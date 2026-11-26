import { useEffect, useState } from "react";
import type { KeyResult, KrMetricType, Okr } from "@detter/shared";
import { Button, Dialog, Input, Switch, cn, useToast } from "@detter/ui";
import { createKeyResult, patchKeyResult, type DraftKeyResult } from "./okr-actions";
import { KR_METRIC_HINTS, KR_METRIC_LABELS } from "./progress";

/**
 * 单条 KR 的新建 / 编辑。
 *
 * 进度条负责「调当前值」，这个对话框负责「改定义」：标题、度量方式、起点/目标、单位。
 * 两种入口分开，避免拖一下进度就把目标值也改了的意外。
 */

const FIELD =
  "h-9 w-full rounded-md border border-border-strong bg-surface-solid px-2.5 text-body text-ink-900 placeholder:text-ink-300 focus:border-accent focus-visible:outline-2 focus-visible:outline-accent/40";

const METRIC_ORDER: readonly KrMetricType[] = ["percent", "number", "boolean", "milestone"];

const METRIC_DEFAULTS: Record<
  KrMetricType,
  Pick<DraftKeyResult, "startValue" | "targetValue" | "currentValue" | "unit">
> = {
  percent: { startValue: 0, targetValue: 100, currentValue: 0, unit: "%" },
  number: { startValue: 0, targetValue: 10, currentValue: 0, unit: "次" },
  boolean: { startValue: 0, targetValue: 1, currentValue: 0, unit: "" },
  milestone: { startValue: 0, targetValue: 1, currentValue: 0, unit: "" },
};

function toNumber(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface KrDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  okr: Okr | null;
  /** 传入表示编辑 */
  kr?: KeyResult | null;
  sortIndex?: number;
}

export function KrDialog({ open, onOpenChange, okr, kr = null, sortIndex = 0 }: KrDialogProps) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [metricType, setMetricType] = useState<KrMetricType>("number");
  const [startValue, setStartValue] = useState(0);
  const [targetValue, setTargetValue] = useState(10);
  const [currentValue, setCurrentValue] = useState(0);
  const [unit, setUnit] = useState("次");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (kr) {
      setTitle(kr.title);
      setMetricType(kr.metricType);
      setStartValue(kr.startValue);
      setTargetValue(kr.targetValue);
      setCurrentValue(kr.currentValue);
      setUnit(kr.unit);
    } else {
      setTitle("");
      setMetricType("number");
      setStartValue(0);
      setTargetValue(10);
      setCurrentValue(0);
      setUnit("次");
    }
    setSaving(false);
  }, [open, kr]);

  const changeMetric = (next: KrMetricType) => {
    setMetricType(next);
    setStartValue(METRIC_DEFAULTS[next].startValue);
    setTargetValue(METRIC_DEFAULTS[next].targetValue);
    setCurrentValue(METRIC_DEFAULTS[next].currentValue);
    setUnit(METRIC_DEFAULTS[next].unit);
  };

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || !okr || saving) return;
    setSaving(true);
    try {
      const draft: DraftKeyResult = {
        title: trimmed,
        metricType,
        startValue,
        targetValue,
        currentValue,
        unit,
      };
      if (kr) {
        await patchKeyResult(kr, draft);
        toast({ title: "KR 已更新", tone: "success" });
      } else {
        await createKeyResult(okr.id, draft, sortIndex);
        toast({ title: "KR 已添加", description: okr.title, tone: "success" });
      }
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "保存失败",
        description: error instanceof Error ? error.message : "稍后再试",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  const showNumbers = metricType === "percent" || metricType === "number";

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={kr ? "编辑 KR" : "新建 KR"}
      description={
        okr ? `挂在「${okr.title}」下 · ${KR_METRIC_HINTS[metricType]}` : "先选一个 Objective"
      }
      size="md"
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            size="sm"
            loading={saving}
            disabled={!title.trim() || !okr}
            onClick={() => void submit()}
          >
            {kr ? "保存" : "添加 KR"}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <div>
          <label htmlFor="kr-title" className="mb-1 block text-micro text-ink-500">
            关键结果
          </label>
          <Input
            id="kr-title"
            value={title}
            autoFocus
            maxLength={300}
            placeholder="例：每周精听 3 次"
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submit();
              }
            }}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="kr-metric" className="mb-1 block text-micro text-ink-500">
              度量方式
            </label>
            <select
              id="kr-metric"
              value={metricType}
              onChange={(event) => changeMetric(event.target.value as KrMetricType)}
              className={FIELD}
            >
              {METRIC_ORDER.map((metric) => (
                <option key={metric} value={metric}>
                  {KR_METRIC_LABELS[metric]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="kr-unit" className="mb-1 block text-micro text-ink-500">
              单位
            </label>
            <Input
              id="kr-unit"
              value={unit}
              placeholder="次 / 篇 / %"
              onChange={(event) => setUnit(event.target.value)}
            />
          </div>
        </div>

        {showNumbers && (
          <div className={cn("grid gap-2", metricType === "percent" ? "grid-cols-3" : "grid-cols-2")}>
            {metricType === "percent" && (
              <label className="block text-micro text-ink-500">
                起点
                <input
                  type="number"
                  value={startValue}
                  onChange={(event) => setStartValue(toNumber(event.target.value))}
                  className={cn(FIELD, "tabular mt-0.5")}
                />
              </label>
            )}
            <label className="block text-micro text-ink-500">
              当前
              <input
                type="number"
                value={currentValue}
                onChange={(event) => setCurrentValue(toNumber(event.target.value))}
                className={cn(FIELD, "tabular mt-0.5")}
              />
            </label>
            <label className="block text-micro text-ink-500">
              目标
              <input
                type="number"
                value={targetValue}
                onChange={(event) => setTargetValue(toNumber(event.target.value))}
                className={cn(FIELD, "tabular mt-0.5")}
              />
            </label>
          </div>
        )}

        {metricType === "boolean" && (
          <div className="flex items-center justify-between rounded-lg border border-border bg-surface-sunken/40 px-3 py-2">
            <span className="text-caption text-ink-700">当前已完成</span>
            <Switch
              checked={currentValue > 0}
              label="当前已完成"
              onCheckedChange={(checked) => setCurrentValue(checked ? 1 : 0)}
            />
          </div>
        )}

        {metricType === "milestone" && (
          <p className="rounded-lg border border-border bg-surface-sunken/40 px-3 py-2 text-micro text-ink-500">
            里程碑型 KR 的进度 = 关联目标里已完成里程碑 / 总里程碑，建好后点「关联」挂上目标。
          </p>
        )}

        <p className="text-micro text-ink-300">
          目标值不能为 0（百分比与数值）；完成度会在 0–100% 之间夹取。
        </p>
      </div>
    </Dialog>
  );
}

export default KrDialog;
