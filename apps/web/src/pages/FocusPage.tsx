import { Timer } from "lucide-react";
import { PagePlaceholder } from "@/components/common/PagePlaceholder";

export default function FocusPage() {
  return (
    <PagePlaceholder
      module="专注"
      title="25 分钟只做一件事"
      description="番茄钟与任务绑定，中断会被记录，结束后自动汇入 KPI。"
      icon={<Timer className="size-5" aria-hidden="true" />}
      bullets={[
        "与任务绑定的专注计时，中断次数如实记录",
        "25/5/15 的默认节奏，可长可短，不强制",
        "专注时长自动进入 KPI，不需要手动填",
        "全局浮层计时，切到别的页面也不会丢",
      ]}
    />
  );
}
