# T02 · 前端基座（设计系统 + App Shell + 本地库 + 同步客户端）

## 0. 一句话目标

交付一个**能跑起来、能离线读写、能和服务端同步**的前端骨架：设计令牌与基础组件、App Shell 与路由、IndexedDB（Dexie）本地库、同步客户端、以及一个「静态四象限」占位页（真实交互由 T03 完成）。

---

## 1. 前置条件（已就绪，直接读，不要改）

| 文件 | 说明 |
| --- | --- |
| `packages/shared/src/**` | 实体 schema、同步协议、NLP、四象限元数据 —— **唯一契约** |
| `docs/architecture/04-DESIGN-SYSTEM.md` | 设计令牌、布局断点、动效规范（**必须严格遵守**） |
| `docs/architecture/00-OVERVIEW.md` | 模块地图与路由表 |
| `apps/api/migrations/0001_init.sql` | 服务端结构（了解字段即可） |

> **禁止修改** `packages/shared/**`、根配置、`apps/api/**`。
> 允许且应当修改：`apps/web/**`、`packages/ui/**`。

---

## 2. 技术约束

- React 19 + TypeScript strict + Vite 7；`verbatimModuleSyntax` 已开，类型导入写 `import type`。
- Tailwind CSS v4（`@tailwindcss/vite`，**无** `tailwind.config.js`，用 CSS 里的 `@theme`）。
- 动画：`motion/react`（framer-motion 新包名）。不要引入其他动画库。
- 本地库：Dexie 4 + `dexie-react-hooks` 的 `useLiveQuery`。
- 状态：Zustand 只放 **UI 状态**（面板开关、当前视图、拖拽中的临时态）；领域数据一律走 Dexie。
- 图标：`lucide-react`。
- 不引入组件库（shadcn/MUI/AntD 全部不要），组件自建，风格由令牌驱动。

---

## 3. 目录与文件所有权

**你只能创建/修改 `apps/web/**` 与 `packages/ui/**`。**

```
apps/web/
├── index.html
├── vite.config.ts
├── vitest.config.ts
├── public/（manifest、图标占位）
└── src/
    ├── main.tsx
    ├── app/
    │   ├── App.tsx
    │   ├── router.tsx
    │   └── providers.tsx
    ├── styles/global.css
    ├── lib/
    │   ├── cn.ts            # clsx + tailwind-merge
    │   ├── api.ts           # 类型化 fetch 封装（自动带 CSRF 头、统一错误）
    │   ├── device.ts        # deviceId 生成与持久化
    │   └── format.ts        # 日期/时长的中文展示
    ├── db/
    │   ├── schema.ts        # Dexie 版本与表定义
    │   ├── index.ts         # db 实例
    │   ├── repo.ts          # 实体读写（自动维护 outbox）
    │   └── hooks.ts         # useLiveQuery 封装
    ├── sync/
    │   ├── client.ts        # push/pull/flush 循环
    │   ├── queue.ts         # outbox 管理
    │   └── useSyncStatus.ts
    ├── stores/
    │   ├── ui.ts
    │   └── capture.ts
    ├── components/
    │   ├── shell/{AppShell,SideNav,TopBar,MobileTabBar,SyncBadge}.tsx
    │   └── common/{EmptyState,LoadingState,ErrorState}.tsx
    └── pages/
        ├── QuadrantPage.tsx      # 静态 2×2 占位（T03 接管）
        ├── InboxPage.tsx
        ├── CalendarPage.tsx
        ├── OkrPage.tsx
        ├── KpiPage.tsx
        ├── FocusPage.tsx
        ├── MindMapPage.tsx
        ├── SettingsPage.tsx
        ├── LoginPage.tsx
        └── SetupPage.tsx
packages/ui/
├── src/styles/tokens.css     # 所有 CSS 变量 + @theme 映射
├── src/lib/cn.ts
├── src/components/
│   ├── Button.tsx Card.tsx Surface.tsx Input.tsx Textarea.tsx
│   ├── Dialog.tsx Sheet.tsx Popover.tsx Menu.tsx Tooltip.tsx
│   ├── Badge.tsx Chip.tsx Progress.tsx Switch.tsx Tabs.tsx
│   ├── Skeleton.tsx Avatar.tsx Divider.tsx EmptyState.tsx
│   └── Toast.tsx（含 useToast）
└── src/index.ts
```

