import { MINUTE, addDays } from "@detter/shared";
import type { Task } from "@detter/shared";
import { RRule } from "rrule";
import type { Options } from "rrule";

/**
 * 重复事件展开（任务书 §5）。
 *
 * 三条铁律：
 * 1. **实例不落库**。rrule 只描述「什么时候发生」，展开结果在渲染层现算；
 *    只有「例外」（改这一次、单独完成、删这一次）才写覆盖记录。
 * 2. **全部按本地时区展开**。rrule 库只认 Date 的 UTC 字段，所以这里用「浮动时间」
 *    技巧：把本地墙上时间塞进 UTC 字段，展开后再按 UTC 字段读回本地时间。
 *    这样跨夏令时也不会把 09:00 的课漂到 10:00（用户不在夏令时区，但代码不假设）。
 * 3. **不出现 toISOString()**。所有格式化都基于本地字段手写。
 */

/** 安全上限：防止一条畸形 rrule（例如 FREQ=SECONDLY）把界面拖死 */
const MAX_OCCURRENCES = 400;

/** 默认时长：只给了开始时间的事件按 1 小时算 */
const DEFAULT_DURATION_MS = 60 * MINUTE;

/* -------------------------------------------------------------------------- */
/*                                浮动时间换算                                  */
/* -------------------------------------------------------------------------- */

/** 本地时间戳 → 浮动 Date（UTC 字段 = 本地字段） */
export function toFloatingDate(ts: number): Date {
  const date = new Date(ts);
  return new Date(
    Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
      date.getSeconds(),
      0,
    ),
  );
}

/** 浮动 Date → 本地时间戳（把 UTC 字段当成本地字段读回来） */
export function fromFloatingDate(date: Date): number {
  return new Date(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    0,
  ).getTime();
}

/** UNTIL 的字面量：20261209T090000Z（把本地墙上时间写成 UTC，与 dtstart 同框） */
function untilLiteral(ts: number): string {
  const date = toFloatingDate(ts);
  const pad = (value: number, length = 2) => String(value).padStart(length, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/* -------------------------------------------------------------------------- */
/*                               RRULE 字符串处理                              */
/* -------------------------------------------------------------------------- */

/** 去掉 RRULE: 前缀与空白，得到 FREQ=...;BYDAY=... */
export function normalizeRRule(rrule: string): string {
  return rrule
    .replace(/^RRULE:/i, "")
    .replace(/\s+/g, "")
    .trim();
}

export function parseRRuleOptions(rrule: string): Partial<Options> | null {
  const body = normalizeRRule(rrule);
  if (!body) return null;
  try {
    return RRule.parseString(body);
  } catch {
    return null;
  }
}

/** 用 UNTIL 截断系列：保留到 lastStartAt 这一条为止（含） */
export function truncateRRule(rrule: string, lastStartAt: number): string {
  const body = normalizeRRule(rrule)
    .split(";")
    .filter((part) => part.length > 0 && !/^(UNTIL|COUNT)=/i.test(part))
    .join(";");
  return `${body};UNTIL=${untilLiteral(lastStartAt)}`.replace(/^;/, "");
}

/** 去掉 UNTIL / COUNT，得到「无限延续」的规则（拆分系列时给新系列用） */
export function openEndedRRule(rrule: string): string {
  return normalizeRRule(rrule)
    .split(";")
    .filter((part) => part.length > 0 && !/^(UNTIL|COUNT)=/i.test(part))
    .join(";");
}

const WEEKDAY_LABELS: Record<string, string> = {
  MO: "周一",
  TU: "周二",
  WE: "周三",
  TH: "周四",
  FR: "周五",
  SA: "周六",
  SU: "周日",
};

/** 人话版重复描述：每天 / 每周 周一 / 每月 */
export function describeRRule(rrule: string | null | undefined): string {
  if (!rrule) return "";
  const body = normalizeRRule(rrule).toUpperCase();
  const interval = Number(/INTERVAL=(\d+)/.exec(body)?.[1] ?? "1");
  const every = (unit: string) => (interval > 1 ? `每 ${interval} ${unit}` : `每${unit}`);

  if (body.includes("FREQ=DAILY")) return every("天");
  if (body.includes("FREQ=WEEKLY")) {
    const byDay = /BYDAY=([A-Z,]+)/.exec(body)?.[1];
    const days = byDay
      ? byDay
          .split(",")
          .filter(Boolean)
          .map((token) => WEEKDAY_LABELS[token.slice(-2)] ?? token)
          .join(" ")
      : "";
    return days ? `${every("周")} ${days}` : every("周");
  }
  if (body.includes("FREQ=MONTHLY")) return every("月");
  if (body.includes("FREQ=YEARLY")) return every("年");
  return "重复";
}

/* -------------------------------------------------------------------------- */
/*                                  展开实例                                   */
/* -------------------------------------------------------------------------- */

/** 事件时长：endAt - startAt；没有结束时间按 1 小时 */
export function durationMs(task: Pick<Task, "startAt" | "endAt">): number {
  if (!task.startAt) return DEFAULT_DURATION_MS;
  if (!task.endAt || task.endAt <= task.startAt) return DEFAULT_DURATION_MS;
  return task.endAt - task.startAt;
}

/**
 * 展开某个系列在 [from, to) 内「开始时间落在窗口里」的实例。
 *
 * 起点往前多取一段时长，是为了接住「昨天 23:00 开始、今天 01:00 结束」这种
 * 跨进窗口的实例；调用方仍会用真实区间做一次重叠过滤。
 */
export function expandOccurrenceStarts(task: Task, from: number, to: number): number[] {
  if (!task.rrule || !task.startAt) return [];
  const options = parseRRuleOptions(task.rrule);
  if (!options) return [];

  const duration = durationMs(task);
  try {
    const rule = new RRule({ ...options, dtstart: toFloatingDate(task.startAt) });
    // between 的 before 是闭区间，这里减 1ms 才能得到 [from, to) 语义
    const dates = rule.between(toFloatingDate(from - duration), toFloatingDate(to - 1), true);
    return dates.slice(0, MAX_OCCURRENCES).map(fromFloatingDate);
  } catch {
    // 规则写坏了就当作不重复，不要让整个日历白屏
    return [];
  }
}

/** 「改此后所有」时，父系列保留到哪一条为止（前一条的下一分钟） */
export function previousOccurrenceBoundary(occurrenceStart: number): number {
  return occurrenceStart - MINUTE;
}

/** 覆盖记录的 occurrenceKey：原始开始时间戳的字符串形式（与任务书一致） */
export function occurrenceKeyOf(startAt: number): string {
  return String(startAt);
}
