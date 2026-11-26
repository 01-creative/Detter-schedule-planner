import { useEffect, useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import type { Quadrant, Task } from "@detter/shared";
import { Badge, Button, Dialog, Input, cn } from "@detter/ui";
import { formatWhen } from "@/lib/format";

/**
 * 任务选择器：搜索 + 最近任务 + 「不绑定任务」。
 *
 * 只列「还能做」的任务（inbox / todo / doing）；已完成/已放弃的只在它正是当前绑定时出现，
 * 免得换绑定时看到一个早就做完的标题。
 */
export interface TaskPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: Task[];
  currentTaskId: string | null;
  loading: boolean;
  onSelect: (taskId: string | null) => void;
}

const QUADRANT_TONE: Record<Quadrant, string> = {
  1: "var(--q1-accent)",
  2: "var(--q2-accent)",
  3: "var(--q3-accent)",
  4: "var(--q4-accent)",
};

export function TaskPickerDialog({
  open,
  onOpenChange,
  tasks,
  currentTaskId,
  loading,
  onSelect,
}: TaskPickerDialogProps) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const candidates = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return tasks
      .filter((task) => {
        const open_ = task.status !== "done" && task.status !== "dropped";
        if (!open_ && task.id !== currentTaskId) return false;
        if (!keyword) return true;
        return task.title.toLowerCase().includes(keyword);
      })
      .sort((a, b) => {
        if (a.id === currentTaskId) return -1;
        if (b.id === currentTaskId) return 1;
        return b.updatedAt - a.updatedAt;
      });
  }, [tasks, query, currentTaskId]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="绑定任务"
      description="专注时长会跟着这条任务走，方便以后回看时间花在哪。"
      size="md"
      footer={
        <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
          取消
        </Button>
      }
    >
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-300"
          aria-hidden="true"
        />
        <Input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索任务标题"
          className="pl-8"
          aria-label="搜索任务"
        />
      </div>

      <div className="mt-3 max-h-[46vh] space-y-1 overflow-y-auto pr-1">
        <button
          type="button"
          onClick={() => {
            onSelect(null);
            onOpenChange(false);
          }}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors duration-[var(--dur-1)] hover:bg-surface-sunken",
            currentTaskId === null && "bg-accent-soft/60",
          )}
        >
          <span className="grid size-4 place-items-center text-accent" aria-hidden="true">
            {currentTaskId === null && <Check className="size-3.5" />}
          </span>
          <span className="text-body text-ink-700">不绑定任务</span>
          <span className="ml-auto text-micro text-ink-300">只计时，不计到具体任务</span>
        </button>

        {loading && <p className="px-2.5 py-4 text-center text-caption text-ink-500">正在读取任务…</p>}

        {!loading && candidates.length === 0 && (
          <p className="px-2.5 py-6 text-center text-caption text-ink-500">
            {query ? "没有匹配的任务" : "四象限里还没有未完成的任务"}
          </p>
        )}

        {candidates.map((task) => {
          const active = task.id === currentTaskId;
          return (
            <button
              key={task.id}
              type="button"
              onClick={() => {
                onSelect(task.id);
                onOpenChange(false);
              }}
              className={cn(
                "flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors duration-[var(--dur-1)] hover:bg-surface-sunken",
                active && "bg-accent-soft/60",
              )}
            >
              <span
                aria-hidden="true"
                className="mt-1.5 size-2 shrink-0 rounded-full"
                style={{ backgroundColor: QUADRANT_TONE[task.quadrant] }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body text-ink-900">{task.title}</span>
                <span className="mt-0.5 block truncate text-micro text-ink-500">
                  {formatWhen(task)}
                </span>
              </span>
              {task.status === "doing" && <Badge tone="accent">进行中</Badge>}
              {active && <Check className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}
