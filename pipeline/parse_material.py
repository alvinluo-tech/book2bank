"""Parser for the 资料分析 layout: one 资料 shared by a group of ~5 items.

The 判断推理 layout assumes "one stem, four options, numbering restarts per teaching
block". 资料分析 breaks that assumption in three ways, so it gets its own module
instead of more branches in parse_bank:

  * a **material** (table / chart / text) sits above a group of items and belongs to
    all of them — it is a first-class entity, not part of any stem;
  * printed numbering is **continuous** inside a 作业题 set (（二） starts at 6, not 1);
  * chapters are named after the material type (第一章 表格资料 …), which is the taxonomy
    the app should surface.

Reuses parse_bank's line reconstruction, answer stream, option splitting and text
cleaning so both layouts stay in sync.

  python pipeline/parse_bank.py --bank ziliao      # dispatches here
  python pipeline/parse_material.py                # or directly
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import books  # noqa: E402
import parse_bank as PB  # noqa: E402
from bank_lines import (  # noqa: E402
    CN_NUM, RE_OPTION, RE_QNUM, RE_SOURCE, Line, build_lines, load_pages,
)
from verify_bank import (  # noqa: E402
    QUOTE, cjk_bigrams, common_bigrams, data_values, quote_parts, score_parts, stem_parts,
)
from parse_bank import clean_analysis, norm, split_options  # noqa: E402

ROOT = books.ROOT

# "（2023 国考副省 121～125）根据下列资料完成以下各题。"
GROUP_HDR = re.compile(r"根据下列资料|根据以下资料|根据材料回答|完成以下各题|请回答问题|根据上述资料")
GROUP_LABEL = re.compile(rf"^[（(]\s*([{CN_NUM}])?\s*[)）]\s*$")
UNIT_LINE = re.compile(r"^单位[:：]")
SET_HEAD = re.compile(rf"^[【[]?\s*(作业题|综合训练|全真模拟)\s*([{CN_NUM}\d]+)")
BLOCK_HEAD = re.compile(r"^[「【『]?\s*(夯实基础|提升进阶|基础巩固|综合训练|全真模拟)\s*[」】』]?$")
PARA_HINT = re.compile(r"^[^0-9]{20,}")  # 文字资料 material is long prose
CJK_ANY = re.compile(r"[㐀-䶿一-鿿]")
CIRCLED = re.compile(r"[①-⑳]")
MAX_ITEM_NUM = 40  # a 作业题 set numbers ~20 items; nothing prints higher


def is_title(text: str) -> bool:
    """The material's own caption line, e.g. 2016—2021年全国及部分省市集成电路产量.

    A table row is mostly digits while a caption is mostly Chinese, so the digit
    balance separates them without knowing the table's shape.
    """
    cjk = len(CJK_ANY.findall(text))
    digits = sum(c.isdigit() for c in text)
    return cjk >= 4 and digits <= cjk * 1.2 and len(norm(text)) >= 6


def clean_label(text: str | None) -> str | None:
    """（一） survives; the OCR's empty （） does not."""
    if not text:
        return None
    m = GROUP_LABEL.match(text.strip())
    if m and m.group(1):
        return f"（{m.group(1)}）"
    return None


