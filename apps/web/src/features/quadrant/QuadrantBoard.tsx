import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { FocusEvent as ReactFocusEvent, MouseEvent as ReactMouseEvent } from "react";
import type { Goal, Quadrant, Task } from "@detter/shared";
import { QUADRANT_META } from "@detter/shared";
import { useToast } from "@detter/ui";
import { useUIStore } from "@/stores/ui";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { createTaskFromGoal } from "@/features/goals/goal-actions";
import { openGoalDialog } from "@/features/goals/goal-dialog";
import { useQuadrantDrag } from "./DragProvider";
import { useAllGoals, useBoardTasks } from "./queries";
import { useIsMobile } from "./useMediaQuery";
import { computeBoardStats } from "./stats";
import {
  moveQuadrant,
  nextFreePlanePosition,
  resolveTaskPoint,
  type MoveDirection,
  type PlanePoint,
} from "./geometry";
import { useCoordinateMigration } from "./coord-migration";
import { buildCellContextMenu, buildTaskContextMenu, type MenuEntry } from "./menu-model";
import type { DragPayload, DropTarget } from "./types";
import { BoardStatsBar } from "./BoardStatsBar";
import { QuadrantPlane } from "./QuadrantPlane";
import { ContextMenu } from "./ContextMenu";
import { CoordinateDialog } from "./CoordinateDialog";
import { TaskDetailPanel } from "./TaskDetailPanel";
import { UndoBar, type UndoState } from "./UndoBar";
import {
  createTask,
  moveTask,
  patchTask,
  placeTask,
  removeTask,
  restoreTask,
  setTaskGoal,
  setTaskPosition,
  toggleTaskDone,
} from "./task-actions";

/**
 * 四象限首页：一张连续的坐标系平面。
 *
 * 这一层只做三件事：把数据分好、把交互（新建/拖动/右键/键盘/撤销）串起来、
 * 把浮层挂上去。视觉与坐标几何分别在 QuadrantPlane / PlaneChrome / geometry 里。
 *
 * 关于 quadrant：它仍然写库（筛选/统计/接口都用它），但每次坐标变化都由
 * task-actions 的 patchTask 重新推导，组件不手动维护第二份事实。
 */

interface MenuState {
  x: number;
  y: number;
  taskId: string | null;
  point: PlanePoint;
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
  const { draggingKind, overQuadrant, isClickSuppressed, setDropHandlers } = useQuadrantDrag();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const { ready: coordsReady } = useCoordinateMigration();

