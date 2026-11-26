import { useLiveQuery } from "dexie-react-hooks";
import type { Goal, MindMap, MindNode, Task } from "@detter/shared";
import { db } from "@/db";

/**
 * 导图的只读查询。
 *
 * 按 07-FRONTEND-STRUCTURE §3：只读查询可以直接查 Dexie，跨表聚合写在自己的 queries 里。
 * `undefined` 表示查询还没回来 —— 空态与加载态必须能区分开。
 */

export interface LiveResult<T> {
  data: T;
  loading: boolean;
}

/** 所有未删除的导图，按创建时间排序：第一张就是默认打开的那张。 */
export function useMindMaps(): LiveResult<MindMap[]> {
  const data = useLiveQuery(
    async () => {
      const rows = await db.mindMaps.toArray();
      return rows
        .filter((row) => !row.deletedAt)
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    },
    [],
    undefined,
  );
  return { data: data ?? [], loading: data === undefined };
}

/** 某张导图的节点。用 mapId 索引查，不要全表扫。 */
export function useMindNodes(mapId: string | null): LiveResult<MindNode[]> {
  // 查询结果里带上「这是哪张图的节点」：切换导图时 useLiveQuery 会短暂返回上一张图的结果，
  // 如果只看 data === undefined 判断加载态，画布会先用「空图」定相机（表现为只看到根节点）。
  const snapshot = useLiveQuery(
    async () => {
      if (!mapId) return { key: null as string | null, rows: [] as MindNode[] };
      const rows = await db.mindNodes.where("mapId").equals(mapId).toArray();
      return { key: mapId, rows: rows.filter((row) => !row.deletedAt) };
    },
    [mapId],
    undefined,
  );
  const ready = snapshot !== undefined && snapshot.key === mapId;
  return { data: ready ? snapshot.rows : [], loading: Boolean(mapId) && !ready };
}

/** 关联目标的下拉/引用标题需要所有未归档目标。 */
export function useMindGoals(): Goal[] {
  const data = useLiveQuery(async () => {
    const rows = await db.goals.toArray();
    return rows.filter((row) => !row.deletedAt && row.status !== "archived");
  }, []);
  return data ?? [];
}

/** 转任务/勾选态需要读任务；订阅后任务在四象限被勾掉，节点会自己变灰。 */
export function useMindTasks(): Task[] {
  const data = useLiveQuery(async () => {
    const rows = await db.tasks.toArray();
    return rows.filter((row) => !row.deletedAt);
  }, []);
  return data ?? [];
}
