import type { Goal, Quadrant, Task } from "@detter/shared";

/**
 * 四象限画板的共享类型。
 *
 * 视图与排序模式落在 `settings` 表（quadrant.viewMode / quadrant.sortMode），
 * 因为它们是「这台设备怎么看」，不属于任务本身。
 */

export type ViewMode = "list" | "free";

export type SortMode = "smart" | "manual";

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 一次落点：落进哪个象限、象限内的相对坐标（0..1）、以及该格的可用矩形。 */
export interface DropTarget {
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
