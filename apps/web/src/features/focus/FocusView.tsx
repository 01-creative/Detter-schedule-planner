import { useCallback, useEffect, useMemo, useState } from "react";
import { Pause, Play, Settings2, SkipForward, Square, Target } from "lucide-react";
import type { Task } from "@detter/shared";
import { Badge, Button, Card, useToast } from "@detter/ui";
import { LoadingState } from "@/components/common/LoadingState";
import { PageHeading } from "@/components/common/PageHeading";
import { useTasks } from "@/db/hooks";
import { formatWhen } from "@/lib/format";
import { FocusMiniBar } from "./FocusMiniBar";
import { FocusRing } from "./FocusRing";
import { PomodoroSettingsDialog } from "./PomodoroSettingsDialog";
import { TaskPickerDialog } from "./TaskPickerDialog";
import { notify, playChime, primeAudio, requestNotificationPermission } from "./focusAudio";
import { formatClock, phaseLabel } from "./pomodoroModel";
import type { SessionDraft } from "./pomodoroModel";
import { computeFocusStats, sessionsOfDay, sessionSpan } from "./pomodoroStats";
import { usePomodoro } from "./usePomodoro";
import { useFocusSettings } from "./useFocusSettings";
import { useNow, usePomodoroSessions } from "./usePomodoroSessions";

/**
 * 专注页主体。
 *
 * 计时真相在 `usePomodoro`（endsAt + localStorage），这里只做装配与反馈：
 * 大圆环、开始/暂停/跳过、当前任务、今日统计、今天最近记录。
 *
 * 三处「不在页面里也要看得见」的提示：
 * - 页面内 sticky 迷你计时条（FocusMiniBar）；
 * - `document.title`（切到别的标签页也能看到剩余）；
 * - 结束时 WebAudio 三声 + 系统通知（已授权时）。
 */
const BASE_TITLE = "Detter · 先做最重要的事";

