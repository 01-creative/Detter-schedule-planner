import { useState } from "react";
import { Ellipsis, Plus } from "lucide-react";
import type { KpiEntry } from "@detter/shared";
import { Badge, Button, Card, Input, Menu, Progress, cn } from "@detter/ui";
import { KpiChart } from "./KpiChart";
import { KpiDetail } from "./KpiDetail";
import {
  AGGREGATION_LABEL,
  PERIOD_LABEL,
  autoSourceLabel,
  formatKpiTarget,
  formatKpiValue,
} from "./kpiModel";
import type { KpiSnapshot, KpiTone } from "./kpiModel";

/**
 * 一张 KPI 卡片：数值 / 进度 / 趋势图 / 打卡入口 / 展开明细。
 *
 * 自动来源的指标把打卡区换成一句说明 —— 这比「给个禁用的输入框」更诚实：
 * 用户需要知道值是从哪来的，而不是以为输入框坏了。
 */
export interface KpiCardProps {
  snapshot: KpiSnapshot;
  entries: KpiEntry[];
  expanded: boolean;
  onToggle: () => void;
  onQuickAdd: (delta: number) => void;
  onBackfill: (date: string, value: number, note: string) => void;
  onDeleteEntry: (id: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}

const TONE_TEXT: Record<KpiTone, string> = {
  success: "text-success-ink",
  warning: "text-warning-ink",
  accent: "text-ink-700",
};

export function KpiCard({
  snapshot,
  entries,
  expanded,
  onToggle,
  onQuickAdd,
  onBackfill,
  onDeleteEntry,
  onEdit,
  onDelete,
}: KpiCardProps) {
  const { kpi } = snapshot;
  const [quick, setQuick] = useState("");
  const percent = Math.round(snapshot.progress * 100);
  const variant = kpi.aggregation === "count" ? "bar" : "line";

  const submitQuick = () => {
    const parsed = Number(quick);
    if (!Number.isFinite(parsed) || parsed === 0) return;
    onQuickAdd(parsed);
    setQuick("");
  };

  return (
    <Card padding="md" className="flex flex-col" data-kpi-name={kpi.name}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="truncate text-h2 text-ink-900">{kpi.name}</h3>
            {snapshot.auto ? (
              <Badge tone="info" dot>
                自动 · {autoSourceLabel(kpi.autoSource)}
              </Badge>
            ) : (
              <Badge tone="neutral">手工</Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-micro text-ink-500">
            {PERIOD_LABEL[snapshot.period]}度 · {AGGREGATION_LABEL[kpi.aggregation]} ·{" "}
            {snapshot.range.label}
          </p>
        </div>
        <Menu
          label={`${kpi.name} 操作`}
          trigger={
            <button
              type="button"
              aria-label={`${kpi.name} 操作`}
              className="-mt-1 -mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink-300 transition-colors duration-[var(--dur-1)] hover:bg-surface-sunken hover:text-ink-700"
            >
              <Ellipsis className="size-4" aria-hidden="true" />
            </button>
          }
          items={[
            { key: "edit", label: "编辑指标", onSelect: onEdit },
            { key: "delete", label: "删除指标", danger: true, onSelect: onDelete },
          ]}
        />
      </div>

      <div className="mt-3 flex items-baseline gap-1.5">
        <span
          className="tabular text-display leading-none font-strong text-ink-900"
          data-kpi-value=""
        >
          {formatKpiValue(snapshot.value)}
        </span>
        <span className="tabular text-caption text-ink-500">
          / {formatKpiTarget(snapshot.target)} {kpi.unit}
        </span>
        <span
          className={cn("tabular ml-auto text-body-strong", TONE_TEXT[snapshot.tone])}
          data-kpi-percent=""
        >
          {percent}%
        </span>
      </div>

      <Progress
        value={snapshot.progress * 100}
        tone={snapshot.tone}
        className="mt-2"
        trailing={kpi.direction === "down" ? "越低越好" : ""}
      />

      <KpiChart
        className="mt-3"
        points={snapshot.points}
        target={snapshot.chartTarget}
        color={kpi.color}
        tone={snapshot.tone}
        variant={variant}
        label={`${kpi.name}（${kpi.unit}）`}
      />

      <p className="mt-1.5 text-micro text-ink-500">{snapshot.pace}</p>

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-3">
        {snapshot.auto ? (
          <span className="text-micro text-ink-300">
            由{autoSourceLabel(kpi.autoSource)}自动汇总
          </span>
        ) : (
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onQuickAdd(1)}
              leftIcon={<Plus className="size-3" aria-hidden="true" />}
            >
              +1 {kpi.unit}
            </Button>
            <form
              className="flex items-center gap-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                submitQuick();
              }}
            >
              <Input
                inputMode="decimal"
                value={quick}
                onChange={(event) => setQuick(event.target.value)}
                placeholder="数值"
                aria-label={`${kpi.name} 打卡数值`}
                className="h-7 w-16 text-caption tabular"
              />
              <Button size="sm" type="submit" variant="ghost" disabled={quick.trim() === ""}>
                记一笔
              </Button>
            </form>
          </>
        )}

        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          data-kpi-toggle=""
          className="ml-auto shrink-0 text-micro text-accent transition-colors duration-[var(--dur-1)] hover:text-accent-hover"
        >
          {expanded ? "收起明细" : "每日明细"}
        </button>
      </div>

      {expanded && (
        <KpiDetail
          snapshot={snapshot}
          entries={entries}
          onBackfill={onBackfill}
          onDeleteEntry={onDeleteEntry}
        />
      )}
    </Card>
  );
}
