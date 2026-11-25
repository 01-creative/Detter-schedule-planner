import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Undo2, X } from "lucide-react";

/**
 * 撤销条。
 *
 * 为什么不用 Toast：@detter/ui 的 toast 只有文案，没有动作按钮，
 * 而「删除」「转任务」「归档」都必须能一键撤回 —— 单人产品里误点一次就得去别处找回来，
 * 成本远高于多写这 40 行。
 */

export interface UndoOffer {
  id: number;
  message: string;
}

export interface UndoBarProps {
  offer: UndoOffer | null;
  onUndo: () => void;
  onDismiss: () => void;
}

export function UndoBar({ offer, onUndo, onDismiss }: UndoBarProps) {
  const reduceMotion = useReducedMotion();
  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {offer && (
        <motion.div
          key={offer.id}
          initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduceMotion ? 0 : 4 }}
          transition={{ duration: reduceMotion ? 0 : 0.16, ease: [0.22, 1, 0.36, 1] }}
          className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[55] flex justify-center px-4 md:bottom-6"
          role="status"
          aria-live="polite"
        >
          <div className="pointer-events-auto flex max-w-md items-center gap-3 rounded-lg border border-border bg-surface-solid px-3.5 py-2.5 shadow-3">
            <span className="min-w-0 truncate text-caption text-ink-700">{offer.message}</span>
            <button
              type="button"
              onClick={onUndo}
              className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-caption font-strong text-accent transition-colors duration-[var(--dur-1)] hover:bg-accent-soft"
            >
              <Undo2 className="size-3.5" aria-hidden="true" />
              撤销
            </button>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="忽略撤销提示"
              className="-mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-md text-ink-300 hover:bg-surface-sunken hover:text-ink-700"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
