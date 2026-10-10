"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { BankMeta, Question } from "@/lib/types";
import {
  computeStats,
  fmtMs,
  materialGroupAt,
  materialIdsInQueue,
  normalizeMode,
  usePractice,
  type GradeResult,
  type SessionConfig,
} from "@/lib/practice-store";
import {
  closeSession,
  createSession,
  fetchByIds,
  fetchDetail,
  fetchMetas,
  fetchMixedQueue,
  fetchQueue,
  markWrongResolved,
  postAnswer,
  toggleFavorite,
} from "./api";
import AnswerSheet from "./answer-sheet";
import ExamResult from "./exam-result";
import MaterialPanel from "./MaterialPanel";
import NotePad from "./note-pad";
import ProgressBar from "./progress-bar";
import QuestionView from "./question-view";
import SetupPanel, {
  DEFAULT_SETUP,
  MODE_NAME,
  setupScope,
  type SetupValue,
} from "./setup-panel";
import Timer from "./timer";
import { useMaterials } from "./use-materials";

const MAX_FETCH_LIMIT = 2000;

/** .btn 固定了字号/内边距，紧凑按钮直接用原子类，避免与 utilities 冲突。 */
const MINI_BTN = "rounded-lg border border-line bg-panel px-2.5 py-1 text-xs transition-colors hover:border-brand";

function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function setupFromParams(sp: URLSearchParams): SetupValue {
  const count = (sp.get("count") ?? "").trim();
  return {
    mode: normalizeMode(sp.get("mode")),
    bank: sp.get("bank") || DEFAULT_SETUP.bank,
    chapter: sp.get("chapter") ?? "",
    section: sp.get("section") ?? "",
    point: sp.get("point") ?? "",
    kind: sp.get("kind") ?? "",
    q: sp.get("q") ?? "",
    count: count === "all" || /^\d+$/.test(count) ? count : DEFAULT_SETUP.count,
    seconds: Number(sp.get("seconds")) > 0 ? Number(sp.get("seconds")) : DEFAULT_SETUP.seconds,
    shuffle: sp.get("shuffle") !== "0",
    onlyUnanswered: sp.get("unanswered") === "1",
    mixed: sp.get("mixed") === "1",
  };
}

