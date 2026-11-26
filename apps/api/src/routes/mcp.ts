import { Hono } from "hono";
import { APP_VERSION } from "@detter/shared";
import type { AppEnv, ResolvedDeps } from "../env";
import { currentAuth } from "../auth/middleware";
import { clientIp } from "../lib/respond";
import {
  JSON_RPC_ERRORS,
  McpRpcError,
  callMcpTool,
  listMcpTools,
} from "../services/mcp";

/**
 * MCP Server：JSON-RPC 2.0 over HTTP（Streamable HTTP 的请求-响应子集）。
 *
 * POST /api/v1/mcp
 *   Authorization: Bearer dtk_xxxxxxxx_yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
 *   {"jsonrpc":"2.0","id":1,"method":"tools/list"}
 *
 * 设计取舍：
 * - 只认 Bearer API Key，不走 Cookie：MCP 客户端是机器，不应共享浏览器会话；
 * - 所有 JSON-RPC 层错误用 HTTP 200 + error 对象返回（协议错误不是传输错误），
 *   鉴权失败才用 401；
 * - 不回堆栈：错误消息是人话，内部异常只落服务端日志。
 *
 * 支持：initialize / tools/list / tools/call / ping / notifications/*。
 */

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

type RpcId = string | number | null;

const PROTOCOL_VERSION = "2025-06-18";

const INSTRUCTIONS = [
  "Detter 是本地优先的四象限日程管理器。",
  "工具返回结构化 JSON，不会返回 Markdown；请自行组织语言。",
  "时间参数一律使用毫秒时间戳（用户时区 Asia/Shanghai），不要传 ISO 字符串。",
  "课程相关工具（add_assessment / add_assignment / set_semester_start）是例外：日期可传 2026-12-01 或 ISO 字符串，权重可传 30 或 \"30%\"；课程不存在时会按课程名自动创建。",
  "quadrant: 1=重要且紧急，2=重要不紧急，3=紧急不重要，4=不重要不紧急。",
  "写操作需要该 API Key 具备 write scope；不确定时先用 list_tasks / get_agenda / list_courses 查看现状。",
].join("");

function rpcResult(id: RpcId, result: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: RpcId, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function normalizeId(raw: unknown): RpcId {
  if (typeof raw === "string" || typeof raw === "number") return raw;
  return null;
}

/** 从 Bearer 头里取 8 位 prefix，用于审计 actor（token 已由中间件校验过）。 */
function bearerPrefix(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+dtk_([A-Za-z0-9]{8})_/i.exec(header.trim());
  return match?.[1] ?? null;
}

function initializeResult(): Record<string, unknown> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: { tools: {} },
    serverInfo: { name: "detter", version: APP_VERSION },
    instructions: INSTRUCTIONS,
  };
}

export function mcpRoutes(deps: ResolvedDeps): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  // Streamable HTTP 客户端可能先 GET 打开 SSE 流；本实现是无状态请求-响应，明确回 405。
  router.get("/mcp", (c) => c.body(null, 405, { allow: "POST" }));

  router.post("/mcp", async (c) => {
    const auth = currentAuth(c);
    if (auth.via !== "apikey") {
      return c.json(
        rpcError(null, JSON_RPC_ERRORS.SERVER, "MCP 只接受 API Key（Authorization: Bearer dtk_...），不接受浏览器会话"),
        401,
      );
    }
    const prefix = bearerPrefix(c.req.header("authorization"));
    if (!prefix) {
      return c.json(rpcError(null, JSON_RPC_ERRORS.SERVER, "Authorization 头格式不正确"), 401);
    }

    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json(rpcError(null, JSON_RPC_ERRORS.PARSE, "请求体必须是合法 JSON"), 200);
    }

    if (Array.isArray(payload)) {
      return c.json(rpcError(null, JSON_RPC_ERRORS.INVALID_REQUEST, "不支持批量请求"), 200);
    }
    if (typeof payload !== "object" || payload === null) {
      return c.json(rpcError(null, JSON_RPC_ERRORS.INVALID_REQUEST, "请求必须是 JSON-RPC 对象"), 200);
    }

    const request = payload as JsonRpcRequest;
    if (request.jsonrpc !== undefined && request.jsonrpc !== "2.0") {
      return c.json(rpcError(null, JSON_RPC_ERRORS.INVALID_REQUEST, "jsonrpc 必须是 2.0"), 200);
    }
    if (typeof request.method !== "string" || request.method.length === 0) {
      return c.json(rpcError(null, JSON_RPC_ERRORS.INVALID_REQUEST, "method 必须是非空字符串"), 200);
    }

    const method = request.method;
    const isNotification = request.id === undefined || method.startsWith("notifications/");
    if (isNotification) {
      // MCP 的 initialized / cancelled 等通知不需要响应体；202 表示已接收
      return c.body(null, 202);
    }

    const id = normalizeId(request.id);

    try {
      switch (method) {
        case "initialize":
          return c.json(rpcResult(id, initializeResult()));

        case "ping":
          return c.json(rpcResult(id, {}));

        case "tools/list":
          return c.json(rpcResult(id, { tools: listMcpTools() }));

        case "tools/call": {
          const params = request.params;
          if (typeof params !== "object" || params === null || Array.isArray(params)) {
            throw new McpRpcError(JSON_RPC_ERRORS.INVALID_PARAMS, "params 必须是对象");
          }
          const { name, arguments: rawArguments } = params as { name?: unknown; arguments?: unknown };
          if (typeof name !== "string" || name.length === 0) {
            throw new McpRpcError(JSON_RPC_ERRORS.INVALID_PARAMS, "params.name 必须是非空字符串");
          }

          const data = await callMcpTool(
            {
              db: deps.db,
              userId: auth.userId,
              scopes: auth.scopes,
              now: deps.now(),
              actor: `apikey:${prefix}`,
              ip: clientIp(c),
            },
            name,
            rawArguments,
          );

          return c.json(
            rpcResult(id, {
              content: [{ type: "text", text: JSON.stringify(data) }],
              isError: false,
            }),
          );
        }

        default:
          throw new McpRpcError(JSON_RPC_ERRORS.METHOD_NOT_FOUND, `未知方法：${method}`);
      }
    } catch (error) {
      if (error instanceof McpRpcError) {
        return c.json(rpcError(id, error.code, error.message), 200);
      }
      // 未知异常：日志里留信息，响应只给一句话（不泄露堆栈）
      console.error(
        JSON.stringify({
          mcp: true,
          method,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        }),
      );
      return c.json(rpcError(id, JSON_RPC_ERRORS.INTERNAL, "服务器内部错误"), 200);
    }
  });

  return router;
}