def parse_stream(end_up: int) -> tuple[list[dict], list[dict], list[dict]]:
    """Materials + items, in reading order."""
    materials: list[dict] = []
    items: list[dict] = []
    notes: list[dict] = []
    chapter, chapter_title = 0, ""
    block = set_name = None
    book_page = None
    mat: dict | None = None
    cur: dict | None = None
    prev_num = 0
    ordinal = 0
    pending_label: str | None = None

    def close_item() -> None:
        nonlocal cur
        cur = None

    def open_material(page: dict, header: Line, label: str | None) -> None:
        # prev_num deliberately survives a new 资料: item numbers run continuously
        # across the groups of one 作业题 (the second 资料 starts at 6, not at 1).
        nonlocal mat, pending_label
        src = RE_SOURCE.match(header.text)
        mat = {
            "id": f"m{len(materials) + 1:04d}",
            "chapter": chapter, "chapterTitle": chapter_title,
            "sectionTitle": block, "setTitle": set_name,
            "groupLabel": clean_label(label) or clean_label(pending_label),
            "header": header.text,
            "source": norm(header.text[: src.end()]) if src else None,
            "title": None, "unit": None, "rows": [],
            "page": page["page"], "bookPage": book_page,
            "y0": header.y, "y1": header.y2,
            "pages": [(page["page"], header.y, header.y2)],
            "scores": [header.score],
        }
        materials.append(mat)
        pending_label = None
        close_item()

    for p, lines in PB.pages_of("up", end_up):
        for ln in PB.split_anchors(lines):
            if ln.kind == "chapter":
                g = ln.extra["chapter"]
                idx = PB.CN.get(g[0], 0)
                ordinal = 0
                prev_num = 0
                if ln.y < 170 and idx and idx != chapter:
                    chapter, chapter_title = idx, norm(g[1]) if len(g) > 1 else chapter_title
                    block = set_name = None
                    prev_num, cur, mat = 0, None, None
                elif not chapter:
                    chapter = idx
                    chapter_title = norm(g[1]) if len(g) > 1 else chapter_title
                continue
            if ln.kind == "page_num":
                digits = re.sub(r"\D", "", ln.text)
                if digits:
                    book_page = int(digits)
                continue
            if ln.kind == "running_head":
                continue
            if PB.PARSED_ON.match(ln.text):
                continue

            bh = BLOCK_HEAD.match(ln.text.strip())
            sh = SET_HEAD.match(ln.text.strip())
            if bh or sh:
                block = norm(bh.group(1)) if bh else block
                set_name = norm(re.sub(r"[\[\]【】]", "", ln.text)) if sh else set_name
                prev_num, cur, mat = 0, None, None
                ordinal += 1
                continue

            if GROUP_HDR.search(ln.text):
                label = None
                # the （一） marker usually sits on the line right above the header
                for prev in reversed([l for l in lines if l.y < ln.y][:2]):
                    m = GROUP_LABEL.match(prev.text.strip())
                    if m:
                        label = f"（{m.group(1) or ''}）" if m.group(1) else None
                        break
                open_material(p, ln, label)
                continue
            if GROUP_LABEL.match(ln.text.strip()):
                # a bare （一）/() marker: remember it for the header that follows
                pending_label = ln.text.strip()
                continue

            m = RE_QNUM.match(ln.text)
            if m and mat is not None:
                num = int(m.group(1))
                rest = m.group(2).strip()
                tagged = bool(RE_SOURCE.match(rest))
                # A table cell run such as "68.36 76.43 81.24" matches `N.` too, so the
                # Chinese/digit balance — not the numbering chain — decides what is an item.
                cjk = len(CJK_ANY.findall(rest))
                digits = sum(c.isdigit() for c in rest)
                is_item = num <= MAX_ITEM_NUM and (cjk >= 4 if not tagged else cjk >= 1) and (
                    tagged or digits <= cjk * 2)
                # Numbering itself is not a usable gate here (a set runs 1..20 and the
                # OCR drops anchors at will), so only the language shape decides whether
                # a numbered line is an item; sequence() rebuilds the numbering after.
                if is_item:
                    prev_num = num
                    cur = {
                        "num": num, "chapter": chapter, "chapterTitle": chapter_title,
                        "section": block, "set": set_name, "point": mat["chapterTitle"],
                        "material": mat,
                        "page": p["page"], "bookPage": book_page,
                        "y0": ln.y, "y1": ln.y2, "lastY": ln.y2,
                        "x0": ln.x, "x1": ln.x + ln.w,
                        "stem": [rest] if rest else [], "opts": [], "optY": 1e9,
                        "scores": [ln.score], "pages": [(p["page"], ln.y, ln.y2)],
                        "segStem": {str(p["page"]): ln.y2}, "source": None,
                        "ordinal": ordinal,
                    }
                    src = RE_SOURCE.match(rest)
                    if src:
                        cur["source"] = norm(rest[: src.end()])
                        cur["stem"] = [rest[src.end():].strip()] if rest[src.end():].strip() else []
                    items.append(cur)
                    mat["y1"] = max(mat["y1"], ln.y)
                    continue

            if cur is not None:
                stripped = ln.text.strip()
                gap = ln.y - cur["lastY"]
                cur["lastY"] = max(cur["lastY"], ln.y2)
                cur["y1"] = max(cur["y1"], ln.y2)
                cur["x0"] = min(cur["x0"], ln.x)
                cur["x1"] = max(cur["x1"], ln.x + ln.w)
                cur["scores"].append(ln.score)
                if cur["pages"] and cur["pages"][-1][0] == p["page"]:
                    cur["pages"][-1] = (p["page"], cur["pages"][-1][1], cur["y1"])
                else:
                    cur["pages"].append((p["page"], ln.y, cur["y1"]))
                if RE_OPTION.match(stripped):
                    cur["opts"].append(stripped)
                    cur["optY"] = min(cur["optY"], ln.y)
                elif cur["opts"]:
                    cur["opts"][-1] = cur["opts"][-1] + " " + stripped
                elif gap <= PB.STEM_GAP and len(stripped) > 1:
                    cur["stem"].append(stripped)
                    cur["segStem"][str(p["page"])] = max(
                        cur["segStem"].get(str(p["page"]), 0.0), ln.y2)
                continue

            if mat is not None:
                stripped = ln.text.strip()
                mat["y1"] = max(mat["y1"], ln.y2)
                mat["scores"].append(ln.score)
                mat["pages"][-1] = (p["page"], mat["pages"][-1][1], mat["y1"])
                if UNIT_LINE.match(stripped):
                    mat["unit"] = norm(re.sub(UNIT_LINE, "", stripped)) or stripped
                elif mat["title"] is None and is_title(stripped):
                    mat["title"] = norm(stripped)
                else:
                    mat["rows"].append(stripped)
        if p["page"] % 60 == 0:
            print(f"  materials: zl p{p['page']} -> {len(materials)} groups, {len(items)} items",
                  flush=True)

    heights = {pg["page"]: pg["height"] for pg in load_pages(CFG_TAG("up"), 1, end_up)}
    for m in materials:
        pg, y0, y1 = m["pages"][-1]
        m["pages"][-1] = (pg, y0, min(y1, heights.get(pg, 2016) - 110))
    return materials, items, notes


