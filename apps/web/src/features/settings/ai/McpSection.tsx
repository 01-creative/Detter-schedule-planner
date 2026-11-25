import { useEffect, useMemo, useState } from "react";
import { Bot, Check, Copy, ShieldCheck } from "lucide-react";
import { Badge, Button, Card, useToast } from "@detter/ui";
import { MCP_KEY_PLACEHOLDER, buildMcpConfig, mcpEndpointUrl } from "./api";
import { copyText } from "./clipboard";

/**
 * MCP 配置片段。
 *
 * 这一段是「外部 agent 能自己把事办了」的入口，所以要把三件事说清楚：
 * 配置贴到哪个文件、密钥放在哪、为什么网页会话不能当密钥用。
 */
export function McpSection({ apiKey }: { apiKey: string | null }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const config = useMemo(() => buildMcpConfig(apiKey ?? MCP_KEY_PLACEHOLDER), [apiKey]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    const ok = await copyText(config);
    if (!ok) {
      toast({ title: "复制失败", description: "请手动选中文本复制。", tone: "danger" });
      return;
    }
    setCopied(true);
    toast({ title: "MCP 配置已复制", tone: "success" });
  };

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Bot className="size-4 text-accent" aria-hidden="true" />
        <h2 className="text-h2 text-ink-900">MCP 配置</h2>
        <Badge tone="accent">Claude Desktop / Cursor</Badge>
      </div>

      <p className="text-caption text-ink-500">
        把下面这段贴进 Claude Desktop 的{" "}
        <span className="font-mono text-ink-700">claude_desktop_config.json</span> 或 Cursor 的{" "}
        <span className="font-mono text-ink-700">.cursor/mcp.json</span>，重启客户端就能看到 19
        个工具（查任务、建任务、看 OKR / KPI、取上下文包）。
      </p>

      <pre className="max-h-64 overflow-auto rounded-md bg-surface-sunken p-3 font-mono text-micro leading-relaxed text-ink-700">
        {config}
      </pre>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => void handleCopy()}
          leftIcon={
            copied ? (
              <Check className="size-3.5" aria-hidden="true" />
            ) : (
              <Copy className="size-3.5" aria-hidden="true" />
            )
          }
        >
          {copied ? "已复制" : "复制配置"}
        </Button>
        {apiKey === null && (
          <p className="text-micro text-ink-300">创建密钥后这里会自动填入真实密钥（刷新页面后恢复占位符）。</p>
        )}
      </div>

      <dl className="grid gap-2 rounded-md bg-surface-sunken px-3 py-2 text-micro text-ink-500 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-ink-300">端点</dt>
          <dd className="truncate font-mono text-ink-700" title={mcpEndpointUrl()}>
            {mcpEndpointUrl()}
          </dd>
        </div>
        <div className="flex items-start gap-1.5">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />
          <div>
            <dt className="text-ink-300">鉴权</dt>
            <dd>只认 Authorization: Bearer，不接受浏览器 Cookie；写操作需要 write scope。</dd>
          </div>
        </div>
      </dl>
    </Card>
  );
}
