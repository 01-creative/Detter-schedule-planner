# T01 · 后端基座（Hono + D1/node:sqlite + 鉴权 + 同步）

## 0. 一句话目标

交付一个**运行时无关**的后端：同一份代码既能跑在 Cloudflare Workers（D1），也能用 `node src/server.ts` 跑在普通服务器（node:sqlite），并已具备登录、会话、同步推送/拉取、全实体 CRUD、健康检查。

---

## 1. 前置条件（已就绪，直接读，不要改）

| 文件 | 说明 |
| --- | --- |
| `packages/shared/src/entities.ts` | 所有实体 zod schema、表名映射、索引提示 —— **唯一契约** |
| `packages/shared/src/sync.ts` | 同步协议 schema（SyncOp / SyncPushResponse / ChangeRow…） |
| `packages/shared/src/api.ts` | 错误码、鉴权 DTO、分页、上下文包 schema |
| `apps/api/migrations/0001_init.sql` | 数据库结构（已定稿，按它实现） |
| `docs/architecture/03-SYNC-PROTOCOL.md` | 同步语义 |
| `docs/architecture/05-SECURITY.md` | 安全要求 |

> **禁止修改** `packages/shared/**`、根目录 `package.json`、`pnpm-workspace.yaml`、`apps/api/migrations/0001_init.sql`。
> 若发现契约缺陷，在最终报告里列出「建议变更」，由总工裁决。

---

## 2. 技术约束

- 运行时：Cloudflare Workers（`@cloudflare/workers-types`）+ Node 24（`node:sqlite`）。
- 框架：`hono` 4.x；校验：`zod` 3.x；**不引入 ORM**。
- 加密只用 WebCrypto（`globalThis.crypto.subtle`），保证两套运行时一致。
- 所有 SQL 用参数绑定，禁止字符串拼接。
- TypeScript strict，`verbatimModuleSyntax` 已开：类型导入必须写 `import type`。

---

## 3. 目录与文件所有权

**你只能创建/修改 `apps/api/**`**（`migrations/` 下新增文件允许，但 `0001_init.sql` 不可改）。

目标结构：

```
apps/api/
├── wrangler.toml
├── .dev.vars.example
├── src/
│   ├── index.ts              # Workers 入口：export default { fetch: app.fetch }
│   ├── server.ts             # Node 入口：node:sqlite + @hono/node-server
│   ├── app.ts                # createApp(deps) -> Hono（路由装配，无运行时依赖）
│   ├── env.ts                # Env 类型 + 配置读取（SETUP_TOKEN、ALLOWED_ORIGINS…）
│   ├── db/
│   │   ├── types.ts          # Db 接口
│   │   ├── d1.ts             # D1 适配器
│   │   ├── node.ts           # node:sqlite 适配器（含 :memory: 支持）
│   │   ├── migrate.ts        # 读取 migrations/*.sql 顺序执行（Node/测试用）
│   │   └── projections.ts    # entity payload -> 投影列
│   ├── lib/
│   │   ├── errors.ts         # ApiError + 统一错误信封
│   │   ├── respond.ts        # ok()/fail()
│   │   ├── crypto.ts         # pbkdf2 / sha256 / randomToken / timingSafeEqual
│   │   └── ids.ts            # 复用 shared 的 uuidv7
│   ├── auth/
│   │   ├── password.ts       # hashPassword / verifyPassword
│   │   ├── session.ts        # 建/查/续期/吊销会话
│   │   ├── apikey.ts         # 生成、校验、scope
│   │   ├── middleware.ts     # requireAuth / requireScope / csrfGuard
│   │   └── ratelimit.ts      # 登录失败限流
│   ├── sync/
│   │   ├── engine.ts         # applyOps：逐个 op 应用 + 冲突返回
│   │   └── query.ts          # pull / snapshot
│   ├── repo/
│   │   └── crud.ts           # 通用实体仓储：list/get/create/update/softDelete
│   ├── routes/
│   │   ├── health.ts auth.ts sync.ts crud.ts devices.ts settings.ts apikeys.ts
│   └── services/
│       └── context.ts        # 上下文包（T12 会用，先给最小实现）
└── tests/
    ├── helpers.ts            # 建内存库 + 建 app
    ├── auth.test.ts
    ├── sync.test.ts
    └── crud.test.ts
```

---

## 4. 详细规格

### 4.1 Db 接口

```ts
export interface Db {
  all<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T[]>;
  first<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T | null>;
  run(sql: string, params?: SqlParam[]): Promise<{ changes: number; lastRowId: number }>;
  /** 原子批量；D1 用 db.batch，node:sqlite 用显式事务 */
  batch(stmts: Array<{ sql: string; params?: SqlParam[] }>): Promise<void>;
  exec(sql: string): Promise<void>;
}
```

