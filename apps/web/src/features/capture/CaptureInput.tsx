import { useLayoutEffect } from "react";
import type {
  ChangeEvent,
  ClipboardEvent,
  KeyboardEvent,
  RefObject,
} from "react";
import { cn } from "@detter/ui";

/**
 * 捕获输入框。
 *
 * 视觉上刻意「没有输入框」：无边框、无描边、无背景块，只有一层从顶部极淡的
 * 渐变把注意力引到文字上。上一版在输入框上画了 focus 描边，2px 的直角矩形
 * 正好压在面板圆角上，把 20px 的圆角切成直角 —— 这一版把描边去掉，
 * 焦点态交给整个面板的 `focus-within` 柔光（见 CaptureComposer）。
 *
 * 高度按内容自动长到 5 行：打开时至少预留 2 行（min-h-[80px]），
 * 所以「面板一打开就踩着内容的高度往上跳」这个毛病不会再出现。
 */

const LINE_HEIGHT = 24;
const PADDING_Y = 32; // py-4 上下各 16
export const MIN_INPUT_HEIGHT = LINE_HEIGHT * 2 + PADDING_Y; // 80
export const MAX_INPUT_HEIGHT = LINE_HEIGHT * 5 + PADDING_Y; // 152

export interface CaptureInputProps {
  value: string;
  variant: "desktop" | "mobile";
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
}

export function CaptureInput({
  value,
  variant,
  inputRef,
  onChange,
  onKeyDown,
  onPaste,
}: CaptureInputProps) {
  useLayoutEffect(() => {
    const node = inputRef.current;
    if (!node) return;
    // scrollHeight 为 0 说明在 jsdom / 未布局环境里，别把高度压成 0
    node.style.height = "auto";
    const next = node.scrollHeight;
    if (!next) return;
    node.style.height = `${Math.min(next, MAX_INPUT_HEIGHT)}px`;
    node.style.overflowY = next > MAX_INPUT_HEIGHT ? "auto" : "hidden";
  }, [value, inputRef]);

  return (
    <textarea
      ref={inputRef}
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      rows={1}
      aria-label="记录内容"
      aria-multiline="true"
      placeholder="明天下午3点 交高数作业 #作业 在教三"
      autoComplete="off"
      spellCheck={false}
      className={cn(
        "block w-full resize-none appearance-none border-0 bg-transparent caret-accent",
        "px-5 py-4 text-[16px] leading-6 text-ink-900 placeholder:text-ink-300",
        // 无描边：焦点反馈由面板的 focus-within 柔光环承担
        "focus:outline-none focus-visible:outline-none",
        variant === "mobile" && "px-4 text-[16px]",
      )}
      style={{ minHeight: MIN_INPUT_HEIGHT }}
    />
  );
}
