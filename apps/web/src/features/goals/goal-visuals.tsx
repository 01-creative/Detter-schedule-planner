import {
  BookOpen,
  Briefcase,
  Code,
  Dumbbell,
  FlaskConical,
  Heart,
  House,
  Leaf,
  Music,
  Palette,
  Plane,
  Target,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * 目标栏的视觉预设。
 *
 * 颜色与图标都写死成有限的几档，而不是自由取色：
 * 目标栏只有 320px 宽，颜色一多就会变成调色盘，反而看不出哪条是重点。
 */

export const GOAL_COLORS = [
  "#6355F6",
  "#0EA5E9",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#EC4899",
  "#8B5CF6",
  "#64748B",
] as const;

export interface GoalIconOption {
  key: string;
  label: string;
  Icon: LucideIcon;
}

export const GOAL_ICONS: GoalIconOption[] = [
  { key: "target", label: "目标", Icon: Target },
  { key: "book", label: "学习", Icon: BookOpen },
  { key: "dumbbell", label: "健身", Icon: Dumbbell },
  { key: "heart", label: "健康", Icon: Heart },
  { key: "briefcase", label: "工作", Icon: Briefcase },
  { key: "code", label: "项目", Icon: Code },
  { key: "palette", label: "创作", Icon: Palette },
  { key: "plane", label: "旅行", Icon: Plane },
  { key: "leaf", label: "生活", Icon: Leaf },
  { key: "music", label: "兴趣", Icon: Music },
  { key: "flask", label: "研究", Icon: FlaskConical },
  { key: "house", label: "家庭", Icon: House },
];

export function goalIconOption(name: string): GoalIconOption {
  return GOAL_ICONS.find((option) => option.key === name) ?? GOAL_ICONS[0]!;
}

export interface RrulePreset {
  value: string;
  label: string;
}

export const RRULE_PRESETS: RrulePreset[] = [
  { value: "FREQ=DAILY", label: "每天" },
  { value: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", label: "工作日" },
  { value: "FREQ=WEEKLY;BYDAY=MO", label: "每周一" },
  { value: "FREQ=WEEKLY;BYDAY=WE", label: "每周三" },
  { value: "FREQ=WEEKLY;BYDAY=FR", label: "每周五" },
  { value: "FREQ=WEEKLY;INTERVAL=1;COUNT=3", label: "每周三次" },
  { value: "FREQ=MONTHLY;BYMONTHDAY=1", label: "每月 1 日" },
];
