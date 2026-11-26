import { formatDuration } from "@detter/shared";
import type { ReviewMetrics, ReviewRange, ReviewRangeType } from "./metrics";

/**
 * 复盘的「人话」层：一行结论 + 做得好的 + 值得注意的。
 *
 * 全部由规则生成（任务书 §4.2：不用模型）。规则只读 metrics 的聚合结果，
 * 因此每句话都能追溯到某个数字，也可以被单测逐句锁住。
 * 输出上限：亮点与注意事项各 3 条 —— 复盘是给自己看的，超过三条就没人看。
 */

export interface ReviewNarrative {
  headline: string;
  highlights: string[];
  attention: string[];
}

const RANGE_WORD: Record<ReviewRangeType, { current: string; previous: string }> = {
  week: { current: "本周", previous: "上周" },
  month: { current: "本月", previous: "上月" },
};

export function rangeWord(range: ReviewRange): string {
  return range.offset < 0 ? RANGE_WORD[range.type].previous : RANGE_WORD[range.type].current;
}

function percentText(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function verdict(metrics: ReviewMetrics): string {
  const { tasks } = metrics;
  if (tasks.created === 0 && tasks.done === 0) return "这周几乎没留下记录";
  if (tasks.completionRate !== null && tasks.completionRate >= 0.8 && tasks.overdue === 0) {
    return "收尾很干净";
  }
  if (tasks.overdue > 0 && tasks.overdue >= Math.max(1, tasks.done)) return "有点拖尾";
  if (tasks.completionRate !== null && tasks.completionRate < 0.5) return "推进偏慢";
  return "节奏正常";
}

function buildHeadline(metrics: ReviewMetrics): string {
  const word = rangeWord(metrics.range);
  const { tasks, focus, kpis, kpiAchieved } = metrics;
  const parts: string[] = [];

  if (tasks.created === 0 && tasks.done === 0) {
    parts.push(`${word}还没有完成或新增记录`);
  } else {
    parts.push(`完成 ${tasks.done} 项（完成率 ${percentText(tasks.completionRate)}）`);
    parts.push(`新增 ${tasks.created} 项`);
    if (tasks.overdue > 0) parts.push(`逾期 ${tasks.overdue} 项`);
  }

  if (focus.sessions > 0) {
    parts.push(`专注 ${formatDuration(focus.minutes)} · ${focus.sessions} 个番茄`);
  } else {
    parts.push("没有专注记录");
  }

  if (tasks.touched > 0) parts.push(`Q2 占比 ${tasks.q2Share}%`);
  if (kpis.length > 0) parts.push(`KPI 达标 ${kpiAchieved}/${kpis.length}`);

  return `${verdict(metrics)}：${parts.join("，")}。`;
}

function buildHighlights(metrics: ReviewMetrics): string[] {
  const word = rangeWord(metrics.range);
  const out: string[] = [];
  const { tasks, focus, kpis, kpiAchieved, goals } = metrics;

  if (tasks.done > 0 && tasks.completionRate !== null && tasks.completionRate >= 0.8) {
    out.push(`完成 ${tasks.done} 项，完成率 ${percentText(tasks.completionRate)}，${word}的事情基本收完了。`);
  }
  if (tasks.touched >= 4 && tasks.q2Share >= 50) {
    out.push(`Q2（重要不紧急）占 ${tasks.q2Share}%，注意力在防火而不是救火。`);
  }
  if (focus.streakDays >= 3) {
    out.push(`连续 ${focus.streakDays} 天有专注记录，节奏稳定。`);
  }
  if (kpis.length > 0 && kpiAchieved === kpis.length) {
    out.push(`${kpis.length} 个 KPI 全部达标。`);
  }
  if (focus.minutes >= 120 && focus.streakDays < 3) {
    out.push(`专注累计 ${formatDuration(focus.minutes)}，深度工作有底子。`);
  }
  const improved = goals.find((goal) => goal.delta !== null && goal.delta > 0);
  if (improved) {
    out.push(`「${improved.title}」比上次快照推进了 ${improved.delta} 个百分点。`);
  }

  if (out.length === 0) {
    out.push(`${word}的数据还少，先挑一件真正重要的事开始，比补记录更有用。`);
  }
  return out.slice(0, 3);
}

function buildAttention(metrics: ReviewMetrics): string[] {
  const word = rangeWord(metrics.range);
  const out: string[] = [];
  const { tasks, focus, kpis } = metrics;
  const q1Overdue = tasks.overdueByQuadrant[1] ?? 0;

  if (tasks.overdue > 0) {
    out.push(
      q1Overdue > 0
        ? `${tasks.overdue} 项逾期未完成，其中 Q1 ${q1Overdue} 项。`
        : `${tasks.overdue} 项逾期未完成，先清掉或直接放弃。`,
    );
  }
  if (tasks.completionRate !== null && tasks.completionRate < 0.5) {
    out.push(
      `完成率 ${percentText(tasks.completionRate)}：新增（${tasks.created}）明显多于完成（${tasks.done}），先把池子收小。`,
    );
  }
  if (tasks.touched >= 4 && tasks.q2Share < 30) {
    out.push(`Q2 占比只有 ${tasks.q2Share}%，容易陷在救火里。`);
  }
  if (focus.sessions === 0) {
    out.push(`${word}没有专注记录，重要的事很难只靠碎片时间推进。`);
  }
  const missedKpis = kpis.filter((kpi) => !kpi.achieved);
  if (missedKpis.length > 0) {
    const names = missedKpis
      .slice(0, 2)
      .map((kpi) => kpi.name)
      .join("、");
    out.push(`${names}未达标（${metrics.kpiAchieved}/${kpis.length}）。`);
  }
  if (tasks.open >= 15) {
    out.push(`待办积压 ${tasks.open} 项，建议先删掉不做的。`);
  }
  const regressed = metrics.goals.find((goal) => goal.delta !== null && goal.delta < 0);
  if (regressed) {
    out.push(`「${regressed.title}」比上次快照回落 ${Math.abs(regressed.delta ?? 0)} 个百分点。`);
  }

  if (out.length === 0) {
    out.push("没有明显异常。保持现在的节奏，别为了填满表格加事。");
  }
  return out.slice(0, 3);
}

export function buildReviewNarrative(metrics: ReviewMetrics): ReviewNarrative {
  return {
    headline: buildHeadline(metrics),
    highlights: buildHighlights(metrics),
    attention: buildAttention(metrics),
  };
}
