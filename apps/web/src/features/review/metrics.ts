import {
  DAY,
  addDays,
  dayKey,
  dayKeyToTs,
  periodRange,
  type Goal,
  type KeyResult,
  type Kpi,
  type KpiAggregation,
  type KpiAutoSource,
  type KpiEntry,
  type KpiPeriod,
  type Okr,
  type OkrPeriod,
  type PomodoroSession,
  type Quadrant,
  type Task,
} from "@detter/shared";
import { formatKrNumber, krRatio, objectiveProgress, toPercent } from "@/features/okr/progress";

/**
 * 复盘口径：全站唯一来源。
 *
 * 这里全部是纯函数 —— 输入是 Dexie 里读出来的原始数组，输出是页面直接渲染的数字。
 * 页面（features/review）与 OKR 页共用本文件的聚合函数，复盘页不 import 任何 KPI /
 * 四象限页面组件，也不调用外部服务；T07 尚未落地时也能自洽。
 *
 * 所有公式（报告里逐条列出）：
 *   完成数   = status === "done" 且 completedAt ∈ [start, end]
 *   新增数   = kind === "task" 且 createdAt ∈ [start, end]
 *   逾期数   = status ∉ {done, dropped} 且 dueAt ∈ [start, min(now, end)]
 *   完成率   = 完成数 / 新增数（无新增时为 null，不显示 0%）
 *   四象限   = 「周期内新增 ∪ 周期内完成」去重后按 quadrant 计数
 *   Q2 占比  = Q2 / 经手任务数（0 项时为 0）
 *   专注分钟 = 周期内所有 focus 记录（含未完成）的 actualMin 之和
 *   番茄数   = 已完成的 focus 记录条数（与专注页「专注 N 个」一致）
 *   KPI 值   = 先按本地日聚合成日序列（手工=当天多次打卡求和；自动=番茄/任务），
 *             再按 aggregation 合成周期值：sum 求和、count 有数据的天数、max 峰值、
 *             avg 有数据天的均值、last 最近一个有数据的天（与 features/kpi 同口径）
 *   KPI 目标 = targetValue × 窗口折算系数（日目标 ×7；周/月目标在更短窗口里不缩小）
 *   KPI 达成 = direction=up 时 value/target；down 时 (2×target−value)/target（与 KPI 页同口径）
 *   目标进度 = 该目标全部存活任务的 done / total；没有任务时退回里程碑 done / total
 *   OKR 进度 = objectiveProgress()，即其下 KR 进度均值（与 OKR 页同一函数）
 */

export type ReviewRangeType = "week" | "month";

export interface ReviewRange {
  type: ReviewRangeType;
  /** 0 = 本期，-1 = 上一期 */
  offset: number;
  start: number;
  end: number;
  /** 快照键：week:2026-11-24 / month:2026-11 */
  periodKey: string;
  /** 11/24 - 11/30 / 2026年11月 */
  label: string;
  /** 2026-11-24 → 2026-11-30 */
  caption: string;
  startKey: string;
  endKey: string;
}

export const REVIEW_RANGE_OPTIONS: ReadonlyArray<{
  type: ReviewRangeType;
  offset: number;
  label: string;
}> = [
  { type: "week", offset: 0, label: "本周" },
  { type: "week", offset: -1, label: "上周" },
  { type: "month", offset: 0, label: "本月" },
  { type: "month", offset: -1, label: "上月" },
];

