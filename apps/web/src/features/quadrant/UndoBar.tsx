import { motion, useReducedMotion } from "motion/react";
import { Trash2, Undo2, X } from "lucide-react";

/**
 * 删除后的 5 秒撤销条。
 *
 * 为什么不用普通 toast：删除是这里唯一会「让东西消失」的动作，
 * 光提示「已删除」没有用，用户需要的是**立刻能反悔**。
 * 所以它带一个真正可点的「撤销」，并在 5 秒后自动收走。
 */
export interface UndoState {
  title: string;
  expiresAt: number;
}

export interface UndoBarProps {
  undo: UndoState | null;
  onUndo: () => void;
  onDismiss: () => void;
}

export function UndoBar({ undo, onUndo, onDismiss }: UndoBarProps) {
  const reduceMotion = useReducedMotion();
  if (!undo) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(9.5rem+env(safe-area-inset-bottom))] z-[62] flex justify-center px-4 md:bottom-6"
    >
      <div className="pointer-events-auto relative flex w-full max-w-md items-center gap-2.5 overflow-hidden rounded-lg border border-border bg-surface-solid px-3 py-2 shadow-3">
        <Trash2 className="size-4 shrink-0 text-ink-300" aria-hidden="true" />
        <p className="min-w-0 flex-1 truncate text-caption text-ink-700">
          已删除「{undo.title}」
        </p>
        <button
          type="button"
          onClick={onUndo}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-caption font-strong text-accent transition-colors duration-[var(--dur-1)] hover:bg-accent-soft"
        >
          <Undo2 className="size-3.5" aria-hidden="true" />
          撤销
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="关闭撤销提示"
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-ink-300 hover:bg-surface-sunken hover:text-ink-700"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
        {/* 倒计时用 scaleX，不改宽度，不触发布局 */}
        <motion.span
          aria-hidden="true"
          key={undo.expiresAt}
          initial={{ scaleX: 1 }}
          animate={{ scaleX: 0 }}
          transition={{ duration: reduceMotion ? 0 : 5, ease: "linear" }}
          className="absolute bottom-0 left-0 h-0.5 w-full origin-left bg-accent/50"
        />
      </div>
    </div>
  );
}

export default UndoBar;
