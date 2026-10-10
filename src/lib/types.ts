/**
 * Shared data contract between the OCR pipeline (Python) and the Next.js app.
 *
 * The question bank itself is a build artifact: pipeline/parse_bank.py writes
 * data/bank/questions.json, which src/lib/bank.ts reads. Everything the user
 * produces (answers, wrong book, notes) lives in SQLite (data/app.db).
 */

export type BookTag = "up" | "dn" | "sl-up" | "sl-dn" | "yy-up" | "yy-dn";

/** [x, y, width, height] in OCR pixel space (dpi 200). */
export type BBox = [number, number, number, number];

export interface PageRef {
  tag: BookTag;
  /** 1-based PDF page index. */
  page: number;
  /** Printed page number in the book, when OCR picked it up. */
  bookPage?: number | null;
  bbox?: BBox | null;
}

export interface QuestionOption {
  label: string;
  /** Text option body; empty for pure-figure options. */
  text?: string | null;
  /** Crop of just this option, for figure options. */
  image?: string | null;
}

export interface QuestionSource {
  year?: number | null;
  /** 山东 / 国考 / 联考 ... */
  region?: string | null;
  /** original item code printed in brackets */
  code?: string | null;
  raw?: string | null;
}

export type QuestionKind = "figure" | "text";

/** 资料分析: what kind of 资料 a group is built on. */
export type MaterialKind = "table" | "chart" | "text" | "mixed";

/**
 * A 资料 (data set) shared by a group of ~5 items in 资料分析.
 *
 * It is an entity of its own rather than part of each stem: the same table or chart
 * is re-read for every item in the group, so the practice UI keeps it on screen while
 * those items are answered.
 */
export interface Material {
  /** e.g. `zl-m0001` (bank-prefixed like question ids). */
  id: string;
  bankId: string;
  chapterIndex: number;
  chapterTitle: string;
  /** 夯实基础 / 提升进阶 … */
  sectionTitle: string | null;
  /** 作业题 1 / 综合训练 3 — the set the group belongs to. */
  setTitle: string | null;
  /** printed （一）（二） marker inside the set. */
  groupLabel: string | null;
  kind: MaterialKind;
  /** 资料标题, e.g. 2016—2021年全国及部分省市集成电路产量. */
  title: string | null;
  /** 单位：亿块 */
  unit: string | null;
  /** OCR'd table rows ("A | B | C") or prose; null for pure charts. */
  text: string | null;
  /** /assets/materials/<id>.png — the authoritative picture of the 资料. */
  image: string | null;
  imageW?: number | null;
  imageH?: number | null;
  imagePages?: number[];
  source: string | null;
  pageRef: PageRef | null;
  ocrConfidence: number;
}

export interface Question {
  /** Stable id: `c<chapter>-q<num>` e.g. `c1-q0002`. */
  id: string;
  /** Owning bank (判断推理 / 数量关系 …), injected by src/lib/bank.ts on load. */
  bankId: string;
  chapterIndex: number;
  chapterTitle: string;
  sectionTitle: string | null;
  /** 考点 title, the finest teaching unit used for weak-point analysis. */
  pointTitle: string | null;
  /** 专项集训 卷一 / 卷二 ... when the item comes from a drill set. */
  drillTitle: string | null;
  /** Question number as printed, restarting per chapter. */
  num: number;
  kind: QuestionKind;
  stem: string;
  options: QuestionOption[];
  /** 资料分析: the shared 资料 this item belongs to; null for other modules. */
  materialId?: string | null;
  answer: string | null;
  analysis: string | null;
  /** 粉笔大数据 accuracy, 0-100. */
  accuracy: number | null;
  /** 易错项 */
  trapOption: string | null;
  source: QuestionSource | null;
  /** Figure crop(s) belonging to the stem. */
  figureImage: string | null;
  /** Full original scan crop of the whole item — the ground truth fallback. */
  cropImage: string | null;
  hasImage: boolean;
  pageRef: PageRef | null;
  answerPageRef: PageRef | null;
  /** Mean OCR confidence 0-1, used to surface low-quality items for review. */
  ocrConfidence: number;
  /** Pipeline warning codes: missing-answer, ocr-low, option-count ... */
  flags: string[];
  /**
   * Set when a human/vision pass corrected the OCR output; see
   * data/banks/<bank>/corrections.json. The pipeline owns questions.json and rewrites
   * it on every rebuild, so these live beside it and are re-applied at load.
   */
  correction?: CorrectionInfo | null;
}

/** Provenance of one manual correction, merged onto a question at load time. */
export interface CorrectionInfo {
  /** Question fields this entry overwrote, e.g. ["answer", "options"]. */
  fields: string[];
  /** Why — what the scan actually says, with the page it was read from. */
  why: string;
  /** ISO timestamp of the correction. */
  at: string;
}

/** One row of data/banks/<bank>/corrections.json. */
export interface CorrectionEntry {
  /**
   * Located by the book itself, never by question id: rebuilding the bank renumbers
   * ids (and (chapter, num) repeats across 考点 blocks), so only the printed 题号 on a
   * given 题目册 page stays a reliable address.
   */
  match: { page: number; num?: number; stemStart?: string };
  /** Fields to overwrite. Only these are touched. */
  set: Partial<Pick<Question, "stem" | "options" | "answer" | "analysis" | "accuracy" | "trapOption" | "answerPageRef">>;
  why: string;
  at: string;
  /** The id at the time of correcting, for humans reading the file. Never matched on. */
  id?: string;
}

