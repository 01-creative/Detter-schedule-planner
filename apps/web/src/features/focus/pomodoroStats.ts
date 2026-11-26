import { addDays, dayKey, formatTime } from "@detter/shared";
import type { PomodoroSession } from "@detter/shared";

/**
 * 番茄钟的统计口径（纯函数）。
 *
 * 口径写死在这里，页面只负责展示：
 * - 「今天」按 `startedAt` 归属：23:50 开始、00:15 结束的一轮算前一天（和 KPI 的按日聚合一致）；
 * - 「专注 N 个」只数 completed === true 的 focus 记录；
 * - 「分钟」数所有 focus 记录的实际时长（中断的那部分也是真坐住了，不该抹掉）；
 * - 连续天数从今天往前数，今天还没有就先看昨天（早上打开时不该显示断签）。
 */

export interface FocusStats {
  /** 今天完成的专注个数 */
  completed: number;
  /** 今天实际专注分钟（含被中断的） */
  minutes: number;
  /** 今天累计暂停次数（打断） */
  interruptions: number;
  /** 连续专注天数 */
  streak: number;
  /** 今天的 focus 记录数（含未完成） */
  sessions: number;
}

export function isFocusSession(session: PomodoroSession): boolean {
  return session.kind === "focus" && !session.deletedAt;
}

export function sessionsOfDay(
  sessions: readonly PomodoroSession[],
  now: number,
): PomodoroSession[] {
  const key = dayKey(now);
  return sessions
    .filter((session) => !session.deletedAt && dayKey(session.startedAt) === key)
    .sort((a, b) => b.startedAt - a.startedAt);
}

export function computeFocusStats(
  sessions: readonly PomodoroSession[],
  now: number,
): FocusStats {
  const today = sessionsOfDay(sessions, now).filter(isFocusSession);

  let completed = 0;
  let minutes = 0;
  let interruptions = 0;
  for (const session of today) {
    if (session.completed) completed += 1;
    minutes += Math.max(0, session.actualMin);
    interruptions += Math.max(0, session.interruptions);
  }

  return {
    completed,
    minutes,
    interruptions,
    streak: focusStreak(sessions, now),
    sessions: today.length,
  };
}

/** 连续天数：只要某天有一条完成的 focus 记录就算「练过」。 */
export function focusStreak(sessions: readonly PomodoroSession[], now: number): number {
  const days = new Set<string>();
  for (const session of sessions) {
    if (!isFocusSession(session) || !session.completed) continue;
    days.add(dayKey(session.startedAt));
  }
  if (days.size === 0) return 0;

  let cursor = now;
  if (!days.has(dayKey(cursor))) {
    // 今天还没开始也不立刻断签：从昨天往前数
    cursor = addDays(now, -1);
    if (!days.has(dayKey(cursor))) return 0;
  }

  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** 记录行的时间段：15:04–15:29；跨天时第二天补日期前缀由调用方处理。 */
export function sessionSpan(session: PomodoroSession): string {
  const start = formatTime(session.startedAt);
  if (session.endedAt === null) return `${start} 开始`;
  const endSameDay = dayKey(session.endedAt) === dayKey(session.startedAt);
  const end = formatTime(session.endedAt);
  return endSameDay ? `${start}–${end}` : `${start}–次日 ${end}`;
}
