import { bankDef, BANK_LIST } from "@/lib/banks";
import type { BankMeta } from "@/lib/types";
import type { RunnerMode } from "@/lib/practice-store";

export interface SetupValue {
  mode: RunnerMode;
  /** 题库科目 id（panduan / shuliang …） */
  bank: string;
  /** "" = 不限 */
  chapter: string;
  section: string;
  point: string;
  kind: string;
  q: string;
  /** 数字字符串 或 "all" */
  count: string;
  /** 考试模式每题限时（秒） */
  seconds: number;
  shuffle: boolean;
  onlyUnanswered: boolean;
  /** 跨模块模考: sample every built module in proportion to its size. */
  mixed: boolean;
}

export const DEFAULT_SETUP: SetupValue = {
  mode: "instant",
  bank: BANK_LIST[0].id,
  chapter: "",
  section: "",
  point: "",
  kind: "",
  q: "",
  count: "20",
  seconds: 60,
  shuffle: true,
  onlyUnanswered: false,
  mixed: false,
};

export const COUNT_CHOICES = ["10", "20", "30", "50", "100", "all"];
export const SECONDS_CHOICES = [30, 45, 60, 90, 120];

interface ModeCard {
  mode: RunnerMode;
  name: string;
  desc: string;
  hint?: string;
}

export const MODE_CARDS: ModeCard[] = [
  { mode: "instant", name: "即时模式", desc: "选完立刻判分，展示正确答案、解析与粉笔大数据" },
  { mode: "recite", name: "背题模式", desc: "答案与解析直接可见，只翻页不记成绩" },
  {
    mode: "exam",
    name: "考试模式",
    desc: "过程中不判分，倒计时结束统一交卷出分",
    hint: "默认每题 60 秒",
  },
  { mode: "wrong", name: "错题重练", desc: "只抽错题本中仍未掌握的题目", hint: "需先有错题" },
  { mode: "smart", name: "智能练习", desc: "未作答、反复出错、正确率低的题目优先" },
  { mode: "favorite", name: "收藏练习", desc: "重做收藏过的题目", hint: "需先有收藏" },
];

export const MODE_NAME: Record<RunnerMode, string> = {
  instant: "即时模式",
  recite: "背题模式",
  exam: "考试模式",
  wrong: "错题重练",
  smart: "智能练习",
  favorite: "收藏练习",
  random: "随机抽题",
};

export function setupScope(v: SetupValue): string {
  const bits: string[] = [v.bank ? bankDef(v.bank).title : "跨模块按比例"];
  if (v.chapter) bits.push(`第${v.chapter}章`);
  if (v.section) bits.push(v.section);
  if (v.point) bits.push(v.point);
  if (v.kind === "figure") bits.push("图形题");
  if (v.kind === "text") bits.push("文字题");
  if (v.q) bits.push(`关键词「${v.q}」`);
  if (v.onlyUnanswered) bits.push("仅未作答");
  return bits.join(" · ");
}

interface Props {
  value: SetupValue;
  meta: BankMeta | null;
  onChange: (patch: Partial<SetupValue>) => void;
  onRun: () => void;
  busy: boolean;
  error: string | null;
}

const fieldCls =
  "w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-brand";

