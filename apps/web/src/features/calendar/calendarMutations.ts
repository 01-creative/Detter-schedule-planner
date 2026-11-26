import { MINUTE, deriveQuadrant, startOfDay } from "@detter/shared";
import type { Task } from "@detter/shared";
import { deleteEntity, saveEntity } from "@/db/repo";
import type { CalendarItem, EventDraft, RecurrenceScope } from "./calendarTypes";
import {
  openEndedRRule,
  occurrenceKeyOf,
  previousOccurrenceBoundary,
  truncateRRule,
} from "./recurrence";

/**
 * 日历的写库路径。**所有写操作只经过这一层，且只调用 `@/db/repo`**
 * （任务书硬约束：任何写都必须走通用仓储，才能维护 rev / outbox / deviceId）。
 *
 * 重复事件三种作用域（任务书 §5）在这里落地：
 *
 * | 作用域 | 写什么 |
 * | --- | --- |
 * | 只改这一次 | 写一条覆盖记录：recurrenceId=父 id、occurrenceKey=原始开始时间戳、rrule=null |
 * | 改此后所有 | 父系列用 UNTIL 截断 + 新开一条从这次起生效的系列 |
 * | 改整个系列 | 直接改父任务（结束后所有实例都跟着变） |
 *
 * 「完成某一次」「删除某一次」复用同一套机制：前者写 status=done 的覆盖记录，
 * 后者写 status=dropped 的覆盖记录（墓碑），父任务永远不动。
 */

/** 去掉同步身份与主键，得到「可复制成一条新记录」的字段 */
function withoutIdentity(task: Task): Record<string, unknown> {
  const { id, createdAt, updatedAt, deletedAt, rev, deviceId, ...rest } = task;
  void id;
  void createdAt;
  void updatedAt;
  void deletedAt;
  void rev;
  void deviceId;
  return rest as Record<string, unknown>;
}

/** 两个时间点相差几个日历日（用于判断「拖到周三」是第几天） */
export function dayDelta(from: number, to: number): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / 86_400_000);
}

const WEEKDAY_ORDER = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

/**
 * 系列整体挪了日期时，同步平移 BYDAY。
 * 否则「每周一 9:00」拖到周二再选「改整个系列」，会变回周一。
 */
export function shiftRRuleWeekdays(rrule: string, delta: number): string {
  if (!delta) return rrule;
  return rrule.replace(/BYDAY=([A-Za-z0-9,+-]+)/, (_whole, list: string) => {
    const mapped = list
      .split(",")
      .filter(Boolean)
      .map((token) => {
        const weekday = /([A-Za-z]{2})$/.exec(token)?.[1]?.toUpperCase();
        if (!weekday) return token;
        const index = WEEKDAY_ORDER.indexOf(weekday as (typeof WEEKDAY_ORDER)[number]);
        if (index < 0) return token;
        const next = WEEKDAY_ORDER[(((index + delta) % 7) + 7) % 7]!;
        return token.replace(/[A-Za-z]{2}$/, next);
      })
      .join(",");
    return `BYDAY=${mapped}`;
  });
}

function resolveRRule(task: Task, draft: EventDraft, movedFrom: number): string | null {
  const original = task.rrule ?? null;
  if (original !== (draft.rrule ?? null)) return draft.rrule ?? null; // 用户直接改了重复规则
  if (!original) return null;
  return shiftRRuleWeekdays(original, dayDelta(movedFrom, draft.startAt));
}

function patchFromDraft(draft: EventDraft): Record<string, unknown> {
  return {
    title: draft.title.trim(),
    notes: draft.notes,
    startAt: draft.startAt,
    endAt: draft.allDay ? null : draft.endAt,
    allDay: draft.allDay,
    location: draft.location,
    status: draft.done ? "done" : "todo",
    completedAt: draft.done ? Date.now() : null,
  };
}

