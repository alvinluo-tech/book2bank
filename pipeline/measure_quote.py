"""Calibration for the `根据题干"…"` marriage test that verify_bank.py relies on.

资料分析 groups five items under one 资料 and every analysis of the group cites the same
numbers, so analysis↔material proves nothing about the individual item. 粉笔's analysis
opens with an elided quotation of that one stem, which is item-specific — but only if the
quotation's generic vocabulary is discounted and numbers match as whole numbers.

This answers the question the verifier cannot answer about itself: when the quotation
prefers some *other* item in the bank, how often is it right? Re-run after any parser
change; the test is the reason the check is trusted.

  python pipeline/measure_quote.py [bankId]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from verify_bank import (  # noqa: E402
    QUOTE, common_bigrams, quote_parts, score_parts, stem_parts,
)

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    bank = sys.argv[1] if len(sys.argv) > 1 else "ziliao"
    qs = json.loads((ROOT / "data/banks" / bank / "questions.json").read_text(encoding="utf-8"))
    common = frozenset(common_bigrams([q.get("stem") or "" for q in qs]))
    nstem = [stem_parts(q.get("stem") or "") for q in qs]

    tested = won = tied = lost = 0
    strong = 0
    wrong: list[tuple] = []
    for i, q in enumerate(qs):
        m = QUOTE.search(q.get("analysis") or "")
        if not m:
            continue
        qn, qb = quote_parts(m.group(1), common)
        if not qn and not qb:
            continue
        own = score_parts(qn, qb, *nstem[i])
        if own < 0.34:
            continue  # quotation too garbled by OCR to be evidence either way
        tested += 1
        best, bid = 0.0, None
        for j, (sn, sc) in enumerate(nstem):
            if j == i:
                continue
            sv = score_parts(qn, qb, sn, sc)
            if sv > best:
                best, bid = sv, qs[j]["id"]
        if best > own + 0.05:
            lost += 1
            wrong.append((q["id"], bid, round(own, 2), round(best, 2), m.group(1)[:30]))
        elif best == own:
            tied += 1
        else:
            won += 1
            if own - best >= 0.25:
                strong += 1
    print(json.dumps({"bank": bank, "quotations_testable": tested, "own_item_wins": won,
                      "tie": tied, "another_item_wins": lost,
                      "win_margin>=0.25": strong}, ensure_ascii=False))
    for w in wrong[:15]:
        print(w)
    return 0


if __name__ == "__main__":
    sys.exit(main())
