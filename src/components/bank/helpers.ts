/**
 * Shared building blocks for the 题库 / 题目详情 / 原书 pages.
 *
 * Pure functions only: no fs, no sqlite — safe to import from client components.
 * Everything is derived from the bank data, so nothing here may hardcode chapter
 * names, question counts or page numbers.
 */

import type { BBox, BookTag, Question, QuestionSource } from "@/lib/types";
import { BANK_LIST, bankDef, BOOK_LABEL, chapterKey, PAGE_DIMS, sideOfTag } from "@/lib/banks";

export { BANK_LIST, bankDef, chapterKey };

/* ------------------------------------------------------------------ */
/* Search params                                                       */
/* ------------------------------------------------------------------ */

/** Raw Next.js searchParams shape. */
export type RawParams = Record<string, string | string[] | undefined>;
/** Normalised, always-string filter map carried through the UI. */
export type Filters = Record<string, string>;

export function normalizeParams(raw: RawParams): Filters {
  const out: Filters = {};
  for (const [key, value] of Object.entries(raw)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined && first !== "") out[key] = first;
  }
  return out;
}

const PERSIST = ["bank", "q", "kind", "status", "flag", "chapter", "section", "point", "limit", "offset"];

/**
 * Build a shareable href from the current filters plus overrides.
 * `null` deletes a key, `undefined` keeps the current value, anything else sets it.
 * Pagination is reset (offset dropped) unless the caller sets it explicitly.
 */
export function buildHref(
  current: Filters,
  overrides: Record<string, string | number | null | undefined>,
  base = "/bank",
): string {
  const sp = new URLSearchParams();
  const keys = new Set([...PERSIST, ...Object.keys(overrides)]);
  for (const key of keys) {
    const raw = overrides[key] === undefined ? current[key] : overrides[key];
    if (raw === undefined || raw === null || raw === "") continue;
    sp.set(key, String(raw));
  }
  const query = sp.toString();
  return query ? `${base}?${query}` : base;
}

/** Href from scratch with arbitrary params (used for cross-page links like /practice). */
export function hrefWith(base: string, params: Record<string, string | number | null | undefined>): string {
  return buildHref({}, params, base);
}

export function strParam(f: Filters, key: string): string | undefined {
  return f[key];
}

