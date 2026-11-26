import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { shortId } from "@detter/shared";
import type { KrMetricType, Okr } from "@detter/shared";
import { Button, Dialog, Input, Textarea, cn, useToast } from "@detter/ui";
import { createOkr, patchOkr, type DraftKeyResult } from "./okr-actions";
import { DEFAULT_OKR_COLOR, OKR_COLORS } from "./okr-visuals";
import { KR_METRIC_HINTS, KR_METRIC_LABELS } from "./progress";
import type { OkrRange } from "./periods";

/**
 * 新建 / 编辑 Objective。
 *
 * 新建时可以直接把 3 条 KR 一次填完（验收要求「新建 Objective + 3 个 KR」），
 * 也可以只写标题，之后再逐条加 —— KR 的标题留空会被忽略，不会产生空 KR。
 *
 * 度量方式切换时会重置数值档位（百分比 0→100、数值 0→10），
 * 但不覆盖已经写好的标题：用户改主意的成本要低。
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

interface DraftRow extends DraftKeyResult {
  key: string;
}

function makeDraft(metricType: KrMetricType = "number"): DraftRow {
  return {
    key: shortId(6),
    title: "",
    metricType,
    ...METRIC_DEFAULTS[metricType],
  };
}

function toNumber(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface OkrDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  range: OkrRange;
  /** 传入表示编辑，不传表示新建 */
  okr?: Okr | null;
  sortIndex?: number;
}

