import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CheckCheck, Inbox } from "lucide-react";
import { parseQuickCapture } from "@detter/shared";
import { Button, useToast } from "@detter/ui";
import { useActiveGoals } from "@/db/hooks";
import { saveCapture } from "./save-capture";

/**
 * PWA / 分享菜单落地页（`/share`）。
 *
 * 手机系统分享菜单会把 `?text=&title=&url=` 拼到 manifest 声明的 share_target 上。
 * 这个组件的唯一职责就是「落地即入库」：不弹确认、不问参数，收完立刻回首页。
 * 因为分享的动作发生在上一个 App 里，用户回到 Detter 时不该再看到第二个表单。
 *
 * 路由由总工接线，这里只保证：
 *   <Route path="/share" element={<ShareTarget />} />
 * 能正常工作。
 */

function buildRawText(params: URLSearchParams): string {
  const text = (params.get("text") ?? "").trim();
  const title = (params.get("title") ?? "").trim();
  const url = (params.get("url") ?? "").trim();

  const head = text || title;
  if (!head) return url;
  if (!url || head.includes(url)) return head;
  return `${head} ${url}`;
}

/**
 * 最近已处理过的分享内容（值 = 时间戳）。
 *
 * 为什么要模块级而不是 useRef：React StrictMode 在开发环境会「挂载 → 卸载 → 再挂载」，
 * 第一次 effect 的定时器会被 cleanup 清掉，而 ref 仍然保留 true，
 * 导致第二次 effect 直接短路 —— 表现就是 dev 下「正在收进盒子…」永远不动。
 * 改成模块级去重表 + 只在真正写库前打标记，两种情况都能正确处理。
 */
const RECENT_WINDOW_MS = 5_000;
const recentlyHandled = new Map<string, number>();

function wasHandled(raw: string): boolean {
  const now = Date.now();
  for (const [key, at] of recentlyHandled) {
    if (now - at > RECENT_WINDOW_MS) recentlyHandled.delete(key);
  }
  return recentlyHandled.has(raw);
}

function markHandled(raw: string): void {
  recentlyHandled.set(raw, Date.now());
}

export function ShareTarget() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const goals = useActiveGoals();
  const goalsRef = useRef(goals);
  goalsRef.current = goals;

  const raw = buildRawText(params);
  const [status, setStatus] = useState<"saving" | "saved" | "empty">(
    raw ? "saving" : "empty",
  );

  useEffect(() => {
    if (!raw) return;

    /**
     * 等一小会儿再解析：goals 是 useLiveQuery 异步读出来的，
     * 立刻解析会丢掉 `@目标` 匹配。150ms 足够本地库返回，又不影响「秒收」的手感。
     */
    const timer = window.setTimeout(() => {
      // 同一个分享内容短时间内重复处理（StrictMode 二次挂载 / 后退再前进）直接跳过写库
      if (wasHandled(raw)) {
        setStatus("saved");
        return;
      }

      const parsed = parseQuickCapture(raw, {
        goals: goalsRef.current.map((goal) => ({ id: goal.id, title: goal.title })),
      });
      void saveCapture({ rawText: raw, parsed, source: "share" })
        .then(() => {
          markHandled(raw);
          setStatus("saved");
          toast({ title: "已收进盒子 ✓", description: parsed.title, tone: "success" });
        })
        .catch(() => {
          toast({
            title: "分享的内容没写进去",
            description: "本地库暂时不可用，请回到应用里手动记一条",
            tone: "danger",
          });
          setStatus("empty");
        });
    }, 150);

    return () => window.clearTimeout(timer);
  }, [raw, toast]);

  /* 收完就回首页：分享是个「路过」的动作，不该把用户留在中转页。 */
  useEffect(() => {
    if (status !== "saved") return;
    const timer = window.setTimeout(() => navigate("/", { replace: true }), 700);
    return () => window.clearTimeout(timer);
  }, [status, navigate]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      {status === "empty" ? (
        <>
          <span className="flex size-12 items-center justify-center rounded-xl bg-surface-sunken text-ink-300">
            <Inbox className="size-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-h2 text-ink-900">没有可收的内容</p>
            <p className="mt-1 text-caption text-ink-500">
              分享链接里没有 text / title / url 参数，回到应用里按 Ctrl+K 直接记一条吧。
            </p>
          </div>
          <Button size="sm" onClick={() => navigate("/", { replace: true })}>
            回到首页
          </Button>
        </>
      ) : (
        <>
          <span className="flex size-12 items-center justify-center rounded-xl bg-success-soft text-success-ink">
            <CheckCheck className="size-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-h2 text-ink-900">
              {status === "saved" ? "已收进盒子" : "正在收进盒子…"}
            </p>
            <p className="mt-1 max-w-sm truncate text-caption text-ink-500">{raw}</p>
          </div>
        </>
      )}
    </div>
  );
}

export default ShareTarget;
