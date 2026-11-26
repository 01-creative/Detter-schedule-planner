import type { VapidCredentials, VapidKeyPair } from "../types";
import { base64UrlDecode, base64UrlEncode, utf8 } from "./encoding";
import { ecdsaSign, importEcdsaPrivateKeyJwk } from "./webcrypto";

/**
 * VAPID（RFC 8292）—— ES256 JWT。
 *
 * 只依赖 WebCrypto：
 * - Workers 的 crypto.subtle 支持 ECDSA P-256；
 * - Node 18+ 的 globalThis.crypto 同样支持。
 * 因此同一份代码可以跑在两个运行时，不需要 `web-push` 这类 Node 专用包。
 *
 * 密钥格式与 `npx web-push generate-vapid-keys` 一致：
 *   VAPID_PUBLIC_KEY  = base64url(65 字节未压缩 P-256 公钥)
 *   VAPID_PRIVATE_KEY = base64url(32 字节私钥 d)
 * 私钥导入需要 x/y，所以公钥必须同时提供——这正是任务书里的环境变量约定。
 */

const DEFAULT_SUBJECT = "mailto:detter@localhost";
const JWT_TTL_SECONDS = 12 * 60 * 60;

function isValidSubject(subject: string): boolean {
  return /^mailto:.+@.+/i.test(subject) || /^https:\/\/.+/i.test(subject);
}

/**
 * 解析并校验 VAPID 密钥；任何一项不合法都返回 null（调用方据此关闭 webpush 渠道），
 * 而不是用半个密钥去发请求——那只会得到一串看不懂的 401。
 */
export function parseVapidCredentials(credentials: VapidCredentials | null | undefined): VapidKeyPair | null {
  if (!credentials) return null;

  const publicKeyBase64 = (credentials.publicKey ?? "").trim();
  const privateKeyBase64 = (credentials.privateKey ?? "").trim();
  if (!publicKeyBase64 || !privateKeyBase64) return null;

  let publicKey: Uint8Array;
  let privateKey: Uint8Array;
  try {
    publicKey = base64UrlDecode(publicKeyBase64);
    privateKey = base64UrlDecode(privateKeyBase64);
  } catch {
    return null;
  }

  if (publicKey.length !== 65 || publicKey[0] !== 0x04) return null;
  if (privateKey.length !== 32) return null;

  const subject = (credentials.subject ?? "").trim() || DEFAULT_SUBJECT;
  if (!isValidSubject(subject)) return null;

  return {
    publicKey,
    publicKeyBase64,
    subject,
    privateKeyJwk: {
      kty: "EC",
      crv: "P-256",
      d: base64UrlEncode(privateKey),
      x: base64UrlEncode(publicKey.subarray(1, 33)),
      y: base64UrlEncode(publicKey.subarray(33, 65)),
      ext: true,
    },
  };
}

function jwtSegment(value: Record<string, unknown>): string {
  return base64UrlEncode(utf8(JSON.stringify(value)));
}

/**
 * 生成 Authorization 头的 `vapid t=<jwt>, k=<pub>` 部分。
 * `aud` 必须是 push 服务 endpoint 的 origin（RFC 8292 §2）。
 */
export async function createVapidAuthorization(
  keys: VapidKeyPair,
  endpoint: string,
  now: number,
): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = { typ: "JWT", alg: "ES256" };
  const claims = {
    aud,
    exp: Math.floor(now / 1000) + JWT_TTL_SECONDS,
    sub: keys.subject,
    iat: Math.floor(now / 1000),
  };

  const signingInput = `${jwtSegment(header)}.${jwtSegment(claims)}`;
  const key = await importEcdsaPrivateKeyJwk(keys.privateKeyJwk);
  // WebCrypto 的 ECDSA 签名就是 IEEE P1363 的 r||s（64 字节），正好是 JWS 要的格式，
  // 不需要再转 DER。
  const signature = await ecdsaSign(key, utf8(signingInput));

  return `vapid t=${signingInput}.${base64UrlEncode(signature)}, k=${keys.publicKeyBase64}`;
}
