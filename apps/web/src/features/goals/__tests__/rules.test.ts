import { describe, expect, it } from "vitest";
import { GoalSchema, TaskSchema } from "@detter/shared";
import type { Goal, Task } from "@detter/shared";
import {
  buildGoalTaskInput,
  buildTemplateTaskInputs,
  describeRrule,
  goalSubtitle,
  goalsOfKind,
  groupTasksByGoal,
  reorderGoals,
  sortGoals,
  summarizeGoalTasks,
  templateTitles,
  withSortIndexes,
} from "../rules";

/**
 * 目标栏的纯规则。
 * 重点覆盖两条验收：目标拖到象限生成什么、模板铺开生成什么。
 */

function makeGoal(patch: Partial<Goal> & { id: string }): Goal {
  return GoalSchema.parse({
    title: `目标 ${patch.id}`,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  });
}

function makeTask(patch: Partial<Task> & { id: string }): Task {
  return TaskSchema.parse({
    title: `任务 ${patch.id}`,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  });
}

describe("目标 → 任务", () => {
  it("标题取目标标题，带 goalId、落点象限与坐标，状态是 todo", () => {
    const goal = makeGoal({ id: "g1", title: "每周三次健身" });
    const input = buildGoalTaskInput(goal, { quadrant: 1, posX: 0.2, posY: 0.8 }, 1_700_000_000_000);

    expect(input.title).toBe("每周三次健身");
    expect(input.goalId).toBe("g1");
    expect(input.quadrant).toBe(1);
    expect(input.posX).toBe(0.2);
    expect(input.posY).toBe(0.8);
    expect(input.status).toBe("todo");
    expect(input.manualQuadrant).toBe(true);
    expect(input.source).toBe("goal");
    expect(input.createdAt).toBe(1_700_000_000_000);
    expect(typeof input.id).toBe("string");
    expect(input.id).not.toBe(goal.id);
  });

  it("越界坐标会被夹回 0..1", () => {
    const goal = makeGoal({ id: "g2" });
    const input = buildGoalTaskInput(goal, { quadrant: 2, posX: 3, posY: -2 });
    expect(input.posX).toBe(1);
    expect(input.posY).toBe(0);
  });
});

describe("模板铺开", () => {
  const goal = makeGoal({
    id: "g3",
    title: "周复盘模板",
    kind: "template",
    milestones: [
      { id: "m1", title: "回顾本周", done: false },
      { id: "m2", title: "写下三件好事", done: true },
      { id: "m3", title: "定下周目标", done: false },
    ],
  });

  it("有里程碑就按里程碑拆，没有就生成目标本身", () => {
    expect(templateTitles(goal)).toEqual(["回顾本周", "写下三件好事", "定下周目标"]);
    expect(templateTitles(makeGoal({ id: "g4", title: "空模板" }))).toEqual(["空模板"]);
  });

  it("每条任务都关联目标、来源是 template、坐标在 0..1 内", () => {
    const inputs = buildTemplateTaskInputs(goal, templateTitles(goal), 2, 1_000);
    expect(inputs).toHaveLength(3);
    expect(inputs.map((input) => input.title)).toEqual(["回顾本周", "写下三件好事", "定下周目标"]);
    for (const input of inputs) {
      expect(input.goalId).toBe(goal.id);
      expect(input.source).toBe("template");
      expect(input.quadrant).toBe(2);
      expect(input.posX).toBeGreaterThanOrEqual(0);
      expect(input.posX).toBeLessThanOrEqual(1);
      expect(input.posY).toBeGreaterThanOrEqual(0);
      expect(input.posY).toBeLessThanOrEqual(1);
    }
  });
});

