import { describe, expect, it } from "vitest";
import { TaskSchema } from "@detter/shared";
import type { Task } from "@detter/shared";
import {
  coordinateReadout,
  estimateLabelWidth,
  layoutPlaneLabels,
  moveQuadrant,
  nextFreePlanePosition,
  planeFromLegacy,
  quadrantFromPosition,
  relocateToQuadrant,
  resolveDropTarget,
  resolveTaskPoint,
  unitFromPoint,
} from "../geometry";

/**
 * 平面的纯几何计算。
 *
 * 这些数字一旦算错，表现是「明明放在这里，松手却跳走了」或「任务落在 Q1 却被算进 Q2」——
 * 靠手点很难定位，所以坐标换算、迁移、标签避让必须有自动化用例。
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

function mountPlane(): HTMLElement {
  const plane = document.createElement("section");
  plane.setAttribute("data-plane", "");
  document.body.appendChild(plane);
  plane.getBoundingClientRect = () =>
    ({
      ...RECT,
      right: RECT.left + RECT.width,
      bottom: RECT.top + RECT.height,
      x: RECT.left,
      y: RECT.top,
      toJSON: () => ({}),
    }) as DOMRect;
  return plane;
}

describe("unitFromPoint", () => {
  it("把指针映射到全平面 0..1，并把越界坐标夹紧", () => {
    expect(unitFromPoint(300, 150, RECT)).toEqual({ x: 0.5, y: 0.5 });
    expect(unitFromPoint(100, 50, RECT)).toEqual({ x: 0, y: 0 });
    expect(unitFromPoint(500, 250, RECT)).toEqual({ x: 1, y: 1 });
    expect(unitFromPoint(9999, -9999, RECT)).toEqual({ x: 1, y: 0 });
    // 宽高为 0 时不能出现 NaN / Infinity
    expect(unitFromPoint(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({
      x: 1,
      y: 1,
    });
  });
});

describe("resolveDropTarget", () => {
  it("找到 [data-plane] 并返回全平面坐标，quadrant 由坐标推导", () => {
    const plane = mountPlane();
    const target = resolveDropTarget(300, 150, docWith(plane));
    expect(target).not.toBeNull();
    expect(target?.posX).toBeCloseTo(0.5, 5);
    expect(target?.posY).toBeCloseTo(0.5, 5);
    expect(target?.quadrant).toBe(1); // 边界按 Q1 优先
    expect(target?.rect.width).toBe(400);

    const topLeft = resolveDropTarget(120, 70, docWith(plane));
    expect(topLeft?.quadrant).toBe(2);
    expect(topLeft?.posX).toBeCloseTo(0.05, 5);
    expect(topLeft?.posY).toBeCloseTo(0.1, 5);
    plane.remove();
  });

  it("指针不在平面上时返回 null（松手即取消）", () => {
    expect(resolveDropTarget(10, 10, docWith(null))).toBeNull();

    const outside = document.createElement("div");
    document.body.appendChild(outside);
    expect(resolveDropTarget(10, 10, docWith(outside))).toBeNull();
    outside.remove();
  });
});

describe("坐标 ↔ 象限", () => {
  it("四个象限由 x 与 importance = 1 - y 的符号决定", () => {
    expect(quadrantFromPosition(0.8, 0.2)).toBe(1);
    expect(quadrantFromPosition(0.2, 0.2)).toBe(2);
    expect(quadrantFromPosition(0.8, 0.8)).toBe(3);
    expect(quadrantFromPosition(0.2, 0.8)).toBe(4);
    expect(quadrantFromPosition(0, 0)).toBe(2);
    expect(quadrantFromPosition(1, 0)).toBe(1);
    expect(quadrantFromPosition(1, 1)).toBe(3);
    expect(quadrantFromPosition(0, 1)).toBe(4);
  });

  it("边界值：x=0.5 算紧急，y=0.5 算重要，原点归 Q1", () => {
    expect(quadrantFromPosition(0.5, 0.5)).toBe(1);
    expect(quadrantFromPosition(0.4999, 0.4999)).toBe(2);
    expect(quadrantFromPosition(0.5, 0.5001)).toBe(3);
    expect(quadrantFromPosition(0.4999, 0.5001)).toBe(4);
    expect(quadrantFromPosition(0.72, 0.37)).toBe(1);
  });
});

describe("旧坐标 → 全平面坐标", () => {
  it("四个象限分别映射到平面的四个 1/2 区块", () => {
    expect(planeFromLegacy(1, 0.5, 0.5)).toEqual({ x: 0.75, y: 0.25 });
    expect(planeFromLegacy(2, 0.5, 0.5)).toEqual({ x: 0.25, y: 0.25 });
    expect(planeFromLegacy(3, 0.5, 0.5)).toEqual({ x: 0.75, y: 0.75 });
    expect(planeFromLegacy(4, 0.5, 0.5)).toEqual({ x: 0.25, y: 0.75 });
    expect(planeFromLegacy(1, 0, 1)).toEqual({ x: 0.5, y: 0.5 });
    expect(planeFromLegacy(2, 1, 0)).toEqual({ x: 0.5, y: 0 });
  });

  it("resolveTaskPoint 对已迁移坐标原样返回，对旧坐标做一次兼容换算", () => {
    expect(resolveTaskPoint({ posX: 0.2, posY: 0.2, quadrant: 2 })).toEqual({
      x: 0.2,
      y: 0.2,
    });
    // 收件箱/模板等入口仍可能写「象限 + 格内坐标」，显示时不能落在别的象限
    expect(resolveTaskPoint({ posX: 0.8, posY: 0.2, quadrant: 2 })).toEqual({
      x: 0.4,
      y: 0.1,
    });
  });

  it("relocateToQuadrant 保留原象限内的相对位置", () => {
    expect(relocateToQuadrant(0.25, 0.25, 1)).toEqual({ x: 0.75, y: 0.25 });
    const moved = relocateToQuadrant(0.1, 0.4, 3);
    expect(moved.x).toBeCloseTo(0.6, 5);
    expect(moved.y).toBeCloseTo(0.9, 5);
    expect(quadrantFromPosition(moved.x, moved.y)).toBe(3);
  });
});

describe("新任务落点", () => {
  it("没有已有点时落在 Q2 近中心", () => {
    expect(nextFreePlanePosition([])).toEqual({ x: 0.44, y: 0.44 });
  });

  it("同一点被占用时沿螺旋错开，且仍在 Q2 内部", () => {
    const first = nextFreePlanePosition([]);
    const second = nextFreePlanePosition([first]);
    expect(Math.hypot(second.x - first.x, second.y - first.y)).toBeGreaterThanOrEqual(0.035);
    expect(quadrantFromPosition(second.x, second.y)).toBe(2);

    const points = [first];
    for (let index = 0; index < 8; index += 1) {
      points.push(nextFreePlanePosition(points));
    }
    const unique = new Set(points.map((point) => `${point.x.toFixed(3)},${point.y.toFixed(3)}`));
    expect(unique.size).toBe(points.length);
  });
});

describe("标签排布", () => {
  it("显式给出宽度：短标题不小于 64，长标题封顶 172", () => {
    expect(estimateLabelWidth("跑步")).toBeGreaterThanOrEqual(64);
    expect(estimateLabelWidth("准备英语听力（精听 20 分钟）")).toBe(172);
    expect(estimateLabelWidth("Reply the advisor about the weekly report")).toBeLessThanOrEqual(
      172,
    );
  });

  it("按 y 排序，重叠的标签向下错开并拉长引线", () => {
    const layouts = layoutPlaneLabels(
      [
        { id: "b", x: 0.2, y: 0.21, title: "第二条" },
        { id: "a", x: 0.2, y: 0.2, title: "第一条" },
      ],
      { width: 800, height: 400, labelHeight: 24, gap: 4 },
    );
    const a = layouts.find((layout) => layout.id === "a")!;
    const b = layouts.find((layout) => layout.id === "b")!;
    expect(b.top - a.top).toBeGreaterThanOrEqual(28);
    const leaderLength = Math.abs(b.leader.y2 - b.leader.y1);
    expect(leaderLength).toBeGreaterThan(2.5);
    expect(a.leader.y2).toBeGreaterThan(a.top);
  });

  it("不同列但实际矩形相交时也会错开（窄屏常见）", () => {
    const layouts = layoutPlaneLabels(
      [
        { id: "left-dot", x: 0.2, y: 0.5, title: "准备英语听力（精听 20 分钟）" },
        { id: "right-dot", x: 0.8, y: 0.5, title: "交高数作业（第 12 周）" },
      ],
      { width: 520, height: 400, labelHeight: 24, gap: 4 },
    );
    const [a, b] = layouts;
    const overlapX =
      a!.left < b!.left + b!.width && a!.left + a!.width > b!.left;
    const overlapY =
      a!.top < b!.top + 24 && a!.top + 24 > b!.top;
    expect(overlapX && overlapY).toBe(false);
    expect(Math.abs(b!.leader.y2 - b!.leader.y1)).toBeGreaterThan(2.5);
  });

  it("靠右边的标签翻到圆点左侧，不出平面", () => {
    const [layout] = layoutPlaneLabels(
      [{ id: "edge", x: 0.98, y: 0.5, title: "贴边的一条任务" }],
      { width: 800, height: 400 },
    );
    expect(layout?.side).toBe("left");
    expect(layout!.left).toBeGreaterThanOrEqual(6);
    expect(layout!.left + layout!.width).toBeLessThanOrEqual(794);
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

describe("拖动读数", () => {
  it("紧急度取 x，重要度取 1 - y，保留两位", () => {
    expect(coordinateReadout(0.72, 0.63)).toBe("紧急度 0.72 · 重要度 0.37");
    expect(coordinateReadout(-1, -0.4)).toBe("紧急度 0.00 · 重要度 1.00");
    expect(coordinateReadout(1.4, 0.63)).toBe("紧急度 1.00 · 重要度 0.37");
  });
});

describe("任务坐标一致性", () => {
  it("placeTask 级别的坐标变化由 quadrant 推导（用 schema 补默认值校验）", () => {
    const task = makeTask({ id: "t", posX: 0.8, posY: 0.2 });
    expect(quadrantFromPosition(task.posX, task.posY)).toBe(1);
    expect(task.quadrant).toBe(2); // schema 的默认象限，不代表坐标
  });
});
