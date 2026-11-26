import { describe, expect, it } from "vitest";
import {
  GoalSchema,
  KeyResultSchema,
  KpiEntrySchema,
  KpiSchema,
  OkrSchema,
  PomodoroSessionSchema,
  TaskSchema,
  dayKey,
} from "@detter/shared";
import type { Goal, KeyResult, Kpi, KpiEntry, Okr, PomodoroSession, Task } from "@detter/shared";
import {
  aggregateDailySeries,
  autoDailySeries,
  computeReviewMetrics,
  dayKeysOfRange,
  kpiAchievementRatio,
  kpiWindowScale,
  manualDailySeries,
  parseReviewQuery,
  reviewRange,
} from "../metrics";

/**
 * 复盘指标：每个数字对应报告里的一条公式。
 * 这里刻意用「可手算」的样本：2 完成 / 4 新增 / 1 逾期 / 3 个番茄 / 4 个 KPI。
 */

const NOW = new Date(2026, 10, 26, 15, 0, 0).getTime();

function at(month: number, day: number, hour = 9, minute = 0): number {
  return new Date(2026, month - 1, day, hour, minute, 0).getTime();
}

function makeTask(patch: Partial<Task> & { id: string }): Task {
  return TaskSchema.parse({ title: `任务 ${patch.id}`, createdAt: at(11, 24), updatedAt: 1, ...patch });
}

function makeGoal(patch: Partial<Goal> & { id: string }): Goal {
  return GoalSchema.parse({ title: `目标 ${patch.id}`, createdAt: 1, updatedAt: 1, ...patch });
}

function makeKr(patch: Partial<KeyResult> & { id: string }): KeyResult {
  return KeyResultSchema.parse({
    okrId: "okr1",
    title: `KR ${patch.id}`,
    metricType: "number",
    startValue: 0,
    targetValue: 3,
    currentValue: 0,
    unit: "次",
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  });
}

function makeKpi(patch: Partial<Kpi> & { id: string }): Kpi {
  return KpiSchema.parse({
    name: `KPI ${patch.id}`,
    unit: "次",
    targetValue: 1,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  });
}

function makeEntry(patch: Partial<KpiEntry> & { id: string }): KpiEntry {
  return KpiEntrySchema.parse({
    kpiId: "kpi1",
    date: "2026-11-24",
    value: 0,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  });
}

function makeSession(patch: Partial<PomodoroSession> & { id: string }): PomodoroSession {
  return PomodoroSessionSchema.parse({
    kind: "focus",
    startedAt: at(11, 24),
    planMin: 25,
    actualMin: 25,
    completed: true,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  });
}

const tasks: Task[] = [
  makeTask({
    id: "t1",
    title: "写完周报",
    createdAt: at(11, 24, 10),
    completedAt: at(11, 25, 18),
    status: "done",
    quadrant: 1,
    goalId: "g1",
    okrId: "okr1",
    krId: "kr1",
  }),
  makeTask({
    id: "t2",
    title: "整理笔记",
    createdAt: at(11, 20, 9),
    completedAt: at(11, 26, 9),
    status: "done",
    quadrant: 3,
    goalId: "g1",
  }),
  makeTask({
    id: "t3",
    title: "交高数作业",
    createdAt: at(11, 24, 9),
    status: "todo",
    quadrant: 1,
    dueAt: at(11, 25, 12),
  }),
  makeTask({
    id: "t4",
    title: "准备英语听力",
    createdAt: at(11, 26, 9),
    status: "todo",
    quadrant: 2,
    dueAt: at(11, 28, 18),
    goalId: "g1",
    okrId: "okr1",
  }),
  makeTask({
    id: "t5",
    title: "旧账单",
    createdAt: at(11, 22, 9),
    status: "todo",
    quadrant: 2,
    dueAt: at(11, 20, 9),
  }),
  makeTask({
    id: "t6",
    title: "放弃的事",
    createdAt: at(11, 24, 9),
    status: "dropped",
    quadrant: 4,
    dueAt: at(11, 24, 12),
  }),
  makeTask({
    id: "t7",
    title: "日程",
    kind: "event",
    createdAt: at(11, 24, 9),
    status: "todo",
    quadrant: 1,
    dueAt: at(11, 24, 12),
  }),
];

