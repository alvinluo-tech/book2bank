/**
 * Date helpers for SQLite `datetime('now','localtime')` strings.
 *
 * Those look like "YYYY-MM-DD HH:MM:SS" and are *local* wall-clock text, so they
 * must never be handed to `new Date(str)` directly (V8 would read them as an
 * unsupported format or as UTC depending on shape). We normalise the space to a
 * "T" and keep them timezone-less, which JS then parses as local time.
 */

const DAY_MS = 86_400_000;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TS = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/;

/** "YYYY-MM-DD HH:MM:SS" -> local Date; null when the value is unusable. */
export function parseSqlite(value: string | null | undefined): Date | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const candidate = DATE_ONLY.test(raw) ? raw : LOCAL_TS.test(raw) ? raw.replace(" ", "T") : raw;
  const d = new Date(candidate);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "2026-10-09 21:14" for tooltips; null when unparseable. */
export function formatDateTime(value: string | null | undefined): string | null {
  const d = parseSqlite(value);
  if (!d) return null;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function formatDate(value: string | null | undefined): string | null {
  const d = parseSqlite(value);
  if (!d) return null;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Whole calendar days between `value` and `now` (negative = in the past). */
export function dayDiff(value: string | null | undefined, now: Date = new Date()): number | null {
  const d = parseSqlite(value);
  if (!d) return null;
  return Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / DAY_MS);
}

export type RelativeTone = "late" | "today" | "soon" | "future" | "past" | "unknown";

export interface RelativeInfo {
  text: string;
  tone: RelativeTone;
  /** null when the review is unscheduled. */
  diff: number | null;
}

/** 今天 / 昨天 / 3天后 / 2天前 — day-granular, the only granularity a Leitner box deserves. */
export function relativeDay(value: string | null | undefined, now: Date = new Date()): RelativeInfo {
  const diff = dayDiff(value, now);
  if (diff === null) return { text: "未安排", tone: "unknown", diff: null };
  if (diff === 0) return { text: "今天", tone: "today", diff };
  if (diff === 1) return { text: "明天", tone: "soon", diff };
  if (diff === 2) return { text: "后天", tone: "future", diff };
  if (diff === -1) return { text: "昨天", tone: "past", diff };
  if (diff === -2) return { text: "前天", tone: "past", diff };
  if (diff > 2) return { text: `${diff}天后`, tone: "future", diff };
  return { text: `${-diff}天前`, tone: diff <= -7 ? "past" : "late", diff };
}

/** Leitner semantics: no date scheduled means "review it now". */
export function isDue(nextReview: string | null | undefined, now: Date = new Date()): boolean {
  const d = parseSqlite(nextReview);
  if (!d) return true;
  return d.getTime() <= now.getTime();
}

/** Compact "12 秒 / 3.4 分 / 42 分钟" for durations in ms. */
export function humanDuration(ms: number | null | undefined): string {
  const v = Number(ms);
  if (!Number.isFinite(v) || v <= 0) return "—";
  if (v < 60_000) return `${Math.round(v / 1000)} 秒`;
  if (v < 3_600_000) return `${(v / 60_000).toFixed(1)} 分`;
  return `${(v / 3_600_000).toFixed(1)} 小时`;
}
