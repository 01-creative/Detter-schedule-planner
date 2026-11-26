import { beforeEach, describe, expect, it } from "vitest";
import { GoalSchema, TaskSchema } from "@detter/shared";
import { db } from "@/db";
import { saveEntity } from "@/db/repo";
import { computeReviewMetrics, reviewRange, type ReviewMetrics } from "../metrics";
import { buildReviewMarkdown } from "../markdown";
import { buildReviewNarrative } from "../narrative";
import {
  REVIEW_SNAPSHOT_VERSION,
  deleteReviewSnapshot,
  goalBaselineOf,
  isReviewSnapshot,
  latestSnapshotBefore,
  loadReviewSnapshot,
  loadReviewSnapshots,
  saveReviewSnapshot,
  settingKeyOf,
  type ReviewSnapshot,
} from "../snapshot";

/**
 * 快照读写：settings["review.<periodKey>"]。
 * 历史复盘不能再算 —— 存进去什么，回看就是什么。
 */

const NOW = new Date(2026, 10, 26, 15, 0, 0).getTime();

function metricsFor(offset: number): ReviewMetrics {
  const range = reviewRange("week", offset, NOW);
  const goal = GoalSchema.parse({ id: "g1", title: "目标一", createdAt: 1, updatedAt: 1 });
  const task = TaskSchema.parse({
    id: "t1",
    title: "做完一件事",
    goalId: "g1",
    status: "done",
    completedAt: range.start + 3_600_000,
    createdAt: range.start,
    updatedAt: 1,
  });
  return computeReviewMetrics({
    tasks: [task],
    goals: [goal],
    okrs: [],
    krs: [],
    kpis: [],
    kpiEntries: [],
    sessions: [],
    range,
    now: NOW,
  });
}

function makeSnapshot(offset: number, generatedAt = NOW): ReviewSnapshot {
  const metrics = metricsFor(offset);
  const narrative = buildReviewNarrative(metrics);
  return {
    version: REVIEW_SNAPSHOT_VERSION,
    periodKey: metrics.range.periodKey,
    range: metrics.range,
    generatedAt,
    narrative,
    metrics,
    markdown: buildReviewMarkdown(metrics, narrative, {
      generatedAt,
      snapshotKey: settingKeyOf(metrics.range.periodKey),
    }),
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe("复盘快照", () => {
  it("按 review.<periodKey> 落库，读回来的数字与存进去一致", async () => {
    const snapshot = makeSnapshot(0);
    await saveReviewSnapshot(snapshot);

    const rows = await db.settings.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.key).toBe("review.week:2026-11-23");
    expect(rows[0]?.id).toBe("setting:review.week:2026-11-23");

    const loaded = await loadReviewSnapshot(snapshot.periodKey);
    expect(loaded).not.toBeNull();
    expect(loaded?.generatedAt).toBe(snapshot.generatedAt);
    expect(loaded?.metrics.tasks.done).toBe(1);
    expect(loaded?.metrics.range.startKey).toBe("2026-11-23");
    expect(loaded?.markdown).toContain("# 本周复盘 · 11/23 - 11/29");
  });

  it("历史列表按生成时间倒序，且忽略非复盘 settings", async () => {
    await saveEntity("setting", { id: "setting:board.view", key: "board.view", value: "list" });
    await saveReviewSnapshot(makeSnapshot(-1, NOW - 10_000));
    await saveReviewSnapshot(makeSnapshot(0, NOW));

    const snapshots = await loadReviewSnapshots();
    expect(snapshots.map((item) => item.periodKey)).toEqual([
      "week:2026-11-23",
      "week:2026-11-16",
    ]);
    expect(snapshots[0]?.generatedAt).toBe(NOW);
  });

  it("取「整段在本期之前」的最近快照作为基线", async () => {
    const range = reviewRange("week", 0, NOW);
    const twoWeeksAgo = makeSnapshot(-2, NOW - 20_000);
    const lastWeek = makeSnapshot(-1, NOW - 10_000);
    await saveReviewSnapshot(twoWeeksAgo);
    await saveReviewSnapshot(lastWeek);

    const snapshots = await loadReviewSnapshots();
    const baseline = latestSnapshotBefore(snapshots, range);
    expect(baseline?.periodKey).toBe("week:2026-11-16");
    expect(goalBaselineOf(baseline)).toEqual({ g1: 100 });
    expect(goalBaselineOf(null)).toBeUndefined();
  });

  it("覆盖同一周期只保留一份值，删除后读不到", async () => {
    await saveReviewSnapshot(makeSnapshot(0, NOW - 5_000));
    await saveReviewSnapshot({ ...makeSnapshot(0, NOW), markdown: "# 新版" });
    expect((await loadReviewSnapshot("week:2026-11-23"))?.markdown).toBe("# 新版");

    await deleteReviewSnapshot("week:2026-11-23");
    expect(await loadReviewSnapshot("week:2026-11-23")).toBeNull();
    expect(await loadReviewSnapshots()).toEqual([]);
  });

  it("结构不完整的值不会被当成快照", async () => {
    expect(isReviewSnapshot(null)).toBe(false);
    expect(isReviewSnapshot({})).toBe(false);
    expect(isReviewSnapshot({ version: 1, periodKey: "week:x", generatedAt: 1, markdown: "" })).toBe(
      false,
    );
    const snapshot = makeSnapshot(0);
    expect(isReviewSnapshot(snapshot)).toBe(true);
    await saveEntity("setting", { id: "setting:review.bad", key: "review.bad", value: { nope: true } });
    expect(await loadReviewSnapshots()).toEqual([]);
  });
});
