/**
 * Web Push 需要的字节工具（Workers 与 Node 通用）。
 *
 * 刻意不用 Buffer / node:crypto：
 * - Workers 运行时没有 Buffer；
 * - atob / btoa 在两个运行时（Node 16+ 与 Workers）都是全局函数。
 *
 * 所有函数都只做纯计算，便于用 RFC 8291 的测试向量直接验证。
 */

const CHUNK = 0x8000;

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, array) => sum + array.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const array of arrays) {
    output.set(array, offset);
    offset += array.length;
  }
  return output;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** 32 位大端整数（aes128gcm 的 rs 字段）。 */
export function uint32BE(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** 把 UTF-8 字符串截断到不超过 maxBytes，且不切坏多字节字符。 */
export function truncateUtf8(text: string, maxBytes: number): string {
  const encoded = utf8(text);
  if (encoded.length <= maxBytes) return text;

  let result = "";
  let used = 0;
  for (const char of text) {
    const size = utf8(char).length;
    if (used + size > maxBytes) break;
    result += char;
    used += size;
  }
  return result;
}
