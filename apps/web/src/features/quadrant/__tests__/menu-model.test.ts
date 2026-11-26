import { describe, expect, it } from "vitest";
import { GoalSchema, TaskSchema } from "@detter/shared";
import { buildCellContextMenu, buildTaskContextMenu } from "../menu-model";
import type { MenuEntry } from "../menu-model";

/**
 * 右键菜单的「状态」——这一层最容易出现「已完成的任务还显示完成」。
 * 断言的是模型，不是像素。
 */

const activeGoal = GoalSchema.parse({
  id: "goal-active",
  title: "每周三次健身",
  kind: "recurring",
  status: "active",
  createdAt: 1,
  updatedAt: 1,
});

const archivedGoal = GoalSchema.parse({
  id: "goal-archived",
  title: "已经放弃的目标",
  status: "archived",
  createdAt: 1,
  updatedAt: 1,
});

function task(overrides: Record<string, unknown>) {
  return TaskSchema.parse({
    id: "task-1",
    title: "交高数作业",
    quadrant: 1,
    status: "todo",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  });
}

function findEntry(items: MenuEntry[], key: string): MenuEntry | undefined {
  for (const item of items) {
    if (item.type === "separator") continue;
    if (item.key === key) return item;
    if (item.type === "submenu") {
      const nested = findEntry(item.items, key);
      if (nested) return nested;
    }
  }
  return undefined;
}

describe("buildTaskContextMenu", () => {
  it("未完成任务显示「完成」，点击项顺序符合任务书", () => {
    const items = buildTaskContextMenu({
      task: task({}),
      goals: [activeGoal],
      quadrant: 1,
    });
    const labels = items
      .filter((entry): entry is Extract<MenuEntry, { type: "item" | "submenu" }> => entry.type !== "separator")
      .map((entry) => entry.label);

    expect(labels).toEqual([
      "新建任务",
      "完成",
      "移动到",
      "设置精确坐标…",
      "关联目标",
      "复制标题",
      "删除",
    ]);
  });

  it("已完成任务改成「取消完成」", () => {
    const items = buildTaskContextMenu({
      task: task({ status: "done" }),
      goals: [],
      quadrant: 1,
    });
    expect(findEntry(items, "toggle-done")).toMatchObject({ label: "取消完成" });
  });

  it("「移动到」列出四个象限并标出当前位置", () => {
    const items = buildTaskContextMenu({ task: task({ quadrant: 3 }), goals: [], quadrant: 3 });
    const move = findEntry(items, "move");
    expect(move?.type).toBe("submenu");
    if (move?.type !== "submenu") return;
    expect(move.items).toHaveLength(4);
    const active = move.items
      .filter((entry): entry is Extract<MenuEntry, { type: "item" }> => entry.type === "item")
      .filter((entry) => entry.active);
    expect(active.map((entry) => entry.key)).toEqual(["move:3"]);
  });

  it("「关联目标」只列进行中的目标，并始终给出新建 / 取消关联", () => {
    const items = buildTaskContextMenu({
      task: task({ goalId: activeGoal.id }),
      goals: [activeGoal, archivedGoal],
      quadrant: 1,
    });
    const submenu = findEntry(items, "goal");
    if (submenu?.type !== "submenu") throw new Error("缺少关联目标子菜单");

    const goalKeys = submenu.items
      .filter((entry): entry is Extract<MenuEntry, { type: "item" }> => entry.type === "item")
      .map((entry) => entry.key);

    expect(goalKeys).toContain(`goal:${activeGoal.id}`);
    expect(goalKeys).not.toContain(`goal:${archivedGoal.id}`);
    // 已有关联 → 提供取消关联；并且当前目标是 active 状态
    expect(goalKeys).toContain("goal:clear");
    expect(submenu.items.find((entry) => entry.key === `goal:${activeGoal.id}`)).toMatchObject({
      active: true,
    });
  });

  it("没有进行中的目标时给出禁用提示，且提供新建入口", () => {
    const items = buildTaskContextMenu({
      task: task({}),
      goals: [archivedGoal],
      quadrant: 1,
    });
    const submenu = findEntry(items, "goal");
    if (submenu?.type !== "submenu") throw new Error("缺少关联目标子菜单");
    expect(submenu.items.find((entry) => entry.key === "goal:none")).toMatchObject({
      disabled: true,
    });
    expect(submenu.items.find((entry) => entry.key === "goal:new")).toBeTruthy();
  });

  it("删除项是危险项", () => {
    const items = buildTaskContextMenu({ task: task({}), goals: [], quadrant: 1 });
    expect(findEntry(items, "delete")).toMatchObject({ danger: true });
  });
});

describe("buildCellContextMenu", () => {
  it("空白格只提供「在此新建任务」", () => {
    const items = buildCellContextMenu();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "item", key: "new", label: "在此新建任务" });
  });
});
