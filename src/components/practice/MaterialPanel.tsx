"use client";

import clsx from "clsx";
import Link from "next/link";
import { useCallback, useState, useSyncExternalStore } from "react";
import type { Material } from "@/lib/types";
import {
  cleanLabel,
  cleanSource,
  columnAligns,
  groupLabelOf,
  kindLabel,
  pad,
  parseTable,
  toParagraphs,
} from "./material-format";

/**
 * 一段资料（统计表格 / 图形 / 文字材料）的展示面板。
 *
 * 资料分析里一段资料带着整组小题，读数要来回翻，所以练习时它常驻在题目上方，
 * 桌面端 sticky 跟随；其余模块没有资料，这个组件根本不会被渲染。
 */

export interface MaterialGroupPosition {
  /** 本题在本组中的序号，1 基。 */
  index: number;
  /** 本组共几题（以当前队列为准，抽题不满一组时也如实显示）。 */
  total: number;
}

interface Props {
  material: Material;
  /** 同组小题定位条：同一资料 · 第 2/5 小题。 */
  group?: MaterialGroupPosition | null;
  /** 练习页需要 sticky 跟随答题；详情页关掉。 */
  sticky?: boolean;
  className?: string;
}

const MINI_BTN =
  "shrink-0 rounded-lg border border-line bg-panel px-2 py-1 text-[11px] text-muted transition-colors hover:border-brand hover:text-brand";

/** 折叠状态按资料 id 存档：同一段资料在这一组小题之间保持同一个开合状态。 */
const collapseKey = (id: string) => `ziliao.material.collapsed.${id}`;

const readCollapsed = (id: string): boolean => {
  try {
    return window.localStorage.getItem(collapseKey(id)) === "1";
  } catch {
    return false; // 无痕模式 / 存储被禁用：不记住，但照常显示
  }
};

/** 服务端渲染时一律摊开，客户端才按 localStorage 收起——避免 hydration 打起来。 */
const serverCollapsed = () => false;

/**
 * localStorage 是外部系统，按 external store 读它，而不是在 effect 里 setState
 * （翻页换资料时组件实例不变，effect 里同步状态会多渲染一轮）。
 */
function useStoredCollapse(id: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const onStorage = (event: StorageEvent) => {
        if (event.key === collapseKey(id)) onChange();
      };
      window.addEventListener("storage", onStorage);
      return () => window.removeEventListener("storage", onStorage);
    },
    [id],
  );
  const getSnapshot = useCallback(() => readCollapsed(id), [id]);
  return useSyncExternalStore(subscribe, getSnapshot, serverCollapsed);
}

/* ------------------------------------------------------------------ */
/* component                                                          */
/* ------------------------------------------------------------------ */

