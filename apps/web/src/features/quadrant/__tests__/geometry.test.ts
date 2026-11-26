import { describe, expect, it } from "vitest";
import { TaskSchema } from "@detter/shared";
import type { Task } from "@detter/shared";
import {
  insertionIndexForPoint,
  moveQuadrant,
  resolveDropTarget,
  sortIndexBetween,
  sortIndexForInsertion,
  sortTasksForCell,
  unitFromPoint,
} from "../geometry";

/**
 * 拖拽相关的纯计算。
 *
 * 这些数字一旦算错，表现是「明明放在这里，松手却跳走了」——
 * 靠手点很难定位，所以坐标换算、落点判定、插入位置必须有自动化用例。
 */

const RECT = { left: 100, top: 50, width: 400, height: 200 };

function makeTask(patch: Partial<Task> & { id: string }): Task {
  return TaskSchema.parse({
    title: `任务 ${patch.id}`,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  });
}

/** 造一个只有 elementFromPoint 的 document 桩，jsdom 不实现真实命中测试。 */
function docWith(element: Element | null): Document {
  return { elementFromPoint: () => element } as unknown as Document;
}

function mountCell(quadrant: number): { cell: HTMLElement; layer: HTMLElement } {
  const cell = document.createElement("section");
  cell.setAttribute("data-quadrant", String(quadrant));
  const layer = document.createElement("div");
  layer.setAttribute("data-quadrant-layer", "");
  cell.appendChild(layer);
  document.body.appendChild(cell);
  layer.getBoundingClientRect = () =>
    ({
      ...RECT,
      right: RECT.left + RECT.width,
      bottom: RECT.top + RECT.height,
      x: RECT.left,
      y: RECT.top,
      toJSON: () => ({}),
    }) as DOMRect;
  return { cell, layer };
}

describe("unitFromPoint", () => {
  it("把指针映射到象限内的 0..1，并把越界坐标夹紧", () => {
    expect(unitFromPoint(300, 150, RECT)).toEqual({ posX: 0.5, posY: 0.5 });
    expect(unitFromPoint(100, 50, RECT)).toEqual({ posX: 0, posY: 0 });
    expect(unitFromPoint(500, 250, RECT)).toEqual({ posX: 1, posY: 1 });
    expect(unitFromPoint(9999, -9999, RECT)).toEqual({ posX: 1, posY: 0 });
    // 宽高为 0 时不能出现 NaN / Infinity
    expect(unitFromPoint(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({
      posX: 1,
      posY: 1,
    });
  });
});

describe("resolveDropTarget", () => {
  it("找到最近的 [data-quadrant]，并用自由层矩形算坐标", () => {
    const { cell } = mountCell(2);
    const target = resolveDropTarget(300, 150, docWith(cell));
    expect(target).not.toBeNull();
    expect(target?.quadrant).toBe(2);
    expect(target?.posX).toBeCloseTo(0.5, 5);
    expect(target?.posY).toBeCloseTo(0.5, 5);
    expect(target?.rect.width).toBe(400);
    cell.remove();
  });

  it("指针不在任何象限上时返回 null（松手即取消）", () => {
    expect(resolveDropTarget(10, 10, docWith(null))).toBeNull();

    const outside = document.createElement("div");
    document.body.appendChild(outside);
    expect(resolveDropTarget(10, 10, docWith(outside))).toBeNull();
    outside.remove();
  });
});

describe("列表落点", () => {
  const cards = [
    { id: "a", top: 0, height: 40 },
    { id: "b", top: 50, height: 40 },
    { id: "c", top: 100, height: 40 },
  ];

  it("按卡片中线算出插入位置", () => {
    expect(insertionIndexForPoint(cards, 10)).toBe(0);
    expect(insertionIndexForPoint(cards, 21)).toBe(1);
    expect(insertionIndexForPoint(cards, 60)).toBe(1);
    expect(insertionIndexForPoint(cards, 80)).toBe(2);
    expect(insertionIndexForPoint(cards, 999)).toBe(3);
  });

  it("用前后邻居的中点生成 sortIndex，只写一条", () => {
    expect(sortIndexBetween(undefined, undefined)).toBe(0);
    expect(sortIndexBetween(undefined, 3)).toBe(2);
    expect(sortIndexBetween(5, undefined)).toBe(6);
    expect(sortIndexBetween(2, 4)).toBe(3);
  });

  it("插入到第 0 / 末尾时 sortIndex 依然单调", () => {
    const ordered = [
      makeTask({ id: "a", sortIndex: 10 }),
      makeTask({ id: "b", sortIndex: 20 }),
    ];
    expect(sortIndexForInsertion(ordered, 0)).toBeLessThan(10);
    expect(sortIndexForInsertion(ordered, 1)).toBe(15);
    expect(sortIndexForInsertion(ordered, 2)).toBeGreaterThan(20);
  });
});

describe("排序规则", () => {
  const now = new Date(2026, 10, 26, 10, 0, 0, 0).getTime();

  const overdue = makeTask({ id: "overdue", dueAt: now - 3_600_000, sortIndex: 5 });
  const today = makeTask({ id: "today", dueAt: now + 3_600_000, sortIndex: 4 });
  const dueLater = makeTask({ id: "later", dueAt: now + 86_400_000 * 3, sortIndex: 3 });
  const noDue = makeTask({ id: "none", sortIndex: 2 });
  const done = makeTask({ id: "done", status: "done", dueAt: now - 1000, sortIndex: 0 });

  it("智能排序：逾期 > 今天 > 有截止 > 其他，已完成沉底", () => {
    const sorted = sortTasksForCell([done, noDue, dueLater, today, overdue], "smart", now);
    expect(sorted.map((task) => task.id)).toEqual(["overdue", "today", "later", "none", "done"]);
  });

  it("手动排序只看 sortIndex，不看时间桶", () => {
    const sorted = sortTasksForCell([done, noDue, dueLater, today, overdue], "manual", now);
    expect(sorted.map((task) => task.id)).toEqual(["done", "none", "later", "today", "overdue"]);
  });

  it("同一个桶里按 sortIndex 排，保证拖拽顺序稳定", () => {
    const a = makeTask({ id: "a", sortIndex: 2, createdAt: 5 });
    const b = makeTask({ id: "b", sortIndex: 1, createdAt: 1 });
    const sorted = sortTasksForCell([a, b], "smart", now);
    expect(sorted.map((task) => task.id)).toEqual(["b", "a"]);
  });
});

describe("键盘移动象限", () => {
  it("2×2 布局里左右 ±1、上下 ±2，越界保持原位", () => {
    expect(moveQuadrant(2, "left")).toBe(1);
    expect(moveQuadrant(3, "right")).toBe(4);
    expect(moveQuadrant(4, "up")).toBe(2);
    expect(moveQuadrant(3, "up")).toBe(1);
    expect(moveQuadrant(1, "up")).toBe(1);
    expect(moveQuadrant(1, "left")).toBe(1);
    expect(moveQuadrant(4, "down")).toBe(4);
  });
});
