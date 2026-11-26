import { useCallback, useEffect, useMemo, useState } from "react";
import { HOUR, MINUTE, startOfDay } from "@detter/shared";
import { useToast } from "@detter/ui";
import { useActiveGoals } from "@/db/hooks";
import { LoadingState } from "@/components/common/LoadingState";
import { AgendaView } from "./AgendaView";
import { CalendarToolbar } from "./CalendarToolbar";
import { DayView } from "./DayView";
import { EventDetailSheet } from "./EventDetailSheet";
import { MonthView } from "./MonthView";
import { WeekView } from "./WeekView";
import {
  AGENDA_DAYS,
  DEFAULT_DURATION_MINUTES,
  DESKTOP_VIEW_MODES,
  MOBILE_VIEW_MODES,
  SNAP_MINUTES,
  shiftAnchor,
  snapToStep,
  viewRange,
  type CalendarViewMode,
} from "./calendarMath";
import { useCalendarData } from "./useCalendarData";
import { useIsMobile } from "./useIsMobile";
import { useNow } from "./useNow";
import {
  applyEventDelete,
  applyEventEdit,
  createEvent,
  draftFromItem,
  toggleEventDone,
} from "./calendarMutations";
import type { CalendarItem, EventDraft, EventSeed, RecurrenceScope } from "./calendarTypes";

/**
 * 日历页面的主组件（页面只做薄壳装配，逻辑都在这里）。
 *
 * 职责：
 * - 视图模式与锚点日期（锚点 = 当前聚焦的那一天）；
 * - 区间查询 + 重复展开（交给 useCalendarData，结果按 [tasks, from, to] 缓存）；
 * - 键盘导航 ← / → / T；
 * - 新建 / 编辑 / 删除 / 拖拽改期的写库编排（全部走 repo）。
 *
 * 移动端默认议程视图（任务书 §3.4）：375 宽的周视图每列只有 96px，
 * 列表比网格更能回答「今天还有什么」。
 */

interface SheetState {
  mode: "create" | "edit";
  item: CalendarItem | null;
  seed: EventSeed | null;
  sessionKey: string;
}

