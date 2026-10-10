import { NextResponse } from "next/server";
import { listNotes, setNote } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ rows: listNotes() });
}

export async function POST(req: Request) {
  const body = (await req.json()) as { questionId?: string; text?: string };
  if (!body.questionId) return NextResponse.json({ error: "questionId is required" }, { status: 400 });
  setNote(body.questionId, body.text ?? "");
  return NextResponse.json({ ok: true });
}
