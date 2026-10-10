import Link from "next/link";
import { getOverview, getModuleSummaries } from "@/lib/db";
import type { ModuleSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Per-module accent, kept in one place so a card and its chips never disagree. */
const ACCENTS = ["#4f46e5", "#0891b2", "#b45309", "#059669", "#be123c", "#7c3aed"];

const LAYOUT_LABEL: Record<ModuleSummary["layout"], string> = {
  flat: "单题四选项",
  "material-group": "一段资料带一组小题",
};

function Ring({ value, color }: { value: number; color: string }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  return (
    <svg viewBox="0 0 56 56" className="h-14 w-14 shrink-0" role="img" aria-label={`完成度 ${pct.toFixed(0)}%`}>
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--line)" strokeWidth="5" />
      <circle
        cx="28"
        cy="28"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={`${(c * pct) / 100} ${c}`}
        transform="rotate(-90 28 28)"
      />
      <text x="28" y="32" textAnchor="middle" className="fill-current text-[11px] font-medium tabular-nums">
        {pct < 1 && pct > 0 ? "<1" : pct.toFixed(0)}%
      </text>
    </svg>
  );
}

function ModuleCard({ m, accent }: { m: ModuleSummary; accent: string }) {
  const ocrPct = m.ocr.total ? Math.min(100, (m.ocr.pages / m.ocr.total) * 100) : 0;
  return (
    <article className="card flex flex-col overflow-hidden">
      <div className="h-1" style={{ background: accent }} />
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              href={m.built ? `/bank?bank=${m.id}` : `/book?bank=${m.id}`}
              className="block truncate text-[17px] font-semibold tracking-tight hover:text-brand"
            >
              {m.subject}
            </Link>
            <p className="mt-0.5 truncate text-[11px] text-muted">{m.bookTitle}</p>
          </div>
          {m.built ? (
            <Ring value={m.coverage} color={accent} />
          ) : (
            <span className="chip shrink-0" style={{ color: accent, borderColor: accent }}>
              识别中 {ocrPct.toFixed(0)}%
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5 text-[11px]">
          <span className="chip">{LAYOUT_LABEL[m.layout]}</span>
          <span className="chip tabular-nums">{m.questions} 题</span>
          {m.materials > 0 && <span className="chip tabular-nums">{m.materials} 段资料</span>}
          {m.withFigure > 0 && <span className="chip tabular-nums">图形 {m.withFigure}</span>}
          {m.built && m.withAnswer < m.questions && (
            <span className="chip tabular-nums" title="下册答案尚未完全配对">
              有答案 {m.withAnswer}/{m.questions}
            </span>
          )}
        </div>

        {m.chapters.length > 0 && (
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
            {m.chapters.slice(0, 6).map((c) => (
              <li key={c.index} className="flex items-center gap-1">
                <span className="truncate">{c.title}</span>
                <span className="tabular-nums opacity-70">{c.count}</span>
              </li>
            ))}
          </ul>
        )}

        {m.built ? (
          <div className="grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
            <div>
              <div className="text-[11px] text-muted">已刷</div>
              <div className="text-sm font-medium tabular-nums">
                {m.answered}
                <span className="text-[11px] text-muted">/{m.questions}</span>
              </div>
            </div>
            <div>
              <div className="text-[11px] text-muted">正确率</div>
              <div className="text-sm font-medium tabular-nums" style={{ color: m.answered ? accent : undefined }}>
                {m.answered ? `${m.accuracy.toFixed(0)}%` : "—"}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-muted">待复习</div>
              <div className="text-sm font-medium tabular-nums">
                {m.dueForReview}
                <span className="text-[11px] text-muted">/{m.wrongOpen}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="border-t border-line pt-3">
            <div className="flex justify-between text-[11px] text-muted">
              <span>扫描识别进度</span>
              <span className="tabular-nums">
                {m.ocr.pages}/{m.ocr.total} 页
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full" style={{ width: `${ocrPct}%`, background: accent }} />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              题库结构化尚未收口：完成后执行 <code className="chip">python pipeline/build.py --bank {m.id}</code>{" "}
              即可并入广场，已识别页面现在就能浏览。
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {m.built ? (
            <>
              <Link href={`/practice?bank=${m.id}&mode=smart`} className="btn btn-primary">
                智能刷题
              </Link>
              <Link href={`/practice?bank=${m.id}&mode=recite`} className="btn">背题</Link>
              <Link href={`/wrong?bank=${m.id}`} className="btn">
                错题<span className="num text-muted">{m.wrongOpen}</span>
              </Link>
              <Link href={`/bank?bank=${m.id}`} className="btn">题库</Link>
            </>
          ) : (
            <Link href={`/book?bank=${m.id}`} className="btn">浏览已识别页面</Link>
          )}
        </div>
      </div>
    </article>
  );
}

export default function Plaza() {
  const modules = getModuleSummaries();
  const o = getOverview();
  const built = modules.filter((m) => m.built);
  const pending = modules.filter((m) => !m.built);
  const totalQuestions = modules.reduce((s, m) => s + m.questions, 0);
  const totalMaterials = modules.reduce((s, m) => s + m.materials, 0);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">题型广场</h1>
          <p className="mt-1 text-xs text-muted">
            行测各模块独立建库、独立进度、独立错题本 · {built.length}/{modules.length} 个模块已就绪 · {totalQuestions} 题
            {totalMaterials > 0 ? ` · ${totalMaterials} 段资料` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/practice?mode=exam&mixed=1" className="btn btn-primary">跨模块模考</Link>
          <Link href="/overview" className="btn">学习概览</Link>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "题库总量", value: String(totalQuestions), sub: `${built.length} 个模块已就绪` },
          { label: "已作答", value: String(o.answeredTotal), sub: `覆盖 ${o.coverage.toFixed(1)}%` },
          { label: "累计正确率", value: `${o.accuracy.toFixed(1)}%`, sub: `今日 ${o.todayCount} 题` },
          { label: "待复习错题", value: String(o.dueForReview), sub: `错题本共 ${o.wrongOpen} 题` },
        ].map((c) => (
          <div key={c.label} className="card p-4">
            <div className="text-xs text-muted">{c.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{c.value}</div>
            <div className="mt-0.5 text-[11px] text-muted">{c.sub}</div>
          </div>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {modules.map((m, i) => (
          <ModuleCard key={m.id} m={m} accent={ACCENTS[i % ACCENTS.length]} />
        ))}
      </section>

      {pending.length > 0 && (
        <p className="text-[11px] leading-relaxed text-muted">
          未就绪的模块显示的是真实识别进度而不是空壳：扫描 → OCR → 结构化 → 裁图 四阶段可断点续跑，
          任一阶段中断都不会污染已建好的模块。
        </p>
      )}

      <section className="card p-4">
        <h2 className="mb-2 text-sm font-medium">模块之间怎么区分</h2>
        <ul className="flex flex-col gap-1.5 text-[12px] leading-relaxed text-muted">
          <li>· 题号只在模块内部有意义，跨模块一律用「模块 + 章节 + 页码 + 原题号」定位，所以学习记录不会串台。</li>
          <li>· 资料分析的一段资料被若干小题共用，刷题时资料面板吸附在题目上方，同一组的题永远连续出现。</li>
          <li>· 表格与统计图都保留原书裁图，OCR 文字只作为可检索、可复制的图层，二者随时可对照。</li>
          <li>· 错题本、收藏、笔记、统计均可按模块切片，可以只看资料分析的错题。</li>
        </ul>
      </section>
    </div>
  );
}