const goals: Goal[] = [
  makeGoal({ id: "g1", title: "高数不挂科", color: "#6355F6" }),
  makeGoal({
    id: "g2",
    title: "读完三本书",
    milestones: [
      { id: "m1", title: "第一本", done: true },
      { id: "m2", title: "第二本", done: false },
      { id: "m3", title: "第三本", done: false },
    ],
  }),
  makeGoal({ id: "g3", title: "模板目标", kind: "template" }),
];

const okrs: Okr[] = [
  OkrSchema.parse({
    id: "okr1",
    title: "把英语听力拉上来",
    period: "week",
    periodStart: "2026-11-23",
    periodEnd: "2026-11-29",
    createdAt: 1,
    updatedAt: 1,
  }),
];

const krs: KeyResult[] = [
  makeKr({ id: "kr1", title: "每周精听 3 次", targetValue: 3, currentValue: 2, linkedTaskIds: ["t1", "t4"] }),
  makeKr({
    id: "kr2",
    title: "精听 20 篇",
    metricType: "percent",
    startValue: 0,
    targetValue: 100,
    currentValue: 40,
  }),
];

const kpis: Kpi[] = [
  makeKpi({ id: "kpi1", name: "健身", targetValue: 3, period: "week", aggregation: "sum" }),
  makeKpi({ id: "kpi2", name: "读书", unit: "页", targetValue: 200, period: "month", aggregation: "sum" }),
  makeKpi({ id: "kpi3", name: "喝水", unit: "杯", targetValue: 8, period: "day", aggregation: "sum" }),
  makeKpi({
    id: "kpi4",
    name: "专注",
    unit: "分钟",
    targetValue: 60,
    period: "week",
    autoSource: "pomodoro_min",
  }),
  makeKpi({
    id: "kpi5",
    name: "完成任务",
    unit: "项",
    targetValue: 2,
    period: "week",
    autoSource: "tasks_done",
  }),
  makeKpi({ id: "kpi6", name: "停用的 KPI", targetValue: 1, active: false }),
];

const kpiEntries: KpiEntry[] = [
  makeEntry({ id: "e1", kpiId: "kpi1", date: "2026-11-24", value: 1 }),
  makeEntry({ id: "e2", kpiId: "kpi1", date: "2026-11-25", value: 1 }),
  makeEntry({ id: "e3", kpiId: "kpi1", date: "2026-11-26", value: 1 }),
  makeEntry({ id: "e4", kpiId: "kpi2", date: "2026-11-24", value: 60 }),
  makeEntry({ id: "e5", kpiId: "kpi2", date: "2026-11-25", value: 60 }),
  makeEntry({ id: "e6", kpiId: "kpi3", date: "2026-11-24", value: 3 }),
  makeEntry({ id: "e7", kpiId: "kpi3", date: "2026-11-25", value: 4 }),
  makeEntry({ id: "e8", kpiId: "kpi3", date: "2026-11-26", value: 3 }),
  // 周期外的打卡不能算进本周
  makeEntry({ id: "e9", kpiId: "kpi1", date: "2026-11-20", value: 99 }),
];

const sessions: PomodoroSession[] = [
  makeSession({ id: "p1", startedAt: at(11, 24, 9), actualMin: 25 }),
  makeSession({ id: "p2", startedAt: at(11, 25, 9), actualMin: 30 }),
  makeSession({ id: "p3", startedAt: at(11, 26, 9), actualMin: 25 }),
  makeSession({ id: "p4", kind: "short_break", startedAt: at(11, 24, 10), actualMin: 5, planMin: 5 }),
  makeSession({ id: "p5", startedAt: at(11, 23, 9), actualMin: 20, completed: false }),
];

