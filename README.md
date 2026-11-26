# Detter · 个人日程管理

> 把"当时觉得记一下就行、后来一定忘"的小事，3 秒收住，并自动挂到长期目标上。

一个**本地优先、跨设备同步、对 AI 开放**的个人日程管理器。四象限是首页，OKR / KPI / 番茄钟 / 日历 / 思维导图围绕它工作。

---

## 它解决什么问题

| 真实场景 | Detter 的做法 |
| --- | --- |
| 老师随口说的作业、地址、日期，当时记得，一忙就忘 | `Ctrl/⌘+K` 一句话记下，自动解析时间/地点/标签/目标，进收件箱 |
| 记了但懒得整理 | 收件箱一键分诊；也可把整包数据交给 AI 让它整理 |
| 小事和长期目标脱节 | 每条任务可挂目标 / OKR-KR；右侧目标栏常驻 |
| 不知道今天该干什么 | 四象限（重要 × 紧急）拖一下定位 |
| 定了目标落不到日常 | 目标可"铺开"成任务；周期目标按 RRULE 自动出现 |
| 时间投入没反馈 | 番茄钟与任务绑定，自动汇总成 KPI |
| 想用 AI 但不想被平台绑死 | 带 scope 的 API Key + 19 个 MCP 工具 + 上下文包导出 |

---

## 功能一览

- **四象限**：双击空白新建、拖拽跨象限、右键菜单、精确坐标、列表/自由双视图
- **目标栏**：一次性 / 周期性 / 模板三类，拖到象限即生成任务
- **快速捕获**：全局快捷键、解析预览、逐项微调、多行粘贴、断网可写、PWA 分享入口
- **收件箱**：一键分诊、去重提示、冲突提示、批量整理、撤销
- **日历**：日/周/月/议程，拖拽改期，重复事件"只改这一次 / 此后所有 / 整个系列"
- **专注**：不会漂移的番茄钟（刷新/切后台都准）、与任务绑定、提示音
- **KPI**：手工打卡 + 从番茄钟/任务自动聚合、五种聚合方式、手写 SVG 趋势图
- **OKR**：周/月/季/年，四种 KR 度量，进度可拖拽
- **复盘**：一键生成本周/本月复盘（规则生成，不调模型），可复制 Markdown 给 AI
- **思维导图**：目标拆解树，`Tab`/`Enter` 建节点，节点一键变任务
- **AI 接口**：API Key（read/write/admin scope）、REST v1、MCP server、JSON/Markdown/ICS 导出
- **同步**：本地优先（IndexedDB）+ op-log 增量同步，离线可写、联网自动补推

---

## 技术栈

| 层 | 选择 |
| --- | --- |
| 前端 | React 19 · TypeScript · Vite · Tailwind v4 · Motion |
| 本地数据 | IndexedDB（Dexie）+ 事务性 outbox |
| 后端 | Hono —— **同一份代码**跑 Cloudflare Workers 或 Node |
| 数据库 | SQLite 方言：Cloudflare D1 / `node:sqlite` |
| 测试 | Vitest + Playwright 端到端 |

没有任何组件库、没有 ORM、没有 GraphQL。所有 UI 组件自建，令牌驱动。

---

## 快速开始

```bash
# 1. 安装
pnpm install

# 2. 起后端（Node 运行时，零外部依赖）
cd apps/api
pnpm build:node          # 产出 dist/server.js
SETUP_TOKEN=$(openssl rand -hex 24) DETTER_DB=./data/detter.sqlite node dist/server.js

# 3. 起前端
cd apps/web
DETTER_API_TARGET=http://127.0.0.1:8787 pnpm dev
```

打开 <http://127.0.0.1:5173>，用服务端日志里的 `SETUP_TOKEN` 完成初始化。

> **Windows / PowerShell** 用 `$env:SETUP_TOKEN="..."` 的写法。
> 端口被占用时用 `PORT=8788` 与 `DETTER_API_TARGET` 改到别的端口。

---

## 目录结构

```
apps/
  web/                 React 前端（feature 垂直切分，见 docs/architecture/07）
  api/                 Hono 后端（Workers + Node 双运行时）
packages/
  shared/              领域契约：zod schema、同步协议、NLP 解析、象限规则
  ui/                  设计系统：令牌 + 无业务组件
docs/
  architecture/        架构、数据模型、API、同步、设计、安全、AI、前端结构
  tasks/               每个模块的任务书（含验收标准）
  ops/                 部署与运维
deploy/                Dockerfile / compose
scripts/               QA 与构建脚本
```

---

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 同时起 web 与 api |
| `pnpm typecheck` | 全量类型检查 |
| `pnpm test` | 全量单测 |
| `pnpm lint` | ESLint（0 error 为通过） |
| `pnpm build` | 构建前端 |
| `pnpm verify` | typecheck + lint + test + build |
| `pnpm --filter @detter/api build:node` | 打包 Node 版后端 |
| `node scripts/qa-audit.mjs --url=... --password=...` | 全站走查（9 路由 × 2 视口） |

---

## 部署

两条路，代码不变：

- **Cloudflare**：`wrangler d1 create detter` → 填 `apps/api/wrangler.toml` → `wrangler deploy` → 绑自定义域名
- **自有服务器**：`node dist/server.js` 或 `docker compose -f deploy/docker-compose.yml up -d`

详见 [`docs/ops/DEPLOYMENT.md`](docs/ops/DEPLOYMENT.md)。

---

## AI 接入

设置 → AI 接入 → 新建密钥（建议 `read` + `write`，不要给 `admin`）。

```json
{
  "mcpServers": {
    "detter": {
      "type": "http",
      "url": "https://你的域名/api/v1/mcp",
      "headers": { "Authorization": "Bearer dtk_xxxxxxxx_yyyy" }
    }
  }
}
```

工具：`list_tasks / create_task / update_task / complete_task / capture / triage_inbox /
get_agenda / get_okr / log_kpi / get_context_pack / search` 等 19 个。
详见 [`docs/architecture/06-AI-INTEGRATION.md`](docs/architecture/06-AI-INTEGRATION.md)。

---

## 安全

- 单用户：PBKDF2-SHA256（310k 迭代）+ HttpOnly 会话 Cookie + 设备管理
- API Key：只存哈希、scope 最小化、可吊销、写操作进审计日志
- CSRF 三层防护、请求体限流、登录失败锁定、安全响应头
- 全链路 HTTPS（Cloudflare 侧必须 Full (strict)）

详见 [`docs/architecture/05-SECURITY.md`](docs/architecture/05-SECURITY.md)。

---

## 开发约定

- 提交信息用 Conventional Commits；`main` 始终可构建、可部署
- 新功能先读 `docs/tasks/` 里对应任务书，验收标准写在那里
- feature 目录之间不互相 import；共享逻辑进 `packages/shared` 或 `packages/ui`
- 每个改动都要能通过 `pnpm verify`

---

## 许可

私人项目，未开源授权。数据永远属于你自己：随时可用「设置 → 导出」带走全部内容。
