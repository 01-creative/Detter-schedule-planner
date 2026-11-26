import { useEffect, useState } from "react";
import type { Task } from "@detter/shared";
import { QUADRANT_META } from "@detter/shared";
import { Button, Dialog, cn } from "@detter/ui";
import { quadrantFromPosition } from "./geometry";

/**
 * 「设置精确坐标…」。
 *
 * 两个 0–100 的滑块 + 数字输入，左边一块同比例的迷你平面做实时预览。
 * 这里直接按用户能理解的两条轴命名：横轴紧急度、纵轴重要度；
 * 存库时再换回 posX / posY（posY = 1 - 重要度）。
 *
 * 确定之前不写库：拖动滑块只是把 preview 传给板子（平面上的真圆点会跟着动），
 * Esc / 取消就完全回到原样。
 */
export interface CoordinateDialogProps {
  task: Task | null;
  onClose: () => void;
  onPreview: (preview: { taskId: string; posX: number; posY: number } | null) => void;
  onConfirm: (task: Task, posX: number, posY: number) => void;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function CoordinateDialog({ task, onClose, onPreview, onConfirm }: CoordinateDialogProps) {
  const [urgency, setUrgency] = useState(50);
  const [importance, setImportance] = useState(50);

  useEffect(() => {
    if (!task) return;
    setUrgency(clampPercent(task.posX * 100));
    setImportance(clampPercent((1 - task.posY) * 100));
  }, [task]);

  const posX = urgency / 100;
  const posY = 1 - importance / 100;
  const quadrant = quadrantFromPosition(posX, posY);

  /* 实时预览：滑块一动就通知板子；关闭时清掉，绝不留下幽灵位置 */
  useEffect(() => {
    if (!task) return;
    onPreview({ taskId: task.id, posX, posY });
    return () => onPreview(null);
  }, [task, posX, posY, onPreview]);

  if (!task) return null;

  const meta = QUADRANT_META[quadrant];
  const tone = `var(--q${quadrant}-accent)`;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="设置精确坐标"
      description="横轴：左不紧急、右紧急；纵轴：下不重要、上重要。象限由坐标自动推导。"
      size="sm"
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" onClick={() => onConfirm(task, posX, posY)}>
            保存坐标
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div
          className="relative h-36 w-full overflow-hidden rounded-lg border border-border bg-surface"
          style={{
            backgroundImage: [
              "radial-gradient(70% 70% at 100% 0%, var(--plane-q1, rgba(244,63,94,.14)) 0%, transparent 70%)",
              "radial-gradient(70% 70% at 0% 0%, var(--plane-q2, rgba(16,185,129,.13)) 0%, transparent 70%)",
              "radial-gradient(70% 70% at 100% 100%, var(--plane-q3, rgba(245,158,11,.15)) 0%, transparent 70%)",
              "radial-gradient(70% 70% at 0% 100%, var(--plane-q4, rgba(100,116,139,.12)) 0%, transparent 70%)",
            ].join(", "),
          }}
          aria-hidden="true"
        >
          <span className="absolute top-1/2 right-2 left-2 h-px -translate-y-1/2 bg-border-strong" />
          <span className="absolute top-2 bottom-2 left-1/2 w-px -translate-x-1/2 bg-border-strong" />
          <div
            className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-2"
            style={{
              left: `${urgency}%`,
              top: `${100 - importance}%`,
              backgroundColor: tone,
            }}
          />
          <div className="absolute inset-x-0 top-0 flex h-7 items-center gap-1.5 px-2 text-micro text-ink-500">
            <span className="size-1.5 rounded-full" style={{ backgroundColor: tone }} />
            Q{quadrant} {meta.name}
          </div>
        </div>

        <AxisControl
          axis="x"
          label="紧急度 · 横轴"
          value={urgency}
          onChange={setUrgency}
          hint="0 最左（不紧急），100 最右（紧急）"
        />
        <AxisControl
          axis="y"
          label="重要度 · 纵轴"
          value={importance}
          onChange={setImportance}
          hint="0 最下（不重要），100 最上（重要）"
        />

        <p className="rounded-md bg-surface-sunken px-2.5 py-2 text-micro text-ink-500">
          保存后落在 Q{quadrant} {meta.name}，坐标 {posX.toFixed(2)} / {posY.toFixed(2)}。
        </p>
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
