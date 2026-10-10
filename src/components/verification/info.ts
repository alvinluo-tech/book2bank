/**
 * Labels and explanations for verify_bank.py's evidence grades and reason codes.
 *
 * Mirrors FLAG_INFO in src/components/bank/helpers.ts: pure data, no fs, safe from
 * any component. Raw codes carry parenthesized values (e.g. `answer-not-in-options(B!=A)`);
 * the class shown in headers and filters is everything before the `(`, while the raw
 * string stays visible wherever a reader needs the pipeline's own evidence.
 */

import type { EvidenceGrade } from "@/lib/verification";
import type { Tone } from "@/components/bank/helpers";

export interface VerdictInfo {
  label: string;
  tone: Tone;
  help: string;
}

export const EVIDENCE_INFO: Record<EvidenceGrade, VerdictInfo> = {
  quoted: {
    label: "解析引用题干",
    tone: "info",
    help: "解析自带的「根据题干“…”」引文最高分命中本题题干——逐题级的最强配对证据。",
  },
  strong: {
    label: "数据/生僻词吻合",
    tone: "ok",
    help: "解析与题干共享数字数据或低频词汇，配对可信；资料分析中这类证据只到资料（题组）一级。",
  },
  weak: {
    label: "仅常见词重合",
    tone: "warn",
    help: "只有全库常见的词汇重合，文本证据很弱，需要对照原书确认。",
  },
  none: {
    label: "无文字证据",
    tone: "muted",
    help: "题干与解析在文本层面找不到共享证据；有答案时会被记为「解析未涉题干」。",
  },
  untestable: {
    label: "文字不可测",
    tone: "muted",
    help: "题干是同一句模板（图形推理常见），文本无从证明配对，只能靠裁剪图人工核对。",
  },
};

/** Stacked-bar / legend colors, keyed by grade. CSS vars flip in dark mode on their own. */
export const EVIDENCE_COLOR: Record<EvidenceGrade, string> = {
  quoted: "var(--brand)",
  strong: "var(--ok)",
  weak: "var(--warn)",
  none: "var(--muted)",
  untestable: "color-mix(in srgb, var(--muted) 40%, transparent)",
};

/** Reason/evidence classes sort out of the `(...)` detail, same split as the pipeline's summary. */
/** What each proof token the pipeline collected actually asserts. */
export const PROOF_INFO: Record<string, string> = {
  "anchor-printed-on-page": "答案册该页确实印着「N.【答案】X」，且字母与入库答案一致",
  "unique-anchor-in-chapter": "这一页同一高度上只有这一道题用这个编号，不存在歧义",
  "analysis-conclusion": "解析末尾「故正确答案为X」与入库答案一致",
  "answer-in-options": "答案字母确实在该题印出的选项里",
  "no-options-to-test": "选项是图形，没有可比对的字母（不代表答案越界）",
};

export const reasonClass = (raw: string): string => raw.split("(")[0];

const REASON_INFO: Record<string, VerdictInfo> = {
  "no-answer": {
    label: "缺答案",
    tone: "bad",
    help: "答案册没有这题的【答案】锚点：作答不判分，需要对照答案册人工补录。",
  },
  "answer-not-in-options": {
    label: "答案不在选项",
    tone: "bad",
    help: "配上的答案字母不在识别出的选项列表里（括注实际值），选项或答案有一处识别错。",
  },
  "anchor-letter-disagrees": {
    label: "锚点字母不符",
    tone: "bad",
    help: "所引答案册页上印刷的「N.【答案】X」与本条答案字母不一致（括注印刷值）。",
  },
  "analysis-quotes-another-item": {
    label: "解析引用他题",
    tone: "bad",
    help: "解析里「根据题干“…”」的引文更匹配另一题（括注他题 id 与分值）——本题挂的是别人的解析。",
  },
  "analysis-not-about-this-material": {
    label: "解析非本资料",
    tone: "bad",
    help: "解析既不含本题资料的任何数字，主题词也几乎不重合（括注重合度），答案很可能配错。",
  },
  "analysis-ignores-stem-content": {
    label: "解析未涉题干",
    tone: "warn",
    help: "有答案但文本证据为零，且解析引文没有点名本题题干——配对无从证明。",
  },
  "analysis-off-topic": {
    label: "解析离题",
    tone: "warn",
    help: "解析与题干的词汇重合度低于阈值（括注重合度），常见于解析串到了相邻题。",
  },
  "empty-stem": {
    label: "题干为空",
    tone: "bad",
    help: "题干未识别到文字。",
  },
  "no-options-and-no-figure": {
    label: "无选项且无图",
    tone: "bad",
    help: "既没有识别出文字选项，也没有图形可看，本题无法作答。",
  },
  "stem-is-material-prose": {
    label: "题干是资料原文",
    tone: "bad",
    help: "整段题干原样出现在资料正文里，疑似把资料句子误切成了小题。",
  },
  "shared-answer-object": {
    label: "答案与他题共用",
    tone: "bad",
    help: "两题指向答案册上同一个位置（括注他题 id），必有一题错配。",
  },
  "answer-page-went-backwards": {
    label: "答案页码回退",
    tone: "warn",
    help: "同章内按题号顺序答案页码倒退（括注页码），锚点很可能串行。",
  },
};

/** Advisory note classes — shown in tooltips, never mark a question suspect. */
const NOTE_INFO: Record<string, string> = {
  "option-maybe-truncated": "选项疑似被截断",
  "duplicate-stem-head": "题干开头与他题重复",
  "anchor-num-not-on-page": "题号不在所引答案页",
  "marriage-evidence-only-from-boilerplate": "证据只来自模板句",
  "low-topic-overlap": "题干解析词汇重合度偏低",
  "rounded-or-derived-numbers": "解析数字是四舍五入/推算值",
  "no-analysis": "缺解析",
};

/** Own-property lookup only: a reason class must never resolve to Object.prototype members. */
function own<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/** Label/tone/help for a raw reason code, with honest fallbacks like flagInfo(). */
export function reasonInfo(raw: string): VerdictInfo {
  const cls = reasonClass(raw);
  const hit = own(REASON_INFO, cls);
  if (hit) return hit;
  if (cls.startsWith("analysis-conclusion-")) {
    return {
      label: "解析结论字母不符",
      tone: "bad",
      help: "解析末尾「故正确答案为X」的 X 与配上的答案字母不一致（X 见原始码）。",
    };
  }
  return {
    label: cls,
    tone: "muted",
    help: "verify_bank.py 标记的其它情形，原始码括注了判定数值。",
  };
}

export function noteLabel(raw: string): string {
  return own(NOTE_INFO, reasonClass(raw)) ?? reasonClass(raw);
}
