import { QUADRANT_META } from "@detter/shared";
import type { Quadrant } from "@detter/shared";
import type { BadgeTone } from "@detter/ui";

/**
 * 复盘页的展示小工具（无数据依赖）。
 *
 * 颜色一律取令牌变量，不在组件里写死色值 —— 深浅色切换、象限换色都只改 tokens.css。
 */

export function quadrantColor(quadrant: Quadrant): string {
  return `var(--q${quadrant}-accent)`;
}

export function quadrantSoft(quadrant: Quadrant): string {
  return `var(--q${quadrant}-soft)`;
}

export function quadrantName(quadrant: Quadrant): string {
  return QUADRANT_META[quadrant].name;
}

/** 11/28 18:00 / 11/28 · 全天之外的截止时间展示。 */
export function formatDueShort(ts: number): string {
  const date = new Date(ts);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Q2 占比的健康度。阈值与任务书示例的「52%（健康）」对齐。 */
export function q2Health(share: number, touched: number): { label: string; tone: BadgeTone } {
  if (touched === 0) return { label: "数据不足", tone: "neutral" };
  if (share >= 50) return { label: "健康", tone: "success" };
  if (share >= 30) return { label: "尚可", tone: "warning" };
  return { label: "偏低", tone: "danger" };
}

export function kpiTone(achieved: boolean, hasValue: boolean): BadgeTone {
  if (!hasValue) return "neutral";
  return achieved ? "success" : "warning";
}

/** 「目标按 7 天折算」/「目标按 4 周折算」：说清折算的是哪个周期单位。 */
export function kpiScaleLabel(period: "day" | "week" | "month", scale: number): string {
  if (period === "day") return `目标按 ${scale} 天折算`;
  if (period === "week") return `目标按 ${scale} 周折算`;
  return `目标按 ${scale} 个月折算`;
}

/** 「5小时20分」这类时长在窄屏下要能折行，这里给到分钟级的紧凑文案。 */
export function compactMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}分`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}小时` : `${hours}小时${rest}分`;
}
