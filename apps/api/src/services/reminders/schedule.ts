import { formatDuration } from "@detter/shared";
import type { Db, DbStatement } from "../../db/types";
import { uuidv7 } from "../../lib/ids";
import { changeStatement, updateEntityStatement } from "../../repo/crud";
import { runHomeworkDigest } from "../courses/digest";
import { REMINDER_HORIZON_DAYS, REMINDER_MAX_ATTEMPTS, readReminderConfig, type ReadConfigOptions } from "./config";
import { getNotifier } from "./notifiers";
import { parseVapidCredentials } from "./webpush/vapid";
import type {
  ImplementedChannel,
  NotifierContext,
  ReminderPayload,
  ReminderRuntimeConfig,
  VapidCredentials,
} from "./types";

/**
 * 提醒调度器：整个 T14 的心脏。
 *
 * 一次 tick 做两件事（顺序不能反）：
 *   1) 物化（materialize）：把「未完成任务的时间点 − remindOffsets」落成 reminders 行，
 *      唯一键 (task_id, fire_at, channel) 保证重复 tick 不会重复行；
 *   2) 投递（deliver）：取出 fire_at <= now 的 pending 行，交给对应渠道。
 *
 * 失败策略：
 *   - 临时失败（网络/5xx）→ 保留 pending，下个 tick 再试；第 2 次失败后标 failed 并降级；
 *   - 永久失败（没配 token / 没有设备订阅 / 401）→ 立刻降级，不浪费一分钟；
 *   - 降级 = 在同一个 (task, fireAt) 上按配置的渠道链顺序换下一个渠道，仍受唯一键约束。
 *
 * 这个文件不依赖 Hono / 请求对象，Workers 的 scheduled、Node 的 setInterval、
 * 单测和三处手动触发（POST /reminders/tick）共用同一个入口。
 */

export const REMINDER_HORIZON_MS = REMINDER_HORIZON_DAYS * 24 * 60 * 60 * 1000;
/** 迟到超过 24 小时的提醒不再发送：迟到一天的通知只剩噪音。 */
export const REMINDER_MAX_LATENESS_MS = 24 * 60 * 60 * 1000;
const TICK_BATCH_LIMIT = 50;
const MAX_ROUNDS = 4;
const MAX_REMINDED_AT = 50;
const BATCH_CHUNK = 50;

export interface ReminderTask {
  id: string;
  status: string;
  startAt: number | null;
  dueAt: number | null;
  remindOffsets: number[];
  title: string;
  quadrant: number | null;
  notes: string;
  location: string;
  kind: string;
}

/**
 * 提醒基准时间：startAt ?? dueAt。
 * 有开始时间就按开始时间（日程），否则按截止时间（DDL）。
 */
export function reminderBaseTime(task: Pick<ReminderTask, "startAt" | "dueAt">): number | null {
  if (typeof task.startAt === "number" && Number.isFinite(task.startAt)) return task.startAt;
  if (typeof task.dueAt === "number" && Number.isFinite(task.dueAt)) return task.dueAt;
  return null;
}

/**
 * 任务的全部提醒时间点（不按 now 过滤）。
 *
 * 用途有两个：
 * - 物化时取其中落在未来 7 天的子集；
 * - 取消时判断一条 pending 行是否还「对得上」任务的当前时间/偏移
 *   （比如任务改期后，旧的 fireAt 就不在集合里了）。
 *
 * 注意：过去的点也要保留在集合里。服务器停机 25 小时后，那条 pending 行
 * 仍然对应任务的原始时间，应该由投递阶段判为 expired，而不是在物化阶段被静默取消。
 */
export function allFireTimes(task: Pick<ReminderTask, "startAt" | "dueAt" | "remindOffsets">): number[] {
  const base = reminderBaseTime(task);
  if (base === null) return [];

  const fireTimes = new Set<number>();
  for (const offset of task.remindOffsets) {
    if (!Number.isFinite(offset) || offset < 0) continue;
    fireTimes.add(base - Math.trunc(offset) * 60_000);
  }
  return [...fireTimes].sort((left, right) => left - right);
}

/**
 * 生成未来 7 天内的提醒时间点。
 *
 * - 偏移单位是分钟，且 schema 保证 ≥ 0（不允许「提前 -5 分钟」）；
 * - 结果去重并升序（两个 offset 撞到同一时刻只提醒一次）；
 * - `fireAt >= now`：等于 now 的也要收，否则「现在就到期」的任务永远排不上。
 */
