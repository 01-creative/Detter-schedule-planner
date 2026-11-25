import { describe, expect, it } from "vitest";
import { ContextPackSchema, dayKey } from "@detter/shared";
import type { ApiScope } from "@detter/shared";
import { call, createTestServer, setupUser, type TestServer } from "./helpers";

/**
 * 上下文包 + 导出验收（T12 §6、§7）：
 * - /context/pack 的 JSON 字段受 ContextPackSchema 约束，markdown 有固定版式；
 * - /export/json 是 detter-export-v1 信封，/export/markdown 可读，/export/ics 是合法日历；
 * - /capture 走同一套 NLP 落收件箱；
 * - 全部只读端点对 read scope 开放，写端点拒绝只读 Key。
 */

interface RawResponse {
  status: number;
  headers: Headers;
  text: string;
}

interface ExportEnvelope {
  format: string;
  exportedAt: number;
  exportedAtIso: string;
  version: string;
  profile: { displayName: string; timezone: string; quadrantScheme: string };
  cursor: number;
  counts: Record<string, number>;
  entities: Record<string, Array<Record<string, unknown>>>;
}

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

const LOCAL_NOW = new Date(2026, 10, 25, 10, 0, 0).getTime(); // 2026-11-25 10:00 本地时间

async function rawGet(
  server: TestServer,
  path: string,
  options: { cookie?: string; bearer?: string } = {},
): Promise<RawResponse> {
  const headers: Record<string, string> = {};
  if (options.cookie) headers.cookie = options.cookie;
  if (options.bearer) headers.authorization = `Bearer ${options.bearer}`;
  const response = await server.app.request(path, { headers });
  return { status: response.status, headers: response.headers, text: await response.text() };
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

async function seedTask(
  server: TestServer,
  cookie: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const created = await call<Record<string, unknown>>(server, "POST", "/api/v1/tasks", { cookie, body });
  expect(created.status).toBe(201);
  const data = created.body.data;
  if (!data) throw new Error("创建任务失败");
  return data;
}

describe("上下文包", () => {
  it("GET /context/pack?range=today 返回符合 ContextPackSchema 的 JSON", async () => {
    const server = await createTestServer({ now: () => LOCAL_NOW });
    const cookie = await setupUser(server);
    await seedTask(server, cookie, {
      title: "今天的任务",
      quadrant: 2,
      startAt: LOCAL_NOW,
      dueAt: LOCAL_NOW + 3_600_000,
    });

    const response = await call<unknown>(server, "GET", "/api/v1/context/pack?range=today&format=json", { cookie });
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);

    const pack = ContextPackSchema.parse(response.body.data);
    expect(pack.range).toBe("today");
    expect(pack.generatedAt).toBe(LOCAL_NOW);
    expect(pack.period.label).toBe("2026-11-25");
    expect(pack.period.start).toBeLessThanOrEqual(pack.period.end);
    expect(pack.profile).toMatchObject({ timezone: "Asia/Shanghai", quadrantScheme: "eisenhower" });
    expect(pack.tasks).toHaveLength(1);
    expect(pack.tasks[0]).toMatchObject({ title: "今天的任务", quadrant: 2, status: "todo" });
    expect(pack.briefing.length).toBeGreaterThan(10);
    expect(pack.briefing).toContain("今天");
    expect(typeof pack.stats.tasksInRange).toBe("number");
    expect(pack.stats).toMatchObject({ tasksInRange: 1, overdue: 0, q2: 1 });
    expect(pack.pomodoro).toEqual({ sessions: 0, focusMinutes: 0 });
  });

  it("上下文包聚合 OKR / KPI / 番茄钟（不靠前端也能算）", async () => {
    const server = await createTestServer({ now: () => LOCAL_NOW });
    const cookie = await setupUser(server);

    const okr = await call<{ id: string }>(server, "POST", "/api/v1/okrs", {
      cookie,
      body: {
        title: "本周主线：把高数补上",
        period: "week",
        periodStart: "2026-11-23",
        periodEnd: "2026-11-29",
        status: "active",
      },
    });
    expect(okr.status).toBe(201);

    const kr = await call(server, "POST", "/api/v1/key-results", {
      cookie,
      body: {
        okrId: okr.body.data?.id,
        title: "完成 3 章复习",
        metricType: "number",
        startValue: 0,
        targetValue: 3,
        currentValue: 1,
        unit: "章",
      },
    });
    expect(kr.status).toBe(201);

    const kpi = await call(server, "POST", "/api/v1/kpis", {
      cookie,
      body: {
        name: "深度工作时长",
        unit: "分钟",
        period: "week",
        aggregation: "sum",
        targetValue: 900,
        autoSource: "pomodoro_min",
      },
    });
    expect(kpi.status).toBe(201);

    const pomodoro = await call(server, "POST", "/api/v1/pomodoro-sessions", {
      cookie,
      body: {
        kind: "focus",
        startedAt: LOCAL_NOW - 2 * 3_600_000,
        endedAt: LOCAL_NOW - 3_600_000,
        planMin: 60,
        actualMin: 55,
        completed: true,
      },
    });
    expect(pomodoro.status).toBe(201);

    const response = await call<unknown>(server, "GET", "/api/v1/context/pack?range=week", { cookie });
    const pack = ContextPackSchema.parse(response.body.data);

    const okrViews = pack.okr as Array<{ objective: string; krs: Array<Record<string, unknown>> }>;
    expect(okrViews).toHaveLength(1);
    expect(okrViews[0]?.objective).toBe("本周主线：把高数补上");
    expect(okrViews[0]?.krs[0]).toMatchObject({ title: "完成 3 章复习", current: 1, target: 3, unit: "章" });

    const kpiViews = pack.kpis as Array<Record<string, unknown>>;
    expect(kpiViews[0]).toMatchObject({ name: "深度工作时长", value: 55, target: 900, unit: "分钟" });
    expect(kpiViews[0]?.rate).toBeCloseTo(0.06, 2);
    expect(pack.pomodoro).toEqual({ sessions: 1, focusMinutes: 55 });
    expect(pack.stats.focusMinutes).toBe(55);
    expect(pack.stats.kpisActive).toBe(1);
  });

  it("GET /context/pack?format=markdown 输出可粘贴的固定版式", async () => {
    const server = await createTestServer({ now: () => LOCAL_NOW });
    const cookie = await setupUser(server);
    await seedTask(server, cookie, { title: "交高数作业", quadrant: 2, startAt: LOCAL_NOW + 5 * 3_600_000 });

    const response = await rawGet(server, "/api/v1/context/pack?range=week&format=markdown", { cookie });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(response.text).toContain("# Detter 周报 · 2026-11-23 ~ 2026-11-29");
    expect(response.text).toContain("## 一句话总结");
    expect(response.text).toContain("## 四象限分布");
    expect(response.text).toContain("Q2 重要不紧急：1 项");
    expect(response.text).toContain("## 待办清单");
    expect(response.text).toContain("- [ ] 交高数作业（今天 15:00）");
    expect(response.text).toContain("## 你可以这样帮我");
    expect(response.text).toContain("1. 指出今天最该做的三件事");
  });

  it("range 非法返回 validation_error（不静默兜底）", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server);

    const response = await call(server, "GET", "/api/v1/context/pack?range=year", { cookie });
    expect(response.status).toBe(400);
    const body = response.body as unknown as ApiEnvelope<unknown>;
    expect(body.error?.code).toBe("validation_error");
    expect(JSON.stringify(body.error?.details)).toContain("today");
  });

  it("read scope 的 API Key 可以读取上下文包与导出", async () => {
    const server = await createTestServer({ now: () => LOCAL_NOW });
    const cookie = await setupUser(server);
    const key = await createKey(server, cookie, { name: "只读 Agent", scopes: ["read"] });
    await seedTask(server, cookie, { title: "只读可见", startAt: LOCAL_NOW });

    const pack = await rawGet(server, "/api/v1/context/pack?range=today", { bearer: key.plaintext });
    expect(pack.status).toBe(200);

    const exported = await rawGet(server, "/api/v1/export/json", { bearer: key.plaintext });
    expect(exported.status).toBe(200);
  });
});

