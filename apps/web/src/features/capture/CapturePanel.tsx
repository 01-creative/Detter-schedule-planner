import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CalendarDays, CornerDownLeft, Hash, MapPin, Sparkles, Timer } from "lucide-react";
import { parseQuickCapture } from "@detter/shared";
import { Chip, useToast } from "@detter/ui";
import { captureInbox } from "@/db/repo";
import { useActiveGoals } from "@/db/hooks";
import { formatDurationMinutes, formatWhen } from "@/lib/format";
import { useCaptureStore } from "@/stores/capture";

/**
 * 快速记录面板（最小可用版）。
 *
 * 这个文件是 T05 的接管点：解析分诊、AI 整理、直接加入象限都在后续版本里加，
 * 但它们都只改 src/features/capture/**，不用碰 shell。
 *
 * 本版本负责：
 * - Ctrl/Cmd+K 全局呼出、自动聚焦、Esc 关闭；
 * - 边输入边用 shared 的 parseQuickCapture 解析并展示「标题 + 时间 + 标签」预览；
 * - 回车写入 inbox（离线也照样写本地）；写入后面板不关，支持连续捕获。
 */
export function CapturePanel() {
  const open = useCaptureStore((state) => state.open);
  const seed = useCaptureStore((state) => state.seed);
  const closeCapture = useCaptureStore((state) => state.closeCapture);
  const openCapture = useCaptureStore((state) => state.openCapture);
  const goals = useActiveGoals();
  const { toast } = useToast();
  const reduceMotion = useReducedMotion();

  const [value, setValue] = useState("");
  const [savedCount, setSavedCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const parse = useCallback(
    (raw: string) =>
      parseQuickCapture(raw, {
        goals: goals.map((goal) => ({ id: goal.id, title: goal.title })),
      }),
    [goals],
  );

  /* 全局快捷键：在输入框里按也不会冲突，因为捕获面板是最高优先级的入口。 */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (useCaptureStore.getState().open) {
          useCaptureStore.getState().closeCapture();
        } else {
          useCaptureStore.getState().openCapture();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /* 打开时重置并聚焦。setTimeout 是为了等入场动画的第一帧，否则 iOS 键盘会把动画顶掉。 */
  useEffect(() => {
    if (!open) return;
    setValue(seed);
    setSavedCount(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open, seed]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeCapture();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, closeCapture]);

  const draft = useMemo(() => (value.trim() ? parse(value) : null), [value, parse]);

  const submit = useCallback(async () => {
    const raw = value.trim();
    if (!raw) return;
    const parsed = parse(raw);
    // 先写本地再说：网络失败不该让这条记录消失
    await captureInbox({ rawText: raw, parsed, source: "hotkey" });
    setValue("");
    setSavedCount((count) => count + 1);
    toast({ title: "已收进盒子 ✓", description: parsed.title, tone: "success" });
    inputRef.current?.focus();
  }, [value, parse, toast]);

  if (typeof document === "undefined") return null;

  const previewChips = draft
    ? [
        draft.startAt
          ? {
              key: "time",
              node: (
                <Chip key="time" icon={<CalendarDays className="size-3" aria-hidden="true" />}>
                  {formatWhen({ startAt: draft.startAt, endAt: draft.endAt, allDay: draft.allDay })}
                </Chip>
              ),
            }
          : null,
        draft.durationMin
          ? {
              key: "duration",
              node: (
                <Chip key="duration" icon={<Timer className="size-3" aria-hidden="true" />}>
                  预计 {formatDurationMinutes(draft.durationMin)}
                </Chip>
              ),
            }
          : null,
        draft.rrule
          ? {
              key: "rrule",
              node: <Chip key="rrule">重复</Chip>,
            }
          : null,
        draft.location
          ? {
              key: "location",
              node: (
                <Chip key="location" icon={<MapPin className="size-3" aria-hidden="true" />}>
                  在{draft.location}
                </Chip>
              ),
            }
          : null,
        ...draft.tags.map((tag) => ({
          key: `tag-${tag}`,
          node: (
            <Chip key={`tag-${tag}`} tone="accent" icon={<Hash className="size-3" aria-hidden="true" />}>
              #{tag}
            </Chip>
          ),
        })),
        draft.goalTitle
          ? { key: "goal", node: <Chip key="goal">@{draft.goalTitle}</Chip> }
          : null,
        draft.quadrantGuess
          ? {
              key: "quadrant",
              node: <Chip key="quadrant" tone="muted">{`建议 Q${draft.quadrantGuess}`}</Chip>,
            }
          : null,
      ].filter((item): item is { key: string; node: ReactElement } => item !== null)
    : [];

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[16vh] sm:pt-[18vh]">
          <motion.div
            className="absolute inset-0"
            style={{ backgroundColor: "var(--scrim)", backdropFilter: "blur(3px)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.16 }}
            onClick={closeCapture}
            aria-hidden="true"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="快速记录"
            initial={{ opacity: 0, y: reduceMotion ? 0 : -8, scale: reduceMotion ? 1 : 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: reduceMotion ? 0 : -4, scale: reduceMotion ? 1 : 0.99 }}
            transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="relative w-full max-w-[640px] overflow-hidden rounded-xl border border-border bg-surface-solid shadow-3"
          >
            <div className="flex items-center gap-2.5 px-4">
              <Sparkles className="size-4 shrink-0 text-accent" aria-hidden="true" />
              <input
                ref={inputRef}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => {
                  // 中文输入法正在组词时回车是「选词」，不能提交
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void submit();
                  }
                }}
                placeholder="明天下午3点 交高数作业 #作业 在教三"
                aria-label="记录内容"
                autoComplete="off"
                /* 内嵌描边而不是外描边：输入框贴着面板上沿，外描边会被圆角裁掉一截 */
                className="h-14 flex-1 bg-transparent text-body text-ink-900 placeholder:text-ink-300 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent/50"
              />
              {savedCount > 0 && (
                <motion.span
                  key={savedCount}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="shrink-0 text-micro text-success-ink"
                >
                  已记录 {savedCount} 条
                </motion.span>
              )}
            </div>

            <div className="border-t border-border px-4 py-3">
              {draft ? (
                <div className="space-y-2">
                  <div className="flex items-baseline gap-2">
                    <span className="shrink-0 text-micro text-ink-300">标题</span>
                    <p className="truncate text-body font-strong text-ink-900">
                      {draft.title || value}
                    </p>
                  </div>
                  {previewChips.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="mr-0.5 text-micro text-ink-300">解析</span>
                      {previewChips.map((item) => item.node)}
                    </div>
                  ) : (
                    <p className="text-micro text-ink-300">
                      还没有识别到时间或标签。试试：明天下午3点 交作业 #学习 在图书馆
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-micro text-ink-300">
                  一句话就够：时间、#标签、@目标、在哪儿，剩下的交给解析器。
                </p>
              )}
            </div>

            <div className="flex items-center gap-4 border-t border-border bg-surface-sunken/40 px-4 py-2 text-micro text-ink-500">
              <span className="inline-flex items-center gap-1">
                <kbd className="rounded border border-border bg-surface-solid px-1 py-0.5">
                  <CornerDownLeft className="inline size-2.5" aria-hidden="true" /> Enter
                </kbd>
                记录
              </span>
              <span>
                <kbd className="rounded border border-border bg-surface-solid px-1 py-0.5">Esc</kbd>{" "}
                关闭
              </span>
              <span className="ml-auto hidden sm:inline">写进收件箱，不打断当下的事</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export default CapturePanel;
