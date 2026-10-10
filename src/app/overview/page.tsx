import Link from "next/link";
import { getBank, getMetas } from "@/lib/bank";
import { bankDef } from "@/lib/banks";
import { getChapterStats, getOverview, getPointStats, getTrend, listWrong } from "@/lib/db";

export const dynamic = "force-dynamic";

function Sparkline({ points }: { points: { date: string; accuracy: number; total: number }[] }) {
  if (points.length < 2) {
    return <p className="pt-8 text-center text-xs text-muted">答题后这里会出现正确率趋势</p>;
  }
  const w = 320;
  const h = 72;
  const max = Math.max(...points.map((p) => p.total), 1);
  const step = w / (points.length - 1);
  const line = points.map((p, i) => `${(i * step).toFixed(1)},${(h - (p.accuracy / 100) * h).toFixed(1)}`).join(" ");
  const bars = points
    .map((p, i) => `${(i * step).toFixed(1)},${h} ${(i * step).toFixed(1)},${(h - (p.total / max) * (h * 0.45)).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-[72px] w-full" role="img" aria-label="近期正确率趋势">
      <polyline points={bars} fill="none" stroke="var(--line)" strokeWidth="1" opacity="0.6" />
      {points.map((p, i) => (
        <circle key={p.date} cx={i * step} cy={h - (p.accuracy / 100) * h} r="1.8" fill="var(--brand)" />
      ))}
      <polyline points={line} fill="none" stroke="var(--brand)" strokeWidth="1.6" />
    </svg>
  );
}

export default function Home() {
  const metas = getMetas();
  const bank = getBank();
  const o = getOverview();
  const trend = getTrend(14);
  const weak = getPointStats()
    .filter((p) => p.total >= 3)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 6);
  const due = listWrong({ due: true, limit: 6 });
  const flagCount = bank.reduce((m, q) => {
    for (const f of q.flags) m[f] = (m[f] ?? 0) + 1;
    return m;
  }, {} as Record<string, number>);

  if (!bank.length) {
    return (
      <div className="card p-8">
        <h1 className="text-lg font-semibold">题库尚未构建</h1>
        <p className="mt-2 text-sm text-muted">
          先运行 <code className="chip">python pipeline/build.py</code> 生成 data/banks/&lt;科目&gt;/questions.json。
        </p>
      </div>
    );
  }

  const cards = [
    { label: "题库覆盖", value: `${o.coverage.toFixed(1)}%`, sub: `${Math.round((o.coverage / 100) * o.bankTotal)}/${o.bankTotal} 题`, href: "/bank" },
    { label: "累计正确率", value: `${o.accuracy.toFixed(1)}%`, sub: `${o.correctTotal}/${o.answeredTotal} 次作答`, href: "/stats" },
    { label: "待复习错题", value: String(o.dueForReview), sub: `错题本共 ${o.wrongOpen} 题`, href: "/wrong" },
    { label: "今日刷题", value: String(o.todayCount), sub: `今日正确率 ${o.todayAccuracy.toFixed(0)}%`, href: "/practice" },
  ];

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">决战行测 5000 题 · 刷题系统</h1>
          <p className="mt-1 text-xs text-muted">
            {metas.map((m) => `${m.subject} ${m.totals.questions}`).join(" + ")} = {o.bankTotal} 题 ·{" "}
            {bank.filter((q) => q.hasImage).length} 题含图形 · {bank.filter((q) => q.analysis).length} 题含解析 · 扫描页{" "}
            {metas.reduce((s, m) => s + m.totals.pagesOcr, 0)} 页
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/practice?mode=instant" className="btn btn-primary">开始刷题</Link>
          <Link href="/practice?mode=recite" className="btn">背题模式</Link>
          <Link href="/practice?mode=smart" className="btn">智能练习</Link>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className="card p-4">
            <div className="text-xs text-muted">{c.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{c.value}</div>
            <div className="mt-0.5 text-[11px] text-muted">{c.sub}</div>
          </Link>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="card p-4 lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium">近 14 天正确率</h2>
            <Link href="/stats" className="text-xs text-brand">详细统计 →</Link>
          </div>
          <Sparkline points={trend} />
          <div className="mt-3 grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-[11px] text-muted">平均作答用时</div>
              <div className="text-sm font-medium tabular-nums">{(o.avgSpeedMs / 1000).toFixed(1)}s</div>
            </div>
            <div>
              <div className="text-[11px] text-muted">活跃天数</div>
              <div className="text-sm font-medium tabular-nums">{o.streakDays} 天</div>
            </div>
            <div>
              <div className="text-[11px] text-muted">收藏 / 笔记</div>
              <div className="text-sm font-medium tabular-nums">{o.favorites} / {o.notes}</div>
            </div>
          </div>
        </div>

        <div className="card p-4">
          <h2 className="mb-2 text-sm font-medium">最薄弱考点</h2>
          {weak.length === 0 && <p className="py-6 text-center text-xs text-muted">每个考点作答 3 题后生成</p>}
          <ul className="flex flex-col gap-2">
            {weak.map((p) => (
              <li key={`${p.bankId}-${p.chapterIndex}-${p.title}`}>
                <Link
                  href={`/practice?bank=${p.bankId}&chapter=${p.chapterIndex}&point=${encodeURIComponent(p.title)}`}
                  className="block"
                >
                  <div className="flex justify-between text-xs">
                    <span className="truncate pr-2">{p.title}</span>
                    <span className="tabular-nums text-muted">{p.accuracy.toFixed(0)}% · {p.total}题</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
                    <div className="h-full rounded-full bg-brand" style={{ width: `${p.accuracy}%` }} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium">今日待复习</h2>
            <Link href="/wrong" className="text-xs text-brand">错题本 →</Link>
          </div>
          {due.length === 0 && <p className="py-6 text-center text-xs text-muted">复到期为空 — 保持节奏</p>}
          <ul className="flex flex-col gap-2">
            {due.map((w) => (
              <li key={w.questionId} className="flex items-center justify-between gap-3 text-sm">
                <Link href={`/question/${w.questionId}`} className="truncate hover:text-brand">
                  {w.question
                    ? `${bankDef(w.question.bankId).title}·第${w.question.chapterIndex}章 · ${w.question.pointTitle ?? ""} · 原题号${w.question.num}`
                    : w.questionId}
                </Link>
                <span className="chip shrink-0">错 {w.wrongCount} 次 · 第{w.box}关</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card p-4">
          <h2 className="mb-2 text-sm font-medium">章节进度</h2>
          <ul className="flex flex-col gap-2.5">
            {getChapterStats().map((c) => {
              const done = Math.min(100, (c.total / Math.max(1, c.bankTotal)) * 100);
              return (
                <li key={`${c.bankId}-${c.chapterIndex}`}>
                  <div className="flex justify-between text-xs">
                    <Link href={`/bank?bank=${c.bankId}&chapter=${c.chapterIndex}`} className="hover:text-brand">
                      {c.bankTitle} · 第{c.chapterIndex}章 {c.chapterTitle}
                    </Link>
                    <span className="tabular-nums text-muted">
                      已答 {c.total}/{c.bankTotal} 题
                    </span>
                  </div>
                  {/* 进度 = 已作答题数 / 题库题量；0 作答时只留轨道，绝不假装有进度 */}
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
                    <div className="h-full rounded-full bg-brand" style={{ width: `${done}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
          {Object.keys(flagCount).length > 0 && (
            <p className="mt-3 border-t border-line pt-2 text-[11px] leading-relaxed text-muted">
              扫描识别质量标记：
              {Object.entries(flagCount).map(([f, n]) => ` ${f} ${n}`).join(" · ")}
              ，可在题库页按标记筛查并对照原书裁剪图核对。
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
