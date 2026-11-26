import { useCallback, useMemo, useState } from "react";
import { ChartLine, Plus } from "lucide-react";
import type { Kpi, KpiPeriod } from "@detter/shared";
import { Button, Dialog, Tabs, useToast } from "@detter/ui";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingState } from "@/components/common/LoadingState";
import { KpiCard } from "./KpiCard";
import { KpiFormDialog } from "./KpiFormDialog";
import {
  PERIOD_LABEL,
  buildSnapshot,
  formatKpiTarget,
} from "./kpiModel";
import type { KpiSnapshot } from "./kpiModel";
import {
  createKpi,
  deleteEntry,
  deleteKpi,
  draftOf,
  emptyDraft,
  quickAdd,
  setEntryForDate,
  updateKpi,
} from "./kpiActions";
import type { KpiDraft } from "./kpiActions";
import { useKpiData } from "./useKpiData";
import { useNow } from "./useNow";

/**
 * KPI 页主体。
 *
 * 页面只做三件事：取数（useKpiData）、算快照（buildSnapshot，纯函数）、派发写操作。
 * 周期切换是「临时覆盖」：默认跟随每个指标自己的周期，也可以统一按日/周/月看，
 * 用来横向比较「这周到底做得怎么样」。
 */
type ViewPeriod = "auto" | KpiPeriod;

const VIEW_PERIOD_ITEMS = [
  { value: "auto", label: "跟随指标" },
  { value: "day", label: "日" },
  { value: "week", label: "周" },
  { value: "month", label: "月" },
];

const PRESETS: Array<{ key: string; label: string; draft: KpiDraft }> = [
  {
    key: "deep-work",
    label: "深度工作时长（番茄钟自动）",
    draft: {
      name: "深度工作时长",
      unit: "分钟",
      direction: "up",
      targetValue: 900,
      period: "week",
      aggregation: "sum",
      autoSource: "pomodoro_min",
      color: "#6355F6",
    },
  },
  {
    key: "gym",
    label: "健身次数（每周 3 次）",
    draft: {
      name: "健身次数",
      unit: "次",
      direction: "up",
      targetValue: 3,
      period: "week",
      aggregation: "sum",
      autoSource: null,
      color: "#10B981",
    },
  },
  {
    key: "reading",
    label: "读书页数（每周 200 页）",
    draft: {
      name: "读书页数",
      unit: "页",
      direction: "up",
      targetValue: 200,
      period: "week",
      aggregation: "sum",
      autoSource: null,
      color: "#F59E0B",
    },
  },
];

