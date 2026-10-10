import clsx from "clsx";
import Link from "next/link";
import SmartImage from "@/components/bank/SmartImage";
import type { Question } from "@/lib/types";
import type { GradeResult, RunnerMode, WrongInfo } from "@/lib/practice-store";
import AnalysisPanel from "./analysis-panel";
import AnswerFeedback from "./answer-feedback";
import OptionList, { answerOptionMissing, isLetterOnly } from "./option-list";
import QualityBadges from "./quality-badges";

interface Props {
  question: Question;
  position: number;
  total: number;
  mode: RunnerMode;
  chosen: string | null;
  graded: GradeResult | null;
  ungraded: boolean;
  revealed: boolean;
  cropOpen: boolean;
  elapsedMs: number;
  /** 已判分锁定（即时模式）——不再接受新的选择。 */
  locked: boolean;
  pending: boolean;
  wrongInfo?: WrongInfo;
  favorite: boolean;
  /**
   * 资料分析：MaterialPanel 没能渲染（资料还在路上 / 旧 id 已失效）时的说明，
   * 其余模块恒为 null，题头与改动前完全一致。
   */
  materialNote?: string | null;
  onSelect: (label: string) => void;
  onToggleReveal: () => void;
  onToggleCrop: () => void;
  onToggleFavorite: () => void;
}

