import fs from "node:fs";
import path from "node:path";
import { BANK_LIST } from "./banks";
import type { BankLayout } from "./banks";

/**
 * Reader for data/banks/<id>/verification.json — the per-question verdicts written by
 * pipeline/verify_bank.py. Server-only, like bank.ts: fs never reaches the client.
 *
 * The file is pipeline output, not app input: every shape check happens here so a
 * half-written or restructured JSON degrades to "该科目尚未校验" instead of a crash.
 */

const BANKS_DIR = path.join(process.cwd(), "data", "banks");

/** Evidence grades, strongest first — the vocabulary of verify_bank.py's `evidence` field. */
export const EVIDENCE_GRADES = ["quoted", "strong", "weak", "none", "untestable"] as const;
export type EvidenceGrade = (typeof EVIDENCE_GRADES)[number];

/** One question's verdict; fields mirror verify_bank.py's row, defensively coerced. */
export interface VerificationRow {
  id: string;
  chapter: number;
  num: number;
  answer: string | null;
  ok: boolean;
  evidence: EvidenceGrade;
  evidenceScore: number;
  /** Raw defect codes; a `(` suffix carries the pipeline's evidence values. */
  reasons: string[];
  /** Advisory signals that do not mark the question suspect. */
  notes: string[];
  /**
   * Fields a human / vision pass overwrote via corrections.json, or null when the row is
   * pure OCR. verify_bank.py merges those before judging, so the verdict here is about
   * the corrected question — the chip just tells the reader where it came from.
   */
  corrected?: string[] | null;
  /** The 下册 page really prints `N.【答案】<this letter>` for this number, that number
   *  is not claimed twice at the same height, and the letter is a printed option. */
  structural: boolean;
  /** Proof tokens collected by the pipeline (printed anchor / conclusion / options). */
  proof: string[];
}

export interface VerificationSummary {
  bank: string;
  layout: BankLayout;
  questions: number;
  verified: number;
  suspect: number;
  /** Defect class → count; classes are reason codes with the `(...)` detail stripped. */
  reasons: Record<string, number>;
  notes: Record<string, number>;
  /** Evidence grade → count; a grade the bank lacks is absent, not zero. */
  evidence: Record<string, number>;
  withAnswer: number;
  materials: number;
  /** Answered questions whose pairing is settled by the printed anchor alone. */
  anchorProven: number;
  /** Answered questions the machine cannot settle: only the page image can. */
  needsEyes: number;
  /** Options the reader cannot see in full (OCR dropped a whole option row). */
  optionsIncomplete: number;
  printedAnchors: number;
  unclaimedAnchors: number;
  unclaimedSample: string[];
}

export interface VerificationDoc {
  summary: VerificationSummary;
  rows: VerificationRow[];
}

/** A suspect row plus the bank it came from, so one flat list stays attributable. */
export interface SuspectRow extends VerificationRow {
  bankId: string;
}

interface VerificationCache {
  docs: Map<string, VerificationDoc>;
  rowsById: Map<string, Map<string, VerificationRow>>;
  mtime: number;
}

declare global {
  var __quizVerification: VerificationCache | undefined;
}

function readJsonSafe(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Missing or unreadable files count as mtime 0, exactly like the existsSync guard in bank.ts. */
function mtimeOf(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** JSON.parse yields own properties only, so Object.entries here can't hit prototype keys. */
function countMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== "object") return out;
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
    if (typeof n === "number" && Number.isFinite(n)) out[k] = n;
  }
  return out;
}

function asGrade(v: unknown): EvidenceGrade {
  return (EVIDENCE_GRADES as readonly unknown[]).includes(v) ? (v as EvidenceGrade) : "none";
}

