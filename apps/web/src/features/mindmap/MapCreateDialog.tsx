import { useEffect, useRef, useState } from "react";
import { Target } from "lucide-react";
import type { Goal, Task } from "@detter/shared";
import { Button, Dialog, Input, Tabs, cn, useToast } from "@detter/ui";
import { createEmptyMindMap, generateFromGoal } from "./mindmap-actions";

/**
 * 新建导图。
 *
 * 两个入口共用这一个对话框，因为它们是同一个决策的两种答案：
 * 「从零写」还是「把已有目标搬进来」。做成两个按钮两个弹层，
 * 用户每次都要先想清楚是哪种，反而慢。
 */

export type CreateMode = "blank" | "from-goal";

export interface MapCreatedInfo {
  mapId: string;
  /** 新建后直接进入编辑态的节点（空白导图的根节点） */
  autoEditId: string | null;
  nodeCount: number;
}

export interface MapCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goals: readonly Goal[];
  tasks: readonly Task[];
  initialMode?: CreateMode;
  initialGoalId?: string | null;
  onCreated: (info: MapCreatedInfo) => void;
}

const MAX_CHILDREN = 12;

export function MapCreateDialog({
  open,
  onOpenChange,
  goals,
  tasks,
  initialMode = "blank",
  initialGoalId = null,
  onCreated,
}: MapCreateDialogProps) {
  const { toast } = useToast();
  const [mode, setMode] = useState<CreateMode>(initialMode);
  const [title, setTitle] = useState("");
  const [goalId, setGoalId] = useState<string | null>(initialGoalId);
  const [busy, setBusy] = useState(false);
  const goalsRef = useRef(goals);
  goalsRef.current = goals;

  // 只在「打开」这一刻重置：goals 是实时查询，跟着它重置会把用户正在输入的字吃掉
  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setTitle("");
    setGoalId(initialGoalId ?? goalsRef.current[0]?.id ?? null);
    setBusy(false);
  }, [open, initialMode, initialGoalId]);

  const selectedGoal = goals.find((goal) => goal.id === goalId) ?? null;
  const goalTaskCount = selectedGoal
    ? tasks.filter((task) => task.goalId === selectedGoal.id && task.status !== "dropped").length
    : 0;

  const canSubmit = mode === "blank" ? title.trim().length > 0 : Boolean(selectedGoal);

  const submit = () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    if (mode === "blank") {
      void createEmptyMindMap(title)
        .then(({ map, root }) => {
          onCreated({ mapId: map.id, autoEditId: root.id, nodeCount: 1 });
          onOpenChange(false);
          toast({ title: "导图已创建", description: "给根节点起个名字，Tab 就能加子节点", tone: "success" });
        })
        .finally(() => setBusy(false));
      return;
    }
    if (!selectedGoal) return;
    void generateFromGoal(selectedGoal, tasks)
      .then(({ map, children }) => {
        onCreated({ mapId: map.id, autoEditId: null, nodeCount: 1 + children.length });
        onOpenChange(false);
        toast({
          title: `已从「${selectedGoal.title}」生成导图`,
          description: `带入 ${children.length} 个任务节点`,
          tone: "success",
        });
      })
      .finally(() => setBusy(false));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="新建导图"
      description="一张图只拆一个目标；节点可以随时变成任务。"
      size="md"
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" variant="primary" loading={busy} disabled={!canSubmit} onClick={submit}>
            {mode === "blank" ? "创建空白导图" : "生成导图"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Tabs
          ariaLabel="导图来源"
          value={mode}
          onValueChange={(value) => setMode(value as CreateMode)}
          items={[
            { value: "blank", label: "空白导图" },
            { value: "from-goal", label: "从目标生成" },
          ]}
        />

        {mode === "blank" ? (
          <div className="space-y-1.5">
            <label htmlFor="mindmap-title" className="block text-caption text-ink-700">
              这张导图要拆的目标
            </label>
            <Input
              id="mindmap-title"
              autoFocus
              value={title}
              placeholder="例：三个月内把驾照考下来"
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
            />
            <p className="text-micro text-ink-300">创建后根节点会进入编辑态，直接改名即可。</p>
          </div>
        ) : (
          <div className="space-y-2">
            {goals.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border-strong px-3 py-6 text-center">
                <p className="text-caption text-ink-500">还没有目标</p>
                <p className="mt-1 text-micro text-ink-300">先在四象限右侧的目标栏写下一个目标，再来生成导图。</p>
              </div>
            ) : (
              <div role="radiogroup" aria-label="选择目标" className="max-h-64 space-y-1 overflow-y-auto pr-1">
                {goals.map((goal) => {
                  const active = goal.id === goalId;
                  const count = tasks.filter((task) => task.goalId === goal.id && task.status !== "dropped").length;
                  return (
                    <button
                      key={goal.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setGoalId(goal.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors duration-[var(--dur-1)]",
                        active
                          ? "border-accent bg-accent-soft text-ink-900"
                          : "border-border bg-surface-solid text-ink-700 hover:bg-surface-sunken",
                      )}
                    >
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: goal.color }}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate text-body">{goal.title}</span>
                      <span className="tabular shrink-0 text-micro text-ink-500">{count} 项任务</span>
                    </button>
                  );
                })}
              </div>
            )}
            {selectedGoal && (
              <p className="flex items-center gap-1.5 text-micro text-ink-500">
                <Target className="size-3 text-accent" aria-hidden="true" />
                根节点 = 「{selectedGoal.title}」，第一层带入最多 {MAX_CHILDREN} 个任务
                {goalTaskCount > MAX_CHILDREN ? `（当前 ${goalTaskCount} 个，只取前 ${MAX_CHILDREN} 个）` : ""}
              </p>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}

export default MapCreateDialog;
