/**
 * OKR 的视觉预设。
 *
 * 与目标栏同一思路：颜色只给有限几档，避免页面变成调色盘。
 * 不直接 import features/goals 的常量 —— 两个 feature 各自演进，互不依赖。
 */
export const OKR_COLORS = [
  "#8B5CF6",
  "#6355F6",
  "#0EA5E9",
  "#10B981",
  "#F59E0B",
  "#EC4899",
  "#64748B",
  "#EF4444",
] as const;

export const DEFAULT_OKR_COLOR = OKR_COLORS[0];
