# T15 · 课程能力（课表导入 / 考核构成 / 每周作业 / AI 接入）

> 对应甲方原话：「根据课表网页的保存文件自动解析并添加日程，并支持记录每个课程的考核计划并添加对应的日程……
> 把老师的 PPT 拍下来发给 AI，AI 可以帮我把这些都记好，在对应时间有提示，并能展示占分，
> 然后还可以记录每周的作业，如果有一周我没有手动添加作业还可以提醒我有没有遗忘这个科目的作业。」

---

## 1. 文件清单

### 共享契约（前后端唯一事实来源）

| 文件 | 说明 |
| --- | --- |
| `packages/shared/src/entities.ts` | 新增 `CourseSchema` / `AssessmentSchema` / `AssignmentSchema`，并入 `ENTITY_NAMES` / `ENTITY_SCHEMAS` / `ENTITY_TABLES` / `ENTITY_INDEX_HINTS` |
| `packages/shared/src/timetable.ts` | 课表 HTML 解析器（纯函数，无 DOM）+ 周次/节次/课程名解析 |
| `packages/shared/src/courses.ts` | 课程域纯逻辑：作息换算、周次↔日期、rrule 拆段、课程→Task 映射、权重汇总、遗漏判定、宽松日期/权重解析 |
| `packages/shared/src/api.ts` | `MCP_TOOLS` 增加 7 个课程工具 |
| `packages/shared/src/index.ts`、`package.json` | 导出 `./timetable`、`./courses` |
| `packages/shared/src/__fixtures__/timetable.sample.html` | 从 161KB 真实课表裁出的 3 门课 / 6 个时段夹具（含一个 td 两个课程块） |
| `packages/shared/src/__tests__/timetable.test.ts` | 解析器 28 条断言 |
| `packages/shared/src/__tests__/courses.test.ts` | 课程纯函数 36 条断言 |

### 服务端

| 文件 | 说明 |
| --- | --- |
| `apps/api/migrations/0003_courses.sql` | `courses` / `assessments` / `assignments` 三张表 + 索引 |
| `apps/api/src/db/projections.ts` | 三个新实体的投影列与派生函数 |
| `apps/api/src/repo/crud.ts` | 课程/考核/作业的列表过滤（archived、courseId、kind、status、weekNo、from/to、q） |
| `apps/api/src/routes/crud.ts` | collection 映射：`/courses` `/assessments` `/assignments` |
| `apps/api/src/services/courses.ts` | 课程服务：按名找课/自动建课、考核项+Task、作业+Task、课程计划、学期起点、参数归一化 |
| `apps/api/src/services/courses/digest.ts` | 每周作业遗漏提醒（幂等汇总通知） |
| `apps/api/src/services/mcp.ts` | 7 个课程 MCP 工具（鉴权/审计沿用现有单点实现） |
| `apps/api/src/routes/courses.ts` | 补充端点：`/courses/summary`、`/courses/:id/plan`、`/courses/homework-digest[/check]` |
| `apps/api/src/app.ts` | 注册补充端点（排在通用 CRUD 之前） |
| `apps/api/src/services/reminders/schedule.ts` | `runReminderTick` 增加 digest 阶段与 `summary.digest` |
| `apps/api/src/services/reminders/notifiers/inapp.ts` | 抽出 `writeInappNotification` 供 digest 复用（幂等语义只写一份） |
| `apps/api/tests/courses.test.ts` | 22 条：实体/CRUD 9 条 + MCP 8 条 + 遗漏提醒 5 条 |

### 前端

