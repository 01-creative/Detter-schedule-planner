import { db } from "@/db";
import { deleteEntity, saveEntity } from "@/db/repo";
import type { ReviewMetrics, ReviewRange } from "./metrics";
import type { ReviewNarrative } from "./narrative";

/**
 * 复盘快照。
 *
 * 任务书 §4.4：生成过的复盘存进 `settings["review.<periodKey>"]`，历史可回看。
 * 为什么不每次打开都重算：任务会改、状态会变，重算出来的「上周复盘」和上周看到的不一样，
 * 那就不叫复盘了。快照 = 当时的口径 + 当时的结论。
 *
 * 键名：review.week:2026-11-24 / review.month:2026-11，与 ReviewRange.periodKey 一致。
 */

export const REVIEW_SNAPSHOT_VERSION = 1;
export const REVIEW_SETTING_PREFIX = "review.";

export interface ReviewSnapshot {
  version: typeof REVIEW_SNAPSHOT_VERSION;
  periodKey: string;
  range: ReviewRange;
  generatedAt: number;
  narrative: ReviewNarrative;
  metrics: ReviewMetrics;
  markdown: string;
}

export function settingKeyOf(periodKey: string): string {
  return `${REVIEW_SETTING_PREFIX}${periodKey}`;
}

export function snapshotSettingId(periodKey: string): string {
  return `setting:${settingKeyOf(periodKey)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 宽松校验：快照来自同步的其他设备，字段可能比本机旧，缺关键字段就当没存过。 */
export function isReviewSnapshot(value: unknown): value is ReviewSnapshot {
  if (!isRecord(value)) return false;
  if (value.version !== REVIEW_SNAPSHOT_VERSION) return false;
  if (typeof value.periodKey !== "string" || typeof value.generatedAt !== "number") return false;
  if (typeof value.markdown !== "string") return false;
  if (!isRecord(value.range) || !isRecord(value.narrative)) return false;
  if (!isRecord(value.metrics)) return false;
  return typeof value.range.periodKey === "string";
}

export async function loadReviewSnapshots(): Promise<ReviewSnapshot[]> {
  const rows = await db.settings.toArray();
  const byPeriod = new Map<string, ReviewSnapshot>();
  for (const row of rows) {
    if (row.deletedAt) continue;
    if (!row.key.startsWith(REVIEW_SETTING_PREFIX)) continue;
    if (!isReviewSnapshot(row.value)) continue;
    const existing = byPeriod.get(row.value.periodKey);
    // 同一周期理论上只有一行（id 固定）；万一旧版本用别的 id 写过，取生成时间最新的。
    if (!existing || row.value.generatedAt > existing.generatedAt) {
      byPeriod.set(row.value.periodKey, row.value);
    }
  }
  return [...byPeriod.values()].sort((a, b) => b.generatedAt - a.generatedAt);
}

export async function loadReviewSnapshot(periodKey: string): Promise<ReviewSnapshot | null> {
  const rows = await db.settings.where("key").equals(settingKeyOf(periodKey)).toArray();
  const alive = rows.filter((row) => !row.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt);
  for (const row of alive) {
    if (isReviewSnapshot(row.value)) return row.value;
  }
  return null;
}

export async function saveReviewSnapshot(snapshot: ReviewSnapshot): Promise<void> {
  const key = settingKeyOf(snapshot.periodKey);
  await saveEntity("setting", {
    id: snapshotSettingId(snapshot.periodKey),
    key,
    value: snapshot,
  });
}

export async function deleteReviewSnapshot(periodKey: string): Promise<void> {
  const rows = await db.settings.where("key").equals(settingKeyOf(periodKey)).toArray();
  for (const row of rows) {
    if (row.deletedAt) continue;
    await deleteEntity("setting", row.id);
  }
}

/** 最近一个「整段都在本期之前」的快照 —— 用它算目标进度的变化。 */
export function latestSnapshotBefore(
  snapshots: readonly ReviewSnapshot[],
  range: ReviewRange,
): ReviewSnapshot | null {
  let best: ReviewSnapshot | null = null;
  for (const snapshot of snapshots) {
    if (snapshot.range.end >= range.start) continue;
    if (!best || snapshot.range.end > best.range.end) best = snapshot;
  }
  return best;
}

/** 基线：目标 id → 上一次快照里的进度百分比。没有快照时返回 undefined。 */
export function goalBaselineOf(
  snapshot: ReviewSnapshot | null,
): Record<string, number> | undefined {
  if (!snapshot) return undefined;
  const baseline: Record<string, number> = {};
  for (const goal of snapshot.metrics.goals) baseline[goal.id] = goal.progress;
  return baseline;
}

/** 历史列表的显示名：本周 / 上周 / 本月 / 上月 / 更早的周期。 */
export function snapshotRangeLabel(range: ReviewRange): string {
  const base = range.type === "week" ? "周复盘" : "月复盘";
  return `${range.label} ${base}`;
}
