/**
 * WebCrypto 的最小封装层。
 *
 * 为什么需要它：本仓库同时加载了 @cloudflare/workers-types 与 @types/node，
 * 两者对 `generateKey` 重载、ECDH 的 public 参数命名（`public` / `$public`）声明不一致。
 * 直接在业务代码里调用 subtle.* 会出现「Workers 能跑、tsc 不认」的情况。
 * 把平台差异收敛到这一个文件，业务代码只依赖下面这些签名明确的函数。
 *
 * 用到的算法（都是两个运行时都支持的）：
 * - ECDH P-256（协商共享密钥 / 生成临时密钥）
 * - HKDF-SHA256（RFC 8291 的密钥派生）
 * - AES-128-GCM（载荷加密）
 * - ECDSA P-256 + SHA-256（VAPID 的 ES256 JWT 签名）
 */

interface SubtleLike {
  generateKey(algorithm: object, extractable: boolean, keyUsages: string[]): Promise<unknown>;
  importKey(
    format: string,
    keyData: unknown,
    algorithm: string | object,
    extractable: boolean,
    keyUsages: string[],
  ): Promise<unknown>;
  exportKey(format: string, key: unknown): Promise<ArrayBuffer>;
  deriveBits(algorithm: object, baseKey: unknown, length: number): Promise<ArrayBuffer>;
  sign(algorithm: object, key: unknown, data: Uint8Array): Promise<ArrayBuffer>;
  encrypt(algorithm: object, key: unknown, data: Uint8Array): Promise<ArrayBuffer>;
}

// 用全局 crypto（Workers / Node 18+ 都有）。这里只取 subtle，
// getRandomValues 在 encoding.ts 里直接用全局 crypto，类型由 @types/node 提供。
const subtle = (crypto as unknown as { subtle: SubtleLike }).subtle;

export interface EcdhKeyPair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

export async function generateEcdhKeyPair(): Promise<EcdhKeyPair> {
  const pair = (await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as { privateKey: CryptoKey; publicKey: CryptoKey };
  return { privateKey: pair.privateKey, publicKey: pair.publicKey };
}

export async function exportRawPublicKey(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await subtle.exportKey("raw", key));
}

export async function importEcdhPublicKey(bytes: Uint8Array): Promise<CryptoKey> {
  return (await subtle.importKey("raw", bytes, { name: "ECDH", namedCurve: "P-256" }, false, [])) as CryptoKey;
}

/** 测试向量用：把已知的私钥 JWK 导入成 ECDH 私钥（生产路径永远用 generateEcdhKeyPair）。 */
export async function importEcdhPrivateKeyJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return (await subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, [
    "deriveBits",
  ])) as CryptoKey;
}

/** ECDH 共享密钥（32 字节）。 */
export async function deriveEcdhSecret(privateKey: CryptoKey, publicKey: CryptoKey): Promise<Uint8Array> {
  // workers-types 把公钥字段命名成 `public`，DOM 也是 `public`；
  // 用对象字面量 + cast 绕过两套声明之间的字面量差异。
  const algorithm = { name: "ECDH", public: publicKey } as object;
  return new Uint8Array(await subtle.deriveBits(algorithm, privateKey, 256));
}

export async function importHkdfKey(ikm: Uint8Array): Promise<CryptoKey> {
  return (await subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"])) as CryptoKey;
}

/** HKDF-SHA256 = Extract(salt, ikm) + Expand(info, length)。 */
export async function hkdfBits(
  ikmKey: CryptoKey,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const algorithm = { name: "HKDF", hash: "SHA-256", salt, info } as object;
  return new Uint8Array(await subtle.deriveBits(algorithm, ikmKey, length * 8));
}

export async function importAesGcmKey(raw: Uint8Array): Promise<CryptoKey> {
  return (await subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"])) as CryptoKey;
}

export async function aesGcmEncrypt(key: CryptoKey, iv: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
  const algorithm = { name: "AES-GCM", iv } as object;
  return new Uint8Array(await subtle.encrypt(algorithm, key, plaintext));
}

export async function importEcdsaPrivateKeyJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return (await subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
  ])) as CryptoKey;
}

/** ES256 签名（WebCrypto 输出 r||s 64 字节，正是 JWS 需要的格式）。 */
export async function ecdsaSign(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const algorithm = { name: "ECDSA", hash: "SHA-256" } as object;
  return new Uint8Array(await subtle.sign(algorithm, key, data));
}
