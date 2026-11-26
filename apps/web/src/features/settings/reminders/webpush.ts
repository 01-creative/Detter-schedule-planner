import { errorMessage, subscribePush, unsubscribePush } from "./api";

/**
 * 浏览器 Web Push 的前端能力封装。
 *
 * 这一层要回答的不是「怎么 subscribe」，而是「为什么现在不能 subscribe」：
 * 浏览器不支持、非安全上下文、iOS 没加到主屏、用户拒绝了通知权限、
 * Service Worker 还没注册（开发模式）—— 每种情况都要给出不同文案，
 * 否则用户只会看到一个静默失败的开关。
 */

export type PushSupport =
  | "unsupported"
  | "insecure"
  | "needs-install"
  | "permission-denied"
  | "permission-default"
  | "ready";

const IOS_RE = /iPad|iPhone|iPod/;

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPadOS 13+ 的 UA 伪装成 Mac，用触摸点数量兜一层
  return IOS_RE.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const displayMode = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  const navigatorStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return displayMode || navigatorStandalone;
}

export function detectPushSupport(): PushSupport {
  if (typeof window === "undefined" || typeof navigator === "undefined") return "unsupported";
  if (!window.isSecureContext) return "insecure";

  const hasNotification = "Notification" in window;
  const hasServiceWorker = "serviceWorker" in navigator;
  const hasPushManager = "PushManager" in window;

  // iOS：16.4+ 且必须「添加到主屏幕」，否则 Notification 根本不存在
  if (isIos() && (!hasNotification || !hasPushManager || !isStandalone())) return "needs-install";

  if (!hasNotification || !hasServiceWorker || !hasPushManager) return "unsupported";
  if (Notification.permission === "denied") return "permission-denied";
  if (Notification.permission === "default") return "permission-default";
  return "ready";
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

/** Service Worker 未注册时（开发模式）ready 永远不会 resolve，所以加超时。 */
async function readyRegistration(timeoutMs = 4_000): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), timeoutMs)),
    ]);
  } catch {
    return null;
  }
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  const registration = await readyRegistration();
  if (!registration) return null;
  try {
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export interface PushToggleResult {
  ok: boolean;
  error?: string;
}

export async function enablePush(publicKey: string): Promise<PushToggleResult> {
  const support = detectPushSupport();
  if (support === "insecure") return { ok: false, error: "浏览器要求 HTTPS 或 localhost 才能推送" };
  if (support === "needs-install") return { ok: false, error: "iOS 需要 16.4+，并先「添加到主屏幕」" };
  if (support === "unsupported") return { ok: false, error: "当前浏览器不支持 Web Push" };

  const permission =
    Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, error: "通知权限没有被允许，可以在地址栏左侧的站点设置里重新开启" };
  }

  const registration = await readyRegistration();
  if (!registration) {
    return {
      ok: false,
      error: "Service Worker 未就绪：开发模式不注册 SW，请用生产构建或先安装为应用",
    };
  }

  try {
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(publicKey) as unknown as BufferSource,
      }));

    const json = subscription.toJSON();
    const p256dh = json.keys?.p256dh;
    const auth = json.keys?.auth;
    if (!json.endpoint || !p256dh || !auth) {
      return { ok: false, error: "浏览器没有返回完整的推送订阅信息" };
    }

    try {
      await subscribePush({ endpoint: json.endpoint, keys: { p256dh, auth } });
    } catch (error) {
      // 服务端没存上就不要留下一个「看似已订阅」的浏览器状态
      await subscription.unsubscribe().catch(() => undefined);
      throw error;
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function disablePush(): Promise<PushToggleResult> {
  const subscription = await getCurrentSubscription();
  try {
    if (subscription) await subscription.unsubscribe();
  } catch {
    // 浏览器侧取消失败也要清服务端，否则会继续收到推送
  }
  try {
    await unsubscribePush();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}
