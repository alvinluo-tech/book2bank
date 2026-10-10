import Link from "next/link";
import { getBank, getMeta, getMetas, queryQuestions } from "@/lib/bank";
import { BANK_LIST, chapterKey } from "@/lib/banks";
import { getDb, getSmartQueue, listFavoriteIds, listWrongIds } from "@/lib/db";
import type { Question } from "@/lib/types";
import EmptyHint from "@/components/bank/EmptyHint";
import FilterBar from "@/components/bank/FilterBar";
import Pagination from "@/components/bank/Pagination";
import QuestionRow, { type RowState } from "@/components/bank/QuestionRow";
import TaxonomyTree from "@/components/bank/TaxonomyTree";
import {
  bankFlags,
  bankLabel,
  buildHref,
  buildTaxonomy,
  hrefWith,
  inTaxonomy,
  normalizeParams,
  numParam,
  readBank,
  readKind,
  readLimit,
  readOffset,
  readStatus,
  UNSET,
} from "@/components/bank/helpers";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** ids → last recorded answer, one row per question. */
function lastAttempts(): Map<string, { answer: string | null; correct: boolean }> {
  const rows = getDb()
    .prepare(
      `SELECT question_id, answer, correct FROM attempts
       WHERE id IN (SELECT MAX(id) FROM attempts GROUP BY question_id)`,
    )
    .all() as { question_id: string; answer: string | null; correct: number }[];
  return new Map(rows.map((r) => [r.question_id, { answer: r.answer, correct: !!r.correct }]));
}

function wrongCounts(): Map<string, number> {
  const rows = getDb().prepare(`SELECT question_id, wrong_count FROM wrong_book`).all() as {
    question_id: string;
    wrong_count: number;
  }[];
  return new Map(rows.map((r) => [r.question_id, r.wrong_count]));
}

