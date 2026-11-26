import { useEffect, useMemo, useState } from "react";
import { Check, Plus, Trash2, Undo2 } from "lucide-react";
import { dayKey, dayKeyToTs, type Assignment, type Course } from "@detter/shared";
import { Badge, Button, Input, cn } from "@detter/ui";
import { assignmentStatusLabel, groupAssignmentsByWeek, weeksUpToCurrent } from "./coursesModel";

/**
 * 每周作业：按周列出 + 快速添加 + 截止时间可改。
 *
 * 四个细节：
 * 1. 默认选中「本周」，这样点开就能补记；
 * 2. 缺记的周单独提示（只对 `weeklyHomework` 的课提示），点一下就把周次填进表单；
 * 3. 每条作业带一个关联的 Task，勾选完成会同步把 Task 标完成（提醒因此消失）；
 * 4. 截止时间精确到分钟：交作业常常是「周日 23:59」，只给日期不够用；
 *    已经记下的那条也能点开改，改完连任务的时间一起改（提醒跟着走）。
 */
export interface AssignmentListProps {
  course: Course;
  assignments: Assignment[];
  currentWeek: number | null;
  missingWeeks: number[];
  onAdd: (input: { weekNo: number; title: string; dueAt: number | null }) => void;
  onStatusChange: (assignment: Assignment, status: Assignment["status"]) => void;
  onDueChange: (assignment: Assignment, dueAt: number | null) => void;
  onDelete: (assignment: Assignment) => void;
}

/** 默认截止时刻：周日 23:59 是绝大多数教务系统的截止口径。 */
const DEFAULT_DUE_TIME = "23:59";

function formatDueAt(at: number): string {
  const date = dayKey(at);
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${date} ${hh}:${mm}`;
}

function timeOfDay(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 把「日期 + 时刻」拼成本地时间戳；时刻缺省时按当天 23:59。 */
function composeDue(date: string, time: string): number {
  const [h, m] = (time || DEFAULT_DUE_TIME).split(":").map(Number);
  const minutes = (Number.isFinite(h) ? (h as number) : 23) * 60 + (Number.isFinite(m) ? (m as number) : 59);
  return dayKeyToTs(date, minutes * 60_000);
}

export function AssignmentList({
  course,
  assignments,
  currentWeek,
  missingWeeks,
  onAdd,
  onStatusChange,
  onDueChange,
  onDelete,
}: AssignmentListProps) {
  const [title, setTitle] = useState("");
  const [weekNo, setWeekNo] = useState<number>(currentWeek ?? 1);
  const [dueText, setDueText] = useState("");
  const [dueTime, setDueTime] = useState(DEFAULT_DUE_TIME);
  const [error, setError] = useState("");

  /** 正在改截止时间的那一条 */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState(DEFAULT_DUE_TIME);

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
    onAdd({ weekNo, title: text, dueAt: dueText ? composeDue(dueText, dueTime) : null });
    setTitle("");
    setDueText("");
    setDueTime(DEFAULT_DUE_TIME);
    setError("");
  };

  const openEditor = (item: Assignment) => {
    setEditingId(item.id);
    setEditDate(item.dueAt !== null ? dayKey(item.dueAt) : dayKey(Date.now()));
    setEditTime(item.dueAt !== null ? timeOfDay(item.dueAt) : DEFAULT_DUE_TIME);
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
          <label className="min-w-0 sm:w-[140px]">
            <span className="text-micro text-ink-500">截止日期</span>
            <Input
              type="date"
              value={dueText}
              onChange={(event) => setDueText(event.target.value)}
              className="tabular mt-0.5"
              aria-label="作业截止日期"
            />
          </label>
          <label className="min-w-0 sm:w-[110px]">
            <span className="text-micro text-ink-500">截止时刻</span>
            <Input
              type="time"
              value={dueTime}
              onChange={(event) => setDueTime(event.target.value)}
              className="tabular mt-0.5"
              aria-label="作业截止时刻"
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
                    className="rounded-md border border-border bg-surface-solid px-2.5 py-1.5"
                  >
                    <div className="flex items-center gap-2">
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
                      <button
                        type="button"
                        onClick={() => (editingId === item.id ? setEditingId(null) : openEditor(item))}
                        aria-label={`修改「${item.title}」的截止时间`}
                        className={cn(
                          "tabular shrink-0 rounded px-1.5 py-1 text-micro transition-colors duration-[var(--dur-1)] hover:bg-surface-sunken",
                          item.dueAt === null ? "text-ink-300" : "text-ink-500",
                        )}
                      >
                        {item.dueAt === null ? "设截止" : formatDueAt(item.dueAt)}
                      </button>
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
                    </div>

                    {editingId === item.id && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded bg-surface-sunken/60 p-2">
                        <Input
                          type="date"
                          value={editDate}
                          onChange={(event) => setEditDate(event.target.value)}
                          className="tabular w-[140px]"
                          aria-label="新截止日期"
                        />
                        <Input
                          type="time"
                          value={editTime}
                          onChange={(event) => setEditTime(event.target.value)}
                          className="tabular w-[110px]"
                          aria-label="新截止时刻"
                        />
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => {
                            if (!editDate) return;
                            onDueChange(item, composeDue(editDate, editTime));
                            setEditingId(null);
                          }}
                        >
                          保存
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            onDueChange(item, null);
                            setEditingId(null);
                          }}
                        >
                          清除截止
                        </Button>
                      </div>
                    )}
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
