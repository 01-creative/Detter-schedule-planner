import { useLiveQuery } from "dexie-react-hooks";
import type { Goal, InboxItem, Quadrant, Task } from "@detter/shared";
import { db } from "./index";

/**
 * 领域数据的读取入口。
 *
 * 为什么都用 useLiveQuery：Dexie 会在事务提交后自动重跑查询，
 * 因此「捕获面板写了一条 → 收件箱页立刻多一条」不需要任何手写订阅或全局刷新。
 * 每个 hook 都额外返回 loading：undefined 表示「查询还没回来」，空数组表示「真的没有」，
 * 这两者必须区分开，否则空态会先于加载态闪一下。
 */

export interface LiveResult<T> {
  data: T;
  loading: boolean;
}

export function useInboxItems(): LiveResult<InboxItem[]> {
  const data = useLiveQuery(
    async () => {
      const rows = await db.inbox.orderBy("capturedAt").reverse().toArray();
      return rows.filter((row) => !row.deletedAt);
    },
    [],
    undefined,
  );

  return { data: data ?? [], loading: data === undefined };
}

export function usePendingInboxCount(): number {
  const count = useLiveQuery(async () => {
    const rows = await db.inbox.where("status").equals("pending").toArray();
    return rows.filter((row) => !row.deletedAt).length;
  }, []);
  return count ?? 0;
}

export type QuadrantCounts = Record<Quadrant, number>;

const EMPTY_COUNTS: QuadrantCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };

/** 四象限计数只统计「还活着且没做完」的任务，否则格子里的数字没有行动含义。 */
export function useQuadrantCounts(): QuadrantCounts {
  const counts = useLiveQuery(async () => {
    const tasks = await db.tasks.toArray();
    const next: QuadrantCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const task of tasks) {
      if (task.deletedAt) continue;
      if (task.status === "done" || task.status === "dropped") continue;
      next[task.quadrant] += 1;
    }
    return next;
  }, []);
  return counts ?? EMPTY_COUNTS;
}

export interface DaySummary {
  openTasks: number;
  doneToday: number;
  pendingInbox: number;
}

/** 首屏顶部的小结，用一句话回答「今天还有多少事」。 */
export function useDaySummary(): DaySummary {
  const summary = useLiveQuery(async () => {
    const [tasks, inboxRows] = await Promise.all([db.tasks.toArray(), db.inbox.toArray()]);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayStart = startOfToday.getTime();

    let openTasks = 0;
    let doneToday = 0;
    for (const task of tasks) {
      if (task.deletedAt) continue;
      if (task.status === "done") {
        if (task.completedAt && task.completedAt >= todayStart) doneToday += 1;
        continue;
      }
      if (task.status === "dropped") continue;
      openTasks += 1;
    }

    const pendingInbox = inboxRows.filter((row) => !row.deletedAt && row.status === "pending").length;
    return { openTasks, doneToday, pendingInbox };
  }, []);

  return summary ?? { openTasks: 0, doneToday: 0, pendingInbox: 0 };
}

/** 捕获面板用目标列表做 @ 匹配；没有目标时解析器仍能给出 goalTitle 建议。 */
export function useActiveGoals(): Goal[] {
  const goals = useLiveQuery(async () => {
    const rows = await db.goals.toArray();
    return rows.filter((row) => !row.deletedAt && row.status === "active");
  }, []);
  return goals ?? [];
}

export function useTasks(): LiveResult<Task[]> {
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