export function CalendarView() {
  const isMobile = useIsMobile();
  const now = useNow();
  const { toast } = useToast();
  const goals = useActiveGoals();

  const [mode, setMode] = useState<CalendarViewMode>(isMobile ? "agenda" : "week");
  const [anchor, setAnchor] = useState(() => startOfDay(Date.now()));
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [saving, setSaving] = useState(false);

  const range = useMemo(() => viewRange(mode, anchor), [mode, anchor]);
  const { items, tasks, loading } = useCalendarData(range.from, range.to);

  const goalColors = useMemo(
    () => new Map(goals.map((goal) => [goal.id, goal.color] as const)),
    [goals],
  );

  const modes = isMobile ? MOBILE_VIEW_MODES : DESKTOP_VIEW_MODES;

  /* 断点切换后当前模式可能不在可选项里（例如桌面缩到 375 的日视图） */
  useEffect(() => {
    if (!modes.includes(mode)) setMode(isMobile ? "agenda" : "week");
  }, [isMobile, mode, modes]);

  const findParent = useCallback(
    (item: CalendarItem) =>
      item.parentId ? (tasks.find((task) => task.id === item.parentId) ?? null) : null,
    [tasks],
  );

  const notifyError = useCallback(
    (error: unknown) => {
      toast({
        title: "没保存成功",
        description: error instanceof Error ? error.message : String(error),
        tone: "danger",
      });
    },
    [toast],
  );

  /* -------------------------------- 导航 -------------------------------- */

  const goPrev = useCallback(() => setAnchor((current) => shiftAnchor(mode, current, -1)), [mode]);
  const goNext = useCallback(() => setAnchor((current) => shiftAnchor(mode, current, 1)), [mode]);
  const goToday = useCallback(() => setAnchor(startOfDay(Date.now())), []);

  const handleSelectDay = useCallback(
    (dayStart: number) => {
      setAnchor(startOfDay(dayStart));
      // 桌面：下钻到日视图；移动端的视图切换里没有「日」，落到议程更顺（见报告·遗留问题）
      setMode(isMobile ? "agenda" : "day");
    },
    [isMobile],
  );

  /* 键盘：← / → 上一/下一周期，T 回到今天（任务书 §4） */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (sheet) return; // 弹层打开时不抢键盘
      const target = event.target as HTMLElement | null;
      if (target) {
        if (target.isContentEditable) return;
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
        // 焦点在视图切换的 tablist 上时，方向键属于 tab 导航
        if (target.closest('[role="tablist"]')) return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setAnchor((current) => shiftAnchor(mode, current, -1));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setAnchor((current) => shiftAnchor(mode, current, 1));
      } else if (event.key.toLowerCase() === "t") {
        event.preventDefault();
        setAnchor(startOfDay(Date.now()));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, sheet]);

  /* -------------------------------- 新建 -------------------------------- */

  const openCreate = useCallback((startAt: number) => {
    setSheet({
      mode: "create",
      item: null,
      seed: {
        startAt,
        endAt: startAt + DEFAULT_DURATION_MINUTES * MINUTE,
      },
      sessionKey: `create-${startAt}`,
    });
  }, []);

  /** 工具条「新建」：今天就用下一个刻度，否则落在锚点日的 09:00 */
  const handleCreate = useCallback(() => {
    const dayStart = startOfDay(anchor);
    const isToday = dayStart === startOfDay(Date.now());
    const raw = isToday ? Date.now() : dayStart + 9 * HOUR;
    openCreate(snapToStep(raw, SNAP_MINUTES));
  }, [anchor, openCreate]);

  const openEdit = useCallback((item: CalendarItem) => {
    setSheet({ mode: "edit", item, seed: null, sessionKey: item.key });
  }, []);

  /* -------------------------------- 写库 -------------------------------- */

  const handleSave = useCallback(
    async (draft: EventDraft, scope: RecurrenceScope) => {
      if (!sheet) return;
      setSaving(true);
      try {
        if (sheet.mode === "create" || !sheet.item) {
          await createEvent(draft);
          toast({ title: "已加入日程", description: draft.title, tone: "success" });
        } else {
          await applyEventEdit({
            item: sheet.item,
            draft,
            scope,
            parent: findParent(sheet.item),
          });
          toast({
            title: scope === "this" && sheet.item.recurring ? "只改了这一次" : "已保存",
            description: draft.title,
            tone: "success",
          });
        }
        setSheet(null);
      } catch (error) {
        notifyError(error);
      } finally {
        setSaving(false);
      }
    },
    [sheet, findParent, toast, notifyError],
  );

  const handleDelete = useCallback(
    async (scope: RecurrenceScope) => {
      if (!sheet?.item) return;
      setSaving(true);
      try {
        await applyEventDelete({ item: sheet.item, scope, parent: findParent(sheet.item) });
        toast({
          title: scope === "this" && sheet.item.recurring ? "已跳过这一次" : "已删除",
          description: sheet.item.title,
          tone: "neutral",
        });
        setSheet(null);
      } catch (error) {
        notifyError(error);
      } finally {
        setSaving(false);
      }
    },
    [sheet, findParent, toast, notifyError],
  );

  /** 拖拽/拉长：一次性提交，重复实例自动写成「只改这一次」的覆盖记录 */
  const handleCommitDrag = useCallback(
    (item: CalendarItem, next: { startAt: number; endAt: number }) => {
      const draft = draftFromItem(item, {
        startAt: next.startAt,
        endAt: next.endAt,
        allDay: false,
      });
      void applyEventEdit({ item, draft, scope: "this", parent: findParent(item) }).catch(
        notifyError,
      );
    },
    [findParent, notifyError],
  );

  const handleToggleDone = useCallback(
    (item: CalendarItem, done: boolean) => {
      void toggleEventDone(item, done).catch(notifyError);
    },
    [notifyError],
  );

  /* -------------------------------- 渲染 -------------------------------- */

  if (loading) {
    return (
      <div className="space-y-4">
        <CalendarToolbar
          mode={mode}
          anchor={anchor}
          now={now}
          modes={modes}
          onModeChange={setMode}
          onPrev={goPrev}
          onNext={goNext}
          onToday={goToday}
          onCreate={handleCreate}
        />
        <LoadingState rows={3} />
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <CalendarToolbar
        mode={mode}
        anchor={anchor}
        now={now}
        modes={modes}
        onModeChange={setMode}
        onPrev={goPrev}
        onNext={goNext}
        onToday={goToday}
        onCreate={handleCreate}
      />

      {mode === "week" && (
        <WeekView
          anchor={anchor}
          items={items}
          now={now}
          goalColors={goalColors}
          onOpenItem={openEdit}
          onCreateAt={openCreate}
          onCommitDrag={handleCommitDrag}
          onSelectDay={handleSelectDay}
        />
      )}

      {mode === "day" && (
        <DayView
          anchor={anchor}
          items={items}
          now={now}
          goalColors={goalColors}
          onOpenItem={openEdit}
          onCreateAt={openCreate}
          onCommitDrag={handleCommitDrag}
        />
      )}

      {mode === "month" && (
        <MonthView
          anchor={anchor}
          items={items}
          now={now}
          onOpenItem={openEdit}
          onSelectDay={handleSelectDay}
        />
      )}

      {mode === "agenda" && (
        <AgendaView
          from={range.from}
          to={range.to}
          items={items}
          now={now}
          onOpenItem={openEdit}
          onCreate={handleCreate}
          onToggleDone={handleToggleDone}
        />
      )}

      <p className="mt-3 text-micro text-ink-300 md:hidden">
        议程覆盖未来 {AGENDA_DAYS} 天 · 左右滑动顶部的「周 / 月」看全局
      </p>

      <EventDetailSheet
        open={sheet !== null}
        onOpenChange={(open) => {
          if (!open) setSheet(null);
        }}
        mode={sheet?.mode ?? "create"}
        item={sheet?.item ?? null}
        seed={sheet?.seed ?? null}
        sessionKey={sheet?.sessionKey ?? "none"}
        saving={saving}
        onSave={handleSave}
        onDelete={handleDelete}
      />
    </div>
  );
}

export default CalendarView;
