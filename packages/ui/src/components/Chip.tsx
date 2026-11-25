import type { HTMLAttributes, ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "../lib/cn";

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  icon?: ReactNode;
  /** 传入后右侧出现「移除」，必须同时给 removeLabel 说明移除的是什么 */
  onRemove?: () => void;
  removeLabel?: string;
  tone?: "neutral" | "accent" | "muted";
}

/** 语义小块：解析预览（明天 15:00 / #作业）、筛选条件、标签都用它。 */
export function Chip({
  className,
  icon,
  onRemove,
  removeLabel = "移除",
  tone = "neutral",
  children,
  ...rest
}: ChipProps) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border py-0.5 pr-1.5 pl-2 text-micro",
        tone === "neutral" && "border-border bg-surface-solid text-ink-700",
        tone === "accent" && "border-accent/20 bg-accent-soft text-accent",
        tone === "muted" && "border-transparent bg-surface-sunken text-ink-500",
        className,
      )}
      {...rest}
    >
      {icon}
      <span className="truncate">{children}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="-mr-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full text-ink-300 transition-colors duration-[var(--dur-1)] hover:bg-surface-sunken hover:text-ink-700"
        >
          <X className="size-3" aria-hidden="true" />
        </button>
      )}
    </span>
  );
}
