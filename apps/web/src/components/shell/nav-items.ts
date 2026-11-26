import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  CalendarDays,
  ChartLine,
  Inbox,
  LayoutGrid,
  Network,
  NotebookPen,
  Settings,
  Target,
  Timer,
} from "lucide-react";

/**
 * 导航配置集中在这里。
 *
 * 侧栏、移动端 tab bar、面包屑三处共用同一份数据：
 * 多写一次就会出现「菜单里有、标题里没有」这种没人发现的小裂缝。
 */

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** 设置页/空态里用来解释这个模块要解决什么 */
  description: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    to: "/",
    label: "四象限",
    icon: LayoutGrid,
    description: "重要与紧急两轴，决定现在做什么",
  },
  {
    to: "/inbox",
    label: "收件箱",
    icon: Inbox,
    description: "所有来不及整理的念头先落在这里",
  },
  {
    to: "/calendar",
    label: "日历",
    icon: CalendarDays,
    description: "任务与日程同轴，按天/周/月看",
  },
  {
    to: "/courses",
    label: "课程",
    icon: BookOpen,
    description: "课表导入、考核占分与每周作业",
  },
  {
    to: "/okr",
    label: "OKR",
    icon: Target,
    description: "周/月/季目标与可量化的关键结果",
  },
  {
    to: "/review",
    label: "复盘",
    icon: NotebookPen,
    description: "把一周的数据变成一段能读、能喂给 AI 的总结",
  },
  {
    to: "/kpi",
    label: "KPI",
    icon: ChartLine,
    description: "指标打卡与趋势，番茄钟自动汇总",
  },
  {
    to: "/focus",
    label: "专注",
    icon: Timer,
    description: "绑定任务的番茄钟与中断记录",
  },
  {
    to: "/mindmap",
    label: "导图",
    icon: Network,
    description: "把目标拆成树，节点一键变任务",
  },
  {
    to: "/settings",
    label: "设置",
    icon: Settings,
    description: "同步、设备、外观与数据",
  },
];

/** 移动端底部只放最高频的四个，其余收进「更多」 */
export const MOBILE_TABS: readonly NavItem[] = NAV_ITEMS.filter((item) =>
  ["/", "/inbox", "/calendar", "/focus"].includes(item.to),
);

export const MOBILE_MORE_ITEMS: readonly NavItem[] = NAV_ITEMS.filter(
  (item) => !MOBILE_TABS.includes(item),
);

const TITLES: Record<string, string> = Object.fromEntries(
  NAV_ITEMS.map((item) => [item.to, item.label]),
);

export function viewTitle(pathname: string): string {
  if (TITLES[pathname]) return TITLES[pathname];
  if (pathname.startsWith("/mindmap")) return "导图";
  // 课程详情是 /courses/:id，菜单标题统一显示「课程」
  if (pathname.startsWith("/courses")) return "课程";
  if (pathname === "/login") return "登录";
  if (pathname === "/setup") return "初始化";
  return "Detter";
}

export function currentNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => (item.to === "/" ? pathname === "/" : pathname.startsWith(item.to)));
}
