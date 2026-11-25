import { DetterDB } from "./schema";

/**
 * 全应用唯一的数据库实例。
 * 测试里需要干净数据时调用 db.delete()，Dexie 会在下次访问时自动重开。
 */
export const db = new DetterDB("detter");

/** 供测试或未来的多账户场景创建独立实例。 */
export function createDetterDb(name: string): DetterDB {
  return new DetterDB(name);
}

export const META_KEYS = {
  syncCursor: "sync.cursor",
  lastSyncAt: "sync.lastSyncAt",
  lastPullAt: "sync.lastPullAt",
} as const;

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const record = await db.meta.get(key);
  return record ? (record.value as T) : fallback;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value, updatedAt: Date.now() });
}

/** 同步游标：服务端 changes.seq。落后太多时上层会改走 snapshot。 */
export async function getCursor(): Promise<number> {
  return getMeta<number>(META_KEYS.syncCursor, 0);
}

export async function setCursor(cursor: number): Promise<void> {
  await setMeta(META_KEYS.syncCursor, cursor);
}

export async function getLastSyncAt(): Promise<number | null> {
  return getMeta<number | null>(META_KEYS.lastSyncAt, null);
}

export async function setLastSyncAt(at: number): Promise<void> {
  await setMeta(META_KEYS.lastSyncAt, at);
}

export type { DetterDB };
export { DetterDB as DetterDatabase };
