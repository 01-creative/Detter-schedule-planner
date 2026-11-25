import { Hono } from "hono";
import type { Health } from "@detter/shared";
import type { AppEnv, ResolvedDeps } from "../env";
import { ok } from "../lib/respond";

/**
 * 健康检查：不需要鉴权（监控/负载均衡要能直接打）。
 * 只暴露版本、运行时、DB 可达性——不泄露任何数据，也不需要凭据。
 */
export function healthRoutes(deps: ResolvedDeps): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get("/health", async (c) => {
    let db: Health["db"] = "ok";
    try {
      await deps.db.first("SELECT 1 AS ok");
    } catch {
      db = "error";
    }

    const health: Health = {
      ok: db === "ok",
      version: deps.config.version,
      time: deps.now(),
      runtime: deps.runtime,
      db,
    };
    return ok(c, health, health.ok ? 200 : 503);
  });

  return router;
}
