"use client";

import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import ChartCard from "./ChartCard";
import EmptyState from "./EmptyState";
import { addDaysISO, axisDay, movingAverage, normalizeDay, num, pct, rate } from "@/lib/format";
import type { TrendPoint } from "@/lib/types";

interface TrendRow {
  label: string;
  total: number;
  correct: number;
  accuracy: number | null;
  accuracyMa7: number | null;
}

function buildRows(points: TrendPoint[], days: number, today: string): TrendRow[] {
  const startIso = addDaysISO(today, -(days - 1));
  if (startIso === null) return [];
  const byDate = new Map<string, TrendPoint>();
  for (const p of points) {
    const day = normalizeDay(p.date);
    if (day) byDate.set(day, p);
  }
  const rows: TrendRow[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDaysISO(startIso, i);
    if (date === null) continue;
    const hit = byDate.get(date);
    const total = hit?.total ?? 0;
    rows.push({
      label: axisDay(date),
      total,
      correct: hit?.correct ?? 0,
      accuracy: hit ? rate(hit.correct, hit.total) : null,
      accuracyMa7: null,
    });
  }
  const ma = movingAverage(
    rows.map((r) => r.accuracy),
    7,
    rows.map((r) => r.total),
  );
  return rows.map((r, i) => ({ ...r, accuracyMa7: ma[i] ?? null }));
}

function tooltipText(name: unknown, value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return typeof name === "string" && name.includes("正确率") ? pct(n) : `${num(n)} 题`;
}

export default function AccuracyTrend({
  points,
  days,
  today,
}: {
  points: TrendPoint[];
  days: number;
  today: string;
}) {
  const rows = buildRows(points, days, today);
  const answered = rows.reduce((sum, r) => sum + r.total, 0);
  const correct = rows.reduce((sum, r) => sum + r.correct, 0);
  const overall = rate(correct, answered);
  const perDay = rows.length > 0 ? answered / rows.length : null;

  return (
    <ChartCard
      title={`每日正确率与刷题量（近 ${days} 天）`}
      caption="柱子是当天刷题量，折线是当天正确率，橙色线是 7 日滚动正确率——看趋势比看单天更有意义。"
      footer={
        answered > 0
          ? `区间作答 ${num(answered)} 题 · 整体正确率 ${pct(overall)} · 日均 ${num(perDay, 1)} 题`
          : `区间作答 0 题 · 近 ${days} 天没有答题记录`
      }
    >
      {answered === 0 ? (
        <EmptyState
          compact
          title={`${days} 天内还没有作答`}
          hint="做几道题后这里会出现每日正确率曲线与 7 日滚动均值，用来判断你是在进步还是在原地刷题。"
          href="/practice"
        />
      ) : (
        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id="accuracyFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.32} />
                  <stop offset="100%" stopColor="var(--brand)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "var(--muted)" }}
                tickLine={false}
                axisLine={{ stroke: "var(--line)" }}
                minTickGap={18}
              />
              <YAxis
                yAxisId="accuracy"
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickFormatter={(v: number) => `${v}%`}
                tick={{ fontSize: 10, fill: "var(--muted)" }}
                tickLine={false}
                axisLine={false}
                width={44}
              />
              <YAxis
                yAxisId="volume"
                orientation="right"
                allowDecimals={false}
                tick={{ fontSize: 10, fill: "var(--muted)" }}
                tickLine={false}
                axisLine={false}
                width={34}
              />
              <Tooltip
                formatter={(value, name) => tooltipText(name, value)}
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
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
              <Bar yAxisId="volume" dataKey="total" name="答题量" fill="var(--brand)" fillOpacity={0.16} radius={[2, 2, 0, 0]} maxBarSize={22} />
              <Area
                yAxisId="accuracy"
                dataKey="accuracy"
                name="当日正确率"
                type="monotone"
                stroke="var(--brand)"
                strokeWidth={1.6}
                fill="url(#accuracyFill)"
                connectNulls
                dot={{ r: 2, strokeWidth: 0, fill: "var(--brand)" }}
                activeDot={{ r: 4 }}
              />
              <Line
                yAxisId="accuracy"
                dataKey="accuracyMa7"
                name="7日滚动正确率"
                type="monotone"
                stroke="var(--warn)"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}
