import { useEffect, useMemo, useRef, useState } from "react";
import { parseQuickCapture, type Goal, type ParsedDraft } from "@detter/shared";

/**
 * 实时解析，但不在每个按键的同一帧里做。
 *
 * 任务书 §3.1：解析要放进 requestIdleCallback / 16ms 防抖里，避免打字时重排。
 * 这里优先用 requestIdleCallback（有超时兜底），不支持时退回 16ms 定时器。
 * 返回值在「新结果还没算出来」的间隙里保持上一次的结果，所以 chips 不会闪空。
 */
export function useDeferredDraft(raw: string, goals: Goal[]): ParsedDraft | null {
  const [draft, setDraft] = useState<ParsedDraft | null>(null);
  const goalsRef = useRef(goals);
  goalsRef.current = goals;

  /**
   * 依赖必须稳定：useActiveGoals 在数据还没回来时会返回一个新的 []，
   * 如果直接把它写进 deps，每次 render 都会触发一次解析 → setState → 再 render，
   * 在 IndexedDB 打开的那几十毫秒里会空转成死循环。用「目标内容」当 key。
   */
  const goalsKey = useMemo(
    () => goals.map((goal) => `${goal.id}\u0000${goal.title}`).join("\u0001"),
    [goals],
  );

  useEffect(() => {
    const text = raw.trim();
    if (!text) {
      setDraft(null);
      return;
    }

    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      setDraft(
        parseQuickCapture(text, {
          goals: goalsRef.current.map((goal) => ({ id: goal.id, title: goal.title })),
        }),
      );
    };

    const idle = window.requestIdleCallback as
      | ((callback: IdleRequestCallback, options?: IdleRequestOptions) => number)
      | undefined;
    const cancelIdle = window.cancelIdleCallback as ((handle: number) => void) | undefined;

    if (typeof idle === "function") {
      const handle = idle(run, { timeout: 60 });
      return () => {
        cancelled = true;
        cancelIdle?.(handle);
      };
    }

    const timer = window.setTimeout(run, 16);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [raw, goalsKey]);

  return draft;
}
