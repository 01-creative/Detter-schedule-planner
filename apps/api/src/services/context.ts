import { Hono } from "hono";
import { ContextPackSchema, DEFAULT_TIMEZONE, periodRange } from "@detter/shared";
import type { ContextPack, ContextRange } from "@detter/shared";
import type { AppEnv, ResolvedDeps } from "../env";
import type { Db } from "../db/types";
import { ApiError } from "../lib/errors";
import { ok } from "../lib/respond";
import { currentAuth, requireScope } from "../auth/middleware";

/**
 * AI 上下文包（T12 会在此之上扩展：mindmap 摘要、更多统计、自然语言 briefing）。
 *
 * 这里先给最小可用实现，但把「契约由 ContextPackSchema 兜住」这件事做死：
 * 任何字段漏填都会在 parse 阶段炸掉，而不是让 AI 端收到半成品。
 */

const CONTEXT_RANGES: ContextRange[] = ["today", "week", "month", "quarter"];

export interface ContextPackOptions {
  range: ContextRange;
  include?: string[];
  now: number;
}

interface TaskRow {
  payload: string;
}

const MAX_TASKS = 200;

function toJsonRows(rows: Array<{ payload: string }>): unknown[] {
  return rows.map((row) => JSON.parse(row.payload) as unknown);
}

export async function buildContextPack(
  db: Db,
  userId: string,
  options: ContextPackOptions,
): Promise<ContextPack> {
  const include = new Set(options.include ?? ["tasks", "goals", "okr", "kpi", "pomodoro", "inbox"]);
  const range = periodRange(options.range === "today" ? "day" : options.range, options.now);
  const { start, end } = range;

  const user = await db.first<{ display_name: string; timezone: string }>(
    "SELECT display_name, timezone FROM users WHERE id = ?",
    [userId],
  );

  let tasks: unknown[] = [];
  if (include.has("tasks")) {
    const rows = await db.all<TaskRow>(
      `SELECT payload FROM tasks
        WHERE user_id = ? AND deleted_at IS NULL AND status NOT IN ('dropped', 'done')
          AND (
            (start_at IS NOT NULL AND start_at BETWEEN ? AND ?)
            OR (due_at IS NOT NULL AND due_at BETWEEN ? AND ?)
            -- 没有任何时间戳的待办也算「当前该看的事」，否则 AI 会以为你没事干
            OR (start_at IS NULL AND due_at IS NULL AND status IN ('todo', 'doing', 'inbox'))
          )
        ORDER BY COALESCE(start_at, due_at, 0) ASC
        LIMIT ?`,
      [userId, start, end, start, end, MAX_TASKS],
    );
    tasks = toJsonRows(rows);
  }

  const goals = include.has("goals")
    ? toJsonRows(
        await db.all<TaskRow>(
          "SELECT payload FROM goals WHERE user_id = ? AND deleted_at IS NULL AND status = 'active' ORDER BY sort_index ASC",
          [userId],
        ),
      )
    : [];

  const okr = include.has("okr")
    ? toJsonRows(
        await db.all<TaskRow>(
          "SELECT payload FROM okrs WHERE user_id = ? AND deleted_at IS NULL AND status = 'active' ORDER BY period_start DESC",
          [userId],
        ),
      )
    : [];

  const kpis = include.has("kpi")
    ? toJsonRows(
        await db.all<TaskRow>(
          "SELECT payload FROM kpis WHERE user_id = ? AND deleted_at IS NULL AND sort_index >= 0 ORDER BY sort_index ASC",
          [userId],
        ),
      )
    : [];

  let pomodoro = { sessions: 0, focusMinutes: 0 };
  if (include.has("pomodoro")) {
    // kind / actualMin 没有投影列（不在高频过滤字段里），从 payload 里取
    const row = await db.first<{ sessions: number | null; minutes: number | null }>(
      `SELECT COUNT(*) AS sessions,
              COALESCE(SUM(CAST(json_extract(payload, '$.actualMin') AS INTEGER)), 0) AS minutes
         FROM pomodoro_sessions
        WHERE user_id = ? AND deleted_at IS NULL
          AND json_extract(payload, '$.kind') = 'focus'
          AND started_at BETWEEN ? AND ?`,
      [userId, start, end],
    );
    pomodoro = { sessions: Number(row?.sessions ?? 0), focusMinutes: Number(row?.minutes ?? 0) };
  }

  const inbox = include.has("inbox")
    ? toJsonRows(
        await db.all<TaskRow>(
          "SELECT payload FROM inbox_items WHERE user_id = ? AND deleted_at IS NULL AND status = 'pending' ORDER BY captured_at DESC LIMIT 50",
          [userId],
        ),
      )
    : [];

  const doneRow = await db.first<{ done: number | null }>(
    "SELECT COUNT(*) AS done FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND status = 'done' AND completed_at BETWEEN ? AND ?",
    [userId, start, end],
  );

  const stats: Record<string, number> = {
    tasksInRange: tasks.length,
    tasksCompleted: Number(doneRow?.done ?? 0),
    goalsActive: goals.length,
    okrActive: okr.length,
    kpisActive: kpis.length,
    pomodoroSessions: pomodoro.sessions,
    focusMinutes: pomodoro.focusMinutes,
    inboxPending: inbox.length,
  };

  const inboxPending = stats.inboxPending ?? 0;
  const briefing = [
    `${range.label}：${stats.tasksInRange ?? 0} 项待办 / ${stats.tasksCompleted ?? 0} 项已完成`,
    `进行中的专注 ${stats.focusMinutes ?? 0} 分钟（${stats.pomodoroSessions ?? 0} 个番茄）`,
    inboxPending > 0 ? `收件箱还有 ${inboxPending} 条待分诊` : "收件箱已清空",
  ].join("；");

  return ContextPackSchema.parse({
    generatedAt: options.now,
    range: options.range,
    period: { start: range.start, end: range.end, label: range.label },
    profile: {
      displayName: user?.display_name ?? "",
      timezone: user?.timezone ?? DEFAULT_TIMEZONE,
      quadrantScheme: "eisenhower",
    },
    tasks,
    goals,
    okr,
    kpis,
    pomodoro,
    inbox,
    stats,
    briefing,
  });
}

