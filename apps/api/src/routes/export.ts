import { Hono } from "hono";
import { ENTITY_NAMES, addDays, dayKey, startOfDay } from "@detter/shared";
import type { ContextRange } from "@detter/shared";
import type { AppEnv, ResolvedDeps } from "../env";
import { ApiError } from "../lib/errors";
import { currentAuth, requireScope } from "../auth/middleware";
import { snapshotAll } from "../sync/query";
import { buildContextPack, formatContextPackMarkdown } from "../services/context";

/**
 * 导出：给 AI 的完整数据、给人看的周报、给日历订阅的 ICS。
 *
 * 三个端点都是只读（read scope），返回的是文件而不是 API 信封：
 *   GET /export/json      → detter-export-v1 信封的全量数据
 *   GET /export/markdown  → 可直接粘贴/阅读的周报（默认 week，可传 range）
 *   GET /export/ics       → RFC5545 日历订阅（text/calendar + Content-Disposition）
 *
 * 全部带 Content-Disposition: attachment，浏览器点链接即下载而不是新开标签页。
 */

const MIME_JSON = "application/json; charset=utf-8";
const MIME_MARKDOWN = "text/markdown; charset=utf-8";
const MIME_ICS = "text/calendar; charset=utf-8";

const RANGE_VALUES: readonly ContextRange[] = ["today", "week", "month", "quarter"];

type JsonObject = Record<string, unknown>;

function attachment(filename: string): Record<string, string> {
  return {
    "content-disposition": `attachment; filename="${filename}"`,
    "cache-control": "no-store",
  };
}

function fileStamp(now: number): string {
  return dayKey(now);
}

function parseRange(raw: string | undefined): ContextRange {
  if (raw === undefined || raw === "") return "week";
  if (!RANGE_VALUES.includes(raw as ContextRange)) {
    throw new ApiError("validation_error", "range 取值不合法", { value: raw, allowed: RANGE_VALUES });
  }
  return raw as ContextRange;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/* -------------------------------------------------------------------------- */
/*                                   ICS                                       */
/* -------------------------------------------------------------------------- */

/** 2026-11-25T07:00:00.000Z → 20261125T070000Z */
function icsUtc(ts: number): string {
  return new Date(ts).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** 全天事件用 VALUE=DATE：20261125 */
function icsDate(ts: number): string {
  return dayKey(ts).replace(/-/g, "");
}

/** RFC5545 文本转义：\ ; , 换行 */
function icsEscape(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * RFC5545 折行：每行不超过 75 个八位组，续行以单个空格开头。
 * 按「字符」而不是 UTF-16 码元切分，避免把中文/emoji 拆坏。
 */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > 73) {
      chunks.push(current);
      current = char;
      bytes = size;
    } else {
      current += char;
      bytes += size;
    }
  }
  chunks.push(current);
  return chunks.join("\r\n ");
}

