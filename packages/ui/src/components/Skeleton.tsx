import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** text = 一行文字的高度；block = 任意块 */
  variant?: "text" | "block" | "circle";
}

/** 骨架屏：只动 opacity，越低对比越"安静"（设计规范 §4 只动 transform/opacity）。 */
export function Skeleton({ className, variant = "text", ...rest }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse-soft bg-surface-sunken",
        variant === "text" && "h-3 rounded-full",
        variant === "block" && "rounded-lg",
        variant === "circle" && "size-9 rounded-full",
        className,
      )}
      {...rest}
    />
  );
}
