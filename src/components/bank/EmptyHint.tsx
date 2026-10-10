import Link from "next/link";

/** Shared empty state for bank / question / book views. */
export default function EmptyHint({
  title,
  hint,
  actionHref,
  actionLabel,
  secondaryHref,
  secondaryLabel,
  className = "",
}: {
  title: string;
  hint?: React.ReactNode;
  actionHref?: string;
  actionLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  className?: string;
}) {
  return (
    <div className={`card px-6 py-10 text-center ${className}`}>
      <p className="text-sm font-medium">{title}</p>
      {hint && <div className="mx-auto mt-2 max-w-xl text-xs leading-relaxed text-muted">{hint}</div>}
      {(actionHref || secondaryHref) && (
        <div className="mt-4 flex justify-center gap-2">
          {actionHref && actionLabel && (
            <Link href={actionHref} className="btn btn-primary">
              {actionLabel}
            </Link>
          )}
          {secondaryHref && secondaryLabel && <Link href={secondaryHref} className="btn">{secondaryLabel}</Link>}
        </div>
      )}
    </div>
  );
}
