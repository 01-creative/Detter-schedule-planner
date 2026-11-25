import { Clock, Hash, Inbox, MapPin, Plus } from "lucide-react";
import { Badge, Button, Chip } from "@detter/ui";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingState } from "@/components/common/LoadingState";
import { useInboxItems } from "@/db/hooks";
import { formatRelative, formatWhen } from "@/lib/format";
import { useCaptureStore } from "@/stores/capture";

/**
 * 收件箱：快速捕获的落地页。
 *
 * 这里读的是真实 Dexie 数据 —— 断网时捕获一条，刷新后仍然在，靠的就是这条链路。
 * 分诊（转任务、批量清理、AI 整理）由 T05 接管，本页只负责「看得见、删得掉」。
 */
export default function InboxPage() {
  const { data: items, loading } = useInboxItems();
  const openCapture = useCaptureStore((state) => state.openCapture);
  const pendingCount = items.filter((item) => item.status === "pending").length;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-caption text-ink-500">先收进来，之后再决定</p>
          <h1 className="mt-1 flex items-baseline gap-2 text-h1 text-ink-900">
            收件箱
            {pendingCount > 0 && (
              <span className="numeric rounded-full bg-accent-soft px-2 py-0.5 text-caption text-accent">
                {pendingCount} 待整理
              </span>
            )}
          </h1>
          <p className="mt-1 text-body text-ink-500">
            所有来不及整理的想法都在这里，离线写下的一条也不会丢。
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => openCapture()}
          leftIcon={<Plus className="size-3.5" aria-hidden="true" />}
        >
          记一条
        </Button>
      </header>

      <div className="mt-5">
        {loading ? (
          <LoadingState rows={3} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Inbox className="size-5" aria-hidden="true" />}
            title="收件箱是空的"
            description="按 Ctrl / Cmd + K，或者点右下角的「+」，把脑子里那件事先放进来。"
            action={
              <Button
                size="sm"
                onClick={() => openCapture()}
                leftIcon={<Plus className="size-3.5" aria-hidden="true" />}
              >
                现在记一条
              </Button>
            }
          />
        ) : (
          <ul className="space-y-2.5">
            {items.map((item) => {
              const parsed = item.parsed;
              const title = parsed?.title?.trim() || item.rawText;

              return (
                <li
                  key={item.id}
                  className="rounded-lg border border-border bg-surface-solid p-3.5 shadow-1 transition-[box-shadow,border-color] duration-[var(--dur-2)] hover:border-border-strong hover:shadow-2"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                      <Inbox className="size-3.5" aria-hidden="true" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="text-body font-strong break-words text-ink-900">{title}</p>
                      {parsed?.title && parsed.title !== item.rawText && (
                        <p className="mt-0.5 truncate text-micro text-ink-300">原文：{item.rawText}</p>
                      )}

                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {parsed?.startAt && (
                          <Chip icon={<Clock className="size-3" aria-hidden="true" />}>
                            {formatWhen({
                              startAt: parsed.startAt,
                              endAt: parsed.endAt,
                              allDay: parsed.allDay,
                            })}
                          </Chip>
                        )}
                        {parsed?.location && (
                          <Chip icon={<MapPin className="size-3" aria-hidden="true" />}>
                            在{parsed.location}
                          </Chip>
                        )}
                        {parsed?.tags.map((tag) => (
                          <Chip key={tag} tone="accent" icon={<Hash className="size-3" aria-hidden="true" />}>
                            #{tag}
                          </Chip>
                        ))}
                        {parsed?.goalTitle && <Chip>@{parsed.goalTitle}</Chip>}
                        {parsed?.quadrantGuess && (
                          <Chip tone="muted">建议 Q{parsed.quadrantGuess}</Chip>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-micro text-ink-300">
                        {formatRelative(item.capturedAt)}
                      </span>
                      <Badge tone={item.status === "pending" ? "warning" : "success"}>
                        {item.status === "pending" ? "待整理" : item.status === "triaged" ? "已分诊" : "已归档"}
                      </Badge>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {!loading && items.length > 0 && (
        <p className="mt-4 text-micro text-ink-300">
          分诊成任务、批量清理与 AI 整理由 T05 接入；现在可以先靠它记录。
        </p>
      )}
    </div>
  );
}
