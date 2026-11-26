import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Inbox, ListChecks } from "lucide-react";
import type { InboxItem, Task } from "@detter/shared";
import { Button, Dialog, cn, useToast } from "@detter/ui";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingState } from "@/components/common/LoadingState";
import { PageHeading } from "@/components/common/PageHeading";
import { useActiveGoals, useInboxItems, useTasks } from "@/db/hooks";
import { useCaptureStore } from "@/stores/capture";
import { InboxCard } from "./InboxCard";
import { UndoBar, type UndoOffer } from "./UndoBar";
import { TriageDialog } from "./TriageDialog";
import {
  archiveItem,
  archiveMany,
  draftOf,
  removeItem,
  reparseItem,
  restoreItem,
  revertTask,
  triageItem,
  triageMany,
} from "./actions";
import {
  BULK_CONFIRM_THRESHOLD,
  FILTER_LABEL,
  filterInbox,
  groupInbox,
  type InboxFilter,
} from "./grouping";
import { findConflict, findDuplicate, suggestGoal } from "./matching";
import type { ConflictHit, SimilarTask } from "./matching";

/**
 * 收件箱主体。
 *
 * 一条记录的生命周期：pending →（转任务 / 一键整理）→ triaged，或 → archived。
 * 三种「离开待整理」的动作都必须可撤销，所以所有写操作都先算好回滚函数，
 * 再交给撤销条。批量操作例外（一次改十几条，回滚会把刚建的任务全删掉，
 * 反而更危险），只提示结果。
 */

const EMPTY_SIGNAL: { duplicate: SimilarTask | null; conflict: ConflictHit | null } = {
  duplicate: null,
  conflict: null,
};

