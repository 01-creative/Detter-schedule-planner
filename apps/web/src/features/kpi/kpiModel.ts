import { addDays, dayKey, periodRange, startOfDay } from "@detter/shared";
import type {
  Kpi,
  KpiAggregation,
  KpiAutoSource,
  KpiEntry,
  KpiPeriod,
  PeriodRange,
  PomodoroSession,
  Task,
} from "@detter/shared";

/**
 * KPI 的聚合与达标率（纯函数）。
 *
 * 口径（写死在这里，页面只负责展示）：
 * - **日值是基本单位**：手工 KPI 的一天 = 当天所有手动打卡之和；自动 KPI 的一天由 autoSource 决定
 *   （番茄分钟数 / 专注次数 / 完成任务数）。
 * - **周期值 = 把日值按 aggregation 合起来**：
 *   sum 求和、count 有数据的天数（打卡天数）、max 峰值、avg 有数据天的均值、last 最近一次的值。
 * - **按 startedAt 归属**：23:50 开始、00:15 结束的番茄算前一天，和「今天」的口径一致。
 * - 跨月/跨年不是特例：日序列由 periodRange 展开，2 月 1 日所在的那一周会同时包含 1 月的几天。
 */

export type KpiTone = "success" | "warning" | "accent";

export interface KpiContext {
  entries: readonly KpiEntry[];
  sessions: readonly PomodoroSession[];
  tasks: readonly Task[];
}

export interface KpiSeriesPoint {
  date: string;
  value: number;
  /** 这一天有没有数据（自动来源：值非 0；手工：有打卡） */
  hasData: boolean;
}