| 文件 | 说明 |
| --- | --- |
| `apps/web/src/db/schema.ts` | Dexie `version(2)`：`courses` / `assessments` / `assignments` |
| `apps/web/src/db/repo.ts` | 本地表映射 |
| `apps/web/src/features/courses/coursesModel.ts` | 卡片派生、本周概况、权重状态、作业分组、设置解析（纯函数） |
| `apps/web/src/features/courses/queries.ts` | `useCoursesData` / `useNow` |
| `apps/web/src/features/courses/courseActions.ts` | 导入（幂等）、考核项/作业的增删改与 Task 同步、级联删除 |
| `apps/web/src/features/courses/CoursesView.tsx` | 列表页：周次 + 遗漏横幅 + 课程卡网格 + 三个弹窗入口 |
| `apps/web/src/features/courses/CourseCard.tsx` | 课程卡（权重条、本周作业、下一项考核） |
| `apps/web/src/features/courses/CourseDetailView.tsx` | 详情页：权重构成 + 考核项列表 + 每周作业 |
| `apps/web/src/features/courses/WeightBar.tsx` | 权重构成条（按类型分色，超 100% 标黄） |
| `apps/web/src/features/courses/AssessmentList.tsx` / `AssessmentDialog.tsx` | 考核项列表与表单（列表非表格，375 可用） |
| `apps/web/src/features/courses/AssignmentList.tsx` | 按周列出作业 + 快速添加 + 缺记提示 |
| `apps/web/src/features/courses/HomeworkCatchUpDialog.tsx` | 「去补记」弹窗 |
| `apps/web/src/features/courses/ImportTimetableDialog.tsx` | 选文件 → 解析预览 → 学期起点 → 导入结果 |
| `apps/web/src/features/courses/CourseSettingsPanel.tsx` / `CourseSettingsSection.tsx` | 学期起点 / 作息表 / 提醒时刻（设置页与页面弹窗共用） |
| `apps/web/src/features/courses/CourseEditDialog.tsx` | 课程新建/编辑（含每周作业开关、目标关联、颜色） |
| `apps/web/src/pages/CoursesPage.tsx`、`CourseDetailPage.tsx` | 薄壳页面 |
| `apps/web/src/app/router.tsx`、`components/shell/nav-items.ts` | `/courses`、`/courses/:id` 路由；左侧导航「课程」在「日历」下，移动端进「更多」 |
| `apps/web/src/pages/SettingsPage.tsx` | 新增「课程与课表」分区 |
| `apps/web/src/features/courses/__tests__/coursesModel.test.ts`（16 条）、`import.test.ts`（5 条） | 派生逻辑 + 导入幂等 |

### 文档

`docs/architecture/01-DATA-MODEL.md`、`02-API-CONTRACT.md`、`06-AI-INTEGRATION.md` 已同步（实体关系、投影列、settings 键、端点、工具清单与示例）。

---

## 2. 数据模型定稿

```ts
Course     id, name, code, teacher, credits(null), color, semesterStart(YYYY-MM-DD|null),
           weeklyHomework(boolean), note, archived, goalId(null), sortIndex
Assessment id, courseId, title, kind('homework'|'project'|'exam'|'quiz'|'attendance'|'other'),
           weight(0..100), dueAt(null), startAt(null), note, status('planned'|'submitted'|'done'|'graded'),
           score(0..100|null), taskId(null)
Assignment id, courseId, weekNo(1..60), title, dueAt(null), status('todo'|'done'|'skipped'), note, taskId(null)
```

- 三张表都带 `id/createdAt/updatedAt/deletedAt/rev/deviceId`，直接接入现有同步协议（`changes`/`snapshot` 自动包含，已用 push→pull 测试验证）。
- 投影列：`courses(archived, goal_id)`、`assessments(course_id, status, kind, due_at)`、`assignments(course_id, week_no, status, due_at)`；payload 仍是唯一事实来源。
- **Task 是日程的唯一载体**：考核项/作业各生成一条 Task（`taskId` 回指），标题为 `[课程名] 标题`，`goalId` 继承课程；上课时段生成 `kind=event` 的 rrule Task。提醒调度、日历、四象限无需改动即可看到它们。
- 新增两个约定：`sortIndex`（稳定排序）；`Assessment.score` 只在 `graded` 时有意义。

---

## 3. 解析器的结构假设（`parseTimetableHtml`）

1. 课程表位于 `<tbody id="courseTableBody">…</tbody>`；没有时退化为扫描整页 `<td id="{day}_{period}">`，并在 `warnings` 里说明。
2. 单元格 id 的语义：`{day}_{period}`，day ∈ 1..7（**1=周一 … 7=周日，与 ISO 周几一致**），period 为起始节次；`<th id="0_x">`（第 N 节标签）自动跳过。
3. 一个 `<td>` 里可能有多个课程块，每个以 `<div class="… class_div …">` 开头；块内：
   - 课程名：`<p class="p-kcm-N">`（N 是配色序号，解析时用 `p-kcm` 前缀匹配，不写死 3）；
   - 教师 / 周次 / 节次：`<p class="kcb_p_gray">`，按内容分类（含「周」+数字 → 周次；`x-y节` → 节次；其余第一条 → 教师）；
   - 地点：`<p class="p-jxl-N">`；
   - 嵌套的 `<div class="tools">` 不会被当成新的课程块。
