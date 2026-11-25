import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { runMigrations } from "./db/migrate";
import { createNodeDb } from "./db/node";
import { readNodeConfig } from "./env";

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
const config = readNodeConfig(process.env);

if (dbFile !== ":memory:") {
  mkdirSync(path.dirname(path.resolve(dbFile)), { recursive: true });
}

const db = createNodeDb(dbFile);
const migrationsDir = resolveMigrationsDir();
const applied = await runMigrations(db, migrationsDir);
const app = createApp({ db, config, runtime: "node" });

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `[detter-api] listening on http://127.0.0.1:${info.port} · db=${dbFile} · ` +
      `migrations=${applied.length > 0 ? applied.join(",") : "up-to-date"}`,
  );
  if (!config.setupToken) {
    console.warn("[detter-api] 未设置 SETUP_TOKEN：/api/v1/auth/setup 将返回 not_configured");
  }
});

/** 优雅退出：先停止接收新连接，再让进程自然结束（node:sqlite 无需额外 flush）。 */
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`[detter-api] ${signal} received, shutting down`);
    server.close(() => process.exit(0));
  });
}
