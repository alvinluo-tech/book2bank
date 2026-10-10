import { create } from "zustand";
import type { Material, PracticeMode, Question } from "./types";

/**
 * Session state for the practice runner.
 *
 * The store is deliberately free of fetch calls: the runner orchestrates the
 * API and pushes results in here, so every transition stays replayable and the
 * per-question timer survives navigation.
 */

/** `favorite` is a UI scope that still records attempts like `instant` does. */
export type RunnerMode = PracticeMode | "favorite";

export const RUNNER_MODES: RunnerMode[] = [
  "instant",
  "recite",
  "exam",
  "wrong",
  "smart",
  "favorite",
  "random",
];

export function normalizeMode(raw: string | null | undefined): RunnerMode {
  const m = (raw ?? "").trim().toLowerCase();
  return (RUNNER_MODES as string[]).includes(m) ? (m as RunnerMode) : "instant";
}

/** Graded modes record an attempt; 背题模式 only navigates. */
export function isGraded(mode: RunnerMode): boolean {
  return mode !== "recite";
}

export interface GradeResult {
  correct: boolean;
  answer: string | null;
  analysis: string | null;
  wrongCount: number;
  box: number;
}

export interface HistoryEntry {
  answer: string | null;
  correct: boolean;
  createdAt: string;
  mode: string;
}

export interface WrongInfo {
  wrongCount: number;
  box: number;
  status: string;
}

export interface SessionConfig {
  mode: RunnerMode;
  /** Human readable label shown in the header and written to sessions.title. */
  title: string;
  /** Scope description persisted on the session row, e.g. 第1章 · 数量规律. */
  scope: string | null;
  shuffle: boolean;
  secondsPerQuestion: number;
  /** Exam budget in seconds for the whole paper (queue.length * perQuestion). */
  totalSeconds: number;
}

export interface PracticeState {
  /* --- lifecycle --- */
  active: boolean;
  loading: boolean;
  error: string | null;

  /* --- queue --- */
  queue: string[];
  questions: Record<string, Question>;
  /** Total bank size matching the current filter (before the limit slice). */
  total: number;
  index: number;

  /* --- session --- */
  mode: RunnerMode;
  config: SessionConfig | null;
  sessionId: number | null;
  startedAt: number | null;
  /** 交卷时刻（仅考试模式），用于成绩页展示整卷耗时。 */
  finishedAt: number | null;
  /** Wall-clock deadline (ms epoch) for 考试模式, null in other modes. */
  deadline: number | null;
  submitted: boolean;

  /* --- per question progress --- */
  chosen: Record<string, string | null>;
  graded: Record<string, GradeResult | null>;
  /** true when the item has no OCR'd answer, so grading is meaningless. */
  ungraded: Record<string, boolean>;
  elapsed: Record<string, number>;
  revealed: Record<string, boolean>;
  cropOpen: Record<string, boolean>;
  /** ms epoch when the current question became visible (null = paused). */
  tickStart: number | null;

  /* --- user state mirrors --- */
  favorites: Record<string, boolean>;
  notes: Record<string, string>;
  history: Record<string, HistoryEntry[]>;
  wrongInfo: Record<string, WrongInfo>;

  /* --- 资料（仅资料分析；其它模块永远为空） --- */
  /**
   * 已取回的资料，按 materialId 索引。`null` 表示服务端确认该 id 已不存在
   * （重建题库后的旧 id），面板据此什么都不渲染，而不是反复请求。
   */
  materials: Record<string, Material | null>;
  /** 已经发起过加载的资料 id，避免同一次会话里重复往返。 */
  materialRequested: Record<string, true>;

