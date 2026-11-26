import { QUADRANT_META, formatDateTime, formatDuration } from "@detter/shared";
import type { Quadrant } from "@detter/shared";
import { formatKrNumber } from "@/features/okr/progress";
import { quadrantShare, type ReviewGoalRow, type ReviewMetrics, type ReviewOkrRow, type ReviewRange } from "./metrics";
import type { ReviewNarrative } from "./narrative";

/**
 * 复盘 → Markdown。
 *
 * 目标是「粘到任何对话框里都能直接读」：中文标点、表格列宽用对齐行固定、
 * 不出现 HTML、不依赖图片。这里不碰 DOM，下载 / 复制由 export.ts 负责，
 * 所以格式本身可以被单测逐行锁住。
 */

const QUADRANTS: readonly Quadrant[] = [1, 2, 3, 4];

function quadrantName(quadrant: Quadrant): string {
  return `Q${quadrant} ${QUADRANT_META[quadrant].name}`;
}

function dueText(ts: number | null): string {
  if (ts === null) return "未排期";
  const date = new Date(ts);
  const clock = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${date.getMonth() + 1}/${date.getDate()} ${clock}`;
}

function goalRow(row: ReviewGoalRow): string {
  const delta = row.delta === null ? "—" : row.delta > 0 ? `+${row.delta}` : `${row.delta}`;
  return `| ${row.title} | ${row.taskDone}/${row.taskTotal} | ${row.progress}% | ${delta} |`;
}

function okrSection(row: ReviewOkrRow): string[] {
  const head = `### ${row.title} · ${row.progress === null ? "—" : `${row.progress}%`}`;
  const lines = [head];
  if (row.krs.length === 0) {
    lines.push("- 这个 Objective 还没有 KR。");
  } else {
    for (const kr of row.krs) {
      lines.push(`- ${kr.title}：${kr.percent}%`);
    }
  }
  if (row.taskTotal > 0) {
    lines.push(`- 关联任务：${row.taskDone}/${row.taskTotal} 已完成`);
  }
  return lines;
}

/** 生成完整 Markdown。`meta` 允许调用方补上生成时间与快照键。 */
export function buildReviewMarkdown(
  metrics: ReviewMetrics,
  narrative: ReviewNarrative,
  meta: { generatedAt?: number; snapshotKey?: string } = {},
): string {
  const range: ReviewRange = metrics.range;
  const generatedAt = meta.generatedAt ?? Date.now();
  const { tasks, focus, goals, okrs, kpis } = metrics;
  const lines: string[] = [];

  lines.push(`# ${rangeLabelWord(range)}复盘 · ${range.label}`);
  lines.push("");
  lines.push(`> ${narrative.headline}`);
  lines.push("");
  lines.push(`- 数据范围：${range.caption}`);
  lines.push(`- 生成时间：${formatDateTime(generatedAt)}`);
  if (meta.snapshotKey) lines.push(`- 快照键：${meta.snapshotKey}`);
  lines.push("");

  lines.push("## 概览");
  lines.push("");
  lines.push("| 项目 | 数值 |");
  lines.push("| --- | ---: |");
  lines.push(`| 完成 / 新增 | ${tasks.done} / ${tasks.created} 项 |`);
  lines.push(`| 完成率 | ${tasks.completionRate === null ? "—" : `${Math.round(tasks.completionRate * 100)}%`} |`);
  lines.push(`| 逾期未完成 | ${tasks.overdue} 项 |`);
  lines.push(`| 经手任务 | ${tasks.touched} 项 |`);
  lines.push(`| 专注 | ${formatDuration(focus.minutes)} · ${focus.sessions} 个番茄 |`);
  lines.push(`| KPI 达标 | ${metrics.kpiAchieved} / ${kpis.length} |`);
  lines.push("");

  lines.push("## 四象限分布");
  lines.push("");
  lines.push(
    `经手 ${tasks.touched} 项（周期内新增 ∪ 完成，按任务去重），Q2 占比 ${tasks.q2Share}%。`,
  );
  lines.push("");
  lines.push("| 象限 | 数量 | 占比 |");
  lines.push("| --- | ---: | ---: |");
  for (const quadrant of QUADRANTS) {
    const count = tasks.quadrants[quadrant] ?? 0;
    lines.push(`| ${quadrantName(quadrant)} | ${count} | ${quadrantShare(count, tasks.touched)}% |`);
  }
  lines.push("");

  lines.push("## 待办清单");
  lines.push("");
  if (tasks.todo.length === 0) {
    lines.push("没有未完成的待办。");
  } else {
    for (const item of tasks.todo) {
      const overdue =
        item.dueAt !== null && item.dueAt < metrics.evaluatedAt ? " 已逾期" : "";
      const due = item.dueAt === null ? "未排期" : `${dueText(item.dueAt)}${overdue}`;
      lines.push(`- [ ] Q${item.quadrant} · ${item.title}（${due}）`);
    }
    if (tasks.todoMore > 0) {
      lines.push(`- 还有 ${tasks.todoMore} 项未列出，打开 Detter 查看完整待办。`);
    }
  }
  lines.push("");

  lines.push("## 目标进展");
  lines.push("");
  if (goals.length === 0) {
    lines.push("本周期没有可统计的目标进展。");
  } else {
    lines.push("| 目标 | 任务 | 进度 | 较上次 |");
    lines.push("| --- | ---: | ---: | ---: |");
    for (const row of goals) lines.push(goalRow(row));
  }
  lines.push("");

  lines.push("## OKR");
  lines.push("");
  if (okrs.length === 0) {
    lines.push("本周期没有进行中的 Objective。");
  } else {
    for (const row of okrs) {
      lines.push(...okrSection(row));
      lines.push("");
    }
    if (okrs.length > 0) lines.pop();
  }
  lines.push("");

  lines.push("## KPI");
  lines.push("");
  if (kpis.length === 0) {
    lines.push("还没有启用中的 KPI。");
  } else {
    lines.push("| KPI | 实际 | 目标 | 达成 |");
    lines.push("| --- | ---: | ---: | ---: |");
    for (const kpi of kpis) {
      const actual = formatKrNumber(kpi.value);
      const target = formatKrNumber(kpi.target);
      const percent = kpi.percent === null ? "—" : `${kpi.percent}%`;
      const mark = kpi.achieved ? " ✅" : " ⚠️";
      lines.push(`| ${kpi.name} | ${actual} ${kpi.unit} | ${target} ${kpi.unit} | ${percent}${mark} |`);
    }
    if (kpis.some((kpi) => kpi.scale > 1)) {
      lines.push("");
      lines.push("> 目标按复盘窗口折算（日目标 ×7、周目标 ×4…），与 KPI 页按自身周期查看的数字窗口不同。");
    }
  }
  lines.push("");

  lines.push("## 做得好的");
  lines.push("");
  for (const item of narrative.highlights) lines.push(`- ${item}`);
  lines.push("");

  lines.push("## 值得注意的");
  lines.push("");
  for (const item of narrative.attention) lines.push(`- ${item}`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("由 Detter 生成 · 数据只来自本地库 · 不含任何外部请求");

  return lines.join("\n");
}

function rangeLabelWord(range: ReviewRange): string {
  if (range.type === "week") return range.offset < 0 ? "上周" : "本周";
  return range.offset < 0 ? "上月" : "本月";
}
