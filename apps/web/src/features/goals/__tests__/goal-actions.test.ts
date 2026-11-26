import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { createGoal, createTaskFromGoal, expandTemplate, saveGoalOrder, toggleGoalMilestone } from "../goal-actions";
import { reorderGoals, templateTitles } from "../rules";

/**
 * 目标 → 任务的落库验证。
 *
 * 单测到「仓库层」而不是只测纯函数：这条链路真正容易坏的地方是
 * 「任务建出来了但 goalId 丢了」「usageCount 没涨」，这些都只有查库才看得见。
 */
beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe("目标拖到象限", () => {
  it("生成带 goalId 的任务，并把目标使用次数 +1", async () => {
    const goal = await createGoal({
      title: "每周三次健身",
      kind: "recurring",
      color: "#10B981",
      icon: "dumbbell",
      rrule: "FREQ=WEEKLY",
    });

    const task = await createTaskFromGoal(goal, { quadrant: 1, posX: 0.2, posY: 0.3 });

    expect(task.title).toBe("每周三次健身");
    expect(task.goalId).toBe(goal.id);
    expect(task.quadrant).toBe(1);
    expect(task.status).toBe("todo");
    expect(task.source).toBe("goal");
    expect(task.posX).toBeCloseTo(0.2, 5);

    const storedTask = await db.tasks.get(task.id);
    expect(storedTask?.goalId).toBe(goal.id);
    expect(storedTask?.deletedAt).toBeNull();

    const storedGoal = await db.goals.get(goal.id);
    expect(storedGoal?.usageCount).toBe(1);
    expect(storedGoal?.lastUsedAt).not.toBeNull();

    // 离线优先：两条写操作都进了 outbox
    expect(await db.outbox.count()).toBeGreaterThanOrEqual(2);
  });
});

describe("模板铺开", () => {
  it("按步骤生成多条任务，写入关联目标并累加使用次数", async () => {
    const goal = await createGoal({
      title: "周复盘模板",
      kind: "template",
      color: "#6355F6",
      icon: "target",
      milestoneTitles: ["回顾本周", "写下三件好事", "定下周目标"],
    });

    const created = await expandTemplate(goal, templateTitles(goal), 2);

    expect(created).toHaveLength(3);
    expect(created.map((task) => task.title)).toEqual(["回顾本周", "写下三件好事", "定下周目标"]);
    expect(created.every((task) => task.goalId === goal.id)).toBe(true);
    expect(created.every((task) => task.source === "template")).toBe(true);
    expect(created.every((task) => task.quadrant === 2)).toBe(true);

    const stored = await db.goals.get(goal.id);
    expect(stored?.usageCount).toBe(1);
    expect(await db.tasks.count()).toBe(3);
  });
});

describe("目标维护", () => {
  it("切换里程碑不会动到使用次数", async () => {
    const goal = await createGoal({
      title: "毕设开题",
      kind: "once",
      color: "#0EA5E9",
      icon: "book",
      milestoneTitles: ["读文献", "写提纲"],
    });

    const updated = await toggleGoalMilestone(goal, goal.milestones[0]?.id ?? "");
    expect(updated.milestones[0]?.done).toBe(true);
    expect(updated.usageCount).toBe(0);
  });

  it("重排只改 sortIndex，顺序被持久化", async () => {
    const first = await createGoal({ title: "A", kind: "once", color: "#6355F6", icon: "target" });
    const second = await createGoal({ title: "B", kind: "once", color: "#6355F6", icon: "target" });

    await saveGoalOrder(reorderGoals([first, second], 0, 1));

    const rows = await db.goals.toArray();
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(second.id)?.sortIndex).toBe(0);
    expect(byId.get(first.id)?.sortIndex).toBe(1);
  });
});
