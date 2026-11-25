# T12 · AI 接口层（API Key + REST v1 + MCP + 上下文包）

> 用户的原话：「希望给密钥后外部的 agent 可以很方便地处理，同时允许导出后给 AI。」
> 所以这一层的验收标准不是「接口能通」，而是**一个真实的 MCP 客户端能自己把事办了**。

## 0. 目标

1. 在设置页管理 API Key（创建/吊销/看使用时间）。
2. 所有实体都有对外的 REST v1（复用 T01 的 CRUD）。
3. 一个可用的 MCP server（JSON-RPC over HTTP），暴露 19 个工具。
4. 上下文包（Markdown / JSON）与导出（JSON / Markdown / ICS）。

## 1. 前置

- T01 的鉴权（session + api key）与通用 CRUD 已就绪。
- 契约：`packages/shared/src/api.ts` 的 `ApiKeyCreate`、`ContextPack`、`MCP_TOOLS`。
- 文档：`docs/architecture/06-AI-INTEGRATION.md`（工具清单与描述以它为准）。

## 2. 文件所有权

后端：`apps/api/src/routes/apikeys.ts`、`apps/api/src/routes/context.ts`、`apps/api/src/routes/mcp.ts`、`apps/api/src/routes/export.ts`、`apps/api/src/services/context.ts`、`apps/api/src/services/mcp.ts`、`apps/api/tests/mcp.test.ts`

前端：`src/features/settings/ai/**`、`src/pages/SettingsPage.tsx`（AI 区块）

> 注意：T01 已经占用了 `apps/api/src/routes/*` 的大部分文件。开始前先读现状，**只新增/修改上面列出的文件**，不要重构 T01 的代码。

## 3. API Key 管理

- `GET /api/v1/api-keys` 列表（prefix、name、scopes、lastUsedAt、expiresAt）
- `POST /api/v1/api-keys` 创建，响应里**仅此一次**返回明文 `dtk_xxx_yyy`
- `DELETE /api/v1/api-keys/:id` 吊销（软标记 `revoked_at`）
- 前端：
  - 列表 + 「新建密钥」（名字、scope 多选、有效期）
  - 创建成功后弹出一次性展示框：明文 + `复制` + 「我已保存」
  - 每条显示「最后使用：3 小时前」，醒目的「吊销」
  - 顶部一段说明：*建议给 AI 用 read+write，不要 admin*

## 4. REST v1

直接复用 T01 的通用 CRUD（`/tasks`、`/goals` …），本任务只补充：

| 端点 | 说明 |
| --- | --- |
| `POST /capture` | 文本 → 解析 → 落 inbox，返回 `{inboxId, draft, suggestions}` |
| `GET /context/pack` | 上下文包（`range` + `format`） |
| `GET /export/json` | 全量导出（`detter-export-v1`） |
| `GET /export/markdown` | 人类可读周报 |
| `GET /export/ics` | 日历订阅（`text/calendar`，含 RRULE） |

**导出的额外交付**：`Content-Disposition: attachment; filename="detter-2026-11-25.json"`。

## 5. MCP Server

`POST /api/v1/mcp`，JSON-RPC 2.0：

```json
{ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }
{ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": "create_task", "arguments": { "title": "交作业", "quadrant": 1 } } }
```

必须支持：
- `initialize` → 返回 `protocolVersion: "2025-06-18"`、`capabilities: { tools: {} }`、`serverInfo`
- `tools/list` → 19 个工具（`MCP_TOOLS`），每个带 `description` 与 `inputSchema`（JSON Schema）
- `tools/call` → 执行；返回 `{ content: [{ type: "text", text: <json string> }], isError?: false }`
- `ping`
- 错误：`-32601` 方法不存在、`-32602` 参数错误、`-32000` 业务错误（message 人类可读，不含堆栈）

**工具实现要求**：
- 走同一套 repo 层（不要另写 SQL）
- 写操作必须带 scope 检查（`write`）与 `audit_log`
- 时间参数统一毫秒时间戳
- `get_context_pack` 复用 `services/context.ts`

## 6. 上下文包

`services/context.ts` 实现 `buildContextPack(db, userId, { range, format })`：

- 取数：tasks（区间内 startAt/dueAt/completedAt 命中）、goals（active）、okr+krs（当前周期）、kpis+kpiEntries（区间）、pomodoro（区间聚合）、inbox（pending，最多 20 条）
- 计算：完成数/逾期数/Q2 占比/专注分钟/各 KPI 达成率
- 生成 `briefing`：3–5 句中文总结（纯规则拼接，不调模型）
- `format = markdown` 时输出 `06-AI-INTEGRATION.md` §2.4 的版式

## 7. 验收

1. 设置页创建 Key → 明文只显示一次 → 刷新页面看不到明文。
2. `curl -H "Authorization: Bearer dtk_..." /api/v1/tasks` 返回 200。
3. 只有 `read` scope 的 key 调 `POST /tasks` → 403 `scope_insufficient`。
4. 吊销 Key 后立刻 401。
5. `tools/list` 返回 19 个工具且 schema 合法。
6. `tools/call create_task` 建一条任务 → 四象限（刷新后）能看到。
7. `tools/call get_agenda` 返回今天的任务。
8. `get_context_pack` 的 Markdown 粘到任意 AI 里能读懂（人工判断）。
9. 用 **Claude Desktop 或 Cursor** 配置 MCP 后能列出工具并成功建任务（贴配置与截图/文字记录）。
10. `/export/ics` 能被 Google Calendar / 系统日历订阅（贴验证方式）。

## 8. 报告

1. 文件清单
2. `typecheck` / `test` 真实输出
3. MCP 客户端联调的真实记录（请求/响应片段）
4. 上下文包样例（截取 30 行）
5. 安全说明：scope 怎么拦、审计记什么
6. 遗留问题
