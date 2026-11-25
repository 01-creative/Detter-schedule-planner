import { useState } from "react";
import { getISOWeek } from "date-fns";
import {
  ChevronDown,
  Clock,
  Hash,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Target,
} from "lucide-react";
import { Badge, Button, Sheet, Tabs, cn, useToast } from "@detter/ui";
import { QUADRANT_META, QUADRANT_ORDER, type Quadrant } from "@detter/shared";
import { useDaySummary, useQuadrantCounts } from "@/db/hooks";
import { formatDateLabel, greeting } from "@/lib/format";
import { useCaptureStore } from "@/stores/capture";
import { useUIStore } from "@/stores/ui";

/**
 * 四象限首页 —— 本阶段是**静态占位**。
 *
 * 这里刻意只做「骨架 + 视觉」：
 * - 计数接的是真实 Dexie 数据（所以能验证本地库链路是通的）；
 * - 卡片是示例卡，用虚线描边 + 「示例」标记，不会被误认为真数据；
 * - 拖拽、精确坐标、右键新建全部留给 T03，且都只改这一个文件。
 *
 * 移动端（<768）按设计规范改成「纵向分区 + 顶部吸顶分段控件 + 每个分区可折叠」。
 */

interface SampleCard {
  title: string;
  when: string;
  tag: string;
}

const SAMPLE_CARDS: Record<Quadrant, SampleCard[]> = {
  1: [
    { title: "交高数作业（第 12 周）", when: "今天 15:00", tag: "课程" },
    { title: "回复导师关于开题的邮件", when: "今天 18:00", tag: "学业" },
  ],
  2: [
    { title: "复习线性代数第 3 章", when: "明天 09:00", tag: "学习" },
    { title: "跑步 5 公里", when: "周四 19:30", tag: "健康" },
    { title: "写这周的复盘", when: "周日 20:00", tag: "复盘" },
  ],
  3: [
    { title: "取快递", when: "今天 17:00", tag: "生活" },
    { title: "帮室友带晚饭", when: "今天 19:00", tag: "生活" },
  ],
  4: [{ title: "刷一会儿短视频", when: "无排期", tag: "娱乐" }],
};

const QUADRANT_TAB_LABELS = ["Q1", "Q2", "Q3", "Q4"] as const;

