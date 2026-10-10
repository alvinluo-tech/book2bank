import Link from "next/link";
import { accuracyColor, toFinite } from "@/lib/format";

interface StatCardProps {
  label: string;
  /** Pre-formatted display value — formatting stays the caller's concern. */
  value: string;
  sub?: string;
  href?: string;
  /** 0-100 thin bar; values outside the range are clamped. */
  progress?: number | null;
  /** When given, value + bar are coloured by this accuracy (0-100). */
  accent?: number | null;
}

export default function StatCard({ label, value, sub, href, progress, accent }: StatCardProps) {
  const raw = toFinite(accent);
  const color = raw === null ? "var(--brand)" : accuracyColor(raw);
  const bar = toFinite(progress);
  const width = bar === null ? null : Math.min(100, Math.max(0, bar));

  const body = (
    <>
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums" style={raw === null ? undefined : { color }}>
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-[11px] text-muted">{sub}</div> : null}
      {width !== null ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full" style={{ width: `${width}%`, background: color }} />
        </div>
      ) : null}
    </>
  );

  if (href) {
    return (
      <Link href={href} className="card p-4 transition-colors hover:border-brand">
        {body}
      </Link>
    );
  }
  return <div className="card p-4">{body}</div>;
}
