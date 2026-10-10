"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import ChartCard from "./ChartCard";
import EmptyState from "./EmptyState";
import { accuracyColor, num, pct, rate, shorten } from "@/lib/format";
import type { ChapterStat } from "@/lib/types";

interface ChapterRow {
  key: string;
  chapterIndex: number;
  title: string;
  bankTotal: number;
  answered: number;
  accuracy: number | null;
  accuracyLabel: string;
}

function toRows(chapters: ChapterStat[]): ChapterRow[] {
  return chapters
    .filter((c) => c.bankTotal > 0 || c.total > 0)
    .map((c) => {
      const accuracy = rate(c.correct, c.total);
      return {
        key: `${c.bankId}:${c.chapterIndex}`,
        chapterIndex: c.chapterIndex,
        title: shorten(`${c.bankTitle}·${c.chapterTitle}`, 11),
        bankTotal: c.bankTotal,
        answered: c.total,
        accuracy,
        accuracyLabel: accuracy === null ? "未作答" : pct(accuracy),
      };
    });
}

export default function ChapterProgress({ chapters }: { chapters: ChapterStat[] }) {
  const rows = toRows(chapters);
  const answered = rows.reduce((sum, r) => sum + r.answered, 0);
  const weakest = rows
    .filter((r) => r.accuracy !== null && r.answered >= 5)
    .sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0))
    .slice(0, 2);

  return (
    <ChartCard
      title="章节进度：已作答 vs 题库题量"
      caption="浅色条是该章节题库总量，深色条是你已作答的量，颜色代表正确率（绿≥80%、橙60-80%、红<60%）。"
      footer={
        answered === 0
          ? "尚无作答记录"
          : weakest.length > 0
            ? `正确率最低的章节：${weakest.map((r) => `${r.title} ${r.accuracyLabel}`).join(" · ")}`
            : `已作答 ${num(answered)} 题 · 每章至少作答 5 题后这里会点出最薄弱的章节`
      }
    >
      {rows.length === 0 || answered === 0 ? (
        <EmptyState
          compact
          title="章节进度还没开始记录"
          hint="作答任意一章的题目后，这里会显示每一章刷了多少、刷到什么正确率，帮你决定下一步补哪一章。"
          href="/practice"
        />
      ) : (
        <div className="w-full" style={{ height: Math.max(170, rows.length * 48 + 24) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 8 }} barGap={2}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 10, fill: "var(--muted)" }}
                tickLine={false}
                axisLine={{ stroke: "var(--line)" }}
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="title"
                width={92}
                tick={{ fontSize: 11, fill: "var(--ink)" }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                formatter={(value, name) => [`${num(Number(value))} 题`, String(name)]}
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
              <Bar dataKey="bankTotal" name="题库题量" fill="var(--line)" radius={[0, 3, 3, 0]} maxBarSize={16} />
              <Bar dataKey="answered" name="已作答" radius={[0, 3, 3, 0]} maxBarSize={16}>
                {rows.map((r) => (
                  <Cell key={r.key} fill={accuracyColor(r.accuracy)} />
                ))}
                <LabelList dataKey="accuracyLabel" position="right" fontSize={10} fill="var(--muted)" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}
