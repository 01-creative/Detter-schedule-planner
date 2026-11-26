import { useLiveQuery } from "dexie-react-hooks";
import type { KeyResult, Task } from "@detter/shared";
import { db } from "@/db";
import { saveEntity } from "@/db/repo";
import { patchKeyResult } from "./okr-actions";

/**
 * KR「自动推进」。
 *
 * 任务书 §3.2：linkedTaskIds 里的任务全部完成 → 进度 +1，仅 number 型、
 * 且 step 明确时生效，默认关闭。
 *
 * 开关本身没有地方放（KeyResult 契约里没有 auto 字段），因此存 settings：
 * `okr.krAuto` → { [krId]: { enabled, step, lastSignature } }。
 * lastSignature 是关联任务的状态签名：同一批任务只自动加一次，
 * 否则每次打开页面都会 +1，那不叫自动化，叫事故。
 */

export const AUTO_ADVANCE_KEY = "okr.krAuto";
export const AUTO_ADVANCE_DEFAULT_STEP = 1;

export interface AutoAdvanceConfig {
  enabled: boolean;
  step: number;
  /** 上次自动推进时的任务状态签名 */
  lastSignature?: string;
}

export type AutoAdvanceMap = Record<string, AutoAdvanceConfig>;

export function autoAdvanceSignature(kr: KeyResult, tasks: readonly Task[]): string {
  const linked = tasks.filter((task) => kr.linkedTaskIds.includes(task.id));
  return linked
    .map((task) => `${task.id}:${task.status}`)
    .sort()
    .join("|");
}

/** 只有 number 型、挂了任务、还没到目标时才谈得上自动推进。 */
export function canAutoAdvance(kr: KeyResult): boolean {
  return kr.metricType === "number" && kr.linkedTaskIds.length > 0 && kr.currentValue < kr.targetValue;
}

export function shouldAutoAdvance(
  kr: KeyResult,
  tasks: readonly Task[],
  config: AutoAdvanceConfig | undefined,
): boolean {
  if (!config?.enabled) return false;
  if (!canAutoAdvance(kr)) return false;
  const linked = tasks.filter((task) => kr.linkedTaskIds.includes(task.id) && !task.deletedAt);
  if (linked.length !== kr.linkedTaskIds.length) return false;
  if (!linked.every((task) => task.status === "done")) return false;
  return config.lastSignature !== autoAdvanceSignature(kr, tasks);
}

export function nextAutoValue(kr: KeyResult, config: AutoAdvanceConfig): number {
  const step =
    Number.isFinite(config.step) && config.step > 0 ? config.step : AUTO_ADVANCE_DEFAULT_STEP;
  const next = Math.round((kr.currentValue + step) * 100) / 100;
  return Math.min(kr.targetValue, next);
}

function parseMap(value: unknown): AutoAdvanceMap {
  if (typeof value !== "object" || value === null) return {};
  const out: AutoAdvanceMap = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null) continue;
    const record = raw as Record<string, unknown>;
    const step =
      typeof record.step === "number" && Number.isFinite(record.step) && record.step > 0
        ? record.step
        : AUTO_ADVANCE_DEFAULT_STEP;
    const config: AutoAdvanceConfig = { enabled: record.enabled === true, step };
    if (typeof record.lastSignature === "string") config.lastSignature = record.lastSignature;
    out[key] = config;
  }
  return out;
}

export async function loadAutoAdvanceMap(): Promise<AutoAdvanceMap> {
  const rows = await db.settings.where("key").equals(AUTO_ADVANCE_KEY).toArray();
  const latest = rows
    .filter((row) => !row.deletedAt)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return latest ? parseMap(latest.value) : {};
}

export async function saveAutoAdvanceEntry(
  krId: string,
  config: AutoAdvanceConfig,
): Promise<void> {
  const map = await loadAutoAdvanceMap();
  map[krId] = config;
  await saveEntity("setting", {
    id: `setting:${AUTO_ADVANCE_KEY}`,
    key: AUTO_ADVANCE_KEY,
    value: map,
  });
}

export async function removeAutoAdvanceEntry(krId: string): Promise<void> {
  const map = await loadAutoAdvanceMap();
  if (!(krId in map)) return;
  delete map[krId];
  await saveEntity("setting", {
    id: `setting:${AUTO_ADVANCE_KEY}`,
    key: AUTO_ADVANCE_KEY,
    value: map,
  });
}

/** 执行一次自动推进；成功后签名落库，重复调用不会再触发。 */
export async function applyAutoAdvance(
  kr: KeyResult,
  tasks: readonly Task[],
  config: AutoAdvanceConfig,
): Promise<boolean> {
  const next = nextAutoValue(kr, config);
  if (next === kr.currentValue) return false;
  await patchKeyResult(kr, { currentValue: next });
  await saveAutoAdvanceEntry(kr.id, {
    ...config,
    lastSignature: autoAdvanceSignature(kr, tasks),
  });
  return true;
}

export interface AutoAdvanceState {
  map: AutoAdvanceMap;
  loading: boolean;
}

export function useAutoAdvanceMap(): AutoAdvanceState {
  const data = useLiveQuery(async () => loadAutoAdvanceMap(), [], undefined);
  return { map: data ?? {}, loading: data === undefined };
}
