# T03 · 四象限主页 + 目标栏

> 这是产品的门面。它要在 1 秒内回答一个问题：**我现在该做什么？**

## 0. 目标

把首页做成一块可操作的板子：2×2 四象限，任务卡可以拖、可以右键、可以精确定位；右侧目标栏常驻，目标能一键变成任务。

## 1. 前置

- T02 已完成：`AppShell`、路由、Dexie 仓储（`@/db/repo`）、设计令牌、`@detter/ui` 组件、`pages/QuadrantPage.tsx` 静态占位。
- 契约：`@detter/shared` 的 `Task` / `Goal` schema、`QUADRANT_META`、`deriveQuadrant`。
- 规范：`docs/architecture/04-DESIGN-SYSTEM.md`、`07-FRONTEND-STRUCTURE.md`。

## 2. 文件所有权

你拥有：

```
src/features/quadrant/**      ← 新建
src/features/goals/**         ← 新建
src/components/common/TaskCard.tsx   ← 新建（作为全站统一的任务卡，创建后冻结）
src/components/common/ConfirmDialog.tsx
src/pages/QuadrantPage.tsx    ← 整体重写
```

**不要改**：`src/app/**`、`src/db/**`、`src/sync/**`、`src/lib/**`、`src/components/shell/**`、`packages/ui/**`、`packages/shared/**`、`apps/api/**`。

页面里需要新增「自由布局开关」等全局设置时，用 `settings` 表（通过 `@/db/repo` 存 `quadrant.viewMode`），**不要**改 `stores/ui.ts`。

---

## 3. 布局

### 桌面（≥1024）

```
┌────────────────────────────────────────────────┬──────────────┐
│ 统计条：今日 N · 逾期 N · Q2 占比 N% · [视图切换] │              │
├──────────────────────────┬─────────────────────┤   目标栏      │
│  Q1 重要且紧急            │  Q2 重要不紧急       │   320px       │
│                          │                     │  （可折叠）    │
├──────────────────────────┼─────────────────────┤              │
│  Q3 紧急不重要            │  Q4 不重要不紧急     │              │
└──────────────────────────┴─────────────────────┘              │
```

- 板子 `flex-1 min-w-0`，`grid grid-cols-2 grid-rows-2 gap-4 p-4`，整体 `h-full min-h-0`。
- 每格：`rounded-2xl` + 象限渐变 + 内描边，内部 `flex flex-col min-h-0`。
- 格头 44px：短名 + 计数 badge + 悬停出现的 `+` + 极淡的 hint。
- 格体：`flex-1 overflow-y-auto`，`overscroll-contain`。

### 移动（<768）

- 单列纵向滚动，顶部吸顶分段控件（Q1/Q2/Q3/Q4 + 全部）。
- 每格不再滚动，整页滚动；卡片高度自适应。
- 右上角「⋯」→ 视图切换、排序方式。

---

## 4. 任务卡（`components/common/TaskCard.tsx`）

Props 契约（后续日历/收件箱会复用）：

```ts
export interface TaskCardProps {
  task: Task;
  goal?: Goal | null;
  density?: "comfortable" | "compact";
  dragging?: boolean;
  selected?: boolean;
  onOpen?: (task: Task) => void;
  onToggleDone?: (task: Task) => void;
  onContextMenu?: (task: Task, event: React.MouseEvent) => void;
  onPointerDown?: (task: Task, event: React.PointerEvent) => void;
}
```

视觉（严格按设计令牌）：
- 白底、`--r-lg`、`--shadow-1`；左侧 3px 竖条 = `goal.color`（无目标则透明）。
- 第一行标题 14/20 medium，最多 2 行省略。
- 第二行元信息（有则显示）：时间 chip（今天 15:00 / 明天 / 全天 / 逾期·红）、地点、最多 2 个标签 chip、`+N`。
- hover：`--shadow-2` + `translateY(-1px)`，右上角出现 `⋯`。
- 完成态：`line-through` + `opacity-60` + 竖条变灰，勾选动画 180ms。
- 拖拽态：`scale(1.03)` + `--shadow-3` + `rotate(.4deg)`，`cursor-grabbing`。

**不要把数据请求写进这个组件**，它只负责展示与回调。

---

## 5. 拖拽引擎

用 **Pointer Events**（不要 HTML5 DnD）：

```
pointerdown → 记录起点，setPointerCapture
pointermove → 位移 > 4px 才进入拖拽（避免误触点击）
pointerup   → 计算落点，提交一次
pointercancel / Esc → 取消，回到原位
```

- 拖拽中的浮层：`position: fixed` 的克隆卡片，跟随指针（`transform: translate3d`，用 rAF 合并），`pointer-events: none`。
- 落点判定：`document.elementFromPoint(x, y)` 找最近的 `[data-quadrant]`；没有则取消。
- 落点高亮：目标格 `ring-2`（象限强调色）+ `scale-[1.005]`，180ms。
- 触摸：长按 200ms 进入拖拽（`navigator.vibrate?.(10)` 可选）；期间若指针移动 > 10px 则判定为滚动，取消长按。
- 跨格拖拽自动滚动：靠近边缘 40px 时以 8px/帧 滚动容器。

