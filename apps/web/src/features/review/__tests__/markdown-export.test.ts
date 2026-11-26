import { describe, expect, it } from "vitest";
import {
  GoalSchema,
  KeyResultSchema,
  KpiEntrySchema,
  KpiSchema,
  OkrSchema,
  PomodoroSessionSchema,
  TaskSchema,
} from "@detter/shared";
import type { Goal, KeyResult, Kpi, KpiEntry, Okr, PomodoroSession, Task } from "@detter/shared";
import { computeReviewMetrics, reviewRange } from "../metrics";
import { buildReviewMarkdown } from "../markdown";
import { buildReviewNarrative } from "../narrative";

/**
 * Markdown 导出：给 AI 读的版本。
 * 重点锁三件事：中文标点、表格对齐行、空数据不产出 NaN/undefined。
 */

const NOW = new Date(2026, 10, 26, 15, 0, 0).getTime();

function at(month: number, day: number, hour = 9): number {
  return new Date(2026, month - 1, day, hour, 0, 0).getTime();
}

const tasks: Task[] = [
  TaskSchema.parse({
    id: "t1",
    title: "写完周报",
    goalId: "g1",
    createdAt: at(11, 24),
    completedAt: at(11, 25),
    status: "done",
    quadrant: 2,
    updatedAt: 1,
  }),
  TaskSchema.parse({
    id: "t2",
    title: "复习线代",
    createdAt: at(11, 22),
    completedAt: at(11, 26),
    status: "done",
    quadrant: 1,
    okrId: "o1",
    updatedAt: 1,
  }),
  TaskSchema.parse({
    id: "t3",
    title: "逾期任务",
    goalId: "g1",
    createdAt: at(11, 20),
    dueAt: at(11, 25, 12),
    status: "todo",
    quadrant: 1,
    updatedAt: 1,
  }),
  TaskSchema.parse({
    id: "t4",
    title: "待办事项",
    createdAt: at(11, 24),
    dueAt: at(11, 28, 18),
    status: "todo",
    quadrant: 3,
    updatedAt: 1,
  }),
];

const goals: Goal[] = [
  GoalSchema.parse({ id: "g1", title: "高数不挂科", color: "#6355F6", createdAt: 1, updatedAt: 1 }),
];

const okrs: Okr[] = [
  OkrSchema.parse({
    id: "o1",
    title: "把英语听力拉上来",
    period: "week",
    periodStart: "2026-11-23",
    periodEnd: "2026-11-29",
    color: "#8B5CF6",
    createdAt: 1,
    updatedAt: 1,
  }),
];

const krs: KeyResult[] = [
  KeyResultSchema.parse({
    id: "kr1",
    okrId: "o1",
    title: "每周精听 3 次",
    metricType: "number",
    targetValue: 5,
    currentValue: 3,
    unit: "次",
    createdAt: 1,
    updatedAt: 1,
  }),
  KeyResultSchema.parse({
    id: "kr2",
    okrId: "o1",
    title: "六级模考及格",
    metricType: "boolean",
    targetValue: 1,
    currentValue: 1,
    createdAt: 2,
    updatedAt: 2,
  }),
];

const kpis: Kpi[] = [
  KpiSchema.parse({ id: "k1", name: "健身", unit: "次", targetValue: 3, period: "week", createdAt: 1, updatedAt: 1 }),
  KpiSchema.parse({
    id: "k2",
    name: "读书",
    unit: "页",
    targetValue: 200,
    period: "month",
    createdAt: 2,
    updatedAt: 2,
  }),
];

const kpiEntries: KpiEntry[] = [
  KpiEntrySchema.parse({ id: "e1", kpiId: "k1", date: "2026-11-24", value: 1, createdAt: 1, updatedAt: 1 }),
  KpiEntrySchema.parse({ id: "e2", kpiId: "k1", date: "2026-11-25", value: 2, createdAt: 2, updatedAt: 2 }),
  KpiEntrySchema.parse({ id: "e3", kpiId: "k2", date: "2026-11-25", value: 120, createdAt: 3, updatedAt: 3 }),
];