describe("describeRrule", () => {
  it("把常见规则翻成人话", () => {
    expect(describeRrule("FREQ=DAILY")).toBe("每天");
    expect(describeRrule("FREQ=DAILY;INTERVAL=2")).toBe("每 2 天");
    expect(describeRrule("FREQ=WEEKLY;BYDAY=MO,WE,FR")).toBe("每周一、三、五");
    expect(describeRrule("FREQ=WEEKLY")).toBe("每周");
    expect(describeRrule("FREQ=MONTHLY;BYMONTHDAY=1")).toBe("每月 1 日");
    expect(describeRrule("FREQ=YEARLY")).toBe("每年");
    expect(describeRrule("RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3")).toBe("每周一 · 共 3 次");
    expect(describeRrule(null)).toBeNull();
    expect(describeRrule("")).toBeNull();
    expect(describeRrule("FREQ=SOMETHING")).toBe("按规则重复");
  });

  it("副标题按类型给出人话", () => {
    expect(goalSubtitle(makeGoal({ id: "a", kind: "recurring", rrule: "FREQ=WEEKLY;BYDAY=MO" }))).toBe(
      "周期 · 每周一",
    );
    expect(goalSubtitle(makeGoal({ id: "b", kind: "once", endDate: "2026-12-15" }))).toBe(
      "一次性 · 截止 2026-12-15",
    );
    expect(goalSubtitle(makeGoal({ id: "c", kind: "template", usageCount: 8 }))).toBe(
      "模板 · 已用 8 次",
    );
  });
});

describe("目标进度与排序", () => {
  it("进度 = 已完成 / 总数；没有任务时是 null", () => {
    const tasks = [
      makeTask({ id: "t1", status: "done" }),
      makeTask({ id: "t2" }),
      makeTask({ id: "t3", status: "dropped" }),
    ];
    expect(summarizeGoalTasks(tasks)).toEqual({ total: 3, done: 1, ratio: 1 / 3 });
    expect(summarizeGoalTasks([])).toEqual({ total: 0, done: 0, ratio: null });
  });

  it("按目标分组时忽略没有 goalId 的任务", () => {
    const tasks = [
      makeTask({ id: "t1", goalId: "g1" }),
      makeTask({ id: "t2", goalId: "g1" }),
      makeTask({ id: "t3", goalId: null }),
    ];
    const grouped = groupTasksByGoal(tasks);
    expect(grouped.get("g1")).toHaveLength(2);
    expect(grouped.has("")).toBe(false);
  });

  it("同一 tab 内按 sortIndex 排序，并过滤归档", () => {
    const goals = [
      makeGoal({ id: "b", sortIndex: 2, kind: "once" }),
      makeGoal({ id: "a", sortIndex: 1, kind: "once" }),
      makeGoal({ id: "c", sortIndex: 0, kind: "recurring" }),
      makeGoal({ id: "d", sortIndex: 0, kind: "once", status: "archived" }),
    ];
    expect(sortGoals(goals).map((goal) => goal.id)).toEqual(["c", "d", "a", "b"]);
    expect(goalsOfKind(goals, "once").map((goal) => goal.id)).toEqual(["a", "b"]);
  });

  it("拖动重排：上移、下移与越界都返回稳定结果", () => {
    const goals = ["a", "b", "c"].map((id, index) => makeGoal({ id, sortIndex: index }));

    expect(reorderGoals(goals, 0, 2).map((goal) => goal.id)).toEqual(["b", "c", "a"]);
    expect(reorderGoals(goals, 2, 0).map((goal) => goal.id)).toEqual(["c", "a", "b"]);
    expect(reorderGoals(goals, 1, 1).map((goal) => goal.id)).toEqual(["a", "b", "c"]);
    expect(reorderGoals(goals, 99, 0).map((goal) => goal.id)).toEqual(["c", "a", "b"]);

    expect(withSortIndexes(reorderGoals(goals, 0, 2))).toEqual([
      { id: "b", sortIndex: 0 },
      { id: "c", sortIndex: 1 },
      { id: "a", sortIndex: 2 },
    ]);
  });
});
