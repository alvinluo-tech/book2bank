import Link from "next/link";
import clsx from "clsx";
import type { ReactNode } from "react";
import { BANK_LIST, bankDef } from "@/lib/banks";
import type { BankLayout } from "@/lib/banks";
import {
  EVIDENCE_GRADES,
  getAllVerificationSummaries,
  getSuspectRows,
  type EvidenceGrade,
  type SuspectRow,
  type VerificationSummary,
} from "@/lib/verification";
import { normalizeParams, readBank, TONE_VARS, type Filters } from "@/components/bank/helpers";
import {
  EVIDENCE_COLOR,
  EVIDENCE_INFO,
  noteLabel,
  reasonClass,
  reasonInfo,
} from "@/components/verification/info";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const LAYOUT_LABEL: Record<BankLayout, string> = {
  flat: "单题四选项",
  "material-group": "一段资料带一组小题",
};

/** Keep every active filter when navigating; `null` clears a key (mirrors buildHref's contract). */
function vHref(current: Filters, overrides: Record<string, string | null>): string {
  const merged: Filters = { ...current };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) delete merged[k];
    else merged[k] = v;
  }
  delete merged.offset; // this page lists everything, no pagination to carry
  const qs = new URLSearchParams(merged).toString();
  return qs ? `/verification?${qs}` : "/verification";
}

function FilterChip({
  href,
  active,
  tone,
  children,
}: {
  href: string;
  active: boolean;
  tone?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={clsx("chip hover:border-brand hover:text-brand", active && "border-brand font-medium text-brand")}
      style={active ? { color: "var(--brand)", borderColor: "var(--brand)" } : undefined}
    >
      {tone && (
        <span aria-hidden className="mr-0.5 inline-block h-1.5 w-1.5 rounded-full" style={{ background: tone }} />
      )}
      {children}
    </Link>
  );
}

