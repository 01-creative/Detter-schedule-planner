import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Badge, Card } from "@detter/ui";
import type { ApiKeyCreated } from "@detter/shared";
import { ApiKeySection } from "./ApiKeySection";
import { McpSection } from "./McpSection";
import { AiExportSection } from "./AiExportSection";

/**
 * 设置页的 AI 接入区块（T12）。
 *
 * 明文状态只存在组件的内存里：创建后可以把真实密钥自动填进 MCP 配置片段，
 * 刷新页面即恢复占位符——与「明文只显示一次」的安全约束一致。
 */
export function AISettingsSection() {
  const [plaintext, setPlaintext] = useState<string | null>(null);

  return (
    <div className="space-y-4" id="ai-access">
      <Card className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="size-4 text-accent" aria-hidden="true" />
          <h2 className="text-h2 text-ink-900">AI 接入</h2>
          <Badge tone="accent">MCP + REST</Badge>
        </div>
        <p className="text-caption text-ink-500">
          给外部 AI 一把钥匙：Claude Desktop / Cursor 可以通过 MCP 直接查日程、建任务、做周回顾；
          脚本和快捷指令可以用 REST。
        </p>
        <p className="text-micro text-ink-300">
          AI 和你是同一套权限与审计：写操作要 write scope，全部记进 audit_log，随时可吊销。
        </p>
      </Card>

      <ApiKeySection onKeyCreated={(created: ApiKeyCreated) => setPlaintext(created.plaintext)} />
      <McpSection apiKey={plaintext} />
      <AiExportSection />
    </div>
  );
}
