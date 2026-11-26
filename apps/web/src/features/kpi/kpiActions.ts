import { dayKey } from "@detter/shared";
import type { Kpi, KpiAggregation, KpiAutoSource, KpiEntry, KpiPeriod } from "@detter/shared";
import { db } from "@/db";
import { deleteEntity, saveEntity } from "@/db/repo";

/**
 * KPI 的写操作。
 *
 * 铁律：全部走 `@/db/repo`（它负责 updatedAt / outbox / rev），
 * 唯一例外是 quickAdd 需要先读当天已有的手动打卡，读用 Dexie 直查（只读不写）。
 */

export interface KpiDraft {
  name: string;
  unit: string;
  direction: "up" | "down";
  targetValue: number;
  period: KpiPeriod;
  aggregation: KpiAggregation;
  autoSource: KpiAutoSource | null;
  color: string;
}

export function emptyDraft(): KpiDraft {
  return {
    name: "",
    unit: "次",
    direction: "up",
    targetValue: 100,
    period: "week",
    aggregation: "sum",
    autoSource: null,
    color: "#0EA5E9",
  };
}

export function draftOf(kpi: Kpi): KpiDraft {
  return {
    name: kpi.name,
    unit: kpi.unit,
    direction: kpi.direction,
    targetValue: kpi.targetValue,
    period: kpi.period,
    aggregation: kpi.aggregation,
    autoSource: kpi.autoSource,
    color: kpi.color,
  };
}

function assertManual(kpi: Kpi): void {
  if (kpi.autoSource) {
    throw new Error("自动汇总的指标不支持手工录入");
  }
}

export async function createKpi(draft: KpiDraft, sortIndex: number): Promise<void> {
  await saveEntity("kpi", {
    name: draft.name.trim(),
    unit: draft.unit.trim() || "次",
    direction: draft.direction,
    targetValue: Math.max(0, Number(draft.targetValue) || 0),
    period: draft.period,
    aggregation: draft.aggregation,
    autoSource: draft.autoSource,
    color: draft.color,
    sortIndex,
  });
}

export async function updateKpi(kpi: Kpi, draft: KpiDraft): Promise<void> {
  await saveEntity("kpi", {
    ...kpi,
    name: draft.name.trim(),
    unit: draft.unit.trim() || "次",
    direction: draft.direction,
    targetValue: Math.max(0, Number(draft.targetValue) || 0),
    period: draft.period,
    aggregation: draft.aggregation,
    autoSource: draft.autoSource,
    color: draft.color,
  });
}

export async function deleteKpi(kpi: Kpi): Promise<void> {
  await deleteEntity("kpi", kpi.id);
}

async function manualEntriesOf(kpiId: string, date?: string): Promise<KpiEntry[]> {
  const rows = await db.kpiEntries.where("kpiId").equals(kpiId).toArray();
  return rows
    .filter((row) => !row.deletedAt && row.source === "manual")
    .filter((row) => (date ? row.date === date : true))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** 快速打卡：同一天的手动记录合并成一条，避免一天堆十几行「+1」。 */
export async function quickAdd(kpi: Kpi, delta: number, date = dayKey(Date.now())): Promise<void> {
  assertManual(kpi);
  const [latest] = await manualEntriesOf(kpi.id, date);
  if (!latest) {
    await saveEntity("kpiEntry", { kpiId: kpi.id, date, value: delta, note: "", source: "manual" });
    return;
  }
  const next = latest.value + delta;
  if (next <= 0 && delta < 0) {
    await deleteEntity("kpiEntry", latest.id);
    return;
  }
  await saveEntity("kpiEntry", { ...latest, value: next });
}

/** 补录 / 覆盖某一天：有手动记录就改值，没有就新增一条。 */
export async function setEntryForDate(
  kpi: Kpi,
  date: string,
  value: number,
  note = "",
): Promise<void> {
  assertManual(kpi);
  const [latest] = await manualEntriesOf(kpi.id, date);
  if (!latest) {
    await saveEntity("kpiEntry", { kpiId: kpi.id, date, value, note, source: "manual" });
    return;
  }
  await saveEntity("kpiEntry", { ...latest, date, value, note: note || latest.note });
}

export async function deleteEntry(entryId: string): Promise<void> {
  await deleteEntity("kpiEntry", entryId);
}
