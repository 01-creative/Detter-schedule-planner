import { describe, expect, it } from "vitest";
import { MCP_TOOLS } from "@detter/shared";
import type { ApiScope } from "@detter/shared";
import { call, pullAll, pushOps, createTestServer, setupUser, type TestServer } from "./helpers";
import { runReminderTick } from "../src/services/reminders/schedule";
import { runHomeworkDigest } from "../src/services/courses/digest";

/**
 * 课程能力的验收（T15）：
 *
 * 1. 实体 / CRUD：三张新表的默认值、投影列过滤、软删除、/courses/summary 与 /courses/:id/plan；
 * 2. MCP：7 个课程工具的参数容错（20 / "20%"、2026-12-01 / ISO、课程名自动建课）与审计；
 * 3. 每周作业遗漏提醒：默认周日 20:00、幂等（一周最多一条）、runReminderTick 会顺带跑它。
 *
 * 时间统一用本地时区构造（new Date(y, m, d, ...)），与 shared 里的语义一致。
 */

const DAY = 86_400_000;
const SEMESTER_START = "2026-09-07"; // 周一
/** 2026-09-23（周三）——第 3 周 */
const WED_WEEK3 = new Date(2026, 8, 23, 12, 0, 0).getTime();
/** 2026-09-27（周日）20:30 —— 默认提醒时刻之后 */
const SUN_WEEK3_EVENING = new Date(2026, 8, 27, 20, 30, 0).getTime();

type Payload = Record<string, unknown>;

/* -------------------------------------------------------------------------- */
/*                                  MCP 客户端                                 */
/* -------------------------------------------------------------------------- */

interface RpcEnvelope {
  result?: { content?: Array<{ text?: string }> };
  error?: { code: number; message: string };
}

async function rpc(server: TestServer, key: string | null, body: unknown) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-detter-csrf": "1",
  };
  if (key) headers.authorization = `Bearer ${key}`;
  const response = await server.app.request("/api/v1/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: (text ? JSON.parse(text) : {}) as RpcEnvelope };
}

function toolData<T = Payload>(envelope: RpcEnvelope): T {
  const text = envelope.result?.content?.[0]?.text;
  if (typeof text !== "string") throw new Error(`缺少 MCP 文本结果：${JSON.stringify(envelope)}`);
  return JSON.parse(text) as T;
}

async function createKey(
  server: TestServer,
  cookie: string,
  scopes: ApiScope[] = ["read", "write"],
): Promise<string> {
  const created = await call<{ plaintext: string }>(server, "POST", "/api/v1/api-keys", {
    cookie,
    body: { name: "claude", scopes },
  });
  expect(created.status).toBe(201);
  return created.body.data?.plaintext as string;
}

