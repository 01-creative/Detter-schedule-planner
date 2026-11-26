import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type {
  FocusEvent as ReactFocusEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { Goal, Quadrant, Task } from "@detter/shared";
import { QUADRANT_META, QUADRANT_ORDER } from "@detter/shared";
import { cn, useToast } from "@detter/ui";
import { useUIStore } from "@/stores/ui";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { createTaskFromGoal } from "@/features/goals/goal-actions";
import { openGoalDialog } from "@/features/goals/goal-dialog";
import { useQuadrantDrag } from "./DragProvider";
import { useAllGoals, useBoardTasks } from "./queries";
import { useIsMobile } from "./useMediaQuery";
import { computeBoardStats } from "./stats";
import {
  insertionIndexForPoint,
  moveQuadrant,
  nextFreePosition,
  sortIndexForInsertion,
  sortTasksForCell,
  unitFromPoint,
  type MoveDirection,
} from "./geometry";
import { buildCellContextMenu, buildTaskContextMenu, type MenuEntry } from "./menu-model";
import type { DragPayload, DropTarget, SortMode, ViewMode } from "./types";
import { BoardStatsBar } from "./BoardStatsBar";
import { QuadrantCell } from "./QuadrantCell";
import { ContextMenu } from "./ContextMenu";
import { CoordinateDialog } from "./CoordinateDialog";
import { TaskDetailPanel } from "./TaskDetailPanel";
import { UndoBar, type UndoState } from "./UndoBar";
import {
  createTask,
  moveTask,
  patchTask,
  removeTask,
  restoreTask,
  setTaskGoal,
  setTaskPosition,
  toggleTaskDone,
} from "./task-actions";

/**
 * 四象限画板。
 *
 * 这一层只做三件事：把数据按格分好、把交互（新建/拖拽/右键/键盘/撤销）串起来、
 * 把浮层挂上去。视觉细节全在 QuadrantCell / TaskCard / GoalRail 里。
 *
 * 拖拽期间不在 state 里存指针坐标：那部分由 drag-controller 每帧直接改浮层的
 * transform，只有「落点换格子」这种低频变化才 setState。
 */

interface InlineState {
  quadrant: Quadrant;
  posX: number;
  posY: number;
}

interface MenuState {
  x: number;
  y: number;
  quadrant: Quadrant;
  taskId: string | null;
  posX: number;
  posY: number;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

/**
 * 键盘事件的 target 不一定是 Element：从 window 派发的合成事件（自动化测试、
 * 部分输入法/扩展）会给出 Window，那里没有 closest。统一在这里收口。
 */
function eventElement(target: EventTarget | null): Element | null {
  return target instanceof Element ? target : null;
}

function pointInQuadrant(quadrant: Quadrant, clientX: number, clientY: number) {
  const cell = document.querySelector<HTMLElement>(`[data-quadrant="${quadrant}"]`);
  const layer = cell?.querySelector<HTMLElement>("[data-quadrant-layer]");
  const box = (layer ?? cell)?.getBoundingClientRect();
  if (!box) return { posX: 0.5, posY: 0.2 };
  return unitFromPoint(clientX, clientY, {
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
  });
}

/** 列表模式的落点：量一遍目标格里每张卡的竖直中线，算出插到第几个。 */
function measureInsertIndex(quadrant: Quadrant, target: DropTarget, draggedId: string): number {
  const cell = document.querySelector<HTMLElement>(`[data-quadrant="${quadrant}"]`);
  if (!cell) return 0;
  const nodes = Array.from(cell.querySelectorAll<HTMLElement>("[data-task-id]")).filter(
    (node) => node.getAttribute("data-task-id") !== draggedId,
  );
  const boundaries = nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return {
      id: node.getAttribute("data-task-id") ?? "",
      top: rect.top,
      height: rect.height,
    };
  });
  const y = target.rect.top + target.posY * target.rect.height;
  return insertionIndexForPoint(boundaries, y);
}

