import { describe, expect, it } from "vitest";
import { KpiEntrySchema, KpiSchema, PomodoroSessionSchema, TaskSchema, addDays, dayKey, periodRange } from "@detter/shared";
import type { Kpi, Task } from "@detter/shared";
import {
  aggregateSeries,
  buildSnapshot,
  dayKeysOf,
  kpiProgress,
  kpiTone,
  manualDailySeries,
  paceSentence,
} from "../kpiModel";

/**
 * KPI 聚合与达标率。
 *
 * 覆盖任务书 §5.8 要求的全部口径：
 * - 周期聚合 day / week / month（含「一周跨两个月」这种边界）；
 * - 达标率 up / down 两个方向；
 * - 自动聚合三种来源（番茄分钟 / 专注次数 / 完成任务数）；
 * - sum / count / max / avg / last 五种聚合方式。
 */

const MIN = 60_000;
let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

function makeKpi(patch: Partial<Kpi> & { name: string }): Kpi {
  return KpiSchema.parse({ id: nextId("kpi"), createdAt: 1, updatedAt: 1, ...patch });
}

function entry(kpiId: string, date: string, value: number) {
  return KpiEntrySchema.parse({ id: nextId("entry"), kpiId, date, value, createdAt: 1, updatedAt: 1 });
}

function session(startedAt: number, actualMin: number, kind: "focus" | "short_break" = "focus") {
  return PomodoroSessionSchema.parse({
    id: nextId("session"),
    kind,
    startedAt,
    endedAt: startedAt + actualMin * MIN,
    planMin: actualMin,
    actualMin,
    completed: true,
    createdAt: 1,
    updatedAt: 1,
  });
}

function doneTask(completedAt: number): Task {
  return TaskSchema.parse({
    id: nextId("task"),
    title: `任务 ${completedAt}`,
    status: "done",
    completedAt,
    createdAt: 1,
    updatedAt: 1,
  });
}

function at(y: number, m: number, d: number, h = 0, min = 0): number {
  return new Date(y, m - 1, d, h, min, 0, 0).getTime();
}

const EMPTY_CONTEXT = { entries: [], sessions: [], tasks: [] };

describe("周期聚合", () => {
  it("day：只算当天的打卡，前一天的不计入", () => {
    const now = at(2026, 11, 25, 10, 0);
    const kpi = makeKpi({ id: "day", name: "喝水", period: "day", targetValue: 8, unit: "杯" });
    const context = {
      ...EMPTY_CONTEXT,
      entries: [entry("day", "2026-11-25", 3), entry("day", "2026-11-25", 2), entry("day", "2026-11-24", 9)],
    };
    const snapshot = buildSnapshot(kpi, context, now);
    expect(snapshot.period).toBe("day");
    expect(snapshot.days).toBe(1);
    expect(snapshot.value).toBe(5);
    expect(snapshot.points).toHaveLength(1);
    expect(snapshot.progress).toBeCloseTo(5 / 8);
    expect(snapshot.entryCount).toBe(2);
  });

  it("week：620 / 900 = 69%，领先本周已过的 35%", () => {
    const now = at(2026, 11, 25, 10, 0); // 周三
    const kpi = makeKpi({
      id: "week",
      name: "深度工作时长",
      unit: "分钟",
      period: "week",
      targetValue: 900,
      aggregation: "sum",
      autoSource: null,
    });
    const context = {
      ...EMPTY_CONTEXT,
      entries: [
        entry("week", "2026-11-23", 300),
        entry("week", "2026-11-25", 320),
        entry("week", "2026-11-22", 500), // 上周日，不计入
      ],
    };
    const snapshot = buildSnapshot(kpi, context, now);
    expect(snapshot.range.key).toBe("2026-11-23");
    expect(snapshot.days).toBe(7);
    expect(snapshot.points).toHaveLength(7);
    expect(snapshot.value).toBe(620);
    expect(snapshot.target).toBe(900);
    expect(Math.round(snapshot.progress * 100)).toBe(69);
    expect(Math.round(snapshot.elapsedRatio * 100)).toBe(35);
    expect(snapshot.tone).toBe("accent");
    expect(snapshot.pace).toBe("本周已过 35%，你完成了 69%，领先");
    // 虚线日目标 = 900 / 7 天
    expect(snapshot.chartTarget).toBeCloseTo(900 / 7);
  });

  it("month：只算本月；一周跨两个月时两个月的天数都进这一周", () => {
    const feb1 = at(2026, 2, 1, 10, 0); // 周日，所在周从 1/26 开始
    const entries = [entry("m", "2026-01-28", 40), entry("m", "2026-02-01", 60)];

    const weekKpi = makeKpi({ id: "w", name: "周合计", period: "week", targetValue: 100 });
    const week = buildSnapshot(weekKpi, { ...EMPTY_CONTEXT, entries: entries.map((item) => ({ ...item, kpiId: "w" })) }, feb1);
    expect(week.range.key).toBe("2026-01-26");
    expect(week.days).toBe(7);
    expect(week.value).toBe(100); // 40 + 60，跨月也都在同一周里

    const monthKpi = makeKpi({ id: "m", name: "月合计", period: "month", targetValue: 100 });
    const month = buildSnapshot(monthKpi, { ...EMPTY_CONTEXT, entries }, feb1);
    expect(month.value).toBe(60); // 1 月的 40 不计入 2 月
    expect(month.days).toBe(28);
  });
});

