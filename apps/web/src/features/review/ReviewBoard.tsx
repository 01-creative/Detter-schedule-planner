import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  CheckCheck,
  ClipboardCopy,
  Download,
  Eye,
  FileJson,
  Info,
  RefreshCw,
  Save,
  Sparkles,
} from "lucide-react";
import { formatDateTime } from "@detter/shared";
import { Badge, Button, Tabs, useToast } from "@detter/ui";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingState } from "@/components/common/LoadingState";
import { PageHeading } from "@/components/common/PageHeading";
import { SectionLabel } from "@/components/common/SectionLabel";
import { buildReviewJson, buildReviewJsonFromSnapshot, copyText, downloadText, reviewFileName } from "./export";
import { buildReviewMarkdown } from "./markdown";
import {
  computeReviewMetrics,
  parseReviewQuery,
  REVIEW_RANGE_OPTIONS,
  rangeKeyOf,
  reviewRange,
  type ReviewMetrics,
  type ReviewRange,
  type ReviewRangeType,
} from "./metrics";
import { buildReviewNarrative, rangeWord } from "./narrative";
import { useReviewData, useReviewSnapshots } from "./queries";
import {
  GoalsCard,
  KpiCard,
  NotesCard,
  OkrOverviewCard,
  QuadrantCard,
  ReviewHero,
  TodoCard,
} from "./ReviewSections";
import {
  REVIEW_SNAPSHOT_VERSION,
  deleteReviewSnapshot,
  goalBaselineOf,
  latestSnapshotBefore,
  saveReviewSnapshot,
  settingKeyOf,
  type ReviewSnapshot,
} from "./snapshot";
import { SnapshotHistory } from "./SnapshotHistory";

/**
 * 复盘页。
 *
 * 生命周期：
 *   1. 选周期（本周 / 上周 / 本月 / 上月，可用 ?range=&offset= 深链）；
 *   2. 有快照就直接展示快照（冻结口径），没有就用当前数据实时计算；
 *   3. 「重算预览」只是预览，不覆盖历史；「保存/更新快照」才写 settings。
 *
 * 页面不读 KPI / 番茄钟组件：所有数字由 metrics.ts 从原始表算出，
 * 与 OKR 页共用同一套 KR / Objective 进度函数。
 */

function rangeTitle(range: ReviewRange): string {
  return `${rangeWord(range)}复盘`;
}

