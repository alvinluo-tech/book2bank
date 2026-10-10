import clsx from "clsx";
import { flagInfo, TONE_VARS } from "./helpers";

/**
 * Pipeline quality markers rendered as honest, user-visible signals.
 * Unknown codes from future pipeline runs still show up (label = raw code).
 */
export default function FlagBadges({
  flags,
  max,
  className,
  detail = false,
}: {
  flags: string[];
  max?: number;
  className?: string;
  /** Prepend the 标记 label so the block reads as a sentence in the detail page. */
  detail?: boolean;
}) {
  if (!flags.length) return null;
  const shown = max ? flags.slice(0, max) : flags;
  const rest = flags.length - shown.length;
  return (
    <span className={clsx("flex flex-wrap items-center gap-1", className)}>
      {detail && <span className="text-[11px] text-muted">识别标记</span>}
      {shown.map((flag) => {
        const info = flagInfo(flag);
        const colors = TONE_VARS[info.tone];
        return (
          <span
            key={flag}
            title={`${flag} — ${info.help}`}
            style={{ color: colors.fg, borderColor: colors.fg }}
            className="chip"
          >
            {info.label}
          </span>
        );
      })}
      {rest > 0 && <span className="chip tabular-nums">另 {rest} 项</span>}
    </span>
  );
}
