import Link from "next/link";
import clsx from "clsx";
import type { Metadata } from "next";
import { getBank, getMetas } from "@/lib/bank";
import {
  getChapterStats,
  getDifficultyBuckets,
  getHeatmap,
  getOptionBias,
  getOverview,
  getPointStats,
  getTrend,
  listSessions,
} from "@/lib/db";
import { LOW_SAMPLE_MIN, duration, isoToday, num, pct, rate, safeDiv } from "@/lib/format";
import AccuracyTrend from "@/components/stats/AccuracyTrend";
import ChapterProgress from "@/components/stats/ChapterProgress";
import DifficultyChart from "@/components/stats/DifficultyChart";
import HeatmapCalendar from "@/components/stats/HeatmapCalendar";
import OptionBiasChart from "@/components/stats/OptionBiasChart";
import PointRadar from "@/components/stats/PointRadar";
import PointTable from "@/components/stats/PointTable";
import SessionList from "@/components/stats/SessionList";
import StatCard from "@/components/stats/StatCard";
import StudyAdvice, { type AdviceTip } from "@/components/stats/StudyAdvice";
import type { ChapterStat, DifficultyBucket, HeatCell, OptionBias, OverviewStats, PointStat } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "统计分析 · 行测题库",
  description: "正确率趋势、章节与考点掌握度、选项偏好、难度分布与练习会话复盘。",
};

const RANGES = [7, 14, 30, 90];
const HEATMAP_DAYS = 140;

interface KpiCard {
  label: string;
  value: string;
  sub: string;
  progress: number | null;
  accent: number | null;
  href?: string;
}

function resolveDays(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const match = RANGES.find((range) => range === Number(value));
  return match ?? 30;
}

function practiceHref(chapterIndex: number, point: string, bankId?: string): string {
  const sp = new URLSearchParams();
  if (bankId) sp.set("bank", bankId);
  sp.set("chapter", String(chapterIndex));
  sp.set("point", point);
  return `/practice?${sp.toString()}`;
}

/**
 * 你选某个字母的比例 vs 它在全库中作为正确答案的比例。
 * 偏差超过 15 个百分点说明答题掺进了「蒙题偏好」，而不是判断。
 */
function biasTips(bias: OptionBias[]): AdviceTip[] {
  const chosenSum = bias.reduce((s, b) => s + b.chosen, 0);
  const answerSum = bias.reduce((s, b) => s + b.correctAsAnswer, 0);
  if (chosenSum === 0 || answerSum === 0) return [];
  const tips: AdviceTip[] = [];
  for (const b of bias) {
    const chosenShare = (b.chosen / chosenSum) * 100;
    const answerShare = (b.correctAsAnswer / answerSum) * 100;
    const gap = chosenShare - answerShare;
    if (Math.abs(gap) <= 15) continue;
    tips.push({
      kind: "bias",
      text:
        gap > 0
          ? `蒙题偏好：你选 ${b.label} 占 ${pct(chosenShare)}，而全库答案里 ${b.label} 只占 ${pct(
              answerShare,
            )}，高出 ${pct(Math.abs(gap))} — 不会的题别把赌注压在它上面。`
          : `回避偏好：你几乎不选 ${b.label}（${pct(chosenShare)}），但它在全库答案里占 ${pct(
              answerShare,
            )} — 排除掉两三项之后，不要把 ${b.label} 直接划掉。`,
      href: "/practice?mode=instant",
      action: "即时批改练手感",
    });
  }
  return tips;
}

