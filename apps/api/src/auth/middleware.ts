import type { Context, MiddlewareHandler } from "hono";
import type { ApiScope } from "@detter/shared";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppConfig, AppEnv, AuthContext } from "../env";
import type { Db } from "../db/types";
import { ApiError, CSRF_HEADER } from "../lib/errors";
import { authenticateApiKey } from "./apikey";
import { findSession, SESSION_TTL_MS } from "./session";

/**
 * 鉴权中间件。
 *
 * 身份上下文 / Hono 上下文类型定义在 env.ts：路由和测试都只需要 import 一个地方，
 * 也避免 env ↔ middleware 的循环依赖。
 */

export interface AuthDeps {
  db: Db;
  config: AppConfig;
  now: () => number;
}

/** scope 是包含关系：admin ⊃ write ⊃ read。写操作的人当然能读，反之不行。 */
const SCOPE_RANK: Record<ApiScope, number> = { read: 1, write: 2, admin: 3 };
const ALL_SCOPES: ApiScope[] = ["read", "write", "admin"];

export function hasScope(granted: ApiScope[], required: ApiScope): boolean {
  const need = SCOPE_RANK[required];
  return granted.some((scope) => SCOPE_RANK[scope] >= need);
}

export function bearerToken(c: Context): string | null {
  const header = c.req.header("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? (match[1] as string).trim() : null;
}

/** 解析请求身份；不抛错，未认证返回 null（/auth/status 需要这个语义）。 */
export async function resolveAuth(c: Context, deps: AuthDeps): Promise<AuthContext | null> {
  const token = bearerToken(c);
  if (token) {
    const apiKey = await authenticateApiKey(deps.db, token, deps.now());
    if (!apiKey) return null;
    return {
      userId: apiKey.userId,
      deviceId: null,
      via: "apikey",
      scopes: apiKey.scopes,
      sessionId: null,
      apiKeyId: apiKey.apiKeyId,
    };
  }

  const cookie = getCookie(c, deps.config.cookieName);
  if (!cookie) return null;

  const session = await findSession(deps.db, cookie, deps.now());
  if (!session) return null;
  return {
    userId: session.userId,
    deviceId: session.deviceId,
    via: "cookie",
    scopes: ALL_SCOPES,
    sessionId: session.id,
    apiKeyId: null,
  };
}

function isSafeMethod(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

/**
 * CSRF 防护（安全文档 §2.3）。
 *
 * 只约束「带 Cookie 会话的非安全方法」：
 *  - API Key 请求不携带 Cookie，天然不受 CSRF 影响，直接放行（仍需通过 requireAuth）；
 *  - 没有会话 Cookie 的请求（setup/login）由各自路由处理，这里不拦。
 */
export function csrfGuard(config: AppConfig): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (isSafeMethod(c.req.method.toUpperCase())) return next();
    if (bearerToken(c)) return next();

    const cookie = getCookie(c, config.cookieName);
    if (!cookie) return next();

    if (c.req.header(CSRF_HEADER) !== "1") {
      throw new ApiError("csrf_failed", `缺少 ${CSRF_HEADER}: 1 请求头`);
    }

    const origin = c.req.header("origin");
    if (origin && !config.allowedOrigins.includes(origin)) {
      throw new ApiError("csrf_failed", "Origin 不在允许列表内", { origin });
    }

    return next();
  };
}

export function requireAuth(deps: AuthDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = await resolveAuth(c, deps);
    if (!auth) {
      // 带 Bearer 却解析失败 → 密钥无效；不带 → 没登录。两种都是 401，但提示要能区分。
      throw new ApiError("unauthorized", bearerToken(c) ? "API Key 无效或已过期" : "需要登录");
    }
    c.set("auth", auth);
    return next();
  };
}

export function requireScope(scope: ApiScope): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = c.get("auth");
    if (!auth) throw ApiError.unauthorized();
    if (!hasScope(auth.scopes, scope)) {
      throw new ApiError("scope_insufficient", `该凭据缺少 ${scope} 权限`, {
        required: scope,
        granted: auth.scopes,
      });
    }
    return next();
  };
}

export function currentAuth(c: Context): AuthContext {
  const auth = c.get("auth");
  if (!auth) throw ApiError.unauthorized();
  return auth;
}

/**
 * 下发会话 Cookie。
 * 生产用 __Host- 前缀 + Secure + Path=/（浏览器强制校验，能挡住子域注入 Cookie）。
 */
export function setSessionCookie(c: Context, config: AppConfig, token: string): void {
  setCookie(c, config.cookieName, token, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "Lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearSessionCookie(c: Context, config: AppConfig): void {
  deleteCookie(c, config.cookieName, {
    path: "/",
    secure: config.secureCookies,
    sameSite: "Lax",
  });
}
