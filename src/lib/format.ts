/**
 * Pure, dependency-free formatting helpers shared by the stats page and charts.
 * Every function is safe on empty / broken input: they return an em dash or a
 * null rather than NaN, Infinity or "undefined".
 */

const EMPTY = "—";
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;
const DAY_MS = 86_400_000;

/** 考点答题样本低于此值时视为「数据不足」，不展示正确率结论。 */
export const LOW_SAMPLE_MIN = 5;

/** Monday-first labels, index 0 = 周一 (matches `weekdayIndex`). */
export const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

const WEEKDAY_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function toFinite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Guarded division: returns null instead of NaN / Infinity. */
export function safeDiv(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null) return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

/** correct / total as a 0-100 percentage, or null when there is no sample. */
export function rate(correct: number, total: number): number | null {
  const r = safeDiv(correct, total);
  return r === null ? null : r * 100;
}

export function pct(value: number | null | undefined, digits = 1): string {
  const n = toFinite(value);
  if (n === null) return EMPTY;
  return `${n.toFixed(digits)}%`;
}

export function num(value: number | null | undefined, digits = 0): string {
  const n = toFinite(value);
  if (n === null) return EMPTY;
  return n.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** 90_000 -> "1分30秒"; 0 / broken -> "0秒"; long spans drop the seconds. */
export function duration(ms: number | null | undefined): string {
  const n = toFinite(ms);
  if (n === null || n <= 0) return "0秒";
  const totalSec = Math.round(n / 1000);
  if (totalSec < 60) return `${totalSec}秒`;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return m > 0 ? `${h}小时${m}分` : `${h}小时`;
  return s > 0 ? `${m}分${s}秒` : `${m}分`;
}

function utcMidnight(value: string): number | null {
  const m = DAY_RE.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return Date.UTC(y, mo - 1, d);
}

/** Normalise "2026-10-09 08:12:00" / Date ISO to the plain day "2026-10-09". */
export function normalizeDay(value: string | null | undefined): string | null {
  if (!value) return null;
  return utcMidnight(value) === null ? null : value.trim().slice(0, 10);
}

export function dateCN(value: string | null | undefined): string {
  if (!value) return EMPTY;
  const m = DAY_RE.exec(value.trim());
  if (!m) return EMPTY;
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
}

export function monthCN(value: string): string {
  const m = DAY_RE.exec(value.trim());
  return m ? `${Number(m[2])}月` : EMPTY;
}

/** Compact axis label: "10/9". */
export function axisDay(value: string): string {
  const m = DAY_RE.exec(value.trim());
  return m ? `${Number(m[2])}/${Number(m[3])}` : EMPTY;
}

/** "10月9日 14:32" — falls back to the date when the time part is missing. */
export function dateTimeCN(value: string | null | undefined): string {
  if (!value) return EMPTY;
  const m = STAMP_RE.exec(value.trim());
  if (!m) return dateCN(value);
  return `${Number(m[2])}月${Number(m[3])}日 ${m[4]}:${m[5]}`;
}

/** Monday-first weekday index: 周一 = 0 … 周日 = 6. */
export function weekdayIndex(value: string): number {
  const t = utcMidnight(value);
  if (t === null) return 0;
  return (new Date(t).getUTCDay() + 6) % 7;
}

export function weekdayCN(value: string): string {
  const t = utcMidnight(value);
  if (t === null) return EMPTY;
  return WEEKDAY_CN[new Date(t).getUTCDay()];
}

/** Calendar-safe day arithmetic (UTC based, so no DST / timezone drift). */
export function addDaysISO(value: string, days: number): string | null {
  const t = utcMidnight(value);
  if (t === null) return null;
  const shifted = new Date(t + days * DAY_MS);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Local calendar today, independent of the runtime timezone offset. */
export function isoToday(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/**
 * Trailing moving average over a fixed window.
 * Values that are null (e.g. a day with no answers) are skipped; when `weights`
 * is supplied the window becomes volume-weighted, which turns a moving average
 * of daily accuracies into the pooled accuracy of the window.
 * Returns null until the window is fully covered.
 */
export function movingAverage(
  values: readonly (number | null)[],
  window: number,
  weights?: readonly (number | null)[],
): (number | null)[] {
  const size = Math.max(1, Math.floor(window));
  const out: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    const from = Math.max(0, i - size + 1);
    let weightedSum = 0;
    let weightTotal = 0;
    for (let j = from; j <= i; j++) {
      const v = toFinite(values[j]);
      if (v === null) continue;
      const w = weights ? toFinite(weights[j]) : null;
      const factor = w === null ? 1 : w;
      if (factor <= 0) continue;
      weightedSum += v * factor;
      weightTotal += factor;
    }
    const covered = i - from + 1;
    out.push(covered >= size && weightTotal > 0 ? weightedSum / weightTotal : null);
  }
  return out;
}

/** Accuracy -> semantic colour token (works in both light and dark mode). */
export function accuracyColor(accuracy: number | null | undefined): string {
  const n = toFinite(accuracy);
  if (n === null) return "var(--muted)";
  if (n >= 80) return "var(--ok)";
  if (n >= 60) return "var(--warn)";
  return "var(--bad)";
}

/** Clip long Chinese titles so chart axes stay readable. */
export function shorten(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(1, max - 1))}…`;
}
