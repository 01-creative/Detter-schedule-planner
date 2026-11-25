import { Hono } from "hono";
import { SyncPullQuerySchema, SyncPushRequestSchema } from "@detter/shared";
import type { SyncPushResponse } from "@detter/shared";
import type { AppEnv, ResolvedDeps } from "../env";
import { ApiError } from "../lib/errors";
import { ok, readJson } from "../lib/respond";
import { currentAuth, requireScope } from "../auth/middleware";
import { applyOps } from "../sync/engine";
import { currentCursor, pullChanges, snapshotAll } from "../sync/query";
import { touchDevice } from "../auth/session";

/**
 * 同步端点：push / pull / snapshot。
 *
 * push 的 deviceId 取自请求体（不是 Cookie）：一台设备可能同时有多个标签页/账号会话，
 * 写入来源以客户端声明的设备为准，服务端只负责把它强制写进 payload。
 */
export function syncRoutes(deps: ResolvedDeps): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.post("/sync/push", requireScope("write"), async (c) => {
    const auth = currentAuth(c);
    const body = SyncPushRequestSchema.parse(await readJson(c));
    const now = deps.now();

    const results = await applyOps(
      { db: deps.db, userId: auth.userId, deviceId: body.deviceId, now },
      body.ops,
    );

    // 顺手刷新设备活跃时间；设备行不存在时这条 UPDATE 是空操作
    await touchDevice(deps.db, auth.userId, body.deviceId, now);

    const response: SyncPushResponse = {
      results,
      cursor: await currentCursor(deps.db, auth.userId),
    };
    return ok(c, response);
  });

  router.get("/sync/pull", requireScope("read"), async (c) => {
    const auth = currentAuth(c);
    const parsed = SyncPullQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      throw ApiError.validation("sync pull 查询参数不合法", {
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
    }
    return ok(c, await pullChanges(deps.db, auth.userId, parsed.data.cursor, parsed.data.limit));
  });

  router.get("/sync/snapshot", requireScope("read"), async (c) => {
    const auth = currentAuth(c);
    return ok(c, await snapshotAll(deps.db, auth.userId, deps.now()));
  });

  return router;
}