export function KpiView() {
  const { kpis, entries, sessions, tasks, loading } = useKpiData();
  const { toast } = useToast();
  const now = useNow(60_000);

  const [viewPeriod, setViewPeriod] = useState<ViewPeriod>("auto");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Kpi | null>(null);
  const [draft, setDraft] = useState<KpiDraft>(emptyDraft);
  const [deleting, setDeleting] = useState<Kpi | null>(null);

  const override = viewPeriod === "auto" ? undefined : viewPeriod;
  const snapshots = useMemo<KpiSnapshot[]>(
    () =>
      kpis.map((kpi) => buildSnapshot(kpi, { entries, sessions, tasks }, now, override)),
    [kpis, entries, sessions, tasks, now, override],
  );

  const achieved = snapshots.filter((snapshot) => snapshot.progress >= 1).length;

  const openCreate = useCallback(() => {
    setEditing(null);
    setDraft(emptyDraft());
    setFormOpen(true);
  }, []);

  const openEdit = useCallback((kpi: Kpi) => {
    setEditing(kpi);
    setDraft(draftOf(kpi));
    setFormOpen(true);
  }, []);

  const handleSubmit = useCallback(
    async (next: KpiDraft) => {
      try {
        if (editing) {
          await updateKpi(editing, next);
          toast({ title: "指标已更新", tone: "success" });
        } else {
          await createKpi(next, kpis.length);
          toast({ title: "指标已创建", description: "卡片上可以直接打卡", tone: "success" });
        }
        setFormOpen(false);
      } catch {
        toast({ title: "保存失败，稍后再试", tone: "danger" });
      }
    },
    [editing, kpis.length, toast],
  );

  const handleQuickAdd = useCallback(
    async (kpi: Kpi, delta: number) => {
      try {
        await quickAdd(kpi, delta);
      } catch {
        toast({ title: "打卡没写进去", tone: "danger" });
      }
    },
    [toast],
  );

  const handleBackfill = useCallback(
    async (kpi: Kpi, date: string, value: number, note: string) => {
      try {
        await setEntryForDate(kpi, date, value, note);
        toast({ title: `已补录 ${date}`, description: `${value} ${kpi.unit}`, tone: "success" });
      } catch {
        toast({ title: "补录失败，稍后再试", tone: "danger" });
      }
    },
    [toast],
  );

  const handleDeleteEntry = useCallback(
    async (id: string) => {
      try {
        await deleteEntry(id);
        toast({ title: "已删除这条记录", tone: "neutral" });
      } catch {
        toast({ title: "删除失败，稍后再试", tone: "danger" });
      }
    },
    [toast],
  );

  const handleDeleteKpi = useCallback(async () => {
    if (!deleting) return;
    try {
      await deleteKpi(deleting);
      toast({ title: `已删除「${deleting.name}」`, tone: "neutral" });
      setDeleting(null);
    } catch {
      toast({ title: "删除失败，稍后再试", tone: "danger" });
    }
  }, [deleting, toast]);

  const handlePreset = useCallback(
    async (preset: (typeof PRESETS)[number]) => {
      try {
        await createKpi(preset.draft, kpis.length);
        toast({ title: `已创建「${preset.draft.name}」`, tone: "success" });
      } catch {
        toast({ title: "创建失败，稍后再试", tone: "danger" });
      }
    },
    [kpis.length, toast],
  );

  return (
    <div className="mx-auto w-full max-w-6xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-caption text-ink-500">把时间投入变成看得见的变化</p>
          <h1 className="mt-1 text-h1 text-ink-900">KPI</h1>
          <p className="mt-1 max-w-xl text-body text-ink-500">
            手工打卡与自动汇总并存：番茄钟分钟、专注次数、完成任务数都能直接变成指标，不用手填。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs
            variant="pill"
            ariaLabel="查看周期"
            items={VIEW_PERIOD_ITEMS}
            value={viewPeriod}
            onValueChange={(value) => setViewPeriod(value as ViewPeriod)}
          />
          <Button
            size="sm"
            variant="primary"
            onClick={openCreate}
            leftIcon={<Plus className="size-3.5" aria-hidden="true" />}
          >
            新建指标
          </Button>
        </div>
      </header>

      {loading ? (
        <LoadingState rows={3} className="mt-6" />
      ) : kpis.length === 0 ? (
        <EmptyState
          className="mt-10"
          icon={<ChartLine className="size-5" aria-hidden="true" />}
          title="还没有指标，从一个会自动汇总的开始"
          description="深度工作时长直接来自番茄钟：每完成一个 25 分钟番茄，这里就自动 +25。"
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              {PRESETS.map((preset) => (
                <Button
                  key={preset.key}
                  size="sm"
                  variant="secondary"
                  onClick={() => void handlePreset(preset)}
                >
                  {preset.label}
                </Button>
              ))}
              <Button size="sm" variant="ghost" onClick={openCreate}>
                自定义
              </Button>
            </div>
          }
        />
      ) : (
        <>
          <p className="mt-4 text-caption text-ink-500">
            共 <span className="tabular font-strong text-ink-900">{kpis.length}</span> 个指标 · 达标{" "}
            <span className="tabular font-strong text-ink-900">{achieved}</span> 个
            <span className="ml-1 text-ink-300">
              {override ? `· 统一按${PERIOD_LABEL[override]}查看` : "· 各按自己的周期"}
            </span>
          </p>

          <div className="mt-3 grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
            {snapshots.map((snapshot) => (
              <KpiCard
                key={snapshot.kpi.id}
                snapshot={snapshot}
                entries={entries}
                expanded={expandedId === snapshot.kpi.id}
                onToggle={() =>
                  setExpandedId((current) =>
                    current === snapshot.kpi.id ? null : snapshot.kpi.id,
                  )
                }
                onQuickAdd={(delta) => void handleQuickAdd(snapshot.kpi, delta)}
                onBackfill={(date, value, note) =>
                  void handleBackfill(snapshot.kpi, date, value, note)
                }
                onDeleteEntry={(id) => void handleDeleteEntry(id)}
                onEdit={() => openEdit(snapshot.kpi)}
                onDelete={() => setDeleting(snapshot.kpi)}
              />
            ))}
          </div>
        </>
      )}

      <KpiFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        initial={draft}
        editing={editing}
        onSubmit={(next) => void handleSubmit(next)}
      />

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={`删除「${deleting?.name ?? ""}」？`}
        description="指标会从列表里消失，已有的打卡记录不会被物理删除，换设备也能收到墓碑。"
        size="sm"
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={() => setDeleting(null)}>
              再想想
            </Button>
            <Button size="sm" variant="danger" onClick={() => void handleDeleteKpi()}>
              删除
            </Button>
          </>
        }
      >
        <p className="text-caption text-ink-500">
          目标 {formatKpiTarget(deleting?.targetValue ?? 0)} {deleting?.unit ?? ""} ·{" "}
          {deleting ? PERIOD_LABEL[deleting.period] : ""}度
        </p>
      </Dialog>
    </div>
  );
}
