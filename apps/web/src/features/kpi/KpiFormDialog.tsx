import { useEffect, useState } from "react";
import type { Kpi, KpiAggregation, KpiAutoSource, KpiPeriod } from "@detter/shared";
import { Button, Dialog, Input, cn } from "@detter/ui";
import { AGGREGATION_LABEL, AUTO_SOURCE_LABEL, PERIOD_LABEL } from "./kpiModel";
import type { KpiDraft } from "./kpiActions";

/**
 * 新建 / 编辑指标。
 *
 * 一条 KPI 就是五个旋钮：名字 + 单位、周期、目标值、方向（越高越好 / 越低越好）、聚合方式，
 * 外加可选的自动来源。表单刻意不折叠高级项 —— 只有五六个字段，藏起来反而多点两下。
 */
export interface KpiFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: KpiDraft;
  editing: Kpi | null;
  onSubmit: (draft: KpiDraft) => void;
}

const PERIODS: KpiPeriod[] = ["day", "week", "month"];
const AGGREGATIONS: KpiAggregation[] = ["sum", "count", "max", "avg", "last"];
const AUTO_SOURCES: Array<{ value: KpiAutoSource | null; label: string }> = [
  { value: null, label: "手工打卡" },
  { value: "pomodoro_min", label: `自动 · ${AUTO_SOURCE_LABEL.pomodoro_min}` },
  { value: "focus_sessions", label: `自动 · ${AUTO_SOURCE_LABEL.focus_sessions}` },
  { value: "tasks_done", label: `自动 · ${AUTO_SOURCE_LABEL.tasks_done}` },
];

const COLORS = ["#6355F6", "#0EA5E9", "#10B981", "#F59E0B", "#EF4444", "#EC4899", "#8B5CF6"];

function Segment<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex items-center gap-1 rounded-full border border-border bg-surface-solid p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-7 rounded-full px-2.5 text-micro transition-colors duration-[var(--dur-1)]",
            value === option.value
              ? "bg-accent-soft text-accent"
              : "text-ink-500 hover:text-ink-900",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-border-strong bg-surface-solid px-2 text-body text-ink-900 transition-[border-color,box-shadow] duration-[var(--dur-1)] hover:border-border-strong focus:border-accent focus:ring-4 focus:ring-accent/15";

export function KpiFormDialog({
  open,
  onOpenChange,
  initial,
  editing,
  onSubmit,
}: KpiFormDialogProps) {
  const [draft, setDraft] = useState<KpiDraft>(initial);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraft(initial);
    setError("");
  }, [open, initial]);

  const patch = (part: Partial<KpiDraft>) => setDraft((current) => ({ ...current, ...part }));

  const submit = () => {
    const name = draft.name.trim();
    if (!name) {
      setError("先给指标起个名字");
      return;
    }
    if (!Number.isFinite(draft.targetValue) || draft.targetValue < 0) {
      setError("目标值得是 ≥ 0 的数字");
      return;
    }
    onSubmit({ ...draft, name });
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "编辑指标" : "新建指标"}
      description="自动来源的指标由番茄钟 / 任务完成情况汇总，不能手工录入。"
      size="md"
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" variant="primary" onClick={submit}>
            {editing ? "保存" : "创建"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="text-caption text-ink-700">名称</span>
          <Input
            autoFocus
            value={draft.name}
            onChange={(event) => patch({ name: event.target.value })}
            placeholder="深度工作时长 / 健身次数 / 读书页数"
            className="mt-1"
            aria-label="指标名称"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-caption text-ink-700">单位</span>
            <Input
              value={draft.unit}
              onChange={(event) => patch({ unit: event.target.value })}
              placeholder="分钟 / 次 / 页"
              className="mt-1"
              aria-label="单位"
            />
          </label>
          <label className="block">
            <span className="text-caption text-ink-700">周期目标</span>
            <Input
              type="number"
              min={0}
              value={String(draft.targetValue)}
              onChange={(event) => patch({ targetValue: Number(event.target.value) })}
              className="mt-1 tabular"
              aria-label="周期目标"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-caption text-ink-700">周期</span>
          <Segment
            label="周期"
            value={draft.period}
            options={PERIODS.map((period) => ({ value: period, label: PERIOD_LABEL[period] }))}
            onChange={(period) => patch({ period })}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-caption text-ink-700">方向</span>
          <Segment
            label="方向"
            value={draft.direction}
            options={[
              { value: "up", label: "越高越好" },
              { value: "down", label: "越低越好" },
            ]}
            onChange={(direction) => patch({ direction })}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-caption text-ink-700">聚合方式</span>
            <select
              className={cn(SELECT_CLASS, "mt-1")}
              value={draft.aggregation}
              onChange={(event) => patch({ aggregation: event.target.value as KpiAggregation })}
              aria-label="聚合方式"
            >
              {AGGREGATIONS.map((aggregation) => (
                <option key={aggregation} value={aggregation}>
                  {AGGREGATION_LABEL[aggregation]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-caption text-ink-700">数据来源</span>
            <select
              className={cn(SELECT_CLASS, "mt-1")}
              value={draft.autoSource ?? ""}
              onChange={(event) =>
                patch({ autoSource: (event.target.value || null) as KpiAutoSource | null })
              }
              aria-label="数据来源"
            >
              {AUTO_SOURCES.map((source) => (
                <option key={source.value ?? "manual"} value={source.value ?? ""}>
                  {source.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-caption text-ink-700">颜色</span>
          <div className="flex items-center gap-1.5" role="group" aria-label="指标颜色">
            {COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`选择颜色 ${color}`}
                aria-pressed={draft.color === color}
                onClick={() => patch({ color })}
                className={cn(
                  "size-6 rounded-full border transition-transform duration-[var(--dur-1)]",
                  draft.color === color
                    ? "scale-110 border-ink-900"
                    : "border-transparent hover:scale-105",
                )}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>

        {error && <p className="text-caption text-danger-ink">{error}</p>}
      </div>
    </Dialog>
  );
}
