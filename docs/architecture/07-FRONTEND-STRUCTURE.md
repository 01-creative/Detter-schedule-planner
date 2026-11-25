# 前端模块化约定（并发开发的防冲突规则）

> 背景：这个项目会同时有 2~3 个执行者并行开发前端。
> 如果每个人都往 `App.tsx`、`repo.ts`、`components/` 里加东西，半天就会变成一团乱麻。
> 所以先定规矩：**按特性垂直切分，共享层只读**。

---

## 1. 目录分层

```
src/
├── app/                 # 【基座所有】应用装配：router、providers、错误边界
├── styles/              # 【基座所有】global.css
├── lib/                 # 【基座所有】api / device / cn / format 等无状态工具
├── db/                  # 【基座所有】Dexie schema + 通用仓储 + hooks
├── sync/                # 【基座所有】同步客户端
├── stores/              # 【基座所有】全局 UI store（只放 UI 状态）
├── components/
│   ├── shell/           # 【基座所有】导航壳
│   └── common/          # 【基座所有】跨特性通用件（空态/加载/错误态）
├── features/
│   ├── quadrant/        # 【T03 所有】
│   ├── goals/           # 【T04 所有】
│   ├── capture/         # 【T05 所有】
│   ├── inbox/           # 【T05 所有】
│   ├── calendar/        # 【T06 所有】
│   ├── focus/           # 【T07 所有】
│   ├── kpi/             # 【T08 所有】
│   ├── okr/             # 【T09 所有】
│   ├── review/          # 【T10 所有】
│   └── mindmap/         # 【T11 所有】
└── pages/               # 薄壳：只做「取数据 + 拼 features 组件」
```

`packages/ui` 是设计系统：**只放无业务语义的展示组件**（Button/Card/Dialog…）。
任何带「任务」「目标」字眼的组件都不属于这里。

---

## 2. 所有权规则（并发时的硬约束）

| 目录 | 谁可以改 |
| --- | --- |
| `app/`、`styles/`、`lib/`、`db/`、`sync/`、`stores/`、`components/shell` | 只有基座（T02）；后续任务**只读** |
| `components/common/` | 只读；需要新公共组件 → 放进自己 feature 里，或在报告里申请 |
| `features/<你的 feature>/` | 只有你；别人只读 |
| `pages/<你的页面>` | 只有你 |
| `app/router.tsx` | **只有总工改**（你要加页面就跑来申请，或由总工统一接） |
| `packages/ui/**` | 只有 T02（T13 打磨阶段移交） |

**需要跨特性复用**怎么办？两条路，按优先级：
1. 你自己的 feature 里再实现一份（成本低、耦合低）；
2. 在报告里写明「建议提升到 common/ui」，由总工决定，避免两人同时改同一个文件。

---

## 3. 数据访问规则

- 所有写操作必须走 `@/db` 暴露的通用仓储（它已经帮你维护 `updatedAt`/`outbox`/`rev`）。
- **不要**在 feature 里直接 `db.tasks.put(...)` 绕过仓储——会漏掉同步队列。
- 只读查询：可以用 `useLiveQuery` 直接查 Dexie，但表名与字段以 `@/db/schema` 为准。
- 需要跨表聚合（如「某目标下所有任务」）：写在自己 feature 的 `queries.ts` 里，不要塞进 `db/repo.ts`。

```ts
// features/kpi/queries.ts 示例
import { db } from "@/db";
export async function getKpiWithEntries(kpiId: string) { ... }
```

---

## 4. 状态规则

| 状态 | 放哪 |
| --- | --- |
| 领域数据（任务/目标/OKR…） | Dexie（`useLiveQuery`） |
| 面板开关、当前 tab、拖拽临时态 | `useUiStore` / feature 内 `useState` |
| 服务端连接状态 | `useSyncStatus()` |
| 表单草稿 | 组件本地 state，需要跨页保留才进 store |

**禁止**把实体数组塞进 Zustand——两份真相必然不一致。

---

## 5. 组件与样式规则

1. 颜色/圆角/阴影/动效一律用 `@detter/ui` 的 CSS 变量，**禁止**硬编码 `#fff`、`12px`、`ease` 这类值（除非是一次性的布局尺寸）。
2. 动效只用 `motion/react`，且只动 `transform` / `opacity`。
3. 每个 feature 至少有：主组件、空态、加载态。
4. 移动端优先思考：先写 375 宽的样式，再用 `md:` / `lg:` 增强。
5. 文案统一中文、动词开头、不用「请」这类客套（例：「新建任务」而不是「请您新建任务」）。

---

## 6. 页面薄壳模板

```tsx
// pages/QuadrantPage.tsx
import { QuadrantBoard } from "@/features/quadrant/QuadrantBoard";
import { GoalRail } from "@/features/goals/GoalRail";

export default function QuadrantPage() {
  return (
    <div className="flex h-full min-h-0">
      <QuadrantBoard />
      <GoalRail />
    </div>
  );
}
```

页面里不写业务逻辑、不写数据请求（除了加载骨架）。

---

## 7. 命名

- 组件：`PascalCase.tsx`；hooks：`useXxx.ts`；纯函数：`camelCase.ts`。
- 导出：具名导出为主，页面用 `default`（给路由懒加载用）。
- 事件处理：`handleXxx`；回调 prop：`onXxx`。

---

## 8. 提交前自检

- [ ] 没有改到别人目录
- [ ] 没有新增 `any`（除第三方类型缺失）
- [ ] 没有 `console.log` 留在交付代码里
- [ ] 375 宽下不横向滚动
- [ ] 键盘能操作主流程
