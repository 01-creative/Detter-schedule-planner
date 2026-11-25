import { Hono } from "hono";
import { z } from "zod";
import {
  DEFAULT_TIMEZONE,
  LoginRequestSchema,
  SetupRequestSchema,
  type ApiScope,
  type AuthStatus,
} from "@detter/shared";
import type { AppEnv, ResolvedDeps } from "../env";
import { ApiError } from "../lib/errors";
import { sha256Hex, timingSafeEqualHex } from "../lib/crypto";
import { clientIp, ok, readJson } from "../lib/respond";
import { uuidv7 } from "../lib/ids";
import {
  DUMMY_PASSWORD_RECORD,
  hashPassword,
  validatePasswordPolicy,
  verifyPassword,
} from "../auth/password";
import {
  countRecentFailures,
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_MS,
  pruneLoginAttempts,
  recordLoginAttempt,
} from "../auth/ratelimit";
import { createSession, ensureDevice, revokeOtherSessions, revokeSession } from "../auth/session";
import {
  clearSessionCookie,
  currentAuth,
  requireScope,
  resolveAuth,
  setSessionCookie,
} from "../auth/middleware";

/**
 * 鉴权路由。
 *
 * 拆成 public / private 两组：public 的路由注册在全局鉴权中间件之前，
 * private 的注册在受保护子应用里。这样「未登录也能拿 200 的 /auth/status」不会
 * 被 requireAuth 拦掉，也不需要写路由级的例外分支。
 */

const ALL_SCOPES: ApiScope[] = ["read", "write", "admin"];

const PasswordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(10).max(200),
});

interface UserRow {
  id: string;
  display_name: string;
  password_hash: string;
  password_salt: string;
  iterations: number;
  timezone: string;
}

function buildAuthStatus(
  deps: ResolvedDeps,
  input: {
    initialized: boolean;
    authenticated: boolean;
    deviceId: string | null;
    scopes: ApiScope[];
  },
): AuthStatus {
  return {
    initialized: input.initialized,
    authenticated: input.authenticated,
    deviceId: input.deviceId,
    scopes: input.scopes,
    serverTime: deps.now(),
    version: deps.config.version,
  };
}

async function countUsers(deps: ResolvedDeps): Promise<number> {
  const row = await deps.db.first<{ count: number }>("SELECT COUNT(*) AS count FROM users");
  return Number(row?.count ?? 0);
}

async function firstUser(deps: ResolvedDeps): Promise<UserRow | null> {
  return deps.db.first<UserRow>(
    "SELECT id, display_name, password_hash, password_salt, iterations, timezone FROM users ORDER BY created_at ASC LIMIT 1",
  );
}

/**
 * 初始化口令比对：先各自 sha256 再常数时间比较。
 * 直接比原文会让比较时间随首个不同字符的位置变化，理论上可被逐字节试探。
 */
async function setupTokenMatches(provided: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256Hex(provided), sha256Hex(expected)]);
  return timingSafeEqualHex(a, b);
}

