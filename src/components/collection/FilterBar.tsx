"use client";

import clsx from "clsx";
import type { ReactNode } from "react";
import { btnSm, fieldBase } from "./ui";

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

export interface FilterField {
  key: string;
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  title?: string;
}

export interface FilterToggle {
  key: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  count?: number;
  title?: string;
}

export interface FilterSearch {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
}

interface FilterBarProps {
  /** Segmented radio-ish control (状态 / 排序). */
  segments?: FilterField[];
  /** Native dropdowns (章节 / 考点). */
  selects?: FilterField[];
  /** Pill switches (仅今日到期 / 仅含图形). */
  toggles?: FilterToggle[];
  search?: FilterSearch;
  /** Right-aligned buttons / links. */
  actions?: ReactNode;
  /** Rendered as "清空筛选" when `dirty`. */
  onReset?: () => void;
  dirty?: boolean;
  className?: string;
}

/** One dense strip holding every filter of a collection page. */
export default function FilterBar({
  segments = [],
  selects = [],
  toggles = [],
  search,
  actions,
  onReset,
  dirty = false,
  className,
}: FilterBarProps) {
  return (
    <div className={clsx("card flex flex-wrap items-center gap-x-3 gap-y-2 p-2.5", className)}>
      {segments.map((f) => (
        <div key={f.key} className="flex items-center gap-2">
          <span className="text-[11px] text-muted">{f.label}</span>
          <div className="inline-flex rounded-lg border border-line p-0.5">
            {f.options.map((o) => {
              const active = o.value === f.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => f.onChange(o.value)}
                  className={clsx(
                    "rounded-md px-2.5 py-1 text-xs transition-colors",
                    active ? "bg-brand-soft font-medium text-brand" : "text-muted hover:text-ink",
                  )}
                >
                  {o.label}
                  {o.count !== undefined ? (
                    <span className="ml-1 tabular-nums opacity-75">{o.count}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {selects.map((f) => (
        <label key={f.key} className="flex items-center gap-1.5 text-[11px] text-muted" title={f.title}>
          {f.label}
          <select className={fieldBase} value={f.value} onChange={(e) => f.onChange(e.target.value)}>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.count !== undefined ? `${o.label}（${o.count}）` : o.label}
              </option>
            ))}
          </select>
        </label>
      ))}

      {toggles.map((t) => (
        <button
          key={t.key}
          type="button"
          role="switch"
          aria-checked={t.checked}
          title={t.title}
          onClick={() => t.onChange(!t.checked)}
          className={clsx(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
            t.checked ? "border-brand/60 bg-brand-soft text-brand" : "border-line text-muted hover:text-ink",
          )}
        >
          <span aria-hidden className={clsx("h-1.5 w-1.5 rounded-full", t.checked ? "bg-brand" : "bg-line")} />
          {t.label}
          {t.count !== undefined ? <span className="tabular-nums opacity-75">{t.count}</span> : null}
        </button>
      ))}

      {search ? (
        <label className="flex items-center gap-1.5 text-[11px] text-muted">
          {search.label ?? "关键词"}
          <input
            type="search"
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            placeholder={search.placeholder}
            className={clsx(fieldBase, "w-[170px] py-1")}
          />
        </label>
      ) : null}

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {dirty && onReset ? (
          <button type="button" className={btnSm} onClick={onReset}>
            清空筛选
          </button>
        ) : null}
        {actions}
      </div>
    </div>
  );
}
