import type { Notifier } from "../types";
import { isAllowedPushEndpoint, parseSubscriptionJson, sendWebPush } from "../webpush/send";

/**
 * Web Push 渠道。
 *
 * 一个用户可能有多台设备/多个浏览器订阅，逐台发送：
 * - 至少一台成功 → 本次渠道成功；
 * - 404/410 → 订阅已失效，立刻清除（任务书要求）；
 * - 其余失败 → 汇总成一条错误；只有「全部都是 4xx 配置错误」才算永久失败，
 *   以免一次网络抖动就把整条渠道降级掉。
 */
interface DeviceRow {
  id: string;
  push_subscription: string;
}

async function clearSubscription(ctx: Parameters<Notifier["send"]>[1], deviceId: string): Promise<void> {
  await ctx.db.run(
    "UPDATE devices SET push_enabled = 0, push_subscription = NULL WHERE id = ? AND user_id = ?",
    [deviceId, ctx.userId],
  );
}

export const webpushNotifier: Notifier = {
  id: "webpush",
  async send(payload, ctx) {
    if (!ctx.vapid) {
      return { ok: false, permanent: true, error: "服务端未配置 VAPID 密钥" };
    }

    const devices = await ctx.db.all<DeviceRow>(
      `SELECT id, push_subscription FROM devices
        WHERE user_id = ? AND push_enabled = 1 AND push_subscription IS NOT NULL`,
      [ctx.userId],
    );
    if (devices.length === 0) {
      return { ok: false, permanent: true, error: "没有已开启推送的设备" };
    }

    const message = JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: payload.url,
      taskId: payload.taskId,
      tag: payload.tag,
    });

    let delivered = 0;
    let cleaned = 0;
    let retryable = false;
    const errors: string[] = [];

    for (const device of devices) {
      const subscription = parseSubscriptionJson(device.push_subscription);
      if (!subscription) {
        await clearSubscription(ctx, device.id);
        cleaned += 1;
        errors.push(`${device.id.slice(0, 8)}: 订阅格式损坏，已清理`);
        continue;
      }
      if (!isAllowedPushEndpoint(subscription.endpoint, ctx.pushEndpointAllowlist)) {
        await clearSubscription(ctx, device.id);
        cleaned += 1;
        errors.push(`${device.id.slice(0, 8)}: endpoint 不在白名单，已清理`);
        continue;
      }

      const result = await sendWebPush(subscription, message, {
        vapid: ctx.vapid,
        fetch: ctx.fetch,
        now: ctx.now,
      });

      if (result.ok) {
        delivered += 1;
        continue;
      }

      errors.push(`${device.id.slice(0, 8)}: ${result.error ?? `HTTP ${result.status}`}`);
      if (result.gone) {
        await clearSubscription(ctx, device.id);
        cleaned += 1;
      } else if (result.retryable !== false) {
        retryable = true;
      }
    }

    if (delivered > 0) {
      return { ok: true };
    }

    const summary = errors.join("; ").slice(0, 300);
    return {
      ok: false,
      // 全部失效（订阅被清理）也属于永久失败：没有设备可推了，继续重试只是空转
      permanent: !retryable,
      error: cleaned > 0 ? `${summary}（已清理 ${cleaned} 个失效订阅）` : summary || "推送失败",
    };
  },
};
