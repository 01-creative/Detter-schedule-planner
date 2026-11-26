import { useEffect, useRef, useState } from "react";
import { CornerDownLeft } from "lucide-react";

/**
 * 格内联新建：双击空白 / 点格头「+」时原地出现一个输入框。
 *
 * 不做弹窗，是因为「想到一件事」到「写下来」之间的每一步都在流失注意力；
 * 一个贴着手指的输入框比一个居中对话框快得多。Enter 保存，Esc 取消。
 */
export interface InlineComposerProps {
  label: string;
  placeholder?: string;
  onSubmit: (title: string) => void;
  onCancel: () => void;
}

export function InlineComposer({
  label,
  placeholder = "写下要做的事",
  onSubmit,
  onCancel,
}: InlineComposerProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // 等一格渲染完再聚焦，否则 iOS 键盘会把入场动画顶掉
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(timer);
  }, []);

  const submit = () => {
    const title = value.trim();
    if (!title) return;
    onSubmit(title);
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        submit();
      }}
      onClick={(event) => event.stopPropagation()}
      className="rounded-lg border border-accent/40 bg-surface-solid p-2 shadow-2"
    >
      <div className="flex items-center gap-1.5">
        <CornerDownLeft className="size-3.5 shrink-0 text-ink-300" aria-hidden="true" />
        <input
          ref={inputRef}
          value={value}
          aria-label={label}
          placeholder={placeholder}
          autoComplete="off"
          maxLength={500}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              onCancel();
            }
          }}
          className="h-11 -my-2 min-w-0 flex-1 bg-transparent text-body text-ink-900 outline-none placeholder:text-ink-300"
        />
      </div>
      <p className="mt-1 pl-5 text-micro text-ink-300">Enter 保存 · Esc 取消</p>
    </form>
  );
}

export default InlineComposer;