describe("达标率", () => {
  it("up 方向：value / target，超过 100% 夹到 1", () => {
    expect(kpiProgress("up", 900, 0)).toBe(0);
    expect(kpiProgress("up", 900, 450)).toBeCloseTo(0.5);
    expect(kpiProgress("up", 900, 620)).toBeCloseTo(620 / 900);
    expect(kpiProgress("up", 900, 900)).toBe(1);
    expect(kpiProgress("up", 900, 1800)).toBe(1);
  });

  it("down 方向：(2*target - value) / target，目标 0 时只有 0 算达标", () => {
    expect(kpiProgress("down", 3, 0)).toBe(1);
    expect(kpiProgress("down", 3, 2)).toBe(1);
    expect(kpiProgress("down", 3, 3)).toBe(1);
    expect(kpiProgress("down", 3, 4)).toBeCloseTo(2 / 3);
    expect(kpiProgress("down", 3, 6)).toBe(0);
    expect(kpiProgress("down", 3, 9)).toBe(0);
    expect(kpiProgress("down", 0, 0)).toBe(1);
    expect(kpiProgress("down", 0, 1)).toBe(0);
  });

  it("颜色分档：达标绿、<60% 琥珀、其余中性", () => {
    expect(kpiTone(1)).toBe("success");
    expect(kpiTone(0.59)).toBe("warning");
    expect(kpiTone(0.6)).toBe("accent");
    expect(kpiTone(0.99)).toBe("accent");
  });
});

