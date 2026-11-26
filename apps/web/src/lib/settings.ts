import { db } from "@/db";

/**
 * 读一条设置（settings 表按 key 取最新未删除的一行）。
 *
 * 为什么不放进 db/repo：repo 是「写入口」，负责事务与 outbox；
 * 这里是最常用的**只读**取法，单独一个函数可以让调用点保持一行，不必每次展开 where/sort。
 */
export async function readSetting<T = unknown>(key: string): Promise<T | null> {
  const rows = await db.settings.where("key").equals(key).toArray();
  const alive = rows.filter((row) => !row.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt);
  return (alive[0]?.value as T | undefined) ?? null;
}

/** 提醒设置里「新任务默认提前多少分钟」的键（与后端 reminders 配置同一约定）。 */
export const REMINDER_DEFAULT_OFFSET_KEY = "reminders.defaultOffsetMin";
