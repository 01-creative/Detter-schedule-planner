import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app";
import { runMigrations } from "./db/migrate";
import { createNodeDb } from "./db/node";
import { readNodeConfig, readNodePushDeps } from "./env";
import { runReminderTick } from "./services/reminders/schedule";

/**
 * Node 入口：node:sqlite + @hono/node-server。
 *
 * 注意：这个文件必须由打包产物运行（`pnpm build:node && node dist/server.js`）。
 * 原因是 @detter/shared 以 TS 源码形式被 workspace 链接进 node_modules，
 * 而 Node 的原生类型剥离明确拒绝处理 node_modules 下的 .ts 文件。
 * esbuild 会把 shared 一起打进来，于是运行时只剩一个自包含的 JS 文件。
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * migrations 目录定位：源码运行与打包运行的上层目录不同，按候选路径探测。
 * DETTER_MIGRATIONS 用于容器部署时显式指定。
 */
function resolveMigrationsDir(): string {
  const candidates = [
    process.env.DETTER_MIGRATIONS,
    path.resolve(here, "../migrations"), // dist/server.js → apps/api/migrations
    path.resolve(here, "../../migrations"), // src/server.ts → apps/api/migrations
    path.resolve(process.cwd(), "migrations"),
    path.resolve(process.cwd(), "apps/api/migrations"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`找不到 migrations 目录，已尝试：${candidates.join(" | ")}`);
}

const dbFile = process.env.DETTER_DB ?? "./data/detter.sqlite";
const port = Number(process.env.PORT ?? 8787);
const hostname = process.env.HOST ?? "0.0.0.0";
const config = readNodeConfig(process.env);

if (dbFile !== ":memory:") {
  mkdirSync(path.dirname(path.resolve(dbFile)), { recursive: true });
}

const db = createNodeDb(dbFile);
const migrationsDir = resolveMigrationsDir();
const applied = await runMigrations(db, migrationsDir);
const push = readNodePushDeps(process.env);
const app = createApp({
  db,
  config,
  runtime: "node",
  push: {
    vapid: push.vapid,
    fetch: push.fetch,
    endpointAllowlist: push.endpointAllowlist,
  },
});

/**
 * 单端口自托管：如果旁边有前端构建产物，就由同一个进程把静态资源也伺候了。
 *
 * 这样自托管只需要「一个进程 + 一个端口 + 一个数据库文件」，
 * 不用再配 Nginx 或 Vite 代理；同源部署还省掉了 Cookie 的跨站问题。
 * 找不到 dist 就退化成纯 API（开发时由 Vite 代理前端，两边互不影响）。
 */
function resolveWebDist(): string | null {
  const candidates = [
    process.env.DETTER_WEB_DIST,
    path.resolve(here, "../../web/dist"), // dist/server.js → apps/web/dist
    path.resolve(here, "../../../web/dist"), // src/server.ts → apps/web/dist
    path.resolve(process.cwd(), "apps/web/dist"),
    path.resolve(process.cwd(), "../web/dist"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "index.html"))) return candidate;
  }
  return null;
}

const webDist = resolveWebDist();
let webIndex: string | null = null;
if (webDist) {
  webIndex = readFileSync(path.join(webDist, "index.html"), "utf8");

  /**
   * 同一进程既要发 API 又要发页面，两边的 CSP 完全不同：
   * - /api/* 是 JSON：`default-src 'none'` 最保守；
   * - 页面要加载自己的 JS/CSS/图标：用 docs/architecture/05-SECURITY.md §2.4 那份文档 CSP。
   * 这里在响应返回后按路径改头，避免为了托管前端而把 API 的 CSP 放宽。
   */
  const DOCUMENT_CSP = [
    "default-src 'self'",
    "script-src 'self'",
    // Tailwind v4 与 Motion 会注入内联样式，样式必须放行
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");

  app.use("*", async (c, next) => {
    // 必须在 next() 之前写入：Hono 的 c.header() 会合并进最终响应。
    // 页面侧的安全头在这里补齐（API 那份 secureHeaders 只作用于 /api/*）。
    if (!c.req.path.startsWith("/api")) {
      c.header("content-security-policy", DOCUMENT_CSP);
      c.header("x-content-type-options", "nosniff");
      c.header("referrer-policy", "no-referrer");
      c.header("cross-origin-opener-policy", "same-origin");
      c.header("cross-origin-resource-policy", "same-origin");
      c.header("permissions-policy", "geolocation=(), microphone=(), camera=()");
    }
    await next();
  });

  // 静态资源排在 API 路由之后注册：命中的 API 请求先被路由处理，不会走到这里
  app.use("*", serveStatic({ root: webDist }));
  app.get("*", (c) => {
    // 未知的 /api 路径要老老实实 404，不能被前端兜底吞掉
    if (c.req.path.startsWith("/api")) return c.notFound();
    return c.html(webIndex as string);
  });
}

const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(
    `[detter-api] listening on http://127.0.0.1:${info.port} · db=${dbFile} · ` +
      `migrations=${applied.length > 0 ? applied.join(",") : "up-to-date"}` +
      (webDist ? ` · web=${webDist}` : " · web=(未找到前端构建产物，纯 API 模式)"),
  );
  if (!config.setupToken) {
    console.warn("[detter-api] 未设置 SETUP_TOKEN：/api/v1/auth/setup 将返回 not_configured");
  }
});

/** 优雅退出：先停止接收新连接，再让进程自然结束（node:sqlite 无需额外 flush）。 */
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`[detter-api] ${signal} received, shutting down`);
    clearInterval(reminderTimer);
    server.close(() => process.exit(0));
  });
}

/* -------------------------------------------------------------------------- */
/*                          提醒调度（T14 · Node 运行时）                       */
/* -------------------------------------------------------------------------- */

/**
 * Workers 用 scheduled 事件，Node 用 setInterval —— 两边都调 runReminderTick，
 * 保证「同一份调度逻辑、两种部署方式」。60s 一次与 Workers cron 的最小粒度一致。
 *
 * 三个细节：
 * 1. `tickRunning` 防重入：上一次 tick 还在等外部 HTTP 时，不要叠加第二次；
 * 2. 定时器 unref：不因为它挂着而阻止进程退出；
 * 3. 启动 1 秒后先跑一次：开发时不用干等一分钟才能看到「到点」。
 */
const REMINDER_TICK_MS = 60_000;
let tickRunning = false;

async function reminderTick(): Promise<void> {
  if (tickRunning) return;
  tickRunning = true;
  try {
    const summary = await runReminderTick(db, Date.now(), {
      vapid: push.vapid,
      fetch: push.fetch,
      pushEndpointAllowlist: push.endpointAllowlist,
    });
    if (summary.sent > 0 || summary.failed > 0 || summary.errors.length > 0) {
      console.log(
        `[reminders] tick materialized=${summary.materialized} sent=${summary.sent} ` +
          `retried=${summary.retried} failed=${summary.failed} downgraded=${summary.downgraded} ` +
          `errors=${summary.errors.length}`,
      );
    }
  } catch (error) {
    console.error(
      `[reminders] tick 失败：${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
    );
  } finally {
    tickRunning = false;
  }
}

const reminderTimer = setInterval(() => void reminderTick(), REMINDER_TICK_MS);
reminderTimer.unref();
const reminderBootTimer = setTimeout(() => void reminderTick(), 1_000);
reminderBootTimer.unref();
