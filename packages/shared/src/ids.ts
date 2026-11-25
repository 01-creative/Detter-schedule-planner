/**
 * ID 生成：UUIDv7（时间有序，适合本地优先 + 增量同步）。
 *
 * 为什么不用自增 ID：
 * - 离线时客户端必须能自己生成主键，不能等服务器分配；
 * - UUIDv7 前 48bit 是毫秒时间戳，按字典序 ≈ 按创建时间排序，SQLite 索引友好。
 */

const HEX: string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

/** 生成 UUIDv7 字符串（小写，带连字符）。 */
export function uuidv7(now: number = Date.now(), rand: () => number = Math.random): string {
  const bytes = new Uint8Array(16);

  // 48bit 时间戳（big-endian）
  let ts = now;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ts & 0xff;
    ts = Math.floor(ts / 256);
  }

  for (let i = 6; i < 16; i++) {
    bytes[i] = Math.floor(rand() * 256) & 0xff;
  }

  // version = 7
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  // variant = RFC 4122
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const h = (i: number) => HEX[bytes[i]!]!;
  return (
    h(0) + h(1) + h(2) + h(3) + "-" +
    h(4) + h(5) + "-" +
    h(6) + h(7) + "-" +
    h(8) + h(9) + "-" +
    h(10) + h(11) + h(12) + h(13) + h(14) + h(15)
  );
}

/** 从 UUIDv7 中取回毫秒时间戳；非 v7 返回 null。 */
export function uuidv7Time(id: string): number | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return null;
  }
  const hex = id.slice(0, 8) + id.slice(9, 13);
  return parseInt(hex, 16);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** 生成短随机 ID（用于 checklist 项等非同步实体）。 */
export function shortId(length = 10): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}
