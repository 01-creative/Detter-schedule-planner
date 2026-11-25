import {
  ContextPackSchema,
  DEFAULT_TIMEZONE,
  dayKey,
  dayKeyToTs,
  endOfDay,
  endOfWeek,
  formatTime,
  parseQuickCapture,
  periodRange,
  startOfDay,
  startOfWeek,
} from "@detter/shared";
import type { CaptureSource, ContextPack, ContextRange, ParsedDraft } from "@detter/shared";
import type { Db } from "../db/types";
import { ApiError } from "../lib/errors";
import { createEntity } from "../repo/crud";

/**
 * AI 上下文包与快速捕获的服务层。
 *
 * 设计原则（docs/architecture/06-AI-INTEGRATION.md §2）：
 * - 一次查询把「AI 需要知道的一切」按区间取齐，宁可多给语义，也不让模型猜字段；
 * - briefing 纯规则拼接，不调模型：离线、可控、可测；
 * - markdown 版式固定，用户可以直接粘进任何聊天窗口。
 *
 * 该文件被 routes/context.ts（REST）与 services/mcp.ts（MCP 工具）共用，
 * 因此这里不出现任何 Hono / 请求对象。
 */

const MAX_TASKS = 200;
const MAX_INBOX = 20;
const MAX_GOALS = 100;

export interface ContextPackOptions {
  range: ContextRange;
  /** 需要包含的区块；缺省包含除 mindmap 外的全部 */
  include?: string[];
  now: number;
}

interface PayloadRow {
  payload: string;
}

type JsonObject = Record<string, unknown>;

