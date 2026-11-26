import { MINUTE, addDays, dayKey, startOfDay } from "@detter/shared";
import type { Task } from "@detter/shared";
import { durationMs, expandOccurrenceStarts, occurrenceKeyOf } from "./recurrence";
import type { CalendarItem, DayGroup } from "./calendarTypes";

/**
 * 把任务表装配成「日历条目」。
 *
 * 装配规则（任务书 §5）：
 * - 系列父任务（rrule 非空、recurrenceId 为空）按 rrule 在视图区间内展开虚拟实例；
 * - 覆盖记录（recurrenceId 指向父任务）按 occurrenceKey **覆盖**对应实例：
 *   改过时间的用新时间、status=dropped 的整条消失（墓碑）、status=done 的显示为已完成；
 * - 覆盖记录如果被挪到了区间外，这次就不出现（否则会凭空多出一条）；
 * - 没匹配上任何实例的覆盖记录按普通任务渲染 —— 这是「从区间外挪进来」的情况。
 *
 * 整个过程是纯函数，展开结果在 CalendarView 里用 useMemo 缓存（任务书 §7）。
 */

/** 条目实际占用的区间；只有截止时间的任务按 1 分钟算，避免零长度被过滤掉 */
export function itemSpan(item: Pick<CalendarItem, "startAt" | "endAt">): { start: number; end: number } {
  const start = item.startAt;
  const end = item.endAt ?? start + MINUTE;
  return { start, end: Math.max(end, start + MINUTE) };
}

/** 与 [from, to) 是否有交集 */
export function itemOverlaps(item: Pick<CalendarItem, "startAt" | "endAt">, from: number, to: number): boolean {
  const { start, end } = itemSpan(item);
  return end > from && start < to;
}

/** 与某一天是否有交集（日/周视图按列取数据用） */
export function itemsOnDay(items: readonly CalendarItem[], dayStart: number): CalendarItem[] {
  const dayEnd = addDays(dayStart, 1);
  return items.filter((item) => itemOverlaps(item, dayStart, dayEnd));
}

function toItem(
  task: Task,
  options: {
    parent: Task | null;
    occurrenceKey: string | null;
    startAt: number;
    endAt: number | null;
    virtual: boolean;
  },
): CalendarItem {
  const dueOnly = !task.startAt && task.dueAt !== null;
  const allDay = task.allDay || dueOnly;
  const parentId = options.parent?.id ?? null;
  const occurrenceKey = options.occurrenceKey;
  return {
    key:
      parentId && occurrenceKey
        ? `${parentId}#${occurrenceKey}`
        : `${task.id}${occurrenceKey ? `#${occurrenceKey}` : ""}`,
    taskId: task.id,
    parentId,
    occurrenceKey,
    title: task.title,
    startAt: options.startAt,
    endAt: allDay ? null : options.endAt,
    allDay,
    dueOnly,
    kind: task.kind,
    status: task.status,
    quadrant: task.quadrant,
    location: task.location,
    notes: task.notes,
    tags: task.tags,
    goalId: task.goalId,
    rrule: task.rrule,
    recurring: Boolean(task.rrule) || Boolean(parentId),
    virtual: options.virtual,
    task,
  };
}

/** 日历条目的稳定排序：先按开始时间，再按标题，最后按 key */
export function sortCalendarItems(items: CalendarItem[]): CalendarItem[] {
  return items.sort(
    (a, b) =>
      a.startAt - b.startAt ||
      a.title.localeCompare(b.title, "zh-CN") ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
}

/**
 * 装配视图区间 [from, to) 内的所有条目。
 * 返回的数组已排序，可直接渲染。
 */
export function buildCalendarItems(tasks: readonly Task[], from: number, to: number): CalendarItem[] {
  const live = tasks.filter((task) => !task.deletedAt);

  /** 父任务 id → (occurrenceKey → 覆盖记录) */
  const overridesByParent = new Map<string, Map<string, Task>>();
  for (const task of live) {
    if (!task.recurrenceId) continue;
    if (!task.occurrenceKey) continue;
    let bucket = overridesByParent.get(task.recurrenceId);
    if (!bucket) {
      bucket = new Map<string, Task>();
      overridesByParent.set(task.recurrenceId, bucket);
    }
    bucket.set(task.occurrenceKey, task);
  }

  const seriesParents = live.filter(
    (task) => !task.recurrenceId && Boolean(task.rrule) && Boolean(task.startAt),
  );
  const seriesIds = new Set(seriesParents.map((task) => task.id));
  const consumed = new Set<string>();
  const items: CalendarItem[] = [];

  for (const parent of seriesParents) {
    const starts = expandOccurrenceStarts(parent, from, to);
    const bucket = overridesByParent.get(parent.id);
    const duration = durationMs(parent);

    for (const occurrenceStart of starts) {
      const key = occurrenceKeyOf(occurrenceStart);
      const override = bucket?.get(key);

      if (override) {
        consumed.add(override.id);
        if (override.status === "dropped") continue; // 删除某一次 = 墓碑
        const startAt = override.startAt ?? occurrenceStart;
        const endAt = override.endAt ?? (override.startAt ? override.startAt + duration : startAt + duration);
        const item = toItem(override, {
          parent,
          occurrenceKey: key,
          startAt,
          endAt,
          virtual: false,
        });
        if (itemOverlaps(item, from, to)) items.push(item);
        continue;
      }

      const item = toItem(parent, {
        parent,
        occurrenceKey: key,
        startAt: occurrenceStart,
        endAt: occurrenceStart + duration,
        virtual: true,
      });
      if (itemOverlaps(item, from, to)) items.push(item);
    }
  }

  const byId = new Map(live.map((task) => [task.id, task] as const));

  for (const task of live) {
    // 已经展开过的系列父任务不再单独出现（它的第一条实例由 dtstart 生成）
    if (seriesIds.has(task.id)) continue;
    if (consumed.has(task.id)) continue;
    if (task.status === "dropped") continue;

    // 孤儿覆盖记录（父任务已被删掉）按普通任务渲染，而不是静默丢掉
    const parent = task.recurrenceId ? (byId.get(task.recurrenceId) ?? null) : null;
    const startAt = task.startAt ?? task.dueAt;
    if (startAt === null) continue;
    const item = toItem(task, {
      parent,
      occurrenceKey: task.occurrenceKey,
      startAt,
      endAt: task.endAt,
      virtual: false,
    });
    if (itemOverlaps(item, from, to)) items.push(item);
  }

  return sortCalendarItems(items);
}

/** 议程：按天分组（覆盖 [from, to) 内的每一天，空天不返回） */
export function groupItemsByDay(items: readonly CalendarItem[], from: number, to: number): DayGroup[] {
  const buckets = new Map<string, DayGroup>();
  for (const item of items) {
    // 跨天条目只出现在它开始的那一天（落进窗口时按窗口首日算），避免同一件事重复三遍
    const { start } = itemSpan(item);
    const day = startOfDay(Math.max(start, from));
    if (day < from || day >= to) continue;
    const key = dayKey(day);
    let group = buckets.get(key);
    if (!group) {
      group = { dayStart: day, items: [] };
      buckets.set(key, group);
    }
    group.items.push(item);
  }
  return [...buckets.values()].sort((a, b) => a.dayStart - b.dayStart);
}

/** 某一天里各象限出现过哪些（月视图的小圆点用） */
export function quadrantsOfDay(items: readonly CalendarItem[], dayStart: number): number[] {
  const seen = new Set<number>();
  for (const item of itemsOnDay(items, dayStart)) seen.add(item.quadrant);
  return [...seen].sort((a, b) => a - b);
}
