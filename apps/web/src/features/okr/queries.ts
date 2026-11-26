import { useLiveQuery } from "dexie-react-hooks";
import type { Goal, KeyResult, Okr, Task } from "@detter/shared";
import { db } from "@/db";

/**
 * OKR 页的只读查询。
 *
 * 四张表一次取回：Objective 卡片要同时显示 KR、关联任务与关联目标，
 * 分开查会让同一个卡片在三次渲染里出现三种数字。
 * 全部过滤墓碑；undefined 保留「还没查回来」，与空数组区分。
 */

export interface OkrDataSet {
  okrs: Okr[];
  krs: KeyResult[];
  goals: Goal[];
  tasks: Task[];
  loading: boolean;
}

export function useOkrData(): OkrDataSet {
  const data = useLiveQuery(
    async () => {
      const [okrs, krs, goals, tasks] = await Promise.all([
        db.okrs.toArray(),
        db.keyResults.toArray(),
        db.goals.toArray(),
        db.tasks.toArray(),
      ]);
      return {
        okrs: okrs.filter((row) => !row.deletedAt),
        krs: krs.filter((row) => !row.deletedAt),
        goals: goals.filter((row) => !row.deletedAt),
        tasks: tasks.filter((row) => !row.deletedAt),
      };
    },
    [],
    undefined,
  );

  if (!data) {
    return { okrs: [], krs: [], goals: [], tasks: [], loading: true };
  }
  return { ...data, loading: false };
}

/** 按 Objective 分组 KR，组内按 sortIndex + createdAt 稳定排序。 */
export function groupKrsByOkr(krs: readonly KeyResult[]): Map<string, KeyResult[]> {
  const map = new Map<string, KeyResult[]>();
  for (const kr of krs) {
    const list = map.get(kr.okrId);
    if (list) list.push(kr);
    else map.set(kr.okrId, [kr]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.sortIndex - b.sortIndex || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }
  return map;
}
