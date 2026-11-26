import type { Quadrant, Task, TaskKind, TaskStatus } from "@detter/shared";

/**
 * 日历渲染用的领域类型。
 *
 * `CalendarItem` 是「一条会出现在网格里的东西」，它可能是：
 * - 普通任务 / 事件（有独立数据库行）；
 * - 重复系列的虚拟实例（**没有**数据库行，由 rrule 现算）；
 * - 重复系列的覆盖记录（数据库里有行，recurrenceId 指向父任务）。
 *
 * 视图层只认这个类型，因此「虚拟实例」与「真实任务」在渲染上没有任何区别，
 * 差別只体现在写库时走哪条路径（见 calendarMutations.ts）。
 */

export type RecurrenceScope = "this" | "following" | "all";

export interface CalendarItem {
  /** 渲染 key：虚拟实例是 parentId#occurrenceKey；普通任务是任务 id */
  key: string;
  /** 写库时要改的那一行（虚拟实例指向系列父任务） */
  taskId: string;
  /** 系列父任务 id；非重复为 null */
  parentId: string | null;
  /** 实例的原始开始时间戳（字符串），用来匹配覆盖记录 */
  occurrenceKey: string | null;
  title: string;
  startAt: number;
  /** 没有结束时间时为 null（全天 / 只有截止时间的任务） */
  endAt: number | null;
  allDay: boolean;
  /** 只有 dueAt 的「截止型」任务：进全天行，显示「截止」 */
  dueOnly: boolean;
  kind: TaskKind;
  status: TaskStatus;
  quadrant: Quadrant;
  location: string;
  notes: string;
  tags: string[];
  goalId: string | null;
  rrule: string | null;
  /** 是否属于重复系列（虚拟实例或覆盖记录） */
  recurring: boolean;
  /** 没有独立数据库行 */
  virtual: boolean;
  /** 这条条目背后的数据库行：虚拟实例是父任务，覆盖记录是覆盖行 */
  task: Task;
}

/** 详情面板保存时提交的字段集合（只改这些，其余字段原样保留） */
export interface EventDraft {
  title: string;
  startAt: number;
  endAt: number;
  allDay: boolean;
  location: string;
  notes: string;
  done: boolean;
  /** RFC5545 规则串；null 表示不重复 */
  rrule: string | null;
}

/** 新建事件时的预填参数 */
export interface EventSeed {
  startAt: number;
  endAt: number;
  allDay?: boolean;
  title?: string;
}

/** 按天分组后的议程数据 */
export interface DayGroup {
  dayStart: number;
  items: CalendarItem[];
}
