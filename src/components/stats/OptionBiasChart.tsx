"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import ChartCard from "./ChartCard";
import EmptyState from "./EmptyState";
import { num, pct, rate } from "@/lib/format";
import type { OptionBias } from "@/lib/types";

interface BiasRow {
  label: string;
  chosen: number;
  chosenShare: number | null;
  chosenLabel: string;
  answerShare: number | null;
  answerLabel: string;
  correctAsAnswer: number;
}

export default function OptionBiasChart({ bias }: { bias: OptionBias[] }) {
  const chosenSum = bias.reduce((s, b) => s + b.chosen, 0);
  const answerSum = bias.reduce((s, b) => s + b.correctAsAnswer, 0);

  const rows: BiasRow[] = bias.map((b) => {
    const chosenShare = rate(b.chosen, chosenSum);
    const answerShare = rate(b.correctAsAnswer, answerSum);
    return {
      label: b.label,
      chosen: b.chosen,
      chosenShare,
      chosenLabel: pct(chosenShare, 0),
      answerShare,
      answerLabel: pct(answerShare, 0),
      correctAsAnswer: b.correctAsAnswer,
    };
  });

  const deviations = rows.flatMap((r) =>
    r.chosenShare === null || r.answerShare === null
      ? []
      : [{ label: r.label, gap: r.chosenShare - r.answerShare }],
  ).sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
  const top = deviations[0];
  const maxShare = rows.reduce((m, r) => Math.max(m, r.chosenShare ?? 0, r.answerShare ?? 0), 0);
  const axisMax = Math.max(10, Math.ceil(maxShare / 10) * 10);

  return (
    <ChartCard
      title="选项偏好（蒙题倾向）"
      caption="深色是你在所有作答里选某个字母的比例，浅色是它在全库中作为正确答案的比例 — 两者差得越远，说明越凭偏好而非判断在选。"
      right={<span className="chip">全部作答记录</span>}
      footer={
        chosenSum === 0
          ? "尚无作答记录"
          : top
            ? `共作答 ${num(chosenSum)} 次；偏离最大的是 ${top.label}，你选它的比例${
                top.gap >= 0 ? "高于" : "低于"
              }全库答案分布 ${pct(Math.abs(top.gap))}`
            : `共作答 ${num(chosenSum)} 次`
      }
    >
      {chosenSum === 0 ? (
        <EmptyState
          compact
          title="还没有作答数据"
          hint="做完题这里会对比「你爱选哪个字母」和「答案本身分布」，用来发现自己有没有蒙题偏好。"
          href="/practice"
        />
      ) : (
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 14, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12, fill: "var(--ink)" }}
                tickLine={false}
                axisLine={{ stroke: "var(--line)" }}
              />
              <YAxis
                domain={[0, axisMax]}
                ticks={[0, axisMax / 2, axisMax]}
                tickFormatter={(v: number) => `${Math.round(v)}%`}
                tick={{ fontSize: 10, fill: "var(--muted)" }}
                tickLine={false}
                axisLine={false}
                width={44}
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
              <Bar
                dataKey="chosenShare"
                name="你选它的比例"
                fill="var(--brand)"
                radius={[3, 3, 0, 0]}
                maxBarSize={30}
              >
                <LabelList dataKey="chosenLabel" position="top" fontSize={10} fill="var(--ink)" />
              </Bar>
              <Bar
                dataKey="answerShare"
                name="它是答案的比例"
                fill="var(--line)"
                stroke="var(--muted)"
                strokeOpacity={0.35}
                radius={[3, 3, 0, 0]}
                maxBarSize={30}
              >
                <LabelList dataKey="answerLabel" position="top" fontSize={10} fill="var(--muted)" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}