describe("快速捕获（REST）", () => {
  it("POST /capture 解析文本并落收件箱，返回 draft 与 suggestions", async () => {
    const server = await createTestServer({ now: () => LOCAL_NOW });
    const cookie = await setupUser(server);

    const goal = await call(server, "POST", "/api/v1/goals", { cookie, body: { title: "高数不挂科" } });
    expect(goal.status).toBe(201);

    const captured = await call<{
      inboxId: string;
      draft: { title: string; tags: string[]; startAt: number | null; quadrantGuess: number };
      suggestions: Array<{ goalId: string; goalTitle: string; score: number }>;
    }>(server, "POST", "/api/v1/capture", {
      cookie,
      body: { text: "明天下午3点 交高数作业 #作业" },
    });
    expect(captured.status).toBe(201);
    const data = captured.body.data;
    expect(data?.inboxId).toBeTypeOf("string");
    expect(data?.draft.title).toBe("交高数作业");
    expect(data?.draft.tags).toEqual(["作业"]);
    expect(data?.draft.startAt).toBe(new Date(2026, 10, 26, 15, 0, 0).getTime());
    // 「高数」与目标标题「高数不挂科」二元组有交集，应给出一条建议
    expect(data?.suggestions.length).toBeGreaterThan(0);
    expect(data?.suggestions[0]?.goalTitle).toBe("高数不挂科");

    const inbox = await call<{ items: Array<Record<string, unknown>> }>(server, "GET", "/api/v1/inbox?status=pending", {
      cookie,
    });
    expect(inbox.body.data?.items).toHaveLength(1);
    expect(inbox.body.data?.items[0]).toMatchObject({
      id: data?.inboxId,
      rawText: "明天下午3点 交高数作业 #作业",
      source: "manual",
      status: "pending",
    });
  });

  it("只读 Key 不能 /capture（403 scope_insufficient），匿名 401", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server);
    const key = await createKey(server, cookie, { name: "只读 Agent", scopes: ["read"] });

    const forbidden = await call(server, "POST", "/api/v1/capture", {
      headers: { authorization: `Bearer ${key.plaintext}` },
      body: { text: "明天 交作业" },
    });
    expect(forbidden.status).toBe(403);
    expect((forbidden.body as unknown as ApiEnvelope<unknown>).error?.code).toBe("scope_insufficient");

    const anonymous = await call(server, "POST", "/api/v1/capture", { body: { text: "明天 交作业" } });
    expect(anonymous.status).toBe(401);
  });
});

