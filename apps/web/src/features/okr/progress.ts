import type { Goal, KeyResult, KrMetricType } from "@detter/shared";

/**
 * KR 进度的唯一算法来源。
 *
 * 任务书 §3.2 规定了四种度量，进度一律折算成 0..1 的 ratio：
 * - percent   ：(cur - start) / (target - start)
 * - number    ：cur / target
 * - boolean   ：0 或 100%（cur > 0 即完成）
 * - milestone ：关联目标里「已完成里程碑 / 里程碑总数」
 *
 * 为什么 milestone 从 Goal 上取：KeyResult 契约里没有 milestones 字段，
 * 而 KR 本身带 linkedGoalIds —— 里程碑天然属于目标，跨表读才是唯一事实来源。
 * 除 linkedGoalIds 外，也接受 goal.krId === kr.id（GoalDialog 直接挂 KR 的写法）。
 *
 * Objective 进度 = 其下所有 KR 进度均值；没有 KR 时返回 null（UI 显示「—」而不是 0%）。
 */

export const KR_METRIC_LABELS: Record<KrMetricType, string> = {
  percent: "百分比",
  number: "数值",
  boolean: "是 / 否",
  milestone: "里程碑",
};

export const KR_METRIC_HINTS: Record<KrMetricType, string> = {
  percent: "(当前 - 起点) / (目标 - 起点)",
  number: "当前 / 目标",
  boolean: "完成即 100%",
  milestone: "已完成里程碑 / 总里程碑（取关联目标）",
};

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** 0..1 的比例 → 0..100 的整数百分比。 */
export function toPercent(ratio: number): number {
  return Math.round(clamp01(ratio) * 100);
}

/** 保留两位小数，避免拖动后写进库里的值变成 33.333333。 */
export function roundKrValue(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 数字展示：整数不带小数点，小数最多两位。 */
export function formatKrNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return String(roundKrValue(value));
}

/** KR 关联的目标：linkedGoalIds ∪ goal.krId，保持 goals 的原有顺序。 */
export function linkedGoalsOfKr(kr: KeyResult, goals: readonly Goal[] = []): Goal[] {
  return goals.filter(
    (goal) => !goal.deletedAt && (kr.linkedGoalIds.includes(goal.id) || goal.krId === kr.id),
  );
}

export interface MilestoneTally {
  done: number;
  total: number;
}

export function milestoneTally(kr: KeyResult, goals: readonly Goal[] = []): MilestoneTally {
  let done = 0;
  let total = 0;
  for (const goal of linkedGoalsOfKr(kr, goals)) {
    for (const milestone of goal.milestones) {
      total += 1;
      if (milestone.done) done += 1;
    }
  }
  return { done, total };
}

/** 单条 KR 的进度比例（0..1）。 */
export function krRatio(kr: KeyResult, goals: readonly Goal[] = []): number {
  switch (kr.metricType) {
    case "percent": {
      const span = kr.targetValue - kr.startValue;
      if (span === 0) return kr.currentValue >= kr.targetValue ? 1 : 0;
      return clamp01((kr.currentValue - kr.startValue) / span);
    }
    case "number": {
      if (kr.targetValue <= 0) return kr.currentValue > 0 ? 1 : 0;
      return clamp01(kr.currentValue / kr.targetValue);
    }
    case "boolean":
      return kr.currentValue > 0 ? 1 : 0;
    case "milestone": {
      const { done, total } = milestoneTally(kr, goals);
      return total === 0 ? 0 : clamp01(done / total);
    }
  }
}

export function krPercent(kr: KeyResult, goals: readonly Goal[] = []): number {
  return toPercent(krRatio(kr, goals));
}

export interface ObjectiveProgress {
  /** 0..1 */
  ratio: number;
  /** 0..100 整数 */
  percent: number;
  /** 参与平均的 KR 数 */
  count: number;
}

/** Objective 进度 = 所有 KR 进度的均值；没有 KR 时 null。 */
export function objectiveProgress(
  krs: readonly KeyResult[],
  goals: readonly Goal[] = [],
): ObjectiveProgress | null {
  if (krs.length === 0) return null;
  let sum = 0;
  for (const kr of krs) sum += krRatio(kr, goals);
  const ratio = sum / krs.length;
  return { ratio, percent: toPercent(ratio), count: krs.length };
}

/** percent / number 才允许拖拽；boolean 点击切换，milestone 由目标决定。 */
export function krAdjustable(kr: KeyResult): boolean {
  return kr.metricType === "percent" || kr.metricType === "number";
}

/** 把拖拽得到的比例折算回 currentValue。milestone 不可拖，原样返回。 */
export function krValueAtRatio(kr: KeyResult, ratio: number): number {
  const safe = clamp01(ratio);
  switch (kr.metricType) {
    case "percent":
      return Math.round(kr.startValue + safe * (kr.targetValue - kr.startValue));
    case "number":
      return roundKrValue(safe * kr.targetValue);
    case "boolean":
      return safe >= 0.5 ? 1 : 0;
    case "milestone":
      return kr.currentValue;
  }
}

/**
 * 反推：currentValue 变化时（例如自动推进 +1），对应的比例。
 * 只有测试与调试需要，UI 一律从 krRatio 出发。
 */
export function krRatioFromValue(kr: KeyResult, value: number): number {
  return krRatio({ ...kr, currentValue: value });
}

/** KR 左侧的「当前值」文案：8 / 20 篇、520 分、已完成、3 / 5 里程碑。 */
export function krValueLabel(kr: KeyResult, goals: readonly Goal[] = []): string {
  const unit = kr.unit.trim();
  switch (kr.metricType) {
    case "percent":
      return `${formatKrNumber(kr.currentValue)}${unit || "%"}`;
    case "number": {
      const head = `${formatKrNumber(kr.currentValue)} / ${formatKrNumber(kr.targetValue)}`;
      return unit ? `${head} ${unit}` : head;
    }
    case "boolean":
      return kr.currentValue > 0 ? "已完成" : "未完成";
    case "milestone": {
      const { done, total } = milestoneTally(kr, goals);
      return `${done} / ${total} 里程碑`;
    }
  }
}

/** KR 的目标文案，用于编辑弹窗与关联面板：目标 ≥ 550 分。 */
export function krTargetLabel(kr: KeyResult): string {
  const unit = kr.unit.trim();
  const suffix = unit ? ` ${unit}` : "";
  switch (kr.metricType) {
    case "percent":
      return `${formatKrNumber(kr.startValue)}${unit || "%"} → ${formatKrNumber(kr.targetValue)}${unit || "%"}`;
    case "number":
      return `目标 ${formatKrNumber(kr.targetValue)}${suffix}`;
    case "boolean":
      return "完成即达标";
    case "milestone":
      return "由关联目标的里程碑决定";
  }
}

/** 拖动气泡里的文案：60% 或 12 篇。 */
export function krRatioBubbleLabel(kr: KeyResult, ratio: number): string {
  if (kr.metricType === "percent") return `${toPercent(ratio)}%`;
  if (kr.metricType === "number") {
    const unit = kr.unit.trim();
    const value = formatKrNumber(krValueAtRatio(kr, ratio));
    return unit ? `${value} ${unit}` : value;
  }
  return `${toPercent(ratio)}%`;
}