def CFG_TAG(side: str) -> str:
    return PB.CFG["tag"][side]


def _score(it: dict) -> tuple:
    """Prefer the candidate that actually reads like a question when numbers collide."""
    raw = it.get("stem") or it.get("analysis") or ""
    stem = raw if isinstance(raw, str) else " ".join(raw)
    return (stem.rstrip().endswith(("？", "?", "：", ":")), len(stem))


def assign_ordinals(rows: list[dict]) -> list[dict]:
    """Stamp each row with the 作业题 it belongs to: numbering restarts at 1 per set."""
    ch, ordinal, last = None, 0, 0
    for r in rows:
        if ch is not None and r["chapter"] != ch:
            ordinal = 0
        if r["num"] == 1 or (last and r["num"] > 20 and last <= 20):
            ordinal += 1
        ch = r["chapter"]
        last = r["num"]
        r["ordinal"] = max(1, ordinal)
    return rows


def sequence(items: list[dict]) -> tuple[list[dict], int]:
    """Split each chapter into 作业题 sets at every printed 1, one item per number.

    A set always starts at 1, so the restarts are visible even when the OCR loses an
    anchor mid-set; within a set the printed number is unique, so a stray number
    picked up out of a table or figure caption only competes with the real item for
    that slot instead of becoming a phantom question.
    """
    assign_ordinals(items)
    out: dict[tuple, dict] = {}
    stray = 0
    for it in items:
        key = (it["chapter"], it["ordinal"], it["num"])
        cur = out.get(key)
        if cur is None:
            out[key] = it
        else:
            stray += 1
            if _score(it) > _score(cur):
                out[key] = it
    ordered = sorted(out.values(), key=lambda i: (i["chapter"], i["ordinal"], i["num"]))
    return ordered, stray


def material_signature(mat: dict) -> tuple[set, set]:
    """Numbers and vocabulary actually printed inside one 资料, for content matching.

    Accepts both the in-progress shape (rows/pages) and the emitted one (text/segments).
    """
    text = " ".join([
        mat.get("text") or " ".join(mat.get("rows") or []),
        mat.get("title") or "", mat.get("unit") or "",
    ])
    for (pg, y0, y1) in (mat.get("segments") or mat.get("pages") or []):
        doc = page_map_get(pg)
        if not doc:
            continue
        for ln in build_lines(doc):
            if y0 - 8 <= ln.y <= y1 + 8:
                text += " " + ln.text
    return data_values(text), cjk_bigrams(text)


_PAGE_CACHE: dict[int, dict] = {}
_PAGE_MAP: dict[int, dict] = {}


def page_map_get(page: int) -> dict:
    return _PAGE_MAP.get(page, {})


def stamp_quote_matches(items: list[dict], answers: list[dict]) -> int:
    """Which single item does each 解析's `根据题干"…"` quotation describe?

    The 资料's numbers are shared by its five items, so content matching against the
    material cannot tell them apart. The quotation can: it reproduces one stem's own
    wording. Storing (best item, its score, runner-up score) lets the alignment treat a
    decisive quotation as stronger evidence than a printed number, which is what fills
    the holes where OCR mangled one side's numbering.
    """
    nstem = [stem_parts(norm(" ".join(it["stem"]))) for it in items]
    common = frozenset(common_bigrams([norm(" ".join(it["stem"])) for it in items]))
    for i, s in enumerate(nstem):
        items[i]["_i"] = i
    decisive = 0
    for a in answers:
        m = QUOTE.search(a.get("analysis") or "")
        if not m:
            continue
        qn, qb = quote_parts(m.group(1), common)
        if not qn and not qb:
            continue
        best, second, bi = 0.0, 0.0, None
        for j, (sn, sc) in enumerate(nstem):
            if not sn and not sc:
                continue
            sv = score_parts(qn, qb, sn, sc)
            if sv > best:
                best, second, bi = sv, best, j
            elif sv > second:
                second = sv
        a["_qm"] = (bi, best, second)
        if best >= 0.34 and best - second >= 0.10:
            decisive += 1
    return decisive