export function authPublicRoutes(deps: ResolvedDeps): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.post("/auth/setup", async (c) => {
    const body = SetupRequestSchema.parse(await readJson(c));

    if ((await countUsers(deps)) > 0) {
      throw new ApiError("already_initialized", "已经初始化过，请直接登录");
    }
    if (!deps.config.setupToken) {
      throw new ApiError("not_configured", "服务端未配置 SETUP_TOKEN，无法初始化");
    }
    if (!(await setupTokenMatches(body.setupToken, deps.config.setupToken))) {
      throw new ApiError("forbidden", "初始化口令不正确");
    }

    const policyError = validatePasswordPolicy(body.password);
    if (policyError) throw ApiError.validation(policyError, { field: "password" });

    const now = deps.now();
    const password = await hashPassword(body.password);
    const userId = uuidv7(now);

    await deps.db.run(
      `INSERT INTO users (id, display_name, password_hash, password_salt, iterations, timezone, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, "我", password.hash, password.salt, password.iterations, DEFAULT_TIMEZONE, now],
    );

    const deviceId = await ensureDevice(deps.db, { userId, name: body.deviceName, now });
    const session = await createSession(deps.db, {
      userId,
      deviceId,
      userAgent: c.req.header("user-agent") ?? "",
      ip: clientIp(c),
      now,
    });
    setSessionCookie(c, deps.config, session.token);

    return ok(
      c,
      buildAuthStatus(deps, { initialized: true, authenticated: true, deviceId, scopes: ALL_SCOPES }),
      201,
    );
  });

  router.post("/auth/login", async (c) => {
    const body = LoginRequestSchema.parse(await readJson(c));
    const now = deps.now();
    const ip = clientIp(c);

    await pruneLoginAttempts(deps.db, now);
    const failures = await countRecentFailures(deps.db, ip, now);
    if (failures >= LOGIN_MAX_FAILURES) {
      throw new ApiError("rate_limited", "登录失败次数过多，请 15 分钟后再试", {
        windowMs: LOGIN_WINDOW_MS,
        failures,
      });
    }

    const user = await firstUser(deps);
    // 用户不存在时也跑一次等价开销的 PBKDF2，避免靠响应时间探测账号是否存在
    const passwordOk = user
      ? await verifyPassword(body.password, {
          hash: user.password_hash,
          salt: user.password_salt,
          iterations: Number(user.iterations),
        })
      : await verifyPassword(body.password, DUMMY_PASSWORD_RECORD);

    await recordLoginAttempt(deps.db, ip, now, Boolean(user) && passwordOk);

    if (!user || !passwordOk) {
      // 统一 401：不区分「没初始化」与「密码错」，避免给攻击者多余信息
      throw new ApiError("unauthorized", "密码不正确");
    }

    const deviceId = await ensureDevice(deps.db, { userId: user.id, name: body.deviceName, now });
    const session = await createSession(deps.db, {
      userId: user.id,
      deviceId,
      userAgent: c.req.header("user-agent") ?? "",
      ip,
      now,
    });
    setSessionCookie(c, deps.config, session.token);

    return ok(
      c,
      buildAuthStatus(deps, { initialized: true, authenticated: true, deviceId, scopes: ALL_SCOPES }),
    );
  });

  router.get("/auth/status", async (c) => {
    const initialized = (await countUsers(deps)) > 0;
    const auth = await resolveAuth(c, deps);
    return ok(
      c,
      buildAuthStatus(deps, {
        initialized,
        authenticated: Boolean(auth),
        deviceId: auth?.deviceId ?? null,
        scopes: auth?.scopes ?? [],
      }),
    );
  });

  return router;
}

export function authPrivateRoutes(deps: ResolvedDeps): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get("/auth/me", requireScope("read"), async (c) => {
    const auth = currentAuth(c);
    const user = await deps.db.first<{ id: string; display_name: string; timezone: string }>(
      "SELECT id, display_name, timezone FROM users WHERE id = ?",
      [auth.userId],
    );
    const devices = await deps.db.first<{ count: number }>(
      "SELECT COUNT(*) AS count FROM devices WHERE user_id = ?",
      [auth.userId],
    );
    return ok(c, {
      user: {
        id: user?.id ?? auth.userId,
        displayName: user?.display_name ?? "",
        timezone: user?.timezone ?? DEFAULT_TIMEZONE,
      },
      devices: Number(devices?.count ?? 0),
    });
  });

  router.post("/auth/logout", async (c) => {
    const now = deps.now();
    const auth = c.get("auth");
    if (auth?.sessionId) await revokeSession(deps.db, auth.sessionId, now);
    clearSessionCookie(c, deps.config);
    return ok(c, { loggedOut: true });
  });

  router.patch("/auth/password", requireScope("admin"), async (c) => {
    const body = PasswordChangeSchema.parse(await readJson(c));
    const auth = currentAuth(c);
    const now = deps.now();

    const user = await firstUser(deps);
    if (!user) throw ApiError.unauthorized();

    const currentOk = await verifyPassword(body.currentPassword, {
      hash: user.password_hash,
      salt: user.password_salt,
      iterations: Number(user.iterations),
    });
    if (!currentOk) throw new ApiError("unauthorized", "当前密码不正确");

    const policyError = validatePasswordPolicy(body.newPassword);
    if (policyError) throw ApiError.validation(policyError, { field: "newPassword" });

    const next = await hashPassword(body.newPassword);
    await deps.db.run(
      "UPDATE users SET password_hash = ?, password_salt = ?, iterations = ? WHERE id = ?",
      [next.hash, next.salt, next.iterations, user.id],
    );

    // 改密码 = 所有旧会话失效；当前这台设备换发新会话，用户不会被自己踢下线
    await revokeOtherSessions(deps.db, user.id, auth.sessionId, now);
    if (auth.sessionId) await revokeSession(deps.db, auth.sessionId, now);

    const deviceId =
      auth.deviceId ??
      (await ensureDevice(deps.db, { userId: user.id, name: "当前设备", now }));
    const session = await createSession(deps.db, {
      userId: user.id,
      deviceId,
      userAgent: c.req.header("user-agent") ?? "",
      ip: clientIp(c),
      now,
    });
    setSessionCookie(c, deps.config, session.token);

    return ok(
      c,
      buildAuthStatus(deps, { initialized: true, authenticated: true, deviceId, scopes: ALL_SCOPES }),
    );
  });

  return router;
}
