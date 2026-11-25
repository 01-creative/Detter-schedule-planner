import type { ApiErrorCode, ApiResponse } from "@detter/shared";

/**
 * 类型化 fetch 封装。
 *
 * 三件事在这里做掉，页面和同步客户端都不用重复：
 * 1. 统一信封：{ ok, data } / { ok:false, error } → 直接拿 data 或抛 ApiError；
 * 2. 非 GET 自动带 x-detter-csrf 头（服务端要求）；
 * 3. 超时与网络失败归一成 NetworkFailure，让上层能区分「业务失败」和「连不上」。
 */

const API_BASE = "/api/v1";

/** 3.5s：足够覆盖慢网络下的鉴权查询，又不至于让离线用户干等 */
const DEFAULT_TIMEOUT_MS = 3_500;

export type OfflineLikeCode = "network_error" | "timeout";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ApiErrorCode, message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** 连不上服务器：离线、代理 502、超时都归到这里。调用方据此进入离线模式。 */
export class NetworkFailure extends Error {
  readonly code: OfflineLikeCode;
  readonly status: number;

  constructor(code: OfflineLikeCode, message: string, status = 0) {
    super(message);
    this.name = "NetworkFailure";
    this.code = code;
    this.status = status;
  }
}

/** 离线判定：网络失败、超时、5xx（后端挂了）都算「暂时不可用」。 */
export function isOfflineError(error: unknown): boolean {
  if (error instanceof NetworkFailure) return true;
  if (error instanceof ApiError) return error.status >= 500;
  return false;
}

export interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  timeoutMs?: number;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, timeoutMs = DEFAULT_TIMEOUT_MS, headers, ...init } = options;
  const method = (init.method ?? "GET").toUpperCase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const finalHeaders = new Headers(headers);
  finalHeaders.set("Accept", "application/json");
  if (body !== undefined) finalHeaders.set("Content-Type", "application/json");
  // 服务端对所有非 GET 的 Cookie 请求要求这个头，防止 CSRF
  if (method !== "GET" && method !== "HEAD") finalHeaders.set("x-detter-csrf", "1");

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      method,
      headers: finalHeaders,
      credentials: "same-origin",
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) {
      throw new NetworkFailure("timeout", "请求超时，稍后会自动重试");
    }
    throw new NetworkFailure("network_error", "连不上服务器");
  } finally {
    clearTimeout(timer);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    // 代理层返回的 HTML（后端没起）不应该被当成业务错误
    throw new NetworkFailure("network_error", `服务器暂时不可用（${response.status}）`, response.status);
  }

  let payload: ApiResponse<T>;
  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new NetworkFailure("network_error", "响应无法解析", response.status);
  }

  if (!payload.ok) {
    throw new ApiError(
      payload.error.code,
      payload.error.message || "请求失败",
      response.status,
      payload.error.details,
    );
  }

  return payload.data;
}

export const api = {
  request,
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "POST", body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "PATCH", body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "DELETE" }),
};