function short(text: string, max = 14): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export function InboxBoard() {
  const { data: items, loading } = useInboxItems();
  const { data: tasks } = useTasks();
  const goals = useActiveGoals();
  const openCapture = useCaptureStore((state) => state.openCapture);
  const { toast } = useToast();

  const [filter, setFilter] = useState<InboxFilter>("all");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [triageTarget, setTriageTarget] = useState<InboxItem | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showHandled, setShowHandled] = useState(false);
  const [undo, setUndo] = useState<UndoOffer | null>(null);

  const undoTimer = useRef<number | undefined>(undefined);
  const undoRun = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    return () => window.clearTimeout(undoTimer.current);
  }, []);

  const now = Date.now();
  const pending = useMemo(() => items.filter((item) => item.status === "pending"), [items]);
  const handled = useMemo(() => items.filter((item) => item.status !== "pending"), [items]);
  const visible = useMemo(() => filterInbox(pending, filter, now), [pending, filter, now]);
  const groups = useMemo(() => groupInbox(visible, now), [visible, now]);

  /** 每条待整理的「可能重复 / 时间冲突」提示。 */
  const signals = useMemo(() => {
    const map = new Map<string, { duplicate: SimilarTask | null; conflict: ConflictHit | null }>();
    for (const item of pending) {
      const draft = draftOf(item, goals);
      map.set(item.id, {
        duplicate: findDuplicate(draft.title || item.rawText, tasks, now),
        conflict: findConflict(draft.startAt, draft.endAt, tasks, draft.allDay),
      });
    }
    return map;
  }, [pending, goals, tasks, now]);

  const offerUndo = useCallback((message: string, run: () => Promise<void>) => {
    window.clearTimeout(undoTimer.current);
    undoRun.current = run;
    setUndo({ id: Date.now(), message });
    undoTimer.current = window.setTimeout(() => setUndo(null), 6000);
  }, []);

  const dismissUndo = useCallback(() => {
    window.clearTimeout(undoTimer.current);
    undoRun.current = null;
    setUndo(null);
  }, []);

  const applyUndo = useCallback(async () => {
    const run = undoRun.current;
    window.clearTimeout(undoTimer.current);
    undoRun.current = null;
    setUndo(null);
    if (!run) return;
    try {
      await run();
      toast({ title: "已撤销", tone: "success" });
    } catch {
      toast({ title: "撤销失败，请手动改回去", tone: "danger" });
    }
  }, [toast]);

  const handleQuickTriage = useCallback(
    async (item: InboxItem) => {
      setBusy(true);
      try {
        const task = await triageItem(item);
        offerUndo(`已把「${short(item.rawText)}」变成任务`, async () => {
          await revertTask(task.id);
          await restoreItem(item);
        });
      } catch (error) {
        toast({
          title: "没能建成任务",
          description: error instanceof Error ? error.message : "这条记录还留在收件箱",
          tone: "danger",
        });
      } finally {
        setBusy(false);
      }
    },
    [offerUndo, toast],
  );

  const handleArchive = useCallback(
    async (item: InboxItem) => {
      setBusy(true);
      try {
        await archiveItem(item);
        offerUndo(`已归档「${short(item.rawText)}」`, async () => {
          await restoreItem(item);
        });
      } catch {
        toast({ title: "归档失败，稍后再试", tone: "danger" });
      } finally {
        setBusy(false);
      }
    },
    [offerUndo, toast],
  );

  const handleDelete = useCallback(
    async (item: InboxItem) => {
      setBusy(true);
      try {
        await removeItem(item);
        offerUndo(`已删除「${short(item.rawText)}」`, async () => {
          await restoreItem(item);
        });
      } catch {
        toast({ title: "删除失败，稍后再试", tone: "danger" });
      } finally {
        setBusy(false);
      }
    },
    [offerUndo, toast],
  );

  const handleRestore = useCallback(
    async (item: InboxItem) => {
      setBusy(true);
      try {
        await restoreItem(item);
        toast({ title: "已放回待整理", description: short(item.rawText, 24), tone: "success" });
      } catch {
        toast({ title: "恢复失败，稍后再试", tone: "danger" });
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  const handleSaveText = useCallback(
    async (item: InboxItem, text: string) => {
      try {
        await reparseItem(item, text);
        toast({ title: "已重新解析", description: text.slice(0, 24), tone: "success" });
      } catch {
        toast({ title: "保存失败，原文没改", tone: "danger" });
      }
    },
    [toast],
  );

  const selectedItems = useMemo(
    () => pending.filter((item) => selected.includes(item.id)),
    [pending, selected],
  );

  const runTriageAll = useCallback(
    async (list: InboxItem[]) => {
      setBusy(true);
      try {
        const result = await triageMany(list);
        if (result.failed > 0) {
          toast({
            title: `整理完成 ${result.done} 条，${result.failed} 条失败`,
            description: "失败的那些还留在收件箱里",
            tone: "danger",
            duration: 5000,
          });
        } else {
          toast({ title: `已整理 ${result.done} 条`, tone: "success" });
        }
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  const handleTriageAll = () => {
    if (pending.length === 0) return;
    if (pending.length > BULK_CONFIRM_THRESHOLD) {
      setConfirmBulk(true);
      return;
    }
    void runTriageAll(pending);
  };

  const handleBulkTriage = async () => {
    if (selectedItems.length === 0) return;
    await runTriageAll(selectedItems);
    setSelected([]);
    setSelectMode(false);
  };

  const handleBulkArchive = async () => {
    if (selectedItems.length === 0) return;
    setBusy(true);
    try {
      const result = await archiveMany(selectedItems);
      toast({ title: `已归档 ${result.done} 条`, tone: "success" });
      setSelected([]);
      setSelectMode(false);
    } finally {
      setBusy(false);
    }
  };

  const toggleSelected = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );

  const triageTargetSuggestion = triageTarget
    ? suggestGoal(triageTarget.rawText, goals)
    : null;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <PageHeading
          eyebrow="先收进来，之后再决定"
          title="收件箱"
          description="所有来不及整理的想法都在这里，离线写下的一条也不会丢。"
        />
        <Button size="sm" onClick={() => openCapture()}>
          记一条
        </Button>
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-caption text-ink-500">
          待整理 <span className="numeric font-strong text-ink-900">{pending.length}</span> 条
        </span>

        <div
          className="flex items-center gap-1 rounded-full border border-border bg-surface-solid p-0.5"
          role="group"
          aria-label="按时间筛选"
        >
          {(Object.keys(FILTER_LABEL) as InboxFilter[]).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={cn(
                "relative h-6 rounded-full px-2.5 text-micro transition-colors duration-[var(--dur-1)]",
                // 命中区 44 高（视觉 24）：上下各借 10px，落到筛选行 8px 的行间距里；
                // 左右各借 2px，吃掉 gap-1 的一半，彼此不重叠。
                "after:absolute after:-inset-y-2.5 after:-inset-x-0.5 after:content-['']",
                filter === value
                  ? "bg-accent-soft text-accent"
                  : "text-ink-500 hover:text-ink-900",
              )}
            >
              {FILTER_LABEL[value]}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSelectMode((value) => !value);
              setSelected([]);
            }}
            disabled={pending.length === 0}
          >
            {selectMode ? "退出批量" : "批量选择"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={handleTriageAll}
            disabled={pending.length === 0 || busy}
            leftIcon={<ListChecks className="size-3.5" aria-hidden="true" />}
          >
            全部整理
          </Button>
        </div>
      </div>

      {selectMode && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-accent/20 bg-accent-soft/50 px-3 py-2">
          <span className="text-caption text-ink-700">
            已选 <span className="numeric font-strong text-ink-900">{selected.length}</span> 条
          </span>
          <button
            type="button"
            onClick={() =>
              setSelected(selected.length === pending.length ? [] : pending.map((item) => item.id))
            }
            className="text-micro text-accent underline-offset-2 hover:underline"
          >
            {selected.length === pending.length ? "取消全选" : "全选"}
          </button>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={selectedItems.length === 0 || busy}
              onClick={() => void handleBulkArchive()}
            >
              全部归档
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={selectedItems.length === 0 || busy}
              onClick={() => void handleBulkTriage()}
            >
              全部转任务
            </Button>
          </div>
        </div>
      )}

      {/* 底部安全区：FAB 是 fixed 的（56px、距底 72px），主内容区原有的 96px 下边距不够，
          滚到底时最后一条卡片的「一键整理」会被它压住。这里再留 56px，让列表收在 FAB 上方。 */}
      <div className="mt-4 pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
        {loading ? (
          <LoadingState rows={3} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Inbox className="size-5" aria-hidden="true" />}
            title="盒子是空的，说明你还没忘事"
            description="按 Ctrl / Cmd + K，或者点右下角的「+」，把脑子里那件事先放进来。"
            action={
              <Button size="sm" onClick={() => openCapture()}>
                现在记一条
              </Button>
            }
          />
        ) : pending.length === 0 ? (
          <EmptyState
            icon={<Inbox className="size-5" aria-hidden="true" />}
            title="待整理已清空"
            description="盒子里的记录都处理完了。新的念头随时可以按 Ctrl / Cmd + K 记进来。"
            action={
              <Button size="sm" onClick={() => openCapture()}>
                再记一条
              </Button>
            }
          />
        ) : groups.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border-strong px-3 py-6 text-center text-caption text-ink-500">
            这个时间范围内没有记录，切到「全部」看看。
          </p>
        ) : (
          <>
            {groups.map((group) => (
              <section key={group.key} className="mt-4 first:mt-0" aria-label={group.label}>
                <h2 className="mb-2 text-caption text-ink-500">{group.label}</h2>
                <ul className="space-y-2.5">
                  {group.items.map((item) => {
                    const signal = signals.get(item.id) ?? EMPTY_SIGNAL;
                    return (
                      <InboxCard
                        key={item.id}
                        item={item}
                        duplicate={signal.duplicate?.task ?? null}
                        conflict={signal.conflict?.task ?? null}
                        selectMode={selectMode}
                        selected={selected.includes(item.id)}
                        busy={busy}
                        onToggleSelect={() => toggleSelected(item.id)}
                        onOpenTriage={() => setTriageTarget(item)}
                        onQuickTriage={() => void handleQuickTriage(item)}
                        onArchive={() => void handleArchive(item)}
                        onDelete={() => void handleDelete(item)}
                        onRestore={() => void handleRestore(item)}
                        onSaveText={(text) => handleSaveText(item, text)}
                      />
                    );
                  })}
                </ul>
              </section>
            ))}
          </>
        )}

        {handled.length > 0 && (
          <div className="mt-6 border-t border-border pt-3">
            <button
              type="button"
              onClick={() => setShowHandled((value) => !value)}
              aria-expanded={showHandled}
              className="inline-flex items-center gap-1 text-caption text-ink-500 transition-colors duration-[var(--dur-1)] hover:text-ink-900"
            >
              已整理 {handled.length} 条
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform duration-[var(--dur-2)]",
                  !showHandled && "-rotate-90",
                )}
                aria-hidden="true"
              />
            </button>

            {showHandled && (
              <ul className="mt-2 space-y-2.5">
                {handled.map((item) => {
                  const signal = EMPTY_SIGNAL;
                  return (
                    <InboxCard
                      key={item.id}
                      item={item}
                      duplicate={signal.duplicate?.task ?? null}
                      conflict={signal.conflict?.task ?? null}
                      selectMode={false}
                      selected={false}
                      busy={busy}
                      onToggleSelect={() => undefined}
                      onOpenTriage={() => undefined}
                      onQuickTriage={() => undefined}
                      onArchive={() => undefined}
                      onDelete={() => void handleDelete(item)}
                      onRestore={() => void handleRestore(item)}
                      onSaveText={(text) => handleSaveText(item, text)}
                    />
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      <UndoBar offer={undo} onUndo={() => void applyUndo()} onDismiss={dismissUndo} />

      <TriageDialog
        item={triageTarget}
        goals={goals}
        suggestedGoal={triageTargetSuggestion}
        onOpenChange={(open) => {
          if (!open) setTriageTarget(null);
        }}
        onSaved={(item, task) => {
          offerUndo(`已把「${short(item.rawText)}」变成任务`, async () => {
            await revertTask(task.id);
            await restoreItem(item);
          });
          setTriageTarget(null);
        }}
      />

      <Dialog
        open={confirmBulk}
        onOpenChange={setConfirmBulk}
        title={`整理这 ${pending.length} 条记录？`}
        description="会按解析结果逐条建成任务，象限取建议值，之后可以在四象限里调整。"
        size="sm"
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={() => setConfirmBulk(false)}>
              再等等
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setConfirmBulk(false);
                void runTriageAll(pending);
              }}
            >
              全部整理
            </Button>
          </>
        }
      >
        <p className="text-caption text-ink-500">
          超过 {BULK_CONFIRM_THRESHOLD} 条时先确认一次，避免一次误点建出一堆任务。
        </p>
      </Dialog>
    </div>
  );
}
