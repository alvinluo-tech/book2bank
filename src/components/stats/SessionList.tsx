"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import Link from "next/link";
import ChartCard from "./ChartCard";
import EmptyState from "./EmptyState";
import { accuracyColor, dateTimeCN, duration, num, pct, rate, toFinite } from "@/lib/format";
import type { PracticeMode, SessionSummary } from "@/lib/types";

type SortKey = "started" | "total" | "score" | "duration";

const MODE_LABEL: Record<PracticeMode, string> = {
  recite: "背题",
  instant: "即时批改",
  exam: "模拟考试",
  wrong: "错题重做",
  random: "随机",
  smart: "智能练习",
};

const SORTS: { key: SortKey; label: string }[] = [
  { key: "started", label: "开始时间" },
  { key: "total", label: "题量" },
  { key: "score", label: "得分率" },
  { key: "duration", label: "用时" },
];

interface SessionRow {
  id: number;
  title: string;
  mode: string;
  scope: string | null;
  total: number;
  correct: number;
  score: number | null;
  durationMs: number;
  startedAt: string;
  open: boolean;
}

function sortMetric(row: SessionRow, key: SortKey): number | null {
  if (key === "total") return row.total;
  if (key === "score") return row.score;
  if (key === "duration") return row.durationMs;
  const stamp = Date.parse(row.startedAt.replace(" ", "T"));
  return Number.isFinite(stamp) ? stamp : null;
}

export default function SessionList({ sessions }: { sessions: SessionSummary[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("started");
  const [desc, setDesc] = useState(true);

  const rows = useMemo<SessionRow[]>(
    () =>
      sessions.map((s) => ({
        id: s.id,
        title: s.title || `会话 #${s.id}`,
        mode: MODE_LABEL[s.mode] ?? s.mode,
        scope: s.scope,
        total: s.total,
        correct: s.correct,
        score: rate(s.correct, s.total),
        durationMs: toFinite(s.durationMs) ?? 0,
        startedAt: s.startedAt,
        open: s.finishedAt === null,
      })),
    [sessions],
  );

  const sorted = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      const av = sortMetric(a, sortKey);
      const bv = sortMetric(b, sortKey);
      if (av === null || bv === null) {
        if (av === null && bv === null) return b.id - a.id;
        return av === null ? 1 : -1;
      }
      const base = desc ? bv - av : av - bv;
      return base !== 0 ? base : b.id - a.id;
    });
    return list;
  }, [rows, sortKey, desc]);

  const totalQuestions = rows.reduce((s, r) => s + r.total, 0);
  const totalCorrect = rows.reduce((s, r) => s + r.correct, 0);
  const totalMs = rows.reduce((s, r) => s + r.durationMs, 0);

  function toggle(key: SortKey) {
    if (key === sortKey) setDesc(!desc);
    else {
      setSortKey(key);
      setDesc(true);
    }
  }

  return (
    <ChartCard
      title="练习会话记录"
      caption="每一次「开始练习」到「交卷」算一个会话。按得分率排序可以马上找到考砸的那一场，回看是哪种模式在拖分。"
      right={<span className="chip">最近 {num(rows.length)} 场</span>}
      footer={
        rows.length === 0
          ? "尚无会话"
          : `合计 ${num(totalQuestions)} 题 · 平均得分率 ${pct(rate(totalCorrect, totalQuestions))} · 总用时 ${duration(totalMs)}`
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          compact
          title="还没有练习会话"
          hint="在刷题页开启一个会话（尤其是模考模式），结束后这里会记录得分率、用时与模式，方便复盘。"
          href="/practice?mode=exam"
          actionLabel="开一场模考"
        />
      ) : (
        <div className="max-h-[360px] overflow-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-panel">
              <tr className="border-b border-line text-muted">
                <th scope="col" className="px-2 py-2 text-left font-medium">
                  会话
                </th>
                <th scope="col" className="px-2 py-2 text-left font-medium">
                  模式
                </th>
                {SORTS.map((col) => (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={sortKey === col.key ? (desc ? "descending" : "ascending") : "none"}
                    className="px-2 py-2 text-right font-medium"
                  >
                    <button
                      type="button"
                      onClick={() => toggle(col.key)}
                      className={clsx("inline-flex items-center gap-1 hover:text-brand", sortKey === col.key && "text-brand")}
                    >
                      {col.label}
                      <span aria-hidden>{sortKey === col.key ? (desc ? "↓" : "↑") : "↕"}</span>
                    </button>
                  </th>
                ))}
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  状态
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0 hover:bg-brand-soft/40">
                  <td className="px-2 py-1.5">
                    <div className="max-w-[220px] truncate">{r.title}</div>
                    {r.scope ? <div className="truncate text-[10px] text-muted">{r.scope}</div> : null}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    <span className="chip">{r.mode}</span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{dateTimeCN(r.startedAt)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.total > 0 ? num(r.total) : "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {r.score === null ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <span style={{ color: accuracyColor(r.score) }}>{pct(r.score, 0)}</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{duration(r.durationMs)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right">
                    {r.open ? (
                      <Link href="/practice" className="chip hover:border-brand">
                        进行中
                      </Link>
                    ) : (
                      <span className="chip">已完成</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ChartCard>
  );
}
