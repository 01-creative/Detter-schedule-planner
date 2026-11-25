# T05 · 快速捕获 + 收件箱

> 整个产品最核心的价值：**记一下这件事，必须比忘记它还快。**

## 0. 目标

- 任何入口（快捷键 / 手机主屏 / 分享菜单 / API）落进来的内容，都能在 **3 秒内**完成一次记录。
- 记录只是开始：收件箱要能**低成本地整理**（一次点击把「一条文本」变成「一条有象限、有目标、有时间的任务」）。

## 1. 前置

- T02 已完成：`features/capture/CapturePanel.tsx` 最小版、`stores/capture.ts`、`@/db/repo`、`pages/InboxPage.tsx` 占位。
- 契约：`@detter/shared` 的 `parseQuickCapture`、`InboxItem`、`ParsedDraft`、`summarizeDraft`。
- 规范：`04-DESIGN-SYSTEM.md`（6.5 捕获面板）、`07-FRONTEND-STRUCTURE.md`。

## 2. 文件所有权

你拥有：

```
src/features/capture/**     ← 整体重写（替换 T02 的最小版）
src/features/inbox/**       ← 新建
src/pages/InboxPage.tsx     ← 整体重写
```

**不要改**：`src/app/**`（面板已由 providers 挂载）、`src/db/**`、`src/sync/**`、`src/components/**`、`packages/**`。

---

## 3. 捕获面板（桌面）

### 3.1 交互

```
Ctrl/⌘ + K            打开（已在全局绑定）
Ctrl/⌘ + Shift + K    打开并聚焦「快速模式」
Esc                   关闭（有内容时二次 Esc）
Enter                 保存并**保持打开**（连续记录）
Ctrl/⌘ + Enter        保存并关闭
Ctrl/⌘ + Shift + Enter 保存为 Q1（重要且紧急）
↑ / ↓                 在候选目标/标签建议间移动
Tab                   接受当前建议
```

- 位置：`top: 18vh` 居中，宽 `min(640px, calc(100vw - 32px))`，`--r-xl`，`--shadow-3`，背板 `backdrop-blur`。
- 输入框：单行自动增高到 5 行（`textarea` + auto-resize），无边框，字号 16/24，placeholder 示例句。
- **不阻塞输入**：解析在 `requestIdleCallback` / 16ms 防抖里做，不要每个按键都重排。

### 3.2 解析预览（关键体验）

输入框下方一行 chips，实时反映解析结果：

```
[明天 15:00] [#作业] [@高数不挂科] [在教三] [40分钟] [Q1]
```

- 每个 chip 可点击 → 打开微调（改时间 / 移除标签 / 换目标 / 改象限）。
- 解析失败的原文保持原样，不显示错误。
- 置信度 < 0.5 时，在 chips 末尾显示一句淡提示：「已按原文记录，可稍后整理」。

### 3.3 保存逻辑

1. 用 `parseQuickCapture(text, { goals: activeGoals })` 解析
2. 写入 `inbox` 表：`rawText`、`parsed`、`source`、`status: "pending"`、`capturedAt`
3. 若用户显式按了「保存为 Q1」→ 同时创建 task（`status: todo`）并标记 inbox 为 `triaged`
4. 成功反馈：面板顶部一条 1.2s 的「已收进盒子 ✓」+ 输入框清空
5. 失败（极少）：保留输入，toast 错误，**绝不丢文本**

### 3.4 移动端

- 底部 FAB 打开 **底部 sheet**（不是居中弹窗），输入框自动聚焦，键盘弹起时 sheet 上推。
- sheet 顶部一排快捷 chip：`今天` `明天` `本周` `Q1` `Q2`，点一下就把对应 token 插入文本。
- 右下角「完成」按钮（约 48px 高）——手机上没有 Ctrl+Enter。

---

## 4. 收件箱页（`/inbox`）

### 4.1 布局

```
┌────────────────────────────────────────────────┐
│ 待整理 12 条    [全部/今天/更早]  [批量选择] [全部整理]│
├────────────────────────────────────────────────┤
│ 今天                                            │
│ ┌──────────────────────────────────────────┐   │
│ │ 明天下午3点 交高数作业 #作业               │   │
│ │ [明天 15:00] [#作业] [Q1]     [转任务] [⋯] │   │
│ └──────────────────────────────────────────┘   │
│ ...                                             │
└────────────────────────────────────────────────┘
```

