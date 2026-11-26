import type { ReviewMetrics, ReviewRange } from "./metrics";
import type { ReviewNarrative } from "./narrative";
import type { ReviewSnapshot } from "./snapshot";

/**
 * 复盘导出：剪贴板 / .md / .json。
 *
 * 全部在浏览器本地完成，不上传任何内容。JSON 是给 agent 用的结构化数据，
 * 字段与 metrics 一一对应，不包含函数或 DOM 信息。
 */

export const REVIEW_EXPORT_VERSION = 1;

export interface ReviewExportPayload {
  range: ReviewRange;
  generatedAt: number;
  narrative: ReviewNarrative;
  metrics: ReviewMetrics;
  markdown?: string;
}

export function buildReviewJson(payload: ReviewExportPayload): string {
  return JSON.stringify(
    {
      generator: "detter",
      schema: "detter.review",
      version: REVIEW_EXPORT_VERSION,
      generatedAt: payload.generatedAt,
      generatedAtLocal: new Date(payload.generatedAt).toISOString(),
      range: {
        type: payload.range.type,
        offset: payload.range.offset,
        periodKey: payload.range.periodKey,
        label: payload.range.label,
        startKey: payload.range.startKey,
        endKey: payload.range.endKey,
        start: payload.range.start,
        end: payload.range.end,
      },
      narrative: payload.narrative,
      metrics: payload.metrics,
      ...(payload.markdown ? { markdown: payload.markdown } : {}),
    },
    null,
    2,
  );
}

export function buildReviewJsonFromSnapshot(snapshot: ReviewSnapshot): string {
  return buildReviewJson({
    range: snapshot.range,
    generatedAt: snapshot.generatedAt,
    narrative: snapshot.narrative,
    metrics: snapshot.metrics,
    markdown: snapshot.markdown,
  });
}

/** 文件名只用 ASCII：跨设备、跨系统保存都不会出现乱码。 */
export function reviewFileName(range: ReviewRange, ext: "md" | "json"): string {
  const slug = range.type === "week" ? range.startKey : range.startKey.slice(0, 7);
  return `detter-review-${range.type}-${slug}.${ext}`;
}

/** 复制到剪贴板。http 非安全上下文下 Clipboard API 不存在，退回 textarea 方案。 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 继续走兜底方案
    }
  }
  if (typeof document === "undefined") return false;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  const selected = document.getSelection();
  const previous = selected && selected.rangeCount > 0 ? selected.getRangeAt(0) : null;
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(area);
  if (previous) {
    selected?.removeAllRanges();
    selected?.addRange(previous);
  }
  return ok;
}

export function downloadText(filename: string, text: string, mime: string): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
