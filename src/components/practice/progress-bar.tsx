import { computeStats, fmtMs, usePractice } from "@/lib/practice-store";

/**
 * 进度条 + 「第 12 / 60 题 · 正确 9 · 正确率 75%」这行常驻摘要。
 * 分段条：绿=对，红=错，黄=已答但题库无答案，紫=考试模式已作答。
 */
export default function ProgressBar() {
  const s = usePractice((st) => st);
  const stats = computeStats(s);
  const total = Math.max(1, stats.total);
  const pct = (n: number) => `${(n / total) * 100}%`;

  return (
    <div className="card p-3">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="tabular-nums text-muted">
          第 <span className="text-sm font-semibold text-ink">{Math.min(s.index + 1, stats.total)}</span> /{" "}
          {stats.total} 题
        </span>
        <span className="tabular-nums text-muted">
          正确 <span className="font-medium text-[var(--ok)]">{stats.correct}</span>
          <span className="mx-1.5">·</span>
          正确率{" "}
          <span className="font-medium text-ink">
            {stats.gradedTotal ? `${stats.accuracy.toFixed(0)}%` : "—"}
          </span>
        </span>
      </div>

      <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-line">
        <div className="h-full bg-ok" style={{ width: pct(stats.correct) }} />
        <div className="h-full bg-bad" style={{ width: pct(stats.wrong) }} />
        {stats.noAnswer > 0 && (
          <div className="h-full" style={{ width: pct(stats.noAnswer), background: "var(--warn)" }} />
        )}
        {s.mode === "exam" && (
          <div
            className="h-full bg-brand"
            style={{ width: pct(Math.max(0, stats.answered - stats.gradedTotal - stats.noAnswer)) }}
          />
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] tabular-nums text-muted">
        <span>已作答 {stats.answered}</span>
        <span>错误 {stats.wrong}</span>
        {stats.noAnswer > 0 && <span>无法判分 {stats.noAnswer}</span>}
        <span>累计用时 {fmtMs(stats.elapsedMs)}</span>
        {s.mode === "exam" && !s.submitted && <span>交卷后统一判分</span>}
        {s.mode === "recite" && <span>背题模式不计成绩</span>}
      </div>
    </div>
  );
}
