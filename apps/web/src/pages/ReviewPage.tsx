import { ReviewBoard } from "@/features/review/ReviewBoard";

/**
 * 复盘页（薄壳）。
 *
 * 取数、口径计算、快照与导出全部在 features/review 内，
 * 页面只负责把看板挂上去 —— 与 07-FRONTEND-STRUCTURE §6 的约定一致。
 */
export default function ReviewPage() {
  return <ReviewBoard />;
}
