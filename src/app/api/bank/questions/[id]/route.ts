import { NextResponse } from "next/server";
import { getMaterial, getQuestion, materialSiblings } from "@/lib/bank";
import { getDb, getNote } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const question = getQuestion(id);
  if (!question) return NextResponse.json({ error: `unknown question ${id}` }, { status: 404 });
  const db = getDb();
  const attempts = (db
    .prepare(`SELECT answer, correct, created_at, mode FROM attempts WHERE question_id = ? ORDER BY id DESC LIMIT 20`)
    .all(id) as { answer: string; correct: number; created_at: string; mode: string }[]).map((a) => ({
    answer: a.answer,
    correct: !!a.correct,
    createdAt: a.created_at,
    mode: a.mode,
  }));
  const wrong = db.prepare(`SELECT wrong_count, box, status, next_review FROM wrong_book WHERE question_id = ?`).get(id) as
    | { wrong_count: number; box: number; status: string; next_review: string | null } | undefined;
  const favorite = !!db.prepare(`SELECT 1 FROM favorites WHERE question_id = ?`).get(id);
  const tags = (db.prepare(
    `SELECT t.name FROM tags t JOIN question_tags qt ON qt.tag_id = t.id WHERE qt.question_id = ?`,
  ).all(id) as { name: string }[]).map((t) => t.name);
  // The 资料 a 资料分析 item belongs to travels with it, so the practice client can
  // keep the shared table/chart on screen without a second round trip per question.
  return NextResponse.json({
    question,
    material: getMaterial(question.materialId),
    siblings: question.materialId ? materialSiblings(question.materialId).map((s) => s.id) : [],
    attempts,
    wrong,
    favorite,
    note: getNote(id),
    tags,
  });
}
