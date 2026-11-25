import { CalendarDays } from "lucide-react";
import { PagePlaceholder } from "@/components/common/PagePlaceholder";

export default function CalendarPage() {
  return (
    <PagePlaceholder
      module="日历"
      title="任务与日程，放在同一条时间轴上"
      description="日 / 周 / 月三种视图，任务与事件共用一套时间字段，拖拽即改期。"
      icon={<CalendarDays className="size-5" aria-hidden="true" />}
      bullets={[
        "日/周/月视图切换，重复任务按 RRULE 展开成实例",
        "拖拽改期、跨天任务拉长，冲突的时段会被标出来",
        "课程、会议这类事件不要求打卡，到点即视为过去",
        "离线新增的日程照样进本地库，联网后自动同步",
      ]}
    />
  );
}
