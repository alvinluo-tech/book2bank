import clsx from "clsx";
import Link from "next/link";
import type { Question } from "@/lib/types";
import type { GradeResult, WrongInfo } from "@/lib/practice-store";
import { fmtMs } from "@/lib/practice-store";

/**
 * 即时模式的判分反馈条：对错 + 正确答案 + 用时 + 粉笔大数据 + 错题本状态。
 */
export default function AnswerFeedback({
  question,
  result,
  chosen,
  ungraded,
  ms,
  wrongInfo,
  pending = false,
}: {
  question: Question;
  result: GradeResult | null;
  chosen: string | null;
  ungraded: boolean;
  ms: number;
  wrongInfo?: WrongInfo;
  pending?: boolean;
}) {
  if (!result && !pending) return null;
  const correct = !!result?.correct;

  return (
    <div
      className={clsx(
        "mt-3 rounded-xl border p-3",
        pending && "border-line bg-panel",
        !pending && ungraded && "border-line bg-panel",
        !pending && correct && "border-ok bg-ok-soft",
        !pending && !correct && !ungraded && "border-bad bg-bad-soft",
      )}
    >
      {pending ? (
        <p className="text-sm text-muted">判分中…</p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span
            className={clsx(
              "text-sm font-semibold",
              ungraded ? "text-muted" : correct ? "text-ok" : "text-bad",
            )}
          >
            {ungraded ? "无法判分" : correct ? "回答正确" : "回答错误"}
          </span>
          {question.answer && (
            <span className="text-sm">
              正确答案{" "}
              <span className="font-semibold tabular-nums text-ok">{question.answer}</span>
              <span className="mx-1 text-muted">·</span>
              你的答案{" "}
              <span className={clsx("font-semibold tabular-nums", correct ? "text-ok" : "text-bad")}>
                {chosen ?? "未作答"}
              </span>
            </span>
          )}
          <span className="text-xs tabular-nums text-muted">用时 {fmtMs(ms)}</span>
          {question.accuracy !== null && (
            <span className="text-xs tabular-nums text-muted">
              粉笔正确率 {question.accuracy.toFixed(1)}%
            </span>
          )}
          {question.trapOption && (
            <span className="text-xs text-muted">
              易错项 <span className="font-medium text-[var(--warn)]">{question.trapOption}</span>
              {chosen === question.trapOption && !correct && <span className="ml-1">（你正好踩坑）</span>}
            </span>
          )}
          {(wrongInfo?.wrongCount ?? result?.wrongCount ?? 0) > 0 && (
            <span className="text-xs text-muted">
              已错 {wrongInfo?.wrongCount ?? result?.wrongCount} 次 · 第 {wrongInfo?.box ?? result?.box} 关
              <Link href="/wrong" className="ml-1 text-brand hover:underline">
                错题本 →
              </Link>
            </span>
          )}
        </div>
      )}

      {!pending && ungraded && (
        <p className="mt-1.5 text-xs leading-relaxed text-muted">
          题库中该题缺少答案（OCR 未匹配到答案页），本次作答不判分、不写入答题记录，也不计入正确率。
          <Link href={`/question/${question.id}`} className="ml-1 text-brand hover:underline">
            去题目详情补充 →
          </Link>
        </p>
      )}
    </div>
  );
}
