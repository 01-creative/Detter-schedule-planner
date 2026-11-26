import { useEffect, useState } from "react";
import { COURSE_COLORS } from "@detter/shared";
import type { Course, Goal } from "@detter/shared";
import { Button, Dialog, Input, Switch, Textarea, cn } from "@detter/ui";
import type { CourseDraft } from "./courseActions";

/**
 * 新建 / 编辑课程。
 *
 * `weeklyHomework` 是「遗漏提醒」的总开关：打开后，这一周没有作业记录时会出现在
 * 「这周有 N 门课还没记作业」里。导入课表时默认打开，没有作业的课在这里关掉即可。
 */
export interface CourseEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  course: Course | null;
  goals: Goal[];
  onSubmit: (draft: CourseDraft) => void;
}

function emptyDraft(): CourseDraft {
  return {
    name: "",
    teacher: "",
    credits: null,
    color: COURSE_COLORS[0],
    weeklyHomework: true,
    note: "",
    goalId: null,
    semesterStart: null,
  };
}

export function CourseEditDialog({ open, onOpenChange, course, goals, onSubmit }: CourseEditDialogProps) {
  const [draft, setDraft] = useState<CourseDraft>(emptyDraft);
  const [creditsText, setCreditsText] = useState("");
  const [semesterText, setSemesterText] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const initial: CourseDraft = course
      ? {
          name: course.name,
          teacher: course.teacher,
          credits: course.credits,
          color: course.color,
          weeklyHomework: course.weeklyHomework,
          note: course.note,
          goalId: course.goalId,
          semesterStart: course.semesterStart,
        }
      : emptyDraft();
    setDraft(initial);
    setCreditsText(initial.credits === null || initial.credits === undefined ? "" : String(initial.credits));
    setSemesterText(initial.semesterStart ?? "");
    setError("");
  }, [open, course]);

  const patch = (part: Partial<CourseDraft>) => setDraft((current) => ({ ...current, ...part }));

  const submit = () => {
    const name = draft.name.trim();
    if (!name) {
      setError("课程名不能为空");
      return;
    }
    const credits = creditsText.trim() === "" ? null : Number(creditsText);
    if (credits !== null && (!Number.isFinite(credits) || credits < 0 || credits > 50)) {
      setError("学分是 0~50 的数字");
      return;
    }
    if (semesterText && !/^\d{4}-\d{2}-\d{2}$/.test(semesterText)) {
      setError("学期起点用 2026-09-07 这种格式");
      return;
    }
    onSubmit({ ...draft, name, credits, semesterStart: semesterText || null });
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={course ? "编辑课程" : "新建课程"}
      description="课程是计划，日程是执行：保存后可以给它加考核项与每周作业。"
      size="md"
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" variant="primary" onClick={submit}>
            {course ? "保存" : "创建"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="text-caption text-ink-700">课程名</span>
          <Input
            autoFocus
            value={draft.name}
            onChange={(event) => patch({ name: event.target.value })}
            placeholder="学术英语写作"
            className="mt-1"
            aria-label="课程名"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-caption text-ink-700">教师</span>
            <Input
              value={draft.teacher ?? ""}
              onChange={(event) => patch({ teacher: event.target.value })}
              placeholder="肖铮"
              className="mt-1"
              aria-label="教师"
            />
          </label>
          <label className="block">
            <span className="text-caption text-ink-700">学分</span>
            <Input
              type="number"
              min={0}
              max={50}
              step={0.5}
              value={creditsText}
              onChange={(event) => setCreditsText(event.target.value)}
              className="tabular mt-1"
              aria-label="学分"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-caption text-ink-700">学期第 1 周周一</span>
            <Input
              type="date"
              value={semesterText}
              onChange={(event) => setSemesterText(event.target.value)}
              className="tabular mt-1"
              aria-label="学期第 1 周周一"
            />
          </label>
          <label className="block">
            <span className="text-caption text-ink-700">关联目标</span>
            <select
              className="mt-1 h-9 w-full rounded-md border border-border-strong bg-surface-solid px-2 text-body text-ink-900 focus:border-accent focus:ring-4 focus:ring-accent/15"
              value={draft.goalId ?? ""}
              onChange={(event) => patch({ goalId: event.target.value || null })}
              aria-label="关联目标"
            >
              <option value="">不关联</option>
              {goals.map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {goal.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-micro text-ink-300">
          不填学期起点时用「课程设置」里的全局学期；自动生成的日程会继承这门课关联的目标。
        </p>

        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-sunken/60 px-3 py-2">
          <div className="min-w-0">
            <p className="text-caption text-ink-900">每周都有作业</p>
            <p className="text-micro text-ink-300">打开后，本周没有作业记录时会出现在遗漏提醒里</p>
          </div>
          <Switch
            checked={draft.weeklyHomework === true}
            onCheckedChange={(checked) => patch({ weeklyHomework: checked })}
            label="每周都有作业"
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-caption text-ink-700">颜色</span>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="课程颜色">
            {COURSE_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`选择颜色 ${color}`}
                aria-pressed={draft.color === color}
                onClick={() => patch({ color })}
                className={cn(
                  "size-6 rounded-full border transition-transform duration-[var(--dur-1)]",
                  draft.color === color ? "scale-110 border-ink-900" : "border-transparent hover:scale-105",
                )}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>

        <label className="block">
          <span className="text-caption text-ink-700">备注</span>
          <Textarea
            value={draft.note ?? ""}
            onChange={(event) => patch({ note: event.target.value })}
            placeholder="老师、教室、考试形式…"
            rows={2}
            className="mt-1"
            aria-label="课程备注"
          />
        </label>

        {error && <p className="text-caption text-danger-ink">{error}</p>}
      </div>
    </Dialog>
  );
}