/** 由条目派生一份草稿：拖拽改期、快速完成这类「只动几个字段」的操作用它 */
export function draftFromItem(item: CalendarItem, patch: Partial<EventDraft> = {}): EventDraft {
  return {
    title: item.title,
    startAt: item.startAt,
    endAt: item.endAt ?? item.startAt + 60 * MINUTE,
    allDay: item.allDay,
    location: item.location,
    notes: item.notes,
    done: item.status === "done",
    rrule: item.rrule,
    ...patch,
  };
}

/* -------------------------------------------------------------------------- */
/*                                   新建                                      */
/* -------------------------------------------------------------------------- */

/**
 * 新建一条日程。
 *
 * 默认 `kind: "task"`：日历和四象限共用同一张表，新建的任务既能在时间轴上看到，
 * 也会以任务卡片进入象限。象限按任务书 §6 由 deriveQuadrant 推导 ——
 * 日历里新建的条目没有重要/紧急刻度，所以落在默认的 Q2（重要不紧急）。
 */
export async function createEvent(draft: EventDraft): Promise<Task> {
  const row = await saveEntity("task", {
    title: draft.title.trim(),
    notes: draft.notes,
    kind: "task",
    status: draft.done ? "done" : "todo",
    completedAt: draft.done ? Date.now() : null,
    quadrant: deriveQuadrant(null, null, 2),
    manualQuadrant: false,
    startAt: draft.startAt,
    endAt: draft.allDay ? null : draft.endAt,
    allDay: draft.allDay,
    location: draft.location,
    rrule: draft.rrule ?? null,
    recurrenceId: null,
    occurrenceKey: null,
    source: "manual",
  });
  return row as unknown as Task;
}

/* -------------------------------------------------------------------------- */
/*                                   编辑                                      */
/* -------------------------------------------------------------------------- */

export interface EditArgs {
  item: CalendarItem;
  draft: EventDraft;
  scope: RecurrenceScope;
  /** 系列父任务；item.recurring 时必须提供 */
  parent: Task | null;
}

/** 只改这一次：写覆盖记录（已有覆盖记录时改那一条） */
async function saveOccurrenceOverride({ item, draft, parent }: EditArgs): Promise<void> {
  const source = parent ?? item.task;
  const base = item.virtual ? withoutIdentity(source) : { ...item.task };
  const occurrenceKey = item.occurrenceKey ?? occurrenceKeyOf(item.startAt);

  await saveEntity("task", {
    ...base,
    ...patchFromDraft(draft),
    // 覆盖记录本身不再展开，只承载「这一次」的差异
    rrule: null,
    recurrenceId: source.id,
    occurrenceKey,
    title: draft.title.trim() || source.title,
  });
}

/** 改整个系列：直接改父任务 */
async function updateWholeSeries({ item, draft }: EditArgs): Promise<void> {
  const source = item.task;
  await saveEntity("task", {
    ...source,
    ...patchFromDraft(draft),
    rrule: resolveRRule(source, draft, source.startAt ?? draft.startAt),
  });
}

/**
 * 改此后所有：父系列用 UNTIL 截断，再从这一次起新开一条系列。
 * 如果改的就是第一次，两者等价，「改整个系列」即可。
 */
async function splitSeries({ item, draft, parent }: EditArgs): Promise<void> {
  const source = parent ?? item.task;
  const occurrenceStart = item.startAt;
  const seriesStart = source.startAt ?? occurrenceStart;

  if (occurrenceStart <= seriesStart || !source.rrule) {
    await updateWholeSeries({ item, draft, scope: "all", parent });
    return;
  }

  await saveEntity("task", {
    ...source,
    rrule: truncateRRule(source.rrule, previousOccurrenceBoundary(occurrenceStart)),
  });

  const nextRRule = (
    (source.rrule ?? null) === (draft.rrule ?? null)
      ? openEndedRRule(source.rrule)
      : (draft.rrule ?? null)
  ) as string | null;

  await saveEntity("task", {
    ...withoutIdentity(source),
    ...patchFromDraft(draft),
    title: draft.title.trim() || source.title,
    rrule: nextRRule ? shiftRRuleWeekdays(nextRRule, dayDelta(occurrenceStart, draft.startAt)) : null,
    recurrenceId: null,
    occurrenceKey: null,
  });
}

