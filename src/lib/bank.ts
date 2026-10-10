import fs from "node:fs";
import path from "node:path";
import { bankDef, BANK_LIST } from "./banks";
import type { BankMeta, BookTag, CorrectionEntry, Material, Question, QuestionQuery } from "./types";

const BANKS_DIR = path.join(process.cwd(), "data", "banks");
const ASSETS_DIR = path.join(process.cwd(), "public", "assets");

interface BankCache {
  questions: Question[];
  byId: Map<string, Question>;
  metas: BankMeta[];
  /** 资料分析 资料块, keyed by material id. Empty for the other modules. */
  materials: Map<string, Material>;
  corrections: Record<string, CorrectionsReport>;
  mtime: number;
}

declare global {
  var __quizBank: BankCache | undefined;
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** File names actually present under public/assets/<dir>, or empty if never cropped. */
function assetNames(dir: "figures" | "crops" | "materials"): Set<string> {
  try {
    return new Set(fs.readdirSync(path.join(ASSETS_DIR, dir)));
  } catch {
    return new Set();
  }
}

/**
 * Trust a figure pointer only while its PNG is really on disk.
 *
 * crop_images.py writes the PNG and stamps the pointer in the same pass, so a pointer
 * whose file is gone belongs to a bank that was re-parsed (which renumbers ids) without
 * being re-cropped. Nothing here may invent a path from `q.id`: after a renumber the
 * file of that name is a *different* question's figure.
 */
function verifyAssets(questions: Question[]): void {
  const figures = assetNames("figures");
  const crops = assetNames("crops");
  for (const q of questions) {
    if (q.figureImage && !figures.has(path.basename(q.figureImage))) q.figureImage = null;
    if (q.cropImage && !crops.has(path.basename(q.cropImage))) q.cropImage = null;
    q.hasImage = !!q.figureImage;
  }
}

/** Warnings a corrected field makes untrue of the item. */
const RESOLVABLE: Record<string, string[]> = {
  answer: ["no-answer", "answer-not-in-options"],
  options: ["answer-not-in-options", "no-options", "options-1", "options-2", "options-3"],
  stem: ["empty-stem"],
  analysis: ["short-analysis"],
};

const normStem = (s?: string | null) => (s ?? "").replace(/\s+/g, "");

export interface CorrectionsReport {
  applied: number;
  /** Entries that could not be matched to exactly one question, with the reason. */
  unmatched: string[];
}

/**
 * Merge the human / vision-verified corrections onto the parsed bank.
 *
 * parse_bank.py rewrites questions.json from the OCR on every rebuild, so manual fixes
 * cannot live in that file. They are addressed by 题目册 page + printed 题号, because a
 * rebuild renumbers ids and (chapter, num) repeats across 考点 blocks. An entry that no
 * longer matches exactly one question is reported instead of being applied to whatever
 * question now shares the old id.
 */
function applyCorrections(dir: string, questions: Question[]): CorrectionsReport {
  const doc = readJson<{ entries?: CorrectionEntry[] }>(path.join(dir, "corrections.json"));
  const entries = doc?.entries ?? [];
  const report: CorrectionsReport = { applied: 0, unmatched: [] };
  if (!entries.length) return report;

  const byPage = new Map<number, Question[]>();
  for (const q of questions) {
    const page = q.pageRef?.page;
    if (page) byPage.set(page, [...(byPage.get(page) ?? []), q]);
  }

  for (const e of entries) {
    const hits = (e.match?.page ? byPage.get(e.match.page) : undefined)?.filter((q) => {
      if (e.match.num !== undefined && q.num !== e.match.num) return false;
      if (e.match.stemStart && !normStem(q.stem).startsWith(normStem(e.match.stemStart))) return false;
      return true;
    }) ?? [];
    if (hits.length !== 1) {
      report.unmatched.push(
        `${e.id ?? e.match.stemStart ?? "?"} @ p${e.match.page}${e.match.num !== undefined ? ` 第${e.match.num}题` : ""}：匹配到 ${hits.length} 题`,
      );
      continue;
    }
    const q = hits[0];
    const set = e.set ?? {};
    const fields = Object.keys(set).filter((k) => k !== "id" && k !== "bankId") as (keyof typeof set)[];
    for (const field of fields) {
      Object.assign(q, { [field]: set[field] });
    }
    const resolved = fields.flatMap((f) => RESOLVABLE[f] ?? []);
    // 题干与选项都被重新誊写过，整题的识别置信度警告也就失效了。
    if (fields.includes("stem") && fields.includes("options")) resolved.push("ocr-low");
    if (q.kind === "figure" && q.figureImage) q.hasImage = true;
    q.flags = ["corrected", ...q.flags.filter((f) => !resolved.includes(f))];
    // 校正可能切除或改写了那句结论，所以按现在的文本重判，而不是保留解析器当年的判断
    q.flags = conclusionClashes(q)
      ? [...new Set([...q.flags, "answer-mismatch"])]
      : q.flags.filter((f) => f !== "answer-mismatch");
    q.correction = { fields, why: e.why, at: e.at };
    report.applied += 1;
  }
  return report;
}

/** 解析末尾自述的结论字母；与答案是否矛盾要按当前文本算，不能沿用解析器留下的旧警告。 */
const CONCLUSION = /故正确答案为\s*([A-H])|正确答案应为\s*([A-H])/;
function conclusionClashes(q: Question): boolean {
  const m = CONCLUSION.exec(q.analysis ?? "");
  const letter = m?.[1] ?? m?.[2];
  return !!letter && !!q.answer && letter !== q.answer;
}

/** Load every registered bank; a bank with no artifacts yet is simply absent. */
function load(): BankCache {
  const files = BANK_LIST.flatMap((b) => [
    path.join(BANKS_DIR, b.id, "questions.json"),
    path.join(BANKS_DIR, b.id, "corrections.json"),
    path.join(BANKS_DIR, b.id, "materials.json"),
  ]);
  const mtime = Math.max(0, ...files.map((f) => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0)));
  if (
    !globalThis.__quizBank ||
    globalThis.__quizBank.mtime !== mtime ||
    !Array.isArray(globalThis.__quizBank.metas) ||
    !(globalThis.__quizBank.materials instanceof Map)
  ) {
    const questions: Question[] = [];
    const metas: BankMeta[] = [];
    const corrections: Record<string, CorrectionsReport> = {};
    const materials = new Map<string, Material>();
    const materialsOnDisk = assetNames("materials");
    for (const def of BANK_LIST) {
      const dir = path.join(BANKS_DIR, def.id);
      const qs = readJson<Question[]>(path.join(dir, "questions.json"));
      if (!qs?.length) continue;
      for (const q of qs) {
        // The pipeline owns ids and page tags; bankId is stamped here so every
        // consumer can attribute a question without a second lookup.
        q.bankId = def.id;
      }
      verifyAssets(qs);
      for (const m of readJson<Material[]>(path.join(dir, "materials.json")) ?? []) {
        m.bankId = def.id;
        // Same rule as verifyAssets(): a pointer whose PNG is gone is a stale id from
        // a re-numbered rebuild, and the table it claims to show belongs to someone else.
        if (m.image && !materialsOnDisk.has(path.basename(m.image))) m.image = null;
        materials.set(m.id, m);
      }
      corrections[def.id] = applyCorrections(dir, qs);
      const meta = readJson<BankMeta>(path.join(dir, "meta.json"));
      if (meta) {
        meta.bankId = meta.bankId || def.id;
        meta.subject = meta.subject || bankDef(def.id).title;
        // meta.json is written by the parse stage, before crops and before any manual
        // correction: report what the UI can actually show and grade.
        meta.totals.withFigure = qs.filter((q) => q.hasImage).length;
        meta.totals.withAnswer = qs.filter((q) => q.answer).length;
        meta.totals.withAnalysis = qs.filter((q) => q.analysis).length;
        metas.push(meta);
      }
      questions.push(...qs);
    }
    globalThis.__quizBank = {
      questions,
      byId: new Map(questions.map((q) => [q.id, q])),
      metas,
      materials,
      corrections,
      mtime,
    };
  }
  return globalThis.__quizBank;
}

