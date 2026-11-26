import { clampUnit, isSameDay } from "@detter/shared";
import type { Quadrant, Task } from "@detter/shared";
import type { DropTarget, RectLike, SortMode } from "./types";

/**
 * 四象限的纯几何 / 排序计算。
 *
 * 这里刻意不碰 React、不碰 Dexie：拖拽落点、插入位置、排序这些一旦写成纯函数，
 * 就能在没有浏览器拖拽事件的情况下被单测覆盖（见 __tests__/geometry.test.ts）。
 */

/* -------------------------------------------------------------------------- */
/*                                  坐标换算                                    */
/* -------------------------------------------------------------------------- */

/**
 * 指针 → 象限内相对坐标。
 *
 * 0 表示贴左/上边，1 表示贴右/下边；超出格子的坐标会被夹到 0..1，
 * 因此拖到格子外再滑回来也不会写进非法值。
 */
export function unitFromPoint(
  x: number,
  y: number,
  rect: RectLike,
): { posX: number; posY: number } {
  const width = rect.width || 1;
  const height = rect.height || 1;
  return {
    posX: clampUnit((x - rect.left) / width),
    posY: clampUnit((y - rect.top) / height),
  };
}

/** 从 DOM 元素上读象限编号；不是合法的 1..4 就返回 null。 */
export function quadrantFromElement(element: Element | null | undefined): Quadrant | null {
  const cell = element?.closest("[data-quadrant]");
  if (!cell) return null;
  const value = Number(cell.getAttribute("data-quadrant"));
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : null;
}

/**
 * 找指针下最近的象限格。
 *
 * jsdom 没有 elementFromPoint 的完整实现，这里用可选调用 + try/catch 兜底，
 * 单测里替换成桩函数即可（坐标换算逻辑本身不依赖真实布局）。
 */
export function findQuadrantElement(x: number, y: number, doc: Document = document): HTMLElement | null {
  let hit: Element | null = null;
  try {
    hit = typeof doc.elementFromPoint === "function" ? doc.elementFromPoint(x, y) : null;
  } catch {
    hit = null;
  }
  if (!hit) return null;
  const cell = hit.closest("[data-quadrant]");
  return cell instanceof HTMLElement ? cell : null;
}

/**
 * 落点判定：指针下的格子 + 格内坐标。
 *
 * 自由模式下卡片是相对 `[data-quadrant-layer]` 绝对定位的，
 * 所以坐标要按那一层的矩形算（和 CSS 里的百分比同源），否则卡片落点会偏。
 * 列表模式没有这一层，退回格子自身。
 */
export function dropTargetFromRect(
  quadrant: Quadrant,
  x: number,
  y: number,
  rect: RectLike,
): DropTarget {
  const { posX, posY } = unitFromPoint(x, y, rect);
  return { quadrant, posX, posY, rect };
}

export function resolveDropTarget(x: number, y: number, doc: Document = document): DropTarget | null {
  const cell = findQuadrantElement(x, y, doc);
  if (!cell) return null;
  const quadrant = quadrantFromElement(cell);
  if (quadrant === null) return null;
  const layer = cell.querySelector<HTMLElement>("[data-quadrant-layer]");
  const box = (layer ?? cell).getBoundingClientRect();
  return dropTargetFromRect(quadrant, x, y, {
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
  });
}

/* -------------------------------------------------------------------------- */
/*                              列表模式：插入位置                              */
/* -------------------------------------------------------------------------- */

export interface CardBoundary {
  id: string;
  top: number;
  height: number;
}

/**
 * 根据指针纵坐标算出插到第几个位置。
 * 用「卡片中线」判定：指针过了中线就算放在它后面，这样手感更接近文件列表。
 */
export function insertionIndexForPoint(cards: readonly CardBoundary[], y: number): number {
  let index = 0;
  for (const card of cards) {
    const middle = card.top + card.height / 2;
    if (y > middle) index += 1;
    else break;
  }
  return index;
}

/**
 * 插入位置的 sortIndex：取前后邻居的中点，只写一条记录。
 * 两端没有邻居时向 ±1 延伸；极端情况下浮点精度耗尽（很少见），
 * 由调用方触发一次整格重排即可，这里不制造副作用。
 */
export function sortIndexBetween(prev: number | undefined, next: number | undefined): number {
  if (prev === undefined && next === undefined) return 0;
  if (prev === undefined) return (next as number) - 1;
  if (next === undefined) return prev + 1;
  return (prev + next) / 2;
}

