import type { Db } from "../../db/types";
import { readReminderConfig } from "./config";
import { parseVapidCredentials } from "./webpush/vapid";
import type { NotifierContext, VapidCredentials } from "./types";

/**
 * 组装 Notifier 的运行上下文。
 *
 * 这里刻意不依赖 Hono / ResolvedDeps：推送渠道既被 HTTP 路由（/reminders/test）
 * 调用，也被 cron 调度调用，只有纯函数才不会把请求对象带进调度器。
 */
export interface NotifierContextInput {
  db: Db;
  userId: string;
  now: number;
  vapidCredentials: VapidCredentials | null;
  fetch: typeof fetch;
  endpointAllowlist: string[];
}

export async function buildNotifierContext(input: NotifierContextInput): Promise<NotifierContext> {
  const vapid = parseVapidCredentials(input.vapidCredentials);
  const config = await readReminderConfig(input.db, input.userId, { vapidConfigured: vapid !== null });
  const row = await input.db.first<{ timezone: string | null }>("SELECT timezone FROM users WHERE id = ?", [
    input.userId,
  ]);

  return {
    db: input.db,
    userId: input.userId,
    now: input.now,
    timezone: row?.timezone?.trim() || "Asia/Shanghai",
    config,
    vapid,
    pushEndpointAllowlist: input.endpointAllowlist,
    fetch: input.fetch,
  };
}
