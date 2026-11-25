import { cloneElement, isValidElement, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactElement, ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "../lib/cn";

export interface PopoverProps {
  /** 触发器：必须是可聚焦元素（button / a），Popover 只负责补 aria 与点击 */
  trigger: ReactElement;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "start" | "end" | "center";
  side?: "bottom" | "top";
  className?: string;
  /** 菜单类弹层用 menu，说明性弹层用 dialog */
  role?: "menu" | "dialog";
  label?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * 轻量弹层。
 *
 * 用「相对定位 + absolute 面板」而不是 portal：这些弹层都挂在工具条/卡片内部，
 * 不需要逃逸 overflow 容器，省掉一整套定位计算，也避免滚动时错位。
 */
export function Popover({
  trigger,
  children,
  align = "end",
  side = "bottom",
  className,
  role = "menu",
  label,
  open: controlledOpen,
  onOpenChange,
}: PopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const wrapperRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // 只关自己，不再向上冒泡触发外层面板的 Esc
        event.stopPropagation();
        setOpen(false);
        (wrapperRef.current?.querySelector("[aria-expanded]") as HTMLElement | null)?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const triggerNode = isValidElement(trigger)
    ? cloneElement(trigger as ReactElement<Record<string, unknown>>, {
        "aria-expanded": open,
        "aria-haspopup": role === "menu" ? "menu" : "dialog",
        onClick: (event: ReactMouseEvent<HTMLElement>) => {
          const props = (trigger as ReactElement<{ onClick?: (e: ReactMouseEvent<HTMLElement>) => void }>)
            .props;
          props.onClick?.(event);
          if (!event.defaultPrevented) setOpen(!open);
        },
      })
    : trigger;

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      {triggerNode}
      <AnimatePresence>
        {open && (
          <motion.div
            ref={panelRef}
            role={role}
            aria-label={label}
            initial={{ opacity: 0, y: reduceMotion ? 0 : side === "bottom" ? -4 : 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: reduceMotion ? 0 : -2, scale: 0.99 }}
            transition={{ duration: reduceMotion ? 0 : 0.16, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "absolute z-40 min-w-44 rounded-lg border border-border bg-surface-solid p-1.5 shadow-3",
              side === "bottom" ? "top-[calc(100%+8px)]" : "bottom-[calc(100%+8px)]",
              align === "end" && "right-0",
              align === "start" && "left-0",
              align === "center" && "left-1/2 -translate-x-1/2",
              className,
            )}
          >
            {typeof children === "function" ? children(() => setOpen(false)) : children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