function metricsOf(baselineGoals?: Record<string, number>) {
  const range = reviewRange("week", 0, NOW);
  return computeReviewMetrics({
    tasks,
    goals,
    okrs,
    krs,
    kpis,
    kpiEntries,
    sessions,
    range,
    now: NOW,
    baselineGoals,
  });
}

describe("reviewRange 周期", () => {
  it("本周：周一开始，periodKey 可用于快照键", () => {
    const range = reviewRange("week", 0, NOW);
    expect(range.startKey).toBe("2026-11-23");
    expect(range.endKey).toBe("2026-11-29");
    expect(range.label).toBe("11/23 - 11/29");
    expect(range.periodKey).toBe("week:2026-11-23");
    expect(dayKey(range.start)).toBe("2026-11-23");
  });

  it("上周 / 本月 / 上月；月末减一个月不溢出", () => {
    expect(reviewRange("week", -1, NOW).startKey).toBe("2026-11-16");
    const month = reviewRange("month", 0, NOW);
    expect(month.startKey).toBe("2026-11-01");
    expect(month.periodKey).toBe("month:2026-11");

    const decemberEnd = new Date(2026, 11, 31, 23, 0, 0).getTime();
    expect(reviewRange("month", -1, decemberEnd).startKey).toBe("2026-11-01");
  });

  it("解析 URL 参数：range/offset，非法值退回本周", () => {
    expect(parseReviewQuery("?range=month")).toEqual({ type: "month", offset: 0 });
    expect(parseReviewQuery("?range=last-month")).toEqual({ type: "month", offset: -1 });
    expect(parseReviewQuery("?range=week&offset=-1")).toEqual({ type: "week", offset: -1 });
    expect(parseReviewQuery("?range=month&offset=3")).toEqual({ type: "month", offset: 0 });
    expect(parseReviewQuery("?range=nonsense")).toEqual({ type: "week", offset: 0 });
    expect(parseReviewQuery("")).toEqual({ type: "week", offset: 0 });
  });
});

describe("任务指标", () => {
  it("完成 / 新增 / 逾期 / 完成率 / 待办", () => {
    const metrics = metricsOf();
    expect(metrics.tasks.done).toBe(2);
    expect(metrics.tasks.created).toBe(4);
    expect(metrics.tasks.overdue).toBe(1);
    expect(metrics.tasks.open).toBe(3);
    expect(metrics.tasks.completionRate).toBeCloseTo(0.5);
    expect(metrics.tasks.todo.map((item) => item.id)).toEqual(["t3", "t5", "t4"]);
  });

  it("四象限按「新增 ∪ 完成」去重计数，Q2 占比按同一分母", () => {
    const metrics = metricsOf();
    expect(metrics.tasks.touched).toBe(5);
    expect(metrics.tasks.quadrants).toEqual({ 1: 2, 2: 1, 3: 1, 4: 1 });
    expect(metrics.tasks.q2Share).toBe(20);
    expect(metrics.tasks.createdByQuadrant).toEqual({ 1: 2, 2: 1, 3: 0, 4: 1 });
    expect(metrics.tasks.overdueByQuadrant).toEqual({ 1: 1, 2: 0, 3: 0, 4: 0 });
  });

  it("日程（event）与 dropped 不计入完成 / 逾期", () => {
    const metrics = metricsOf();
    expect(metrics.tasks.done).toBe(2);
    expect(metrics.tasks.overdue).toBe(1);
  });

  it("空数据时完成率为 null，不显示 0%", () => {
    const range = reviewRange("week", 0, NOW);
    const metrics = computeReviewMetrics({
      tasks: [],
      goals: [],
      okrs: [],
      krs: [],
      kpis: [],
      kpiEntries: [],
      sessions: [],
      range,
      now: NOW,
    });
    expect(metrics.tasks.completionRate).toBeNull();
    expect(metrics.tasks.todo).toEqual([]);
    expect(metrics.kpiAchieved).toBe(0);
    expect(metrics.goals).toEqual([]);
    expect(metrics.okrs).toEqual([]);
  });
});

