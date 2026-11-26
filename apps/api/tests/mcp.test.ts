import { describe, expect, it } from "vitest";
import { ContextPackSchema, MCP_TOOLS } from "@detter/shared";
import type { ApiScope } from "@detter/shared";
import { call, createTestServer, setupUser, type TestServer } from "./helpers";

/**
 * MCP 验收（T12 §7）：
 * - 协议：initialize / tools/list(19 个) / tools/call / ping / 错误码；
 * - 权限：Bearer-only、read 不能写、写操作进 audit_log；
 * - 语义：create_task 真的落库、get_agenda 只给当天、get_context_pack 符合契约。
 *
 * 客户端用法与真实 MCP 客户端一致：HTTP POST + JSON-RPC body。
 */

interface RpcEnvelope {
  jsonrpc?: string;
  id?: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

interface ToolListResult {
  tools: Array<{
    name: string;
    description: string;
    inputSchema: { type: string; properties: Record<string, unknown>; required?: string[] };
  }>;
}

interface ToolCallResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

async function rpc(
  server: TestServer,
  key: string | null,
  body: unknown,
  options: { cookie?: string } = {},
): Promise<{ status: number; json: RpcEnvelope; headers: Headers }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    // 真实 MCP 客户端不带 Cookie；这里显式带上 CSRF 头是为了让 Cookie 请求穿过 CSRF 层，
    // 从而验证 MCP 自己的「只认 Bearer」规则（而不是被 CSRF 提前挡掉）。
    "x-detter-csrf": "1",
  };
  if (key) headers.authorization = `Bearer ${key}`;
  if (options.cookie) headers.cookie = options.cookie;

  const response = await server.app.request("/api/v1/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    json: (text.length > 0 ? JSON.parse(text) : {}) as RpcEnvelope,
    headers: response.headers,
  };
}

function toolData(envelope: RpcEnvelope): unknown {
  const result = envelope.result as ToolCallResult | undefined;
  const text = result?.content?.[0]?.text;
  if (typeof text !== "string") throw new Error(`MCP 结果缺少 text content：${JSON.stringify(envelope)}`);
  return JSON.parse(text) as unknown;
}

async function createKey(
  server: TestServer,
  cookie: string,
  input: { name: string; scopes: ApiScope[] },
): Promise<{ id: string; prefix: string; plaintext: string }> {
  const created = await call<{ id: string; prefix: string; plaintext: string }>(
    server,
    "POST",
    "/api/v1/api-keys",
    { cookie, body: input },
  );
  expect(created.status).toBe(201);
  const data = created.body.data;
  if (!data) throw new Error(`创建 API Key 失败：${JSON.stringify(created.body)}`);
  return data;
}

const LOCAL_NOW = new Date(2026, 10, 25, 10, 0, 0).getTime(); // 2026-11-25 10:00 本地时间

