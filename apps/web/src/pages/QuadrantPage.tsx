import { QuadrantProvider } from "@/features/quadrant/DragProvider";
import { QuadrantBoard } from "@/features/quadrant/QuadrantBoard";
import { GoalRailShell } from "@/features/goals/GoalRailShell";

/**
 * 四象限首页（薄壳）。
 *
 * 页面只负责两件事：装配拖拽/视图模式的 Provider，以及决定「板子 + 目标栏」的
 * 页面级高度与断点布局。所有业务逻辑都在 features/quadrant 与 features/goals 里。
 *
 * 高度：桌面端整页不滚动，四象限 2×2 铺满可视区。
 * 100dvh − 顶栏 56 − main 上内边距 20 − main 下内边距 40 = 100dvh − 7.25rem。
 */
export default function QuadrantPage() {
  return (
    <QuadrantProvider>
      <div className="flex h-full min-h-0 flex-col md:h-[calc(100dvh-7.25rem)] md:min-h-[540px] lg:flex-row lg:gap-4">
        <QuadrantBoard />
        <GoalRailShell />
      </div>
    </QuadrantProvider>
  );
}