export default async function BankPage({ searchParams }: { searchParams: SearchParams }) {
  const current = normalizeParams(await searchParams);
  const all = getBank();
  // No 题库 selected in the URL means “全部题库”; the tree always shows every bank.
  const bankId = readBank(current);
  const scope = bankId ? all.filter((item) => item.bankId === bankId) : all;
  const metas = getMetas();
  const meta = bankId ? getMeta(bankId) : null;

  if (!all.length) {
    return (
      <EmptyHint
        title="题库尚未构建"
        hint={
          <p className="leading-relaxed">
            先运行 <code className="chip">python pipeline/build.py</code>（OCR → parse_bank → crop_images）
            生成各科目题库与图片资源。
          </p>
        }
        actionHref="/"
        actionLabel="返回概览"
      />
    );
  }

  const status = readStatus(current);
  const kind = readKind(current);
  const chapter = numParam(current, "chapter");
  const section = current.section;
  const point = current.point;
  const limit = readLimit(current);
  const offset = readOffset(current, limit);

  const last = lastAttempts();
  const wrong = wrongCounts();
  const favoriteIds = new Set(listFavoriteIds());

  // Same pool semantics as GET /api/bank/questions?status=…
  let pool: Question[] | undefined;
  if (status === "answered") pool = scope.filter((item) => last.has(item.id));
  else if (status === "unanswered") pool = scope.filter((item) => !last.has(item.id));
  else if (status === "wrong") {
    const ids = new Set(listWrongIds("open"));
    pool = scope.filter((item) => ids.has(item.id));
  } else if (status === "favorite") pool = scope.filter((item) => favoriteIds.has(item.id));
  else if (status === "smart") {
    const key = bankId && chapter !== undefined ? chapterKey(bankId, chapter) : undefined;
    pool = getSmartQueue(key, 500).filter((item) => !bankId || item.bankId === bankId);
  }

  const scoped = (pool ?? scope).filter((item) => inTaxonomy(item, { bank: bankId, chapter, section, point }));
  const search = { kind, q: current.q, flag: current.flag, limit };
  let pageOffset = offset;
  let result = queryQuestions({ ...search, offset: pageOffset }, scoped);
  // a stale offset (narrower filter or smaller page size) would show an empty list
  if (result.total > 0 && result.items.length === 0) {
    pageOffset = Math.max(0, Math.floor((result.total - 1) / limit) * limit);
    result = queryQuestions({ ...search, offset: pageOffset }, scoped);
  }
  const { total, items } = result;

  const taxonomy = buildTaxonomy(all, new Set(last.keys()));
  const flags = bankFlags(scope);
  const bankCounts = BANK_LIST.filter((b) => all.some((item) => item.bankId === b.id)).map((b) => ({
    id: b.id,
    title: b.title,
    count: all.filter((item) => item.bankId === b.id).length,
  }));

  // 刷题 scope: taxonomy is expressible in /practice params, the 未分类 sentinel is not.
  const practiceHref = hrefWith("/practice", {
    bank: bankId,
    chapter,
    section: section === UNSET ? null : section,
    point: point === UNSET ? null : point,
    kind,
    mode: status === "wrong" ? "wrong" : status === "smart" ? "smart" : null,
  });

  const totals = meta
    ? meta.totals
    : metas.reduce(
        (acc, m) => ({
          questions: acc.questions + m.totals.questions,
          withAnswer: acc.withAnswer + m.totals.withAnswer,
          withAnalysis: acc.withAnalysis + m.totals.withAnalysis,
          withFigure: acc.withFigure + m.totals.withFigure,
          pagesOcr: acc.pagesOcr + m.totals.pagesOcr,
        }),
        { questions: 0, withAnswer: 0, withAnalysis: 0, withFigure: 0, pagesOcr: 0 },
      );

  return (
    <div className="flex items-start gap-4">
      <aside className="sticky top-6 hidden w-[264px] shrink-0 lg:block">
        <TaxonomyTree banks={taxonomy} current={current} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              题库浏览器 · {meta?.subject ?? (bankId ? bankLabel(bankId) : "全部题库")}
            </h1>
            <p className="mt-1 text-xs text-muted">
              <span className="tabular-nums">{totals.questions}</span> 题 ·{" "}
              <span className="tabular-nums">{totals.withFigure}</span> 题含图形 ·{" "}
              <span className="tabular-nums">{totals.withAnswer}</span> 题有答案 ·{" "}
              <span className="tabular-nums">{totals.withAnalysis}</span> 题有解析
              {meta?.builtAt ? <span className="ml-1">· 构建于 {meta.builtAt.replace("T", " ")}</span> : null}
            </p>
          </div>
          <div className="flex gap-2">
            <Link href={practiceHref} className="btn btn-primary">
              开始刷这部分
            </Link>
            <Link href={hrefWith("/book", { bank: bankId })} className="btn">
              原书页面
            </Link>
          </div>
        </header>

        <details className="card px-3 py-2 lg:hidden">
          <summary className="cursor-pointer text-sm font-medium">章节筛选</summary>
          <div className="mt-2">
            <TaxonomyTree banks={taxonomy} current={current} />
          </div>
        </details>

        <FilterBar current={current} flags={flags} banks={bankCounts} total={total} />

        {total === 0 ? (
          <EmptyHint
            title={scoped.length ? "没有同时满足这些条件的题目" : "该范围内暂无题目"}
            hint={
              <p className="leading-relaxed">
                {scoped.length ? (
                  <>
                    章节范围内有 <span className="tabular-nums">{scoped.length}</span> 题，但关键词、题型、
                    作答状态与识别标记的组合把它们全部筛掉了；OCR 仍在进行时，缺答案的章节也会随构建减少。
                  </>
                ) : (
                  <>
                    当前筛选条件命中的题库范围为 0 题。OCR 尚未覆盖该章节时会出现这种情况，
                    可先运行流水线或直接放宽条件。
                  </>
                )}
              </p>
            }
            actionHref={buildHref(current, { q: null, kind: null, status: null, flag: null, offset: null })}
            actionLabel="放宽条件：清除关键词与筛选"
            secondaryHref="/bank"
            secondaryLabel="清除全部筛选"
          />
        ) : (
          <div className="flex flex-col gap-2">
            {items.map((item) => (
              <QuestionRow
                key={item.id}
                q={item}
                state={
                  {
                    last: last.get(item.id),
                    wrongCount: wrong.get(item.id),
                    favorite: favoriteIds.has(item.id),
                  } satisfies RowState
                }
              />
            ))}
          </div>
        )}

        <Pagination total={total} limit={limit} offset={pageOffset} current={current} />

        <p className="text-[11px] leading-relaxed text-muted">
          列表按原书排版顺序排列；点击任意行进入题目详情，可查看解析、粉笔大数据正确率与原书裁剪图。
          质量标记为流水线识别信号，不代表数据错误。
        </p>
      </div>
    </div>
  );
}
