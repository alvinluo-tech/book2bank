import { NextResponse } from "next/server";
import { getBank, getCorrectionsReport, getMeta, getMetas } from "@/lib/bank";
import { chapterKey } from "@/lib/banks";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Taxonomy for every bank plus per-chapter answered counts, for sidebars and progress bars. */
export async function GET(req: Request) {
  const bank = new URL(req.url).searchParams.get("bank");
  const meta = getMeta(bank ?? undefined);
  const metas = getMetas();
  const db = getDb();
  const answered = (db.prepare(
    `SELECT question_id FROM attempts WHERE id IN (SELECT MAX(id) FROM attempts GROUP BY question_id)`,
  ).all() as { question_id: string }[]);

  const keyOf = new Map<string, string>();
  for (const q of getBank()) keyOf.set(q.id, chapterKey(q.bankId, q.chapterIndex));
  const answeredByKey = new Map<string, number>();
  for (const a of answered) {
    const ck = keyOf.get(a.question_id);
    if (ck) answeredByKey.set(ck, (answeredByKey.get(ck) ?? 0) + 1);
  }

  return NextResponse.json({
    metas,
    meta,
    corrections: getCorrectionsReport(),
    answeredByChapter: metas.flatMap((m) =>
      m.chapters.map((ch) => ({
        bankId: m.bankId,
        index: ch.index,
        answered: answeredByKey.get(chapterKey(m.bankId, ch.index)) ?? 0,
      })),
    ),
  });
}
