import { POMODORO_KINDS } from "@detter/shared";
import type { PomodoroKind } from "@detter/shared";
import { createIdleTimer, FOCUS_TIMER_STORAGE_KEY } from "./pomodoroModel";
import type { TimerState, TimerStatus } from "./pomodoroModel";

/**
 * 计时状态的落盘。
 *
 * 为什么不进 Dexie：这是「这台设备上的一个正在跑的计时器」，不是要同步的领域数据。
 * 写进 localStorage 的好处是同步层完全不知道它存在，也不会因为一条 UI 状态触发推送。
 *
 * 容错是必须的：localStorage 里可能留着上一版本的字段、用户手改的脏值、
 * 甚至别的站点写坏的字符串。任何一项不合法就当作「没有计时器」，绝不把 NaN 带进 UI。
 */

const STATUSES: readonly TimerStatus[] = ["idle", "running", "paused"] as const;

function isKind(value: unknown): value is PomodoroKind {
  return typeof value === "string" && (POMODORO_KINDS as readonly string[]).includes(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStatus(value: unknown): value is TimerStatus {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

/** 把任意来源的数据解析成合法计时状态；解析不出来返回 null。 */
export function parseTimerState(raw: unknown): TimerState | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;

  if (!isStatus(record.status)) return null;
  if (!isKind(record.kind)) return null;
  if (!isNumber(record.planMin) || record.planMin < 1) return null;

  const planMin = Math.round(record.planMin);
  const numbers = [
    "sessionStartedAt",
    "startedAt",
    "endsAt",
    "accumulatedMs",
    "remainingMs",
    "interruptions",
    "round",
  ] as const;
  if (!numbers.every((key) => isNumber(record[key]))) return null;

  const status = record.status;
  // running 必须有合法的 endsAt，否则整轮作废（宁可让用户重开一轮，也不要显示乱跳的倒计时）
  if (status === "running" && (record.endsAt as number) <= 0) return null;

  const taskId =
    typeof record.taskId === "string" && record.taskId.length > 0 ? record.taskId : null;

  return {
    status,
    kind: record.kind,
    planMin,
    sessionStartedAt: record.sessionStartedAt as number,
    startedAt: record.startedAt as number,
    endsAt: record.endsAt as number,
    accumulatedMs: Math.max(0, record.accumulatedMs as number),
    remainingMs: Math.max(0, record.remainingMs as number),
    taskId,
    interruptions: Math.max(0, Math.round(record.interruptions as number)),
    round: Math.max(0, Math.round(record.round as number)),
  };
}

export function loadTimerState(): TimerState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(FOCUS_TIMER_STORAGE_KEY);
    if (!raw) return null;
    return parseTimerState(raw);
  } catch {
    return null;
  }
}

export function saveTimerState(state: TimerState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FOCUS_TIMER_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 隐私模式 / 配额满：计时器仍然能在当前页面里跑，只是刷新会丢
  }
}

export function clearTimerState(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(FOCUS_TIMER_STORAGE_KEY);
  } catch {
    // 同上，忽略
  }
}

/** 首次进入 / 重置时的初始状态（专注阶段、默认时长）。 */
export function initialState(focusMin: number): TimerState {
  return createIdleTimer({ kind: "focus", planMin: focusMin });
}
