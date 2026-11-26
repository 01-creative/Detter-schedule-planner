import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, CornerDownRight, MousePointerClick, Undo2, X } from "lucide-react";
import type { Goal, MindMap, MindNode, Task } from "@detter/shared";
import { cn, useToast } from "@detter/ui";
import {
  cameraCenter,
  cameraFromCenter,
  clampZoom,
  fitCamera,
  gridStep,
  isPointVisible,
  panBy,
  worldToScreen,
  zoomAtPoint,
  zoomStep,
  type Camera,
  type ViewportSize,
} from "./camera";
import {
  cullLayout,
  layoutMindMap,
  type LayoutNode,
} from "./layout";
import {
  findNodeAt,
  midpoint,
  movedBeyondThreshold,
  pinchCamera,
  quantizePosition,
  toLocalPoint,
  toScreenRect,
  wheelZoomFactor,
  worldDelta,
  distanceBetween,
  type PinchStart,
  type Point,
  type ScreenRect,
} from "./interaction";
import {
  deleteSubtree,
  createNode,
  DEFAULT_ROOT_TEXT,
  NEW_NODE_TEXT,
  patchNode,
  pinNode,
  renameNode,
  reparentNode,
  setLinkedTaskDone,
  setNodeCollapsed,
  setNodeColor,
  convertNodeToTask,
  restoreNodes,
  resolveGoalId,
  saveViewport,
} from "./mindmap-actions";
import { canReparent, nextSortIndex, subtreeIds } from "./tree";
import { CanvasControls } from "./CanvasControls";
import { MindEdges } from "./MindEdges";
import { MindNodeCard, type EditIntent } from "./MindNodeCard";
import { NodeToolbar, TOOLBAR_HEIGHT, TOOLBAR_WIDTH } from "./NodeToolbar";

/**
 * 画布层。
 *
 * 交互全部在这里收口，节点卡片只负责「长什么样」：
 * - 空白拖拽 / 空格 + 拖拽 / 双指 → 平移、缩放（相机是 state，但只在指针事件里更新）；
 * - 节点拖拽 → 直接改 `style.transform`（ref），松手才写库，不触发 React 渲染；
 * - 键盘（Tab / Enter / Delete / 方向键）→ 建树、删子树、在节点间移动选中；
 * - 视口裁剪 → 只渲染视口 ±400px 内的节点（cullLayout）。
 */

export interface MindMapStageProps {
  map: MindMap;
  nodes: readonly MindNode[];
  goals: readonly Goal[];
  tasks: readonly Task[];
  /** 节点是否已经从本地库读回来了：没读回来之前不要定相机，否则会按「空图」居中 */
  nodesReady?: boolean;
  /** 新建的节点 id；用来在导图刚建好时把根节点带进编辑态 */
  autoEditId?: string | null;
  className?: string;
}

interface DragSession {
  id: string;
  pointerId: number;
  startClient: Point;
  origin: Point;
  current: Point;
  moved: boolean;
  targetId: string | null;
  element: HTMLElement | null;
  exclude: Set<string>;
}

interface PanSession {
  pointerId: number;
  startClient: Point;
  startCamera: Camera;
}

interface PinchSessionState extends PinchStart {
  pointers: Map<number, Point>;
}

interface UndoState {
  snapshots: MindNode[];
  text: string;
}

const DEFAULT_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };
const CULL_MARGIN = 400;
const VIEWPORT_PADDING = 72;

function hasSavedViewport(map: MindMap): boolean {
  return map.viewportX !== 0 || map.viewportY !== 0 || map.viewportZoom !== 1;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("button, a, [role='menuitem'], [role='menu'], [role='dialog']"));
}

