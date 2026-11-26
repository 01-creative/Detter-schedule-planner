import { uuidv7 } from "../../../lib/ids";
import type { Notifier } from "../types";

/**
 * 应用内通知渠道：写一行 notifications，前端轮询拿红点/列表。
 *
 * 它是最可靠的渠道——不依赖任何外部服务、不依赖系统通知权限，
 * 因此所有渠道链的末尾都默认有它兜底。
 *
 * 幂等：notifications.reminder_id 上有唯一索引，INSERT OR IGNORE 保证
 * 「同一提醒点无论重试多少次，最多一条通知」。
 */
export const inappNotifier: Notifier = {
  id: "inapp",
  async send(payload, ctx) {
    await ctx.db.run(
      `INSERT OR IGNORE INTO notifications
         (id, user_id, reminder_id, task_id, title, body, url, channel, read_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'inapp', NULL, ?)`,
      [
        uuidv7(ctx.now),
        ctx.userId,
        payload.reminderId,
        payload.taskId,
        payload.title,
        payload.body,
        payload.url,
        ctx.now,
      ],
    );
    return { ok: true };
  },
};
