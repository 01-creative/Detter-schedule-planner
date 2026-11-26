import type { ImplementedChannel, Notifier } from "../types";
import { inappNotifier } from "./inapp";
import { wechatNotifier } from "./wechat";
import { webpushNotifier } from "./webpush";

/**
 * 渠道注册表。
 *
 * 新增渠道只要在这里加一行 + 一个 Notifier 实现；调度器不认识具体渠道，
 * 这样「Web Push 在大陆不可靠就换微信/邮件」的产品决策不需要改调度逻辑。
 */
const REGISTRY: Record<ImplementedChannel, Notifier> = {
  inapp: inappNotifier,
  wechat: wechatNotifier,
  webpush: webpushNotifier,
};

export function getNotifier(channel: string): Notifier | null {
  return (REGISTRY as Record<string, Notifier | undefined>)[channel] ?? null;
}

export function listNotifiers(): ImplementedChannel[] {
  return Object.keys(REGISTRY) as ImplementedChannel[];
}

export { inappNotifier, wechatNotifier, webpushNotifier };
