"use client";

import { useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { buildHref, type BankNode, type Filters } from "./helpers";

const TAX_KEYS = ["bank", "chapter", "section", "point"] as const;

/** Expand whatever the current URL selects so a shared link arrives fully opened. */
function initialOpen(banks: BankNode[], current: Filters): Set<string> {
  const open = new Set<string>();
  for (const b of banks) {
    const bankKey = `b:${b.bankId}`;
    if (banks.length === 1 || current.bank === b.bankId) open.add(bankKey);
    for (const ch of b.chapters) {
      const chKey = `c:${ch.key}`;
      const chapterSelected = current.bank === ch.bankId && current.chapter === String(ch.index);
      if (chapterSelected) open.add(chKey);
      if (!current.chapter && current.section) open.add(chKey);
      for (const sec of ch.sections) {
        if (current.section === sec.title && (chapterSelected || !current.chapter)) {
          open.add(chKey);
          open.add(`${chKey}|${sec.title}`);
        }
      }
    }
  }
  return open;
}

/** 题库 → 章 → 节 → 考点 filter tree; every node is a plain link so URLs stay shareable. */
export default function TaxonomyTree({ banks, current }: { banks: BankNode[]; current: Filters }) {
  const [open, setOpen] = useState<Set<string>>(() => initialOpen(banks, current));

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /** A node is active when the URL selects exactly its scope (nothing deeper). */
  const isActive = (overrides: Record<string, string | number | null>) =>
    TAX_KEYS.every((key) => {
      const wanted = overrides[key];
      const clean = wanted === null || wanted === undefined ? undefined : String(wanted);
      return current[key] === clean;
    });

  const total = banks.reduce((sum, b) => sum + b.count, 0);
  const answeredTotal = banks.reduce((sum, b) => sum + b.answered, 0);

  return (
    <div className="card flex max-h-[calc(100vh-7rem)] flex-col overflow-hidden">
      <div className="flex items-baseline justify-between border-b border-line px-3 py-2">
        <span className="text-xs font-medium">章节树</span>
        <span className="text-[11px] tabular-nums text-muted">
          已刷 {answeredTotal}/{total}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        <Link
          href={buildHref(current, { bank: null, chapter: null, section: null, point: null, offset: null })}
          className={clsx(
            "mb-1 flex items-center justify-between rounded-lg px-2 py-1.5 text-xs",
            current.bank === undefined
              ? "bg-brand-soft font-medium text-brand"
              : "text-muted hover:bg-brand-soft hover:text-brand",
          )}
        >
          <span>全部题库</span>
          <span className="tabular-nums">{total}</span>
        </Link>

        <ul className="flex flex-col gap-0.5">
          {banks.map((b) => {
            const bankKey = `b:${b.bankId}`;
            const bankOpen = open.has(bankKey);
            const bankActive = isActive({ bank: b.bankId, chapter: null, section: null, point: null });
            return (
              <li key={b.bankId}>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    aria-expanded={bankOpen}
                    aria-label={bankOpen ? "收起该题库" : "展开该题库"}
                    onClick={() => toggle(bankKey)}
                    className="w-5 shrink-0 rounded text-center text-[10px] text-muted hover:text-ink"
                  >
                    {b.chapters.length ? (bankOpen ? "▾" : "▸") : ""}
                  </button>
                  <Link
                    href={buildHref(
                      current,
                      { bank: b.bankId, chapter: null, section: null, point: null, offset: null },
                      "/bank",
                    )}
                    className={clsx(
                      "flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs",
                      bankActive
                        ? "bg-brand-soft font-semibold text-brand"
                        : "font-medium hover:bg-brand-soft hover:text-brand",
                    )}
                  >
                    <span className="truncate">{b.title}</span>
                    <span className="shrink-0 tabular-nums text-[11px] text-muted">{b.count}</span>
                  </Link>
                </div>

                {bankOpen && (
                  <ul className="ml-4 flex flex-col gap-0.5 border-l border-line pl-1.5">
                    {b.chapters.map((ch) => {
                      const chKey = `c:${ch.key}`;
                      const chOpen = open.has(chKey);
                      const chActive = isActive({ bank: ch.bankId, chapter: ch.index, section: null, point: null });
                      return (
                        <li key={ch.key}>
                          <div className="flex items-center gap-0.5">
                            <button
                              type="button"
                              aria-expanded={chOpen}
                              aria-label={chOpen ? "收起" : "展开"}
                              onClick={() => toggle(chKey)}
                              className="w-5 shrink-0 rounded text-center text-[10px] text-muted hover:text-ink"
                            >
                              {ch.sections.length ? (chOpen ? "▾" : "▸") : ""}
                            </button>
                            <Link
                              href={buildHref(
                                current,
                                { bank: ch.bankId, chapter: ch.index, section: null, point: null, offset: null },
                                "/bank",
                              )}
                              className={clsx(
                                "flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-2 py-1 text-xs",
                                chActive
                                  ? "bg-brand-soft font-medium text-brand"
                                  : "hover:bg-brand-soft hover:text-brand",
                              )}
                            >
                              <span className="truncate">
                                第{ch.index}章 {ch.title}
                              </span>
                              <span className="shrink-0 tabular-nums text-[11px] text-muted">{ch.count}</span>
                            </Link>
                          </div>

                          {chOpen && (
                            <div className="ml-5">
                              <div className="py-0.5 pl-2 text-[10px] tabular-nums text-muted">
                                已刷 {ch.answered}/{ch.count}
                              </div>
                              <ul className="flex flex-col gap-0.5 border-l border-line pl-1.5">
                                {ch.sections.map((sec) => {
                                  const secKey = `${chKey}|${sec.title}`;
                                  const secOpen = open.has(secKey);
                                  const secActive = isActive({
                                    bank: ch.bankId,
                                    chapter: ch.index,
                                    section: sec.title,
                                    point: null,
                                  });
                                  return (
                                    <li key={sec.title}>
                                      <div className="flex items-center gap-0.5">
                                        <button
                                          type="button"
                                          aria-expanded={secOpen}
                                          aria-label={secOpen ? "收起考点" : "展开考点"}
                                          onClick={() => toggle(secKey)}
                                          className="w-5 shrink-0 rounded text-center text-[10px] text-muted hover:text-ink"
                                        >
                                          {sec.points.length ? (secOpen ? "▾" : "▸") : ""}
                                        </button>
                                        <Link
                                          href={buildHref(
                                            current,
                                            {
                                              bank: ch.bankId,
                                              chapter: ch.index,
                                              section: sec.title,
                                              point: null,
                                              offset: null,
                                            },
                                            "/bank",
                                          )}
                                          className={clsx(
                                            "flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-2 py-1 text-xs",
                                            secActive
                                              ? "bg-brand-soft font-medium text-brand"
                                              : "text-muted hover:bg-brand-soft hover:text-brand",
                                          )}
                                        >
                                          <span className="truncate">{sec.title}</span>
                                          <span className="shrink-0 tabular-nums text-[11px]">{sec.count}</span>
                                        </Link>
                                      </div>
                                      {secOpen && (
                                        <ul className="ml-5 flex flex-col gap-0.5 border-l border-line pl-1">
                                          {sec.points.map((pt) => {
                                            const ptActive = isActive({
                                              bank: ch.bankId,
                                              chapter: ch.index,
                                              section: sec.title,
                                              point: pt.title,
                                            });
                                            return (
                                              <li key={pt.title}>
                                                <Link
                                                  href={buildHref(
                                                    current,
                                                    {
                                                      bank: ch.bankId,
                                                      chapter: ch.index,
                                                      section: sec.title,
                                                      point: pt.title,
                                                      offset: null,
                                                    },
                                                    "/bank",
                                                  )}
                                                  className={clsx(
                                                    "flex items-center justify-between gap-2 rounded-md px-2 py-1 text-[11px]",
                                                    ptActive
                                                      ? "bg-brand-soft font-medium text-brand"
                                                      : "text-muted hover:bg-brand-soft hover:text-brand",
                                                  )}
                                                >
                                                  <span className="truncate">{pt.title}</span>
                                                  <span className="shrink-0 tabular-nums">{pt.count}</span>
                                                </Link>
                                              </li>
                                            );
                                          })}
                                        </ul>
                                      )}
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
