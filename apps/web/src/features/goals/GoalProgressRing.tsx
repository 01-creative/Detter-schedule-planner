import { cn } from "@detter/ui";

/**
 * 目标进度环。
 *
 * 用 SVG 的 stroke-dashoffset 画，而不是叠一个 conic-gradient：
 * 前者在 320px 的栏里边缘更干净，也不会因为圆角抗锯齿出现毛边。
 * 没有任务时显示空环 + 「—」，不要显示 0%（0% 会被误读成「没进展」）。
 */
export interface GoalProgressRingProps {
  done: number;
  total: number;
  color: string;
  size?: number;
  className?: string;
}

export function GoalProgressRing({
  done,
  total,
  color,
  size = 26,
  className,
}: GoalProgressRingProps) {
  const radius = 9;
  const circumference = 2 * Math.PI * radius;
  const ratio = total > 0 ? Math.min(1, done / total) : 0;
  const percent = total > 0 ? Math.round(ratio * 100) : 0;

  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
      title={total > 0 ? `${done}/${total} 完成` : "还没有任务"}
    >
      <svg viewBox="0 0 24 24" className="size-full -rotate-90" aria-hidden="true">
        <circle
          cx="12"
          cy="12"
          r={radius}
          fill="none"
          stroke="var(--border-strong)"
          strokeWidth="2.5"
        />
        {total > 0 && (
          <circle
            cx="12"
            cy="12"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - ratio)}
            className="transition-[stroke-dashoffset] duration-[var(--dur-3)] ease-out"
          />
        )}
      </svg>
      <span className="tabular absolute text-[8px] leading-none font-strong text-ink-500">
        {total > 0 ? `${percent}` : "—"}
      </span>
    </span>
  );
}

export default GoalProgressRing;
