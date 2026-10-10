"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import ChartCard from "./ChartCard";
import EmptyState from "./EmptyState";
import { LOW_SAMPLE_MIN, accuracyColor, num, pct, rate } from "@/lib/format";
import type { ChapterStat, PointStat } from "@/lib/types";

type SortKey = "chapter" | "title" | "total" | "accuracy" | "coverage" | "bankTotal";
type SortDir = "asc" | "desc";

interface PointRow {
  key: string;
  chapterKey: string;
  chapterIndex: number;
  chapterLabel: string;
  chapterTitle: string;
  title: string;
  total: number;
  correct: number;
  bankTotal: number;
  accuracy: number | null;
  coverage: number | null;
  href: string;
}

const COLUMNS: { key: SortKey; label: string; align: "left" | "right" }[] = [
  { key: "chapter", label: "章节", align: "left" },
  { key: "title", label: "考点", align: "left" },
  { key: "total", label: "答题数", align: "right" },
  { key: "accuracy", label: "正确率", align: "right" },
  { key: "bankTotal", label: "题库量", align: "right" },
  { key: "coverage", label: "覆盖率", align: "right" },
];

function metric(row: PointRow, key: Exclude<SortKey, "title">): number | null {
  if (key === "total") return row.total;
  if (key === "bankTotal") return row.bankTotal;
  if (key === "coverage") return row.coverage;
  if (key === "accuracy") return row.accuracy;
  return row.chapterIndex;
}

function compare(a: PointRow, b: PointRow, key: SortKey, dir: SortDir): number {
  const tie = a.title.localeCompare(b.title, "zh-CN") || a.chapterIndex - b.chapterIndex;
  if (key === "title") return dir === "asc" ? tie : -tie;

  const av = metric(a, key);
  const bv = metric(b, key);
  // Rows without a measurable value (未作答 / 空章节) always sink to the bottom.
  if (av === null || bv === null) {
    if (av === null && bv === null) return tie;
    return av === null ? 1 : -1;
  }
  const base = av - bv;
  const signed = dir === "asc" ? base : -base;
  if (key === "chapter" && base === 0) return tie;
  return signed !== 0 ? signed : tie;
}

export default function PointTable({ points, chapters }: { points: PointStat[]; chapters: ChapterStat[] }) {
  const [chapterFilter, setChapterFilter] = useState<string | null>(null);
  const [onlyAnswered, setOnlyAnswered] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("accuracy");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const allRows = useMemo<PointRow[]>(
    () =>
      points.map((p) => ({
        key: `${p.bankId}:${p.chapterIndex}::${p.title}`,
        chapterKey: `${p.bankId}:${p.chapterIndex}`,
        chapterIndex: p.chapterIndex,
        chapterLabel: `${p.bankTitle}·第${p.chapterIndex}章`,
        chapterTitle: p.chapterTitle,
        title: p.title,
        total: p.total,
        correct: p.correct,
        bankTotal: p.bankTotal,
        accuracy: rate(p.correct, p.total),
        coverage: rate(p.total, p.bankTotal),
        href: `/practice?bank=${p.bankId}&chapter=${p.chapterIndex}&point=${encodeURIComponent(p.title)}`,
      })),
    [points],
  );

  const rows = useMemo(() => {
    const filtered = allRows.filter(
      (r) => (chapterFilter === null || r.chapterKey === chapterFilter) && (!onlyAnswered || r.total > 0),
    );
    return [...filtered].sort((a, b) => compare(a, b, sortKey, sortDir));
  }, [allRows, chapterFilter, onlyAnswered, sortKey, sortDir]);

  const answeredPoints = allRows.filter((r) => r.total > 0).length;
  const lowSample = allRows.filter((r) => r.total > 0 && r.total < LOW_SAMPLE_MIN).length;

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "title" || key === "chapter" ? "asc" : "desc");
    }
  }

  return (
    <ChartCard
      title="考点明细表"
      caption="每行一个考点：答题数、正确率、题库量与覆盖率。点击表头排序，默认按正确率从低到高——最该练的排最前。"
      right={
        <span className="chip">
          共 {num(allRows.length)} 个考点 · 已作答 {num(answeredPoints)}
        </span>
      }
      footer={
        lowSample > 0
          ? `另有 ${num(lowSample)} 个考点样本不足 ${LOW_SAMPLE_MIN} 题，正确率仅作参考（标记为「数据不足」）。`
          : "正确率按每题最近一次作答计算，重复刷同一题不会重复计入。"
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setChapterFilter(null)}
          className={clsx("chip hover:border-brand", chapterFilter === null ? "border-brand text-brand" : "")}
        >
          全部章节
        </button>
        {chapters.map((c) => {
          const ck = `${c.bankId}:${c.chapterIndex}`;
          return (
            <button
              key={ck}
              type="button"
              onClick={() => setChapterFilter(ck)}
              className={clsx(
                "chip hover:border-brand",
                chapterFilter === ck ? "border-brand text-brand" : "",
              )}
            >
              {c.bankTitle}·第{c.chapterIndex}章 {c.chapterTitle}
            </button>
          );
        })}
        <label className="chip ml-auto cursor-pointer gap-1.5">
          <input
            type="checkbox"
            className="accent-[var(--brand)]"
            checked={onlyAnswered}
            onChange={(e) => setOnlyAnswered(e.target.checked)}
          />
          仅看已作答
        </label>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          compact
          title="没有符合条件的考点"
          hint="换一个章节筛选，或取消「仅看已作答」看看还没碰过的考点。"
        />
      ) : (
        <div className="max-h-[480px] overflow-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-panel">
              <tr className="border-b border-line">
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={
                      sortKey === col.key ? (sortDir === "asc" ? "ascending" : "descending") : "none"
                    }
                    className={clsx("px-2 py-2 font-medium", col.align === "right" ? "text-right" : "text-left")}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className={clsx(
                        "inline-flex items-center gap-1 hover:text-brand",
                        sortKey === col.key ? "text-brand" : "text-muted",
                      )}
                    >
                      {col.label}
                      <span aria-hidden className="tabular-nums">
                        {sortKey === col.key ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
                      </span>
                    </button>
                  </th>
                ))}
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const lowSampleRow = r.total > 0 && r.total < LOW_SAMPLE_MIN;
                return (
                  <tr key={r.key} className="border-b border-line last:border-0 hover:bg-brand-soft/40">
                    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-muted">{r.chapterLabel}</td>
                    <td className="px-2 py-1.5">
                      <Link href={r.href} className="hover:text-brand">
                        {r.title}
                      </Link>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.total > 0 ? num(r.total) : "—"}</td>
                    <td className="px-2 py-1.5 text-right">
                      {r.accuracy === null ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <span className="inline-flex items-center justify-end gap-1.5">
                          <span
                            className="tabular-nums font-medium"
                            style={{ color: accuracyColor(r.accuracy) }}
                          >
                            {pct(r.accuracy)}
                          </span>
                          {lowSampleRow ? <span className="chip shrink-0">数据不足</span> : null}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-muted">{num(r.bankTotal)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {r.coverage === null ? "—" : `${pct(r.coverage, 0)}`}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">
                      <Link href={r.href} className="btn px-2 py-1 text-[11px]">
                        去练习
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </ChartCard>
  );
}