def content_score(q: dict, a: dict, sig: tuple) -> float:
    """How much of the 解析 actually belongs to this question's 资料.

    A 解析 quotes the numbers and the subject of the data it works on, so this is a
    direct test of the marriage that does not involve the printed numbering at all.
    """
    nums, bigs = sig
    an = a.get("analysis") or ""
    a_nums = data_values(an)
    a_bigs = cjk_bigrams(an)
    score = 0.0
    shared = len(a_nums & nums)
    if shared >= 2:
        score += 3.0
    elif shared == 1:
        score += 1.2
    elif len(a_nums) >= 2 and len(nums) >= 4:
        # Only call this a misfit when the 解析 really works on a data set of its own
        # and none of it is in this 资料; a qualitative 解析 cites nothing and stays neutral.
        score -= 1.5
    vocab = len(a_bigs & bigs)
    if vocab >= 12:
        score += 1.5
    elif vocab >= 4:
        score += 0.7
    return score


def align_local(items: list[dict], answers: list[dict], sigs: dict | None = None) -> tuple[list[tuple], list[dict]]:
    """Needleman-Wunsch on the printed numbers, per chapter.

    Both books have holes (the OCR drops an anchor now and then) and the question book
    also gains phantoms from numbered lines inside a table, so neither a positional zip
    nor a (set, number) key survives a single miss. Scoring equal printed numbers and
    charging for a gap on either side lets the pairing re-anchor after every miss; the
    作业题 ordinal only breaks ties, because it is itself derived from restarts.
    """
    by_ch_q: dict[int, list[dict]] = {}
    by_ch_a: dict[int, list[dict]] = {}
    for it in items:
        by_ch_q.setdefault(it["chapter"], []).append(it)
    for a in answers:
        by_ch_a.setdefault(a["chapter"], []).append(a)

    if sigs:
        for it in items:
            it.setdefault("_sig", sigs.get((it.get("material") or {}).get("id"), (set(), set())))
    pairs: list[tuple] = []
    issues: list[dict] = []
    left_q: list[dict] = []
    left_a: list[dict] = []
    MATCH, GAP = 3.0, 1.2

    for ch in sorted(set(by_ch_q) | set(by_ch_a)):
        Q, A = by_ch_q.get(ch, []), by_ch_a.get(ch, [])
        nq, na = len(Q), len(A)
        prev = [0.0] * (na + 1)
        for j in range(1, na + 1):
            prev[j] = prev[j - 1] - GAP
        back: list[list[int]] = []
        for i in range(1, nq + 1):
            row = [prev[0] - GAP]
            cur_back = [0] * (na + 1)
            for j in range(1, na + 1):
                q, a = Q[i - 1], A[j - 1]
                qm = a.get("_qm")
                # A decisive quotation identifies the item itself, so it outranks the
                # printed numbering; an equal-score runner-up means the stems are the
                # same wording and only the number can separate them.
                decisive = bool(qm) and qm[0] is not None and qm[1] >= 0.34 and qm[1] - qm[2] >= 0.10
                if decisive:
                    score = MATCH + 4.0 + qm[1] if qm[0] == q.get("_i") else -8.0
                elif q["num"] != a["num"]:
                    score = -8.0
                else:
                    # Content decides; the printed number only says which slot to compare.
                    cs = content_score(q, a, q.get("_sig") or (set(), set()))
                    if cs <= -1.5:
                        # The 解析 works on numbers this 资料 never printed: pairing them
                        # would answer the question with someone else's answer, which is
                        # worse than leaving it flagged as unanswered.
                        score = -8.0
                    else:
                        score = MATCH + cs
                        if q.get("ordinal") == a.get("ordinal"):
                            score += 0.5
                diag = prev[j - 1] + score
                up = prev[j] - GAP          # question without answer
                left = row[j - 1] - GAP     # answer without question
                best = max(diag, up, left)
                row.append(best)
                cur_back[j] = 0 if best == diag else (1 if best == up else 2)
            back.append(cur_back)
            prev = row

        i, j = nq, na
        steps: list[tuple] = []
        while i > 0 or j > 0:
            if i == 0:
                steps.append((None, A[j - 1])); j -= 1; continue
            if j == 0:
                steps.append((Q[i - 1], None)); i -= 1; continue
            move = back[i - 1][j]
            if move == 0:
                steps.append((Q[i - 1], A[j - 1])); i -= 1; j -= 1
            elif move == 1:
                steps.append((Q[i - 1], None)); i -= 1
            else:
                steps.append((None, A[j - 1])); j -= 1
        steps.reverse()

        for q, a in steps:
            if q and a:
                pairs.append((q, a, "dp-num"))
            elif q:
                pairs.append((q, None, "dp-num"))
                left_q.append(q)
                issues.append({"type": "question-without-answer", "chapter": ch,
                               "num": q["num"], "page": q["page"]})
            else:
                left_a.append(a)
                issues.append({"type": "answer-without-question", "chapter": ch,
                               "num": a["num"], "page": a["page"]})

    # Second chance for holes the per-chapter DP cannot reach: an OCR'd chapter header
    # can be missing on one side, which orphans a whole block of answers (pages 83-88 of
    # the 资料分析 answer book are exactly that). A leftover is paired only when the
    # evidence is unambiguous — the printed number *and* the 作业题 ordinal agree, or the
    # 解析's 题干 quotation names this item decisively.
    taken: set[int] = set()
    recovered: list[tuple] = []
    for q in left_q:
        cands = []
        for a in left_a:
            if id(a) in taken:
                continue
            qm = a.get("_qm")
            decisive = (bool(qm) and qm[0] == q.get("_i")
                        and qm[1] >= 0.34 and qm[1] - qm[2] >= 0.10)
            same = (bool(q["num"]) and q["num"] == a["num"] and q.get("ordinal") == a.get("ordinal")
                    and q["chapter"] == a["chapter"])
            if same and content_score(q, a, q.get("_sig") or (set(), set())) <= -1.5:
                continue  # the DP already proved this 解析 works on a different 资料
            if decisive:
                # a quotation that names this stem and no other item is identity evidence,
                # so it may come from another chapter's part of the answer book; the
                # page-monotonicity guard below still rejects it if the order says otherwise
                cands.append((0, a))
            elif same and abs((a.get("chapter") or 0) - (q.get("chapter") or 0)) <= 1:
                cands.append((1, a))
        if not cands:
            continue
        if len(cands) > 1 and not any(c[0] == 0 for c in cands):
            continue  # several candidates, nothing separates them: keep it flagged
        best = sorted(cands, key=lambda c: c[0])[0][1]
        taken.add(id(best))
        recovered.append((q, best))
    for q, a in recovered:
        for k, p in enumerate(pairs):
            if p[0] is q and not p[1]:
                pairs[k] = (q, a, "fill-leftover")
                break
        left_a[:] = [x for x in left_a if x is not a]
    # A recovered answer must not land *before* one already used in the chapter: the
    # answer book runs in question order, so a backwards page means the match was wrong
    # and an open hole is the honest outcome.
    last_pg: dict[int, int] = {}
    kept = 0
    for k in sorted(range(len(pairs)),
                   key=lambda k: (pairs[k][0]["chapter"], pairs[k][0].get("ordinal", 0),
                                  pairs[k][0]["num"])):
        q, a, how = pairs[k]
        if a is None:
            continue
        pg = a.get("page") or 0
        ch = q["chapter"]
        if pg:
            if how == "fill-leftover" and last_pg.get(ch, 0) > pg + 2:
                pairs[k] = (q, None, "dp-num")
                continue
            last_pg[ch] = max(last_pg.get(ch, 0), pg)
            if how == "fill-leftover":
                kept += 1
    if kept:
        issues.append({"type": "leftover-recovered", "count": kept})
    else:
        issues[:] = [i for i in issues if i.get("type") != "leftover-recovered"]

    pairs.sort(key=lambda p: (p[0]["chapter"], p[0].get("ordinal", 0), p[0]["num"]))
    return pairs, issues


