import { useEffect, useState } from "react";
import clsx from "clsx";
import { fmtMs, usePractice } from "@/lib/practice-store";

function useNow(intervalMs = 500, enabled = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, enabled]);
  return now;
}

/**
 * 计时器：
 * - 每题计时：始终显示当前题累计用时（含来回翻看的累积时间，来自 store.elapsed + tickStart）。
 * - 考试倒计时：由 deadline 驱动，剩余 60s 变橙、15s 变红；归零由 runner 自动交卷。
 */
export default function Timer({ compact = false }: { compact?: boolean }) {
  const tickStart = usePractice((s) => s.tickStart);
  const deadline = usePractice((s) => s.deadline);
  const submitted = usePractice((s) => s.submitted);
  const mode = usePractice((s) => s.mode);
  const qid = usePractice((s) => s.queue[s.index]);
  const base = usePractice((s) => (qid ? s.elapsed[qid] ?? 0 : 0));
  const totalMs = usePractice((s) => Object.values(s.elapsed).reduce((a, b) => a + b, 0));

  const live = tickStart !== null || deadline !== null;
  const now = useNow(500, live);

  const questionMs = base + (tickStart !== null ? Math.max(0, now - tickStart) : 0);
  const sessionMs = totalMs + (tickStart !== null ? Math.max(0, now - tickStart) : 0);
  const remainMs = deadline !== null ? Math.max(0, deadline - now) : null;
  const critical = remainMs !== null && remainMs <= 15_000;
  const warning = remainMs !== null && remainMs <= 60_000;

  return (
    <div className={clsx("flex items-center gap-3", compact ? "text-[11px]" : "text-xs")}>
      <span className="tabular-nums text-muted">
        本题 <span className="font-medium text-ink tabular-nums">{fmtMs(questionMs)}</span>
      </span>
      <span className="tabular-nums text-muted">
        合计 <span className="font-medium text-ink tabular-nums">{fmtMs(sessionMs)}</span>
      </span>
      {remainMs !== null && mode === "exam" && !submitted && (
        <span
          className={clsx(
            "rounded-md border px-2 py-0.5 tabular-nums",
            critical
              ? "border-[var(--bad)] text-[var(--bad)]"
              : warning
                ? "border-[var(--warn)] text-[var(--warn)]"
                : "border-line text-muted",
          )}
        >
          剩余 {fmtMs(remainMs)}
        </span>
      )}
      {mode === "exam" && submitted && <span className="chip">已交卷</span>}
    </div>
  );
}
