import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, Plus, Target } from "lucide-react";
import type { KeyResult, Okr, OkrPeriod } from "@detter/shared";
import { Button, Tabs, useToast } from "@detter/ui";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingState } from "@/components/common/LoadingState";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import {
  applyAutoAdvance,
  saveAutoAdvanceEntry,
  shouldAutoAdvance,
  useAutoAdvanceMap,
} from "./auto-advance";
import { KrDialog } from "./KrDialog";
import { LinkDialog } from "./LinkDialog";
import { OkrCard } from "./OkrCard";
import { OkrDialog } from "./OkrDialog";
import {
  copyOkrsToRange,
  deleteKeyResult,
  deleteOkr,
  updateKeyResultValue,
} from "./okr-actions";
import {
  OKR_PERIOD_TABS,
  findPreviousRangeWithOkrs,
  okrRange,
  pickOkrsOfRange,
  shiftAnchor,
} from "./periods";
import { groupKrsByOkr, useOkrData } from "./queries";

/**
 * OKR 看板。
 *
 * 周期导航与复盘共用 `periodRange`：周一开始、自然月/季/年，
 * 所以「复盘里选的这一周」和「OKR 页这一周」永远是同一段日期。
 *
 * 空态给两条路：新建，或从最近一个有 Objective 的同类周期复制结构。
 */
const EMPTY_TITLE: Record<OkrPeriod, string> = {
  week: "这周还没有目标",
  month: "这个月还没有目标",
  quarter: "这个季度还没有目标",
  year: "这一年还没有目标",
};

interface KrDialogTarget {
  okr: Okr;
  kr: KeyResult | null;
  sortIndex: number;
}

interface LinkTarget {
  okr: Okr;
  kr: KeyResult | null;
}

