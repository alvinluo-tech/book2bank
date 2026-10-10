import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { saveNote } from "./api";
import { usePractice } from "@/lib/practice-store";

type Status = "idle" | "dirty" | "saving" | "saved" | "error";

const STATUS_COPY: Record<Status, string> = {
  idle: "",
  dirty: "未保存…",
  saving: "保存中…",
  saved: "已保存",
  error: "保存失败，可重试",
};

const DEBOUNCE_MS = 600;

/**
 * 每题笔记：600ms 防抖写入 /api/notes。
 * 调用方用 key={questionId} 挂载，切换题目会重新挂载本组件，
 * 卸载清理把防抖窗口里的内容立刻补写出去，避免最后一笔丢失。
 */
export default function NotePad({ questionId }: { questionId: string }) {
  const stored = usePractice((s) => s.notes[questionId]);
  const setNote = usePractice((s) => s.setNote);
  const [text, setText] = useState(stored ?? "");
  const [status, setStatus] = useState<Status>("idle");

  const edited = useRef(false);
  const timer = useRef<number | null>(null);
  /** 输入时的题目快照，切题后仍知道该把哪段文字写回哪一题。 */
  const draft = useRef<{ qid: string; value: string } | null>(null);

  const push = useCallback(
    (qid: string, value: string) => {
      setNote(qid, value);
      setStatus("saving");
      saveNote(qid, value)
        .then(() => setStatus("saved"))
        .catch(() => setStatus("error"));
    },
    [setNote],
  );

  const flush = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const d = draft.current;
    draft.current = null;
    if (d?.qid) push(d.qid, d.value);
  }, [push]);

  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  useEffect(
    () => () => {
      flushRef.current();
    },
    [],
  );

  // 服务端笔记晚于首帧到达时补一次（本地已编辑则以本地为准）。
  useEffect(() => {
    if (!edited.current && stored !== undefined) setText(stored);
  }, [stored]);

  return (
    <div className="card p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <label htmlFor="practice-note-input" className="text-sm font-medium">
          笔记
        </label>
        <span
          className={clsx(
            "text-[11px]",
            status === "error" ? "text-bad" : status === "saved" ? "text-ok" : "text-muted",
          )}
        >
          {STATUS_COPY[status]}
        </span>
      </div>
      <textarea
        id="practice-note-input"
        value={text}
        rows={4}
        spellCheck={false}
        placeholder="记思路、记坑点（N 键聚焦）…"
        onChange={(e) => {
          edited.current = true;
          const value = e.target.value;
          setText(value);
          setStatus("dirty");
          draft.current = { qid: questionId, value };
          if (timer.current !== null) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => {
            timer.current = null;
            flush();
          }, DEBOUNCE_MS);
        }}
        onKeyDown={(e) => e.stopPropagation()}
        className="w-full resize-y rounded-lg border border-line bg-bg p-2 text-[13px] leading-relaxed outline-none focus:border-brand"
      />
      <p className="mt-1 text-[11px] text-muted">输入自动保存 · Esc 退出输入框</p>
    </div>
  );
}
