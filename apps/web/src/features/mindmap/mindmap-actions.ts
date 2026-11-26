import { uuidv7 } from "@detter/shared";
import type { Goal, MindMap, MindMapInput, MindNode, MindNodeInput, MindNodeKind, Task } from "@detter/shared";
import { db } from "@/db";
import { deleteEntity, getEntity, saveEntity } from "@/db/repo";
import { subtreeIds, type MindTree } from "./tree";

/**
 * 导图的写操作。
 *
 * 与其它 feature 一样，全部走 `@/db/repo`：它会补齐 schema 默认值、维护
 * updatedAt/rev/deviceId，并在同一个事务里写 outbox。组件里不允许出现 db.mindNodes.put。
 *
 * 一个刻意的设计：`x == 0 && y == 0` 表示「没手动拖过」，所以
 * - 自动布局不往库里写坐标（避免每加一个节点就写 N 条）；
 * - 拖拽落点写坐标 = 固定（pinned）；
 * - 改变父级时把坐标清零，让节点重新回到自动布局里。
 */

function toRow(value: object): Record<string, unknown> {
  return { ...value } as unknown as Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/*                                  思维导图                                    */
/* -------------------------------------------------------------------------- */

export interface CreateMapOptions {
  title: string;
  goalId?: string | null;
}

export function buildMapInput(options: CreateMapOptions, now: number = Date.now()): MindMapInput {
  return {
    id: uuidv7(now),
    title: options.title.trim().slice(0, 200) || "未命名导图",
    goalId: options.goalId ?? null,
    viewportX: 0,
    viewportY: 0,
    viewportZoom: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export async function createMindMap(options: CreateMapOptions): Promise<MindMap> {
  const row = await saveEntity("mindMap", toRow(buildMapInput(options)));
  return row as unknown as MindMap;
}

export async function patchMindMap(map: MindMap, patch: Partial<MindMap>): Promise<MindMap> {
  const row = await saveEntity("mindMap", toRow({ ...map, ...patch }));
  return row as unknown as MindMap;
}

/**
 * 保存画布状态。
 *
 * viewportX / viewportY 存的是**视口中心的世界坐标**（不是像素偏移）：
 * 像素偏移只在保存时的窗口尺寸下成立，换设备打开就会整块偏出画布；
 * 存世界中心 + 缩放，任何尺寸下都能回到同一处。
 *
 * 调用方负责防抖（平移/缩放停下来 600ms 再落库），否则一次拖拽能写几十条 outbox。
 */
export function saveViewport(
  map: MindMap,
  viewport: { x: number; y: number; zoom: number },
): Promise<MindMap> {
  return patchMindMap(map, {
    viewportX: viewport.x,
    viewportY: viewport.y,
    viewportZoom: viewport.zoom,
  });
}

/** 删导图 = 先删节点再删自己，全部软删除，撤销在本 feature 之外不做（走同步也能恢复）。 */
export async function removeMindMap(map: MindMap): Promise<number> {
  const rows = await dbMindNodes(map.id);
  for (const node of rows) {
    await deleteEntity("mindNode", node.id);
  }
  await deleteEntity("mindMap", map.id);
  return rows.length;
}

/** 直接查表：删除整张图时用，读一次就够，不值得为它加 hook。 */
async function dbMindNodes(mapId: string): Promise<MindNode[]> {
  const rows = await db.mindNodes.where("mapId").equals(mapId).toArray();
  return rows.filter((row) => !row.deletedAt);
}

/* -------------------------------------------------------------------------- */
/*                                    节点                                      */
/* -------------------------------------------------------------------------- */

export interface CreateNodeOptions {
  mapId: string;
  parentId: string | null;
  text?: string;
  sortIndex?: number;
  kind?: MindNodeKind;
  refId?: string | null;
  color?: string | null;
}

export const NEW_NODE_TEXT = "新节点";
export const DEFAULT_ROOT_TEXT = "新的目标";

export function buildNodeInput(options: CreateNodeOptions, now: number = Date.now()): MindNodeInput {
  return {
    id: uuidv7(now),
    mapId: options.mapId,
    parentId: options.parentId,
    text: options.text?.slice(0, 500) ?? NEW_NODE_TEXT,
    // 0/0 = 交给自动布局
    x: 0,
    y: 0,
    kind: options.kind ?? "idea",
    refId: options.refId ?? null,
    color: options.color ?? null,
    collapsed: false,
    sortIndex: options.sortIndex ?? 0,
    createdAt: now,
    updatedAt: now,
  };
}

export async function createNode(options: CreateNodeOptions): Promise<MindNode> {
  const row = await saveEntity("mindNode", toRow(buildNodeInput(options)));
  return row as unknown as MindNode;
}

export async function patchNode(node: MindNode, patch: Partial<MindNode>): Promise<MindNode> {
  const row = await saveEntity("mindNode", toRow({ ...node, ...patch }));
  return row as unknown as MindNode;
}

export function renameNode(node: MindNode, text: string): Promise<MindNode> {
  const next = text.trim().slice(0, 500);
  return patchNode(node, { text: next.length > 0 ? next : NEW_NODE_TEXT });
}

export function setNodeCollapsed(node: MindNode, collapsed: boolean): Promise<MindNode> {
  return patchNode(node, { collapsed });
}

export function setNodeColor(node: MindNode, color: string | null): Promise<MindNode> {
  return patchNode(node, { color });
}

/** 拖到空白处：落点写进 x/y，节点从此脱离自动布局。 */
export function pinNode(node: MindNode, x: number, y: number): Promise<MindNode> {
  return patchNode(node, { x: Math.round(x), y: Math.round(y) });
}

/**
 * 拖到另一个节点上：改父级并清空坐标。
 *
 * 清空坐标是有意的：用户表达的是「这个节点该挂在这里」，而不是「把它摆在这儿」。
 * 若保留拖拽落点，节点会变成 pinned，之后新增兄弟节点时它不会跟着重排。
 */
export function reparentNode(node: MindNode, parentId: string, sortIndex: number): Promise<MindNode> {
  return patchNode(node, { parentId, sortIndex, x: 0, y: 0 });
}

/** 删除节点及其整棵子树，返回被删掉的快照（用于撤销）。 */
export async function deleteSubtree(tree: MindTree, nodeId: string): Promise<MindNode[]> {
  const ids = subtreeIds(tree, nodeId);
  const snapshots: MindNode[] = [];
  for (const id of ids) {
    const node = tree.byId.get(id);
    if (!node) continue;
    const removed = await deleteEntity("mindNode", id);
    if (removed) snapshots.push(node);
  }
  return snapshots;
}

/** 撤销删除：按原 id 写回，createdAt 由仓储沿用墓碑上的值，父子关系原样恢复。 */
export async function restoreNodes(snapshots: readonly MindNode[]): Promise<void> {
  for (const node of snapshots) {
    await saveEntity("mindNode", toRow({ ...node, deletedAt: null }));
  }
}

/* -------------------------------------------------------------------------- */
/*                              与任务 / 目标的联动                              */
/* -------------------------------------------------------------------------- */

export interface ConvertResult {
  task: Task;
  node: MindNode;
}

/**
 * 节点 → 任务。
 *
 * 任务进 Q2（重要不紧急）是产品取向：从目标拆出来的事默认是「该安排时间」的，
 * 而不是「马上做」。goalId 沿用导图的目标，这样四象限里它能挂回同一条目标线。
 */
export async function convertNodeToTask(node: MindNode, goalId: string | null): Promise<ConvertResult> {
  const now = Date.now();
  const taskRow = await saveEntity(
    "task",
    toRow({
      id: uuidv7(now),
      title: (node.text || "未命名任务").slice(0, 500),
      notes: "",
      status: "todo",
      quadrant: 2,
      manualQuadrant: true,
      goalId,
      source: "goal",
      createdAt: now,
      updatedAt: now,
    }),
  );
  const task = taskRow as unknown as Task;
  const updated = await patchNode(node, { kind: "task", refId: task.id });
  return { task, node: updated };
}

/** 节点上的勾选框：直接改任务完成态，节点通过 liveQuery 立刻变灰。 */
export async function setLinkedTaskDone(taskId: string, done: boolean): Promise<Task | null> {
  const row = await getEntity("task", taskId);
  if (!row) return null;
  const task = row as unknown as Task;
  const next = await saveEntity(
    "task",
    toRow({
      ...task,
      status: done ? "done" : "todo",
      completedAt: done ? Date.now() : null,
    }),
  );
  return next as unknown as Task;
}

/** 沿着祖先链找第一个「目标节点」的 refId：转任务时用它补 goalId。 */
export function resolveGoalId(tree: MindTree, nodeId: string): string | null {
  let cursor: string | null = nodeId;
  let guard = 0;
  while (cursor && guard < 10_000) {
    const node = tree.byId.get(cursor);
    if (!node) return null;
    if (node.kind === "goal" && node.refId) return node.refId;
    cursor = tree.parentOf.get(cursor) ?? null;
    guard += 1;
  }
  return null;
}

export interface GenerateFromGoalResult {
  map: MindMap;
  root: MindNode;
  children: MindNode[];
}

/**
 * 「从目标生成」：根 = 目标，第一层 = 该目标下的任务（最多 12 个）。
 *
 * 上限 12 不是随便定的：目标下挂几十个任务时，全铺开只会得到一张读不出结构的图；
 * 12 个大致对应「一眼能扫完」的屏幕高度。
 */
export async function generateFromGoal(goal: Goal, tasks: readonly Task[]): Promise<GenerateFromGoalResult> {
  const map = await createMindMap({ title: goal.title, goalId: goal.id });
  const root = await createNode({
    mapId: map.id,
    parentId: null,
    text: goal.title,
    kind: "goal",
    refId: goal.id,
    sortIndex: 0,
  });

  const picked = [...tasks]
    .filter((task) => task.goalId === goal.id && !task.deletedAt && task.status !== "dropped")
    .sort((a, b) => a.sortIndex - b.sortIndex || a.createdAt - b.createdAt)
    .slice(0, 12);

  const children: MindNode[] = [];
  for (let index = 0; index < picked.length; index += 1) {
    const task = picked[index]!;
    const child = await createNode({
      mapId: map.id,
      parentId: root.id,
      text: task.title,
      kind: "task",
      refId: task.id,
      sortIndex: index,
    });
    children.push(child);
  }

  return { map, root, children };
}

/** 新建空导图：一张图 + 一个根节点（根节点直接进入编辑态）。 */
export async function createEmptyMindMap(title: string): Promise<{ map: MindMap; root: MindNode }> {
  const map = await createMindMap({ title });
  const root = await createNode({
    mapId: map.id,
    parentId: null,
    text: title.trim() || DEFAULT_ROOT_TEXT,
    sortIndex: 0,
  });
  return { map, root };
}
