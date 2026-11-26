import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CalendarPlus, Pencil, Plus, Trash2 } from "lucide-react";
import {
  courseWeekNo,
  summarizeWeights,
  type Assessment,
  type Assignment,
  type Course,
} from "@detter/shared";
import { Badge, Button, Card, Dialog, useToast } from "@detter/ui";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingState } from "@/components/common/LoadingState";
import { useActiveGoals } from "@/db/hooks";
import { AssessmentDialog } from "./AssessmentDialog";
import { AssessmentList } from "./AssessmentList";
import { AssignmentList } from "./AssignmentList";
import { CourseEditDialog } from "./CourseEditDialog";
import { WeightBar } from "./WeightBar";
import {
  addAssessment,
  addAssignment,
  deleteAssessmentRecord,
  deleteAssignmentRecord,
  deleteCourseCascade,
  generateAssessmentTask,
  updateAssessmentRecord,
  updateAssignmentRecord,
  updateCourseRecord,
  type AssessmentDraft,
  type CourseDraft,
} from "./courseActions";
import { ASSESSMENT_KIND_LABEL, courseSubtitle, sortedAssessments, weightStatus } from "./coursesModel";
import { useCoursesData, useNow } from "./queries";

/**
 * 课程详情：权重构成条 + 考核项列表 + 每周作业。
 *
 * 页面结构对应甲方原话的两件事：
 *   「把老师的 PPT 拍下来发给 AI，帮我把这些都记好，在对应时间有提示，并能展示占分」
 *   → 权重条 + 考核项列表（每项都对应一条真实日程）
 *   「记录每周的作业，如果有一周没有手动添加作业还可以提醒我」
 *   → 按周列表 + 缺记提示（补记入口就在列表上方）
 *
 * 权重合计直接调 `@detter/shared#summarizeWeights`，与卡片、MCP、提醒用的是同一份实现。
 */
