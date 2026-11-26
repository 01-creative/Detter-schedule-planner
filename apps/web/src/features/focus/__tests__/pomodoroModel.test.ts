import { beforeEach, describe, expect, it } from "vitest";
import { dayKey } from "@detter/shared";
import {
  DEFAULT_FOCUS_SETTINGS,
  completionOf,
  createIdleTimer,
  focusedOf,
  formatClock,
  interruptOf,
  isExpired,
  nextPhase,
  pauseTimer,
  remainingOf,
  resumeTimer,
  sanitizeSettings,
  skipPhase,
  startTimer,
} from "../pomodoroModel";
import { parseTimerState } from "../focusStorage";
import { computeFocusStats, focusStreak } from "../pomodoroStats";
import { PomodoroSessionSchema } from "@detter/shared";

/**
 * 番茄钟计时模型。
 *
 * 最重要的三条：
 * 1. 剩余时间永远由 endsAt 反算，刷新 / 切后台后不许漂移；
 * 2. 暂停 30 秒再继续，专注时长不被吃掉（也不能把暂停算成专注）；
 * 3. 跨零点的一轮，记录的时间与归属日期都正确。
 */

const settings = DEFAULT_FOCUS_SETTINGS;
const MIN = 60_000;

function at(y: number, m: number, d: number, h = 0, min = 0): number {
  return new Date(y, m - 1, d, h, min, 0, 0).getTime();
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("计时反算（endsAt 是唯一真相）", () => {
  it("任意时刻的剩余都由 endsAt 反算，不累加", () => {
    const t0 = at(2026, 11, 26, 9, 0);
    const state = startTimer(createIdleTimer({ planMin: 25 }), t0);

    expect(remainingOf(state, t0)).toBe(25 * MIN);
    expect(remainingOf(state, t0 + 5_000)).toBe(25 * MIN - 5_000);
    // 切后台 10 分钟：只影响「什么时候发现」，不影响剩余量
    expect(remainingOf(state, t0 + 10 * MIN)).toBe(15 * MIN);
    expect(isExpired(state, t0 + 10 * MIN)).toBe(false);
    expect(isExpired(state, t0 + 25 * MIN)).toBe(true);
    expect(remainingOf(state, t0 + 40 * MIN)).toBe(0);
  });

  it("刷新页面后（状态从 localStorage 还原）剩余时间误差为 0", () => {
    const t0 = at(2026, 11, 26, 9, 0);
    const state = startTimer(createIdleTimer({ planMin: 25 }), t0);

    // 模拟落盘 → 刷新 → 重新解析
    const restored = parseTimerState(JSON.stringify(state));
    expect(restored).toEqual(state);

    const reloadAt = t0 + 30_000;
    expect(remainingOf(restored!, reloadAt)).toBe(remainingOf(state, reloadAt));
    expect(remainingOf(restored!, reloadAt)).toBe(25 * MIN - 30_000);
    expect(formatClock(remainingOf(restored!, reloadAt))).toBe("24:30");
  });

  it("脏数据不会变成 NaN 倒计时", () => {
    expect(parseTimerState("not-json")).toBeNull();
    expect(parseTimerState({ status: "running", kind: "focus", planMin: 25 })).toBeNull();
    expect(parseTimerState({ ...startTimer(createIdleTimer({ planMin: 25 }), 1), planMin: 0 })).toBeNull();
  });
});

describe("暂停 / 恢复", () => {
  it("暂停 30 秒再继续，总专注时长不被吃掉", () => {
    const t0 = at(2026, 11, 26, 9, 0);
    const running = startTimer(createIdleTimer({ planMin: 25 }), t0);

    const paused = pauseTimer(running, t0 + 2 * MIN);
    expect(paused.status).toBe("paused");
    expect(paused.remainingMs).toBe(23 * MIN);
    expect(paused.interruptions).toBe(1);
    expect(focusedOf(paused, t0 + 2 * MIN)).toBe(2 * MIN);

    // 暂停 30 秒（这 30 秒不算专注）
    const resumed = resumeTimer(paused, t0 + 2 * MIN + 30_000);
    expect(remainingOf(resumed, t0 + 2 * MIN + 30_000)).toBe(23 * MIN);
    expect(focusedOf(resumed, t0 + 2 * MIN + 30_000)).toBe(2 * MIN);

    // 恢复 1 分钟后：专注 3 分钟，剩余 22 分钟
    expect(focusedOf(resumed, t0 + 3 * MIN + 30_000)).toBe(3 * MIN);
    expect(remainingOf(resumed, t0 + 3 * MIN + 30_000)).toBe(22 * MIN);
  });
});

describe("收尾：完成 / 中断 / 跨零点", () => {
  it("跨零点的一轮：endedAt 按计划结束时刻，归属开始那天", () => {
    const t0 = at(2026, 11, 25, 23, 50);
    const state = startTimer(createIdleTimer({ planMin: 25 }), t0);
    const plannedEnd = t0 + 25 * MIN; // 次日 00:15

    // 发现到点的时间晚了 8 秒（后台节流）：记录仍然按计划结束时刻
    const result = completionOf(state, plannedEnd + 8_000, settings);
    expect(result).not.toBeNull();
    expect(result!.record.startedAt).toBe(t0);
    expect(result!.record.endedAt).toBe(plannedEnd);
    expect(result!.record.actualMin).toBe(25);
    expect(result!.record.completed).toBe(true);
    expect(dayKey(result!.record.startedAt)).toBe("2026-11-25");
    expect(dayKey(result!.record.endedAt)).toBe("2026-11-26");
    expect(result!.next.status).toBe("idle");
    expect(result!.next.kind).toBe("short_break");
  });

  it("手动中断：completed=false，actualMin 按真实累计；不足 1 分钟不落库", () => {
    const t0 = at(2026, 11, 26, 9, 0);
    const state = startTimer(createIdleTimer({ planMin: 25 }), t0);

    const result = interruptOf(state, t0 + 7 * MIN, settings);
    expect(result.record?.completed).toBe(false);
    expect(result.record?.actualMin).toBe(7);
    expect(result.next.status).toBe("idle");
    expect(result.next.taskId).toBeNull();

    expect(interruptOf(state, t0 + 30_000, settings).record).toBeNull();
  });

  it("阶段流转：4 个番茄后长休息，长休息结束清空本轮", () => {
    expect(nextPhase("focus", 0, settings)).toEqual({ kind: "short_break", round: 1 });
    expect(nextPhase("focus", 2, settings)).toEqual({ kind: "short_break", round: 3 });
    expect(nextPhase("focus", 3, settings)).toEqual({ kind: "long_break", round: 4 });
    expect(nextPhase("short_break", 2, settings)).toEqual({ kind: "focus", round: 2 });
    expect(nextPhase("long_break", 4, settings)).toEqual({ kind: "focus", round: 0 });

    const idle = createIdleTimer({ planMin: 25, round: 1 });
    const skipped = skipPhase(idle, settings);
    expect(skipped.kind).toBe("short_break");
    expect(skipped.round).toBe(1);
    expect(skipped.planMin).toBe(settings.shortBreakMin);
  });
});

describe("设置与今日统计", () => {
  it("设置容错：脏值回落到默认，越界夹住", () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_FOCUS_SETTINGS);
    expect(sanitizeSettings({ focusMin: "abc" })).toEqual(DEFAULT_FOCUS_SETTINGS);
    expect(sanitizeSettings({ focusMin: 999, shortBreakMin: 0 })).toMatchObject({
      focusMin: 180,
      shortBreakMin: 1,
    });
    expect(sanitizeSettings({ focusMin: 45, longBreakEvery: 3 })).toMatchObject({
      focusMin: 45,
      longBreakEvery: 3,
    });
  });

  it("今日统计按 startedAt 归属，连续天数不受「今天还没开始」影响", () => {
    const now = at(2026, 11, 26, 10, 0);
    const make = (startedAt: number, actualMin: number, completed = true) =>
      PomodoroSessionSchema.parse({
        id: `s-${startedAt}`,
        kind: "focus",
        startedAt,
        endedAt: startedAt + actualMin * MIN,
        actualMin,
        planMin: 25,
        completed,
        interruptions: completed ? 0 : 1,
        createdAt: 1,
        updatedAt: 1,
      });

    const sessions = [
      make(at(2026, 11, 26, 9, 0), 25),
      make(at(2026, 11, 26, 10, 0), 10, false),
      make(at(2026, 11, 25, 20, 0), 25),
      make(at(2026, 11, 24, 20, 0), 25),
      // 前一天 23:50 开始、今天结束：算前一天
      make(at(2026, 11, 23, 23, 50), 25),
    ];

    const stats = computeFocusStats(sessions, now);
    // 今天两条：一条完成（25 分钟）、一条中断（10 分钟）
    expect(stats.completed).toBe(1);
    expect(stats.minutes).toBe(35);
    expect(stats.interruptions).toBe(1);
    expect(stats.sessions).toBe(2);
    // 26 / 25 / 24 / 23 四天连续
    expect(focusStreak(sessions, now)).toBe(4);
  });
});
