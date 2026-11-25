import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { saveEntity } from "@/db/repo";
import { __resetSyncForTests, flush, getSyncSnapshot, push } from "@/sync/client";

/**
 * 同步客户端的三条关键分支：
 * 1) 离线（fetch 直接失败）→ 状态 offline，outbox 原样保留；
 * 2) 冲突且本地更新 → 换新 opId、以服务端 rev 为 baseRev 重排队；
 * 3) 冲突且服务端更新 → 覆盖本地并丢弃该 op。
 *
 * 用 stub 掉 global.fetch 的方式驱动真实代码路径，而不是只测纯函数，
 * 因为「协议接得对不对」恰恰在 IO 边界上最容易错。
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function okPush(results: unknown[], cursor = 1): Response {
  return jsonResponse({ ok: true, data: { results, cursor } });
}

function emptyPull(cursor = 1): Response {
  return jsonResponse({ ok: true, data: { changes: [], cursor, hasMore: false } });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(async () => {
  __resetSyncForTests();
  await db.delete();
  await db.open();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sync client：冲突与离线", () => {
  it("服务端不可达时进入 offline，outbox 一条不丢", async () => {
    await saveEntity("task", { title: "离线也要能记" });
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await flush();

    expect(getSyncSnapshot().state).toBe("offline");
    expect(await db.outbox.count()).toBe(1);
    expect(await db.tasks.count()).toBe(1);
  });

  it("冲突且本地更新更晚：用服务端 rev 重新入队，本地内容不被覆盖", async () => {
    const local = await saveEntity("task", { title: "本地最新版本" });
    const queued = await db.outbox.toArray();
    const originalOpId = queued[0]!.opId;

    // 服务器上的版本更旧（updatedAt 更小）→ localWins 应返回 true
    const serverPayload = { ...local, title: "服务器旧版本", updatedAt: local.updatedAt - 5_000 };
    fetchMock
      .mockResolvedValueOnce(
        okPush([{ opId: originalOpId, status: "conflict", rev: 7, server: serverPayload }]),
      )
      .mockResolvedValueOnce(emptyPull(7));

    await push();

    const row = await db.tasks.get(local.id);
    expect(row?.title).toBe("本地最新版本");

    const ops = await db.outbox.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]?.baseRev).toBe(7);
    // 必须换新 opId，否则服务端按幂等键直接判 duplicate
    expect(ops[0]?.opId).not.toBe(originalOpId);
    expect(ops[0]?.attempts).toBe(0);
  });

  it("冲突且服务端更新更晚：覆盖本地并删除该 op", async () => {
    const local = await saveEntity("task", { title: "本地旧版本" });
    const queued = await db.outbox.toArray();

    const serverPayload = {
      ...local,
      title: "服务器新版本",
      updatedAt: local.updatedAt + 5_000,
      rev: 9,
      deviceId: "another-device",
    };
    fetchMock.mockResolvedValueOnce(
      okPush([
        { opId: queued[0]!.opId, status: "conflict", rev: 9, server: serverPayload },
      ]),
    );

    await push();

    const row = await db.tasks.get(local.id);
    expect(row?.title).toBe("服务器新版本");
    expect(row?.rev).toBe(9);
    expect(await db.outbox.count()).toBe(0);
  });

  it("applied 后回写服务端 rev，并把 op 移出队列", async () => {
    const local = await saveEntity("task", { title: "会被接受" });
    const queued = await db.outbox.toArray();

    fetchMock.mockResolvedValueOnce(
      okPush([{ opId: queued[0]!.opId, status: "applied", rev: 3, seq: 12 }]),
    );

    await push();

    expect(await db.outbox.count()).toBe(0);
    expect((await db.tasks.get(local.id))?.rev).toBe(3);
  });

  it("单条 op 连续失败 3 次后进入死信队列（不静默丢弃）", async () => {
    await saveEntity("task", { title: "服务端一直拒绝" });
    const queued = await db.outbox.toArray();
    const opId = queued[0]!.opId;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      // 清掉退避时间，模拟下一轮同步立刻重试
      await db.outbox.toCollection().modify({ nextRetryAt: undefined });
      fetchMock.mockResolvedValueOnce(
        okPush([{ opId, status: "error", error: "validation_error" }]),
      );
      await push();
    }

    expect(await db.outbox.count()).toBe(0);
    expect(await db.outboxDead.count()).toBe(1);
    expect(getSyncSnapshot().dead).toBe(1);
    expect(getSyncSnapshot().state).toBe("error");
  });
});