export function ReviewBoard() {
  const { toast } = useToast();
  const data = useReviewData();
  const { loading } = data;
  const { data: snapshots, loading: snapshotsLoading } = useReviewSnapshots();
  const [searchParams, setSearchParams] = useSearchParams();
  const [now] = useState(() => Date.now());
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);

  const query = useMemo(() => parseReviewQuery(searchParams.toString()), [searchParams]);
  const range = useMemo(() => reviewRange(query.type, query.offset, now), [query.type, query.offset, now]);

  useEffect(() => {
    setPreview(false);
  }, [range.periodKey]);

  const baselineSnapshot = useMemo(() => latestSnapshotBefore(snapshots, range), [snapshots, range]);
  const baselineGoals = useMemo(() => goalBaselineOf(baselineSnapshot), [baselineSnapshot]);

  const liveMetrics = useMemo<ReviewMetrics>(
    () =>
      computeReviewMetrics({
        tasks: data.tasks,
        goals: data.goals,
        okrs: data.okrs,
        krs: data.krs,
        kpis: data.kpis,
        kpiEntries: data.kpiEntries,
        sessions: data.sessions,
        range,
        now,
        baselineGoals,
      }),
    [data, range, now, baselineGoals],
  );
  const liveNarrative = useMemo(() => buildReviewNarrative(liveMetrics), [liveMetrics]);
  const liveMarkdown = useMemo(
    () =>
      buildReviewMarkdown(liveMetrics, liveNarrative, {
        generatedAt: now,
        snapshotKey: settingKeyOf(range.periodKey),
      }),
    [liveMetrics, liveNarrative, now, range.periodKey],
  );

  const snapshot = useMemo(
    () => snapshots.find((item) => item.periodKey === range.periodKey) ?? null,
    [snapshots, range.periodKey],
  );
  const showingSnapshot = snapshot !== null && !preview;
  const activeMetrics = showingSnapshot && snapshot ? snapshot.metrics : liveMetrics;
  const activeNarrative = showingSnapshot && snapshot ? snapshot.narrative : liveNarrative;
  const activeMarkdown = showingSnapshot && snapshot ? snapshot.markdown : liveMarkdown;
  const activeGeneratedAt = showingSnapshot && snapshot ? snapshot.generatedAt : now;

  const isEmpty =
    liveMetrics.tasks.created === 0 &&
    liveMetrics.tasks.done === 0 &&
    liveMetrics.tasks.open === 0 &&
    liveMetrics.focus.sessions === 0 &&
    liveMetrics.goals.length === 0 &&
    liveMetrics.okrs.length === 0 &&
    liveMetrics.kpis.length === 0 &&
    snapshots.length === 0;

  const selectRange = useCallback(
    (type: ReviewRangeType, offset: number) => {
      const next = new URLSearchParams();
      next.set("range", type);
      if (offset === -1) next.set("offset", "-1");
      setSearchParams(next, { replace: true });
    },
    [setSearchParams],
  );

  const handleCopy = useCallback(
    (markdown: string) => {
      void copyText(markdown).then((ok) => {
        toast(
          ok
            ? { title: "已复制 Markdown", description: "可以直接粘给 AI 或贴进笔记", tone: "success" }
            : {
                title: "复制失败",
                description: "浏览器拒绝了剪贴板访问，请改用「下载 .md」",
                tone: "danger",
              },
        );
      });
    },
    [toast],
  );

  const handleDownloadMarkdown = useCallback(
    (target: ReviewRange, markdown: string) => {
      downloadText(reviewFileName(target, "md"), markdown, "text/markdown");
    },
    [],
  );

  const handleDownloadJson = useCallback((target: ReviewRange, payload: string) => {
    downloadText(reviewFileName(target, "json"), payload, "application/json");
  }, []);

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const generatedAt = Date.now();
      const metrics = computeReviewMetrics({
        tasks: data.tasks,
        goals: data.goals,
        okrs: data.okrs,
        krs: data.krs,
        kpis: data.kpis,
        kpiEntries: data.kpiEntries,
        sessions: data.sessions,
        range,
        now: generatedAt,
        baselineGoals,
      });
      const narrative = buildReviewNarrative(metrics);
      const markdown = buildReviewMarkdown(metrics, narrative, {
        generatedAt,
        snapshotKey: settingKeyOf(range.periodKey),
      });
      await saveReviewSnapshot({
        version: REVIEW_SNAPSHOT_VERSION,
        periodKey: range.periodKey,
        range,
        generatedAt,
        narrative,
        metrics,
        markdown,
      });
      setPreview(false);
      toast({
        title: snapshot ? "快照已更新" : "快照已保存",
        description: `${range.label} · 之后可回看`,
        tone: "success",
      });
    } catch (error) {
      toast({
        title: "没能保存快照",
        description: error instanceof Error ? error.message : "稍后再试",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  }, [saving, data, range, baselineGoals, snapshot, toast]);

  const handleDeleteSnapshot = useCallback(
    (target: ReviewSnapshot) => {
      void deleteReviewSnapshot(target.periodKey)
        .then(() => toast({ title: "快照已删除", tone: "success" }))
        .catch(() => toast({ title: "删除失败，稍后再试", tone: "danger" }));
    },
    [toast],
  );

  const downloadActiveJson = useCallback(() => {
    const payload =
      showingSnapshot && snapshot
        ? buildReviewJsonFromSnapshot(snapshot)
        : buildReviewJson({
            range,
            generatedAt: now,
            narrative: liveNarrative,
            metrics: liveMetrics,
            markdown: liveMarkdown,
          });
    handleDownloadJson(range, payload);
  }, [
    showingSnapshot,
    snapshot,
    range,
    now,
    liveNarrative,
    liveMetrics,
    liveMarkdown,
    handleDownloadJson,
  ]);

  const tabs = REVIEW_RANGE_OPTIONS.map((option) => ({
    value: rangeKeyOf(option.type, option.offset),
    label: option.label,
  }));
  const activeRangeKey = rangeKeyOf(range.type, range.offset);

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-6xl">
        <LoadingState rows={4} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <PageHeading
          eyebrow="复盘 · 只用本地数据"
          title={rangeTitle(range)}
          titleAddon={<span className="tabular text-h2 text-ink-500">{range.label}</span>}
          description={<span className="tabular">{range.caption}</span>}
        />
        <Tabs
          items={tabs}
          value={activeRangeKey}
          onValueChange={(value) => {
            const option = REVIEW_RANGE_OPTIONS.find(
              (item) => rangeKeyOf(item.type, item.offset) === value,
            );
            if (option) selectRange(option.type, option.offset);
          }}
          variant="pill"
          ariaLabel="复盘范围"
        />
      </header>

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-info-soft px-3 py-2">
        <Info className="mt-0.5 size-3.5 shrink-0 text-info-ink" aria-hidden="true" />
        <p className="min-w-0 text-micro text-info-ink">
          想更深度的分析？把 Markdown 连同
          <Link to="/settings" className="mx-1 underline decoration-info-ink/30 underline-offset-2">
            上下文包
          </Link>
          一起给 AI，页面上的数字都能在 JSON 里找到。
        </p>
      </div>

      {/* 工具条分两行：状态（快照/实时）一行，动作一行。
          窄屏不再让 .md / .json / 保存快照挤成「2+1」并留下一条悬空分隔线。 */}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={showingSnapshot ? "accent" : "neutral"} dot>
            {showingSnapshot ? "快照" : "实时计算"}
          </Badge>
          <span className="text-micro text-ink-300">
            {showingSnapshot
              ? `${formatDateTime(activeGeneratedAt)} 生成 · 不随数据变化`
              : `${formatDateTime(now)} 计算 · 未保存`}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<ClipboardCopy className="size-3.5" aria-hidden="true" />}
            onClick={() => handleCopy(activeMarkdown)}
          >
            复制 Markdown
          </Button>
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<Download className="size-3.5" aria-hidden="true" />}
            onClick={() => handleDownloadMarkdown(range, activeMarkdown)}
          >
            .md
          </Button>
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<FileJson className="size-3.5" aria-hidden="true" />}
            onClick={downloadActiveJson}
          >
            .json
          </Button>
          <span aria-hidden="true" className="mx-1 hidden h-4 w-px bg-border-strong sm:block" />
          {showingSnapshot ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<Eye className="size-3.5" aria-hidden="true" />}
                onClick={() => setPreview(true)}
              >
                重算预览
              </Button>
              <Button
                size="sm"
                variant="primary"
                className="order-first sm:order-none"
                loading={saving}
                leftIcon={<RefreshCw className="size-3.5" aria-hidden="true" />}
                onClick={() => void handleSave()}
              >
                更新快照
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="primary"
              className="order-first sm:order-none"
              loading={saving}
              leftIcon={<Save className="size-3.5" aria-hidden="true" />}
              onClick={() => void handleSave()}
            >
              {snapshot ? "更新快照" : "保存快照"}
            </Button>
          )}
        </div>
      </div>

      {preview && snapshot && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-accent/20 bg-accent-soft px-3 py-2 text-micro text-accent">
          <Sparkles className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            正在用当前数据预览，页面数字会与已保存的快照不同；不点保存就不会覆盖历史。
          </span>
          <button
            type="button"
            className="shrink-0 underline underline-offset-2"
            onClick={() => setPreview(false)}
          >
            回到快照
          </button>
        </div>
      )}

      {isEmpty ? (
        <div className="mt-5 rounded-xl border border-dashed border-border-strong bg-surface">
          <EmptyState
            icon={<BookOpen className="size-6" aria-hidden="true" />}
            title={`${rangeWord(range)}还没有记录`}
            description="先在四象限里完成一件事，或去专注页跑一个番茄；有了数据再回来生成复盘。"
            action={
              <Link to="/">
                <Button size="sm" leftIcon={<ArrowRight className="size-3.5" aria-hidden="true" />}>
                  去四象限
                </Button>
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <div className="mt-5">
            <ReviewHero
              metrics={activeMetrics}
              narrative={activeNarrative}
              generatedAt={activeGeneratedAt}
              snapshot={showingSnapshot}
            />
          </div>

          {/* 区块节奏：结论（mt-5 / 卡内 16）→ 分组标题（mt-6）→ 明细（gap-4）。
              之前所有块都是 12px，结论、数据、备注读起来一样重。 */}
          <SectionLabel className="mt-6">这几件事值得看</SectionLabel>
          <div className="mt-3 grid gap-4 lg:grid-cols-12">
            <div className="min-w-0 lg:col-span-7">
              <QuadrantCard metrics={activeMetrics} />
            </div>
            <div className="min-w-0 lg:col-span-5">
              <TodoCard metrics={activeMetrics} />
            </div>
            <div className="min-w-0 lg:col-span-6">
              <GoalsCard metrics={activeMetrics} />
            </div>
            <div className="min-w-0 lg:col-span-6">
              <OkrOverviewCard metrics={activeMetrics} />
            </div>
            <div className="min-w-0 lg:col-span-12">
              <KpiCard metrics={activeMetrics} />
            </div>
            <div className="min-w-0 lg:col-span-6">
              <NotesCard title="做得好的" items={activeNarrative.highlights} tone="success" />
            </div>
            <div className="min-w-0 lg:col-span-6">
              <NotesCard title="值得注意的" items={activeNarrative.attention} tone="warning" />
            </div>
          </div>
        </>
      )}

      <div className="mt-6">
        <SnapshotHistory
          snapshots={snapshots}
          loading={snapshotsLoading}
          currentPeriodKey={range.periodKey}
          onCopy={handleCopy}
          onDownloadMarkdown={(item) => handleDownloadMarkdown(item.range, item.markdown)}
          onDownloadJson={(item) => handleDownloadJson(item.range, buildReviewJsonFromSnapshot(item))}
          onDelete={handleDeleteSnapshot}
        />
      </div>

      <p className="mt-4 flex items-center gap-1.5 text-micro text-ink-300">
        <CheckCheck className="size-3.5" aria-hidden="true" />
        所有数字都由本地原始数据计算：完成 / 新增 / 逾期 / 四象限 / 专注 / KPI；不发起外部请求。
      </p>
    </div>
  );
}

export default ReviewBoard;
