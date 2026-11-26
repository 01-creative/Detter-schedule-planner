import { useEffect, useMemo, useState } from "react";
import { Trash } from "lucide-react";
import { dayKey } from "@detter/shared";
import type { KpiEntry } from "@detter/shared";
import { Badge, Button, Input } from "@detter/ui";
import { entriesInRange, autoSourceLabel, formatKpiValue } from "./kpiModel";
import type { KpiSnapshot } from "./kpiModel";

/**
 * 卡片展开后的每日明细。
 *
 * 手工指标：可以直接补录（选日期 + 数值 + 备注），也可以删掉某一条；
 * 自动指标：**不允许手工录入**（任务书 §4.3），只展示由番茄钟/任务算出来的每日值，
 * 并明确写出数据来源，避免用户以为「记不进去是坏了」。
 */
export interface KpiDetailProps {
  snapshot: KpiSnapshot;
  entries: KpiEntry[];
  onBackfill: (date: string, value: number, note: string) => void;
  onDeleteEntry: (id: string) => void;
}

function shortDate(date: string): string {
  return date.slice(5);
}

export function KpiDetail({ snapshot, entries, onBackfill, onDeleteEntry }: KpiDetailProps) {
  const { kpi, range } = snapshot;
  const [date, setDate] = useState(() => dayKey(Date.now()));
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    setDate(dayKey(Date.now()));
    setValue("");
    setNote("");
  }, [kpi.id]);

  const kpiEntries = useMemo(
    () => entriesInRange(entries, kpi.id, range),
    [entries, kpi.id, range],
  );

  const autoPoints = useMemo(
    () =>
      snapshot.points
        .filter((point) => point.hasData)
        .slice(-14)
        .reverse(),
    [snapshot.points],
  );

  const submit = () => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    onBackfill(date, parsed, note.trim());
    setValue("");
    setNote("");
  };

  return (
    <div className="mt-3 border-t border-border pt-3">
      {snapshot.auto ? (
        <div className="space-y-2">
          <p className="rounded-md bg-info-soft px-2.5 py-2 text-micro text-info-ink">
            数据来自「{autoSourceLabel(kpi.autoSource)}」，由系统自动汇总，不支持手工录入。
          </p>
          {autoPoints.length === 0 ? (
            <p className="py-3 text-center text-caption text-ink-500">
              本周期还没有可汇总的数据。
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {autoPoints.map((point) => (
                <li key={point.date} className="flex items-center gap-2 py-1.5">
                  <span className="tabular text-caption text-ink-500">{shortDate(point.date)}</span>
                  <span className="ml-auto tabular text-caption text-ink-900">
                    {formatKpiValue(point.value)} {kpi.unit}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <label className="flex flex-col gap-1">
              <span className="text-micro text-ink-500">日期</span>
              <Input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="h-8 w-[136px] text-caption tabular"
                aria-label="打卡日期"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-micro text-ink-500">数值</span>
              <Input
                inputMode="decimal"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder={`${kpi.unit}`}
                className="h-8 w-20 text-caption tabular"
                aria-label="打卡数值"
              />
            </label>
            <label className="flex min-w-[120px] flex-1 flex-col gap-1">
              <span className="text-micro text-ink-500">备注（可选）</span>
              <Input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="补录原因"
                className="h-8 text-caption"
                aria-label="打卡备注"
              />
            </label>
            <Button size="sm" type="submit" variant="secondary" disabled={value.trim() === ""}>
              补录
            </Button>
          </form>

          {kpiEntries.length === 0 ? (
            <p className="py-3 text-center text-caption text-ink-500">本周期还没有打卡，补录一条试试。</p>
          ) : (
            <ul className="mt-2 max-h-52 divide-y divide-border overflow-y-auto pr-1">
              {kpiEntries.map((entry) => (
                <li key={entry.id} className="flex items-center gap-2 py-1.5">
                  <span className="tabular text-caption text-ink-500">{shortDate(entry.date)}</span>
                  <span className="tabular text-caption text-ink-900">
                    {formatKpiValue(entry.value)} {kpi.unit}
                  </span>
                  {entry.note && (
                    <span className="min-w-0 flex-1 truncate text-micro text-ink-300">
                      {entry.note}
                    </span>
                  )}
                  <Badge tone="neutral">{entry.source === "manual" ? "手工" : "自动"}</Badge>
                  <button
                    type="button"
                    aria-label={`删除 ${entry.date} 的记录`}
                    onClick={() => onDeleteEntry(entry.id)}
                    className="inline-flex size-7 items-center justify-center rounded-md text-ink-300 transition-colors duration-[var(--dur-1)] hover:bg-danger-soft hover:text-danger-ink"
                  >
                    <Trash className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
