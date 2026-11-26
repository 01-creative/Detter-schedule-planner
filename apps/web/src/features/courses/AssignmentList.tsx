import { useEffect, useMemo, useState } from "react";
import { Check, Plus, Trash2, Undo2 } from "lucide-react";
import { dayKey, dayKeyToTs, DAY, type Assignment, type Course } from "@detter/shared";
import { Badge, Button, Input, cn } from "@detter/ui";
import { assignmentStatusLabel, groupAssignmentsByWeek, weeksUpToCurrent } from "./coursesModel";

/**
 * 每周作业：按周列出 + 快速添加。
 *
 * 三个细节：
 * 1. 默认选中「本周」，这样点开就能补记；
 * 2. 缺记的周单独提示（`weeklyHomework` 的课才提示），点一下就把周次填进表单；
 * 3. 每条作业带一个关联的 Task，勾选完成会同步把 Task 标完成（提醒因此消失）。
 */
export interface AssignmentListProps {
  course: Course;
  assignments: Assignment[];
  currentWeek: number | null;
  missingWeeks: number[];
  onAdd: (input: { weekNo: number; title: string; dueAt: number | null }) => void;
  onStatusChange: (assignment: Assignment, status: Assignment["status"]) => void;
  onDelete: (assignment: Assignment) => void;
}

export function AssignmentList({
  course,
  assignments,
  currentWeek,
  missingWeeks,
  onAdd,
  onStatusChange,
  onDelete,
}: AssignmentListProps) {
  const [title, setTitle] = useState("");
  const [weekNo, setWeekNo] = useState<number>(currentWeek ?? 1);
  const [dueText, setDueText] = useState("");
  const [error, setError] = useState("");

  // 数据是异步回来的：第一次渲染时 currentWeek 还是 null，等它到了再把默认周次改成「本周」
  useEffect(() => {
    if (currentWeek !== null) setWeekNo(currentWeek);
  }, [currentWeek]);

  const groups = useMemo(() => groupAssignmentsByWeek(assignments, currentWeek), [assignments, currentWeek]);
  const weekOptions = useMemo(() => {
    const max = Math.max(currentWeek ?? 1, ...assignments.map((item) => item.weekNo), 1);
    return Array.from({ length: Math.min(Math.max(max, 1), 60) }, (_, index) => index + 1);
  }, [assignments, currentWeek]);

  const submit = () => {
    const text = title.trim();
    if (!text) {
      setError("写一句作业内容，比如「课后习题 3.1-3.8」");
      return;
    }
    const dueAt = dueText ? dayKeyToTs(dueText) + DAY - 1 : null;
    onAdd({ weekNo, title: text, dueAt });
    setTitle("");
    setDueText("");
    setError("");
  };

  return (
    <div className="space-y-3">
      {course.weeklyHomework && missingWeeks.length > 0 && (
        <p
          role="status"
          className="rounded-md bg-warning-soft px-3 py-2 text-caption text-warning-ink"
        >
          这门课是「每周有作业」，但第 {missingWeeks.slice(0, 8).join("、")}
          {missingWeeks.length > 8 ? "…" : ""} 周还没有记录。
          <button
            type="button"
            className="ml-1 underline underline-offset-2"
            onClick={() => setWeekNo(missingWeeks[0] as number)}
          >
            补记第 {missingWeeks[0]} 周
          </button>
        </p>
      )}

      <div className="rounded-md border border-border bg-surface-sunken/50 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="min-w-0 sm:w-[130px]">
            <span className="text-micro text-ink-500">第几周</span>
            <select
              className="mt-0.5 h-9 w-full rounded-md border border-border-strong bg-surface-solid px-2 text-body text-ink-900 focus:border-accent focus:ring-4 focus:ring-accent/15"
              value={weekNo}
              onChange={(event) => setWeekNo(Number(event.target.value))}
              aria-label="作业所属周次"
            >
              {weekOptions.map((week) => (
                <option key={week} value={week}>
                  第 {week} 周{week === currentWeek ? "（本周）" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0 flex-1">
            <span className="text-micro text-ink-500">作业内容</span>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submit();
              }}
              placeholder="课后习题 3.1-3.8"
              className="mt-0.5"
              aria-label="作业内容"
            />
          </label>
          <label className="min-w-0 sm:w-[150px]">
            <span className="text-micro text-ink-500">截止（可选）</span>
            <Input
              type="date"
              value={dueText}
              onChange={(event) => setDueText(event.target.value)}
              className="tabular mt-0.5"
              aria-label="作业截止日期"
            />
          </label>
          <Button
            size="sm"
            variant="primary"
            className="sm:mb-0.5"
            onClick={submit}
            leftIcon={<Plus className="size-3.5" aria-hidden="true" />}
          >
            记下
          </Button>
        </div>
        {error && <p className="mt-1.5 text-micro text-danger-ink">{error}</p>}
      </div>

      {groups.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-5 text-center text-caption text-ink-500">
          还没有记录任何一周的作业。每周记一条，就不会在期末才发现漏了三章。
        </p>
      ) : (
        <ul className="space-y-3">
          {groups.map((group) => (
            <li key={group.weekNo}>
              <div className="flex items-center gap-2">
                <span className="text-caption font-strong text-ink-700">第 {group.weekNo} 周</span>
                {group.isCurrent && <Badge tone="accent">本周</Badge>}
                <span className="text-micro text-ink-300">{group.items.length} 条</span>
              </div>
              <ul className="mt-1.5 space-y-1">
                {group.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-2 rounded-md border border-border bg-surface-solid px-2.5 py-1.5"
                  >
                    <button
                      type="button"
                      aria-label={item.status === "done" ? "标记为待做" : "标记为已完成"}
                      aria-pressed={item.status === "done"}
                      onClick={() => onStatusChange(item, item.status === "done" ? "todo" : "done")}
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-[var(--dur-1)]",
                        item.status === "done"
                          ? "border-success bg-success text-white"
                          : "border-border-strong text-transparent hover:border-success",
                      )}
                    >
                      <Check className="size-3" aria-hidden="true" />
                    </button>
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-caption",
                        item.status === "done" ? "text-ink-300 line-through" : "text-ink-900",
                      )}
                    >
                      {item.title}
                    </span>
                    {item.dueAt !== null && (
                      <span className="tabular shrink-0 text-micro text-ink-500">{dayKey(item.dueAt)}</span>
                    )}
                    <span className="shrink-0 text-micro text-ink-300">
                      {assignmentStatusLabel(item.status)}
                    </span>
                    {item.status !== "skipped" ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`把「${item.title}」标记为跳过`}
                        onClick={() => onStatusChange(item, "skipped")}
                      >
                        <Undo2 className="size-3.5" aria-hidden="true" />
                      </Button>
                    ) : (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`恢复「${item.title}」`}
                        onClick={() => onStatusChange(item, "todo")}
                      >
                        <Undo2 className="size-3.5" aria-hidden="true" />
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`删除「${item.title}」`}
                      className="text-ink-300 hover:text-danger-ink"
                      onClick={() => onDelete(item)}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {currentWeek !== null && weeksUpToCurrent(currentWeek).length > 0 && groups.length > 0 && (
        <p className="text-micro text-ink-300">
          学期第 1~{currentWeek} 周共记录 {assignments.length} 条作业。
        </p>
      )}
    </div>
  );
}
