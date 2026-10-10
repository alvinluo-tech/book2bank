import clsx from "clsx";
import type { Question } from "@/lib/types";

/**
 * 数据质量 badge 行：把 OCR 流水线的警告码翻译成人话，
 * 并给出「该题答案/解析可能识别不全，建议对照原书」这类可执行的提示。
 */

interface FlagCopy {
  label: string;
  tip: string;
  tone: "ok" | "warn" | "muted" | "bad";
}

const FLAG_COPY: Record<string, FlagCopy> = {
  corrected: {
    label: "已人工校正",
    tip: "该题的题干/选项/答案已人工对照原书扫描逐字复核，不再是 OCR 的原始结果",
    tone: "ok",
  },
  "no-answer": {
    label: "缺答案/解析",
    tip: "该题答案或解析可能识别不全，建议对照原书",
    tone: "bad",
  },
  "missing-answer": {
    label: "缺答案/解析",
    tip: "该题答案或解析可能识别不全，建议对照原书",
    tone: "bad",
  },
  "ocr-low": {
    label: "识别置信度低",
    tip: "文字识别置信度偏低，题干或解析可能有错字，建议对照原书",
    tone: "warn",
  },
  "figure-options": {
    label: "选项为图形",
    tip: "四个选项是图形，直接看上方题图中的 A/B/C/D",
    tone: "muted",
  },
  "option-count": {
    label: "选项数量异常",
    tip: "选项识别数量不是 4 个，已按 A–D 补全，建议对照原书核对",
    tone: "warn",
  },
  "options-1": {
    label: "仅识别到 1 个选项",
    tip: "选项识别数量不是 4 个，已按 A–D 补全，建议对照原书核对",
    tone: "warn",
  },
  "options-2": {
    label: "仅识别到 2 个选项",
    tip: "选项识别数量不是 4 个，已按 A–D 补全，建议对照原书核对",
    tone: "warn",
  },
  "options-3": {
    label: "仅识别到 3 个选项",
    tip: "选项识别数量不是 4 个，已按 A–D 补全，建议对照原书核对",
    tone: "warn",
  },
  "no-analysis": {
    label: "缺解析",
    tip: "该题解析可能识别不全，建议对照原书",
    tone: "warn",
  },
  "answer-recovered": {
    label: "答案自解析恢复",
    tip: "答案锚点行 OCR 丢失，答案字母是从解析末尾「故正确答案为X」恢复的，解析正文可能与相邻题串行，建议对照原书",
    tone: "warn",
  },
  "answer-mismatch": {
    label: "答案自相矛盾",
    tip: "答案锚点与解析结论不一致（OCR 误读其一），请务必对照原书确认",
    tone: "bad",
  },
  "answer-not-in-options": {
    label: "答案不在选项中",
    tip: "识别出的答案字母不在已识别的选项里，多为选项缺行或选项标签误读，请对照原书",
    tone: "bad",
  },
  "no-figure": { label: "缺题图", tip: "题干图形未裁出，建议对照原书看图", tone: "warn" },
};

export function flagCopy(flag: string): FlagCopy {
  const hit = FLAG_COPY[flag];
  if (hit) return hit;
  const n = /^options-(\d)$/.exec(flag);
  if (n) {
    return {
      label: `仅识别到 ${n[1]} 个选项`,
      tip: "选项识别数量不是 4 个，已按 A–D 补全，建议对照原书核对",
      tone: "warn",
    };
  }
  return { label: flag, tip: "该题存在识别警告，建议对照原书核对", tone: "muted" };
}

export default function QualityBadges({
  question,
  className,
}: {
  question: Question;
  className?: string;
}) {
  const flags = question.flags ?? [];
  if (!flags.length) return null;

  return (
    <div className={clsx("border-t border-line pt-2", className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-muted">数据质量</span>
        {flags.map((f) => {
          const c = flagCopy(f);
          const tone =
            c.tone === "bad"
              ? { border: "var(--bad)", fg: "var(--bad)", bg: "var(--bad-soft)" }
              : c.tone === "warn"
                ? { border: "var(--warn)", fg: "var(--warn)", bg: "var(--warn-soft)" }
                : c.tone === "ok"
                  ? { border: "var(--ok)", fg: "var(--ok)", bg: "var(--ok-soft)" }
                  : { border: "var(--line)", fg: "var(--muted)", bg: "transparent" };
          return (
            <span
              key={f}
              title={c.tip}
              className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] leading-relaxed"
              style={{ borderColor: tone.border, color: tone.fg, background: tone.bg }}
            >
              {c.label}
            </span>
          );
        })}
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        {[...new Set(flags.map((f) => flagCopy(f).tip))].join("；")}。
      </p>
    </div>
  );
}
