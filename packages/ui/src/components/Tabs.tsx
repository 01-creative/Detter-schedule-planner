import { useId, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "../lib/cn";

export interface TabItem {
  value: string;
  label: string;
  icon?: ReactNode;
  /** 右侧计数（收件箱 3 条这种） */
  count?: number;
}

export interface TabsProps {
  items: readonly TabItem[];
  value: string;
  onValueChange: (value: string) => void;
  variant?: "underline" | "pill";
  ariaLabel: string;
  className?: string;
}

/**
 * 受控 Tabs。下划线用 layoutId 做 180ms 滑移，切换时只有一个元素在动。
 * 键盘：左右方向键在 tab 之间移动（WAI-ARIA tabs 的标准行为）。
 */
export function Tabs({
  items,
  value,
  onValueChange,
  variant = "underline",
  ariaLabel,
  className,
}: TabsProps) {
  const layoutId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const index = items.findIndex((item) => item.value === value);
    if (index < 0) return;
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const next = items[(index + delta + items.length) % items.length];
    if (!next) return;
    onValueChange(next.value);
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[items.indexOf(next)]?.focus();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn(
        "flex items-center gap-1",
        variant === "underline" ? "border-b border-border" : "rounded-full bg-surface-sunken p-1",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onValueChange(item.value)}
            className={cn(
              "relative inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-caption transition-colors duration-[var(--dur-1)]",
              // 命中区 44px 高（视觉仍是 32）：伪元素向下/向上各借 6px。
              // 左右只借 2px —— 相邻 tab 之间只有 4px 间隙，借满会互相盖住，
              // 点空隙时到底算谁的就很随机了（WCAG 2.5.8 的间距豁免正是这么算的）。
              "after:absolute after:-inset-y-1.5 after:-inset-x-0.5 after:content-['']",
              variant === "underline" && "-mb-px",
              variant === "pill" && "rounded-full",
              active ? "text-ink-900" : "text-ink-500 hover:text-ink-700",
            )}
          >
            {item.icon}
            {item.label}
            {typeof item.count === "number" && (
              <span
                className={cn(
                  "tabular rounded-full px-1.5 text-micro",
                  active ? "bg-accent-soft text-accent" : "bg-surface-sunken text-ink-500",
                )}
              >
                {item.count}
              </span>
            )}
            {variant === "underline" && active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-accent"
                transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
              />
            )}
            {variant === "pill" && active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 -z-10 rounded-full bg-surface-solid shadow-1"
                transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
