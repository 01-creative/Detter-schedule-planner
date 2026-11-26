import { base64UrlDecode, concatBytes, randomBytes, truncateUtf8, uint32BE, utf8 } from "./encoding";
import {
  aesGcmEncrypt,
  deriveEcdhSecret,
  exportRawPublicKey,
  generateEcdhKeyPair,
  hkdfBits,
  importAesGcmKey,
  importEcdhPublicKey,
  importHkdfKey,
} from "./webcrypto";

/**
 * aes128gcm 载荷加密（RFC 8291 / RFC 8188）。
 *
 * 为什么不用 `web-push` 包：它依赖 Node 的 crypto/http，在 Cloudflare Workers 里跑不起来；
 * 而推送是这个产品「最后一道闸」的一部分，必须两种运行时都能用。
 *
 * 流程（对应 RFC 8291 §3.4）：
 *   1. ECDH(as_private, ua_public)                → ecdh_secret
 *   2. HKDF(auth_secret, ecdh_secret, "WebPush: info\0" || ua_public || as_public) → IKM
 *   3. HKDF(salt, IKM, "Content-Encoding: aes128gcm\0") → CEK (16B)
 *      HKDF(salt, IKM, "Content-Encoding: nonce\0")     → NONCE (12B)
 *   4. AES-128-GCM(CEK, NONCE, plaintext || 0x02)
 *   5. 消息体 = salt(16) || rs(4) || idlen(1)=65 || as_public(65) || 密文
 */

/** Push 服务普遍限制单条消息 ≤ 4096 字节；留足头部与填充余量后按 3000 字节截断。 */
export const MAX_PUSH_PAYLOAD_BYTES = 3000;

/** 单条记录大小，绝大多数实现都用 4096。 */
const RECORD_SIZE = 4096;

const PADDING_DELIMITER = 0x02;

export interface PushSubscriptionInfo {
  endpoint: string;
  keys: {
    /** 客户端公钥（base64url，65 字节未压缩 P-256） */
    p256dh: string;
    /** 认证密钥（base64url，16 字节） */
    auth: string;
  };
}

export interface EphemeralKeyMaterial {
  privateKey: CryptoKey;
  /** 65 字节未压缩公钥 */
  publicKey: Uint8Array;
}

export interface EncryptOptions {
  /** 固定 salt 仅用于测试向量；生产不传。 */
  salt?: Uint8Array;
  /** 固定临时密钥仅用于测试向量；生产不传。 */
  ephemeral?: EphemeralKeyMaterial;
}

export interface EncryptedPushMessage {
  body: Uint8Array;
  salt: Uint8Array;
  serverPublicKey: Uint8Array;
}

export async function generateEphemeralKeys(): Promise<EphemeralKeyMaterial> {
  const pair = await generateEcdhKeyPair();
  const publicKey = await exportRawPublicKey(pair.publicKey);
  return { privateKey: pair.privateKey, publicKey };
}

/** 校验订阅里的密钥长度；非法订阅直接拒绝（也避免把奇怪字节喂给 WebCrypto）。 */
export function parseSubscriptionKeys(subscription: PushSubscriptionInfo): {
  p256dh: Uint8Array;
  auth: Uint8Array;
} | null {
  try {
    const p256dh = base64UrlDecode(subscription.keys.p256dh);
    const auth = base64UrlDecode(subscription.keys.auth);
    if (p256dh.length !== 65 || p256dh[0] !== 0x04) return null;
    if (auth.length < 16) return null;
    return { p256dh, auth };
  } catch {
    return null;
  }
}

export async function encryptPushPayload(
  subscription: PushSubscriptionInfo,
  payload: string,
  options: EncryptOptions = {},
): Promise<EncryptedPushMessage> {
  const keys = parseSubscriptionKeys(subscription);
  if (!keys) throw new Error("推送订阅的 p256dh/auth 密钥格式不合法");

  const salt = options.salt ?? randomBytes(16);
  const ephemeral = options.ephemeral ?? (await generateEphemeralKeys());

  const userAgentKey = await importEcdhPublicKey(keys.p256dh);
  const sharedSecret = await deriveEcdhSecret(ephemeral.privateKey, userAgentKey);

  // RFC 8291 §3.4 第一层：salt 就是客户端的 auth_secret
  const ecdhKey = await importHkdfKey(sharedSecret);
  const ikm = await hkdfBits(
    ecdhKey,
    keys.auth,
    concatBytes(utf8("WebPush: info\0"), keys.p256dh, ephemeral.publicKey),
    32,
  );

  // 第二层：以随机 salt 派生 CEK / NONCE
  const ikmKey = await importHkdfKey(ikm);
  const contentEncryptionKey = await hkdfBits(ikmKey, salt, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfBits(ikmKey, salt, utf8("Content-Encoding: nonce\0"), 12);

  const plaintext = concatBytes(
    utf8(truncateUtf8(payload, MAX_PUSH_PAYLOAD_BYTES)),
    new Uint8Array([PADDING_DELIMITER]),
  );

  const aesKey = await importAesGcmKey(contentEncryptionKey);
  const ciphertext = await aesGcmEncrypt(aesKey, nonce, plaintext);

  const header = concatBytes(
    salt,
    uint32BE(RECORD_SIZE),
    new Uint8Array([ephemeral.publicKey.length]),
    ephemeral.publicKey,
  );

  return {
    body: concatBytes(header, ciphertext),
    salt,
    serverPublicKey: ephemeral.publicKey,
  };
}