describe("MCP server", () => {
  it("initialize 返回协议版本、tools 能力与 serverInfo", async () => {
    const server = await createTestServer({ now: () => LOCAL_NOW });
    const cookie = await setupUser(server);
    const key = await createKey(server, cookie, { name: "claude-desktop", scopes: ["read", "write"] });

    const response = await rpc(server, key.plaintext, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "claude-desktop", version: "0.9.0" },
      },
    });
    expect(response.status).toBe(200);
    expect(response.json.jsonrpc).toBe("2.0");
    expect(response.json.id).toBe(1);
    const result = response.json.result as {
      protocolVersion: string;
      capabilities: { tools: Record<string, unknown> };
      serverInfo: { name: string; version: string };
      instructions?: string;
    };
    expect(result.protocolVersion).toBe("2025-06-18");
    expect(result.capabilities.tools).toEqual({});
    expect(result.serverInfo.name).toBe("detter");
    expect(result.serverInfo.version).toBeTypeOf("string");
    expect(result.instructions).toContain("毫秒时间戳");

    // 客户端随后发的 initialized 通知：202 且无响应体
    const notification = await rpc(server, key.plaintext, { jsonrpc: "2.0", method: "notifications/initialized" });
    expect(notification.status).toBe(202);
    expect(notification.json).toEqual({});
  });

  it("ping 返回空结果", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server);
    const key = await createKey(server, cookie, { name: "ping", scopes: ["read"] });

    const response = await rpc(server, key.plaintext, { jsonrpc: "2.0", id: "p1", method: "ping" });
    expect(response.status).toBe(200);
    expect(response.json.id).toBe("p1");
    expect(response.json.result).toEqual({});
  });

  it("tools/list 返回与契约一致的 19 个工具，每个都有 description 与合法 inputSchema", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server);
    const key = await createKey(server, cookie, { name: "cursor", scopes: ["read", "write"] });

    const response = await rpc(server, key.plaintext, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(response.status).toBe(200);
    const tools = (response.json.result as ToolListResult).tools;
    expect(tools).toHaveLength(26);
    expect(tools.map((tool) => tool.name)).toEqual([...MCP_TOOLS]);

    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema.type).toBe("object");
      expect(Object.keys(tool.inputSchema.properties).length).toBeGreaterThan(0);
    }

    const createTask = tools.find((tool) => tool.name === "create_task");
    expect(createTask?.inputSchema.required).toEqual(["title"]);
    const quadrant = createTask?.inputSchema.properties.quadrant as { type: string; minimum: number; maximum: number };
    expect(quadrant).toMatchObject({ type: "integer", minimum: 1, maximum: 4 });
    expect(createTask?.description).toContain("毫秒时间戳");
    expect(createTask?.description).toContain("Q2");
  });

  it("tools/call create_task 真的建出任务（并可在 REST 里读到）", async () => {
    const server = await createTestServer({ now: () => LOCAL_NOW });
    const cookie = await setupUser(server);
    const key = await createKey(server, cookie, { name: "claude-desktop", scopes: ["read", "write"] });
    const dueAt = LOCAL_NOW + 3 * 3_600_000;

    const response = await rpc(server, key.plaintext, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "create_task",
        arguments: { title: "交高数作业", quadrant: 1, dueAt, tags: ["作业"] },
      },
    });
    expect(response.status).toBe(200);
    expect(response.json.error).toBeUndefined();

    const task = toolData(response.json) as Record<string, unknown>;
    expect(task).toMatchObject({
      title: "交高数作业",
      quadrant: 1,
      dueAt,
      tags: ["作业"],
      source: "ai",
      status: "todo",
      deletedAt: null,
    });
    expect(task.id).toBeTypeOf("string");

    // 与浏览器/同步看到的是同一条数据
    const listed = await call<{ items: Array<Record<string, unknown>> }>(server, "GET", "/api/v1/tasks", {
      headers: { authorization: `Bearer ${key.plaintext}` },
    });
    expect(listed.status).toBe(200);
    expect(listed.body.data?.items.map((item) => item.title)).toEqual(["交高数作业"]);
  });

  it("read scope 的 Key 能读不能写（写返回 -32000，且不落库）", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server);
    const key = await createKey(server, cookie, { name: "只读 Agent", scopes: ["read"] });

    const blocked = await rpc(server, key.plaintext, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "create_task", arguments: { title: "越权写入" } },
    });
    expect(blocked.json.error?.code).toBe(-32000);
    expect(blocked.json.error?.message).toContain("write");

    const read = await rpc(server, key.plaintext, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "list_tasks", arguments: {} },
    });
    expect(read.json.error).toBeUndefined();
    expect((toolData(read.json) as { items: unknown[] }).items).toHaveLength(0);

    const all = await call<{ items: unknown[] }>(server, "GET", "/api/v1/tasks", { cookie });
    expect(all.body.data?.items).toHaveLength(0);
  });

  it("未知方法与未知工具分别返回 -32601 / -32602", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server);
    const key = await createKey(server, cookie, { name: "cursor", scopes: ["read", "write"] });

    const unknownMethod = await rpc(server, key.plaintext, { jsonrpc: "2.0", id: 6, method: "resources/list" });
    expect(unknownMethod.json.error?.code).toBe(-32601);
    expect(unknownMethod.json.error?.message).toContain("未知方法");

    const unknownTool = await rpc(server, key.plaintext, {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "create_super_task", arguments: {} },
    });
    expect(unknownTool.json.error?.code).toBe(-32602);
    expect(unknownTool.json.error?.message).toContain("未知工具");
  });

  it("非法参数返回 -32602（缺 title / 参数类型错）", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server);
    const key = await createKey(server, cookie, { name: "cursor", scopes: ["read", "write"] });

    const missing = await rpc(server, key.plaintext, {
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "create_task", arguments: {} },
    });
    expect(missing.json.error?.code).toBe(-32602);
    expect(missing.json.error?.message).toContain("title");

    const wrongType = await rpc(server, key.plaintext, {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "create_task", arguments: { title: "类型错误", quadrant: "urgent" } },
    });
    expect(wrongType.json.error?.code).toBe(-32602);

    // 不合法参数不会产生半条数据
    const all = await call<{ items: unknown[] }>(server, "GET", "/api/v1/tasks", { cookie });
    expect(all.body.data?.items).toHaveLength(0);
  });

  it("MCP 只认 Bearer API Key；Cookie 会话和匿名请求都被拒绝", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server);

    const withCookie = await rpc(server, null, { jsonrpc: "2.0", id: 10, method: "tools/list" }, { cookie });
    expect(withCookie.status).toBe(401);
    expect(withCookie.json.error?.message).toContain("API Key");

    const anonymous = await rpc(server, null, { jsonrpc: "2.0", id: 11, method: "tools/list" });
    expect(anonymous.status).toBe(401);
  });

  it("写操作落 audit_log（actor=apikey:<prefix>），读操作不落", async () => {
    const server = await createTestServer({ now: () => LOCAL_NOW });
    const cookie = await setupUser(server);
    const key = await createKey(server, cookie, { name: "claude-desktop", scopes: ["read", "write"] });

    await rpc(server, key.plaintext, {
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: { name: "create_task", arguments: { title: "审计用任务", quadrant: 2 } },
    });
    await rpc(server, key.plaintext, {
      jsonrpc: "2.0",
      id: 13,
      method: "tools/call",
      params: { name: "list_tasks", arguments: {} },
    });

    const rows = await server.db.all<{
      actor: string;
      action: string;
      entity: string;
      entity_id: string;
      ip: string;
      meta: string;
    }>("SELECT actor, action, entity, entity_id, ip, meta FROM audit_log ORDER BY at ASC");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe(`apikey:${key.prefix}`);
    expect(rows[0]?.action).toBe("mcp.create_task");
    expect(rows[0]?.entity).toBe("task");
    expect(rows[0]?.entity_id).toBeTypeOf("string");
    const meta = JSON.parse(rows[0]?.meta ?? "{}") as Record<string, unknown>;
    expect(meta.tool).toBe("create_task");
    expect(meta.title).toBe("审计用任务");

    // lastUsedAt 被刷新（设置页能看到「最后使用」）
    const keys = await call<{ items: Array<{ id: string; lastUsedAt: number | null }> }>(
      server,
      "GET",
      "/api/v1/api-keys",
      { cookie },
    );
    expect(keys.body.data?.items.find((item) => item.id === key.id)?.lastUsedAt).toBe(LOCAL_NOW);
  });

  it("get_agenda 只返回指定日期的任务（默认今天）", async () => {
    const server = await createTestServer({ now: () => LOCAL_NOW });
    const cookie = await setupUser(server);
    const key = await createKey(server, cookie, { name: "cursor", scopes: ["read", "write"] });

    const todayAt = new Date(2026, 10, 25, 15, 0, 0).getTime();
    const tomorrowAt = new Date(2026, 10, 26, 9, 0, 0).getTime();
    await call(server, "POST", "/api/v1/tasks", { cookie, body: { title: "今天开会", startAt: todayAt } });
    await call(server, "POST", "/api/v1/tasks", { cookie, body: { title: "明天上课", startAt: tomorrowAt } });

    const agenda = await rpc(server, key.plaintext, {
      jsonrpc: "2.0",
      id: 14,
      method: "tools/call",
      params: { name: "get_agenda", arguments: {} },
    });
    const data = toolData(agenda.json) as { date: string; items: Array<{ title: string }> };
    expect(data.date).toBe("2026-11-25");
    expect(data.items.map((item) => item.title)).toEqual(["今天开会"]);

    // 显式传明天
    const nextDay = await rpc(server, key.plaintext, {
      jsonrpc: "2.0",
      id: 15,
      method: "tools/call",
      params: { name: "get_agenda", arguments: { date: "2026-11-26" } },
    });
    expect((toolData(nextDay.json) as { items: Array<{ title: string }> }).items.map((item) => item.title)).toEqual([
      "明天上课",
    ]);
  });

  it("get_context_pack 工具返回符合 ContextPackSchema 的数据", async () => {
    const server = await createTestServer({ now: () => LOCAL_NOW });
    const cookie = await setupUser(server);
    const key = await createKey(server, cookie, { name: "claude-desktop", scopes: ["read", "write"] });

    await call(server, "POST", "/api/v1/tasks", {
      cookie,
      body: { title: "写周报", quadrant: 2, startAt: LOCAL_NOW },
    });

    const response = await rpc(server, key.plaintext, {
      jsonrpc: "2.0",
      id: 16,
      method: "tools/call",
      params: { name: "get_context_pack", arguments: { range: "week" } },
    });
    const pack = ContextPackSchema.parse(toolData(response.json));
    expect(pack.range).toBe("week");
    expect(pack.period.start).toBeLessThanOrEqual(pack.period.end);
    expect(pack.profile.timezone).toBe("Asia/Shanghai");
    expect(pack.tasks).toHaveLength(1);
    expect(pack.briefing).toContain("项待办");
    expect(pack.stats.tasksInRange).toBe(1);
  });

  it("get_okr 工具把 OKR 与 KR 一起返回", async () => {
    const server = await createTestServer({ now: () => LOCAL_NOW });
    const cookie = await setupUser(server);
    const key = await createKey(server, cookie, { name: "claude-desktop", scopes: ["read", "write"] });

    const okr = await call<{ id: string }>(server, "POST", "/api/v1/okrs", {
      cookie,
      body: {
        title: "本周主线",
        period: "week",
        periodStart: "2026-11-23",
        periodEnd: "2026-11-29",
        status: "active",
      },
    });
    expect(okr.status).toBe(201);
    const kr = await call(server, "POST", "/api/v1/key-results", {
      cookie,
      body: { okrId: okr.body.data?.id, title: "完成 3 章复习", targetValue: 3, currentValue: 1, unit: "章" },
    });
    expect(kr.status).toBe(201);

    const response = await rpc(server, key.plaintext, {
      jsonrpc: "2.0",
      id: 21,
      method: "tools/call",
      params: { name: "get_okr", arguments: {} },
    });
    expect(response.json.error).toBeUndefined();
    const data = toolData(response.json) as {
      objectives: Array<{ objective: string; krs: Array<Record<string, unknown>> }>;
    };
    expect(data.objectives).toHaveLength(1);
    expect(data.objectives[0]?.objective).toBe("本周主线");
    expect(data.objectives[0]?.krs[0]).toMatchObject({ title: "完成 3 章复习", currentValue: 1, targetValue: 3 });
  });

  it("capture → triage_inbox 能把一句话变成任务（agent 的一次完整操作）", async () => {
    const server = await createTestServer({ now: () => LOCAL_NOW });
    const cookie = await setupUser(server);
    const key = await createKey(server, cookie, { name: "claude-desktop", scopes: ["read", "write"] });

    const captured = await rpc(server, key.plaintext, {
      jsonrpc: "2.0",
      id: 17,
      method: "tools/call",
      params: { name: "capture", arguments: { text: "明天下午3点 交高数作业 #作业" } },
    });
    const captureData = toolData(captured.json) as {
      inboxId: string;
      draft: { title: string; tags: string[]; startAt: number | null };
      suggestions: unknown[];
    };
    expect(captureData.inboxId).toBeTypeOf("string");
    expect(captureData.draft.title).toBe("交高数作业");
    expect(captureData.draft.tags).toEqual(["作业"]);
    expect(captureData.draft.startAt).toBe(new Date(2026, 10, 26, 15, 0, 0).getTime());
    expect(Array.isArray(captureData.suggestions)).toBe(true);

    const triaged = await rpc(server, key.plaintext, {
      jsonrpc: "2.0",
      id: 18,
      method: "tools/call",
      params: { name: "triage_inbox", arguments: { id: captureData.inboxId, patch: { quadrant: 1 } } },
    });
    expect(triaged.json.error).toBeUndefined();
    const triagedData = toolData(triaged.json) as {
      inboxId: string;
      task: Record<string, unknown>;
    };
    expect(triagedData.task).toMatchObject({ title: "交高数作业", quadrant: 1, source: "capture" });
    expect(triagedData.task.startAt).toBe(new Date(2026, 10, 26, 15, 0, 0).getTime());

    const inbox = await call<{ items: Array<Record<string, unknown>> }>(server, "GET", "/api/v1/inbox?status=pending", {
      headers: { authorization: `Bearer ${key.plaintext}` },
    });
    expect(inbox.body.data?.items).toHaveLength(0);

    const triagedInbox = await call<{ items: Array<Record<string, unknown>> }>(
      server,
      "GET",
      "/api/v1/inbox?status=triaged",
      { headers: { authorization: `Bearer ${key.plaintext}` } },
    );
    expect(triagedInbox.body.data?.items[0]).toMatchObject({
      id: captureData.inboxId,
      status: "triaged",
      taskId: triagedData.task.id,
    });
  });

  it("complete_task / delete_task 改变状态并留下审计", async () => {
    const server = await createTestServer({ now: () => LOCAL_NOW });
    const cookie = await setupUser(server);
    const key = await createKey(server, cookie, { name: "cursor", scopes: ["read", "write"] });

    const created = await call<Record<string, unknown>>(server, "POST", "/api/v1/tasks", {
      cookie,
      body: { title: "可完成任务" },
    });
    const id = String(created.body.data?.id);

    const completed = await rpc(server, key.plaintext, {
      jsonrpc: "2.0",
      id: 19,
      method: "tools/call",
      params: { name: "complete_task", arguments: { id } },
    });
    const completedTask = toolData(completed.json) as Record<string, unknown>;
    expect(completedTask.status).toBe("done");
    expect(completedTask.completedAt).toBe(LOCAL_NOW);

    const deleted = await rpc(server, key.plaintext, {
      jsonrpc: "2.0",
      id: 20,
      method: "tools/call",
      params: { name: "delete_task", arguments: { id } },
    });
    expect(deleted.json.error).toBeUndefined();

    const audit = await server.db.all<{ action: string; entity_id: string }>(
      "SELECT action, entity_id FROM audit_log ORDER BY at ASC",
    );
    expect(audit.map((row) => row.action).sort()).toEqual(["mcp.complete_task", "mcp.delete_task"].sort());
    expect(audit.every((row) => row.entity_id === id)).toBe(true);
  });
});
