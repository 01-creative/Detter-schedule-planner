import type { VapidKeyPair } from "../types";
import { createVapidAuthorization } from "./vapid";
import { encryptPushPayload, type PushSubscriptionInfo } from "./encrypt";
import { fetchWithTimeout, readErrorSnippet } from "../http";

/**
 * 发送一条 Web Push（RFC 8030 + RFC 8291 + RFC 8292）。
 *
 * 只做「一个订阅一次请求」这一件事；多设备遍历、410 清理、渠道降级都在 notifier 里，
 * 这样加密/鉴权部分可以用 RFC 8291 的测试向量单独验证。
 */

const PUSH_TIMEOUT_MS = 10_000;
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

/**
 * 允许的 push 服务域名后缀。
 *
 * 为什么必须有白名单：订阅信息来自客户端，服务端会拿 endpoint 主动发 POST；
 * 没有白名单的话，一个被盗的会话就能把服务端当 SSRF 跳板打内网。
 */
export const DEFAULT_PUSH_ENDPOINT_SUFFIXES: readonly string[] = [
  "googleapis.com", // Chrome / Edge Android（FCM）
  "push.services.mozilla.com", // Firefox
  "notify.windows.com", // Edge / Windows（WNS）
  "push.apple.com", // Safari / iOS 16.4+
  "push.services.mozilla.org",
];

export function isAllowedPushEndpoint(endpoint: string, extraSuffixes: readonly string[] = []): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();
  const suffixes = [...DEFAULT_PUSH_ENDPOINT_SUFFIXES, ...extraSuffixes.map((item) => item.trim().toLowerCase())];
  return suffixes.some((suffix) => suffix.length > 0 && (host === suffix || host.endsWith(`.${suffix}`)));
}

export function parseSubscriptionJson(raw: string | null): PushSubscriptionInfo | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      endpoint?: unknown;
      keys?: { p256dh?: unknown; auth?: unknown };
    };
    if (typeof parsed.endpoint !== "string" || parsed.endpoint.length === 0) return null;
    const p256dh = parsed.keys?.p256dh;
    const auth = parsed.keys?.auth;
    if (typeof p256dh !== "string" || typeof auth !== "string") return null;
    return { endpoint: parsed.endpoint, keys: { p256dh, auth } };
  } catch {
    return null;
  }
}

export interface WebPushResult {
  ok: boolean;
  status: number;
  error?: string;
  /** 404/410：订阅已失效，调用方必须清理 */
  gone?: boolean;
  /** false 表示重试没有意义（4xx 配置错误） */
  retryable?: boolean;
}

export interface SendWebPushOptions {
  vapid: VapidKeyPair;
  fetch: typeof fetch;
  now: number;
  ttlSeconds?: number;
}

export async function sendWebPush(
  subscription: PushSubscriptionInfo,
  payload: string,
  options: SendWebPushOptions,
): Promise<WebPushResult> {
  let body: Uint8Array;
  let authorization: string;
  try {
    body = (await encryptPushPayload(subscription, payload)).body;
    authorization = await createVapidAuthorization(options.vapid, subscription.endpoint, options.now);
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: `加密/签名失败：${error instanceof Error ? error.message : String(error)}`,
      retryable: false,
    };
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(
      options.fetch,
      subscription.endpoint,
      {
        method: "POST",
        headers: {
          // 三个头都不能少：缺 content-encoding 推送服务会拒收
          "content-encoding": "aes128gcm",
          "content-type": "application/octet-stream",
          ttl: String(options.ttlSeconds ?? DEFAULT_TTL_SECONDS),
          urgency: "normal",
          authorization,
        },
        body,
      },
      PUSH_TIMEOUT_MS,
    );
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: `推送请求失败：${error instanceof Error ? error.message : String(error)}`,
      retryable: true,
    };
  }

  if (response.status >= 200 && response.status < 300) {
    return { ok: true, status: response.status };
  }

  const gone = response.status === 404 || response.status === 410;
  const snippet = await readErrorSnippet(response);
  return {
    ok: false,
    status: response.status,
    error: `push: HTTP ${response.status}${snippet ? ` ${snippet}` : ""}`,
    gone,
    // 429 / 5xx 值得重试；其余 4xx 是配置或密钥问题
    retryable: response.status === 429 || response.status >= 500,
  };
}