describe("导出", () => {
  it("GET /export/json 是 detter-export-v1 信封，带 Content-Disposition", async () => {
    const server = await createTestServer({ now: () => LOCAL_NOW });
    const cookie = await setupUser(server);
    const task = await seedTask(server, cookie, { title: "导出任务", quadrant: 1, dueAt: LOCAL_NOW });

    const response = await rawGet(server, "/api/v1/export/json", { cookie });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="detter-${dayKey(LOCAL_NOW)}.json"`,
    );

    const body = JSON.parse(response.text) as ExportEnvelope;
    expect(body.format).toBe("detter-export-v1");
    expect(body.version).toBeTypeOf("string");
    expect(body.exportedAt).toBe(LOCAL_NOW);
    expect(body.profile.timezone).toBe("Asia/Shanghai");
    expect(body.counts.task).toBe(1);
    expect(body.entities.task).toHaveLength(1);
    const exportedTask = body.entities.task?.[0];
    expect(exportedTask).toMatchObject({ id: task.id, title: "导出任务" });
    // 全量导出必须覆盖所有可同步实体
    for (const entity of ["task", "goal", "inbox", "okr", "kr", "kpi", "kpiEntry", "pomodoro", "mindMap", "mindNode", "setting"]) {
      expect(body.entities).toHaveProperty(entity);
    }
  });

  it("GET /export/json 未登录返回 401", async () => {
    const server = await createTestServer();
    const response = await rawGet(server, "/api/v1/export/json");
    expect(response.status).toBe(401);
  });

  it("GET /export/markdown 输出人类可读周报（attachment）", async () => {
    const server = await createTestServer({ now: () => LOCAL_NOW });
    const cookie = await setupUser(server);
    await seedTask(server, cookie, { title: "本周重点", quadrant: 2, startAt: LOCAL_NOW });

    const response = await rawGet(server, "/api/v1/export/markdown", { cookie });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="detter-${dayKey(LOCAL_NOW)}.md"`,
    );
    expect(response.text).toContain("# Detter 周报");
    expect(response.text).toContain("本周重点");
    expect(response.text).toContain("## 一句话总结");
  });

  it("GET /export/ics 是合法日历：CRLF、VCALENDAR、VEVENT、UID、RRULE", async () => {
    const server = await createTestServer({ now: () => LOCAL_NOW });
    const cookie = await setupUser(server);
    const startAt = new Date(2026, 10, 25, 15, 0, 0).getTime();
    await seedTask(server, cookie, {
      title: "每周复习,线代;第1章",
      startAt,
      endAt: startAt + 3_600_000,
      rrule: "FREQ=WEEKLY;BYDAY=MO",
    });

    const response = await rawGet(server, "/api/v1/export/ics", { cookie });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/calendar");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="detter-${dayKey(LOCAL_NOW)}.ics"`,
    );

    const text = response.text;
    expect(text.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(text).toContain("VERSION:2.0");
    expect(text).toContain("BEGIN:VEVENT");
    expect(text).toContain("DTSTART:20261125T070000Z");
    expect(text).toContain("DTEND:20261125T080000Z");
    expect(text).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO");
    expect(text).toMatch(/UID:[^\r\n]+@detter/);
    expect(text).toContain("SUMMARY:每周复习\\,线代\\;第1章");

    // RFC5545：每行不超过 75 个八位组
    for (const line of text.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it("ICS 跳过已完成任务，并给只有截止时间的任务加「截止：」前缀", async () => {
    const server = await createTestServer({ now: () => LOCAL_NOW });
    const cookie = await setupUser(server);
    await seedTask(server, cookie, { title: "已完成事项", status: "done", completedAt: LOCAL_NOW });
    await seedTask(server, cookie, { title: "交材料", dueAt: LOCAL_NOW + 3_600_000 });

    const response = await rawGet(server, "/api/v1/export/ics", { cookie });
    expect(response.status).toBe(200);
    expect(response.text).not.toContain("已完成事项");
    expect(response.text).toContain("SUMMARY:截止：交材料");
    expect(response.text.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  it("空数据也导出合法的空日历", async () => {
    const server = await createTestServer({ now: () => LOCAL_NOW });
    const cookie = await setupUser(server);

    const response = await rawGet(server, "/api/v1/export/ics", { cookie });
    expect(response.status).toBe(200);
    expect(response.text).toContain("BEGIN:VCALENDAR");
    expect(response.text).not.toContain("BEGIN:VEVENT");
  });
});