  /* --- actions --- */
  begin: (payload: {
    items: Question[];
    total: number;
    config: SessionConfig;
  }) => void;
  openIndex: (i: number) => void;
  next: () => void;
  prev: () => void;
  /** Commit running time into `elapsed` for the current item; returns the total ms. */
  flushElapsed: () => number;
  resumeElapsed: () => void;
  choose: (questionId: string, label: string | null) => void;
  setGrade: (questionId: string, result: GradeResult, ungraded?: boolean) => void;
  setRevealed: (questionId: string, value: boolean) => void;
  toggleRevealed: (questionId: string) => void;
  toggleCrop: (questionId: string) => void;
  setFavorite: (questionId: string, value: boolean) => void;
  setNote: (questionId: string, value: string) => void;
  setDetail: (
    questionId: string,
    detail: {
      favorite?: boolean;
      note?: string | null;
      attempts?: HistoryEntry[];
      wrong?: WrongInfo | null;
    },
  ) => void;
  setSessionId: (id: number | null) => void;
  markSubmitted: () => void;
  setLoading: (v: boolean, error?: string | null) => void;
  /**
   * 认领一批待加载的资料 id，返回其中「此前没发起过」的部分；调用方只需加载返回值。
   * 认领即写入 materialRequested，StrictMode 的二次 effect 也就不会重复请求。
   */
  requestMaterials: (ids: string[]) => string[];
  /** 落库取回的资料；missingIds 是服务端确认已不存在的旧 id。 */
  setMaterials: (list: Material[], missingIds?: string[]) => void;
  /** 网络/服务端异常时撤销认领，允许后续翻页重试。 */
  releaseMaterials: (ids: string[]) => void;
  reset: () => void;
}

const emptyMaps = {
  chosen: {},
  graded: {},
  ungraded: {},
  elapsed: {},
  revealed: {},
  cropOpen: {},
} as const;