> 需要 Radix 无头组件时可**自行安装**（见第 6 节「依赖规则」），但只允许装 `@radix-ui/react-*`。

---

## 4. 详细规格

### 4.1 设计令牌（`packages/ui/src/styles/tokens.css`）

必须按 `04-DESIGN-SYSTEM.md` 实现：

- 颜色：暖白背景 `--bg`、三层表面、四级墨色、四个象限渐变（Q1 玫瑰 / Q2 翡翠 / Q3 琥珀 / Q4 石板灰）、品牌强调色紫罗兰。
- 圆角：`--r-sm 8px / --r-md 12px / --r-lg 16px / --r-xl 24px / --r-full`。
- 阴影：`--shadow-1/2/3`（低饱和、大模糊、负扩散）。
- 动效：`--ease-out cubic-bezier(.22,1,.36,1)`、`--dur-1 120ms / --dur-2 180ms / --dur-3 260ms / --dur-4 400ms`。
- 字体栈：`-apple-system, "PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", system-ui, sans-serif`。
- 深浅色：默认浅色，`[data-theme="dark"]` 提供完整覆盖（**必须两套都可用**）。
- Tailwind v4：`@import "tailwindcss";` + `@theme { --color-*: … }` 映射，让 `bg-surface` 这类工具类可用。

### 4.2 App Shell

- 桌面（≥ 1024px）：左侧 76px 图标导航栏（可 hover 展开为 220px）+ 顶部 56px 工具条 + 主内容区。四象限页右侧额外 320px 目标栏（T04 填内容，先留 `<aside>` 占位）。
- 平板（768–1023px）：左侧栏折叠为图标；右侧目标栏改为抽屉。
- 移动（< 768px）：顶部极简标题 + 底部 5 个 tab（四象限 / 收件箱 / 日历 / 专注 / 更多），右下悬浮「+」快速记录按钮。
- 顶部工具条：面包屑（当前视图）、全局搜索占位、同步状态徽标、头像菜单。
- 页面切换用 `motion` 的 `AnimatePresence` 做淡入上移（120–180ms），**不要**做花哨的转场。

### 4.3 路由

```
/            → QuadrantPage（首页，RequireAuth）
/inbox       → InboxPage
/calendar    → CalendarPage
/okr         → OkrPage
/kpi         → KpiPage
/focus       → FocusPage
/mindmap     → MindMapPage
/settings    → SettingsPage
/login       → LoginPage
/setup       → SetupPage
```

未初始化（`/api/v1/auth/status` 返回 `initialized:false`）→ 强制跳 `/setup`。
未登录 → 跳 `/login` 并记住 `returnTo`。

### 4.4 本地库（Dexie）

```ts
db.version(1).stores({
  tasks: "id, status, quadrant, goalId, startAt, dueAt, updatedAt, deletedAt",
  goals: "id, status, kind, sortIndex, updatedAt",
  inbox: "id, status, capturedAt, updatedAt",
  okrs: "id, period, periodStart, status, updatedAt",
  keyResults: "id, okrId, updatedAt",
  kpis: "id, sortIndex, updatedAt",
  kpiEntries: "id, kpiId, date, updatedAt",
  pomodoroSessions: "id, taskId, startedAt, updatedAt",
  mindMaps: "id, goalId, updatedAt",
  mindNodes: "id, mapId, parentId, updatedAt",
  settings: "id, key, updatedAt",
  outbox: "++seq, opId, entity, entityId, at",
  meta: "key",          // deviceId / cursor / lastSyncAt
});
```

`repo.ts` 的每次写操作必须：
1. 组装完整合法实体（用 `@detter/shared` 的 schema `.parse` 补齐默认值）
2. `updatedAt = Date.now()`、`rev` 保持本地已知值、`deviceId = 当前设备`
3. 同一事务里写实体 + 追加一条 outbox 记录
4. 触发 `scheduleFlush()`（防抖 800ms）

