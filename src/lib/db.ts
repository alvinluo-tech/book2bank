import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { BANK_LIST, bankDef, bankPageTotal, bankTags, chapterKey } from "./banks";
import { getBank, getMetas, getQuestion } from "./bank";
import type {
  AnswerInput,
  AnswerResult,
  ChapterStat,
  DifficultyBucket,
  HeatCell,
  OptionBias,
  OverviewStats,
  PointStat,
  PracticeMode,
  Question,
  SessionSummary,
  TrendPoint,
  WrongEntry,
  ModuleSummary,
} from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = process.env.QUIZ_DB_PATH ?? path.join(DATA_DIR, "app.db");

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id  TEXT NOT NULL,
  session_id   INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
  answer       TEXT,
  correct      INTEGER NOT NULL,
  duration_ms  INTEGER NOT NULL DEFAULT 0,
  mode         TEXT NOT NULL DEFAULT 'instant',
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_attempts_q ON attempts(question_id);
CREATE INDEX IF NOT EXISTS idx_attempts_day ON attempts(created_at);

CREATE TABLE IF NOT EXISTS sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL DEFAULT '',
  mode        TEXT NOT NULL,
  scope       TEXT,
  total       INTEGER NOT NULL DEFAULT 0,
  correct     INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  started_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS wrong_book (
  question_id TEXT PRIMARY KEY,
  wrong_count INTEGER NOT NULL DEFAULT 1,
  first_at    TEXT NOT NULL,
  last_at     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',
  note        TEXT,
  box         INTEGER NOT NULL DEFAULT 1,
  next_review TEXT,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS favorites (
  question_id TEXT PRIMARY KEY,
  added_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  note        TEXT
);

CREATE TABLE IF NOT EXISTS notes (
  question_id TEXT PRIMARY KEY,
  text        TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS question_tags (
  question_id TEXT NOT NULL,
  tag_id      INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (question_id, tag_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`;

/** Leitner intervals (days) per box; reaching box 5 marks the item mastered. */
const BOX_DAYS = [0, 1, 3, 7, 21];
const MASTER_BOX = 5;

function connect(): Database.Database {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("busy_timeout = 5000");
  db.exec(SCHEMA);
  return db;
}

declare global {
  var __quizDb: Database.Database | undefined;
}

export function getDb(): Database.Database {
  if (!globalThis.__quizDb) globalThis.__quizDb = connect();
  return globalThis.__quizDb;
}

const dayAdd = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 19).replace("T", " ");
};

/* ------------------------------------------------------------------ */
/* Attempts + wrong book                                               */
/* ------------------------------------------------------------------ */

export function recordAnswer(input: AnswerInput): AnswerResult {
  const db = getDb();
  const question = getQuestion(input.questionId);
  // 外部输入一律收敛成数据库期待的形状：损坏的请求应该得到一个正常
  // 的“错题/未判分”，而不是一条 500。
  const answer =
    typeof input.answer === "string" ? input.answer.trim().toUpperCase().slice(0, 4) || null : null;
  const correct = !!question?.answer && !!answer && question.answer === answer;
  const mode: PracticeMode = input.mode ?? "instant";
  const sessionId = Number.isFinite(input.sessionId) ? Number(input.sessionId) : null;
  const durationMs = Math.max(0, Math.min(Number(input.durationMs) || 0, 3_600_000));

  db.prepare(
    `INSERT INTO attempts (question_id, session_id, answer, correct, duration_ms, mode)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(input.questionId, sessionId, answer, correct ? 1 : 0, durationMs, mode);

  if (sessionId !== null) {
    db.prepare(
      `UPDATE sessions SET total = total + 1, correct = correct + ?, duration_ms = duration_ms + ? WHERE id = ?`,
    ).run(correct ? 1 : 0, durationMs, sessionId);
  }

  const existing = db
    .prepare(`SELECT * FROM wrong_book WHERE question_id = ?`)
    .get(input.questionId) as
    | { wrong_count: number; box: number; status: string }
    | undefined;

  if (!correct && question?.answer) {
    if (existing) {
      db.prepare(
        `UPDATE wrong_book SET wrong_count = wrong_count + 1, last_at = datetime('now','localtime'),
           status = 'open', box = 1, next_review = ?, resolved_at = NULL WHERE question_id = ?`,
      ).run(dayAdd(BOX_DAYS[0]), input.questionId);
    } else {
      db.prepare(
        `INSERT INTO wrong_book (question_id, wrong_count, first_at, last_at, status, box, next_review)
         VALUES (?, 1, datetime('now','localtime'), datetime('now','localtime'), 'open', 1, ?)`,
      ).run(input.questionId, dayAdd(BOX_DAYS[0]));
    }
  } else if (correct && existing && existing.status === "open") {
    const nextBox = Math.min(MASTER_BOX, (existing.box || 1) + 1);
    const mastered = nextBox >= MASTER_BOX;
    db.prepare(
      `UPDATE wrong_book SET box = ?, next_review = ?, status = ?, resolved_at = ? WHERE question_id = ?`,
    ).run(nextBox, mastered ? null : dayAdd(BOX_DAYS[nextBox - 1]),
      mastered ? "resolved" : "open", mastered ? dayAdd(0) : null, input.questionId);
  }

  const row = db
    .prepare(`SELECT wrong_count, box FROM wrong_book WHERE question_id = ?`)
    .get(input.questionId) as { wrong_count: number; box: number } | undefined;

  return {
    correct,
    answer: question?.answer ?? null,
    analysis: question?.analysis ?? null,
    wrongCount: row?.wrong_count ?? 0,
    box: row?.box ?? 0,
  };
}

export function createSession(title: string, mode: PracticeMode, scope: string | null) {
  const info = getDb()
    .prepare(`INSERT INTO sessions (title, mode, scope) VALUES (?, ?, ?)`)
    .run(title, mode, scope);
  return Number(info.lastInsertRowid);
}

export function closeSession(id: number) {
  getDb().prepare(`UPDATE sessions SET finished_at = datetime('now','localtime') WHERE id = ?`).run(id);
}

export function listSessions(limit = 50): SessionSummary[] {
  return (getDb()
    .prepare(`SELECT * FROM sessions ORDER BY id DESC LIMIT ?`)
    .all(limit) as Record<string, unknown>[]).map((r) => ({
    id: Number(r.id),
    title: String(r.title ?? ""),
    mode: String(r.mode) as PracticeMode,
    scope: (r.scope as string) ?? null,
    total: Number(r.total),
    correct: Number(r.correct),
    durationMs: Number(r.duration_ms),
    startedAt: String(r.started_at),
    finishedAt: (r.finished_at as string) ?? null,
  }));
}

export function listWrong(opts: { status?: string; chapterKey?: string; due?: boolean; limit?: number } = {}): WrongEntry[] {
  const db = getDb();
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (opts.status) { where.push(`wb.status = ?`); args.push(opts.status); }
  if (opts.due) { where.push(`wb.status = 'open' AND (wb.next_review IS NULL OR wb.next_review <= datetime('now','localtime'))`); }
  const sql = `SELECT wb.* FROM wrong_book wb ${where.length ? "WHERE " + where.join(" AND ") : ""}
               ORDER BY wb.last_at DESC LIMIT ?`;
  args.push(opts.limit ?? 500);
  const rows = db.prepare(sql).all(...args) as Record<string, unknown>[];
  return rows
    .map((r) => {
      const q = getQuestion(String(r.question_id));
      if (opts.chapterKey !== undefined && (!q || chapterKey(q.bankId, q.chapterIndex) !== opts.chapterKey)) return null;
      return {
        questionId: String(r.question_id),
        wrongCount: Number(r.wrong_count),
        firstAt: String(r.first_at),
        lastAt: String(r.last_at),
        status: (r.status === "resolved" ? "resolved" : "open") as WrongEntry["status"],
        note: (r.note as string) ?? null,
        box: Number(r.box ?? 1),
        nextReview: (r.next_review as string) ?? null,
        resolvedAt: (r.resolved_at as string) ?? null,
        question: q ?? null,
      } as WrongEntry;
    })
    .filter(Boolean) as WrongEntry[];
}

export function updateWrong(questionId: string, patch: { note?: string | null; status?: "open" | "resolved"; box?: number }) {
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  if (patch.note !== undefined) { sets.push("note = ?"); args.push(patch.note); }
  if (patch.box !== undefined) {
    sets.push("box = ?"); args.push(patch.box);
    const mastered = patch.box >= MASTER_BOX;
    sets.push("status = ?"); args.push(mastered ? "resolved" : "open");
    sets.push("resolved_at = ?"); args.push(mastered ? dayAdd(0) : null);
    sets.push("next_review = ?"); args.push(mastered ? null : dayAdd(BOX_DAYS[patch.box - 1]));
  }
  if (patch.status !== undefined) {
    sets.push("status = ?"); args.push(patch.status);
    if (patch.status === "resolved") { sets.push("resolved_at = datetime('now','localtime')"); sets.push("next_review = NULL"); }
  }
  if (!sets.length) return false;
  args.push(questionId);
  getDb().prepare(`UPDATE wrong_book SET ${sets.join(", ")} WHERE question_id = ?`).run(...args);
  return true;
}

export function removeWrong(questionId: string) {
  getDb().prepare(`DELETE FROM wrong_book WHERE question_id = ?`).run(questionId);
}

export function toggleFavorite(questionId: string) {
  const db = getDb();
  const hit = db.prepare(`SELECT 1 FROM favorites WHERE question_id = ?`).get(questionId);
  if (hit) db.prepare(`DELETE FROM favorites WHERE question_id = ?`).run(questionId);
  else db.prepare(`INSERT INTO favorites (question_id) VALUES (?)`).run(questionId);
  return !hit;
}

export function listFavorites() {
  return (getDb().prepare(`SELECT * FROM favorites ORDER BY added_at DESC`).all() as Record<string, unknown>[])
    .map((r) => ({
      questionId: String(r.question_id),
      addedAt: String(r.added_at),
      note: (r.note as string) ?? null,
      question: getQuestion(String(r.question_id)) ?? null,
    }));
}

/** 收藏 id 集合：列表页只要 id，不值得为每行解析完整题目对象。 */
export function listFavoriteIds(): string[] {
  return (getDb().prepare(`SELECT question_id FROM favorites`).all() as { question_id: string }[]).map(
    (r) => r.question_id,
  );
}

/** 某状态的错题 id 集合（默认 open）。 */
export function listWrongIds(status = "open"): string[] {
  return (getDb()
    .prepare(`SELECT question_id FROM wrong_book WHERE status = ?`)
    .all(status) as { question_id: string }[]).map((r) => r.question_id);
}

export function setNote(questionId: string, text: string) {
  getDb()
    .prepare(
      `INSERT INTO notes (question_id, text, updated_at) VALUES (?, ?, datetime('now','localtime'))
       ON CONFLICT(question_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`,
    )
    .run(questionId, text);
}

export function getNote(questionId: string): string | null {
  const row = getDb().prepare(`SELECT text FROM notes WHERE question_id = ?`).get(questionId) as
    | { text: string } | undefined;
  return row?.text ?? null;
}

export function listNotes() {
  return (getDb().prepare(`SELECT * FROM notes ORDER BY updated_at DESC`).all() as Record<string, unknown>[])
    .map((r) => ({
      questionId: String(r.question_id),
      text: String(r.text),
      updatedAt: String(r.updated_at),
      question: getQuestion(String(r.question_id)) ?? null,
    }));
}

export function setTags(questionId: string, names: string[]) {
  const db = getDb();
  db.prepare(`DELETE FROM question_tags WHERE question_id = ?`).run(questionId);
  for (const raw of names.map((n) => n.trim()).filter(Boolean)) {
    db.prepare(`INSERT OR IGNORE INTO tags (name) VALUES (?)`).run(raw);
    const tag = db.prepare(`SELECT id FROM tags WHERE name = ?`).get(raw) as { id: number };
    db.prepare(`INSERT OR IGNORE INTO question_tags (question_id, tag_id) VALUES (?, ?)`).run(questionId, tag.id);
  }
}

export function listTags() {
  return (getDb().prepare(
    `SELECT t.name, COUNT(qt.question_id) AS n FROM tags t LEFT JOIN question_tags qt ON qt.tag_id = t.id
     GROUP BY t.id HAVING n > 0 ORDER BY n DESC`,
  ).all() as { name: string; n: number }[]);
}

/* ------------------------------------------------------------------ */
/* Statistics                                                          */
/* ------------------------------------------------------------------ */

export function getOverview(): OverviewStats {
  const db = getDb();
  const bankTotal = getBank().length;
  const a = db.prepare(
    `SELECT COUNT(*) AS total, COALESCE(SUM(correct),0) AS correct,
            AVG(NULLIF(duration_ms,0)) AS avg_ms,
            COUNT(DISTINCT question_id) AS answered
     FROM attempts`,
  ).get() as { total: number; correct: number; avg_ms: number | null; answered: number };
  const today = db.prepare(
    `SELECT COUNT(*) AS total, COALESCE(SUM(correct),0) AS correct FROM attempts
     WHERE date(created_at) = date('now','localtime')`,
  ).get() as { total: number; correct: number };
  const streak = db.prepare(
    `SELECT COUNT(DISTINCT date(created_at)) AS d FROM attempts
     WHERE created_at >= datetime('now','localtime','-30 day')`,
  ).get() as { d: number };
  const wrongOpen = db.prepare(`SELECT COUNT(*) AS n FROM wrong_book WHERE status='open'`).get() as { n: number };
  const due = db.prepare(
    `SELECT COUNT(*) AS n FROM wrong_book WHERE status='open' AND (next_review IS NULL OR next_review <= datetime('now','localtime'))`,
  ).get() as { n: number };
  const fav = db.prepare(`SELECT COUNT(*) AS n FROM favorites`).get() as { n: number };
  const notes = db.prepare(`SELECT COUNT(*) AS n FROM notes WHERE text <> ''`).get() as { n: number };
  const hour = db.prepare(
    `SELECT CAST(strftime('%H', created_at) AS INTEGER) AS h, COUNT(*) AS n FROM attempts GROUP BY h ORDER BY n DESC LIMIT 1`,
  ).get() as { h: number; n: number } | undefined;

  return {
    answeredTotal: a.total,
    correctTotal: a.correct,
    accuracy: a.total ? (a.correct / a.total) * 100 : 0,
    streakDays: streak.d,
    todayCount: today.total,
    todayAccuracy: today.total ? (today.correct / today.total) * 100 : 0,
    wrongOpen: wrongOpen.n,
    dueForReview: due.n,
    favorites: fav.n,
    notes: notes.n,
    bankTotal,
    coverage: bankTotal ? (a.answered / bankTotal) * 100 : 0,
    avgSpeedMs: Math.round(a.avg_ms ?? 0),
    bestHour: hour ? { hour: hour.h, count: hour.n } : null,
  };
}

export function getTrend(days = 30): TrendPoint[] {
  const rows = getDb().prepare(
    `SELECT date(created_at) AS d, COUNT(*) AS total, COALESCE(SUM(correct),0) AS correct
     FROM attempts WHERE created_at >= datetime('now','localtime', ?)
     GROUP BY d ORDER BY d`,
  ).all(`-${days} day`) as { d: string; total: number; correct: number }[];
  return rows.map((r) => ({
    date: r.d,
    total: r.total,
    correct: r.correct,
    accuracy: r.total ? (r.correct / r.total) * 100 : 0,
  }));
}

export function getChapterStats(): ChapterStat[] {
  const byChapter = new Map<string, { q: Question; title: string; total: number; correct: number; bank: number }>();
  for (const q of getBank()) {
    const ck = chapterKey(q.bankId, q.chapterIndex);
    const e = byChapter.get(ck) ?? { q, title: q.chapterTitle, total: 0, correct: 0, bank: 0 };
    e.bank += 1;
    byChapter.set(ck, e);
  }
  const seen = new Map<string, number>();
  for (const a of getDb().prepare(`SELECT question_id, correct FROM attempts ORDER BY id`).all() as
    { question_id: string; correct: number }[]) {
    seen.set(a.question_id, a.correct);
  }
  for (const [qid, correct] of seen) {
    const q = getQuestion(qid);
    if (!q) continue;
    const e = byChapter.get(chapterKey(q.bankId, q.chapterIndex));
    if (e) { e.total += 1; e.correct += correct; }
  }
  return [...byChapter.entries()]
    .sort((x, y) => x[0].localeCompare(y[0], "zh-CN"))
    .map(([, v]) => ({
      chapterIndex: v.q.chapterIndex,
      chapterTitle: v.title,
      bankId: v.q.bankId,
      bankTitle: bankDef(v.q.bankId).title,
      total: v.total,
      correct: v.correct,
      accuracy: v.total ? (v.correct / v.total) * 100 : 0,
      bankTotal: v.bank,
    }));
}

export function getPointStats(): PointStat[] {
  const agg = new Map<string, PointStat>();
  for (const q of getBank()) {
    const ck = chapterKey(q.bankId, q.chapterIndex);
    const key = `${ck}::${q.pointTitle ?? q.sectionTitle ?? "未分类"}`;
    const e = agg.get(key) ?? {
      chapterIndex: q.chapterIndex,
      chapterTitle: q.chapterTitle,
      bankId: q.bankId,
      bankTitle: bankDef(q.bankId).title,
      title: q.pointTitle ?? q.sectionTitle ?? "未分类",
      total: 0,
      correct: 0,
      accuracy: 0,
      bankTotal: 0,
    };
    e.bankTotal += 1;
    agg.set(key, e);
  }
  const seen = new Map<string, number>();
  for (const a of getDb().prepare(`SELECT question_id, correct FROM attempts ORDER BY id`).all() as
    { question_id: string; correct: number }[]) {
    seen.set(a.question_id, a.correct);
  }
  for (const [qid, correct] of seen) {
    const q = getQuestion(qid);
    if (!q) continue;
    const ck = chapterKey(q.bankId, q.chapterIndex);
    const e = agg.get(`${ck}::${q.pointTitle ?? q.sectionTitle ?? "未分类"}`);
    if (e) { e.total += 1; e.correct += correct; }
  }
  return [...agg.values()]
    .map((e) => ({ ...e, accuracy: e.total ? (e.correct / e.total) * 100 : 0 }))
    .sort((a, b) =>
      a.bankId.localeCompare(b.bankId) || a.chapterIndex - b.chapterIndex || b.bankTotal - a.bankTotal);
}

export function getHeatmap(days = 120): HeatCell[] {
  const rows = getDb().prepare(
    `SELECT date(created_at) AS date, COUNT(*) AS count, COALESCE(SUM(correct),0) AS correct
     FROM attempts WHERE created_at >= datetime('now','localtime', ?) GROUP BY date ORDER BY date`,
  ).all(`-${days} day`) as HeatCell[];
  return rows;
}

export function getOptionBias(): OptionBias[] {
  const rows = getDb().prepare(`SELECT answer, correct FROM attempts WHERE answer IS NOT NULL`).all() as
    { answer: string; correct: number }[];
  const chosen = new Map<string, number>();
  for (const r of rows) chosen.set(r.answer, (chosen.get(r.answer) ?? 0) + 1);
  const asAnswer = new Map<string, number>();
  for (const q of getBank()) {
    if (q.answer) asAnswer.set(q.answer, (asAnswer.get(q.answer) ?? 0) + 1);
  }
  return ["A", "B", "C", "D", "E", "F", "G", "H"].map((label) => ({
    label,
    chosen: chosen.get(label) ?? 0,
    correctAsAnswer: asAnswer.get(label) ?? 0,
  }));
}

export function getDifficultyBuckets(): DifficultyBucket[] {
  const buckets = [
    { bucket: "<60% 易错", lo: 0, hi: 60 },
    { bucket: "60-80%", lo: 60, hi: 80 },
    { bucket: "80-90%", lo: 80, hi: 90 },
    { bucket: ">90% 简单", lo: 90, hi: 101 },
    { bucket: "无数据", lo: -1, hi: -1 },
  ];
  const seen = new Map<string, number>();
  for (const a of getDb().prepare(`SELECT question_id, correct FROM attempts ORDER BY id`).all() as
    { question_id: string; correct: number }[]) seen.set(a.question_id, a.correct);
  return buckets.map((b) => {
    let total = 0;
    let correct = 0;
    for (const [qid, ok] of seen) {
      const q = getQuestion(qid);
      if (!q) continue;
      const acc = q.accuracy ?? -1;
      const hit = b.lo < 0 ? acc < 0 : acc >= b.lo && acc < b.hi;
      if (hit) { total += 1; correct += ok; }
    }
    return { bucket: b.bucket, total, correct, accuracy: total ? (correct / total) * 100 : 0 };
  });
}

/** Questions the learner has never answered or keeps missing — powers 智能练习. */
export function getSmartQueue(chapter?: string, limit = 50) {
  const db = getDb();
  const seen = new Set(
    (db.prepare(`SELECT DISTINCT question_id FROM attempts`).all() as { question_id: string }[]).map((r) => r.question_id),
  );
  const wrong = new Map(
    (db.prepare(`SELECT question_id, wrong_count, box FROM wrong_book WHERE status='open'`).all() as
      { question_id: string; wrong_count: number; box: number }[]).map((r) => [r.question_id, r]),
  );
  const scored = getBank()
    .filter((q) => !chapter || chapterKey(q.bankId, q.chapterIndex) === chapter)
    .map((q) => {
      const w = wrong.get(q.id);
      let score = 0;
      if (!seen.has(q.id)) score += 5;
      if (w) score += 10 + w.wrong_count * 2 - w.box;
      if (q.accuracy !== null && q.accuracy < 60) score += 3;
      if (q.flags.includes("ocr-low")) score -= 2;
      return { q, score };
    })
    .sort((a, b) => b.score - a.score || a.q.id.localeCompare(b.q.id));
  return scored.slice(0, limit).map((s) => s.q);
}

export function exportUserData() {
  const db = getDb();
  return {
    exportedAt: new Date().toISOString(),
    attempts: db.prepare(`SELECT * FROM attempts ORDER BY id`).all(),
    sessions: db.prepare(`SELECT * FROM sessions ORDER BY id`).all(),
    wrongBook: db.prepare(`SELECT * FROM wrong_book`).all(),
    favorites: db.prepare(`SELECT * FROM favorites`).all(),
    notes: db.prepare(`SELECT * FROM notes`).all(),
    tags: db.prepare(`SELECT * FROM tags`).all(),
    questionTags: db.prepare(`SELECT * FROM question_tags`).all(),
  };
}

export function resetUserData() {
  const db = getDb();
  db.exec(`DELETE FROM attempts; DELETE FROM sessions; DELETE FROM wrong_book;
           DELETE FROM favorites; DELETE FROM notes; DELETE FROM question_tags; DELETE FROM tags;`);
}

/* ------------------------------------------------------------------ */
/* 题型广场 (module plaza)                                              */
/* ------------------------------------------------------------------ */

/** Pages already OCR'd for one bank, read live so progress moves while a build runs. */
function ocrPageCount(tags: string[]): number {
  let n = 0;
  for (const tag of tags) {
    try {
      n += fs.readdirSync(path.join(process.cwd(), "data", "ocr", tag)).length;
    } catch {
      /* that side has not been started yet */
    }
  }
  return n;
}

/**
 * One card per module: what the bank holds, how far the learner is through it, and
 * how far the OCR build has got. Built from the registry rather than from meta.json
 * alone so a module that is still being extracted shows up as progress, not as a
 * missing card.
 */
export function getModuleSummaries(): ModuleSummary[] {
  const db = getDb();
  const metas = getMetas();
  const bank = getBank();
  const lastAttempt = db.prepare(
    `SELECT question_id, correct FROM attempts WHERE id IN (SELECT MAX(id) FROM attempts GROUP BY question_id)`,
  ).all() as { question_id: string; correct: number }[];
  const wrongOpen = new Set(
    (db.prepare(`SELECT question_id FROM wrong_book WHERE status = 'open'`).all() as { question_id: string }[])
      .map((r) => r.question_id),
  );
  const due = new Set(
    (db.prepare(
      `SELECT question_id FROM wrong_book WHERE status = 'open'
        AND (next_review IS NULL OR next_review <= datetime('now','localtime'))`,
    ).all() as { question_id: string }[]).map((r) => r.question_id),
  );
  const favs = new Set(
    (db.prepare(`SELECT question_id FROM favorites`).all() as { question_id: string }[]).map((r) => r.question_id),
  );
  const correctIds = new Set(lastAttempt.filter((a) => a.correct).map((a) => a.question_id));
  const attempted = new Set(lastAttempt.map((a) => a.question_id));

  return BANK_LIST.map((def) => {
    const meta = metas.find((m) => m.bankId === def.id) ?? null;
    const questions = bank.filter((q) => q.bankId === def.id);
    const answered = questions.filter((q) => attempted.has(q.id));
    const correct = answered.filter((q) => correctIds.has(q.id)).length;
    const ocrPages = ocrPageCount(bankTags(def.id));
    const total = meta?.totals.pagesTotal ?? bankPageTotal(def.id);
    return {
      id: def.id,
      subject: def.title,
      bookTitle: meta?.bookTitle ?? def.fullTitle,
      layout: def.layout,
      built: questions.length > 0,
      questions: questions.length,
      materials: meta?.totals.materials ?? 0,
      withAnswer: questions.filter((q) => q.answer).length,
      withFigure: questions.filter((q) => q.hasImage).length,
      answered: answered.length,
      correct,
      accuracy: answered.length ? (correct / answered.length) * 100 : 0,
      coverage: questions.length ? (answered.length / questions.length) * 100 : 0,
      wrongOpen: questions.filter((q) => wrongOpen.has(q.id)).length,
      dueForReview: questions.filter((q) => due.has(q.id)).length,
      favorites: questions.filter((q) => favs.has(q.id)).length,
      chapters: (meta?.chapters ?? []).map((c) => ({ index: c.index, title: c.title, count: c.count })),
      topics: (meta?.chapters ?? []).map((c) => c.title),
      builtAt: meta?.builtAt ?? null,
      ocr: { pages: ocrPages, total, done: total > 0 && ocrPages >= total },
    };
  });
}
