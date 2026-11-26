import { OkrBoard } from "@/features/okr/OkrBoard";

/**
 * OKR 页。
 *
 * 页面只做一件事：把 features/okr 的看板挂上去。
 * 周期导航、KR 拖拽、关联与自动推进全在 feature 内，页面保持薄壳
 * （07-FRONTEND-STRUCTURE §6），之后换布局不需要动业务代码。
 */
export default function OkrPage() {
  return <OkrBoard />;
}
