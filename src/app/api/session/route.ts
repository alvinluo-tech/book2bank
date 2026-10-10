import { NextResponse } from "next/server";
import { closeSession, createSession, listSessions } from "@/lib/db";
import type { PracticeMode } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ sessions: listSessions(60) });
}

export async function POST(req: Request) {
  const body = (await req.json()) as { title?: string; mode?: PracticeMode; scope?: string | null };
  const id = createSession(body.title ?? "练习", (body.mode ?? "instant") as PracticeMode, body.scope ?? null);
  return NextResponse.json({ id });
}

export async function PATCH(req: Request) {
  const body = (await req.json()) as { id?: number };
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  closeSession(body.id);
  return NextResponse.json({ ok: true });
}
