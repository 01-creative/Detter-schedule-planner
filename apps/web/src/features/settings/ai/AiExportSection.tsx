import { useState } from "react";
import { CalendarPlus, Copy, Download, FileText } from "lucide-react";
import type { ContextRange } from "@detter/shared";
import { Badge, Button, Card, useToast } from "@detter/ui";
import { errorMessage, fetchContextPackMarkdown } from "./api";
import { copyText } from "./clipboard";

/**
 * 上下文包与导出。
 *
 * 两条「给 AI 用」的路径：
 * - 复制 Markdown：贴进任意 AI 聊天窗口，不需要密钥（最轻）；
 * - 下载文件：JSON 全量备份 / ICS 订阅日历。
 */

const RANGES: Array<{ value: ContextRange; label: string }> = [
  { value: "today", label: "今天" },
  { value: "week", label: "本周" },
  { value: "month", label: "本月" },
  { value: "quarter", label: "本季度" },
];

const DOWNLOADS = [
  { href: "/api/v1/export/json", label: "JSON 全量", icon: Download },
  { href: "/api/v1/export/markdown", label: "Markdown 周报", icon: FileText },
  { href: "/api/v1/export/ics", label: "ICS 日历", icon: CalendarPlus },
];

const LINK_CLASS =
  // 视觉 28 高保持不变；命中区靠伪元素补到 44 高。
  // 1px 描边让 ::after 的参照盒少了 2px，所以是上下各借 9px 而不是 8px。
  // 宽度本来就在 87px 以上，不必左右扩，也就不会和相邻链接抢点击。
  "relative inline-flex h-7 items-center gap-1.5 rounded-md border border-border-strong bg-surface-solid px-2.5 text-caption font-strong text-ink-900 transition-colors after:absolute after:-inset-y-[9px] after:inset-x-0 after:content-[''] hover:bg-surface-sunken/60";

export function AiExportSection() {
  const { toast } = useToast();
  const [busyRange, setBusyRange] = useState<ContextRange | null>(null);

  const handleCopyPack = async (range: ContextRange) => {
    setBusyRange(range);
    try {
      const markdown = await fetchContextPackMarkdown(range);
      const ok = await copyText(markdown);
      if (!ok) {
        toast({ title: "复制失败", description: "请改用「下载 Markdown 周报」。", tone: "danger" });
        return;
      }
      toast({ title: "上下文包已复制", description: "粘进任意 AI 对话框即可。", tone: "success" });
    } catch (error) {
      toast({ title: "生成失败", description: errorMessage(error), tone: "danger" });
    } finally {
      setBusyRange(null);
    }
  };

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Download className="size-4 text-accent" aria-hidden="true" />
        <h2 className="text-h2 text-ink-900">上下文包与导出</h2>
        <Badge tone="info">无需密钥</Badge>
      </div>

      <p className="text-caption text-ink-500">
        把一段时间内的任务、目标、OKR、KPI、番茄钟与收件箱压成一份 Markdown，
        直接粘给任意 AI，让它帮你分析或重排。
      </p>

      <div className="flex flex-wrap gap-2">
        {RANGES.map((range) => (
          <Button
            key={range.value}
            size="sm"
            variant="secondary"
            loading={busyRange === range.value}
            disabled={busyRange !== null && busyRange !== range.value}
            onClick={() => void handleCopyPack(range.value)}
            leftIcon={<Copy className="size-3.5" aria-hidden="true" />}
          >
            复制{range.label}上下文包
          </Button>
        ))}
      </div>

      <div className="border-t border-border pt-3">
        <p className="text-caption text-ink-700">下载</p>
        <div className="mt-2 flex flex-wrap gap-x-2 gap-y-4">
          {DOWNLOADS.map((item) => (
            <a key={item.href} href={item.href} download className={LINK_CLASS}>
              <item.icon className="size-3.5" aria-hidden="true" />
              {item.label}
            </a>
          ))}
        </div>
        <p className="mt-2 text-micro text-ink-300">
          JSON 是 <span className="font-mono">detter-export-v1</span> 信封（可直接喂给 AI 或备份）；
          ICS 可被系统日历 / Google Calendar 订阅。
        </p>
      </div>
    </Card>
  );
}
