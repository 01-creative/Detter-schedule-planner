import { Sheet } from "@detter/ui";
import { useUIStore } from "@/stores/ui";
import { useIsMobile } from "@/features/quadrant/useMediaQuery";
import { GoalDialog } from "./GoalDialog";
import { GoalRail } from "./GoalRail";

/**
 * 目标栏在三种宽度下的壳：
 * - ≥1024：320px 常驻，可折叠（折叠状态存在 UI store）；
 * - 768–1023：右侧抽屉；
 * - <768：底部 sheet。
 *
 * 新建目标对话框挂在壳这一层，因此即使目标栏被收起、或者从右键菜单里
 * 点了「新建目标」，对话框也照样能出来。
 */
export function GoalRailShell() {
  const collapsed = useUIStore((state) => state.goalRailCollapsed);
  const toggleCollapsed = useUIStore((state) => state.toggleGoalRailCollapsed);
  const drawerOpen = useUIStore((state) => state.goalRailDrawerOpen);
  const setDrawerOpen = useUIStore((state) => state.setGoalRailDrawerOpen);
  const isMobile = useIsMobile();

  return (
    <>
      {!collapsed && (
        <aside aria-label="目标栏" className="hidden w-80 shrink-0 lg:block">
          <GoalRail onCollapse={toggleCollapsed} />
        </aside>
      )}

      <Sheet
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title="目标"
        description="拖到象限即可建任务"
        side={isMobile ? "bottom" : "right"}
        className={isMobile ? undefined : "w-[min(380px,90vw)]"}
      >
        <GoalRail embedded />
      </Sheet>

      <GoalDialog />
    </>
  );
}

export default GoalRailShell;
