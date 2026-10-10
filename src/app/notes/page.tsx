"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import CollectionRow from "@/components/collection/CollectionRow";
import ConfirmButton from "@/components/collection/ConfirmButton";
import EmptyHint from "@/components/collection/EmptyHint";
import FilterBar from "@/components/collection/FilterBar";
import RelativeTime from "@/components/collection/RelativeTime";
import { btnSm, btnSmPrimary, chipBad, chipBrand, subtle } from "@/components/collection/ui";
import { bankDef } from "@/lib/banks";
import type { Question } from "@/lib/types";

/** Row shape returned by GET /api/notes (see src/lib/db.ts listNotes). */
interface NoteRow {
  questionId: string;
  text: string;
  updatedAt: string;
  question: Question | null;
}

type SortKey = "recent" | "num";

const PAGE_STEP = 60;

/** SQLite `datetime('now','localtime')` style stamp, so RelativeTime can parse it. */
function localStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export default function NotesPage() {
  const [rows, setRows] = useState<NoteRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [nonce, setNonce] = useState(0);

  const [chapter, setChapter] = useState("all");
  const [filledOnly, setFilledOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("recent");
  const [keyword, setKeyword] = useState("");
  const [visible, setVisible] = useState(PAGE_STEP);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/notes", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { rows?: NoteRow[] };
        if (!alive) return;
        setRows(Array.isArray(data.rows) ? data.rows : []);
        setNow(new Date());
        setLoadError(null);
      } catch {
        if (alive) setLoadError("读取 /api/notes 失败。请确认本地服务已启动。");
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

  const save = useCallback(async (questionId: string, text: string) => {
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ questionId, text }),
    });
    if (!res.ok) return false;
    setRows((prev) =>
      (prev ?? []).map((r) => (r.questionId === questionId ? { ...r, text, updatedAt: localStamp() } : r)),
    );
    return true;
  }, []);

  const stats = useMemo(() => {
    const all = rows ?? [];
    const filled = all.filter((r) => r.text.trim() !== "");
    return {
      total: all.length,
      filled: filled.length,
      blank: all.length - filled.length,
      chars: filled.reduce((n, r) => n + r.text.trim().length, 0),
      invalid: all.filter((r) => !r.question).length,
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
      if (filledOnly && r.text.trim() === "") return false;
      if (needle) {
        const q = r.question;
        const hay = q
          ? `${r.text} ${q.stem} ${q.pointTitle ?? ""} ${q.sectionTitle ?? ""} ${q.chapterTitle} ${q.num} ${r.questionId}`
          : `${r.text} ${r.questionId}`;
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
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [rows, chapter, filledOnly, keyword, sort]);

  const shown = filtered.slice(0, visible);
  const dirty = chapter !== "all" || filledOnly || keyword !== "" || sort !== "recent";

  const reset = () => {
    setChapter("all");
    setFilledOnly(false);
    setKeyword("");
    setSort("recent");
    setVisible(PAGE_STEP);
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">笔记</h1>
          <p className="mt-1 text-xs text-muted">
            共 {stats.total} 条 · 有内容 {stats.filled} 条 · 累计 {stats.chars} 字
            {stats.blank > 0 ? ` · 空白 ${stats.blank} 条` : ""}
            {stats.invalid > 0 ? ` · 已失效 ${stats.invalid} 条` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/practice" className="btn btn-primary">
            去刷题
          </Link>
          <button type="button" className={btnSm} onClick={reload}>
            刷新
          </button>
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
              { value: "recent", label: "最近修改" },
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
            title: "按题库章节筛选笔记",
            options: [{ value: "all", label: "全部章节", count: stats.total }, ...chapterOptions],
          },
        ]}
        toggles={[
          {
            key: "filled",
            label: "仅有内容",
            checked: filledOnly,
            onChange: setFilledOnly,
            count: stats.filled,
            title: "隐藏正文为空白的笔记",
          },
        ]}
        search={{ value: keyword, onChange: changeKeyword, label: "搜索", placeholder: "笔记正文 / 题干 / 考点" }}
        dirty={dirty}
        onReset={reset}
      />

      {loadError ? (
        <div className="card flex flex-wrap items-center justify-between gap-2 p-3 text-xs text-bad">
          <span>{loadError}</span>
          <button type="button" className={btnSm} onClick={reload}>
            重试
          </button>
        </div>
      ) : null}

      {!rows && !loadError ? <div className="card p-8 text-center text-xs text-muted">正在读取笔记…</div> : null}

      {rows && rows.length === 0 && !loadError ? (
        <EmptyHint
          title="还没有写过笔记"
          action={
            <>
              <Link href="/practice" className={btnSmPrimary}>
                去刷题时顺手记一条
              </Link>
              <Link href="/wrong" className={btnSm}>
                看错题本
              </Link>
            </>
          }
        >
          <p>
            笔记贴在题目上：在刷题界面或题目详情页写下考点口径、图形规律、易错陷阱，保存后会出现在这里。
            这里编辑的内容与题目绑定（notes 表按 question_id 存），换设备或重建题库后题号可能对不上，但正文仍会保留。
          </p>
          <p className="mt-1">注意：错题本每行也有一个「备注」，它存在 wrong_book.note，和这里的笔记是两份数据。</p>
        </EmptyHint>
      ) : null}

      {rows && rows.length > 0 && filtered.length === 0 && !loadError ? (
        <EmptyHint
          title="当前筛选下没有笔记"
          action={
            dirty ? (
              <button type="button" className={btnSm} onClick={reset}>
                清空筛选
              </button>
            ) : undefined
          }
        >
          <p>把「仅有内容」关掉，就能看到为了占位而留下的空白笔记。</p>
        </EmptyHint>
      ) : null}

      {shown.length > 0 ? (
        <section className="flex flex-col gap-2.5">
          {shown.map((r) => (
            <CollectionRow
              key={r.questionId}
              questionId={r.questionId}
              question={r.question}
              note={r.text}
              noteLabel="笔记正文"
              notePlaceholder="写下判断口径与易错点，如「平移看内外圈分开数；先数部分数再看对称」；失焦自动保存"
              noteRows={4}
              onSaveNote={(text) => save(r.questionId, text)}
              extraChips={
                <>
                  {r.text.trim() === "" ? <span className={chipBad}>空白笔记</span> : null}
                  <span className={chipBrand}>{r.text.trim().length} 字</span>
                </>
              }
              meta={<RelativeTime value={r.updatedAt} now={now} neutral label="修改于" />}
              actions={
                <>
                  <Link href={`/question/${r.questionId}`} className={btnSmPrimary}>
                    查看原题
                  </Link>
                  <Link href={`/practice?ids=${encodeURIComponent(r.questionId)}`} className={btnSm}>
                    去重做
                  </Link>
                  {r.text.trim() !== "" ? (
                    <ConfirmButton
                      label="清空正文"
                      confirmLabel="确认清空"
                      onConfirm={() => save(r.questionId, "")}
                      title="只清空笔记正文；题目与笔记记录仍保留"
                    />
                  ) : null}
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
        正文失焦即保存（也可 Ctrl/⌘ + Enter），保存状态显示在右上角；想整库备份或清空请到{" "}
        <Link href="/settings" className="text-brand">数据页</Link>。
      </p>
    </div>
  );
}