export const usePractice = create<PracticeState>((set, get) => ({
  active: false,
  loading: false,
  error: null,

  queue: [],
  questions: {},
  total: 0,
  index: 0,

  mode: "instant",
  config: null,
  sessionId: null,
  startedAt: null,
  finishedAt: null,
  deadline: null,
  submitted: false,

  ...emptyMaps,
  tickStart: null,

  favorites: {},
  notes: {},
  history: {},
  wrongInfo: {},

  materials: {},
  materialRequested: {},

  begin: ({ items, total, config }) => {
    const shuffled = config.shuffle ? shuffle(items.map((q) => q.id)) : items.map((q) => q.id);
    // 资料分析：一段资料带一组小题，打乱后必须把同组小题重新贴在一起。
    const queue = groupQueueIds(items, shuffled);
    const questions: Record<string, Question> = {};
    for (const q of items) questions[q.id] = q;
    const revealed: Record<string, boolean> = {};
    if (config.mode === "recite") for (const id of queue) revealed[id] = true;
    set({
      active: true,
      loading: false,
      error: null,
      queue,
      questions,
      total,
      index: 0,
      mode: config.mode,
      config,
      sessionId: null,
      startedAt: Date.now(),
      finishedAt: null,
      deadline:
        config.mode === "exam" && config.totalSeconds > 0
          ? Date.now() + config.totalSeconds * 1000
          : null,
      submitted: false,
      tickStart: queue.length ? Date.now() : null,
      ...emptyMaps,
      revealed,
      materials: {},
      materialRequested: {},
    });
  },

  openIndex: (i) => {
    const s = get();
    if (!s.queue.length) return;
    const target = Math.max(0, Math.min(i, s.queue.length - 1));
    if (target === s.index && s.tickStart !== null) return;
    const elapsed = { ...s.elapsed };
    const prevId = s.queue[s.index];
    if (prevId && s.tickStart !== null) {
      elapsed[prevId] = (elapsed[prevId] ?? 0) + Math.max(0, Date.now() - s.tickStart);
    }
    set({ index: target, elapsed, tickStart: Date.now() });
  },

  next: () => get().openIndex(get().index + 1),
  prev: () => get().openIndex(get().index - 1),

  flushElapsed: () => {
    const s = get();
    const qid = s.queue[s.index];
    if (!qid) return 0;
    if (s.tickStart === null) return s.elapsed[qid] ?? 0;
    const total = (s.elapsed[qid] ?? 0) + Math.max(0, Date.now() - s.tickStart);
    set({ elapsed: { ...s.elapsed, [qid]: total }, tickStart: null });
    return total;
  },

  resumeElapsed: () => {
    const s = get();
    if (s.tickStart === null && s.queue[s.index]) set({ tickStart: Date.now() });
  },

  choose: (questionId, label) =>
    set((s) => ({ chosen: { ...s.chosen, [questionId]: label } })),

  setGrade: (questionId, result, ungraded) =>
    set((s) => ({
      graded: { ...s.graded, [questionId]: result },
      ungraded: { ...s.ungraded, [questionId]: !!ungraded },
      revealed: { ...s.revealed, [questionId]: true },
      wrongInfo: result.wrongCount
        ? {
            ...s.wrongInfo,
            [questionId]: {
              wrongCount: result.wrongCount,
              box: result.box,
              status: result.correct ? "open" : s.wrongInfo[questionId]?.status ?? "open",
            },
          }
        : s.wrongInfo,
    })),

  setRevealed: (questionId, value) =>
    set((s) => ({ revealed: { ...s.revealed, [questionId]: value } })),

  toggleRevealed: (questionId) =>
    set((s) => ({ revealed: { ...s.revealed, [questionId]: !s.revealed[questionId] } })),

  toggleCrop: (questionId) =>
    set((s) => ({ cropOpen: { ...s.cropOpen, [questionId]: !s.cropOpen[questionId] } })),

  setFavorite: (questionId, value) =>
    set((s) => ({ favorites: { ...s.favorites, [questionId]: value } })),

  setNote: (questionId, value) =>
    set((s) => ({ notes: { ...s.notes, [questionId]: value } })),

  setDetail: (questionId, detail) =>
    set((s) => {
      const next: Partial<PracticeState> = {};
      const history = { ...s.history };
      const wrongInfo = { ...s.wrongInfo };
      const favorites = { ...s.favorites };
      const notes = { ...s.notes };
      if (detail.attempts) history[questionId] = detail.attempts;
      if (detail.wrong) wrongInfo[questionId] = detail.wrong;
      if (typeof detail.favorite === "boolean" && favorites[questionId] === undefined) {
        favorites[questionId] = detail.favorite;
      }
      // never clobber a note the runner already has locally (debounced save may be in flight)
      if (notes[questionId] === undefined) notes[questionId] = detail.note ?? "";
      next.history = history;
      next.wrongInfo = wrongInfo;
      next.favorites = favorites;
      next.notes = notes;
      return next;
    }),

  setSessionId: (id) => set({ sessionId: id }),

  requestMaterials: (ids) => {
    const s = get();
    const todo: string[] = [];
    for (const id of ids) {
      if (!id) continue;
      if (id in s.materials || s.materialRequested[id]) continue;
      if (!todo.includes(id)) todo.push(id);
    }
    if (todo.length) {
      const materialRequested = { ...s.materialRequested };
      for (const id of todo) materialRequested[id] = true;
      set({ materialRequested });
    }
    return todo;
  },

  setMaterials: (list, missingIds) =>
    set((s) => {
      if (!list.length && !missingIds?.length) return s;
      const materials = { ...s.materials };
      for (const m of list) materials[m.id] = m;
      for (const id of missingIds ?? []) if (!(id in materials)) materials[id] = null;
      return { materials };
    }),

  releaseMaterials: (ids) =>
    set((s) => {
      const materialRequested = { ...s.materialRequested };
      let changed = false;
      for (const id of ids) {
        if (materialRequested[id]) {
          delete materialRequested[id];
          changed = true;
        }
      }
      return changed ? { materialRequested } : s;
    }),

  markSubmitted: () => {
    const s = get();
    const elapsed = { ...s.elapsed };
    const qid = s.queue[s.index];
    if (qid && s.tickStart !== null) {
      elapsed[qid] = (elapsed[qid] ?? 0) + Math.max(0, Date.now() - s.tickStart);
    }
    // 交卷后整卷进入回顾态：解析默认可见，但允许逐题折叠
    const revealed = { ...s.revealed };
    for (const id of s.queue) revealed[id] = true;
    set({ submitted: true, deadline: null, tickStart: null, elapsed, revealed, finishedAt: Date.now() });
  },

  setLoading: (v, error = null) => set({ loading: v, error }),

  reset: () =>
    set({
      active: false,
      loading: false,
      error: null,
      queue: [],
      questions: {},
      index: 0,
      config: null,
      sessionId: null,
      startedAt: null,
      finishedAt: null,
      deadline: null,
      submitted: false,
      tickStart: null,
      ...emptyMaps,
      materials: {},
      materialRequested: {},
    }),
}));

/* ------------------------------------------------------------------ */
/* Derived helpers                                                     */
/* ------------------------------------------------------------------ */

export interface SessionStats {
  answered: number;
  gradedTotal: number;
  correct: number;
  wrong: number;
  noAnswer: number;
  accuracy: number;
  elapsedMs: number;
  done: number;
  total: number;
}

