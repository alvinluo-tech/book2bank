"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import CollectionRow from "@/components/collection/CollectionRow";
import EmptyHint from "@/components/collection/EmptyHint";
import FilterBar from "@/components/collection/FilterBar";
import RelativeTime from "@/components/collection/RelativeTime";
import { btnSm, btnSmPrimary, chipBrand, subtle } from "@/components/collection/ui";
import { bankDef } from "@/lib/banks";
import type { Question } from "@/lib/types";

/** Row shape returned by GET /api/favorites (see src/lib/db.ts listFavorites). */
interface FavoriteRow {
  questionId: string;
  addedAt: string;
  note: string | null;
  question: Question | null;
}

type SortKey = "recent" | "num";

const PAGE_STEP = 80;

function UnfavoriteButton({ questionId, onRun }: { questionId: string; onRun: (id: string) => Promise<boolean> }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      className={btnSm}
      style={failed ? { borderColor: "var(--bad)", color: "var(--bad)" } : undefined}
      disabled={busy}
      title="再次点收藏可以恢复；收藏不记录作答"
      onClick={async () => {
        setBusy(true);
        const ok = await onRun(questionId);
        setFailed(!ok);
        setBusy(false);
      }}
    >
      {busy ? "处理中…" : failed ? "重试取消" : "取消收藏"}
    </button>
  );
}

