# AI 集成

> 目标：**让任何 AI 客户端（Claude Desktop / Cursor / Cherry Studio / 自建 agent / 手机快捷指令）都能读写你的日程**，
> 而不把产品绑死在某个模型或某个平台上。

三条通道，按接入成本从低到高：

| 通道 | 适合 | 是否需要 Key |
| --- | --- | --- |
| ① 上下文包导出（复制粘贴） | 临时分析、"帮我看看这周" | 不需要 |
| ② REST API | 脚本、iOS 快捷指令、自动化 | 需要 |
| ③ MCP Server | Claude Desktop / Cursor 等直接接管 | 需要 |

---

## 1. 凭证模型

```
Authorization: Bearer dtk_<8位prefix>_<32位secret>
```

- 在「设置 → AI 接入」里创建，**明文只显示一次**。
- scope：`read` / `write` / `admin`。给 AI 用 `write`，不要给 `admin`。
- 可设置过期时间；列表里能看到 `lastUsedAt`（发现异常立刻吊销）。
- 所有写操作进 `audit_log`，actor 记为 `apikey:<prefix>`。

---

## 2. 上下文包（Context Pack）

### 2.1 用途

把「AI 需要知道的一切」压缩成一份结构化文档，用户复制给任意 AI：
- 这周有哪些任务、哪些逾期
- 目标与 OKR 进展
- KPI 达成情况、专注时长
- 收件箱里待整理的东西
- 给模型的操作建议（能调用哪些工具、字段含义）

### 2.2 接口

```
GET /api/v1/context/pack?range=week&format=markdown
GET /api/v1/context/pack?range=today&format=json
```

`range`: `today | week | month | quarter`

### 2.3 JSON 结构

```json
{
  "generatedAt": 1764...,
  "range": "week",
  "period": { "start": 1764..., "end": 1764..., "label": "2026-11-23 周" },
  "profile": { "displayName": "", "timezone": "Asia/Shanghai", "quadrantScheme": "eisenhower" },
  "tasks": [ { "id": "...", "title": "...", "quadrant": 1, "status": "todo", "dueAt": 1764..., "goal": "高数不挂科" } ],
  "goals": [ { "id": "...", "title": "...", "kind": "recurring", "progress": 0.4 } ],
  "okr": [ { "objective": "...", "krs": [ { "title": "...", "current": 3, "target": 5 } ] } ],
  "kpis": [ { "name": "深度工作时长", "value": 620, "target": 900, "unit": "分钟" } ],
  "pomodoro": { "sessions": 12, "focusMinutes": 300 },
  "inbox": [ { "id": "...", "rawText": "明天下午3点 交高数作业" } ],
  "stats": { "doneThisWeek": 9, "overdue": 2, "q2Ratio": 0.42 },
  "briefing": "本周共 23 项任务，完成 9 项；2 项逾期；Q2（重要不紧急）占比 42%，偏低；深度工作 5 小时，未达 KPI 目标 15 小时。"
}
```

### 2.4 Markdown 形态（给聊天窗口粘贴）

```markdown
# Detter 周报 · 2026-11-23 ~ 2026-11-29

## 一句话总结
本周 23 项任务完成 9 项，逾期 2 项；深度工作 5h（目标 15h）。

## 四象限分布
- Q1 重要且紧急：4 项（2 项逾期）
- Q2 重要不紧急：10 项  ← 本周重心
...

## 待办清单
- [ ] 交高数作业（明天 15:00，@高数不挂科）  
...

## 目标进展
- 高数不挂科（周期）：40%
...

## 你可以这样帮我
1. 把收件箱里的 5 条整理到合适象限
2. 指出哪三件事最该今天做
3. 把「复习线代」拆成 3 个 45 分钟的子任务
```

---

## 3. MCP Server

### 3.1 传输

`POST /api/v1/mcp` —— JSON-RPC 2.0 over HTTP（Streamable HTTP，无 SSE 长连接；请求-响应足够）。

```
Authorization: Bearer dtk_...
Content-Type: application/json
```

支持方法：`initialize`、`tools/list`、`tools/call`、`ping`。

### 3.2 客户端配置示例

