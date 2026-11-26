import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import type { ApiErrorCode } from "@detter/shared";
import type { AppDeps, AppEnv, ResolvedDeps } from "./env";
import { ApiError, type JsonStatus } from "./lib/errors";
import { fail } from "./lib/respond";
import { uuidv7 } from "./lib/ids";
import { csrfGuard, requireAuth } from "./auth/middleware";
import { healthRoutes } from "./routes/health";
import { authPrivateRoutes, authPublicRoutes } from "./routes/auth";
import { syncRoutes } from "./routes/sync";
import { crudRoutes } from "./routes/crud";
import { deviceRoutes } from "./routes/devices";
import { settingsRoutes } from "./routes/settings";
import { apiKeyRoutes } from "./routes/apikeys";
import { contextRoutes } from "./routes/context";
import { mcpRoutes } from "./routes/mcp";
import { exportRoutes } from "./routes/export";
import { reminderRoutes } from "./routes/reminders";
import { pushRoutes } from "./routes/push";
import { calendarRoutes } from "./routes/calendar";

/** 请求体上限：安全文档要求 1MB（同步批次最多 500 个 op）。 */
export const MAX_BODY_BYTES = 1024 * 1024;

function requestId(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const id = c.req.header("x-request-id") ?? uuidv7();
    c.set("requestId", id);
    c.set("startedAt", Date.now());
    c.header("x-request-id", id);
    await next();
  };
}

/**
 * 只在出错时记日志（成功请求不写日志：单用户产品，日志噪音没有价值，隐私风险反而更大）。
 * 记录内容遵循安全文档 §2.11：不记 Cookie / Authorization / payload。
 */
function errorLogger(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    const status = c.res.status;
    if (status < 400) return;
    const entry = {
      requestId: c.get("requestId"),
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status,
      ms: Date.now() - (c.get("startedAt") ?? Date.now()),
    };
    const line = JSON.stringify(entry);
    if (status >= 500) console.error(line);
    else console.warn(line);
  };
}

function statusToCode(status: number): ApiErrorCode {
  switch (status) {
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 413:
      return "payload_too_large";
    case 415:
      return "unsupported_media_type";
    case 429:
      return "rate_limited";
    default:
      return "internal_error";
  }
}

/**
 * 组装应用。
 *
 * 依赖全部由参数注入（db / config / runtime / now），所以这个函数本身没有任何运行时假设：
 * Workers 入口塞 D1，Node 入口塞 node:sqlite，测试塞 :memory:。
 */
export function createApp(deps: AppDeps): Hono<AppEnv> {
  const resolved: ResolvedDeps = {
    db: deps.db,
    config: deps.config,
    runtime: deps.runtime,
    now: deps.now ?? (() => Date.now()),
    push: {
      vapid: deps.push?.vapid ?? null,
      fetch: deps.push?.fetch ?? ((input, init) => fetch(input, init)),
      endpointAllowlist: deps.push?.endpointAllowlist ?? [],
    },
  };

  const app = new Hono<AppEnv>();

  app.use("*", requestId());
  app.use("*", errorLogger());
  app.use(
    "*",
    cors({
      origin: (origin) => (resolved.config.allowedOrigins.includes(origin) ? origin : null),
      allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["content-type", "authorization", "x-detter-csrf", "x-request-id", "x-detter-device"],
      exposeHeaders: ["x-request-id"],
      credentials: true,
      maxAge: 86_400,
    }),
  );
  app.use(
    "*",
    secureHeaders({
      // API 只返回 JSON，画面由前端负责；这里给最保守的 CSP
      contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      crossOriginResourcePolicy: "same-origin",
      crossOriginOpenerPolicy: "same-origin",
      referrerPolicy: "no-referrer",
      permissionsPolicy: { geolocation: [], microphone: [], camera: [] },
    }),
  );
  app.use(
    "*",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => fail(c, "payload_too_large", `请求体超过 ${MAX_BODY_BYTES} 字节`),
    }),
  );

  // 公开路由：健康检查 + 未登录也要能拿 200 的鉴权状态/初始化/登录
  app.route("/api/v1", healthRoutes(resolved));
  app.route("/api/v1", authPublicRoutes(resolved));
  // 日历订阅（T14）：系统日历不带 Cookie，用 URL 里的随机 token 鉴权
  app.route("/api/v1", calendarRoutes(resolved));

  // 受保护路由：先 CSRF 再鉴权，最后按端点声明所需 scope
  const protectedApi = new Hono<AppEnv>();
  protectedApi.use("*", csrfGuard(resolved.config));
  protectedApi.use("*", requireAuth(resolved));
  protectedApi.route("/", authPrivateRoutes(resolved));
  protectedApi.route("/", syncRoutes(resolved));
  protectedApi.route("/", deviceRoutes(resolved));
  protectedApi.route("/", settingsRoutes(resolved));
  protectedApi.route("/", apiKeyRoutes(resolved));
  protectedApi.route("/", contextRoutes(resolved));
  protectedApi.route("/", mcpRoutes(resolved));
  protectedApi.route("/", exportRoutes(resolved));
  protectedApi.route("/", reminderRoutes(resolved));
  protectedApi.route("/", pushRoutes(resolved));
  // 通用 CRUD 放最后：/:collection 会吞掉任何未匹配的单段路径
  protectedApi.route("/", crudRoutes(resolved));
  app.route("/api/v1", protectedApi);

  app.notFound((c) => fail(c, "not_found", `未找到 ${c.req.method} ${new URL(c.req.url).pathname}`));

  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return fail(c, error.code, error.message, error.details, error.status);
    }

    if (error instanceof ZodError) {
      return fail(c, "validation_error", "请求参数不合法", {
        issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
    }

    if (error instanceof HTTPException) {
      const status = error.status as JsonStatus;
      return fail(c, statusToCode(error.status), error.message || "请求失败", undefined, status);
    }

    // 未捕获异常：日志里留全量信息，响应里不泄露堆栈（安全文档 §2.11）
    console.error(
      JSON.stringify({
        requestId: c.get("requestId"),
        method: c.req.method,
        path: new URL(c.req.url).pathname,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      }),
    );
    return fail(c, "internal_error", "服务器内部错误");
  });

  return app;
}