export default function MaterialPanel({ material, group = null, sticky = false, className }: Props) {
  // 手动开合只记当前这份资料的（附 id 比较），翻到下一段资料自动回到存档状态。
  const [collapseOverride, setCollapseOverride] = useState<{ id: string; value: boolean } | null>(null);
  const [textToggle, setTextToggle] = useState<{ id: string; open: boolean } | null>(null);
  const [imgError, setImgError] = useState<{ id: string } | null>(null);

  const storedCollapsed = useStoredCollapse(material.id);
  const collapsed = collapseOverride?.id === material.id ? collapseOverride.value : storedCollapsed;
  const image = imgError?.id === material.id ? null : material.image;
  const textOpen = textToggle?.id === material.id ? textToggle.open : !material.image;

  const text = (material.text ?? "").trim();
  const title = cleanLabel(material.title);
  const unit = cleanLabel(material.unit);
  const setLabel = groupLabelOf(material);
  const source = cleanSource(material.source);
  const kindText = kindLabel(material.kind);
  const table = text ? parseTable(text) : null;
  const aligns = table ? columnAligns(table) : [];
  const pageRef = material.pageRef;
  const bookHref = pageRef
    ? `/book?bank=${encodeURIComponent(material.bankId)}&tag=${encodeURIComponent(pageRef.tag)}&page=${pageRef.page}`
    : null;

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapseOverride({ id: material.id, value: next });
    try {
      window.localStorage.setItem(collapseKey(material.id), next ? "1" : "0");
    } catch {
      /* 存不下就算了，本次会话里记住 */
    }
  };

  const lowConfidence = material.ocrConfidence < 0.75;

  return (
    <section
      aria-label="资料"
      className={clsx(
        "card overflow-hidden",
        sticky && "lg:sticky lg:top-4 lg:z-10",
        className,
      )}
    >
      <header
        className={clsx(
          "flex flex-wrap items-center justify-between gap-2 p-3",
          !collapsed && "border-b border-line",
        )}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="chip border-brand/50 bg-brand-soft text-brand">{kindText}</span>
          {setLabel && <span className="chip">{setLabel}</span>}
          {source && <span className="chip">来源 {source}</span>}
          {group && group.total > 1 && (
            <span className="chip tabular-nums">
              同一资料 · 第 {group.index}/{group.total} 小题
            </span>
          )}
        </div>
        <button type="button" className={MINI_BTN} onClick={toggleCollapsed} aria-expanded={!collapsed}>
          {collapsed ? "展开资料" : "收起资料"}
        </button>
      </header>

      {collapsed ? (
        <p className="truncate px-3 pb-3 text-[11px] text-muted">
          已收起 · {title ?? kindText}
          {unit ? `（单位：${unit}）` : ""}
          {group && group.total > 1 ? ` · 本组 ${group.total} 小题` : ""}
        </p>
      ) : (
        <div className="flex flex-col gap-3 p-3 lg:max-h-[min(62vh,680px)] lg:overflow-y-auto">
          {/* 资料原图：OCR 的权威依据，优先整幅展示 */}
          {image && (
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element -- 资料裁图是流水线产物，直接从 /public 读 */}
              <img
                src={image}
                alt={`${kindText}${title ? `：${title}` : ""}`}
                width={material.imageW ?? undefined}
                height={material.imageH ?? undefined}
                loading="lazy"
                decoding="async"
                onError={() => {
                  setImgError({ id: material.id });
                  setTextToggle({ id: material.id, open: true });
                }}
                className="figure-img w-full"
              />
              <figcaption className="mt-1 text-[11px] leading-relaxed text-muted">
                资料原图（{pageRef ? `第 ${pageRef.page} 页扫描` : "流水线裁图"}
                {material.imagePages && material.imagePages.length > 1
                  ? ` · 跨 ${material.imagePages.length} 页`
                  : ""}
                ）。
                {text || title
                  ? "下方文字版数据为识别结果，算数前以原图为准。"
                  : "这段资料没有识别出可用的文字数据，算数请以原图为准。"}
              </figcaption>
            </figure>
          )}

          {/* 文字版数据：表格资料还原成 <table>，文字资料按段落排 */}
          {(text || title) && (
            <div className="rounded-xl border border-line">
              <button
                type="button"
                onClick={() => setTextToggle({ id: material.id, open: !textOpen })}
                aria-expanded={textOpen}
                className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs"
              >
                <span className="font-medium">文字版数据</span>
                <span className="shrink-0 tabular-nums text-muted">
                  {table ? `${table.rows.length} 行 ${table.cols} 列` : text ? "文字材料" : "未识别到数据"}
                  {" · "}
                  {textOpen ? "收起" : "展开"}
                </span>
              </button>

              {textOpen && (
                <div className="border-t border-line p-2.5">
                  {(title || unit) && (
                    <p className="mb-2 text-[13px] leading-relaxed">
                      <span className="font-medium">{title ?? kindText}</span>
                      {unit && (
                        <span className="ml-1.5 text-[11px] text-muted">单位：{unit}</span>
                      )}
                    </p>
                  )}

                  {table && (
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-[11px] leading-relaxed tabular-nums">
                        <thead>
                          <tr className="border-b border-line">
                            {table.header.map((cell, i) => (
                              <th
                                key={`${cell}-${i}`}
                                scope="col"
                                className={clsx(
                                  "whitespace-nowrap px-1.5 py-1 font-medium text-muted",
                                  aligns[i] ? "text-right" : "text-left",
                                )}
                              >
                                {cell}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {table.rows.map((row, r) =>
                            row.length === 1 ? (
                              <tr key={r} className="border-b border-line last:border-0">
                                <td colSpan={table.cols} className="px-1.5 py-1 text-muted">
                                  {row[0]}
                                </td>
                              </tr>
                            ) : (
                              <tr key={r} className="border-b border-line last:border-0">
                                {pad(row, table.cols).map((cell, c) => (
                                  <td
                                    key={c}
                                    className={clsx(
                                      "px-1.5 py-1",
                                      aligns[c] ? "text-right" : "text-left",
                                      cell === "" && "text-muted",
                                    )}
                                  >
                                    {cell || "—"}
                                  </td>
                                ))}
                              </tr>
                            ),
                          )}
                        </tbody>
                      </table>
                      <p className="mt-1 text-[10px] leading-relaxed text-muted">
                        表格由 OCR 逐行还原，缺格以「—」占位；行列与原图有出入时以原图为准。
                      </p>
                    </div>
                  )}

                  {!table && text && (
                    <div className="flex flex-col gap-1.5">
                      {material.kind === "table" && (
                        <p className="text-[10px] leading-relaxed text-muted">
                          这段表格资料没有被完整识别成行列，以下按识别到的文字原样显示，算数请对照原图。
                        </p>
                      )}
                      {toParagraphs(text).map((p, i) => (
                        <p
                          key={i}
                          className={clsx(
                            "whitespace-pre-wrap leading-[1.8]",
                            /^注[：:]/.test(p) ? "text-[11px] text-muted" : "text-[13px]",
                          )}
                        >
                          {p}
                        </p>
                      ))}
                    </div>
                  )}

                  {!text && (
                    <p className="text-[11px] leading-relaxed text-muted">
                      这段资料没有识别到文字数据（纯图形资料常见），请以上方原图为准。
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 图片和文字都没有：只能回原书看这段资料 */}
          {!image && !text && (
            <div className="rounded-xl border border-dashed border-line p-3 text-xs leading-relaxed text-muted">
              这段资料的原图与文字数据都不可用（裁图未生成或 OCR 未识别到内容），
              {title ? `目前只知道它是《${title}》` : "目前没有任何可读内容"}，作答本题组请回到原书查看。
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {bookHref && pageRef && (
                  <Link
                    href={bookHref}
                    className="chip border-brand/50 bg-brand-soft text-brand hover:underline"
                  >
                    原书第 {pageRef.page} 页
                    {pageRef.bookPage != null ? `（书页 ${pageRef.bookPage}）` : ""} →
                  </Link>
                )}
              </div>
              <p className="mt-2 text-[11px]">
                补做资料裁图：运行 <code className="font-mono">python pipeline/crop_images.py</code>。
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2 text-[11px] tabular-nums text-muted">
            <span>
              资料 <code className="font-mono">{material.id}</code>
            </span>
            <span style={lowConfidence ? { color: "var(--warn)" } : undefined}>
              识别置信度 {Math.round(material.ocrConfidence * 100)}%
              {lowConfidence ? "（偏低，建议对照原图）" : ""}
            </span>
            {bookHref && pageRef && (
              <Link href={bookHref} className="hover:text-brand">
                原书第 {pageRef.page} 页 →
              </Link>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
