import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { saveEntity } from "@/db/repo";
import { loadTimerState, saveTimerState } from "./focusStorage";
import {
  completionOf,
  createIdleTimer,
  focusedOf,
  interruptOf,
  isInFinalCountdown,
  pauseTimer,
  planMinFor,
  progressOf,
  remainingOf,
  resumeTimer,
  skipPhase,
  startTimer,
  totalOf,
} from "./pomodoroModel";
import type { FocusSettings, SessionDraft, TimerState } from "./pomodoroModel";

/**
 * 番茄钟控制器。
 *
 * 计时策略（对照任务书 §3.1）：
 * - `setInterval` 只负责「触发重渲染」，不参与计时；每次渲染都用 `Date.now()` 反算剩余；
 * - 唯一真相是 state.endsAt，并且它会被写进 localStorage，所以刷新后原样接上；
 * - 切后台回来时浏览器把 interval 节流到 1 次/分钟也无所谓：visibilitychange 会立刻校正一次；
 * - 到点收尾用 `endedAt = endsAt`，不是「发现到点的那一刻」，所以后台节流不会污染记录。
 *
 * 状态机：idle → running ⇄ paused → （到点）idle（下一阶段）。
 * 所有写库动作都在效果/事件里完成，setState 的 updater 保持纯函数（StrictMode 会双调用）。
 */

/** 不足 1 分钟的专注不落库：避免统计里堆满 0 分钟记录（口径在 interruptOf 里）。 */
async function persistSession(draft: SessionDraft): Promise<boolean> {
  try {
    await saveEntity("pomodoro", { ...draft, note: "" });
    return true;
  } catch {
    return false;
  }
}

export interface UsePomodoroOptions {
  settings: FocusSettings;
  onCompleted?: (draft: SessionDraft) => void;
  onInterrupted?: (draft: SessionDraft) => void;
  /** 结束前 10 秒的轻提示（只触发一次） */
  onCountdown?: () => void;
  onPersistError?: () => void;
}

export interface PomodoroController {
  state: TimerState;
  now: number;
  remainingMs: number;
  totalMs: number;
  focusedMs: number;
  ratio: number;
  isIdle: boolean;
  isRunning: boolean;
  isPaused: boolean;
  start: () => void;
  pause: () => void;
  resume: () => void;
  /** 手动中断（写一条 completed=false 的记录，不足 1 分钟不写） */
  stop: () => void;
  /** 跳过当前阶段（不写记录） */
  skip: () => void;
  reset: () => void;
  setTaskId: (taskId: string | null) => void;
}

export function usePomodoro({
  settings,
  onCompleted,
  onInterrupted,
  onCountdown,
  onPersistError,
}: UsePomodoroOptions): PomodoroController {
  const [state, setState] = useState<TimerState>(
    () => loadTimerState() ?? createIdleTimer({ kind: "focus", planMin: settings.focusMin }),
  );
  const [now, setNow] = useState(() => Date.now());

  const completedKey = useRef<string | null>(null);
  const countdownKey = useRef<string | null>(null);
  const callbacks = useRef({ onCompleted, onInterrupted, onCountdown, onPersistError });
  const settingsRef = useRef(settings);

  useEffect(() => {
    callbacks.current = { onCompleted, onInterrupted, onCountdown, onPersistError };
    settingsRef.current = settings;
  }, [onCompleted, onInterrupted, onCountdown, onPersistError, settings]);

  /** 任何状态变化都落盘：刷新时 endsAt 还在，倒计时就不会跳。 */
  useEffect(() => {
    saveTimerState(state);
  }, [state]);

  /** 未开始的轮次跟随设置（改完立即生效）。运行中的轮次不受影响。 */
  useEffect(() => {
    setState((current) => {
      if (current.status !== "idle") return current;
      const wanted = planMinFor(current.kind, settingsRef.current);
      if (current.planMin === wanted) return current;
      return { ...current, planMin: wanted, remainingMs: wanted * 60_000 };
    });
  }, [settings.focusMin, settings.shortBreakMin, settings.longBreakMin, settings.longBreakEvery]);

  /** 只在 running 时走时钟；paused / idle 不空转。 */
  useEffect(() => {
    if (state.status !== "running") return;
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 250);
    const onVisible = () => tick();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [state.status]);

  /** 到点收尾：先切状态（避免重复触发），再写记录。 */
  useEffect(() => {
    if (state.status !== "running") return;
    if (now < state.endsAt) return;
    const key = `${state.sessionStartedAt}:${state.endsAt}`;
    if (completedKey.current === key) return;
    completedKey.current = key;

    const result = completionOf(state, now, settingsRef.current);
    if (!result) return;
    setState(result.next);
    void persistSession(result.record).then((ok) => {
      if (ok) callbacks.current.onCompleted?.(result.record);
      else callbacks.current.onPersistError?.();
    });
  }, [now, state]);

  /** 结束前 10 秒：每轮只响一次。 */
  useEffect(() => {
    if (state.status !== "running") return;
    if (!isInFinalCountdown(state, now)) return;
    const key = `${state.sessionStartedAt}:${state.endsAt}`;
    if (countdownKey.current === key) return;
    countdownKey.current = key;
    callbacks.current.onCountdown?.();
  }, [now, state]);

  const start = useCallback(() => {
    const at = Date.now();
    setNow(at);
    setState((current) => (current.status === "idle" ? startTimer(current, at) : current));
  }, []);

  const pause = useCallback(() => {
    const at = Date.now();
    setNow(at);
    setState((current) => (current.status === "running" ? pauseTimer(current, at) : current));
  }, []);

  const resume = useCallback(() => {
    const at = Date.now();
    setNow(at);
    setState((current) => (current.status === "paused" ? resumeTimer(current, at) : current));
  }, []);

  const stop = useCallback(() => {
    if (state.status === "idle") return;
    const at = Date.now();
    const result = interruptOf(state, at, settingsRef.current);
    setNow(at);
    setState(result.next);
    if (!result.record) return;
    const record = result.record;
    void persistSession(record).then((ok) => {
      if (ok) callbacks.current.onInterrupted?.(record);
      else callbacks.current.onPersistError?.();
    });
  }, [state]);

  const skip = useCallback(() => {
    const at = Date.now();
    setNow(at);
    setState((current) => skipPhase(current, settingsRef.current));
  }, []);

  const reset = useCallback(() => {
    setNow(Date.now());
    setState((current) => {
      const next = createIdleTimer({
        kind: "focus",
        planMin: settingsRef.current.focusMin,
        round: current.round,
        taskId: current.taskId,
      });
      completedKey.current = null;
      countdownKey.current = null;
      return next;
    });
  }, []);

  const setTaskId = useCallback((taskId: string | null) => {
    setState((current) => ({ ...current, taskId }));
  }, []);

  const derived = useMemo(() => {
    const remaining = remainingOf(state, now);
    const total = totalOf(state);
    const focused = focusedOf(state, now);
    return {
      remainingMs: remaining,
      totalMs: total,
      focusedMs: focused,
      ratio: progressOf(state, now),
    };
  }, [state, now]);

  return {
    state,
    now,
    ...derived,
    isIdle: state.status === "idle",
    isRunning: state.status === "running",
    isPaused: state.status === "paused",
    start,
    pause,
    resume,
    stop,
    skip,
    reset,
    setTaskId,
  };
}