export function computeFireTimes(
  task: Pick<ReminderTask, "startAt" | "dueAt" | "remindOffsets">,
  now: number,
  horizonMs: number = REMINDER_HORIZON_MS,
): number[] {
  const limit = now + horizonMs;
  return allFireTimes(task).filter((fireAt) => fireAt >= now && fireAt <= limit);
}

/* -------------------------------------------------------------------------- */
/*                                  类型 / 行                                   */
/* -------------------------------------------------------------------------- */

interface TaskRow {
  id: string;
  status: string;
  start_at: number | null;
  due_at: number | null;
  payload: string;
}

interface DueReminderRow {
  id: string;
  user_id: string;
  task_id: string;
  fire_at: number;
  channel: string;
  attempts: number;
  payload: string | null;
  task_status: string | null;
  task_deleted_at: number | null;
  start_at: number | null;
  due_at: number | null;
}

export interface ReminderTickOptions {
  /** 原始 VAPID 环境变量；内部会解析成密钥对，解析失败则 webpush 渠道不可用 */
  vapid?: VapidCredentials | null;
  fetch?: typeof fetch;
  /** 额外的 push endpoint 域名后缀（自建推送服务时用） */
  pushEndpointAllowlist?: string[];
  /** 只跑某个用户（测试/排障用；正常 cron 不传） */
  userId?: string;
  maxRounds?: number;
  /** 是否顺带跑「本周还没记作业」的汇总提醒；默认开，单测可关 */
  homeworkDigest?: boolean;
}

export interface ReminderTickSummary {
  users: number;
  materialized: number;
  cancelled: number;
  processed: number;
  sent: number;
  retried: number;
  failed: number;
  downgraded: number;
  expired: number;
  skipped: number;
  /** 本次 tick 写出的「本周还没记作业」汇总通知条数 */
  digest: number;
  errors: string[];
}

function emptySummary(): ReminderTickSummary {
  return {
    users: 0,
    materialized: 0,
    cancelled: 0,
    processed: 0,
    sent: 0,
    retried: 0,
    failed: 0,
    downgraded: 0,
    expired: 0,
    skipped: 0,
    digest: 0,
    errors: [],
  };
}

function asNullableInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return null;
}