function sourceLabel(q: Question): string | null {
  const s = q.source;
  if (!s) return null;
  if (s.raw) return s.raw.replace(/^（|\）$/g, "");
  const parts = [s.year ? `${s.year}年` : null, s.region, s.code ? `第${s.code}题` : null].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

export default function QuestionView({
  question: q,
  position,
  total,
  mode,
  chosen,
  graded,
  ungraded,
  revealed,
  cropOpen,
  elapsedMs,
  locked,
  pending,
  wrongInfo,
  favorite,
  materialNote,
  onSelect,
  onToggleReveal,
  onToggleCrop,
  onToggleFavorite,
}: Props) {
  const recite = mode === "recite";
  const showGrade = recite || revealed;
  // 选项图形和题干印在同一张裁图里，题图缺失时必须退回整题裁图，否则「选项见题图」无图可看。
  // 缺正确选项的题也要看到原书整题图，否则读者只会看见三个选项配一个不在其中的答案
  const visual =
    q.figureImage ?? (isLetterOnly(q) || answerOptionMissing(q) ? q.cropImage : null);
  const visualIsCrop = visual !== null && visual === q.cropImage && !q.figureImage;

  return (
    <article className="card p-4">
      {/* 题头：定位信息 + 常用操作 */}
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="chip tabular-nums">
            本组第 {position} / {total} 题
          </span>
          <span className="chip tabular-nums">原题号 {q.num}</span>
          <span className="chip">
            第{q.chapterIndex}章 {q.chapterTitle}
          </span>
          {q.sectionTitle && <span className="chip">{q.sectionTitle}</span>}
          {q.pointTitle && <span className="chip">{q.pointTitle}</span>}
          {q.drillTitle && <span className="chip">{q.drillTitle}</span>}
          {sourceLabel(q) && <span className="chip">{sourceLabel(q)}</span>}
          <span className="chip">{q.kind === "figure" ? "图形推理" : "文字题"}</span>
          {materialNote && (
            <span className="chip tabular-nums" style={{ color: "var(--warn)" }}>
              {materialNote}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleFavorite}
            title="收藏本题（F）"
            className="rounded-lg border bg-panel px-2 py-1 text-xs transition-colors hover:border-brand"
            style={
              favorite
                ? { borderColor: "var(--warn)", color: "var(--warn)" }
                : { borderColor: "var(--line)", color: "var(--muted)" }
            }
          >
            {favorite ? "★ 已收藏" : "☆ 收藏"}
          </button>
          <button
            type="button"
            onClick={onToggleCrop}
            title="显示原书裁剪图（T 键，对照原始扫描）"
            className={clsx(
              "rounded-lg border bg-panel px-2 py-1 text-xs transition-colors hover:border-brand",
              cropOpen ? "border-brand text-brand" : "border-line text-muted",
            )}
          >
            对照原书
          </button>
        </div>
      </header>

      {/* 题干 */}
      <p className="stem">{q.stem || "（题干未识别）"}</p>

      {/* 题图：图形推理的选项图也在这张裁图里，所以放全宽、优先展示 */}
      {visual && (
        <figure className="mt-3">
          <SmartImage
            src={visual}
            alt={
              visualIsCrop
                ? `第 ${q.num} 题原书裁剪图（含选项）`
                : `第 ${q.num} 题题图与选项`
            }
            hint={`第 ${q.num} 题的图形文件缺失，请重新裁图（npm run bank:crop）。`}
            className="figure-img w-full"
          />
          {visualIsCrop && (
            <figcaption className="mt-1 text-[11px] leading-relaxed text-muted">
              本题题图未单独裁出，上方直接展示原书裁剪图（题图与 A–D 选项同在其中）。
            </figcaption>
          )}
        </figure>
      )}
      {!visual && (q.kind === "figure" || isLetterOnly(q) || answerOptionMissing(q)) && (
        <p className="mt-3 rounded-lg border border-dashed border-line p-2.5 text-xs leading-relaxed text-muted">
          该题图形尚未裁出（题图与原书裁图都不可用），运行 <code className="font-mono">npm run bank:crop</code> 补做裁图。
        </p>
      )}

      {/* 选项 */}
      <div className="mt-4">
        <OptionList
          question={q}
          value={chosen}
          answer={showGrade ? q.answer : null}
          reveal={showGrade}
          locked={locked}
          onSelect={onSelect}
        />
      </div>

      {recite && q.answer && (
        <p className="mt-2 text-xs text-muted">
          背题模式：正确答案{" "}
          <span className="font-semibold text-ok tabular-nums">{q.answer}</span>
          　·　本模式不记录成绩，仅作浏览与记忆。
        </p>
      )}

      {showGrade && !recite && (
        <AnswerFeedback
          question={q}
          result={graded}
          chosen={chosen}
          ungraded={ungraded}
          ms={elapsedMs}
          wrongInfo={wrongInfo}
          pending={pending}
        />
      )}

      <AnalysisPanel question={q} open={revealed} onToggle={onToggleReveal} forceOpen={recite} />

      <QualityBadges question={q} className="mt-3" />

      {/* 对照原书：整题扫描裁图 + 回原书页 */}
      {cropOpen && (
        <div className="mt-3 rounded-xl border border-brand bg-brand-soft p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-medium text-brand">原书裁剪图（OCR 原始依据）</span>
            <div className="flex gap-3">
              {q.pageRef && (
                <Link href={`/book?tag=${q.pageRef.tag}&page=${q.pageRef.page}`} className="text-brand hover:underline">
                  原书第 {q.pageRef.page} 页（{q.pageRef.tag === "up" ? "上册" : "下册"}
                  {q.pageRef.bookPage ? ` · 书页 ${q.pageRef.bookPage}` : ""}）→
                </Link>
              )}
              <Link href={`/question/${q.id}`} className="text-brand hover:underline">
                题目详情 →
              </Link>
            </div>
          </div>
          {q.cropImage ? (
            visualIsCrop ? (
              <p className="text-xs text-muted">上方题图即为本卷该题的原书裁剪图。</p>
            ) : (
              <SmartImage
                src={q.cropImage}
                alt={`第 ${q.num} 题原书裁剪图`}
                hint={`第 ${q.num} 题的原书裁剪图文件缺失。`}
                className="figure-img w-full"
              />
            )
          ) : (
            <p className="text-xs text-muted">该题没有可用的原书裁剪图。</p>
          )}
        </div>
      )}
    </article>
  );
}