/** All questions, or one bank's questions when `bankId` is given. */
export function getBank(bankId?: string): Question[] {
  const all = load().questions;
  return bankId ? all.filter((q) => q.bankId === bankId) : all;
}

export function getQuestion(id: string): Question | undefined {
  return load().byId.get(id);
}

/** Per-bank state of corrections.json, so entries a rebuild orphaned stay visible. */
export function getCorrectionsReport(): Record<string, CorrectionsReport> {
  return load().corrections;
}

/** One bank's meta (defaults to the first registered bank), or null before first build. */
export function getMeta(bankId?: string): BankMeta | null {
  const metas = load().metas;
  if (!metas.length) return null;
  const id = bankId ?? metas[0].bankId;
  return metas.find((m) => m.bankId === id) ?? null;
}

export function getMetas(): BankMeta[] {
  return load().metas;
}

export function bankReady(): boolean {
  return load().questions.length > 0;
}

/** Questions that exist on a scanned page — powers the 原书页面 browser. */
export function getQuestionsByPage(tag: BookTag, page: number): Question[] {
  return getBank().filter((q) => (tag.endsWith("dn") ? q.answerPageRef?.page === page : q.pageRef?.tag === tag && q.pageRef.page === page));
}

export function queryQuestions(query: QuestionQuery, pool?: Question[]) {
  const {
    bank,
    chapter,
    section,
    point,
    kind,
    q: text,
    flag,
    limit = 50,
    offset = 0,
  } = query;
  const needle = text?.trim().toLowerCase();
  const filtered = (pool ?? getBank()).filter((q) => {
    if (bank && q.bankId !== bank) return false;
    if (chapter !== undefined && q.chapterIndex !== chapter) return false;
    if (section && q.sectionTitle !== section) return false;
    if (point && q.pointTitle !== point) return false;
    if (kind && q.kind !== kind) return false;
    if (flag && !q.flags.includes(flag)) return false;
    if (needle) {
      const hay = `${q.stem} ${q.options.map((o) => o.text ?? "").join(" ")} ${q.analysis ?? ""} ${q.num}`
        .toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
  return {
    total: filtered.length,
    items: filtered.slice(offset, offset + limit),
  };
}

/** Ordered taxonomy tree for one bank's sidebar. */
export function getTaxonomy(bankId?: string) {
  const chapters = new Map<number, {
    index: number;
    title: string;
    count: number;
    sections: Map<string, { title: string; count: number; points: Map<string, number> }>;
  }>();
  for (const q of getBank(bankId)) {
    const ch = chapters.get(q.chapterIndex) ?? {
      index: q.chapterIndex,
      title: q.chapterTitle,
      count: 0,
      sections: new Map(),
    };
    ch.count += 1;
    const secTitle = q.sectionTitle ?? "本章综合";
    const sec = ch.sections.get(secTitle) ?? { title: secTitle, count: 0, points: new Map() };
    sec.count += 1;
    const pt = q.pointTitle ?? q.sectionTitle ?? "综合";
    sec.points.set(pt, (sec.points.get(pt) ?? 0) + 1);
    ch.sections.set(secTitle, sec);
    chapters.set(q.chapterIndex, ch);
  }
  return [...chapters.values()].sort((a, b) => a.index - b.index);
}

/* ------------------------------------------------------------------ */
/* 资料 (materials) — 资料分析 only                                     */
/* ------------------------------------------------------------------ */

/** One 资料 by id; null for the other modules, which have none. */
export function getMaterial(id: string | null | undefined): Material | null {
  if (!id) return null;
  return load().materials.get(id) ?? null;
}

export function getMaterials(bankId?: string): Material[] {
  const all = [...load().materials.values()];
  return bankId ? all.filter((m) => m.bankId === bankId) : all;
}

/** Every item that shares one 资料, in printed order — how the app groups a set. */
export function materialSiblings(materialId: string | null | undefined): Question[] {
  if (!materialId) return [];
  return getBank()
    .filter((q) => q.materialId === materialId)
    .sort((a, b) => a.num - b.num);
}
