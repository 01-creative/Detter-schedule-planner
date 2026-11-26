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

Course（课程）
  ├─◄ Assessment.courseId   1:N（考核构成，带权重）
  ├─◄ Assignment.courseId   1:N（每周作业，按 weekNo）
  ├─► Goal.id（可选，goalId：自动生成的 Task 继承它）
  ├─► Task.id（每个上课时段一条带 rrule 的 event Task，靠 tags 里的 `course:<id>` 关联）
  └─ Assessment.taskId / Assignment.taskId → Task.id（提醒 / 日历 / 四象限只认 Task）

Setting
  └─ courses.semesterStart / courses.periodTimes / courses.homeworkReminder
```

没有外键约束。理由：同步场景下删除是墓碑，外键会阻碍乱序应用；一致性由应用层维护。

**课程 → 日程的唯一约定**：课程是「计划」，Task 是「日程」。
- 上课时段：导入时为每个时段（按周次拆段）建一条带 `rrule` 的 `kind=event` Task，幂等键是标签 `course:<id>` + `slot:<星期-节次-起始周>`；
- 考核项 / 每周作业：每条记录对应一条真实 Task（`taskId` 回指），标题带 `[课程名]` 前缀，`goalId` 继承课程的 `goalId`。
  因为提醒调度扫的是 `tasks` 表、日历与四象限也只读 Task，没有 Task 的记录只是「计划」，不会出现在日程里。

---

## 3. 关键设计决策

### 3.1 Task 与 Event 合一

`kind: "task" | "event"`：
- `task` 有完成态，进四象限；
- `event` 是时间块（上课、会议），到点即过，不要求打卡。

好处：日历和四象限读同一张表，拖拽不用跨模型转换；重复规则只实现一次。

### 3.2 象限是「派生字段」

- `posX / posY` 是事实来源（见 3.3），`quadrant` 保存时由坐标推导；
- `quadrant` 仍写库，因为筛选、统计、接口都用它；
- `importance / urgency`（1..5）与 `manualQuadrant` 是旧入口/同步协议的兼容字段，平面不再用它们推导象限。

旧版按刻度推导的规则仍保留在 `packages/shared/src/quadrant.ts`，供日历、捕获等未改入口使用。

### 3.3 坐标 `posX/posY`：全平面归一化坐标

首页是一张连续的坐标系平面，不是四个容器：

- `posX` = 紧急度，`0` 最左（不紧急）、`1` 最右（紧急）；
- `posY` = 纵向屏幕位置，`0` 最上、`1` 最下；`importance = 1 - posY`；
- `(0.5, 0.5)` 是两条轴的原点；象限由符号自动推导：
  `posX ≥ 0.5 && 1 - posY ≥ 0.5` → Q1，其余同理。

`quadrant` 是派生字段（筛选 / 统计 / 接口仍读它），写入时由坐标推导，不单独接受用户输入。
新任务不传坐标时默认 `(0.44, 0.44)`（Q2 近中心），画板创建时还会按螺旋避让已有点。

旧数据（象限 + 格内相对坐标）通过 `settings["quadrant.coordVersion"] = "plane-v1"` 一次性迁移：

```
x = (q1|q3) ? 0.5 + posX*0.5 : posX*0.5
y = (q1|q2) ? posY*0.5     : 0.5 + posY*0.5
```

迁移会把换算后重合的点错开（仍在原象限内），标记写库后不再执行。

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

课程相关（`packages/shared/src/courses.ts` 里的 `COURSE_SETTING_KEYS`）：

```
courses.semesterStart     "2026-09-07"    学期第 1 周周一；课程自己的 semesterStart 优先
courses.periodTimes       [{start:"08:00",end:"08:45"}, …]  11 节作息，默认川大江安
courses.homeworkReminder  {enabled:true, weekday:7, time:"20:00"}  每周作业遗漏提醒的时刻
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
| `courses` | archived, goal_id |
| `assessments` | course_id, status, kind, due_at |
| `assignments` | course_id, week_no, status, due_at |
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