function monthDay(ts: number): string {
  const date = new Date(ts);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function daysBetween(start: number, end: number): number {
  return Math.round((end - start + 1) / DAY);
}

/** 周期范围。月偏移从当月 1 号算起，避免 31 号减一个月落到本月（JS setMonth 溢出）。 */
export function reviewRange(
  type: ReviewRangeType,
  offset = 0,
  now: number = Date.now(),
): ReviewRange {
  let anchor = now;
  if (type === "week") {
    anchor = addDays(now, offset * 7);
  } else {
    const date = new Date(now);
    anchor = new Date(date.getFullYear(), date.getMonth() + offset, 1).getTime();
  }
  const range = periodRange(type, anchor);
  const startKey = dayKey(range.start);
  const endKey = dayKey(range.end);
  return {
    type,
    offset,
    start: range.start,
    end: range.end,
    periodKey: type === "week" ? `week:${startKey}` : `month:${startKey.slice(0, 7)}`,
    label: type === "week" ? `${monthDay(range.start)} - ${monthDay(range.end)}` : range.label,
    caption: `${startKey} → ${endKey} · 共 ${daysBetween(range.start, range.end)} 天`,
    startKey,
    endKey,
  };
}

/** /review?range=month&offset=-1 的解析。非法值一律退回「本周」。 */
export function parseReviewQuery(search: string): { type: ReviewRangeType; offset: number } {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const raw = params.get("range");
  const offsetRaw = Number(params.get("offset") ?? "0");
  if (raw === "month" || raw === "last-month") {
    return { type: "month", offset: raw === "last-month" ? -1 : offsetRaw === -1 ? -1 : 0 };
  }
  if (raw === "week" || raw === "last-week") {
    return { type: "week", offset: raw === "last-week" ? -1 : offsetRaw === -1 ? -1 : 0 };
  }
  return { type: "week", offset: offsetRaw === -1 ? -1 : 0 };
}

export function rangeKeyOf(type: ReviewRangeType, offset: number): string {
  return `${type}:${offset}`;
}

function emptyQuadrants(): Record<Quadrant, number> {
  return { 1: 0, 2: 0, 3: 0, 4: 0 };
}

function bump(counts: Record<Quadrant, number>, quadrant: Quadrant): void {
  counts[quadrant] = (counts[quadrant] ?? 0) + 1;
}

export interface ReviewTodoItem {
  id: string;
  title: string;
  quadrant: Quadrant;
  dueAt: number | null;
  goalId: string | null;
}

export interface ReviewTaskMetrics {
  done: number;
  created: number;
  overdue: number;
  /** 当前仍未完成的任务总数（不是周期内新增，用于「待办清单」） */
  open: number;
  /** 完成 / 新增；新增为 0 时 null */
  completionRate: number | null;
  /** 经手任务（新增 ∪ 完成，按 id 去重）的象限分布 */
  quadrants: Record<Quadrant, number>;
  touched: number;
  /** Q2 占经手任务的比例，0–100 整数 */
  q2Share: number;
  overdueByQuadrant: Record<Quadrant, number>;
  createdByQuadrant: Record<Quadrant, number>;
  todo: ReviewTodoItem[];
  /** 待办清单之外还剩多少条 */
  todoMore: number;
}

export const TODO_PREVIEW_LIMIT = 20;

export interface ReviewFocusMetrics {
  /** 已完成的专注番茄数（与专注页「专注 N 个」一致） */
  sessions: number;
  /** 周期内所有 focus 记录的实际分钟之和（含被中断的，与专注页「专注分钟」一致） */
  minutes: number;
  /** 有已完成番茄的天数 */
  days: number;
  /** 周期内最长连续专注天数 */
  streakDays: number;
}

export interface ReviewKpiRow {
  id: string;
  name: string;
  unit: string;
  color: string;
  direction: "up" | "down";
  period: KpiPeriod;
  autoSource: KpiAutoSource | null;
  value: number;
  /** 按窗口折算后的目标 */
  target: number;
  /** 原始目标（KPI 自己声明的周期目标） */
  baseTarget: number;
  /** 目标折算系数：日目标在周复盘里是 7 */
  scale: number;
  ratio: number | null;
  percent: number | null;
  achieved: boolean;
  /** 周期内的原始记录条数（手工=打卡条数） */
  entryCount: number;
}

export interface ReviewGoalRow {
  id: string;
  title: string;
  color: string;
  /** 0..100 */
  progress: number;
  taskTotal: number;
  taskDone: number;
  milestoneTotal: number;
  milestoneDone: number;
  /** 与上一次快照相比的百分点；没有基线时为 null */
  delta: number | null;
}

export interface ReviewOkrRow {
  id: string;
  title: string;
  color: string;
  period: OkrPeriod;
  periodStart: string;
  periodEnd: string;
  /** 0..100；没有 KR 时 null */
  progress: number | null;
  krCount: number;
  krAchieved: number;
  taskTotal: number;
  taskDone: number;
  krs: Array<{ id: string; title: string; percent: number; valueLabel: string }>;
}

export interface ReviewMetrics {
  range: ReviewRange;
  /** 计算时点：本期取 now，过去周期取周期终点 */
  evaluatedAt: number;
  tasks: ReviewTaskMetrics;
  focus: ReviewFocusMetrics;
  goals: ReviewGoalRow[];
  okrs: ReviewOkrRow[];
  kpis: ReviewKpiRow[];
  kpiAchieved: number;
}

export interface ReviewInputs {
  tasks: readonly Task[];
  goals: readonly Goal[];
  okrs: readonly Okr[];
  krs: readonly KeyResult[];
  kpis: readonly Kpi[];
  kpiEntries: readonly KpiEntry[];
  sessions: readonly PomodoroSession[];
  range: ReviewRange;
  now?: number;
  /** 上一次快照里的目标进度（百分比），用于算 delta */
  baselineGoals?: Readonly<Record<string, number>>;
}

/* -------------------------------------------------------------------------- */
/*                              任务关联（OKR / 目标）                          */
/* -------------------------------------------------------------------------- */

export interface TaskTally {
  total: number;
  done: number;
}

export function tallyTasks(tasks: readonly Task[]): TaskTally {
  let done = 0;
  for (const task of tasks) {
    if (task.status === "done") done += 1;
  }
  return { total: tasks.length, done };
}

/** 挂在该 Objective 下的任务：task.okrId 命中，或 krId 落在它的 KR 里（去重）。 */
export function tasksOfOkrId(
  tasks: readonly Task[],
  okrId: string,
  krIds: readonly string[] = [],
): Task[] {
  const krSet = new Set(krIds);
  return tasks.filter(
    (task) => !task.deletedAt && (task.okrId === okrId || (task.krId !== null && krSet.has(task.krId))),
  );
}

/** 挂在该 KR 下的任务：task.krId 命中，或 kr.linkedTaskIds 显式列出。 */
export function tasksOfKrId(
  tasks: readonly Task[],
  krId: string,
  linkedTaskIds: readonly string[] = [],
): Task[] {
  const explicit = new Set(linkedTaskIds);
  return tasks.filter((task) => !task.deletedAt && (task.krId === krId || explicit.has(task.id)));
}

/* -------------------------------------------------------------------------- */
/*                                   KPI                                      */
/* -------------------------------------------------------------------------- */

/**
 * KPI 目标折算：日目标在 7 天复盘里 ×7，周目标在月复盘里 ×4；
 * 反过来（月目标放进周复盘）不缩小 —— 与任务书示例「读书 120/200」一致。
 * 折算系数会显示在 KPI 卡片上，避免和 KPI 页「按日查看」的数字对不上时说不清。
 */
export function kpiWindowScale(period: KpiPeriod, range: ReviewRange): number {
  const windowDays = Math.max(1, daysBetween(range.start, range.end));
  const unitDays = period === "day" ? 1 : period === "week" ? 7 : 30;
  return Math.max(1, Math.round(windowDays / unitDays));
}

/** 周期内的日期键序列（按本地日展开，跨月跨年都成立）。 */
export function dayKeysOfRange(range: ReviewRange): string[] {
  const keys: string[] = [];
  let cursor = range.start;
  while (cursor <= range.end && keys.length < 40) {
    keys.push(dayKey(cursor));
    cursor = addDays(cursor, 1);
  }
  return keys;
}

export interface KpiDailySeries {
  /** 每天的值（没有记录的天是 0） */
  values: Map<string, number>;
  /** 有记录的天（手工=有打卡；自动=当天有记录） */
  dataDays: Set<string>;
}

function emptyDailySeries(keys: readonly string[]): KpiDailySeries {
  const values = new Map<string, number>();
  for (const key of keys) values.set(key, 0);
  return { values, dataDays: new Set<string>() };
}

/**
 * 手工 KPI 的日序列：一天可以打多次卡，日值求和。
 * 与 features/kpi/kpiModel.ts 的 manualDailySeries 同口径。
 */
export function manualDailySeries(
  kpiId: string,
  entries: readonly KpiEntry[],
  keys: readonly string[],
): KpiDailySeries {
  const series = emptyDailySeries(keys);
  for (const entry of entries) {
    if (entry.deletedAt || entry.kpiId !== kpiId) continue;
    if (!series.values.has(entry.date)) continue;
    series.values.set(entry.date, (series.values.get(entry.date) ?? 0) + entry.value);
    series.dataDays.add(entry.date);
  }
  return series;
}

/**
 * 自动 KPI 的日序列（与 features/kpi/kpiModel.ts 同口径）：
 * - pomodoro_min / focus_sessions 按 startedAt 归属，数所有 focus 记录（含未完成）；
 * - tasks_done 按 completedAt 归属，数所有完成任务。
 */
export function autoDailySeries(
  source: KpiAutoSource,
  sessions: readonly PomodoroSession[],
  tasks: readonly Task[],
  keys: readonly string[],
): KpiDailySeries {
  const series = emptyDailySeries(keys);
  if (source === "pomodoro_min" || source === "focus_sessions") {
    for (const session of sessions) {
      if (session.deletedAt || session.kind !== "focus") continue;
      if (!series.values.has(dayKey(session.startedAt))) continue;
      const key = dayKey(session.startedAt);
      const delta = source === "pomodoro_min" ? Math.max(0, session.actualMin) : 1;
      series.values.set(key, (series.values.get(key) ?? 0) + delta);
      series.dataDays.add(key);
    }
    return series;
  }
  for (const task of tasks) {
    if (task.deletedAt || task.completedAt === null) continue;
    const key = dayKey(task.completedAt);
    if (!series.values.has(key)) continue;
    series.values.set(key, (series.values.get(key) ?? 0) + 1);
    series.dataDays.add(key);
  }
  return series;
}

/**
 * 日序列 → 周期值。
 * count 是「有记录的天数」，max/avg/last 也按天取值 —— 与 KPI 页的
 * aggregation 语义一致（不是按打卡条数）。没有数据时一律 0。
 */
export function aggregateDailySeries(
  mode: KpiAggregation,
  series: KpiDailySeries,
  keys: readonly string[],
): number {
  const dataValues = keys
    .filter((key) => series.dataDays.has(key))
    .map((key) => series.values.get(key) ?? 0);
  if (dataValues.length === 0) return 0;
  switch (mode) {
    case "sum":
      return keys.reduce((sum, key) => sum + (series.values.get(key) ?? 0), 0);
    case "count":
      return dataValues.length;
    case "max":
      return Math.max(...dataValues);
    case "avg":
      return dataValues.reduce((sum, value) => sum + value, 0) / dataValues.length;
    case "last":
      return dataValues[dataValues.length - 1] ?? 0;
  }
}

/**
 * 达成率（与 features/kpi/kpiModel.ts 的 kpiProgress 同口径）：
 * - up   ：value / target；
 * - down ：(2 × target - value) / target，达标 100%，到 2 倍目标时 0%；
 * - target ≤ 0 时只区分「有没有推进 / 是不是 0」；
 * 结果夹在 0..1。
 */
export function kpiAchievementRatio(
  value: number | null,
  target: number,
  direction: "up" | "down",
): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (target <= 0) {
    if (direction === "up") return value > 0 ? 1 : 0;
    return value <= 0 ? 1 : 0;
  }
  const raw = direction === "up" ? value / target : (2 * target - value) / target;
  return Math.min(1, Math.max(0, raw));
}

