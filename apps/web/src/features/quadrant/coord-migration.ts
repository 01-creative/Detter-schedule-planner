import { useEffect, useState } from "react";
import type { Quadrant, Task } from "@detter/shared";
import { db } from "@/db";
import { saveEntity } from "@/db/repo";
import { useSyncStatus } from "@/sync/useSyncStatus";
import {
  isSamePoint,
  nextFreePlanePosition,
  planeFromLegacy,
  type PlanePoint,
} from "./geometry";

/**
 * 一次性坐标迁移：把「象限 + 格内相对坐标」换成全平面归一化坐标。
 *
 * 标记放在 settings 表（与 useFocusSettings 同一套读写方式）：
 *   key = quadrant.coordVersion, value = "plane-v1"
 *
 * 只跑一次。标记在全部任务写完之后才落库，所以中途失败时下次会重跑；
 * 换算公式本身不是幂等的（重复换算会再缩一半），重跑只对「还没写过的」任务安全，
 * 这一点由单次串行执行 + 标记兜底，不在任务上再加字段。
 */

export const COORD_VERSION_KEY = "quadrant.coordVersion";
export const COORD_VERSION = "plane-v1";

export interface LegacyPlanEntry {
  task: Task;
  x: number;
  y: number;
  quadrant: Quadrant;
}

/**
 * 纯函数：规划旧任务的新坐标，并把换算后重合的点用螺旋避让错开。
 *
 * 旧数据里大量任务都是「格内 (0.5,0.5)」——直接换算会让同象限的任务叠在一个点上，
 * 所以这里按创建时间稳定排序，第二个起换到附近空位。坐标仍在原象限内部。
 */
export function planLegacyMigration(tasks: readonly Task[]): LegacyPlanEntry[] {
  const ordered = [...tasks]
    .filter((task) => !task.deletedAt)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const accepted: PlanePoint[] = [];
  const plan: LegacyPlanEntry[] = [];

  for (const task of ordered) {
    const raw = planeFromLegacy(task.quadrant, task.posX, task.posY);
    const collides = accepted.some((point) => isSamePoint(point, raw, 0.025));
    const point = collides
      ? nextFreePlanePosition(accepted, raw, task.quadrant)
      : raw;
    accepted.push(point);
    plan.push({ task, x: point.x, y: point.y, quadrant: task.quadrant });
  }

  return plan;
}

export interface CoordinateMigrationDeps {
  readVersion: () => Promise<string | null>;
  loadAliveTasks: () => Promise<Task[]>;
  writeTaskPosition: (entry: LegacyPlanEntry) => Promise<void>;
  writeVersion: () => Promise<void>;
}

export interface CoordinateMigrationResult {
  skipped: boolean;
  migrated: number;
}

/** 可注入依赖的迁移执行器：单测用内存实现，生产用 Dexie。 */
export async function runCoordinateMigration(
  deps: CoordinateMigrationDeps,
): Promise<CoordinateMigrationResult> {
  const version = await deps.readVersion();
  if (version === COORD_VERSION) return { skipped: true, migrated: 0 };

  const tasks = await deps.loadAliveTasks();
  const plan = planLegacyMigration(tasks);
  for (const entry of plan) await deps.writeTaskPosition(entry);
  await deps.writeVersion();
  return { skipped: false, migrated: plan.length };
}

/* -------------------------------------------------------------------------- */
/*                               Dexie 接线与 hook                              */
/* -------------------------------------------------------------------------- */

async function readStoredVersion(): Promise<string | null> {
  const rows = await db.settings.where("key").equals(COORD_VERSION_KEY).toArray();
  const alive = rows
    .filter((row) => !row.deletedAt)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const value = alive[0]?.value;
  return typeof value === "string" ? value : null;
}

async function writeStoredVersion(): Promise<void> {
  await saveEntity("setting", {
    id: `setting:${COORD_VERSION_KEY}`,
    key: COORD_VERSION_KEY,
    value: COORD_VERSION,
  });
}

async function migrateCoordinateStore(): Promise<CoordinateMigrationResult> {
  const result = await runCoordinateMigration({
    readVersion: readStoredVersion,
    loadAliveTasks: async () => {
      const rows = await db.tasks.toArray();
      return rows.filter((row) => !row.deletedAt);
    },
    writeTaskPosition: async (entry) => {
      await saveEntity("task", {
        ...entry.task,
        posX: entry.x,
        posY: entry.y,
        quadrant: entry.quadrant,
      });
    },
    writeVersion: writeStoredVersion,
  });
  if (!result.skipped) {
    console.info(`[quadrant] 坐标迁移完成：${result.migrated} 条 → ${COORD_VERSION}`);
  }
  return result;
}

/** React StrictMode 会双调用 effect；模块级 promise 保证同一会话只跑一次。 */
let inFlight: Promise<CoordinateMigrationResult> | null = null;

/**
 * 迁移时机。
 *
 * 有一个容易踩的坑：新设备刚登录时，首页可能比首次同步更早挂载，
 * 同步又是一页一页应用远程变更的。如果看到第一条任务就开跑，
 * 会在剩下 7 条还没落地时写下 `plane-v1` 标记——之后它们永远不会被换算。
 *
 * 因此必须等同步落定（成功 / 离线 / 出错）再跑；离线时状态会很快变成 offline，
 * 不会把本地数据拖在骨架屏里。这个等待只影响首次挂载，标记写完后不再等待。
 */
export function useCoordinateMigration(): { ready: boolean } {
  const sync = useSyncStatus();
  const shouldRun =
    sync.lastSyncAt !== null || sync.state === "offline" || sync.state === "error";
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!shouldRun) return;
    let cancelled = false;
    const run = inFlight ?? (inFlight = migrateCoordinateStore());
    run
      .catch((error) => {
        // 迁移失败不能把首页锁死：先按原坐标渲染，下次进入再重试。
        inFlight = null;
        console.error("[quadrant] 坐标迁移失败", error);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [shouldRun]);

  return { ready };
}
