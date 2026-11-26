import { Hono } from "hono";
import type { AppEnv, ResolvedDeps } from "../env";
import { ApiError } from "../lib/errors";
import { ok, readJson } from "../lib/respond";
import { currentAuth, requireScope } from "../auth/middleware";
import { maskSettingValue, readSettings, writeSettings } from "../repo/settings";

/**
 * 设置：对外是 `Record<string, unknown>`，对内仍然是 setting 实体（按 key 存一行）。
 *
 * 为什么要落成实体而不是一张 KV 表：设置也要跨设备同步、也要能离线改，
 * 走同一条 changes 日志才不用额外发明一套同步机制。
 *
 * 密钥类设置（微信 token、日历订阅 token）**不回显**：GET 只返回掩码，
 * 前端据此显示「已配置 / 未配置」；PUT 时留空表示保持原值，显式传 null 才是清除。
 */

export function settingsRoutes(deps: ResolvedDeps): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get("/settings", requireScope("read"), async (c) => {
    const auth = currentAuth(c);
    const settings = await readSettings(deps.db, auth.userId);

    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(settings)) {
      masked[key] = maskSettingValue(key, value);
    }
    return ok(c, masked);
  });

  router.put("/settings", requireScope("write"), async (c) => {
    const auth = currentAuth(c);
    const body = await readJson(c);
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw ApiError.validation("设置必须是 key → value 的对象");
    }

    const entries = Object.entries(body as Record<string, unknown>);
    if (entries.length > 200) {
      throw ApiError.validation("一次最多写入 200 个设置项", { count: entries.length });
    }

    await writeSettings(deps.db, auth.userId, body as Record<string, unknown>, deps.now(), {
      deviceId: auth.deviceId ?? "",
    });

    return ok(c, { saved: entries.length });
  });

  return router;
}