export function OkrDialog({ open, onOpenChange, range, okr = null, sortIndex = 0 }: OkrDialogProps) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<string>(DEFAULT_OKR_COLOR);
  const [drafts, setDrafts] = useState<DraftRow[]>([makeDraft("number")]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (okr) {
      setTitle(okr.title);
      setDescription(okr.description);
      setColor(okr.color);
      setDrafts([]);
    } else {
      setTitle("");
      setDescription("");
      setColor(DEFAULT_OKR_COLOR);
      setDrafts([makeDraft("number")]);
    }
    setSaving(false);
  }, [open, okr]);

  const updateDraft = (key: string, patch: Partial<DraftRow>) => {
    setDrafts((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const changeMetric = (key: string, metricType: KrMetricType) => {
    updateDraft(key, { metricType, ...METRIC_DEFAULTS[metricType] });
  };

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      if (okr) {
        await patchOkr(okr, { title: trimmed, description: description.trim(), color });
        toast({ title: "Objective 已更新", tone: "success" });
      } else {
        const rows = drafts.filter((draft) => draft.title.trim().length > 0);
        await createOkr(
          { title: trimmed, description: description.trim(), range, color, sortIndex },
          rows.map(({ key: _key, ...rest }) => rest),
        );
        toast({
          title: "Objective 已创建",
          description: rows.length > 0 ? `带 ${rows.length} 个 KR` : "先加 KR 才会有进度",
          tone: "success",
        });
      }
      onOpenChange(false);
    } catch (error) {
      toast({
        title: okr ? "保存失败" : "创建失败",
        description: error instanceof Error ? error.message : "稍后再试",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={okr ? "编辑 Objective" : "新建 Objective"}
      description={okr ? "标题与描述随时可改。" : `${range.label} · ${range.caption}，目标写方向，KR 写刻度。`}
      size="lg"
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" loading={saving} disabled={!title.trim()} onClick={() => void submit()}>
            {okr ? "保存" : "创建"}
          </Button>
        </>
      }
    >
      <div className="max-h-[64dvh] space-y-4 overflow-y-auto pr-1">
        <div>
          <label htmlFor="okr-title" className="mb-1 block text-micro text-ink-500">
            Objective（方向）
          </label>
          <Input
            id="okr-title"
            value={title}
            autoFocus
            maxLength={300}
            placeholder="例如：把英语听力拉上来"
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing && okr) {
                event.preventDefault();
                void submit();
              }
            }}
          />
        </div>

        <div>
          <label htmlFor="okr-desc" className="mb-1 block text-micro text-ink-500">
            为什么重要（可选）
          </label>
          <Textarea
            id="okr-desc"
            rows={2}
            value={description}
            maxLength={1000}
            placeholder="一句话说明它和哪件长期的事有关"
            onChange={(event) => setDescription(event.target.value)}
            className="text-caption"
          />
        </div>

        <div>
          <p className="mb-1 text-micro text-ink-500">颜色</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Objective 颜色">
            {OKR_COLORS.map((value) => (
              <button
                key={value}
                type="button"
                aria-label={`颜色 ${value}`}
                aria-pressed={color === value}
                onClick={() => setColor(value)}
                className={cn(
                  "size-6 rounded-full transition-transform duration-[var(--dur-1)] hover:scale-110",
                  color === value && "ring-2 ring-ink-300 ring-offset-2 ring-offset-surface-solid",
                )}
                style={{ backgroundColor: value }}
              />
            ))}
          </div>
        </div>

        {!okr && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-micro text-ink-500">关键结果（可留空，之后再补）</p>
              <span className="text-micro text-ink-300">{drafts.length} 条</span>
            </div>

            {drafts.map((draft, index) => {
              const showStart = draft.metricType === "percent";
              const showNumbers = draft.metricType === "percent" || draft.metricType === "number";
              return (
                <div
                  key={draft.key}
                  className="rounded-lg border border-border bg-surface-sunken/40 p-2.5"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-micro font-strong text-ink-500">KR {index + 1}</span>
                    <span className="text-micro text-ink-300">{KR_METRIC_HINTS[draft.metricType]}</span>
                    {drafts.length > 1 && (
                      <button
                        type="button"
                        aria-label={`删除 KR ${index + 1}`}
                        onClick={() => setDrafts((rows) => rows.filter((row) => row.key !== draft.key))}
                        className="ml-auto inline-flex size-6 items-center justify-center rounded-md text-ink-300 hover:bg-surface-sunken hover:text-ink-700"
                      >
                        <X className="size-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>

                  <Input
                    aria-label={`KR ${index + 1} 标题`}
                    value={draft.title}
                    maxLength={300}
                    placeholder="例：每周精听 3 次"
                    onChange={(event) => updateDraft(draft.key, { title: event.target.value })}
                    className="mt-2"
                  />

                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <select
                      aria-label={`KR ${index + 1} 度量方式`}
                      value={draft.metricType}
                      onChange={(event) => changeMetric(draft.key, event.target.value as KrMetricType)}
                      className={FIELD}
                    >
                      {METRIC_ORDER.map((metric) => (
                        <option key={metric} value={metric}>
                          {KR_METRIC_LABELS[metric]}
                        </option>
                      ))}
                    </select>
                    <Input
                      aria-label={`KR ${index + 1} 单位`}
                      value={draft.unit}
                      placeholder="单位：次 / 篇 / 分"
                      onChange={(event) => updateDraft(draft.key, { unit: event.target.value })}
                    />
                  </div>

                  {showNumbers && (
                    <div className={cn("mt-2 grid gap-2", showStart ? "grid-cols-3" : "grid-cols-2")}>
                      {showStart && (
                        <label className="block text-micro text-ink-500">
                          起点
                          <input
                            type="number"
                            aria-label={`KR ${index + 1} 起点`}
                            value={draft.startValue}
                            onChange={(event) =>
                              updateDraft(draft.key, { startValue: toNumber(event.target.value) })
                            }
                            className={cn(FIELD, "tabular mt-0.5")}
                          />
                        </label>
                      )}
                      <label className="block text-micro text-ink-500">
                        当前
                        <input
                          type="number"
                          aria-label={`KR ${index + 1} 当前值`}
                          value={draft.currentValue}
                          onChange={(event) =>
                            updateDraft(draft.key, { currentValue: toNumber(event.target.value) })
                          }
                          className={cn(FIELD, "tabular mt-0.5")}
                        />
                      </label>
                      <label className="block text-micro text-ink-500">
                        目标
                        <input
                          type="number"
                          aria-label={`KR ${index + 1} 目标值`}
                          value={draft.targetValue}
                          onChange={(event) =>
                            updateDraft(draft.key, { targetValue: toNumber(event.target.value) })
                          }
                          className={cn(FIELD, "tabular mt-0.5")}
                        />
                      </label>
                    </div>
                  )}

                  {(draft.metricType === "boolean" || draft.metricType === "milestone") && (
                    <p className="mt-2 text-micro text-ink-300">
                      {draft.metricType === "boolean"
                        ? "完成即 100%，建好后点进度条切换。"
                        : "进度由关联目标的里程碑决定，建好后在「关联」里挂目标。"}
                    </p>
                  )}
                </div>
              );
            })}

            <Button
              size="sm"
              variant="secondary"
              className="w-full"
              leftIcon={<Plus className="size-3.5" aria-hidden="true" />}
              onClick={() => setDrafts((rows) => [...rows, makeDraft("number")])}
            >
              再加一条 KR
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}

export default OkrDialog;
