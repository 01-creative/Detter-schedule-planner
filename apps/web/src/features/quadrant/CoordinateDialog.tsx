import { useEffect, useState } from "react";
import type { Task } from "@detter/shared";
import { QUADRANT_META } from "@detter/shared";
import { Button, Dialog, cn } from "@detter/ui";

/**
 * 「设置精确坐标…」。
 *
 * 两个 0–100 的滑块 + 数字输入，左边一块同比例的迷你画布做实时预览。
 * 确定之前不写库：拖动滑块只是把 preview 传给板子（自由视图下真卡片会跟着动），
 * Esc / 取消就完全回到原样。
 */
export interface CoordinateDialogProps {
  task: Task | null;
  freeMode: boolean;
  onClose: () => void;
  onPreview: (preview: { taskId: string; posX: number; posY: number } | null) => void;
  onConfirm: (task: Task, posX: number, posY: number) => void;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function CoordinateDialog({
  task,
  freeMode,
  onClose,
  onPreview,
  onConfirm,
}: CoordinateDialogProps) {
  const [x, setX] = useState(50);
  const [y, setY] = useState(50);

  useEffect(() => {
    if (!task) return;
    setX(clampPercent(task.posX * 100));
    setY(clampPercent(task.posY * 100));
  }, [task]);

  /* 实时预览：滑块一动就通知板子；关闭时清掉，绝不留下幽灵位置 */
  useEffect(() => {
    if (!task) return;
    onPreview({ taskId: task.id, posX: x / 100, posY: y / 100 });
    return () => onPreview(null);
  }, [task, x, y, onPreview]);

  if (!task) return null;

  const quadrant = task.quadrant;
  const meta = QUADRANT_META[quadrant];
  const tone = `var(--q${quadrant}-accent)`;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="设置精确坐标"
      description="0 靠左上，100 靠右下。坐标是相对于所在象限内部的。"
      size="sm"
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            onClick={() => onConfirm(task, x / 100, y / 100)}
          >
            保存坐标
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div
          className="relative h-32 w-full overflow-hidden rounded-lg border border-border"
          style={{
            backgroundImage: `linear-gradient(180deg, var(--q${quadrant}-from) 0%, var(--q${quadrant}-to) 100%)`,
          }}
          aria-hidden="true"
        >
          <div className="absolute inset-x-0 top-0 flex h-7 items-center gap-1.5 px-2 text-micro text-ink-500">
            <span className="size-1.5 rounded-full" style={{ backgroundColor: tone }} />
            Q{quadrant} {meta.name}
          </div>
          <div
            className="absolute h-9 w-2/5 rounded-md border border-white/70 bg-surface-solid shadow-2"
            style={{
              left: `${x}%`,
              top: `${y}%`,
              transform: `translate(-${x}%, -${y}%)`,
            }}
          >
            <span className="absolute inset-y-1 left-0 w-[3px] rounded-r-full" style={{ backgroundColor: tone }} />
            <p className="line-clamp-2 px-2 pt-1 text-micro text-ink-700">{task.title}</p>
          </div>
        </div>

        <AxisControl
          axis="x"
          label="X · 水平"
          value={x}
          onChange={setX}
          hint="0 最左，100 最右"
        />
        <AxisControl
          axis="y"
          label="Y · 垂直"
          value={y}
          onChange={setY}
          hint="0 最上，100 最下"
        />

        {!freeMode && (
          <p className="rounded-md bg-info-soft px-2.5 py-2 text-micro text-info-ink">
            当前是列表视图，坐标会保存；确定后会自动切到自由视图，才能看到位置。
          </p>
        )}
      </div>
    </Dialog>
  );
}

function AxisControl({
  axis,
  label,
  value,
  onChange,
  hint,
}: {
  axis: "x" | "y";
  label: string;
  value: number;
  onChange: (value: number) => void;
  hint: string;
}) {
  const id = `coord-${axis}`;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-caption font-strong text-ink-700">
          {label}
        </label>
        <span className="tabular text-caption text-ink-500">{value}%</span>
      </div>
      <div className="mt-1.5 flex items-center gap-3">
        <input
          id={id}
          type="range"
          min={0}
          max={100}
          step={1}
          value={value}
          onChange={(event) => onChange(clampPercent(Number(event.target.value)))}
          className="h-1.5 flex-1 cursor-pointer accent-[color:var(--accent)]"
        />
        <input
          type="number"
          min={0}
          max={100}
          step={1}
          value={value}
          aria-label={`${label}百分比`}
          onChange={(event) => onChange(clampPercent(Number(event.target.value)))}
          className={cn(
            "tabular h-8 w-16 rounded-md border border-border-strong bg-surface-solid px-2 text-center text-caption text-ink-900",
            "focus:border-accent focus-visible:outline-2 focus-visible:outline-accent/40",
          )}
        />
      </div>
      <p className="mt-1 text-micro text-ink-300">{hint}</p>
    </div>
  );
}

export default CoordinateDialog;
