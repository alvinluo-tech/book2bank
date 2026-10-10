import clsx from "clsx";
import type { Question, QuestionOption } from "@/lib/types";

export interface RenderedOption {
  label: string;
  text: string | null;
  image: string | null;
}

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];
/** 行测常规四选项；江苏卷等会出现 A–H，按实际出现自动扩展。 */
const BASE_COUNT = 4;

function normLabel(o: QuestionOption): string {
  const raw = (o.label ?? "").trim().toUpperCase();
  return raw ? raw[0] : "";
}

/**
 * OCR 有时只裁出 1~2 个选项文字（甚至把 A/B 连成一句）。
 * 这里统一补全字母（默认 A–D，出现更大字母时扩展到它），缺失的选项保留字母，
 * 保证「正确答案是 D 但只识别到 A/C」时仍可点选。
 */
export function buildOptions(q: Question): RenderedOption[] {
  const map = new Map<string, QuestionOption>();
  for (const o of q.options ?? []) {
    const l = normLabel(o);
    if (l && !map.has(l)) map.set(l, o);
  }
  const present = [...map.keys()];
  const maxIdx = present.length
    ? Math.max(BASE_COUNT - 1, ...present.map((l) => LETTERS.indexOf(l)))
    : BASE_COUNT - 1;
  const grid = LETTERS.slice(0, Math.min(LETTERS.length, maxIdx + 1));
  const extras = present.filter((l) => !grid.includes(l)).sort();
  return [...grid, ...extras].map((label) => {
    const o = map.get(label);
    return { label, text: o?.text?.trim() ? o.text.trim() : null, image: o?.image ?? null };
  });
}

/** 图形推理：选项无文字，四张图都在 figureImage 这一张裁图里。 */
export function isLetterOnly(q: Question): boolean {
  if (q.kind === "figure") return true;
  const opts = buildOptions(q);
  return opts.every((o) => !o.text && !o.image);
}

/**
 * The stored answer is not among the parsed options.
 *
 * OCR drops whole option lines — most often the correct one, because it is the line the
 * 解析 quotes at length and the layout squeezes (数量关系's fraction options and 言语理解's
 * long options are the usual victims). Showing "A/B/C" with the answer "D" teaches the
 * reader that the book is wrong, so such items must fall back to the 原书整题裁图.
 */
export function answerOptionMissing(q: Question): boolean {
  const opts = buildOptions(q);
  return !!q.answer && opts.length > 0 && !opts.some((o) => o.label === q.answer);
}

interface Props {
  question: Question;
  value: string | null;
  /** 正确答案（判分后或背题模式才用于高亮）。 */
  answer: string | null;
  /** 是否展示对错。 */
  reveal: boolean;
  /** 已判分后不允许再改（即时模式）；考试模式始终可改。 */
  locked?: boolean;
  onSelect: (label: string) => void;
}

export default function OptionList({ question, value, answer, reveal, locked = false, onSelect }: Props) {
  const options = buildOptions(question);
  const letterOnly = isLetterOnly(question);

  return (
    <div>
      {letterOnly && (
        <p className="mb-2 text-xs text-muted">
          本题选项为图形，请直接对照上方题图中的选项字母作答。
        </p>
      )}
      {!letterOnly && answerOptionMissing(question) && (
        <p className="mb-2 text-xs text-muted">
          识别出的选项里缺了正确答案「{question.answer}」那一行（扫描识别漏读），请对照原书整题图作答。
        </p>
      )}
      <div
        className={clsx(
          "grid gap-2",
          letterOnly ? "grid-cols-4" : "grid-cols-1 sm:grid-cols-2",
        )}
      >
        {options.map((o) => {
          const selected = value === o.label;
          const isAnswer = reveal && answer === o.label;
          const isMiss = reveal && selected && answer !== null && answer !== o.label;
          const trap = reveal && !selected && question.trapOption === o.label && answer !== o.label;
          return (
            <button
              key={o.label}
              type="button"
              disabled={locked && !selected}
              onClick={() => !locked && onSelect(o.label)}
              aria-pressed={selected}
              className={clsx(
                "flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors",
                locked && !selected ? "cursor-default opacity-80" : "cursor-pointer hover:border-brand",
                selected && !reveal && "border-brand bg-brand-soft",
                !selected && !isAnswer && !isMiss && !trap && "border-line bg-panel",
                isAnswer && "border-ok bg-ok-soft",
                isMiss && "border-bad bg-bad-soft",
                trap && "border-dashed",
              )}
              style={trap ? { borderColor: "var(--warn)" } : undefined}
            >
              <span
                className={clsx(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[11px] font-medium",
                  selected ? "border-brand text-brand" : "border-line text-muted",
                  isAnswer && "border-ok text-ok",
                  isMiss && "border-bad text-bad",
                )}
              >
                {o.label}
              </span>
              <span className="min-w-0 flex-1">
                {o.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={o.image} alt={`选项 ${o.label}`} className="figure-img mt-1" loading="lazy" />
                )}
                {o.text ? (
                  <span className="leading-relaxed">{o.text}</span>
                ) : letterOnly ? (
                  <span className="text-xs text-muted">选项见题图</span>
                ) : (
                  <span className="text-xs text-muted">该选项文字未识别，建议对照原书</span>
                )}
                {trap && <span className="ml-2 text-[11px] text-[var(--warn)]">粉笔易错项</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