export async function applyEventEdit(args: EditArgs): Promise<void> {
  const { item, scope } = args;
  if (!item.recurring) {
    await updateWholeSeries(args);
    return;
  }
  if (scope === "this") await saveOccurrenceOverride(args);
  else if (scope === "following") await splitSeries(args);
  else await updateWholeSeries(args);
}

/* -------------------------------------------------------------------------- */
/*                                   删除                                      */
/* -------------------------------------------------------------------------- */

export interface DeleteArgs {
  item: CalendarItem;
  scope: RecurrenceScope;
  parent: Task | null;
}

export async function applyEventDelete({ item, scope, parent }: DeleteArgs): Promise<void> {
  if (!item.recurring || scope === "all") {
    await deleteEntity("task", item.parentId ?? item.taskId);
    return;
  }

  if (scope === "this") {
    // 已经有覆盖记录 → 直接把那一条删掉，父系列不受影响
    if (!item.virtual) {
      await deleteEntity("task", item.taskId);
      return;
    }
    const source = parent ?? item.task;
    const occurrenceKey = item.occurrenceKey ?? occurrenceKeyOf(item.startAt);
    await saveEntity("task", {
      ...withoutIdentity(source),
      startAt: item.startAt,
      endAt: item.endAt,
      allDay: item.allDay,
      // 墓碑：展开时看到 dropped 就跳过这一次
      status: "dropped",
      completedAt: null,
      rrule: null,
      recurrenceId: source.id,
      occurrenceKey,
    });
    return;
  }

  // 改此后所有：把父系列截断到这一次之前；如果删的就是第一条，整条系列都没了
  const source = parent ?? item.task;
  const seriesStart = source.startAt ?? item.startAt;
  if (item.startAt <= seriesStart || !source.rrule) {
    await deleteEntity("task", source.id);
    return;
  }
  await saveEntity("task", {
    ...source,
    rrule: truncateRRule(source.rrule, previousOccurrenceBoundary(item.startAt)),
  });
}

/* -------------------------------------------------------------------------- */
/*                              快速完成（钩子）                                */
/* -------------------------------------------------------------------------- */

/**
 * 勾选 / 取消勾选。
 * - 普通任务：直接改那条任务；
 * - 重复实例：写/改一条 status=done 的覆盖记录（任务书 §5 的「完成某一次」）。
 */
export async function toggleEventDone(item: CalendarItem, done: boolean): Promise<void> {
  const status = done ? "done" : "todo";
  const completedAt = done ? Date.now() : null;

  if (item.virtual && item.parentId && item.occurrenceKey) {
    await saveEntity("task", {
      ...withoutIdentity(item.task),
      ...patchFromDraft({
        title: item.title,
        startAt: item.startAt,
        endAt: item.endAt ?? item.startAt + 60 * MINUTE,
        allDay: item.allDay,
        location: item.location,
        notes: item.notes,
        done,
        rrule: null,
      }),
      rrule: null,
      recurrenceId: item.parentId,
      occurrenceKey: item.occurrenceKey,
    });
    return;
  }

  await saveEntity("task", { ...item.task, status, completedAt });
}

/* -------------------------------------------------------------------------- */
/*                              覆盖记录 → 时间段                               */
/* -------------------------------------------------------------------------- */

/**
 * 面板里把「日期 + 时间」拼回时间戳。
 * 刻意用 `new Date(y, m-1, d, h, min)` 而不是 `Date.parse("YYYY-MM-DDTHH:mm")`：
 * 后者在部分运行时会按 UTC 解析，得到一个错位的本地时间。
 */
export function combineDateAndTime(dateKey: string, timeValue: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  return new Date(
    year ?? 1970,
    (month ?? 1) - 1,
    day ?? 1,
    hour ?? 0,
    minute ?? 0,
    0,
    0,
  ).getTime();
}
