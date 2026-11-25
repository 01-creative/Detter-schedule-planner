import { forwardRef } from "react";
import type { TextareaHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid = false, rows = 4, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        "w-full resize-y rounded-md border border-border-strong bg-surface-solid px-3 py-2 text-body text-ink-900",
        "placeholder:text-ink-300",
        "transition-[border-color,box-shadow] duration-[var(--dur-1)] ease-out",
        "focus:border-accent focus:ring-4 focus:ring-accent/15",
        invalid && "border-danger focus:border-danger focus:ring-danger/15",
        className,
      )}
      {...rest}
    />
  );
});
