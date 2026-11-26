# 接口契约（REST v1）

Base：`/api/v1`

## 0. 信封与错误码

成功：`{ "ok": true, "data": ... }`
失败：`{ "ok": false, "error": { "code": "...", "message": "...", "details": ... } }`

错误码见 `packages/shared/src/api.ts` 的 `API_ERROR_CODES`：
`unauthorized / forbidden / not_found / validation_error / conflict / rate_limited /
payload_too_large / internal_error / not_configured / setup_required / already_initialized /
csrf_failed / scope_insufficient`

HTTP 状态码一一对应：401 / 403 / 404 / 422 / 409 / 429 / 413 / 500 / 503 / 428 / 409 / 403 / 403。

---

## 1. 鉴权

| 方式 | 凭证 | 适用 |
| --- | --- | --- |
| 浏览器会话 | `detter_session` Cookie（HttpOnly, SameSite=Lax, Secure） | Web / PWA |
| API Key | `Authorization: Bearer dtk_<prefix>_<secret>` | AI / agent / 脚本 / 快捷指令 |

- 所有非 GET 的 Cookie 请求必须带 `x-detter-csrf: 1`。
- API Key 的 scope：`read` < `write` < `admin`。
- 每台设备一个 `deviceId`，随同步请求提交，用于冲突判定与设备管理。

### 端点

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/health` | 无 | 健康检查 |
| GET | `/auth/status` | 无 | 初始化/登录状态（未登录也 200） |
| POST | `/auth/setup` | setupToken | 首次初始化，只能成功一次 |
| POST | `/auth/login` | 无 | 登录，下发 Cookie |
| POST | `/auth/logout` | 会话 | 吊销当前会话 |
| GET | `/auth/me` | 会话 | 用户信息 |
| PATCH | `/auth/password` | 会话 | 改密码（需旧密码） |

---

## 2. 同步

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/sync/push` | 批量提交变更（≤500 op） |
| GET | `/sync/pull?cursor&limit` | 增量拉取（limit ≤ 500） |
| GET | `/sync/snapshot` | 全量快照（换设备/游标过期时用） |

请求/响应结构见 `packages/shared/src/sync.ts`。

---

## 3. 实体 CRUD（给 AI、脚本、非同步客户端）

collection 映射：

| entity | 路径 |
| --- | --- |
| task | `/tasks` |
| goal | `/goals` |
| inbox | `/inbox` |
| okr | `/okrs` |
| kr | `/key-results` |
| kpi | `/kpis` |
| kpiEntry | `/kpi-entries` |
| pomodoro | `/pomodoro-sessions` |
| mindMap | `/mind-maps` |
| mindNode | `/mind-nodes` |
| course | `/courses` |
| assessment | `/assessments` |
| assignment | `/assignments` |
| setting | `/settings` |

每个 collection 都支持：

```
GET    /{collection}                 列表
POST   /{collection}                 创建
GET    /{collection}/:id
PATCH  /{collection}/:id             局部更新
DELETE /{collection}/:id             软删除
```

通用查询参数：`limit`(≤500, 默认 100)、`cursor`、`includeDeleted`。

实体特有过滤：

| 路径 | 参数 |
| --- | --- |
| `/tasks` | `from` `to`（毫秒，匹配 startAt 或 dueAt）、`status`、`quadrant`、`goalId`、`okrId`、`q`（标题模糊） |
| `/kpi-entries` | `kpiId`、`from` `to`（YYYY-MM-DD） |
| `/okrs` | `period`、`periodStart`、`status` |
| `/pomodoro-sessions` | `taskId`、`from` `to` |
| `/courses` | `archived`（true=只看归档 / false=只看在用）、`includeArchived`（全部）、`goalId`、`q`（课程名） |
| `/assessments` | `courseId`、`kind`、`status`、`from` `to`（dueAt 毫秒） |
| `/assignments` | `courseId`、`weekNo`、`status`、`from` `to`（dueAt 毫秒） |

### 3.1 课程的补充端点

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/courses/summary` | 课程 + 权重合计 + 本周周次 + 本周是否缺作业 |
| GET | `/courses/:id/plan` | 课程 + 考核项 + 作业快照（脚本/AI 调试用） |
| GET | `/courses/homework-digest` | 预览「这周有几门课没记作业」，不写通知 |
| POST | `/courses/homework-digest/check` | 立即跑一次遗漏提醒；`{force:true}` 忽略「到点才发/本周已发」 |

> 这三个路径必须排在通用 CRUD 之前注册，否则 `/courses/summary` 会被 `/:collection/:id` 当成课程 ID。
> 考核项 / 作业的 Task 是由应用层（MCP 工具或前端写操作）创建的：直接 `POST /assessments` 只落计划，
> 需要日程时用 MCP 的 `add_assessment`，或在页面里点「一键生成日程」。

---

## 4. 设备 / 设置 / 密钥

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/devices` | read | 设备列表 |
| PATCH | `/devices/:id` | write | 改名 |
| DELETE | `/devices/:id` | write | 吊销该设备所有会话 |
| GET | `/settings` | read | `Record<string, unknown>` |
| PUT | `/settings` | write | 批量 upsert |
| GET | `/api-keys` | admin | 密钥列表（不含明文） |
| POST | `/api-keys` | admin | 创建，**仅此一次**返回明文 |
| DELETE | `/api-keys/:id` | admin | 吊销 |

---

## 5. 捕获与 AI

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/capture` | 快速捕获：文本 → 解析 → 落 inbox |
| GET | `/context/pack?range=week&format=json\|markdown` | 生成上下文包给 AI |
| GET | `/export/json` | 全量导出 |
| GET | `/export/markdown?range=week` | 人类可读周报 |
| GET | `/export/ics` | 日历订阅 |
| POST | `/mcp` | MCP（JSON-RPC over HTTP） |

---

## 6. 响应示例

创建任务：

```http
POST /api/v1/tasks
Authorization: Bearer dtk_xxx_yyy
Content-Type: application/json
x-detter-csrf: 1

{ "title": "交高数作业", "quadrant": 1, "dueAt": 1764... }
```

```json
{
  "ok": true,
  "data": {
    "id": "0193...",
    "title": "交高数作业",
    "quadrant": 1,
    "status": "todo",
    "rev": 1,
    "createdAt": 1764...,
    "updatedAt": 1764...,
    "...": "其余字段按 schema 默认值补齐"
  }
}
```

---

## 7. 限流

| 端点 | 限制 |
| --- | --- |
| `/auth/login` | 15 分钟内同 IP 失败 10 次 → 429 |
| `/capture` | 60 次/分钟 |
| 其它写操作 | 300 次/分钟 |
| `/mcp` | 120 次/分钟 |

实现：单用户场景用 D1 计数表 + 内存窗口即可，不引入 Redis / Durable Object。

---

## 8. CORS

默认只允许同源。开发环境允许 `http://127.0.0.1:5173`、`http://localhost:5173`（由 `ALLOWED_ORIGINS` 配置）。
预检请求返回 `Access-Control-Allow-Credentials: true`，只回显白名单内的 Origin。