export default function FavoritesPage() {
  const [rows, setRows] = useState<FavoriteRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [nonce, setNonce] = useState(0);

  const [chapter, setChapter] = useState("all");
  const [figureOnly, setFigureOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("recent");
  const [keyword, setKeyword] = useState("");
  const [visible, setVisible] = useState(PAGE_STEP);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/favorites", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { rows?: FavoriteRow[] };
        if (!alive) return;
        setRows(Array.isArray(data.rows) ? data.rows : []);
        setNow(new Date());
        setLoadError(null);
      } catch {
        if (alive) setLoadError("读取 /api/favorites 失败。请确认本地服务已启动。");
      }
    })();
    return () => {
      alive = false;
    };
  }, [nonce]);

  /** Every filter change rewinds the rendered window. */
  const applyFilters = <T,>(setter: (v: T) => void) => (value: T) => {
    setter(value);
    setVisible(PAGE_STEP);
  };
  const changeChapter = applyFilters(setChapter);
  const changeSort = applyFilters(setSort);
  const changeKeyword = applyFilters(setKeyword);

  /** POST /api/favorites toggles, so calling it on a listed id removes it. */
  const unfavorite = useCallback(
    async (questionId: string) => {
      const res = await fetch("/api/favorites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ questionId }),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { favorite?: boolean };
      if (data.favorite === false) {
        setRows((prev) => (prev ?? []).filter((r) => r.questionId !== questionId));
      } else {
        reload();
      }
      return true;
    },
    [reload],
  );

  const stats = useMemo(() => {
    const all = rows ?? [];
    return {
      total: all.length,
      figure: all.filter((r) => r.question?.kind === "figure" || r.question?.hasImage).length,
      invalid: all.filter((r) => !r.question).length,
      chapters: new Set(
        all.map((r) => (r.question ? `${r.question.bankId}:${r.question.chapterIndex}` : null)).filter((s): s is string => typeof s === "string"),
      ).size,
    };
  }, [rows]);

  const chapterOptions = useMemo(() => {
    const titles = new Map<string, string>();
    const counts = new Map<string, number>();
    for (const r of rows ?? []) {
      const q = r.question;
      if (!q) continue;
      const ck = `${q.bankId}:${q.chapterIndex}`;
      titles.set(ck, `${bankDef(q.bankId).title}·第${q.chapterIndex}章 ${q.chapterTitle}`);
      counts.set(ck, (counts.get(ck) ?? 0) + 1);
    }
    return [...titles.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([ck, title]) => ({ value: ck, label: title, count: counts.get(ck) ?? 0 }));
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    const out = (rows ?? []).filter((r) => {
      if (chapter !== "all") {
        const q = r.question;
        if (!q || `${q.bankId}:${q.chapterIndex}` !== chapter) return false;
      }
      if (figureOnly && !(r.question?.kind === "figure" || r.question?.hasImage)) return false;
      if (needle) {
        const q = r.question;
        const hay = q ? `${q.stem} ${q.pointTitle ?? ""} ${q.sectionTitle ?? ""} ${q.chapterTitle} ${q.num} ${r.questionId}` : r.questionId;
        if (!hay.toLowerCase().includes(needle)) return false;
      }
      return true;
    });
    return out.sort((a, b) => {
      if (sort === "num") {
        const an = a.question ? `${a.question.bankId}:${a.question.chapterIndex}-${String(a.question.num).padStart(5, "0")}` : a.questionId;
        const bn = b.question ? `${b.question.bankId}:${b.question.chapterIndex}-${String(b.question.num).padStart(5, "0")}` : b.questionId;
        return an.localeCompare(bn);
      }
      return b.addedAt.localeCompare(a.addedAt);
    });
  }, [rows, chapter, figureOnly, keyword, sort]);

  const shown = filtered.slice(0, visible);
  const dirty = chapter !== "all" || figureOnly || keyword !== "" || sort !== "recent";

  const reset = () => {
    setChapter("all");
    setFigureOnly(false);
    setKeyword("");
    setSort("recent");
    setVisible(PAGE_STEP);
  };

  const redoAllHref = useMemo(() => {
    const ids = filtered.slice(0, 100).map((r) => r.questionId).join(",");
    return `/practice?ids=${encodeURIComponent(ids)}`;
  }, [filtered]);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">收藏列表</h1>
          <p className="mt-1 text-xs text-muted">
            共 {stats.total} 题 · 覆盖 {stats.chapters} 个章节 · 图形题 {stats.figure} 题
            {stats.invalid > 0 ? ` · 已失效 ${stats.invalid} 题` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/practice?mode=favorite" className="btn btn-primary">
            收藏模式刷题
          </Link>
          {filtered.length > 0 ? (
            <Link href={redoAllHref} className="btn" title="按当前筛选顺序重做（最多 100 题）">
              重做前 {Math.min(filtered.length, 100)} 题
            </Link>
          ) : null}
        </div>
      </header>

      <FilterBar
        segments={[
          {
            key: "sort",
            label: "排序",
            value: sort,
            onChange: (v) => changeSort(v as SortKey),
            options: [
              { value: "recent", label: "最近收藏" },
              { value: "num", label: "原题号" },
            ],
          },
        ]}
        selects={[
          {
            key: "chapter",
            label: "章节",
            value: chapter,
            onChange: changeChapter,
            title: "按题库章节筛选收藏",
            options: [{ value: "all", label: "全部章节", count: stats.total }, ...chapterOptions],
          },
        ]}
        toggles={[
          {
            key: "figure",
            label: "仅图形题",
            checked: figureOnly,
            onChange: setFigureOnly,
            count: stats.figure,
            title: "只看带图形裁剪的题目（图形推理）",
          },
        ]}
        search={{ value: keyword, onChange: changeKeyword, label: "搜索", placeholder: "题干 / 考点 / 原题号" }}
        dirty={dirty}
        onReset={reset}
        actions={
          <button type="button" className={btnSm} onClick={reload}>
            刷新
          </button>
        }
      />

      {loadError ? (
        <div className="card flex flex-wrap items-center justify-between gap-2 p-3 text-xs text-bad">
          <span>{loadError}</span>
          <button type="button" className={btnSm} onClick={reload}>
            重试
          </button>
        </div>
      ) : null}

      {!rows && !loadError ? <div className="card p-8 text-center text-xs text-muted">正在读取收藏列表…</div> : null}

      {rows && rows.length === 0 && !loadError ? (
        <EmptyHint
          title="还没有收藏任何题目"
          action={
            <>
              <Link href="/practice" className={btnSmPrimary}>
                去刷题
              </Link>
              <Link href="/bank" className={btnSm}>
                逛题库
              </Link>
            </>
          }
        >
          <p>
            在刷题界面按「收藏」，或在题目详情页点星标，题目就会存进 favorites 表并出现在这里。
            收藏只影响列表，不会改动作答记录，也不会进入错题本。
          </p>
        </EmptyHint>
      ) : null}

      {rows && rows.length > 0 && filtered.length === 0 && !loadError ? (
        <EmptyHint
          title="当前筛选下没有收藏"
          action={
            dirty ? (
              <button type="button" className={btnSm} onClick={reset}>
                清空筛选
              </button>
            ) : undefined
          }
        >
          <p>收藏列表按收藏时间倒序排列；换成「原题号」可以按书的顺序看。</p>
        </EmptyHint>
      ) : null}

      {shown.length > 0 ? (
        <section className="flex flex-col gap-2.5">
          {shown.map((r) => (
            <CollectionRow
              key={r.questionId}
              questionId={r.questionId}
              question={r.question}
              extraChips={
                r.question?.kind === "figure" || r.question?.hasImage ? (
                  <span className={chipBrand}>含图形裁剪</span>
                ) : null
              }
              meta={<RelativeTime value={r.addedAt} now={now} neutral label="收藏于" />}
              actions={
                <>
                  <Link href={`/question/${r.questionId}`} className={btnSmPrimary}>
                    查看原题
                  </Link>
                  <Link href={`/practice?ids=${encodeURIComponent(r.questionId)}`} className={btnSm}>
                    去重做
                  </Link>
                  <UnfavoriteButton questionId={r.questionId} onRun={unfavorite} />
                </>
              }
            />
          ))}

          {filtered.length > visible ? (
            <button type="button" className={btnSm} onClick={() => setVisible((v) => v + PAGE_STEP)}>
              显示更多（还有 {filtered.length - visible} 条）
            </button>
          ) : null}
        </section>
      ) : null}

      <p className={subtle}>
        收藏存在 data/app.db 的 favorites 表（question_id 主键 + added_at）。若题目在重建题库后消失，这里会显示「已失效」，
        取消收藏即可清理。
      </p>
    </div>
  );
}
