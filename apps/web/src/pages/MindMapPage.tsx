import { Network } from "lucide-react";
import { PagePlaceholder } from "@/components/common/PagePlaceholder";

export default function MindMapPage() {
  return (
    <PagePlaceholder
      module="思维导图"
      title="把一个大目标拆成能动手的节点"
      description="目标拆解树，节点可以直接变成任务，也可以反向挂回目标。"
      icon={<Network className="size-5" aria-hidden="true" />}
      bullets={[
        "拖拽布局，画布缩放与平移会随导图保存",
        "节点可标记为想法 / 目标 / 任务 / KR / 笔记",
        "「转成任务」保留父子关系，不丢上下文",
        "键盘可完成新建、折叠、删除，不必依赖鼠标",
      ]}
    />
  );
}
