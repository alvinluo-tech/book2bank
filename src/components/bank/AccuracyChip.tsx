import clsx from "clsx";
import { accuracyTone, fmtAccuracy, TONE_VARS } from "./helpers";

/**
 * 粉笔大数据 正确率 chip — only rendered when the bank carries a real value.
 * <60 red (普遍做错，值得重点刷), 60-85 amber, >85 green.
 */
export default function AccuracyChip({
  value,
  trap,
  prefix = "正确率",
  className,
}: {
  value: number | null | undefined;
  trap?: string | null;
  prefix?: string;
  className?: string;
}) {
  if (value === null || value === undefined) return null;
  const tone = accuracyTone(value);
  const colors = TONE_VARS[tone];
  return (
    <span
      title={`粉笔大数据正确率 ${fmtAccuracy(value)}${trap ? `，易错项 ${trap}` : ""}`}
      style={{ color: colors.fg, background: colors.bg, borderColor: colors.fg }}
      className={clsx("chip tabular-nums", className)}
    >
      {prefix ? `${prefix} ${fmtAccuracy(value)}` : fmtAccuracy(value)}
      {trap ? <span className="opacity-80">· 易错{trap}</span> : null}
    </span>
  );
}
