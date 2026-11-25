import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Plus } from "lucide-react";
import { Button } from "@detter/ui";
import { useCaptureStore } from "@/stores/capture";

/**
 * 未开发模块的占位页。
 *
 * 为什么不直接显示「建设中」四个字：T03–T12 会陆续接管这些页面，
 * 中间这段时间用户（也就是开发者自己）每天都会点进来。
 * 所以这里说明「这个模块会做什么」，并给一个现在就能用的动作（记一条）。
 */
export function PagePlaceholder({
  module,
  title,
  description,
  icon,
  bullets,
}: {
  module: string;
  title: string;
  description: string;
  icon: ReactNode;
  bullets: string[];
}) {
  const openCapture = useCaptureStore((state) => state.openCapture);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <header className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-micro text-ink-300">{module} · 建设中</p>
          <h1 className="mt-0.5 text-h1 text-ink-900">{title}</h1>
          <p className="mt-1 text-body text-ink-500">{description}</p>
        </div>
      </header>

      <section className="mt-6 rounded-xl border border-dashed border-border-strong bg-surface p-5">
        <h2 className="text-h2 text-ink-900">这个模块会做什么</h2>
        <ul className="mt-2.5 space-y-2">
          {bullets.map((bullet) => (
            <li key={bullet} className="flex items-start gap-2 text-body text-ink-700">
              <span
                aria-hidden="true"
                className="mt-[9px] size-1.5 shrink-0 rounded-full bg-accent/60"
              />
              {bullet}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
          <Button
            size="sm"
            onClick={() => openCapture()}
            leftIcon={<Plus className="size-3.5" aria-hidden="true" />}
          >
            先记一条
          </Button>
          <Link to="/">
            <Button
              size="sm"
              variant="secondary"
              rightIcon={<ArrowRight className="size-3.5" aria-hidden="true" />}
            >
              回到四象限
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
