"use client";

import clsx from "clsx";

export const MASTER_BOX = 5;

interface LeitnerDotsProps {
  /** 1..5 — see recordAnswer() in src/lib/db.ts. */
  box: number;
  status?: "open" | "resolved";
  /** Box interval hint, e.g. [1,3,7,21,21]. */
  intervals?: number[];
  showLabel?: boolean;
  className?: string;
}

const clamp = (n: number) => Math.max(0, Math.min(MASTER_BOX, Math.round(Number.isFinite(n) ? n : 0)));

/** Five dots: filled up to the current Leitner box. Box 5 = 已消灭. */
export default function LeitnerDots({
  box,
  status = "open",
  intervals,
  showLabel = true,
  className,
}: LeitnerDotsProps) {
  const filled = clamp(box);
  const done = status === "resolved" || filled >= MASTER_BOX;
  const title = done
    ? `关卡 ${filled}/${MASTER_BOX} · 已消灭`
    : `关卡 ${filled}/${MASTER_BOX}${intervals?.[filled - 1] !== undefined ? ` · 下次复习间隔 ${intervals[filled - 1]} 天` : ""}`;

  return (
    <span className={clsx("inline-flex items-center gap-1.5", className)} title={title}>
      <span className="flex items-center gap-1" role="img" aria-label={`复习关卡 ${filled} / ${MASTER_BOX}`}>
        {Array.from({ length: MASTER_BOX }, (_, i) => {
          const on = i < filled;
          return (
            <span
              key={i}
              className={clsx(
                "h-1.5 w-1.5 rounded-full transition-colors",
                !on && "bg-line",
                on && done && "bg-ok",
                on && !done && "bg-brand",
              )}
            />
          );
        })}
      </span>
      {showLabel ? (
        <span className={clsx("text-[11px] tabular-nums", done ? "text-ok" : "text-muted")}>
          {filled}/{MASTER_BOX} 关
        </span>
      ) : null}
    </span>
  );
}
