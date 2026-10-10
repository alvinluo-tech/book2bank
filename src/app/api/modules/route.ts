import { NextResponse } from "next/server";
import { getModuleSummaries } from "@/lib/db";

export const dynamic = "force-dynamic";

/** One card per module (判断推理 / 数量关系 / 资料分析 / 言语理解) for the 题型广场. */
export async function GET() {
  return NextResponse.json({ modules: getModuleSummaries() });
}