/** Evidence grades as one stacked bar plus clickable counts. */
function EvidenceBar({ s, bankId, current }: { s: VerificationSummary; bankId: string; current: Filters }) {
  const total = Math.max(1, s.questions);
  return (
    <div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-line">
        {EVIDENCE_GRADES.map((g) => {
          const n = s.evidence[g] ?? 0;
          if (!n) return null;
          return (
            <div
              key={g}
              title={`${EVIDENCE_INFO[g].label} ${n} 题`}
              style={{ width: `${(n / total) * 100}%`, background: EVIDENCE_COLOR[g] }}
            />
          );
        })}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
        {EVIDENCE_GRADES.map((g) => {
          const n = s.evidence[g];
          if (!n) return null;
          const active = current.ev === g && readBank(current) === bankId;
          return (
            <Link
              key={g}
              href={vHref(current, { bank: bankId, ev: active ? null : g, reason: null })}
              className={clsx("chip", active && "font-medium")}
              style={{ color: EVIDENCE_COLOR[g], borderColor: active ? EVIDENCE_COLOR[g] : undefined }}
              title={EVIDENCE_INFO[g].help}
            >
              {EVIDENCE_INFO[g].label} <span className="tabular-nums">{n}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function SummaryCard({
  bankId,
  s,
  current,
}: {
  bankId: string;
  s: VerificationSummary;
  current: Filters;
}) {
  const active = readBank(current) === bankId;
  const reasonEntries = Object.entries(s.reasons).sort((a, b) => b[1] - a[1]);
  const pct = s.questions ? (s.verified / s.questions) * 100 : 0;
  return (
    <article className={clsx("card flex flex-col gap-3 p-4", active && "border-brand")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={vHref(current, { bank: active ? null : bankId, reason: null, ev: null })}
            className="block truncate text-[15px] font-semibold tracking-tight hover:text-brand"
          >
            {bankDef(bankId).title}
          </Link>
          <p className="mt-0.5 text-[11px] text-muted tabular-nums">
            {s.questions} 题 · {LAYOUT_LABEL[s.layout]} · 通过 {pct.toFixed(1)}%
          </p>
        </div>
        {s.suspect ? (
          <span
            className="chip shrink-0 tabular-nums"
            style={{ color: TONE_VARS.bad.fg, borderColor: TONE_VARS.bad.fg }}
          >
            可疑 {s.suspect}
          </span>
        ) : (
          <span className="chip shrink-0" style={{ color: TONE_VARS.ok.fg, borderColor: TONE_VARS.ok.fg }}>
            全部通过
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 text-[11px]">
        <span className="chip tabular-nums" title={s.questions ? `已配对答案 ${s.withAnswer} / ${s.questions} 题` : undefined}>
          已配对答案 {s.withAnswer}/{s.questions}
        </span>
        <span className="chip tabular-nums">无问题 {s.verified}</span>
        <span
          className="chip tabular-nums"
          title="答案册那一页确实印着「N.【答案】本记录的答案字母」，且该编号在这一页同一高度只被一道题使用，且字母在印出的选项里 —— 三条同时成立即为「印刷锚点已证」，与题号对齐逻辑无关"
        >
          印刷锚点已证 {s.anchorProven}
          {s.needsEyes > 0 && (
            <span style={{ color: "var(--warn)" }}> · 需核对原页 {s.needsEyes}</span>
          )}
          {s.optionsIncomplete > 0 && (
            <span title="OCR 漏读整行选项：答案字母不在已识别的选项里，作答时会自动改展示原书整题图">
              {" · 选项不全 " + s.optionsIncomplete}
            </span>
          )}
        </span>
        {s.materials > 0 && <span className="chip tabular-nums">{s.materials} 段资料</span>}
        <span className="chip tabular-nums" title="答案册 OCR 到的 N.【答案】 锚点总数">
          印刷锚点 {s.printedAnchors}
        </span>
        <span
          className="chip tabular-nums"
          style={s.unclaimedAnchors ? { color: TONE_VARS.warn.fg, borderColor: TONE_VARS.warn.fg } : undefined}
          title={`答案册上印了却没配给任何题目的锚点，多为漏建题；样例：${s.unclaimedSample.join(" ")}${
            s.unclaimedAnchors > s.unclaimedSample.length ? " …" : ""
          }`}
        >
          未认领锚点 {s.unclaimedAnchors}
        </span>
      </div>

      <EvidenceBar s={s} bankId={bankId} current={current} />

      {reasonEntries.length > 0 && (
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          {reasonEntries.map(([cls, n]) => (
            <Link
              key={cls}
              href={vHref(current, { bank: bankId, reason: cls, ev: null })}
              className="chip"
              style={{ color: TONE_VARS[reasonInfo(cls).tone].fg }}
              title={reasonInfo(cls).help}
            >
              {reasonInfo(cls).label} <span className="tabular-nums">{n}</span>
            </Link>
          ))}
        </div>
      )}
    </article>
  );
}

function SuspectRowItem({ r }: { r: SuspectRow }) {
  const ev = EVIDENCE_INFO[r.evidence];
  return (
    <li className="border-b border-line last:border-0">
      <Link
        href={`/question/${encodeURIComponent(r.id)}`}
        className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-xs hover:text-brand"
      >
        <span className="w-16 shrink-0 truncate text-muted">{bankDef(r.bankId).title}</span>
        <span className="shrink-0 tabular-nums">
          第{r.chapter}章 · 原题号 {r.num}
        </span>
        <span className="chip shrink-0 tabular-nums" title={ev.help} style={{ color: EVIDENCE_COLOR[r.evidence] }}>
          {ev.label}
        </span>
        <span
          className="chip shrink-0 tabular-nums"
          style={r.answer ? undefined : { color: TONE_VARS.bad.fg, borderColor: TONE_VARS.bad.fg }}
        >
          {r.answer ? `答案 ${r.answer}` : "缺答案"}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted" title={r.reasons.join(" / ")}>
          {r.reasons.join(" · ")}
        </span>
        {r.notes.length > 0 && (
          <span
            className="shrink-0 text-[11px] text-muted"
            title={`提示：${r.notes.map((n) => `${n}（${noteLabel(n)}）`).join("、")}`}
          >
            提示 {r.notes.length}
          </span>
        )}
        <span className="shrink-0 text-muted" aria-hidden>
          →
        </span>
      </Link>
    </li>
  );
}

export default async function VerificationPage({ searchParams }: { searchParams: SearchParams }) {
  const current = normalizeParams(await searchParams);
  const summaries = getAllVerificationSummaries();
  const loaded = new Map(summaries.map((x) => [x.bankId, x.summary]));
  const waiting = BANK_LIST.filter((b) => !loaded.has(b.id));

  const bankId = readBank(current);
  const evParam = current.ev;
  const ev = evParam && (EVIDENCE_GRADES as readonly string[]).includes(evParam) ? (evParam as EvidenceGrade) : undefined;
  const reason = current.reason || undefined;

  const scoped = getSuspectRows(bankId).filter((r) => !ev || r.evidence === ev);

  // 一题可命中多个原因：每个原因组都列出它，组内不重复。
  const byClass = new Map<string, SuspectRow[]>();
  for (const r of scoped) {
    for (const cls of new Set(r.reasons.map(reasonClass))) {
      byClass.set(cls, [...(byClass.get(cls) ?? []), r]);
    }
  }
  const groups = [...byClass.entries()]
    .map(([cls, rows]) => ({ cls, rows }))
    .sort((a, b) => b.rows.length - a.rows.length || a.cls.localeCompare(b.cls));
  const shownGroups = reason ? groups.filter((g) => g.cls === reason) : groups;

  const totals = summaries.reduce(
    (acc, { summary: s }) => ({
      questions: acc.questions + s.questions,
      verified: acc.verified + s.verified,
      suspect: acc.suspect + s.suspect,
      withAnswer: acc.withAnswer + s.withAnswer,
    }),
    { questions: 0, verified: 0, suspect: 0, withAnswer: 0 },
  );
  const hasFilters = Boolean(bankId || ev || reason);

  if (!summaries.length) {
    return (
      <div className="card p-8">
        <h1 className="text-lg font-semibold">数据校验</h1>
        <p className="mt-2 text-sm text-muted">
          还没有任何 verification.json。先运行 <code className="chip">python pipeline/verify_bank.py</code>{" "}
          生成 data/banks/&lt;科目&gt;/verification.json（逐题核对题目册 ↔ 答案册的配对证据）。
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">数据校验</h1>
          <p className="mt-1 text-xs text-muted">
            pipeline/verify_bank.py 的逐题判定：完整性 + 题目 ↔ 答案配对证据 · 已校验 {summaries.length}/
            {BANK_LIST.length} 个模块 · <span className="tabular-nums">{totals.questions}</span> 题中{" "}
            <span className="tabular-nums" style={{ color: TONE_VARS.ok.fg }}>
              {totals.verified}
            </span>{" "}
            题无问题、
            <span className="tabular-nums" style={{ color: TONE_VARS.bad.fg }}>
              {totals.suspect}
            </span>{" "}
            题可疑 · 答案配对 <span className="tabular-nums">{totals.withAnswer}/{totals.questions}</span>
            {waiting.length ? ` · ${waiting.map((b) => b.title).join("、")} 尚未校验` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {hasFilters && (
            <Link href={vHref(current, { bank: null, reason: null, ev: null })} className="btn">
              清除筛选
            </Link>
          )}
          <Link href="/bank" className="btn">
            题库浏览器
          </Link>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {BANK_LIST.flatMap((b) => {
          const s = loaded.get(b.id);
          if (!s) {
            return [
              <article key={b.id} className="card flex flex-col justify-center gap-1 p-4 text-center">
                <div className="text-sm font-medium">{b.title}</div>
                <div className="text-[11px] text-muted">
                  尚未校验 · <code className="chip">python pipeline/verify_bank.py --bank {b.id}</code>
                </div>
              </article>,
            ];
          }
          return [<SummaryCard key={b.id} bankId={b.id} s={s} current={current} />];
        })}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-sm font-medium">
            可疑题目 <span className="tabular-nums text-muted">({scoped.length} 题，按原因分组)</span>
          </h2>
          <p className="text-[11px] text-muted">一题可同时命中多个原因，会出现在多个分组里。</p>
        </div>

        <div className="card flex flex-col gap-2 p-3 text-[11px]">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-14 shrink-0 text-muted">模块</span>
            <FilterChip href={vHref(current, { bank: null, reason: null, ev: null })} active={!bankId}>
              全部
            </FilterChip>
            {summaries.map(({ bankId: id, title }) => (
              <FilterChip
                key={id}
                href={vHref(current, { bank: id, reason: null, ev: null })}
                active={bankId === id}
              >
                {title}
              </FilterChip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-14 shrink-0 text-muted">证据</span>
            <FilterChip href={vHref(current, { ev: null, reason: null })} active={!ev}>
              全部
            </FilterChip>
            {EVIDENCE_GRADES.map((g) => {
              const n = scoped.filter((r) => r.evidence === g).length;
              if (!n) return null;
              return (
                <FilterChip key={g} href={vHref(current, { ev: g, reason: null })} active={ev === g} tone={EVIDENCE_COLOR[g]}>
                  {EVIDENCE_INFO[g].label} <span className="tabular-nums">{n}</span>
                </FilterChip>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-14 shrink-0 text-muted">原因</span>
            <FilterChip href={vHref(current, { reason: null })} active={!reason}>
              全部 {groups.length} 类
            </FilterChip>
            {groups.map((g) => (
              <FilterChip key={g.cls} href={vHref(current, { reason: g.cls, ev: null })} active={reason === g.cls}>
                {reasonInfo(g.cls).label} <span className="tabular-nums">{g.rows.length}</span>
              </FilterChip>
            ))}
          </div>
        </div>

        {shownGroups.length === 0 ? (
          <div className="card p-6 text-center text-xs text-muted">
            {scoped.length === 0 ? (
              <>当前筛选范围内没有可疑题目{hasFilters ? "，可放宽条件再看。" : "——全部通过逐题校验。"}</>
            ) : (
              <>没有命中该原因类的题目，<Link href={vHref(current, { reason: null })} className="text-brand">回到全部原因</Link>。</>
            )}
          </div>
        ) : (
          shownGroups.map((g) => {
            const info = reasonInfo(g.cls);
            return (
              <section key={g.cls} className="card p-4">
                <h2 className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <span style={{ color: TONE_VARS[info.tone].fg }}>{info.label}</span>
                  <span className="chip tabular-nums">{g.rows.length} 题</span>
                  <code className="text-[11px] font-normal text-muted">{g.cls}</code>
                  {reason === g.cls && (
                    <Link href={vHref(current, { reason: null })} className="ml-auto text-[11px] text-brand">
                      查看全部原因 →
                    </Link>
                  )}
                </h2>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">{info.help}</p>
                <ul className="mt-2 flex flex-col">
                  {g.rows.map((r) => (
                    <SuspectRowItem key={`${r.bankId}-${r.id}`} r={r} />
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </section>

      <section className="card p-4">
        <h2 className="mb-2 text-sm font-medium">证据等级怎么读</h2>
        <ul className="flex flex-col gap-1.5 text-[12px] leading-relaxed text-muted">
          {EVIDENCE_GRADES.map((g) => (
            <li key={g} className="flex gap-2">
              <span className="shrink-0 font-medium" style={{ color: EVIDENCE_COLOR[g] }}>
                {EVIDENCE_INFO[g].label}
              </span>
              <span>{EVIDENCE_INFO[g].help}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-line pt-2 text-[11px] leading-relaxed text-muted">
          判定来自 <code className="chip">python pipeline/verify_bank.py</code> 写入的{" "}
          data/banks/&lt;科目&gt;/verification.json；原因 chip 的括注即流水线记录的判值。
          证据等级与「可疑」相互独立：图形题常是「文字不可测」但并非配对有错。
        </p>
      </section>
    </div>
  );
}
