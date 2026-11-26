import { useCallback, useMemo, useState } from "react";
import { BookOpen, CalendarCog, FileUp, Plus, Sparkles } from "lucide-react";
import type { Course } from "@detter/shared";
import { Button, Dialog, useToast } from "@detter/ui";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingState } from "@/components/common/LoadingState";
import { PageHeading } from "@/components/common/PageHeading";
import { useActiveGoals } from "@/db/hooks";
import { CourseCard } from "./CourseCard";
import { CourseEditDialog } from "./CourseEditDialog";
import { CourseSettingsPanel } from "./CourseSettingsPanel";
import { HomeworkCatchUpDialog } from "./HomeworkCatchUpDialog";
import { ImportTimetableDialog } from "./ImportTimetableDialog";
import {
  addAssignment,
  createCourse,
  saveCourseSettings,
  type CourseDraft,
} from "./courseActions";
import { buildCourseCards, defaultSemesterStart, weekOverview } from "./coursesModel";
import { useCoursesData, useNow } from "./queries";

/**
 * /courses 主视图。
 *
 * 页面回答三个问题（顺序即视觉优先级）：
 *   1. 这周还有哪门课没记作业？（顶部横幅，只有存在遗漏时才出现）
 *   2. 每门课占多少分、下一个死线是什么？（课程卡）
 *   3. 课表从哪来？（导入入口；首次使用是空态里的主按钮）
 *
 * 所有派生数字走 coursesModel 的纯函数，组件不自己算权重。
 */
