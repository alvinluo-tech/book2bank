import { useMemo } from "react";
import Link from "next/link";
import type { Question } from "@/lib/types";

/**
 * 扫描页里混进了水印文案（打开粉笔APP / 扫一扫 / 正文：xxx），
 * 直接渲染会很吵，这里按行过滤并合并空行。
 */
export function cleanAnalysis(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0)
    .filter(
      (l) =>
        !/打开粉笔\s*APP/i.test(l) &&
        !/^扫一扫$/.test(l) &&
        !/扫描解析右侧二维码/.test(l) &&
        !/^正文：/.test(l) &&
        !/不支持其他方式/.test(l) &&
        !/^本部分题目解析见下册第.{0,12}页。?$/.test(l),
    );
}

export default function AnalysisPanel({
  question,
  open,
  onToggle,
  forceOpen = false,
}: {
  question: Question;
  open: boolean;
  onToggle: () => void;
  /** 背题模式 / 交卷回顾：解析默认展开且不可折叠。 */
  forceOpen?: boolean;
}) {
  const lines = useMemo(() => (question.analysis ? cleanAnalysis(question.analysis) : []), [question.analysis]);
  const expanded = forceOpen || open;

  return (
    <section className="mt-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={forceOpen ? undefined : onToggle}
          className="text-sm font-medium hover:text-brand"
          aria-expanded={expanded}
        >
          {expanded ? "▾ 解析" : "▸ 解析"}
          {!forceOpen && <span className="ml-2 text-[11px] font-normal text-muted">点击查看/隐藏</span>}
        </button>
        <div className="flex items-center gap-2 text-[11px]">
          {question.answerPageRef && (
            <Link
              href={`/book?tag=dn&page=${question.answerPageRef.page}`}
              className="text-brand hover:underline"
            >
              下册第 {question.answerPageRef.bookPage ?? question.answerPageRef.page} 页
            </Link>
          )}
          <Link href={`/question/${question.id}`} className="text-muted hover:text-brand">
            题目详情 →
          </Link>
        </div>
      </div>

      {expanded && (
        <div className="mt-2">
          {lines.length === 0 && (
            <p className="rounded-lg border border-dashed border-line p-3 text-xs leading-relaxed text-muted">
              该题暂无解析（OCR 未识别到答案页内容），建议点击下方「对照原书」核对原书解析。
            </p>
          )}
          {lines.length > 0 && (
            // 每行一个 <p> 会沿原书的窄印刷列断句；拼回散文交给屏宽排版
            <p className="text-[13.5px] leading-[1.85] text-ink">{lines.join("")}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] tabular-nums text-muted">
            {question.accuracy !== null && <span>粉笔大数据正确率 {question.accuracy.toFixed(1)}%</span>}
            {question.trapOption && <span>易错项 {question.trapOption}</span>}
            <span>OCR 置信度 {(question.ocrConfidence * 100).toFixed(0)}%</span>
          </div>
        </div>
      )}
    </section>
  );
}
