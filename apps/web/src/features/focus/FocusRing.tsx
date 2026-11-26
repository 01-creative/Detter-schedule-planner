import { useId } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { PomodoroKind } from "@detter/shared";
import { cn } from "@detter/ui";
import { phaseLabel } from "./pomodoroModel";
import type { TimerStatus } from "./pomodoroModel";

/**
 * 番茄钟大圆环（手写 SVG，直径 280 / 移动端 220）。
 *
 * 圆环只看一个数字：ratio（本轮到目前为止走掉的比例）。
 * 它由 endsAt 反算，不是自己累加的，所以刷新、切后台、锁屏回来都会立刻对上。
 * 呼吸光晕是 4s 的 transform 动画，prefers-reduced-motion 下直接关掉。
 */

export interface FocusRingProps {
  ratio: number;
  status: TimerStatus;
  kind: PomodoroKind;
  clock: string;
  /** 精确剩余毫秒，挂成 data 属性方便自测对照 endsAt */
  remainingMs: number;
  taskTitle: string | null;
  round: number;
  roundTotal: number;
}

const RADIUS = 124;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const VIEW = 280;

interface ToneColors {
  from: string;
  to: string;
  halo: string;
  dot: string;
}

function colorsFor(status: TimerStatus, kind: PomodoroKind): ToneColors {
  if (status === "paused") {
    return {
      from: "var(--ink-300)",
      to: "var(--ink-500)",
      halo: "var(--surface-sunken)",
      dot: "var(--ink-300)",
    };
  }
  if (kind !== "focus") {
    return {
      from: "var(--success)",
      to: "var(--info)",
      halo: "var(--success-soft)",
      dot: "var(--success)",
    };
  }
  return {
    from: "var(--accent)",
    to: "var(--info)",
    halo: "var(--accent-soft)",
    dot: "var(--accent)",
  };
}

function statusLabel(status: TimerStatus, kind: PomodoroKind): string {
  if (status === "paused") return "已暂停";
  if (status === "idle") return kind === "focus" ? "准备开始" : `${phaseLabel(kind)}时间`;
  return kind === "focus" ? "专注中" : phaseLabel(kind);
}

export function FocusRing({
  ratio,
  status,
  kind,
  clock,
  remainingMs,
  taskTitle,
  round,
  roundTotal,
}: FocusRingProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const gradientId = `focus-ring-${uid}`;
  const reduceMotion = useReducedMotion();
  const tone = colorsFor(status, kind);
  const safeRatio = Math.min(1, Math.max(0, ratio));

  return (
    <div
      className="relative grid place-items-center"
      data-focus-clock={clock}
      data-focus-status={status}
      data-focus-remaining={Math.round(remainingMs)}
    >
      {/* 极淡的渐变光晕：4s 呼吸，只动 transform / opacity */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute size-[240px] rounded-full sm:size-[320px]"
        style={{ background: `radial-gradient(circle at 50% 45%, ${tone.halo} 0%, transparent 68%)` }}
        animate={
          reduceMotion
            ? undefined
            : { scale: [0.94, 1.04, 0.94], opacity: [0.55, 0.95, 0.55] }
        }
        transition={reduceMotion ? undefined : { duration: 4, repeat: Infinity, ease: "easeInOut" }}
      />

      <svg
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        className="relative size-[220px] sm:size-[280px]"
        role="img"
        aria-label={`${phaseLabel(kind)}剩余 ${clock}${status === "paused" ? "，已暂停" : ""}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={tone.from} />
            <stop offset="100%" stopColor={tone.to} />
          </linearGradient>
        </defs>

        <circle
          cx={VIEW / 2}
          cy={VIEW / 2}
          r={RADIUS}
          fill="none"
          stroke="var(--border-strong)"
          strokeWidth="10"
        />

        {safeRatio > 0.001 && (
          <circle
            cx={VIEW / 2}
            cy={VIEW / 2}
            r={RADIUS}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - safeRatio)}
            transform={`rotate(-90 ${VIEW / 2} ${VIEW / 2})`}
            style={reduceMotion ? undefined : { transition: "stroke-dashoffset 250ms linear" }}
          />
        )}
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-caption text-ink-500">{statusLabel(status, kind)}</span>
        <span className="tabular mt-1 text-[44px] leading-none font-strong text-ink-900 sm:text-[52px]">
          {clock}
        </span>
        <span className="mt-2 max-w-[168px] truncate px-2 text-micro text-ink-500 sm:max-w-[200px]">
          {taskTitle ?? "未绑定任务"}
        </span>

        <div
          className="mt-2.5 flex items-center gap-1.5"
          role="img"
          aria-label={`本轮第 ${Math.min(round, roundTotal)} 个，共 ${roundTotal} 个`}
        >
          {Array.from({ length: roundTotal }).map((_, index) => (
            <span
              key={index}
              className={cn(
                "size-1.5 rounded-full transition-transform duration-[var(--dur-2)]",
                index < round ? "scale-110" : "border border-border-strong bg-transparent",
              )}
              style={index < round ? { backgroundColor: tone.dot } : undefined}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
