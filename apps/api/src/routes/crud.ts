import { Hono } from "hono";
import type { EntityName } from "@detter/shared";
import type { AppEnv, ResolvedDeps } from "../env";
import { ApiError } from "../lib/errors";
import { ok, queryInt, readJson } from "../lib/respond";
import { currentAuth, requireScope } from "../auth/middleware";
import {
  createEntity,
  listPayloads,
  parseBoolean,
  readPayload,
  softDeleteEntity,
  updateEntity,
} from "../repo/crud";
import { SECRET_MASK, isSecretSetting } from "../repo/settings";

/**
 * 通用 CRUD 路由：14 个可同步实体共用一套实现。
 *
 * collection 名与共享包里的 entity 名故意不同（复数/短横线）：
 * URL 面向人和 curl，实体名面向协议与代码。
 */
export const COLLECTION_TO_ENTITY: Record<string, EntityName> = {
  tasks: "task",
  goals: "goal",
  inbox: "inbox",
  okrs: "okr",
  "key-results": "kr",
  kpis: "kpi",
  "kpi-entries": "kpiEntry",
  "pomodoro-sessions": "pomodoro",
  "mind-maps": "mindMap",
  "mind-nodes": "mindNode",
  courses: "course",
  assessments: "assessment",
  assignments: "assignment",
  settings: "setting",
};

const KNOWN_COLLECTIONS = Object.keys(COLLECTION_TO_ENTITY);

function resolveEntity(collection: string): EntityName {
  const entity = COLLECTION_TO_ENTITY[collection];
  if (!entity) {
    throw new ApiError("not_found", `未知集合：${collection}`, { collections: KNOWN_COLLECTIONS });
  }
  return entity;
}

/** REST 写入的来源设备：客户端用请求头声明，没声明就沿用会话绑定的设备。 */
function requestDeviceId(auth: { deviceId: string | null }, header: string | undefined): string {
  if (header && header.trim()) return header.trim();
  return auth.deviceId ?? "";
}

export function crudRoutes(deps: ResolvedDeps): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get("/:collection", requireScope("read"), async (c) => {
    const auth = currentAuth(c);
    const entity = resolveEntity(c.req.param("collection"));
    const raw = c.req.query();

    const result = await listPayloads(deps.db, entity, auth.userId, {
      limit: queryInt(raw.limit, 100, 1, 500),
      cursor: raw.cursor ?? null,
      includeDeleted: parseBoolean(raw.includeDeleted),
      query: raw,
    });

    return ok(c, { items: result.items, nextCursor: result.nextCursor });
  });

  router.post("/:collection", requireScope("write"), async (c) => {
    const auth = currentAuth(c);
    const entity = resolveEntity(c.req.param("collection"));
    const payload = await createEntity(deps.db, entity, auth.userId, {
      input: await readJson(c),
      deviceId: requestDeviceId(auth, c.req.header("x-detter-device")),
      now: deps.now(),
    });
    return ok(c, payload, 201);
  });

  router.get("/:collection/:id", requireScope("read"), async (c) => {
    const auth = currentAuth(c);
    const entity = resolveEntity(c.req.param("collection"));
    const payload = await readPayload(
      deps.db,
      entity,
      auth.userId,
      c.req.param("id"),
      parseBoolean(c.req.query("includeDeleted")),
    );
    if (!payload) throw ApiError.notFound("实体不存在");
    // 单条读取同样不能回显密钥（GET /settings/:id 的兜底）
    if (entity === "setting" && typeof payload.key === "string" && isSecretSetting(payload.key)) {
      payload.value = SECRET_MASK;
    }
    return ok(c, payload);
  });

  router.patch("/:collection/:id", requireScope("write"), async (c) => {
    const auth = currentAuth(c);
    const entity = resolveEntity(c.req.param("collection"));
    const body = await readJson(c);
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw ApiError.validation("PATCH 请求体必须是对象");
    }
    const payload = await updateEntity(deps.db, entity, auth.userId, c.req.param("id"), body, deps.now());
    if (!payload) throw ApiError.notFound("实体不存在");
    return ok(c, payload);
  });

  router.delete("/:collection/:id", requireScope("write"), async (c) => {
    const auth = currentAuth(c);
    const entity = resolveEntity(c.req.param("collection"));
    const payload = await softDeleteEntity(deps.db, entity, auth.userId, c.req.param("id"), deps.now());
    if (!payload) throw ApiError.notFound("实体不存在");
    return ok(c, payload);
  });

  return router;
}
