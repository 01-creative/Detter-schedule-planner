import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent, KeyboardEvent, ReactNode } from "react";
import { parseQuickCapture, type Quadrant } from "@detter/shared";
import { cn, useToast } from "@detter/ui";
import { useActiveGoals } from "@/db/hooks";
import { BatchPreview } from "./BatchPreview";
import { CaptureInput } from "./CaptureInput";
import { DraftChips } from "./DraftChips";
import { clearDraft, readDraft, writeDraft } from "./draft-store";
import {
  applyTweaks,
  insertToken,
  QUICK_TOKENS,
  splitCaptureLines,
  type CaptureTweaks,
  type TweakTarget,
} from "./overrides";
import { captureEnd, captureStart } from "./perf";
import { saveCapture, saveCaptureBatch } from "./save-capture";
import { useDeferredDraft } from "./use-deferred-draft";

/**
 * 捕获台本体：输入、预览、微调、批量粘贴、保存。
 *
 * 三种提交方式（任务书 §3.1）：
 *   Enter            保存并保持打开 —— 「连续记录 20 条」时手不用离开键盘
 *   ⌘/Ctrl + Enter   保存并关闭
 *   ⌘/Ctrl+Shift+Enter 保存为 Q1（同时建任务，直接进四象限）
 *
 * 高度策略：输入区至少 2 行、预览区固定预留、底栏固定高度。
 * 打开面板的高度因此是稳定的常量；只有用户主动展开微调或批量预览时才会长高。
 */

export type CaptureCommit = "save" | "saveAndClose" | "saveQ1";

/** 在候选列表里前后移动（↑/↓ 用），越界回绕。 */
function cycle<T>(options: readonly T[], current: T, direction: 1 | -1, fallbackIndex = 0): T {
  const index = options.findIndex((option) => option === current);
  const base = index >= 0 ? index : fallbackIndex;
  return options[(base + direction + options.length) % options.length]!;
}

const QUADRANT_OPTIONS: Quadrant[] = [1, 2, 3, 4];
const DURATION_OPTIONS: Array<number | null> = [null, 15, 25, 40, 60, 90];

export interface CaptureComposerProps {
  variant: "desktop" | "mobile";
  /** store 里带过来的预填文本；为空则恢复本地草稿 */
  seed: string;
  savedCount: number;
  onSaved: (count: number, commit: CaptureCommit) => void;
  onRequestClose: () => void;
}