def align_by_material(items: list[dict], answers: list[dict],
                     sigs: dict) -> tuple[list[tuple], list[dict]]:
    """Identify the 资料 by content, then the item inside it by number and order.

    The two books' printed numbers disagree wherever the OCR lost an anchor, so
    number-equality alone both misses real answers and — the dangerous failure — marries
    a question to another 资料's answer that happens to share its number. Content decides
    which group an answer belongs to; the number and the order only pick which of the five.

    Values like "10" or "100" appear in nearly every table, so a number only counts when
    it is distinctive to at most two 资料; assignment is then greedy on the best-scoring
    pairs rather than first-come, which is what let early groups steal later answers.
    """
    freq: Counter = Counter()
    for nums, _b in sigs.values():
        for v in set(nums):
            freq[v] += 1
    distinct = {mid: {v for v in nums if freq[v] <= 2} for mid, (nums, _b) in sigs.items()}

    q_mat = {id(it): (it.get("material") or {}).get("id", "") for it in items}
    cand: list[tuple[float, dict, dict]] = []
    for a in answers:
        an = data_values(a.get("analysis") or "")
        if not an:
            continue
        for it in items:
            d = distinct.get(q_mat[id(it)])
            if not d:
                continue
            shared = len(an & d)
            if shared >= 2:
                score = shared * 1.0 + (2.0 if a["num"] == it["num"] else -0.3 * abs(a["num"] - it["num"]))
                cand.append((score, it, a))
    cand.sort(key=lambda t: (-t[0], t[2]["page"], t[1]["num"]))

    taken_q: set[int] = set()
    taken_a: set[int] = set()
    matched: dict[int, tuple] = {}
    for score, it, a in cand:
        if id(it) in taken_q or id(a) in taken_a:
            continue
        if abs(a["num"] - it["num"]) > 6 and score < 5:
            continue
        taken_q.add(id(it))
        taken_a.add(id(a))
        matched[id(it)] = (a, "material-content" if a["num"] == it["num"] else "material-content±num")
        if a["num"] != it["num"]:
            it["num_disagrees"] = a["num"]

    pairs = [(it, matched.get(id(it), (None, "unmatched"))[0],
              matched.get(id(it), (None, "unmatched"))[1]) for it in items]
    issues = [{"type": "question-without-answer", "chapter": it["chapter"],
               "material": q_mat[id(it)], "num": it["num"], "page": it["page"]}
              for it in items if id(it) not in taken_q]
    for a in answers:
        if id(a) not in taken_a:
            issues.append({"type": "unused-answer", "num": a["num"], "page": a["page"]})
    pairs.sort(key=lambda p: (p[0]["chapter"], p[0].get("ordinal", 0), p[0]["num"]))
    return pairs, issues


