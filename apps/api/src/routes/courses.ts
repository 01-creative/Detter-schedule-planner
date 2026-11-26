import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, ResolvedDeps } from "../env";
import { ApiError } from "../lib/errors";
import { ok, queryInt } from "../lib/respond";
import { currentAuth, requireScope } from "../auth/middleware";
import { courseSummaries, listAssessments, listAssignments, listCourses } from "../services/courses";
import { runHomeworkDigest } from "../services/courses/digest";

/**
 * 课程域的 REST 补充端点（网页端主要走本地库 + 同步，这里服务脚本与验收）。
 *
 *   GET  /courses/summary                 课程 + 权重合计 + 本周作业状态
 *   GET  /courses/homework-digest         只看「这周有几门课没记作业」（不写通知）
 *   POST /courses/homework-digest/check   立即跑一次遗漏提醒（默认遵守「到点才发」，force=true 强制）
 *
 * 注意：`/courses` 本身的 CRUD 由通用路由提供（apps/api/src/routes/crud.ts），
 * 这两个路径都是多段路径，不会被通用 `/:collection/:id` 吞掉，但仍在 app.ts 里排在它之前注册。
 */

const DigestSchema = z.object({
  /** true = 忽略「还没到提醒时间」「本周已发过」的判断 */
  force: z.boolean().optional(),
  /** false = 只计算不写通知（预览） */
  notify: z.boolean().optional(),
});

async function readOptionalJson(c: { req: { text: () => Promise<string> } }): Promise<unknown> {
  const raw = await c.req.text();
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw ApiError.validation("请求体必须是合法 JSON");
  }
}

export function courseRoutes(deps: ResolvedDeps): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get("/courses/summary", requireScope("read"), async (c) => {
    const auth = currentAuth(c);
    const includeArchived = c.req.query("includeArchived") === "1";
    const ctx = { db: deps.db, userId: auth.userId, now: deps.now() };
    const items = await courseSummaries(ctx, { includeArchived });
    return ok(c, {
      items,
      count: items.length,
      missingHomework: items.filter((item) => item.homeworkMissing).length,
    });
  });

  router.get("/courses/homework-digest", requireScope("read"), async (c) => {
    const auth = currentAuth(c);
    const result = await runHomeworkDigest(deps.db, auth.userId, deps.now(), { notify: false });
    return ok(c, result);
  });

  router.post("/courses/homework-digest/check", requireScope("write"), async (c) => {
    const auth = currentAuth(c);
    const body = DigestSchema.parse(await readOptionalJson(c));
    const result = await runHomeworkDigest(deps.db, auth.userId, deps.now(), {
      force: body.force === true,
      notify: body.notify !== false,
    });
    return ok(c, result);
  });

  /**
   * 课程 + 考核项 + 作业的一次性快照：给脚本与 AI 调试用。
   * 页面不走它（页面读本地 Dexie，离线可用），但用它能在没有前端的情况下核对数据。
   */
  router.get("/courses/:id/plan", requireScope("read"), async (c) => {
    const auth = currentAuth(c);
    const ctx = { db: deps.db, userId: auth.userId, now: deps.now() };
    const courseId = c.req.param("id");
    const courses = await listCourses(ctx, { includeArchived: true });
    const course = courses.find((item) => item.id === courseId);
    if (!course) throw ApiError.notFound("课程不存在");
    const [assessments, assignments] = await Promise.all([
      listAssessments(ctx, courseId),
      listAssignments(ctx, { courseId }),
    ]);
    const limit = queryInt(c.req.query("limit"), 200, 1, 500);
    return ok(c, {
      course,
      assessments: assessments.slice(0, limit),
      assignments: assignments.slice(0, limit),
    });
  });

  return router;
}