export default function Runner() {
  const sp = useSearchParams();
  const router = useRouter();
  const store = usePractice();
  const [setup, setSetup] = useState<SetupValue>(() => setupFromParams(new URLSearchParams(sp.toString())));
  const [metas, setMetas] = useState<BankMeta[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingQid, setPendingQid] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(true);
  const [confirmExit, setConfirmExit] = useState(false);
  const booted = useRef(false);

  const currentId = store.queue[store.index];
  const current = currentId ? store.questions[currentId] : undefined;
  const isExam = store.mode === "exam";
  const stats = useMemo(() => computeStats(store), [store]);
  const meta = useMemo(
    () => metas.find((m) => m.bankId === setup.bank) ?? metas[0] ?? null,
    [metas, setup.bank],
  );

  /* ---------------------------------------------------------------- */
  /* 资料（资料分析）：当前题所属的资料、同组定位与按需加载               */
  /* ---------------------------------------------------------------- */
  const materialGroup = useMemo(
    () => materialGroupAt(store.queue, store.questions, store.index),
    [store.queue, store.questions, store.index],
  );
  const currentMaterialId = current?.materialId ?? null;
  const material = currentMaterialId ? (store.materials[currentMaterialId] ?? null) : null;
  const materialPending = !!currentMaterialId && !material && !!store.materialRequested[currentMaterialId];

  const materialIds = useMemo(() => {
    const all = materialIdsInQueue(store.queue, store.questions);
    if (!all.length) return [];
    // 整场练习的资料组不多时一次载入，答题卡就能给每一组标出资料标题。
    if (all.length <= 12) return all;
    const nearby: string[] = [];
    for (let i = store.index; i < Math.min(store.index + 2, store.queue.length); i += 1) {
      const mid = store.questions[store.queue[i]]?.materialId;
      if (mid && !nearby.includes(mid)) nearby.push(mid);
    }
    return nearby;
  }, [store.queue, store.questions, store.index]);

  useMaterials(materialIds);

  /* ---------------------------------------------------------------- */
  /* taxonomy for the setup panel                                      */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    let alive = true;
    fetchMetas().then((ms) => {
      if (alive) setMetas(ms);
    });
    return () => {
      alive = false;
    };
  }, []);

  /* ---------------------------------------------------------------- */
  /* start / stop                                                     */
  /* ---------------------------------------------------------------- */
  const writeUrl = useCallback(
    (v: SetupValue, ids?: string[]) => {
      const p = new URLSearchParams();
      p.set("mode", v.mode);
      if (v.bank) p.set("bank", v.bank);
      if (v.chapter) p.set("chapter", v.chapter);
      if (v.section) p.set("section", v.section);
      if (v.point) p.set("point", v.point);
      if (v.kind) p.set("kind", v.kind);
      if (v.q) p.set("q", v.q);
      p.set("count", v.count);
      p.set("seconds", String(v.seconds));
      p.set("shuffle", v.shuffle ? "1" : "0");
      if (v.onlyUnanswered) p.set("unanswered", "1");
      if (v.mixed) p.set("mixed", "1");
      if (ids?.length && ids.length <= 60) p.set("ids", ids.join(","));
      router.replace(`/practice?${p.toString()}`, { scroll: false });
    },
    [router],
  );

  const run = useCallback(
    async (v: SetupValue, ids?: string[]) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      setShowResult(true);
      try {
        let items: Question[];
        let total: number;
        if (ids && ids.length) {
          items = await fetchByIds(ids);
          total = items.length;
        } else {
          const status =
            v.mode === "wrong"
              ? "wrong"
              : v.mode === "favorite"
                ? "favorite"
                : v.mode === "smart"
                  ? "smart"
                  : v.onlyUnanswered
                    ? "unanswered"
                    : null;
          const limit = v.count === "all" ? MAX_FETCH_LIMIT : Math.max(1, Number(v.count) || 20);
          const res = v.mixed && !v.bank
            ? await fetchMixedQueue({
                chapter: v.chapter || null,
                section: v.section || null,
                point: v.point || null,
                kind: v.kind || null,
                q: v.q || null,
                status,
                limit,
              })
            : await fetchQueue({
            bank: v.bank || null,
            chapter: v.chapter || null,
            section: v.section || null,
            point: v.point || null,
            kind: v.kind || null,
            q: v.q || null,
            status,
            limit,
            offset: 0,
          });
          items = res.items;
          total = res.total;
        }

        if (!items.length) {
          setNotice(emptyCopy(v));
          setBusy(false);
          return;
        }

        const fromIds = !!ids?.length;
        const config: SessionConfig = {
          mode: v.mode,
          title: `${MODE_NAME[v.mode]} · ${setupScope(v)}`,
          scope: setupScope(v),
          shuffle: fromIds ? false : v.shuffle,
          secondsPerQuestion: v.seconds,
          totalSeconds: v.mode === "exam" ? items.length * v.seconds : 0,
        };
        store.begin({ items, total, config });
        writeUrl(v, fromIds ? ids : undefined);

        if (v.mode !== "recite") {
          try {
            const res = await createSession(config.title, v.mode, config.scope);
            store.setSessionId(res.id);
          } catch {
            setNotice("会话创建失败，本次作答仍会记录，但不计入单次练习统计。");
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "载入题目失败");
      } finally {
        setBusy(false);
      }
    },
    [store, writeUrl],
  );

  /**
   * 外部「重做」链接带 ids 时直接开局；?auto=1 同样跳过设置面板。
   * run() 内部会同步写 busy/error 等本地状态，故推迟一个宏任务调用，
   * 避免在 effect 里级联渲染；runRef 保证用的是最新闭包。
   */
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  }, [run]);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const params = new URLSearchParams(sp.toString());
    const ids = parseIds(params.get("ids"));
    const initial = setupFromParams(params);
    if (!ids.length && params.get("auto") !== "1") return;
    window.setTimeout(() => void runRef.current(initial, ids.length ? ids : undefined), 0);
  }, [sp]);

  /** 页面关闭时收尾会话。 */
  useEffect(() => {
    if (!store.active) return;
    const id = store.sessionId;
    const handler = () => {
      if (id) void closeSession(id).catch(() => undefined);
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [store.active, store.sessionId]);

  /* ---------------------------------------------------------------- */
  /* 当前题详情（收藏 / 笔记 / 历史作答）                                */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    if (!currentId) return;
    const token = currentId;
    let alive = true;
    fetchDetail(token)
      .then((d) => {
        if (!alive) return;
        store.setDetail(token, {
          favorite: d.favorite,
          note: d.note,
          attempts: d.attempts,
          wrong: d.wrong
            ? { wrongCount: d.wrong.wrong_count, box: d.wrong.box, status: d.wrong.status }
            : null,
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  /* ---------------------------------------------------------------- */
  /* 作答                                                             */
  /* ---------------------------------------------------------------- */
  const grading = useRef<Set<string>>(new Set());

  const gradeCurrent = useCallback(
    async (q: Question, label: string) => {
      if (grading.current.has(q.id)) return;
      store.choose(q.id, label);
      const ms = store.flushElapsed();
      if (!q.answer) {
        const placeholder: GradeResult = {
          correct: false,
          answer: null,
          analysis: q.analysis,
          wrongCount: store.wrongInfo[q.id]?.wrongCount ?? 0,
          box: store.wrongInfo[q.id]?.box ?? 0,
        };
        store.setGrade(q.id, placeholder, true);
        setNotice(`本题题库缺答案（已用时 ${fmtMs(ms)}），不判分、不写入答题记录。`);
        return;
      }
      grading.current.add(q.id);
      setPendingQid(q.id);
      try {
        const res = await postAnswer({
          questionId: q.id,
          answer: label,
          durationMs: ms,
          mode: store.mode,
          sessionId: store.sessionId,
        });
        store.setGrade(q.id, res, false);
        setNotice(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "提交答案失败");
        store.resumeElapsed();
      } finally {
        grading.current.delete(q.id);
        setPendingQid(null);
      }
    },
    [store],
  );

  const pick = useCallback(
    (label: string) => {
      if (!current) return;
      if (store.mode === "recite") {
        store.choose(current.id, label);
        return;
      }
      if (isExam) {
        if (!store.submitted) store.choose(current.id, label);
        return;
      }
      if (store.graded[current.id] || pendingQid) return;
      void gradeCurrent(current, label);
    },
    [current, gradeCurrent, isExam, pendingQid, store],
  );

  const submitting = useRef(false);

  const submitExam = useCallback(async () => {
    // 读最新 state：flushElapsed 刚写过 elapsed/index，渲染闭包里的是旧快照
    const st = usePractice.getState();
    if (!st.config || st.config.mode !== "exam" || st.submitted || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    st.flushElapsed();
    const fresh = usePractice.getState();
    const answered = fresh.queue.filter((id) => fresh.chosen[id]);
    const BATCH = 4;
    try {
      for (let i = 0; i < answered.length; i += BATCH) {
        const batch = answered.slice(i, i + BATCH);
        const results = await Promise.allSettled(
          batch.map(async (id) => {
            const q = fresh.questions[id];
            if (!q?.answer) return { id, result: null as GradeResult | null };
            const res = await postAnswer({
              questionId: id,
              answer: fresh.chosen[id] ?? null,
              durationMs: fresh.elapsed[id] ?? 0,
              mode: fresh.mode,
              sessionId: fresh.sessionId,
            });
            return { id, result: res as GradeResult | null };
          }),
        );
        for (const r of results) {
          if (r.status !== "fulfilled") continue;
          const { id, result } = r.value;
          if (result) {
            fresh.setGrade(id, result, false);
          } else {
            const q = fresh.questions[id];
            fresh.setGrade(
              id,
              { correct: false, answer: null, analysis: q?.analysis ?? null, wrongCount: 0, box: 0 },
              true,
            );
          }
        }
      }
      if (fresh.sessionId) {
        try {
          await closeSession(fresh.sessionId);
        } catch {
          /* 交卷统计已入库，收尾失败不阻塞 */
        }
      }
      fresh.markSubmitted();
      setShowResult(true);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }, []);

  const exitSession = useCallback(async () => {
    if (store.sessionId) {
      try {
        await closeSession(store.sessionId);
      } catch {
        /* ignore */
      }
    }
    store.reset();
    setShowResult(true);
    setConfirmExit(false);
    setNotice(null);
    setError(null);
  }, [store]);

  const toggleFav = useCallback(async () => {
    if (!currentId) return;
    try {
      const res = await toggleFavorite(currentId);
      store.setFavorite(currentId, res.favorite);
    } catch (e) {
      setError(e instanceof Error ? e.message : "收藏失败");
    }
  }, [currentId, store]);

  /* ---------------------------------------------------------------- */
  /* 键盘快捷键                                                        */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    if (!store.active) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "TEXTAREA" ||
          target.tagName === "INPUT" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (typing) {
        if (e.key === "Escape") target?.blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const letters = ["a", "b", "c", "d", "e", "f", "g", "h"];
      const letter = letters.includes(k) && current?.options.some((o) => o.label === k.toUpperCase())
        ? k.toUpperCase()
        : null;
      const digit = /^[1-8]$/.test(e.key) && current?.options.some((o) => o.label === "ABCDEFGH"[Number(e.key) - 1])
        ? "ABCDEFGH"[Number(e.key) - 1]
        : null;
      const choice = letter ?? digit;
      if (choice) {
        e.preventDefault();
        pick(choice);
        return;
      }
      if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        if (isExam && store.submitted) setShowResult(false);
        store.next();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        store.prev();
        return;
      }
      if (k === "f") {
        e.preventDefault();
        void toggleFav();
        return;
      }
      if (k === "n") {
        e.preventDefault();
        document.getElementById("practice-note-input")?.focus();
        return;
      }
      if (k === "t" && currentId) {
        e.preventDefault();
        store.toggleCrop(currentId);
        return;
      }
      if (k === "s" && isExam && !store.submitted) {
        e.preventDefault();
        void submitExam();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, currentId, isExam, pick, store, submitExam, toggleFav]);

  /* 考试倒计时归零自动交卷 */
  useEffect(() => {
    if (!store.active || !isExam || store.submitted || store.deadline === null) return;
    const id = window.setInterval(() => {
      if (store.deadline !== null && Date.now() >= store.deadline) {
        window.clearInterval(id);
        setNotice("考试时间已到，已自动交卷。");
        void submitExam();
      }
    }, 500);
    return () => window.clearInterval(id);
  }, [isExam, store.active, store.deadline, store.submitted, submitExam]);

  /* ---------------------------------------------------------------- */
  /* render                                                           */
  /* ---------------------------------------------------------------- */
  if (!store.active) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeading meta={meta} />
        <SetupPanel
          value={setup}
          meta={meta}
          busy={busy}
          error={error}
          onChange={(patch) => {
            setSetup((prev) => ({ ...prev, ...patch }));
            setError(null);
            setNotice(null);
          }}
          onRun={() => void run(setup)}
        />
        {notice && <Notice text={notice} onDismiss={() => setNotice(null)} />}
        <Tips />
      </div>
    );
  }

  const revealed = !!store.revealed[currentId];
  const history = currentId ? store.history[currentId] ?? [] : [];
  const wrongInfo = currentId ? store.wrongInfo[currentId] : undefined;

  return (
    <div className="flex flex-col gap-4">
      {/* 会话头 */}
      <header className="card flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-sm font-semibold">{MODE_NAME[store.mode]}</h1>
            <span className="chip truncate">{store.config?.scope ?? "全库"}</span>
            <span className="chip tabular-nums">共 {stats.total} 题</span>
            {store.total > stats.total && (
              <span className="chip tabular-nums">范围命中 {store.total} 题</span>
            )}
            {store.sessionId && <span className="chip tabular-nums">会话 #{store.sessionId}</span>}
            {store.mode === "recite" && <span className="chip">不记成绩</span>}
          </div>
          <p className="mt-1 truncate text-[11px] text-muted">{store.config?.title}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Timer />
          {isExam && !store.submitted && (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submitExam()}>
              交卷
            </button>
          )}
          {isExam && store.submitted && (
            <button type="button" className="btn" onClick={() => setShowResult((v) => !v)}>
              {showResult ? "逐题回顾" : "返回成绩"}
            </button>
          )}
          {confirmExit ? (
            <span className="flex items-center gap-1.5 text-xs">
              <span className="text-muted">
                {isExam && !store.submitted ? "未交卷，确定结束？" : "确定结束本次练习？"}
              </span>
              <button
                type="button"
                className={MINI_BTN}
                onClick={() => void exitSession()}
              >
                结束
              </button>
              <button type="button" className={MINI_BTN} onClick={() => setConfirmExit(false)}>
                继续
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (isExam && !store.submitted) setConfirmExit(true);
                else void exitSession();
              }}
            >
              结束练习
            </button>
          )}
        </div>
      </header>

      {error && <Notice text={error} tone="bad" onDismiss={() => setError(null)} />}
      {notice && <Notice text={notice} onDismiss={() => setNotice(null)} />}

      {isExam && store.submitted && showResult ? (
        <ExamResult
          onReview={() => setShowResult(false)}
          onRestart={() => void exitSession()}
          onRetry={(ids) => void run(setup, ids)}
        />
      ) : null}

      <ProgressBar />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-3">
          {current ? (
            <>
              {/* 资料在前、小题在后：同组小题共用这一张卡，sticky 让数据一直看得见 */}
              {material && (
                <MaterialPanel material={material} group={materialGroup} sticky />
              )}
              <QuestionView
                question={current}
                position={store.index + 1}
                total={stats.total}
                mode={store.mode}
                materialNote={
                  current.materialId && !material
                    ? materialPending
                      ? "资料载入中…"
                      : `资料 ${current.materialId} 已不在题库中（重建后请重新开始本次练习）`
                    : null
                }
                chosen={store.chosen[current.id] ?? null}
                graded={store.graded[current.id] ?? null}
                ungraded={!!store.ungraded[current.id]}
                revealed={revealed}
                cropOpen={!!store.cropOpen[current.id]}
                elapsedMs={store.elapsed[current.id] ?? 0}
                locked={
                  (isExam && store.submitted) ||
                  (!isExam &&
                    store.mode !== "recite" &&
                    (!!store.graded[current.id] || pendingQid === current.id))
                }
                pending={pendingQid === current.id}
                wrongInfo={wrongInfo}
                favorite={!!store.favorites[current.id]}
                onSelect={pick}
                onToggleReveal={() => store.toggleRevealed(current.id)}
                onToggleCrop={() => store.toggleCrop(current.id)}
                onToggleFavorite={() => void toggleFav()}
              />

              {/* 导航 */}
              <nav className="card flex flex-wrap items-center justify-between gap-2 p-3">
                <button
                  type="button"
                  className="btn"
                  onClick={() => store.prev()}
                  disabled={store.index === 0}
                >
                  ← 上一题
                </button>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  {history.length > 0 && (
                    <span className="tabular-nums">
                      历史 {history
                        .slice(0, 4)
                        .map((h) => `${h.answer ?? "—"}${h.correct ? "✓" : "✗"}`)
                        .join(" ")}
                    </span>
                  )}
                  {wrongInfo?.status === "open" && (
                    <button
                      type="button"
                      className={MINI_BTN}
                      onClick={() => {
                        void markWrongResolved(current.id).then(() =>
                          store.setDetail(current.id, {
                            wrong: { ...wrongInfo, status: "resolved" },
                          }),
                        );
                      }}
                    >
                      标记已掌握
                    </button>
                  )}
                </div>
                {isExam && !store.submitted && store.index >= store.queue.length - 1 ? (
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submitExam()}>
                    完成最后一题 · 交卷
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      if (isExam && store.submitted) setShowResult(false);
                      store.next();
                    }}
                    disabled={store.index >= store.queue.length - 1}
                  >
                    {store.index >= store.queue.length - 1 ? "已是最后一题" : "下一题 →"}
                  </button>
                )}
              </nav>
            </>
          ) : (
            <div className="card p-8 text-center">
              <h2 className="text-base font-semibold">题目队列为空</h2>
              <p className="mt-2 text-sm text-muted">
                本次抽题没有可练习的题目，请调整范围后重新开始。
              </p>
              <button type="button" className="btn btn-primary mt-4" onClick={() => void exitSession()}>
                回到设置
              </button>
            </div>
          )}
        </div>

        <aside className="flex flex-col gap-3">
          <AnswerSheet />
          {currentId && <NotePad key={currentId} questionId={currentId} />}
          <ShortcutCard exam={isExam && !store.submitted} />
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* helpers / small blocks                                             */
/* ------------------------------------------------------------------ */

function emptyCopy(v: SetupValue): string {
  if (v.mode === "wrong") {
    return "错题本里当前没有可练的题目（可能都已标记掌握）。先去刷一组题，或到错题本查看已掌握的记录。";
  }
  if (v.mode === "favorite") {
    return "还没有收藏任何题目。刷题时按 F 或点击「☆ 收藏」即可加入收藏。";
  }
  if (v.onlyUnanswered) {
    return "该范围内没有未作答的题目，取消「只做未作答过的题」即可全部重练。";
  }
  if (v.mode === "smart") {
    return "智能练习没有找到候选题目，通常是题库尚未构建完成。";
  }
  return "没有符合条件的题目：换个章节/考点范围，或清空关键词后再试。";
}

function PageHeading({ meta }: { meta: BankMeta | null }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">刷题</h1>
        <p className="mt-1 text-xs text-muted">
          {meta ? `共 ${meta.totals.questions} 题 · ${meta.chapters.length} 章` : "题库载入中…"}
          {" · 背题模式不记成绩，考试模式交卷后统一判分"}
        </p>
      </div>
      <div className="flex gap-2 text-xs">
        <Link href="/bank" className="btn">
          题库浏览
        </Link>
        <Link href="/wrong" className="btn">
          错题本
        </Link>
      </div>
    </header>
  );
}

