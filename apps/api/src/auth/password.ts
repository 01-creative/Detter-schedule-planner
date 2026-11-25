import { fromBase64, pbkdf2Sha256, randomBytes, toBase64, timingSafeEqual } from "../lib/crypto";

/**
 * 口令存储。
 *
 * 参数按 docs/architecture/05-SECURITY.md 固定：PBKDF2-SHA256 / 310000 次 / 16B 盐 / 32B 输出。
 * 迭代次数随记录一起存库，未来调高参数时老用户仍能登录（校验用记录里的值）。
 */
export const PASSWORD_ITERATIONS = 310_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

export interface PasswordRecord {
  hash: string;
  salt: string;
  iterations: number;
}

export async function hashPassword(
  password: string,
  iterations: number = PASSWORD_ITERATIONS,
): Promise<PasswordRecord> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await pbkdf2Sha256(password, salt, iterations, HASH_BYTES);
  return { hash: toBase64(hash), salt: toBase64(salt), iterations };
}

export async function verifyPassword(password: string, record: PasswordRecord): Promise<boolean> {
  const salt = fromBase64(record.salt);
  const expected = fromBase64(record.hash);
  const iterations = record.iterations > 0 ? record.iterations : PASSWORD_ITERATIONS;
  const actual = await pbkdf2Sha256(password, salt, iterations, expected.length || HASH_BYTES);
  return timingSafeEqual(actual, expected);
}

/**
 * 口令策略（安全文档 §2.1）：≥ 10 位、禁止纯数字。
 * 返回错误文案，合规返回 null。
 */
export function validatePasswordPolicy(password: string): string | null {
  if (password.length < 10) return "密码至少 10 位";
  if (/^\d+$/.test(password)) return "密码不能是纯数字";
  return null;
}

/**
 * 「用户不存在」时也做一次等价的 PBKDF2，避免通过响应耗时探测账号是否存在。
 * 盐/摘要都是全零常量，只用于消耗同样的算力。
 */
export const DUMMY_PASSWORD_RECORD: PasswordRecord = {
  hash: toBase64(new Uint8Array(HASH_BYTES)),
  salt: toBase64(new Uint8Array(SALT_BYTES)),
  iterations: PASSWORD_ITERATIONS,
};
