import { NextResponse } from "next/server";
import { getBank, queryQuestions } from "@/lib/bank";
import { getDb, listFavorites, listWrong, getSmartQueue } from "@/lib/db";
import type { QuestionQuery } from "@/lib/types";

export const dynamic = "force-dynamic";

function answeredIds(): Set<string> {
  return new Set(
    (getDb().prepare(`SELECT DISTINCT question_id FROM attempts`).all() as { question_id: string }[])
      .map((r) => r.question_id),
  );
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const num = (k: string) => (sp.get(k) ? Number(sp.get(k)) : undefined);
  const str = (k: string) => sp.get(k) ?? undefined;
  const status = str("status") as QuestionQuery["status"];

  const query: QuestionQuery = {
    bank: str("bank"),
    chapter: num("chapter"),
    section: str("section"),
    point: str("point"),
    kind: str("kind") as QuestionQuery["kind"],
    q: str("q"),
    flag: str("flag"),
    limit: num("limit") ?? 60,
    offset: num("offset") ?? 0,
  };

  let pool: ReturnType<typeof getBank> | undefined;
  if (query.bank) pool = getBank(query.bank);
  if (status === "wrong") {
    const ids = new Set(listWrong({ status: "open" }).map((w) => w.questionId));
    pool = (pool ?? getBank()).filter((q) => ids.has(q.id));
  } else if (status === "favorite") {
    const ids = new Set(listFavorites().map((f) => f.questionId));
    pool = (pool ?? getBank()).filter((q) => ids.has(q.id));
  } else if (status === "smart") {
    const ck = query.bank && query.chapter !== undefined
      ? `${query.bank}:${query.chapter}`
      : undefined;
    pool = getSmartQueue(ck, num("limit") ?? 100);
  } else if (status === "answered" || status === "unanswered") {
    const seen = answeredIds();
    pool = (pool ?? getBank()).filter((q) => (status === "answered" ? seen.has(q.id) : !seen.has(q.id)));
  }

  return NextResponse.json(queryQuestions(query, pool));
}
