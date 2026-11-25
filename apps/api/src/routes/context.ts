import { Hono } from "hono";
import { CONTEXT_RANGES, CaptureRequestSchema } from "@detter/shared";
import type { ContextRange } from "@detter/shared";
import type { AppEnv, ResolvedDeps } from "../env";
import { ApiError } from "../lib/errors";
import { ok, readJson } from "../lib/respond";
import { currentAuth, requireScope } from "../auth/middleware";
import { buildContextPack, captureToInbox, formatContextPackMarkdown } from "../services/context";

/**
 * AI 数据出入口：上下文包 + 快速捕获（REST v1）。
 *
 * `/context/pack` 是 06-AI-INTEGRATION.md 定义的正式端点；
 * `/context` 是 T01 时期的别名，保留以免既有客户端（及 T01 的回归测试）失效。
 *
 * `/capture` 按 T12 §4 提供「文本 → 解析 → 落收件箱」，与 MCP 的 capture 工具共用
 * services/context.ts 的同一套实现（也保证 AI 与人类走同一套解析规则）。
 */

const RANGES: readonly ContextRange[] = CONTEXT_RANGES;

function parseRange(raw: string | undefined): ContextRange {
  if (raw === undefined || raw === "") return "week";
  if (!RANGES.includes(raw as ContextRange)) {
    throw new ApiError("validation_error", "range 取值不合法", { value: raw, allowed: RANGES });
  }
  return raw as ContextRange;
}

function parseFormat(raw: string | undefined): "json" | "markdown" {
  if (raw === undefined || raw === "") return "json";
  if (raw !== "json" && raw !== "markdown") {
    throw new ApiError("validation_error", "format 只能是 json 或 markdown", { value: raw });
  }
  return raw;
}

const ALLOWED_INCLUDE = ["tasks", "goals", "okr", "kpi", "pomodoro", "inbox", "mindmap"] as const;

function parseInclude(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const items = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const unknown = items.filter((item) => !ALLOWED_INCLUDE.includes(item as (typeof ALLOWED_INCLUDE)[number]));
  if (unknown.length > 0) {
    throw new ApiError("validation_error", "include 取值不合法", { value: unknown, allowed: ALLOWED_INCLUDE });
  }
  return items;
}

export function contextRoutes(deps: ResolvedDeps): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get("/context/pack", requireScope("read"), async (c) => {
    const auth = currentAuth(c);
    const range = parseRange(c.req.query("range"));
    const format = parseFormat(c.req.query("format"));
    const include = parseInclude(c.req.query("include"));

    const pack = await buildContextPack(deps.db, auth.userId, { range, include, now: deps.now() });

    if (format === "markdown") {
      return c.body(formatContextPackMarkdown(pack), 200, {
        "content-type": "text/markdown; charset=utf-8",
      });
    }
    return ok(c, pack);
  });

  // T01 兼容别名：形状不变；markdown 前置一行旧标题，避免旧调用方/测试失效。
  router.get("/context", requireScope("read"), async (c) => {
    const auth = currentAuth(c);
    const range = parseRange(c.req.query("range"));
    const format = parseFormat(c.req.query("format"));
    const include = parseInclude(c.req.query("include"));

    const pack = await buildContextPack(deps.db, auth.userId, { range, include, now: deps.now() });
    if (format === "markdown") {
      const body = `# Detter 上下文包\n\n${formatContextPackMarkdown(pack)}`;
      return c.body(body, 200, { "content-type": "text/markdown; charset=utf-8" });
    }
    return ok(c, pack);
  });

  router.post("/capture", requireScope("write"), async (c) => {
    const auth = currentAuth(c);
    const body = CaptureRequestSchema.parse(await readJson(c));

    // 客户端 draft 只作参考：服务端始终用同一套解析器重新解析，避免两端规则漂移
    const result = await captureToInbox(deps.db, auth.userId, {
      text: body.text,
      source: body.source,
      now: deps.now(),
    });
    return ok(c, result, 201);
  });

  return router;
}
