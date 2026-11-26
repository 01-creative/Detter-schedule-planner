import type { Db } from "../../db/types";
import { readSettingValues } from "../../repo/settings";
import {
  DEFAULT_CHANNELS,
  IMPLEMENTED_CHANNELS,
  isImplementedChannel,
  type ImplementedChannel,
  type ReminderRuntimeConfig,
  type WechatProvider,
} from "./types";

/**
 * 提醒配置：全部存在 settings 表里（key → value），与其它设置走同一套同步机制。
 *
 * 为什么不做成专门的 config 表：这个产品的设置本来就少，多一张表就多一套同步/备份/迁移；
 * 而 settings 已经有 (user_id, key) 唯一索引，读写都是 O(1)。
 */

export const REMINDER_SETTING_KEYS = {
  enabled: "reminders.enabled",
  channels: "reminders.channels",
  defaultOffsetMin: "reminders.defaultOffsetMin",
  wechatProvider: "reminders.wechatProvider",
  wechatToken: "wechat.token",
  calendarToken: "reminders.calendarToken",
} as const;

export const DEFAULT_OFFSET_MIN = 5;
export const MAX_OFFSET_MIN = 60 * 24 * 30;

/** 只物化未来 7 天的提醒：再远的日程随时可能被改，提前写进库只会制造垃圾行。 */
export const REMINDER_HORIZON_DAYS = 7;

/** 同一渠道失败 2 次后降级到下一个渠道（永久失败立即降级）。 */
export const REMINDER_MAX_ATTEMPTS = 2;

const WECHAT_PROVIDERS: readonly WechatProvider[] = ["auto", "pushplus", "serverchan"];

/** 渠道去重 + 保序；未知渠道直接丢掉（向前兼容：以后加 email 时老服务端不会崩）。 */
export function normalizeChannels(raw: unknown): ImplementedChannel[] {
  if (!Array.isArray(raw)) return [...DEFAULT_CHANNELS];
  const seen = new Set<ImplementedChannel>();
  for (const item of raw) {
    if (isImplementedChannel(item)) seen.add(item);
  }
  if (seen.size === 0) return [...DEFAULT_CHANNELS];
  // 按固定优先级重排，保证「webpush → wechat → inapp」的降级顺序稳定，
  // 不受用户在 UI 上勾选顺序影响。
  return IMPLEMENTED_CHANNELS.filter((channel) => seen.has(channel));
}

export function normalizeDefaultOffset(raw: unknown): number {
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_OFFSET_MIN;
  return Math.min(MAX_OFFSET_MIN, Math.max(0, Math.trunc(value)));
}

export function normalizeWechatProvider(raw: unknown): WechatProvider {
  return typeof raw === "string" && (WECHAT_PROVIDERS as readonly string[]).includes(raw)
    ? (raw as WechatProvider)
    : "auto";
}

/** Server酱的 SendKey 形如 SCT... / sctp123t...；其余按 PushPlus（32 位十六进制）处理。 */
export function detectWechatProvider(token: string): Exclude<WechatProvider, "auto"> {
  return /^sct/i.test(token) ? "serverchan" : "pushplus";
}

export function resolveWechatProvider(configured: WechatProvider, token: string): Exclude<WechatProvider, "auto"> {
  return configured === "auto" ? detectWechatProvider(token) : configured;
}

export interface ReadConfigOptions {
  /** 服务端是否配了 VAPID 密钥；没配时 webpush 渠道不可用，直接从链路里去掉。 */
  vapidConfigured: boolean;
}

/**
 * 读配置。
 *
 * 注意两点默认值：
 * - 总开关默认 **开**：提醒是这个产品「止损的最后一道闸」，默认关掉等于没有；
 * - 渠道默认只有 inapp：不依赖任何外部服务，任何环境都能工作。
 */
export async function readReminderConfig(
  db: Db,
  userId: string,
  options: ReadConfigOptions,
): Promise<ReminderRuntimeConfig> {
  const values = await readSettingValues(db, userId, [
    REMINDER_SETTING_KEYS.enabled,
    REMINDER_SETTING_KEYS.channels,
    REMINDER_SETTING_KEYS.defaultOffsetMin,
    REMINDER_SETTING_KEYS.wechatProvider,
    REMINDER_SETTING_KEYS.wechatToken,
    REMINDER_SETTING_KEYS.calendarToken,
  ]);

  const enabled = values[REMINDER_SETTING_KEYS.enabled] !== false;
  const requested = normalizeChannels(values[REMINDER_SETTING_KEYS.channels]);
  const channels = requested.filter((channel) => channel !== "webpush" || options.vapidConfigured);
  const token = typeof values[REMINDER_SETTING_KEYS.wechatToken] === "string"
    ? (values[REMINDER_SETTING_KEYS.wechatToken] as string).trim()
    : "";
  const calendarToken = typeof values[REMINDER_SETTING_KEYS.calendarToken] === "string"
    ? (values[REMINDER_SETTING_KEYS.calendarToken] as string).trim() || null
    : null;

  return {
    enabled,
    channels: channels.length > 0 ? channels : [...DEFAULT_CHANNELS],
    defaultOffsetMin: normalizeDefaultOffset(values[REMINDER_SETTING_KEYS.defaultOffsetMin]),
    wechatProvider: normalizeWechatProvider(values[REMINDER_SETTING_KEYS.wechatProvider]),
    wechatToken: token,
    calendarToken,
  };
}

export interface PublicReminderConfig {
  enabled: boolean;
  channels: ImplementedChannel[];
  defaultOffsetMin: number;
  wechatProvider: WechatProvider;
  wechatConfigured: boolean;
  calendarConfigured: boolean;
  vapidConfigured: boolean;
  availableChannels: Array<{ id: ImplementedChannel; available: boolean; reason?: string }>;
  maxAttempts: number;
  horizonDays: number;
}

/** 对外配置：微信 token 只留一个布尔信号。 */
export function toPublicConfig(
  config: ReminderRuntimeConfig,
  options: { vapidConfigured: boolean; maxAttempts: number; horizonDays: number },
): PublicReminderConfig {
  const wechatConfigured = config.wechatToken.length > 0;
  return {
    enabled: config.enabled,
    channels: config.channels,
    defaultOffsetMin: config.defaultOffsetMin,
    wechatProvider: config.wechatProvider,
    wechatConfigured,
    calendarConfigured: config.calendarToken !== null,
    vapidConfigured: options.vapidConfigured,
    availableChannels: [
      {
        id: "inapp",
        available: true,
      },
      {
        id: "wechat",
        available: wechatConfigured,
        reason: wechatConfigured ? undefined : "还没有填 PushPlus / Server酱 token",
      },
      {
        id: "webpush",
        available: options.vapidConfigured,
        reason: options.vapidConfigured ? undefined : "服务端未配置 VAPID 密钥",
      },
    ],
    maxAttempts: options.maxAttempts,
    horizonDays: options.horizonDays,
  };
}
