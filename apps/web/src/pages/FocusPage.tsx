import { FocusView } from "@/features/focus/FocusView";

/**
 * 专注页（薄壳）。
 *
 * 计时、任务绑定、设置、记录全部在 `features/focus` 里；
 * 页面只负责把它挂载到路由出口上（07-FRONTEND-STRUCTURE §6）。
 */
export default function FocusPage() {
  return <FocusView />;
}
