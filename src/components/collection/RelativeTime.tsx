"use client";

import { formatDateTime, relativeDay, type RelativeTone } from "./time";

const TONE_CLASS: Record<RelativeTone, string> = {
  late: "text-bad",
  today: "font-medium text-brand",
  soon: "text-brand",
  future: "text-muted",
  past: "text-muted",
  unknown: "text-muted",
};

interface RelativeTimeProps {
  /** SQLite local datetime string, e.g. WrongEntry.nextReview. */
  value: string | null | undefined;
  /** Stable "now" so a list of rows all agrees on today. */
  now?: Date;
  /** For timestamps that are always in the past (收藏时间/最后答错): never shout. */
  neutral?: boolean;
  label?: string;
  emptyLabel?: string;
  className?: string;
}

/** Renders 今天 / 昨天 / 3天后 with the absolute datetime as tooltip. */
export default function RelativeTime({
  value,
  now,
  neutral = false,
  label,
  emptyLabel = "未安排",
  className = "",
}: RelativeTimeProps) {
  const info = relativeDay(value, now);
  const text = info.diff === null ? emptyLabel : info.text;
  const tone: RelativeTone = neutral && (info.tone === "late" || info.tone === "today") ? "past" : info.tone;
  const absolute = formatDateTime(value);
  return (
    <span className={`tabular-nums ${TONE_CLASS[tone]} ${className}`} title={absolute ?? "时间无法解析"}>
      {label ? <span className="text-muted">{label} </span> : null}
      {text}
    </span>
  );
}
