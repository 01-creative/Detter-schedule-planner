import { ChartLine } from "lucide-react";
import { PagePlaceholder } from "@/components/common/PagePlaceholder";

export default function KpiPage() {
  return (
    <PagePlaceholder
      module="KPI"
      title="把时间投入变成看得见的变化"
      description="指标定义 + 每日打卡 + 周期达成率；深度工作时长由番茄钟自动汇总。"
      icon={<ChartLine className="size-5" aria-hidden="true" />}
      bullets={[
        "sum / count / max / avg / last 五种聚合方式",
        "手工打卡与自动来源（番茄钟分钟、专注次数、完成任务数）并存",
        "按日/周/月看趋势与达成率，异常点单独标出",
        "数据可导出，换成别的工具也不锁死",
      ]}
    />
  );
}
