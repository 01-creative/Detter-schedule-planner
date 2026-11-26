import { addDays, dayKey, periodRange } from "@detter/shared";
import type { Okr, OkrPeriod } from "@detter/shared";

/**
 * OKR 周期导航的纯规则。
 *
 * 唯一事实来源是 `@detter/shared` 的 `periodRange`：
 * 周从周一开始、月按自然月、季按自然季度 —— 复盘页也用同一套边界，
 * 所以这里不重复实现任何日期计算，只做「按周期类型平移 + 生成中文标签」。
 *
 * Okr.periodStart / periodEnd 按契约存本地日历日键（YYYY-MM-DD），
 * 因此匹配时比较 `dayKey(range.start)`，同时兼容旧数据写成 periodRange.key 的情况。
 */

export interface OkrRange {
  type: OkrPeriod;
  /** 周期起点 00:00 */
  start: number;
  /** 周期终点 23:59:59.999 */
  end: number;
  /** periodRange 的归档键：周 2026-11-24 / 月 2026-11 / 季 2026-Q4 / 年 2026 */
  key: string;
  /** 应写入 Okr.periodStart 的日期键 */
  startKey: string;
  /** 应写入 Okr.periodEnd 的日期键 */
  endKey: string;
  /** 周期主标题：11/24 - 11/30 · 2026年11月 · 2026 Q4 */
  label: string;
  /** 副标题：2026-11-24 → 2026-11-30 · 共 7 天 */
  caption: string;
  isCurrent: boolean;
}

export const OKR_PERIOD_TABS: ReadonlyArray<{ value: OkrPeriod; label: string }> = [
  { value: "week", label: "周" },
  { value: "month", label: "月" },
  { value: "quarter", label: "季" },
  { value: "year", label: "年" },
];

export const OKR_PERIOD_NAMES: Record<OkrPeriod, string> = {
  week: "周",
  month: "月",
  quarter: "季度",
  year: "年",
};

function monthDay(ts: number): string {
  const date = new Date(ts);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function daysBetween(start: number, end: number): number {
  return Math.round((end - start + 1) / 86_400_000);
}

/** 周期主标题。跨年周会补上年份，否则「12/29 - 01/04」看不出是哪一年。 */
export function okrRangeLabel(type: OkrPeriod, start: number, end: number, now: number): string {
  const startYear = new Date(start).getFullYear();
  const endYear = new Date(end).getFullYear();
  if (type === "week") {
    const base = `${monthDay(start)} - ${monthDay(end)}`;
    const needYear = startYear !== endYear || startYear !== new Date(now).getFullYear();
    return needYear ? `${startYear}年 ${base}` : base;
  }
  if (type === "month") {
    return `${startYear}年${new Date(start).getMonth() + 1}月`;
  }
  if (type === "quarter") {
    return `${startYear} Q${Math.floor(new Date(start).getMonth() / 3) + 1}`;
  }
  return `${startYear}年`;
}

/** 计算某个时间点所处的 OKR 周期。 */
export function okrRange(type: OkrPeriod, anchor: number = Date.now(), now: number = Date.now()): OkrRange {
  const range = periodRange(type, anchor);
  const startKey = dayKey(range.start);
  const endKey = dayKey(range.end);
  return {
    type,
    start: range.start,
    end: range.end,
    key: range.key,
    startKey,
    endKey,
    label: okrRangeLabel(type, range.start, range.end, now),
    caption: `${startKey} → ${endKey} · 共 ${daysBetween(range.start, range.end)} 天`,
    isCurrent: periodRange(type, now).key === range.key,
  };
}

/** 按周期类型平移：-1 上一周期，+1 下一周期。返回新锚点（新周期起点）。 */
export function shiftAnchor(type: OkrPeriod, anchor: number, delta: number): number {
  const date = new Date(anchor);
  switch (type) {
    case "week":
      return addDays(anchor, delta * 7);
    case "month":
      return new Date(date.getFullYear(), date.getMonth() + delta, 1).getTime();
    case "quarter":
      return new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3 + delta * 3, 1).getTime();
    case "year":
      return new Date(date.getFullYear() + delta, 0, 1).getTime();
  }
}

export function shiftOkrRange(type: OkrPeriod, range: OkrRange, delta: number, now: number = Date.now()): OkrRange {
  return okrRange(type, shiftAnchor(type, range.start, delta), now);
}

/** 同一周期的前后顺序比较：<0 表示 a 在 b 之前。 */
export function compareOkrRange(a: OkrRange, b: OkrRange): number {
  return a.start - b.start;
}

/** 该 Objective 是否属于当前浏览的周期。 */
export function okrMatchesRange(okr: Okr, range: OkrRange): boolean {
  if (okr.deletedAt) return false;
  if (okr.period !== range.type) return false;
  return okr.periodStart === range.startKey || okr.periodStart === range.key;
}

/** 周期内所有 Objective，按 sortIndex + createdAt 稳定排序。 */
export function pickOkrsOfRange(okrs: readonly Okr[], range: OkrRange): Okr[] {
  return okrs
    .filter((okr) => okrMatchesRange(okr, range))
    .sort(
      (a, b) => a.sortIndex - b.sortIndex || a.createdAt - b.createdAt || a.id.localeCompare(b.id),
    );
}

/** Objective 自己的周期文案（用于跨周期搜索结果或历史列表）。 */
export function okrPeriodText(okr: Okr): string {
  const start = okr.periodStart;
  const end = okr.periodEnd;
  if (okr.period === "week") return `${start} → ${end}`;
  if (okr.period === "month") return start.slice(0, 7).replace("-", "年") + "月";
  if (okr.period === "quarter") return start.slice(0, 4) + " Q" + (Math.floor((Number(start.slice(5, 7)) - 1) / 3) + 1);
  return start.slice(0, 4) + "年";
}

/**
 * 从当前周期往前找最近一个有 Objective 的同类周期，最多找 12 个。
 * 找不到返回 null —— UI 据此禁用「从上一周期复制」。
 */
export function findPreviousRangeWithOkrs(
  okrs: readonly Okr[],
  type: OkrPeriod,
  range: OkrRange,
  now: number = Date.now(),
  maxLookback = 12,
): OkrRange | null {
  let cursor = range;
  for (let step = 0; step < maxLookback; step += 1) {
    cursor = shiftOkrRange(type, cursor, -1, now);
    if (pickOkrsOfRange(okrs, cursor).length > 0) return cursor;
  }
  return null;
}

/** 周/月/季/年的「第几个」不在这里算：周期边界一律交给 periodRange。 */
export function isRangeStart(type: OkrPeriod, ts: number): boolean {
  return dayKey(periodRange(type, ts).start) === dayKey(ts);
}
