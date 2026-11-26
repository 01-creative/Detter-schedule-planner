import { api } from "@/lib/api";

/**
 * 提醒设置的前端请求层。
 *
 * 所有写操作都走 PUT /reminders/config，服务端负责校验、归一化并返回最新配置——
 * 前端不自己拼渠道顺序、不猜 token 状态，避免两套规则打架。
 */

export type ReminderChannelId = "webpush" | "wechat" | "inapp";
export type WechatProvider = "auto" | "pushplus" | "serverchan";

export interface ChannelAvailability {
  id: ReminderChannelId;
  available: boolean;
  reason?: string;
}

export interface ReminderConfig {
  enabled: boolean;
  channels: ReminderChannelId[];
  defaultOffsetMin: number;
  wechatProvider: WechatProvider;
  wechatConfigured: boolean;
  calendarConfigured: boolean;
  vapidConfigured: boolean;
  availableChannels: ChannelAvailability[];
  maxAttempts: number;
  horizonDays: number;
  tickSeconds: number;
}

export interface ReminderConfigPatch {
  enabled?: boolean;
  channels?: ReminderChannelId[];
  defaultOffsetMin?: number;
  wechatProvider?: WechatProvider;
  wechatToken?: string;
  clearWechatToken?: boolean;
}

export interface ReminderItem {
  id: string;
  taskId: string;
  taskTitle: string;
  fireAt: number;
  channel: string;
  status: "pending" | "sent" | "failed" | "cancelled" | "expired";
  attempts: number;
  sentAt: number | null;
  error: string | null;
  createdAt: number;
}

export interface NotificationItem {
  id: string;
  taskId: string | null;
  title: string;
  body: string;
  url: string;
  channel: string;
  readAt: number | null;
  createdAt: number;
}

export interface CalendarLink {
  configured: boolean;
  /** 形如 /api/v1/calendar/ics?token=...；前端自己补 origin */
  path: string | null;
}

export interface PushPublicKey {
  enabled: boolean;
  publicKey: string | null;
  subject: string | null;
}

export async function getReminderConfig(): Promise<ReminderConfig> {
  return api.get<ReminderConfig>("/reminders/config");
}

export async function saveReminderConfig(patch: ReminderConfigPatch): Promise<ReminderConfig> {
  return api.request<ReminderConfig>("/reminders/config", { method: "PUT", body: patch });
}

export async function listReminders(status?: string): Promise<ReminderItem[]> {
  const query = status ? `?status=${encodeURIComponent(status)}&limit=20` : "?limit=20";
  const data = await api.get<{ items: ReminderItem[] }>(`/reminders${query}`);
  return data.items;
}

export async function runTickNow(): Promise<Record<string, number>> {
  return api.post<Record<string, number>>("/reminders/tick");
}

export async function sendTestNotification(channel: ReminderChannelId): Promise<{
  channel: string;
  ok: boolean;
  error: string | null;
}> {
  return api.post("/reminders/test", { channel });
}

export async function listNotifications(): Promise<{
  items: NotificationItem[];
  unreadCount: number;
}> {
  return api.get("/reminders/notifications?limit=5");
}

export async function markNotificationsRead(all = true, ids?: string[]): Promise<number> {
  const data = await api.post<{ updated: number }>("/reminders/notifications/read", { all, ids });
  return data.updated;
}

export async function getCalendarLink(): Promise<CalendarLink> {
  return api.get<CalendarLink>("/reminders/calendar-link");
}

export async function createCalendarLink(): Promise<CalendarLink> {
  return api.post<CalendarLink>("/reminders/calendar-link");
}

export async function revokeCalendarLink(): Promise<CalendarLink> {
  return api.delete<CalendarLink>("/reminders/calendar-link");
}

export async function getPushPublicKey(): Promise<PushPublicKey> {
  return api.get<PushPublicKey>("/push/public-key");
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function subscribePush(input: PushSubscriptionInput): Promise<void> {
  await api.post("/push/subscribe", input);
}

export async function unsubscribePush(): Promise<void> {
  await api.request("/push/subscribe", { method: "DELETE", body: {} });
}

export async function getPushStatus(): Promise<{
  devices: Array<{ id: string; name: string; pushEnabled: boolean; endpointHost: string | null }>;
}> {
  return api.get("/push/status");
}

/** 统一把未知异常转成一句可展示的话。 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "操作失败，请稍后重试";
}