function buildTips(
  overview: OverviewStats,
  chapters: ChapterStat[],
  points: PointStat[],
  bias: OptionBias[],
  difficulty: DifficultyBucket[],
  withAnswer: number,
): AdviceTip[] {
  if (overview.answeredTotal === 0) {
    return [
      {
        kind: "start",
        text: `题库已就绪：${num(overview.bankTotal)} 题、其中 ${num(
          withAnswer,
        )} 题带标准答案可自动判分，但你还没有任何作答记录 — 先做 10 道题，所有图表才会开始说话。`,
        href: "/practice?mode=instant",
        action: "开始第一次刷题",
      },
    ];
  }

  const tips: AdviceTip[] = [];

  points
    .filter((p) => p.total >= LOW_SAMPLE_MIN)
    .sort((a, b) => a.accuracy - b.accuracy || b.total - a.total)
    .slice(0, 3)
    .forEach((p, i) => {
      tips.push({
        kind: "weak",
        text: `薄弱考点 ${i + 1}：${p.bankTitle}·第${p.chapterIndex}章「${p.title}」正确率 ${pct(p.accuracy)}（已作答 ${num(
          p.total,
        )} 题，该考点共 ${num(p.bankTotal)} 题）。`,
        href: practiceHref(p.chapterIndex, p.title, p.bankId),
        action: "专练这个考点",
      });
    });

  chapters
    .filter((c) => c.total >= LOW_SAMPLE_MIN && c.accuracy < overview.accuracy)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 2)
    .forEach((c) => {
      tips.push({
        kind: "chapter",
        text: `${c.bankTitle}·第${c.chapterIndex}章「${c.chapterTitle}」正确率 ${pct(c.accuracy)}，低于全库平均 ${pct(
          overview.accuracy,
        )}，且只覆盖该章题库的 ${pct(rate(c.total, c.bankTotal), 0)} — 建议整章推进，而不是零散刷考点。`,
        href: `/practice?bank=${c.bankId}&chapter=${c.chapterIndex}`,
        action: "整章练习",
      });
    });

  const untouched = chapters.filter((c) => c.bankTotal > 0 && c.total === 0);
  if (untouched.length > 0) {
    tips.push({
      kind: "coverage",
      text: `完全没碰过的章节：${untouched
        .map((c) => `${c.bankTitle}·第${c.chapterIndex}章 ${c.chapterTitle}`)
        .join("、")} — 先用背题模式把考点框架过一遍。`,
      href: "/practice?mode=recite",
      action: "背题模式",
    });
  }

  tips.push(...biasTips(bias));

  const easy = difficulty.find((b) => b.bucket === ">90% 简单");
  if (easy !== undefined && easy.total >= LOW_SAMPLE_MIN && easy.accuracy < 80) {
    tips.push({
      kind: "careless",
      text: `书中标注为简单（正确率 >90%）的题你只有 ${pct(easy.accuracy)}（${num(
        easy.total,
      )} 题）— 失分点在基础定义而不是难题，先回原书把解析读透。`,
      href: "/practice?mode=smart",
      action: "智能练习补基础",
    });
  }

  if (overview.dueForReview > 0) {
    tips.push({
      kind: "review",
      text: `错题本有 ${num(overview.dueForReview)} 题到复习期限（累计待解决 ${num(
        overview.wrongOpen,
      )} 题）— 按间隔重复先清旧账，刷新题的收益才留得住。`,
      href: "/wrong",
      action: "去错题本复习",
    });
  }

  return tips.slice(0, 7);
}

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const days = resolveDays(params.days);
  const today = isoToday();

  const overview = getOverview();
  const trend = getTrend(days);
  const chapters = getChapterStats();
  const points = getPointStats();
  const heatmap: HeatCell[] = getHeatmap(HEATMAP_DAYS);
  const optionBias = getOptionBias();
  const difficulty = getDifficultyBuckets();
  const sessions = listSessions(60);

  if (getBank().length === 0) {
    return (
      <div className="card p-8">
        <h1 className="text-lg font-semibold">统计分析</h1>
        <p className="mt-2 text-sm text-muted">
          题库尚未构建，统计无从计算。先运行{" "}
          <code className="chip">python pipeline/build.py</code> 生成题库后再回到本页。
        </p>
      </div>
    );
  }

  const rangeTotal = trend.reduce((s, p) => s + p.total, 0);
  const rangeCorrect = trend.reduce((s, p) => s + p.correct, 0);
  const rangeAccuracy = rate(rangeCorrect, rangeTotal);
  const answeredDistinct = safeDiv(overview.coverage * overview.bankTotal, 100);
  const hasAttempts = overview.answeredTotal > 0;

  const cards: KpiCard[] = [
    {
      label: "累计正确率",
      value: hasAttempts ? pct(overview.accuracy) : "—",
      sub: `${num(overview.correctTotal)} / ${num(overview.answeredTotal)} 次作答`,
      progress: hasAttempts ? overview.accuracy : null,
      accent: hasAttempts ? overview.accuracy : null,
    },
    {
      label: `近 ${days} 天作答`,
      value: num(rangeTotal),
      sub: rangeAccuracy === null ? "区间内没有答题记录" : `区间正确率 ${pct(rangeAccuracy)}`,
      progress: rangeAccuracy,
      accent: rangeAccuracy,
      href: "/practice",
    },
    {
      label: "题库覆盖",
      value: overview.bankTotal > 0 ? pct(overview.coverage) : "—",
      sub: `${num(answeredDistinct)} / ${num(overview.bankTotal)} 题至少答过一次`,
      progress: overview.coverage,
      accent: null,
      href: "/bank",
    },
    {
      label: "活跃天数（近 30 天）",
      value: `${num(overview.streakDays)} 天`,
      sub: `今日 ${num(overview.todayCount)} 题 · 正确率 ${
        overview.todayCount > 0 ? pct(overview.todayAccuracy, 0) : "—"
      }`,
      progress: null,
      accent: null,
    },
    {
      label: "待复习错题",
      value: num(overview.dueForReview),
      sub: `错题本待解决 ${num(overview.wrongOpen)} 题`,
      progress: null,
      accent: null,
      href: "/wrong",
    },
    {
      label: "平均作答用时",
      value: overview.avgSpeedMs > 0 ? duration(overview.avgSpeedMs) : "—",
      sub:
        overview.bestHour === null
          ? `收藏 ${num(overview.favorites)} · 笔记 ${num(overview.notes)}`
          : `高峰时段 ${overview.bestHour.hour} 时 · 收藏 ${num(overview.favorites)}`,
      progress: null,
      accent: null,
    },
  ];

  const tips = buildTips(
    overview,
    chapters,
    points,
    optionBias,
    difficulty,
    getMetas().reduce((s, m) => s + m.totals.withAnswer, 0),
  );

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">统计分析</h1>
          <p className="mt-1 text-xs text-muted">
            趋势与日历按所选区间统计；章节、考点与难度分布按「每题最近一次作答」计算，选项偏好与累计正确率按全部作答次数计算。
          </p>
        </div>
        <nav className="flex items-center gap-1.5" aria-label="时间范围">
          {RANGES.map((range) => {
            const active = range === days;
            return (
              <Link
                key={range}
                href={`/stats?days=${range}`}
                aria-current={active ? "true" : undefined}
                className={clsx(
                  "chip hover:border-brand",
                  active && "border-brand bg-brand-soft font-medium text-brand",
                )}
              >
                {range} 天
              </Link>
            );
          })}
        </nav>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
        {cards.map((c) => (
          <StatCard
            key={c.label}
            label={c.label}
            value={c.value}
            sub={c.sub}
            href={c.href}
            progress={c.progress}
            accent={c.accent}
          />
        ))}
      </section>

      <section className="grid items-start gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 min-w-0">
          <AccuracyTrend points={trend} days={days} today={today} />
        </div>
        <StudyAdvice tips={tips} />

        <div className="lg:col-span-2 min-w-0">
          <ChapterProgress chapters={chapters} />
        </div>
        <OptionBiasChart bias={optionBias} />

        <div className="lg:col-span-2 min-w-0">
          <HeatmapCalendar cells={heatmap} today={today} weeks={20} />
        </div>
        <DifficultyChart buckets={difficulty} />

        <PointRadar points={points} />
        <div className="lg:col-span-2 min-w-0">
          <SessionList sessions={sessions} />
        </div>
      </section>

      <PointTable points={points} chapters={chapters} />
    </div>
  );
}
