import { clampUnit } from "@detter/shared";
import type { Quadrant, Task } from "@detter/shared";
import type { PlaneItem, PlaneLabelLayout, RectLike, DropTarget } from "./types";

/**
 * 四象限平面的纯几何计算。
 *
 * 坐标语义（全平面统一）：
 *   x = 紧急度（0 最左，1 最右）
 *   y = 屏幕纵坐标（0 最上，1 最下），importance = 1 - y
 *   (0.5, 0.5) 是两条轴的原点
 *
 * 象限不是容器，只是由坐标符号推出来的区域：
 *   x ≥ 0.5 且 importance ≥ 0.5 → Q1，其余按同样方式得到 Q2/Q3/Q4。
 *
 * 这里刻意不碰 React、不碰 Dexie：坐标换算、迁移、标签避让都能被单测覆盖。
 */

export interface PlanePoint {
  x: number;
  y: number;
}

/** 各象限的几何中心（0.5×0.5 区块的中点）。 */
export const PLANE_QUADRANT_CENTER: Record<Quadrant, PlanePoint> = {
  1: { x: 0.75, y: 0.25 },
  2: { x: 0.25, y: 0.25 },
  3: { x: 0.75, y: 0.75 },
  4: { x: 0.25, y: 0.75 },
};

/** 新任务默认落在 Q2 靠近原点处（0.5,0.5 是轴，不能压上去）。 */
export const DEFAULT_PLANE_POSITION: PlanePoint = { x: 0.44, y: 0.44 };

/** 默认新任务所属象限：Q2 重要不紧急，正是产品希望用户多看的一格。 */
export const DEFAULT_PLANE_QUADRANT: Quadrant = 2;

/** 0 表示最左/最上，1 表示最右/最下；NaN 回退到中点。 */
export function clampPlane(value: number): number {
  return clampUnit(value);
}

export function clampPlanePoint(point: PlanePoint, inset = 0): PlanePoint {
  const min = inset;
  const max = 1 - inset;
  return {
    x: Math.min(max, Math.max(min, clampPlane(point.x))),
    y: Math.min(max, Math.max(min, clampPlane(point.y))),
  };
}

/**
 * 由平面坐标推导象限。边界值按「靠轴即算」处理：
 * x = 0.5 算紧急，y = 0.5 算重要，因此原点 (0.5,0.5) 属于 Q1。
 */
export function quadrantFromPosition(x: number, y: number): Quadrant {
  const urgent = clampPlane(x) >= 0.5;
  const important = 1 - clampPlane(y) >= 0.5;
  if (important) return urgent ? 1 : 2;
  return urgent ? 3 : 4;
}

/** 坐标是否落在某个象限内部（含边界，边界按 Q1/Q3 优先）。 */
export function quadrantOfTask(task: Pick<Task, "posX" | "posY">): Quadrant {
  return quadrantFromPosition(task.posX, task.posY);
}

/**
 * 旧数据换算：老坐标是「象限 + 格内相对坐标」，换成全平面坐标。
 *
 *   x = (q1|q3) ? 0.5 + posX*0.5 : posX*0.5
 *   y = (q1|q2) ? posY*0.5     : 0.5 + posY*0.5
 */
export function planeFromLegacy(quadrant: Quadrant, posX: number, posY: number): PlanePoint {
  const x = clampPlane(posX);
  const y = clampPlane(posY);
  const right = quadrant === 1 || quadrant === 3;
  const top = quadrant === 1 || quadrant === 2;
  return {
    x: right ? 0.5 + x * 0.5 : x * 0.5,
    y: top ? y * 0.5 : 0.5 + y * 0.5,
  };
}

/**
 * 渲染/拖拽时使用的真实位置。
 *
 * 正常任务的坐标和 quadrant 是一致的；但目标栏、收件箱、模板展开等入口
 * 仍可能按旧语义（象限 + 格内坐标）写库。这里做一次无副作用的兼容换算：
 * 坐标推不出存储象限时，按旧坐标解释一次。换算后坐标与象限一致，因此可重复调用。
 */
export function resolveTaskPoint(task: Pick<Task, "posX" | "posY" | "quadrant">): PlanePoint {
  const direct = { x: clampPlane(task.posX), y: clampPlane(task.posY) };
  if (quadrantFromPosition(direct.x, direct.y) === task.quadrant) return direct;
  return planeFromLegacy(task.quadrant, direct.x, direct.y);
}

