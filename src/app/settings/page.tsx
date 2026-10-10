"use client";

import clsx from "clsx";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import ConfirmButton from "@/components/collection/ConfirmButton";
import { isDue } from "@/components/collection/time";
import { btnSm, btnSmPrimary, chipMuted, sectionTitle, subtle } from "@/components/collection/ui";
import { isoToday } from "@/lib/format";
import type { BankMeta, WrongEntry } from "@/lib/types";

interface MetaPayload {
  metas: BankMeta[];
  answeredByChapter: { bankId: string; index: number; answered: number }[];
  corrections?: Record<string, { applied?: number; unmatched?: string[] }>;
}

/** Matches exportUserData() in src/lib/db.ts — the POST /api/data body. */
interface BackupShape {
  exportedAt?: string;
  attempts?: unknown[];
  sessions?: unknown[];
  wrongBook?: unknown[];
  favorites?: unknown[];
  notes?: unknown[];
  tags?: unknown[];
  questionTags?: unknown[];
}

interface Snapshot {
  metas: BankMeta[];
  answeredByChapter: { bankId: string; index: number; answered: number }[];
  /** 人工校正的落地情况：applied 已生效，unmatched 是重建后没能再匹配上的条目。 */
  corrections?: Record<string, { applied: number; unmatched: string[] }>;
  wrongOpen: number;
  wrongResolved: number;
  due: number;
  wrongTotal: number;
  favorites: number;
  notes: number;
  invalidWrong: number;
}

async function getJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

const bytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`);

const len = (arr: unknown[] | undefined) => (Array.isArray(arr) ? arr.length : 0);

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "brand" | "ok" | "bad" }) {
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

export default function SettingsPage() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [pending, setPending] = useState<{ name: string; size: number; backup: BackupShape } | null>(null);
  const [importing, setImporting] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [nonce, setNonce] = useState(0);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [metaPayload, wrongPayload, favPayload, notePayload] = await Promise.all([
        getJson<MetaPayload>("/api/bank/meta", { metas: [], answeredByChapter: [] }),
        getJson<{ rows: WrongEntry[] }>("/api/wrong?limit=5000", { rows: [] }),
        getJson<{ rows: { questionId: string }[] }>("/api/favorites", { rows: [] }),
        getJson<{ rows: { questionId: string; text: string }[] }>("/api/notes", { rows: [] }),
      ]);

      const wrong = Array.isArray(wrongPayload.rows) ? wrongPayload.rows : [];
      const now = new Date();
      let open = 0;
      let resolved = 0;
      let due = 0;
      let invalid = 0;
      for (const r of wrong) {
        if (r.status === "resolved") resolved += 1;
        else {
          open += 1;
          if (isDue(r.nextReview, now)) due += 1;
        }
        if (!r.question) invalid += 1;
      }

      const metas = Array.isArray(metaPayload?.metas) ? metaPayload.metas : [];
      const rawCorrections = (metaPayload?.corrections ?? {}) as Record<string, { applied?: number; unmatched?: string[] }>;
      const corrections: NonNullable<Snapshot["corrections"]> = {};
      for (const [bankId, v] of Object.entries(rawCorrections)) {
        corrections[bankId] = { applied: v?.applied ?? 0, unmatched: Array.isArray(v?.unmatched) ? v.unmatched : [] };
      }
      if (!alive) return;
      setSnap({
        metas,
        corrections,
        answeredByChapter: Array.isArray(metaPayload?.answeredByChapter) ? metaPayload.answeredByChapter : [],
        wrongOpen: open,
        wrongResolved: resolved,
        due,
        wrongTotal: wrong.length,
        invalidWrong: invalid,
        favorites: len(favPayload?.rows),
        notes: (notePayload?.rows ?? []).filter((r) => (r.text ?? "").trim() !== "").length,
      });
      setLoadError(
        metas.some((m) => m.totals.questions > 0)
          ? null
          : "没有读到题库元数据（data/banks/<科目>/meta.json）：请先运行 python pipeline/build.py。",
      );
    })();
    return () => {
      alive = false;
    };
  }, [nonce]);

  const pickFile = async (file: File) => {
    setNotice(null);
    let parsed: BackupShape;
    try {
      parsed = JSON.parse(await file.text()) as BackupShape;
    } catch {
      setPending(null);
      setNotice({ tone: "bad", text: "JSON 解析失败：这个文件不是合法的备份。" });
      return;
    }
    if (!parsed || !Array.isArray(parsed.attempts)) {
      setPending(null);
      setNotice({ tone: "bad", text: "无法识别的备份结构：缺少 attempts 数组（请使用本页导出的文件）。" });
      return;
    }
    setPending({ name: file.name, size: file.size, backup: parsed });
  };

  const runImport = async () => {
    if (!pending) return;
    setImporting(true);
    try {
      const res = await fetch("/api/data", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(pending.backup),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; attempts?: number; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setNotice({
          tone: "bad",
          text: `导入失败：${data?.error ?? `HTTP ${res.status}`}。写入在一个事务里完成，失败已回滚，现有记录没有被改动。`,
        });
      } else {
        setNotice({ tone: "ok", text: `导入完成，已写入 ${len(pending.backup.attempts)} 条作答记录。` });
        setPending(null);
        reload();
      }
    } finally {
      setImporting(false);
    }
  };

  const runWipe = async () => {
    const res = await fetch("/api/data", { method: "DELETE" });
    if (res.ok) {
      setNotice({ tone: "ok", text: "已清空全部学习记录（作答流水、错题本、收藏、笔记）。题库与图片未受影响。" });
      setPhrase("");
      setPending(null);
      reload();
    } else {
      setNotice({ tone: "bad", text: `清空失败：HTTP ${res.status}。` });
    }
  };

  const bankTotal = snap ? snap.metas.reduce((s, m) => s + m.totals.questions, 0) : 0;
  const answeredTotal = snap ? snap.answeredByChapter.reduce((n, c) => n + c.answered, 0) : 0;
  const coverage = bankTotal ? (answeredTotal / bankTotal) * 100 : 0;
  const answeredByKey = new Map(
    (snap?.answeredByChapter ?? []).map((c) => [`${c.bankId}:${c.index}`, c.answered]),
  );
  const chapterCount = snap ? snap.metas.reduce((s, m) => s + m.chapters.length, 0) : 0;
  const withAnswer = snap ? snap.metas.reduce((s, m) => s + m.totals.withAnswer, 0) : 0;
  const builtAt = snap?.metas.map((m) => m.builtAt).sort().at(-1);
  const pagesOcr = snap ? snap.metas.reduce((s, m) => s + m.totals.pagesOcr, 0) : 0;
  const withFigure = snap ? snap.metas.reduce((s, m) => s + m.totals.withFigure, 0) : 0;
  const corrected = snap ? Object.values(snap.corrections ?? {}).reduce((s, c) => s + c.applied, 0) : 0;
  const drifted = snap ? Object.values(snap.corrections ?? {}).flatMap((c) => c.unmatched) : [];
  const canWipe = phrase.trim() === "清空";

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">数据</h1>
          <p className="mt-1 text-xs text-muted">
            学习记录保存在本地 SQLite（data/app.db），题库是构建产物（data/banks/&lt;科目&gt;/questions.json）；这里只做备份、恢复与清空。
          </p>
        </div>
        <div className="flex gap-2">
          <a href="/api/data" download={`quiz-progress-${isoToday()}.json`} className="btn btn-primary">
            导出备份
          </a>
          <button type="button" className="btn" onClick={reload}>
            重新统计
          </button>
        </div>
      </header>

      {loadError ? (
        <div
          className="rounded-lg border px-3 py-2.5 text-xs"
          style={{ borderColor: "var(--bad)", background: "var(--bad-soft)", color: "var(--bad)" }}
        >
          {loadError}
        </div>
      ) : null}
      {notice ? (
        <div
          className="rounded-lg border px-3 py-2.5 text-xs"
          style={{
            borderColor: notice.tone === "ok" ? "var(--ok)" : "var(--bad)",
            background: notice.tone === "ok" ? "var(--ok-soft)" : "var(--bad-soft)",
            color: notice.tone === "ok" ? "var(--ok)" : "var(--bad)",
          }}
        >
          {notice.text}
        </div>
      ) : null}

      {!snap ? <div className="card p-8 text-center text-xs text-muted">正在统计本地数据…</div> : null}

      {snap ? (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="题库题量" value={String(bankTotal)} sub={`${chapterCount} 个章节 · 含答案 ${withAnswer}`} />
            <Stat label="已作答题数" value={String(answeredTotal)} sub={`覆盖率 ${coverage.toFixed(1)}%`} tone="brand" />
            <Stat label="错题未消灭" value={String(snap.wrongOpen)} sub={`今日到期 ${snap.due} · 已消灭 ${snap.wrongResolved}`} tone={snap.due > 0 ? "bad" : undefined} />
            <Stat label="收藏 / 笔记" value={`${snap.favorites} / ${snap.notes}`} sub={snap.invalidWrong > 0 ? `错题本含 ${snap.invalidWrong} 题已失效` : "均为有效题号"} tone="ok" />
          </section>

          <section className="card p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className={sectionTitle}>章节作答分布</h2>
              <span className={chipMuted}>
                题库构建于 {builtAt ?? "未知"} · 扫描 {pagesOcr} 页 · 图形 {withFigure} 题
                {corrected > 0 ? ` · 人工校正 ${corrected} 题` : ""}
              </span>
            </div>
            {drifted.length > 0 ? (
              <p className="mb-2 rounded-lg border border-dashed px-3 py-2 text-xs leading-relaxed" style={{ borderColor: "var(--warn)", color: "var(--warn)" }}>
                {drifted.length} 条人工校正没能再匹配到题目（重建题库后页码或题号变了），它们暂时未生效，请核对{" "}
                <code className="font-mono">data/banks/&lt;科目&gt;/corrections.json</code>：
                <br />
                {drifted.map((d) => (
                  <span key={d} className="font-mono text-[11px]">{d}　</span>
                ))}
              </p>
            ) : null}
            {snap.metas.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted">没有读到题库元数据，请先执行 python pipeline/build.py。</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {snap.metas.flatMap((m) =>
                  m.chapters.map((ch) => {
                    const answered = answeredByKey.get(`${m.bankId}:${ch.index}`) ?? 0;
                    const pct = ch.count ? Math.min(100, (answered / ch.count) * 100) : 0;
                    return (
                      <li key={`${m.bankId}-${ch.index}`}>
                        <div className="flex items-baseline justify-between gap-3 text-xs">
                          <Link href={`/bank?bank=${m.bankId}&chapter=${ch.index}`} className="truncate hover:text-brand">
                            {m.subject} · 第{ch.index}章 {ch.title}
                          </Link>
                          <span className="shrink-0 tabular-nums text-muted">
                            已作答 {answered} / {ch.count} 题 · {pct.toFixed(1)}%
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
                          <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                        </div>
                      </li>
                    );
                  }),
                )}
              </ul>
            )}
          </section>
        </>
      ) : null}

      <section className="card p-4">
        <h2 className={sectionTitle}>备份与恢复</h2>
        <p className={clsx(subtle, "mt-1")}>
          备份是一份纯 JSON（attempts / sessions / wrongBook / favorites / notes / tags / questionTags），
          可以直接用编辑器打开比对，也可以拷到另一台机器导入。导出走 <code className={chipMuted}>GET /api/data</code>，
          下载文件名带日期。
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a href="/api/data" download={`quiz-progress-${isoToday()}.json`} className={btnSmPrimary}>
            导出当前进度
          </a>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void pickFile(file);
            }}
          />
          <button type="button" className={btnSm} onClick={() => fileRef.current?.click()}>
            选择备份文件
          </button>
        </div>

        {pending ? (
          <div
            className="mt-3 rounded-lg border p-3"
            style={{ borderColor: "var(--warn)", background: "var(--warn-soft)" }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-xs font-medium text-ink">{pending.name}</div>
                <div className="mt-0.5 text-[11px] tabular-nums text-muted">
                  {bytes(pending.size)} · 导出于 {pending.backup.exportedAt?.replace("T", " ").slice(0, 19) ?? "未知"}
                </div>
              </div>
              <div className="flex gap-1.5">
                <ConfirmButton
                  tone="danger"
                  label="确认导入（覆盖现有记录）"
                  confirmLabel="确认覆盖导入"
                  disabled={importing}
                  onConfirm={runImport}
                  title="导入会先清空现有作答、错题本、收藏与笔记"
                />
                <button type="button" className={btnSm} onClick={() => setPending(null)} disabled={importing}>
                  放弃
                </button>
              </div>
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] tabular-nums text-muted">
              <li>作答 {len(pending.backup.attempts)} 条</li>
              <li>练习场次 {len(pending.backup.sessions)} 场</li>
              <li>错题 {len(pending.backup.wrongBook)} 题</li>
              <li>收藏 {len(pending.backup.favorites)} 题</li>
              <li>笔记 {len(pending.backup.notes)} 条</li>
              <li>标签 {len(pending.backup.tags)} 个 / 关联 {len(pending.backup.questionTags)} 条</li>
            </ul>
          </div>
        ) : null}

        <p className={clsx(subtle, "mt-2")}>
          导入在一个事务里完成：先清空 attempts / sessions / wrong_book / favorites / notes / tags，再按备份逐表写入。
          中途出错会整体回滚，不会留下半份数据；但成功后旧记录就被覆盖了，所以建议先导出一份当前进度再导入。
        </p>
      </section>

      <section className="card p-4" style={{ borderColor: "var(--bad)" }}>
        <h2 className={sectionTitle} style={{ color: "var(--bad)" }}>
          危险操作
        </h2>
        <p className={clsx(subtle, "mt-1")}>
          清空会删除全部学习记录：作答流水、练习场次、错题本、收藏、笔记与标签，且无法撤销。
          题库 data/banks/&lt;科目&gt;/questions.json 与 public/assets 下的裁剪图片不受影响。
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-muted">
            输入 清空
            <input
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder="清空"
              className="w-[86px] rounded-lg border border-line bg-panel px-2 py-1 text-xs tabular-nums text-ink outline-none focus:border-brand"
            />
          </label>
          <ConfirmButton
            tone="danger"
            label="清空所有学习记录"
            confirmLabel="确认清空"
            disabled={!canWipe}
            onConfirm={runWipe}
            title={canWipe ? "执行 DELETE /api/data，清空全部学习记录" : "需先在左侧输入「清空」二字"}
          />
          {!canWipe ? <span className="text-[11px] text-muted">需先输入「清空」二字才能执行</span> : null}
        </div>
      </section>

      <section className="card p-4">
        <h2 className={sectionTitle}>这些数据存在哪里</h2>
        <p className={clsx(subtle, "mt-1.5")}>
          你产生的一切都在项目根目录 <code className={chipMuted}>data/app.db</code>（SQLite，better-sqlite3 直连，WAL 模式，
          表为 attempts / sessions / wrong_book / favorites / notes / tags / question_tags / settings；
          设 <code className={chipMuted}>QUIZ_DB_PATH</code> 可换到别的路径）。
          备份文件也是这张库的内容，用文本编辑器即可比对。
        </p>
        <p className={clsx(subtle, "mt-1.5")}>
          题库不是数据库内容，而是构建产物：运行 <code className={chipMuted}>python pipeline/build.py</code>
          （OCR → parse_bank.py → crop_images.py）会重写 <code className={chipMuted}>data/banks/&lt;科目&gt;/questions.json</code> 与{" "}
          <code className={chipMuted}>public/assets/figures</code>、<code className={chipMuted}>crops</code>。
          重建后题号可能变化，错题本与收藏里的旧题号会显示「已失效」，作答记录仍在库里，可继续移出错题本或改备注。
        </p>
        <p className={clsx(subtle, "mt-1.5")}>
          想单独看进度指标去 <Link href="/stats" className="text-brand">统计分析</Link>；
          想核对 OCR 质量去 <Link href="/bank" className="text-brand">题库</Link> 按标记筛选，并对照{" "}
          <Link href="/book" className="text-brand">原书页面</Link>；
          收藏与笔记的列表在 <Link href="/favorites" className="text-brand">收藏</Link> 与{" "}
          <Link href="/notes" className="text-brand">笔记</Link>。
        </p>
      </section>
    </div>
  );
}
