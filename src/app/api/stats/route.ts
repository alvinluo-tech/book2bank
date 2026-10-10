import { NextResponse } from "next/server";
import {
  getChapterStats, getDifficultyBuckets, getHeatmap, getOptionBias,
  getOverview, getPointStats, getTrend,
} from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const days = Number(new URL(req.url).searchParams.get("days") ?? 30);
  return NextResponse.json({
    overview: getOverview(),
    trend: getTrend(days),
    chapters: getChapterStats(),
    points: getPointStats(),
    heatmap: getHeatmap(140),
    optionBias: getOptionBias(),
    difficulty: getDifficultyBuckets(),
  });
}