export function CaptureComposer({
  variant,
  seed,
  savedCount,
  onSaved,
  onRequestClose,
}: CaptureComposerProps) {
  const goals = useActiveGoals();
  const { toast } = useToast();

  const [value, setValue] = useState<string>(() => seed || readDraft());
  const [tweaks, setTweaks] = useState<CaptureTweaks>({});
  const [activeTweak, setActiveTweak] = useState<TweakTarget | null>(null);
  const [batch, setBatch] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [escArmed, setEscArmed] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const busyRef = useRef(false);
  const valueRef = useRef(value);
  const lastWriteRef = useRef(0);

  const draft = useDeferredDraft(value, goals);

  /**
   * ↑/↓ 在候选之间移动。只对「有候选集合」的三类生效：
   * 象限（Q1–Q4）、时长（无 / 15 / 25 / 40 / 60 / 90）、目标（不挂 + 每个进行中的目标）。
   * Tab 不在这里处理 —— 它表示「接受当前选择」，即收起微调条。
   */
  const cycleSuggestion = useCallback(
    (target: TweakTarget, direction: 1 | -1) => {
      if (target === "quadrant") {
        const current = tweaks.quadrant ?? draft?.quadrantGuess ?? 2;
        const next = cycle(QUADRANT_OPTIONS, current, direction, 1);
        setTweaks((prev) => ({ ...prev, quadrant: next }));
        return;
      }
      if (target === "duration") {
        const current =
          tweaks.durationMin !== undefined ? tweaks.durationMin : (draft?.durationMin ?? null);
        const next = cycle(DURATION_OPTIONS, current, direction);
        setTweaks((prev) => ({ ...prev, durationMin: next }));
        return;
      }
      if (target === "goal") {
        const options: Array<{ id: string | null; title: string | null }> = [
          { id: null, title: null },
          ...goals.map((goal) => ({ id: goal.id, title: goal.title })),
        ];
        const currentId = tweaks.goalId !== undefined ? tweaks.goalId : (draft?.goalId ?? null);
        const index = options.findIndex((option) => option.id === currentId);
        const base = index >= 0 ? index : 0;
        const next = options[(base + direction + options.length) % options.length]!;
        setTweaks((prev) => ({ ...prev, goalId: next.id, goalTitle: next.title }));
      }
    },
    [tweaks, draft, goals],
  );

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  /* 打开即可打字：先同步聚焦，40ms 后再补一次兜住 iOS 的键盘/动画抢焦点。 */
  useEffect(() => {
    inputRef.current?.focus();
    const timer = window.setTimeout(() => inputRef.current?.focus(), 40);
    return () => window.clearTimeout(timer);
  }, []);

  /* 草稿落盘：最多每 500ms 一次（节流），崩溃重开后由 readDraft 恢复。 */
  useEffect(() => {
    if (!value.trim()) {
      clearDraft();
      return;
    }
    const wait = Math.max(0, 500 - (Date.now() - lastWriteRef.current));
    const timer = window.setTimeout(() => {
      writeDraft(value);
      lastWriteRef.current = Date.now();
    }, wait);
    return () => window.clearTimeout(timer);
  }, [value]);

  /* 关掉面板（点背板、Esc、路由跳走）时把最后一刻的内容也留下。 */
  useEffect(() => {
    return () => {
      const text = valueRef.current;
      if (text.trim()) writeDraft(text);
    };
  }, []);

  /* 「有内容时二次 Esc」：第一次只提示，2.5s 后解除，避免一直拦着。 */
  useEffect(() => {
    if (!escArmed) return;
    const timer = window.setTimeout(() => setEscArmed(false), 2500);
    return () => window.clearTimeout(timer);
  }, [escArmed]);

  const submit = useCallback(
    async (commit: CaptureCommit, startedAt?: number) => {
      const raw = value.trim();
      if (!raw || busyRef.current) return;

      const t0 = startedAt ?? captureStart();
      busyRef.current = true;
      setBusy(true);

      try {
        // 保存用「当前文本重新解析」，而不是界面上那份可能还在防抖里的 draft：
        // 用户按下回车的那一刻，落库的内容必须和输入框里看到的一模一样。
        const parsed = applyTweaks(
          parseQuickCapture(raw, {
            goals: goals.map((goal) => ({ id: goal.id, title: goal.title })),
          }),
          tweaks,
        );

        await saveCapture({
          rawText: raw,
          parsed,
          source: variant === "mobile" ? "mobile" : "hotkey",
          commitQuadrant: commit === "saveQ1" ? 1 : null,
        });

        captureEnd(t0, commit);
        clearDraft();
        setValue("");
        setTweaks({});
        setActiveTweak(null);
        setEscArmed(false);
        onSaved(1, commit);
      } catch (error) {
        // 失败时绝不丢文本：输入框原样保留，只提示。
        const description = error instanceof Error ? error.message : "写入本地库失败";
        toast({
          title: "这条没写进去，内容还在",
          description: `${description} · 再按一次回车重试`,
          tone: "danger",
          duration: 5000,
        });
      } finally {
        busyRef.current = false;
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [value, goals, tweaks, variant, onSaved, toast],
  );

  const confirmBatch = useCallback(async () => {
    if (!batch || busyRef.current) return;
    const t0 = captureStart();
    busyRef.current = true;
    setBusy(true);

    try {
      const drafts = batch.map((line) => ({
        rawText: line,
        parsed: parseQuickCapture(line, {
          goals: goals.map((goal) => ({ id: goal.id, title: goal.title })),
        }),
      }));
      const result = await saveCaptureBatch(drafts, variant === "mobile" ? "mobile" : "manual");
      captureEnd(t0, "batch");

      if (result.saved > 0) {
        clearDraft();
        setValue("");
        onSaved(result.saved, "save");
      }
      if (result.failedAt !== null) {
        toast({
          title: `写到第 ${result.failedAt + 1} 条时出错了`,
          description: `前 ${result.saved} 条已保存，剩下的请再粘一次`,
          tone: "danger",
          duration: 5000,
        });
      }
      setBatch(null);
    } finally {
      busyRef.current = false;
      setBusy(false);
      inputRef.current?.focus();
    }
  }, [batch, goals, variant, onSaved, toast]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      // 中文输入法组词时，回车是「选词」不是「提交」
      if (event.nativeEvent.isComposing) return;

      // 微调条展开时：↑/↓ 换候选，Tab 接受（收起）
      if (
        activeTweak &&
        (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Tab")
      ) {
        event.preventDefault();
        if (event.key === "Tab") {
          setActiveTweak(null);
          return;
        }
        cycleSuggestion(activeTweak, event.key === "ArrowDown" ? 1 : -1);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!value.trim()) {
          onRequestClose();
          return;
        }
        if (!escArmed) {
          setEscArmed(true);
          return;
        }
        onRequestClose();
        return;
      }

      if (event.key !== "Enter") return;

      if (event.metaKey || event.ctrlKey) {
        event.preventDefault();
        void submit(event.shiftKey ? "saveQ1" : "saveAndClose", captureStart());
        return;
      }

      // Shift+Enter 换行：手工分条 / 写多行备注时用得上
      if (event.shiftKey) return;

      event.preventDefault();
      void submit("save", captureStart());
    },
    [value, escArmed, onRequestClose, submit, activeTweak, cycleSuggestion],
  );

  const onPaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    const text = event.clipboardData.getData("text/plain");
    const lines = splitCaptureLines(text);
    if (lines.length <= 1) return;
    // 多行粘贴不直接写进输入框：先拆成 N 条给用户确认，避免把整个清单存成一条
    event.preventDefault();
    setBatch(lines);
  }, []);

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setValue(event.target.value);
    if (escArmed) setEscArmed(false);
  };

  const quickInsert = (token: string) => {
    setValue((prev) => insertToken(prev, token));
    inputRef.current?.focus();
  };

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col bg-surface-solid",
        // 焦点反馈：一圈 1px 的极淡冷色描边（不抢戏，但键盘用户看得见焦点在哪）
        "focus-within:outline-1 focus-within:-outline-offset-1 focus-within:outline-accent/25",
        variant === "desktop" ? "rounded-[var(--r-xl)]" : "rounded-t-[var(--r-2xl)]",
      )}
    >
      {variant === "mobile" && (
        <div className="no-scrollbar flex shrink-0 gap-1.5 overflow-x-auto px-4 pt-3">
          {QUICK_TOKENS.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => quickInsert(item.token)}
              className="h-8 shrink-0 rounded-full border border-border bg-surface-solid px-3 text-caption text-ink-700 transition-colors duration-[var(--dur-1)] active:bg-surface-sunken"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      {/* 输入区：无边框，只留一层从顶部淡出的底色，和面板融为一体 */}
      <div className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-[104px] bg-gradient-to-b from-surface-sunken via-surface-sunken/45 to-transparent"
        />
        <div className="relative">
          <CaptureInput
            value={value}
            variant={variant}
            inputRef={inputRef}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />
        </div>
      </div>

      {/* 预览区：固定预留高度，chips 出现时是淡入而不是把面板顶开 */}
      <div
        className={cn(
          "min-h-[56px] px-5 pt-1 pb-2",
          variant === "mobile" && "px-4",
          batch && "min-h-0",
        )}
      >
        {batch ? (
          <BatchPreview
            lines={batch}
            goals={goals}
            busy={busy}
            onConfirm={() => void confirmBatch()}
            onCancel={() => setBatch(null)}
          />
        ) : draft ? (
          <DraftChips
            draft={draft}
            tweaks={tweaks}
            onTweaksChange={setTweaks}
            goals={goals}
            variant={variant}
            active={activeTweak}
            onActiveChange={setActiveTweak}
          />
        ) : (
          <p className="text-micro text-ink-300">
            一句话就够：时间、#标签、@目标、在哪儿，剩下的交给解析器。
          </p>
        )}
      </div>

      {variant === "mobile" ? (
        <div className="border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={() => void submit("saveAndClose", captureStart())}
            disabled={busy || !value.trim()}
            className="h-12 w-full rounded-lg gradient-accent text-body font-strong text-on-accent shadow-accent transition-transform duration-[var(--dur-1)] active:scale-[.99] disabled:opacity-50"
          >
            完成
          </button>
        </div>
      ) : (
        <div className="flex h-11 items-center gap-3 border-t border-border bg-surface-sunken/30 px-4 text-micro text-ink-500">
          {escArmed ? (
            <span className="text-warning-ink">再按一次 Esc 关闭 · 内容已存草稿</span>
          ) : (
            <>
              <span className="inline-flex items-center gap-1">
                <Kbd>Enter</Kbd>
                记录
              </span>
              <span className="hidden items-center gap-1 sm:inline-flex">
                <Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd>
                关闭
              </span>
              <span className="hidden items-center gap-1 lg:inline-flex">
                <Kbd>Ctrl</Kbd>+<Kbd>Shift</Kbd>+<Kbd>Enter</Kbd>
                加入 Q1
              </span>
              {savedCount > 0 && (
                <span className="ml-auto text-success-ink">已记录 {savedCount} 条</span>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-surface-solid px-1 py-0.5 text-[10px] leading-none text-ink-500">
      {children}
    </kbd>
  );
}
