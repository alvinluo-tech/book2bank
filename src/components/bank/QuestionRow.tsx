import Link from "next/link";
import type { Question } from "@/lib/types";
import AccuracyChip from "./AccuracyChip";
import FlagBadges from "./FlagBadges";
import SmartImage from "./SmartImage";
import { bankLabel, figureSrc, KIND_LABELS, pointLabel, sectionLabel, sourceText, TONE_VARS } from "./helpers";

export interface RowState {
  /** Last recorded answer for this question, if any. */
  last?: { answer: string | null; correct: boolean } | null;
  wrongCount?: number;
  favorite?: boolean;
}

/**
 * 资料分析的题共用一段资料：列表里给出资料编号，同组小题一眼就能看出是一对多。
 * 只渲染 materialId 本身——重建题库后编号会变，绝不据此推断资料标题或图片路径。
 */
function materialChip(materialId: string | null | undefined): string | null {
  if (!materialId) return null;
  return materialId.replace(/^[a-z]+-/, "") || materialId;
}

/** Compact result row for the 题库浏览器; the whole row links to the detail page. */
export default function QuestionRow({ q, state }: { q: Question; state?: RowState }) {
  const thumb = figureSrc(q);
  const source = sourceText(q.source);
  const last = state?.last;
  return (
    <Link
      href={`/question/${encodeURIComponent(q.id)}`}
      className="card flex gap-3 p-3 transition-colors hover:border-brand"
    >
      <div className="flex w-11 shrink-0 flex-col items-center gap-1">
        <span className="text-sm font-semibold tabular-nums leading-none">第{q.num}题</span>
        {last !== undefined && last !== null && (
          <span
            style={last.correct ? { color: TONE_VARS.ok.fg } : { color: TONE_VARS.bad.fg }}
            className="text-[11px] tabular-nums"
            title={last.correct ? "上次作答正确" : `上次作答选了 ${last.answer ?? "未答"}`}
          >
            {last.correct ? "已对" : `已错${last.answer ? `·${last.answer}` : ""}`}
          </span>
        )}
      </div>

      {thumb && (
        <SmartImage
          src={thumb}
          alt={`第${q.num}题图形`}
          hint="无图"
          className="h-16 w-24 shrink-0 rounded-lg border border-line bg-white object-contain p-1"
          boxClassName="h-16 w-24 shrink-0 text-[10px]"
        />
      )}

      <div className="min-w-0 flex-1">
        {/* Taxonomy is context, not data: one muted line instead of a chip pile.
            The filter bar above already says which chapter is selected. */}
        <div className="truncate text-[11px] leading-relaxed text-muted">
          {[
            bankLabel(q.bankId),
            `第${q.chapterIndex}章 ${q.chapterTitle}`,
            sectionLabel(q),
            pointLabel(q),
            q.drillTitle ? `专项 ${q.drillTitle}` : null,
            materialChip(q.materialId) ? `资料 ${materialChip(q.materialId)}` : null,
            KIND_LABELS[q.kind],
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>

        <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-ink">{q.stem}</p>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {q.answer ? (
            <span style={{ color: TONE_VARS.info.fg, borderColor: TONE_VARS.info.fg }} className="chip tabular-nums">
              答案 {q.answer}
            </span>
          ) : (
            <span style={{ color: TONE_VARS.bad.fg, borderColor: TONE_VARS.bad.fg }} className="chip">
              缺答案
            </span>
          )}
          <AccuracyChip value={q.accuracy} trap={q.trapOption} prefix="" className="tabular-nums" />
          {source && <span className="chip">来源 {source}</span>}
          {state?.wrongCount ? <span className="chip tabular-nums">错 {state.wrongCount} 次</span> : null}
          {state?.favorite && <span className="chip">已收藏</span>}
          <FlagBadges flags={q.flags} max={3} className="ml-auto" />
        </div>
      </div>
    </Link>
  );
}