export function numParam(f: Filters, key: string): number | undefined {
  const v = f[key];
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

export const PAGE_SIZES = [20, 50, 100] as const;

export function readLimit(f: Filters): number {
  const n = numParam(f, "limit");
  return n && (PAGE_SIZES as readonly number[]).includes(n) ? n : 50;
}

export function readOffset(f: Filters, limit: number): number {
  const raw = numParam(f, "offset");
  if (raw === undefined) return 0;
  const max = Math.max(0, Math.floor(raw / limit) * limit);
  return max;
}

/** Bank id from the URL; undefined means every bank. */
export function readBank(f: Filters): string | undefined {
  const id = f.bank;
  if (!id) return undefined;
  return BANK_LIST.some((b) => b.id === id) ? id : undefined;
}

export const bankLabel = (id: string | null | undefined): string => bankDef(id).title;

export const KIND_LABELS: Record<string, string> = { text: "文字题", figure: "图形题" };

export type StatusValue = "all" | "unanswered" | "answered" | "wrong" | "favorite" | "smart";

export const STATUS_LABELS: Record<StatusValue, string> = {
  all: "全部状态",
  unanswered: "未作答",
  answered: "已作答",
  wrong: "错题本内",
  favorite: "已收藏",
  smart: "智能推荐",
};

export function readStatus(f: Filters): StatusValue {
  const v = f.status as StatusValue | undefined;
  return v && v in STATUS_LABELS ? v : "all";
}

export function readKind(f: Filters): Question["kind"] | undefined {
  const v = f.kind;
  return v === "figure" || v === "text" ? v : undefined;
}

/* ------------------------------------------------------------------ */
/* Taxonomy (derived from the bank so filter clicks always match)      */
/* ------------------------------------------------------------------ */

/** URL placeholder for items whose 节 / 考点 was never recognised by OCR. */
export const UNSET = "（未分类）";

export const sectionLabel = (q: Question) => q.sectionTitle ?? UNSET;
export const pointLabel = (q: Question) => q.pointTitle ?? UNSET;

export interface PointNode {
  title: string;
  count: number;
}
export interface SectionNode extends PointNode {
  points: PointNode[];
}
export interface ChapterNode {
  /** chapterKey(bankId, index) — chapterIndex restarts inside every bank. */
  key: string;
  bankId: string;
  index: number;
  title: string;
  count: number;
  answered: number;
  sections: SectionNode[];
}
export interface BankNode {
  bankId: string;
  title: string;
  count: number;
  answered: number;
  chapters: ChapterNode[];
}

interface MutableChapter {
  key: string;
  bankId: string;
  index: number;
  title: string;
  count: number;
  answered: number;
  sections: Map<string, SectionNode>;
}

/** 题库 → 章 → 节 → 考点 tree; titles are verbatim question fields, so filtering can never miss. */
export function buildTaxonomy(bank: Question[], answered: Set<string>): BankNode[] {
  const banks = new Map<string, { bankId: string; title: string; count: number; answered: number; chapters: Map<string, MutableChapter> }>();
  for (const q of bank) {
    let b = banks.get(q.bankId);
    if (!b) {
      b = { bankId: q.bankId, title: bankLabel(q.bankId), count: 0, answered: 0, chapters: new Map() };
      banks.set(q.bankId, b);
    }
    b.count += 1;

    const key = chapterKey(q.bankId, q.chapterIndex);
    let ch = b.chapters.get(key);
    if (!ch) {
      ch = {
        key,
        bankId: q.bankId,
        index: q.chapterIndex,
        title: q.chapterTitle,
        count: 0,
        answered: 0,
        sections: new Map(),
      };
      b.chapters.set(key, ch);
    }
    ch.count += 1;
    if (answered.has(q.id)) {
      b.answered += 1;
      ch.answered += 1;
    }

    const secLabel = sectionLabel(q);
    let sec = ch.sections.get(secLabel);
    if (!sec) {
      sec = { title: secLabel, count: 0, points: [] };
      ch.sections.set(secLabel, sec);
    }
    sec.count += 1;

    const ptLabel = pointLabel(q);
    const point = sec.points.find((p) => p.title === ptLabel);
    if (point) point.count += 1;
    else sec.points.push({ title: ptLabel, count: 1 });
  }

  const order = (id: string) => BANK_LIST.findIndex((b) => b.id === id);
  return [...banks.values()]
    .sort((a, b) => order(a.bankId) - order(b.bankId))
    .map((b) => ({
      bankId: b.bankId,
      title: b.title,
      count: b.count,
      answered: b.answered,
      chapters: [...b.chapters.values()]
        .sort((x, y) => x.index - y.index)
        .map((ch) => ({
          key: ch.key,
          bankId: ch.bankId,
          index: ch.index,
          title: ch.title,
          count: ch.count,
          answered: ch.answered,
          sections: [...ch.sections.values()],
        })),
    }));
}

/** Flat chapter list, handy for views that ignore the bank grouping. */
export const flattenChapters = (banks: BankNode[]): ChapterNode[] => banks.flatMap((b) => b.chapters);

export interface TaxonomyFilter {
  bank?: string;
  chapter?: number;
  section?: string;
  point?: string;
}

/**
 * Taxonomy predicate mirroring buildTaxonomy's labels.
 * queryQuestions() can only match literal titles, so 未分类 nodes are handled here.
 */
export function inTaxonomy(q: Question, f: TaxonomyFilter): boolean {
  if (f.bank && q.bankId !== f.bank) return false;
  if (f.chapter !== undefined && q.chapterIndex !== f.chapter) return false;
  if (f.section !== undefined) {
    if (f.section === UNSET) {
      if (q.sectionTitle) return false;
    } else if (q.sectionTitle !== f.section) return false;
  }
  if (f.point !== undefined) {
    if (f.point === UNSET) {
      if (q.pointTitle) return false;
    } else if (q.pointTitle !== f.point) return false;
  }
  return true;
}

/** Same chapter scope as a question — chapterIndex restarts per bank, so bank matters too. */
export const sameChapter = (a: Question, b: Question) =>
  a.bankId === b.bankId && a.chapterIndex === b.chapterIndex;

/* ------------------------------------------------------------------ */
/* Pipeline quality flags — user-visible signals, never hidden         */
/* ------------------------------------------------------------------ */

export type FlagTone = Tone;

export interface FlagInfo {
  label: string;
  tone: FlagTone;
  help: string;
}

export const FLAG_INFO: Record<string, FlagInfo> = {
  corrected: {
    label: "已人工校正",
    tone: "ok",
    help: "这道题的题干/选项/答案由人工对照原书扫描复核过（见 data/banks/<科目>/corrections.json），不再只是 OCR 结果；鼠标移到题图上还能看到校正依据。",
  },
  "no-answer": {
    label: "缺答案",
    tone: "bad",
    help: "答案册未能匹配到该题答案：作答不会判分，解析也可能缺失。建议对照答案册人工补录。",
  },
  "answer-mismatch": {
    label: "答案存疑",
    tone: "bad",
    help: "答案锚点与解析末尾「故正确答案为X」不一致，很可能有一处识别错误，务必对照原书裁剪图核对。",
  },
  "answer-not-in-options": {
    label: "答案不在选项中",
    tone: "warn",
    help: "识别到的答案字母不在该题选项列表里，可能是选项漏识别或答案识别错误，请对照原书核对。",
  },
  "answer-recovered": {
    label: "答案自解析恢复",
    tone: "warn",
    help: "答案锚点行在 OCR 中丢失，答案字母是从解析末尾「故正确答案为X」恢复的；解析正文可能与相邻题串行，建议对照答案册原页。",
  },
  "ocr-low": {
    label: "识别置信度低",
    tone: "warn",
    help: "整题 OCR 平均置信度偏低，题干或解析可能存在错字、串行。请对照原书裁剪图核对。",
  },
  "figure-options": {
    label: "选项为图形",
    tone: "info",
    help: "A/B/C/D 四个选项本身是图形（含印刷字母标签），未识别为文字，请在图形中查看。",
  },
  "options-1": {
    label: "仅 1 个选项",
    tone: "bad",
    help: "只识别到 1 个文字选项，通常说明选项版式被打乱或漏识别。",
  },
  "options-2": {
    label: "仅 2 个选项",
    tone: "warn",
    help: "只识别到 2 个文字选项（原书应为 4 个），常见于两列选项被合并。",
  },
  "options-3": {
    label: "仅 3 个选项",
    tone: "warn",
    help: "只识别到 3 个文字选项（原书应为 4 个），可能漏掉了一列。",
  },
  "no-options": {
    label: "无选项",
    tone: "bad",
    help: "未识别到任何文字选项，选项通常是图形或版式被打乱，请对照原书裁剪图。",
  },
  "empty-stem": {
    label: "题干为空",
    tone: "bad",
    help: "题干未识别到文字，多为纯图形题；请以图形或原书裁剪图为准。",
  },
  "short-analysis": {
    label: "解析偏短",
    tone: "warn",
    help: "解析字数低于阈值，可能被页面边界截断，建议对照答案册原页。",
  },
};

export function flagInfo(flag: string): FlagInfo {
  return (
    FLAG_INFO[flag] ?? {
      label: flag,
      tone: "muted",
      help: "流水线标记的其它质量信号，具体含义见 pipeline 输出。",
    }
  );
}

/** Flags present in the current bank, most frequent first — used by the 筛选 select. */
export function bankFlags(bank: Question[]): { flag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const q of bank) for (const f of q.flags) counts.set(f, (counts.get(f) ?? 0) + 1);
  return [...counts.entries()]
    .map(([flag, count]) => ({ flag, count }))
    .sort((a, b) => b.count - a.count || a.flag.localeCompare(b.flag));
}

