import type { PomodoroKind } from "@detter/shared";
import { cn } from "@detter/ui";
import { phaseLabel } from "./pomodoroModel";
import type { TimerStatus } from "./pomodoroModel";

/**
 * 页面内的迷你计时器（任务书 §3.4）。
 *
 * 为什么不做成全局浮层：那需要在 `app/providers.tsx` 里挂一行 —— 基座文件不属于 T07。
 * 折中方案是把它做成页面内的 sticky 条 + 同步 document.title：
 * 滚动到页面任何位置都能看到剩余时间，切到别的标签页也能从标题栏看到。
 *
 * 空闲时什么都不渲染：没在计时的时候，这条横幅只会占地方。
 */
export interface FocusMiniBarProps {
  status: TimerStatus;
  kind: PomodoroKind;
  clock: string;
  taskTitle: string | null;
}

export function FocusMiniBar({ status, kind, clock, taskTitle }: FocusMiniBarProps) {
  if (status === "idle") return null;
  const paused = status === "paused";

  return (
    <div
      role="timer"
      aria-live="off"
      data-focus-mini=""
      className={cn(
        "sticky top-[52px] z-20 -mx-4 mb-4 border-b px-4 py-2 md:top-14 md:-mx-6 md:px-6 lg:-mx-8 lg:px-8",
        paused ? "border-warning/25 bg-warning-soft/70" : "border-accent/15 bg-accent-soft/70",
        "glass",
      )}
    >
      <div className="flex items-center gap-2.5">
        <span className="relative flex size-2 items-center justify-center" aria-hidden="true">
          <span
            className={cn(
              "absolute size-2 rounded-full",
              paused ? "bg-warning" : "animate-pulse-soft bg-accent",
            )}
          />
        </span>
        <span className="text-caption text-ink-500">
          {paused ? "已暂停" : `正在${phaseLabel(kind)}`}
        </span>
        <span className="tabular text-body-strong text-ink-900" data-mini-clock={clock}>
          {clock}
        </span>
        {taskTitle && (
          <span className="min-w-0 truncate text-caption text-ink-500">· {taskTitle}</span>
        )}
      </div>
    </div>
  );
}
