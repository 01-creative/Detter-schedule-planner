import { forwardRef } from "react";
import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export type SurfaceVariant = "solid" | "glass" | "sunken" | "plain";
export type SurfaceElevation = 0 | 1 | 2 | 3;

const VARIANT: Record<SurfaceVariant, string> = {
  solid: "bg-surface-solid",
  glass: "glass",
  sunken: "bg-surface-sunken",
  plain: "bg-transparent",
};

const ELEVATION: Record<SurfaceElevation, string> = {
  0: "",
  1: "shadow-1",
  2: "shadow-2",
  3: "shadow-3",
};

export interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  variant?: SurfaceVariant;
  elevation?: SurfaceElevation;
  bordered?: boolean;
  radius?: "sm" | "md" | "lg" | "xl" | "2xl";
}

/** 面：卡片/弹层/内嵌区的共同底。把「用什么底色 + 多大阴影」收敛到一处。 */
export const Surface = forwardRef<HTMLDivElement, SurfaceProps>(function Surface(
  {
    className,
    variant = "solid",
    elevation = 1,
    bordered = true,
    radius = "lg",
    children,
    ...rest
  },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        VARIANT[variant],
        ELEVATION[elevation],
        bordered && "border border-border",
        radius === "sm" && "rounded-sm",
        radius === "md" && "rounded-md",
        radius === "lg" && "rounded-lg",
        radius === "xl" && "rounded-xl",
        radius === "2xl" && "rounded-2xl",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
});