/* ------------------------------------------------------------------ */
/* Assets + provenance                                                 */
/* ------------------------------------------------------------------ */

/**
 * Figure crop for the stem/options, and the whole-item 原书对照 crop.
 *
 * Both paths come from the bank: crop_images.py writes the PNG and stamps the pointer
 * in one pass, and src/lib/bank.ts drops a pointer whose file is no longer there.
 * Deriving `/assets/figures/<id>.png` from the id would be wrong — re-parsing a bank
 * renumbers ids, so the file under a reused name is another question's figure.
 */
export function figureSrc(q: Question): string | null {
  return q.figureImage;
}

export function cropSrc(q: Question): string | null {
  return q.cropImage;
}

/** /assets/pages/<tag>-<NNN>.jpg — generated by pipeline/crop_images.py at 115 dpi. */
export function pageSrc(tag: BookTag, page: number): string {
  return `/assets/pages/${tag}-${String(page).padStart(3, "0")}.jpg`;
}

/**
 * 200 dpi OCR page geometry: bbox coordinates live in this pixel space while the
 * page JPEG is a 115 dpi render of the same page. Percentages of these dimensions
 * therefore map onto the displayed image at any size.
 */
export const OCR_PAGE: Record<BookTag, { w: number; h: number }> = PAGE_DIMS as Record<BookTag, { w: number; h: number }>;

