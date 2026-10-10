"""Reader/applier for data/banks/<bank>/corrections.json — the human-verified field fixes.

questions.json is a build artifact: parse_bank.py rewrites it from the OCR every time, so
a correction cannot live in it. It lives beside it, and anything that judges the bank has
to merge it in first — otherwise a question whose answer was verified by eye is still
reported as `no-answer`, and the app shows 已人工校正 next to 校验存疑 for the same item.

The matching rule here is deliberately a byte-for-byte mirror of applyCorrections() in
src/lib/bank.ts, because the two must never disagree about which question a correction
lands on:

  * addressed by 题目册 page + printed 题号 + 题干前缀, never by question id — a rebuild
    renumbers ids, and (chapter, num) restarts inside 考点 blocks;
  * an entry must hit exactly one question, otherwise it is reported as unmatched and
    applied to nothing. A silently misapplied correction is worse than a missing one.
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

# Fields a correction may overwrite. Anything else in `set` is ignored, so a typo in the
# JSON cannot invent a field the app does not read.
ALLOWED = {"stem", "options", "answer", "analysis", "accuracy", "trapOption", "answerPageRef"}

_norm = lambda s: re.sub(r"\s+", "", s or "")


def load(out_dir: Path) -> list[dict]:
    """Correction entries for one bank, or [] when the file is absent or malformed."""
    path = Path(out_dir) / "corrections.json"
    if not path.exists():
        return []
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return []
    entries = doc.get("entries") if isinstance(doc, dict) else None
    return [e for e in (entries or []) if isinstance(e, dict) and isinstance(e.get("set"), dict)]


def apply(questions: list[dict], entries: list[dict]) -> tuple[int, list[str]]:
    """Merge corrections into `questions` in place. Returns (applied, unmatched reasons)."""
    by_page: dict[int, list[dict]] = defaultdict(list)
    for q in questions:
        page = (q.get("pageRef") or {}).get("page")
        if page:
            by_page[page].append(q)

    applied = 0
    unmatched: list[str] = []
    for e in entries:
        m = e.get("match") or {}
        hits = [q for q in by_page.get(m.get("page"), [])
                if (m.get("num") is None or q.get("num") == m["num"])
                and (not m.get("stemStart") or _norm(q.get("stem")).startswith(_norm(m["stemStart"])))]
        if len(hits) != 1:
            label = e.get("id") or m.get("stemStart") or "?"
            num = "" if m.get("num") is None else f" 第{m['num']}题"
            unmatched.append(f"{label} @ p{m.get('page')}{num}：匹配到 {len(hits)} 题")
            continue
        q = hits[0]
        fields = [k for k in e["set"] if k in ALLOWED]
        for key in fields:
            q[key] = e["set"][key]
        q["_corrected"] = {"fields": fields, "why": e.get("why") or "", "at": e.get("at") or ""}
        applied += 1
    return applied, unmatched


def apply_for_bank(out_dir: Path, questions: list[dict]) -> tuple[int, list[str]]:
    return apply(questions, load(out_dir))