describe("专注指标", () => {
  it("分钟数所有 focus 记录，番茄只数已完成的（与专注页一致）", () => {
    const metrics = metricsOf();
    expect(metrics.focus.minutes).toBe(100);
    expect(metrics.focus.sessions).toBe(3);
    expect(metrics.focus.days).toBe(3);
    expect(metrics.focus.streakDays).toBe(3);
  });
});

describe("KPI 指标", () => {
  it("聚合、目标折算、达成率", () => {
    const metrics = metricsOf();
    expect(metrics.kpis.map((kpi) => kpi.id)).toEqual(["kpi1", "kpi2", "kpi3", "kpi4", "kpi5"]);

    const fitness = metrics.kpis.find((kpi) => kpi.id === "kpi1")!;
    expect(fitness.value).toBe(3);
    expect(fitness.target).toBe(3);
    expect(fitness.ratio).toBe(1);
    expect(fitness.achieved).toBe(true);

    const reading = metrics.kpis.find((kpi) => kpi.id === "kpi2")!;
    expect(reading.value).toBe(120);
    expect(reading.target).toBe(200);
    expect(reading.percent).toBe(60);
    expect(reading.achieved).toBe(false);

    const water = metrics.kpis.find((kpi) => kpi.id === "kpi3")!;
    expect(water.value).toBe(10);
    expect(water.target).toBe(56);
    expect(water.percent).toBe(18);

    const focus = metrics.kpis.find((kpi) => kpi.id === "kpi4")!;
    expect(focus.value).toBe(100);
    expect(focus.percent).toBe(100);
    expect(focus.achieved).toBe(true);

    const doneKpi = metrics.kpis.find((kpi) => kpi.id === "kpi5")!;
    expect(doneKpi.value).toBe(2);
    expect(doneKpi.achieved).toBe(true);

    expect(metrics.kpiAchieved).toBe(3);
  });

  it("日/周/月目标按窗口折算：周窗口 日×7、周×1、月×1", () => {
    const week = reviewRange("week", 0, NOW);
    expect(kpiWindowScale("day", week)).toBe(7);
    expect(kpiWindowScale("week", week)).toBe(1);
    expect(kpiWindowScale("month", week)).toBe(1);

    const month = reviewRange("month", 0, NOW);
    expect(kpiWindowScale("day", month)).toBe(30);
    expect(kpiWindowScale("week", month)).toBe(4);
    expect(kpiWindowScale("month", month)).toBe(1);
  });

  it("日序列聚合：一天多次打卡先按天求和，再按 aggregation 合成", () => {
    const range = reviewRange("week", 0, NOW);
    const keys = dayKeysOfRange(range);
    expect(keys).toHaveLength(7);
    const entries = [
      makeEntry({ id: "a", date: "2026-11-24", value: 1 }),
      makeEntry({ id: "b", date: "2026-11-24", value: 2 }),
      makeEntry({ id: "c", date: "2026-11-25", value: 3 }),
      makeEntry({ id: "d", date: "2026-11-20", value: 99 }),
    ];
    const series = manualDailySeries("kpi1", entries, keys);
    expect(aggregateDailySeries("sum", series, keys)).toBe(6);
    expect(aggregateDailySeries("count", series, keys)).toBe(2);
    expect(aggregateDailySeries("max", series, keys)).toBe(3);
    expect(aggregateDailySeries("avg", series, keys)).toBe(3);
    expect(aggregateDailySeries("last", series, keys)).toBe(3);

    const empty = manualDailySeries("kpi1", [], keys);
    for (const mode of ["sum", "count", "max", "avg", "last"] as const) {
      expect(aggregateDailySeries(mode, empty, keys)).toBe(0);
    }
  });

  it("自动来源按 startedAt / completedAt 归日，focus 含未完成记录", () => {
    const range = reviewRange("week", 0, NOW);
    const keys = dayKeysOfRange(range);
    const minutes = autoDailySeries("pomodoro_min", sessions, tasks, keys);
    expect(aggregateDailySeries("sum", minutes, keys)).toBe(100);
    expect(minutes.dataDays.size).toBe(4);

    const focusCount = autoDailySeries("focus_sessions", sessions, tasks, keys);
    expect(aggregateDailySeries("sum", focusCount, keys)).toBe(4);

    const tasksDone = autoDailySeries("tasks_done", sessions, tasks, keys);
    expect(aggregateDailySeries("sum", tasksDone, keys)).toBe(2);
  });

  it("达成率：与 KPI 页同口径（up=值/目标，down=2−值/目标）", () => {
    expect(kpiAchievementRatio(3, 3, "up")).toBe(1);
    expect(kpiAchievementRatio(2, 3, "up")).toBeCloseTo(2 / 3);
    expect(kpiAchievementRatio(4, 3, "up")).toBe(1);
    expect(kpiAchievementRatio(120, 200, "up")).toBe(0.6);
    expect(kpiAchievementRatio(3, 3, "down")).toBe(1);
    expect(kpiAchievementRatio(2, 3, "down")).toBe(1);
    expect(kpiAchievementRatio(5, 3, "down")).toBeCloseTo(1 / 3);
    expect(kpiAchievementRatio(6, 3, "down")).toBe(0);
    expect(kpiAchievementRatio(0, 0, "down")).toBe(1);
    expect(kpiAchievementRatio(1, 0, "down")).toBe(0);
    expect(kpiAchievementRatio(1, 0, "up")).toBe(1);
    expect(kpiAchievementRatio(0, 0, "up")).toBe(0);
    expect(kpiAchievementRatio(null, 10, "up")).toBeNull();
  });
});