4. 课程名去掉末尾 `_42` 这类课程号后缀（仅当后缀是 1~8 位字母数字），后缀存进 `code`；教师去掉 `*`（主讲标记），多位教师保留逗号。
5. 周次：`1-17周`、`1-8周,10-16周`、`1-17周(单)`、`1-16周(双)`、`3-9周单周`、`4-18周双周`、`1-16 周`（空格）、`3周` 都能解析；单双周先剥标记再按奇偶过滤，展开成升序去重数组。
6. 节次缺失时用 td id 的 period 兜底；周次缺失时按第 1 周处理并写 `warnings`。
7. 解析器不抛异常：结构不对返回空 `courses` + `warnings`，导入预览能给出人话提示。
8. 同一门课出现在多个格子 → 合并成一门课 + 多个时段；完全相同的时段去重。

真实文件（2026-2027 秋季，161KB）解析结果：**14 门课 / 15 个时段**（「概率统计（理工）」两周各一次 → 合并为一门课两个时段），与页面上数出来的课程块完全一致。

---

## 4. 节次时间怎么配

- 默认川大江安作息 11 节，存在 `settings["courses.periodTimes"]`（不是组件里的常量）：
  `1:08:00-08:45 2:08:55-09:40 3:10:00-10:45 4:10:55-11:40 5:14:00-14:45 6:14:55-15:40 7:16:00-16:45 8:16:55-17:40 9:19:00-19:45 10:19:55-20:40 11:20:50-21:35`
- 修改入口：`/courses → 课程设置`，以及 `设置 → 课程与课表`（同一个 `CourseSettingsPanel`）；「恢复江安默认」一键还原。
- 读的时候逐项校验，坏值回落到默认；导入时按 `startPeriod` 的 start、`endPeriod` 的 end 组合出真实时间。
- 学期起点 `settings["courses.semesterStart"]`（课程自己的 `semesterStart` 优先）；导入成功且全局为空时，自动把本次使用的学期起点写成全局设置。

---

## 5. 遗漏提醒怎么触发

- 判定：`weeklyHomework = true` 且未归档的课，在「本学期当前周」（按课程/全局学期起点算）没有 `Assignment` 记录；`skipped` 也算记过（明确跳过不再打扰）。
- 提醒时刻：`settings["courses.homeworkReminder"]` 默认 `{enabled:true, weekday:7, time:"20:00"}`（周日 20:00）。
- 实现（选的是「不建重复 Task」那条路）：
  - 在 `runReminderTick` 里加一个 digest 阶段（`services/courses/digest.ts`），**直接写一条 inapp 通知**，幂等键 `homework-digest:<user8>:<本周周一>`；
  - 为什么不建重复 Task：提醒调度只认 Task 的**单个** startAt/dueAt，rrule 展开在渲染层不落库，重复 Task 只能提醒第一次；为什么不用 reminders 表：它的唯一键是 `(task_id, fire_at, channel)`，没有 task 的提醒得造假 task_id。notifications 的 `reminder_id` 唯一索引天然满足「一周最多一条」。
  - 到点才发（`now >= 本周提醒时刻`），`force` 可忽略时间与「已发过」的判断（验收用）。
  - 同一个 `runReminderTick` 也被 Workers cron 与 Node setInterval 共用，所以两种部署方式都自动拥有了这个提醒。
- 入口：`/courses` 顶部横幅「这周有 N 门课还没记作业」+「去补记」弹窗（逐门课输入即记）；详情页按周列出并标出缺记的周。

---

## 6. MCP 工具（参数与返回）

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `list_courses` | `includeArchived?` | 课程 + `weight{total,remaining,byKind}` + `weekNo` + `homeworkMissing` |
| `create_course` | `name` `code?` `teacher?` `credits?` `color?` `semesterStart?` `weeklyHomework?` `note?` `goalId?` | 建课（学分支持小数） |
| `update_course` | `courseId?` / `course?` + 任意字段（含 `archived`） | 改课；找不到报 not_found，不静默新建 |
| `add_assessment` | `courseId?` / `course?` `title` `kind?` `weight?` `date?` `status?` `note?` | 课程不存在按名自动建；**自动建 Task** |
| `add_assignment` | `courseId?` / `course?` `title` `weekNo?` `date?` `status?` `note?` | 自动建课并标记「每周有作业」；周次可由 date 推算，否则用当前周 |
| `get_course_plan` | `courseId?` / `course?` | 考核项 + 权重合计/构成 + 作业历史 + 缺记的周 |
| `set_semester_start` | `date` `courseId?` / `course?` | 写全局设置，或只改一门课 |

