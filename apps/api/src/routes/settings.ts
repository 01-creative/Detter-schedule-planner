import { Hono } from "hono";
import type { AppEnv, ResolvedDeps } from "../env";
import { ApiError } from "../lib/errors";
import { ok, readJson } from "../lib/respond";
import { currentAuth, requireScope } from "../auth/middleware";
import { createEntity, updateEntity } from "../repo/crud";

/**
 * 设置：对外是 `Record<string, unknown>`，对内仍然是 setting 实体（按 key 存一行）。
 *
 * 为什么要落成实体而不是一张 KV 表：设置也要跨设备同步、也要能离线改，
 * 走同一条 changes 日志才不用额外发明一套同步机制。
 */

interface SettingRow {
  id: string;
  payload: string;
}

export function settingsRoutes(deps: ResolvedDeps): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get("/settings", requireScope("read"), async (c) => {
    const auth = currentAuth(c);
    const rows = await deps.db.all<SettingRow>(
      "SELECT id, payload FROM settings WHERE user_id = ? AND deleted_at IS NULL ORDER BY key ASC",
      [auth.userId],
    );

    const settings: Record<string, unknown> = {};
    for (const row of rows) {
      const payload = JSON.parse(row.payload) as { key?: unknown; value?: unknown };
      if (typeof payload.key === "string") settings[payload.key] = payload.value ?? null;
    }
    return ok(c, settings);
  });

  router.put("/settings", requireScope("write"), async (c) => {
    const auth = currentAuth(c);
    const body = await readJson(c);
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw ApiError.validation("设置必须是 key → value 的对象");
    }

    const now = deps.now();
    const entries = Object.entries(body as Record<string, unknown>);
    if (entries.length > 200) {
      throw ApiError.validation("一次最多写入 200 个设置项", { count: entries.length });
    }

    for (const [key, value] of entries) {
      const existing = await deps.db.first<{ id: string }>(
        "SELECT id FROM settings WHERE user_id = ? AND key = ?",
        [auth.userId, key],
      );

      if (existing) {
        // includeDeleted：同名 key 之前被软删过（唯一索引仍在），PUT 的语义是「重新生效」而不是报冲突
        await updateEntity(deps.db, "setting", auth.userId, existing.id, { key, value }, now, {
          includeDeleted: true,
        });
      } else {
        await createEntity(deps.db, "setting", auth.userId, {
          input: { key, value },
          deviceId: auth.deviceId ?? "",
          now,
        });
      }
    }

    return ok(c, { saved: entries.length });
  });

  return router;
}