export function MindMapStage({
  map,
  nodes,
  goals,
  tasks,
  nodesReady = true,
  autoEditId = null,
  className,
}: MindMapStageProps) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const dragRef = useRef<DragSession | null>(null);
  const panRef = useRef<PanSession | null>(null);
  const pinchRef = useRef<PinchSessionState | null>(null);
  const pointersRef = useRef(new Map<number, Point>());
  const cameraRef = useRef<Camera>(DEFAULT_CAMERA);
  const viewportRef = useRef<ViewportSize>({ width: 0, height: 0 });
  const mapRef = useRef(map);
  mapRef.current = map;
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA);
  const [viewport, setViewport] = useState<ViewportSize>({ width: 0, height: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(autoEditId);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [converting, setConverting] = useState(false);

  cameraRef.current = camera;
  viewportRef.current = viewport;

  /* ------------------------------------------------------------------ */
  /*                              结构与派生                              */
  /* ------------------------------------------------------------------ */

  const layout = useMemo(() => layoutMindMap(nodes), [nodes]);
  const culled = useMemo(
    () => cullLayout(layout, camera, viewport, CULL_MARGIN),
    [layout, camera, viewport],
  );
  // 签名不变就复用同一份数组：平移时不让连线层无谓重渲染
  // （依赖故意只写 signature：数组本身每次裁剪都是新引用，但那不是内容变化）
  const edges = useMemo(() => culled.edges, [culled.signature]);

  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const goalById = useMemo(() => new Map(goals.map((goal) => [goal.id, goal])), [goals]);

  const selectedNode = selectedId ? (layout.byId.get(selectedId) ?? null) : null;

  /* ------------------------------------------------------------------ */
  /*                                相机                                 */
  /* ------------------------------------------------------------------ */

  const appliedViewportRef = useRef<string | null>(null);
  const userMovedCameraRef = useRef(false);
  const saveViewportNow = useCallback((next: Camera) => {
    const target = mapRef.current;
    const size = viewportRef.current;
    if (size.width === 0 || size.height === 0) return;
    // 存「世界中心 + 缩放」而不是像素偏移：换设备/换窗口宽度后仍能回到同一处
    const center = cameraCenter(next, size);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void saveViewport(target, {
        x: Math.round(center.x),
        y: Math.round(center.y),
        zoom: next.zoom,
      });
    }, 600);
  }, []);

  const setCameraAndPersist = useCallback(
    (next: Camera) => {
      userMovedCameraRef.current = true;
      cameraRef.current = next;
      setCamera(next);
      saveViewportNow(next);
    },
    [saveViewportNow],
  );

  /**
   * 相机初始化。
   *
   * 为什么不是「每张图只初始化一次」：同步会把同一张图的多条变更依次写进来
   * （先建图、后改视口），如果第一次写入时就锁死相机，第二次更新永远不生效，
   * 表现是「在另一台设备上明明缩放到了 144%，打开还是 100%」。
   * 所以改成：**用户还没动过相机之前**，视口每变一次就重新套用一次；
   * 用户一旦平移/缩放，就彻底交还给他，后续同步不再抢相机。
   */
  useEffect(() => {
    if (!nodesReady) return;
    if (viewport.width === 0 || viewport.height === 0) return;
    if (userMovedCameraRef.current) return;
    const signature = `${map.id}|${map.viewportX}|${map.viewportY}|${map.viewportZoom}`;
    if (appliedViewportRef.current === signature) return;
    appliedViewportRef.current = signature;

    // 上次的视口原样恢复：视口存的是**世界中心 + 缩放**，与窗口尺寸无关，
    // 换到更窄的窗口时根节点依然在屏幕中央（只是两侧分支会被裁掉，拖一下就能看到）。
    // 只有「从来没有保存过视口」的图才适应画布。
    const next = hasSavedViewport(map)
      ? cameraFromCenter(
          { x: map.viewportX, y: map.viewportY },
          clampZoom(map.viewportZoom),
          viewport,
        )
      : fitCamera(layout.bounds, viewport, VIEWPORT_PADDING);
    cameraRef.current = next;
    setCamera(next);
  }, [map.id, map.viewportX, map.viewportY, map.viewportZoom, viewport, layout.bounds, nodesReady]);

  /** 编辑中的节点不在视野里就把它带进来（新建孙节点时最常见） */
  useEffect(() => {
    if (!editingId || viewport.width === 0) return;
    const target = layout.byId.get(editingId);
    if (!target) return;
    const centerX = target.x + target.width / 2;
    const centerY = target.y + target.height / 2;
    const current = cameraRef.current;
    if (isPointVisible(current, viewport, centerX, centerY, 64)) return;
    setCameraAndPersist(cameraFromCenter({ x: centerX, y: centerY }, current.zoom, viewport));
  }, [editingId, layout, viewport, setCameraAndPersist]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () => {
      setViewport({ width: element.clientWidth, height: element.clientHeight });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  /* 刚建好的图：根节点直接进编辑态（由 shell 传 autoEditId） */
  const autoEditRef = useRef<string | null>(null);
  useEffect(() => {
    if (!autoEditId || autoEditRef.current === autoEditId) return;
    if (!layout.byId.has(autoEditId)) return;
    autoEditRef.current = autoEditId;
    setSelectedId(autoEditId);
    setEditingId(autoEditId);
  }, [autoEditId, layout]);

  /* ------------------------------------------------------------------ */
  /*                              工具函数                                */
  /* ------------------------------------------------------------------ */

  const registerCard = useCallback((id: string, element: HTMLElement | null) => {
    if (element) cardRefs.current.set(id, element);
    else cardRefs.current.delete(id);
  }, []);

  const zoomIn = useCallback(() => {
    if (viewport.width === 0) return;
    setCameraAndPersist(zoomStep(cameraRef.current, 1, viewport));
  }, [setCameraAndPersist, viewport]);

  const zoomOut = useCallback(() => {
    if (viewport.width === 0) return;
    setCameraAndPersist(zoomStep(cameraRef.current, -1, viewport));
  }, [setCameraAndPersist, viewport]);

  const fitToCanvas = useCallback(() => {
    if (viewport.width === 0) return;
    setCameraAndPersist(fitCamera(layout.bounds, viewport, VIEWPORT_PADDING));
  }, [layout.bounds, setCameraAndPersist, viewport]);

  /* 滚轮缩放必须用非 passive 原生监听：React 的 onWheel 在根节点上是 passive 的，
     preventDefault 会失效，表现为「滚轮同时缩放并滚动整页」。 */
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const point = toLocalPoint(rect, event.clientX, event.clientY);
      const current = cameraRef.current;
      if (event.altKey) {
        // Alt + 滚轮：平移（给习惯「滚轮滚页面」的人留一个出口）
        setCameraAndPersist(panBy(current, -event.deltaX, -event.deltaY));
        return;
      }
      setCameraAndPersist(zoomAtPoint(current, current.zoom * wheelZoomFactor(event.deltaY), point.x, point.y));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [setCameraAndPersist]);

  /* ------------------------------------------------------------------ */
  /*                                拖动                                 */
  /* ------------------------------------------------------------------ */

  const screenRects = useCallback((): ScreenRect[] => {
    return culled.nodes.map((node) => toScreenRect(node.id, node, cameraRef.current));
  }, [culled.nodes]);

  const finishDrag = useCallback(
    (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || (event.type !== "pointercancel" && event.pointerId !== drag.pointerId)) return;
      dragRef.current = null;
      setDraggingId(null);
      setDropTargetId(null);

      if (!drag.moved) return; // 只是点了一下，选中已经在 pointerdown 做过了

      if (event.type === "pointercancel") {
        // 手势被系统打断：只回位，不落库
        if (drag.element) {
          drag.element.style.transform = `translate3d(${drag.origin.x}px, ${drag.origin.y}px, 0)`;
        }
        return;
      }

      const node = layout.tree.byId.get(drag.id);
      if (!node) return;

      const targetId = drag.targetId;

      if (targetId) {
        const check = canReparent(layout.tree, drag.id, targetId);
        if (check.ok) {
          const target = layout.tree.byId.get(targetId);
          const sortIndex = nextSortIndex(layout.tree, targetId);
          // 目标如果收起了，先展开，否则「挂上去了但看不见」
          if (target?.collapsed) void patchNode(target, { collapsed: false });
          void reparentNode(node, targetId, sortIndex).then(() => {
            toast({
              title: "已挂到新节点下",
              description: target?.text ? `父节点：${target.text}` : undefined,
              tone: "success",
            });
          });
          // 乐观地把节点摆到新布局的位置，避免松手瞬间闪回旧位置
          const optimistic = layoutMindMap(
            nodes.map((item) => {
              if (item.id === drag.id) return { ...item, parentId: targetId, x: 0, y: 0 };
              if (item.id === targetId) return { ...item, collapsed: false };
              return item;
            }),
          );
          const placed = optimistic.byId.get(drag.id);
          if (placed && drag.element) {
            drag.element.style.transform = `translate3d(${placed.x}px, ${placed.y}px, 0)`;
          }
          return;
        }
        if (check.reason !== "same-parent") {
          // 拖进自己的子树 / 自己：不改结构，回到原位
          if (drag.element) {
            drag.element.style.transform = `translate3d(${drag.origin.x}px, ${drag.origin.y}px, 0)`;
          }
          return;
        }
      }

      // 落空 or 拖回原父节点：把落点写进 x/y，变成手动位置
      const point = quantizePosition(drag.current.x, drag.current.y);
      void pinNode(node, point.x, point.y);
      const optimistic = layoutMindMap(
        nodes.map((item) => (item.id === drag.id ? { ...item, x: point.x, y: point.y } : item)),
      );
      const placed = optimistic.byId.get(drag.id);
      if (placed && drag.element) {
        drag.element.style.transform = `translate3d(${placed.x}px, ${placed.y}px, 0)`;
      }
    },
    [layout, nodes, toast],
  );

  const beginNodeDrag = useCallback(
    (layoutNode: LayoutNode, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 && event.pointerType === "mouse") return;
      event.stopPropagation();
      setSelectedId(layoutNode.id);

      // 空格按住时，拖节点也当成平移（与 Figma 的手感一致）
      if (spaceHeld) {
        panRef.current = {
          pointerId: event.pointerId,
          startClient: toLocalPoint(
            containerRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 },
            event.clientX,
            event.clientY,
          ),
          startCamera: cameraRef.current,
        };
        pinchRef.current = null;
        return;
      }
      if (editingId === layoutNode.id) return;

      const element = cardRefs.current.get(layoutNode.id) ?? null;
      const drag: DragSession = {
        id: layoutNode.id,
        pointerId: event.pointerId,
        startClient: { x: event.clientX, y: event.clientY },
        origin: { x: layoutNode.x, y: layoutNode.y },
        current: { x: layoutNode.x, y: layoutNode.y },
        moved: false,
        targetId: null,
        element,
        exclude: new Set(subtreeIds(layout.tree, layoutNode.id)),
      };
      dragRef.current = drag;

      const onMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== drag.pointerId) return;
        const dx = moveEvent.clientX - drag.startClient.x;
        const dy = moveEvent.clientY - drag.startClient.y;
        if (!drag.moved) {
          if (!movedBeyondThreshold(drag.startClient, { x: moveEvent.clientX, y: moveEvent.clientY })) return;
          drag.moved = true;
          setDraggingId(drag.id);
        }
        const delta = worldDelta(dx, dy, cameraRef.current);
        const x = drag.origin.x + delta.x;
        const y = drag.origin.y + delta.y;
        drag.current = { x, y };
        // 关键：直接改 style，不进 state
        if (drag.element) drag.element.style.transform = `translate3d(${x}px, ${y}px, 0)`;

        const container = containerRef.current;
        if (!container) return;
        const local = toLocalPoint(container.getBoundingClientRect(), moveEvent.clientX, moveEvent.clientY);
        const target = findNodeAt(screenRects(), local, drag.exclude);
        if (target !== drag.targetId) {
          drag.targetId = target;
          setDropTargetId(target);
        }
      };
      const onEnd = (endEvent: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        window.removeEventListener("pointercancel", onEnd);
        finishDrag(endEvent);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
    },
    [editingId, finishDrag, layout.tree, screenRects, spaceHeld],
  );

  /* ------------------------------------------------------------------ */
  /*                           画布指针（平移/双指）                       */
  /* ------------------------------------------------------------------ */

  const handleContainerPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // 只有点在空白处才走这里（节点卡片与浮层都会 stopPropagation）
      if (event.target !== event.currentTarget) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const container = containerRef.current;
      if (!container) return;
      const local = toLocalPoint(container.getBoundingClientRect(), event.clientX, event.clientY);

      setSelectedId(null);
      pointersRef.current.set(event.pointerId, local);

      if (pointersRef.current.size >= 2) {
        // 双指：取消单指平移，进入缩放
        panRef.current = null;
        const points = [...pointersRef.current.values()];
        const first = points[0]!;
        const second = points[1]!;
        pinchRef.current = {
          camera: cameraRef.current,
          mid: midpoint(first, second),
          distance: distanceBetween(first, second),
          pointers: new Map(pointersRef.current),
        };
        return;
      }

      panRef.current = {
        pointerId: event.pointerId,
        startClient: local,
        startCamera: cameraRef.current,
      };
    },
    [],
  );

  const handleContainerPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container) return;
      const local = toLocalPoint(container.getBoundingClientRect(), event.clientX, event.clientY);
      if (pointersRef.current.has(event.pointerId)) pointersRef.current.set(event.pointerId, local);

      const pinch = pinchRef.current;
      if (pinch && pointersRef.current.size >= 2) {
        const points = [...pointersRef.current.values()];
        const first = points[0]!;
        const second = points[1]!;
        const result = pinchCamera(pinch, midpoint(first, second), distanceBetween(first, second));
        cameraRef.current = result.camera;
        setCamera(result.camera);
        return;
      }

      const pan = panRef.current;
      if (pan && pan.pointerId === event.pointerId) {
        const next = panBy(pan.startCamera, local.x - pan.startClient.x, local.y - pan.startClient.y);
        cameraRef.current = next;
        setCamera(next);
      }
    },
    [],
  );

  const handleContainerPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      pointersRef.current.delete(event.pointerId);
      if (pointersRef.current.size < 2) pinchRef.current = null;
      if (panRef.current?.pointerId === event.pointerId) panRef.current = null;
      // 平移/缩放结束后统一落库一次（拖动过程中不写）
      if (!dragRef.current) saveViewportNow(cameraRef.current);
    },
    [saveViewportNow],
  );

  const handleContainerPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      pointersRef.current.delete(event.pointerId);
      pinchRef.current = null;
      if (panRef.current?.pointerId === event.pointerId) panRef.current = null;
    },
    [],
  );

  /* ------------------------------------------------------------------ */
  /*                              节点动作                                */
  /* ------------------------------------------------------------------ */

  const startEditing = useCallback((layoutNode: LayoutNode) => {
    if (dragRef.current) return;
    setSelectedId(layoutNode.id);
    setEditingId(layoutNode.id);
  }, []);

  const handleEditEnd = useCallback(
    (layoutNode: LayoutNode, text: string | null, intent: EditIntent) => {
      setEditingId(null);
      if (intent === "cancel") return;
      if (text !== null && text !== layoutNode.node.text) {
        void renameNode(layoutNode.node, text);
      }
      if (intent === "child") {
        const parent = layoutNode.node;
        const sortIndex = nextSortIndex(layout.tree, parent.id);
        if (parent.collapsed) void patchNode(parent, { collapsed: false });
        void createNode({
          mapId: mapRef.current.id,
          parentId: parent.id,
          text: NEW_NODE_TEXT,
          sortIndex,
        }).then((node) => {
          setSelectedId(node.id);
          setEditingId(node.id);
        });
      }
    },
    [layout.tree],
  );

  const createChildOf = useCallback(
    (parentId: string) => {
      const parent = layout.tree.byId.get(parentId);
      if (!parent) return;
      if (parent.collapsed) void patchNode(parent, { collapsed: false });
      const sortIndex = nextSortIndex(layout.tree, parentId);
      void createNode({
        mapId: mapRef.current.id,
        parentId,
        text: NEW_NODE_TEXT,
        sortIndex,
      }).then((node) => {
        setSelectedId(node.id);
        setEditingId(node.id);
      });
    },
    [layout.tree],
  );

  /** 极端情况：节点被删光后重新起一棵树 */
  const createRootNode = useCallback(() => {
    void createNode({
      mapId: mapRef.current.id,
      parentId: null,
      text: DEFAULT_ROOT_TEXT,
      sortIndex: 0,
    }).then((node) => {
      setSelectedId(node.id);
      setEditingId(node.id);
    });
  }, []);

  const createSiblingOf = useCallback(
    (layoutNode: LayoutNode) => {
      const parentId = layoutNode.parentId;
      // 根节点没有兄弟：Enter 在根上等于「加一个子节点」
      if (!parentId) {
        createChildOf(layoutNode.id);
        return;
      }
      if (layoutNode.node.collapsed) void patchNode(layoutNode.node, { collapsed: false });
      // 插在选中的那个后面：用 0.5 的步长，避免为了插入而重写整排兄弟
      const sortIndex = layoutNode.node.sortIndex + 0.5;
      void createNode({
        mapId: mapRef.current.id,
        parentId,
        text: NEW_NODE_TEXT,
        sortIndex,
      }).then((node) => {
        setSelectedId(node.id);
        setEditingId(node.id);
      });
    },
    [createChildOf],
  );

  const removeNode = useCallback(
    (layoutNode: LayoutNode) => {
      const affected = subtreeIds(layout.tree, layoutNode.id);
      void deleteSubtree(layout.tree, layoutNode.id).then((snapshots) => {
        if (snapshots.length === 0) return;
        setSelectedId((current) => (current && affected.includes(current) ? null : current));
        setEditingId(null);
        setUndo({
          snapshots,
          text:
            snapshots.length > 1
              ? `已删除 ${snapshots.length} 个节点`
              : `已删除「${layoutNode.node.text || "未命名"}」`,
        });
        if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
        undoTimerRef.current = setTimeout(() => setUndo(null), 6000);
      });
    },
    [layout.tree],
  );

  const undoDelete = useCallback(() => {
    if (!undo) return;
    const snapshots = undo.snapshots;
    setUndo(null);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    void restoreNodes(snapshots).then(() => {
      const restored = snapshots.find((node) => node.parentId === null) ?? snapshots[0];
      if (restored) setSelectedId(restored.id);
      toast({ title: "已撤销删除", tone: "neutral" });
    });
  }, [toast, undo]);

  const toggleCollapse = useCallback((layoutNode: LayoutNode) => {
    void setNodeCollapsed(layoutNode.node, !layoutNode.node.collapsed);
  }, []);

  const linkedGoalIdOf = useCallback(
    (layoutNode: LayoutNode): string | null => {
      if (layoutNode.node.kind === "goal" && layoutNode.node.refId) return layoutNode.node.refId;
      const mapGoal = mapRef.current.goalId;
      if (mapGoal) return mapGoal;
      return resolveGoalId(layout.tree, layoutNode.id);
    },
    [layout.tree],
  );

  const convertToTask = useCallback(
    (layoutNode: LayoutNode) => {
      if (converting) return;
      setConverting(true);
      const goalId = linkedGoalIdOf(layoutNode);
      void convertNodeToTask(layoutNode.node, goalId)
        .then(() => {
          toast({
            title: "已转成任务",
            description: goalId ? "已放进 Q2，并关联到当前目标" : "已放进 Q2（重要不紧急）",
            tone: "success",
          });
        })
        .finally(() => setConverting(false));
    },
    [converting, linkedGoalIdOf, toast],
  );

  const toggleLinkedTask = useCallback(
    (layoutNode: LayoutNode) => {
      const taskId = layoutNode.node.refId;
      if (!taskId) return;
      const task = taskById.get(taskId);
      const done = task?.status === "done";
      void setLinkedTaskDone(taskId, !done).then((next) => {
        if (!next) {
          toast({ title: "关联的任务已经不在了", tone: "danger" });
          return;
        }
        toast({ title: next.status === "done" ? "任务已完成" : "已恢复为待办", tone: "neutral" });
      });
    },
    [taskById, toast],
  );

  /* ------------------------------------------------------------------ */
  /*                                 键盘                                 */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (typeof document !== "undefined" && document.querySelector('[role="dialog"]')) return;
      if (event.key === " " && !isInteractiveTarget(event.target)) {
        event.preventDefault();
        setSpaceHeld(true);
        return;
      }
      if (isInteractiveTarget(event.target)) return;

      const selected = selectedId ? layout.byId.get(selectedId) : null;

      if (event.key === "Escape") {
        setSelectedId(null);
        return;
      }
      if (!selected) return;

      if (event.key === "Tab") {
        event.preventDefault();
        createChildOf(selected.id);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        createSiblingOf(selected);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeNode(selected);
        return;
      }
      if (event.key === "F2") {
        event.preventDefault();
        setEditingId(selected.id);
        return;
      }

      const siblingIds = layout.tree.childrenOf.get(selected.parentId) ?? [];
      const siblingIndex = siblingIds.indexOf(selected.id);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (siblingIds.length < 2) return;
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex = (siblingIndex + delta + siblingIds.length) % siblingIds.length;
        setSelectedId(siblingIds[nextIndex]!);
      } else if (event.key === "ArrowRight" && selected.childIds.length > 0) {
        event.preventDefault();
        setSelectedId(selected.childIds[0]!);
      } else if (event.key === "ArrowLeft" && selected.parentId) {
        event.preventDefault();
        setSelectedId(selected.parentId);
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === " ") setSpaceHeld(false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [createChildOf, createSiblingOf, layout, removeNode, selectedId]);

  /* ------------------------------------------------------------------ */
  /*                                 渲染                                 */
  /* ------------------------------------------------------------------ */

  const grid = viewport.width > 0 ? gridStep(camera.zoom) : 24;
  const position = `${camera.x}px ${camera.y}px`;

  const toolbar = useMemo(() => {
    if (!selectedNode || editingId || draggingId || viewport.width === 0) return null;
    const screen = worldToScreen(camera, selectedNode.x + selectedNode.width / 2, selectedNode.y);
    const inside =
      screen.x + selectedNode.width * camera.zoom > 0 &&
      screen.x - selectedNode.width * camera.zoom < viewport.width &&
      screen.y + 40 > 0 &&
      screen.y < viewport.height;
    if (!inside) return null;
    return {
      left: Math.min(
        viewport.width - TOOLBAR_WIDTH / 2 - 8,
        Math.max(TOOLBAR_WIDTH / 2 + 8, screen.x),
      ),
      top: Math.max(4, screen.y - TOOLBAR_HEIGHT - 10),
    };
  }, [camera, draggingId, editingId, selectedNode, viewport]);

  return (
    <div
      ref={containerRef}
      data-testid="mindmap-canvas"
      className={cn(
        "relative min-h-0 flex-1 touch-none overflow-hidden rounded-xl border border-border bg-surface-sunken select-none",
        spaceHeld ? "cursor-grab" : "cursor-default",
        className,
      )}
      style={{
        backgroundImage: "radial-gradient(circle, var(--border-strong) 1px, transparent 1px)",
        backgroundSize: `${grid}px ${grid}px`,
        backgroundPosition: position,
        overscrollBehavior: "contain",
        touchAction: "none",
      }}
      onPointerDown={handleContainerPointerDown}
      onPointerMove={handleContainerPointerMove}
      onPointerUp={handleContainerPointerUp}
      onPointerCancel={handleContainerPointerCancel}
      onDoubleClick={(event) => event.preventDefault()}
    >
      <div
        ref={worldRef}
        role="tree"
        aria-label="导图节点"
        className="pointer-events-none absolute top-0 left-0 h-0 w-0 origin-top-left"
        style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}
      >
        <MindEdges edges={edges} selectedId={selectedId} />
        {culled.nodes.map((node) => {
          const linkedTask = node.node.kind === "task" && node.node.refId ? taskById.get(node.node.refId) : undefined;
          const linkedGoal = node.node.kind === "goal" && node.node.refId ? goalById.get(node.node.refId) : undefined;
          return (
            <MindNodeCard
              key={node.id}
              layoutNode={node}
              selected={selectedId === node.id}
              editing={editingId === node.id}
              dropTarget={dropTargetId === node.id}
              dragging={draggingId === node.id}
              taskDone={linkedTask ? linkedTask.status === "done" : null}
              refTitle={linkedTask?.title ?? linkedGoal?.title ?? null}
              refLabel={linkedTask ? "任务" : linkedGoal ? "目标" : null}
              onPointerDown={beginNodeDrag}
              onDoubleClick={startEditing}
              onToggleCollapse={toggleCollapse}
              onToggleTask={toggleLinkedTask}
              onOpenRef={() => navigate("/")}
              onEditEnd={handleEditEnd}
              registerRef={registerCard}
            />
          );
        })}
      </div>

      {toolbar && selectedNode && (
        <NodeToolbar
          node={selectedNode}
          left={toolbar.left}
          top={toolbar.top}
          goals={goals}
          linkedGoalId={
            selectedNode.node.kind === "goal" ? selectedNode.node.refId : mapRef.current.goalId
          }
          isTask={selectedNode.node.kind === "task" && Boolean(selectedNode.node.refId)}
          onEdit={() => setEditingId(selectedNode.id)}
          onAddChild={() => createChildOf(selectedNode.id)}
          onToggleCollapse={() => toggleCollapse(selectedNode)}
          onConvertToTask={() => convertToTask(selectedNode)}
          onLinkGoal={(goalId) => {
            void patchNode(selectedNode.node, {
              kind: goalId ? "goal" : "idea",
              refId: goalId || null,
            });
          }}
          onColor={(color) => {
            void setNodeColor(selectedNode.node, color);
          }}
          onDelete={() => removeNode(selectedNode)}
        />
      )}

      <CanvasControls zoom={camera.zoom} onZoomIn={zoomIn} onZoomOut={zoomOut} onFit={fitToCanvas} />

      {layout.nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="pointer-events-auto flex flex-col items-center gap-2">
            <p className="text-caption text-ink-500">这张导图还没有节点</p>
            <button
              type="button"
              onClick={createRootNode}
              className="rounded-md border border-border-strong bg-surface-solid px-3 py-1.5 text-caption text-ink-900 shadow-1 hover:bg-surface-sunken"
            >
              新建根节点
            </button>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-3 left-3 hidden max-w-[60%] items-center gap-2 text-micro text-ink-300 md:flex">
        <MousePointerClick className="size-3" aria-hidden="true" />
        <span>双击编辑 · Tab 子节点 · Enter 兄弟节点 · Delete 删除 · 空格拖拽平移 · 滚轮缩放</span>
      </div>

      {undo && (
        <div
          role="status"
          onPointerDown={(event) => event.stopPropagation()}
          className="absolute bottom-16 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-border bg-surface-solid px-3 py-2 shadow-3"
        >
          <span className="text-caption text-ink-700">{undo.text}</span>
          <button
            type="button"
            onClick={undoDelete}
            className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-caption text-accent hover:bg-accent-soft"
          >
            <Undo2 className="size-3.5" aria-hidden="true" />
            撤销
          </button>
          <button
            type="button"
            aria-label="关闭撤销提示"
            onClick={() => setUndo(null)}
            className="inline-flex size-5 items-center justify-center rounded-sm text-ink-300 hover:bg-surface-sunken hover:text-ink-700"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {draggingId && (
        <div className="pointer-events-none absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-surface-solid/95 px-3 py-1 text-micro text-ink-500 shadow-1">
          <CornerDownRight className="size-3" aria-hidden="true" />
          松手放到节点上可改父级
        </div>
      )}

      {spaceHeld && (
        <div className="pointer-events-none absolute top-3 right-3 flex items-center gap-1 rounded-full border border-border bg-surface-solid/95 px-2 py-1 text-micro text-ink-500">
          <ChevronLeft className="size-3" aria-hidden="true" />
          拖动平移
        </div>
      )}
    </div>
  );
}

export default MindMapStage;