function callTool(server: TestServer, key: string, name: string, args: Payload) {
  return rpc(server, key, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
}

/* -------------------------------------------------------------------------- */
/*                             实体 / CRUD 行为                                */
/* -------------------------------------------------------------------------- */

describe("课程实体与 CRUD", () => {
  it("创建课程：默认值齐全（archived=false、weeklyHomework=false、credits=null），并出现在列表里", async () => {
    const server = await createTestServer({ now: () => WED_WEEK3 });
    const cookie = await setupUser(server);

    const created = await call<Payload>(server, "POST", "/api/v1/courses", {
      cookie,
      body: { name: "英语", teacher: "王老师", credits: 3, semesterStart: SEMESTER_START },
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      name: "英语",
      code: "",
      teacher: "王老师",
      credits: 3,
      weeklyHomework: false,
      archived: false,
      note: "",
      goalId: null,
      semesterStart: SEMESTER_START,
      rev: 1,
    });

    const list = await call<{ items: Payload[] }>(server, "GET", "/api/v1/courses", { cookie });
    expect(list.body.data?.items.map((item) => item.name)).toEqual(["英语"]);

    // 投影列确实写进了表（不是只在 payload 里）
    const row = await server.db.first<{ archived: number; goal_id: string | null }>(
      "SELECT archived, goal_id FROM courses WHERE id = ?",
      [String(created.body.data?.id)],
    );
    expect(row).toEqual({ archived: 0, goal_id: null });
  });

  it("归档后默认列表不返回；?archived=true 只看归档；includeArchived 看全部", async () => {
    const server = await createTestServer({ now: () => WED_WEEK3 });
    const cookie = await setupUser(server);

    const course = await call<Payload>(server, "POST", "/api/v1/courses", {
      cookie,
      body: { name: "旧课" },
    });
    const patched = await call(server, "PATCH", `/api/v1/courses/${String(course.body.data?.id)}`, {
      cookie,
      body: { archived: true },
    });
    expect(patched.status).toBe(200);

    const alive = await call<{ items: Payload[] }>(server, "GET", "/api/v1/courses", { cookie });
    expect(alive.body.data?.items).toHaveLength(0);
    const archived = await call<{ items: Payload[] }>(server, "GET", "/api/v1/courses?archived=true", {
      cookie,
    });
    expect(archived.body.data?.items.map((item) => item.name)).toEqual(["旧课"]);
    const all = await call<{ items: Payload[] }>(server, "GET", "/api/v1/courses?includeArchived=true", {
      cookie,
    });
    expect(all.body.data?.items).toHaveLength(1);
  });

  it("考核项权重越界（120 / -5）返回 validation_error", async () => {
    const server = await createTestServer({ now: () => WED_WEEK3 });
    const cookie = await setupUser(server);
    const course = await call<Payload>(server, "POST", "/api/v1/courses", { cookie, body: { name: "英语" } });
    const courseId = String(course.body.data?.id);

    const tooMuch = await call(server, "POST", "/api/v1/assessments", {
      cookie,
      body: { courseId, title: "期末", weight: 120 },
    });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error?.code).toBe("validation_error");

    const negative = await call(server, "POST", "/api/v1/assessments", {
      cookie,
      body: { courseId, title: "期末", weight: -5 },
    });
    expect(negative.status).toBe(400);
  });

  it("考核项过滤：courseId + kind + status", async () => {
    const server = await createTestServer({ now: () => WED_WEEK3 });
    const cookie = await setupUser(server);
    const english = await call<Payload>(server, "POST", "/api/v1/courses", { cookie, body: { name: "英语" } });
    const math = await call<Payload>(server, "POST", "/api/v1/courses", { cookie, body: { name: "数学" } });

    const seeds = [
      { courseId: String(english.body.data?.id), title: "大作业", kind: "project", weight: 30 },
      { courseId: String(english.body.data?.id), title: "期中", kind: "exam", weight: 20, status: "graded" },
      { courseId: String(math.body.data?.id), title: "小测", kind: "quiz", weight: 10 },
    ];
    for (const seed of seeds) {
      const created = await call(server, "POST", "/api/v1/assessments", { cookie, body: seed });
      expect(created.status).toBe(201);
    }

    const ofEnglish = await call<{ items: Payload[] }>(
      server,
      "GET",
      `/api/v1/assessments?courseId=${String(english.body.data?.id)}`,
      { cookie },
    );
    expect(ofEnglish.body.data?.items).toHaveLength(2);

    const exams = await call<{ items: Payload[] }>(server, "GET", "/api/v1/assessments?kind=exam", { cookie });
    expect(exams.body.data?.items.map((item) => item.title)).toEqual(["期中"]);

    const graded = await call<{ items: Payload[] }>(
      server,
      "GET",
      "/api/v1/assessments?status=graded",
      { cookie },
    );
    expect(graded.body.data?.items).toHaveLength(1);

    const badKind = await call(server, "GET", "/api/v1/assessments?kind=final", { cookie });
    expect(badKind.status).toBe(400);
  });

  it("每周作业：weekNo 必填且 ≥1；可以按 courseId + weekNo 过滤", async () => {
    const server = await createTestServer({ now: () => WED_WEEK3 });
    const cookie = await setupUser(server);
    const course = await call<Payload>(server, "POST", "/api/v1/courses", { cookie, body: { name: "英语" } });
    const courseId = String(course.body.data?.id);

    const missingWeek = await call(server, "POST", "/api/v1/assignments", {
      cookie,
      body: { courseId, title: "缺周次" },
    });
    expect(missingWeek.status).toBe(400);

    for (const weekNo of [2, 3]) {
      const created = await call(server, "POST", "/api/v1/assignments", {
        cookie,
        body: { courseId, weekNo, title: `第 ${weekNo} 周作业` },
      });
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({ weekNo, status: "todo", taskId: null });
    }

    const week3 = await call<{ items: Payload[] }>(
      server,
      "GET",
      `/api/v1/assignments?courseId=${courseId}&weekNo=3`,
      { cookie },
    );
    expect(week3.body.data?.items.map((item) => item.title)).toEqual(["第 3 周作业"]);
  });

  it("软删除后列表不含、按 ID 读取 404", async () => {
    const server = await createTestServer({ now: () => WED_WEEK3 });
    const cookie = await setupUser(server);
    const course = await call<Payload>(server, "POST", "/api/v1/courses", { cookie, body: { name: "英语" } });
    const assessment = await call<Payload>(server, "POST", "/api/v1/assessments", {
      cookie,
      body: { courseId: String(course.body.data?.id), title: "期末", weight: 60 },
    });
    const id = String(assessment.body.data?.id);

    const removed = await call(server, "DELETE", `/api/v1/assessments/${id}`, { cookie });
    expect(removed.status).toBe(200);
    expect(removed.body.data).toMatchObject({ deletedAt: expect.any(Number) });

    const list = await call<{ items: Payload[] }>(server, "GET", "/api/v1/assessments", { cookie });
    expect(list.body.data?.items).toHaveLength(0);

    const got = await call(server, "GET", `/api/v1/assessments/${id}`, { cookie });
    expect(got.status).toBe(404);
  });

  it("/courses/summary：权重合计、本周作业状态、缺记标记", async () => {
    const server = await createTestServer({ now: () => WED_WEEK3 });
    const cookie = await setupUser(server);
    await call(server, "PUT", "/api/v1/settings", { cookie, body: { "courses.semesterStart": SEMESTER_START } });

    const english = await call<Payload>(server, "POST", "/api/v1/courses", {
      cookie,
      body: { name: "英语", weeklyHomework: true, credits: 3 },
    });
    const courseId = String(english.body.data?.id);
    await call(server, "POST", "/api/v1/assessments", { cookie, body: { courseId, title: "大作业", weight: 30 } });
    await call(server, "POST", "/api/v1/assessments", { cookie, body: { courseId, title: "考试", weight: 40 } });

    const summary = await call<{ items: Payload[]; missingHomework: number }>(
      server,
      "GET",
      "/api/v1/courses/summary",
      { cookie },
    );
    expect(summary.status).toBe(200);
    const item = summary.body.data?.items[0] as Payload;
    expect(item).toMatchObject({
      name: "英语",
      weekNo: 3,
      assessmentCount: 2,
      thisWeekAssignments: 0,
      homeworkMissing: true,
    });
    expect((item.weight as Payload).total).toBe(70);
    expect((item.weight as Payload).remaining).toBe(30);
    expect(summary.body.data?.missingHomework).toBe(1);

    // 记一条第 3 周的作业后不再缺
    await call(server, "POST", "/api/v1/assignments", {
      cookie,
      body: { courseId, weekNo: 3, title: "第 3 周作业" },
    });
    const after = await call<{ items: Payload[] }>(server, "GET", "/api/v1/courses/summary", { cookie });
    expect((after.body.data?.items[0] as Payload).homeworkMissing).toBe(false);
  });

  it("/courses/:id/plan 返回课程 + 考核项 + 作业", async () => {
    const server = await createTestServer({ now: () => WED_WEEK3 });
    const cookie = await setupUser(server);
    const course = await call<Payload>(server, "POST", "/api/v1/courses", { cookie, body: { name: "英语" } });
    const courseId = String(course.body.data?.id);
    await call(server, "POST", "/api/v1/assessments", { cookie, body: { courseId, title: "期末", weight: 60 } });
    await call(server, "POST", "/api/v1/assignments", { cookie, body: { courseId, weekNo: 1, title: "作业" } });

    const plan = await call<Payload>(server, "GET", `/api/v1/courses/${courseId}/plan`, { cookie });
    expect(plan.status).toBe(200);
    expect((plan.body.data?.course as Payload).name).toBe("英语");
    expect(plan.body.data?.assessments).toHaveLength(1);
    expect(plan.body.data?.assignments).toHaveLength(1);
  });

  it("新实体接进同步协议：push 课程后 pull 能拿到 change", async () => {
    const server = await createTestServer({ now: () => WED_WEEK3 });
    const cookie = await setupUser(server);
    const deviceId = "device-course-1";

    const pushed = await pushOps(server, cookie, deviceId, [
      {
        opId: "op-course-1",
        entity: "course",
        op: "upsert",
        id: "0199aaaa-bbbb-7ccc-8ddd-eeeeffff0001",
        baseRev: 0,
        at: WED_WEEK3,
        payload: {
          name: "操作系统",
          teacher: "李老师",
          weeklyHomework: true,
          createdAt: WED_WEEK3,
          updatedAt: WED_WEEK3,
        },
      },
    ]);
    expect(pushed.status).toBe(200);
    expect(pushed.body.data?.results[0]).toMatchObject({ status: "applied", rev: 1 });

    const changes = await pullAll(server, cookie);
    const courseChange = changes.find((change) => change.entity === "course");
    expect(courseChange).toBeTruthy();
    expect((courseChange?.payload as Payload).name).toBe("操作系统");
    expect((courseChange?.payload as Payload).weeklyHomework).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/*                                   MCP                                       */
/* -------------------------------------------------------------------------- */

describe("MCP 课程工具", () => {
  it("tools/list 包含 7 个课程工具，且顺序与 MCP_TOOLS 一致", async () => {
    const server = await createTestServer({ now: () => WED_WEEK3 });
    const cookie = await setupUser(server);
    const key = await createKey(server, cookie);

    const response = await rpc(server, key, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    const tools = (response.json as unknown as { result: { tools: Array<{ name: string }> } }).result.tools;
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual([...MCP_TOOLS]);
    for (const name of [
      "list_courses",
      "create_course",
      "update_course",
      "add_assessment",
      "add_assignment",
      "get_course_plan",
      "set_semester_start",
    ]) {
      expect(names).toContain(name);
    }
  });

  it("add_assessment：课程不存在时自动建课，并生成带课程前缀的 Task 与审计", async () => {
    const server = await createTestServer({ now: () => WED_WEEK3 });
    const cookie = await setupUser(server);
    const key = await createKey(server, cookie);

    const response = await callTool(server, key, "add_assessment", {
      course: "英语",
      title: "大作业",
      kind: "project",
      weight: 30,
      date: "2026-12-01",
      note: "PPT 第 12 页",
    });
    expect(response.status).toBe(200);
    const data = toolData<{ course: Payload; assessment: Payload; task: Payload }>(response.json);
    expect(data.course).toMatchObject({ name: "英语", created: true });
    expect(data.assessment).toMatchObject({ title: "大作业", kind: "project", weight: 30, status: "planned" });
    expect(data.task.title).toBe("[英语] 大作业");

    // 只写日期时按当天 23:59 处理
    const expectedDue = new Date(2026, 11, 1).getTime() + DAY - 1;
    expect(data.assessment.dueAt).toBe(expectedDue);

    const taskRow = await server.db.first<{ payload: string }>(
      "SELECT payload FROM tasks WHERE id = ?",
      [String(data.assessment.taskId)],
    );
    const task = JSON.parse(taskRow?.payload as string) as Payload;
    expect(task).toMatchObject({ title: "[英语] 大作业", dueAt: expectedDue, quadrant: 2 });
    expect((task.tags as string[]).some((tag) => tag.startsWith("course:"))).toBe(true);

    const audit = await server.db.first<{ action: string; actor: string }>(
      "SELECT action, actor FROM audit_log WHERE action = 'mcp.add_assessment'",
    );
    expect(audit?.actor).toMatch(/^apikey:/);
  });

  it('add_assessment：权重接受 "30%"，课程用 courseId 指定且不重复建课', async () => {
    const server = await createTestServer({ now: () => WED_WEEK3 });
    const cookie = await setupUser(server);
    const key = await createKey(server, cookie);

    const course = await call<Payload>(server, "POST", "/api/v1/courses", { cookie, body: { name: "数学" } });
    const courseId = String(course.body.data?.id);

    const first = await callTool(server, key, "add_assessment", {
      courseId,
      title: "期中考试",
      kind: "exam",
      weight: "30%",
      date: "2026-11-20T09:00:00+08:00",
    });
    const firstData = toolData<{ assessment: Payload }>(first.json);
    expect(firstData.assessment.weight).toBe(30);
    expect(firstData.assessment.dueAt).toBe(Date.parse("2026-11-20T09:00:00+08:00"));

    const second = await callTool(server, key, "add_assessment", {
      course: "数学",
      title: "小测",
      weight: 20,
    });
    const secondData = toolData<{ course: Payload }>(second.json);
    expect(secondData.course).toMatchObject({ id: courseId, created: false });

    const count = await server.db.first<{ count: number }>("SELECT COUNT(*) AS count FROM courses");
    expect(Number(count?.count)).toBe(1);
  });

  it("add_assignment：按课程名自动建课并标记 weeklyHomework，weekNo 与 date 都能定周", async () => {
    const server = await createTestServer({ now: () => WED_WEEK3 });
    const cookie = await setupUser(server);
    const key = await createKey(server, cookie);
    await call(server, "PUT", "/api/v1/settings", { cookie, body: { "courses.semesterStart": SEMESTER_START } });

    const byWeek = await callTool(server, key, "add_assignment", {
      course: "英语",
      title: "第 3 章习题",
      weekNo: 3,
      date: "2026-09-25",
    });
    const data = toolData<{ course: Payload; assignment: Payload; task: Payload }>(byWeek.json);
    expect(data.assignment).toMatchObject({ weekNo: 3, status: "todo" });
    expect(data.task.title).toBe("[英语] 第 3 章习题");
    expect(data.course.created).toBe(true);

    const courseRow = await server.db.first<{ payload: string }>(
      "SELECT payload FROM courses WHERE id = ?",
      [String(data.course.id)],
    );
    expect((JSON.parse(courseRow?.payload as string) as Payload).weeklyHomework).toBe(true);

    // 只给日期：按学期起点推算第几周（2026-09-25 是第 3 周周五）
    const byDate = await callTool(server, key, "add_assignment", {
      course: "英语",
      title: "听力打卡",
      date: "2026-09-25",
    });
    expect(toolData<{ assignment: Payload }>(byDate.json).assignment.weekNo).toBe(3);
  });

  it("get_course_plan：权重合计、按类型构成、缺记的周", async () => {
    const server = await createTestServer({ now: () => WED_WEEK3 });
    const cookie = await setupUser(server);
    const key = await createKey(server, cookie);
    await call(server, "PUT", "/api/v1/settings", { cookie, body: { "courses.semesterStart": SEMESTER_START } });

    const course = await call<Payload>(server, "POST", "/api/v1/courses", {
      cookie,
      body: { name: "英语", weeklyHomework: true },
    });
    const courseId = String(course.body.data?.id);
    await call(server, "POST", "/api/v1/assessments", { cookie, body: { courseId, title: "大作业", kind: "project", weight: 30 } });
    await call(server, "POST", "/api/v1/assessments", { cookie, body: { courseId, title: "期末", kind: "exam", weight: 50 } });
    await call(server, "POST", "/api/v1/assignments", { cookie, body: { courseId, weekNo: 2, title: "作业" } });

    const response = await callTool(server, key, "get_course_plan", { courseId });
    const plan = toolData<{ weight: Payload; assessments: Payload[]; missingWeeks: number[]; weekNo: number }>(
      response.json,
    );
    expect(plan.weekNo).toBe(3);
    expect(plan.assessments).toHaveLength(2);
    expect(plan.weight.total).toBe(80);
    expect(plan.weight.remaining).toBe(20);
    // 第 1、3 周都没记作业（第 2 周记了）
    expect(plan.missingWeeks).toEqual([1, 3]);
  });

  it("set_semester_start 写全局设置；add_assignment 不给周次时用当前周", async () => {
    const server = await createTestServer({ now: () => WED_WEEK3 });
    const cookie = await setupUser(server);
    const key = await createKey(server, cookie);

    const set = await callTool(server, key, "set_semester_start", { date: SEMESTER_START });
    expect(toolData<{ semesterStart: string; scope: string }>(set.json)).toMatchObject({
      semesterStart: SEMESTER_START,
      scope: "global",
    });

    const course = await call<Payload>(server, "POST", "/api/v1/courses", { cookie, body: { name: "英语" } });
    const assignment = await callTool(server, key, "add_assignment", {
      courseId: String(course.body.data?.id),
      title: "本周作业",
    });
    expect(toolData<{ assignment: Payload }>(assignment.json).assignment.weekNo).toBe(3);
  });

  it("create_course / update_course：建课后按课程名改字段", async () => {
    const server = await createTestServer({ now: () => WED_WEEK3 });
    const cookie = await setupUser(server);
    const key = await createKey(server, cookie);

    const created = await callTool(server, key, "create_course", {
      name: "计算机网络",
      teacher: "张老师",
      credits: 3.5,
      semesterStart: SEMESTER_START,
      weeklyHomework: true,
    });
    const course = toolData<Payload>(created.json);
    expect(course).toMatchObject({ name: "计算机网络", teacher: "张老师", credits: 3.5, weeklyHomework: true });

    const updated = await callTool(server, key, "update_course", {
      course: "计算机网络",
      teacher: "李老师",
      archived: true,
    });
    const patched = toolData<Payload>(updated.json);
    expect(patched).toMatchObject({ teacher: "李老师", archived: true, name: "计算机网络" });

    // 归档后 list_courses 默认不返回；includeArchived 才看得到
    const listed = await callTool(server, key, "list_courses", {});
    expect(toolData<{ items: Payload[] }>(listed.json).items).toHaveLength(0);
    const all = await callTool(server, key, "list_courses", { includeArchived: true });
    expect(toolData<{ items: Payload[] }>(all.json).items).toHaveLength(1);
  });

  it("list_courses 返回权重合计与本周缺记标记；只读 Key 不能写", async () => {
    const server = await createTestServer({ now: () => WED_WEEK3 });
    const cookie = await setupUser(server);
    const key = await createKey(server, cookie);
    const readKey = await createKey(server, cookie, ["read"]);
    await call(server, "PUT", "/api/v1/settings", { cookie, body: { "courses.semesterStart": SEMESTER_START } });

    const course = await call<Payload>(server, "POST", "/api/v1/courses", {
      cookie,
      body: { name: "英语", weeklyHomework: true },
    });
    await call(server, "POST", "/api/v1/assessments", {
      cookie,
      body: { courseId: String(course.body.data?.id), title: "期末", weight: 60 },
    });

    const listed = await callTool(server, key, "list_courses", {});
    const list = toolData<{ items: Payload[]; missingHomework: number }>(listed.json);
    expect(list.items[0]).toMatchObject({ name: "英语", weekNo: 3, homeworkMissing: true });
    expect((list.items[0]?.weight as Payload).total).toBe(60);
    expect(list.missingHomework).toBe(1);

    const denied = await callTool(server, readKey, "add_assessment", { course: "英语", title: "小测" });
    expect(denied.json.error?.message).toContain("write scope");
  });
});

/* -------------------------------------------------------------------------- */
/*                              每周作业遗漏提醒                                */
/* -------------------------------------------------------------------------- */

async function seedWeeklyCourse(server: TestServer, cookie: string): Promise<void> {
  await call(server, "PUT", "/api/v1/settings", { cookie, body: { "courses.semesterStart": SEMESTER_START } });
  const english = await call<Payload>(server, "POST", "/api/v1/courses", {
    cookie,
    body: { name: "英语", weeklyHomework: true },
  });
  await call(server, "POST", "/api/v1/courses", {
    cookie,
    body: { name: "体育", weeklyHomework: false },
  });
  await call(server, "POST", "/api/v1/assessments", {
    cookie,
    body: { courseId: String(english.body.data?.id), title: "期末", weight: 50 },
  });
}

describe("每周作业遗漏提醒", () => {
  it("force 触发一条应用内提醒；同周再跑不会重复", async () => {
    const server = await createTestServer({ now: () => SUN_WEEK3_EVENING });
    const cookie = await setupUser(server);
    await seedWeeklyCourse(server, cookie);

    const first = await call<Payload>(server, "POST", "/api/v1/courses/homework-digest/check", {
      cookie,
      body: { force: true },
    });
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ emitted: true, missing: 1, weekNo: 3, reason: "emitted" });

    const notifications = await server.db.all<{ title: string; body: string; url: string }>(
      "SELECT title, body, url FROM notifications WHERE reminder_id LIKE 'homework-digest:%'",
    );
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ title: "本周还有 1 门课没记作业", url: "/courses" });
    expect(notifications[0]?.body).toContain("英语");

    const second = await call<Payload>(server, "POST", "/api/v1/courses/homework-digest/check", {
      cookie,
      body: { force: true },
    });
    expect(second.body.data).toMatchObject({ emitted: false, reason: "already_sent" });
    const count = await server.db.first<{ count: number }>(
      "SELECT COUNT(*) AS count FROM notifications WHERE reminder_id LIKE 'homework-digest:%'",
    );
    expect(Number(count?.count)).toBe(1);
  });

  it("没到提醒时刻（周三中午）不写通知；force 才写", async () => {
    const server = await createTestServer({ now: () => WED_WEEK3 });
    const cookie = await setupUser(server);
    await seedWeeklyCourse(server, cookie);

    const notYet = await call<Payload>(server, "POST", "/api/v1/courses/homework-digest/check", {
      cookie,
      body: {},
    });
    expect(notYet.body.data).toMatchObject({ emitted: false, reason: "before_time", missing: 1 });

    const forced = await call<Payload>(server, "POST", "/api/v1/courses/homework-digest/check", {
      cookie,
      body: { force: true },
    });
    expect(forced.body.data).toMatchObject({ emitted: true, reason: "emitted" });
  });

  it("GET /courses/homework-digest 只预览、不写通知", async () => {
    const server = await createTestServer({ now: () => WED_WEEK3 });
    const cookie = await setupUser(server);
    await seedWeeklyCourse(server, cookie);

    const preview = await call<Payload>(server, "GET", "/api/v1/courses/homework-digest", { cookie });
    expect(preview.status).toBe(200);
    expect(preview.body.data).toMatchObject({ emitted: false, missing: 1, courseNames: ["英语"] });

    const count = await server.db.first<{ count: number }>(
      "SELECT COUNT(*) AS count FROM notifications WHERE reminder_id LIKE 'homework-digest:%'",
    );
    expect(Number(count?.count)).toBe(0);
  });

  it("runReminderTick 会顺带跑 digest（到点后 summary.digest = 1）", async () => {
    const server = await createTestServer({ now: () => SUN_WEEK3_EVENING });
    const cookie = await setupUser(server);
    await seedWeeklyCourse(server, cookie);

    const summary = await runReminderTick(server.db, SUN_WEEK3_EVENING);
    expect(summary.digest).toBe(1);
    expect(summary.errors).toEqual([]);

    const count = await server.db.first<{ count: number }>(
      "SELECT COUNT(*) AS count FROM notifications WHERE reminder_id LIKE 'homework-digest:%'",
    );
    expect(Number(count?.count)).toBe(1);

    // 再 tick 一次不会重复发
    const again = await runReminderTick(server.db, SUN_WEEK3_EVENING + 60_000);
    expect(again.digest).toBe(0);
  });

  it("没有每周作业的课 / 没有学期起点时不发提醒", async () => {
    const server = await createTestServer({ now: () => SUN_WEEK3_EVENING });
    const cookie = await setupUser(server);
    await call(server, "POST", "/api/v1/courses", { cookie, body: { name: "体育", weeklyHomework: false } });

    const userId = (await server.db.first<{ id: string }>("SELECT id FROM users"))?.id ?? "";
    const result = await runHomeworkDigest(server.db, userId, SUN_WEEK3_EVENING, { force: true });
    expect(result).toMatchObject({ emitted: false, reason: "no_courses" });

    const noSemester = await createTestServer({ now: () => SUN_WEEK3_EVENING });
    const cookie2 = await setupUser(noSemester);
    await call(noSemester, "POST", "/api/v1/courses", {
      cookie: cookie2,
      body: { name: "英语", weeklyHomework: true },
    });
    const userId2 = (await noSemester.db.first<{ id: string }>("SELECT id FROM users"))?.id ?? "";
    const digest = await runHomeworkDigest(noSemester.db, userId2, SUN_WEEK3_EVENING, { force: true });
    expect(digest).toMatchObject({ emitted: false, reason: "no_semester" });
  });
});