export default function SetupPanel({ value, meta, onChange, onRun, busy, error }: Props) {
  const chapters = meta?.chapters ?? [];
  const chapter = chapters.find((c) => String(c.index) === value.chapter);
  const sections = chapter?.sections ?? [];
  const section = sections.find((s) => s.title === value.section);
  const points = section?.points ?? [];
  const bankTotal = meta?.totals.questions ?? 0;
  const countNum = value.count === "all" ? bankTotal : Number(value.count);
  const isExam = value.mode === "exam";
  // wrong / favorite / smart 由系统选题，status 参数已被占用，不能再叠加「仅未作答」
  const statusLocked = value.mode === "wrong" || value.mode === "favorite" || value.mode === "smart";

  return (
    <section className="card p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">开始刷题</h2>
        <p className="text-xs text-muted">
          题库 {bankTotal} 题
          {meta ? ` · ${chapters.length} 章 · ${meta.totals.withFigure} 题含图形` : ""}
        </p>
      </header>

      {/* 模式 */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {MODE_CARDS.map((m) => {
          const active = value.mode === m.mode;
          return (
            <button
              key={m.mode}
              type="button"
              onClick={() => onChange({ mode: m.mode, shuffle: m.mode === "instant" || m.mode === "smart" ? true : value.shuffle })}
              className={
                active
                  ? "rounded-xl border border-brand bg-brand-soft p-3 text-left"
                  : "rounded-xl border border-line bg-panel p-3 text-left transition-colors hover:border-brand"
              }
            >
              <div className="flex items-center gap-2">
                <span className={active ? "text-sm font-semibold text-brand" : "text-sm font-medium"}>
                  {m.name}
                </span>
                {m.hint && <span className="chip shrink-0">{m.hint}</span>}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted">{m.desc}</p>
            </button>
          );
        })}
      </div>

      {/* 范围 */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs text-muted">
          科目
          <select
            className={fieldCls}
            value={value.bank}
            onChange={(e) =>
              onChange({ bank: e.target.value, chapter: "", section: "", point: "", mixed: e.target.value === "" })}
          >
            <option value="">全部模块 · 按比例混合</option>
            {BANK_LIST.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted">
          章节范围
          <select
            className={fieldCls}
            value={value.chapter}
            onChange={(e) => onChange({ chapter: e.target.value, section: "", point: "" })}
          >
            <option value="">全部章节</option>
            {chapters.map((c) => (
              <option key={c.index} value={String(c.index)}>
                第{c.index}章 {c.title}（{c.count}题）
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted">
          节
          <select
            className={fieldCls}
            value={value.section}
            disabled={!chapter}
            onChange={(e) => onChange({ section: e.target.value, point: "" })}
          >
            <option value="">本节全部</option>
            {sections.map((s) => (
              <option key={s.title} value={s.title}>
                {s.title}（{s.count}题）
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted">
          考点
          <select
            className={fieldCls}
            value={value.point}
            disabled={!section}
            onChange={(e) => onChange({ point: e.target.value })}
          >
            <option value="">全部考点</option>
            {points.map((p) => (
              <option key={p.title} value={p.title}>
                {p.title}（{p.count}题）
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted">
          题型
          <select className={fieldCls} value={value.kind} onChange={(e) => onChange({ kind: e.target.value })}>
            <option value="">全部题型</option>
            <option value="figure">仅图形题</option>
            <option value="text">仅文字题</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted sm:col-span-2">
          关键词（题干/选项/解析/题号）
          <input
            className={fieldCls}
            value={value.q}
            placeholder="例如：平移、水面、2024"
            onChange={(e) => onChange({ q: e.target.value })}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted">
          本次题量
          <select className={fieldCls} value={value.count} onChange={(e) => onChange({ count: e.target.value })}>
            {COUNT_CHOICES.map((c) => (
              <option key={c} value={c}>
                {c === "all" ? `全部（${bankTotal}题）` : `${c} 题`}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted">
          {isExam ? "考试每题限时" : "参考每题限时"}
          <select
            className={fieldCls}
            value={String(value.seconds)}
            onChange={(e) => onChange({ seconds: Number(e.target.value) })}
          >
            {SECONDS_CHOICES.map((s) => (
              <option key={s} value={s}>
                {s} 秒 / 题
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
        <label className="flex cursor-pointer items-center gap-1.5 text-muted">
          <input
            type="checkbox"
            checked={value.shuffle}
            onChange={(e) => onChange({ shuffle: e.target.checked })}
            className="accent-[var(--brand)]"
          />
          乱序出题
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-muted">
          <input
            type="checkbox"
            checked={value.onlyUnanswered}
            disabled={statusLocked}
            onChange={(e) => onChange({ onlyUnanswered: e.target.checked })}
            className="accent-[var(--brand)]"
          />
          只做未作答过的题
        </label>
        {statusLocked && (
          <span className="text-[11px] text-muted">
            {MODE_NAME[value.mode]}
            由系统选题，「只做未作答过的题」不可叠加；章节/考点范围仍会生效。
          </span>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <p className="text-xs text-muted">
          {MODE_NAME[value.mode]} · {setupScope(value)} · {value.count === "all" ? "全部" : `${value.count} 题`}
          {isExam && countNum > 0
            ? ` · 全卷 ${Math.round((countNum * value.seconds) / 60)} 分钟`
            : ""}
        </p>
        <div className="flex items-center gap-2">
          {error && <span className="text-xs text-bad">{error}</span>}
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onRun}>
            {busy ? "载入中…" : "开始练习"}
          </button>
        </div>
      </div>
    </section>
  );
}
