import { MINUTE, addDays, isoWeekday, startOfDay, startOfMonth, startOfWeek } from "@detter/shared";
import { formatWeekday } from "@/lib/format";

/**
 * 日历的几何换算与布局算法。
 *
 * 这里全部是纯函数：不碰 DOM、不碰 Dexie、不碰 React。
 * 拖拽、吸附、重叠分列这些「最容易算错又最难在浏览器里断言」的部分因此可以直接单测。
 *
 * 时间语义（全局约束）：所有时间戳都是毫秒整数，**一律按本地时区解释**。
 * 因此这里既不出现 `toISOString()`，也不用 `DAY = 86400000` 做日期加减
 * （跨月/跨夏令时那样加会漂），日期推进统一走 `addDays()` 的日历语义。
 */

/** 每小时 56px（任务书 §3.1），日/周/月三个视图共用同一套时间刻度 */
export const PX_PER_HOUR = 56;
export const PX_PER_MINUTE = PX_PER_HOUR / 60;

/** 拖拽吸附粒度与最小时长（任务书 §4） */
export const SNAP_MINUTES = 15;
export const MIN_DURATION_MINUTES = 15;
/** 点击空白时段新建事件时的默认时长（任务书 §4） */
export const DEFAULT_DURATION_MINUTES = 60;

/** 同一列最多铺 3 层，第 4 层起折叠成 +N（任务书 §3.1） */
export const MAX_COLUMNS = 3;
/** 事件块最小高度：15 分钟的块也要看得见标题 */
export const MIN_BLOCK_PX = 22;

/** 移动端议程视图的窗口长度（天） */
export const AGENDA_DAYS = 30;

export type CalendarViewMode = "day" | "week" | "month" | "agenda";

export const DESKTOP_VIEW_MODES: readonly CalendarViewMode[] = ["day", "week", "month"];
export const MOBILE_VIEW_MODES: readonly CalendarViewMode[] = ["agenda", "week", "month"];

/** 视图区间，左闭右开 */
export interface ViewRange {
  from: number;
  to: number;
}

/* -------------------------------------------------------------------------- */
/*                                 时间 ↔ 像素                                 */
/* -------------------------------------------------------------------------- */

