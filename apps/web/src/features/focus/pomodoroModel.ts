import { POMODORO_DEFAULTS } from "@detter/shared";
import type { PomodoroKind } from "@detter/shared";

/**
 * 番茄钟的计时模型（纯函数，不碰 React / Dexie / 浏览器 API）。
 *
 * 核心约定（任务书 §3.1）：**唯一真相是目标结束时间 `endsAt`**。
 * 剩余时间永远是 `endsAt - Date.now()` 反算出来的，绝不写 `remaining -= elapsed`。
 * 这样做换来三个硬保证：
 *   1. 页面刷新 / 切后台 / 锁屏，只要时钟没被改，回来时剩余时间一定是对的；
 *   2. 定时器被节流（后台标签页会被浏览器压到 1 次/分钟）不影响结果，只影响刷新频率；
 *   3. 渲染频率与计时精度解耦 —— 250ms 只是「多久重画一次」，不是「走了多久」。
 *
 * 暂停需要把「冻结的剩余量」记下来，因为此时 `endsAt` 已经不再推进：
 * 恢复时重新算 `endsAt = now + remainingMs`，于是又回到单一真相。
 */

/** settings 表里的键名（与任务书 §3.3 一致）。 */
export const FOCUS_SETTINGS_KEY = "focus.pomodoro";

/** 计时状态在 localStorage 的键（刷新后能接上，不走 Dexie：这不是领域数据）。 */
export const FOCUS_TIMER_STORAGE_KEY = "detter.focus.timer.v1";

export interface FocusSettings {
  focusMin: number;
  shortBreakMin: number;
  longBreakMin: number;
  longBreakEvery: number;
}

export const DEFAULT_FOCUS_SETTINGS: FocusSettings = {
  focusMin: POMODORO_DEFAULTS.focusMin,
  shortBreakMin: POMODORO_DEFAULTS.shortBreakMin,
  longBreakMin: POMODORO_DEFAULTS.longBreakMin,
  longBreakEvery: POMODORO_DEFAULTS.longBreakEvery,
};

const MINUTE_MS = 60_000;

const KIND_LABEL: Record<PomodoroKind, string> = {
  focus: "专注",
  short_break: "短休息",
  long_break: "长休息",
};

export function phaseLabel(kind: PomodoroKind): string {
  return KIND_LABEL[kind];
}

function toInt(value: unknown, fallback: number, min: number, max: number): number {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.round(raw)));
}

/**
 * 设置容错：settings 表是用户/同步写入的，可能是旧版本结构、字符串或脏数据。
 * 任何一项不合法都退回默认值，不允许 NaN 流进计时（否则 UI 会出现 "NaN:NaN"）。
 */
export function sanitizeSettings(input: unknown): FocusSettings {
  const record =
    typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  return {
    focusMin: toInt(record.focusMin, DEFAULT_FOCUS_SETTINGS.focusMin, 1, 180),
    shortBreakMin: toInt(record.shortBreakMin, DEFAULT_FOCUS_SETTINGS.shortBreakMin, 1, 60),
    longBreakMin: toInt(record.longBreakMin, DEFAULT_FOCUS_SETTINGS.longBreakMin, 1, 120),
    longBreakEvery: toInt(record.longBreakEvery, DEFAULT_FOCUS_SETTINGS.longBreakEvery, 1, 12),
  };
}

export function planMinFor(kind: PomodoroKind, settings: FocusSettings): number {
  if (kind === "short_break") return settings.shortBreakMin;
  if (kind === "long_break") return settings.longBreakMin;
  return settings.focusMin;
}

/* -------------------------------------------------------------------------- */
/*                                  计时状态                                   */
/* -------------------------------------------------------------------------- */

export type TimerStatus = "idle" | "running" | "paused";

