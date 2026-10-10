"use client";

import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import ChartCard from "./ChartCard";
import EmptyState from "./EmptyState";
import { accuracyColor, num, pct, rate } from "@/lib/format";
import type { DifficultyBucket } from "@/lib/types";

interface DifficultyRow {
  bucket: string;
  shortLabel: string;
  total: number;
  correct: number;
  accuracy: number | null;
  label: string;
}

const SHORT: Record<string, string> = {
  "<60% 易错": "易错 <60%",
  "60-80%": "60-80%",
  "80-90%": "80-90%",
  ">90% 简单": "简单 >90%",
  无数据: "书无数据",
};

export default function DifficultyChart({ buckets }: { buckets: DifficultyBucket[] }) {
  const rows: DifficultyRow[] = buckets.map((b) => {
    const accuracy = b.total > 0 ? rate(b.correct, b.total) : null;
    return {
      bucket: b.bucket,
      shortLabel: SHORT[b.bucket] ?? b.bucket,
      total: b.total,
      correct: b.correct,
      accuracy,
      label: accuracy === null ? "未作答" : pct(accuracy),
    };
  });

  const answered = rows.reduce((s, r) => s + r.total, 0);
  const correct = rows.reduce((s, r) => s + r.correct, 0);
  const hard = rows.find((r) => r.bucket === "<60% 易错");
  const easy = rows.find((r) => r.bucket === ">90% 简单");

  return (
    <ChartCard
      title="分难度正确率"
      caption="按原书「粉笔大数据正确率」把题分成四档。柱高是你在这一档的正确率，浅色柱是你答的题数 — 易错档能稳住，分数才有上限。"
      right={<span className="chip">全部作答记录</span>}
      footer={
        answered === 0
          ? "尚无作答记录"
          : `整体正确率 ${pct(rate(correct, answered))}` +
            (hard && hard.total > 0 ? ` · 易错档 ${pct(hard.accuracy)}（${num(hard.total)} 题）` : "") +
            (easy && easy.total > 0 ? ` · 简单档 ${pct(easy.accuracy)}（${num(easy.total)} 题）` : "")
      }
    >
      {answered === 0 ? (
        <EmptyState
          compact
          title="还没有按难度的统计"
          hint="作答记录积累后，这里会按原书标注的正确率分档，看你是「简单题也错」还是「只在难题上失分」。"
          href="/practice"
        />
      ) : (
        <div className="h-[240px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 16, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="shortLabel"
                interval={0}
                tick={{ fontSize: 10, fill: "var(--ink)" }}
                tickLine={false}
                axisLine={{ stroke: "var(--line)" }}
              />
              <YAxis
                yAxisId="accuracy"
                domain={[0, 100]}
                ticks={[0, 50, 100]}
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
                formatter={(value, name) => {
                  const label = String(name);
                  const n = Number(value);
                  return [label.includes("正确率") ? pct(n) : `${num(n)} 题`, label];
                }}
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
              <Bar
                yAxisId="volume"
                dataKey="total"
                name="作答题数"
                fill="var(--brand)"
                fillOpacity={0.16}
                radius={[3, 3, 0, 0]}
                maxBarSize={26}
              />
              <Bar
                yAxisId="accuracy"
                dataKey="accuracy"
                name="该档正确率"
                radius={[3, 3, 0, 0]}
                maxBarSize={26}
              >
                {rows.map((r) => (
                  <Cell key={r.bucket} fill={accuracyColor(r.accuracy)} />
                ))}
                <LabelList dataKey="label" position="top" fontSize={10} fill="var(--ink)" />
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}
