import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** compact 用于象限格内部，避免把格子撑开 */
  size?: "default" | "compact";
}

/** 空态。插画用两个渐变圆斑（纯 CSS，不引入图片）。 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  size = "default",
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        size === "default" ? "gap-3 px-6 py-12" : "gap-2 px-4 py-6",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          "relative flex items-center justify-center",
          size === "default" ? "size-16" : "size-11",
        )}
      >
        <span className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_30%,var(--accent-soft),transparent_70%)]" />
        <span className="absolute inset-2 rounded-full bg-[radial-gradient(circle_at_70%_70%,var(--q2-from),transparent_70%)] opacity-80" />
        <span className={cn("relative text-ink-500", size === "default" ? "size-6" : "size-5")}>
          {icon}
        </span>
      </div>
      <p className={cn("font-strong text-ink-900", size === "default" ? "text-body" : "text-caption")}>
        {title}
      </p>
      {description && (
        <p className={cn("max-w-xs text-ink-500", size === "default" ? "text-caption" : "text-micro")}>
          {description}
        </p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
