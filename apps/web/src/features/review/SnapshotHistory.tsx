import { useState } from "react";
import { Clock3, Copy, Download, FileJson, Trash2 } from "lucide-react";
import { formatDateTime } from "@detter/shared";
import { Button, Dialog } from "@detter/ui";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SectionCard } from "./ReviewSections";
import type { ReviewSnapshot } from "./snapshot";

/**
 * 历史快照。
 *
 * 复盘一旦生成就冻结：历史数据会变，只有快照能忠实地回答「当时我怎么看」。
 * 这里既能看到存档的 Markdown，也能重新复制 / 下载 / 删除。
 */
export interface SnapshotHistoryProps {
  snapshots: ReviewSnapshot[];
  loading: boolean;
  currentPeriodKey: string;
  onCopy: (markdown: string) => void;
  onDownloadMarkdown: (snapshot: ReviewSnapshot) => void;
  onDownloadJson: (snapshot: ReviewSnapshot) => void;
  onDelete: (snapshot: ReviewSnapshot) => void;
}

export function SnapshotHistory({
  snapshots,
  loading,
  currentPeriodKey,
  onCopy,
  onDownloadMarkdown,
  onDownloadJson,
  onDelete,
}: SnapshotHistoryProps) {
  const [viewing, setViewing] = useState<ReviewSnapshot | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ReviewSnapshot | null>(null);

  return (
    <SectionCard
      title="历史快照"
      icon={<Clock3 className="size-4" aria-hidden="true" />}
      aside={<span className="text-micro text-ink-300">{snapshots.length} 份</span>}
    >
      {loading ? (
        <p className="py-4 text-center text-caption text-ink-300">正在读取历史…</p>
      ) : snapshots.length === 0 ? (
        <p className="py-4 text-center text-caption text-ink-300">
          还没有保存过复盘。生成一次并点「保存快照」，以后就能回看当时的口径。
        </p>
      ) : (
        <ul className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {snapshots.slice(0, 9).map((snapshot) => {
            const isCurrent = snapshot.periodKey === currentPeriodKey;
            return (
              <li key={snapshot.periodKey}>
                <button
                  type="button"
                  onClick={() => setViewing(snapshot)}
                  className="w-full rounded-lg border border-border bg-surface-solid px-3 py-2 text-left transition-colors duration-[var(--dur-1)] hover:border-border-strong hover:bg-surface-sunken/50"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-caption font-strong text-ink-900">
                      {snapshot.range.label} · {snapshot.range.type === "week" ? "周" : "月"}
                    </span>
                    {isCurrent && (
                      <span className="shrink-0 rounded-full bg-accent-soft px-1.5 text-micro text-accent">
                        当前
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-micro text-ink-300">
                    {formatDateTime(snapshot.generatedAt)} · 完成 {snapshot.metrics.tasks.done} 项
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={viewing !== null}
        onOpenChange={(next) => {
          if (!next) setViewing(null);
        }}
        title={viewing ? `${viewing.range.label} 的复盘快照` : "复盘快照"}
        description={
          viewing ? `生成于 ${formatDateTime(viewing.generatedAt)} · 内容为当时口径，不随数据变化` : undefined
        }
        size="lg"
        footer={
          viewing ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                leftIcon={<Trash2 className="size-3.5" aria-hidden="true" />}
                onClick={() => setConfirmDelete(viewing)}
              >
                删除快照
              </Button>
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<FileJson className="size-3.5" aria-hidden="true" />}
                onClick={() => onDownloadJson(viewing)}
              >
                下载 .json
              </Button>
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<Download className="size-3.5" aria-hidden="true" />}
                onClick={() => onDownloadMarkdown(viewing)}
              >
                下载 .md
              </Button>
              <Button
                size="sm"
                leftIcon={<Copy className="size-3.5" aria-hidden="true" />}
                onClick={() => onCopy(viewing.markdown)}
              >
                复制 Markdown
              </Button>
            </>
          ) : null
        }
      >
        <pre className="max-h-[52dvh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-sunken p-3 font-mono text-[12px] leading-[20px] text-ink-700">
          {viewing?.markdown ?? ""}
        </pre>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(next) => {
          if (!next) setConfirmDelete(null);
        }}
        title="删除这份快照？"
        description="只删除存档，不影响任务与目标本身。"
        confirmLabel="删除"
        tone="danger"
        onConfirm={() => {
          if (confirmDelete) {
            onDelete(confirmDelete);
            setViewing(null);
          }
          setConfirmDelete(null);
        }}
      />
    </SectionCard>
  );
}

export default SnapshotHistory;