def assemble(materials: list[dict], items: list[dict], answers: list[dict],
             end_up: int, sigs: dict | None = None) -> tuple[list[dict], list[dict], list[dict]]:
    page_map = {p["page"]: p for p in load_pages(CFG_TAG("up"), 1, end_up)}
    items, dropped = sequence(items)
    assign_ordinals(answers)
    if sigs is None:
        sigs = {(it.get("material") or {}).get("id"): it["_sig"] for it in items if it.get("_sig")}
    # Number equality stays mandatory: the five items of one 资料 share all of its
    # numbers, so content alone cannot tell which of them an answer belongs to. Content
    # is used as a veto inside align_local, which is what removes the cross-资料 pairings.
    pairs, issues = align_local(items, answers, sigs)
    issues.append({"type": "dedupe-dropped", "count": dropped})
    questions: list[dict] = []
    seq: dict[int, int] = defaultdict(int)
    used: set[str] = set()

    for pair in pairs:
        # parse_bank.align yields (item, answer, pairing-method) — the method is
        # reported by parse_bank's own writer, so it is only logged here.
        it, ans = pair[0], pair[1]
        it["chapter"] = it["chapter"] or 1
        it["chapterIndex"] = it["chapter"]
        seq[it["chapter"]] += 1
        idx = seq[it["chapter"]]
        mat = it.get("material")
        stem = norm(" ".join(it["stem"]))
        options = split_options(it["opts"])
        bands = PB.figure_band(it, page_map)
        has_fig = bool(bands and bands[0]["h"] >= 55)

        flags: list[str] = []
        if not ans:
            flags.append("no-answer")
        if not options:
            flags.append("no-options")
        elif len(options) < 4 and not has_fig:
            flags.append(f"options-{len(options)}")
        if len(stem) < 6:
            flags.append("empty-stem")
        if options and CIRCLED.search(stem) and all(
                re.fullmatch(r"[0-9]{2,6}", o["text"] or "") for o in options if o["text"]):
            # 排序题的选项是 ①②③④ 的排列，OCR 常把带圈数字读成普通数字 → 必须看原图
            flags.append("options-circled")
        if not mat or not mat["rows"] and not mat["title"]:
            flags.append("no-material")
        conf = sum(it["scores"]) / len(it["scores"]) if it["scores"] else 0
        if conf < 0.82:
            flags.append("ocr-low")

        src = None
        if it.get("source"):
            mm = re.search(r"[（(]?((?:19|20)\d{2})?([^{（()）]{0,14}?)(\d{1,4})?[）)]?", it["source"])
            if mm:
                src = {"year": int(mm.group(1)) if mm.group(1) else None,
                       "region": norm(mm.group(2) or "") or None,
                       "code": mm.group(3), "raw": it["source"]}
        if not src and mat and mat.get("source"):
            mm = re.search(r"[（(]((?:19|20)\d{2})?([^{（()）]{0,14}?)(\d{1,4}[～~]\d{1,4})?[）)]",
                           mat["source"])
            if mm:
                src = {"year": int(mm.group(1)) if mm.group(1) else None,
                       "region": norm(mm.group(2) or "") or None,
                       "code": mm.group(3), "raw": mat["source"]}

        prefix = PB.CFG["idPrefix"]
        qid = f"{prefix}c{it['chapter']}-{idx:04d}"
        if mat:
            used.add(mat["id"])
        questions.append({
            "id": qid,
            "bankId": PB.BANK_ID,
            "chapterIndex": it["chapter"],
            "chapterTitle": it["chapterTitle"] or f"第{it['chapter']}章",
            "sectionTitle": it.get("section"),
            "pointTitle": None,
            "drillTitle": it.get("set"),
            "blockTitle": it.get("set"),
            "num": it["num"],
            "kind": "figure" if has_fig else "text",
            "stem": stem,
            "options": options,
            "materialId": (prefix + mat["id"]) if mat else None,
            "answer": ans["answer"] if ans else None,
            "analysis": clean_analysis(ans["analysis"]) if ans else None,
            "accuracy": ans["accuracy"] if ans else None,
            "trapOption": ans["trap"] if ans else None,
            "source": src,
            "figureImage": None,
            "cropImage": None,
            "hasImage": has_fig,
            "pageRef": {"tag": CFG_TAG("up"), "page": it["page"], "bookPage": it["bookPage"],
                        "bbox": [round(it["x0"]), round(it["y0"]),
                                 round(it["x1"] - it["x0"]), round(it["y1"] - it["y0"])]},
            "answerPageRef": ({"tag": CFG_TAG("dn"), "page": ans["page"], "bookPage": None,
                               "bbox": [150, round(ans["y0"]), 1100, round(ans["y1"] - ans["y0"])]}
                              if ans else None),
            "ocrConfidence": round(conf, 3),
            "flags": flags,
            "segments": it["pages"],
            "bands": bands,
        })

    out_mats = []
    for m in materials:
        if m["id"] not in used:
            continue
        text = "\n".join(m["rows"])
        if not m["rows"]:
            kind = "chart"  # 图形资料: nothing the OCR could read but a picture
        else:
            digits = sum(c.isdigit() for c in text)
            letters = sum(1 for c in text if "一" <= c <= "鿿")
            kind = "table" if digits >= letters else "text"
        out_mats.append({
            "id": PB.CFG["idPrefix"] + m["id"],
            "bankId": PB.BANK_ID,
            "chapterIndex": m["chapter"] or 1,
            "chapterTitle": m["chapterTitle"],
            "sectionTitle": m["sectionTitle"],
            "setTitle": m["setTitle"],
            "groupLabel": m["groupLabel"],
            "kind": kind,
            "title": m["title"],
            "unit": m["unit"],
            "text": norm_rows(text),
            "image": None,
            "source": m["source"],
            "pageRef": {"tag": CFG_TAG("up"), "page": m["page"], "bookPage": m["bookPage"],
                        "bbox": [150, round(m["y0"]), 1090, round(m["y1"] - m["y0"])]},
            "segments": m["pages"],
            "ocrConfidence": round(sum(m["scores"]) / len(m["scores"]), 3) if m["scores"] else 0,
        })
    return questions, out_mats, issues


