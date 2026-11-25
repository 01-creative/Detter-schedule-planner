import { useCallback, useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "../lib/cn";

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  side?: "bottom" | "right";
  className?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 抽屉：移动端「更多」与平板上的目标栏都走它。
 * 只动 transform/opacity，因此滑动过程不会触发重排。
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  side = "bottom",
  className,
}: SheetProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (nodes.length === 0) return;
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
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [open, close]);

  if (typeof document === "undefined") return null;

  const hidden = side === "bottom" ? { y: reduceMotion ? 0 : 24 } : { x: reduceMotion ? 0 : 24 };

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className={cn(
            "fixed inset-0 z-50 flex",
            side === "bottom" ? "items-end justify-center" : "items-stretch justify-end",
          )}
        >
          <motion.div
            className="absolute inset-0"
            style={{ backgroundColor: "var(--scrim)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.18 }}
            onClick={close}
            aria-hidden="true"
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={{ opacity: 0, ...hidden }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, ...hidden }}
            transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "relative flex flex-col border border-border bg-surface-solid shadow-3",
              side === "bottom"
                ? "max-h-[86dvh] w-full rounded-t-2xl pb-[env(safe-area-inset-bottom)]"
                : "h-full w-[min(360px,88vw)] rounded-l-xl",
              className,
            )}
          >
            <div className="flex items-start gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0 flex-1">
                <h2 id={titleId} className="text-h2 text-ink-900">
                  {title}
                </h2>
                {description && <p className="mt-1 text-caption text-ink-500">{description}</p>}
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="关闭面板"
                className="-mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ink-500 hover:bg-surface-sunken hover:text-ink-900"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="border-t border-border px-5 py-3">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