**坐标写入**（自由模式）：
```ts
const rect = cell.getBoundingClientRect();
const posX = clamp((clientX - rect.left) / rect.width, 0, 1);
const posY = clamp((clientY - rect.top) / rect.height, 0, 1);
```
列表模式下落点只决定 `quadrant` 与 `sortIndex`（按插入位置），`posX/posY` 保持不变。

---

## 6. 两种视图

| 视图 | 说明 | 默认 |
| --- | --- | --- |
| 列表 | 纵向流式，按「逾期 > 今天 > 有截止日 > 其他」+ `sortIndex` 排序 | ✅ |
| 自由 | 绝对定位，`left/top` 由 `posX/posY` 驱动 | 手动切换 |

自由模式的定位写法（**不需要测量卡片尺寸**，保证 0..1 时完整落在格内）：

```css
left: calc(var(--pos-x) * 100%);
top: calc(var(--pos-y) * 100%);
transform: translate(calc(var(--pos-x) * -100%), calc(var(--pos-y) * -100%));
```

视图模式存 `settings` 键 `quadrant.viewMode`（`"list" | "free"`），全局切换；每格保留自己的 `posX/posY`，切回自由模式时空间记忆还在。

---

## 7. 交互清单（逐条实现并自测）

| 操作 | 行为 |
| --- | --- |
| 单击卡片 | 打开右侧/居中详情面板（标题、备注、时间、目标、标签、清单，可编辑） |
| 双击卡片 | 切换完成态（带勾选动画） |
| 右键卡片 | 上下文菜单（见下） |
| 右键空白格 | 「在此新建任务」，以该点为坐标 |
| 双击空白格 | 内联新建：原地出现输入框，Enter 保存 / Esc 取消 |
| 格头 `+` | 内联新建（默认坐标 0.5/0.2） |
| 拖拽卡片 | 换象限 / 改坐标 / 改排序 |
| 拖拽目标到格 | 新建任务并关联该目标，`goal.usageCount++` |
| `Ctrl/⌘ + 方向键` | 选中卡片时移动象限（键盘可达） |
| `Delete` | 删除选中卡片（带 5 秒撤销 toast） |

### 右键菜单项

```
新建任务
─────────
完成 / 取消完成
移动到 ▸ Q1 Q2 Q3 Q4
设置精确坐标…
关联目标 ▸ （列出 active 目标 + 「新建目标」）
─────────
复制标题
删除
```

「设置精确坐标…」弹小面板：X / Y 两个 0–100 的滑块 + 数字输入，**实时预览**卡片位置，确定才写库。

---

## 8. 目标栏（`features/goals/**`）

- 宽 320px（`lg` 以上常驻，`md` 抽屉，`sm` 底部 sheet）。
- 顶部 tab：`一次性 / 周期 / 模板`，下划线指示器 180ms 滑动。
- 目标卡：左侧色点 + 标题 + 副标题（周期目标显示 rrule 人话：每周一 / 每天；一次性显示截止日）+ 右侧进度环或 `N 项`。
- 排序：`sortIndex`，可上下拖动重排（仅同一 tab 内）。
- 目标卡可拖到象限：拖动时板子四个格同时高亮；松手 → 创建任务（`title = goal.title`，`goalId`，坐标=落点）。
- 模板 tab：卡片右侧「铺开」按钮 → 弹出确认（生成几条、分别是什么）→ 批量建任务；`usageCount++`。
- 底部「+ 新建目标」→ 对话框：标题、类型、周期（一次性选截止日 / 周期选重复规则）、颜色（8 个预设色）、图标（12 个预设）、关联 OKR/KR（可留空）。
- 目标详情：点击卡片展开（或抽屉）→ 显示该目标下任务列表 + 完成率 + 里程碑勾选。

---

## 9. 数据规则

- 全部写操作走 `@/db/repo`（自动维护 `outbox`/`updatedAt`/`rev`）。
- 拖拽过程中**只在内存里**更新；`pointerup` 时一次提交。
- 新建任务时必填：`id`（uuidv7）、`title`、`createdAt`、`updatedAt`、`quadrant`、`status: "todo"`。
- 删除走软删除（仓储已处理），UI 立即移除 + 撤销 toast。
- 目标进度 = 该目标下 `status === "done"` 的任务数 / 总数（总数 0 时显示「—」）。

---

## 10. 验收（总工会逐条检查）

1. 新建任务 → 刷新 → 还在，位置正确。
2. 拖到 Q2 → 刷新 → 仍在 Q2；自由模式下坐标偏差 < 2%。
3. 右键 → 设置坐标 → 输入 20/80 → 卡片到左下角。
4. 目标拖到 Q1 → 生成任务且带 `goalId`，目标卡显示 `1 项`。
5. 模板「铺开」→ 生成多条，`usageCount` 增加。
6. 双击完成 → 划线动画 → 刷新后仍完成。
7. 375 宽：单列、可操作、无横向滚动。
8. 键盘：Tab 能聚焦卡片，右键菜单可用方向键选择，Esc 关闭。
9. 219 张卡片时拖拽不卡（可用 devtools 造数据）。
10. 断网：所有操作正常，SyncBadge 显示待同步条数。

---

## 11. 报告

1. 文件清单与职责
2. `typecheck` / `build` / `test` 真实输出
3. 拖拽实现说明（为什么用 pointer events、如何处理触摸与滚动冲突）
4. 自由模式坐标方案的说明（为什么用 transform 而不是测量）
5. 截图或文字描述 3 个宽度下的布局
6. 遗留问题