export interface TimerState {
  status: TimerStatus;
  kind: PomodoroKind;
  /** 本轮计划分钟数；休息阶段用各自设置 */
  planMin: number;
  /** 这一轮真实的开始时刻（含暂停前的时间），写进 pomodoro 记录的 startedAt */
  sessionStartedAt: number;
  /** 当前「运行段」的起点；暂停/恢复会把它推到恢复时刻 */
  startedAt: number;
  /** 目标结束时间：running 时的唯一真相 */
  endsAt: number;
  /** 之前各运行段累计的专注毫秒（不含当前段） */
  accumulatedMs: number;
  /** paused 时冻结的剩余毫秒 */
  remainingMs: number;
  taskId: string | null;
  /** 暂停次数，作为「打断」计入记录 */
  interruptions: number;
  /** 本轮已完成的专注个数，用于 ● ● ● ○ 与长休息判断 */
  round: number;
}

export interface TimerSeed {
  kind?: PomodoroKind;
  planMin: number;
  round?: number;
  taskId?: string | null;
}

export function createIdleTimer({
  kind = "focus",
  planMin,
  round = 0,
  taskId = null,
}: TimerSeed): TimerState {
  const safePlan = Math.max(1, Math.round(planMin) || DEFAULT_FOCUS_SETTINGS.focusMin);
  return {
    status: "idle",
    kind,
    planMin: safePlan,
    sessionStartedAt: 0,
    startedAt: 0,
    endsAt: 0,
    accumulatedMs: 0,
    remainingMs: safePlan * MINUTE_MS,
    taskId,
    interruptions: 0,
    round,
  };
}

export function startTimer(state: TimerState, now: number): TimerState {
  if (state.status !== "idle") return state;
  const total = state.planMin * MINUTE_MS;
  return {
    ...state,
    status: "running",
    sessionStartedAt: now,
    startedAt: now,
    endsAt: now + total,
    accumulatedMs: 0,
    remainingMs: 0,
    interruptions: 0,
  };
}

/** 暂停：把当前运行段的已用时间折进 accumulatedMs，并冻结剩余量。 */
export function pauseTimer(state: TimerState, now: number): TimerState {
  if (state.status !== "running") return state;
  const stoppedAt = Math.min(now, state.endsAt);
  const elapsed = Math.max(0, stoppedAt - state.startedAt);
  return {
    ...state,
    status: "paused",
    accumulatedMs: state.accumulatedMs + elapsed,
    remainingMs: Math.max(0, state.endsAt - now),
    interruptions: state.interruptions + 1,
  };
}

/** 恢复：用 now + 冻结剩余量重算 endsAt，重新回到「单一真相」。 */
export function resumeTimer(state: TimerState, now: number): TimerState {
  if (state.status !== "paused") return state;
  return {
    ...state,
    status: "running",
    startedAt: now,
    endsAt: now + state.remainingMs,
    remainingMs: 0,
  };
}

/* -------------------------------------------------------------------------- */
/*                                 读取派生量                                  */
/* -------------------------------------------------------------------------- */

export function totalOf(state: TimerState): number {
  return state.planMin * MINUTE_MS;
}

/** 剩余毫秒：running 用 endsAt 反算，paused 用冻结值，idle 就是整轮时长。 */
export function remainingOf(state: TimerState, now: number): number {
  if (state.status === "running") return Math.max(0, state.endsAt - now);
  if (state.status === "paused") return Math.max(0, state.remainingMs);
  return totalOf(state);
}

/** 已经专注的毫秒（休息阶段同样按时间算，只是记录里 kind 不同）。 */
export function focusedOf(state: TimerState, now: number): number {
  if (state.status === "running") {
    const end = Math.min(now, state.endsAt);
    return state.accumulatedMs + Math.max(0, end - state.startedAt);
  }
  if (state.status === "paused") return state.accumulatedMs;
  return 0;
}

export function progressOf(state: TimerState, now: number): number {
  const total = totalOf(state);
  if (total <= 0) return 0;
  const done = total - remainingOf(state, now);
  return Math.min(1, Math.max(0, done / total));
}

export function isExpired(state: TimerState, now: number): boolean {
  return state.status === "running" && now >= state.endsAt;
}

/** 剩余 10 秒内、且还没到点：用于「结束前 10 秒」的轻提示。 */
export function isInFinalCountdown(state: TimerState, now: number, windowMs = 10_000): boolean {
  if (state.status !== "running") return false;
  const remaining = remainingOf(state, now);
  return remaining > 0 && remaining <= windowMs;
}

