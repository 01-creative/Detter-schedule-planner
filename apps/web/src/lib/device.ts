import { uuidv7 } from "@detter/shared";

/**
 * 设备身份。
 *
 * 为什么存在 localStorage 而不是 IndexedDB：同步客户端在数据库打开之前就要用 deviceId
 * 组装 op；localStorage 是同步 API，且清空数据时也会被一起清掉，语义正确。
 */

const DEVICE_ID_KEY = "detter.deviceId";
const DEVICE_NAME_KEY = "detter.deviceName";

let memoryDeviceId: string | null = null;

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    // Safari 无痕模式下访问 localStorage 会抛错，退化成进程内 ID
    return null;
  }
}

export function getDeviceId(): string {
  if (memoryDeviceId) return memoryDeviceId;
  const storage = safeStorage();
  const existing = storage?.getItem(DEVICE_ID_KEY);
  if (existing) {
    memoryDeviceId = existing;
    return existing;
  }
  const created = uuidv7();
  storage?.setItem(DEVICE_ID_KEY, created);
  memoryDeviceId = created;
  return created;
}

/** 给设备起一个人能看懂的名字，设置页与冲突排查会用到。 */
export function getDeviceName(): string {
  const storage = safeStorage();
  const saved = storage?.getItem(DEVICE_NAME_KEY);
  if (saved) return saved;
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const platform = /iPhone|iPad|iPod/.test(ua)
    ? "iPhone"
    : /Android/.test(ua)
      ? "Android"
      : /Macintosh/.test(ua)
        ? "Mac"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "浏览器";
  const name = `${platform} · Detter`;
  storage?.setItem(DEVICE_NAME_KEY, name);
  return name;
}

export function setDeviceName(name: string): void {
  safeStorage()?.setItem(DEVICE_NAME_KEY, name);
}

export function getPlatform(): string {
  if (typeof navigator === "undefined") return "web";
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "web";
}

/** 测试用：清掉进程内缓存，让下一次调用重新读存储。 */
export function __resetDeviceCacheForTests(): void {
  memoryDeviceId = null;
}