def norm_rows(text: str) -> str | None:
    """Keep table rows readable: collapse the OCR's ragged spacing into cells."""
    if not text:
        return None
    lines = []
    for ln in text.split("\n"):
        cells = re.split(r"\s{2,}|\s+(?=\d)", ln.strip())
        cells = [c for c in cells if c]
        lines.append(" | ".join(cells) if len(cells) > 2 else ln.strip())
    return "\n".join([l for l in lines if l]) or None


def write_outputs(questions: list[dict], materials: list[dict], issues: list[dict],
                  notes: list[dict]) -> None:
    out = PB.OUT_DIR
    out.mkdir(parents=True, exist_ok=True)
    (out / "questions.json").write_text(json.dumps(questions, ensure_ascii=False), encoding="utf-8")
    (out / "materials.json").write_text(json.dumps(materials, ensure_ascii=False), encoding="utf-8")

    chapters: dict[int, dict] = {}
    for q in questions:
        ch = chapters.setdefault(q["chapterIndex"], {
            "index": q["chapterIndex"], "title": q["chapterTitle"],
            "count": 0, "answered": 0, "sections": {}, "points": {}})
        ch["count"] += 1
        ch["answered"] += 1 if q["answer"] else 0
        sec_t = q["sectionTitle"] or ch["title"]
        sec = ch["sections"].setdefault(sec_t, {"title": sec_t, "count": 0, "points": {}})
        sec["count"] += 1
        pt_t = q["drillTitle"] or "综合"
        sec["points"].setdefault(pt_t, {"title": pt_t, "count": 0})["count"] += 1
        ch["points"][pt_t] = sec["points"][pt_t]

    taxonomy, points_flat = [], []
    for idx in sorted(chapters):
        ch = chapters[idx]
        secs = []
        for st in sorted(ch["sections"].values(), key=lambda s: -s["count"]):
            pts = sorted(st["points"].values(), key=lambda p: -p["count"])
            secs.append({"title": st["title"], "count": st["count"], "points": pts})
            for pt in pts:
                points_flat.append({"chapterIndex": idx, "chapterTitle": ch["title"],
                                    "sectionTitle": st["title"], "title": pt["title"],
                                    "count": pt["count"]})
        taxonomy.append({"index": ch["index"], "title": ch["title"], "count": ch["count"],
                         "answered": ch["answered"], "sections": secs})

    tags = [PB.CFG["tag"]["up"], PB.CFG["tag"]["dn"]]
    meta = {
        "bankId": PB.BANK_ID,
        "bookTitle": PB.CFG["bookTitle"],
        "subject": PB.CFG["title"],
        "layout": "material-group",
        "builtAt": datetime.now().isoformat(timespec="seconds"),
        "totals": {
            "questions": len(questions),
            "withAnswer": sum(1 for q in questions if q["answer"]),
            "withAnalysis": sum(1 for q in questions if q["analysis"]),
            "withFigure": sum(1 for q in questions if q["hasImage"]),
            "materials": len(materials),
            "pagesOcr": sum(len(list((ROOT / "data" / "ocr" / t).glob("*.json"))) for t in tags
                            if (ROOT / "data" / "ocr" / t).exists()),
            # lets the UI show OCR progress instead of an apparently empty module
            "pagesTotal": sum(PB.CFG["pages"].values()),
        },
        "chapters": taxonomy,
        "points": points_flat,
    }
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    (out / "issues.json").write_text(
        json.dumps({"issues": issues, "notes": notes[:400]}, ensure_ascii=False, indent=1),
        encoding="utf-8")
    flags = Counter(f for q in questions for f in q["flags"])
    print(json.dumps({"layout": "material-group", "questions": len(questions),
                      "materials": len(materials),
                      "withAnswer": meta["totals"]["withAnswer"],
                      "flags": dict(flags),
                      "chapters": {str(k): v["count"] for k, v in chapters.items()}},
                     ensure_ascii=False, indent=1))


