import type { WeightSummary } from "@detter/shared";
import { cn } from "@detter/ui";
import {
  ASSESSMENT_KIND_COLOR,
  ASSESSMENT_KIND_LABEL,
  weightStatus,
  weightStatusLabel,
} from "./coursesModel";

/**
 * 权重构成条：按类型分色，右侧写「已知 X% / 剩余 Y% 未记录」。
 *
 * 设计取舍：
 * - 只用一条堆叠条，不做饼图——占比是「加起来有没有到 100」的问题，条形比饼更快读懂；
 * - 超过 100% 时整条转成警示色并标注超出的百分点（这是数据错误，必须显眼）；
 * - 未记录的剩余部分用 sunken 底色表示「这里还空着」。
 */
export interface WeightBarProps {
  summary: WeightSummary;
  className?: string;
  /** 紧凑模式：卡片里用，不显示图例 */
  compact?: boolean;
}

export function WeightBar({ summary, className, compact = false }: WeightBarProps) {
  const status = weightStatus(summary);
  const scale = Math.max(100, summary.total, 1);
  const overflow = status === "over";

  return (
    <div className={cn("min-w-0", className)}>
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-sunken"
        role="img"
        aria-label={`考核权重：已知 ${summary.total}%，剩余 ${summary.remaining}%`}
      >
        {summary.byKind.map((bucket) => (
          <span
            key={bucket.kind}
            className="h-full first:rounded-l-full"
            style={{
              width: `${(bucket.weight / scale) * 100}%`,
              backgroundColor: overflow ? "var(--danger)" : ASSESSMENT_KIND_COLOR[bucket.kind],
              opacity: overflow ? 0.85 : 1,
            }}
            title={`${ASSESSMENT_KIND_LABEL[bucket.kind]} ${bucket.weight}%`}
          />
        ))}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-micro">
        <span className={cn("font-strong", overflow ? "text-warning-ink" : "text-ink-900")}>
          已知 {summary.total}%
        </span>
        <span className="text-ink-300">/</span>
        <span className="text-ink-500">
          {overflow ? `超出 ${summary.overflow}%` : `剩余 ${summary.remaining}% 未记录`}
        </span>
        {summary.count === 0 && <span className="text-ink-300">还没有考核项</span>}
      </div>

      {!compact && summary.byKind.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {summary.byKind.map((bucket) => (
            <li key={bucket.kind} className="flex items-center gap-1.5 text-micro text-ink-500">
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ backgroundColor: ASSESSMENT_KIND_COLOR[bucket.kind] }}
              />
              {ASSESSMENT_KIND_LABEL[bucket.kind]}
              <span className="tabular text-ink-700">{bucket.weight}%</span>
              <span className="text-ink-300">· {bucket.count} 项</span>
            </li>
          ))}
        </ul>
      )}
      {overflow && (
        <p role="status" className="mt-2 rounded-md bg-warning-soft px-2.5 py-1.5 text-micro text-warning-ink">
          {weightStatusLabel(summary)}：检查一下是不是把「平时分」和「期末」重复记了。
        </p>
      )}
    </div>
  );
}
