import Link from "next/link";
import { computeStats, fmtMs, usePractice } from "@/lib/practice-store";

/** 考试模式交卷后的成绩总览。 */
export default function ExamResult({
  onReview,
  onRestart,
  onRetry,
}: {
  onReview: () => void;
  onRestart: () => void;
  onRetry: (ids: string[]) => void;
}) {
  const s = usePractice((st) => st);
  const stats = computeStats(s);
  const wallMs = s.finishedAt && s.startedAt ? s.finishedAt - s.startedAt : 0;
  const wrongIds = s.queue.filter((id) => s.graded[id] && !s.graded[id]!.correct && !s.ungraded[id]);
  const skippedIds = s.queue.filter((id) => !s.chosen[id]);

  const verdict =
    stats.accuracy >= 80 ? "状态不错，保持这个正确率" : stats.accuracy >= 60 ? "中等偏上，重点看错题解析" : "先把这一组错题吃透再开新组";

  return (
    <section className="card p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">本卷成绩</h2>
        <span className="text-xs text-muted">{s.config?.title ?? "考试"} · 已交卷</span>
      </header>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="正确 / 已判分" value={`${stats.correct} / ${stats.gradedTotal}`} />
        <Metric label="正确率" value={stats.gradedTotal ? `${stats.accuracy.toFixed(1)}%` : "—"} tone="var(--brand)" />
        <Metric label="答题用时" value={fmtMs(stats.elapsedMs)} sub={`整卷耗时 ${fmtMs(wallMs)}`} />
        <Metric
          label="未作答"
          value={String(skippedIds.length)}
          sub={stats.noAnswer ? `另有 ${stats.noAnswer} 题题库缺答案` : undefined}
        />
      </div>

      <p className="mt-3 text-xs text-muted">{verdict}。</p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={onReview}>
          逐题回顾
        </button>
        <button
          type="button"
          className="btn"
          disabled={!wrongIds.length}
          onClick={() => onRetry(wrongIds)}
        >
          重做本组错题（{wrongIds.length}）
        </button>
        <button type="button" className="btn" onClick={onRestart}>
          回到设置
        </button>
        <Link href="/stats" className="btn">
          查看统计
        </Link>
        <Link href="/wrong" className="btn">
          错题本
        </Link>
      </div>

      {wrongIds.length > 0 && (
        <ul className="mt-3 grid gap-1.5 border-t border-line pt-3 sm:grid-cols-2">
          {wrongIds.slice(0, 12).map((id) => {
            const q = s.questions[id];
            return (
              <li key={id} className="flex items-center justify-between gap-2 text-xs">
                <Link href={`/question/${id}`} className="truncate hover:text-brand">
                  {q ? `${q.pointTitle ?? q.sectionTitle ?? q.chapterTitle} · 题号 ${q.num}` : id}
                </Link>
                <span className="chip shrink-0 tabular-nums">
                  你选 {s.chosen[id] ?? "—"} / 正确 {q?.answer ?? "—"}
                </span>
              </li>
            );
          })}
          {wrongIds.length > 12 && (
            <li className="text-xs text-muted">…其余 {wrongIds.length - 12} 题见答题卡</li>
          )}
        </ul>
      )}
    </section>
  );
}

function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-muted">{sub}</div>}
    </div>
  );
}
