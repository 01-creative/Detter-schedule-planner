# 数据模型

> 唯一事实来源是 `packages/shared/src/entities.ts` 的 zod schema 与 `apps/api/migrations/0001_init.sql`。
> 本文解释「为什么这样设计」，字段级细节以代码为准。

---

## 1. 通用字段

所有可同步实体都有：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | UUIDv7，**客户端生成**，离线也能建 |
| `createdAt` | number | 毫秒时间戳 |
| `updatedAt` | number | 毫秒；冲突比较的主依据 |
| `deletedAt` | number \| null | 软删除标记（墓碑） |
| `rev` | number | 服务端递增版本，乐观并发 |
| `deviceId` | string | 最后写入的设备 |

**为什么用 UUIDv7**：时间有序、可离线生成、SQLite 索引友好。

---

## 2. 实体关系

```
Goal（目标）
  ├─◄ Task.goalId        1:N
  └─◄ KeyResult.linkedGoalIds（多对多，JSON 数组）

Okr（周期目标）
  └─◄ KeyResult.okrId    1:N（KR 嵌入 OKR 展示，但独立表存储）
        └─◄ Task.krId

Kpi（指标定义）
  └─◄ KpiEntry.kpiId     1:N（按天一条，唯一键 kpiId+date）

Task
  ├─◄ PomodoroSession.taskId   1:N
  └─◄ MindNode.refId（kind=task）

MindMap
  └─◄ MindNode.mapId     1:N（树：parentId 自引用）

InboxItem
  └─► Task.id（分诊后回填 taskId）
```

没有外键约束。理由：同步场景下删除是墓碑，外键会阻碍乱序应用；一致性由应用层维护。

---

## 3. 关键设计决策

### 3.1 Task 与 Event 合一

`kind: "task" | "event"`：
- `task` 有完成态，进四象限；
- `event` 是时间块（上课、会议），到点即过，不要求打卡。

好处：日历和四象限读同一张表，拖拽不用跨模型转换；重复规则只实现一次。

### 3.2 象限是「存储字段 + 可推导」

- `importance` / `urgency` 各 1..5；
- `quadrant` 是实际渲染用的字段，可直接由拖拽改写；
- `manualQuadrant = true` 时不再由刻度推导（避免拖拽后又被算回去）。

推导规则见 `packages/shared/src/quadrant.ts`：两者 ≥3 → Q1；重要≥3 → Q2；紧急≥3 → Q3；否则 Q4。

### 3.3 坐标 `posX/posY`：象限内相对坐标

`0..1` 的相对值（不是像素），因此不同屏幕尺寸下布局一致。拖拽时换算：
`posX = (clientX - cellRect.left) / cellRect.width`，写入前 `clamp(0,1)`。
网格吸附由 UI 决定（默认不吸，按住 Shift 吸到 0.2/0.5/0.8）。

### 3.4 重复任务：一个系列 + 若干实例

- 系列父任务：`rrule` 有值，`recurrenceId = null`；
- 实例：渲染时**不落库**，由 `rrule` 在给定区间展开（虚拟实例）；
- 只有「例外」（改期、跳过、单独完成）才落库：`recurrenceId` 指向父任务，`occurrenceKey` 记录原始开始时间戳。

这样避免无限膨胀，也能正确处理"这一次改到明天"。

### 3.5 OKR 与 KPI 的边界

| | OKR | KPI |
| --- | --- | --- |
| 目的 | 牵引方向（有野心） | 监控健康度（可持续） |
| 周期 | 周/月/季/年 | 天/周/月 |
| 进度 | KR 从 start→target 的百分比 | 达标次数 / 目标次数 |
| 关联 | 挂 Goal 与 Task | 可从番茄钟、任务完成自动聚合 |

一个常见组合：OKR「Q4 提升英语」→ KR「每周 5 次听力」；KPI「每周专注时长 ≥ 10h」由番茄钟自动汇总。

### 3.6 设置项

`settings` 是 `key/value` 表，`value` 为任意 JSON。约定键：

```
appearance.theme         "light" | "dark" | "system"
appearance.accent        "#6355F6"
capture.defaultQuadrant  2
focus.pomodoro           {focusMin, shortBreakMin, longBreakMin, longBreakEvery}
notify.channels          ["webpush"]
ai.enabled               boolean
ai.mcpEnabled            boolean
```

---

## 4. 投影列（DB 里的冗余字段）

为了让 SQL 能过滤，部分实体在表里冗余了少量列，写入时从 payload 派生：

| 表 | 投影列 |
| --- | --- |
| `tasks` | status, quadrant, kind, goal_id, start_at, due_at, completed_at |
| `goals` | status, kind, sort_index |
| `inbox_items` | status, captured_at |
| `okrs` | period, period_start, status |
| `key_results` | okr_id |
| `kpis` | sort_index |
| `kpi_entries` | kpi_id, date |
| `pomodoro_sessions` | task_id, started_at |
| `mind_nodes` | map_id, parent_id |
| `settings` | key（唯一索引 user_id+key） |

**payload 才是权威**：读取时以 payload 为准，投影列只用于 `where/order by`。
派生函数集中在 `apps/api/src/db/projections.ts`，**任何新增实体都必须同时更新它**。

---

## 5. 索引与容量

单人 5 年数据量估算：
- 任务 ~ 20/天 × 1800 天 = 36000 行
- 番茄钟 ~ 6/天 = 10800 行
- KPI 条目 ~ 5 指标 × 1800 = 9000 行

D1 免费额度 5GB / 500 万行读/天，**完全够**。SQLite 在这个量级下所有查询都在毫秒级。

必须存在的索引（已在迁移里）：

```
tasks(user_id, deleted_at, status)
tasks(user_id, start_at)
tasks(user_id, due_at)
tasks(user_id, goal_id)
changes(user_id, seq)
kpi_entries(user_id, kpi_id, date)
```

---

## 6. 数据导出格式

`GET /api/v1/export/json`：
```json
{
  "format": "detter-export-v1",
  "exportedAt": 1764...,
  "user": { "displayName": "..." },
  "entities": { "task": [ ... ], "goal": [ ... ], ... }
}
```

`GET /api/v1/export/markdown?range=week`：给 AI 阅读的周报（见 06-AI-INTEGRATION）。

`GET /api/v1/export/ics`：日历订阅，只导出 `kind=event` 与有 `startAt` 的 task。