export default function QuadrantPage() {
  const counts = useQuadrantCounts();
  const summary = useDaySummary();
  const openCapture = useCaptureStore((state) => state.openCapture);
  const goalRailCollapsed = useUIStore((state) => state.goalRailCollapsed);
  const toggleGoalRailCollapsed = useUIStore((state) => state.toggleGoalRailCollapsed);
  const goalRailDrawerOpen = useUIStore((state) => state.goalRailDrawerOpen);
  const setGoalRailDrawerOpen = useUIStore((state) => state.setGoalRailDrawerOpen);

  const now = Date.now();

  const scrollToQuadrant = (quadrant: Quadrant) => {
    document.getElementById(`quadrant-${quadrant}`)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
      <div className="min-w-0 flex-1">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-caption text-ink-500">
              {formatDateLabel(now)} · 第 {getISOWeek(now)} 周
            </p>
            <h1 className="mt-1 text-h1 text-ink-900 lg:text-display">
              {greeting(now)}，今天先做最重要的一件事
            </h1>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-500">
              <span>
                待办 <span className="numeric font-strong text-ink-900">{summary.openTasks}</span>
              </span>
              <span aria-hidden="true" className="text-ink-300">
                ·
              </span>
              <span>
                收件箱待整理{" "}
                <span className="numeric font-strong text-ink-900">{summary.pendingInbox}</span>
              </span>
              <span aria-hidden="true" className="text-ink-300">
                ·
              </span>
              <span>
                今日完成{" "}
                <span className="numeric font-strong text-success-ink">{summary.doneToday}</span>
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent">静态占位 · T03 接管</Badge>
            <Button
              size="sm"
              variant="secondary"
              className="lg:hidden"
              onClick={() => setGoalRailDrawerOpen(true)}
              leftIcon={<Target className="size-3.5" aria-hidden="true" />}
            >
              目标
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="hidden lg:inline-flex"
              onClick={toggleGoalRailCollapsed}
              aria-label={goalRailCollapsed ? "展开目标栏" : "收起目标栏"}
              aria-pressed={!goalRailCollapsed}
              leftIcon={
                goalRailCollapsed ? (
                  <PanelRightOpen className="size-3.5" aria-hidden="true" />
                ) : (
                  <PanelRightClose className="size-3.5" aria-hidden="true" />
                )
              }
            >
              目标栏
            </Button>
            <Button
              size="sm"
              onClick={() => openCapture()}
              leftIcon={<Plus className="size-3.5" aria-hidden="true" />}
            >
              记一条
            </Button>
          </div>
        </header>

        {/* 移动端：吸顶快速跳转（Q1–Q4），配合下面的纵向分区 */}
        <nav
          aria-label="象限快速跳转"
          className="sticky top-[52px] z-20 -mx-4 mt-3 border-b border-border bg-bg/95 px-4 py-2 backdrop-blur md:hidden"
        >
          <div className="flex gap-1.5" role="group" aria-label="跳转到象限">
            {QUADRANT_ORDER.map((quadrant) => (
              <button
                key={quadrant}
                type="button"
                onClick={() => scrollToQuadrant(quadrant)}
                className="flex h-8 flex-1 items-center justify-center gap-1 rounded-full border border-border bg-surface-solid text-caption text-ink-700"
              >
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full"
                  style={{ backgroundColor: `var(--q${quadrant}-accent)` }}
                />
                {QUADRANT_TAB_LABELS[quadrant - 1]}
                <span className="numeric text-micro text-ink-300">{counts[quadrant]}</span>
              </button>
            ))}
          </div>
        </nav>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4 lg:h-[calc(100dvh-13.5rem)] lg:min-h-[460px] lg:grid-rows-2">
          {QUADRANT_ORDER.map((quadrant) => (
            <QuadrantCell
              key={quadrant}
              quadrant={quadrant}
              count={counts[quadrant]}
              onCapture={() => openCapture(`!${quadrant} `)}
            />
          ))}
        </div>
      </div>

      {!goalRailCollapsed && (
        <aside aria-label="目标栏" className="hidden w-80 shrink-0 lg:block">
          <div className="sticky top-[76px] flex h-[calc(100dvh-6rem)] flex-col rounded-xl border border-border bg-surface p-4 shadow-1">
            <GoalRail onCollapse={toggleGoalRailCollapsed} />
          </div>
        </aside>
      )}

      {/* 平板与移动端：目标栏退化成右侧抽屉 */}
      <Sheet
        open={goalRailDrawerOpen}
        onOpenChange={setGoalRailDrawerOpen}
        title="目标"
        side="right"
        description="目标栏由 T04 接管"
      >
        <div className="flex h-full flex-col">
          <GoalRail />
        </div>
      </Sheet>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                 象限格                                      */
/* -------------------------------------------------------------------------- */

function QuadrantCell({
  quadrant,
  count,
  onCapture,
}: {
  quadrant: Quadrant;
  count: number;
  onCapture: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const meta = QUADRANT_META[quadrant];
  const cards = SAMPLE_CARDS[quadrant];

  return (
    <section
      id={`quadrant-${quadrant}`}
      data-q={quadrant}
      aria-labelledby={`quadrant-${quadrant}-title`}
      className={cn(
        "quadrant-cell cell-inner-ring flex min-h-0 scroll-mt-[120px] flex-col rounded-xl shadow-1",
        "border border-white/50 dark:border-white/5",
      )}
    >
      <header className="flex items-start gap-2 px-4 pt-3.5 pb-2">
        <span
          aria-hidden="true"
          className="mt-[7px] size-2 shrink-0 rounded-full"
          style={{ backgroundColor: `var(--q${quadrant}-accent)` }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2
              id={`quadrant-${quadrant}-title`}
              className="text-[15px] leading-[22px] font-strong text-ink-900"
            >
              {meta.name}
            </h2>
            <span className="numeric rounded-full bg-surface-solid/70 px-1.5 text-micro text-ink-500">
              {count}
            </span>
          </div>
          <p className="mt-0.5 text-micro text-ink-500/80">{meta.hint}</p>
        </div>
        <button
          type="button"
          onClick={onCapture}
          aria-label={`在「${meta.name}」快速记录`}
          className="relative inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink-500 transition-colors duration-[var(--dur-1)] after:absolute after:-inset-2 after:content-[''] hover:bg-surface-solid/70 hover:text-ink-900"
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-label={expanded ? `收起「${meta.name}」` : `展开「${meta.name}」`}
          className="relative inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink-500 after:absolute after:-inset-2 after:content-[''] hover:bg-surface-solid/70 hover:text-ink-900 md:hidden"
        >
          <ChevronDown
            className={cn(
              "size-4 transition-transform duration-[var(--dur-2)]",
              !expanded && "-rotate-90",
            )}
            aria-hidden="true"
          />
        </button>
      </header>

      {expanded && (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 lg:pr-2">
          <ul className="space-y-2">
            {cards.map((card) => (
              <li key={card.title}>
                <article className="rounded-lg border border-dashed border-border-strong bg-surface-solid/70 p-2.5 opacity-80">
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 text-body font-strong text-ink-700">{card.title}</p>
                    <span className="shrink-0 rounded-full bg-surface-sunken px-1.5 text-micro text-ink-300">
                      示例
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-ink-500">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="size-3" aria-hidden="true" />
                      {card.when}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Hash className="size-3" aria-hidden="true" />
                      {card.tag}
                    </span>
                  </div>
                </article>
              </li>
            ))}
          </ul>
          <p className="mt-2 px-1 text-micro text-ink-500/60">{meta.action} · 真实任务由 T03 接入</p>
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*                                 目标栏                                      */
/* -------------------------------------------------------------------------- */

type GoalTab = "once" | "recurring" | "template";

interface GoalSample {
  title: string;
  meta: string;
  color?: string;
}

const GOAL_SAMPLES: Record<GoalTab, GoalSample[]> = {
  once: [
    { title: "9 月前拿到驾照", meta: "一次性 · 还剩 3 个里程碑", color: "#6355F6" },
    { title: "把毕设开题写完", meta: "一次性 · 截止 12-15", color: "#0EA5E9" },
  ],
  recurring: [
    { title: "每周三次健身", meta: "周期 · 本周 2/3", color: "#10B981" },
    { title: "每周读一本书", meta: "周期 · 进行中", color: "#F59E0B" },
  ],
  template: [{ title: "周复盘模板", meta: "模板 · 已用 8 次" }, { title: "旅行清单", meta: "模板 · 已用 2 次" }],
};

function GoalRail({ onCollapse }: { onCollapse?: () => void }) {
  const [tab, setTab] = useState<GoalTab>("once");
  const { toast } = useToast();
  const items = GOAL_SAMPLES[tab];

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-h2 text-ink-900">目标</h2>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="收起目标栏"
            className="inline-flex size-8 items-center justify-center rounded-md text-ink-300 hover:bg-surface-sunken hover:text-ink-700"
          >
            <PanelRightClose className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <Tabs
        className="mt-2"
        ariaLabel="目标分类"
        value={tab}
        onValueChange={(value) => setTab(value as GoalTab)}
        items={[
          { value: "once", label: "一次性" },
          { value: "recurring", label: "周期" },
          { value: "template", label: "模板" },
        ]}
      />

      <ul className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
        {items.map((item) => (
          <li
            key={item.title}
            className="rounded-lg border border-dashed border-border-strong bg-surface-solid/60 p-2.5"
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: item.color ?? "var(--ink-300)" }}
              />
              <p className="min-w-0 flex-1 truncate text-body text-ink-700">{item.title}</p>
              <span className="shrink-0 rounded-full bg-surface-sunken px-1.5 text-micro text-ink-300">
                示例
              </span>
            </div>
            <p className="mt-1 pl-4 text-micro text-ink-300">{item.meta}</p>
          </li>
        ))}
      </ul>

      <div className="mt-3 space-y-2 border-t border-border pt-3">
        <Button
          variant="secondary"
          size="sm"
          className="w-full"
          leftIcon={<Plus className="size-3.5" aria-hidden="true" />}
          onClick={() =>
            toast({
              title: "目标创建将在 T04 接入",
              description: "目标的数据模型与目标栏容器已经就位",
            })
          }
        >
          新建目标
        </Button>
        <p className="text-micro text-ink-300">目标栏由 T04 接管：拖到象限即建任务。</p>
      </div>
    </>
  );
}
