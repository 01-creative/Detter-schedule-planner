import { describe, expect, it } from "vitest";
import { call, createTestServer, pullAll, pushOps, setupUser, TEST_PASSWORD } from "./helpers";

/**
 * 验收场景 5-8：同步推送/幂等/冲突/墓碑/游标分页。
 * 另外覆盖协议文档 §5 的强制字段、时钟偏差与校验失败。
 */

interface OpResult {
  opId: string;
  status: "applied" | "conflict" | "error" | "duplicate";
  rev?: number;
  seq?: number;
  server?: Record<string, unknown> | null;
  error?: string;
}

interface PushBody {
  results: OpResult[];
  cursor: number;
}

function taskPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { title: "写周报", status: "todo", quadrant: 2, ...overrides };
}

async function push(
  server: Awaited<ReturnType<typeof createTestServer>>,
  cookie: string,
  deviceId: string,
  ops: Array<Record<string, unknown>>,
): Promise<PushBody> {
  const response = await pushOps(server, cookie, deviceId, ops);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body.data as unknown as PushBody;
}

function op(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    opId: crypto.randomUUID(),
    entity: "task",
    op: "upsert",
    id: "task-1",
    baseRev: 0,
    at: Date.now(),
    ...overrides,
  };
}

describe("同步", () => {
  it("push 新建得到 rev=1；同一 opId 再次推送返回 duplicate 且不重复应用", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server);

    const opId = crypto.randomUUID();
    const first = await push(server, cookie, "device-a", [
      op({ opId, payload: taskPayload({ title: "第一版" }) }),
    ]);

    expect(first.results[0]).toMatchObject({ status: "applied", rev: 1 });
    expect(first.results[0]?.seq).toBeGreaterThan(0);

    const second = await push(server, cookie, "device-a", [
      op({ opId, payload: taskPayload({ title: "被覆盖?" }) }),
    ]);
    expect(second.results[0]?.status).toBe("duplicate");
    expect(second.results[0]?.rev).toBe(1);
    expect(second.results[0]?.seq).toBe(first.results[0]?.seq);

    // 数据库里只有一条 changes：dup 推送没有再次写日志
    const changes = await pullAll(server, cookie);
    expect(changes).toHaveLength(1);

    const stored = await call<Record<string, unknown>>(server, "GET", "/api/v1/tasks/task-1", { cookie });
    expect(stored.status).toBe(200);
    expect(stored.body.data?.title).toBe("第一版");
    expect(stored.body.data?.rev).toBe(1);
  });

  it("同一批次里重复的 opId 只应用一次", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server);

    const opId = crypto.randomUUID();
    const body = await push(server, cookie, "device-a", [
      op({ opId, payload: taskPayload() }),
      op({ opId, payload: taskPayload({ title: "重复" }) }),
    ]);

    expect(body.results.map((result) => result.status)).toEqual(["applied", "duplicate"]);
    expect(await pullAll(server, cookie)).toHaveLength(1);
  });

  it("baseRev 过期返回 conflict 并带回服务端权威版本，重推后 rev 递增", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server);

    await push(server, cookie, "device-a", [op({ payload: taskPayload({ title: "v1" }) })]);
    const second = await push(server, cookie, "device-a", [
      op({ baseRev: 1, payload: taskPayload({ title: "v2" }) }),
    ]);
    expect(second.results[0]).toMatchObject({ status: "applied", rev: 2 });

    // 用过期 baseRev（仍是 1）再推
    const conflict = await push(server, cookie, "device-b", [
      op({ baseRev: 1, payload: taskPayload({ title: "迟到的修改", quadrant: 4 }) }),
    ]);
    expect(conflict.results[0]?.status).toBe("conflict");
    expect(conflict.results[0]?.rev).toBe(2);
    expect(conflict.results[0]?.server).toMatchObject({ title: "v2", rev: 2 });

    // 拿到服务端 rev 后重推成功
    const retried = await push(server, cookie, "device-b", [
      op({ baseRev: 2, payload: taskPayload({ title: "迟到的修改", quadrant: 4 }) }),
    ]);
    expect(retried.results[0]).toMatchObject({ status: "applied", rev: 3 });

    const stored = await call<Record<string, unknown>>(server, "GET", "/api/v1/tasks/task-1", { cookie });
    expect(stored.body.data).toMatchObject({ title: "迟到的修改", quadrant: 4, rev: 3 });
  });

  it("delete 产生墓碑，pull 能拉到 deleted=true 且 payload 为 null", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server);

    await push(server, cookie, "device-a", [op({ payload: taskPayload() })]);
    const deleted = await push(server, cookie, "device-a", [
      op({ op: "delete", baseRev: 1, payload: undefined }),
    ]);
    expect(deleted.results[0]).toMatchObject({ status: "applied", rev: 2 });

    const changes = await pullAll(server, cookie);
    const tombstone = changes.find((change) => change.deleted === true);
    expect(tombstone).toMatchObject({ entity: "task", entityId: "task-1", rev: 2, deleted: true, payload: null });

    // 删除后实体不可见，但 includeDeleted 能看到墓碑
    const gone = await call(server, "GET", "/api/v1/tasks/task-1", { cookie });
    expect(gone.status).toBe(404);

    const listed = await call<{ items: Array<Record<string, unknown>> }>(
      server,
      "GET",
      "/api/v1/tasks?includeDeleted=true",
      { cookie },
    );
    expect(listed.body.data?.items).toHaveLength(1);
    expect(listed.body.data?.items[0]?.deletedAt).toBeTypeOf("number");

    // 删除不存在的实体是幂等成功
    const idempotent = await push(server, cookie, "device-b", [
      op({ op: "delete", id: "never-existed", baseRev: 0, payload: undefined }),
    ]);
    expect(idempotent.results[0]).toMatchObject({ status: "applied", rev: 0 });
  });

  it("pull 游标递增、limit 生效、hasMore 正确且循环拉取不丢不重", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server);

    await push(
      server,
      cookie,
      "device-a",
      Array.from({ length: 5 }, (_, index) =>
        op({ id: `task-${index}`, payload: taskPayload({ title: `任务 ${index}` }) }),
      ),
    );

    const page1 = await call<{ changes: Array<{ seq: number }>; cursor: number; hasMore: boolean }>(
      server,
      "GET",
      "/api/v1/sync/pull?cursor=0&limit=2",
      { cookie },
    );
    expect(page1.body.data?.changes).toHaveLength(2);
    expect(page1.body.data?.hasMore).toBe(true);
    expect(page1.body.data?.cursor).toBe(page1.body.data?.changes[1]?.seq);

    const page2 = await call<{ changes: Array<{ seq: number }>; cursor: number; hasMore: boolean }>(
      server,
      "GET",
      `/api/v1/sync/pull?cursor=${page1.body.data?.cursor}&limit=2`,
      { cookie },
    );
    expect(page2.body.data?.changes).toHaveLength(2);
    expect(page2.body.data?.hasMore).toBe(true);
    expect(page2.body.data?.changes[0]?.seq).toBeGreaterThan(page1.body.data?.changes[1]?.seq as number);

    const page3 = await call<{ changes: Array<{ seq: number }>; cursor: number; hasMore: boolean }>(
      server,
      "GET",
      `/api/v1/sync/pull?cursor=${page2.body.data?.cursor}&limit=2`,
      { cookie },
    );
    expect(page3.body.data?.changes).toHaveLength(1);
    expect(page3.body.data?.hasMore).toBe(false);

    const all = await pullAll(server, cookie, 2);
    expect(all).toHaveLength(5);
    const seqs = all.map((change) => change.seq as number);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it("push 响应带回当前 cursor，等于最大 seq", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server);

    const body = await push(server, cookie, "device-a", [
      op({ id: "task-a", payload: taskPayload({ title: "a" }) }),
      op({ id: "task-b", payload: taskPayload({ title: "b" }) }),
    ]);
    expect(body.cursor).toBe(body.results[1]?.seq);

    const pull = await call<{ cursor: number }>(server, "GET", "/api/v1/sync/pull?cursor=0", { cookie });
    expect(pull.body.data?.cursor).toBe(body.cursor);
  });

  it("服务端强制覆盖 id / rev / deviceId，客户端不能伪造", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server);

    const body = await push(server, cookie, "real-device", [
      op({
        id: "op-id-wins",
        payload: taskPayload({ id: "forged-id", rev: 99, deviceId: "forged-device" }),
      }),
    ]);
    expect(body.results[0]).toMatchObject({ status: "applied", rev: 1 });

    const stored = await call<Record<string, unknown>>(server, "GET", "/api/v1/tasks/op-id-wins", { cookie });
    expect(stored.body.data).toMatchObject({ id: "op-id-wins", rev: 1, deviceId: "real-device" });
  });

  it("客户端时钟偏差超过 24h 时用服务器时间", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server);
    const now = Date.now();

    const body = await push(server, cookie, "device-a", [
      op({ payload: taskPayload({ updatedAt: now - 3 * 24 * 60 * 60 * 1000 }) }),
    ]);
    expect(body.results[0]?.status).toBe("applied");

    const stored = await call<Record<string, unknown>>(server, "GET", "/api/v1/tasks/task-1", { cookie });
    const updatedAt = Number(stored.body.data?.updatedAt);
    expect(Math.abs(updatedAt - Date.now())).toBeLessThan(10_000);
  });

  it("schema 校验失败返回 error 且不落库", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server);

    const body = await push(server, cookie, "device-a", [
      op({ payload: { title: "" } }), // title 至少 1 个字符
      op({ id: "task-2", payload: "不是对象" }),
    ]);

    expect(body.results[0]?.status).toBe("error");
    expect(body.results[0]?.error).toContain("validation_error");
    expect(body.results[1]?.status).toBe("error");

    const changes = await pullAll(server, cookie);
    expect(changes).toHaveLength(0);
  });

  it("snapshot 返回全部存活实体与 cursor（不含墓碑）", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server);

    await push(server, cookie, "device-a", [
      op({ id: "task-a", payload: taskPayload({ title: "留下" }) }),
      op({ id: "task-b", payload: taskPayload({ title: "删掉" }) }),
      op({ id: "task-c", entity: "goal", payload: { title: "一个目标" }, baseRev: 0 }),
    ]);
    await push(server, cookie, "device-a", [op({ id: "task-b", op: "delete", baseRev: 1, payload: undefined })]);

    const snapshot = await call<{
      entities: Record<string, Array<Record<string, unknown>>>;
      cursor: number;
      generatedAt: number;
    }>(server, "GET", "/api/v1/sync/snapshot", { cookie });

    expect(snapshot.status).toBe(200);
    expect(snapshot.body.data?.entities.task).toHaveLength(1);
    expect(snapshot.body.data?.entities.goal).toHaveLength(1);
    expect(snapshot.body.data?.entities.kpi).toHaveLength(0);
    expect(snapshot.body.data?.cursor).toBeGreaterThan(0);
    expect(snapshot.body.data?.generatedAt).toBeTypeOf("number");
  });

  it("跨设备：A 改标题、B 改象限 —— B 的 baseRev 过期，服务端保留 A 的版本", async () => {
    const server = await createTestServer();
    const cookieA = await setupUser(server, { deviceName: "设备 A" });
    const loginB = await call(server, "POST", "/api/v1/auth/login", {
      body: { password: TEST_PASSWORD, deviceName: "设备 B" },
    });
    const cookieB = loginB.cookie as string;

    // 共同起点：rev = 1
    await push(server, cookieA, "device-a", [op({ payload: taskPayload({ title: "原始标题", quadrant: 2 }) })]);

    // A 先改标题 → rev = 2
    const aUpdate = await push(server, cookieA, "device-a", [
      op({ baseRev: 1, payload: taskPayload({ title: "A 改的标题", quadrant: 2 }) }),
    ]);
    expect(aUpdate.results[0]).toMatchObject({ status: "applied", rev: 2 });

    // B 仍拿着 rev = 1 改象限 → 冲突，服务端返回 A 的版本
    const bAttempt = await push(server, cookieB, "device-b", [
      op({ baseRev: 1, payload: taskPayload({ title: "原始标题", quadrant: 4 }) }),
    ]);
    expect(bAttempt.results[0]?.status).toBe("conflict");
    expect(bAttempt.results[0]?.server).toMatchObject({ title: "A 改的标题", quadrant: 2, rev: 2 });

    // 服务端此时仍是 A 的版本（B 的冲突写入没有落库）
    const afterConflict = await call<Record<string, unknown>>(server, "GET", "/api/v1/tasks/task-1", { cookie: cookieA });
    expect(afterConflict.body.data).toMatchObject({ title: "A 改的标题", quadrant: 2, rev: 2 });

    // B 用服务端 rev 重推（客户端 localWins 判定 B 更新）→ 实体级 LWW：整条实体被 B 覆盖
    const bRetry = await push(server, cookieB, "device-b", [
      op({ baseRev: 2, payload: taskPayload({ title: "B 的标题", quadrant: 4 }) }),
    ]);
    expect(bRetry.results[0]).toMatchObject({ status: "applied", rev: 3 });

    const finalState = await call<Record<string, unknown>>(server, "GET", "/api/v1/tasks/task-1", { cookie: cookieA });
    expect(finalState.body.data).toMatchObject({ quadrant: 4, rev: 3, deviceId: "device-b" });
    // 实体级 LWW 的已知代价：字段级改动会互相覆盖（协议文档 §4「已知取舍」）
    expect(finalState.body.data?.title).toBe("B 的标题");
  });
});
