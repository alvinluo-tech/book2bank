import Link from "next/link";
import EmptyState from "./EmptyState";

export type AdviceKind = "start" | "weak" | "chapter" | "bias" | "coverage" | "review" | "careless";

export interface AdviceTip {
  kind: AdviceKind;
  text: string;
  href?: string;
  /** Link label, defaults to 去练习. */
  action?: string;
}

const ICON: Record<AdviceKind, string> = {
  start: "→",
  weak: "▼",
  chapter: "◆",
  bias: "◐",
  coverage: "◇",
  review: "↻",
  careless: "!",
};

const COLOR: Record<AdviceKind, string> = {
  start: "var(--brand)",
  weak: "var(--bad)",
  chapter: "var(--warn)",
  bias: "var(--warn)",
  coverage: "var(--brand)",
  review: "var(--brand)",
  careless: "var(--bad)",
};

export default function StudyAdvice({ tips, note }: { tips: AdviceTip[]; note?: string }) {
  return (
    <section className="card flex flex-col p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">学习建议</h2>
        <span className="chip">{tips.length > 0 ? `${tips.length} 条` : "待生成"}</span>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-muted">
        由当前统计直接推导：优先补正确率最低的考点，其次清掉到期错题。
      </p>
      {tips.length === 0 ? (
        <EmptyState
          compact
          title="暂时没有可给出的建议"
          hint={note ?? "再刷几组题，让考点样本达到 5 题以上，系统就能指出你真正的薄弱环节。"}
          href="/practice"
        />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {tips.map((tip, i) => (
            <li key={`${tip.kind}-${i}`} className="flex gap-2.5">
              <span
                aria-hidden
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold"
                style={{ color: COLOR[tip.kind], background: "var(--brand-soft)", border: "1px solid var(--line)" }}
              >
                {ICON[tip.kind]}
              </span>
              <div className="min-w-0">
                <p className="text-xs leading-relaxed">{tip.text}</p>
                {tip.href ? (
                  <Link href={tip.href} className="mt-1 inline-block text-[11px] text-brand hover:underline">
                    {tip.action ?? "去练习"} →
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
