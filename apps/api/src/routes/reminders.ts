import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, ResolvedDeps } from "../env";
import { ApiError } from "../lib/errors";
import { ok, queryInt, readJson } from "../lib/respond";
import { currentAuth, requireScope } from "../auth/middleware";
import { writeSettings } from "../repo/settings";
import {
  REMINDER_HORIZON_DAYS,
  REMINDER_MAX_ATTEMPTS,
  REMINDER_SETTING_KEYS,
  normalizeChannels,
  normalizeDefaultOffset,
  normalizeWechatProvider,
  readReminderConfig,
  toPublicConfig,
} from "../services/reminders/config";
import { runReminderTick } from "../services/reminders/schedule";
import { getNotifier } from "../services/reminders/notifiers";
import { buildNotifierContext } from "../services/reminders/runtime";
import { parseVapidCredentials } from "../services/reminders/webpush/vapid";
import { base64UrlEncode, randomBytes } from "../services/reminders/webpush/encoding";
import type { ReminderPayload } from "../services/reminders/types";

/**
 * 提醒与通知的 REST 面（T14）。
 *
 *   GET    /reminders/config            读配置（微信 token 只回一个布尔）
 *   PUT    /reminders/config            改开关 / 渠道链 / 默认提前量 / 微信 token
 *   GET    /reminders                   看调度结果（排查「为什么没提醒」的第一入口）
 *   POST   /reminders/tick              手动跑一次调度（Workers/Node 两种运行时都验证用）
 *   POST   /reminders/test              发一条测试提醒，验证渠道到底通不通
 *   GET    /reminders/notifications     inapp 通知箱（红点轮询）
 *   POST   /reminders/notifications/read 标记已读
 *   GET/POST/DELETE /reminders/calendar-link  系统日历订阅链接（ICS 兜底）
 */

const CHANNEL_VALUES = ["webpush", "wechat", "inapp"] as const;
const STATUS_VALUES = ["pending", "sent", "failed", "cancelled", "expired"] as const;

const ConfigPatchSchema = z.object({
  enabled: z.boolean().optional(),
  channels: z.array(z.enum(CHANNEL_VALUES)).max(3).optional(),
  defaultOffsetMin: z.number().int().min(0).max(60 * 24 * 30).optional(),
  wechatProvider: z.enum(["auto", "pushplus", "serverchan"]).optional(),
  /** 不传 = 保持原值；传空串 = 清除；传非空 = 覆盖 */
  wechatToken: z.string().max(500).optional(),
  clearWechatToken: z.boolean().optional(),
});

const TestSchema = z.object({
  channel: z.enum(CHANNEL_VALUES).optional(),
});

const ReadSchema = z.object({
  ids: z.array(z.string().min(1).max(100)).max(100).optional(),
  all: z.boolean().optional(),
});

interface ReminderRow {
  id: string;
  task_id: string;
  fire_at: number;
  channel: string;
  status: string;
  attempts: number;
  sent_at: number | null;
  error: string | null;
  created_at: number;
  payload: string | null;
}

interface NotificationRow {
  id: string;
  task_id: string | null;
  title: string;
  body: string;
  url: string;
  channel: string;
  read_at: number | null;
  created_at: number;
}

function vapidConfigured(deps: ResolvedDeps): boolean {
  return parseVapidCredentials(deps.push.vapid) !== null;
}

async function publicConfig(deps: ResolvedDeps, userId: string) {
  const configured = vapidConfigured(deps);
  const config = await readReminderConfig(deps.db, userId, { vapidConfigured: configured });
  return toPublicConfig(config, {
    vapidConfigured: configured,
    maxAttempts: REMINDER_MAX_ATTEMPTS,
    horizonDays: REMINDER_HORIZON_DAYS,
  });
}

function calendarPath(token: string | null): string | null {
  return token ? `/api/v1/calendar/ics?token=${encodeURIComponent(token)}` : null;
}

function taskTitle(payload: string | null): string {
  if (!payload) return "";
  try {
    const parsed = JSON.parse(payload) as { title?: unknown };
    return typeof parsed.title === "string" ? parsed.title : "";
  } catch {
    return "";
  }
}