/** 把一条任务转换到目标象限，保留它在原象限内的相对位置。 */
export function relocateToQuadrant(
  x: number,
  y: number,
  target: Quadrant,
): PlanePoint {
  const from = quadrantFromPosition(x, y);
  const fromLeft = from === 1 || from === 3 ? 0.5 : 0;
  const fromTop = from === 1 || from === 2 ? 0 : 0.5;
  // 0..0.5 的区块内部再留 6% 边距，避免落在坐标轴上（轴上会被判给另一格）
  const relX = Math.min(0.94, Math.max(0.06, (clampPlane(x) - fromLeft) / 0.5));
  const relY = Math.min(0.94, Math.max(0.06, (clampPlane(y) - fromTop) / 0.5));
  const left = target === 1 || target === 3 ? 0.5 : 0;
  const top = target === 1 || target === 2 ? 0 : 0.5;
  return { x: left + relX * 0.5, y: top + relY * 0.5 };
}

/** 象限内部的可用范围（留边距，避免点压在轴上）。 */
function quadrantBounds(quadrant: Quadrant): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  const left = quadrant === 1 || quadrant === 3 ? 0.5 : 0;
  const top = quadrant === 1 || quadrant === 2 ? 0 : 0.5;
  return {
    minX: left + 0.05,
    maxX: left + 0.45,
    minY: top + 0.05,
    maxY: top + 0.45,
  };
}

const MIN_DOT_GAP = 0.035;

/**
 * 新任务的默认落点：先试 Q2 近中心，再沿黄金角螺旋找一个和已有点不重合的位置。
 *
 * 不做复杂布局，也不引入库：只要保证「不全都堆在同一个点」，用户就能逐个拖走。
 */
export function nextFreePlanePosition(
  points: readonly PlanePoint[],
  anchor: PlanePoint = DEFAULT_PLANE_POSITION,
  quadrant: Quadrant = quadrantFromPosition(anchor.x, anchor.y),
): PlanePoint {
  const bounds = quadrantBounds(quadrant);
  const inside = (point: PlanePoint) =>
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY;
  const clampToQuadrant = (point: PlanePoint): PlanePoint => ({
    x: Math.min(bounds.maxX, Math.max(bounds.minX, clampPlane(point.x))),
    y: Math.min(bounds.maxY, Math.max(bounds.minY, clampPlane(point.y))),
  });
  const taken = points.map((point) => clampPlanePoint(point));
  const free = (point: PlanePoint) =>
    taken.every(
      (other) => Math.hypot(other.x - point.x, other.y - point.y) >= MIN_DOT_GAP,
    );

  const base = clampToQuadrant(anchor);
  if (free(base)) return inside(base) ? base : clampToQuadrant(base);

  // 黄金角螺旋：半径随序号增大，方向自然铺开，不会排成一条直线
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 1; i <= 96; i += 1) {
    const radius = 0.04 * Math.sqrt(i);
    const angle = i * goldenAngle;
    const candidate = clampToQuadrant({
      x: base.x + Math.cos(angle) * radius,
      y: base.y + Math.sin(angle) * radius,
    });
    if (free(candidate)) return candidate;
  }
  return base;
}

/** 估算标签宽度（px）。显式宽度是绝对定位下不被压成竖排的关键。 */
export function estimateLabelWidth(title: string): number {
  let width = 0;
  for (const char of Array.from(title)) {
    const code = char.codePointAt(0) ?? 0;
    if (/\s/.test(char)) width += 3.4;
    else if (code > 0x2e80) width += 11.5;
    else if (/[A-Z0-9]/.test(char)) width += 7;
    else if (/[a-z]/.test(char)) width += 6.4;
    else width += 5.2;
  }
  return Math.round(Math.min(172, Math.max(64, width + 16)));
}

export interface LabelLayoutOptions {
  width: number;
  height: number;
  labelHeight?: number;
  gap?: number;
  padding?: number;
  /** 允许测试注入宽度，生产环境用 estimateLabelWidth */
  measure?: (item: PlaneItem) => number;
}

/**
 * 标签避让：按圆点 y 排序，同一侧发生重叠的标签向下（到底后向上）错开，
 * 并拉长圆点到标签的引线。简单、确定、无第三方依赖。
 */
