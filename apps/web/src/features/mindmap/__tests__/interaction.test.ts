import { describe, expect, it } from "vitest";
import {
  DRAG_THRESHOLD,
  distanceBetween,
  findNodeAt,
  midpoint,
  movedBeyondThreshold,
  pinchCamera,
  pointInRect,
  quantizePosition,
  toLocalPoint,
  toScreenRect,
  worldDelta,
  type ScreenRect,
} from "../interaction";

/**
 * 指针几何。拖拽落点判断（尤其是「不能拖进自己的子树」）一旦错，
 * 表现是「明明松手在节点上，却没改父级」或者更糟——树变成环。
 */

const RECTS: ScreenRect[] = [
  { id: "a", left: 0, top: 0, width: 100, height: 40 },
  { id: "b", left: 50, top: 20, width: 100, height: 40 },
];

describe("屏幕矩形与局部坐标", () => {
  it("toScreenRect 同时应用平移与缩放", () => {
    expect(toScreenRect("n", { x: 5, y: 5, width: 100, height: 40 }, { x: 10, y: 20, zoom: 2 })).toEqual({
      id: "n",
      left: 20,
      top: 30,
      width: 200,
      height: 80,
    });
  });

  it("toLocalPoint 把 client 坐标换算到容器内", () => {
    expect(toLocalPoint({ left: 120, top: 60 }, 300, 200)).toEqual({ x: 180, y: 140 });
  });

  it("pointInRect 含边界", () => {
    expect(pointInRect({ x: 0, y: 0 }, RECTS[0]!)).toBe(true);
    expect(pointInRect({ x: 100, y: 40 }, RECTS[0]!)).toBe(true);
    expect(pointInRect({ x: 101, y: 40 }, RECTS[0]!)).toBe(false);
  });
});

describe("拖拽落点", () => {
  it("重叠时取 DOM 顺序更靠上的那个（后渲染的在上面）", () => {
    expect(findNodeAt(RECTS, { x: 60, y: 30 })).toBe("b");
    expect(findNodeAt(RECTS, { x: 10, y: 10 })).toBe("a");
  });

  it("排除正在拖的节点及其子树后命中下一个", () => {
    expect(findNodeAt(RECTS, { x: 60, y: 30 }, new Set(["b"]))).toBe("a");
    expect(findNodeAt(RECTS, { x: 60, y: 30 }, new Set(["a", "b"]))).toBeNull();
  });

  it("空白处返回 null", () => {
    expect(findNodeAt(RECTS, { x: 400, y: 400 })).toBeNull();
    expect(findNodeAt([], { x: 1, y: 1 })).toBeNull();
  });

  it("超过阈值才算拖动，避免手抖让点击变成拖拽", () => {
    expect(movedBeyondThreshold({ x: 0, y: 0 }, { x: DRAG_THRESHOLD, y: 0 })).toBe(false);
    expect(movedBeyondThreshold({ x: 0, y: 0 }, { x: DRAG_THRESHOLD + 1, y: 0 })).toBe(true);
    expect(movedBeyondThreshold({ x: 0, y: 0 }, { x: 0, y: -12 })).toBe(true);
  });

  it("世界位移 = 屏幕位移 / 缩放", () => {
    expect(worldDelta(100, -50, { x: 0, y: 0, zoom: 2 })).toEqual({ x: 50, y: -25 });
    expect(worldDelta(100, -50, { x: 0, y: 0, zoom: 0 })).toEqual({ x: 100, y: -50 });
  });

  it("落点取整，避免浮点噪声把节点变成 pinned", () => {
    expect(quantizePosition(12.4, -3.6)).toEqual({ x: 12, y: -4 });
  });
});

describe("双指缩放", () => {
  const start = {
    camera: { x: 0, y: 0, zoom: 1 },
    mid: { x: 100, y: 100 },
    distance: 100,
  };

  it("距离翻倍 → 200%，中点下的世界坐标不动", () => {
    const { camera, scale } = pinchCamera(start, { x: 100, y: 100 }, 200);
    expect(scale).toBeCloseTo(2, 6);
    expect(camera.zoom).toBeCloseTo(2, 6);
    expect(camera.x).toBeCloseTo(100 - 100 * 2, 6);
    expect(camera.y).toBeCloseTo(100 - 100 * 2, 6);
  });

  it("中点移动 → 画面跟着手走（同距离时只平移）", () => {
    const { camera } = pinchCamera(start, { x: 160, y: 130 }, 100);
    expect(camera.zoom).toBeCloseTo(1, 6);
    expect(camera.x).toBeCloseTo(60, 6);
    expect(camera.y).toBeCloseTo(30, 6);
  });

  it("缩放倍率被 25%–200% 夹住", () => {
    expect(pinchCamera(start, { x: 100, y: 100 }, 10_000).camera.zoom).toBe(2);
    expect(pinchCamera(start, { x: 100, y: 100 }, 1).camera.zoom).toBeCloseTo(0.25, 6);
  });

  it("中点与距离的辅助函数", () => {
    expect(midpoint({ x: 0, y: 0 }, { x: 20, y: 10 })).toEqual({ x: 10, y: 5 });
    expect(distanceBetween({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});
