import { dayKey, type InboxItem } from "@detter/shared";

/**
 * 收件箱的分组与筛选（纯函数）。
 *
 * 分组按 `capturedAt` 的本地日历日，而不是「24 小时前」：
 * 用户在凌晨 1 点记的东西，第二天早上应该出现在「昨天」而不是「今天」，
 * 日历日才符合人对「昨天」的直觉。
 */

export type InboxFilter = "all" | "today" | "earlier";
export type InboxBucketKey = "today" | "yesterday" | "earlier";

export const BUCKET_LABEL: Record<InboxBucketKey, string> = {
  today: "今天",
  yesterday: "昨天",
  earlier: "更早",
};

export const FILTER_LABEL: Record<InboxFilter, string> = {
  all: "全部",
  today: "今天",
  earlier: "更早",
};

export function bucketOf(capturedAt: number, now: number = Date.now()): InboxBucketKey {
  const today = dayKey(now);
  const key = dayKey(capturedAt);
  if (key === today) return "today";
  if (key === dayKey(now - 86_400_000)) return "yesterday";
  return "earlier";
}

export function filterInbox(
  items: readonly InboxItem[],
  filter: InboxFilter,
  now: number = Date.now(),
): InboxItem[] {
  if (filter === "all") return [...items];
  const today = dayKey(now);
  return items.filter((item) => {
    const key = dayKey(item.capturedAt);
    return filter === "today" ? key === today : key !== today;
  });
}

export interface InboxGroup {
  key: InboxBucketKey;
  label: string;
  items: InboxItem[];
}

export function groupInbox(items: readonly InboxItem[], now: number = Date.now()): InboxGroup[] {
  const buckets: Record<InboxBucketKey, InboxItem[]> = { today: [], yesterday: [], earlier: [] };
  for (const item of items) buckets[bucketOf(item.capturedAt, now)].push(item);

  return (["today", "yesterday", "earlier"] as const)
    .filter((key) => buckets[key].length > 0)
    .map((key) => ({ key, label: BUCKET_LABEL[key], items: buckets[key] }));
}

/** 「全部整理」超过这个数量先确认（任务书 §4.2）。 */
export const BULK_CONFIRM_THRESHOLD = 10;
