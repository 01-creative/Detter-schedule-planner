import type { Quadrant } from "./entities";

/**
 * 四象限判定。
 *
 * 语义（艾森豪威尔）：
 *   Q1 重要且紧急  —— 马上做
 *   Q2 重要不紧急  —— 安排做（长期价值区，系统应当把用户往这里推）
 *   Q3 紧急不重要  —— 快速处理 / 委派
 *   Q4 不重要不紧急 —— 尽量不做
 *
 * 设计取舍：重要/紧急各用 1..5 的整数刻度，>= 3 视为“是”。
 * 用户手动指定象限时（manualQuadrant=true）以手动的为准，不再推导。
 */
export const QUADRANT_META = {
  1: {
    key: "q1" as const,
    name: "重要且紧急",
    short: "立即做",
    action: "马上做",
    hint: "截止日期压到今天、非你不可的事",
    gradient: ["#FFE4E6", "#FFF1F2"],
    accent: "#E11D48",
  },
  2: {
    key: "q2" as const,
    name: "重要不紧急",
    short: "计划做",
    action: "安排时间",
    hint: "长期价值：学习、健康、关系、重要项目",
    gradient: ["#D1FAE5", "#ECFDF5"],
    accent: "#059669",
  },
  3: {
    key: "q3" as const,
    name: "紧急不重要",
    short: "快速处理",
    action: "尽快清掉 / 委派",
    hint: "他人期待、临时打断、群消息",
    gradient: ["#FEF3C7", "#FFFBEB"],
    accent: "#D97706",
  },
  4: {
    key: "q4" as const,
    name: "不重要不紧急",
    short: "少做",
    action: "有空再说",
    hint: "刷信息流、无目的闲逛",
    gradient: ["#E2E8F0", "#F8FAFC"],
    accent: "#64748B",
  },
} as const satisfies Record<
  Quadrant,
  {
    key: string;
    name: string;
    short: string;
    action: string;
    hint: string;
    gradient: readonly [string, string];
    accent: string;
  }
>;

export const QUADRANT_ORDER: Quadrant[] = [1, 2, 3, 4];

/** 由重要/紧急刻度推导象限；刻度为 null 时回退到 fallback。 */
export function deriveQuadrant(
  importance: number | null | undefined,
  urgency: number | null | undefined,
  fallback: Quadrant = 2,
): Quadrant {
  const imp = typeof importance === "number" ? importance >= 3 : null;
  const urg = typeof urgency === "number" ? urgency >= 3 : null;
  if (imp === null && urg === null) return fallback;
  const i = imp ?? true;
  const u = urg ?? false;
  if (i && u) return 1;
  if (i && !u) return 2;
  if (!i && u) return 3;
  return 4;
}

/** 把 0..1 的坐标吸附到网格，返回相对象限内的位置。 */
export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

/** 象限内的九宫格吸附点（0.2 / 0.5 / 0.8），便于“精确坐标” */
export function snapToGrid(value: number, grid = 5): number {
  const step = 1 / grid;
  return Math.min(1, Math.max(0, Math.round(value / step) * step));
}