function fallbackCopy(text: string): boolean {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export function QuadrantBoard() {
  const { data: tasks, loading } = useBoardTasks();
  const goals = useAllGoals();
  const {
    viewMode,
    setViewMode,
    sortMode,
    setSortMode,
    draggingKind,
    draggingTaskId,
    overQuadrant,
    startTaskDrag,
    isClickSuppressed,
    setDropHandlers,
  } = useQuadrantDrag();
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const goalRailCollapsed = useUIStore((state) => state.goalRailCollapsed);
  const toggleGoalRail = useUIStore((state) => state.toggleGoalRailCollapsed);
  const setGoalRailDrawerOpen = useUIStore((state) => state.setGoalRailDrawerOpen);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [inline, setInline] = useState<InlineState | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [coordId, setCoordId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ taskId: string; posX: number; posY: number } | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);
  const [mobileFilter, setMobileFilter] = useState<0 | Quadrant>(0);

  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const inlineRef = useRef<InlineState | null>(inline);
  inlineRef.current = inline;
  const goalsByIdRef = useRef<Map<string, Goal>>(new Map());
  const pendingClick = useRef<{ id: string; timer: number } | null>(null);
  const undoTimer = useRef<number | null>(null);
  const undoTaskRef = useRef<Task | null>(null);

  const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const goalsById = useMemo(() => new Map(goals.map((goal) => [goal.id, goal])), [goals]);
  goalsByIdRef.current = goalsById;

  const stats = useMemo(() => computeBoardStats(tasks), [tasks]);
  const byQuadrant = useMemo(() => {
    const now = Date.now();
    const map: Record<Quadrant, Task[]> = { 1: [], 2: [], 3: [], 4: [] };
    for (const task of tasks) map[task.quadrant].push(task);
    for (const quadrant of QUADRANT_ORDER) {
      map[quadrant] = sortTasksForCell(map[quadrant], sortMode, now);
    }
    return map;
  }, [tasks, sortMode]);

  const detailTask = detailId ? (tasksById.get(detailId) ?? null) : null;
  const coordTask = coordId ? (tasksById.get(coordId) ?? null) : null;

  /**
   * 从系统通知点进来时，URL 上带 `?task=<id>`（提醒的 payload 就是这么拼的）。
   * 这里直接打开该任务详情，并把参数从地址栏抹掉——否则用户关掉面板后刷新会又弹一次。
   */
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const taskId = searchParams.get("task");
    if (!taskId) return;
    setDetailId(taskId);
    const next = new URLSearchParams(searchParams);
    next.delete("task");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(
    () => () => {
      if (pendingClick.current) window.clearTimeout(pendingClick.current.timer);
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
    },
    [],
  );

  const focusTask = useCallback((id: string) => {
    window.setTimeout(() => {
      document
        .querySelector<HTMLElement>(`[data-task-id="${id}"]`)
        ?.focus({ preventScroll: true });
    }, 80);
  }, []);

  /* ------------------------------- 打开详情 ------------------------------- */

  const openDetailNow = useCallback((id: string) => {
    setDetailId(id);
  }, []);

  /**
   * 单击打开详情，但要让位给双击完成：
   * 第一下先挂起 220ms，若第二下落在同一张卡上就取消打开（交给 dblclick 切换完成）。
   * 点了另一张卡则立刻把上一张打开，不会「什么都没发生」。
   */
  const handleOpen = useCallback(
    (task: Task) => {
      if (isClickSuppressed()) return;
      const pending = pendingClick.current;
      if (pending && pending.id === task.id) {
        window.clearTimeout(pending.timer);
        pendingClick.current = null;
        return;
      }
      if (pending) {
        window.clearTimeout(pending.timer);
        pendingClick.current = null;
        openDetailNow(pending.id);
      }
      const timer = window.setTimeout(() => {
        pendingClick.current = null;
        openDetailNow(task.id);
      }, 220);
      pendingClick.current = { id: task.id, timer };
    },
    [isClickSuppressed, openDetailNow],
  );

  const handleToggleDone = useCallback(
    (task: Task) => {
      if (isClickSuppressed()) return;
      const pending = pendingClick.current;
      if (pending && pending.id === task.id) {
        window.clearTimeout(pending.timer);
        pendingClick.current = null;
      }
      void toggleTaskDone(task);
    },
    [isClickSuppressed],
  );

  const handleMoveTo = useCallback(
    async (task: Task, quadrant: Quadrant) => {
      if (task.quadrant === quadrant) return;
      await moveTask(task, quadrant);
      toast({
        title: `已移到 Q${quadrant}`,
        description: QUADRANT_META[quadrant].name,
      });
      focusTask(task.id);
    },
    [focusTask, toast],
  );

  /* ------------------------------- 删除 / 撤销 ----------------------------- */

  const deleteWithUndo = useCallback(async (task: Task) => {
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    undoTaskRef.current = task;
    setUndo({ title: task.title, expiresAt: Date.now() + 5000 });
    undoTimer.current = window.setTimeout(() => {
      undoTimer.current = null;
      undoTaskRef.current = null;
      setUndo(null);
    }, 5000);
    await removeTask(task);
  }, []);

  const handleUndo = useCallback(async () => {
    if (undoTimer.current) {
      window.clearTimeout(undoTimer.current);
      undoTimer.current = null;
    }
    const task = undoTaskRef.current;
    undoTaskRef.current = null;
    setUndo(null);
    if (!task) return;
    await restoreTask(task);
    toast({ title: "已撤销删除", description: task.title, tone: "success" });
    focusTask(task.id);
  }, [focusTask, toast]);

  const dismissUndo = useCallback(() => {
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    undoTimer.current = null;
    undoTaskRef.current = null;
    setUndo(null);
  }, []);

  /* --------------------------------- 新建 --------------------------------- */

  const openInline = useCallback(
    (quadrant: Quadrant, position?: { posX: number; posY: number }) => {
      const existing = tasksRef.current.filter((task) => task.quadrant === quadrant);
      const fallback = nextFreePosition(existing);
      setInline({
        quadrant,
        posX: position?.posX ?? fallback.posX,
        posY: position?.posY ?? fallback.posY,
      });
    },
    [],
  );

  const submitInline = useCallback(
    async (title: string) => {
      const composer = inlineRef.current;
      if (!composer) return;
      const task = await createTask({
        title,
        quadrant: composer.quadrant,
        posX: composer.posX,
        posY: composer.posY,
        source: "manual",
      });
      setInline(null);
      setSelectedId(task.id);
      focusTask(task.id);
    },
    [focusTask],
  );

  const cancelInline = useCallback(() => setInline(null), []);

  /* ------------------------------- 右键菜单 ------------------------------- */

  const handleTaskContextMenu = useCallback((task: Task, event: ReactMouseEvent) => {
    setMenu({
      x: event.clientX,
      y: event.clientY,
      quadrant: task.quadrant,
      taskId: task.id,
      posX: task.posX,
      posY: task.posY,
    });
  }, []);

  const handleCellContextMenu = useCallback((quadrant: Quadrant, event: ReactMouseEvent) => {
    event.preventDefault();
    const point = pointInQuadrant(quadrant, event.clientX, event.clientY);
    setMenu({
      x: event.clientX,
      y: event.clientY,
      quadrant,
      taskId: null,
      posX: point.posX,
      posY: point.posY,
    });
  }, []);

  const handleCellDoubleClick = useCallback(
    (quadrant: Quadrant, event: ReactMouseEvent) => {
      const point = pointInQuadrant(quadrant, event.clientX, event.clientY);
      openInline(quadrant, point);
    },
    [openInline],
  );

  const menuItems: MenuEntry[] = useMemo(() => {
    if (!menu) return [];
    const task = menu.taskId ? tasksById.get(menu.taskId) : undefined;
    if (!task) return buildCellContextMenu();
    return buildTaskContextMenu({ task, goals, quadrant: task.quadrant });
  }, [menu, tasksById, goals]);

  const copyTitle = useCallback(
    async (task: Task) => {
      try {
        await navigator.clipboard.writeText(task.title);
        toast({ title: "已复制标题" });
      } catch {
        if (fallbackCopy(task.title)) toast({ title: "已复制标题" });
        else toast({ title: "复制失败", description: "浏览器不允许访问剪贴板", tone: "danger" });
      }
    },
    [toast],
  );

  const handleMenuSelect = useCallback(
    (key: string) => {
      const current = menu;
      const task = current?.taskId ? tasksById.get(current.taskId) : undefined;

      if (key === "new") {
        openInline(
          current?.quadrant ?? 2,
          task ? undefined : { posX: current?.posX ?? 0.5, posY: current?.posY ?? 0.2 },
        );
        return;
      }
      if (!task) return;

      if (key === "toggle-done") {
        void toggleTaskDone(task);
        return;
      }
      if (key.startsWith("move:")) {
        const quadrant = Number(key.slice(5));
        if (quadrant === 1 || quadrant === 2 || quadrant === 3 || quadrant === 4) {
          void handleMoveTo(task, quadrant);
        }
        return;
      }
      if (key === "coords") {
        setCoordId(task.id);
        return;
      }
      if (key.startsWith("goal:")) {
        const value = key.slice(5);
        if (value === "new") {
          openGoalDialog({
            title: task.title.slice(0, 60),
            onCreated: (goal) => {
              void setTaskGoal(task, goal.id).then(() => {
                toast({ title: "已关联目标", description: goal.title, tone: "success" });
              });
            },
          });
        } else if (value === "clear") {
          void setTaskGoal(task, null);
        } else if (value !== "none") {
          void setTaskGoal(task, value);
        }
        return;
      }
      if (key === "copy") {
        void copyTitle(task);
        return;
      }
      if (key === "delete") {
        if (detailId === task.id) setDetailId(null);
        void deleteWithUndo(task);
      }
    },
    [copyTitle, deleteWithUndo, detailId, handleMoveTo, menu, openInline, tasksById, toast],
  );

  /* --------------------------------- 拖拽 --------------------------------- */

  const handleStartDrag = useCallback(
    (task: Task, event: ReactPointerEvent<HTMLElement>) => {
      const goal = task.goalId ? (goalsByIdRef.current.get(task.goalId) ?? null) : null;
      setSelectedId(task.id);
      startTaskDrag(task, goal, event);
    },
    [startTaskDrag],
  );

  const handleDrop = useCallback(
    async (payload: DragPayload, target: DropTarget) => {
      if (payload.kind === "goal") {
        const created = await createTaskFromGoal(payload.goal, target);
        toast({
          title: "已把目标变成任务",
          description: `${payload.goal.title} · Q${target.quadrant}`,
          tone: "success",
        });
        setSelectedId(created.id);
        focusTask(created.id);
        return;
      }

      const { task } = payload;
      if (viewMode === "free") {
        await moveTask(task, target.quadrant, { posX: target.posX, posY: target.posY });
        return;
      }

      const index = measureInsertIndex(target.quadrant, target, task.id);
      const others = sortTasksForCell(
        tasksRef.current.filter(
          (item) => item.quadrant === target.quadrant && item.id !== task.id,
        ),
        sortMode,
        Date.now(),
      );
      const sortIndex = sortIndexForInsertion(others, index);
      await moveTask(task, target.quadrant, { sortIndex });
      if (task.quadrant !== target.quadrant) {
        toast({
          title: `已移到 Q${target.quadrant}`,
          description: QUADRANT_META[target.quadrant].name,
        });
      }
    },
    [focusTask, sortMode, toast, viewMode],
  );

  useEffect(() => {
    setDropHandlers({ drop: handleDrop });
    return () => setDropHandlers({});
  }, [handleDrop, setDropHandlers]);

  /* --------------------------------- 键盘 --------------------------------- */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = eventElement(event.target);
      // 弹层里的键盘行为由弹层自己处理（Esc、方向键、输入）
      if (target?.closest("[role='dialog']")) return;

      if (event.key === "Escape") {
        if (menu) {
          setMenu(null);
          return;
        }
        if (inline) setInline(null);
        return;
      }
      // 输入中一律放行：Delete / Ctrl+Z / 方向键都不该被板子劫持
      if (isTyping(event.target)) return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        if (!undoTaskRef.current) return;
        event.preventDefault();
        void handleUndo();
        return;
      }
      if (event.altKey || event.shiftKey) return;

      const selected = selectedId ? tasksById.get(selectedId) : undefined;

      if ((event.metaKey || event.ctrlKey) && event.key.startsWith("Arrow")) {
        if (!selected) return;
        const direction = event.key.replace("Arrow", "").toLowerCase();
        if (
          direction !== "left" &&
          direction !== "right" &&
          direction !== "up" &&
          direction !== "down"
        ) {
          return;
        }
        event.preventDefault();
        const next = moveQuadrant(selected.quadrant, direction as MoveDirection);
        if (next !== selected.quadrant) void handleMoveTo(selected, next);
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        if (!selected) return;
        event.preventDefault();
        void deleteWithUndo(selected);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteWithUndo, handleMoveTo, handleUndo, inline, menu, selectedId, tasksById]);

  const handleFocusCapture = useCallback((event: ReactFocusEvent<HTMLDivElement>) => {
    const id = eventElement(event.target)?.closest("[data-task-id]")?.getAttribute("data-task-id");
    if (id) setSelectedId(id);
  }, []);

  const handlePointerDownCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const id = eventElement(event.target)?.closest("[data-task-id]")?.getAttribute("data-task-id");
    if (id) setSelectedId(id);
  }, []);

  /* ------------------------------- 坐标面板 ------------------------------- */

  const handleCoordinateConfirm = useCallback(
    async (task: Task, posX: number, posY: number) => {
      setPreview(null);
      await setTaskPosition(task, posX, posY);
      setCoordId(null);
      if (viewMode === "list") {
        setViewMode("free");
        toast({
          title: "已切到自由视图",
          description: "坐标已保存，卡片按坐标摆放",
        });
      }
      focusTask(task.id);
    },
    [focusTask, setViewMode, toast, viewMode],
  );

  const openGoalRail = useCallback(() => setGoalRailDrawerOpen(true), [setGoalRailDrawerOpen]);

  const visibleQuadrants: Quadrant[] =
    isMobile && mobileFilter !== 0 ? [mobileFilter] : QUADRANT_ORDER;

  const openCount = (quadrant: Quadrant) =>
    byQuadrant[quadrant].filter((task) => task.status !== "done" && task.status !== "dropped").length;

  if (loading) return <BoardSkeleton />;

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      onFocusCapture={handleFocusCapture}
      onPointerDownCapture={handlePointerDownCapture}
    >
      <BoardStatsBar
        stats={stats}
        viewMode={viewMode}
        onViewModeChange={(mode: ViewMode) => setViewMode(mode)}
        sortMode={sortMode}
        onSortModeChange={(mode: SortMode) => setSortMode(mode)}
        onOpenGoalRail={openGoalRail}
        onToggleGoalRail={toggleGoalRail}
        goalRailCollapsed={goalRailCollapsed}
      />

      {/* 移动端：Q1–Q4 + 全部，吸在主标题栏下方；按钮自身可压缩，不裁切。
          横向滚动放在 nav 上而不是里面那层：里面的圆角胶囊只有 36 高，
          一旦它自己 overflow-x:auto，分段按钮补出来的 44 命中区会被裁回 36。 */}
      <nav
        aria-label="象限筛选"
        className="no-scrollbar sticky top-[52px] z-20 -mx-4 mt-3 overflow-x-auto border-b border-border bg-bg/95 px-4 py-2 backdrop-blur md:hidden"
      >
        <div className="flex items-center gap-1 rounded-full bg-surface-sunken/80 p-1">
          {([0, ...QUADRANT_ORDER] as const).map((value) => {
            const active = mobileFilter === value;
            const count = value === 0 ? stats.open : openCount(value);
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => setMobileFilter(value)}
                className={cn(
                  "relative flex h-7 min-w-0 flex-1 basis-0 items-center justify-center gap-1 rounded-full px-1 text-caption whitespace-nowrap transition-colors duration-[var(--dur-1)]",
                  // 分段控件视觉 28 高，命中区补到 44：上下各借 8px（落在 nav 的 py-2 里），
                  // 左右各借 2px 正好吃掉 gap-1 的一半，不与相邻分段重叠。
                  "after:absolute after:-inset-y-2 after:-inset-x-0.5 after:content-['']",
                  active
                    ? "bg-surface-solid text-ink-900 shadow-1"
                    : "text-ink-500 hover:text-ink-700",
                )}
              >
                {value !== 0 && (
                  <span
                    aria-hidden="true"
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: `var(--q${value}-accent)` }}
                  />
                )}
                {value === 0 ? "全部" : `Q${value}`}
                <span className="tabular text-micro text-ink-300">{count}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* 移动端格间距 12 → 8：四格纵向堆叠时这一项直接决定「一屏能看见几个象限」 */}
      <div className="mt-3 grid min-h-0 flex-1 grid-cols-1 gap-2 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:grid-cols-2 md:grid-rows-2 md:gap-4 md:pb-0">
        {visibleQuadrants.map((quadrant) => (
          <QuadrantCell
            key={quadrant}
            quadrant={quadrant}
            tasks={byQuadrant[quadrant]}
            viewMode={viewMode}
            goalsById={goalsById}
            selectedId={selectedId}
            draggingTaskId={draggingTaskId}
            overQuadrant={overQuadrant}
            goalDragActive={draggingKind === "goal"}
            composer={
              inline && inline.quadrant === quadrant
                ? { posX: inline.posX, posY: inline.posY }
                : null
            }
            preview={preview}
            onOpen={handleOpen}
            onToggleDone={handleToggleDone}
            onContextMenu={handleTaskContextMenu}
            onStartDrag={handleStartDrag}
            onCellContextMenu={handleCellContextMenu}
            onCellDoubleClick={handleCellDoubleClick}
            onAdd={openInline}
            onComposerSubmit={submitInline}
            onComposerCancel={cancelInline}
          />
        ))}
      </div>

      <ContextMenu
        open={Boolean(menu)}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        items={menuItems}
        label={menu?.taskId ? "任务操作" : "象限操作"}
        onSelect={handleMenuSelect}
        onClose={() => setMenu(null)}
      />

      <CoordinateDialog
        task={coordTask}
        freeMode={viewMode === "free"}
        onClose={() => {
          setCoordId(null);
          setPreview(null);
        }}
        onPreview={setPreview}
        onConfirm={(task, posX, posY) => {
          void handleCoordinateConfirm(task, posX, posY);
        }}
      />

      <TaskDetailPanel
        task={detailTask}
        goals={goals}
        side={isMobile ? "bottom" : "right"}
        onClose={() => setDetailId(null)}
        onPatch={(task, patch) => {
          void patchTask(task, patch);
        }}
        onToggleDone={(task) => {
          void toggleTaskDone(task);
        }}
        onMoveQuadrant={(task, quadrant) => {
          void handleMoveTo(task, quadrant);
        }}
        onRequestDelete={(task) => setDeleteTarget(task)}
      />

      <UndoBar undo={undo} onUndo={() => void handleUndo()} onDismiss={dismissUndo} />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="删除这条任务？"
        description={
          deleteTarget
            ? `「${deleteTarget.title}」会被移出四象限，5 秒内可以撤销。`
            : undefined
        }
        confirmLabel="删除"
        tone="danger"
        onConfirm={() => {
          const target = deleteTarget;
          if (!target) return;
          setDetailId(null);
          void deleteWithUndo(target);
        }}
      />
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
      <div className="flex items-center gap-3">
        <div className="h-5 w-24 animate-pulse rounded bg-surface-sunken" />
        <div className="h-3 w-40 animate-pulse rounded bg-surface-sunken" />
      </div>
      <div className="mt-3 grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-2 md:grid-rows-2 md:gap-4">
        {QUADRANT_ORDER.map((quadrant) => (
          <div
            key={quadrant}
            className="min-h-[220px] animate-pulse rounded-2xl border border-border bg-surface"
          />
        ))}
      </div>
    </div>
  );
}

export default QuadrantBoard;