export function computeStats(s: PracticeState): SessionStats {
  let answered = 0;
  let correct = 0;
  let wrong = 0;
  let noAnswer = 0;
  let elapsedMs = 0;
  for (const id of s.queue) {
    const picked = s.chosen[id];
    elapsedMs += s.elapsed[id] ?? 0;
    if (!picked) continue;
    answered += 1;
    if (s.ungraded[id]) {
      noAnswer += 1;
      continue;
    }
    const g = s.graded[id];
    if (g) {
      if (g.correct) correct += 1;
      else wrong += 1;
    }
  }
  const gradedTotal = correct + wrong;
  return {
    answered,
    gradedTotal,
    correct,
    wrong,
    noAnswer,
    accuracy: gradedTotal ? (correct / gradedTotal) * 100 : 0,
    elapsedMs,
    done: s.mode === "exam" ? answered : gradedTotal,
    total: s.queue.length,
  };
}

export function fmtMs(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 资料分组（资料分析专属；其余模块 materialId 全为 null，以下函数皆恒等）  */
/* ------------------------------------------------------------------ */

/**
 * 打乱之后做一次「按资料稳定分组」：
 * - 组的先后顺序 = 该组第一题在乱序里出现的位置；
 * - 组内按原题号升序，与印刷顺序一致；
 * - 没有资料的题共用 null 这一桶，桶内保持原有相对顺序。
 *
 * 因此一段资料的题目永远连着出现，绝不会被两组交叉拆开；而判断推理等模块
 * 一道资料题都没有，直接原样返回，队列与改动前逐字节相同。
 */
export function groupQueueIds(items: Question[], ids: string[]): string[] {
  const hasMaterial = items.some((q) => q.materialId);
  if (!hasMaterial) return ids;

  const byId = new Map(items.map((q) => [q.id, q]));
  const buckets = new Map<string, Question[]>();
  for (const id of ids) {
    const q = byId.get(id);
    if (!q) continue;
    const key = q.materialId ?? "";
    const bucket = buckets.get(key);
    if (bucket) bucket.push(q);
    else buckets.set(key, [q]);
  }

  const out: string[] = [];
  for (const [key, bucket] of buckets) {
    if (key === "") {
      out.push(...bucket.map((q) => q.id));
      continue;
    }
    out.push(
      ...bucket
        .slice()
        .sort((a, b) => a.num - b.num || a.id.localeCompare(b.id))
        .map((q) => q.id),
    );
  }
  // 队列里取不到题目的 id（理论上不会发生）留在尾部，绝不静默丢题。
  const placed = new Set(out);
  out.push(...ids.filter((id) => !placed.has(id)));
  return out;
}

/** 队列里出现过的资料 id，按队列顺序去重。 */
export function materialIdsInQueue(
  queue: string[],
  questions: Record<string, Question>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of queue) {
    const mid = questions[id]?.materialId;
    if (!mid || seen.has(mid)) continue;
    seen.add(mid);
    out.push(mid);
  }
  return out;
}

export interface MaterialGroupInfo {
  materialId: string;
  /** 本题在队列该组内的序号，1 基。 */
  index: number;
  /** 队列里这组共有几题——抽题只抽到部分时也以队列为准。 */
  total: number;
}

/** 当前题所属资料组在队列中的位置，用于「同一资料 · 第 2/5 小题」。 */
export function materialGroupAt(
  queue: string[],
  questions: Record<string, Question>,
  index: number,
): MaterialGroupInfo | null {
  const current = questions[queue[index]];
  const materialId = current?.materialId;
  if (!materialId) return null;
  let position = 0;
  let total = 0;
  for (const id of queue) {
    if (questions[id]?.materialId !== materialId) continue;
    total += 1;
    if (id === queue[index]) position = total;
  }
  return { materialId, index: position || 1, total };
}

/** 答题卡分组条带：队列中一段连续的同资料小题。 */
export interface MaterialSegment {
  materialId: string;
  /** 组在队列中的起始下标（0 基）。 */
  start: number;
  count: number;
  /** 资料组序号，从 1 开始，按队列出现顺序递增。 */
  ordinal: number;
}

export function materialSegments(
  queue: string[],
  questions: Record<string, Question>,
): MaterialSegment[] {
  const out: MaterialSegment[] = [];
  const ordinalOf = new Map<string, number>();
  let i = 0;
  while (i < queue.length) {
    const mid = questions[queue[i]]?.materialId ?? null;
    if (!mid) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < queue.length && questions[queue[j]]?.materialId === mid) j += 1;
    const ordinal = ordinalOf.get(mid) ?? ordinalOf.size + 1;
    ordinalOf.set(mid, ordinal);
    out.push({ materialId: mid, start: i, count: j - i, ordinal });
    i = j;
  }
  return out;
}
