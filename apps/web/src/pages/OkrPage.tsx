import { Target } from "lucide-react";
import { PagePlaceholder } from "@/components/common/PagePlaceholder";

export default function OkrPage() {
  return (
    <PagePlaceholder
      module="OKR"
      title="周 / 月 / 季的目标，落到可量化的关键结果"
      description="目标负责方向，KR 负责刻度；任务可以挂到 KR 上，完成即推进进度。"
      icon={<Target className="size-5" aria-hidden="true" />}
      bullets={[
        "按周/月/季建立周期，periodStart 唯一确定一个周期",
        "KR 支持百分比、数值、布尔、里程碑四种度量",
        "任务与目标、KR 双向关联，进度自动聚合",
        "季度收尾时一键生成复盘用的上下文包",
      ]}
    />
  );
}