/** 把插入位置换算成 sortIndex；`others` 必须已按当前显示顺序排好。 */
export function sortIndexForInsertion(others: readonly Task[], index: number): number {
  const clamped = Math.max(0, Math.min(index, others.length));
  const prev = others[clamped - 1]?.sortIndex;
  const next = others[clamped]?.sortIndex;
  return sortIndexBetween(prev, next);
}

/* -------------------------------------------------------------------------- */
/*                                  排序规则                                    */
/* -------------------------------------------------------------------------- */

/**
 * 列表模式的排序桶：逾期 > 今天 > 有截止日 > 其他，已完成统一沉底。
 * 桶内再按 sortIndex（用户拖出来的顺序），最后用创建时间兜底，保证稳定。
 */
export const SORT_BUCKETS = {
  overdue: 0,
  today: 1,
  due: 2,
  other: 3,
  finished: 4,
} as const;

export function taskSortBucket(task: Task, now: number): number {
  if (task.status === "done" || task.status === "dropped") return SORT_BUCKETS.finished;
  if (task.dueAt !== null && task.dueAt < now) return SORT_BUCKETS.overdue;

  const when = task.dueAt ?? task.startAt;
  if (when !== null && isSameDay(when, now)) return SORT_BUCKETS.today;
  if (task.dueAt !== null) return SORT_BUCKETS.due;
  return SORT_BUCKETS.other;
}

export function sortTasksForCell(tasks: readonly Task[], mode: SortMode, now: number): Task[] {
  const sorted = [...tasks];
  sorted.sort((a, b) => {
    if (mode === "smart") {
      const delta = taskSortBucket(a, now) - taskSortBucket(b, now);
      if (delta !== 0) return delta;
    }
    if (a.sortIndex !== b.sortIndex) return a.sortIndex - b.sortIndex;
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.id.localeCompare(b.id);
  });
  return sorted;
}

/* -------------------------------------------------------------------------- */
/*                              键盘：移动象限                                  */
/* -------------------------------------------------------------------------- */

const DIRECTION_DELTA = { left: -1, right: 1, up: -2, down: 2 } as const;

export type MoveDirection = keyof typeof DIRECTION_DELTA;

/**
 * 方向键 → 象限。布局是 2×2：
 *   Q1 Q2
 *   Q3 Q4
 * 所以左右 ±1、上下 ±2；越界保持不动。
 */
export function moveQuadrant(current: Quadrant, direction: MoveDirection): Quadrant {
  const next = current + DIRECTION_DELTA[direction];
  return next === 1 || next === 2 || next === 3 || next === 4 ? next : current;
}

/* -------------------------------------------------------------------------- */
/*                          自由模式：默认坐标与叠放                            */
/* -------------------------------------------------------------------------- */

/** 新建任务时的默认九宫格落点（0.5/0.2 是任务书规定的「格头 +」默认位置）。 */
const FREE_SLOTS: ReadonlyArray<readonly [number, number]> = [
  [0.5, 0.2],
  [0.22, 0.2],
  [0.78, 0.2],
  [0.5, 0.5],
  [0.22, 0.5],
  [0.78, 0.5],
  [0.5, 0.8],
  [0.22, 0.8],
  [0.78, 0.8],
];

/** 找一个还没被占用的默认落点；都被占了就回到中心。 */
export function nextFreePosition(tasks: readonly Task[]): { posX: number; posY: number } {
  for (const [x, y] of FREE_SLOTS) {
    const used = tasks.some(
      (task) => Math.abs(task.posX - x) < 0.02 && Math.abs(task.posY - y) < 0.02,
    );
    if (!used) return { posX: x, posY: y };
  }
  return { posX: 0.5, posY: 0.5 };
}

/**
 * 完全重合的卡片（例如历史数据都是默认 0.5/0.5）在自由模式里会叠成一摞。
 * 这里给第 2 张起一个 6px 的错位，看起来像「一叠纸」，但不改数据库里的坐标 ——
 * 拖动任意一张后它就有了独立坐标。
 */
export function stackOffsets(tasks: readonly Task[]): Map<string, number> {
  const seen = new Map<string, number>();
  const offsets = new Map<string, number>();
  for (const task of tasks) {
    const key = `${task.posX.toFixed(3)}:${task.posY.toFixed(3)}`;
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    if (count > 0) offsets.set(task.id, Math.min(count, 3) * 6);
  }
  return offsets;
}
