import { useMemo } from "react";
import { parseQuickCapture, type Goal } from "@detter/shared";
import { Button } from "@detter/ui";
import { formatWhen } from "@/lib/format";

/**
 * 多行粘贴预览。
 *
 * 剪贴板里常常是一整段清单，直接塞进输入框会被当成「一条」，然后用户要手动拆。
 * 这里先拆成 N 条、逐条显示解析结果，确认后再批量落库 —— 批量写是不可逆的
 * （尤其是粘贴进来 30 行的时候），所以必须先看一眼再按确定。
 */

export interface BatchPreviewProps {
  lines: string[];
  goals: Goal[];
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function BatchPreview({ lines, goals, busy, onConfirm, onCancel }: BatchPreviewProps) {
  const rows = useMemo(
    () =>
      lines.map((line) => ({
        line,
        parsed: parseQuickCapture(line, {
          goals: goals.map((goal) => ({ id: goal.id, title: goal.title })),
        }),
      })),
    [lines, goals],
  );

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-caption text-ink-700">
          粘贴了 <span className="numeric font-strong text-ink-900">{lines.length}</span> 行，将拆成{" "}
          <span className="numeric font-strong text-ink-900">{lines.length}</span> 条记录
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
            取消
          </Button>
          <Button size="sm" onClick={onConfirm} loading={busy}>
            全部保存
          </Button>
        </div>
      </div>

      <ul className="mt-2 max-h-[38vh] space-y-1 overflow-y-auto pr-1">
        {rows.map((row, index) => {
          const summary = [
            row.parsed.startAt
              ? formatWhen({
                  startAt: row.parsed.startAt,
                  endAt: row.parsed.endAt,
                  allDay: row.parsed.allDay,
                })
              : null,
            row.parsed.tags.map((tag) => `#${tag}`).join(" "),
          ]
            .filter(Boolean)
            .join(" · ");

          return (
            <li
              key={`${index}-${row.line}`}
              className="flex items-baseline gap-2 rounded-md bg-surface-sunken/50 px-2.5 py-1.5"
            >
              <span className="numeric w-5 shrink-0 text-micro text-ink-300">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate text-caption text-ink-900">{row.line}</span>
              {summary && <span className="shrink-0 text-micro text-ink-500">{summary}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
