import type { AnswerResult, BankMeta, Question } from "@/lib/types";
import type { RunnerMode } from "@/lib/practice-store";

/**
 * Thin, failure-tolerant fetch helpers for the practice runner.
 * Everything is a plain JSON round-trip against the existing /api routes.
 */

export interface QueueParams {
  bank?: string | null;
  chapter?: string | null;
  section?: string | null;
  point?: string | null;
  kind?: string | null;
  q?: string | null;
  status?: "unanswered" | "wrong" | "favorite" | "smart" | null;
  limit: number;
  offset?: number;
}

export interface QueueResponse {
  total: number;
  items: Question[];
}

export interface QuestionDetail {
  question: Question;
  attempts?: { answer: string | null; correct: boolean; createdAt: string; mode: string }[];
  wrong?: { wrong_count: number; box: number; status: string; next_review: string | null } | null;
  favorite?: boolean;
  note?: string | null;
  tags?: string[];
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: string };
      detail = body?.error ?? "";
    } catch {
      /* ignore non-JSON error bodies */
    }
    throw new Error(`${res.status} ${res.statusText}${detail ? ` · ${detail}` : ""}`);
  }
  return (await res.json()) as T;
}

export function buildQueueUrl(p: QueueParams): string {
  const sp = new URLSearchParams();
  if (p.bank) sp.set("bank", p.bank);
  if (p.chapter) sp.set("chapter", p.chapter);
  if (p.section) sp.set("section", p.section);
  if (p.point) sp.set("point", p.point);
  if (p.kind) sp.set("kind", p.kind);
  if (p.q) sp.set("q", p.q);
  if (p.status) sp.set("status", p.status);
  sp.set("limit", String(p.limit));
  sp.set("offset", String(p.offset ?? 0));
  return `/api/bank/questions?${sp.toString()}`;
}

/** Largest-remainder apportionment: every module with questions gets a slot. */
export function apportion(weights: number[], total: number): number[] {
  const n = weights.length;
  if (!n || total <= 0) return weights.map(() => 0);
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map((w) => (w / sum) * total);
  const base = raw.map((r) => Math.floor(r));
  let left = total - base.reduce((a, b) => a + b, 0);
  const byFrac = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of byFrac) {
    if (left <= 0) break;
    base[i] += 1;
    left -= 1;
  }
  for (let i = 0; i < n; i++) {
    if (base[i] > 0 || weights[i] === 0 || total < n) continue;
    const donor = base.indexOf(Math.max(...base));
    if (donor >= 0 && base[donor] > 1) {
      base[donor] -= 1;
      base[i] = 1;
    }
  }
  return base.map((b, i) => Math.min(b, weights[i] || b));
}

/**
 * 跨模块模考: 行测本来就是把各模块按比例合在一张卷上，所以抽题按各模块题库规模配比，
 * 而不是把四个模块拼成一个大队列再随机（那样小题量模块会被大模块淹没）。
 */
export async function fetchMixedQueue(
  p: Omit<QueueParams, "bank" | "limit" | "offset"> & { limit: number },
): Promise<QueueResponse> {
  const { modules } = await json<{ modules: { id: string; questions: number }[] }>("/api/modules");
  const built = modules.filter((m) => m.questions > 0);
  if (!built.length) return { total: 0, items: [] };
  const quota = apportion(built.map((m) => m.questions), p.limit);
  const slices = await Promise.all(
    built.map((m, i) =>
      quota[i] > 0
        ? fetchQueue({ ...p, bank: m.id, limit: quota[i], offset: 0 })
        : Promise.resolve({ total: 0, items: [] as QueueResponse["items"] }),
    ),
  );
  const items = slices.flatMap((s) => s.items);
  return { total: slices.reduce((sum, s) => sum + s.total, 0), items };
}

export async function fetchQueue(p: QueueParams): Promise<QueueResponse> {
  const data = await json<QueueResponse>(buildQueueUrl(p));
  return { total: data.total ?? 0, items: Array.isArray(data.items) ? data.items : [] };
}

/**
 * Resolve an explicit id list (the 重做 buttons elsewhere deep-link these).
 * Fetched in bounded batches so a long list cannot flood the dev server.
 */
export async function fetchByIds(ids: string[]): Promise<Question[]> {
  const out: Question[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!seen.has(id)) seen.add(id);
  }
  const list = [...seen];
  const BATCH = 6;
  for (let i = 0; i < list.length; i += BATCH) {
    const batch = list.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map((id) => json<{ question: Question }>(`/api/bank/questions/${encodeURIComponent(id)}`)),
    );
    results.forEach((r, j) => {
      if (r.status === "fulfilled" && r.value?.question) out.push(r.value.question);
      else missing.push(batch[j]);
    });
  }
  if (!out.length && missing.length) throw new Error(`未能载入题目：${missing.slice(0, 5).join(", ")}`);
  return out;
}

export async function fetchMetas(): Promise<BankMeta[]> {
  try {
    const data = await json<{ metas: BankMeta[] }>("/api/bank/meta");
    return Array.isArray(data.metas) ? data.metas : [];
  } catch {
    return [];
  }
}

export async function postAnswer(input: {
  questionId: string;
  answer: string | null;
  durationMs: number;
  mode: RunnerMode;
  sessionId: number | null;
}): Promise<AnswerResult> {
  return json<AnswerResult>("/api/answer", { method: "POST", body: JSON.stringify(input) });
}

export async function createSession(title: string, mode: RunnerMode, scope: string | null) {
  return json<{ id: number }>("/api/session", {
    method: "POST",
    body: JSON.stringify({ title, mode, scope }),
  });
}

export async function closeSession(id: number) {
  return json<{ ok: boolean }>("/api/session", { method: "PATCH", body: JSON.stringify({ id }) });
}

export async function toggleFavorite(questionId: string) {
  return json<{ favorite: boolean }>("/api/favorites", {
    method: "POST",
    body: JSON.stringify({ questionId }),
  });
}

export async function saveNote(questionId: string, text: string) {
  return json<{ ok: boolean }>("/api/notes", {
    method: "POST",
    body: JSON.stringify({ questionId, text }),
  });
}

export async function fetchDetail(questionId: string): Promise<QuestionDetail> {
  return json<QuestionDetail>(`/api/bank/questions/${encodeURIComponent(questionId)}`);
}

export async function markWrongResolved(questionId: string) {
  return json<{ ok: boolean }>("/api/wrong", {
    method: "PATCH",
    body: JSON.stringify({ questionId, status: "resolved" }),
  });
}
