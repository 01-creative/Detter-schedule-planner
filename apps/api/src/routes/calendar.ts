import { Hono } from "hono";
import type { AppEnv, ResolvedDeps } from "../env";
import { buildIcs, loadIcsTasks } from "./export";
import { REMINDER_SETTING_KEYS } from "../services/reminders/config";
import { fail } from "../lib/respond";

/**
 * 日历订阅（ICS）的公开入口 —— 「比 Web Push 更可靠的那条路」。
 *
 * 系统日历（iOS/macOS 日历、Android 日历、Google Calendar、Outlook）拉取订阅地址时
 * 不会带 Cookie，也不支持自定义请求头，所以 /export/ics 的会话鉴权对它没用。
 * 这里用一条单独的、可随时吊销的随机 token（存在 settings 里）来鉴权：
 *
 *   GET /api/v1/calendar/ics?token=<32 字节随机串>
 *
 * 它返回和 /export/ics 完全相同的日历内容，只是 Content-Disposition 用 inline，
 * 方便日历客户端直接读取。token 是「秘密地址」模型：泄露了就在设置页重置。
 *
 * 注意：这条路由必须在 protected 路由之前注册，且不能挂 requireAuth——
 * 系统日历不会带我们的 Cookie。
 */
export function calendarRoutes(deps: ResolvedDeps): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get("/calendar/ics", async (c) => {
    const token = (c.req.query("token") ?? "").trim();
    if (token.length < 32 || !/^[A-Za-z0-9_-]+$/.test(token)) {
      return fail(c, "unauthorized", "日历订阅链接无效", undefined, 401);
    }

    // 常量时间的意义有限（这是随机 256 位 token，不是用户密码），
    // 但用 SQL 精确匹配至少不会把 token 写进日志。
    const row = await deps.db.first<{ user_id: string }>(
      "SELECT user_id FROM settings WHERE key = ? AND deleted_at IS NULL AND json_extract(payload, '$.value') = ?",
      [REMINDER_SETTING_KEYS.calendarToken, token],
    );
    if (!row) {
      return fail(c, "unauthorized", "日历订阅链接无效或已被重置", undefined, 401);
    }

    const tasks = await loadIcsTasks(deps.db, row.user_id);
    const now = deps.now();
    return c.body(buildIcs(tasks, now), 200, {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "no-store",
      // 不要 attachment：部分日历客户端只接受 inline 的 text/calendar
      "content-disposition": 'inline; filename="detter.ics"',
    });
  });

  return router;
}
