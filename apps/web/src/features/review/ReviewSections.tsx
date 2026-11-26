import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  ListTodo,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import { QUADRANT_META, formatDateTime } from "@detter/shared";
import type { Quadrant } from "@detter/shared";
import { Badge, cn } from "@detter/ui";
import type { ReviewMetrics } from "./metrics";
import type { ReviewNarrative } from "./narrative";
import {
  compactMinutes,
  formatDueShort,
  kpiScaleLabel,
  kpiTone,
  q2Health,
  quadrantColor,
  quadrantName,
  quadrantSoft,
} from "./review-visuals";

/**
 * 复盘页的展示层。
 *
 * 只接收已经算好的 metrics / narrative，不读库、不算数：
 * 数字口径全部在 metrics.ts，这里只负责把它们排得干净。
 */

const QUADRANTS: readonly Quadrant[] = [1, 2, 3, 4];

export function SectionCard({
  title,
  aside,
  icon,
  children,
  className,
}: {
  title: string;
  aside?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col rounded-xl border border-border bg-surface p-4 shadow-1",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {icon && <span className="shrink-0 text-ink-300">{icon}</span>}
        <h2 className="min-w-0 truncate text-h2 text-ink-900">{title}</h2>
        {aside && <div className="ml-auto flex shrink-0 items-center gap-1.5">{aside}</div>}
      </div>
      <div className="mt-3 min-w-0 flex-1">{children}</div>
    </section>
  );
}

function Bar({ ratio, color, className }: { ratio: number; color: string; className?: string }) {
  const safe = Math.min(1, Math.max(0, ratio));
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-surface-sunken", className)}>
      <div
        className="h-full origin-left rounded-full"
        style={{ transform: `scaleX(${safe})`, backgroundColor: color }}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "success" | "danger";
}) {
  return (
    <div className="rounded-lg bg-surface-sunken/70 px-3 py-2">
      <dt className="text-micro text-ink-500">{label}</dt>
      <dd
        className={cn(
          "tabular mt-0.5 text-h2",
          tone === "success" ? "text-success-ink" : tone === "danger" ? "text-danger-ink" : "text-ink-900",
        )}
      >
        {value}
      </dd>
      {hint && <p className="mt-0.5 truncate text-micro text-ink-300">{hint}</p>}
    </div>
  );
}

export function ReviewHero({
  metrics,
  narrative,
  generatedAt,
  snapshot,
}: {
  metrics: ReviewMetrics;
  narrative: ReviewNarrative;
  generatedAt: number;
  snapshot: boolean;
}) {
  const rate = metrics.tasks.completionRate;
  return (
    <section className="rounded-xl border border-border bg-surface p-4 shadow-1 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Sparkles className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-micro text-ink-300">一行结论</p>
          <p className="mt-1 text-h2 text-ink-900">{narrative.headline}</p>
          <p className="mt-1.5 text-micro text-ink-500">
            {snapshot ? "快照" : "实时计算"} · {formatDateTime(generatedAt)} 生成 · 数据只来自本地库
          </p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="完成"
          value={`${metrics.tasks.done} 项`}
          hint={rate === null ? "本周期没有新增" : `完成率 ${Math.round(rate * 100)}%`}
          tone="success"
        />
        <Stat label="新增" value={`${metrics.tasks.created} 项`} hint={`经手 ${metrics.tasks.touched} 项`} />
        <Stat
          label="逾期"
          value={`${metrics.tasks.overdue} 项`}
          hint={
            metrics.tasks.overdue > 0
              ? `Q1 占 ${metrics.tasks.overdueByQuadrant[1] ?? 0} 项`
              : "没有拖尾"
          }
          tone={metrics.tasks.overdue > 0 ? "danger" : "neutral"}
        />
        <Stat
          label="专注"
          value={compactMinutes(metrics.focus.minutes)}
          hint={`${metrics.focus.sessions} 个番茄 · ${metrics.focus.days} 天`}
        />
      </dl>
    </section>
  );
}

