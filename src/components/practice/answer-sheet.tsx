import { Fragment } from "react";
import clsx from "clsx";
import { computeStats, materialSegments, type MaterialSegment } from "@/lib/practice-store";
import { usePractice } from "@/lib/practice-store";

/**
 * 答题卡：题号网格 + 状态色。考试模式下可随时点回上一题改答案。
 *
 * 资料分析的答题卡按资料分段——一道大题就是「一段资料 + 5 个小题」，
 * 条带上标出组号、资料标题与该组已答数，交卷前能一眼看出哪组还没读完。
 * 其余模块没有 materialId，一条 extra 都不会生成，网格与改动前一致。
 */
export default function AnswerSheet({ onNavigate }: { onNavigate?: () => void }) {
  const s = usePractice((st) => st);
  const stats = computeStats(s);
  const currentId = s.queue[s.index];

  if (!s.queue.length) return null;

  const reveal = s.mode !== "recite" && (s.mode !== "exam" || s.submitted);

  const segments = materialSegments(s.queue, s.questions);
  const segAt = new Map<number, MaterialSegment>(segments.map((seg) => [seg.start, seg]));
  const currentSeg =
    segments.find((seg) => s.index >= seg.start && s.index < seg.start + seg.count) ?? null;

  return (
    <div className="card p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium">答题卡</h3>
        <span className="text-[11px] tabular-nums text-muted">
          {s.mode === "exam" && !s.submitted
            ? `已答 ${stats.answered} / 未答 ${stats.total - stats.answered}`
            : `已作答 ${stats.answered} / ${stats.total}`}
        </span>
      </div>

      <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-10 lg:grid-cols-8">
        {s.queue.map((id, i) => {
          const q = s.questions[id];
          const picked = s.chosen[id];
          const grade = s.graded[id];
          const isCurrent = id === currentId;
          const noAnswer = s.ungraded[id] || !q?.answer;
          const showCorrect = reveal && picked && grade?.correct && !s.ungraded[id];
          const showWrong = reveal && picked && grade && !grade.correct && !s.ungraded[id];

          const cell = (
            <button
              type="button"
              onClick={() => {
                s.openIndex(i);
                onNavigate?.();
              }}
              title={`第 ${i + 1} 题${q ? ` · 原题号 ${q.num}` : ""}${picked ? ` · 你选 ${picked}` : " · 未作答"}`}
              className={clsx(
                "flex h-8 items-center justify-center rounded-lg border text-[11px] tabular-nums transition-colors",
                "border-line text-muted hover:border-brand hover:text-brand",
                s.mode === "exam" && !s.submitted && picked && "border-brand bg-brand-soft text-brand",
                showCorrect && "border-ok bg-ok-soft text-ok",
                showWrong && "border-bad bg-bad-soft text-bad",
                reveal && picked && noAnswer && "text-[var(--warn)]",
                isCurrent && "ring-2 ring-brand ring-offset-1 ring-offset-panel",
              )}
            >
              {i + 1}
              {picked && <span className="ml-0.5 text-[9px]">{picked}</span>}
            </button>
          );

          const seg = segAt.get(i);
          if (!seg) return <Fragment key={id}>{cell}</Fragment>;

          const answered = s.queue
            .slice(seg.start, seg.start + seg.count)
            .filter((qid) => s.chosen[qid]).length;
          const material = s.materials[seg.materialId];
          const active = currentSeg?.materialId === seg.materialId;

          return (
            <Fragment key={`seg-${seg.ordinal}-${id}`}>
              <div
                className={clsx(
                  "col-span-full mt-1 flex items-center gap-1.5 rounded-md border border-line bg-bg px-1.5 py-0.5 text-[10px]",
                  active && "border-brand/50 bg-brand-soft",
                )}
                title={`第 ${seg.start + 1}–${seg.start + seg.count} 题共用一段资料 ${seg.materialId}`}
              >
                <span className={clsx("shrink-0 font-medium", active ? "text-brand" : "text-muted")}>
                  资料 {seg.ordinal}
                </span>
                <span className="min-w-0 flex-1 truncate text-muted">
                  {material ? material.title ?? "（无标题）" : `第 ${seg.start + 1}–${seg.start + seg.count} 题`}
                </span>
                <span className="shrink-0 tabular-nums text-muted">
                  已答 {answered}/{seg.count}
                </span>
              </div>
              {cell}
            </Fragment>
          );
        })}
      </div>

      <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-2 text-[11px] text-muted">
        <Legend className="bg-ok-soft" label="正确" />
        <Legend className="bg-bad-soft" label="错误" />
        {s.mode === "exam" && !s.submitted && <Legend className="bg-brand-soft" label="已作答" />}
        <Legend className="border-dashed" label="未作答" />
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--warn)" }} />
          题库缺答案
        </span>
        {segments.length > 0 && <span className="tabular-nums">共 {segments.length} 组资料</span>}
      </div>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={clsx("h-2.5 w-2.5 rounded-sm border border-line", className)} />
      {label}
    </span>
  );
}