export function CoursesView() {
  const { courses, assessments, assignments, semesterStart, periodTimes, homeworkReminder, loading } =
    useCoursesData();
  const goals = useActiveGoals();
  const now = useNow();
  const { toast } = useToast();

  const [importOpen, setImportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [catchUpOpen, setCatchUpOpen] = useState(false);

  const cards = useMemo(
    () => buildCourseCards(courses, assessments, assignments, now, semesterStart),
    [courses, assessments, assignments, now, semesterStart],
  );
  const overview = useMemo(() => weekOverview(cards), [cards]);
  const effectiveSemesterStart = semesterStart ?? defaultSemesterStart(now);

  const handleCreate = useCallback(
    async (draft: CourseDraft) => {
      try {
        const course = await createCourse(draft, courses.length);
        toast({ title: `已创建「${course.name}」`, description: "接下来给它加考核项与每周作业", tone: "success" });
      } catch {
        toast({ title: "创建失败，稍后再试", tone: "danger" });
      }
    },
    [courses.length, toast],
  );

  const handleSaveSettings = useCallback(
    async (input: Parameters<typeof saveCourseSettings>[0]) => {
      await saveCourseSettings(input);
      toast({ title: "课程设置已保存", tone: "success" });
    },
    [toast],
  );

  const handleCatchUpAdd = useCallback(
    async (course: Course, weekNo: number, title: string) => {
      try {
        await addAssignment(course, { title, weekNo, dueAt: null, note: "", status: "todo" });
        toast({ title: `已记下「${course.name}」第 ${weekNo} 周作业`, tone: "success" });
      } catch {
        toast({ title: "没记上，稍后再试", tone: "danger" });
      }
    },
    [toast],
  );

  return (
    <div className="mx-auto w-full max-w-6xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <PageHeading
          eyebrow={overview.weekNo === null ? "把课表、考核与作业放在一处" : `学期第 ${overview.weekNo} 周`}
          title="课程"
          description="从教务系统导入课表，把老师的考核构成与每周作业记下来；每一个考核项都会变成真实日程，到点提醒。"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setSettingsOpen(true)}
            leftIcon={<CalendarCog className="size-3.5" aria-hidden="true" />}
          >
            课程设置
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setImportOpen(true)}
            leftIcon={<FileUp className="size-3.5" aria-hidden="true" />}
          >
            导入课表
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => setCreateOpen(true)}
            leftIcon={<Plus className="size-3.5" aria-hidden="true" />}
          >
            新建课程
          </Button>
        </div>
      </header>

      {loading ? (
        <LoadingState rows={3} className="mt-6" />
      ) : courses.length === 0 ? (
        <EmptyState
          className="mt-10"
          icon={<BookOpen className="size-5" aria-hidden="true" />}
          title="先把这学期的课表导进来"
          description="在教务系统打开「本学期课程表」→ 另存为网页 → 选那个 HTML。会自动生成每周重复的上课日程，之后再加考核项与作业。"
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                size="sm"
                variant="primary"
                onClick={() => setImportOpen(true)}
                leftIcon={<FileUp className="size-3.5" aria-hidden="true" />}
              >
                导入课表
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCreateOpen(true)}>
                手动建一门课
              </Button>
            </div>
          }
        />
      ) : (
        <>
          {overview.missingCount > 0 && (
            <div
              role="status"
              className="mt-5 flex flex-wrap items-center gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3"
            >
              <Sparkles className="size-4 shrink-0 text-warning-ink" aria-hidden="true" />
              <p className="min-w-0 flex-1 text-body text-warning-ink">
                这周有 <span className="tabular font-strong">{overview.missingCount}</span> 门课还没记作业：
                <span className="text-ink-700">
                  {overview.missing.slice(0, 4).map((item) => item.course.name).join("、")}
                  {overview.missingCount > 4 ? ` 等 ${overview.missingCount} 门` : ""}
                </span>
              </p>
              <Button size="sm" variant="secondary" onClick={() => setCatchUpOpen(true)}>
                去补记
              </Button>
            </div>
          )}

          <p className="mt-4 text-caption text-ink-500">
            共 <span className="tabular font-strong text-ink-900">{cards.length}</span> 门课 ·{" "}
            <span className="tabular font-strong text-ink-900">{assessments.length}</span> 项考核 ·{" "}
            <span className="tabular font-strong text-ink-900">{assignments.length}</span> 条作业记录
            {semesterStart === null && !courses.some((course) => course.semesterStart) && (
              <span className="ml-2 text-warning-ink">（还没设置学期起点，先在「课程设置」里填第 1 周周一）</span>
            )}
          </p>

          <div className="mt-3 grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
            {cards.map((card) => (
              <CourseCard key={card.course.id} card={card} />
            ))}
          </div>
        </>
      )}

      <ImportTimetableDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        defaultSemesterStart={effectiveSemesterStart}
        periodTimes={periodTimes}
        onImported={(result, importedSemesterStart) => {
          // 首次导入时把学期起点存成全局设置：之后新建的课程、MCP 的 add_assignment 都用得上
          if (semesterStart === null) {
            void saveCourseSettings({ semesterStart: importedSemesterStart });
          }
          if (result.seriesCreated > 0) {
            toast({
              title: `导入了 ${result.seriesCreated} 条上课日程`,
              description: `${result.coursesCreated} 门新课程 · 跳过 ${result.seriesSkipped} 条已存在`,
              tone: "success",
            });
          }
        }}
      />

      <CourseEditDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        course={null}
        goals={goals}
        onSubmit={(draft) => void handleCreate(draft)}
      />

      <Dialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title="课程设置"
        description="这些值存在 settings 表里，跟着账号跨设备同步。"
        size="md"
      >
        <CourseSettingsPanel
          semesterStart={semesterStart}
          periodTimes={periodTimes}
          homeworkReminder={homeworkReminder}
          onSave={handleSaveSettings}
        />
      </Dialog>

      <HomeworkCatchUpDialog
        open={catchUpOpen}
        onOpenChange={setCatchUpOpen}
        gaps={overview.missing.map((card) => ({ course: card.course, weekNo: card.weekNo ?? 1 }))}
        onAdd={(course, weekNo, title) => void handleCatchUpAdd(course, weekNo, title)}
      />
    </div>
  );
}
