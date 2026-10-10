"use client";

import { useMemo } from "react";
import ChartCard from "./ChartCard";
import {
  addDaysISO,
  dateCN,
  monthCN,
  normalizeDay,
  num,
  pct,
  rate,
  weekdayCN,
  weekdayIndex,
  WEEKDAY_LABELS,
} from "@/lib/format";
import type { HeatCell } from "@/lib/types";

const CELL = 15;
const GAP = 4;
const STEP = CELL + GAP;
const GUTTER = 24;
const MONTH_ROW = 16;
/** Volume → colour level (0 = no answer that day). */
const LEVEL_OPACITY = [0.5, 0.22, 0.42, 0.64, 1];

interface DayCell {
  iso: string;
  count: number;
  correct: number;
  level: number;
  future: boolean;
}

function levelOf(count: number, max: number): number {
  if (count <= 0) return 0;
  const ratio = count / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

export default function HeatmapCalendar({
  cells,
  today,
  weeks = 20,
}: {
  cells: HeatCell[];
  today: string;
  weeks?: number;
}) {
  const grid = useMemo(() => {
    const byDate = new Map<string, HeatCell>();
    for (const c of cells) {
      const day = normalizeDay(c.date);
      if (day) byDate.set(day, c);
    }
    const startIso = addDaysISO(today, -weekdayIndex(today) - (weeks - 1) * 7);
    if (startIso === null) return null;

    const days: DayCell[] = [];
    for (let i = 0; i < weeks * 7; i++) {
      const iso = addDaysISO(startIso, i);
      if (iso === null) continue;
      const hit = byDate.get(iso);
      const count = hit?.count ?? 0;
      days.push({
        iso,
        count,
        correct: hit?.correct ?? 0,
        level: 0,
        future: iso > today,
      });
    }
    const max = days.reduce((m, d) => Math.max(m, d.count), 0);
    const scaled = days.map((d) => ({ ...d, level: levelOf(d.count, max) }));
    const columns: DayCell[][] = [];
    for (let w = 0; w < weeks; w++) columns.push(scaled.slice(w * 7, w * 7 + 7));
    return { columns, max };
  }, [cells, today, weeks]);

  if (grid === null) {
    return (
      <ChartCard title={`作答日历（近 ${weeks} 周）`} caption={`近 ${weeks} 周的刷题热力图。`}>
        <p className="text-xs text-muted">日期数据无法解析，请检查系统时间设置。</p>
      </ChartCard>
    );
  }

  const { columns } = grid;
  const flat = columns.flat();
  const totalCount = flat.reduce((s, d) => s + d.count, 0);
  const totalCorrect = flat.reduce((s, d) => s + d.correct, 0);
  const activeDays = flat.filter((d) => d.count > 0).length;
  const avgPerActiveDay = rate(totalCount, activeDays);
  const width = GUTTER + columns.length * STEP + 2;
  const height = MONTH_ROW + 7 * STEP + 2;

  return (
    <ChartCard
      title={`作答日历（近 ${weeks} 周）`}
      caption="每格一天，颜色越深当天刷得越多；空白格说明那天没碰题。把鼠标放到格子上可以看当天正确率。"
      right={<span className="chip">活跃 {num(activeDays)} 天</span>}
      footer={
        totalCount === 0
          ? `近 ${weeks} 周还没有作答记录 — 先做 10 题把日历点亮。`
          : `近 ${weeks} 周作答 ${num(totalCount)} 题 · 整体正确率 ${pct(rate(totalCorrect, totalCount))} · 活跃日均 ${num(avgPerActiveDay, 1)} 题`
      }
    >
      <div className="overflow-x-auto pb-1">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`近 ${weeks} 周作答热力图，共作答 ${totalCount} 题`}
          className="block"
        >
          {columns.map((col, w) => {
            const first = col[0];
            if (!first) return null;
            const prev = w > 0 ? columns[w - 1][0] : undefined;
            const isNewMonth = w === 0 || (prev !== undefined && first.iso.slice(0, 7) !== prev.iso.slice(0, 7));
            if (!isNewMonth) return null;
            return (
              <text
                key={`month-${first.iso}`}
                x={GUTTER + w * STEP}
                y={MONTH_ROW - 5}
                fontSize={10}
                fill="var(--muted)"
              >
                {monthCN(first.iso)}
              </text>
            );
          })}

          {WEEKDAY_LABELS.map((label, d) =>
            d % 2 === 1 && d !== 6 ? null : (
              <text
                key={`wd-${label}`}
                x={0}
                y={MONTH_ROW + d * STEP + CELL - 2}
                fontSize={9}
                fill="var(--muted)"
              >
                {label}
              </text>
            ),
          )}

          {columns.map((col, w) =>
            col.map((day, d) => (
              <rect
                key={day.iso}
                x={GUTTER + w * STEP}
                y={MONTH_ROW + d * STEP}
                width={CELL}
                height={CELL}
                rx={3}
                fill={day.future ? "transparent" : day.level === 0 ? "var(--line)" : "var(--brand)"}
                fillOpacity={day.future ? 1 : LEVEL_OPACITY[day.level]}
                stroke={day.future ? "none" : "var(--line)"}
                strokeOpacity={day.level === 0 ? 0.7 : 0}
                strokeWidth={1}
                strokeDasharray={day.future ? "2 2" : undefined}
              >
                <title>
                  {day.future
                    ? `${dateCN(day.iso)} ${weekdayCN(day.iso)} · 未到`
                    : `${dateCN(day.iso)} ${weekdayCN(day.iso)} · 答题 ${num(day.count)} · 正确率 ${
                        day.count > 0 ? pct(rate(day.correct, day.count)) : "—"
                      }`}
                </title>
              </rect>
            )),
          )}
        </svg>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
        <span>少</span>
        {LEVEL_OPACITY.map((op, level) => (
          <span
            key={level}
            aria-label={level === 0 ? "当天未作答" : `当天作答量等级 ${level}`}
            className="inline-block h-3 w-3 rounded-[3px] border border-line"
            style={{
              background: level === 0 ? "var(--line)" : "var(--brand)",
              opacity: level === 0 ? 0.5 : op,
            }}
          />
        ))}
        <span>多</span>
        <span className="ml-2">单日峰值 {num(grid.max)} 题 · 空白格 = 当天没有作答</span>
      </div>
    </ChartCard>
  );
}
