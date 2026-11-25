import { createApp } from "./app";
import { createD1Db } from "./db/d1";
import { readWorkerConfig, type WorkerEnv } from "./env";

/**
 * Cloudflare Workers 入口。
 *
 * 每次请求新建一个轻量的适配器与 Hono 实例：Worker 的执行模型里没有跨请求的可靠状态，
 * 而这两者本身都是无状态的对象，构造开销可以忽略。
 *
 * 数据库结构由 `wrangler d1 migrations apply` 负责，运行时不跑迁移。
 */
export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const app = createApp({
      db: createD1Db(env.DB),
      config: readWorkerConfig(env),
      runtime: "workers",
    });
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<WorkerEnv>;