export function FocusView() {
  const { data: tasks, loading: tasksLoading } = useTasks();
  const { data: sessions, loading: sessionsLoading } = usePomodoroSessions();
  const [settings, saveSettings] = useFocusSettings();
  const { toast } = useToast();
  const now = useNow(30_000);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const taskById = useMemo(() => {
    const map = new Map<string, Task>();
    for (const task of tasks) map.set(task.id, task);
    return map;
  }, [tasks]);

  const handleCompleted = useCallback(
    (draft: SessionDraft) => {
      playChime(3);
      if (draft.kind === "focus") {
        notify("专注完成", `${draft.actualMin} 分钟已记入 KPI`);
        toast({
          title: `完成一个 ${draft.actualMin} 分钟的番茄`,
          description: "专注时长已自动汇入 KPI，不用再手填",
          tone: "success",
        });
      } else {
        notify("休息结束", "准备好下一轮了吗？");
        toast({ title: "休息结束", description: "回到下一件重要的事", tone: "info" });
      }
    },
    [toast],
  );

  const handleInterrupted = useCallback(
    (draft: SessionDraft) => {
      toast({
        title: "这一轮中断了",
        description: `实际专注 ${draft.actualMin} 分钟，记为未完成`,
        tone: "neutral",
      });
    },
    [toast],
  );

  const handleCountdown = useCallback(() => {
    playChime(1, 660);
  }, []);

  const handlePersistError = useCallback(() => {
    toast({
      title: "记录没写进本地库",
      description: "可能是浏览器存储被占满，稍后再试一次",
      tone: "danger",
    });
  }, [toast]);

  const pomodoro = usePomodoro({
    settings,
    onCompleted: handleCompleted,
    onInterrupted: handleInterrupted,
    onCountdown: handleCountdown,
    onPersistError: handlePersistError,
  });

  const clock = formatClock(pomodoro.remainingMs);
  const activeTask = pomodoro.state.taskId ? (taskById.get(pomodoro.state.taskId) ?? null) : null;
  const stats = useMemo(() => computeFocusStats(sessions, now), [sessions, now]);
  const todaySessions = useMemo(() => sessionsOfDay(sessions, now), [sessions, now]);
  const loading = tasksLoading || sessionsLoading;

  /* 标题栏倒计时：切到别的标签页也能看到还剩多久 */
  useEffect(() => {
    if (pomodoro.isIdle) {
      document.title = "专注 · Detter";
      return;
    }
    const state = pomodoro.isPaused ? "已暂停" : `正在${phaseLabel(pomodoro.state.kind)}`;
    document.title = `${clock} · ${state} · Detter`;
  }, [clock, pomodoro.isIdle, pomodoro.isPaused, pomodoro.state.kind]);

  useEffect(() => {
    return () => {
      document.title = BASE_TITLE;
    };
  }, []);

  /* 空格开始/暂停：焦点在输入框或弹层里时不抢键盘 */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") return;
      if (target?.isContentEditable) return;
      if (document.querySelector('[role="dialog"]')) return;

      event.preventDefault();
      if (pomodoro.isRunning) {
        pomodoro.pause();
      } else if (pomodoro.isPaused) {
        pomodoro.resume();
      } else {
        primeAudio();
        void requestNotificationPermission();
        pomodoro.start();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pomodoro.isRunning, pomodoro.isPaused, pomodoro.pause, pomodoro.resume, pomodoro.start]);

  const handlePrimary = () => {
    if (pomodoro.isRunning) {
      pomodoro.pause();
      return;
    }
    if (pomodoro.isPaused) {
      pomodoro.resume();
      return;
    }
    primeAudio();
    void requestNotificationPermission();
    pomodoro.start();
  };

  const handleStop = () => {
    const focused = pomodoro.focusedMs;
    pomodoro.stop();
    if (focused < 60_000) {
      toast({ title: "已停止", description: "不足 1 分钟，没有写入记录", tone: "neutral" });
    }
  };

  const primaryLabel = pomodoro.isRunning
    ? "暂停"
    : pomodoro.isPaused
      ? "继续"
      : pomodoro.state.kind === "focus"
        ? "开始专注"
        : `开始${phaseLabel(pomodoro.state.kind)}`;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <FocusMiniBar
        status={pomodoro.state.status}
        kind={pomodoro.state.kind}
        clock={clock}
        taskTitle={activeTask?.title ?? null}
      />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <PageHeading
          eyebrow="25 分钟只做一件事"
          title="专注"
          description="这一轮只认一个数：目标结束时间。刷新、切后台、锁屏回来，剩余时间都按真实时钟校正。"
        />
        <Button
          size="icon"
          variant="ghost"
          // 窄屏换行后按钮要留在右边（旧版会掉到标题下方最左侧）
          className="ml-auto"
          aria-label="番茄钟设置"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2 className="size-4" aria-hidden="true" />
        </Button>
      </header>

      {loading ? (
        <LoadingState rows={3} className="mt-6" />
      ) : (
        <>
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <Card padding="lg" className="flex flex-col items-center gap-5">
              <FocusRing
                ratio={pomodoro.ratio}
                status={pomodoro.state.status}
                kind={pomodoro.state.kind}
                clock={clock}
                remainingMs={pomodoro.remainingMs}
                taskTitle={activeTask?.title ?? null}
                round={pomodoro.state.round}
                roundTotal={settings.longBreakEvery}
              />

              <div className="flex w-full flex-col items-center gap-2 sm:flex-row sm:justify-center">
                <Button
                  size="lg"
                  variant="primary"
                  className="h-14 w-full min-w-[148px] px-8 sm:h-11 sm:w-auto"
                  onClick={handlePrimary}
                  data-focus-primary=""
                  leftIcon={
                    pomodoro.isRunning ? (
                      <Pause className="size-4" aria-hidden="true" />
                    ) : (
                      <Play className="size-4" aria-hidden="true" />
                    )
                  }
                >
                  {primaryLabel}
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                    size="lg"
                    variant="ghost"
                    className="h-12 sm:h-11"
                    onClick={pomodoro.skip}
                    leftIcon={<SkipForward className="size-4" aria-hidden="true" />}
                  >
                    跳过
                  </Button>
                  {(pomodoro.isRunning || pomodoro.isPaused) && (
                    <Button
                      size="lg"
                      variant="ghost"
                      className="h-12 sm:h-11"
                      onClick={handleStop}
                      leftIcon={<Square className="size-3.5" aria-hidden="true" />}
                    >
                      停止
                    </Button>
                  )}
                </div>
              </div>

              <p className="hidden text-micro text-ink-300 sm:block">
                空格键 开始 / 暂停 · 结束前 10 秒会轻响一声
              </p>
              <p className="text-micro text-ink-300 sm:hidden">
                结束前 10 秒会轻响一声，结束时自动记账
              </p>
            </Card>

            <div className="flex flex-col gap-4">
              <Card>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-h2 text-ink-900">当前任务</h2>
                  <Button size="sm" variant="ghost" onClick={() => setPickerOpen(true)}>
                    换
                  </Button>
                </div>
                {activeTask ? (
                  <>
                    <p className="mt-2 text-body font-strong text-ink-900">{activeTask.title}</p>
                    <p className="mt-0.5 text-caption text-ink-500">{formatWhen(activeTask, now)}</p>
                  </>
                ) : (
                  <>
                    <p className="mt-2 text-caption text-ink-500">
                      没绑定任务也能计时，只是这段时间以后不好归因。
                    </p>
                    <Button
                      size="sm"
                      className="mt-3"
                      onClick={() => setPickerOpen(true)}
                      leftIcon={<Target className="size-3.5" aria-hidden="true" />}
                    >
                      选个任务
                    </Button>
                  </>
                )}
              </Card>

              <Card>
                <h2 className="text-h2 text-ink-900">今日统计</h2>
                <dl className="mt-3 grid grid-cols-3 gap-2">
                  <div>
                    <dt className="text-micro text-ink-500">专注</dt>
                    <dd className="tabular mt-0.5 text-h2 text-ink-900">
                      {stats.completed}
                      <span className="ml-0.5 text-micro font-normal text-ink-500">个</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-micro text-ink-500">时长</dt>
                    <dd className="tabular mt-0.5 text-h2 text-ink-900">
                      {stats.minutes}
                      <span className="ml-0.5 text-micro font-normal text-ink-500">分钟</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-micro text-ink-500">打断</dt>
                    <dd className="tabular mt-0.5 text-h2 text-ink-900">
                      {stats.interruptions}
                      <span className="ml-0.5 text-micro font-normal text-ink-500">次</span>
                    </dd>
                  </div>
                </dl>
                <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                  <span className="text-caption text-ink-500">连续专注</span>
                  <span className="tabular text-body-strong text-ink-900">{stats.streak} 天</span>
                </div>
              </Card>
            </div>
          </div>

          <section className="mt-6" aria-labelledby="focus-recent">
            <div className="flex items-end justify-between gap-2">
              <h2 id="focus-recent" className="text-h2 text-ink-900">
                最近记录
              </h2>
              <span className="text-caption text-ink-500">
                今天 · <span className="tabular">{todaySessions.length}</span> 条
              </span>
            </div>

            {todaySessions.length === 0 ? (
              <div className="mt-2 rounded-lg border border-dashed border-border-strong px-4 py-8 text-center">
                <p className="text-body font-strong text-ink-900">今天还没有记录</p>
                <p className="mt-1 text-caption text-ink-500">
                  点「开始专注」，第一颗番茄结束后会自动出现在这里，并汇入 KPI。
                </p>
              </div>
            ) : (
              <ul className="mt-2 space-y-2">
                {todaySessions.map((session) => {
                  const label =
                    session.kind === "focus"
                      ? (session.taskId ? (taskById.get(session.taskId)?.title ?? null) : null) ??
                        "未绑定任务"
                      : phaseLabel(session.kind);
                  return (
                    <li
                      key={session.id}
                      className="flex items-center gap-3 rounded-lg border border-border bg-surface-solid px-3 py-2.5 shadow-1"
                    >
                      <span className="tabular w-[104px] shrink-0 text-caption text-ink-500">
                        {sessionSpan(session)}
                      </span>
                      <span
                        aria-hidden="true"
                        className="size-1.5 shrink-0 rounded-full"
                        style={{
                          backgroundColor:
                            session.kind === "focus" ? "var(--accent)" : "var(--success)",
                        }}
                      />
                      <span className="min-w-0 flex-1 truncate text-body text-ink-900">{label}</span>
                      {session.interruptions > 0 && (
                        <span className="text-micro text-ink-300">暂停 {session.interruptions}</span>
                      )}
                      <Badge tone={session.completed ? "neutral" : "warning"}>
                        {session.completed ? phaseLabel(session.kind) : "中断"}
                      </Badge>
                      <span className="tabular w-14 shrink-0 text-right text-caption text-ink-500">
                        {session.actualMin} 分钟
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}

      <PomodoroSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        value={settings}
        running={pomodoro.isRunning || pomodoro.isPaused}
        onSave={saveSettings}
      />

      <TaskPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        tasks={tasks}
        currentTaskId={pomodoro.state.taskId}
        loading={tasksLoading}
        onSelect={pomodoro.setTaskId}
      />
    </div>
  );
}