export interface KpiSnapshot {
  kpi: Kpi;
  /** 实际使用的周期（页面可以临时按「周」看一个本该是「月」的指标） */
  period: KpiPeriod;
  range: PeriodRange;
  /** 周期内天数，用于日目标线与进度对照 */
  days: number;
  value: number;
  target: number;
  /** 原始比值（可能 > 1，用于显示 620 / 900） */
  ratio: number;
  /** 0–1 的达标率（down 方向按 (2*target-value)/target 折算） */
  progress: number;
  tone: KpiTone;
  points: KpiSeriesPoint[];
  /** 图表里的虚线日目标 */
  chartTarget: number;
  /** 周期已经过去的比例 0–1 */
  elapsedRatio: number;
  /** 一句人话：本周已过 60%，你完成了 69%，领先 */
  pace: string;
  auto: boolean;
  /** 本周期内的原始记录条数（手工=打卡条数；自动=底层记录条数） */
  entryCount: number;
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export const PERIOD_LABEL: Record<KpiPeriod, string> = {
  day: "日",
  week: "周",
  month: "月",
};

export const PERIOD_WORD: Record<KpiPeriod, string> = {
  day: "今天",
  week: "本周",
  month: "本月",
};

export const AGGREGATION_LABEL: Record<KpiAggregation, string> = {
  sum: "求和",
  count: "打卡天数",
  max: "峰值",
  avg: "均值",
  last: "最近一次",
};

export const AUTO_SOURCE_LABEL: Record<KpiAutoSource, string> = {
  pomodoro_min: "番茄钟分钟",
  focus_sessions: "专注次数",
  tasks_done: "完成任务数",
};

export function autoSourceLabel(source: KpiAutoSource | null): string {
  return source ? AUTO_SOURCE_LABEL[source] : "手工打卡";
}

/** 展开周期内的每一天（最多 400 天，防御脏周期）。 */
export function dayKeysOf(range: PeriodRange): string[] {
  const keys: string[] = [];
  let cursor = startOfDay(range.start);
  while (cursor <= range.end && keys.length < 400) {
    keys.push(dayKey(cursor));
    cursor = addDays(cursor, 1);
  }
  return keys;
}

export interface DailySeries {
  values: Map<string, number>;
  /** 有数据的天（手工=有打卡；自动=值非 0） */
  dataDays: Set<string>;
}

export function emptySeries(keys: readonly string[]): DailySeries {
  const values = new Map<string, number>();
  for (const key of keys) values.set(key, 0);
  return { values, dataDays: new Set<string>() };
}

/** 手工 KPI：一天可以打多次卡，日值求和。 */
export function manualDailySeries(
  kpiId: string,
  entries: readonly KpiEntry[],
  keys: readonly string[],
): DailySeries {
  const series = emptySeries(keys);
  for (const entry of entries) {
    if (entry.deletedAt || entry.kpiId !== kpiId) continue;
    if (!series.values.has(entry.date)) continue;
    series.values.set(entry.date, (series.values.get(entry.date) ?? 0) + entry.value);
    series.dataDays.add(entry.date);
  }
  return series;
}

/** 自动 KPI：日值由番茄钟 / 任务完成情况直接算出来。 */
export function autoDailySeries(
  source: KpiAutoSource,
  sessions: readonly PomodoroSession[],
  tasks: readonly Task[],
  keys: readonly string[],
): DailySeries {
  const series = emptySeries(keys);

  if (source === "pomodoro_min" || source === "focus_sessions") {
    for (const session of sessions) {
      if (session.deletedAt || session.kind !== "focus") continue;
      const key = dayKey(session.startedAt);
      if (!series.values.has(key)) continue;
      if (source === "pomodoro_min") {
        series.values.set(key, (series.values.get(key) ?? 0) + Math.max(0, session.actualMin));
      } else {
        series.values.set(key, (series.values.get(key) ?? 0) + 1);
      }
      series.dataDays.add(key);
    }
    return series;
  }

  for (const task of tasks) {
    if (task.deletedAt) continue;
    if (task.completedAt === null) continue;
    const key = dayKey(task.completedAt);
    if (!series.values.has(key)) continue;
    series.values.set(key, (series.values.get(key) ?? 0) + 1);
    series.dataDays.add(key);
  }
  return series;
}

/** 把日序列按 aggregation 合成为周期值。平均值只除以「有数据的天」。 */
export function aggregateSeries(
  mode: KpiAggregation,
  series: DailySeries,
  keys: readonly string[],
): number {
  const all = keys.map((key) => series.values.get(key) ?? 0);
  const dataValues = keys
    .filter((key) => series.dataDays.has(key))
    .map((key) => series.values.get(key) ?? 0);
  if (dataValues.length === 0) return 0;

  switch (mode) {
    case "sum":
      return all.reduce((sum, value) => sum + value, 0);
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

/** 达标率：up 方向 value/target；down 方向 (2*target-value)/target。 */
export function kpiProgress(direction: Kpi["direction"], target: number, value: number): number {
  if (target <= 0) {
    if (direction === "up") return value > 0 ? 1 : 0;
    return value <= 0 ? 1 : 0;
  }
  const raw = direction === "up" ? value / target : (2 * target - value) / target;
  return clamp01(raw);
}

export function kpiTone(progress: number): KpiTone {
  if (progress >= 1) return "success";
  if (progress < 0.6) return "warning";
  return "accent";
}

/** 周期过了多少（用于「本周已过 60%」）。 */
export function elapsedRatioOf(range: PeriodRange, now: number): number {
  const span = range.end + 1 - range.start;
  if (span <= 0) return 1;
  return clamp01((Math.min(now, range.end + 1) - range.start) / span);
}

export function paceSentence(
  period: KpiPeriod,
  direction: Kpi["direction"],
  progress: number,
  elapsedRatio: number,
): string {
  const word = PERIOD_WORD[period];
  const elapsedPct = Math.round(elapsedRatio * 100);
  const donePct = Math.round(progress * 100);
  const doneWord = direction === "up" ? `你完成了 ${donePct}%` : `当前 ${donePct}%`;
  const lead =
    progress >= 1
      ? "已达标"
      : progress - elapsedRatio > 0.05
        ? "领先"
        : progress - elapsedRatio < -0.05
          ? "落后"
          : "持平";
  return `${word}已过 ${elapsedPct}%，${doneWord}，${lead}`;
}

/** 图表虚线：日目标。sum/count 把周期目标摊到每天，max/avg/last 用周期目标本身。 */
export function chartTargetOf(kpi: Kpi, days: number): number {
  if (kpi.targetValue <= 0) return 0;
  if (kpi.aggregation === "sum" || kpi.aggregation === "count") {
    return kpi.targetValue / Math.max(1, days);
  }
  return kpi.targetValue;
}

export function buildSnapshot(
  kpi: Kpi,
  context: KpiContext,
  now: number,
  overridePeriod?: KpiPeriod,
): KpiSnapshot {
  const period = overridePeriod ?? kpi.period;
  const range = periodRange(period, now);
  const keys = dayKeysOf(range);
  const auto = kpi.autoSource !== null;

  const series = auto
    ? autoDailySeries(kpi.autoSource as KpiAutoSource, context.sessions, context.tasks, keys)
    : manualDailySeries(kpi.id, context.entries, keys);

  const value = aggregateSeries(kpi.aggregation, series, keys);
  const progress = kpiProgress(kpi.direction, kpi.targetValue, value);
  const elapsedRatio = elapsedRatioOf(range, now);
  const target = kpi.targetValue;
  const ratio = target > 0 ? value / target : value > 0 ? 1 : 0;

  let entryCount: number;
  if (kpi.autoSource === "pomodoro_min" || kpi.autoSource === "focus_sessions") {
    entryCount = context.sessions.filter((session) => {
      if (session.deletedAt || session.kind !== "focus") return false;
      return keys.includes(dayKey(session.startedAt));
    }).length;
  } else if (kpi.autoSource === "tasks_done") {
    entryCount = context.tasks.filter((task) => {
      if (task.deletedAt || task.completedAt === null) return false;
      return keys.includes(dayKey(task.completedAt));
    }).length;
  } else {
    entryCount = context.entries.filter(
      (entry) => !entry.deletedAt && entry.kpiId === kpi.id && keys.includes(entry.date),
    ).length;
  }

  return {
    kpi,
    period,
    range,
    days: keys.length,
    value,
    target,
    ratio,
    progress,
    tone: kpiTone(progress),
    points: keys.map((key) => ({
      date: key,
      value: series.values.get(key) ?? 0,
      hasData: series.dataDays.has(key),
    })),
    chartTarget: chartTargetOf(kpi, keys.length),
    elapsedRatio,
    pace: paceSentence(period, kpi.direction, progress, elapsedRatio),
    auto,
    entryCount,
  };
}

/* -------------------------------------------------------------------------- */
/*                                  展示辅助                                   */
/* -------------------------------------------------------------------------- */

/** 数字展示：整数加千分位，小数最多一位（620 / 900 / 69.5）。 */
export function formatKpiValue(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1000 && Number.isInteger(value)) {
    return value.toLocaleString("zh-CN");
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** 目标值为 0 时显示「—」，避免出现 0 / 0。 */
export function formatKpiTarget(value: number): string {
  return value > 0 ? formatKpiValue(value) : "—";
}

/** 某条 KPI 在周期内的原始打卡（按日期倒序），用于明细面板。 */
export function entriesInRange(
  entries: readonly KpiEntry[],
  kpiId: string,
  range: PeriodRange,
): KpiEntry[] {
  return entries
    .filter((entry) => !entry.deletedAt && entry.kpiId === kpiId)
    .filter((entry) => entry.date >= dayKey(range.start) && entry.date <= dayKey(range.end))
    .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : b.date.localeCompare(a.date)));
}

/** 当天已打卡的总量（用于「补录」时预填）。 */
export function dailyTotal(entries: readonly KpiEntry[], kpiId: string, date: string): number {
  return entries
    .filter((entry) => !entry.deletedAt && entry.kpiId === kpiId && entry.date === date)
    .reduce((sum, entry) => sum + entry.value, 0);
}
