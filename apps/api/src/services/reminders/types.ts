import type { ReminderChannel } from "@detter/shared";
import type { Db } from "../../db/types";

/**
 * 提醒/推送的公共类型。
 *
 * 契约里的 ReminderChannel 有 4 个值（webpush / wechat / email / inapp），
 * v1 真正实现 3 个；email 只保留类型位，调度器不会选它（见 config.ts 的白名单）。
 */

export type ImplementedChannel = Extract<ReminderChannel, "webpush" | "wechat" | "inapp">;

/** 渠道优先级从左到右；默认链路始终有 inapp 兜底（它不依赖任何外部服务）。 */
export const IMPLEMENTED_CHANNELS: readonly ImplementedChannel[] = ["webpush", "wechat", "inapp"];

export const DEFAULT_CHANNELS: readonly ImplementedChannel[] = ["inapp"];

export function isImplementedChannel(value: unknown): value is ImplementedChannel {
  return typeof value === "string" && (IMPLEMENTED_CHANNELS as readonly string[]).includes(value);
}

export type WechatProvider = "auto" | "pushplus" | "serverchan";

export interface ReminderRuntimeConfig {
  /** 总开关；关掉后不再生成新提醒，已有的 pending 行会被取消 */
  enabled: boolean;
  /** 已生效的渠道链（按优先级，末尾一般是 inapp） */
  channels: ImplementedChannel[];
  /** 新任务默认提前量（分钟），设置页保存，供客户端建任务时读取 */
  defaultOffsetMin: number;
  wechatProvider: WechatProvider;
  /** 只在服务端使用，绝不进入响应体 */
  wechatToken: string;
  /** 日历订阅 token（可选；与微信 token 一样属于服务端密钥） */
  calendarToken: string | null;
}

export interface VapidCredentials {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** 解析并校验后的 VAPID 密钥；解析失败时整个 webpush 渠道不可用。 */
export interface VapidKeyPair {
  /** 65 字节未压缩公钥（0x04 | x | y） */
  publicKey: Uint8Array;
  /** 可以直接交给 crypto.subtle.importKey 的 JWK */
  privateKeyJwk: JsonWebKey;
  publicKeyBase64: string;
  subject: string;
}

export interface ReminderPayload {
  /** 对应 reminders.id，用于 inapp 的幂等写入与排查 */
  reminderId: string;
  taskId: string;
  title: string;
  body: string;
  /** 点击通知后打开的站内路径，例如 /?task=<id> */
  url: string;
  /** 同一任务同一时间点的多次渠道投递共用一个 tag，系统通知中心会合并 */
  tag: string;
  fireAt: number;
}

export interface NotifyResult {
  ok: boolean;
  error?: string;
  /**
   * true 表示重试没有意义（没配置 token、没有设备订阅、地址被安全策略拒绝）：
   * 调度器会立刻降级到下一个渠道，而不是等 2 次失败。
   */
  permanent?: boolean;
}

export interface NotifierContext {
  db: Db;
  userId: string;
  now: number;
  timezone: string;
  config: ReminderRuntimeConfig;
  vapid: VapidKeyPair | null;
  /** push endpoint 域名白名单（安全文档 §2 资产表：防止把服务端当 SSRF 跳板） */
  pushEndpointAllowlist: string[];
  fetch: typeof fetch;
}

export interface Notifier {
  id: ImplementedChannel;
  send(payload: ReminderPayload, ctx: NotifierContext): Promise<NotifyResult>;
}