/** Validate one parsed file; null means "treat this bank as unverified". */
function parseDoc(raw: unknown): VerificationDoc | null {
  if (!raw || typeof raw !== "object") return null;
  const doc = raw as { summary?: unknown; rows?: unknown };
  if (!Array.isArray(doc.rows) || !doc.summary || typeof doc.summary !== "object") return null;

  const s = doc.summary as Record<string, unknown>;
  const summary: VerificationSummary = {
    bank: str(s.bank),
    layout: s.layout === "material-group" ? "material-group" : "flat",
    questions: num(s.questions),
    verified: num(s.verified),
    suspect: num(s.suspect),
    reasons: countMap(s.reasons),
    notes: countMap(s.notes),
    evidence: countMap(s.evidence),
      anchorProven: num(s.anchorProven),
      needsEyes: num(s.needsEyes),
      optionsIncomplete: num(s.optionsIncomplete),
    withAnswer: num(s.withAnswer),
    materials: num(s.materials),
    printedAnchors: num(s.printedAnchors),
    unclaimedAnchors: num(s.unclaimedAnchors),
    unclaimedSample: strArray(s.unclaimedSample),
  };

  const rows: VerificationRow[] = [];
  for (const item of doc.rows) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const id = str(r.id);
    if (!id) continue;
    rows.push({
      id,
      chapter: num(r.chapter),
      num: num(r.num),
      answer: typeof r.answer === "string" && r.answer ? r.answer : null,
      // A row that forgot `ok` lands in 可疑 rather than passing silently.
      ok: r.ok === true,
      evidence: asGrade(r.evidence),
      evidenceScore: num(r.evidenceScore),
      reasons: strArray(r.reasons),
      notes: strArray(r.notes),
      structural: r.structural === true,
      proof: strArray(r.proof),
      corrected: Array.isArray(r.corrected) ? r.corrected.filter((x): x is string => typeof x === "string") : null,
    });
  }
  return { summary, rows };
}

/** Re-read every registered bank's file when any verification.json changed on disk. */
function load(): VerificationCache {
  const files = BANK_LIST.map((b) => path.join(BANKS_DIR, b.id, "verification.json"));
  const mtime = Math.max(0, ...files.map(mtimeOf));
  if (
    !globalThis.__quizVerification ||
    globalThis.__quizVerification.mtime !== mtime ||
    !(globalThis.__quizVerification.docs instanceof Map) ||
    !(globalThis.__quizVerification.rowsById instanceof Map)
  ) {
    const docs = new Map<string, VerificationDoc>();
    const rowsById = new Map<string, Map<string, VerificationRow>>();
    for (const def of BANK_LIST) {
      const doc = parseDoc(readJsonSafe(path.join(BANKS_DIR, def.id, "verification.json")));
      if (!doc) continue; // unbuilt or never verified — callers get null, never a throw
      docs.set(def.id, doc);
      rowsById.set(def.id, new Map(doc.rows.map((r) => [r.id, r])));
    }
    globalThis.__quizVerification = { docs, rowsById, mtime };
  }
  return globalThis.__quizVerification;
}

/** One bank's whole verdict file, or null when it has not been verified yet. */
export function getVerification(bankId: string | null | undefined): VerificationDoc | null {
  if (!bankId) return null;
  return load().docs.get(bankId) ?? null;
}

export interface BankVerificationSummary {
  bankId: string;
  /** BANK_LIST display title. */
  title: string;
  summary: VerificationSummary;
}

/** Verified banks only, in BANK_LIST order; a missing file simply has no entry. */
export function getAllVerificationSummaries(): BankVerificationSummary[] {
  const cache = load();
  return BANK_LIST.flatMap((b) => {
    const doc = cache.docs.get(b.id);
    return doc ? [{ bankId: b.id, title: b.title, summary: doc.summary }] : [];
  });
}

/** The verdict stored for one question, or null when unverified / unknown id. */
export function getVerificationRow(
  bankId: string | null | undefined,
  questionId: string | null | undefined,
): VerificationRow | null {
  if (!bankId || !questionId) return null;
  return load().rowsById.get(bankId)?.get(questionId) ?? null;
}

/**
 * Every suspect row (ok === false), `bankId` scoped or across all verified banks.
 * File order is preserved: rows are written per bank in chapter + 原题号 order.
 */
export function getSuspectRows(bankId?: string): SuspectRow[] {
  const cache = load();
  const defs = bankId ? BANK_LIST.filter((b) => b.id === bankId) : BANK_LIST;
  const out: SuspectRow[] = [];
  for (const def of defs) {
    const doc = cache.docs.get(def.id);
    if (!doc) continue;
    for (const r of doc.rows) if (!r.ok) out.push({ ...r, bankId: def.id });
  }
  return out;
}
