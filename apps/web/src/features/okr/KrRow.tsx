import { useCallback, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, ReactElement } from "react";
import { Link2, MoreHorizontal, Pencil, Trash2, Zap } from "lucide-react";
import type { Goal, KeyResult, Task } from "@detter/shared";
import { Menu, cn } from "@detter/ui";
import type { MenuItem } from "@detter/ui";
import { tallyTasks, tasksOfKrId } from "@/features/review/metrics";
import type { AutoAdvanceConfig } from "./auto-advance";
import {
  clamp01,
  krAdjustable,
  krPercent,
  krRatio,
  krRatioBubbleLabel,
  krTargetLabel,
  krValueAtRatio,
  krValueLabel,
} from "./progress";

/**
 * KR 行 + 可拖拽进度条。
 *
 * 拖拽语义：在整条 24px 高的轨道上按下 → 实时按指针 x 比例预览 → 松手写库。
 * 拖动时上方出现数值气泡（60% / 12 篇），手指或鼠标移出也不会跳。
 *
 * 无障碍替代：轨道是 role=slider，方向键 ±5%（Shift ±1%），Home/End 到两端；
 * boolean 是 checkbox（点击/空格切换），milestone 由关联目标的里程碑决定，
 * 两者都不可拖 —— 把不可拖的东西做成可拖，比做成只读更让人困惑。
 */
export interface KrRowProps {
  kr: KeyResult;
  color: string;
  goals: readonly Goal[];
  tasks: readonly Task[];
  auto: AutoAdvanceConfig | undefined;
  onCommitValue: (value: number) => void;
  onEdit: () => void;
  onLink: () => void;
  onToggleAuto: () => void;
  onDelete: () => void;
}

