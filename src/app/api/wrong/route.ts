import { NextResponse } from "next/server";
import { listWrong, removeWrong, updateWrong } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const rows = listWrong({
    status: sp.get("status") ?? undefined,
    chapterKey: sp.get("chapterKey") ?? undefined,
    due: sp.get("due") === "1",
    limit: sp.get("limit") ? Number(sp.get("limit")) : 500,
  });
  return NextResponse.json({ rows, total: rows.length });
}

export async function PATCH(req: Request) {
  const body = (await req.json()) as { questionId?: string; note?: string | null; status?: "open" | "resolved"; box?: number };
  if (!body.questionId) return NextResponse.json({ error: "questionId is required" }, { status: 400 });
  updateWrong(body.questionId, { note: body.note, status: body.status, box: body.box });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("questionId");
  if (!id) return NextResponse.json({ error: "questionId is required" }, { status: 400 });
  removeWrong(id);
  return NextResponse.json({ ok: true });
}
