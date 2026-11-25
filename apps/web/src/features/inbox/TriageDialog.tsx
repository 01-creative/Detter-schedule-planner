import { useEffect, useState } from "react";
import { Dialog, Button, cn, useToast } from "@detter/ui";
import type { Goal, InboxItem, Quadrant, Task } from "@detter/shared";
import { draftOf, triageItem } from "./actions";

/**
 * 「转任务」编辑器。
 *
 * 任务书 §4.2：「打开任务编辑器，预填解析结果，保存后 inbox 标记 triaged 并写 taskId」。
 * 真正的任务编辑器由 T03/T05 之后的任务接管；这里刻意只做分诊需要的六个字段，
 * 多了会把「整理一条」变回「填一张表」，而这件事的全部价值就在于低成本。
 */

const QUADRANTS: Array<{ value: Quadrant; label: string; hint: string }> = [
  { value: 1, label: "Q1", hint: "重要且紧急" },
  { value: 2, label: "Q2", hint: "重要不紧急" },
  { value: 3, label: "Q3", hint: "紧急不重要" },
  { value: 4, label: "Q4", hint: "不重要不紧急" },
];

const DURATIONS = [15, 25, 40, 60, 90];

function toLocalInput(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface TriageDialogProps {
  item: InboxItem | null;
  goals: Goal[];
  /** 无 @ 时按文本自动匹配到的目标 */
  suggestedGoal: Goal | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (item: InboxItem, task: Task) => void;
}

export function TriageDialog({
  item,
  goals,
  suggestedGoal,
  onOpenChange,
  onSaved,
}: TriageDialogProps) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [startAt, setStartAt] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [duration, setDuration] = useState("");
  const [quadrant, setQuadrant] = useState<Quadrant>(2);
  const [goalId, setGoalId] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);

  /* 每次换一条记录才重置表单：编辑过程中重渲染不能把用户填的东西冲掉。 */
  const itemId = item?.id ?? null;
  useEffect(() => {
    if (!item) return;
    const draft = draftOf(item, goals);
    setTitle(draft.title || item.rawText);
    setStartAt(draft.startAt ? toLocalInput(draft.startAt) : "");
    setAllDay(draft.allDay);
    setDuration(draft.durationMin ? String(draft.durationMin) : "");
    setQuadrant(draft.quadrantGuess ?? 2);
    setGoalId(draft.goalId ?? suggestedGoal?.id ?? "");
    setTags(draft.tags.join(" "));
    // 只在切换条目时重置
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  const save = async () => {
    if (!item || saving) return;
    const finalTitle = title.trim() || item.rawText;
    const start = startAt ? new Date(startAt).getTime() : null;
    const minutes = duration.trim() ? Number(duration) : null;
    const validMinutes = Number.isFinite(minutes) ? minutes : null;
    const tagList = tags
      .split(/[\s,，]+/)
      .map((tag) => tag.replace(/^#+/, "").trim())
      .filter(Boolean);

    setSaving(true);
    try {
      const task = await triageItem(item, quadrant, {
        title: finalTitle,
        startAt: start !== null && Number.isFinite(start) ? start : null,
        endAt:
          start !== null && Number.isFinite(start) && validMinutes
            ? start + validMinutes * 60_000
            : null,
        allDay,
        durationMin: validMinutes,
        goalId: goalId || null,
        tags: tagList,
        manualQuadrant: true,
      });
      onSaved(item, task);
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "没能建成任务",
        description: error instanceof Error ? error.message : "这条记录还留在收件箱里",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={item !== null}
      onOpenChange={onOpenChange}
      title="转成任务"
      description="解析结果已经填好了，改一改就能进四象限。"
      size="md"
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" variant="primary" loading={saving} onClick={() => void save()}>
            保存任务
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="text-micro text-ink-500">标题</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            aria-label="任务标题"
            className="mt-1 h-9 w-full rounded-md border border-border bg-surface-solid px-2.5 text-body text-ink-900"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-micro text-ink-500">时间</span>
            <input
              type="datetime-local"
              value={startAt}
              onChange={(event) => setStartAt(event.target.value)}
              aria-label="任务时间"
              className="mt-1 h-9 w-full rounded-md border border-border bg-surface-solid px-2 text-caption text-ink-900"
            />
          </label>
          <label className="block">
            <span className="text-micro text-ink-500">预计时长</span>
            <select
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
              aria-label="预计时长"
              className="mt-1 h-9 w-full rounded-md border border-border bg-surface-solid px-2 text-caption text-ink-900"
            >
              <option value="">不设时长</option>
              {DURATIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} 分钟
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex items-center gap-2 text-caption text-ink-700">
          <input
            type="checkbox"
            checked={allDay}
            onChange={(event) => setAllDay(event.target.checked)}
            className="size-3.5 accent-accent"
          />
          全天
        </label>

        <div>
          <span className="text-micro text-ink-500">象限</span>
          <div className="mt-1 grid grid-cols-4 gap-1.5" role="group" aria-label="选择象限">
            {QUADRANTS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={quadrant === option.value}
                title={option.hint}
                onClick={() => setQuadrant(option.value)}
                className={cn(
                  "h-8 rounded-md border text-caption transition-colors duration-[var(--dur-1)]",
                  quadrant === option.value
                    ? "border-accent/30 bg-accent-soft text-accent"
                    : "border-border bg-surface-solid text-ink-500 hover:text-ink-900",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-micro text-ink-500">目标</span>
            <select
              value={goalId}
              onChange={(event) => setGoalId(event.target.value)}
              aria-label="所属目标"
              className="mt-1 h-9 w-full rounded-md border border-border bg-surface-solid px-2 text-caption text-ink-900"
            >
              <option value="">不挂目标</option>
              {goals.map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {goal.title}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-micro text-ink-500">标签（空格分隔）</span>
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              aria-label="标签"
              className="mt-1 h-9 w-full rounded-md border border-border bg-surface-solid px-2.5 text-caption text-ink-900"
            />
          </label>
        </div>

        <p className="rounded-md bg-surface-sunken/60 px-2.5 py-2 text-micro text-ink-500">
          原文：<span className="text-ink-700">{item?.rawText}</span>
        </p>
      </div>
    </Dialog>
  );
}
