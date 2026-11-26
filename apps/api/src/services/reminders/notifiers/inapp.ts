import { uuidv7 } from "../../../lib/ids";
import type { Db } from "../../../db/types";
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

export interface InappNotificationInput {
  /** 幂等键：对应 reminders.id，或课程遗漏提醒的 `homework-digest:<week>` */
  reminderId: string;
  taskId?: string | null;
  title: string;
  body: string;
  url: string;
}

/**
 * 单独导出写入函数：课程遗漏提醒（每周一次的汇总通知）不是由 reminders 表驱动的，
 * 但它需要完全相同的幂等语义，所以复用这一处 SQL，而不是在别处再写一遍。
 */
export async function writeInappNotification(
  db: Db,
  userId: string,
  now: number,
  input: InappNotificationInput,
): Promise<void> {
  await db.run(
    `INSERT OR IGNORE INTO notifications
       (id, user_id, reminder_id, task_id, title, body, url, channel, read_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'inapp', NULL, ?)`,
    [
      uuidv7(now),
      userId,
      input.reminderId,
      input.taskId ?? "",
      input.title,
      input.body,
      input.url,
      now,
    ],
  );
}

export const inappNotifier: Notifier = {
  id: "inapp",
  async send(payload, ctx) {
    await writeInappNotification(ctx.db, ctx.userId, ctx.now, payload);
    return { ok: true };
  },
};
