import type { Context } from "hono";
import type { ApiErrorCode } from "@detter/shared";
import { ApiError, type JsonStatus } from "./errors";

/**
 * 统一响应信封。
 *
 * 成功 { ok: true, data }
 * 失败 { ok: false, error: { code, message, details? } }
 *
 * 所有路由都必须经由这两个函数返回，保证前端/AI 客户端只需要处理一种形状。
 */

export function ok<T>(c: Context, data: T, status: JsonStatus = 200): Response {
  return c.json({ ok: true, data }, status);
}

export function fail(
  c: Context,
  code: ApiErrorCode,
  message: string,
  details?: unknown,
  status?: JsonStatus,
): Response {
  const error: { code: ApiErrorCode; message: string; details?: unknown } = { code, message };
  if (details !== undefined) error.details = details;
  return c.json({ ok: false, error }, status ?? new ApiError(code, message).status);
}

/** 读 JSON 请求体；不是合法 JSON 就按契约返回 validation_error 而不是 500。 */
export async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw ApiError.validation("请求体必须是合法 JSON");
  }
}

/**
 * 取客户端 IP。
 *
 * Cloudflare 用 cf-connecting-ip；自托管时若挂在反向代理后面用 x-forwarded-for 的第一段。
 * 取不到就落到 "unknown"：登录限流按 "unknown" 聚合也比完全不限流安全。
 */
export function clientIp(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for");
  const candidates = [c.req.header("cf-connecting-ip"), c.req.header("x-real-ip"), forwarded?.split(",")[0]];
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value) return value;
  }
  return "unknown";
}

/** 解析查询参数里的整数，非法时返回 fallback（用于 limit 这类可以静默兜底的参数）。 */
export function queryInt(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

/** 解析可选的整数过滤值；非法返回 null，由调用方决定是忽略还是报错。 */
export function optionalInt(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}
