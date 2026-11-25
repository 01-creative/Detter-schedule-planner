/**
 * 跨运行时加密原语。
 *
 * 为什么不用 node:crypto：同一份代码要跑在 Cloudflare Workers（没有 node:crypto）
 * 和 Node 24 上，只有 WebCrypto（globalThis.crypto）与纯 JS 是两边都有的。
 */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** base64 解码查表；兼容 URL-safe 的 '-' '_'，其余非法字符一律当 0 处理（由调用方保证输入合法）。 */
const B64_LOOKUP: Record<string, number> = (() => {
  const table: Record<string, number> = {};
  for (let i = 0; i < B64_ALPHABET.length; i++) table[B64_ALPHABET[i] as string] = i;
  table["-"] = 62;
  table["_"] = 63;
  return table;
})();

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] as number;
    const has1 = i + 1 < bytes.length;
    const has2 = i + 2 < bytes.length;
    const b1 = has1 ? (bytes[i + 1] as number) : 0;
    const b2 = has2 ? (bytes[i + 2] as number) : 0;
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += has1 ? B64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : "=";
    out += has2 ? B64_ALPHABET[b2 & 0x3f] : "=";
  }
  return out;
}

export function fromBase64(input: string): Uint8Array {
  const clean = input.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let index = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = B64_LOOKUP[clean[i] as string] ?? 0;
    const c1 = B64_LOOKUP[clean[i + 1] as string] ?? 0;
    const c2 = B64_LOOKUP[clean[i + 2] as string] ?? 0;
    const c3 = B64_LOOKUP[clean[i + 3] as string] ?? 0;
    const chunk = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    out[index++] = (chunk >> 16) & 0xff;
    if (i + 2 < clean.length) out[index++] = (chunk >> 8) & 0xff;
    if (i + 3 < clean.length) out[index++] = chunk & 0xff;
  }
  return out.subarray(0, index);
}

export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(input: string): Uint8Array {
  return fromBase64(input);
}

export function utf8(text: string): Uint8Array {
  return textEncoder.encode(text);
}

export function fromUtf8(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** SHA-256 → 小写 hex。用于会话 token、API Key、口令比较的摘要。 */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", utf8(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** PBKDF2-SHA256。参数由调用方给定，便于把迭代次数存进 users 表以便未来升级。 */
export async function pbkdf2Sha256(
  password: string,
  salt: Uint8Array,
  iterations: number,
  lengthBytes: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", utf8(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations, hash: "SHA-256" },
    key,
    lengthBytes * 8,
  );
  return new Uint8Array(bits);
}

/**
 * 常数时间比较。
 * 长度不同直接返回 false —— 长度本身不是秘密（口令摘要、hex 串长度固定）。
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 会话 token：48 字节 base64url（64 字符）。 */
export function randomToken(byteLength = 48): string {
  return toBase64Url(randomBytes(byteLength));
}

/** 定长字母数字随机串（API Key 的 prefix / secret）。用拒绝采样避免取模偏置。 */
export function randomAlphanumeric(length: number): string {
  let out = "";
  const buffer = new Uint8Array(length * 2);
  while (out.length < length) {
    crypto.getRandomValues(buffer);
    for (const byte of buffer) {
      // 248 = 62 * 4，超过它的字节丢弃，保证 0..61 均匀
      if (byte >= 248) continue;
      out += ALNUM[byte % 62];
      if (out.length === length) break;
    }
  }
  return out;
}