function Notice({
  text,
  tone = "info",
  onDismiss,
}: {
  text: string;
  tone?: "info" | "bad";
  onDismiss?: () => void;
}) {
  return (
    <div
      className="flex items-start justify-between gap-3 rounded-xl border p-3 text-xs"
      style={{
        borderColor: tone === "bad" ? "var(--bad)" : "var(--line)",
        color: tone === "bad" ? "var(--bad)" : "var(--ink)",
      }}
    >
      <span className="leading-relaxed">{text}</span>
      {onDismiss && (
        <button type="button" className="shrink-0 text-muted hover:text-brand" onClick={onDismiss}>
          知道了
        </button>
      )}
    </div>
  );
}

function ShortcutCard({ exam }: { exam: boolean }) {
  const rows: [string, string][] = [
    ["A–H / 1–8", "选择选项（有对应选项时优先）"],
    ["Enter 或 →", "下一题"],
    ["←", "上一题"],
    ["F", "收藏本题（本题有 F 选项时则选 F）"],
    ["N", "跳到笔记输入框"],
    ["T", "对照原书裁剪图"],
  ];
  if (exam) rows.push(["S", "交卷"]);
  return (
    <div className="card p-3">
      <h3 className="mb-2 text-sm font-medium">快捷键</h3>
      <ul className="flex flex-col gap-1.5 text-[11px] text-muted">
        {rows.map(([k, v]) => (
          <li key={k} className="flex items-center justify-between gap-2">
            <kbd className="rounded border border-line bg-bg px-1.5 py-0.5 font-mono text-[10px] text-ink">
              {k}
            </kbd>
            <span>{v}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Tips() {
  const items: [string, string][] = [
    ["即时模式", "答完即判，同时给出正确答案、解析与粉笔大数据正确率，适合单点突破。"],
    ["背题模式", "答案与解析直接可见，只翻页不记录成绩。"],
    ["考试模式", "全程不判分，答题卡可来回改答案，交卷后统一出分并全部入库。"],
    ["错题重练 / 收藏练习", "分别只抽错题本中未掌握的题与收藏过的题。"],
    ["智能练习", "未做过、反复出错、正确率偏低的题目优先出现。"],
  ];
  return (
    <section className="card p-4">
      <h2 className="mb-2 text-sm font-medium">模式说明</h2>
      <ul className="grid gap-2 text-xs leading-relaxed text-muted sm:grid-cols-2">
        {items.map(([name, text]) => (
          <li key={name} className="flex items-start gap-2">
            <span className="chip shrink-0">{name}</span>
            <span className="min-w-0">{text}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 border-t border-line pt-2 text-[11px] leading-relaxed text-muted">
        图形推理题的四个选项在原书里是一整张图：题干下方的裁图已包含题干图、选项图与 A/B/C/D
        标注，因此选项按钮只有字母，按字母作答即可。遇到「数据质量」标记时建议点开「对照原书」核对扫描原件。
      </p>
    </section>
  );
}
