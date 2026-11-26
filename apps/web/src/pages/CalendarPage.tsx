import { CalendarView } from "@/features/calendar/CalendarView";

/**
 * 日历页（薄壳）。
 *
 * 页面只做装配：视图切换、拖拽、重复展开、详情面板全部在 `features/calendar` 里，
 * 这样 T13 收敛交互时不用碰路由层（见 07-FRONTEND-STRUCTURE §6）。
 */
export default function CalendarPage() {
  return <CalendarView />;
}