function buildIcs(tasks: JsonObject[], now: number): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Detter//Detter Schedule//CN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Detter",
    "X-WR-TIMEZONE:Asia/Shanghai",
    // 订阅端建议的刷新间隔（Google Calendar 仍按其自身策略抓取）
    "REFRESH-INTERVAL;VALUE=DURATION:PT30M",
    "X-PUBLISHED-TTL:PT30M",
  ];

  for (const task of tasks) {
    const status = asString(task.status, "todo");
    if (status === "done" || status === "dropped") continue;

    const startAt = asNullableNumber(task.startAt);
    const dueAt = asNullableNumber(task.dueAt);
    const endAt = asNullableNumber(task.endAt);
    if (startAt === null && dueAt === null) continue;

    const title = asString(task.title, "未命名");
    const rrule = asString(task.rrule);
    const allDay = task.allDay === true && startAt !== null;
    const estimateMin = asNullableNumber(task.estimateMin) ?? 30;

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${asString(task.id, "unknown")}@detter`);
    lines.push(`DTSTAMP:${icsUtc(now)}`);

    if (allDay && startAt !== null) {
      lines.push(`DTSTART;VALUE=DATE:${icsDate(startAt)}`);
      lines.push(`DTEND;VALUE=DATE:${icsDate(addDays(startOfDay(startAt), 1))}`);
      if (rrule) lines.push(`RRULE:${rrule}`);
    } else {
      const start = startAt ?? (dueAt as number);
      const naturalEnd = endAt !== null && endAt > start ? endAt : dueAt !== null && dueAt > start ? dueAt : null;
      const end = naturalEnd ?? start + Math.max(15, estimateMin) * 60_000;
      lines.push(`DTSTART:${icsUtc(start)}`);
      lines.push(`DTEND:${icsUtc(end)}`);
      if (rrule) lines.push(`RRULE:${rrule}`);
    }

    // 截止型任务（只有 dueAt）在日历上标成「截止：…」，一眼能分清日程与 DDL
    const summary = startAt === null && dueAt !== null ? `截止：${title}` : title;
    lines.push(`SUMMARY:${icsEscape(summary)}`);

    const descriptionParts: string[] = [];
    const notes = asString(task.notes);
    if (notes) descriptionParts.push(notes);
    const tags = asStringArray(task.tags);
    if (tags.length > 0) descriptionParts.push(`标签：${tags.join("、")}`);
    const quadrant = asNullableNumber(task.quadrant);
    if (quadrant !== null) descriptionParts.push(`象限：Q${quadrant}`);
    descriptionParts.push(`状态：${status}`);
    lines.push(`DESCRIPTION:${icsEscape(descriptionParts.join("\n"))}`);

    const location = asString(task.location);
    if (location) lines.push(`LOCATION:${icsEscape(location)}`);
    if (tags.length > 0) lines.push(`CATEGORIES:${tags.map((tag) => icsEscape(tag)).join(",")}`);
    lines.push("STATUS:CONFIRMED");
    lines.push("TRANSP:OPAQUE");
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

/* -------------------------------------------------------------------------- */
/*                                  路由                                       */
/* -------------------------------------------------------------------------- */

export function exportRoutes(deps: ResolvedDeps): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get("/export/json", requireScope("read"), async (c) => {
    const auth = currentAuth(c);
    const now = deps.now();

    const [snapshot, user] = await Promise.all([
      snapshotAll(deps.db, auth.userId, now),
      deps.db.first<{ display_name: string; timezone: string; created_at: number }>(
        "SELECT display_name, timezone, created_at FROM users WHERE id = ?",
        [auth.userId],
      ),
    ]);

    const counts: Record<string, number> = {};
    for (const entity of ENTITY_NAMES) {
      counts[entity] = snapshot.entities[entity]?.length ?? 0;
    }

    const body = {
      format: "detter-export-v1",
      exportedAt: now,
      exportedAtIso: new Date(now).toISOString(),
      version: deps.config.version,
      profile: {
        displayName: user?.display_name ?? "",
        timezone: user?.timezone ?? "Asia/Shanghai",
        quadrantScheme: "eisenhower",
      },
      cursor: snapshot.cursor,
      counts,
      entities: snapshot.entities,
    };

    return c.body(JSON.stringify(body, null, 2), 200, {
      "content-type": MIME_JSON,
      ...attachment(`detter-${fileStamp(now)}.json`),
    });
  });

  router.get("/export/markdown", requireScope("read"), async (c) => {
    const auth = currentAuth(c);
    const now = deps.now();
    const range = parseRange(c.req.query("range"));
    const pack = await buildContextPack(deps.db, auth.userId, { range, now });

    return c.body(formatContextPackMarkdown(pack, now), 200, {
      "content-type": MIME_MARKDOWN,
      ...attachment(`detter-${fileStamp(now)}.md`),
    });
  });

  router.get("/export/ics", requireScope("read"), async (c) => {
    const auth = currentAuth(c);
    const now = deps.now();

    const rows = await deps.db.all<{ payload: string }>(
      "SELECT payload FROM tasks WHERE user_id = ? AND deleted_at IS NULL ORDER BY COALESCE(start_at, due_at, 0) ASC",
      [auth.userId],
    );
    const tasks = rows.map((row) => {
      try {
        return JSON.parse(row.payload) as JsonObject;
      } catch {
        return {} as JsonObject;
      }
    });

    return c.body(buildIcs(tasks, now), 200, {
      "content-type": MIME_ICS,
      ...attachment(`detter-${fileStamp(now)}.ics`),
    });
  });

  return router;
}
