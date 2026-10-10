"use client";

import clsx from "clsx";
import Link from "next/link";
import { useCallback, useRef, useState, type ReactNode } from "react";
import type { Question } from "@/lib/types";
import { chipMuted, btnSm } from "./ui";

/* -------------------------------------------------------------------- */
/* Figure thumbnail — plain <img>, self-hiding when the crop is missing. */
/* -------------------------------------------------------------------- */

export function RowThumb({
  src,
  alt,
  href,
  className,
}: {
  src: string | null | undefined;
  alt: string;
  href?: string | null;
  className?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) return null;

  const img = (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      width={110}
      height={74}
      onError={() => setFailedSrc(src)}
      className={clsx(
        "h-[74px] w-[110px] shrink-0 rounded-lg border border-line bg-white object-contain p-0.5",
        className,
      )}
    />
  );

  return href ? (
    <Link href={href} className="shrink-0" title="查看原题">
      {img}
    </Link>
  ) : (
    img
  );
}

/* -------------------------------------------------------------------- */
/* Inline note editor with explicit save state.                         */
/* -------------------------------------------------------------------- */

export interface NoteFieldProps {
  /** Server-side value; the editor follows it whenever the field is untouched. */
  value: string | null | undefined;
  /** Return false to signal a failed save (the editor then shows 保存失败). */
  onSave: (text: string) => Promise<boolean>;
  label?: string;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
}

export function NoteField({
  value,
  onSave,
  label = "备注",
  placeholder = "写下错因，如「把对称轴看成了中心对称」；失焦自动保存",
  rows = 2,
  disabled = false,
}: NoteFieldProps) {
  const server = value ?? "";
  const [draft, setDraft] = useState(server);
  const [committed, setCommitted] = useState(server);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const [prevServer, setPrevServer] = useState(server);

  // A refetch may change the stored text; adopt it during render (never while the
  // user is mid-edit) so no cascading effect render is needed.
  if (server !== prevServer) {
    setPrevServer(server);
    if (draft === committed) setDraft(server);
    setCommitted(server);
    setFailed(false);
  }

  const dirty = draft !== committed;

  const commit = useCallback(async () => {
    if (saving || draft === committed) return;
    setSaving(true);
    setFailed(false);
    let ok = false;
    try {
      ok = await onSave(draft);
    } catch {
      ok = false;
    }
    setSaving(false);
    if (ok) {
      setCommitted(draft);
      setSavedAt(
        new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }),
      );
    } else {
      setFailed(true);
    }
  }, [committed, draft, onSave, saving]);

  const status = saving ? "保存中…" : failed ? "保存失败" : dirty ? "未保存" : savedAt ? `已保存 ${savedAt}` : null;
  const statusClass = saving
    ? "text-muted"
    : failed
      ? "text-bad"
      : dirty
        ? "text-brand"
        : "text-ok";

  return (
    <div className="mt-2.5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted">{label}</span>
        <span className={clsx("flex items-center gap-1.5 text-[11px] tabular-nums", statusClass)}>
          {status}
          {(dirty || failed) && !saving ? (
            <button type="button" className={btnSm} onClick={() => void commit()} disabled={disabled}>
              {failed ? "重试" : "保存"}
            </button>
          ) : null}
        </span>
      </div>
      <textarea
        ref={areaRef}
        rows={rows}
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            areaRef.current?.blur();
          }
        }}
        className="w-full resize-y rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs leading-relaxed text-ink outline-none transition-colors placeholder:text-muted/70 focus:border-brand disabled:opacity-60"
      />
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Collection row shell shared by 错题本 / 收藏 / 笔记.                   */
/* -------------------------------------------------------------------- */

