import { Hono } from "hono";
import { ApiKeyCreateSchema } from "@detter/shared";
import type { ApiKeyInfo } from "@detter/shared";
import type { AppEnv, ResolvedDeps } from "../env";
import { ApiError } from "../lib/errors";
import { ok, readJson } from "../lib/respond";
import { currentAuth, requireScope } from "../auth/middleware";
import { createApiKeyRecord, parseScopes } from "../auth/apikey";

/**
 * API Key 管理（admin scope）。
 *
 * 明文只在创建响应里出现一次，之后库里只有 prefix + sha256。
 * 撤销用 revoked_at 而不是物理删除：审计日志要能指回它是哪把钥匙。
 */
interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string;
  created_at: number;
  last_used_at: number | null;
  expires_at: number | null;
  revoked_at: number | null;
}

export function apiKeyRoutes(deps: ResolvedDeps): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get("/api-keys", requireScope("admin"), async (c) => {
    const auth = currentAuth(c);
    const rows = await deps.db.all<ApiKeyRow>(
      `SELECT id, name, prefix, scopes, created_at, last_used_at, expires_at, revoked_at
         FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`,
      [auth.userId],
    );

    const items: ApiKeyInfo[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      scopes: parseScopes(row.scopes),
      createdAt: Number(row.created_at),
      lastUsedAt: row.last_used_at === null ? null : Number(row.last_used_at),
      expiresAt: row.expires_at === null ? null : Number(row.expires_at),
      revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
    }));
    return ok(c, { items });
  });

  router.post("/api-keys", requireScope("admin"), async (c) => {
    const auth = currentAuth(c);
    const body = ApiKeyCreateSchema.parse(await readJson(c));

    const created = await createApiKeyRecord(deps.db, {
      userId: auth.userId,
      name: body.name,
      scopes: body.scopes,
      expiresInDays: body.expiresInDays,
      now: deps.now(),
    });

    // 只有这一次能看到 plaintext
    return ok(c, created, 201);
  });

  router.delete("/api-keys/:id", requireScope("admin"), async (c) => {
    const auth = currentAuth(c);
    const id = c.req.param("id");
    const now = deps.now();

    const existing = await deps.db.first<{ id: string; revoked_at: number | null }>(
      "SELECT id, revoked_at FROM api_keys WHERE id = ? AND user_id = ?",
      [id, auth.userId],
    );
    if (!existing) throw ApiError.notFound("API Key 不存在");

    if (existing.revoked_at === null) {
      await deps.db.run("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND user_id = ?", [now, id, auth.userId]);
    }
    return ok(c, { id, revokedAt: existing.revoked_at ?? now });
  });

  return router;
}
