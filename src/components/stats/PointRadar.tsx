"use client";

import {
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import ChartCard from "./ChartCard";
import EmptyState from "./EmptyState";
import { LOW_SAMPLE_MIN, num, pct, rate, shorten } from "@/lib/format";
import type { PointStat } from "@/lib/types";

interface RadarRow {
  label: string;
  title: string;
  bankTitle: string;
  chapterIndex: number;
  total: number;
  accuracy: number;
  coverage: number | null;
  accuracyLabel: string;
  coverageLabel: string;
}

const MAX_AXES = 8;

export default function PointRadar({ points }: { points: PointStat[] }) {
  const qualified = points
    .filter((p) => p.total >= LOW_SAMPLE_MIN && p.bankTotal > 0)
    .sort((a, b) => a.accuracy - b.accuracy || b.total - a.total || a.title.localeCompare(b.title, "zh-CN"))
    .slice(0, MAX_AXES);

  const rows: RadarRow[] = qualified.map((p) => ({
    label: shorten(p.title, 8),
    title: p.title,
    bankTitle: p.bankTitle,
    chapterIndex: p.chapterIndex,
    total: p.total,
    accuracy: p.accuracy,
    coverage: rate(p.total, p.bankTotal),
    accuracyLabel: pct(p.accuracy),
    coverageLabel: pct(rate(p.total, p.bankTotal)),
  }));

  const weakest = rows.length > 0 ? rows[0] : undefined;

  return (
    <ChartCard
      title="考点能力雷达"
      caption={`取正确率最低、样本满 ${LOW_SAMPLE_MIN} 题的考点，把「正确率」和「题库覆盖率」画在同一张雷达图上：凹陷处就是还没刷透的地方。`}
      right={<span className="chip">样本阈值 ≥ {LOW_SAMPLE_MIN} 题</span>}
      footer={
        weakest
          ? `最薄弱：${weakest.bankTitle}·第${weakest.chapterIndex}章 ${weakest.title} · 正确率 ${weakest.accuracyLabel}（${num(weakest.total)} 题）· 覆盖率 ${weakest.coverageLabel}`
          : `至少需要 ${MAX_AXES} 个考点各作答满 ${LOW_SAMPLE_MIN} 题才能成图`
      }
    >
      {rows.length < 3 ? (
        <EmptyState
          compact
          title="考点样本不足"
          hint={`雷达图至少要 3 个考点、每个考点作答满 ${LOW_SAMPLE_MIN} 题才成立。先按考点各刷几道，再回来看形状。`}
          href="/practice"
          actionLabel="按考点练习"
        />
      ) : (
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={rows} outerRadius="72%">
              <PolarGrid stroke="var(--line)" />
              <PolarAngleAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--ink)" }} />
              <PolarRadiusAxis
                domain={[0, 100]}
                tickCount={6}
                tick={{ fontSize: 9, fill: "var(--muted)" }}
                axisLine={false}
                tickFormatter={(v: number) => `${v}`}
              />
              <Tooltip
                formatter={(value, name) => [pct(Number(value)), String(name)]}
                contentStyle={{
                  background: "var(--panel)",
                  border: "1px solid var(--line)",
                  borderRadius: 10,
                  fontSize: 12,
                  color: "var(--ink)",
                }}
                labelStyle={{ color: "var(--muted)", marginBottom: 2 }}
                itemStyle={{ padding: 0 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Radar name="正确率" dataKey="accuracy" stroke="var(--brand)" fill="var(--brand)" fillOpacity={0.32} />
              <Radar name="题库覆盖率" dataKey="coverage" stroke="var(--ok)" fill="var(--ok)" fillOpacity={0.14} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}