export function OkrBoard() {
  const { toast } = useToast();
  const data = useOkrData();
  const auto = useAutoAdvanceMap();
  const [periodType, setPeriodType] = useState<OkrPeriod>("month");
  const [anchor, setAnchor] = useState(() => Date.now());
  const [now] = useState(() => Date.now());

  const [createOpen, setCreateOpen] = useState(false);
  const [editOkr, setEditOkr] = useState<Okr | null>(null);
  const [krDialog, setKrDialog] = useState<KrDialogTarget | null>(null);
  const [linkTarget, setLinkTarget] = useState<LinkTarget | null>(null);
  const [deleteOkrTarget, setDeleteOkrTarget] = useState<Okr | null>(null);
  const [deleteKrTarget, setDeleteKrTarget] = useState<{ okr: Okr; kr: KeyResult } | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const autoInFlight = useRef<Set<string>>(new Set());

  const range = useMemo(() => okrRange(periodType, anchor, now), [periodType, anchor, now]);
  const objectives = useMemo(() => pickOkrsOfRange(data.okrs, range), [data.okrs, range]);
  const krsByOkr = useMemo(() => groupKrsByOkr(data.krs), [data.krs]);
  const previousRange = useMemo(
    () => findPreviousRangeWithOkrs(data.okrs, periodType, range, now),
    [data.okrs, periodType, range, now],
  );
  const previousObjectives = useMemo(
    () => (previousRange ? pickOkrsOfRange(data.okrs, previousRange) : []),
    [data.okrs, previousRange],
  );
  const nextSortIndex = useMemo(
    () => objectives.reduce((max, okr) => Math.max(max, okr.sortIndex), -1) + 1,
    [objectives],
  );

  /* 自动推进：只在开关开启、全部关联任务完成、且任务状态签名变化时 +1。 */
  useEffect(() => {
    if (auto.loading) return;
    for (const kr of data.krs) {
      const config = auto.map[kr.id];
      if (!config?.enabled) continue;
      if (autoInFlight.current.has(kr.id)) continue;
      if (!shouldAutoAdvance(kr, data.tasks, config)) continue;
      autoInFlight.current.add(kr.id);
      void applyAutoAdvance(kr, data.tasks, config)
        .then((applied) => {
          if (applied) {
            toast({
              title: "KR 自动推进 +" + (config.step > 0 ? config.step : 1),
              description: kr.title,
              tone: "success",
            });
          }
        })
        .catch(() => {
          // 自动推进失败不打扰用户：下次打开页面会再试
        })
        .finally(() => autoInFlight.current.delete(kr.id));
    }
  }, [auto.loading, auto.map, data.krs, data.tasks, toast]);

  const handleToggleAuto = useCallback(
    (kr: KeyResult) => {
      const current = auto.map[kr.id];
      const enabled = current?.enabled !== true;
      void saveAutoAdvanceEntry(kr.id, { enabled, step: current?.step ?? 1 })
        .then(() =>
          toast({
            title: enabled ? "已开启自动推进" : "已关闭自动推进",
            description: enabled ? "关联任务全部完成时 +1，只触发一次" : kr.title,
            tone: "success",
          }),
        )
        .catch(() => toast({ title: "设置失败，稍后再试", tone: "danger" }));
    },
    [auto.map, toast],
  );

  const handleCommitKrValue = useCallback(
    (kr: KeyResult, value: number) => {
      void updateKeyResultValue(kr, value).catch(() =>
        toast({ title: "没能保存进度", description: "这次拖动没有写进本地库", tone: "danger" }),
      );
    },
    [toast],
  );

  const handleDeleteOkr = useCallback(async () => {
    if (!deleteOkrTarget) return;
    try {
      await deleteOkr(deleteOkrTarget, data.krs, data.tasks, data.goals);
      toast({ title: "Objective 已删除", description: deleteOkrTarget.title, tone: "success" });
    } catch {
      toast({ title: "删除失败，稍后再试", tone: "danger" });
    }
  }, [deleteOkrTarget, data.krs, data.tasks, data.goals, toast]);

  const handleDeleteKr = useCallback(async () => {
    if (!deleteKrTarget) return;
    try {
      await deleteKeyResult(deleteKrTarget.kr, data.tasks, data.goals);
      toast({ title: "KR 已删除", tone: "success" });
    } catch {
      toast({ title: "删除失败，稍后再试", tone: "danger" });
    }
  }, [deleteKrTarget, data.tasks, data.goals, toast]);

  const handleCopyPrevious = useCallback(async () => {
    if (!previousRange) return;
    try {
      const sourceOkrs = pickOkrsOfRange(data.okrs, previousRange);
      const result = await copyOkrsToRange(sourceOkrs, data.krs, range);
      toast({
        title: `已复制 ${result.okrs.length} 个 Objective`,
        description: `${previousRange.label} → ${range.label} · 含 ${result.krs.length} 个 KR`,
        tone: "success",
      });
      setCopyOpen(false);
    } catch (error) {
      toast({
        title: "复制失败",
        description: error instanceof Error ? error.message : "稍后再试",
        tone: "danger",
      });
    }
  }, [previousRange, data.okrs, data.krs, range, toast]);

  if (data.loading) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <LoadingState rows={3} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-caption text-ink-500">OKR · 方向落到可量化的关键结果</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                aria-label="上一周期"
                onClick={() => setAnchor(shiftAnchor(periodType, range.start, -1))}
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={range.isCurrent}
                onClick={() => setAnchor(now)}
              >
                本期
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label="下一周期"
                onClick={() => setAnchor(shiftAnchor(periodType, range.start, 1))}
              >
                <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
            </div>
            <h1 className="tabular text-h1 text-ink-900">{range.label}</h1>
            <p className="tabular text-micro text-ink-500">{range.caption}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Tabs
            items={OKR_PERIOD_TABS.map((item) => ({ value: item.value, label: item.label }))}
            value={periodType}
            onValueChange={(value) => setPeriodType(value as OkrPeriod)}
            variant="pill"
            ariaLabel="OKR 周期类型"
          />
          <Button
            variant="primary"
            size="md"
            leftIcon={<Plus className="size-4" aria-hidden="true" />}
            onClick={() => setCreateOpen(true)}
          >
            <span className="hidden sm:inline">新建 Objective</span>
            <span className="sm:hidden">新建</span>
          </Button>
        </div>
      </div>

      <p className="mt-2 hidden text-micro text-ink-300 lg:block">
        Objective 进度 = 所有 KR 进度的均值 · KR 进度条可拖动（方向键也行）· ← / → 切换周期
      </p>

      {objectives.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-border-strong bg-surface">
          <EmptyState
            icon={<Target className="size-6" aria-hidden="true" />}
            title={EMPTY_TITLE[periodType]}
            description={
              previousRange
                ? `上一期（${previousRange.label}）有 ${previousObjectives.length} 个 Objective，可以复制结构再改目标值。`
                : "先写一个方向，再拆成 2–3 条可量化的关键结果；别一次写六个。"
            }
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                {previousRange && (
                  <Button
                    size="sm"
                    variant="secondary"
                    leftIcon={<Copy className="size-3.5" aria-hidden="true" />}
                    onClick={() => setCopyOpen(true)}
                  >
                    从上一期复制
                  </Button>
                )}
                <Button
                  size="sm"
                  leftIcon={<Plus className="size-3.5" aria-hidden="true" />}
                  onClick={() => setCreateOpen(true)}
                >
                  新建 Objective
                </Button>
              </div>
            }
          />
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {objectives.map((okr) => (
            <li key={okr.id}>
              <OkrCard
                okr={okr}
                krs={krsByOkr.get(okr.id) ?? []}
                goals={data.goals}
                tasks={data.tasks}
                autoMap={auto.map}
                onAddKr={(target) => setKrDialog({ okr: target, kr: null, sortIndex: krsByOkr.get(target.id)?.length ?? 0 })}
                onEditOkr={(target) => setEditOkr(target)}
                onDeleteOkr={(target) => setDeleteOkrTarget(target)}
                onLinkOkr={(target) => setLinkTarget({ okr: target, kr: null })}
                onEditKr={(target, kr) =>
                  setKrDialog({ okr: target, kr, sortIndex: kr.sortIndex })
                }
                onLinkKr={(target, kr) => setLinkTarget({ okr: target, kr })}
                onCommitKrValue={handleCommitKrValue}
                onToggleAuto={handleToggleAuto}
                onDeleteKr={(target, kr) => setDeleteKrTarget({ okr: target, kr })}
              />
            </li>
          ))}
        </ul>
      )}

      {objectives.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-micro text-ink-300">
          <span>
            {objectives.length} 个 Objective ·{" "}
            {objectives.reduce((sum, okr) => sum + (krsByOkr.get(okr.id)?.length ?? 0), 0)} 个 KR
          </span>
          {previousRange && (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              leftIcon={<Copy className="size-3.5" aria-hidden="true" />}
              onClick={() => setCopyOpen(true)}
            >
              从 {previousRange.label} 复制
            </Button>
          )}
        </div>
      )}

      <OkrDialog open={createOpen} onOpenChange={setCreateOpen} range={range} sortIndex={nextSortIndex} />
      <OkrDialog
        open={editOkr !== null}
        onOpenChange={(next) => {
          if (!next) setEditOkr(null);
        }}
        range={range}
        okr={editOkr}
      />
      <KrDialog
        open={krDialog !== null}
        onOpenChange={(next) => {
          if (!next) setKrDialog(null);
        }}
        okr={krDialog?.okr ?? null}
        kr={krDialog?.kr ?? null}
        sortIndex={krDialog?.sortIndex ?? 0}
      />
      <LinkDialog
        open={linkTarget !== null}
        onOpenChange={(next) => {
          if (!next) setLinkTarget(null);
        }}
        okr={linkTarget?.okr ?? null}
        kr={linkTarget?.kr ?? null}
        goals={data.goals}
        tasks={data.tasks}
      />

      <ConfirmDialog
        open={deleteOkrTarget !== null}
        onOpenChange={(next) => {
          if (!next) setDeleteOkrTarget(null);
        }}
        title={`删除「${deleteOkrTarget?.title ?? ""}」？`}
        description="它的 KR 会一起删除，关联的任务与目标会摘掉 OKR 标记；任务本身不受影响。"
        confirmLabel="删除"
        tone="danger"
        onConfirm={() => {
          void handleDeleteOkr();
          setDeleteOkrTarget(null);
        }}
      />
      <ConfirmDialog
        open={deleteKrTarget !== null}
        onOpenChange={(next) => {
          if (!next) setDeleteKrTarget(null);
        }}
        title={`删除 KR「${deleteKrTarget?.kr?.title ?? ""}」？`}
        description="关联的任务与目标会摘掉这一条关联，任务本身不受影响。"
        confirmLabel="删除"
        tone="danger"
        onConfirm={() => {
          void handleDeleteKr();
          setDeleteKrTarget(null);
        }}
      />
      <ConfirmDialog
        open={copyOpen}
        onOpenChange={setCopyOpen}
        title={`从 ${previousRange?.label ?? "上一期"} 复制？`}
        description={`会新建 ${previousObjectives.length} 个 Objective 和它们的 KR；当前值归零（新周期从起点开始），不复制任务与目标关联。`}
        confirmLabel="复制"
        onConfirm={() => void handleCopyPrevious()}
      />
    </div>
  );
}

export default OkrBoard;
