import Link from "next/link";

interface EmptyStateProps {
  /** Short headline, defaults to 暂无数据. */
  title?: string;
  /** What the learner should do to make this chart appear. */
  hint: string;
  href?: string;
  actionLabel?: string;
  /** Compact = used inside a chart body instead of a full page section. */
  compact?: boolean;
}

export default function EmptyState({
  title = "暂无数据",
  hint,
  href,
  actionLabel = "去练习",
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={
        compact
          ? "flex h-full min-h-[140px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line px-4 text-center"
          : "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line px-4 py-10 text-center"
      }
    >
      <div className="text-sm font-medium">{title}</div>
      <p className="max-w-[42ch] text-[11px] leading-relaxed text-muted">{hint}</p>
      {href ? (
        <Link href={href} className="btn btn-primary mt-1 px-3 py-1.5 text-xs">
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}