describe("目标与 OKR 指标", () => {
  it("目标进度 = done/total；无任务时退回里程碑；模板不计", () => {
    const metrics = metricsOf();
    const g1 = metrics.goals.find((goal) => goal.id === "g1")!;
    expect(g1.taskTotal).toBe(3);
    expect(g1.taskDone).toBe(2);
    expect(g1.progress).toBe(67);

    const g2 = metrics.goals.find((goal) => goal.id === "g2")!;
    expect(g2.taskTotal).toBe(0);
    expect(g2.milestoneTotal).toBe(3);
    expect(g2.milestoneDone).toBe(1);
    expect(g2.progress).toBe(33);

    expect(metrics.goals.some((goal) => goal.id === "g3")).toBe(false);
  });

  it("delta 来自上一次快照；没有基线时为 null", () => {
    const metrics = metricsOf({ g1: 50 });
    expect(metrics.goals.find((goal) => goal.id === "g1")!.delta).toBe(17);
    expect(metrics.goals.find((goal) => goal.id === "g2")!.delta).toBeNull();
  });

  it("OKR 进度 = KR 均值，关联任务按 okrId/krId 统计", () => {
    const metrics = metricsOf();
    expect(metrics.okrs).toHaveLength(1);
    const okr = metrics.okrs[0]!;
    expect(okr.krCount).toBe(2);
    expect(okr.progress).toBe(53);
    expect(okr.taskTotal).toBe(2);
    expect(okr.taskDone).toBe(1);
    expect(okr.krs.map((kr) => kr.percent)).toEqual([67, 40]);
  });

  it("区间外或已删除的 Objective 不出现", () => {
    const range = reviewRange("week", 0, NOW);
    const otherWeek = OkrSchema.parse({
      id: "okr2",
      title: "上一周的目标",
      period: "week",
      periodStart: "2026-11-16",
      periodEnd: "2026-11-22",
      createdAt: 1,
      updatedAt: 1,
    });
    const metrics = computeReviewMetrics({
      tasks: [],
      goals: [],
      okrs: [otherWeek],
      krs: [],
      kpis: [],
      kpiEntries: [],
      sessions: [],
      range,
      now: NOW,
    });
    expect(metrics.okrs).toEqual([]);
  });
});