/* -------------------------------------------------------------------------- */
/*                                  指标组装                                   */
/* -------------------------------------------------------------------------- */

export function computeReviewMetrics(input: ReviewInputs): ReviewMetrics {
  const now = input.now ?? Date.now();
  const { range } = input;
  const evaluatedAt = Math.min(now, range.end);

  /* ---- 任务 ---- */
  const taskRows = input.tasks.filter((task) => !task.deletedAt && task.kind === "task");
  const createdTasks = taskRows.filter(
    (task) => task.createdAt >= range.start && task.createdAt <= range.end,
  );
  const doneTasks = taskRows.filter(
    (task) =>
      task.status === "done" &&
      task.completedAt !== null &&
      task.completedAt >= range.start &&
      task.completedAt <= range.end,
  );
  const overdueTasks = taskRows.filter(
    (task) =>
      task.status !== "done" &&
      task.status !== "dropped" &&
      task.dueAt !== null &&
      task.dueAt >= range.start &&
      task.dueAt <= evaluatedAt &&
      task.createdAt <= evaluatedAt,
  );

  const touched = new Map<string, Task>();
  for (const task of createdTasks) touched.set(task.id, task);
  for (const task of doneTasks) touched.set(task.id, task);

  const quadrants = emptyQuadrants();
  for (const task of touched.values()) bump(quadrants, task.quadrant);

  const createdByQuadrant = emptyQuadrants();
  for (const task of createdTasks) bump(createdByQuadrant, task.quadrant);

  const overdueByQuadrant = emptyQuadrants();
  for (const task of overdueTasks) bump(overdueByQuadrant, task.quadrant);

  const openTasks = taskRows.filter((task) => task.status !== "done" && task.status !== "dropped");
  const sortedOpen = [...openTasks].sort(
    (a, b) =>
      a.quadrant - b.quadrant ||
      (a.dueAt ?? Number.POSITIVE_INFINITY) - (b.dueAt ?? Number.POSITIVE_INFINITY) ||
      a.createdAt - b.createdAt,
  );

  const tasks: ReviewTaskMetrics = {
    done: doneTasks.length,
    created: createdTasks.length,
    overdue: overdueTasks.length,
    open: openTasks.length,
    completionRate: createdTasks.length === 0 ? null : doneTasks.length / createdTasks.length,
    quadrants,
    touched: touched.size,
    q2Share: touched.size === 0 ? 0 : Math.round(((quadrants[2] ?? 0) / touched.size) * 100),
    overdueByQuadrant,
    createdByQuadrant,
    todo: sortedOpen.slice(0, TODO_PREVIEW_LIMIT).map((task) => ({
      id: task.id,
      title: task.title,
      quadrant: task.quadrant,
      dueAt: task.dueAt,
      goalId: task.goalId,
    })),
    todoMore: Math.max(0, sortedOpen.length - TODO_PREVIEW_LIMIT),
  };

  /* ---- 专注 ---- */
  const focusRows = input.sessions.filter(
    (session) =>
      !session.deletedAt &&
      session.kind === "focus" &&
      session.startedAt >= range.start &&
      session.startedAt <= range.end,
  );
  // 分钟数所有 focus 记录（中断的那部分也是真坐住了）；番茄只数已完成的 —— 与专注页一致。
  const focusMinutes = focusRows.reduce((sum, session) => sum + Math.max(0, session.actualMin), 0);
  const completedFocus = focusRows.filter((session) => session.completed);
  const focusDays = new Set(completedFocus.map((session) => dayKey(session.startedAt)));
  const focus: ReviewFocusMetrics = {
    sessions: completedFocus.length,
    minutes: focusMinutes,
    days: focusDays.size,
    streakDays: longestFocusStreak(focusDays, range),
  };

  /* ---- KPI ---- */
  const kpiKeys = dayKeysOfRange(range);
  const activeKpis = input.kpis
    .filter((kpi) => !kpi.deletedAt && kpi.active)
    .sort((a, b) => a.sortIndex - b.sortIndex || a.createdAt - b.createdAt || a.id.localeCompare(b.id));

  let kpiAchieved = 0;
  const kpiRows: ReviewKpiRow[] = activeKpis.map((kpi) => {
    const entryRows = input.kpiEntries.filter(
      (entry) =>
        !entry.deletedAt &&
        entry.kpiId === kpi.id &&
        entry.date >= range.startKey &&
        entry.date <= range.endKey,
    );
    const series = kpi.autoSource
      ? autoDailySeries(kpi.autoSource, input.sessions, input.tasks, kpiKeys)
      : manualDailySeries(kpi.id, input.kpiEntries, kpiKeys);
    const value = aggregateDailySeries(kpi.aggregation, series, kpiKeys);
    const scale = kpiWindowScale(kpi.period, range);
    const target = Math.round(kpi.targetValue * scale * 100) / 100;
    const ratio = kpiAchievementRatio(value, target, kpi.direction);
    const achieved = ratio !== null && ratio >= 1;
    if (achieved) kpiAchieved += 1;
    return {
      id: kpi.id,
      name: kpi.name,
      unit: kpi.unit,
      color: kpi.color,
      direction: kpi.direction,
      period: kpi.period,
      autoSource: kpi.autoSource,
      value,
      target,
      baseTarget: kpi.targetValue,
      scale,
      ratio,
      percent: ratio === null ? null : Math.round(ratio * 100),
      achieved,
      entryCount: kpi.autoSource ? series.dataDays.size : entryRows.length,
    };
  });

  /* ---- 目标 ---- */
  const aliveGoals = input.goals.filter(
    (goal) => !goal.deletedAt && goal.kind !== "template" && goal.status !== "archived",
  );
  const goals: ReviewGoalRow[] = aliveGoals
    .map((goal) => {
      const goalTasks = taskRows.filter((task) => task.goalId === goal.id);
      const taskTally = tallyTasks(goalTasks);
      const milestoneTotal = goal.milestones.length;
      const milestoneDone = goal.milestones.filter((milestone) => milestone.done).length;
      let progress = 0;
      if (taskTally.total > 0) {
        progress = Math.round((taskTally.done / taskTally.total) * 100);
      } else if (milestoneTotal > 0) {
        progress = Math.round((milestoneDone / milestoneTotal) * 100);
      }
      const baseline = input.baselineGoals?.[goal.id];
      return {
        id: goal.id,
        title: goal.title,
        color: goal.color,
        progress,
        taskTotal: taskTally.total,
        taskDone: taskTally.done,
        milestoneTotal,
        milestoneDone,
        delta: baseline === undefined ? null : progress - baseline,
      };
    })
    .filter((goal) => goal.taskTotal > 0 || goal.milestoneTotal > 0)
    .sort((a, b) => b.progress - a.progress || a.title.localeCompare(b.title));

  /* ---- OKR ---- */
  const okrs: ReviewOkrRow[] = input.okrs
    .filter((okr) => !okr.deletedAt)
    .filter((okr) => {
      const start = dayKeyToTs(okr.periodStart);
      const end = dayKeyToTs(okr.periodEnd, DAY - 1);
      return start <= range.end && end >= range.start;
    })
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart) || a.sortIndex - b.sortIndex)
    .map((okr) => {
      const okrKrs = input.krs.filter((kr) => !kr.deletedAt && kr.okrId === okr.id);
      const progress = objectiveProgress(okrKrs, input.goals);
      const okrTasks = tasksOfOkrId(
        input.tasks,
        okr.id,
        okrKrs.map((kr) => kr.id),
      );
      const tally = tallyTasks(okrTasks);
      return {
        id: okr.id,
        title: okr.title,
        color: okr.color,
        period: okr.period,
        periodStart: okr.periodStart,
        periodEnd: okr.periodEnd,
        progress: progress === null ? null : progress.percent,
        krCount: okrKrs.length,
        krAchieved: okrKrs.filter((kr) => toPercent(krRatio(kr, input.goals)) >= 100).length,
        taskTotal: tally.total,
        taskDone: tally.done,
        krs: okrKrs
          .sort((a, b) => a.sortIndex - b.sortIndex || a.createdAt - b.createdAt)
          .map((kr) => ({
            id: kr.id,
            title: kr.title,
            percent: toPercent(krRatio(kr, input.goals)),
            valueLabel: formatKrNumber(kr.currentValue),
          })),
      };
    });

  return { range, evaluatedAt, tasks, focus, goals, okrs, kpis: kpiRows, kpiAchieved };
}

/** 周期内最长连续专注天数。daySet 里的日期必须落在 range 内。 */
export function longestFocusStreak(
  daySet: ReadonlySet<string>,
  range: ReviewRange,
): number {
  let longest = 0;
  let current = 0;
  for (let ts = range.start; ts <= range.end; ts = addDays(ts, 1)) {
    if (daySet.has(dayKey(ts))) {
      current += 1;
      if (current > longest) longest = current;
    } else {
      current = 0;
    }
  }
  return longest;
}

/** 周几的短标签，KPI/分布条与 Markdown 共用。 */
export function quadrantLabel(quadrant: Quadrant): string {
  return `Q${quadrant}`;
}

export function quadrantShare(count: number, total: number): number {
  return total <= 0 ? 0 : Math.round((count / total) * 100);
}

export function formatPercent(value: number | null, fallback = "—"): string {
  return value === null ? fallback : `${Math.round(value)}%`;
}