export function CourseDetailView() {
  const { courseId = "" } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { courses, assessments, assignments, semesterStart, loading } = useCoursesData();
  const goals = useActiveGoals();
  const now = useNow();

  const [editOpen, setEditOpen] = useState(false);
  const [assessmentOpen, setAssessmentOpen] = useState(false);
  const [editingAssessment, setEditingAssessment] = useState<Assessment | null>(null);
  const [deletingAssessment, setDeletingAssessment] = useState<Assessment | null>(null);
  const [deletingCourse, setDeletingCourse] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const course: Course | undefined = courses.find((item) => item.id === courseId);
  const courseAssessments = useMemo(
    () => sortedAssessments(assessments.filter((item) => item.courseId === courseId)),
    [assessments, courseId],
  );
  const courseAssignments = useMemo(
    () => assignments.filter((item) => item.courseId === courseId),
    [assignments, courseId],
  );
  const weightSummary = useMemo(
    () => summarizeWeights(courseAssessments.map((item) => ({ kind: item.kind, weight: item.weight }))),
    [courseAssessments],
  );
  const status = weightStatus(weightSummary);

  const currentWeek = course ? courseWeekNo(course.semesterStart ?? semesterStart, now) : null;
  const missingWeeks = useMemo(() => {
    if (!course?.weeklyHomework || currentWeek === null) return [] as number[];
    const recorded = new Set(courseAssignments.map((item) => item.weekNo));
    return Array.from({ length: Math.min(currentWeek, 60) }, (_, index) => index + 1).filter(
      (week) => !recorded.has(week),
    );
  }, [course?.weeklyHomework, courseAssignments, currentWeek]);

  const handleEditCourse = useCallback(
    async (draft: CourseDraft) => {
      if (!course) return;
      try {
        await updateCourseRecord(course, draft);
        toast({ title: "课程已更新", tone: "success" });
      } catch {
        toast({ title: "保存失败，稍后再试", tone: "danger" });
      }
    },
    [course, toast],
  );

  const handleAssessmentSubmit = useCallback(
    async (draft: AssessmentDraft) => {
      if (!course) return;
      try {
        if (editingAssessment) {
          await updateAssessmentRecord(course, editingAssessment, draft);
          toast({ title: "考核项已更新", description: "关联的日程同步改了", tone: "success" });
        } else {
          await addAssessment(course, draft);
          toast({ title: "已添加考核项", description: "同时生成了一条带截止时间的日程", tone: "success" });
        }
      } catch {
        toast({ title: "保存失败，稍后再试", tone: "danger" });
      } finally {
        setEditingAssessment(null);
      }
    },
    [course, editingAssessment, toast],
  );

  const handleGenerateTask = useCallback(
    async (assessment: Assessment) => {
      if (!course) return;
      setBusyId(assessment.id);
      try {
        const created = await generateAssessmentTask(course, assessment);
        toast({
          title: created ? "已生成日程" : "已更新日程",
          description: "日历与提醒里都能看到它了",
          tone: "success",
        });
      } catch {
        toast({ title: "生成失败，稍后再试", tone: "danger" });
      } finally {
        setBusyId(null);
      }
    },
    [course, toast],
  );

  const handleDeleteAssessment = useCallback(async () => {
    if (!deletingAssessment) return;
    try {
      await deleteAssessmentRecord(deletingAssessment);
      toast({ title: "已删除考核项", tone: "neutral" });
      setDeletingAssessment(null);
    } catch {
      toast({ title: "删除失败，稍后再试", tone: "danger" });
    }
  }, [deletingAssessment, toast]);

  const handleAddAssignment = useCallback(
    async (input: { weekNo: number; title: string; dueAt: number | null }) => {
      if (!course) return;
      try {
        await addAssignment(course, { ...input, note: "", status: "todo" });
        toast({ title: `已记下第 ${input.weekNo} 周作业`, tone: "success" });
      } catch {
        toast({ title: "没记上，稍后再试", tone: "danger" });
      }
    },
    [course, toast],
  );

  const handleAssignmentStatus = useCallback(
    async (assignment: Assignment, next: Assignment["status"]) => {
      if (!course) return;
      try {
        await updateAssignmentRecord(course, assignment, { status: next });
      } catch {
        toast({ title: "更新失败，稍后再试", tone: "danger" });
      }
    },
    [course, toast],
  );

  const handleDeleteAssignment = useCallback(
    async (assignment: Assignment) => {
      if (!course) return;
      try {
        await deleteAssignmentRecord(assignment);
        toast({ title: "已删除这条作业", tone: "neutral" });
      } catch {
        toast({ title: "删除失败，稍后再试", tone: "danger" });
      }
    },
    [course, toast],
  );

  const handleDeleteCourse = useCallback(async () => {
    if (!course) return;
    try {
      const result = await deleteCourseCascade(course);
      toast({
        title: `已删除「${course.name}」`,
        description: `同时清理了 ${result.records} 条考核/作业记录与 ${result.tasks} 条日程`,
        tone: "neutral",
      });
      setDeletingCourse(false);
      void navigate("/courses");
    } catch {
      toast({ title: "删除失败，稍后再试", tone: "danger" });
    }
  }, [course, navigate, toast]);

  if (loading) return <LoadingState rows={4} className="mx-auto mt-6 max-w-4xl" />;

  if (!course) {
    return (
      <EmptyState
        className="mt-10"
        title="这门课不在你的课程列表里"
        description="可能已经删除了，或者链接来自另一台设备（同步完成后会重新出现）。"
        action={
          <Link to="/courses" className="text-caption text-accent underline underline-offset-2">
            回到课程列表
          </Link>
        }
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl">
      <nav aria-label="面包屑" className="flex items-center gap-2 text-caption">
        <Link
          to="/courses"
          className="inline-flex items-center gap-1 rounded-md text-ink-500 transition-colors hover:text-ink-900"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          课程
        </Link>
        <span className="text-ink-300">/</span>
        <span className="min-w-0 truncate text-ink-900">{course.name}</span>
      </nav>

      <header className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              aria-hidden="true"
              className="size-3 shrink-0 rounded-full"
              style={{ backgroundColor: course.color }}
            />
            <h1 className="min-w-0 truncate text-h1 text-ink-900">{course.name}</h1>
            {course.weeklyHomework && <Badge tone="accent">每周有作业</Badge>}
            {course.code && <Badge tone="neutral">课号 {course.code}</Badge>}
          </div>
          <p className="mt-1 text-caption text-ink-500">
            {courseSubtitle({ course, weekNo: currentWeek })}
            {course.semesterStart ? ` · 学期起点 ${course.semesterStart}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setEditOpen(true)}
            leftIcon={<Pencil className="size-3.5" aria-hidden="true" />}
          >
            编辑
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="删除课程"
            className="text-ink-300 hover:text-danger-ink"
            onClick={() => setDeletingCourse(true)}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </header>

      <Card className="mt-4 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-h2 text-ink-900">考核构成</h2>
          <span className="text-micro text-ink-500">
            {courseAssessments.length} 项
            {status === "over" && <span className="ml-1 text-warning-ink">· 合计超过 100%</span>}
          </span>
        </div>
        <WeightBar summary={weightSummary} />

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <h3 className="text-body font-strong text-ink-900">考核项</h3>
          <Button
            size="sm"
            variant="primary"
            leftIcon={<Plus className="size-3.5" aria-hidden="true" />}
            onClick={() => {
              setEditingAssessment(null);
              setAssessmentOpen(true);
            }}
          >
            新增考核项
          </Button>
        </div>
        <AssessmentList
          assessments={courseAssessments}
          busyId={busyId}
          onEdit={(assessment) => {
            setEditingAssessment(assessment);
            setAssessmentOpen(true);
          }}
          onDelete={setDeletingAssessment}
          onGenerateTask={(assessment) => void handleGenerateTask(assessment)}
        />
      </Card>

      <Card className="mt-4 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-h2 text-ink-900">每周作业</h2>
          <span className="text-micro text-ink-500">
            {currentWeek === null ? "先设置学期起点" : `本周是第 ${currentWeek} 周`}
            {missingWeeks.length > 0 && (
              <span className="ml-1 text-warning-ink">· {missingWeeks.length} 周没记</span>
            )}
          </span>
        </div>
        <AssignmentList
          course={course}
          assignments={courseAssignments}
          currentWeek={currentWeek}
          missingWeeks={missingWeeks}
          onAdd={(input) => void handleAddAssignment(input)}
          onStatusChange={(assignment, next) => void handleAssignmentStatus(assignment, next)}
          onDelete={(assignment) => void handleDeleteAssignment(assignment)}
        />
      </Card>

      {course.note && (
        <Card className="mt-4">
          <h2 className="text-h2 text-ink-900">备注</h2>
          <p className="mt-1 whitespace-pre-wrap text-caption text-ink-700">{course.note}</p>
        </Card>
      )}

      <p className="mt-5 flex items-center gap-1.5 text-micro text-ink-300">
        <CalendarPlus className="size-3" aria-hidden="true" />
        每个考核项都对应一条真实日程：到点会在日历与提醒里出现。
      </p>

      <CourseEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        course={course}
        goals={goals}
        onSubmit={(draft) => void handleEditCourse(draft)}
      />

      <AssessmentDialog
        open={assessmentOpen}
        onOpenChange={(open) => {
          setAssessmentOpen(open);
          if (!open) setEditingAssessment(null);
        }}
        editing={editingAssessment}
        remaining={weightSummary.remaining}
        onSubmit={(draft) => void handleAssessmentSubmit(draft)}
      />

      <Dialog
        open={deletingAssessment !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingAssessment(null);
        }}
        title={`删除「${deletingAssessment?.title ?? ""}」？`}
        description="同时会删掉它生成的日程；这项占的分数会回到「未记录」。"
        size="sm"
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={() => setDeletingAssessment(null)}>
              再想想
            </Button>
            <Button size="sm" variant="danger" onClick={() => void handleDeleteAssessment()}>
              删除
            </Button>
          </>
        }
      >
        <p className="text-caption text-ink-500">
          {deletingAssessment
            ? `${ASSESSMENT_KIND_LABEL[deletingAssessment.kind]} · 占总评 ${deletingAssessment.weight}%`
            : ""}
        </p>
      </Dialog>

      <Dialog
        open={deletingCourse}
        onOpenChange={setDeletingCourse}
        title={`删除「${course.name}」？`}
        description="这门课的考核项、作业记录与它们生成的日程都会一起删掉。"
        size="sm"
        dismissible={false}
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={() => setDeletingCourse(false)}>
              取消
            </Button>
            <Button size="sm" variant="danger" onClick={() => void handleDeleteCourse()}>
              删除课程
            </Button>
          </>
        }
      >
        <p className="text-caption text-ink-500">
          共 {courseAssessments.length} 项考核、{courseAssignments.length} 条作业记录。删除是软删除，换设备也能同步。
        </p>
      </Dialog>
    </div>
  );
}
