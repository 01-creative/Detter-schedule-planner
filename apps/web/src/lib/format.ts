import { differenceInMinutes, isToday, isTomorrow, isYesterday } from "date-fns";
import { dayKey } from "@detter/shared";

/**
 * 中文日期/时长展示。
 *
 * 为什么不用 date-fns 的 locale 直接拼：中文习惯是「11月25日 周三」「今天 15:00」，
 * 用 locale 会得到「2026年11月25日星期三」，长且不适合 12px 的辅助信息。
 * date-fns 只负责「今天/明天/昨天」这种区间判断，格式化交给我们自己控制。
 */

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatWeekday(ts: number): string {
  return WEEKDAYS[new Date(ts).getDay()] ?? "周日";
}

/** 11月25日 周三 */
export function formatDateLabel(ts: number): string {
  const date = new Date(ts);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${formatWeekday(ts)}`;
}

/** 15:00 */
export function formatClock(ts: number): string {
  const date = new Date(ts);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 今天 / 明天 / 昨天 / 11月26日 周三 */
export function formatDayLabel(ts: number, now: number = Date.now()): string {
  if (isToday(ts)) return "今天";
  if (isTomorrow(ts)) return "明天";
  if (isYesterday(ts)) return "昨天";
  const date = new Date(ts);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return sameYear ? formatDateLabel(ts) : `${date.getFullYear()}年${formatDateLabel(ts)}`;
}

export interface WhenLike {
  startAt?: number | null;
  endAt?: number | null;
  dueAt?: number | null;
  allDay?: boolean;
}

/** 把一条任务的时间字段压成一句人话：今天 15:00–16:00 / 明天 · 全天 / 截止 11月30日 18:00 */
export function formatWhen(task: WhenLike, now: number = Date.now()): string {
  if (task.allDay && task.startAt) {
    return `${formatDayLabel(task.startAt, now)} · 全天`;
  }
  if (task.startAt) {
    const head = `${formatDayLabel(task.startAt, now)} ${formatClock(task.startAt)}`;
    if (task.endAt && task.endAt > task.startAt) {
      const sameDay = dayKey(task.endAt) === dayKey(task.startAt);
      return `${head}–${sameDay ? formatClock(task.endAt) : `${formatDayLabel(task.endAt, now)} ${formatClock(task.endAt)}`}`;
    }
    return head;
  }
  if (task.dueAt) {
    return `截止 ${formatDayLabel(task.dueAt, now)} ${formatClock(task.dueAt)}`;
  }
  return "未排期";
}

/** 40分钟 / 1.5小时 / 2小时30分 */
export function formatDurationMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || minutes < 0) return "";
  const total = Math.round(minutes);
  if (total < 60) return `${total}分钟`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours}小时` : `${hours}小时${rest}分`;
}

/** 刚刚 / 12分钟前 / 3小时前 / 昨天 / 11-20 */
export function formatRelative(ts: number, now: number = Date.now()): string {
  const diff = differenceInMinutes(now, ts);
  if (diff < 1) return "刚刚";
  if (diff < 60) return `${diff}分钟前`;
  if (isToday(ts)) return `${Math.floor(diff / 60)}小时前`;
  if (isYesterday(ts)) return "昨天";
  const date = new Date(ts);
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 同步时间：今天 15:04 / 11-20 15:04 */
export function formatSyncTime(ts: number | null, now: number = Date.now()): string {
  if (!ts) return "还没同步过";
  return isToday(ts)
    ? `今天 ${formatClock(ts)}`
    : `${pad(new Date(ts).getMonth() + 1)}-${pad(new Date(ts).getDate())} ${formatClock(ts)}`;
}

/** 按当前钟点给一句问候，首屏标题用它，避免首页像冷冰冰的后台 */
export function greeting(now: number = Date.now()): string {
  const hour = new Date(now).getHours();
  if (hour < 5) return "夜深了";
  if (hour < 11) return "早上好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}