/** 毫秒 → "24:12"。向上取整，保证开始时显示 25:00、到点那一刻才显示 00:00。 */
export function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/* -------------------------------------------------------------------------- */
/*                               阶段流转 / 收尾                                */
/* -------------------------------------------------------------------------- */

export interface PhaseStep {
  kind: PomodoroKind;
  round: number;
}

/**
 * 一轮结束后的下一阶段：
 * - 专注跑完 → 累计 round+1；够 longBreakEvery 就长休息，否则短休息；
 * - 短休息结束 → 回到专注，round 不变；
 * - 长休息结束 → 回到专注，round 归零（新的一轮）。
 * 长休息期间 round 保持满格，这样 ● ● ● ● 会一直亮到休息结束。
 */
export function nextPhase(
  kind: PomodoroKind,
  round: number,
  settings: FocusSettings,
): PhaseStep {
  if (kind === "focus") {
    const filled = round + 1;
    return filled >= settings.longBreakEvery
      ? { kind: "long_break", round: filled }
      : { kind: "short_break", round: filled };
  }
  return { kind: "focus", round: kind === "long_break" ? 0 : round };
}

/** 跳过当前阶段：不写记录，但阶段照常往前走（跳过长休息同样会清空本轮计数）。 */
export function skipPhase(state: TimerState, settings: FocusSettings): TimerState {
  const step: PhaseStep =
    state.kind === "focus"
      ? state.round + 1 >= settings.longBreakEvery
        ? { kind: "long_break", round: state.round }
        : { kind: "short_break", round: state.round }
      : nextPhase(state.kind, state.round, settings);
  return createIdleTimer({
    kind: step.kind,
    planMin: planMinFor(step.kind, settings),
    round: step.round,
    taskId: state.taskId,
  });
}

export interface SessionDraft {
  kind: PomodoroKind;
  taskId: string | null;
  startedAt: number;
  endedAt: number;
  planMin: number;
  actualMin: number;
  completed: boolean;
  interruptions: number;
}

export interface CompletionResult {
  record: SessionDraft;
  next: TimerState;
}

/**
 * 到点收尾。endedAt 用计划结束时刻（而不是「发现到点的那一刻」）：
 * 后台标签页被节流时，发现得晚，但记录必须是准的。
 */
export function completionOf(
  state: TimerState,
  now: number,
  settings: FocusSettings,
): CompletionResult | null {
  if (!isExpired(state, now)) return null;
  const step = nextPhase(state.kind, state.round, settings);
  return {
    record: {
      kind: state.kind,
      taskId: state.taskId,
      startedAt: state.sessionStartedAt,
      endedAt: state.endsAt,
      planMin: state.planMin,
      // 完整跑完就是计划时长；暂停不计入，因此 actualMin === planMin
      actualMin: state.planMin,
      completed: true,
      interruptions: state.interruptions,
    },
    next: createIdleTimer({
      kind: step.kind,
      planMin: planMinFor(step.kind, settings),
      round: step.round,
      taskId: state.taskId,
    }),
  };
}

export interface InterruptResult {
  /** 实际专注不足 1 分钟时返回 null：不往统计里塞 0 分钟记录 */
  record: SessionDraft | null;
  next: TimerState;
}

/** 用户手动停止：completed=false，actualMin 按真实累计（不含暂停时间）。 */
export function interruptOf(
  state: TimerState,
  now: number,
  settings: FocusSettings,
): InterruptResult {
  const focused = focusedOf(state, now);
  const next = createIdleTimer({
    kind: state.kind,
    planMin: planMinFor(state.kind, settings),
    round: state.round,
    taskId: state.taskId,
  });
  // 门槛看毫秒而不是四舍五入后的分钟：30 秒不该被四舍五入成 1 分钟
  if (focused < MINUTE_MS) return { record: null, next };
  const actualMin = Math.max(1, Math.round(focused / MINUTE_MS));
  return {
    record: {
      kind: state.kind,
      taskId: state.taskId,
      startedAt: state.sessionStartedAt,
      endedAt: now,
      planMin: state.planMin,
      actualMin,
      completed: false,
      interruptions: state.interruptions,
    },
    next,
  };
}
