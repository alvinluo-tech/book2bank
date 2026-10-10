import { getVerificationRow } from "@/lib/verification";
import { TONE_VARS } from "@/components/bank/helpers";
import { EVIDENCE_INFO, PROOF_INFO, noteLabel, reasonInfo } from "./info";

/**
 * Per-question verdict from pipeline/verify_bank.py, as header chips on the detail page.
 *
 * Server component: src/lib/verification.ts caches the file by mtime, so rendering
 * this costs one map lookup after the first read. Absent file (or unknown id) renders
 * nothing — an unverified bank must not look "clean" nor "broken", just unmarked.
 */
export default function VerificationBadge({
  bankId,
  questionId,
}: {
  bankId: string;
  questionId: string;
}) {
  const row = getVerificationRow(bankId, questionId);
  if (!row) return null;

  const ev = EVIDENCE_INFO[row.evidence];
  const evColors = TONE_VARS[ev.tone];
  const evTitle = `逐题校验：解析证据「${row.evidence}」得分 ${row.evidenceScore.toFixed(1)} — ${ev.help}`;

  return (
    <span className="flex flex-wrap items-center justify-end gap-1">
      {row.corrected?.length ? (
        <span
          className="chip"
          style={{ color: TONE_VARS.ok.fg, borderColor: TONE_VARS.ok.fg }}
          title={`该题的 ${row.corrected.join(" / ")} 已由人工对照原书扫描复核（data/banks/…/corrections.json），下面的结论是就复核后的数据算出的`}
        >
          已人工校正
        </span>
      ) : null}
      <span className="chip" style={{ color: evColors.fg, borderColor: evColors.fg }} title={evTitle}>
        {row.ok ? "校验通过 · " : "校验存疑 · "}
        {ev.label}
      </span>
      <span
        className="chip"
        style={{
          color: row.structural ? "var(--ok)" : "var(--warn)",
          borderColor: row.structural ? "var(--ok)" : "var(--warn)",
        }}
        title={
          row.proof.length
            ? row.proof.map((k) => `${k}：${PROOF_INFO[k] ?? ""}`).join("\n")
            : "答案册里没找到与该编号、该字母对应的印刷锚点，只能看原页核对"
        }
      >
        {row.structural ? "印刷锚点已证" : "需核对原页"}
      </span>
      {row.reasons.map((raw) => {
        const info = reasonInfo(raw);
        const colors = TONE_VARS[info.tone];
        return (
          <span
            key={raw}
            className="chip"
            style={{ color: colors.fg, borderColor: colors.fg }}
            title={`${raw} — ${info.help}`}
          >
            {info.label}
          </span>
        );
      })}
      {row.notes.length > 0 && (
        <span
          className="text-[11px] text-muted"
          title={`提示（不判为可疑）：${row.notes.map((n) => `${n}（${noteLabel(n)}）`).join("、")}`}
        >
          另 {row.notes.length} 项提示
        </span>
      )}
    </span>
  );
}
