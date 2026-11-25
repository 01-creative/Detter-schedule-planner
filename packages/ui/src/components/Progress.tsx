import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface ProgressProps {
  value: number;
  max?: number;
  tone?: "accent" | "success" | "warning" | "danger";
  size?: "sm" | "md";
  label?: string;
  trailing?: ReactNode;
  className?: string;
}

const TONE: Record<NonNullable<ProgressProps["tone"]>, string> = {
  accent: "gradient-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

/**
 * 进度条用 scaleX 而不是 width：宽度变化会触发布局，缩放只走合成层。
 * role/aria 三件套齐全，读屏能直接念出百分比。
 */
export function Progress({
  value,
  max = 100,
  tone = "accent",
  size = "sm",
  label,
  trailing,
  className,
}: ProgressProps) {
  const safeMax = max > 0 ? max : 100;
  const ratio = Math.min(1, Math.max(0, value / safeMax));
  const percent = Math.round(ratio * 100);

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {label && <span className="shrink-0 text-micro text-ink-500">{label}</span>}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={value}
        aria-label={label ? undefined : "进度"}
        className={cn(
          "relative w-full overflow-hidden rounded-full bg-surface-sunken",
          size === "sm" ? "h-1.5" : "h-2.5",
        )}
      >
        <div
          className={cn("h-full origin-left rounded-full transition-transform duration-[var(--dur-3)] ease-out", TONE[tone])}
          style={{ transform: `scaleX(${ratio})` }}
        />
      </div>
      <span className="tabular shrink-0 text-micro text-ink-500">{trailing ?? `${percent}%`}</span>
    </div>
  );
}
