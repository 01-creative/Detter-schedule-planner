import { useLiveQuery } from "dexie-react-hooks";
import type { Goal, Task } from "@detter/shared";
import { db } from "@/db";

/**
 * 板的只读查询。
 *
 * 按 07-FRONTEND-STRUCTURE §3：只读查询可以直接查 Dexie，
 * 跨表聚合写在自己的 queries 文件里，不往 db/repo.ts 里塞业务。
 * 查询返回 undefined 表示「还没回来」——空态与加载态必须能区分开。
 */

export interface LiveBoard<T> {
  data: T;
  loading: boolean;
}

export function useBoardTasks(): LiveBoard<Task[]> {
  const data = useLiveQuery(
    async () => {
      const rows = await db.tasks.toArray();
      return rows.filter((row) => !row.deletedAt);
    },
    [],
    undefined,
  );
  return { data: data ?? [], loading: data === undefined };
}

/** 目标栏需要所有未归档目标；不同 tab 再按 kind 过滤。 */
export function useBoardGoals(): Goal[] {
  const data = useLiveQuery(async () => {
    const rows = await db.goals.toArray();
    return rows.filter((row) => !row.deletedAt && row.status !== "archived");
  }, []);
  return data ?? [];
}

export function useAllGoals(): Goal[] {
  const data = useLiveQuery(async () => {
    const rows = await db.goals.toArray();
    return rows.filter((row) => !row.deletedAt);
  }, []);
  return data ?? [];
}
