import Link from "next/link";
import { notFound } from "next/navigation";
import { getBank, getMaterial, getQuestion, materialSiblings } from "@/lib/bank";
import { bankDef } from "@/lib/banks";
import { getDb } from "@/lib/db";
import type { PracticeMode } from "@/lib/types";
import AccuracyChip from "@/components/bank/AccuracyChip";
import FlagBadges from "@/components/bank/FlagBadges";
import QuestionRow from "@/components/bank/QuestionRow";
import SmartImage from "@/components/bank/SmartImage";
import MaterialPanel from "@/components/practice/MaterialPanel";
import VerificationBadge from "@/components/verification/VerificationBadge";
import {
  bookLabel,
  cropSrc,
  figureSrc,
  flagInfo,
  fmtAccuracy,
  fmtConfidence,
  hrefWith,
  pointLabel,
  sectionLabel,
  sourceText,
  TONE_VARS,
} from "@/components/bank/helpers";

export const dynamic = "force-dynamic";

const MODE_LABEL: Record<PracticeMode, string> = {
  recite: "背题",
  instant: "即时",
  exam: "模考",
  wrong: "错题重做",
  random: "随机",
  smart: "智能推荐",
};

interface AttemptRow {
  id: number;
  correct: boolean;
  answer: string | null;
  mode: string;
  durationMs: number;
  createdAt: string;
}