const sessions: PomodoroSession[] = [
  PomodoroSessionSchema.parse({
    id: "p1",
    startedAt: at(11, 24),
    actualMin: 25,
    completed: true,
    createdAt: 1,
    updatedAt: 1,
  }),
  PomodoroSessionSchema.parse({
    id: "p2",
    startedAt: at(11, 25),
    actualMin: 35,
    completed: true,
    planMin: 35,
    createdAt: 2,
    updatedAt: 2,
  }),
];

function buildMarkdown(): string {
  const range = reviewRange("week", 0, NOW);
  const metrics = computeReviewMetrics({
    tasks,
    goals,
    okrs,
    krs,
    kpis,
    kpiEntries,
    sessions,
    range,
    now: NOW,
    baselineGoals: { g1: 40 },
  });
  return buildReviewMarkdown(metrics, buildReviewNarrative(metrics), {
    generatedAt: NOW,
    snapshotKey: `review.${range.periodKey}`,
  });
}

describe("复盘 Markdown", () => {
  const markdown = buildMarkdown();

  it("标题、周期与快照键", () => {
    expect(markdown.startsWith("# 本周复盘 · 11/23 - 11/29")).toBe(true);
    expect(markdown).toContain("- 数据范围：2026-11-23 → 2026-11-29 · 共 7 天");
    expect(markdown).toContain("- 快照键：review.week:2026-11-23");
  });

  it("概览数字与指标一致", () => {
    expect(markdown).toContain("| 完成 / 新增 | 2 / 2 项 |");
    expect(markdown).toContain("| 完成率 | 100% |");
    expect(markdown).toContain("| 逾期未完成 | 1 项 |");
    expect(markdown).toContain("| 经手任务 | 3 项 |");
    expect(markdown).toContain("| 专注 | 1小时 · 2 个番茄 |");
    expect(markdown).toContain("| KPI 达标 | 1 / 2 |");
  });

  it("四象限表有对齐行且占比按经手数算", () => {
    expect(markdown).toContain("| 象限 | 数量 | 占比 |");
    expect(markdown).toContain("| --- | ---: | ---: |");
    expect(markdown).toContain("| Q1 重要且紧急 | 1 | 33% |");
    expect(markdown).toContain("| Q2 重要不紧急 | 1 | 33% |");
    expect(markdown).toContain("| Q3 紧急不重要 | 1 | 33% |");
    expect(markdown).toContain("| Q4 不重要不紧急 | 0 | 0% |");
  });

  it("待办清单是 Markdown 复选框，逾期有标记", () => {
    expect(markdown).toContain("- [ ] Q1 · 逾期任务（11/25 12:00 已逾期）");
    expect(markdown).toContain("- [ ] Q3 · 待办事项（11/28 18:00）");
  });

  it("目标进展带 delta，OKR 带 KR 明细，KPI 带达成标记", () => {
    expect(markdown).toContain("| 高数不挂科 | 1/2 | 50% | +10 |");
    expect(markdown).toContain("### 把英语听力拉上来 · 80%");
    expect(markdown).toContain("- 每周精听 3 次：60%");
    expect(markdown).toContain("- 六级模考及格：100%");
    expect(markdown).toContain("| 健身 | 3 次 | 3 次 | 100% ✅ |");
    expect(markdown).toContain("| 读书 | 120 页 | 200 页 | 60% ⚠️ |");
  });

  it("规则生成的结论段落与页脚", () => {
    expect(markdown).toContain("## 做得好的");
    expect(markdown).toContain("## 值得注意的");
    expect(markdown).toContain("「高数不挂科」比上次快照推进了 10 个百分点。");
    expect(markdown).toContain("1 项逾期未完成");
    expect(markdown).toContain("由 Detter 生成 · 数据只来自本地库 · 不含任何外部请求");
  });

  it("没有 NaN / undefined / 空表格", () => {
    expect(markdown).not.toMatch(/NaN|undefined|null/);
    expect(markdown).not.toContain("|  |");
  });
});
