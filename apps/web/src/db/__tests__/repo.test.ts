import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseQuickCapture } from "@detter/shared";
import { db } from "@/db";
import { captureInbox, deleteEntity, onLocalWrite, saveEntity } from "@/db/repo";

/**
 * 本地库 + outbox 的行为约束。
 *
 * 这些断言是「离线不丢数据」的地基：只要实体和 outbox 不是成对写入，
 * 后面的同步做得再对也没用。
 */

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe("repo：本地写入与 outbox", () => {
  it("捕获一条收件箱：实体与 outbox 在同一事务里成对落库", async () => {
    const parsed = parseQuickCapture("明天下午3点 交高数作业 #作业", {
      now: new Date(2026, 2, 2, 10, 0, 0).getTime(),
    });

    const item = await captureInbox({ rawText: "明天下午3点 交高数作业 #作业", parsed });

    expect(await db.inbox.count()).toBe(1);
    expect(item.id).toBeTruthy();
    expect(item.status).toBe("pending");
    expect(item.deviceId).toBeTruthy();
    expect(item.deletedAt).toBeNull();

    const ops = await db.outbox.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      entity: "inbox",
      entityId: item.id,
      op: "upsert",
      baseRev: 0,
      attempts: 0,
    });
    // 推送的是完整快照，服务端不需要理解字段语义
    expect((ops[0]?.payload as { rawText?: string } | undefined)?.rawText).toBe(
      "明天下午3点 交高数作业 #作业",
    );
  });

  it("再次保存沿用已同步的 rev，只推进 updatedAt，并追加一条新 op", async () => {
    const first = await saveEntity("task", { title: "写周报", quadrant: 2 });
    // 模拟服务端已经确认过这个版本
    await db.tasks.update(first.id, { rev: 4 });

    const second = await saveEntity("task", { id: first.id, title: "写周报（改）" });

    expect(second.rev).toBe(4);
    expect(second.title).toBe("写周报（改）");
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);

    const ops = await db.outbox.toArray();
    expect(ops.map((op) => op.baseRev)).toEqual([0, 4]);
  });

  it("删除写墓碑并产生 delete op（不做物理删除）", async () => {
    const task = await saveEntity("task", { title: "取快递" });
    await db.outbox.clear();

    const changed = await deleteEntity("task", task.id);
    expect(changed).toBe(true);

    const row = await db.tasks.get(task.id);
    expect(row).toBeDefined();
    expect(row?.deletedAt).toEqual(expect.any(Number));
    expect(row?.updatedAt).toBeGreaterThanOrEqual(task.updatedAt);

    const ops = await db.outbox.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ entity: "task", entityId: task.id, op: "delete" });
    expect(ops[0]?.payload).toBeUndefined();
  });

  it("写入后通知订阅者（同步客户端的推送防抖靠它触发）", async () => {
    const listener = vi.fn();
    const unsubscribe = onLocalWrite(listener);

    await saveEntity("goal", { title: "读完 12 本书" });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    await saveEntity("goal", { title: "跑 300 公里" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("非法输入被 schema 拦下，不会写进库", async () => {
    await expect(saveEntity("task", { title: "" })).rejects.toBeTruthy();
    expect(await db.tasks.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });
});
