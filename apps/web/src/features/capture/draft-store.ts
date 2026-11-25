/**
 * 捕获草稿：写进 localStorage，key 与任务书一致（`detter.capture.draft`）。
 *
 * 为什么不用 IndexedDB：草稿是「进程崩溃/键盘弹起把页面干掉」时的救命绳，
 * 需要在 React 之外、同步地、在任何时刻都能落盘。localStorage 的同步写入正好，
 * 而 IndexedDB 的事务在页面被系统回收时经常来不及提交。
 *
 * 存的是纯文本而不是 JSON：用户可能在任何时刻刷新，解析器会重新解析一次，
 * 没必要把一份可能过时的 ParsedDraft 一起存下来（解析器改了也不需要迁移草稿）。
 */

export const DRAFT_STORAGE_KEY = "detter.capture.draft";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Safari 无痕模式访问 localStorage 会抛错，此时草稿功能静默降级
    return null;
  }
}

export function readDraft(): string {
  return storage()?.getItem(DRAFT_STORAGE_KEY) ?? "";
}

export function writeDraft(text: string): void {
  const store = storage();
  if (!store) return;
  try {
    if (text.trim()) store.setItem(DRAFT_STORAGE_KEY, text);
    else store.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // 配额满或被策略禁用：草稿失败不能影响主流程
  }
}

export function clearDraft(): void {
  try {
    storage()?.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // 同上
  }
}
