import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface TooltipProps {
  label: string;
  children: ReactNode;
  side?: "top" | "bottom";
  className?: string;
}

/**
 * 纯视觉提示。触发器自己必须带 aria-label —— 提示气泡是锦上添花，
 * 不能成为读屏用户获取信息的唯一渠道。
 */
export function Tooltip({ label, children, side = "top", className }: TooltipProps) {
  return (
    <span className={cn("group/tip relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 rounded-md bg-ink-900 px-2 py-1 text-micro whitespace-nowrap text-[color:var(--bg)] opacity-0 shadow-2",
          "transition-opacity duration-[var(--dur-2)] ease-out group-hover/tip:opacity-100 group-focus-within/tip:opacity-100",
          side === "top" ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]",
        )}
      >
        {label}
      </span>
    </span>
  );
}