宽松容错：日期接受 `2026-12-01`（按当天 23:59）或 ISO / 秒级时间戳；权重接受 `30` / `"30%"` / `"30分"`；课程名支持精确/包含匹配。
写工具都要求 `write` scope 并写 `audit_log`（actor=`apikey:<prefix>`），与现有工具同一套路径。

`add_assessment` 返回示例（`content[0].text` 内是这份 JSON）：

```json
{
  "course": { "id": "01a2…", "name": "英语", "created": true },
  "assessment": { "id": "01a2…", "title": "期末考试", "kind": "exam", "weight": 30,
                  "dueAt": 1798473599999, "status": "planned", "taskId": "01a2…" },
  "task": { "id": "01a2…", "title": "[英语] 期末考试", "dueAt": 1798473599999, "startAt": null },
  "weight": { "total": 30, "remaining": 70, "overflow": 0, "count": 1,
              "byKind": [{ "kind": "exam", "weight": 30, "count": 1 }] }
}
```

生成的 Task（真实存储，可在日历/四象限/提醒里看到）：`title="[英语] 期末考试"`、`quadrant=1`、`dueAt=1798473599999`、
`remindOffsets=[720]`（只写日期时 dueAt 是 23:59，提前 12 小时才是有用的提醒）、`tags=["课程","course:<id>","考核","考试"]`。

---

## 7. 实跑输出

### 7.1 导入真实课表（161KB 四川大学教务系统保存页）

```
[导入预览] {"课程数":14,"摘要":"导入课表 | … | 本学期课程表.html | 选择文件"}
[导入结果] 新建课程 14 | 复用课程 0 | 新建日程 15 | 跳过的时段 0
```

第二次导入同一文件（幂等）：

```
新建课程 0 | 复用课程 14 | 新建日程 0 | 跳过的时段 15
```

### 7.2 curl + API Key 调 `add_assessment`（30% 的考试）

```
== 1) setup ==
{"ok":true,"data":{"initialized":true,"authenticated":true,"scopes":["read","write","admin"],…}}

== 2) 创建 API Key（write scope）==
{"ok":true,"data":{"name":"claude-desktop","prefix":"6QcSeHVl","scopes":["read","write"],…}}

== 3) MCP tools/call add_assessment ==
{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"{\"course\":{\"id\":\"01a2…\",\"name\":\"英语\",\"created\":true},
\"assessment\":{\"title\":\"期末考试\",\"kind\":\"exam\",\"weight\":30,\"dueAt\":1798473599999,
\"status\":\"planned\",\"taskId\":\"01a2…\"},\"task\":{\"title\":\"[英语] 期末考试\",\"dueAt\":1798473599999},
\"weight\":{\"total\":30,\"remaining\":70,\"overflow\":0,\"count\":1,
\"byKind\":[{\"kind\":\"exam\",\"weight\":30,\"count\":1}]}}"}],"isError":false}}

== 4) GET /courses/summary ==
{"ok":true,"data":{"items":[{"name":"英语","assessmentCount":1,
"weight":{"total":30,"remaining":70,"overflow":0,"count":1,
"byKind":[{"kind":"exam","weight":30,"count":1}]},…}]}}

== 5) GET /tasks?q=期末考试 ==
title         : [英语] 期末考试
kind          : task
dueAt         : 1798473599999
quadrant      : 1
remindOffsets : {720}
tags          : 课程,course:01a2…,考核,考试
```

课程页权重显示（列表卡 + 详情页，均取自页面文本）：

```
首张课程卡   概率统计（理工） | 祝亭玉 · 第 12 周 | 已知 30% | / | 剩余 70% 未记录 | 本周已记 1 条作业 | 1 项考核 | 下一项：期末考试 · 2026-12-28
课程详情     … 考核构成 | 1 项 | 已知 30% | / | 剩余 70% 未记录 | 考试 | 30% · 1 项
```

### 7.3 「还没记作业」提示与提醒

```
[列表横幅] 这周有 13 门课还没记作业：学术英语写作、数字电子技术基础实验（Ⅱ）、体育-3匹克球、马克思主义基本原理 等 13 门   去补记
[遗漏提醒（force）] {"emitted":true,"reason":"emitted","weekNo":12,"missing":13,"fireAt":1795953600000,"weekKey":"2026-11-23"}
[应用内通知] [{"title":"本周还有 13 门课没记作业","body":"第 12 周 · 大学物理实验（理工）Ⅲ-2、脚本语言程序设计、马克思主义基本原理、数据库系统及安全、数据思维：数字化生存的未来 等 13 门"}]
```