/** 200 dpi page geometry for a tag, with a safe default for tags the registry lacks. */
export function pageDims(tag: BookTag): { w: number; h: number } {
  return PAGE_DIMS[tag] ?? { w: 1386, h: 2008 };
}

export function bookLabel(tag: BookTag): string {
  return BOOK_LABEL[tag] ?? `${tag}（${sideOfTag(tag) === "dn" ? "答案与解析" : "题目"}）`;
}

/** Which of a question's page references points at a given tag. */
export function refForTag(q: Question, tag: BookTag): Question["pageRef"] {
  return sideOfTag(tag) === "dn" ? q.answerPageRef : q.pageRef;
}

/** Page tags actually present in the bank, 题目册 (up) before 答案册 (dn). */
export function bankTags(bank: Question[]): BookTag[] {
  const tags = new Set<BookTag>();
  for (const q of bank) {
    if (q.pageRef) tags.add(q.pageRef.tag);
    if (q.answerPageRef) tags.add(q.answerPageRef.tag);
  }
  return [...tags].sort((a, b) => {
    const sa = sideOfTag(a);
    const sb = sideOfTag(b);
    if (sa !== sb) return sa === "up" ? -1 : 1;
    return a.localeCompare(b);
  });
}

export { BOOK_LABEL };

export interface OverlayRect {
  id: string;
  num: number;
  title: string;
  bbox: BBox;
}

/** Rectangles to draw on a page scan: 题目册 uses pageRef, 答案册 uses answerPageRef. */
export function rectsForPage(bank: Question[], tag: BookTag, page: number): OverlayRect[] {
  const dn = sideOfTag(tag) === "dn";
  const out: OverlayRect[] = [];
  for (const q of bank) {
    const ref = dn ? q.answerPageRef : q.pageRef;
    if (!ref || ref.tag !== tag || ref.page !== page || !ref.bbox) continue;
    out.push({
      id: q.id,
      num: q.num,
      title: `${q.pointTitle ?? q.sectionTitle ?? q.chapterTitle}`,
      bbox: ref.bbox,
    });
  }
  return out;
}

/** 2024·山东·65 style chip text, with the printed raw string as fallback. */
export function sourceText(source: QuestionSource | null | undefined): string | null {
  if (!source) return null;
  const parts = [source.year, source.region, source.code].filter(
    (p): p is string | number => p !== null && p !== undefined && p !== "",
  );
  if (parts.length) return parts.map((p) => String(p)).join("·");
  const raw = source.raw?.replace(/[（）()]/g, "").trim();
  return raw || null;
}

/* ------------------------------------------------------------------ */
/* Misc formatting                                                     */
/* ------------------------------------------------------------------ */

/**
 * Tone colours are applied through inline styles: `.chip` lives outside Tailwind's
 * layers in globals.css, so utility classes would lose the cascade fight for
 * border/color/background. The CSS vars flip automatically in dark mode.
 */
export type Tone = "bad" | "warn" | "ok" | "info" | "muted";

export const TONE_VARS: Record<Tone, { fg: string; bg: string }> = {
  bad: { fg: "var(--bad)", bg: "var(--bad-soft)" },
  warn: { fg: "var(--warn)", bg: "var(--warn-soft)" },
  ok: { fg: "var(--ok)", bg: "var(--ok-soft)" },
  info: { fg: "var(--brand)", bg: "var(--brand-soft)" },
  muted: { fg: "var(--muted)", bg: "transparent" },
};

export const accuracyTone = (value: number): Tone => (value < 60 ? "bad" : value <= 85 ? "warn" : "ok");

export function fmtAccuracy(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function fmtConfidence(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}
