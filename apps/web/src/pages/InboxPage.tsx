import { InboxBoard } from "@/features/inbox/InboxBoard";

/**
 * 收件箱页。
 *
 * 页面只做一件事：把 features/inbox 的看板挂上去。
 * 取数、分组、分诊、批量操作全在 feature 里，页面保持「薄壳」，
 * 这样以后换布局（比如把收件箱做成右侧抽屉）不需要动业务代码。
 */
export default function InboxPage() {
  return <InboxBoard />;
}