- `d1.ts`：`D1Database.prepare(sql).bind(...params).all()` → `.results`；`.run()` → `.meta.changes`；`batch` → `db.batch(prepared[])`。
- `node.ts`：`new DatabaseSync(path)`，`prepare(sql).all(...params)` / `.run(...params)`；`batch` 用 `BEGIN/COMMIT/ROLLBACK`。
- 参数一律 `?` 占位；布尔存 0/1；对象/数组存 JSON 字符串。

### 4.2 鉴权

**首次初始化**
`POST /api/v1/auth/setup` body `{setupToken, password, deviceName}`：
- `users` 表非空 → `409 already_initialized`
- `setupToken !== env.SETUP_TOKEN` → `403 forbidden`
- 建用户（PBKDF2-SHA256，310000 次迭代，16 字节盐，32 字节输出，base64 存储）
- 同时建会话并下发 Cookie

**登录**
`POST /api/v1/auth/login` `{password, deviceName}`：
- 失败限流：同 IP 15 分钟内失败 ≥ 10 次 → `429 rate_limited`
- 成功：创建 session，Set-Cookie `detter_session`

**会话 Cookie 规范**
```
detter_session=<48 字节 base64url 随机 token>
HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000; Secure（生产）
```
数据库只存 `sha256(token)`。校验时按 hash 查、检查 `expires_at`、滑动续期（剩余 < 7 天则延长 30 天）。

**API Key**
`Authorization: Bearer dtk_<8位prefix>_<32位secret>`
- 生成时返回一次明文，库内存 `prefix` + `sha256(整串)`
- 校验：按 prefix 查 → 常量时间比较 hash → 检查 `revoked_at` / `expires_at` → 命中则写 `last_used_at`（每 5 分钟最多写一次，避免打爆 D1）
- scope：`read` / `write` / `admin`；`GET` 需要 `read`，写操作需要 `write`，API Key 管理需要 `admin`

**CSRF**
仅对「Cookie 会话」且非 GET 的请求生效：必须带请求头 `x-detter-csrf: 1`，且 `Origin`（若有）必须在允许列表内（`APP_ORIGIN` + 本地开发 `http://127.0.0.1:5173`）。不满足 → `403 csrf_failed`。API Key 调用豁免。

**端点**
- `GET /api/v1/auth/status` → `AuthStatus`（未登录也返回 200，`authenticated:false`）
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me` → `{user:{id,displayName,timezone}, devices:n}`

### 4.3 同步

`POST /api/v1/sync/push`（body = `SyncPushRequest`），对每个 op：

1. `op_log` 命中 `opId` → `{status:"duplicate", rev, seq}`
2. 解析 `entity` → 表名（`ENTITY_TABLES`）与 schema（`ENTITY_SCHEMAS`）
3. `upsert`：
   - 读当前行 `select rev, deleted_at from <table> where id=? and user_id=?`
   - 不存在 → 插入，`rev=1`
   - 存在且 `rev !== baseRev` → `{status:"conflict", server:<payload>}`
   - 存在且相等 → 更新，`rev+1`
   - 每次写入都 `INSERT INTO changes(...)`，`deleted=0`；`payload` 用**入库后的实体**（含服务端 rev）
4. `delete`：
   - 不存在 → `{status:"applied", rev:0}`
   - `rev !== baseRev` → conflict
   - 否则 `deleted_at=server now, rev+1`，写 change（`deleted=1`, `payload=null`）
5. 每个 op 的「实体写入 + changes 写入」必须用 `db.batch` 成对提交
6. `updatedAt` 使用 payload 自带值；若与服务器时间偏差超过 24h，用服务器时间覆盖（防设备时钟错误）
7. payload 必须通过 `ENTITY_SCHEMAS[entity].safeParse`，失败 → `{status:"error", error:"validation_error: <path>"}`
8. 服务端强制覆盖：`rev`、`deviceId`（取请求的 `deviceId`），`id` 必须与 op.id 一致

响应 `SyncPushResponse`，并附带当前 `cursor`（`select max(seq) from changes where user_id=?`）。

`GET /api/v1/sync/pull?cursor=&limit=` → `SyncPullResponse`；`limit` 默认 200，最大 500；`hasMore = 取满 limit`。
`GET /api/v1/sync/snapshot` → 每张表 `deleted_at is null` 的 payload 全量 + `cursor`。

**性能**：pull 只查 `changes`，不得 join 各实体表。

### 4.4 通用 CRUD

对 `ENTITY_NAMES` 里的每个实体暴露：

```
GET    /api/v1/:collection                 列表（?limit&cursor&includeDeleted + 实体特有过滤）
POST   /api/v1/:collection                 创建（zod 校验，服务端生成 id/rev/时间戳）
GET    /api/v1/:collection/:id
PATCH  /api/v1/:collection/:id             局部更新（深合并顶层字段）
DELETE /api/v1/:collection/:id             软删除
```

`collection` 映射：`task→tasks, goal→goals, inbox→inbox, okr→okrs, kr→key-results, kpi→kpis, kpiEntry→kpi-entries, pomodoro→pomodoro-sessions, mindMap→mind-maps, mindNode→mind-nodes, setting→settings`。

要求：
- 列表默认 `deleted_at is null`，按 `updated_at desc` 排序，`limit` 默认 100 最大 500
- `tasks` 额外支持 `from/to`（`start_at` 或 `due_at` 落在区间）、`status`、`quadrant`、`goalId`、`q`（title LIKE）
- `kpi-entries` 支持 `kpiId`、`from/to`（date 字符串）
- 所有写操作都追加 `changes` 记录（让同步客户端能看到别人改的）
- 返回的实体必须是完整 payload（含 rev/updatedAt）

### 4.5 设备 / 设置 / API Key / 健康

- `GET /api/v1/devices` 列表；`POST /api/v1/devices/:id`（改名）；`DELETE /api/v1/devices/:id`（吊销该设备会话）
- `GET /api/v1/settings` → `Record<string, unknown>`；`PUT /api/v1/settings`（整体 upsert，走 CRUD 同一条路径）
- `GET/POST /api/v1/api-keys`、`DELETE /api/v1/api-keys/:id`（admin）
- `GET /api/v1/health` → `Health`（不需要鉴权）
- `PATCH /api/v1/auth/password`（admin/会话）

### 4.6 中间件顺序

```
requestId → logger(仅错误) → cors → bodyLimit(1MB) → 路由
  路由内：[csrfGuard] → requireAuth → requireScope