/** JSON 之外再给一份 markdown：直接粘给 AI 的对话窗口比 JSON 省 token。 */
export function formatContextPackMarkdown(pack: ContextPack): string {
  const lines: string[] = [];
  lines.push(`# Detter 上下文包 · ${pack.period.label}`);
  lines.push("");
  lines.push(pack.briefing);
  lines.push("");
  lines.push(`## 待办（${pack.tasks.length}）`);
  for (const task of pack.tasks as Array<Record<string, unknown>>) {
    const when = task.startAt ?? task.dueAt;
    const time = typeof when === "number" ? new Date(when).toISOString().slice(5, 16).replace("T", " ") : "未排期";
    lines.push(`- [Q${String(task.quadrant ?? "?")}] ${String(task.title ?? "")} · ${time}`);
  }
  lines.push("");
  lines.push(`## 目标（${pack.goals.length}）`);
  for (const goal of pack.goals as Array<Record<string, unknown>>) {
    lines.push(`- ${String(goal.title ?? "")}（${String(goal.status ?? "")}）`);
  }
  lines.push("");
  lines.push(`## 统计`);
  for (const [key, value] of Object.entries(pack.stats)) lines.push(`- ${key}: ${value}`);
  return lines.join("\n");
}

function parseRange(raw: string | undefined): ContextRange {
  if (raw === undefined || raw === "") return "week";
  if (!CONTEXT_RANGES.includes(raw as ContextRange)) {
    throw new ApiError("validation_error", "range 取值不合法", { value: raw, allowed: CONTEXT_RANGES });
  }
  return raw as ContextRange;
}

export function contextRoutes(deps: ResolvedDeps): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get("/context", requireScope("read"), async (c) => {
    const auth = currentAuth(c);
    const range = parseRange(c.req.query("range"));
    const format = c.req.query("format") ?? "json";
    const includeRaw = c.req.query("include");
    const include = includeRaw ? includeRaw.split(",").map((item) => item.trim()).filter(Boolean) : undefined;

    const pack = await buildContextPack(deps.db, auth.userId, { range, include, now: deps.now() });

    if (format === "markdown") {
      return c.body(formatContextPackMarkdown(pack), 200, {
        "content-type": "text/markdown; charset=utf-8",
      });
    }
    if (format !== "json") {
      throw new ApiError("validation_error", "format 只能是 json 或 markdown", { value: format });
    }
    return ok(c, pack);
  });

  return router;
}
