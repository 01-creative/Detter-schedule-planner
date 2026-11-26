import { KpiView } from "@/features/kpi/KpiView";

/**
 * KPI 页（薄壳）。
 *
 * 取数、周期聚合、达标率、手写 SVG 图表、打卡与补录都在 `features/kpi` 里，
 * 页面保持「一行装配」，以后换布局不用动业务代码。
 */
export default function KpiPage() {
  return <KpiView />;
}
