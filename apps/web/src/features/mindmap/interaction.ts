import { clampZoom, screenToWorld, type Camera } from "./camera";
import type { Point } from "./camera";

export type { Point } from "./camera";

/**
 * 画布上的指针几何。
 *
 * 这些函数刻意不碰 React 状态：拖拽过程中每帧都会调用，走 state 会触发整棵树重渲染。
 * 命中测试也不依赖 DOM（不用 elementFromPoint）：被拖的节点正好在指针底下，
 * elementFromPoint 永远命中它自己；用「节点矩形列表 + 排除集合」更准，也更好测。
 */

export interface ScreenRect {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 世界矩形 → 容器内屏幕矩形。 */
export function toScreenRect(
  id: string,
  node: { x: number; y: number; width: number; height: number },
  camera: Camera,
): ScreenRect {
  return {
    id,
    left: camera.x + node.x * camera.zoom,
    top: camera.y + node.y * camera.zoom,
    width: node.width * camera.zoom,
    height: node.height * camera.zoom,
  };
}

/** 指针的容器内坐标。 */
export function toLocalPoint(
  rect: { left: number; top: number },
  clientX: number,
  clientY: number,
): Point {
  return { x: clientX - rect.left, y: clientY - rect.top };
}

export function pointInRect(point: Point, rect: ScreenRect): boolean {
  return (
    point.x >= rect.left &&
    point.x <= rect.left + rect.width &&
    point.y >= rect.top &&
    point.y <= rect.top + rect.height
  );
}

/**
 * 指针下的节点。
 *
 * rects 按 DOM 顺序（后 = 更上层），所以从后往前找；exclude 用于排除「正在拖的节点
 * 及其子树」——不能把节点拖进自己的后代里，那会把树变成环。
 */
export function findNodeAt(
  rects: readonly ScreenRect[],
  point: Point,
  exclude?: ReadonlySet<string>,
): string | null {
  for (let index = rects.length - 1; index >= 0; index -= 1) {
    const rect = rects[index]!;
    if (exclude?.has(rect.id)) continue;
    if (pointInRect(point, rect)) return rect.id;
  }
  return null;
}

/** 超过阈值才算拖拽，否则当成点击（否则手一抖就选不中节点）。 */
export const DRAG_THRESHOLD = 4;

export function movedBeyondThreshold(start: Point, current: Point, threshold = DRAG_THRESHOLD): boolean {
  return Math.abs(current.x - start.x) > threshold || Math.abs(current.y - start.y) > threshold;
}

export function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** 屏幕位移 → 世界位移（拖节点时用到的唯一换算）。 */
export function worldDelta(dxScreen: number, dyScreen: number, camera: Camera): Point {
  const zoom = camera.zoom || 1;
  return { x: dxScreen / zoom, y: dyScreen / zoom };
}

export interface PinchStart {
  camera: Camera;
  /** 双指起始中点（容器内坐标） */
  mid: Point;
  /** 双指起始距离（px） */
  distance: number;
}

export interface PinchResult {
  camera: Camera;
  /** 缩放倍数（相对起始），用于状态栏显示 */
  scale: number;
}

/**
 * 双指缩放。
 *
 * 两件事同时发生：以起始中点为锚缩放 + 跟随中点移动平移。
 * 顺序不能反：先按「起始中点」的世界坐标缩放，再补上中点位移，
 * 否则双指平移时会一边缩放一边漂移。
 */
export function pinchCamera(start: PinchStart, currentMid: Point, currentDistance: number): PinchResult {
  const safeStart = Math.max(1, start.distance);
  const scale = Math.min(4, Math.max(0.25, currentDistance / safeStart));
  const nextZoom = clampZoom(start.camera.zoom * scale);
  const world = screenToWorld(start.camera, start.mid.x, start.mid.y);
  const camera: Camera = {
    x: currentMid.x - world.x * nextZoom,
    y: currentMid.y - world.y * nextZoom,
    zoom: nextZoom,
  };
  return { camera, scale: nextZoom / (start.camera.zoom || 1) };
}

/** 滚轮 → 缩放倍率：向下滚缩小、向上滚放大，指数衰减保证手感线性。 */
export function wheelZoomFactor(deltaY: number): number {
  return Math.exp(-deltaY * 0.0015);
}

/** 节点拖拽后的落库坐标：取整，避免浮点噪声把「未手动」误判成手动（0.0001 也算手动）。 */
export function quantizePosition(x: number, y: number): Point {
  return { x: Math.round(x), y: Math.round(y) };
}
