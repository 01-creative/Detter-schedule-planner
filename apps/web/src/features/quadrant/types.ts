import type { Goal, Quadrant, Task } from "@detter/shared";

/**
 * 四象限平面的共享类型。
 *
 * 首页只有一张连续的坐标系平面：x = 紧急度、y = 重要度（屏幕坐标里 0 在上）。
 * 象限不是容器，只是坐标符号推出来的区域，因此落点只需要一个全平面坐标。
 */

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 一次落点：全平面归一化坐标（0..1）+ 该平面的可用矩形。 */
export interface DropTarget {
  /** 由坐标推导，方便统计与提示；不参与落点计算 */
  quadrant: Quadrant;
  posX: number;
  posY: number;
  rect: RectLike;
}

export type DragPayload =
  | { kind: "task"; task: Task; goal: Goal | null }
  | { kind: "goal"; goal: Goal };

/** 拖拽期间板子需要的快照；指针位置不在这里（那部分走 rAF 直接改 DOM）。 */
export interface DragSnapshot {
  payload: DragPayload;
  width: number;
  height: number;
  overQuadrant: Quadrant | null;
}

export interface DropHandlers {
  drop?: (payload: DragPayload, target: DropTarget) => void | Promise<void>;
}

/** 平面上的一个任务点（几何计算用，和 React 无关）。 */
export interface PlaneItem {
  id: string;
  x: number;
  y: number;
  title: string;
}

export interface PlaneLabelLayout {
  id: string;
  /** 标签左边缘（px，相对平面） */
  left: number;
  /** 标签上边缘（px，相对平面） */
  top: number;
  width: number;
  side: "left" | "right";
  /** 圆点与标签之间的引线；两端重合时不需要画 */
  leader: { x1: number; y1: number; x2: number; y2: number };
}