export function QuadrantCard({ metrics }: { metrics: ReviewMetrics }) {
  const { tasks } = metrics;
  const health = q2Health(tasks.q2Share, tasks.touched);
  return (
    <SectionCard
      title="四象限分布"
      icon={<Target className="size-4" aria-hidden="true" />}
      aside={<Badge tone={health.tone} dot>{`Q2 ${tasks.q2Share}% · ${health.label}`}</Badge>}
    >
      <p className="text-micro text-ink-500">
        经手 {tasks.touched} 项（周期内新增 ∪ 完成，按任务去重）
      </p>

      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-surface-sunken">
        {QUADRANTS.map((quadrant) => {
          const count = tasks.quadrants[quadrant] ?? 0;
          const width = tasks.touched === 0 ? 0 : (count / tasks.touched) * 100;
          return (
            <span
              key={quadrant}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{ width: `${width}%`, backgroundColor: quadrantColor(quadrant) }}
              title={`Q${quadrant} ${quadrantName(quadrant)} ${count} 项`}
            />
          );
        })}
      </div>

      <ul className="mt-3 space-y-2">
        {QUADRANTS.map((quadrant) => {
          const count = tasks.quadrants[quadrant] ?? 0;
          const share = tasks.touched === 0 ? 0 : Math.round((count / tasks.touched) * 100);
          return (
            <li key={quadrant} className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: quadrantColor(quadrant) }}
              />
              <span className="w-8 shrink-0 text-caption font-strong text-ink-700">Q{quadrant}</span>
              <span className="min-w-0 flex-1 truncate text-caption text-ink-500">
                {QUADRANT_META[quadrant].name}
              </span>
              <span className="tabular shrink-0 text-caption text-ink-700">{count} 项</span>
              <span className="tabular w-10 shrink-0 text-right text-micro text-ink-300">{share}%</span>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 rounded-md px-2 py-1.5 text-micro" style={{ backgroundColor: quadrantSoft(2), color: "var(--q2-accent)" }}>
        {tasks.touched === 0
          ? "还没有可统计的任务。"
          : metrics.tasks.q2Share >= 50
            ? "Q2 占比过半：在做重要但不紧急的事，这是长期复利的位置。"
            : metrics.tasks.q2Share >= 30
              ? "Q2 占比尚可，可以再留一点整块时间给它。"
              : "Q2 占比偏低，这周更像在救火。"}
      </p>
    </SectionCard>
  );
}

export function TodoCard({ metrics }: { metrics: ReviewMetrics }) {
  const { tasks } = metrics;
  return (
    <SectionCard
      title="待办清单"
      icon={<ListTodo className="size-4" aria-hidden="true" />}
      aside={
        <Badge tone={tasks.open > 0 ? "neutral" : "success"}>
          {tasks.open > 0 ? `剩 ${tasks.open} 项` : "已清空"}
        </Badge>
      }
    >
      {tasks.todo.length === 0 ? (
        <p className="py-4 text-center text-caption text-ink-300">没有未完成的待办。</p>
      ) : (
        <ul className="-mx-1 divide-y divide-border">
          {tasks.todo.map((item) => {
            const overdue = item.dueAt !== null && item.dueAt < metrics.evaluatedAt;
            return (
              <li key={item.id} className="flex items-start gap-2 px-1 py-2">
                <span
                  aria-label={`Q${item.quadrant} ${quadrantName(item.quadrant)}`}
                  className="mt-1.5 size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: quadrantColor(item.quadrant) }}
                />
                <span className="min-w-0 flex-1 text-caption text-ink-700">{item.title}</span>
                <span
                  className={cn(
                    "tabular shrink-0 text-micro",
                    overdue ? "text-danger-ink" : "text-ink-300",
                  )}
                >
                  {item.dueAt === null ? "未排期" : formatDueShort(item.dueAt)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {tasks.todoMore > 0 && (
        <p className="mt-2 text-micro text-ink-300">还有 {tasks.todoMore} 项未列出，去四象限查看完整待办。</p>
      )}
    </SectionCard>
  );
}

export function GoalsCard({ metrics }: { metrics: ReviewMetrics }) {
  const hasBaseline = metrics.goals.some((goal) => goal.delta !== null);
  return (
    <SectionCard
      title="目标进展"
      icon={<TrendingUp className="size-4" aria-hidden="true" />}
      aside={<Badge tone="neutral">{metrics.goals.length} 个目标</Badge>}
    >
      {metrics.goals.length === 0 ? (
        <p className="py-4 text-center text-caption text-ink-300">还没有可统计的目标进展。</p>
      ) : (
        <ul className="space-y-3">
          {metrics.goals.map((goal) => (
            <li key={goal.id}>
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: goal.color }}
                />
                <span className="min-w-0 flex-1 truncate text-caption font-strong text-ink-900">
                  {goal.title}
                </span>
                <span className="tabular shrink-0 text-micro text-ink-500">
                  {goal.taskDone}/{goal.taskTotal}
                </span>
                <span className="tabular w-9 shrink-0 text-right text-caption font-strong text-ink-900">
                  {goal.progress}%
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <Bar ratio={goal.progress / 100} color={goal.color} className="flex-1" />
                <span
                  className={cn(
                    "tabular w-12 shrink-0 text-right text-micro",
                    goal.delta === null
                      ? "text-ink-300"
                      : goal.delta > 0
                        ? "text-success-ink"
                        : goal.delta < 0
                          ? "text-danger-ink"
                          : "text-ink-300",
                  )}
                  title="相对上一次快照的百分点变化"
                >
                  {goal.delta === null ? "—" : goal.delta > 0 ? `+${goal.delta}` : `${goal.delta}`}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {!hasBaseline && metrics.goals.length > 0 && (
        <p className="mt-3 text-micro text-ink-300">
          没有更早的快照可对比；下次生成复盘就能看到涨跌。
        </p>
      )}
    </SectionCard>
  );
}

export function OkrOverviewCard({ metrics }: { metrics: ReviewMetrics }) {
  return (
    <SectionCard
      title="OKR"
      icon={<Target className="size-4" aria-hidden="true" />}
      aside={
        <Link
          to="/okr"
          className="inline-flex items-center gap-0.5 rounded-md px-1 text-micro text-accent hover:underline"
        >
          去 OKR 页
          <ArrowUpRight className="size-3" aria-hidden="true" />
        </Link>
      }
    >
      {metrics.okrs.length === 0 ? (
        <p className="py-4 text-center text-caption text-ink-300">本周期没有进行中的 Objective。</p>
      ) : (
        <ul className="space-y-3.5">
          {metrics.okrs.map((okr) => (
            <li key={okr.id}>
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: okr.color }}
                />
                <span className="min-w-0 flex-1 truncate text-caption font-strong text-ink-900">
                  {okr.title}
                </span>
                <span className="tabular shrink-0 text-caption font-strong text-ink-900">
                  {okr.progress === null ? "—" : `${okr.progress}%`}
                </span>
              </div>
              <Bar
                ratio={(okr.progress ?? 0) / 100}
                color={okr.color}
                className="mt-1.5"
              />
              <ul className="mt-1.5 space-y-1">
                {okr.krs.map((kr) => (
                  <li key={kr.id} className="flex items-center gap-2 pl-4">
                    <span className="min-w-0 flex-1 truncate text-micro text-ink-500">{kr.title}</span>
                    <span className="tabular shrink-0 text-micro text-ink-500">{kr.percent}%</span>
                  </li>
                ))}
                {okr.krCount === 0 && (
                  <li className="pl-4 text-micro text-ink-300">还没有 KR。</li>
                )}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

export function KpiCard({ metrics }: { metrics: ReviewMetrics }) {
  return (
    <SectionCard
      title="KPI"
      icon={<CircleCheck className="size-4" aria-hidden="true" />}
      aside={
        <Badge tone={metrics.kpis.length === 0 ? "neutral" : metrics.kpiAchieved === metrics.kpis.length ? "success" : "warning"}>
          {metrics.kpis.length === 0 ? "未配置" : `达标 ${metrics.kpiAchieved}/${metrics.kpis.length}`}
        </Badge>
      }
    >
      {metrics.kpis.length === 0 ? (
        <p className="py-4 text-center text-caption text-ink-300">还没有启用中的 KPI。</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {metrics.kpis.map((kpi) => (
            <div key={kpi.id} className="rounded-lg border border-border bg-surface-solid px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: kpi.color }}
                />
                <span className="min-w-0 flex-1 truncate text-caption font-strong text-ink-900">
                  {kpi.name}
                </span>
                <Badge tone={kpiTone(kpi.achieved, kpi.value !== null)}>
                  {kpi.value === null ? "未打卡" : kpi.achieved ? "达标" : "差一点"}
                </Badge>
              </div>
              <p className="tabular mt-1 text-caption text-ink-700">
                {formatKpiValue(kpi.value)}
                <span className="text-ink-300"> / {formatKpiValue(kpi.target)} {kpi.unit}</span>
              </p>
              <Bar
                ratio={kpi.ratio ?? 0}
                color={kpi.achieved ? "var(--success)" : "var(--warning)"}
                className="mt-1.5"
              />
              <p className="mt-1 flex flex-wrap items-center gap-x-1 text-micro text-ink-300">
                <span>{kpi.percent === null ? "没有可算的目标" : `达成 ${kpi.percent}%`}</span>
                {kpi.autoSource && <span>· 自动</span>}
                {kpi.scale > 1 && <span>· {kpiScaleLabel(kpi.period, kpi.scale)}</span>}
              </p>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function formatKpiValue(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}

export function NotesCard({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "success" | "warning";
}) {
  const Icon = tone === "success" ? CircleCheck : CircleAlert;
  return (
    <SectionCard
      title={title}
      icon={<Icon className={cn("size-4", tone === "success" ? "text-success" : "text-warning")} aria-hidden="true" />}
    >
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2 text-caption text-ink-700">
            <span
              aria-hidden="true"
              className={cn(
                "mt-[7px] size-1.5 shrink-0 rounded-full",
                tone === "success" ? "bg-success" : "bg-warning",
              )}
            />
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