export function KrRow({
  kr,
  color,
  goals,
  tasks,
  auto,
  onCommitValue,
  onEdit,
  onLink,
  onToggleAuto,
  onDelete,
}: KrRowProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragRatio, setDragRatio] = useState<number | null>(null);

  const baseRatio = krRatio(kr, goals);
  const ratio = dragRatio ?? baseRatio;
  const percent = krPercent(kr, goals);
  const adjustable = krAdjustable(kr);
  const isBoolean = kr.metricType === "boolean";
  const isMilestone = kr.metricType === "milestone";
  const taskTally = tallyTasks(tasksOfKrId(tasks, kr.id, kr.linkedTaskIds));
  const autoEnabled = auto?.enabled === true;

  const ratioFromClientX = useCallback((clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    return clamp01((clientX - rect.left) / rect.width);
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!adjustable) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragRatio(ratioFromClientX(event.clientX));
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!adjustable || dragRatio === null) return;
    setDragRatio(ratioFromClientX(event.clientX));
  };

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!adjustable || dragRatio === null) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const nextValue = krValueAtRatio(kr, dragRatio);
    setDragRatio(null);
    if (nextValue !== kr.currentValue) onCommitValue(nextValue);
  };

  const cancelDrag = () => {
    if (dragRatio !== null) setDragRatio(null);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!adjustable) return;
    const step = event.shiftKey ? 0.01 : 0.05;
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") next = clamp01(baseRatio + step);
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = clamp01(baseRatio - step);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = 1;
    if (next === null) return;
    event.preventDefault();
    onCommitValue(krValueAtRatio(kr, next));
  };

  const menuItems: MenuItem[] = [
    {
      key: "edit",
      label: "编辑 KR",
      icon: <Pencil className="size-3.5" aria-hidden="true" />,
      onSelect: onEdit,
    },
    {
      key: "link",
      label: "关联目标与任务",
      icon: <Link2 className="size-3.5" aria-hidden="true" />,
      onSelect: onLink,
    },
    {
      key: "auto",
      label: autoEnabled ? "关闭自动推进" : "开启自动推进（全部完成 +1）",
      icon: <Zap className="size-3.5" aria-hidden="true" />,
      active: autoEnabled,
      disabled: kr.metricType !== "number" || kr.linkedTaskIds.length === 0,
      onSelect: onToggleAuto,
    },
    {
      key: "delete",
      label: "删除 KR",
      icon: <Trash2 className="size-3.5" aria-hidden="true" />,
      danger: true,
      onSelect: onDelete,
    },
  ];

  const sliderProps = adjustable
    ? {
        role: "slider" as const,
        tabIndex: 0,
        "aria-label": `${kr.title} 进度`,
        "aria-valuemin": 0,
        "aria-valuemax": 100,
        "aria-valuenow": percent,
        "aria-valuetext": krRatioBubbleLabel(kr, baseRatio),
        onKeyDown: handleKeyDown,
      }
    : isBoolean
      ? {
          role: "checkbox" as const,
          tabIndex: 0,
          "aria-label": `${kr.title}（${kr.currentValue > 0 ? "已完成" : "未完成"}）`,
          "aria-checked": kr.currentValue > 0,
          onClick: () => onCommitValue(kr.currentValue > 0 ? 0 : 1),
          onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key !== " " && event.key !== "Enter") return;
            event.preventDefault();
            onCommitValue(kr.currentValue > 0 ? 0 : 1);
          },
        }
      : {};

  return (
    <li
      data-kr-id={kr.id}
      className="group/kr rounded-lg px-2 py-2 transition-colors duration-[var(--dur-1)] hover:bg-surface-sunken/50"
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-caption font-strong text-ink-900" title={kr.title}>
          {kr.title}
        </span>
        {autoEnabled && (
          <span className="shrink-0 rounded-full bg-accent-soft px-1.5 text-micro text-accent">自动</span>
        )}
        <span className="tabular shrink-0 text-micro text-ink-500">{krValueLabel(kr, goals)}</span>
        <span className="tabular w-9 shrink-0 text-right text-caption font-strong text-ink-900">
          {percent}%
        </span>
        <Menu
          align="end"
          label={`${kr.title} 的更多操作`}
          items={menuItems}
          trigger={
            (
              <button
                type="button"
                aria-label={`${kr.title} 的更多操作`}
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink-300 opacity-100 transition-colors duration-[var(--dur-1)] hover:bg-surface-sunken hover:text-ink-700 md:opacity-0 md:group-hover/kr:opacity-100 md:focus-visible:opacity-100"
              >
                <MoreHorizontal className="size-3.5" aria-hidden="true" />
              </button>
            ) as ReactElement
          }
        />
      </div>

      <div
        ref={trackRef}
        {...sliderProps}
        onPointerDown={adjustable ? handlePointerDown : undefined}
        onPointerMove={adjustable ? handlePointerMove : undefined}
        onPointerUp={adjustable ? finishDrag : undefined}
        onPointerCancel={adjustable ? cancelDrag : undefined}
        className={cn(
          "relative mt-1 h-6 touch-none rounded-md focus-visible:outline-2 focus-visible:outline-accent/50",
          adjustable && "cursor-ew-resize",
          isBoolean && "cursor-pointer",
          isMilestone && "cursor-default",
        )}
      >
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-surface-sunken">
          <div
            className={cn(
              "h-full origin-left rounded-full",
              dragRatio === null && "transition-transform duration-[var(--dur-2)] ease-out",
            )}
            style={{ transform: `scaleX(${clamp01(ratio)})`, backgroundColor: color }}
          />
        </div>

        {!isMilestone && (
          <span
            aria-hidden="true"
            className={cn(
              "absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border-strong bg-surface-solid shadow-1",
              dragRatio !== null && "scale-125",
              "transition-transform duration-[var(--dur-1)]",
            )}
            style={{ left: `${clamp01(ratio) * 100}%` }}
          />
        )}

        {dragRatio !== null && (
          <span
            className="tabular pointer-events-none absolute -top-5 z-10 -translate-x-1/2 rounded-md bg-ink-900 px-1.5 py-0.5 text-micro text-bg shadow-2"
            style={{ left: `${Math.min(92, Math.max(8, ratio * 100))}%` }}
          >
            {krRatioBubbleLabel(kr, dragRatio)}
          </span>
        )}
      </div>

      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-micro text-ink-300">
        <span>{krTargetLabel(kr)}</span>
        {taskTally.total > 0 && (
          <span>
            · 关联任务 {taskTally.done}/{taskTally.total}
          </span>
        )}
        {isMilestone && <span>· 由关联目标的里程碑决定</span>}
        {isBoolean && !isMilestone && <span>· 点击切换完成</span>}
        {adjustable && <span className="hidden xl:inline">· 拖动改进度</span>}
      </p>
    </li>
  );
}

export default KrRow;
