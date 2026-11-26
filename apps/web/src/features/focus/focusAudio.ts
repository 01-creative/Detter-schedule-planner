/**
 * 番茄钟的声音与系统通知。
 *
 * 声音用 WebAudio 现场合成，不引入任何音频文件：
 * 一个正弦波 + 指数包络，听起来像「叮」而不是「哔」，也不会在 repo 里多出 20KB。
 *
 * 浏览器要求音频上下文必须由用户手势创建/恢复，所以 `primeAudio()` 在点「开始」时调用；
 * 之后的结束提示音都能正常播。通知同理：权限只在用户点开始时申请一次。
 */

let context: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (typeof window.AudioContext === "undefined") return null;
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume();
    return context;
  } catch {
    return null;
  }
}

/** 必须在用户手势里调用一次，否则后续提示音会被浏览器静音。 */
export function primeAudio(): void {
  getContext();
}

/** 播放 n 声「叮」，默认 880Hz；结束前 10 秒用更低的一声（660Hz）区分。 */
export function playChime(count = 1, frequency = 880): void {
  const ctx = getContext();
  if (!ctx) return;
  try {
    const start = ctx.currentTime + 0.02;
    for (let index = 0; index < count; index += 1) {
      const at = start + index * 0.22;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.14, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.2);
    }
  } catch {
    // 声音失败不影响计时，静默忽略
  }
}

function notificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/** 在用户手势里申请一次通知权限；拒绝或环境不支持都返回 false。 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!notificationSupported()) return false;
  try {
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    const result = await Notification.requestPermission();
    return result === "granted";
  } catch {
    return false;
  }
}

export function notify(title: string, body: string): void {
  if (!notificationSupported() || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, tag: "detter-focus" });
  } catch {
    // 某些环境（无 SW 的移动端）会抛错：提示音与页面内 toast 仍然生效
  }
}
