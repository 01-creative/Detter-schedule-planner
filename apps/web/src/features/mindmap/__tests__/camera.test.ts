import { describe, expect, it } from "vitest";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  cameraCenter,
  cameraFromCenter,
  centerOn,
  clampZoom,
  fitCamera,
  gridStep,
  isPointVisible,
  panBy,
  screenToWorld,
  visibleWorldRect,
  worldToScreen,
  zoomAtPoint,
  zoomStep,
  ZOOM_STEP,
} from "../camera";

/**
 * 相机换算。手动点几下很难发现「缩放锚点偏了 10px」这类问题，
 * 但用户会觉得「越缩放越跑」。这里直接把不变量写死：
 * 缩放前后，指针下面的世界坐标必须不动。
 */

describe("clampZoom", () => {
  it("夹在 25%–200%，非法值退回 100%", () => {
    expect(clampZoom(0.1)).toBe(MIN_ZOOM);
    expect(clampZoom(9)).toBe(MAX_ZOOM);
    expect(clampZoom(1.37)).toBe(1.37);
    expect(clampZoom(Number.NaN)).toBe(1);
  });
});

describe("屏幕 ↔ 世界", () => {
  it("平移缩放同时生效", () => {
    const camera = { x: 100, y: 50, zoom: 2 };
    expect(worldToScreen(camera, 10, 10)).toEqual({ x: 120, y: 70 });
    expect(screenToWorld(camera, 120, 70)).toEqual({ x: 10, y: 10 });
  });

  it("panBy 只动平移，不动缩放", () => {
    expect(panBy({ x: 0, y: 0, zoom: 1.5 }, 30, -10)).toEqual({ x: 30, y: -10, zoom: 1.5 });
  });
});

describe("以指针为锚缩放", () => {
  it("锚点下的世界坐标缩放前后不变", () => {
    const camera = { x: 100, y: 50, zoom: 1 };
    const anchor = { x: 220, y: 160 };
    const before = screenToWorld(camera, anchor.x, anchor.y);
    const next = zoomAtPoint(camera, 2, anchor.x, anchor.y);
    const after = worldToScreen(next, before.x, before.y);
    expect(after.x).toBeCloseTo(anchor.x, 6);
    expect(after.y).toBeCloseTo(anchor.y, 6);
  });

  it("缩放被夹住时相机不动", () => {
    const camera = { x: 0, y: 0, zoom: MAX_ZOOM };
    expect(zoomAtPoint(camera, 5, 100, 100)).toBe(camera);
  });

  it("按钮缩放以容器中心为锚，按固定倍率步进", () => {
    const camera = { x: 0, y: 0, zoom: 1 };
    const next = zoomStep(camera, 1, { width: 800, height: 600 });
    expect(next.zoom).toBeCloseTo(ZOOM_STEP, 6);
    const world = screenToWorld(camera, 400, 300);
    const screen = worldToScreen(next, world.x, world.y);
    expect(screen.x).toBeCloseTo(400, 6);
    expect(screen.y).toBeCloseTo(300, 6);
  });
});

describe("适应画布", () => {
  it("内容居中，且最多放大到 100%", () => {
    const bounds = { minX: -100, minY: -50, maxX: 100, maxY: 50, width: 200, height: 100 };
    const camera = fitCamera(bounds, { width: 800, height: 600 }, 56);
    expect(camera.zoom).toBe(1);
    expect(camera.x).toBeCloseTo(400, 6);
    expect(camera.y).toBeCloseTo(300, 6);
  });

  it("内容比视口大时按比例缩小并保持居中", () => {
    const bounds = { minX: 0, minY: 0, maxX: 2000, maxY: 1000, width: 2000, height: 1000 };
    const camera = fitCamera(bounds, { width: 800, height: 600 }, 56);
    expect(camera.zoom).toBeCloseTo(688 / 2000, 6);
    const screen = worldToScreen(camera, 1000, 500);
    expect(screen.x).toBeCloseTo(400, 5);
    expect(screen.y).toBeCloseTo(300, 5);
  });

  it("空图退回到视口中心，不出现 NaN", () => {
    const camera = fitCamera(
      { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 },
      { width: 800, height: 600 },
      56,
    );
    expect(camera).toEqual({ x: 400, y: 300, zoom: 1 });
  });
});

describe("可见区域与定位", () => {
  it("visibleWorldRect 按相机反解世界范围", () => {
    const rect = visibleWorldRect({ x: 100, y: 50, zoom: 0.5 }, { width: 800, height: 600 }, 0);
    expect(rect.minX).toBeCloseTo(-200, 6);
    expect(rect.minY).toBeCloseTo(-100, 6);
    expect(rect.maxX).toBeCloseTo(1400, 6);
    expect(rect.maxY).toBeCloseTo(1100, 6);
  });

  it("isPointVisible 考虑留白", () => {
    const camera = { x: 0, y: 0, zoom: 1 };
    const viewport = { width: 800, height: 600 };
    expect(isPointVisible(camera, viewport, 400, 300)).toBe(true);
    expect(isPointVisible(camera, viewport, 790, 300, 80)).toBe(false);
    expect(isPointVisible(camera, viewport, -10, 300)).toBe(false);
  });

  it("centerOn 把世界点摆到视口正中且不改缩放", () => {
    const camera = centerOn({ x: 0, y: 0, zoom: 1.5 }, { width: 800, height: 600 }, 120, -40);
    const screen = worldToScreen(camera, 120, -40);
    expect(screen.x).toBeCloseTo(400, 6);
    expect(screen.y).toBeCloseTo(300, 6);
    expect(camera.zoom).toBe(1.5);
  });

  it("视口按「世界中心 + 缩放」存取：换窗口尺寸后仍对着同一处", () => {
    const wide = { width: 1440, height: 720 };
    const camera = { x: 300, y: -80, zoom: 1.25 };
    const center = cameraCenter(camera, wide);
    // 存进库的是 center.x / center.y / zoom
    const narrow = { width: 375, height: 812 };
    const restored = cameraFromCenter(center, camera.zoom, narrow);
    const restoredCenter = cameraCenter(restored, narrow);
    expect(restoredCenter.x).toBeCloseTo(center.x, 6);
    expect(restoredCenter.y).toBeCloseTo(center.y, 6);
    expect(restored.zoom).toBe(1.25);
    // 但如果按像素偏移存（旧做法），窄窗口下中心点会跑到 300 - 375/2 之外
    expect(restored.x).not.toBe(camera.x);
  });

  it("还原相机时缩放同样被夹紧", () => {
    expect(cameraFromCenter({ x: 0, y: 0 }, 9, { width: 800, height: 600 }).zoom).toBe(MAX_ZOOM);
    expect(cameraFromCenter({ x: 0, y: 0 }, 0.01, { width: 800, height: 600 }).zoom).toBe(MIN_ZOOM);
  });

  it("点阵间距跟着缩放走，但屏幕上不小于 12px", () => {
    expect(gridStep(1)).toBe(24);
    expect(gridStep(2)).toBe(48);
    expect(gridStep(0.25)).toBe(12);
    expect(gridStep(0.5)).toBe(12);
  });
});
