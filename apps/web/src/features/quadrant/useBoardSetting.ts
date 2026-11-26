import { useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db";
import { saveEntity } from "@/db/repo";

/**
 * 板级设置（视图模式 / 排序方式）读写。
 *
 * 为什么不用 localStorage / Zustand：
 * 任务书要求「全局设置存 settings 表」，这样换设备同步后视图偏好也跟着走。
 * 写入仍然走 `@/db/repo`，因此这些偏好变更同样进入 outbox。
 *
 * id 用 `setting:<key>`，保证同一个 key 永远只有一行，不会越写越多。
 */
export function useBoardSetting<T>(key: string, fallback: T): [T, (value: T) => void] {
  const stored = useLiveQuery(async () => {
    const rows = await db.settings.where("key").equals(key).toArray();
    const alive = rows
      .filter((row) => !row.deletedAt)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return alive[0]?.value as T | undefined;
  }, [key]);

  const setValue = useCallback(
    (value: T) => {
      void saveEntity("setting", { id: `setting:${key}`, key, value });
    },
    [key],
  );

  return [stored === undefined ? fallback : stored, setValue];
}