export interface TaxonomyPoint {
  title: string;
  count: number;
}

export interface TaxonomySection {
  title: string;
  count: number;
  points: TaxonomyPoint[];
}

export interface TaxonomyChapter {
  index: number;
  title: string;
  count: number;
  answered: number;
  sections: TaxonomySection[];
}

export interface BankMeta {
  /** Owning bank id; written by the pipeline, backfilled from banks.ts if absent. */
  bankId: string;
  /** 科目名, e.g. 判断推理 / 数量关系. */
  subject: string;
  bookTitle: string;
  builtAt: string;
  totals: {
    questions: number;
    withAnswer: number;
    withAnalysis: number;
    withFigure: number;
    /** 资料分析 only: number of 资料 groups. */
    materials?: number;
    pagesOcr: number;
    /** Scanned pages the full build needs, so progress can be shown. */
    pagesTotal?: number;
  };
  chapters: TaxonomyChapter[];
  /** Flat list of every 考点, handy for the radar chart. */
  points: { chapterIndex: number; chapterTitle: string; sectionTitle: string | null; title: string; count: number }[];
}

/* ------------------------------------------------------------------ */
/* User state (SQLite)                                                 */
/* ------------------------------------------------------------------ */

export type PracticeMode = "recite" | "instant" | "exam" | "wrong" | "random" | "smart";

export interface AttemptRecord {
  id: number;
  questionId: string;
  sessionId: number | null;
  answer: string | null;
  correct: boolean;
  durationMs: number;
  mode: PracticeMode;
  createdAt: string;
}

export interface WrongEntry {
  questionId: string;
  wrongCount: number;
  firstAt: string;
  lastAt: string;
  status: "open" | "resolved";
  note: string | null;
  /** Leitner box 1..5; 5 means mastered. */
  box: number;
  nextReview: string | null;
  resolvedAt: string | null;
  question: Question | null;
}

export interface SessionSummary {
  id: number;
  title: string;
  mode: PracticeMode;
  scope: string | null;
  total: number;
  correct: number;
  durationMs: number;
  startedAt: string;
  finishedAt: string | null;
}

/* ------------------------------------------------------------------ */
/* Stats DTOs                                                          */
/* ------------------------------------------------------------------ */

export interface OverviewStats {
  answeredTotal: number;
  correctTotal: number;
  accuracy: number;
  streakDays: number;
  todayCount: number;
  todayAccuracy: number;
  wrongOpen: number;
  dueForReview: number;
  favorites: number;
  notes: number;
  bankTotal: number;
  coverage: number;
  avgSpeedMs: number;
  bestHour: { hour: number; count: number } | null;
}

export interface TrendPoint {
  date: string;
  total: number;
  correct: number;
  accuracy: number;
}

export interface ChapterStat {
  chapterIndex: number;
  chapterTitle: string;
  bankId: string;
  bankTitle: string;
  total: number;
  correct: number;
  accuracy: number;
  bankTotal: number;
}

export interface PointStat {
  chapterIndex: number;
  chapterTitle: string;
  bankId: string;
  bankTitle: string;
  title: string;
  total: number;
  correct: number;
  accuracy: number;
  bankTotal: number;
}

export interface HeatCell {
  date: string;
  count: number;
  correct: number;
}

export interface OptionBias {
  label: string;
  chosen: number;
  correctAsAnswer: number;
}

export interface DifficultyBucket {
  bucket: string;
  total: number;
  correct: number;
  accuracy: number;
}

/* ------------------------------------------------------------------ */
/* API request / response shapes                                       */
/* ------------------------------------------------------------------ */

export interface AnswerInput {
  questionId: string;
  answer: string | null;
  durationMs?: number;
  mode?: PracticeMode;
  sessionId?: number | null;
}

export interface AnswerResult {
  correct: boolean;
  answer: string | null;
  analysis: string | null;
  wrongCount: number;
  box: number;
}

export interface QuestionQuery {
  /** Restrict to one bank; absent = all banks. */
  bank?: string;
  chapter?: number;
  section?: string;
  point?: string;
  kind?: QuestionKind;
  status?: "all" | "unanswered" | "answered" | "wrong" | "favorite" | "smart";
  q?: string;
  flag?: string;
  limit?: number;
  offset?: number;
}

/* ------------------------------------------------------------------ */
/* 题型广场 (module plaza)                                              */
/* ------------------------------------------------------------------ */

export interface ModuleChapterSlice {
  index: number;
  title: string;
  count: number;
}

/**
 * One card in the 题型广场: everything needed to decide "do I study this module
 * now", including an honest OCR build status so a module that is still being
 * extracted shows progress instead of looking empty or broken.
 */
export interface ModuleSummary {
  id: string;
  /** 判断推理 / 数量关系 / 言语理解 / 资料分析. */
  subject: string;
  bookTitle: string;
  /** flat = 一题一干四选项; material-group = 一段资料带一组小题. */
  layout: "flat" | "material-group";
  built: boolean;
  questions: number;
  /** 资料分析 only. */
  materials: number;
  withAnswer: number;
  withFigure: number;
  answered: number;
  correct: number;
  accuracy: number;
  coverage: number;
  wrongOpen: number;
  dueForReview: number;
  favorites: number;
  chapters: ModuleChapterSlice[];
  /** Chapter titles, used as the card's subtitle. */
  topics: string[];
  builtAt: string | null;
  ocr: { pages: number; total: number; done: boolean };
}