```

错误统一：`ApiError` → `{ok:false,error:{code,message,details}}`；未捕获异常记日志并返回 `internal_error`（生产不泄露堆栈）。

### 4.7 配置

`wrangler.toml`：
```toml
name = "detter-api"
main = "src/index.ts"
compatibility_date = "2026-01-01"
[[d1_databases]]
binding = "DB"
database_name = "detter"
database_id = "TODO_REPLACE"
[vars]
APP_VERSION = "0.1.0"
```
（`database_id` 用占位符，部署时才填；不允许把真实 ID 硬编码进代码。）

`.dev.vars.example` 列出：`SETUP_TOKEN`、`APP_ORIGIN`、`VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`、`VAPID_SUBJECT`。

Node 入口读 `process.env`，端口 `PORT`（默认 8787），数据库文件 `DETTER_DB`（默认 `./data/detter.sqlite`，自动建目录并执行 migrations）。

---

## 5. 验收（必须自己跑通，把输出贴进报告）

```powershell
$pnpm = "D:\Agentproject\deepseek-dsh\个人开发\.tools\node_modules\pnpm\bin\pnpm.cjs"
node $pnpm --filter @detter/api typecheck
node $pnpm --filter @detter/api test
```

测试至少覆盖：
1. setup 只能成功一次（第二次 409）
2. 密码错误登录 401；10 次后 429
3. 无 Cookie 访问 `/api/v1/tasks` → 401
4. Cookie + 缺 `x-detter-csrf` 的 POST → 403
5. push 新建 → rev=1；再 push 同 opId → duplicate
6. push 用过期 baseRev → conflict，且返回 server 版本
7. delete 后 pull 能拉到 `deleted:true` 的墓碑
8. pull 游标递增、limit 生效、`hasMore` 正确
9. CRUD 创建 task 后，`changes` 里有一条记录
10. API Key 只有 `read` scope 时不能 POST

另外手工验证（贴命令与输出）：
```powershell
$env:DETTER_DB=".tmp/t01.sqlite"; $env:SETUP_TOKEN="dev-setup-token"
node apps/api/src/server.ts   # 另开窗口
curl.exe -s http://127.0.0.1:8787/api/v1/health
```

> 注意：`node src/server.ts` 依赖 Node 24 原生 TS 支持；不要在代码里使用 `enum`、`namespace`、参数属性。

---

## 6. 报告要求

最终回复里给出：
1. 文件清单（新增/修改）
2. `typecheck` / `test` 的实际输出（末尾 20 行）
3. 手工验证的 curl 输出
4. 遗留问题与「建议的契约变更」（如有）
5. 你对同步冲突处理的一个具体例子走查（A 设备改标题、B 设备改象限，谁赢、为什么）

不要提交 git（总工统一提交）。
