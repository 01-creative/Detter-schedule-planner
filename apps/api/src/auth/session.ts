import type { Db } from "../db/types";
import { randomToken, sha256Hex } from "../lib/crypto";
import { uuidv7 } from "../lib/ids";

/**
 * 会话：Cookie 里只放不透明随机 token，库里只存 sha256(token)。
 * 这样即使 D1 备份泄漏，也无法直接拿来冒充登录。
 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** 剩余有效期低于 7 天就滑动续期到满 30 天。 */
export const SESSION_RENEW_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;
/** last_seen_at 的写入节流：每个请求都写会把 D1 的行写入配额烧光。 */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const SESSION_TOKEN_BYTES = 48;

export interface SessionRecord {
  id: string;
  userId: string;
  deviceId: string;
  expiresAt: number;
}

interface SessionRow {
  id: string;
  user_id: string;
  device_id: string;
  expires_at: number;
  last_seen_at: number;
}

export interface CreateSessionInput {
  userId: string;
  deviceId: string;
  userAgent?: string;
  ip?: string;
  now: number;
  ttlMs?: number;
}

export async function createSession(
  db: Db,
  input: CreateSessionInput,
): Promise<{ token: string; session: SessionRecord }> {
  const ttl = input.ttlMs ?? SESSION_TTL_MS;
  const token = randomToken(SESSION_TOKEN_BYTES);
  const tokenHash = await sha256Hex(token);
  const id = uuidv7(input.now);
  const expiresAt = input.now + ttl;

  await db.run(
    `INSERT INTO sessions (id, user_id, token_hash, device_id, user_agent, ip, created_at, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.userId, tokenHash, input.deviceId, input.userAgent ?? "", input.ip ?? "", input.now, expiresAt, input.now],
  );

  return { token, session: { id, userId: input.userId, deviceId: input.deviceId, expiresAt } };
}

/**
 * 按 token 查有效会话，并顺带做滑动续期 + last_seen 节流。
 * 返回 null 表示 token 无效/已吊销/已过期。
 */
export async function findSession(db: Db, token: string, now: number): Promise<SessionRecord | null> {
  const tokenHash = await sha256Hex(token);
  const row = await db.first<SessionRow>(
    "SELECT id, user_id, device_id, expires_at, last_seen_at FROM sessions WHERE token_hash = ? AND revoked_at IS NULL",
    [tokenHash],
  );
  if (!row) return null;

  const expiresAt = Number(row.expires_at);
  if (expiresAt <= now) return null;

  if (expiresAt - now < SESSION_RENEW_THRESHOLD_MS) {
    // 滑动续期：常驻设备不该每 30 天被踢一次
    const nextExpiresAt = now + SESSION_TTL_MS;
    await db.run("UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE id = ?", [nextExpiresAt, now, row.id]);
    return { id: row.id, userId: row.user_id, deviceId: row.device_id, expiresAt: nextExpiresAt };
  }

  if (now - Number(row.last_seen_at) > TOUCH_INTERVAL_MS) {
    await db.run("UPDATE sessions SET last_seen_at = ? WHERE id = ?", [now, row.id]);
  }

  return { id: row.id, userId: row.user_id, deviceId: row.device_id, expiresAt };
}

export async function revokeSession(db: Db, sessionId: string, now: number): Promise<void> {
  await db.run("UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", [now, sessionId]);
}

export async function revokeSessionsForDevice(
  db: Db,
  userId: string,
  deviceId: string,
  now: number,
): Promise<number> {
  const result = await db.run(
    "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL",
    [now, userId, deviceId],
  );
  return result.changes;
}

/** 改密码时用：保留当前会话，踢掉其它所有会话。 */
export async function revokeOtherSessions(
  db: Db,
  userId: string,
  keepSessionId: string | null,
  now: number,
): Promise<number> {
  const result = await db.run(
    "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND id <> ?",
    [now, userId, keepSessionId ?? ""],
  );
  return result.changes;
}

/**
 * 设备登记：同名视为同一设备（单用户、设备数很少，设备名就是用户起的别名）。
 * 登录/初始化时调用，顺带刷新 last_seen_at。
 */
export async function ensureDevice(
  db: Db,
  input: { userId: string; name: string; platform?: string; now: number },
): Promise<string> {
  const name = input.name.trim() || "未命名设备";
  const existing = await db.first<{ id: string }>(
    "SELECT id FROM devices WHERE user_id = ? AND name = ? ORDER BY created_at ASC LIMIT 1",
    [input.userId, name],
  );
  if (existing) {
    await db.run("UPDATE devices SET last_seen_at = ? WHERE id = ?", [input.now, existing.id]);
    return existing.id;
  }

  const id = uuidv7(input.now);
  await db.run(
    "INSERT INTO devices (id, user_id, name, platform, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
    [id, input.userId, name, input.platform ?? "web", input.now, input.now],
  );
  return id;
}

/** 推送时刷新设备活跃时间（设备列表按此显示「最近在线」）。 */
export async function touchDevice(db: Db, userId: string, deviceId: string, now: number): Promise<void> {
  await db.run("UPDATE devices SET last_seen_at = ? WHERE id = ? AND user_id = ?", [now, deviceId, userId]);
}
