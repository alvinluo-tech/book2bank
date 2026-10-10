import Link from "next/link";
import { getBank, getQuestionsByPage } from "@/lib/bank";
import { BANK_LIST, sideOfTag } from "@/lib/banks";
import type { BookTag } from "@/lib/types";
import EmptyHint from "@/components/bank/EmptyHint";
import FlagBadges from "@/components/bank/FlagBadges";
import PageOverlay from "@/components/bank/PageOverlay";
import {
  bankLabel,
  bankTags,
  bookLabel,
  hrefWith,
  normalizeParams,
  numParam,
  pageSrc,
  pointLabel,
  readBank,
  rectsForPage,
  refForTag,
  sectionLabel,
  TONE_VARS,
} from "@/components/bank/helpers";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const FIELD = "rounded-lg border border-line bg-panel px-2.5 py-1.5 text-sm outline-none focus:border-brand";
const BTN = "btn px-2 py-1 text-xs";

export default async function BookPage({ searchParams }: { searchParams: SearchParams }) {
  const current = normalizeParams(await searchParams);

  // Bank scope comes from the URL; fall back to the first bank that actually has questions.
  const requested = readBank(current);
  const all = getBank();
  const bankId =
    requested ??
    BANK_LIST.find((b) => all.some((q) => q.bankId === b.id))?.id ??
    all[0]?.bankId;
  const bank = bankId ? getBank(bankId) : all;

  if (!all.length || !bankId) {
    return (
      <EmptyHint
        title="题库尚未构建，无法定位原书页"
        hint={
          <p className="leading-relaxed">
            页面浏览器依赖题库里的 pageRef / answerPageRef；请先运行{" "}
            <code className="chip">python pipeline/parse_bank.py</code>，再用{" "}
            <code className="chip">python pipeline/crop_images.py --pages</code> 导出扫描页。
          </p>
        }
        actionHref="/"
        actionLabel="返回概览"
      />
    );
  }

  // This bank's cache tags, read straight off its questions (上册/题目册 first).
  const tags: BookTag[] = bankTags(bank);
  const tag: BookTag = tags.includes(current.tag as BookTag) ? (current.tag as BookTag) : (tags[0] ?? "up");
  const page = Math.max(1, numParam(current, "page") ?? 1);

  // getQuestionsByPage matches 答案册 refs without checking the tag, so narrow it to this bank.
  const onPage = getQuestionsByPage(tag, page).filter((q) => q.bankId === bankId);
  const rects = rectsForPage(bank, tag, page);
  const bookPages = onPage
    .map((q) => refForTag(q, tag)?.bookPage)
    .filter((p): p is number => typeof p === "number");
  const missingBbox = onPage.length - rects.length;

  // pages this bank actually references — never hardcoded, always derived
  const referenced = new Set<number>();
  for (const q of bank) {
    const ref = refForTag(q, tag);
    if (ref && ref.tag === tag) referenced.add(ref.page);
  }
  const sorted = [...referenced].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const prevPage = sorted.filter((p) => p < page).pop();
  const nextPage = sorted.find((p) => p > page);

  const linkTo = (target: number, targetTag: BookTag = tag, targetBank = bankId) =>
    hrefWith("/book", { bank: targetBank, tag: targetTag, page: target });
  const src = pageSrc(tag, page);

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">原书页面浏览器</h1>
          <p className="mt-1 text-xs text-muted">
            <Link href={`/bank?bank=${encodeURIComponent(bankId)}`} className="hover:text-brand">
              {bankLabel(bankId)}
            </Link>
            {" · "}
            {bookLabel(tag)} · PDF 第 <span className="tabular-nums">{page}</span> 页
            {bookPages.length > 0 && (
              <>
                {" "}
                · 书页 <span className="tabular-nums">{bookPages[0]}</span>
              </>
            )}{" "}
            · 本页 <span className="tabular-nums">{onPage.length}</span> 题 ·{" "}
            <span className="tabular-nums">{rects.length}</span> 处坐标框
            {missingBbox > 0 && <span className="ml-1">（另 {missingBbox} 题无坐标框）</span>}
          </p>
        </div>
        <p className="max-w-md text-[11px] leading-relaxed text-muted">
          扫描图 <code>{src}</code> 为 115 dpi 渲染，标注框按 200 dpi OCR 坐标换算成百分比，缩放不失真。
        </p>
      </header>

      <div className="card flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
        <div className="flex items-center gap-1" role="group" aria-label="选择科目">
          {BANK_LIST.filter((b) => b.id === bankId || getBank(b.id).length > 0).map((b) => (
            <Link
              key={b.id}
              href={linkTo(page, tags.includes(current.tag as BookTag) ? tag : tags[0] ?? "up", b.id)}
              className={b.id === bankId ? `${BTN} border-brand bg-brand-soft text-brand` : BTN}
            >
              {b.title}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-1" role="group" aria-label="选择书本">
          {tags.map((value) => (
            <Link
              key={value}
              href={linkTo(page, value)}
              className={value === tag ? `${BTN} border-brand bg-brand-soft text-brand` : BTN}
            >
              {bookLabel(value)}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <Link href={linkTo(1)} className={page <= 1 ? `${BTN} pointer-events-none opacity-40` : BTN}>
            首页
          </Link>
          <Link href={linkTo(page - 1)} className={page <= 1 ? `${BTN} pointer-events-none opacity-40` : BTN}>
            上一页
          </Link>
          <Link href={linkTo(page + 1)} className={BTN}>
            下一页
          </Link>
        </div>

        <form method="get" action="/book" className="flex items-center gap-1">
          <input type="hidden" name="bank" value={bankId} />
          <input type="hidden" name="tag" value={tag} />
          <label className="text-muted" htmlFor="book-page">
            跳至
          </label>
          <input
            id="book-page"
            type="number"
            name="page"
            defaultValue={page}
            min={1}
            step={1}
            className={`${FIELD} w-24 tabular-nums`}
          />
          <span className="text-muted">页</span>
          <button type="submit" className={BTN}>
            跳转
          </button>
        </form>

        <div className="ml-auto flex items-center gap-1">
          {prevPage !== undefined && <Link href={linkTo(prevPage)} className={BTN}>有题上一页 · {prevPage}</Link>}
          {nextPage !== undefined && <Link href={linkTo(nextPage)} className={BTN}>有题下一页 · {nextPage}</Link>}
          {first !== undefined && last !== undefined && (
            <span className="tabular-nums text-muted">
              该册覆盖 {sorted.length} 页 · {first}-{last}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col items-start gap-3 xl:flex-row">
        <div className="min-w-0 flex-1">
          <PageOverlay tag={tag} page={page} rects={rects} />
        </div>

        <aside className="w-full shrink-0 xl:w-[340px]">
          <div className="card flex max-h-[calc(100vh-9rem)] flex-col overflow-hidden">
            <div className="flex items-baseline justify-between border-b border-line px-3 py-2">
              <h2 className="text-xs font-medium">本页题目</h2>
              <span className="text-[11px] tabular-nums text-muted">{onPage.length} 题</span>
            </div>
            {onPage.length === 0 ? (
              <div className="p-3">
                <p className="text-xs leading-relaxed text-muted">
                  {bookLabel(tag)}第 {page} 页没有匹配到题目。
                  {nextPage !== undefined ? (
                    <>
                      可跳转到{" "}
                      <Link href={linkTo(nextPage)} className="text-brand">
                        有题的第 {nextPage} 页
                      </Link>
                      。
                    </>
                  ) : null}
                  若该页确实有题，说明 OCR 或解析尚未推进到这里。
                </p>
              </div>
            ) : (
              <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
                {onPage.map((q) => (
                  <li key={q.id} className="px-3 py-2">
                    <Link href={`/question/${encodeURIComponent(q.id)}`} className="block hover:text-brand">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-xs">
                          <span className="tabular-nums font-medium">第 {q.num} 题</span>
                          <span className="ml-1 text-muted">
                            第{q.chapterIndex}章 {q.chapterTitle} › {sectionLabel(q)} › {pointLabel(q)}
                          </span>
                        </span>
                        <span
                          className="chip shrink-0 tabular-nums"
                          style={
                            q.answer
                              ? { color: TONE_VARS.info.fg, borderColor: TONE_VARS.info.fg }
                              : { color: TONE_VARS.bad.fg, borderColor: TONE_VARS.bad.fg }
                          }
                        >
                          {q.answer ?? "缺"}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted">{q.stem}</p>
                      <FlagBadges flags={q.flags} max={4} className="mt-1" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="mt-2 px-1 text-[11px] leading-relaxed text-muted">
            标注框对应 OCR 记录的题目区域：{sideOfTag(tag) === "up" ? "题目册取 pageRef" : "答案册取 answerPageRef"}
            ；点击框或列表条目进入题目详情。
          </p>
        </aside>
      </div>
    </div>
  );
}