export function layoutPlaneLabels(
  items: readonly PlaneItem[],
  options: LabelLayoutOptions,
): PlaneLabelLayout[] {
  const {
    width: planeWidth,
    height: planeHeight,
    labelHeight = 24,
    gap = 4,
    padding = 6,
    measure = (item) => estimateLabelWidth(item.title),
  } = options;
  if (planeWidth <= 0 || planeHeight <= 0 || items.length === 0) return [];

  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  const maxTop = Math.max(padding, planeHeight - padding - labelHeight);
  const placed: Array<{ left: number; top: number; width: number }> = [];
  const layouts: PlaneLabelLayout[] = [];

  const overlaps = (a: { left: number; top: number; width: number }, b: (typeof placed)[number]) =>
    a.left < b.left + b.width + gap &&
    a.left + a.width + gap > b.left &&
    a.top < b.top + labelHeight + gap &&
    a.top + labelHeight + gap > b.top;

  for (const item of sorted) {
    const dotX = item.x * planeWidth;
    const dotY = item.y * planeHeight;
    const width = Math.min(172, Math.max(48, measure(item)));
    const rightLeft = dotX + 12;
    const leftLeft = dotX - 12 - width;
    const rightFits = rightLeft + width <= planeWidth - padding;
    const leftFits = leftLeft >= padding;
    const preferred: "left" | "right" = rightFits || !leftFits ? "right" : "left";
    const sides: Array<"left" | "right"> = preferred === "right" ? ["right", "left"] : ["left", "right"];
    const desiredTop = Math.min(maxTop, Math.max(padding, dotY - labelHeight / 2));

    let chosen: { side: "left" | "right"; left: number; top: number } | null = null;
    for (const side of sides) {
      const rawLeft = side === "right" ? rightLeft : leftLeft;
      const left = Math.min(planeWidth - padding - width, Math.max(padding, rawLeft));
      let top = desiredTop;
      let resolved = true;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const hit = placed.find((entry) => overlaps({ left, top, width }, entry));
        if (!hit) break;
        // 指针在上半部就往上让，下半部就往下让；两端都撞墙时换另一侧
        const above = top + labelHeight / 2 < hit.top + labelHeight / 2;
        top = above ? hit.top - labelHeight - gap : hit.top + labelHeight + gap;
        if (top < padding || top > maxTop) {
          top = Math.min(maxTop, Math.max(padding, top));
          if (placed.some((entry) => overlaps({ left, top, width }, entry))) {
            resolved = false;
            break;
          }
        }
      }
      if (resolved) {
        chosen = { side, left, top };
        break;
      }
    }

    const side = chosen?.side ?? preferred;
    const left =
      chosen?.left ??
      Math.min(
        planeWidth - padding - width,
        Math.max(padding, side === "right" ? rightLeft : leftLeft),
      );
    const top = chosen?.top ?? desiredTop;
    placed.push({ left, top, width });
    layouts.push({
      id: item.id,
      left,
      top,
      width,
      side,
      leader: {
        x1: dotX,
        y1: dotY,
        x2: side === "right" ? left : left + width,
        y2: top + labelHeight / 2,
      },
    });
  }

  return layouts;
}

/* -------------------------------------------------------------------------- */
/*                              指针 / 落点换算                                 */
/* -------------------------------------------------------------------------- */

/** 指针 → 平面归一化坐标；超出平面会被夹到 0..1。 */
export function unitFromPoint(x: number, y: number, rect: RectLike): PlanePoint {
  const width = rect.width || 1;
  const height = rect.height || 1;
  return {
    x: clampPlane((x - rect.left) / width),
    y: clampPlane((y - rect.top) / height),
  };
}

export function planeRect(rect: RectLike): RectLike {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

/** 找指针下的平面容器（`[data-plane]`）。 */
export function findPlaneElement(
  x: number,
  y: number,
  doc: Document = document,
): HTMLElement | null {
  let hit: Element | null = null;
  try {
    hit = typeof doc.elementFromPoint === "function" ? doc.elementFromPoint(x, y) : null;
  } catch {
    hit = null;
  }
  if (!hit) return null;
  const plane = hit.closest("[data-plane]");
  return plane instanceof HTMLElement ? plane : null;
}

/** 落点判定：指针下的平面 + 全平面坐标。 */
export function resolveDropTarget(
  x: number,
  y: number,
  doc: Document = document,
): DropTarget | null {
  const plane = findPlaneElement(x, y, doc);
  if (!plane) return null;
  const box = plane.getBoundingClientRect();
  const point = unitFromPoint(x, y, {
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
  });
  return {
    quadrant: quadrantFromPosition(point.x, point.y),
    posX: point.x,
    posY: point.y,
    rect: planeRect({
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
    }),
  };
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

/** 拖拽读数：紧急度 0.72 · 重要度 0.37 */
export function coordinateReadout(x: number, y: number): string {
  return `紧急度 ${clampPlane(x).toFixed(2)} · 重要度 ${(1 - clampPlane(y)).toFixed(2)}`;
}

/** 圆点是否算「同一点」（用于迁移去重、渲染诊断）。 */
export function isSamePoint(a: PlanePoint, b: PlanePoint, epsilon = 0.001): boolean {
  return Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon;
}
