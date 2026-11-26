import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronDown, Network, Plus, Target, Trash2 } from "lucide-react";
import type { MindMap } from "@detter/shared";
import { Button, EmptyState, Menu, useToast, type MenuItem } from "@detter/ui";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { LoadingState } from "@/components/common/LoadingState";
import { PageHeading } from "@/components/common/PageHeading";
import { MindMapStage } from "./MindMapStage";
import { MapCreateDialog, type CreateMode } from "./MapCreateDialog";
import { removeMindMap } from "./mindmap-actions";
import { useMindGoals, useMindMaps, useMindNodes, useMindTasks } from "./queries";

/**
 * 思维导图页的装配层。
 *
 * 只做四件事：把 Dexie 里的数据取出来、管理「当前是哪张图」、挂新建/删除弹层、
 * 给出空态。画布与节点交互全部在 MindMapStage 里（页面薄壳原则见 07-FRONTEND-STRUCTURE §6）。
 */
export function MindMapShell() {
  const { toast } = useToast();
  const { data: maps, loading: mapsLoading } = useMindMaps();
  const goals = useMindGoals();
  const tasks = useMindTasks();

  const [selectedMapId, setSelectedMapId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState<CreateMode>("blank");
  const [initialGoalId, setInitialGoalId] = useState<string | null>(null);
  const [autoEditId, setAutoEditId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MindMap | null>(null);
  const [params, setParams] = useSearchParams();
  const handledGoalParam = useRef<string | null>(null);

  const activeMap = useMemo(
    () => maps.find((map) => map.id === selectedMapId) ?? maps[0] ?? null,
    [maps, selectedMapId],
  );
  const { data: nodes, loading: nodesLoading } = useMindNodes(activeMap?.id ?? null);

  const linkedTaskCount = nodes.filter((node) => node.kind === "task" && node.refId).length;

  const openCreate = useCallback((mode: CreateMode, goalId: string | null = null) => {
    setCreateMode(mode);
    setInitialGoalId(goalId);
    setCreateOpen(true);
  }, []);

  /* OKR 页的「生成导图」入口：/mindmap?goalId=xxx 直接打开「从目标生成」并选中该目标 */
  useEffect(() => {
    const goalParam = params.get("goalId");
    if (!goalParam || handledGoalParam.current === goalParam) return;
    if (goals.length === 0) return;
    if (!goals.some((goal) => goal.id === goalParam)) return;
    handledGoalParam.current = goalParam;
    openCreate("from-goal", goalParam);
    const next = new URLSearchParams(params);
    next.delete("goalId");
    setParams(next, { replace: true });
  }, [goals, openCreate, params, setParams]);

  const handleCreated = useCallback((info: { mapId: string; autoEditId: string | null }) => {
    setSelectedMapId(info.mapId);
    setAutoEditId(info.autoEditId);
  }, []);

  const handleDelete = useCallback(() => {
    if (!deleteTarget) return;
    const title = deleteTarget.title;
    void removeMindMap(deleteTarget).then((count) => {
      setSelectedMapId(null);
      setAutoEditId(null);
      toast({
        title: `已删除「${title}」`,
        description: count > 0 ? `连同 ${count} 个节点一起删除` : undefined,
        tone: "neutral",
      });
    });
  }, [deleteTarget, toast]);

  const menuItems: MenuItem[] = useMemo(() => {
    const items: MenuItem[] = maps.map((map) => ({
      key: map.id,
      label: map.title,
      active: map.id === activeMap?.id,
      onSelect: () => {
        setSelectedMapId(map.id);
        setAutoEditId(null);
      },
    }));
    items.push({
      key: "__new",
      label: "新建导图",
      icon: <Plus className="size-3.5" aria-hidden="true" />,
      onSelect: () => openCreate("blank"),
    });
    items.push({
      key: "__from-goal",
      label: "从目标生成",
      icon: <Target className="size-3.5" aria-hidden="true" />,
      onSelect: () => openCreate("from-goal"),
    });
    if (activeMap) {
      items.push({
        key: "__delete",
        label: "删除当前导图",
        icon: <Trash2 className="size-3.5" aria-hidden="true" />,
        danger: true,
        onSelect: () => setDeleteTarget(activeMap),
      });
    }
    return items;
  }, [activeMap, maps, openCreate]);

  if (mapsLoading) {
    return (
      <div className="py-6">
        <LoadingState rows={2} />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-13.75rem)] min-h-[440px] flex-col gap-3 md:h-[calc(100dvh-10.75rem)]">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <PageHeading
          eyebrow="思维导图 · 一张图只拆一个目标"
          title="思维导图"
          className="shrink-0"
        />
        <div className="flex min-w-0 items-center gap-2">
          {activeMap && (
            <Menu
              align="start"
              label="切换或管理导图"
              trigger={
                <button
                  type="button"
                  className="inline-flex h-8 max-w-[46vw] min-w-0 items-center gap-1.5 rounded-md border border-border-strong bg-surface-solid px-2.5 text-body font-strong text-ink-900 transition-colors duration-[var(--dur-1)] hover:bg-surface-sunken md:max-w-[280px]"
                >
                  <Network className="size-3.5 shrink-0 text-accent" aria-hidden="true" />
                  <span className="truncate">{activeMap.title}</span>
                  <ChevronDown className="size-3.5 shrink-0 text-ink-300" aria-hidden="true" />
                </button>
              }
              items={menuItems}
            />
          )}
          {activeMap && (
            <p className="tabular text-micro text-ink-500">
              {nodes.length} 节点
              {linkedTaskCount > 0 ? ` · ${linkedTaskCount} 个任务` : ""}
            </p>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<Target className="size-3.5" aria-hidden="true" />}
            onClick={() => openCreate("from-goal")}
          >
            从目标生成
          </Button>
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<Plus className="size-3.5" aria-hidden="true" />}
            onClick={() => openCreate("blank")}
          >
            新建导图
          </Button>
        </div>
      </header>

      {activeMap ? (
        <MindMapStage
          key={activeMap.id}
          map={activeMap}
          nodes={nodes}
          goals={goals}
          tasks={tasks}
          nodesReady={!nodesLoading}
          autoEditId={autoEditId}
          className="min-h-0 flex-1"
        />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-border bg-surface-sunken">
          <EmptyState
            icon={<Network className="size-6" />}
            title="还没有导图"
            description="一张图只拆一个目标。空白开始，或者把一个已有目标连同它的任务直接搬进来。"
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  leftIcon={<Plus className="size-3.5" aria-hidden="true" />}
                  onClick={() => openCreate("blank")}
                >
                  新建导图
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  leftIcon={<Target className="size-3.5" aria-hidden="true" />}
                  onClick={() => openCreate("from-goal")}
                >
                  从目标生成
                </Button>
              </div>
            }
          />
        </div>
      )}

      <MapCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        goals={goals}
        tasks={tasks}
        initialMode={createMode}
        initialGoalId={initialGoalId}
        onCreated={handleCreated}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={`删除「${deleteTarget?.title ?? ""}」？`}
        description="导图和它的全部节点会被一起删除（软删除，同步后其他设备也会消失）。"
        confirmLabel="删除导图"
        tone="danger"
        onConfirm={handleDelete}
      />
    </div>
  );
}

export default MindMapShell;
