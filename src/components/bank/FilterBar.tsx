import Link from "next/link";
import {
  bankLabel,
  buildHref,
  flagInfo,
  KIND_LABELS,
  readStatus,
  STATUS_LABELS,
  type Filters,
  type StatusValue,
} from "./helpers";

const FIELD = "rounded-lg border border-line bg-panel px-2.5 py-1.5 text-sm outline-none focus:border-brand";

type ActiveKey = "bank" | "chapter" | "section" | "point" | "kind" | "status" | "flag" | "q";
const ACTIVE_KEYS: ActiveKey[] = ["bank", "chapter", "section", "point", "kind", "status", "flag", "q"];

/**
 * Search + filters. A plain GET <form>, so it works with JS disabled;
 * every control writes straight into the URL to keep views shareable.
 */
export default function FilterBar({
  current,
  flags,
  banks,
  total,
  base = "/bank",
}: {
  current: Filters;
  flags: { flag: string; count: number }[];
  banks: { id: string; title: string; count: number }[];
  total: number;
  base?: string;
}) {
  const status = readStatus(current);
  const active = ACTIVE_KEYS.map((key) => ({ key, value: current[key] })).filter(
    (entry): entry is { key: ActiveKey; value: string } => Boolean(entry.value),
  );

  const labelFor = (key: ActiveKey, value: string) => {
    switch (key) {
      case "q":
        return `关键词 ${value}`;
      case "kind":
        return KIND_LABELS[value] ?? value;
      case "status":
        return STATUS_LABELS[value as StatusValue] ?? value;
      case "flag":
        return `标记 ${flagInfo(value).label}`;
      case "bank":
        return `题库 ${bankLabel(value)}`;
      case "chapter":
        return `第 ${value} 章`;
      case "section":
        return `节 ${value}`;
      default:
        return `考点 ${value}`;
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <form method="get" action={base} className="card flex flex-wrap items-center gap-2 p-3">
        <input
          type="search"
          name="q"
          defaultValue={current.q ?? ""}
          placeholder="搜索题干、选项、解析或原题号"
          className={`${FIELD} min-w-[14rem] flex-1`}
          aria-label="关键词"
        />
        {banks.length > 1 && (
          <select name="bank" defaultValue={current.bank ?? ""} className={FIELD} aria-label="题库">
            <option value="">全部题库</option>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}（{b.count}）
              </option>
            ))}
          </select>
        )}
        <select name="kind" defaultValue={current.kind ?? ""} className={FIELD} aria-label="题型">
          <option value="">全部题型</option>
          <option value="text">{KIND_LABELS.text}</option>
          <option value="figure">{KIND_LABELS.figure}</option>
        </select>
        <select name="status" defaultValue={status} className={FIELD} aria-label="作答状态">
          {(Object.keys(STATUS_LABELS) as StatusValue[]).map((value) => (
            <option key={value} value={value}>
              {STATUS_LABELS[value]}
            </option>
          ))}
        </select>
        <select name="flag" defaultValue={current.flag ?? ""} className={FIELD} aria-label="质量标记">
          <option value="">全部质量标记</option>
          {flags.map(({ flag, count }) => (
            <option key={flag} value={flag}>
              {flagInfo(flag).label}（{count}）
            </option>
          ))}
        </select>
        {/* taxonomy + page size live in the URL but are not part of this form's controls */}
        {current.chapter && <input type="hidden" name="chapter" value={current.chapter} />}
        {current.section && <input type="hidden" name="section" value={current.section} />}
        {current.point && <input type="hidden" name="point" value={current.point} />}
        {current.limit && <input type="hidden" name="limit" value={current.limit} />}
        <button type="submit" className="btn btn-primary">
          筛选
        </button>
        <Link href={base} className="btn">
          重置
        </Link>
      </form>

      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="font-medium tabular-nums">命中 {total} 题</span>
        {active.length === 0 ? (
          <span className="text-muted">未设置筛选条件</span>
        ) : (
          active.map(({ key, value }) => (
            <Link
              key={key}
              href={buildHref(current, { [key]: null, offset: null }, base)}
              className="chip border-brand text-brand"
              title="移除该条件"
            >
              {labelFor(key, value)}
              <span aria-hidden className="opacity-60">
                ×
              </span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