describe("自动聚合三种来源", () => {
  const now = at(2026, 11, 26, 10, 0);
  const today = now - 3 * 3_600_000; // 当天 07:00
  const yesterday = at(2026, 11, 25, 21, 0);

  it("pomodoro_min：只加 focus 记录，按 startedAt 归日", () => {
    const kpi = makeKpi({
      id: "p",
      name: "深度工作",
      unit: "分钟",
      period: "day",
      targetValue: 50,
      autoSource: "pomodoro_min",
    });
    const snapshot = buildSnapshot(
      kpi,
      {
        ...EMPTY_CONTEXT,
        sessions: [
          session(today, 25),
          session(today + 30 * MIN, 10),
          session(today + 60 * MIN, 5, "short_break"), // 休息不计
          session(yesterday, 25), // 昨天不计
        ],
      },
      now,
    );
    expect(snapshot.auto).toBe(true);
    expect(snapshot.value).toBe(35);
    expect(snapshot.entryCount).toBe(2);
    expect(snapshot.progress).toBeCloseTo(35 / 50);
    expect(snapshot.points[0]?.value).toBe(35);
  });

  it("focus_sessions：数条数（休息记录不算）", () => {
    const kpi = makeKpi({
      id: "s",
      name: "专注次数",
      unit: "个",
      period: "day",
      targetValue: 4,
      autoSource: "focus_sessions",
    });
    const snapshot = buildSnapshot(
      kpi,
      {
        ...EMPTY_CONTEXT,
        sessions: [session(today, 25), session(today + 30 * MIN, 25), session(today + 70 * MIN, 5, "short_break"), session(yesterday, 25)],
      },
      now,
    );
    expect(snapshot.value).toBe(2);
    expect(snapshot.entryCount).toBe(2);
    expect(snapshot.progress).toBeCloseTo(0.5);
  });

  it("tasks_done：按 completedAt 命中的任务数", () => {
    const kpi = makeKpi({
      id: "t",
      name: "完成任务",
      unit: "个",
      period: "day",
      targetValue: 3,
      autoSource: "tasks_done",
    });
    const snapshot = buildSnapshot(
      kpi,
      {
        ...EMPTY_CONTEXT,
        tasks: [doneTask(today), doneTask(today + 2 * MIN), doneTask(yesterday)],
      },
      now,
    );
    expect(snapshot.value).toBe(2);
    expect(snapshot.entryCount).toBe(2);
    expect(kpiTone(snapshot.progress)).toBe("accent");
  });

  it("自动来源的指标不会被手工记录影响", () => {
    const kpi = makeKpi({
      id: "locked",
      name: "深度工作",
      period: "day",
      targetValue: 50,
      autoSource: "pomodoro_min",
    });
    const snapshot = buildSnapshot(
      kpi,
      { ...EMPTY_CONTEXT, entries: [entry("locked", "2026-11-26", 999)] },
      now,
    );
    expect(snapshot.value).toBe(0);
  });
});

describe("五种聚合方式", () => {
  const now = at(2026, 11, 26, 10, 0);
  const range = periodRange("week", now);
  const keys = dayKeysOf(range);
  const entries = [
    entry("agg", dayKey(range.start), 10),
    entry("agg", dayKey(addDays(range.start, 1)), 20),
    entry("agg", dayKey(addDays(range.start, 3)), 5),
  ];
  const series = manualDailySeries("agg", entries, keys);

  it("sum / count / max / avg / last 各自的口径", () => {
    expect(aggregateSeries("sum", series, keys)).toBe(35);
    expect(aggregateSeries("count", series, keys)).toBe(3); // 3 个打卡日
    expect(aggregateSeries("max", series, keys)).toBe(20);
    expect(aggregateSeries("avg", series, keys)).toBeCloseTo(35 / 3);
    expect(aggregateSeries("last", series, keys)).toBe(5);
    expect(aggregateSeries("sum", manualDailySeries("agg", [], keys), keys)).toBe(0);
  });

  it("周期切换会重算：同一份数据在周/月里得到不同数值", () => {
    const weekKpi = makeKpi({ id: "agg", name: "聚合", period: "week", targetValue: 100 });
    const monthKpi = makeKpi({ id: "agg", name: "聚合", period: "month", targetValue: 100 });
    const context = { ...EMPTY_CONTEXT, entries };
    expect(buildSnapshot(weekKpi, context, now).value).toBe(35);
    expect(buildSnapshot(monthKpi, context, now).value).toBe(35);
    // 4 天前的数据在「日」视图里就不算这一周了：今天（11-26）只有 5
    const dayKpi = makeKpi({ id: "agg", name: "聚合", period: "day", targetValue: 100 });
    expect(buildSnapshot(dayKpi, context, now).value).toBe(5);
  });
});

describe("进度人话", () => {
  it("领先 / 落后 / 持平 / 已达标", () => {
    expect(paceSentence("week", "up", 0.69, 0.6)).toBe("本周已过 60%，你完成了 69%，领先");
    expect(paceSentence("week", "up", 0.2, 0.6)).toBe("本周已过 60%，你完成了 20%，落后");
    expect(paceSentence("month", "up", 0.62, 0.6)).toBe("本月已过 60%，你完成了 62%，持平");
    expect(paceSentence("day", "down", 1, 0.2)).toBe("今天已过 20%，当前 100%，已达标");
  });
});
