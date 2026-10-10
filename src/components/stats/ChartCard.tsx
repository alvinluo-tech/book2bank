import clsx from "clsx";

interface ChartCardProps {
  title: string;
  /** One-line Chinese reading guide: what insight the chart carries. */
  caption: string;
  children: React.ReactNode;
  /** Optional slot on the right of the header (legend, link, filter…). */
  right?: React.ReactNode;
  /** Optional slot under the chart (legend, totals, secondary note). */
  footer?: React.ReactNode;
  className?: string;
}

export default function ChartCard({ title, caption, children, right, footer, className }: ChartCardProps) {
  return (
    <section className={clsx("card flex flex-col overflow-hidden p-4", className)}>
      <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-sm font-medium">{title}</h2>
        {right}
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-muted">{caption}</p>
      {/* min-w-0 + overflow-hidden: charts must never widen the page — recharts
          re-measures the clipped box and settles at the real available width. */}
      <div className="min-w-0 flex-1 overflow-hidden">{children}</div>
      {footer ? <div className="mt-3 border-t border-line pt-2 text-[11px] text-muted">{footer}</div> : null}
    </section>
  );
}
