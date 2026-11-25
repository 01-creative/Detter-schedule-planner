import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** 校验失败时只加 aria-invalid + 描边变色，错误文案由外层 Field 负责 */
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid = false, type = "text", ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      aria-invalid={invalid || undefined}
      className={cn(
        "h-9 w-full rounded-md border border-border-strong bg-surface-solid px-3 text-body text-ink-900",
        "placeholder:text-ink-300",
        "transition-[border-color,box-shadow] duration-[var(--dur-1)] ease-out",
        "hover:border-[color:var(--border-strong)] focus:border-accent focus:ring-4 focus:ring-accent/15",
        invalid && "border-danger focus:border-danger focus:ring-danger/15",
        "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-300",
        className,
      )}
      {...rest}
    />
  );
});
