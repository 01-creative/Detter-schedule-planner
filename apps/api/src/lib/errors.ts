import type { ApiErrorCode } from "@detter/shared";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * 合法的 JSON 响应状态码。
 *
 * 直接复用 Hono 的 ContentfulStatusCode：c.json() 只接受有响应体的状态码，
 * 自定义联合类型会在每个 c.json 调用点引发无谓的断言。
 */
export type JsonStatus = ContentfulStatusCode;

/** 错误码 → HTTP 状态码。契约里的错误码是稳定的，HTTP 状态码是它的传输层投影。 */
export const ERROR_STATUS: Record<ApiErrorCode, JsonStatus> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation_error: 400,
  conflict: 409,
  rate_limited: 429,
  payload_too_large: 413,
  unsupported_media_type: 415,
  internal_error: 500,
  not_configured: 503,
  setup_required: 428,
  already_initialized: 409,
  csrf_failed: 403,
  scope_insufficient: 403,
};

/** 业务错误。路由层只管抛，统一由 app.onError 转成契约里的错误信封。 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: JsonStatus;
  readonly details: unknown;

  constructor(code: ApiErrorCode, message: string, details?: unknown, status?: JsonStatus) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
    this.status = status ?? ERROR_STATUS[code];
  }

  static unauthorized(message = "需要登录"): ApiError {
    return new ApiError("unauthorized", message);
  }

  static notFound(message = "资源不存在"): ApiError {
    return new ApiError("not_found", message);
  }

  static validation(message: string, details?: unknown): ApiError {
    return new ApiError("validation_error", message, details);
  }

  static conflict(message: string, details?: unknown): ApiError {
    return new ApiError("conflict", message, details);
  }
}

/** `x-detter-csrf` 请求头：跨站页面无法自定义请求头，这是 CSRF 三层防护的第三层。 */
export const CSRF_HEADER = "x-detter-csrf";