### 4.5 同步客户端

```ts
// 伪代码，实现时拆成 client.ts / queue.ts
async function push(): Promise<boolean>   // 取 outbox 前 200 条 → POST /sync/push → 处理 results
async function pull(): Promise<void>      // GET /sync/pull?cursor → 逐条 upsert/删除 → 更新 cursor
function start(): void                    // 定时 pull（15s，页面隐藏时暂停）+ visibilitychange 立即 pull
function scheduleFlush(): void            // 800ms 防抖 push
```

结果处理：
- `applied` → 从 outbox 删除该 op，更新实体 rev
- `duplicate` → 删除 op
- `conflict` → 用 `localWins()` 判断：本地胜 → 用服务器 rev 作 baseRev 重新入队；服务器胜 → 覆盖本地实体并删除 op
- `error` → 标记 op 失败次数，超过 3 次移到 `outboxDead` 并在 UI 提示（不要静默丢数据）

同时提供一个 `useSyncStatus()`，暴露 `{state: "idle"|"syncing"|"offline"|"error", pending, lastSyncAt}` 给 `SyncBadge`。

### 4.6 快速记录入口（骨架）

`Ctrl/Cmd+K` 打开捕获面板（`stores/capture.ts` 控制）。T05 会实现解析与分诊，本阶段只需：
- 面板能打开/关闭、输入框聚焦、Esc 关闭
- 回车 → 调用 `parseQuickCapture()`（来自 shared）→ 写入 `inbox` 表（`status: "pending"`）→ toast 提示「已记录」
- 面板里显示解析预览的**极简版**（标题 + 时间 + 标签 chips）

### 4.7 状态页规范

每个页面必须有：空态（有插画感的小图形 + 一句引导 + 主 CTA）、加载态（骨架屏）、错误态（可重试）。不要出现「白屏 + 控制台报错」。

### 4.8 首屏性能

- 路由级 `React.lazy` + `Suspense`；四象限页必须首屏同步加载（它是首页）。
- 不使用大图；图标按需引入。
- 构建产物 gzip 后首页 JS < 250KB（先做到，后续再优化）。

---

## 5. 验收（必须自己跑通，把输出贴进报告）

```powershell
$pnpm = "D:\Agentproject\deepseek-dsh\个人开发\.tools\node_modules\pnpm\bin\pnpm.cjs"
node $pnpm --filter @detter/web typecheck
node $pnpm --filter @detter/web build
node $pnpm --filter @detter/web test
```

额外要求：
1. `pnpm --filter @detter/web dev` 能起在 `http://127.0.0.1:5173`，截图或文字描述首屏。
2. 断开网络（DevTools Offline）后仍能打开页面、能写一条收件箱、刷新后数据还在。
3. 至少 3 个单测：Dexie 读写 + outbox 生成、`localWins` 冲突分支、捕获面板生成 inbox 记录。
4. 深色/浅色切换无对比度问题（贴两张截图或说明）。

> 后端可能还没起好：同步客户端必须能在「服务端不可达」时优雅降级（状态显示「离线」，不报错、不丢数据）。

---

## 6. 依赖规则

- 已装好：react、react-dom、react-router-dom、zustand、dexie、dexie-react-hooks、motion、lucide-react、clsx、tailwind-merge、date-fns、rrule、zod、tailwindcss、vite、vitest、@testing-library/*。
- 需要 Radix 时，用**本地 pnpm**安装并只加进 `apps/web/package.json`：
  ```powershell
  node D:\Agentproject\deepseek-dsh\个人开发\.tools\node_modules\pnpm\bin\pnpm.cjs --filter @detter/web add @radix-ui/react-dialog
  ```
  装完在报告里列出新增依赖与理由。
- **不要**执行根目录的全量 `pnpm install`（会与其它执行者冲突）。

---

## 7. 报告要求

1. 文件清单
2. `typecheck` / `build` / `test` 实际输出
3. 首屏与移动端布局的说明（或截图路径）
4. 同步客户端的状态机说明（离线/在线/冲突三种情况怎么走）
5. 遗留问题

不要提交 git（总工统一提交）。
