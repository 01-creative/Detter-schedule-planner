import { describe, expect, it } from "vitest";
import { call, createTestServer, setupUser } from "./helpers";

/**
 * 验收场景 9（CRUD 写入必须留下 changes 记录）+ 通用 CRUD 的行为面：
 * 过滤、分页、软删除、settings 整体 upsert、设备管理、健康检查。
 */

type Payload = Record<string, unknown>;

describe("通用 CRUD", () => {
  it("创建 task 后 changes 里恰好多一条记录", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server);

    const before = await server.db.first<{ count: number }>("SELECT COUNT(*) AS count FROM changes");
    expect(Number(before?.count)).toBe(0);

    const created = await call<Payload>(server, "POST", "/api/v1/tasks", {
      cookie,
      body: { title: "写周报", quadrant: 1, startAt: Date.now(), tags: ["工作"] },
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ title: "写周报", quadrant: 1, rev: 1, deletedAt: null });
    expect(created.body.data?.id).toBeTypeOf("string");

    const row = await server.db.first<{ entity: string; entity_id: string; rev: number; deleted: number; payload: string }>(
      "SELECT entity, entity_id, rev, deleted, payload FROM changes ORDER BY seq DESC LIMIT 1",
    );
    expect(row).toMatchObject({ entity: "task", deleted: 0, rev: 1 });
    expect(row?.entity_id).toBe(created.body.data?.id);
    expect((JSON.parse(row?.payload as string) as Payload).title).toBe("写周报");

    const after = await server.db.first<{ count: number }>("SELECT COUNT(*) AS count FROM changes");
    expect(Number(after?.count)).toBe(1);
  });

  it("列表过滤：quadrant / status / q（含 LIKE 转义）/ from-to", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server);
    const base = Date.UTC(2026, 0, 15, 9, 0, 0);

    const seeds: Array<Record<string, unknown>> = [
      { title: "紧急会议", quadrant: 1, status: "todo", startAt: base },
      { title: "写季度总结", quadrant: 2, status: "doing", dueAt: base + 86_400_000 },
      { title: "100% 完成的事", quadrant: 2, status: "done", completedAt: base },
      { title: "刷手机", quadrant: 4, status: "dropped" },
    ];
    for (const seed of seeds) {
      const created = await call(server, "POST", "/api/v1/tasks", { cookie, body: seed });
      expect(created.status).toBe(201);
    }

    const q2 = await call<{ items: Payload[] }>(server, "GET", "/api/v1/tasks?quadrant=2", { cookie });
    expect(q2.body.data?.items.map((item) => item.title).sort()).toEqual(["100% 完成的事", "写季度总结"]);

    const doing = await call<{ items: Payload[] }>(server, "GET", "/api/v1/tasks?status=doing", { cookie });
    expect(doing.body.data?.items).toHaveLength(1);
    expect(doing.body.data?.items[0]?.title).toBe("写季度总结");

    // q 走 json_extract + LIKE，% 必须被转义，否则 "100%" 会匹配到全部
    const keyword = await call<{ items: Payload[] }>(
      server,
      "GET",
      `/api/v1/tasks?q=${encodeURIComponent("100%")}`,
      { cookie },
    );
    expect(keyword.body.data?.items).toHaveLength(1);
    expect(keyword.body.data?.items[0]?.title).toBe("100% 完成的事");

    // from/to 命中 startAt 或 dueAt
    const range = await call<{ items: Payload[] }>(
      server,
      "GET",
      `/api/v1/tasks?from=${base}&to=${base + 3_600_000}`,
      { cookie },
    );
    expect(range.body.data?.items.map((item) => item.title)).toEqual(["紧急会议"]);

    // 非法枚举值要报 validation_error，而不是静默返回空
    const invalid = await call(server, "GET", "/api/v1/tasks?status=nope", { cookie });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error?.code).toBe("validation_error");
  });

  it("PATCH 只合并顶层字段并递增 rev，DELETE 是软删除", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server);

    const created = await call<Payload>(server, "POST", "/api/v1/tasks", {
      cookie,
      body: { title: "原标题", quadrant: 3, tags: ["a"], checklist: [{ id: "c1", text: "步骤" }] },
    });
    const id = created.body.data?.id as string;

    const patched = await call<Payload>(server, "PATCH", `/api/v1/tasks/${id}`, {
      cookie,
      body: { title: "新标题" },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.data).toMatchObject({
      title: "新标题",
      quadrant: 3, // 未传的字段保留
      rev: 2,
    });
    expect(patched.body.data?.tags).toEqual(["a"]);

    const deleted = await call<Payload>(server, "DELETE", `/api/v1/tasks/${id}`, { cookie });
    expect(deleted.status).toBe(200);
    expect(deleted.body.data?.deletedAt).toBeTypeOf("number");
    expect(deleted.body.data?.rev).toBe(3);

    const gone = await call(server, "GET", `/api/v1/tasks/${id}`, { cookie });
    expect(gone.status).toBe(404);

    const withDeleted = await call<{ items: Payload[] }>(
      server,
      "GET",
      `/api/v1/tasks?includeDeleted=true`,
      { cookie },
    );
    expect(withDeleted.body.data?.items).toHaveLength(1);

    const alive = await call<{ items: Payload[] }>(server, "GET", "/api/v1/tasks", { cookie });
    expect(alive.body.data?.items).toHaveLength(0);

    const deleteAgain = await call(server, "DELETE", `/api/v1/tasks/${id}`, { cookie });
    expect(deleteAgain.status).toBe(200);
  });

  it("游标分页：limit 生效且 nextCursor 能翻到下一页", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server);

    for (let index = 0; index < 5; index++) {
      await call(server, "POST", "/api/v1/tasks", { cookie, body: { title: `任务 ${index}` } });
    }

    const page1 = await call<{ items: Payload[]; nextCursor: string | null }>(
      server,
      "GET",
      "/api/v1/tasks?limit=2",
      { cookie },
    );
    expect(page1.body.data?.items).toHaveLength(2);
    expect(page1.body.data?.nextCursor).toBeTruthy();

    const page2 = await call<{ items: Payload[]; nextCursor: string | null }>(
      server,
      "GET",
      `/api/v1/tasks?limit=2&cursor=${encodeURIComponent(page1.body.data?.nextCursor as string)}`,
      { cookie },
    );
    expect(page2.body.data?.items).toHaveLength(2);
    const page1Ids = (page1.body.data?.items ?? []).map((item) => item.id);
    const page2Ids = (page2.body.data?.items ?? []).map((item) => item.id);
    expect(page1Ids.some((id) => page2Ids.includes(id))).toBe(false);

    const page3 = await call<{ items: Payload[]; nextCursor: string | null }>(
      server,
      "GET",
      `/api/v1/tasks?limit=2&cursor=${encodeURIComponent(page2.body.data?.nextCursor as string)}`,
      { cookie },
    );
    expect(page3.body.data?.items).toHaveLength(1);
    expect(page3.body.data?.nextCursor).toBeNull();
  });

  it("kpi-entries 支持 kpiId 与日期区间过滤", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server);

    const kpi = await call<Payload>(server, "POST", "/api/v1/kpis", {
      cookie,
      body: { name: "每日俯卧撑", targetValue: 30, period: "day" },
    });
    const kpiId = kpi.body.data?.id as string;

    for (const [date, value] of [
      ["2026-01-01", 10],
      ["2026-01-02", 20],
      ["2026-01-05", 30],
    ] as const) {
      const entry = await call(server, "POST", "/api/v1/kpi-entries", {
        cookie,
        body: { kpiId, date, value },
      });
      expect(entry.status).toBe(201);
    }

    const byKpi = await call<{ items: Payload[] }>(server, "GET", `/api/v1/kpi-entries?kpiId=${kpiId}`, {
      cookie,
    });
    expect(byKpi.body.data?.items).toHaveLength(3);

    const byRange = await call<{ items: Payload[] }>(
      server,
      "GET",
      `/api/v1/kpi-entries?kpiId=${kpiId}&from=2026-01-02&to=2026-01-05`,
      { cookie },
    );
    expect(byRange.body.data?.items.map((item) => item.date).sort()).toEqual(["2026-01-02", "2026-01-05"]);
  });

  it("settings 是整体 upsert，同名 key 重复写入会递增 rev 而不是报冲突", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server);

    const first = await call<{ saved: number }>(server, "PUT", "/api/v1/settings", {
      cookie,
      body: { theme: "dark", weekStartsOn: 1 },
    });
    expect(first.status).toBe(200);
    expect(first.body.data?.saved).toBe(2);

    const read = await call<Record<string, unknown>>(server, "GET", "/api/v1/settings", { cookie });
    expect(read.body.data).toEqual({ theme: "dark", weekStartsOn: 1 });

    const second = await call(server, "PUT", "/api/v1/settings", { cookie, body: { theme: "light" } });
    expect(second.status).toBe(200);

    const reread = await call<Record<string, unknown>>(server, "GET", "/api/v1/settings", { cookie });
    expect(reread.body.data).toEqual({ theme: "light", weekStartsOn: 1 });

    const rows = await server.db.all<{ id: string; rev: number; key: string; deleted_at: number | null }>(
      "SELECT id, rev, key, deleted_at FROM settings WHERE key = 'theme'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rev).toBe(2);
    expect(rows[0]?.deleted_at).toBeNull();
  });

  it("被软删的 setting 再次 PUT 同名 key 会复活同一行（唯一索引覆盖墓碑）", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server);

    await call(server, "PUT", "/api/v1/settings", { cookie, body: { theme: "dark" } });
    const before = await server.db.all<{ id: string }>("SELECT id FROM settings WHERE key = 'theme'");
    const settingId = before[0]?.id as string;

    const removed = await call(server, "DELETE", `/api/v1/settings/${settingId}`, { cookie });
    expect(removed.status).toBe(200);
    expect((await call(server, "GET", "/api/v1/settings", { cookie })).body.data).toEqual({});

    const replayed = await call(server, "PUT", "/api/v1/settings", { cookie, body: { theme: "light" } });
    expect(replayed.status).toBe(200);
    expect((await call(server, "GET", "/api/v1/settings", { cookie })).body.data).toEqual({ theme: "light" });

    const after = await server.db.all<{ id: string; rev: number; deleted_at: number | null }>(
      "SELECT id, rev, deleted_at FROM settings WHERE key = 'theme'",
    );
    expect(after).toHaveLength(1);
    expect(after[0]?.id).toBe(settingId);
    expect(after[0]?.deleted_at).toBeNull();
    expect(after[0]?.rev).toBe(3);
  });

  it("设备列表 / 改名 / 删除后会话被吊销", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server, { deviceName: "工作站" });

    const list = await call<{ items: Array<Record<string, unknown>> }>(server, "GET", "/api/v1/devices", { cookie });
    const devices = list.body.data?.items ?? [];
    expect(devices).toHaveLength(1);
    const deviceId = devices[0]?.id as string;

    const renamed = await call(server, "POST", `/api/v1/devices/${deviceId}`, { cookie, body: { name: "台式机" } });
    expect(renamed.status).toBe(200);

    const afterRename = await call<{ items: Array<Record<string, unknown>> }>(server, "GET", "/api/v1/devices", {
      cookie,
    });
    expect(afterRename.body.data?.items[0]?.name).toBe("台式机");

    const removed = await call<{ revokedSessions: number }>(server, "DELETE", `/api/v1/devices/${deviceId}`, {
      cookie,
    });
    expect(removed.status).toBe(200);
    expect(removed.body.data?.revokedSessions).toBeGreaterThanOrEqual(1);

    const afterDelete = await call(server, "GET", "/api/v1/tasks", { cookie });
    expect(afterDelete.status).toBe(401);
  });

  it("health 不需要鉴权，未知集合返回 404", async () => {
    const server = await createTestServer();

    const health = await call<Record<string, unknown>>(server, "GET", "/api/v1/health");
    expect(health.status).toBe(200);
    expect(health.body.data).toMatchObject({ ok: true, db: "ok", runtime: "node", version: "0.1.0" });

    const cookie = await setupUser(server);
    const unknown = await call(server, "GET", "/api/v1/nonsense", { cookie });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error?.code).toBe("not_found");
  });

  it("实体校验失败返回 400 且错误里带字段路径", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server);

    const bad = await call(server, "POST", "/api/v1/tasks", { cookie, body: { quadrant: 9 } });
    expect(bad.status).toBe(400);
    expect(bad.body.error?.code).toBe("validation_error");
    expect(JSON.stringify(bad.body.error?.details)).toContain("title");
  });

  it("请求体超过 1MB 返回 413 payload_too_large", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server);

    const huge = "x".repeat(1024 * 1024 + 16);
    const result = await call(server, "POST", "/api/v1/tasks", {
      cookie,
      body: { title: "超大备注", notes: huge },
    });
    expect(result.status).toBe(413);
    expect(result.body.error?.code).toBe("payload_too_large");
  });

  it("context 上下文包能拿到当前范围的任务与统计", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server);

    const now = Date.now();
    await call(server, "POST", "/api/v1/tasks", {
      cookie,
      body: { title: "今天的任务", startAt: now, quadrant: 2 },
    });

    const context = await call<{ briefing: string; tasks: unknown[]; stats: Record<string, number> }>(
      server,
      "GET",
      "/api/v1/context?range=today",
      { cookie },
    );
    expect(context.status).toBe(200);
    expect(context.body.data?.tasks).toHaveLength(1);
    expect(context.body.data?.briefing).toContain("项待办");
    expect(context.body.data?.stats.tasksInRange).toBe(1);

    const markdown = await server.app.request("/api/v1/context?format=markdown", {
      headers: { cookie, "x-detter-csrf": "1" },
    });
    expect(markdown.status).toBe(200);
    expect(markdown.headers.get("content-type")).toContain("text/markdown");
    expect(await markdown.text()).toContain("Detter 上下文包");
  });
});
