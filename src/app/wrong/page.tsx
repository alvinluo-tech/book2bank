"use client";

import clsx from "clsx";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import CollectionRow from "@/components/collection/CollectionRow";
import ConfirmButton from "@/components/collection/ConfirmButton";
import EmptyHint from "@/components/collection/EmptyHint";
import FilterBar from "@/components/collection/FilterBar";
import LeitnerDots, { MASTER_BOX } from "@/components/collection/LeitnerDots";
import RelativeTime from "@/components/collection/RelativeTime";
import { isDue, relativeDay } from "@/components/collection/time";
import { btnSm, btnSmDanger, btnSmPrimary, chipBad, chipBrand, chipOk, subtle } from "@/components/collection/ui";
import { bankDef } from "@/lib/banks";
import type { WrongEntry } from "@/lib/types";

type StatusFilter = "open" | "resolved" | "all";
type SortKey = "recent" | "count" | "box";

/** Mirrors BOX_DAYS in src/lib/db.ts: days until the next review from each box. */
const INTERVALS = [1, 3, 7, 21];
const INVALID = "invalid";
const PAGE_STEP = 60;

/* ------------------------------------------------------------------ */
/* Local presentational helpers (same module, so still a client tree).  */
/* ------------------------------------------------------------------ */

function ActionButton({
  label,
  onRun,
  tone = "default",
  disabled = false,
  title,
}: {
  label: string;
  onRun: () => Promise<unknown>;
  tone?: "default" | "danger" | "primary";
  disabled?: boolean;
  title?: string;
}) {
  const [busy, setBusy] = useState(false);
  const className = tone === "primary" ? btnSmPrimary : tone === "danger" ? btnSmDanger : btnSm;
  return (
    <button
      type="button"
      className={className}
      title={title}
      disabled={busy || disabled}
      onClick={async () => {
        setBusy(true);
        try {
          await onRun();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "处理中…" : label}
    </button>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: number;
  sub?: string;
  tone?: "brand" | "ok" | "bad";
}) {
  return (
    <div className="card px-3 py-2.5">
      <div className="text-[11px] text-muted">{label}</div>
      <div
        className={clsx(
          "mt-0.5 text-xl font-semibold tabular-nums",
          tone === "brand" && "text-brand",
          tone === "ok" && "text-ok",
          tone === "bad" && "text-bad",
        )}
      >
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-[11px] tabular-nums text-muted">{sub}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function WrongBookPage() {
  const [rows, setRows] = useState<WrongEntry[] | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const [status, setStatus] = useState<StatusFilter>("open");
  const [chapter, setChapter] = useState("all");
  const [dueOnly, setDueOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("recent");
  const [keyword, setKeyword] = useState("");
  /** Module preselected from the 题型广场 link (?bank=ziliao …). */
  const [bank, setBank] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [visible, setVisible] = useState(PAGE_STEP);

  useEffect(() => {
    const b = new URLSearchParams(window.location.search).get("bank");
    if (b) setBank(b);
  }, []);

  /** Refetch after a mutation, from an event handler rather than an effect. */
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/wrong?limit=5000", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { rows?: WrongEntry[] };
        if (!alive) return;
        setRows(Array.isArray(data.rows) ? data.rows : []);
        setNow(new Date());
        setLoadError(null);
      } catch {
        if (alive) setLoadError("读取 /api/wrong 失败。请确认本地服务已启动；学习记录存放在 data/app.db。");
      }
    })();
    return () => {
      alive = false;
    };
  }, [nonce]);

  /** Every filter change also rewinds the rendered window. */
  const applyFilters = <T,>(setter: (v: T) => void) => (value: T) => {
    setter(value);
    setVisible(PAGE_STEP);
  };
  const changeStatus = applyFilters(setStatus);
  const changeChapter = applyFilters(setChapter);
  const changeSort = applyFilters(setSort);
  const changeKeyword = applyFilters(setKeyword);

  /** Status / box changes refetch, so the Leitner schedule shown matches the server. */
  const patch = useCallback(
    async (body: { questionId: string; status?: "open" | "resolved"; box?: number }) => {
      const res = await fetch("/api/wrong", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) reload();
      return res.ok;
    },
    [reload],
  );

  /** Note saves stay local — the editor owns its text, so a refetch would only flicker. */
  const saveNote = useCallback(async (questionId: string, note: string) => {
    const res = await fetch("/api/wrong", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ questionId, note }),
    });
    if (res.ok) setRows((prev) => (prev ?? []).map((r) => (r.questionId === questionId ? { ...r, note } : r)));
    return res.ok;
  }, []);

  const removeOne = useCallback(async (questionId: string) => {
    const res = await fetch(`/api/wrong?questionId=${encodeURIComponent(questionId)}`, { method: "DELETE" });
    if (res.ok) {
      setRows((prev) => (prev ?? []).filter((r) => r.questionId !== questionId));
      setSelected((prev) => prev.filter((id) => id !== questionId));
    }
    return res.ok;
  }, []);

  const removeMany = useCallback(
    async (ids: string[]) => {
      for (const id of ids) {
        await fetch(`/api/wrong?questionId=${encodeURIComponent(id)}`, { method: "DELETE" });
      }
      setSelected([]);
      reload();
    },
    [reload],
  );

  const stats = useMemo(() => {
    let open = 0;
    let resolved = 0;
    let due = 0;
    let invalid = 0;
    for (const r of rows ?? []) {
      if (r.status === "resolved") resolved += 1;
      else {
        open += 1;
        if (isDue(r.nextReview, now)) due += 1;
      }
      if (!r.question) invalid += 1;
    }
    return { total: (rows ?? []).length, open, resolved, due, invalid };
  }, [rows, now]);

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
      .map(([ck, title]) => ({
        value: ck,
        label: title,
        count: counts.get(ck) ?? 0,
      }));
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    const out = (rows ?? []).filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (bank !== "all" && r.question?.bankId !== bank) return false;
      if (chapter === INVALID) {
        if (r.question) return false;
      } else if (chapter !== "all") {
        const q = r.question;
        if (!q || `${q.bankId}:${q.chapterIndex}` !== chapter) return false;
      }
      if (dueOnly && !(r.status === "open" && isDue(r.nextReview, now))) return false;
      if (needle) {
        const q = r.question;
        const hay = q
          ? `${q.stem} ${q.pointTitle ?? ""} ${q.sectionTitle ?? ""} ${q.chapterTitle} ${q.num} ${r.questionId}`
          : r.questionId;
        if (!hay.toLowerCase().includes(needle)) return false;
      }
      return true;
    });

    return out.sort((a, b) => {
      if (sort === "count") return b.wrongCount - a.wrongCount || a.box - b.box;
      if (sort === "box") return b.box - a.box || (a.nextReview ?? "9").localeCompare(b.nextReview ?? "9");
      return b.lastAt.localeCompare(a.lastAt) || b.wrongCount - a.wrongCount;
    });
  }, [rows, status, chapter, dueOnly, keyword, sort, now]);

  const shown = filtered.slice(0, visible);
  const filteredIdSet = useMemo(() => new Set(filtered.map((r) => r.questionId)), [filtered]);
  const selectedInView = selected.filter((id) => filteredIdSet.has(id));
  const allSelected = filtered.length > 0 && selectedInView.length === filtered.length;

  const dirty = status !== "open" || chapter !== "all" || dueOnly || keyword !== "" || sort !== "recent";

  const reset = () => {
    setStatus("open");
    setChapter("all");
    setDueOnly(false);
    setSort("recent");
    setKeyword("");
    setVisible(PAGE_STEP);
  };

  const redoHref = useMemo(() => {
    const params = new URLSearchParams({ status: "wrong" });
    if (chapter !== "all" && chapter !== INVALID) params.set("chapter", chapter);
    return `/practice?${params.toString()}`;
  }, [chapter]);

  const toolbarActions = (
    <>
      <Link href={redoHref} className={btnSmPrimary} title="按当前章节筛选重做未消灭错题">
        重做本筛选全部
      </Link>
      {selectedInView.length > 0 ? (
        <ConfirmButton
          tone="danger"
          label={`批量移出错题本（${selectedInView.length}）`}
          confirmLabel={`确认移出 ${selectedInView.length} 题`}
          onConfirm={() => removeMany(selectedInView)}
          title="删除这些题目的错题本记录；作答流水不受影响"
        />
      ) : null}
      {filtered.length > 0 ? (
        <button
          type="button"
          className={btnSm}
          onClick={() => setSelected(allSelected ? [] : filtered.map((r) => r.questionId))}
        >
          {allSelected ? "取消全选" : `全选 ${filtered.length} 项`}
        </button>
      ) : null}
      <button type="button" className={btnSm} onClick={reload}>
        刷新
      </button>
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">错题本</h1>
          <p className="mt-1 text-xs text-muted">
            答错自动收录 · 错一次进第 1 关，此后连续答对逐级升关，到第 {MASTER_BOX} 关自动标记为已消灭
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/practice?mode=wrong" className="btn btn-primary">
            只练错题
          </Link>
          <Link href="/practice" className="btn">
            去刷题
          </Link>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="未消灭" value={stats.open} sub={`到第 ${MASTER_BOX} 关前都算未消灭`} tone="brand" />
        <Stat
          label="今日到期"
          value={stats.due}
          sub="含逾期未复习"
          tone={stats.due > 0 ? "bad" : undefined}
        />
        <Stat label="已消灭" value={stats.resolved} sub="练满或手动标记" tone="ok" />
        <Stat
          label="错题总数"
          value={stats.total}
          sub={stats.invalid > 0 ? `其中 ${stats.invalid} 题已失效` : "均为有效题号"}
        />
      </section>

      <FilterBar
        segments={[
          {
            key: "status",
            label: "状态",
            value: status,
            onChange: (v) => changeStatus(v as StatusFilter),
            options: [
              { value: "open", label: "未消灭", count: stats.open },
              { value: "resolved", label: "已消灭", count: stats.resolved },
              { value: "all", label: "全部", count: stats.total },
            ],
          },
          {
            key: "sort",
            label: "排序",
            value: sort,
            onChange: (v) => changeSort(v as SortKey),
            options: [
              { value: "recent", label: "最近答错" },
              { value: "count", label: "错误次数" },
              { value: "box", label: "关卡" },
            ],
          },
        ]}
        selects={[
          {
            key: "chapter",
            label: "章节",
            value: chapter,
            onChange: changeChapter,
            title: "按题库章节筛选",
            options: [
              { value: "all", label: "全部章节", count: stats.total },
              ...chapterOptions,
              ...(stats.invalid > 0 ? [{ value: INVALID, label: "已失效", count: stats.invalid }] : []),
            ],
          },
        ]}
        toggles={[
          {
            key: "due",
            label: "仅今日到期",
            checked: dueOnly,
            onChange: setDueOnly,
            count: stats.due,
            title: "只看复习日已到（含逾期）的错题",
          },
        ]}
        search={{ value: keyword, onChange: changeKeyword, label: "搜索", placeholder: "题干 / 考点 / 原题号" }}
        dirty={dirty}
        onReset={reset}
        actions={toolbarActions}
      />

      {loadError ? (
        <div className="card flex flex-wrap items-center justify-between gap-2 p-3 text-xs text-bad">
          <span>{loadError}</span>
          <ActionButton label="重试" onRun={async () => reload()} />
        </div>
      ) : null}

      {!rows && !loadError ? (
        <div className="card p-8 text-center text-xs text-muted">正在读取错题本…</div>
      ) : null}

      {rows && rows.length === 0 && !loadError ? (
        <EmptyHint title="错题本还是空的">
          <p>
            错题本不需要手动添加：在刷题中答错任何一题，它会自动进入第 1 关，并把下次复习安排在明天；到期后再做，答对就升关，
            到第 {MASTER_BOX} 关自动记为已消灭。题库里没有答案的题目（OCR 未识别到答案）不作判分，也就不会进错题本。
          </p>
          <p className="mt-1">
            想先熟悉考点可以用背题模式：<Link href="/practice?mode=recite" className="text-brand">背题模式 →</Link>
          </p>
        </EmptyHint>
      ) : null}

      {rows && rows.length > 0 && filtered.length === 0 && !loadError ? (
        <EmptyHint
          title="当前筛选下没有错题"
          action={
            dirty ? (
              <button type="button" className={btnSm} onClick={reset}>
                清空筛选
              </button>
            ) : undefined
          }
        >
          <p>换一组条件试试，或把状态切到「全部」看看已消灭的错题。</p>
        </EmptyHint>
      ) : null}

      {shown.length > 0 ? (
        <section className="flex flex-col gap-2.5">
          {selectedInView.length > 0 ? (
            <p className={subtle}>已选 {selectedInView.length} / {filtered.length} 项，批量操作只作用于当前筛选结果。</p>
          ) : null}

          {shown.map((r) => {
            const q = r.question;
            const due = r.status === "open" && isDue(r.nextReview, now);
            const rel = relativeDay(r.nextReview, now);
            const nextBox = Math.min(MASTER_BOX, r.box + 1);
            return (
              <CollectionRow
                key={r.questionId}
                questionId={r.questionId}
                question={q}
                highlight={due}
                note={r.note}
                onSaveNote={(text) => saveNote(r.questionId, text)}
                leading={
                  <input
                    type="checkbox"
                    aria-label={`选择 ${r.questionId}`}
                    checked={selected.includes(r.questionId)}
                    onChange={(e) =>
                      setSelected((prev) =>
                        e.target.checked ? [...prev, r.questionId] : prev.filter((id) => id !== r.questionId),
                      )
                    }
                    className="mt-1 h-3.5 w-3.5 shrink-0 accent-brand"
                  />
                }
                extraChips={
                  <>
                    {r.status === "resolved" ? <span className={chipOk}>已消灭</span> : null}
                    {due ? (
                      <span className={chipBad}>
                        {rel.diff !== null && rel.diff < 0 ? `逾期 ${-rel.diff} 天` : "今日到期"}
                      </span>
                    ) : null}
                    {r.status === "resolved" && r.box >= MASTER_BOX ? (
                      <span className={chipBrand}>练满 {MASTER_BOX} 关</span>
                    ) : null}
                  </>
                }
                meta={
                  <>
                    <span className="tabular-nums">错 {r.wrongCount} 次</span>
                    <LeitnerDots box={r.box} status={r.status} intervals={INTERVALS} />
                    {r.status === "open" ? <RelativeTime value={r.nextReview} now={now} label="下次复习" /> : null}
                    <RelativeTime value={r.lastAt} now={now} neutral label="最后答错" />
                    <RelativeTime value={r.firstAt} now={now} neutral label="首次答错" />
                  </>
                }
                actions={
                  <>
                    {q ? (
                      <Link href={`/practice?ids=${encodeURIComponent(r.questionId)}`} className={btnSmPrimary}>
                        去重做
                      </Link>
                    ) : (
                      <span className={clsx(btnSm, "cursor-not-allowed opacity-40")} title="题库重建后该题号已不存在">
                        去重做
                      </span>
                    )}
                    {r.status === "open" ? (
                      <>
                        <ActionButton
                          label="标记已掌握"
                          title="直接记为已消灭，不再安排复习"
                          onRun={() => patch({ questionId: r.questionId, status: "resolved" })}
                        />
                        {r.box < MASTER_BOX ? (
                          <ActionButton
                            label={`升关至 ${nextBox}`}
                            title={`手动推进到第 ${nextBox} 关，并按该关卡重排下次复习日期`}
                            onRun={() => patch({ questionId: r.questionId, box: nextBox })}
                          />
                        ) : null}
                      </>
                    ) : (
                      <ActionButton
                        label="重新复习"
                        title="回到第 1 关，今天即可再练"
                        onRun={() => patch({ questionId: r.questionId, box: 1 })}
                      />
                    )}
                    <ConfirmButton
                      tone="danger"
                      label="移出错题本"
                      confirmLabel="确认移出"
                      onConfirm={() => removeOne(r.questionId)}
                      title="删除错题本记录（作答流水保留，之后答错仍会重新收录）"
                    />
                  </>
                }
              />
            );
          })}

          {filtered.length > visible ? (
            <button type="button" className={btnSm} onClick={() => setVisible((v) => v + PAGE_STEP)}>
              显示更多（还有 {filtered.length - visible} 条）
            </button>
          ) : null}
        </section>
      ) : null}

      <p className={subtle}>
        错题本存在 SQLite 表 wrong_book（question_id / wrong_count / box / next_review / note），文件是 data/app.db；
        导出、导入与清空在「数据」页。<Link href="/settings" className="text-brand">数据设置 →</Link>
      </p>
    </div>
  );
}