async function notifierContext(deps: ResolvedDeps, userId: string) {
  return buildNotifierContext({
    db: deps.db,
    userId,
    now: deps.now(),
    vapidCredentials: deps.push.vapid,
    fetch: deps.push.fetch,
    endpointAllowlist: deps.push.endpointAllowlist,
  });
}

export function reminderRoutes(deps: ResolvedDeps): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  /* ------------------------------- 配置 ------------------------------- */

  router.get("/reminders/config", requireScope("read"), async (c) => {
    const auth = currentAuth(c);
    return ok(c, { ...(await publicConfig(deps, auth.userId)), tickSeconds: 60 });
  });

  router.put("/reminders/config", requireScope("write"), async (c) => {
    const auth = currentAuth(c);
    const body = ConfigPatchSchema.parse(await readJson(c));
    const values: Record<string, unknown> = {};

    if (body.enabled !== undefined) values[REMINDER_SETTING_KEYS.enabled] = body.enabled;
    if (body.channels !== undefined) {
      const channels = normalizeChannels(body.channels);
      // VAPID 没配时不允许把 webpush 写进链路：否则用户以为配好了，实际每次都被降级。
      if (channels.includes("webpush") && !vapidConfigured(deps)) {
        throw ApiError.validation("服务端未配置 VAPID 密钥，暂时不能启用浏览器推送", {
          hint: "设置 VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY 后重启服务。",
        });
      }
      values[REMINDER_SETTING_KEYS.channels] = channels;
    }
    if (body.defaultOffsetMin !== undefined) {
      values[REMINDER_SETTING_KEYS.defaultOffsetMin] = normalizeDefaultOffset(body.defaultOffsetMin);
    }
    if (body.wechatProvider !== undefined) {
      values[REMINDER_SETTING_KEYS.wechatProvider] = normalizeWechatProvider(body.wechatProvider);
    }
    if (body.clearWechatToken) {
      values[REMINDER_SETTING_KEYS.wechatToken] = "";
    } else if (body.wechatToken !== undefined) {
      const token = body.wechatToken.trim();
      if (token.length > 0 && !/^[A-Za-z0-9._~-]+$/.test(token)) {
        throw ApiError.validation("微信 token 只能是字母、数字、点、下划线、短横线");
      }
      values[REMINDER_SETTING_KEYS.wechatToken] = token;
    }

    if (Object.keys(values).length > 0) {
      await writeSettings(deps.db, auth.userId, values, deps.now(), { deviceId: auth.deviceId ?? "" });
    }

    return ok(c, await publicConfig(deps, auth.userId));
  });

  /* ------------------------------- 调度 ------------------------------- */

  router.get("/reminders", requireScope("read"), async (c) => {
    const auth = currentAuth(c);
    const status = c.req.query("status") ?? "";
    if (status !== "" && !(STATUS_VALUES as readonly string[]).includes(status)) {
      throw ApiError.validation("status 取值不合法", { allowed: STATUS_VALUES });
    }
    const limit = queryInt(c.req.query("limit"), 50, 1, 200);

    const conditions = ["r.user_id = ?"];
    const params: Array<string | number> = [auth.userId];
    if (status !== "") {
      conditions.push("r.status = ?");
      params.push(status);
    }
    params.push(limit);

    const rows = await deps.db.all<ReminderRow>(
      `SELECT r.id, r.task_id, r.fire_at, r.channel, r.status, r.attempts,
              r.sent_at, r.error, r.created_at, t.payload
         FROM reminders r
         LEFT JOIN tasks t ON t.id = r.task_id AND t.user_id = r.user_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY r.fire_at DESC, r.created_at DESC
        LIMIT ?`,
      params,
    );

    return ok(c, {
      items: rows.map((row) => ({
        id: row.id,
        taskId: row.task_id,
        taskTitle: taskTitle(row.payload),
        fireAt: Number(row.fire_at),
        channel: row.channel,
        status: row.status,
        attempts: Number(row.attempts),
        sentAt: row.sent_at === null ? null : Number(row.sent_at),
        error: row.error,
        createdAt: Number(row.created_at),
      })),
    });
  });

  router.post("/reminders/tick", requireScope("admin"), async (c) => {
    const auth = currentAuth(c);
    const summary = await runReminderTick(deps.db, deps.now(), {
      vapid: deps.push.vapid,
      fetch: deps.push.fetch,
      pushEndpointAllowlist: deps.push.endpointAllowlist,
      userId: auth.userId,
    });
    return ok(c, summary);
  });

  router.post("/reminders/test", requireScope("write"), async (c) => {
    const auth = currentAuth(c);
    const body = TestSchema.parse(await readJson(c));
    const context = await notifierContext(deps, auth.userId);
    const channel = body.channel ?? context.config.channels[0] ?? "inapp";
    const notifier = getNotifier(channel);
    if (!notifier) throw ApiError.validation(`渠道未实现：${channel}`);

    const now = deps.now();
    const payload: ReminderPayload = {
      reminderId: `test-${now}`,
      taskId: "",
      title: "Detter 测试提醒",
      body: "如果你看到这条消息，说明这个渠道是通的。",
      url: "/settings",
      tag: `detter-test-${now}`,
      fireAt: now,
    };

    const result = await notifier.send(payload, { ...context, userId: auth.userId, now });
    return ok(c, { channel, ok: result.ok, error: result.error ?? null });
  });

  /* ----------------------------- 通知箱 ------------------------------ */

  router.get("/reminders/notifications", requireScope("read"), async (c) => {
    const auth = currentAuth(c);
    const limit = queryInt(c.req.query("limit"), 20, 1, 100);
    const unreadOnly = c.req.query("unreadOnly") === "1" || c.req.query("unreadOnly") === "true";

    const conditions = ["user_id = ?"];
    if (unreadOnly) conditions.push("read_at IS NULL");

    const [rows, unread] = await Promise.all([
      deps.db.all<NotificationRow>(
        `SELECT id, task_id, title, body, url, channel, read_at, created_at
           FROM notifications WHERE ${conditions.join(" AND ")}
          ORDER BY created_at DESC LIMIT ?`,
        [auth.userId, limit],
      ),
      deps.db.first<{ count: number }>(
        "SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL",
        [auth.userId],
      ),
    ]);

    return ok(c, {
      items: rows.map((row) => ({
        id: row.id,
        taskId: row.task_id,
        title: row.title,
        body: row.body,
        url: row.url,
        channel: row.channel,
        readAt: row.read_at === null ? null : Number(row.read_at),
        createdAt: Number(row.created_at),
      })),
      unreadCount: Number(unread?.count ?? 0),
    });
  });

  router.post("/reminders/notifications/read", requireScope("write"), async (c) => {
    const auth = currentAuth(c);
    const body = ReadSchema.parse(await readJson(c));
    const now = deps.now();

    if (body.all) {
      const result = await deps.db.run(
        "UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL",
        [now, auth.userId],
      );
      return ok(c, { updated: result.changes });
    }

    const ids = body.ids ?? [];
    if (ids.length === 0) throw ApiError.validation("ids 或 all 至少给一个");
    const placeholders = ids.map(() => "?").join(", ");
    const result = await deps.db.run(
      `UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (${placeholders})`,
      [now, auth.userId, ...ids],
    );
    return ok(c, { updated: result.changes });
  });

  /* --------------------------- 日历订阅（ICS） ------------------------ */

  router.get("/reminders/calendar-link", requireScope("read"), async (c) => {
    const auth = currentAuth(c);
    const config = await readReminderConfig(deps.db, auth.userId, { vapidConfigured: false });
    return ok(c, {
      configured: config.calendarToken !== null,
      path: calendarPath(config.calendarToken),
    });
  });

  router.post("/reminders/calendar-link", requireScope("write"), async (c) => {
    const auth = currentAuth(c);
    const token = base64UrlEncode(randomBytes(32));
    await writeSettings(deps.db, auth.userId, { [REMINDER_SETTING_KEYS.calendarToken]: token }, deps.now(), {
      deviceId: auth.deviceId ?? "",
    });
    return ok(c, { configured: true, path: calendarPath(token) });
  });

  router.delete("/reminders/calendar-link", requireScope("write"), async (c) => {
    const auth = currentAuth(c);
    await writeSettings(deps.db, auth.userId, { [REMINDER_SETTING_KEYS.calendarToken]: "" }, deps.now(), {
      deviceId: auth.deviceId ?? "",
    });
    return ok(c, { configured: false, path: null });
  });

  return router;
}
