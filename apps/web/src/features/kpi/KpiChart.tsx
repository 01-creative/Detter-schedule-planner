import { useId } from "react";
import { cn } from "@detter/ui";
import type { KpiSeriesPoint, KpiTone } from "./kpiModel";
import { formatKpiValue } from "./kpiModel";

/**
 * 手写 SVG 趋势图（不引图表库）。
 *
 * 风格按设计令牌来：
 * - 2px 线宽、圆头圆角、渐变填充、**没有网格线**；
 * - 达标线是虚线（`strokeDasharray`），颜色跟状态走：达标绿、低于 60% 琥珀、其余用指标色；
 * - 日视图只有一个点，自动改成柱状，避免「一条线只有端点」的空白感。
 *
 * 用 `preserveAspectRatio="none"` 撑满卡片宽度，因此描边必须
 * `vectorEffect="non-scaling-stroke"`，否则宽屏下会被横向拉成 1px 或 4px。
 */

const WIDTH = 260;
const HEIGHT = 72;
const TOP = 8;
const BOTTOM = 64;
const PAD_X = 2;

export interface KpiChartProps {
  points: readonly KpiSeriesPoint[];
  /** 图表里的虚线日目标（0 表示不画） */
  target: number;
  /** 指标自己的颜色（`Kpi.color`） */
  color: string;
  tone: KpiTone;
  variant: "line" | "bar";
  /** 无障碍描述用的名字 */
  label: string;
  className?: string;
}

function toneColor(tone: KpiTone, fallback: string): string {
  if (tone === "success") return "var(--success)";
  if (tone === "warning") return "var(--warning)";
  return fallback || "var(--accent)";
}

function shortDate(date: string): string {
  return date.slice(5);
}

export function KpiChart({
  points,
  target,
  color,
  tone,
  variant,
  label,
  className,
}: KpiChartProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const gradientId = `kpi-fill-${uid}`;
  const stroke = toneColor(tone, color);
  const values = points.map((point) => point.value);
  const hasData = points.some((point) => point.hasData);
  const max = Math.max(target, 1, ...values);
  const count = Math.max(1, points.length);
  const mode = points.length <= 1 ? "bar" : variant;

  /**
   * 整个周期一条记录都没有：不要画图。
   *
   * 之前 points 里每天都有值 0，折线会沿着图表底边画一条 0 值线 ——
   * 看起来像"渲染坏了一根彩线"，而不是"还没有数据"。
   * 空态带高度固定 72px（与图表一致），卡片高度不会跳。
   */
  if (!hasData) {
    return (
      <div className={cn("flex h-[72px] items-center justify-center rounded-md bg-surface-sunken/50", className)}>
        <span className="text-micro text-ink-300">这一周期还没有记录</span>
      </div>
    );
  }

  const xOf = (index: number) =>
    count === 1 ? WIDTH / 2 : PAD_X + (index * (WIDTH - PAD_X * 2)) / (count - 1);
  const yOf = (value: number) => BOTTOM - (Math.max(0, value) / max) * (BOTTOM - TOP);

  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${xOf(index).toFixed(1)} ${yOf(point.value).toFixed(1)}`)
    .join(" ");
  const areaPath =
    points.length > 0
      ? `${linePath} L${xOf(points.length - 1).toFixed(1)} ${BOTTOM} L${xOf(0).toFixed(1)} ${BOTTOM} Z`
      : "";
  const targetY = target > 0 ? yOf(target) : null;
  const barWidth = Math.max(2, ((WIDTH - PAD_X * 2) / count) * 0.56);
  const peak = values.length > 0 ? Math.max(...values) : 0;

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="h-[72px] w-full overflow-visible"
        role="img"
        aria-label={`${label}趋势图：最高 ${formatKpiValue(peak)}，日目标 ${formatKpiValue(target)}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.26" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>

        {mode === "bar" ? (
          <>
            <line
              x1={PAD_X}
              x2={WIDTH - PAD_X}
              y1={BOTTOM}
              y2={BOTTOM}
              stroke="var(--border-strong)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            {points.map((point, index) => {
              const top = yOf(point.value);
              const height = Math.max(0, BOTTOM - top);
              return (
                <rect
                  key={point.date}
                  x={xOf(index) - barWidth / 2}
                  y={height === 0 ? BOTTOM : top}
                  width={barWidth}
                  height={height === 0 ? 0 : height}
                  rx="2"
                  fill={`url(#${gradientId})`}
                  stroke={stroke}
                  strokeWidth="1"
                  strokeOpacity="0.55"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </>
        ) : (
          <>
            <path d={areaPath} fill={`url(#${gradientId})`} />
            <path
              d={linePath}
              fill="none"
              stroke={stroke}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}

        {targetY !== null && (
          <line
            x1={PAD_X}
            x2={WIDTH - PAD_X}
            y1={targetY}
            y2={targetY}
            stroke="var(--ink-300)"
            strokeWidth="1.5"
            strokeDasharray="4 4"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      <div className="mt-1 flex items-center justify-between text-micro text-ink-300">
        <span className="tabular">{shortDate(points[0]?.date ?? "")}</span>
        {points.length > 3 && (
          <span className="tabular">{shortDate(points[Math.floor(points.length / 2)]?.date ?? "")}</span>
        )}
        <span className="tabular">{shortDate(points[points.length - 1]?.date ?? "")}</span>
      </div>
    </div>
  );
}