export default async function QuestionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const question = getQuestion(id);
  if (!question) notFound();

  const db = getDb();
  const attempts: AttemptRow[] = (
    db
      .prepare(
        `SELECT id, answer, correct, mode, duration_ms, created_at FROM attempts
         WHERE question_id = ? ORDER BY id DESC LIMIT 20`,
      )
      .all(id) as Record<string, unknown>[]
  ).map((r) => ({
    id: Number(r.id),
    answer: (r.answer as string | null) ?? null,
    correct: !!r.correct,
    mode: String(r.mode ?? "instant"),
    durationMs: Number(r.duration_ms ?? 0),
    createdAt: String(r.created_at ?? ""),
  }));

  const wrongRow = db
    .prepare(`SELECT wrong_count, box, status, first_at, last_at, next_review, note FROM wrong_book WHERE question_id = ?`)
    .get(id) as
    | { wrong_count: number; box: number; status: string; first_at: string; last_at: string; next_review: string | null; note: string | null }
    | undefined;
  const favoriteRow = db.prepare(`SELECT added_at FROM favorites WHERE question_id = ?`).get(id) as
    | { added_at: string }
    | undefined;
  const noteRow = db.prepare(`SELECT text, updated_at FROM notes WHERE question_id = ?`).get(id) as
    | { text: string; updated_at: string }
    | undefined;
  const tags = (
    db
      .prepare(`SELECT t.name FROM tags t JOIN question_tags qt ON qt.tag_id = t.id WHERE qt.question_id = ? ORDER BY t.name`)
      .all(id) as { name: string }[]
  ).map((t) => t.name);

  const bank = getBank(question.bankId);
  const siblings = bank
    .filter((item) => item.chapterIndex === question.chapterIndex)
    .sort((a, b) => a.num - b.num || a.id.localeCompare(b.id));
  const idx = siblings.findIndex((item) => item.id === question.id);
  const prev = idx > 0 ? siblings[idx - 1] : null;
  const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;

  const source = sourceText(question.source);
  const figure = figureSrc(question);
  const crop = cropSrc(question);
  const textOptions = question.options.filter((o) => o.text);
  const hasFigureOptions = question.options.length === 0 || textOptions.length === 0;
  // OCR drops whole option lines — usually the correct one — so the stored answer can sit
  // outside the parsed options. That must be said out loud instead of showing three
  // options against a fourth letter, which reads as "the book is wrong".
  const answerMissingOption =
    !!question.answer &&
    question.options.length > 0 &&
    !question.options.some((o) => o.label === question.answer);
  const bankHref = (extra: Record<string, string | number | null | undefined>) =>
    hrefWith("/bank", { bank: question.bankId, ...extra });

  /**
   * 资料分析：一干多题共用一段资料。其它模块没有 materialId，
   * material 为 null、group 为空，页面与本功能之前完全一致。
   */
  const material = getMaterial(question.materialId);
  const group = materialSiblings(question.materialId);
  const groupIndex = group.findIndex((item) => item.id === question.id) + 1;
  const groupHref = hrefWith("/practice", {
    ids: group.map((item) => item.id).join(","),
    mode: "instant",
  });

  const crumbs = [
    { label: `第 ${question.chapterIndex} 章 ${question.chapterTitle}`, href: bankHref({ chapter: question.chapterIndex }) },
    {
      label: sectionLabel(question),
      href: bankHref({ chapter: question.chapterIndex, section: sectionLabel(question) }),
    },
    {
      label: pointLabel(question),
      href: bankHref({
        chapter: question.chapterIndex,
        section: sectionLabel(question),
        point: pointLabel(question),
      }),
    },
  ];

  const practiceHref = hrefWith("/practice", {
    ids: question.id,
    mode: "recite",
  });
  const bookHref = question.pageRef
    ? hrefWith("/book", { bank: question.bankId, tag: question.pageRef.tag, page: question.pageRef.page })
    : null;
  const answerBookHref = question.answerPageRef
    ? hrefWith("/book", { bank: question.bankId, tag: question.answerPageRef.tag, page: question.answerPageRef.page })
    : null;

  return (
    <div className="flex flex-col gap-4">
      <nav className="flex flex-wrap items-center gap-1 text-xs text-muted" aria-label="章节路径">
        <Link href={`/bank?bank=${question.bankId}`} className="hover:text-brand">
          题库
        </Link>
        {crumbs.map((c) => (
          <span key={c.label} className="flex items-center gap-1">
            <span aria-hidden>›</span>
            <Link href={c.href} className="hover:text-brand">
              {c.label}
            </Link>
          </span>
        ))}
        <span aria-hidden>›</span>
        <span className="tabular-nums">第 {question.num} 题</span>
      </nav>

      <header className="card flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold tabular-nums">
              第 {question.num} 题 · {question.kind === "figure" ? "图形题" : "文字题"}
            </h1>
            <span className="chip">{bankDef(question.bankId).title}</span>
            <span className="chip">{question.id}</span>
            {question.materialId && (
              <span
                className="chip tabular-nums"
                style={
                  material
                    ? { color: "var(--brand)", borderColor: "var(--brand)" }
                    : { color: "var(--warn)" }
                }
              >
                {material
                  ? `同组 ${group.length} 题 · 本题第 ${groupIndex || 1} 题`
                  : `资料引用已失效 ${question.materialId}`}
              </span>
            )}
            {question.drillTitle && <span className="chip">专项 {question.drillTitle}</span>}
            {source && <span className="chip">来源 {source}</span>}
            {question.accuracy === null ? (
              <span style={{ color: TONE_VARS.muted.fg }} className="chip">
                无大数据
              </span>
            ) : (
              <AccuracyChip value={question.accuracy} trap={question.trapOption} prefix="粉笔正确率" />
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Link href={practiceHref} className="btn btn-primary">
              去刷题
            </Link>
            {bookHref && <Link href={bookHref} className="btn">查看原书页（题目册）</Link>}
            {answerBookHref && <Link href={answerBookHref} className="btn">查看解析页（答案册）</Link>}
            {crop && (
              <a href={crop} target="_blank" rel="noreferrer" className="btn">
                对照原书裁剪图
              </a>
            )}
            <Link href="/wrong" className="btn">
              错题本
            </Link>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 text-right text-xs">
          <span
            style={
              question.answer
                ? { color: TONE_VARS.info.fg, borderColor: TONE_VARS.info.fg }
                : { color: TONE_VARS.bad.fg, borderColor: TONE_VARS.bad.fg }
            }
            className="chip text-sm"
          >
            {question.answer ? `答案 ${question.answer}` : "答案缺失"}
          </span>
          {attempts.length > 0 && (
            <span className="tabular-nums text-muted">
              本地作答 {attempts.length} 次 · 最近一次{" "}
              <span style={{ color: attempts[0].correct ? TONE_VARS.ok.fg : TONE_VARS.bad.fg }}>
                {attempts[0].correct ? "正确" : `选了 ${attempts[0].answer ?? "未答"}`}
              </span>
            </span>
          )}
          {attempts.length === 0 && <span className="text-muted">本地尚未作答</span>}
          <FlagBadges flags={question.flags} />
          <VerificationBadge bankId={question.bankId} questionId={question.id} />
        </div>
      </header>

      {/* 资料分析的共享资料：一段资料带一组小题，题干之前先把它摊开 */}
      {question.materialId &&
        (material ? (
          <>
            <MaterialPanel
              material={material}
              group={group.length > 1 ? { index: groupIndex || 1, total: group.length } : null}
            />
            {group.length > 1 && (
              <section className="card p-3">
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-muted">同一资料的小题（按原题号，建议连着做）</span>
                  {group.map((item) =>
                    item.id === question.id ? (
                      <span
                        key={item.id}
                        className="chip border-brand/50 bg-brand-soft tabular-nums text-brand"
                      >
                        第 {item.num} 题
                      </span>
                    ) : (
                      <Link
                        key={item.id}
                        href={`/question/${encodeURIComponent(item.id)}`}
                        className="chip tabular-nums hover:border-brand hover:text-brand"
                      >
                        第 {item.num} 题
                      </Link>
                    ),
                  )}
                  <Link href={groupHref} className="btn ml-auto px-2 py-1 text-xs">
                    整组连刷 →
                  </Link>
                </div>
              </section>
            )}
          </>
        ) : (
          <div className="card p-3 text-xs leading-relaxed text-muted">
            本题引用资料 <code className="font-mono">{question.materialId}</code>
            ，但题库里已经没有这段资料——通常是重建题库后资料 id 变了。
            {question.pageRef && (
              <Link
                href={hrefWith("/book", {
                  bank: question.bankId,
                  tag: question.pageRef.tag,
                  page: question.pageRef.page,
                })}
                className="chip ml-1.5 hover:border-brand hover:text-brand"
              >
                回到原书第 {question.pageRef.page} 页查看 →
              </Link>
            )}
          </div>
        ))}

      <section className="card p-4">
        <h2 className="mb-2 text-sm font-medium">题干</h2>
        <p className="stem">{question.stem || "（题干未识别到文字）"}</p>
        {figure && (
          <div className="mt-3">
            <SmartImage
              src={figure}
              alt={`第 ${question.num} 题图形`}
              hint="图形裁剪图尚未生成：运行 python pipeline/crop_images.py 后可显示。"
              className="figure-img w-full"
              boxClassName="px-4 py-8"
            />
            <p className="mt-1 text-[11px] text-muted">图形来自题目册原书扫描，包含印刷的 A/B/C/D 选项标签。</p>
          </div>
        )}
      </section>

      <section className="card p-4">
        <h2 className="mb-2 text-sm font-medium">选项</h2>
        {question.options.length === 0 ? (
          <p className="text-sm text-muted">
            本题选项为图形，未识别为文字；请对照{figure ? "上方" : "原书"}图形判断，A/B/C/D 顺序与原书一致。
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {question.options.map((option, i) => {
              const isAnswer = !!question.answer && option.label === question.answer;
              const isTrap = !!question.trapOption && option.label === question.trapOption;
              return (
                <li
                  key={`${option.label}-${i}`}
                  className="flex items-start gap-3 rounded-lg border border-line px-3 py-2"
                  style={isAnswer ? { borderColor: TONE_VARS.ok.fg, background: TONE_VARS.ok.bg } : undefined}
                >
                  <span className="mt-0.5 w-5 shrink-0 text-sm font-semibold tabular-nums">{option.label}</span>
                  <div className="min-w-0 flex-1">
                    {option.text ? (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">{option.text}</p>
                    ) : (
                      <p className="text-sm text-muted">图形选项，见原书 / 上方图形。</p>
                    )}
                    {option.image && (
                      <SmartImage
                        src={option.image}
                        alt={`选项 ${option.label}`}
                        hint="选项图未生成"
                        className="figure-img mt-1 max-h-32"
                        boxClassName="mt-1 text-[11px]"
                      />
                    )}
                  </div>
                  <span className="flex shrink-0 flex-col items-end gap-1 text-[11px]">
                    {isAnswer && <span style={{ color: TONE_VARS.ok.fg }}>正确答案</span>}
                    {isTrap && (
                      <span style={{ color: TONE_VARS.warn.fg }}>
                        易错项 · {question.accuracy !== null ? `${fmtAccuracy(question.accuracy)} 正确率` : "大数据未收录"}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {hasFigureOptions && question.options.length > 0 && (
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            部分选项未被识别为文字，完整选项请看图形或原书裁剪图。
          </p>
        )}
        {answerMissingOption && (
          <p className="mt-2 rounded-lg border border-dashed p-2.5 text-[11px] leading-relaxed text-muted" style={{ borderColor: "var(--warn)" }}>
            识别出的选项里没有正确答案「{question.answer}」所在的那一行（扫描识别漏读整行）。
            该题请以下方的原书整题图为准；数据校验页把这类题记为 <code className="font-mono">answer-not-in-options</code>。
          </p>
        )}
      </section>

      <section className="card p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">答案与解析</h2>
          <span className="flex items-center gap-2">
            {question.trapOption && <span className="chip">易错项 {question.trapOption}</span>}
            <AccuracyChip value={question.accuracy} prefix="正确率" />
          </span>
        </div>
        {question.answer ? (
          <p className="text-sm">
            正确答案：
            <span className="font-semibold tabular-nums" style={{ color: TONE_VARS.ok.fg }}>
              {question.answer}
            </span>
            {question.accuracy !== null && (
              <span className="ml-2 text-xs text-muted">
                粉笔大数据正确率 <span className="tabular-nums">{fmtAccuracy(question.accuracy)}</span>
                {question.trapOption ? `，易错项 ${question.trapOption}` : ""}
              </span>
            )}
          </p>
        ) : (
          <p className="text-sm" style={{ color: TONE_VARS.bad.fg }}>
            答案册未能匹配到本题答案，作答不判分。可在原书解析页人工核对答案。
          </p>
        )}
        <div className="mt-2">
          {question.analysis ? (
            // 解析里的换行是原书印刷列宽（约 28 字/行）的产物，不是段落：
            // 拼回连贯散文，交给浏览器按当前屏宽排版。
            <p className="text-sm leading-[1.85]">{question.analysis.replace(/\n+/g, "")}</p>
          ) : (
            <p className="text-sm text-muted">本题未识别到解析文字，请对照答案册原页。</p>
          )}
        </div>
      </section>

      <section className="card p-4">
        <h2 className="mb-2 text-sm font-medium">识别质量标记</h2>
        {question.flags.length === 0 ? (
          <p className="text-xs leading-relaxed text-muted">
            本题无质量标记：题干、选项与解析均通过流水线校验，识别置信度{" "}
            <span className="tabular-nums">{fmtConfidence(question.ocrConfidence)}</span>。
          </p>
        ) : (
          <>
            <FlagBadges flags={question.flags} detail />
            <ul className="mt-2 flex flex-col gap-1.5">
              {question.flags.map((flag) => (
                <li key={flag} className="flex gap-2 text-xs leading-relaxed">
                  <span className="shrink-0 font-medium" style={{ color: TONE_VARS[flagInfo(flag).tone].fg }}>
                    {flagInfo(flag).label}
                  </span>
                  <span className="text-muted">{flagInfo(flag).help}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-2 text-xs text-muted">
          <span>
            整题平均置信度 <span className="tabular-nums">{fmtConfidence(question.ocrConfidence)}</span>
          </span>
          {question.flags.length > 0 && (
            <Link href={bankHref({ flag: question.flags[0] })} className="chip">
              在题库中筛查同类题
            </Link>
          )}
          {crop && (
            <a href={crop} target="_blank" rel="noreferrer" className="chip">
              打开原书整题裁剪图
            </a>
          )}
        </div>
        {crop && (
          <div className="mt-3">
            <SmartImage
              src={crop}
              alt={`第 ${question.num} 题原书裁剪图`}
              hint="原书整题裁剪图尚未生成：运行 python pipeline/crop_images.py 后可显示。"
              className="figure-img w-full"
              boxClassName="px-4 py-8"
            />
          </div>
        )}
      </section>

      <section className="card p-4">
        <h2 className="mb-2 text-sm font-medium">原书定位</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { label: "题目所在页", ref: question.pageRef },
            { label: "答案与解析页", ref: question.answerPageRef },
          ].map(({ label, ref }) => (
            <div key={label} className="rounded-lg border border-line p-3">
              <div className="text-xs text-muted">{label}</div>
              {ref ? (
                <>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                    <span className="chip">{bookLabel(ref.tag)}</span>
                    <span className="tabular-nums">PDF 第 {ref.page} 页</span>
                    {ref.bookPage != null && <span className="chip tabular-nums">书页 {ref.bookPage}</span>}
                  </div>
                  <div className="mt-1 text-[11px] tabular-nums text-muted">
                    {ref.bbox
                      ? `OCR 坐标框 x=${Math.round(ref.bbox[0])} y=${Math.round(ref.bbox[1])} w=${Math.round(ref.bbox[2])} h=${Math.round(ref.bbox[3])}（200 dpi）`
                      : "该页未记录坐标框"}
                  </div>
                  <Link href={hrefWith("/book", { bank: question.bankId, tag: ref.tag, page: ref.page })} className="btn mt-2 inline-block px-2 py-1 text-xs">
                    在原书页面中查看
                  </Link>
                </>
              ) : (
                <p className="mt-1 text-sm text-muted">未识别到该页引用（流水线尚未匹配或未覆盖此页）。</p>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="card p-4">
        <h2 className="mb-2 text-sm font-medium">历史作答</h2>
        {attempts.length === 0 && !wrongRow ? (
          <p className="text-sm text-muted">
            还没有作答记录。
            <Link href={practiceHref} className="ml-1 text-brand">
              现在刷这题 →
            </Link>
          </p>
        ) : (
          <>
            {wrongRow && (
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                <span style={{ color: TONE_VARS.bad.fg }} className="chip tabular-nums">
                  错 {wrongRow.wrong_count} 次
                </span>
                <span className="chip tabular-nums">记忆第 {wrongRow.box} 关</span>
                <span className="chip">{wrongRow.status === "resolved" ? "已消灭" : "待复习"}</span>
                {wrongRow.next_review && <span className="chip">下次复习 {wrongRow.next_review}</span>}
                <span className="text-muted tabular-nums">
                  首次 {wrongRow.first_at} · 最近 {wrongRow.last_at}
                </span>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted">
                  <tr className="border-b border-line">
                    <th className="py-1 pr-3 font-medium">时间</th>
                    <th className="py-1 pr-3 font-medium">模式</th>
                    <th className="py-1 pr-3 font-medium">选项</th>
                    <th className="py-1 pr-3 font-medium">判定</th>
                    <th className="py-1 pr-3 font-medium">用时</th>
                  </tr>
                </thead>
                <tbody>
                  {attempts.map((a) => (
                    <tr key={a.id} className="border-b border-line last:border-0">
                      <td className="py-1.5 pr-3 tabular-nums text-muted">{a.createdAt}</td>
                      <td className="py-1.5 pr-3">{MODE_LABEL[a.mode as PracticeMode] ?? a.mode}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{a.answer ?? "未作答"}</td>
                      <td
                        className="py-1.5 pr-3"
                        style={{ color: a.correct ? TONE_VARS.ok.fg : TONE_VARS.bad.fg }}
                      >
                        {a.correct ? "正确" : "错误"}
                      </td>
                      <td className="py-1.5 tabular-nums">{(a.durationMs / 1000).toFixed(1)}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="card p-4">
        <h2 className="mb-2 text-sm font-medium">收藏、笔记与标签</h2>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className="chip"
            style={favoriteRow ? { color: TONE_VARS.warn.fg, borderColor: TONE_VARS.warn.fg } : undefined}
          >
            {favoriteRow ? `已收藏（${favoriteRow.added_at}）` : "未收藏"}
          </span>
          {tags.map((t) => (
            <span key={t} className="chip">
              #{t}
            </span>
          ))}
          <Link href="/favorites" className="btn px-2 py-1 text-xs">
            收藏列表
          </Link>
          <Link href="/notes" className="btn px-2 py-1 text-xs">
            笔记列表
          </Link>
        </div>
        <div className="mt-2">
          {noteRow ? (
            <div className="rounded-lg border border-line bg-bg p-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{noteRow.text || "（笔记为空）"}</p>
              <p className="mt-1 text-[11px] tabular-nums text-muted">更新于 {noteRow.updated_at}</p>
            </div>
          ) : (
            <p className="text-xs text-muted">暂无笔记。可在笔记页为本题补充思路或错因。</p>
          )}
        </div>
      </section>

      <nav className="flex items-center justify-between gap-3 text-sm">
        {prev ? (
          <Link href={`/question/${encodeURIComponent(prev.id)}`} className="btn truncate">
            上一题 · 第 {prev.num} 题
          </Link>
        ) : (
          <span className="btn opacity-40">已是本章第一题</span>
        )}
        <span className="text-[11px] tabular-nums text-muted">
          第 {idx + 1}/{siblings.length} 题（按原题号顺序）
        </span>
        {next ? (
          <Link href={`/question/${encodeURIComponent(next.id)}`} className="btn shrink-0">
            下一题 · 第 {next.num} 题
          </Link>
        ) : (
          <span className="btn opacity-40">已是本章最后一题</span>
        )}
      </nav>

      <section className="card p-4">
        <h2 className="mb-2 flex items-center justify-between text-sm font-medium">
          同考点其它题
          <Link
            href={bankHref({
              chapter: question.chapterIndex,
              section: sectionLabel(question),
              point: pointLabel(question),
            })}
            className="text-xs font-normal text-brand"
          >
            在题库中浏览 →
          </Link>
        </h2>
        {(() => {
          const peers = bank
            .filter(
              (item) =>
                item.id !== question.id &&
                item.chapterIndex === question.chapterIndex &&
                sectionLabel(item) === sectionLabel(question) &&
                pointLabel(item) === pointLabel(question),
            )
            .sort((a, b) => a.num - b.num)
            .slice(0, 3);
          if (!peers.length) return <p className="text-xs text-muted">该考点目前只有本题入库。</p>;
          return (
            <div className="flex flex-col gap-2">
              {peers.map((peer) => (
                <QuestionRow key={peer.id} q={peer} />
              ))}
            </div>
          );
        })()}
      </section>
    </div>
  );
}