（14 门课里「概率统计」已记第 12 周作业，所以是 13 门。）

### 7.4 检查项

| 项目 | 结果 |
| --- | --- |
| `pnpm -r typecheck` | 4/4 包通过，0 错 |
| `pnpm -r test` | shared 92 · api 110 · web 302，全绿（本次新增 107 条：解析器 28、课程纯函数 36、API 22、Web 21 —— 其中实体/CRUD 9 条、MCP 8 条 ≥ 5、遗漏提醒 5 条） |
| `pnpm --filter @detter/api build:node` | 通过 |
| `wrangler deploy --dry-run` | 通过（491.25 KiB / gzip 111.47 KiB） |
| `pnpm --filter @detter/web build` | 通过（CoursesPage 15.5KB、CourseDetailPage 20.2KB，均为 lazy chunk） |
| 375 宽横向溢出 | 列表 / 详情 / 导入弹窗均为 `scrollWidth = clientWidth = 375` |
| 控制台错误 | 0 |

---

## 8. 截图

| 截图 | 路径 |
| --- | --- |
| 课程列表 1440 | `docs/screenshots/t15-courses-list-1440.png` |
| 课程列表 375 | `docs/screenshots/t15-courses-list-375.png` |
| 课程详情（含权重条）1440 | `docs/screenshots/t15-course-detail-1440.png` |
| 课程详情（含权重条）375 | `docs/screenshots/t15-course-detail-375.png` |
| 导入预览 1440 | `docs/screenshots/t15-import-preview-1440.png` |
| 导入预览 375 | `docs/screenshots/t15-import-preview-375.png` |

---

## 9. 与需求的对应关系

| 需求 | 落点 |
| --- | --- |
| 课表页保存文件 → 自动解析、添加日程 | `shared/timetable.ts` + `/courses → 导入课表`（预览→学期起点→导入）；每个时段一条 `FREQ=WEEKLY` Task，单双周 `INTERVAL=2`，不连续周次拆段 |
| 记录每门课的考核计划并添加对应日程 | `Assessment` + 自动 Task（`taskId`），「一键生成日程」可补/更新；详情页考核项列表 |
| 有提示、展示占分 | Task 进日历/四象限/提醒（默认提前 12h）；权重构成条与「已知 X% / 剩余 Y%」；MCP 返回权重合计 |
| PPT 拍照 → AI 帮记（宽松容错） | `add_assessment` / `add_assignment`：课程名自动建课、日期 `2026-12-01`/ISO、权重 `30%`/30，鉴权+审计 |
| 记录每周作业 | `Assignment`（weekNo）+ 详情页按周列表与快速添加；每条作业也是 Task |
| 有一周没记 → 提醒有没有遗忘 | `weeklyHomework` + 首页横幅/去补记 + 每周固定时刻（默认周日 20:00）生成应用内汇总通知（幂等） |
| 左侧导航（日历下面）、移动端更多 | `nav-items.ts`：`/courses` 紧跟 `/calendar`；移动端自动进「更多」 |
| 不新增依赖 | 解析只用正则；无 cheerio、无新包 |

---

## 10. 遗留 / 权衡

1. **考核项/作业的 Task 生命周期**：`Task` 完成不会反向把 `Assessment.status` 改成 `graded`（分数需要人工填）。作业的 `done/skipped` 会同步 Task 状态。
2. **直接 `POST /assessments` 不会自动建 Task**：REST 是「纯数据」入口，建日程用 MCP 工具或页面按钮。之所以不在 CRUD 层隐式建 Task，是为了不让通用写入路径产生难以解释的副作用。
3. **作息表最多 11 节**：超过 11 节的时段回落到「同一节 +45 分钟」，并在预览里仍显示原始节次。
4. **单双周用 INTERVAL=2 表达**：如果学校给出 `1-8周,10-16周,18周` 这种非等差序列，会拆成多段 Task（每段一条），不会丢周次但日历上会多出几条系列。
5. **多学期并行**：课程各自带 `semesterStart`，但没有「学期」实体；跨学期归档需手动 `archived`（列表默认不显示归档课）。
6. **解析器只针对川大教务系统版式**：换学校/换版式时改 `timetable.ts` 一处，并补夹具；`warnings` 会指出哪条假设被打破。
