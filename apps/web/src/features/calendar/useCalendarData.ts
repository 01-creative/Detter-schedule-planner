import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Task } from "@detter/shared";
import { db } from "@/db";
import { buildCalendarItems } from "./calendarItems";
import type { CalendarItem } from "./calendarTypes";

/**
 * 日历的数据入口：读任务表 + 按视图区间装配条目。
 *
 * 为什么一次性读全表、再在内存里按区间过滤：
 * 「例外记录」与「系列父任务」的必填字段是 recurrenceId / rrule，而本地库
 * （`db/schema.ts`，基座所有、只读）没有为这两个字段建索引，任何按区间的
 * 索引查询都仍然要全表扫一遍。既然无法避免全表读，就把它做成一次
 * useLiveQuery（Dexie 事务提交后自动重跑），区间过滤交给纯函数，
 * 用 useMemo 按 [tasks, from, to] 缓存 —— 这正是任务书 §7 要求的做法。
 *
 * 单人应用的量级（几千条）在这个成本下毫无压力，换来的是「覆盖记录被挪到
 * 区间外也不会凭空多出来 / 少一条」这种正确性。
 */
export interface CalendarData {
  items: CalendarItem[];
  tasks: Task[];
  loading: boolean;
}

export function useCalendarData(from: number, to: number): CalendarData {
  const tasks = useLiveQuery(
    async () => {
      const rows = await db.tasks.toArray();
      return rows.filter((row) => !row.deletedAt);
    },
    [],
    undefined,
  );

  const items = useMemo(
    () => (tasks ? buildCalendarItems(tasks, from, to) : []),
    [tasks, from, to],
  );

  return { items, tasks: tasks ?? [], loading: tasks === undefined };
}
