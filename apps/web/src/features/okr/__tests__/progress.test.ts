import { describe, expect, it } from "vitest";
import { GoalSchema, KeyResultSchema } from "@detter/shared";
import type { Goal, KeyResult } from "@detter/shared";
import {
  formatKrNumber,
  krPercent,
  krRatio,
  krTargetLabel,
  krValueAtRatio,
  krValueLabel,
  milestoneTally,
  objectiveProgress,
} from "../progress";

/**
 * KR 四种度量算法 + Objective 均值。
 * 这些数字同时出现在 OKR 页和复盘页，改一处必须两边一起对。
 */

function makeKr(patch: Partial<KeyResult> & { id: string }): KeyResult {
  return KeyResultSchema.parse({
    okrId: "okr-1",
    title: `KR ${patch.id}`,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  });
}

function makeGoal(patch: Partial<Goal> & { id: string }): Goal {
  return GoalSchema.parse({
    title: `目标 ${patch.id}`,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  });
}

describe("KR 进度：percent", () => {
  it("用 (cur - start) / (target - start)，并夹在 0..1", () => {
    const kr = makeKr({
      id: "p1",
      metricType: "percent",
      startValue: 20,
      targetValue: 80,
      currentValue: 50,
    });
    expect(krRatio(kr)).toBeCloseTo(0.5);
    expect(krPercent(kr)).toBe(50);

    expect(krRatio({ ...kr, currentValue: 20 })).toBe(0);
    expect(krRatio({ ...kr, currentValue: 80 })).toBe(1);
    expect(krRatio({ ...kr, currentValue: 10 })).toBe(0);
    expect(krRatio({ ...kr, currentValue: 90 })).toBe(1);
  });

  it("起点等于目标时退化成 0 / 100，不产生 NaN", () => {
    const kr = makeKr({
      id: "p2",
      metricType: "percent",
      startValue: 100,
      targetValue: 100,
      currentValue: 99,
    });
    expect(krRatio(kr)).toBe(0);
    expect(krRatio({ ...kr, currentValue: 100 })).toBe(1);
  });
});

describe("KR 进度：number", () => {
  it("用 current / target；目标 ≤ 0 时只区分有没有推进", () => {
    const kr = makeKr({ id: "n1", metricType: "number", targetValue: 20, currentValue: 8 });
    expect(krRatio(kr)).toBeCloseTo(0.4);
    expect(krPercent(kr)).toBe(40);
    expect(krRatio({ ...kr, currentValue: 30 })).toBe(1);
    expect(krRatio({ ...kr, targetValue: 0, currentValue: 0 })).toBe(0);
    expect(krRatio({ ...kr, targetValue: 0, currentValue: 1 })).toBe(1);
  });
});

describe("KR 进度：boolean", () => {
  it("0 / 1 两态", () => {
    const kr = makeKr({ id: "b1", metricType: "boolean", targetValue: 1, currentValue: 0 });
    expect(krRatio(kr)).toBe(0);
    expect(krPercent(kr)).toBe(0);
    expect(krRatio({ ...kr, currentValue: 1 })).toBe(1);
    expect(krPercent({ ...kr, currentValue: 1 })).toBe(100);
  });
});

describe("KR 进度：milestone", () => {
  const goal = makeGoal({
    id: "g1",
    milestones: [
      { id: "m1", title: "一", done: true },
      { id: "m2", title: "二", done: false },
      { id: "m3", title: "三", done: true },
      { id: "m4", title: "四", done: false },
    ],
  });

  it("已完成里程碑 / 总数；linkedGoalIds 与 goal.krId 都算关联", () => {
    const kr = makeKr({
      id: "ms1",
      metricType: "milestone",
      linkedGoalIds: ["g1"],
      startValue: 0,
      targetValue: 1,
      currentValue: 0,
    });
    expect(milestoneTally(kr, [goal])).toEqual({ done: 2, total: 4 });
    expect(krRatio(kr, [goal])).toBe(0.5);

    const inverse = makeKr({ id: "ms2", metricType: "milestone" });
    const linkedByGoal = { ...goal, krId: "ms2" };
    expect(milestoneTally(inverse, [linkedByGoal])).toEqual({ done: 2, total: 4 });
  });

  it("没有关联目标或没有里程碑时是 0，不是 NaN", () => {
    const kr = makeKr({ id: "ms3", metricType: "milestone" });
    expect(krRatio(kr)).toBe(0);
    expect(krRatio(kr, [makeGoal({ id: "g2" })])).toBe(0);
  });

  it("忽略已删除的目标", () => {
    const kr = makeKr({ id: "ms4", metricType: "milestone", linkedGoalIds: ["g1"] });
    const deleted = { ...goal, deletedAt: 10 };
    expect(krRatio(kr, [deleted])).toBe(0);
  });
});