export interface CollectionRowProps {
  questionId: string;
  /** Null when the bank was rebuilt and this id is gone. */
  question: Question | null;
  /** Page-specific chips appended after the taxonomy chips. */
  extraChips?: ReactNode;
  /** Left side of the footer strip: counts, Leitner dots, dates… */
  meta?: ReactNode;
  /** Right side of the footer strip: action buttons / links. */
  actions?: ReactNode;
  /** Leading slot, e.g. the bulk-select checkbox. */
  leading?: ReactNode;
  note?: string | null;
  noteLabel?: string;
  notePlaceholder?: string;
  noteRows?: number;
  onSaveNote?: (text: string) => Promise<boolean>;
  /** Anything rendered under the stem (figures, sub lists). */
  footer?: ReactNode;
  /** Marks overdue / due rows with an accent border. */
  highlight?: boolean;
  href?: string | null;
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * 资料分析的题共用一段资料，列表里标出资料编号即可看出「一拖五」的分组。
 * 只用 materialId 本身：重建题库后编号会变，不据此推断标题或图片路径。
 */
const materialChip = (materialId: string | null | undefined): string | null => {
  if (!materialId) return null;
  return materialId.replace(/^[a-z]+-/, "") || materialId;
};

export default function CollectionRow({
  questionId,
  question,
  extraChips,
  meta,
  actions,
  leading,
  note,
  noteLabel,
  notePlaceholder,
  noteRows,
  onSaveNote,
  footer,
  highlight = false,
  href,
}: CollectionRowProps) {
  const link = href !== undefined ? href : question ? `/question/${questionId}` : null;

  return (
    <article
      className="card p-3 transition-colors"
      // .card sets border-color outside any layer, so the accent has to win inline.
      style={highlight ? { borderColor: "var(--bad)" } : undefined}
      data-question-id={questionId}
    >
      <div className="flex items-start gap-3">
        {leading}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {question ? (
              <>
                <span className={chipMuted} title={question.chapterTitle}>
                  第{question.chapterIndex}章 · {question.chapterTitle}
                </span>
                <span className={chipMuted} title={question.pointTitle ?? "未归类考点"}>
                  {question.pointTitle ?? question.sectionTitle ?? "未分类考点"}
                </span>
                <span className={chipMuted}>原题号 {question.num}</span>
                {materialChip(question.materialId) ? (
                  <span
                    className={chipMuted}
                    title={`本题与同组小题共用资料 ${question.materialId}（资料分析按组出题）`}
                  >
                    资料 {materialChip(question.materialId)}
                  </span>
                ) : null}
                {question.kind === "figure" || question.hasImage ? (
                  <span className={chipMuted}>图形题</span>
                ) : null}
                {question.drillTitle ? <span className={chipMuted}>{question.drillTitle}</span> : null}
              </>
            ) : (
              <>
                <code className={clsx(chipMuted, "font-mono")}>{questionId}</code>
                <span className="inline-flex items-center gap-1 rounded-full border border-bad/50 bg-bad-soft px-2 py-0.5 text-[11px] leading-[1.6] text-bad">
                  已失效
                </span>
              </>
            )}
            {extraChips}
          </div>

          {question ? (
            <div className="mt-2 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                {link ? (
                  <Link href={link} className="block text-sm leading-6 text-ink hover:text-brand">
                    <span className="line-clamp-2">{oneLine(question.stem) || "（题干为空，OCR 未识别到文字）"}</span>
                  </Link>
                ) : (
                  <p className="line-clamp-2 text-sm leading-6">{oneLine(question.stem)}</p>
                )}
              </div>
              <RowThumb
                src={question.figureImage}
                alt={`第${question.chapterIndex}章 原题号${question.num} 图形`}
                href={link}
              />
            </div>
          ) : (
            <p className="mt-2 text-xs leading-relaxed text-muted">
              重建题库后该题号已不存在，作答记录仍然保留。可以补充备注，或直接把它移出错题本。
            </p>
          )}

          {footer}

          {onSaveNote ? (
            <NoteField
              value={note}
              onSave={onSaveNote}
              label={noteLabel ?? "备注"}
              placeholder={notePlaceholder}
              rows={noteRows ?? 2}
            />
          ) : null}
        </div>
      </div>

      {meta || actions ? (
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">{meta}</div>
          <div className="flex flex-wrap items-center gap-1.5">{actions}</div>
        </div>
      ) : null}
    </article>
  );
}
