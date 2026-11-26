import { QUADRANT_META, QUADRANT_ORDER } from "@detter/shared";
import type { Quadrant } from "@detter/shared";
import { cn } from "@detter/ui";

/**
 * 平面的静景：底色、坐标轴、四个角的象限标题。
 *
 * 这里没有任务、没有交互，只负责「看起来是一张连续的坐标系」。
 * 背景按「四个外角打光 + 中心压白」绘制：每个象限只是 1/2 × 1/2 的区块，
 * 光从平面最外角射进来，越靠近原点越淡；中心再加一层白色径向，
 * 让原点附近保持干净，避免四团颜色在中间糊成一片。
 */

/** 四格各一句说明，和样张一致。 */
const QUADRANT_DESCRIPTION: Record<Quadrant, string> = {
  1: "今天就躲不掉的事",
  2: "值得提前投资：学习、健康、关系",
  3: "别人在等你的事",
  4: "可以不做的事",
};

export function PlaneBackdrop({ overQuadrant }: { overQuadrant: Quadrant | null }) {
  return (
    <div aria-hidden="true" className="plane-bg">
      <div className="plane-tint plane-tint-q1" />
      <div className="plane-tint plane-tint-q2" />
      <div className="plane-tint plane-tint-q3" />
      <div className="plane-tint plane-tint-q4" />
      <div className="plane-grid-lines" />
      <div className="plane-center-wash" />
      <div className="plane-vignette" />
      {QUADRANT_ORDER.map((quadrant) => (
        <div
          key={quadrant}
          className={cn(
            "plane-drop-zone",
            quadrant === 1 && "top-0 right-0 rounded-tr-[23px]",
            quadrant === 2 && "top-0 left-0 rounded-tl-[23px]",
            quadrant === 3 && "right-0 bottom-0 rounded-br-[23px]",
            quadrant === 4 && "bottom-0 left-0 rounded-bl-[23px]",
            overQuadrant === quadrant && "plane-drop-zone-hot",
          )}
        />
      ))}
    </div>
  );
}

export function PlaneAxes() {
  return (
    <div aria-hidden="true" className="absolute inset-0">
      <div className="plane-axis plane-axis-x" />
      <div className="plane-axis plane-axis-y" />

      <span className="plane-axis-arrow plane-axis-arrow-right" />
      <span className="plane-axis-arrow plane-axis-arrow-left" />
      <span className="plane-axis-arrow plane-axis-arrow-up" />
      <span className="plane-axis-arrow plane-axis-arrow-down" />

      <span className="plane-tick" style={{ left: "25%", top: "calc(50% - 2px)", width: 1, height: 5 }} />
      <span className="plane-tick" style={{ left: "75%", top: "calc(50% - 2px)", width: 1, height: 5 }} />
      <span className="plane-tick" style={{ top: "25%", left: "calc(50% - 2px)", width: 5, height: 1 }} />
      <span className="plane-tick" style={{ top: "75%", left: "calc(50% - 2px)", width: 5, height: 1 }} />

      <span className="plane-axis-cap plane-axis-cap-left">← 不紧急</span>
      <span className="plane-axis-cap plane-axis-cap-right">紧急 →</span>
      <span className="plane-axis-cap plane-axis-cap-top">↑ 重要</span>
      <span className="plane-axis-cap plane-axis-cap-bottom">不重要 ↓</span>
    </div>
  );
}

const HEADER_POSITION: Record<Quadrant, string> = {
  1: "top-4 right-5 items-end text-right",
  2: "top-4 left-5 items-start text-left",
  3: "right-5 bottom-4 items-end text-right",
  4: "bottom-4 left-5 items-start text-left",
};

export function PlaneQuadrantHeaders({
  counts,
}: {
  counts: Record<Quadrant, number>;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {QUADRANT_ORDER.map((quadrant) => {
        const meta = QUADRANT_META[quadrant];
        const right = quadrant === 1 || quadrant === 3;
        const accentTitle = quadrant === 1 || quadrant === 3;
        return (
          <div
            key={quadrant}
            data-plane-quadrant-header={quadrant}
            className={cn("absolute flex flex-col gap-0.5", HEADER_POSITION[quadrant])}
          >
            <div
              className={cn(
                "flex items-center gap-1.5",
                right && "flex-row-reverse",
              )}
            >
              <span
                aria-hidden="true"
                className="h-3.5 w-[3px] shrink-0 rounded-full"
                style={{ backgroundColor: `var(--q${quadrant}-accent)` }}
              />
              <h2
                className="text-[13px] leading-[18px] font-strong"
                style={accentTitle ? { color: `var(--q${quadrant}-accent)` } : undefined}
              >
                {meta.name}
              </h2>
              <span className="tabular text-[11px] leading-4 text-ink-500">
                {counts[quadrant]}
              </span>
            </div>
            <p className="plane-q-desc max-w-[30ch] text-[11px] leading-4 text-ink-500/80">
              {QUADRANT_DESCRIPTION[quadrant]}
            </p>
          </div>
        );
      })}
    </div>
  );
}

export default PlaneBackdrop;
