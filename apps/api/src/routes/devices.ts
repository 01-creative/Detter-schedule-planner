import { Hono } from "hono";
import { z } from "zod";
import type { Device } from "@detter/shared";
import type { AppEnv, ResolvedDeps } from "../env";
import { ApiError } from "../lib/errors";
import { ok, readJson } from "../lib/respond";
import { currentAuth, requireScope } from "../auth/middleware";
import { revokeSessionsForDevice } from "../auth/session";

/**
 * 设备管理。
 *
 * 「吊销设备」= 撤销该设备的全部会话并删掉设备记录（推送订阅一并清空）。
 * 不物理删除任何日程数据：设备只是个访问入口，数据属于用户。
 */
const RenameDeviceSchema = z.object({ name: z.string().min(1).max(80) });

interface DeviceRow {
  id: string;
  name: string;
  platform: string;
  created_at: number;
  last_seen_at: number | null;
}

export function deviceRoutes(deps: ResolvedDeps): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get("/devices", requireScope("read"), async (c) => {
    const auth = currentAuth(c);
    const rows = await deps.db.all<DeviceRow>(
      "SELECT id, name, platform, created_at, last_seen_at FROM devices WHERE user_id = ? ORDER BY created_at ASC",
      [auth.userId],
    );
    const devices: Device[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      platform: row.platform,
      createdAt: Number(row.created_at),
      lastSeenAt: row.last_seen_at === null ? null : Number(row.last_seen_at),
    }));
    return ok(c, { items: devices });
  });

  router.post("/devices/:id", requireScope("admin"), async (c) => {
    const auth = currentAuth(c);
    const body = RenameDeviceSchema.parse(await readJson(c));
    const id = c.req.param("id");

    const result = await deps.db.run("UPDATE devices SET name = ? WHERE id = ? AND user_id = ?", [
      body.name,
      id,
      auth.userId,
    ]);
    if (result.changes === 0) throw ApiError.notFound("设备不存在");
    return ok(c, { id, name: body.name });
  });

  router.delete("/devices/:id", requireScope("admin"), async (c) => {
    const auth = currentAuth(c);
    const id = c.req.param("id");
    const now = deps.now();

    const existing = await deps.db.first<{ id: string }>(
      "SELECT id FROM devices WHERE id = ? AND user_id = ?",
      [id, auth.userId],
    );
    if (!existing) throw ApiError.notFound("设备不存在");

    const revokedSessions = await revokeSessionsForDevice(deps.db, auth.userId, id, now);
    await deps.db.run("DELETE FROM devices WHERE id = ? AND user_id = ?", [id, auth.userId]);

    return ok(c, { id, revokedSessions });
  });

  return router;
}
