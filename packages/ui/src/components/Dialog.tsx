import { useCallback, useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "../lib/cn";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
  /** 背板点击 / Esc 是否关闭。破坏性确认框通常设为 false，逼用户明确选择 */
  dismissible?: boolean;
  showClose?: boolean;
}

const SIZE: Record<NonNullable<DialogProps["size"]>, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
};

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 对话框。
 *
 * 为什么不用 Radix：这里只需要「背板 + 焦点陷阱 + Esc 关闭」三件事，
 * 自己写能保证焦点环、动画时长、圆角都严格走我们的令牌，也少一个运行时依赖。
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
  className,
  dismissible = true,
  showClose = true,
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;

    // 优先把焦点交给第一个可交互元素；没有才落到面板本身
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dismissible) {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (node) => node.offsetParent !== null || node === document.activeElement,
      );
      if (nodes.length === 0) {
        event.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }
      const firstNode = nodes[0]!;
      const lastNode = nodes[nodes.length - 1]!;
      if (!event.shiftKey && document.activeElement === lastNode) {
        event.preventDefault();
        firstNode.focus();
      } else if (event.shiftKey && document.activeElement === firstNode) {
        event.preventDefault();
        lastNode.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    // 锁滚动：弹层打开时背景不应跟着滚，否则移动端很容易误触
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [open, dismissible, close]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            key="scrim"
            className="absolute inset-0"
            style={{ backgroundColor: "var(--scrim)", backdropFilter: "blur(2px)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.18 }}
            onClick={dismissible ? close : undefined}
            aria-hidden="true"
          />
          <motion.div
            key="panel"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
            tabIndex={-1}
            initial={{ opacity: 0, y: reduceMotion ? 0 : 6, scale: reduceMotion ? 1 : 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: reduceMotion ? 0 : 4, scale: reduceMotion ? 1 : 0.99 }}
            transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "relative w-full overflow-hidden rounded-xl border border-border bg-surface-solid shadow-3",
              SIZE[size],
              className,
            )}
          >
            <div className="flex items-start gap-3 px-5 pt-5 pb-3">
              <div className="min-w-0 flex-1">
                <h2 id={titleId} className="text-h2 text-ink-900">
                  {title}
                </h2>
                {description && (
                  <p id={descriptionId} className="mt-1 text-caption text-ink-500">
                    {description}
                  </p>
                )}
              </div>
              {showClose && (
                <button
                  type="button"
                  onClick={close}
                  aria-label="关闭对话框"
                  className="-mt-1 -mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ink-500 transition-colors duration-[var(--dur-1)] hover:bg-surface-sunken hover:text-ink-900"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              )}
            </div>
            <div className="px-5 pb-4 text-body text-ink-700">{children}</div>
            {footer && (
              <div className="flex items-center justify-end gap-2 border-t border-border bg-surface-sunken/40 px-5 py-3">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
