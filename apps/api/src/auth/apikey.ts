import type { ApiScope } from "@detter/shared";
import type { Db } from "../db/types";
import { randomAlphanumeric, sha256Hex, timingSafeEqualHex } from "../lib/crypto";
import { uuidv7 } from "../lib/ids";

/**
 * API Key：给 AI / agent / MCP 用的一次性明文凭据。
 *
 * 形态：dtk_<8 位 prefix>_<32 位 secret>
 * 库内：prefix 明文（用于检索）+ sha256(整串) —— 只要没拿到整串，拿库也还原不出可用密钥。
 */
export const API_KEY_TOKEN_PREFIX = "dtk_";
const PREFIX_LENGTH = 8;
const SECRET_LENGTH = 32;
const TOKEN_PATTERN = /^dtk_([A-Za-z0-9]{8})_([A-Za-z0-9]{32})$/;
/** last_used_at 每 5 分钟最多写一次，避免每次调用都产生一次 D1 写。 */
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

const VALID_SCOPES: ApiScope[] = ["read", "write", "admin"];

export interface GeneratedApiKey {
  plaintext: string;
  prefix: string;
  hash: string;
}

export async function generateApiKey(): Promise<GeneratedApiKey> {
  const prefix = randomAlphanumeric(PREFIX_LENGTH);
  const secret = randomAlphanumeric(SECRET_LENGTH);
  const plaintext = `${API_KEY_TOKEN_PREFIX}${prefix}_${secret}`;
  return { plaintext, prefix, hash: await sha256Hex(plaintext) };
}

export async function hashApiKey(plaintext: string): Promise<string> {
  return sha256Hex(plaintext);
}

/** scopes 列存 JSON 文本；解析失败按最小权限处理。 */
export function parseScopes(raw: string | null | undefined): ApiScope[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((scope): scope is ApiScope => VALID_SCOPES.includes(scope as ApiScope));
  } catch {
    return [];
  }
}

export interface ApiKeyAuth {
  apiKeyId: string;
  userId: string;
  scopes: ApiScope[];
}

interface ApiKeyRow {
  id: string;
  user_id: string;
  key_hash: string;
  scopes: string;
  expires_at: number | null;
  revoked_at: number | null;
}

/**
 * 校验 Bearer token。
 * 顺序：格式 → 按 prefix 查 → 常数时间比较 hash → 吊销/过期 → 刷新 last_used_at。
 */
export async function authenticateApiKey(db: Db, token: string, now: number): Promise<ApiKeyAuth | null> {
  const match = TOKEN_PATTERN.exec(token);
  if (!match) return null;
  const prefix = match[1] as string;

  const row = await db.first<ApiKeyRow>(
    "SELECT id, user_id, key_hash, scopes, expires_at, revoked_at FROM api_keys WHERE prefix = ?",
    [prefix],
  );
  if (!row) return null;

  const hash = await sha256Hex(token);
  if (!timingSafeEqualHex(hash, row.key_hash)) return null;
  if (row.revoked_at !== null && row.revoked_at !== undefined) return null;
  if (row.expires_at !== null && row.expires_at !== undefined && Number(row.expires_at) <= now) return null;

  await db.run("UPDATE api_keys SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)", [
    now,
    row.id,
    now - LAST_USED_THROTTLE_MS,
  ]);

  return { apiKeyId: row.id, userId: row.user_id, scopes: parseScopes(row.scopes) };
}

export interface CreateApiKeyInput {
  userId: string;
  name: string;
  scopes: ApiScope[];
  expiresInDays?: number;
  now: number;
}

export interface CreatedApiKey {
  id: string;
  name: string;
  prefix: string;
  plaintext: string;
  scopes: ApiScope[];
  expiresAt: number | null;
}

export async function createApiKeyRecord(db: Db, input: CreateApiKeyInput): Promise<CreatedApiKey> {
  const generated = await generateApiKey();
  const id = uuidv7(input.now);
  const expiresAt = input.expiresInDays
    ? input.now + input.expiresInDays * 24 * 60 * 60 * 1000
    : null;

  await db.run(
    `INSERT INTO api_keys (id, user_id, name, prefix, key_hash, scopes, created_at, last_used_at, expires_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)`,
    [id, input.userId, input.name, generated.prefix, generated.hash, JSON.stringify(input.scopes), input.now, expiresAt],
  );

  return {
    id,
    name: input.name,
    prefix: generated.prefix,
    plaintext: generated.plaintext,
    scopes: input.scopes,
    expiresAt,
  };
}