- 按 `capturedAt` 分组：今天 / 昨天 / 更早。
- 每条：原始文本（最多 2 行）+ 解析 chips + 右侧操作。
- 空态：一句「盒子是空的，说明你还没忘事」+ 快捷键提示。

### 4.2 操作

| 操作 | 行为 |
| --- | --- |
| 「转任务」 | 打开任务编辑器，**预填解析结果**，保存后 inbox 标记 `triaged` 并写 `taskId` |
| 「一键整理」 | 直接按解析结果建任务（用 `quadrantGuess`），不打开编辑器 |
| 编辑原文 | 内联编辑，重新解析 |
| 归档 | `status: "archived"`（不建任务，保留可查） |
| 删除 | 软删除 + 撤销 |
| 批量选择 | 多选后「全部转任务」/「全部归档」 |
| 「全部整理」 | 把当前所有 pending 依次按解析结果建任务（超过 10 条先确认） |

### 4.3 智能建议（不依赖大模型）

- 目标匹配：文本与已有目标标题做编辑距离/包含匹配，命中则建议 `goalId`（`parseQuickCapture` 已支持 `@`，这里做**无 `@` 时的自动建议**）。
- 相似去重：与 7 天内已有任务 `title` 相似度 > 0.85 时提示「可能重复」。
- 时间冲突：若解析出的时间与已有任务重叠，标注「与 X 冲突」。

---

## 5. 其它入口（本任务只做前两个）

| 入口 | 说明 |
| --- | --- |
| `POST /api/v1/capture` | 后端接口（T12 提供），给 iOS 快捷指令 / 脚本用 |
| PWA `share_target` | 手机系统分享菜单直接分享文本进 Detter（manifest 声明 + `/share` 路由解析 query） |
| 浏览器书签小工具 | `javascript:location='https://…/share?text='+encodeURIComponent(document.title)`（写进文档即可） |

`/share` 路由由你在 router 里申请（总工接线）：收到 `?text=` 或 `?url=` 后直接写入 inbox 并 toast，然后回到首页。

---

## 6. 数据规则

- 所有写入走 `@/db/repo`（自动 outbox）。
- `InboxItem.id` 用 `uuidv7()`。
- 解析必须调用 `packages/shared` 的 `parseQuickCapture`，**不要**在 feature 里另写一套正则。
- 目标列表从 Dexie 读 `goals`（`status === "active"`），传给解析器做 `@` 匹配。

---

## 7. 性能与可靠性

- 面板打开到可输入 < 100ms（组件常驻挂载，`AnimatePresence` 只控制可见性）。
- 连续记录 50 条不卡（列表用虚拟滚动或 `content-visibility: auto`）。
- 输入过程中断网/崩溃：草稿每 500ms 存 `localStorage`（`detter.capture.draft`），重开后恢复。
- 剪贴板粘贴多行：每行独立成一条，先预览确认再批量保存。

---

## 8. 验收

1. 按 `Ctrl/⌘+K` → 输入「明天下午3点 交高数作业 #作业」→ 回车 → 面板不关闭、输入框清空、顶部提示。
2. 打开 `/inbox` → 看到该条 → chips 正确显示「明天 15:00」「#作业」。
3. 点「一键整理」→ 生成任务（Q1/Q2 依据解析），inbox 变 `triaged`。
4. 断网状态下重复 1–3，全部成功（同步队列待发）。
5. 375 宽：FAB → 底部 sheet → 快捷 chip 插入 → 保存成功。
6. 粘贴 3 行文本 → 预览 3 条 → 批量保存 → inbox 出现 3 条。
7. 单测：解析入口（文本→inbox 记录）、批量保存、去重提示阈值。

---

## 9. 报告

1. 文件清单
2. `typecheck` / `build` / `test` 真实输出
3. 「3 秒记录」的实测路径（从按键到落库，多少 ms）
4. 解析预览的降级策略说明
5. 遗留问题
