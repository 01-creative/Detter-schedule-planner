import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, ResolvedDeps } from "../env";
import { ApiError } from "../lib/errors";
import { ok, readJson } from "../lib/respond";
import { currentAuth, requireScope } from "../auth/middleware";
import { buildNotifierContext } from "../services/reminders/runtime";
import { webpushNotifier } from "../services/reminders/notifiers";
import { isAllowedPushEndpoint, parseSubscriptionJson } from "../services/reminders/webpush/send";
import { parseSubscriptionKeys } from "../services/reminders/webpush/encrypt";
import { parseVapidCredentials } from "../services/reminders/webpush/vapid";
import type { ReminderPayload } from "../services/reminders/types";

/**
 * Web Push 订阅管理（T14 §3.2）。
 *
 *   GET    /push/public-key   前端 subscribe() 需要的 applicationServerKey
 *   POST   /push/subscribe    存到 devices.push_subscription（一台设备一条）
 *   DELETE /push/subscribe    关闭推送时清掉
 *   POST   /push/test         给所有已订阅设备发一条测试推送
 *
 * 安全（05-SECURITY.md §2 资产表）：
 * - endpoint 必须是 https，且域名在白名单内——服务端会主动向它发 POST，
 *   不加白名单等于开了一个 SSRF 出口；
 * - endpoint 本身是敏感信息（含订阅 token），不写日志、不在列表接口回显。
 */

const SubscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
  deviceId: z.string().min(1).max(100).optional(),
});

const DeviceIdSchema = z.object({
  deviceId: z.string().min(1).max(100).optional(),
});

function resolveDeviceId(authDeviceId: string | null, requested: string | undefined): string {
  const deviceId = requested ?? authDeviceId;
  if (!deviceId) {
    throw ApiError.validation("无法确定设备：请带上 deviceId，或使用浏览器会话登录", {
      hint: "API Key 没有绑定设备，必须在请求体里显式传 deviceId。",
    });
  }
  return deviceId;
}

function endpointHostname(endpoint: string | undefined): string | null {
  if (!endpoint) return null;
  try {
    return new URL(endpoint).hostname;
  } catch {
    return null;
  }
}

export function pushRoutes(deps: ResolvedDeps): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get("/push/public-key", requireScope("read"), async (c) => {
    const vapid = parseVapidCredentials(deps.push.vapid);
    if (!vapid) {
      return ok(c, { enabled: false, publicKey: null, subject: null });
    }
    return ok(c, { enabled: true, publicKey: vapid.publicKeyBase64, subject: vapid.subject });
  });

  router.post("/push/subscribe", requireScope("write"), async (c) => {
    const auth = currentAuth(c);
    const body = SubscribeSchema.parse(await readJson(c));
    const deviceId = resolveDeviceId(auth.deviceId, body.deviceId);

    if (!isAllowedPushEndpoint(body.endpoint, deps.push.endpointAllowlist)) {
      throw ApiError.validation("推送 endpoint 不合法：必须是 https 且属于受支持的推送服务", {
        hint: "允许 Google / Mozilla / Microsoft / Apple 的推送域名；自建服务请设置 PUSH_ENDPOINT_ALLOWLIST。",
      });
    }
    if (!parseSubscriptionKeys(body)) {
      throw ApiError.validation("推送订阅密钥不合法（p256dh 必须是 65 字节未压缩 P-256 公钥）");
    }

    const subscription = JSON.stringify({
      endpoint: body.endpoint,
      keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
      createdAt: deps.now(),
    });

    const result = await deps.db.run(
      "UPDATE devices SET push_subscription = ?, push_enabled = 1, last_seen_at = ? WHERE id = ? AND user_id = ?",
      [subscription, deps.now(), deviceId, auth.userId],
    );
    if (result.changes === 0) {
      throw new ApiError("not_found", "设备不存在，请重新登录后再试", { deviceId });
    }
    return ok(c, { subscribed: true, deviceId });
  });

  router.delete("/push/subscribe", requireScope("write"), async (c) => {
    const auth = currentAuth(c);
    const body = DeviceIdSchema.parse(await readJson(c).catch(() => ({})));
    const deviceId = resolveDeviceId(auth.deviceId, body.deviceId);

    const result = await deps.db.run(
      "UPDATE devices SET push_subscription = NULL, push_enabled = 0 WHERE id = ? AND user_id = ?",
      [deviceId, auth.userId],
    );
    return ok(c, { subscribed: false, deviceId, updated: result.changes });
  });

  router.get("/push/status", requireScope("read"), async (c) => {
    const auth = currentAuth(c);
    const rows = await deps.db.all<{ id: string; name: string; push_enabled: number; push_subscription: string | null }>(
      "SELECT id, name, push_enabled, push_subscription FROM devices WHERE user_id = ? ORDER BY created_at ASC",
      [auth.userId],
    );
    return ok(c, {
      devices: rows.map((row) => {
        const parsed = parseSubscriptionJson(row.push_subscription);
        return {
          id: row.id,
          name: row.name,
          pushEnabled: Number(row.push_enabled) === 1 && parsed !== null,
          // 只给域名，不给完整 endpoint（endpoint 里的 token 等同于推送凭据）
          endpointHost: parsed ? endpointHostname(parsed.endpoint) : null,
        };
      }),
    });
  });

  router.post("/push/test", requireScope("write"), async (c) => {
    const auth = currentAuth(c);
    const context = await buildNotifierContext({
      db: deps.db,
      userId: auth.userId,
      now: deps.now(),
      vapidCredentials: deps.push.vapid,
      fetch: deps.push.fetch,
      endpointAllowlist: deps.push.endpointAllowlist,
    });

    const now = deps.now();
    const payload: ReminderPayload = {
      reminderId: `test-push-${now}`,
      taskId: "",
      title: "Detter 测试推送",
      body: "收到这条系统通知，说明 Web Push 在这台设备上是通的。",
      url: "/settings",
      tag: `detter-test-${now}`,
      fireAt: now,
    };

    const result = await webpushNotifier.send(payload, context);
    return ok(c, { ok: result.ok, error: result.error ?? null });
  });

  return router;
}