  const goalRailCollapsed = useUIStore((state) => state.goalRailCollapsed);
  const toggleGoalRail = useUIStore((state) => state.toggleGoalRailCollapsed);
  const setGoalRailDrawerOpen = useUIStore((state) => state.setGoalRailDrawerOpen);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [inline, setInline] = useState<PlanePoint | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [coordId, setCoordId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ taskId: string; posX: number; posY: number } | null>(
    null,
  );
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);

  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const goalsByIdRef = useRef<Map<string, Goal>>(new Map());
  const pendingClick = useRef<{ id: string; timer: number } | null>(null);
  const undoTimer = useRef<number | null>(null);
  const undoActionRef = useRef<(() => Promise<void>) | null>(null);

  const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const goalsById = useMemo(() => new Map(goals.map((goal) => [goal.id, goal])), [goals]);
  goalsByIdRef.current = goalsById;

  const stats = useMemo(() => computeBoardStats(tasks), [tasks]);

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

  const clearPendingClick = useCallback(() => {
    if (pendingClick.current) {
      window.clearTimeout(pendingClick.current.timer);
      pendingClick.current = null;
    }
  }, []);

  const focusTask = useCallback((id: string) => {
    window.setTimeout(() => {
      document
        .querySelector<HTMLElement>(`[data-plane-task="${id}"]`)
        ?.focus({ preventScroll: true });
    }, 80);
  }, []);

  /* ------------------------------- 打开详情 ------------------------------- */

  const openDetailNow = useCallback((id: string) => {
    setDetailId(id);
  }, []);

  /**
   * 单击打开详情，但要让位给双击完成：
   * 第一下先挂起 220ms，若第二下落在同一个圆点上就取消打开（交给 dblclick 切换完成）。
   * 点了另一个圆点则立刻把上一个打开，不会「什么都没发生」。
   */
  const handleOpen = useCallback(
    (task: Task) => {
      if (isClickSuppressed()) return;
      const pending = pendingClick.current;
      if (pending && pending.id === task.id) {
        clearPendingClick();
        return;
      }
      if (pending) {
        clearPendingClick();
        openDetailNow(pending.id);
      }
      const timer = window.setTimeout(() => {
        pendingClick.current = null;
        openDetailNow(task.id);
      }, 220);
      pendingClick.current = { id: task.id, timer };
    },
    [clearPendingClick, isClickSuppressed, openDetailNow],
  );

  const handleToggleDone = useCallback(
    (task: Task) => {
      if (isClickSuppressed()) return;
      clearPendingClick();
      void toggleTaskDone(task);
    },
    [clearPendingClick, isClickSuppressed],
  );

  /* ------------------------------- 撤销条 -------------------------------- */

  const showUndo = useCallback((state: Omit<UndoState, "expiresAt">, action: () => Promise<void>) => {
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    undoActionRef.current = action;
    setUndo({ ...state, expiresAt: Date.now() + 5000 });
    undoTimer.current = window.setTimeout(() => {
      undoTimer.current = null;
      undoActionRef.current = null;
      setUndo(null);
    }, 5000);
  }, []);

  const handleUndo = useCallback(async () => {
    if (undoTimer.current) {
      window.clearTimeout(undoTimer.current);
      undoTimer.current = null;
    }
    const action = undoActionRef.current;
    undoActionRef.current = null;
    setUndo(null);
    if (!action) return;
    try {
      await action();
      toast({ title: "已撤销", tone: "success" });
    } catch {
      toast({ title: "撤销失败", description: "请刷新后再试", tone: "danger" });
    }
  }, [toast]);

  const dismissUndo = useCallback(() => {
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    undoTimer.current = null;
    undoActionRef.current = null;
    setUndo(null);
  }, []);

  const rememberMove = useCallback(
    (
      task: Task,
      before: Pick<Task, "posX" | "posY" | "quadrant">,
      message: string,
    ) => {
      showUndo({ title: task.title, kind: "move", message }, async () => {
        const current = tasksRef.current.find((entry) => entry.id === task.id);
        if (!current) return;
        await patchTask(current, {
          posX: before.posX,
          posY: before.posY,
          quadrant: before.quadrant,
        });
        focusTask(task.id);
      });
    },
    [focusTask, showUndo],
  );

  /* ------------------------------- 删除 / 撤销 ----------------------------- */

  const deleteWithUndo = useCallback(
    async (task: Task) => {
      showUndo(
        {
          title: task.title,
          kind: "delete",
          message: `已删除「${task.title}」`,
        },
        async () => {
          await restoreTask(task);
          focusTask(task.id);
        },
      );
      await removeTask(task);
    },
    [focusTask, showUndo],
  );

  /* --------------------------------- 新建 --------------------------------- */

  const allPoints = useMemo(() => tasks.map((task) => resolveTaskPoint(task)), [tasks]);

  const openInline = useCallback(
    (point?: PlanePoint) => {
      setInline(
        point ? { x: point.x, y: point.y } : nextFreePlanePosition(allPoints),
      );
    },
    [allPoints],
  );

  const submitInline = useCallback(
    async (title: string) => {
      const composer = inline;
      if (!composer) return;
      const task = await createTask({
        title,
        posX: composer.x,
        posY: composer.y,
        source: "manual",
      });
      setInline(null);
      setSelectedId(task.id);
      focusTask(task.id);
    },
    [focusTask, inline],
  );

  const cancelInline = useCallback(() => setInline(null), []);

  /* ------------------------------- 右键菜单 ------------------------------- */

  const handleTaskContextMenu = useCallback((task: Task, event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    setMenu({
      x: event.clientX,
      y: event.clientY,
      taskId: task.id,
      point: resolveTaskPoint(task),
    });
  }, []);

  const handleLongPress = useCallback((task: Task, x: number, y: number) => {
    setMenu({ x, y, taskId: task.id, point: resolveTaskPoint(task) });
  }, []);

  const handleBlankContextMenu = useCallback(
    (point: PlanePoint, event: ReactMouseEvent<HTMLElement>) => {
      setMenu({
        x: event.clientX,
        y: event.clientY,
        taskId: null,
        point,
      });
    },
    [],
  );

  const handleBlankDoubleClick = useCallback(
    (point: PlanePoint) => {
      openInline(point);
    },
    [openInline],
  );

  const menuItems: MenuEntry[] = useMemo(() => {
    if (!menu) return [];
    const task = menu.taskId ? tasksById.get(menu.taskId) : undefined;
    if (!task) return buildCellContextMenu();
    return buildTaskContextMenu({
      task,
      goals,
      quadrant: task.quadrant,
    });
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

  const handleMoveTo = useCallback(
    async (task: Task, quadrant: Quadrant) => {
      if (task.quadrant === quadrant) return;
      const before = { posX: task.posX, posY: task.posY, quadrant: task.quadrant };
      const updated = await moveTask(task, quadrant);
      rememberMove(
        updated,
        before,
        `已移到 Q${quadrant} ${QUADRANT_META[quadrant].name}`,
      );
      focusTask(task.id);
    },
    [focusTask, rememberMove],
  );

  const handleMenuSelect = useCallback(
    (key: string) => {
      const current = menu;
      const task = current?.taskId ? tasksById.get(current.taskId) : undefined;

      if (key === "new") {
        openInline(current?.point);
        return;
      }
      if (!task) return;

      if (key === "toggle-done") {
        clearPendingClick();
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
        clearPendingClick();
        void deleteWithUndo(task);
      }
    },
    [
      clearPendingClick,
      copyTitle,
      deleteWithUndo,
      detailId,
      handleMoveTo,
      menu,
      openInline,
      tasksById,
      toast,
    ],
  );

  /* --------------------------------- 拖拽 --------------------------------- */

  const handleMoveTask = useCallback(
    async (task: Task, point: PlanePoint) => {
      const before = { posX: task.posX, posY: task.posY, quadrant: task.quadrant };
      if (Math.abs(before.posX - point.x) < 0.001 && Math.abs(before.posY - point.y) < 0.001) {
        return;
      }
      const updated = await placeTask(task, point.x, point.y);
      rememberMove(updated, before, `已移动「${task.title}」`);
      setSelectedId(task.id);
    },
    [rememberMove],
  );

  const handleDrop = useCallback(
    async (payload: DragPayload, target: DropTarget) => {
      if (payload.kind === "goal") {
        const created = await createTaskFromGoal(payload.goal, {
          quadrant: target.quadrant,
          posX: target.posX,
          posY: target.posY,
        });
        toast({
          title: "已把目标变成任务",
          description: `${payload.goal.title} · Q${target.quadrant}`,
          tone: "success",
        });
        setSelectedId(created.id);
        focusTask(created.id);
      }
    },
    [focusTask, toast],
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
        if (!undoActionRef.current) return;
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
    const id = eventElement(event.target)
      ?.closest("[data-plane-task]")
      ?.getAttribute("data-plane-task");
    if (id) setSelectedId(id);
  }, []);

  /* ------------------------------- 坐标面板 ------------------------------- */

  const handleCoordinateConfirm = useCallback(
    async (task: Task, posX: number, posY: number) => {
      setPreview(null);
      await setTaskPosition(task, posX, posY);
      setCoordId(null);
      focusTask(task.id);
    },
    [focusTask],
  );

  const openGoalRail = useCallback(() => setGoalRailDrawerOpen(true), [setGoalRailDrawerOpen]);

  if (loading || !coordsReady) return <BoardSkeleton />;

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      onFocusCapture={handleFocusCapture}
    >
      <BoardStatsBar
        stats={stats}
        onNewTask={() => openInline()}
        onOpenGoalRail={openGoalRail}
        onToggleGoalRail={toggleGoalRail}
        goalRailCollapsed={goalRailCollapsed}
      />

      <div className="mt-3 flex min-h-0 flex-1 flex-col">
        <QuadrantPlane
          tasks={tasks}
          goalsById={goalsById}
          stats={stats}
          selectedId={selectedId}
          overQuadrant={overQuadrant}
          goalDragActive={draggingKind === "goal"}
          composer={inline}
          preview={preview}
          onSelect={setSelectedId}
          onOpen={handleOpen}
          onToggleDone={handleToggleDone}
          onContextMenu={handleTaskContextMenu}
          onLongPress={handleLongPress}
          onBlankContextMenu={handleBlankContextMenu}
          onBlankDoubleClick={handleBlankDoubleClick}
          onMoveTask={handleMoveTask}
          onComposerSubmit={submitInline}
          onComposerCancel={cancelInline}
        />
      </div>

      <ContextMenu
        open={Boolean(menu)}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        items={menuItems}
        label={menu?.taskId ? "任务操作" : "平面操作"}
        onSelect={handleMenuSelect}
        onClose={() => setMenu(null)}
      />

      <CoordinateDialog
        task={coordTask}
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
            ? `「${deleteTarget.title}」会从平面上消失，5 秒内可以撤销。`
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3">
        <div className="h-5 w-24 animate-pulse rounded bg-surface-sunken" />
        <div className="h-3 w-40 animate-pulse rounded bg-surface-sunken" />
      </div>
      <div className="mt-3 h-[560px] animate-pulse rounded-3xl border border-border bg-surface md:h-auto md:flex-1" />
    </div>
  );
}

export default QuadrantBoard;