/** 当天 0 点起的分钟数（本地时区） */
export function minutesOfDay(ts: number): number {
  const date = new Date(ts);
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * 时间戳 → 当天网格内的 y 偏移（px）。
 * 任务书给的公式：top = (start - dayStart) / 60000 * pxPerMin。
 */
export function timeToOffsetPx(ts: number, dayStart: number, pxPerMinute: number = PX_PER_MINUTE): number {
  return ((ts - dayStart) / MINUTE) * pxPerMinute;
}

/** y 偏移（px） → 时间戳，timeToOffsetPx 的逆运算 */
export function offsetPxToTime(px: number, dayStart: number, pxPerMinute: number = PX_PER_MINUTE): number {
  return dayStart + (px / pxPerMinute) * MINUTE;
}

/** 一天的网格总高度：24 × 56 = 1344 */
export function dayHeightPx(pxPerHour: number = PX_PER_HOUR): number {
  return pxPerHour * 24;
}

/**
 * 吸附到 N 分钟刻度。
 *
 * 刻意按「当天 0 点」对齐而不是按 UTC 对齐：`shared/time.ts` 的 snapToMinutes 用
 * `Math.round(ts / step) * step`，在 UTC+5:30 这类半时区会把 :00 吸附到 :30。
 * 这里以本地日 0 点为锚，任何时区下都是墙上时间的整刻度。
 */
export function snapToStep(ts: number, stepMinutes: number = SNAP_MINUTES): number {
  const step = Math.max(1, Math.round(stepMinutes)) * MINUTE;
  const anchor = startOfDay(ts);
  return anchor + Math.round((ts - anchor) / step) * step;
}

/* -------------------------------------------------------------------------- */
/*                                  区间生成                                   */
/* -------------------------------------------------------------------------- */

/** 一周的 7 个「日 0 点」，周一在前（中文习惯，与 shared/time 一致） */
export function weekDayStarts(ts: number): number[] {
  const weekStart = startOfWeek(ts);
  return Array.from({ length: 7 }, (_, index) => startOfDay(addDays(weekStart, index)));
}

/**
 * 月视图网格：固定 6 行 × 7 列 = 42 个「日 0 点」，周一开头。
 *
 * 固定 42 格而不是按月份行数自适应，是为了翻月时网格高度不跳动
 * （任务书 §7 的「一次最多渲染 6×7×3 = 126 个块」也以此为前提）。
 */
export function monthGridStarts(ts: number): number[] {
  const firstOfMonth = startOfMonth(ts);
  const lead = isoWeekday(firstOfMonth) - 1; // 本月 1 号前要补几天（周一=0）
  const gridStart = startOfDay(addDays(firstOfMonth, -lead));
  return Array.from({ length: 42 }, (_, index) => startOfDay(addDays(gridStart, index)));
}

/** 当前视图需要查询/渲染的时间区间（左闭右开） */
export function viewRange(mode: CalendarViewMode, anchor: number): ViewRange {
  switch (mode) {
    case "day": {
      const from = startOfDay(anchor);
      return { from, to: addDays(from, 1) };
    }
    case "week": {
      const from = startOfWeek(anchor);
      return { from, to: addDays(from, 7) };
    }
    case "month": {
      const days = monthGridStarts(anchor);
      return { from: days[0]!, to: addDays(days[41]!, 1) };
    }
    case "agenda": {
      const from = startOfDay(anchor);
      return { from, to: addDays(from, AGENDA_DAYS) };
    }
  }
}

/** 上一 / 下一周期。月视图按「日」推进并夹到当月最后一天，避免 3/31 + 1 月漂到 5/1。 */
export function shiftAnchor(mode: CalendarViewMode, anchor: number, direction: number): number {
  switch (mode) {
    case "day":
      return startOfDay(addDays(anchor, direction));
    case "week":
      return startOfDay(addDays(anchor, 7 * direction));
    case "month": {
      const date = new Date(anchor);
      const year = date.getFullYear();
      const month = date.getMonth() + direction;
      const lastDay = new Date(year, month + 1, 0).getDate();
      return new Date(year, month, Math.min(date.getDate(), lastDay)).getTime();
    }
    case "agenda":
      return startOfDay(addDays(anchor, AGENDA_DAYS * direction));
  }
}

/* -------------------------------------------------------------------------- */
/*                                    文案                                     */
/* -------------------------------------------------------------------------- */

/** 11月26日 */
export function monthDayLabel(ts: number): string {
  const date = new Date(ts);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/** 11月26日 周三 */
export function dayLabel(ts: number): string {
  return `${monthDayLabel(ts)} ${formatWeekday(ts)}`;
}

/** 工具条标题：日=11月26日 周三 / 周=11月24日 - 11月30日 / 月=2026年11月 */
export function viewTitle(mode: CalendarViewMode, anchor: number, now: number = Date.now()): string {
  switch (mode) {
    case "day":
      return dayLabel(anchor);
    case "week": {
      const from = startOfWeek(anchor);
      const to = addDays(from, 6);
      const sameYear = new Date(from).getFullYear() === new Date(now).getFullYear();
      const prefix = sameYear ? "" : `${new Date(from).getFullYear()}年`;
      return `${prefix}${monthDayLabel(from)} - ${monthDayLabel(to)}`;
    }
    case "month": {
      const date = new Date(anchor);
      return `${date.getFullYear()}年${date.getMonth() + 1}月`;
    }
    case "agenda":
      return `${dayLabel(startOfDay(anchor))} 起 ${AGENDA_DAYS} 天`;
  }
}

/* -------------------------------------------------------------------------- */
/*                                  重叠分列                                   */
/* -------------------------------------------------------------------------- */

/** 分列算法只需要「有 id、有起止」这三个字段；endAt 允许为空（只有截止时间的任务） */
export interface IntervalItem {
  key: string;
  startAt: number;
  endAt: number | null;
}

export interface PlacedItem<T extends IntervalItem> {
  item: T;
  /** 被裁剪到本日内的起止（endAt 为空时按默认时长补齐） */
  start: number;
  end: number;
  /** 网格内的 y 偏移与高度（px） */
  top: number;
  height: number;
  /** 未套用最小高度前的真实高度，用于调试与断言 */
  rawHeight: number;
  /** 列序号与列数（列数已按 maxColumns 截断） */
  column: number;
  columns: number;
  /** 水平方向的占比 0..1，视图里乘以 100% 用 */
  left: number;
  width: number;
  /** 超过 maxColumns 的层，不渲染，只计入 overflow */
  hidden: boolean;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

/** 被折叠掉的块，视图在右列画一个 +N */
export interface OverflowMark {
  start: number;
  end: number;
  count: number;
  top: number;
}

export interface DayLayout<T extends IntervalItem> {
  placed: PlacedItem<T>[];
  overflow: OverflowMark[];
  /** 渲染用的列数（1..maxColumns） */
  columns: number;
}

export interface LayoutOptions {
  pxPerMinute?: number;
  maxColumns?: number;
  minHeight?: number;
}

/**
 * 一天之内的重叠分列（贪心 + 区间划分）。
 *
 * 步骤：
 * 1. 把每条事件裁到 [dayStart, dayEnd) —— 跨天事件在每一天各出现一段，段尾画「继续」标记；
 * 2. 按开始时间升序、同起点时长的优先、再按 key 排序，保证布局稳定（不随查询顺序抖动）；
 * 3. 扫描出「簇」：与当前簇的最大结束时间有交集就并入，否则另起一簇。
 *    落回某条事件不能与同簇里的其它事件重叠，所以簇内的层数就是这一段的列数；
 * 4. 簇内贪心：每条事件放进「最后一个事件已结束」的最靠左的列；都不空闲则新开一列。
 *    区间图（interval graph）的贪心着色是可证最优的，因此列数 = 最大同时重叠数；
 * 5. 列数超过 maxColumns（3）时只渲染前 3 列，其余计入 overflow（渲染成 +N），
 *    保证窄列里仍然可读，而不是把字挤成一条线。
 */
export function layoutDay<T extends IntervalItem>(
  items: readonly T[],
  dayStart: number,
  options: LayoutOptions = {},
): DayLayout<T> {
  const pxPerMinute = options.pxPerMinute ?? PX_PER_MINUTE;
  const maxColumns = Math.max(1, options.maxColumns ?? MAX_COLUMNS);
  const minHeight = options.minHeight ?? MIN_BLOCK_PX;
  const dayEnd = addDays(dayStart, 1);

  const clamped = items
    .map((item) => ({
      item,
      // 没有结束时间（只有截止时间 / 只有开始时间）时按默认时长占位，否则块会瘦成一条线
      startAt: item.startAt,
      endAt:
        item.endAt && item.endAt > item.startAt
          ? item.endAt
          : item.startAt + DEFAULT_DURATION_MINUTES * MINUTE,
    }))
    .filter((entry) => entry.endAt > entry.startAt)
    .map((entry) => ({
      item: entry.item,
      start: Math.max(entry.startAt, dayStart),
      end: Math.min(entry.endAt, dayEnd),
    }))
    .filter((segment) => segment.end > segment.start && segment.start < dayEnd)
    .sort(
      (a, b) =>
        a.start - b.start ||
        b.end - a.end ||
        (a.item.key < b.item.key ? -1 : a.item.key > b.item.key ? 1 : 0),
    );

  const placed: PlacedItem<T>[] = [];
  const overflow: OverflowMark[] = [];
  let maxUsedColumns = 0;

  let cluster: typeof clamped = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;

  const flush = () => {
    if (cluster.length === 0) return;
    const columnEnds: number[] = [];
    const assignments = cluster.map((segment) => {
      let column = columnEnds.findIndex((end) => end <= segment.start);
      if (column === -1) {
        column = columnEnds.length;
        columnEnds.push(segment.end);
      } else {
        columnEnds[column] = segment.end;
      }
      return { segment, column };
    });

    const columns = Math.min(columnEnds.length, maxColumns);
    maxUsedColumns = Math.max(maxUsedColumns, columns);

    const hiddenInCluster: number[] = [];
    for (const { segment, column } of assignments) {
      const hidden = column >= columns;
      const top = timeToOffsetPx(segment.start, dayStart, pxPerMinute);
      const rawHeight = timeToOffsetPx(segment.end, dayStart, pxPerMinute) - top;
      placed.push({
        item: segment.item,
        start: segment.start,
        end: segment.end,
        top,
        height: Math.max(minHeight, rawHeight),
        rawHeight,
        column,
        columns,
        left: column / columns,
        width: 1 / columns,
        hidden,
        continuesBefore: segment.item.startAt < dayStart,
        continuesAfter: (segment.item.endAt ?? 0) > dayEnd,
      });
      if (hidden) {
        hiddenInCluster.push(segment.start);
        if (hiddenInCluster.length === 1) {
          overflow.push({
            start: segment.start,
            end: segment.end,
            count: 0,
            top,
          });
        }
      }
    }

    if (hiddenInCluster.length > 0) {
      const last = overflow[overflow.length - 1];
      if (last) last.count = hiddenInCluster.length;
    }

    cluster = [];
    clusterEnd = Number.NEGATIVE_INFINITY;
  };

  for (const segment of clamped) {
    // 与当前簇没有任何交集 → 之前的簇到此为止
    if (segment.start >= clusterEnd) flush();
    cluster.push(segment);
    clusterEnd = Math.max(clusterEnd, segment.end);
  }
  flush();

  return { placed, overflow, columns: Math.max(1, maxUsedColumns) };
}

/* -------------------------------------------------------------------------- */
/*                                  拖拽解析                                   */
/* -------------------------------------------------------------------------- */

export type DragMode = "move" | "resize-end";

export interface DragResolveInput {
  mode: DragMode;
  /** 拖拽开始时的原始起止（不是上一帧的结果，避免误差累积） */
  startAt: number;
  endAt: number;
  /** 横向跨了几列 = 跨了几天 */
  deltaDays: number;
  /** 纵向位移换算成的分钟数（未吸附） */
  deltaMinutes: number;
  stepMinutes?: number;
  minDurationMinutes?: number;
}

export interface DragResolveResult {
  startAt: number;
  endAt: number;
}

/**
 * 把一次拖拽解析成新的起止时间。
 *
 * - move：保持时长，日期按 deltaDays 走日历加法（保留墙上时分），再叠加纵向分钟数；
 * - resize-end：只动结束时间，最小 15 分钟，不允许早于开始时间；
 * - 最后统一吸附到 15 分钟刻度，所以「拖到 16:00」不会变成 16:02。
 *
 * 跨天拖拽就是 deltaDays != 0 的情况：周一 09:00 往右拖两列 → 周三 09:00（+ 纵向偏移）。
 */
export function resolveDrag(input: DragResolveInput): DragResolveResult {
  const step = input.stepMinutes ?? SNAP_MINUTES;
  const minDuration = Math.max(1, input.minDurationMinutes ?? MIN_DURATION_MINUTES);
  const duration = Math.max(minDuration * MINUTE, input.endAt - input.startAt);

  if (input.mode === "move") {
    const shifted = addDays(input.startAt, input.deltaDays) + input.deltaMinutes * MINUTE;
    const startAt = snapToStep(shifted, step);
    return { startAt, endAt: startAt + duration };
  }

  const shiftedEnd = addDays(input.endAt, input.deltaDays) + input.deltaMinutes * MINUTE;
  const endAt = Math.max(snapToStep(shiftedEnd, step), input.startAt + minDuration * MINUTE);
  return { startAt: input.startAt, endAt };
}

/** 纵向像素位移 → 分钟数（拖拽时用；不吸附，吸附交给 resolveDrag） */
export function pxToMinutes(px: number, pxPerMinute: number = PX_PER_MINUTE): number {
  return Math.round(px / pxPerMinute);
}

/** 时间格式化 14:30（本地时区），拖拽气泡与事件块都用它 */
export function clockLabel(ts: number): string {
  const date = new Date(ts);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** 拖拽气泡：14:30 - 15:30（跨天时带日期前缀） */
export function dragBubbleLabel(startAt: number, endAt: number): string {
  const sameDay = startOfDay(startAt) === startOfDay(endAt);
  const head = sameDay ? "" : `${monthDayLabel(startAt)} `;
  const tail = sameDay ? "" : ` ${monthDayLabel(endAt)}`;
  return `${head}${clockLabel(startAt)} - ${clockLabel(endAt)}${tail}`;
}

/** 时长文案：1 小时 / 1 小时 30 分 / 45 分钟 */
export function durationLabel(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} 分钟`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分`;
}
