import clsx from "clsx";
import type { ReactNode } from "react";

interface EmptyHintProps {
  title: string;
  /** Plain-language explanation of how this list gets filled. */
  children?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

/** Explains an empty collection instead of showing a blank page. */
export default function EmptyHint({ title, children, action, icon = "◌", className }: EmptyHintProps) {
  return (
    <div className={clsx("card flex flex-col items-center gap-2 px-6 py-12 text-center", className)}>
      <span aria-hidden className="text-2xl text-muted">
        {icon}
      </span>
      <h3 className="text-sm font-medium">{title}</h3>
      {children ? (
        <div className="max-w-[560px] text-[11px] leading-relaxed text-muted">{children}</div>
      ) : null}
      {action ? <div className="mt-2 flex gap-2">{action}</div> : null}
    </div>
  );
}
