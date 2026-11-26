import { MindMapShell } from "@/features/mindmap/MindMapShell";

/**
 * 思维导图页（薄壳）。
 *
 * 页面只负责把 feature 挂上去：取数、画布、节点、目标联动全部在 `features/mindmap`，
 * 这样以后要把它改成「右侧抽屉里的一张图」时不用碰路由层。
 */
export default function MindMapPage() {
  return <MindMapShell />;
}
