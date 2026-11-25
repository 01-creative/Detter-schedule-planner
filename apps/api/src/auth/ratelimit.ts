import type { Db } from "../db/types";
import { uuidv7 } from "../lib/ids";

/**
 * 登录失败限流：同 IP 15 分钟内失败 ≥ 10 次 → 429。
 *
 * 为什么存库而不是内存：Worker 实例随时会被回收，内存计数在公网上等于没有。
 * 单用户场景下 login_attempts 的行数可以忽略，顺手在登录时清理 24h 之前的记录。
 */
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_FAILURES = 10;
const RETENTION_MS = 24 * 60 * 60 * 1000;

export async function countRecentFailures(db: Db, ip: string, now: number): Promise<number> {
  const row = await db.first<{ failures: number }>(
    "SELECT COUNT(*) AS failures FROM login_attempts WHERE ip = ? AND success = 0 AND at >= ?",
    [ip, now - LOGIN_WINDOW_MS],
  );
  return Number(row?.failures ?? 0);
}

export async function recordLoginAttempt(db: Db, ip: string, now: number, success: boolean): Promise<void> {
  await db.run("INSERT INTO login_attempts (id, ip, at, success) VALUES (?, ?, ?, ?)", [
    uuidv7(now),
    ip,
    now,
    success ? 1 : 0,
  ]);
}

export async function pruneLoginAttempts(db: Db, now: number): Promise<void> {
  await db.run("DELETE FROM login_attempts WHERE at < ?", [now - RETENTION_MS]);
}
