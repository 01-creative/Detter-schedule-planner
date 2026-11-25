import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CircleCheck, CircleExclamationPoint, Info } from "lucide-react";
import { cn } from "../lib/cn";

export type ToastTone = "neutral" | "success" | "danger" | "info";

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** 毫秒；0 表示不自动消失 */
  duration?: number;
}

interface ToastRecord extends ToastOptions {
  id: number;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export interface ToastProviderProps {
  children: ReactNode;
}

/**
 * 轻提示。
 *
 * 为什么挂在右下（移动端底部 tab 上方）而不是顶部：这个产品的顶部工具条
 * 已经有同步徽标和搜索，提示再挤上去会互相遮挡。
 */
export function ToastProvider({ children }: ToastProviderProps) {
  const [items, setItems] = useState<ToastRecord[]>([]);
  const sequence = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setItems((list) => list.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = ++sequence.current;
      setItems((list) => [...list.slice(-2), { ...options, id }]);
      const duration = options.duration ?? 2600;
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((timer) => clearTimeout(timer));
      map.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {typeof document !== "undefined" &&
        createPortal(
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:pr-6"
          >
            <AnimatePresence initial={false}>
              {items.map((item) => (
                <ToastCard key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
              ))}
            </AnimatePresence>
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

function ToastCard({ item, onDismiss }: { item: ToastRecord; onDismiss: () => void }) {
  const reduceMotion = useReducedMotion();
  const icons: Record<ToastTone, ReactNode> = {
    neutral: <Info className="size-4 text-ink-500" aria-hidden="true" />,
    success: <CircleCheck className="size-4 text-success" aria-hidden="true" />,
    danger: <CircleExclamationPoint className="size-4 text-danger" aria-hidden="true" />,
    info: <Info className="size-4 text-info" aria-hidden="true" />,
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: reduceMotion ? 0 : 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: reduceMotion ? 0 : 4, scale: 0.99 }}
      transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-lg border px-3.5 py-2.5 shadow-3",
        item.tone === "danger"
          ? "border-danger/20 bg-danger-soft"
          : "border-border bg-surface-solid",
      )}
    >
      <span className="mt-0.5 shrink-0">{icons[item.tone ?? "neutral"]}</span>
      <div className="min-w-0 flex-1">
        <p className="text-caption font-strong text-ink-900">{item.title}</p>
        {item.description && <p className="mt-0.5 text-micro text-ink-500">{item.description}</p>}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="关闭提示"
        className="-mr-1 -mt-1 inline-flex size-6 shrink-0 items-center justify-center rounded-md text-ink-300 hover:bg-surface-sunken hover:text-ink-700"
      >
        <span aria-hidden="true" className="text-body leading-none">
          ×
        </span>
      </button>
    </motion.div>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast 必须在 <ToastProvider> 内使用");
  }
  return context;
}
