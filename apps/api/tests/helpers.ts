import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Hono } from "hono";
import { createApp } from "../src/app";
import { runMigrations } from "../src/db/migrate";
import { createNodeDb } from "../src/db/node";
import type { Db } from "../src/db/types";
import { createConfig, type AppConfig, type AppEnv } from "../src/env";

/**
 * 测试夹具：内存库 + 真实迁移 + 真实 app。
 *
 * 刻意不 mock DB：同步引擎的冲突判定、changes 的 seq 递增、SQL 投影列全都依赖真实 SQLite 行为
 * （AUTOINCREMENT、last_insert_rowid()、事务），mock 掉就等于没测。
 */

export const TEST_SETUP_TOKEN = "test-setup-token";
export const TEST_PASSWORD = "correct-horse-battery";

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, "../migrations");

export interface TestServer {
  app: Hono<AppEnv>;
  db: Db;
  config: AppConfig;
  /** 每台「设备」一个 Cookie 串，模拟多端同步。 */
  close: () => void;
}

export async function createTestServer(
  options: Partial<AppConfig> & { now?: () => number } = {},
): Promise<TestServer> {
  const { now, ...configOverrides } = options;
  const db = createNodeDb(":memory:");
  await runMigrations(db, MIGRATIONS_DIR);
  const resolved = createConfig({
    setupToken: TEST_SETUP_TOKEN,
    secureCookies: false,
    ...configOverrides,
  });
  const app = createApp({ db, config: resolved, runtime: "node", now });
  return { app, db, config: resolved, close: () => undefined };
}

export interface ApiCallOptions {
  body?: unknown;
  cookie?: string | null;
  /** 默认非 GET 请求自动带 x-detter-csrf: 1；传 false 可测 CSRF 缺失。 */
  csrf?: boolean;
  headers?: Record<string, string>;
  origin?: string;
}

export interface ApiResult<T = unknown> {
  status: number;
  body: { ok: boolean; data?: T; error?: { code: string; message: string; details?: unknown } };
  headers: Headers;
  /** 从 Set-Cookie 里抽出的 `name=value`，可直接作为后续请求的 Cookie 头。 */
  cookie: string | null;
}

export async function call<T = unknown>(
  server: TestServer,
  method: string,
  url: string,
  options: ApiCallOptions = {},
): Promise<ApiResult<T>> {
  const headers = new Headers();
  const hasBody = options.body !== undefined;
  if (hasBody) headers.set("content-type", "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);

  const isSafe = method === "GET" || method === "HEAD" || method === "OPTIONS";
  if (!isSafe && options.csrf !== false) headers.set("x-detter-csrf", "1");
  if (options.origin) headers.set("origin", options.origin);
  for (const [key, value] of Object.entries(options.headers ?? {})) headers.set(key, value);

  const response = await server.app.request(url, {
    method,
    headers,
    body: hasBody ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  const body = (text.length > 0 ? JSON.parse(text) : { ok: response.ok }) as ApiResult<T>["body"];

  const setCookieHeader = response.headers.get("set-cookie");
  const cookie = setCookieHeader ? parseSessionCookie(setCookieHeader) : null;

  return { status: response.status, body, headers: response.headers, cookie };
}

/** 从 Set-Cookie 中取第一个 cookie 的 name=value（含清除 Cookie 的 max-age=0 情况）。 */
function parseSessionCookie(header: string): string {
  const first = header.split(/,(?=\s*[A-Za-z0-9_-]+=)/)[0] ?? header;
  return (first.split(";")[0] ?? "").trim();
}

/** 初始化用户并返回会话 Cookie。 */
export async function setupUser(
  server: TestServer,
  input: { password?: string; deviceName?: string; setupToken?: string } = {},
): Promise<string> {
  const result = await call(server, "POST", "/api/v1/auth/setup", {
    body: {
      setupToken: input.setupToken ?? TEST_SETUP_TOKEN,
      password: input.password ?? TEST_PASSWORD,
      deviceName: input.deviceName ?? "测试设备",
    },
  });
  if (result.status !== 201 || !result.cookie) {
    throw new Error(`setup 失败: ${result.status} ${JSON.stringify(result.body)}`);
  }
  return result.cookie;
}

export async function login(
  server: TestServer,
  input: { password?: string; deviceName?: string } = {},
): Promise<ApiResult> {
  return call(server, "POST", "/api/v1/auth/login", {
    body: {
      password: input.password ?? TEST_PASSWORD,
      deviceName: input.deviceName ?? "第二台设备",
    },
  });
}

/** 同步 push 的薄封装。 */
export async function pushOps(
  server: TestServer,
  cookie: string,
  deviceId: string,
  ops: unknown[],
): Promise<ApiResult<{ results: Array<Record<string, unknown>>; cursor: number }>> {
  return call(server, "POST", "/api/v1/sync/push", {
    cookie,
    body: { deviceId, ops },
  });
}

/** 拉全量 change（循环翻页直到 hasMore=false），返回扁平数组。 */export async function pullAll(
  server: TestServer,
  cookie: string,
  limit = 200,
): Promise<Array<Record<string, unknown>>> {
  const collected: Array<Record<string, unknown>> = [];
  let cursor = 0;
  for (let guard = 0; guard < 50; guard++) {
    const result = await call<{ changes: Array<Record<string, unknown>>; cursor: number; hasMore: boolean }>(
      server,
      "GET",
      `/api/v1/sync/pull?cursor=${cursor}&limit=${limit}`,
      { cookie },
    );
    if (result.status !== 200) throw new Error(`pull 失败: ${result.status}`);
    const data = result.body.data as { changes: Array<Record<string, unknown>>; cursor: number; hasMore: boolean };
    collected.push(...data.changes);
    cursor = data.cursor;
    if (!data.hasMore) break;
  }
  return collected;
}