def stamp_signatures(items: list[dict], materials: list[dict], end_up: int) -> None:
    _PAGE_MAP.clear()
    for p in load_pages(CFG_TAG("up"), 1, end_up):
        _PAGE_MAP[p["page"]] = p
    sigs = {m["id"]: material_signature(m) for m in materials}
    for it in items:
        it["_sig"] = sigs.get((it.get("material") or {}).get("id"), (set(), set()))


def run(bank_id: str, end_up: int, end_dn: int) -> int:
    PB.use_bank(bank_id)
    answers, an = PB.parse_answer_stream(end_dn)
    print(f"answer entries: {len(answers)}", flush=True)
    materials, items, qn = parse_stream(end_up)
    print(f"material groups: {len(materials)}, items: {len(items)}", flush=True)
    stamp_signatures(items, materials, end_up)
    dec = stamp_quote_matches(items, answers)
    print(f"decisive 题干 quotations: {dec}", flush=True)
    sigs = {(it.get("material") or {}).get("id"): it["_sig"] for it in items if it.get("_sig")}
    questions, out_mats, issues = assemble(materials, items, answers, end_up, sigs)
    PB.reattach_assets(questions)
    write_outputs(questions, out_mats, issues, an + qn)
    return 0


def main() -> int:
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--bank", default="ziliao", choices=list(books.BANKS))
    ap.add_argument("--end-up", type=int, default=10**9)
    ap.add_argument("--end-dn", type=int, default=10**9)
    args = ap.parse_args()
    return run(args.bank, args.end_up, args.end_dn)


if __name__ == "__main__":
    sys.exit(main())