function parseJsonObject(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseOffsets(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const offsets: number[] = [];
  for (const item of raw) {
    if (typeof item === "number" && Number.isFinite(item) && item >= 0) offsets.push(Math.trunc(item));
  }
  return offsets;
}

function parseTaskRow(row: TaskRow): ReminderTask {
  const payload = parseJsonObject(row.payload);
  return {
    id: row.id,
    status: row.status,
    startAt: asNullableInt(row.start_at),
    dueAt: asNullableInt(row.due_at),
    remindOffsets: parseOffsets(payload.remindOffsets),
    title: typeof payload.title === "string" && payload.title.length > 0 ? payload.title : "未命名任务",
    quadrant: asNullableInt(payload.quadrant),
    notes: typeof payload.notes === "string" ? payload.notes : "",
    location: typeof payload.location === "string" ? payload.location : "",
    kind: typeof payload.kind === "string" ? payload.kind : "task",
  };
}

/* -------------------------------------------------------------------------- */
/*                                 时间格式化                                   */
/* -------------------------------------------------------------------------- */

/** 用用户时区格式化「11-26 09:30」。Intl 在 Workers / Node 都可用，失败时退回 ISO。 */
export function formatInTimezone(timestamp: number, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("zh-CN", {
      timeZone: timezone || "Asia/Shanghai",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(timestamp));
    return parts.replace(/\//g, "-").replace(/\s+/g, " ");
  } catch {
    return new Date(timestamp).toISOString().slice(5, 16).replace("T", " ");
  }
}

function buildPayload(task: ReminderTask, row: DueReminderRow, timezone: string): ReminderPayload {
  const base = reminderBaseTime(task) ?? row.fire_at;
  const offsetMin = Math.max(0, Math.round((base - row.fire_at) / 60_000));
  const isDue = task.startAt === null;
  const when = formatInTimezone(base, timezone);

  const lead = offsetMin > 0 ? `还有 ${formatDuration(offsetMin)}` : isDue ? "现在到期" : "现在开始";
  const title = `${lead}：${task.title}`;
  const detail = [`${when} ${isDue ? "截止" : "开始"}`];
  if (task.location) detail.push(task.location);
  if (task.quadrant !== null) detail.push(`Q${task.quadrant}`);
  const note = task.notes.trim();
  if (note) detail.push(note.length > 60 ? `${note.slice(0, 60)}…` : note);

  return {
    reminderId: row.id,
    taskId: task.id,
    title,
    body: detail.join(" · "),
    url: `/?task=${encodeURIComponent(task.id)}`,
    tag: `detter-${task.id}-${row.fire_at}`,
    fireAt: row.fire_at,
  };
}

/* -------------------------------------------------------------------------- */
/*                                  物化阶段                                    */
/* -------------------------------------------------------------------------- */

interface PendingStatement {
  statement: DbStatement;
  counted: boolean;
}

function pendingInsertStatement(
  userId: string,
  taskId: string,
  fireAt: number,
  channel: ImplementedChannel,
  now: number,
): DbStatement {
  return {
    // 已存在同三元组时：只有「已取消」的行可以被复活（重新排期/重新打开渠道）；
    // sent / failed / pending 一律保持原状——这是「不重复推送」的最后一道保险。
    sql: `INSERT INTO reminders
            (id, user_id, task_id, fire_at, channel, status, attempts, sent_at, error, created_at)
          VALUES (?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, ?)
          ON CONFLICT(task_id, fire_at, channel) DO UPDATE SET
            status = 'pending', attempts = 0, sent_at = NULL, error = NULL
          WHERE reminders.status = 'cancelled'`,
    params: [uuidv7(now), userId, taskId, fireAt, channel, now],
  };
}

async function runStatements(db: Db, statements: DbStatement[]): Promise<number[]> {
  const changes: number[] = [];
  for (let index = 0; index < statements.length; index += BATCH_CHUNK) {
    const chunk = statements.slice(index, index + BATCH_CHUNK);
    const results = await db.batch(chunk);
    for (const result of results) changes.push(result.changes);
  }
  return changes;
}

async function materializeUser(
  db: Db,
  userId: string,
  config: ReminderRuntimeConfig,
  now: number,
  summary: ReminderTickSummary,
): Promise<void> {
  // 1) 已完成 / 已删除的任务：立刻取消所有还没发出去的提醒
  const stale = await db.run(
    `UPDATE reminders SET status = 'cancelled'
      WHERE user_id = ? AND status = 'pending'
        AND task_id IN (
          SELECT id FROM tasks
           WHERE user_id = ? AND (deleted_at IS NOT NULL OR status IN ('done', 'dropped'))
        )`,
    [userId, userId],
  );
  summary.cancelled += stale.changes;

  if (!config.enabled) {
    const disabled = await db.run(
      "UPDATE reminders SET status = 'cancelled' WHERE user_id = ? AND status = 'pending'",
      [userId],
    );
    summary.cancelled += disabled.changes;
    return;
  }

  // 2) 渠道链里被移除的渠道：立刻取消，避免用户关掉某渠道后它还在发。
  //    注意只取消「不在链上」的，不能把所有非主渠道都取消——
  //    降级产生的 pending 行（例如 wechat 失败后入队的 inapp）必须留下。
  const channelPlaceholders = config.channels.map(() => "?").join(", ");
  const switched = await db.run(
    `UPDATE reminders SET status = 'cancelled'
      WHERE user_id = ? AND status = 'pending' AND channel NOT IN (${channelPlaceholders})`,
    [userId, ...config.channels],
  );
  summary.cancelled += switched.changes;

  const primary = config.channels[0] as ImplementedChannel;

  // 3) 逐任务生成未来 7 天的时间点，并取消「已不再对应任何时间点」的 pending 行
  const tasks = await db.all<TaskRow>(
    "SELECT id, status, start_at, due_at, payload FROM tasks WHERE user_id = ? AND deleted_at IS NULL",
    [userId],
  );

  const pending: PendingStatement[] = [];
  for (const row of tasks) {
    const task = parseTaskRow(row);
    if (task.status === "done" || task.status === "dropped") continue;

    const fireTimes = computeFireTimes(task, now);
    const validTimes = allFireTimes(task);
    for (const fireAt of fireTimes) {
      pending.push({ statement: pendingInsertStatement(userId, task.id, fireAt, primary, now), counted: true });
    }

    // 只取消「对不上当前时间/偏移」的 pending 行；过去的合法点留给投递阶段判 expired
    if (validTimes.length === 0) {
      pending.push({
        statement: {
          sql: "UPDATE reminders SET status = 'cancelled' WHERE user_id = ? AND task_id = ? AND status = 'pending'",
          params: [userId, task.id],
        },
        counted: false,
      });
    } else {
      const placeholders = validTimes.map(() => "?").join(", ");
      pending.push({
        statement: {
          sql: `UPDATE reminders SET status = 'cancelled'
                 WHERE user_id = ? AND task_id = ? AND status = 'pending' AND fire_at NOT IN (${placeholders})`,
          params: [userId, task.id, ...validTimes],
        },
        counted: false,
      });
    }
  }

  if (pending.length === 0) return;
  const changes = await runStatements(
    db,
    pending.map((item) => item.statement),
  );
  pending.forEach((item, index) => {
    const count = changes[index] ?? 0;
    if (item.counted) summary.materialized += count;
    else summary.cancelled += count;
  });
}

/* -------------------------------------------------------------------------- */
/*                                  投递阶段                                    */
/* -------------------------------------------------------------------------- */

async function loadDueReminders(
  db: Db,
  userId: string,
  now: number,
  excludeIds: string[],
): Promise<DueReminderRow[]> {
  const exclusion = excludeIds.length > 0 ? ` AND r.id NOT IN (${excludeIds.map(() => "?").join(", ")})` : "";
  return db.all<DueReminderRow>(
    `SELECT r.id, r.user_id, r.task_id, r.fire_at, r.channel, r.attempts,
            t.payload, t.status AS task_status, t.deleted_at AS task_deleted_at,
            t.start_at, t.due_at
       FROM reminders r
       LEFT JOIN tasks t ON t.id = r.task_id AND t.user_id = r.user_id
      WHERE r.user_id = ? AND r.status = 'pending' AND r.fire_at <= ?${exclusion}
      ORDER BY r.fire_at ASC, r.id ASC
      LIMIT ?`,
    [userId, now, ...excludeIds, TICK_BATCH_LIMIT],
  );
}

async function markTaskReminded(db: Db, userId: string, taskId: string, fireAt: number, now: number): Promise<void> {
  const row = await db.first<{ payload: string; deleted_at: number | null; status: string }>(
    "SELECT payload, deleted_at, status FROM tasks WHERE id = ? AND user_id = ?",
    [taskId, userId],
  );
  if (!row || row.deleted_at !== null) return;
  if (row.status === "done" || row.status === "dropped") return;

  const payload = parseJsonObject(row.payload);
  const existing = Array.isArray(payload.remindedAt)
    ? payload.remindedAt.filter((item): item is number => typeof item === "number")
    : [];
  if (existing.includes(fireAt)) return;

  const remindedAt = [...existing, fireAt].sort((left, right) => left - right).slice(-MAX_REMINDED_AT);
  const rev = Number(payload.rev ?? 0) + 1;
  const next = { ...payload, id: taskId, remindedAt, rev, updatedAt: now, deletedAt: null };

  await db.batch([
    updateEntityStatement("task", userId, next),
    changeStatement("task", userId, taskId, rev, false, next, now),
  ]);
}

async function enqueueFallback(
  db: Db,
  row: DueReminderRow,
  config: ReminderRuntimeConfig,
  now: number,
): Promise<boolean> {
  // 已尝试过的渠道（含当前这条；cancelled 的不算，它可以被复活）
  const tried = await db.all<{ channel: string }>(
    "SELECT channel FROM reminders WHERE user_id = ? AND task_id = ? AND fire_at = ? AND status <> 'cancelled'",
    [row.user_id, row.task_id, row.fire_at],
  );
  const triedChannels = new Set(tried.map((item) => item.channel));
  const next = config.channels.find((channel) => !triedChannels.has(channel));
  if (!next) return false;

  const statement = pendingInsertStatement(row.user_id, row.task_id, row.fire_at, next, now);
  const result = await db.run(statement.sql, statement.params ?? []);
  return result.changes > 0;
}

async function processReminder(
  db: Db,
  row: DueReminderRow,
  config: ReminderRuntimeConfig,
  context: Omit<NotifierContext, "userId" | "now" | "config">,
  now: number,
  summary: ReminderTickSummary,
): Promise<void> {
  // 迟到太久：直接过期，不制造「三天前该做的事现在才提醒」的噪音
  if (now - row.fire_at > REMINDER_MAX_LATENESS_MS) {
    await db.run("UPDATE reminders SET status = 'expired', error = ? WHERE id = ?", [
      "超过 24 小时发送窗口",
      row.id,
    ]);
    summary.expired += 1;
    return;
  }

  const task = row.payload && row.task_deleted_at === null && row.task_status !== null
    ? parseTaskRow({ id: row.task_id, status: row.task_status, start_at: row.start_at, due_at: row.due_at, payload: row.payload })
    : null;

  if (!task || task.status === "done" || task.status === "dropped") {
    await db.run("UPDATE reminders SET status = 'cancelled', error = ? WHERE id = ?", [
      task ? "任务已完成，跳过" : "任务不存在或已删除",
      row.id,
    ]);
    summary.skipped += 1;
    return;
  }

  const notifier = getNotifier(row.channel);
  if (!notifier) {
    await db.run("UPDATE reminders SET status = 'failed', error = ? WHERE id = ?", [
      `渠道未实现：${row.channel}`,
      row.id,
    ]);
    summary.failed += 1;
    const downgraded = await enqueueFallback(db, row, config, now);
    if (downgraded) summary.downgraded += 1;
    return;
  }

  const payload = buildPayload(task, row, context.timezone);
  let result: Awaited<ReturnType<typeof notifier.send>>;
  try {
    result = await notifier.send(payload, { ...context, userId: row.user_id, now, config });
  } catch (error) {
    result = { ok: false, error: `渠道异常：${error instanceof Error ? error.message : String(error)}` };
  }

  if (result.ok) {
    await db.run("UPDATE reminders SET status = 'sent', attempts = attempts + 1, sent_at = ?, error = NULL WHERE id = ?", [
      now,
      row.id,
    ]);
    summary.sent += 1;
    await markTaskReminded(db, row.user_id, row.task_id, row.fire_at, now);
    return;
  }

  const attempts = row.attempts + 1;
  const exhausted = result.permanent === true || attempts >= REMINDER_MAX_ATTEMPTS;
  const error = (result.error ?? "未知错误").slice(0, 500);

  if (!exhausted) {
    await db.run("UPDATE reminders SET attempts = ?, error = ? WHERE id = ?", [attempts, error, row.id]);
    summary.retried += 1;
    return;
  }

  await db.run("UPDATE reminders SET status = 'failed', attempts = ?, error = ? WHERE id = ?", [
    attempts,
    error,
    row.id,
  ]);
  summary.failed += 1;
  const downgraded = await enqueueFallback(db, row, config, now);
  if (downgraded) summary.downgraded += 1;
}

async function readTimezone(db: Db, userId: string): Promise<string> {
  const row = await db.first<{ timezone: string | null }>("SELECT timezone FROM users WHERE id = ?", [userId]);
  return row?.timezone && row.timezone.trim() ? row.timezone.trim() : "Asia/Shanghai";
}

/* -------------------------------------------------------------------------- */
/*                                   入口                                       */
/* -------------------------------------------------------------------------- */

export async function runReminderTick(
  db: Db,
  now: number,
  options: ReminderTickOptions = {},
): Promise<ReminderTickSummary> {
  const summary = emptySummary();
  const vapid = parseVapidCredentials(options.vapid ?? null);
  const fetchImpl: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const allowlist = options.pushEndpointAllowlist ?? [];

  const userIds = options.userId
    ? [options.userId]
    : (await db.all<{ id: string }>("SELECT id FROM users ORDER BY created_at ASC")).map((row) => row.id);
  summary.users = userIds.length;

  const maxRounds = Math.max(1, options.maxRounds ?? MAX_ROUNDS);
  const configOptions: ReadConfigOptions = { vapidConfigured: vapid !== null };

  for (const userId of userIds) {
    try {
      const config = await readReminderConfig(db, userId, configOptions);
      const timezone = await readTimezone(db, userId);

      await materializeUser(db, userId, config, now, summary);

      const processed = new Set<string>();
      const context = { db, timezone, config, vapid, pushEndpointAllowlist: allowlist, fetch: fetchImpl };

      for (let round = 0; round < maxRounds; round += 1) {
        const due = await loadDueReminders(db, userId, now, [...processed]);
        if (due.length === 0) break;
        for (const row of due) {
          processed.add(row.id);
          summary.processed += 1;
          await processReminder(db, row, config, context, now, summary);
        }
      }

      /**
       * 课程遗漏提醒（T15）：一次性汇总通知，不经过 reminders 表——
       * 它没有 Task 可挂，而复用 notifications.reminder_id 的唯一索引就能做到幂等。
       * 放在投递之后：同一分钟内用户先收到到点提醒，再看到「这周还没记作业」。
       */
      if (options.homeworkDigest !== false) {
        try {
          const digest = await runHomeworkDigest(db, userId, now);
          if (digest.emitted) summary.digest += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          summary.errors.push(`user ${userId.slice(0, 8)} digest: ${message}`);
          console.error(`[reminders] 课程遗漏提醒失败 user=${userId.slice(0, 8)}: ${message}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.errors.push(`user ${userId.slice(0, 8)}: ${message}`);
      console.error(`[reminders] tick 失败 user=${userId.slice(0, 8)}: ${message}`);
    }
  }

  return summary;
}
