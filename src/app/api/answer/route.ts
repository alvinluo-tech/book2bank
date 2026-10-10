import { NextResponse } from "next/server";
import { recordAnswer } from "@/lib/db";
import type { AnswerInput } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json()) as AnswerInput;
  if (!body?.questionId || typeof body.questionId !== "string") {
    return NextResponse.json({ error: "questionId is required" }, { status: 400 });
  }
  return NextResponse.json(recordAnswer(body));
}