**Claude Desktop**（`claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "detter": {
      "type": "http",
      "url": "https://your-domain.com/api/v1/mcp",
      "headers": { "Authorization": "Bearer dtk_xxxxxxxx_yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy" }
    }
  }
}
```

**Cursor**（`.cursor/mcp.json`）同上结构。

### 3.3 工具清单

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `list_tasks` | `from?` `to?` `status?` `quadrant?` `goalId?` `limit?` | 查任务 |
| `get_task` | `id` | 单条详情 |
| `create_task` | `title` `quadrant?` `dueAt?` `startAt?` `goalId?` `tags?` `notes?` | 建任务 |
| `update_task` | `id` + 任意字段 | 改任务 |
| `complete_task` | `id` | 标记完成 |
| `delete_task` | `id` | 软删除 |
| `list_goals` | `status?` `kind?` | 查目标 |
| `create_goal` | `title` `kind?` `horizon?` `rrule?` | 建目标 |
| `update_goal` | `id` + 字段 | 改目标 |
| `capture` | `text` | 快速捕获（走同一套 NLP） |
| `list_inbox` | `status?` | 收件箱 |
| `triage_inbox` | `id` `patch` | 把收件箱条目转成任务 |
| `get_okr` | `period?` `periodStart?` | OKR + KR |
| `set_key_result` | `krId` `currentValue` | 更新 KR 进度 |
| `log_kpi` | `kpiId` `value` `date?` | KPI 打卡 |
| `get_kpi_summary` | `from?` `to?` | KPI 达成率 |
| `get_agenda` | `date?` | 某天日程（默认今天） |
| `get_context_pack` | `range?` | 上下文包 |
| `search` | `q` `limit?` | 全局搜索（任务/目标/收件箱） |

**设计原则**：
- 工具名用动词开头，参数扁平，避免嵌套对象（模型更容易填对）。
- 时间参数一律**毫秒时间戳**，并在 `description` 里写清楚时区约定。
- 每个工具返回结构化 JSON，不返回大段 Markdown（让模型自己组织语言）。

### 3.4 工具描述示例

```json
{
  "name": "create_task",
  "description": "在 Detter 中创建一条任务。时间用毫秒时间戳（本地时区 Asia/Shanghai）。quadrant: 1=重要且紧急, 2=重要不紧急, 3=紧急不重要, 4=不重要不紧急。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "title": { "type": "string" },
      "quadrant": { "type": "integer", "minimum": 1, "maximum": 4 },
      "dueAt": { "type": "number", "description": "截止时间，毫秒时间戳" },
      "goalId": { "type": "string" },
      "tags": { "type": "array", "items": { "type": "string" } }
    },
    "required": ["title"]
  }
}
```

---

## 4. 典型用法

### 4.1 "帮我把收件箱整理一下"

```
用户：这是我的上下文包 <粘贴 Markdown>，把收件箱里的条目按四象限分好，
     每条给一个 1 行的理由，并把能关联到现有目标的标出来。
```

AI 输出建议 → 用户确认 → 用 `triage_inbox` 批量写入（或手动点几下）。

### 4.2 "每天早上给我一份今日计划"

定时脚本：`GET /context/pack?range=today&format=markdown` → 丢给模型 → 推送回微信/邮件。
（这一层不在本产品内，属于用户自己的自动化，接口已备好。）

### 4.3 "我这个月到底在忙什么"

`GET /context/pack?range=month` → 分析 Q2 占比、目标推进情况、KPI 偏离。

---

## 5. 安全约束

1. **AI 不是特权方**：与人类请求走同一套 zod 校验、scope 检查、审计。
2. **不做隐式授权**：AI 不能创建 API Key、不能改密码（那是 `admin` scope，不给 AI）。
3. **可撤销**：任何时刻吊销 key，立即失效。
4. **可追溯**：`audit_log` 记录 `apikey:<prefix>` 的每次写操作。
5. **不泄露内部结构**：MCP 错误信息只给人类可读的一句话，不回传堆栈/SQL。

---

## 6. 未来（不在 v1）

- 内置 AI 助手（在应用内对话，走服务端代理的模型 Key）——等前端稳定后再做。
- 语音捕获（Web Speech API → 同一套 NLP）。
- 自动周报生成（Cron + 模型摘要 → 推送）。
