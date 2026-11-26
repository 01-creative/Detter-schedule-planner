import { Maximize2, Minus, Plus } from "lucide-react";
import { cn } from "@detter/ui";

/**
 * 右下角画布控件：`+ / − / 适应画布` + 当前缩放比。
 *
 * 缩放比用 `tabular-nums`：数字宽度固定，按 `+` 时不会左右抖动。
 */

export interface CanvasControlsProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  className?: string;
}

const BUTTON = cn(
  "inline-flex size-8 items-center justify-center rounded-sm text-ink-700",
  "transition-colors duration-[var(--dur-1)] hover:bg-surface-sunken hover:text-ink-900",
);

export function CanvasControls({ zoom, onZoomIn, onZoomOut, onFit, className }: CanvasControlsProps) {
  return (
    <div
      className={cn(
        "absolute right-3 bottom-3 z-20 flex items-center gap-0.5 rounded-lg border border-border bg-surface-solid/95 p-1 shadow-2 backdrop-blur-[14px]",
        className,
      )}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button type="button" aria-label="缩小" title="缩小（−）" className={BUTTON} onClick={onZoomOut}>
        <Minus className="size-4" aria-hidden="true" />
      </button>
      <span
        className="tabular w-11 text-center text-micro text-ink-500"
        aria-live="off"
        data-testid="mindmap-zoom"
      >
        {Math.round(zoom * 100)}%
      </span>
      <button type="button" aria-label="放大" title="放大（+）" className={BUTTON} onClick={onZoomIn}>
        <Plus className="size-4" aria-hidden="true" />
      </button>
      <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
      <button type="button" aria-label="适应画布" title="适应画布" className={BUTTON} onClick={onFit}>
        <Maximize2 className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
