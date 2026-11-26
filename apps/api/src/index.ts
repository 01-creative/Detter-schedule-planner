import { createApp } from "./app";
import { createD1Db } from "./db/d1";
import { readWorkerConfig, readWorkerPushDeps, type WorkerEnv } from "./env";
import { runReminderTick } from "./services/reminders/schedule";

/**
 * Cloudflare Workers 入口。
 *
 * 每次请求新建一个轻量的适配器与 Hono 实例：Worker 的执行模型里没有跨请求的可靠状态，
 * 而这两者本身都是无状态的对象，构造开销可以忽略。
 *
 * 数据库结构由 `wrangler d1 migrations apply` 负责，运行时不跑迁移。
 *
 * T14：`scheduled` 由 wrangler.toml 的 [triggers] crons 每分钟触发一次，
 * 与 Node 入口的 setInterval(60s) 调的是同一个 runReminderTick。
 */
export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const app = createApp({
      db: createD1Db(env.DB),
      config: readWorkerConfig(env),
      runtime: "workers",
      push: {
        vapid: readWorkerPushDeps(env).vapid,
        // 不直接把全局 fetch 存进 deps：Workers 里它必须在请求/定时上下文中调用
        fetch: (input, init) => fetch(input, init),
        endpointAllowlist: readWorkerPushDeps(env).endpointAllowlist,
      },
    });
    return app.fetch(request, env, ctx);
  },

  async scheduled(controller: ScheduledController, env: WorkerEnv, ctx: ExecutionContext): Promise<void> {
    const push = readWorkerPushDeps(env);
    ctx.waitUntil(
      runReminderTick(createD1Db(env.DB), controller.scheduledTime ?? Date.now(), {
        vapid: push.vapid,
        fetch: push.fetch,
        pushEndpointAllowlist: push.endpointAllowlist,
      })
        .then((summary) => {
          if (summary.sent > 0 || summary.failed > 0 || summary.errors.length > 0) {
            console.log(
              `[reminders] cron sent=${summary.sent} failed=${summary.failed} retried=${summary.retried} ` +
                `downgraded=${summary.downgraded} errors=${summary.errors.length}`,
            );
          }
        })
        .catch((error: unknown) => {
          console.error(
            `[reminders] cron 失败：${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
          );
        }),
    );
  },
} satisfies ExportedHandler<WorkerEnv>;
