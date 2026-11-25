import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-sunken text-ink-500",
  accent: "bg-accent-soft text-accent",
  success: "bg-success-soft text-success-ink",
  warning: "bg-warning-soft text-warning-ink",
  danger: "bg-danger-soft text-danger-ink",
  info: "bg-info-soft text-info-ink",
};

const DOT_TONES: Record<BadgeTone, string> = {
  neutral: "bg-ink-300",
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  dot?: boolean;
  icon?: ReactNode;
}

export function Badge({ className, tone = "neutral", dot = false, icon, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-micro whitespace-nowrap",
        TONES[tone],
        className,
      )}
      {...rest}
    >
      {dot && <span aria-hidden="true" className={cn("size-1.5 rounded-full", DOT_TONES[tone])} />}
      {icon}
      {children}
    </span>
  );
}