describe("Objective 进度 = KR 均值", () => {
  it("四条 KR 的均值", () => {
    const krs = [
      makeKr({ id: "a", metricType: "percent", startValue: 0, targetValue: 100, currentValue: 50 }),
      makeKr({ id: "b", metricType: "number", targetValue: 10, currentValue: 10 }),
      makeKr({ id: "c", metricType: "boolean", currentValue: 0 }),
      makeKr({ id: "d", metricType: "number", targetValue: 5, currentValue: 2 }),
    ];
    const progress = objectiveProgress(krs);
    expect(progress).not.toBeNull();
    expect(progress?.ratio).toBeCloseTo((0.5 + 1 + 0 + 0.4) / 4);
    expect(progress?.percent).toBe(48);
    expect(progress?.count).toBe(4);
  });

  it("没有 KR 时返回 null（UI 显示 —，不是 0%）", () => {
    expect(objectiveProgress([])).toBeNull();
  });
});

describe("拖拽比例 ↔ 数值", () => {
  const percent = makeKr({
    id: "v1",
    metricType: "percent",
    startValue: 20,
    targetValue: 80,
    currentValue: 20,
  });
  const number = makeKr({ id: "v2", metricType: "number", targetValue: 3, currentValue: 0 });

  it("percent 映射回起点与目标之间", () => {
    expect(krValueAtRatio(percent, 0)).toBe(20);
    expect(krValueAtRatio(percent, 0.6)).toBe(56);
    expect(krValueAtRatio(percent, 1)).toBe(80);
  });

  it("number 按 target × ratio，保留两位小数", () => {
    expect(krValueAtRatio(number, 0.6)).toBe(1.8);
    expect(krValueAtRatio(number, 1)).toBe(3);
    expect(krValueAtRatio(number, 0.333)).toBe(1);
  });

  it("boolean 过半即完成；milestone 不随拖拽改变", () => {
    expect(krValueAtRatio({ ...number, metricType: "boolean" }, 0.4)).toBe(0);
    expect(krValueAtRatio({ ...number, metricType: "boolean" }, 0.6)).toBe(1);
    const milestone = makeKr({ id: "v3", metricType: "milestone", currentValue: 7 });
    expect(krValueAtRatio(milestone, 0.9)).toBe(7);
  });
});

describe("KR 文案", () => {
  it("数值展示与单位", () => {
    const number = makeKr({
      id: "t1",
      metricType: "number",
      targetValue: 20,
      currentValue: 8,
      unit: "篇",
    });
    expect(krValueLabel(number)).toBe("8 / 20 篇");
    expect(krTargetLabel(number)).toBe("目标 20 篇");

    const percent = makeKr({
      id: "t2",
      metricType: "percent",
      startValue: 0,
      targetValue: 100,
      currentValue: 42,
      unit: "%",
    });
    expect(krValueLabel(percent)).toBe("42%");
    expect(krTargetLabel(percent)).toBe("0% → 100%");

    const bool = makeKr({ id: "t3", metricType: "boolean", currentValue: 1 });
    expect(krValueLabel(bool)).toBe("已完成");

    const milestone = makeKr({
      id: "t4",
      metricType: "milestone",
      linkedGoalIds: ["g1"],
    });
    const goal = makeGoal({
      id: "g1",
      milestones: [
        { id: "m1", title: "一", done: true },
        { id: "m2", title: "二", done: false },
      ],
    });
    expect(krValueLabel(milestone, [goal])).toBe("1 / 2 里程碑");
  });

  it("数字格式化不带多余的小数位", () => {
    expect(formatKrNumber(12)).toBe("12");
    expect(formatKrNumber(1.8)).toBe("1.8");
    expect(formatKrNumber(1.234)).toBe("1.23");
  });
});
