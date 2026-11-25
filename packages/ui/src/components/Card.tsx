import { forwardRef } from "react";
import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** 可点击/可拖拽的卡片才需要 hover 抬升，静态卡片不要滥用投影 */
  interactive?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
}

/** 卡片：白底 + 一级阴影 + 发丝描边。hover 才升到二级阴影并上移 1px。 */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, interactive = false, padding = "md", children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "rounded-lg border border-border bg-surface-solid shadow-1",
        "transition-[transform,box-shadow,border-color] duration-[var(--dur-2)] ease-out",
        interactive && "hover:-translate-y-px hover:border-border-strong hover:shadow-2",
        padding === "sm" && "p-3",
        padding === "md" && "p-4",
        padding === "lg" && "p-5",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
});