function parsePayload(row: PayloadRow): JsonObject {
  try {
    const parsed: unknown = JSON.parse(row.payload);
    return typeof parsed === "object" && parsed !== null ? (parsed as JsonObject) : {};
  } catch {
    return {};
  }
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/* -------------------------------------------------------------------------- */
/*                                  取数                                       */
/* -------------------------------------------------------------------------- */

interface TaskView {
  id: string;
  title: string;
  status: string;
  kind: string;
  quadrant: number;
  startAt: number | null;
  endAt: number | null;
  dueAt: number | null;
  allDay: boolean;
  completedAt: number | null;
  goalId: string | null;
  goalTitle: string | null;
  tags: string[];
  notes: string;
  estimateMin: number | null;
  pinned: boolean;
  rrule: string | null;
}

interface GoalView {
  id: string;
  title: string;
  kind: string;
  status: string;
  horizon: string;
  progress: number;
  milestones: Array<{ title: string; done: boolean }>;
  rrule: string | null;
}

interface OkrView {
  id: string;
  objective: string;
  title: string;
  period: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  krs: Array<{
    id: string;
    title: string;
    metricType: string;
    current: number;
    target: number;
    unit: string;
    progress: number;
  }>;
}

interface KpiView {
  id: string;
  name: string;
  value: number;
  target: number;
  unit: string;
  rate: number;
  period: string;
  direction: string;
  autoSource: string | null;
}

export interface KpiSummary {
  id: string;
  name: string;
  unit: string;
  value: number;
  target: number;
  rate: number;
  period: string;
}

interface PomodoroStats {
  sessions: number;
  focusMinutes: number;
}

/* -------------------------------------------------------------------------- */
/*                                  KPI 汇总                                   */
/* -------------------------------------------------------------------------- */

async function pomodoroStats(db: Db, userId: string, start: number, end: number): Promise<PomodoroStats> {
  const row = await db.first<{ sessions: number | null; minutes: number | null }>(
    `SELECT COUNT(*) AS sessions,
            COALESCE(SUM(CAST(json_extract(payload, '$.actualMin') AS INTEGER)), 0) AS minutes
       FROM pomodoro_sessions
      WHERE user_id = ? AND deleted_at IS NULL
        AND json_extract(payload, '$.kind') = 'focus'
        AND started_at BETWEEN ? AND ?`,
    [userId, start, end],
  );
  return { sessions: Number(row?.sessions ?? 0), focusMinutes: Number(row?.minutes ?? 0) };
}

async function completedTaskCount(db: Db, userId: string, start: number, end: number): Promise<number> {
  const row = await db.first<{ done: number | null }>(
    "SELECT COUNT(*) AS done FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND status = 'done' AND completed_at BETWEEN ? AND ?",
    [userId, start, end],
  );
  return Number(row?.done ?? 0);
}

interface KpiRow extends JsonObject {
  id: string;
  name: string;
  unit: string;
  targetValue: number;
  period: string;
  aggregation: string;
  autoSource: string | null;
  direction: string;
  sortIndex: number;
}

function aggregateEntries(values: number[], aggregation: string, dates: string[]): number {
  if (values.length === 0) return 0;
  switch (aggregation) {
    case "count":
      return values.length;
    case "max":
      return Math.max(...values);
    case "avg":
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    case "last": {
      // 取日期最大的那条；日期相同时取靠后写入的那条（查询已按 updated_at 排序）
      let best = 0;
      for (let index = 1; index < values.length; index += 1) {
        const current = dates[index] ?? "";
        const previous = dates[best] ?? "";
        if (current >= previous) best = index;
      }
      return values[best] ?? 0;
    }
    default:
      return values.reduce((sum, value) => sum + value, 0);
  }
}

/**
 * 计算区间内每个 KPI 的值与达成率。
 *
 * 聚合方式与 KPI 自身声明一致；autoSource 优先（深度工作时长这类 KPI 不靠手打卡）。
 * 返回结构同时服务上下文包（KpiView）与 MCP 的 get_kpi_summary。
 */
export async function summarizeKpis(
  db: Db,
  userId: string,
  options: {
    start: number;
    end: number;
    pomodoro?: PomodoroStats;
    tasksDone?: number;
    limit?: number;
  },
): Promise<KpiView[]> {
  const rows = await db.all<PayloadRow>(
    "SELECT payload FROM kpis WHERE user_id = ? AND deleted_at IS NULL AND sort_index >= 0 ORDER BY sort_index ASC LIMIT ?",
    [userId, options.limit ?? 50],
  );
  const kpis = rows.map(parsePayload).filter((row): row is KpiRow => typeof row.id === "string");

  const entryRows = await db.all<PayloadRow>(
    "SELECT payload FROM kpi_entries WHERE user_id = ? AND deleted_at IS NULL AND date BETWEEN ? AND ? ORDER BY date ASC, updated_at ASC",
    [userId, dayKey(options.start), dayKey(options.end)],
  );

  const valuesByKpi = new Map<string, { values: number[]; dates: string[] }>();
  for (const row of entryRows) {
    const entry = parsePayload(row);
    const kpiId = asString(entry.kpiId);
    if (!kpiId) continue;
    const bucket = valuesByKpi.get(kpiId) ?? { values: [], dates: [] };
    bucket.values.push(asNumber(entry.value));
    bucket.dates.push(asString(entry.date));
    valuesByKpi.set(kpiId, bucket);
  }

  const needsPomodoro = kpis.some((kpi) => kpi.autoSource === "pomodoro_min" || kpi.autoSource === "focus_sessions");
  const needsTasks = kpis.some((kpi) => kpi.autoSource === "tasks_done");
  const pomodoro = needsPomodoro && !options.pomodoro
    ? await pomodoroStats(db, userId, options.start, options.end)
    : (options.pomodoro ?? { sessions: 0, focusMinutes: 0 });
  const tasksDone = needsTasks && options.tasksDone === undefined
    ? await completedTaskCount(db, userId, options.start, options.end)
    : (options.tasksDone ?? 0);

  return kpis.map((kpi) => {
    const bucket = valuesByKpi.get(kpi.id);
    let value = aggregateEntries(bucket?.values ?? [], kpi.aggregation, bucket?.dates ?? []);
    if (kpi.autoSource === "pomodoro_min") value = pomodoro.focusMinutes;
    else if (kpi.autoSource === "focus_sessions") value = pomodoro.sessions;
    else if (kpi.autoSource === "tasks_done") value = tasksDone;

    const target = asNumber(kpi.targetValue);
    const direction = kpi.direction === "down" ? "down" : "up";
    let rate = 0;
    if (target > 0) {
      if (direction === "down") rate = value === 0 ? 1 : Math.min(1, target / value);
      else rate = value / target;
    }

    return {
      id: kpi.id,
      name: asString(kpi.name),
      value: round2(value),
      target: round2(target),
      unit: asString(kpi.unit, "次"),
      rate: round2(rate),
      period: kpi.period === "day" || kpi.period === "month" ? kpi.period : "week",
      direction,
      autoSource: typeof kpi.autoSource === "string" ? kpi.autoSource : null,
    };
  });
}

/* -------------------------------------------------------------------------- */
/*                                  上下文包                                    */
/* -------------------------------------------------------------------------- */

const RANGE_PHRASE: Record<ContextRange, string> = {
  today: "今天",
  week: "本周",
  month: "本月",
  quarter: "本季度",
};

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

  const goalRows = include.has("goals")
    ? await db.all<PayloadRow>(
        "SELECT payload FROM goals WHERE user_id = ? AND deleted_at IS NULL AND status = 'active' ORDER BY sort_index ASC LIMIT ?",
        [userId, MAX_GOALS],
      )
    : [];
  const goalPayloads = goalRows.map(parsePayload);
  const goalTitleById = new Map<string, string>();
  for (const goal of goalPayloads) {
    if (typeof goal.id === "string") goalTitleById.set(goal.id, asString(goal.title));
  }

  // 目标进度：优先看里程碑，其次看关联任务的完成比
  const goalTaskRows = await db.all<{ goal_id: string; total: number; done: number }>(
    `SELECT goal_id, COUNT(*) AS total,
            SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
       FROM tasks
      WHERE user_id = ? AND deleted_at IS NULL AND goal_id IS NOT NULL
      GROUP BY goal_id`,
    [userId],
  );
  const goalTaskStats = new Map<string, { total: number; done: number }>();
  for (const row of goalTaskRows) {
    goalTaskStats.set(row.goal_id, { total: Number(row.total), done: Number(row.done) });
  }

  const goals: GoalView[] = goalPayloads.map((goal) => {
    const milestones = Array.isArray(goal.milestones)
      ? goal.milestones
          .filter((item): item is JsonObject => typeof item === "object" && item !== null)
          .map((item) => ({ title: asString(item.title), done: asBoolean(item.done) }))
      : [];
    let progress = 0;
    if (milestones.length > 0) {
      progress = milestones.filter((item) => item.done).length / milestones.length;
    } else {
      const stats = typeof goal.id === "string" ? goalTaskStats.get(goal.id) : undefined;
      if (stats && stats.total > 0) progress = stats.done / stats.total;
    }
    return {
      id: asString(goal.id),
      title: asString(goal.title),
      kind: asString(goal.kind, "once"),
      status: asString(goal.status, "active"),
      horizon: asString(goal.horizon, "none"),
      progress: round2(progress),
      milestones,
      rrule: typeof goal.rrule === "string" ? goal.rrule : null,
    };
  });

  let tasks: TaskView[] = [];
  if (include.has("tasks")) {
    const rows = await db.all<PayloadRow>(
      `SELECT payload FROM tasks
        WHERE user_id = ? AND deleted_at IS NULL AND status NOT IN ('dropped')
          AND (
            (start_at IS NOT NULL AND start_at BETWEEN ? AND ?)
            OR (due_at IS NOT NULL AND due_at BETWEEN ? AND ?)
            OR (completed_at IS NOT NULL AND completed_at BETWEEN ? AND ?)
            -- 没有任何时间戳的待办也是「当前该看的事」，否则 AI 会以为你没事干
            OR (start_at IS NULL AND due_at IS NULL AND completed_at IS NULL AND status IN ('todo', 'doing', 'inbox'))
          )
        ORDER BY COALESCE(start_at, due_at, 0) ASC
        LIMIT ?`,
      [userId, start, end, start, end, start, end, MAX_TASKS],
    );

    tasks = rows.map(parsePayload).map((task) => {
      const goalId = typeof task.goalId === "string" ? task.goalId : null;
      return {
        id: asString(task.id),
        title: asString(task.title),
        status: asString(task.status, "todo"),
        kind: asString(task.kind, "task"),
        quadrant: Math.min(4, Math.max(1, Math.trunc(asNumber(task.quadrant, 2)))),
        startAt: asNullableNumber(task.startAt),
        endAt: asNullableNumber(task.endAt),
        dueAt: asNullableNumber(task.dueAt),
        allDay: asBoolean(task.allDay),
        completedAt: asNullableNumber(task.completedAt),
        goalId,
        goalTitle: goalId ? (goalTitleById.get(goalId) ?? null) : null,
        tags: asStringArray(task.tags),
        notes: truncate(asString(task.notes), 300),
        estimateMin: asNullableNumber(task.estimateMin),
        pinned: asBoolean(task.pinned),
        rrule: typeof task.rrule === "string" ? task.rrule : null,
      };
    });
  }

  let okr: OkrView[] = [];
  if (include.has("okr")) {
    const okrRows = await db.all<PayloadRow>(
      "SELECT payload FROM okrs WHERE user_id = ? AND deleted_at IS NULL AND status = 'active' ORDER BY period_start DESC LIMIT 20",
      [userId],
    );
    const okrPayloads = okrRows.map(parsePayload).filter((row) => typeof row.id === "string");
    const ids = okrPayloads.map((row) => asString(row.id));
    const krRows = ids.length
      ? await db.all<PayloadRow>(
          `SELECT payload FROM key_results
            WHERE user_id = ? AND deleted_at IS NULL AND okr_id IN (${ids.map(() => "?").join(", ")})
            ORDER BY json_extract(payload, '$.sortIndex') ASC, updated_at ASC`,
          [userId, ...ids],
        )
      : [];
    const krsByOkr = new Map<string, OkrView["krs"]>();
    for (const row of krRows.map(parsePayload)) {
      const okrId = asString(row.okrId);
      if (!okrId) continue;
      const current = asNumber(row.currentValue);
      const target = asNumber(row.targetValue, 100);
      const startValue = asNumber(row.startValue);
      const span = target - startValue;
      const progress = span === 0 ? (current >= target ? 1 : 0) : (current - startValue) / span;
      const list = krsByOkr.get(okrId) ?? [];
      list.push({
        id: asString(row.id),
        title: asString(row.title),
        metricType: asString(row.metricType, "percent"),
        current: round2(current),
        target: round2(target),
        unit: asString(row.unit, "%"),
        progress: round2(Math.min(1, Math.max(0, progress))),
      });
      krsByOkr.set(okrId, list);
    }

    okr = okrPayloads.map((row) => {
      const id = asString(row.id);
      return {
        id,
        objective: asString(row.title),
        title: asString(row.title),
        period: asString(row.period, "week"),
        periodStart: asString(row.periodStart),
        periodEnd: asString(row.periodEnd),
        status: asString(row.status, "active"),
        krs: krsByOkr.get(id) ?? [],
      };
    });
  }

  let pomodoro: PomodoroStats = { sessions: 0, focusMinutes: 0 };
  if (include.has("pomodoro")) {
    pomodoro = await pomodoroStats(db, userId, start, end);
  }

  let inbox: JsonObject[] = [];
  if (include.has("inbox")) {
    const rows = await db.all<PayloadRow>(
      "SELECT payload FROM inbox_items WHERE user_id = ? AND deleted_at IS NULL AND status = 'pending' ORDER BY captured_at DESC LIMIT ?",
      [userId, MAX_INBOX],
    );
    inbox = rows.map(parsePayload).map((item) => ({
      id: asString(item.id),
      rawText: asString(item.rawText),
      source: asString(item.source, "manual"),
      capturedAt: asNullableNumber(item.capturedAt) ?? 0,
      parsed: item.parsed ?? null,
    }));
  }

  const tasksCompleted = await completedTaskCount(db, userId, start, end);
  const doneThisWeek = await completedTaskCount(db, userId, startOfWeek(options.now), endOfWeek(options.now));
  const overdueRow = await db.first<{ overdue: number | null }>(
    `SELECT COUNT(*) AS overdue FROM tasks
      WHERE user_id = ? AND deleted_at IS NULL
        AND due_at IS NOT NULL AND due_at < ?
        AND status NOT IN ('done', 'dropped')`,
    [userId, options.now],
  );
  const overdue = Number(overdueRow?.overdue ?? 0);

  const kpis: KpiView[] = include.has("kpi")
    ? await summarizeKpis(db, userId, {
        start,
        end,
        pomodoro,
        tasksDone: tasksCompleted,
      })
    : [];

  const inRangeTasks = tasks.filter((task) => task.status !== "done");
  const q1 = tasks.filter((task) => task.quadrant === 1).length;
  const q2 = tasks.filter((task) => task.quadrant === 2).length;
  const q3 = tasks.filter((task) => task.quadrant === 3).length;
  const q4 = tasks.filter((task) => task.quadrant === 4).length;
  const q2Ratio = tasks.length > 0 ? round2(q2 / tasks.length) : 0;
  const kpiRateAvg = kpis.length > 0 ? round2(kpis.reduce((sum, kpi) => sum + kpi.rate, 0) / kpis.length) : 0;

  const stats: Record<string, number> = {
    tasksInRange: tasks.length,
    tasksCompleted,
    doneThisWeek,
    overdue,
    q1,
    q2,
    q3,
    q4,
    q2Ratio,
    focusMinutes: pomodoro.focusMinutes,
    pomodoroSessions: pomodoro.sessions,
    inboxPending: inbox.length,
    goalsActive: goals.length,
    okrActive: okr.length,
    kpisActive: kpis.length,
    kpiRateAvg,
    tasksOpen: inRangeTasks.length,
  };

  const briefing = buildBriefing({
    range: options.range,
    tasksInRange: tasks.length,
    tasksOpen: inRangeTasks.length,
    tasksCompleted,
    overdue,
    q2Ratio,
    focusMinutes: pomodoro.focusMinutes,
    sessions: pomodoro.sessions,
    goalsActive: goals.length,
    okrActive: okr.length,
    inboxPending: inbox.length,
    kpis,
  });

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

/* -------------------------------------------------------------------------- */
/*                                  briefing                                   */
/* -------------------------------------------------------------------------- */

function buildBriefing(input: {
  range: ContextRange;
  tasksInRange: number;
  tasksOpen: number;
  tasksCompleted: number;
  overdue: number;
  q2Ratio: number;
  focusMinutes: number;
  sessions: number;
  goalsActive: number;
  okrActive: number;
  inboxPending: number;
  kpis: KpiView[];
}): string {
  const sentences: string[] = [];
  const when = RANGE_PHRASE[input.range];

  if (input.tasksInRange === 0) {
    sentences.push(`${when}还没有安排任务，可以先从收件箱或目标里挑一件最重要的事开始。`);
  } else {
    const overdue = input.overdue > 0 ? `，另有 ${input.overdue} 项已逾期` : "，没有逾期项";
    sentences.push(
      `${when}共 ${input.tasksInRange} 项任务（${input.tasksOpen} 项待办），已完成 ${input.tasksCompleted} 项${overdue}。`,
    );
  }

  if (input.tasksInRange > 0) {
    const percent = Math.round(input.q2Ratio * 100);
    if (percent >= 40) {
      sentences.push(`Q2（重要不紧急）占比 ${percent}%，重心在长期价值上，节奏健康。`);
    } else {
      sentences.push(`Q2（重要不紧急）占比仅 ${percent}%，偏低，时间被紧急事务挤占了。`);
    }
  }

  const focusKpi = input.kpis.find(
    (kpi) => kpi.autoSource === "pomodoro_min" || /深度|专注/.test(kpi.name),
  );
  if (focusKpi && focusKpi.target > 0) {
    const percent = Math.round(focusKpi.rate * 100);
    sentences.push(
      `深度工作 ${round2(input.focusMinutes / 60)} 小时（目标 ${round2(focusKpi.target / 60)} 小时，完成 ${percent}%）。`,
    );
  } else {
    sentences.push(`累计专注 ${input.focusMinutes} 分钟，共 ${input.sessions} 个番茄。`);
  }

  if (input.goalsActive > 0 || input.okrActive > 0) {
    sentences.push(`目标 ${input.goalsActive} 个、OKR ${input.okrActive} 个正在推进。`);
  } else {
    sentences.push("还没有进行中的目标，建议先定一个本周只做一件事的目标。");
  }

  if (input.inboxPending > 0) {
    sentences.push(`收件箱还有 ${input.inboxPending} 条待分诊，建议先清空再开始今天的事。`);
  } else {
    sentences.push("收件箱已清空。");
  }

  // 3–5 句：任务为空时第一句已包含行动建议，最多再保留 3 句
  return sentences.slice(0, 5).join("");
}

/* -------------------------------------------------------------------------- */
/*                               Markdown 版式                                 */
/* -------------------------------------------------------------------------- */

const QUADRANT_LABEL: Record<number, string> = {
  1: "Q1 重要且紧急",
  2: "Q2 重要不紧急",
  3: "Q3 紧急不重要",
  4: "Q4 不重要不紧急",
};

function formatTaskTime(task: TaskView, now: number): string {
  const label = (ts: number): string => {
    const key = dayKey(ts);
    if (key === dayKey(now)) return "今天";
    if (key === dayKey(now + 86_400_000)) return "明天";
    if (key === dayKey(now - 86_400_000)) return "昨天";
    return key;
  };

  if (task.allDay && task.startAt !== null) return `${label(task.startAt)} · 全天`;
  if (task.startAt !== null) {
    const head = `${label(task.startAt)} ${formatTime(task.startAt)}`;
    if (task.endAt !== null && task.endAt > task.startAt) {
      const sameDay = dayKey(task.endAt) === dayKey(task.startAt);
      return `${head}–${sameDay ? formatTime(task.endAt) : `${label(task.endAt)} ${formatTime(task.endAt)}`}`;
    }
    return head;
  }
  if (task.dueAt !== null) return `截止 ${label(task.dueAt)} ${formatTime(task.dueAt)}`;
  return "未排期";
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** 生成给聊天窗口粘贴的 Markdown（版式见 06-AI-INTEGRATION.md §2.4）。 */
export function formatContextPackMarkdown(pack: ContextPack, now: number = pack.generatedAt): string {
  const tasks = pack.tasks as TaskView[];
  const goals = pack.goals as GoalView[];
  const okr = pack.okr as OkrView[];
  const kpis = pack.kpis as KpiView[];
  const inbox = pack.inbox as JsonObject[];

  const lines: string[] = [];
  const title = pack.range === "today" ? "日回顾" : pack.range === "week" ? "周报" : pack.range === "month" ? "月报" : "季度回顾";
  lines.push(`# Detter ${title} · ${dayKey(pack.period.start)} ~ ${dayKey(pack.period.end)}`);
  lines.push("");
  lines.push("## 一句话总结");
  lines.push(pack.briefing);
  lines.push("");

  const overdueByQuadrant = new Map<number, number>();
  for (const task of tasks) {
    if (task.status === "done" || task.dueAt === null || task.dueAt >= now) continue;
    overdueByQuadrant.set(task.quadrant, (overdueByQuadrant.get(task.quadrant) ?? 0) + 1);
  }

  lines.push("## 四象限分布");
  const quadrantCounts: Record<number, number> = {
    1: tasks.filter((task) => task.quadrant === 1).length,
    2: tasks.filter((task) => task.quadrant === 2).length,
    3: tasks.filter((task) => task.quadrant === 3).length,
    4: tasks.filter((task) => task.quadrant === 4).length,
  };
  const maxQuadrant = Math.max(...Object.values(quadrantCounts));
  for (const quadrant of [1, 2, 3, 4] as const) {
    const count = quadrantCounts[quadrant] ?? 0;
    const overdue = overdueByQuadrant.get(quadrant) ?? 0;
    const isFocus = quadrant === 2 && count > 0 && count >= maxQuadrant;
    const suffix = isFocus ? "  ← 本周重心" : "";
    lines.push(`- ${QUADRANT_LABEL[quadrant]}：${count} 项${overdue > 0 ? `（${overdue} 项逾期）` : ""}${suffix}`);
  }
  lines.push("");

  lines.push("## 待办清单");
  const openTasks = tasks.filter((task) => task.status !== "done");
  const doneTasks = tasks.filter((task) => task.status === "done");
  if (openTasks.length === 0 && doneTasks.length === 0) {
    lines.push("- 暂无任务");
  } else {
    for (const task of openTasks) {
      const goal = task.goalTitle ? `，@${task.goalTitle}` : "";
      const tags = task.tags.length > 0 ? ` #${task.tags.join(" #")}` : "";
      lines.push(`- [ ] ${task.title}（${formatTaskTime(task, now)}${goal}）${tags}`);
    }
    for (const task of doneTasks) {
      const doneAt = task.completedAt !== null ? ` ${dayKey(task.completedAt)}` : "";
      lines.push(`- [x] ${task.title}（已完成${doneAt}）`);
    }
  }
  lines.push("");

  if (goals.length > 0) {
    lines.push("## 目标进展");
    for (const goal of goals) {
      lines.push(`- ${goal.title}（${goal.kind === "recurring" ? "周期" : "一次性"}）：${formatPercent(goal.progress)}`);
    }
    lines.push("");
  }

  if (okr.length > 0) {
    lines.push("## OKR");
    for (const objective of okr) {
      lines.push(`- ${objective.objective}（${objective.periodStart} 起，${objective.period}）`);
      for (const kr of objective.krs) {
        lines.push(`  - ${kr.title}：${kr.current} / ${kr.target} ${kr.unit}（${formatPercent(kr.progress)}）`);
      }
    }
    lines.push("");
  }

  if (kpis.length > 0) {
    lines.push("## KPI");
    for (const kpi of kpis) {
      lines.push(`- ${kpi.name}：${kpi.value} / ${kpi.target} ${kpi.unit}（${formatPercent(kpi.rate)}）`);
    }
    lines.push("");
  }

  if (inbox.length > 0) {
    lines.push("## 收件箱（待分诊）");
    for (const item of inbox) {
      lines.push(`- ${asString(item.rawText)}`);
    }
    lines.push("");
  }

  lines.push("## 你可以这样帮我");
  const suggestions: string[] = [];
  if (inbox.length > 0) suggestions.push(`把收件箱里的 ${inbox.length} 条按四象限整理，每条给一句理由`);
  if ((pack.stats.overdue ?? 0) > 0) suggestions.push(`给 ${pack.stats.overdue} 项逾期任务排一个补救顺序`);
  suggestions.push("指出今天最该做的三件事，并说明为什么");
  suggestions.push("把最大的那件事拆成 3 个 45 分钟就能开始的小任务");
  suggestions.forEach((text, index) => lines.push(`${index + 1}. ${text}`));
  lines.push("");

  return lines.join("\n");
}

/* -------------------------------------------------------------------------- */
/*                                  快速捕获                                   */
/* -------------------------------------------------------------------------- */

export interface CaptureSuggestion {
  goalId: string;
  goalTitle: string;
  score: number;
}

export interface CaptureResult {
  inboxId: string;
  draft: ParsedDraft;
  suggestions: CaptureSuggestion[];
}

function bigrams(text: string): Set<string> {
  const normalized = text.replace(/\s+/g, "").toLowerCase();
  const result = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    result.add(normalized.slice(index, index + 2));
  }
  if (normalized.length === 1) result.add(normalized);
  return result;
}

/** 极简相似度：中文按二元组算 Jaccard，够给「可能关联的目标」排序即可。 */
function similarity(a: string, b: string): number {
  const left = bigrams(a);
  const right = bigrams(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.max(left.size, right.size);
}

function suggestGoals(draft: ParsedDraft, goals: Array<{ id: string; title: string }>): CaptureSuggestion[] {
  if (goals.length === 0) return [];
  if (draft.goalId) {
    const hit = goals.find((goal) => goal.id === draft.goalId);
    if (hit) return [{ goalId: hit.id, goalTitle: hit.title, score: 1 }];
  }
  const title = draft.goalTitle ? `${draft.title} ${draft.goalTitle}` : draft.title;
  return goals
    .map((goal) => ({ goalId: goal.id, goalTitle: goal.title, score: round2(similarity(title, goal.title)) }))
    .filter((item) => item.score >= 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

/**
 * 文本 → 解析 → 落收件箱。
 *
 * 与前端离线解析共用 packages/shared/nlp.ts 的同一套解析器：
 * AI 通过 MCP 捕获时看到的建议，和用户手输时完全一致。
 */
export async function captureToInbox(
  db: Db,
  userId: string,
  input: { text: string; source: CaptureSource; now: number },
): Promise<CaptureResult> {
  const text = input.text.trim();
  if (text.length === 0) throw ApiError.validation("text 不能为空");

  const goalRows = await db.all<PayloadRow>(
    "SELECT payload FROM goals WHERE user_id = ? AND deleted_at IS NULL AND status = 'active' LIMIT 200",
    [userId],
  );
  const goals = goalRows
    .map(parsePayload)
    .map((goal) => ({ id: asString(goal.id), title: asString(goal.title) }))
    .filter((goal) => goal.id.length > 0 && goal.title.length > 0);

  const draft = parseQuickCapture(text, { now: input.now, goals });
  const item = await createEntity(db, "inbox", userId, {
    input: {
      rawText: text,
      source: input.source,
      status: "pending",
      parsed: draft,
      capturedAt: input.now,
    },
    deviceId: "",
    now: input.now,
  });

  return {
    inboxId: String(item.id),
    draft,
    suggestions: suggestGoals(draft, goals),
  };
}

/** 解析 "YYYY-MM-DD" 或毫秒时间戳为某天的 00:00（本地时区）。 */
export function resolveDayStart(raw: unknown, fallback: number): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return startOfDay(Math.trunc(raw));
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return dayKeyToTs(raw);
  return startOfDay(fallback);
}

/** 与 resolveDayStart 配对：同一天的 23:59:59.999。 */
export function resolveDayEnd(dayStart: number): number {
  return endOfDay(dayStart);
}
