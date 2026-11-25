import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "../lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "gradient-accent text-on-accent shadow-accent hover:brightness-[1.05]",
  secondary:
    "border border-border-strong bg-surface-solid text-ink-900 hover:bg-surface-sunken/60",
  ghost: "text-ink-700 hover:bg-surface-sunken hover:text-ink-900",
  danger: "border border-danger/20 bg-danger-soft text-danger-ink hover:border-danger/40",
};

const SIZES: Record<ButtonSize, string> = {
  // 28 / 36 / 44（设计规范 §6.1）
  sm: "h-7 gap-1.5 rounded-md px-2.5 text-caption after:absolute after:-inset-2 after:content-['']",
  md: "h-9 gap-2 rounded-md px-3.5 text-body",
  lg: "h-11 gap-2 rounded-lg px-5 text-body",
  icon: "size-9 rounded-md after:absolute after:-inset-1 after:content-['']",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 异步动作中：禁用交互但保留宽度，避免按钮跳动 */
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

/**
 * 基础按钮。所有变体都由令牌驱动，不出现硬编码颜色。
 * 图标按钮请自行传 aria-label —— 组件不做兜底，因为空标签本身就是缺陷。
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = "secondary",
    size = "md",
    loading = false,
    leftIcon,
    rightIcon,
    disabled,
    children,
    type = "button",
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center font-strong whitespace-nowrap",
        "transition-[transform,background-color,color,border-color,box-shadow,filter] duration-[var(--dur-1)] ease-out",
        "active:scale-[.97] disabled:pointer-events-none disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <LoaderCircle className="size-3.5 animate-driven-spin" aria-hidden="true" />
      ) : (
        leftIcon
      )}
      {children}
      {rightIcon}
    </button>
  );
});
