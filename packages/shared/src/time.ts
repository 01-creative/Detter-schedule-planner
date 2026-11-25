/**
 * 时间工具（纯函数，全部以本地时区语义处理）。
 *
 * 约定：
 * - 时间戳统一用毫秒整数（number）；
 * - 日期键统一用本地日历日 "YYYY-MM-DD"（用于 KPI / OKR 周期归档）；
 * - 周从周一开始（符合中文习惯）。
 */

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

function pad(n: number, len = 2): string {
  return String(n).padStart(len, "0");
}

/** 本地日历日键：2026-11-25 */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 由日期键与当天毫秒偏移构造时间戳（本地时区）。 */
export function dayKeyToTs(key: string, msOfDay = 0): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 0, 0, 0, msOfDay).getTime();
}

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfDay(ts: number): number {
  return startOfDay(ts) + DAY - 1;
}

export function addDays(ts: number, days: number): number {
  const d = new Date(ts);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

export function addMonths(ts: number, months: number): number {
  const d = new Date(ts);
  d.setMonth(d.getMonth() + months);
  return d.getTime();
}

/** 本地日 0=周日。ISO 周几 1=周一 … 7=周日。 */
export function isoWeekday(ts: number): number {
  const wd = new Date(ts).getDay();
  return wd === 0 ? 7 : wd;
}

/** 本周一 00:00 */
export function startOfWeek(ts: number): number {
  return startOfDay(addDays(ts, 1 - isoWeekday(ts)));
}

export function endOfWeek(ts: number): number {
  return startOfWeek(ts) + 7 * DAY - 1;
}

export function startOfMonth(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export function endOfMonth(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() - 1;
}

export function startOfQuarter(ts: number): number {
  const d = new Date(ts);
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3, 1).getTime();
}

export function endOfQuarter(ts: number): number {
  const d = new Date(ts);
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3 + 3, 1).getTime() - 1;
}

export function startOfYear(ts: number): number {
  return new Date(new Date(ts).getFullYear(), 0, 1).getTime();
}

export function endOfYear(ts: number): number {
  return new Date(new Date(ts).getFullYear() + 1, 0, 1).getTime() - 1;
}

export type PeriodType = "day" | "week" | "month" | "quarter" | "year";

export interface PeriodRange {
  start: number;
  end: number;
  /** 周期起始日键，写入 OKR 的 periodStart */
  key: string;
  label: string;
}

/** 计算某个时间点所处的周期范围。 */
export function periodRange(type: PeriodType, ts: number = Date.now()): PeriodRange {
  switch (type) {
    case "day":
      return { start: startOfDay(ts), end: endOfDay(ts), key: dayKey(ts), label: dayKey(ts) };
    case "week": {
      const s = startOfWeek(ts);
      return { start: s, end: endOfWeek(ts), key: dayKey(s), label: `${dayKey(s)} 周` };
    }
    case "month": {
      const d = new Date(ts);
      const s = startOfMonth(ts);
      return {
        start: s,
        end: endOfMonth(ts),
        key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`,
        label: `${d.getFullYear()}年${d.getMonth() + 1}月`,
      };
    }
    case "quarter": {
      const d = new Date(ts);
      const q = Math.floor(d.getMonth() / 3) + 1;
      return {
        start: startOfQuarter(ts),
        end: endOfQuarter(ts),
        key: `${d.getFullYear()}-Q${q}`,
        label: `${d.getFullYear()} Q${q}`,
      };
    }
    case "year": {
      const y = new Date(ts).getFullYear();
      return { start: startOfYear(ts), end: endOfYear(ts), key: `${y}`, label: `${y}年` };
    }
  }
}

/** 2026-11-25 14:30 */
export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  return `${dayKey(ts)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 14:30 */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 把分钟数格式化成 “1小时30分” */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}分钟`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h}小时` : `${h}小时${rest}分`;
}

/** 相对时间：刚刚 / 12分钟前 / 3小时前 / 昨天 / 11-20 */
export function relativeTime(ts: number, now: number = Date.now()): string {
  const diff = now - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}分钟前`;
  if (diff < DAY && dayKey(ts) === dayKey(now)) return `${Math.floor(diff / HOUR)}小时前`;
  const yesterday = dayKey(addDays(now, -1));
  if (dayKey(ts) === yesterday) return "昨天";
  const d = new Date(ts);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 是否同一个本地日 */
export function isSameDay(a: number, b: number): boolean {
  return dayKey(a) === dayKey(b);
}

/** 把时间戳对齐到下一个整 5 分钟（用于拖拽后吸附） */
export function snapToMinutes(ts: number, step = 5): number {
  const ms = step * MINUTE;
  return Math.round(ts / ms) * ms;
}
