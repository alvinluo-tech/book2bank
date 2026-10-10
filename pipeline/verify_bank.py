"""Per-question verification of every bank: completeness + question↔answer marriage.

The pairing itself is produced by parse_bank/parse_material, so re-checking it with
the same numbering logic would prove nothing. This pass asks each question a set of
*independent* questions instead:

  marriage     the 解析 stored on the question really talks about this question
               (shared data values for 资料分析/数量关系, shared Chinese content
               words for 定义/类比/逻辑), and its own conclusion matches the letter
  anchor       the 下册 page actually carries `N.【答案】X` with this number and letter
  order        answer pages never run backwards inside a chapter
  options      the answer letter is one of the printed options
  integrity    no duplicated stem, no shared answer object, no missing number in a block

Outputs data/banks/<bank>/verification.json (one verdict per question) and prints a
summary. Exit code 1 when anything is left in the `suspect` bucket.

corrections.json is merged into the bank before judging (see pipeline/corrections.py), so
a field that has been verified against the scan by hand is checked as the app serves it.

  python pipeline/verify_bank.py                 # every bank
  python pipeline/verify_bank.py --bank ziliao
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import books  # noqa: E402
import corrections  # noqa: E402
from bank_lines import build_lines, load_pages  # noqa: E402

ROOT = books.ROOT
ANS_ANCHOR = re.compile(r"(?<![\d.])(\d{1,3})\s*[.、．]?\s*[\[【（(]{0,2}\s*答\s*案\s*(?:[\]】）)][:：]?|[:：])?\s*([A-H])")
CONCLUSION = re.compile(r"故正确答案为\s*([A-H])|正确答案应为\s*([A-H])|答案\s*[:：]\s*([A-H])")
YEARS = re.compile(r"(?<!\d)(?:19|20)\d{2}(?!\d)")  # only a standalone year, not the 2008 inside 12008
NUM = re.compile(r"\d+(?:\.\d+)?")
CJK = re.compile(r"[㐀-䶿一-鿿]")
SRC_PAREN = re.compile(r"[（(][^（()）]{0,20}[)）]")


def cjk_bigrams(text: str) -> set:
    chars = CJK.findall(text or "")
    return {"".join(chars[i:i + 2]) for i in range(len(chars) - 1)}


def data_values(text: str) -> set:
    """Numbers worth comparing: drop years and the source tag, keep the data."""
    if not text:
        return set()
    t = SRC_PAREN.sub("", YEARS.sub("", text))
    out = set()
    for m in NUM.finditer(t):
        v = m.group(0)
        if "." in v:
            out.add(v)
        elif len(v) >= 2:
            out.add(v)
    return out


BOILER = re.compile(r"从所给的四个选项中|最合适的一个填入问号处|下列选项中最符合所给图形规律|根据上述定义|下列属于|下列不属于|没有体现|能够推出|不能推出|由此可以推出")
# 资料分析's 解析 opens with an elided quotation of the one stem it explains:
# `根据题干"2023年…约是2020年…多少倍"`. The 资料's own numbers are shared by all five
# items of the group, so this quotation is the only *item-level* proof of marriage.
QUOTE = re.compile(r"根据题干\s*[\"“”'『「]?\s*([^\"“”'』」。]{4,70})")
ELL = re.compile(r"[.…·、,，\-—_/()（）\s]+")  # `+`, never `*`: it would match at every position
RANGE_DASH = re.compile(r"(?<=\d)[一—–~～](?=\d)")  # OCR reads the 1—2 range dash as the character 一
ALL_NUM = re.compile(r"\d+(?:\.\d+)?")
CJK_RUN = re.compile(r"[㐀-䶿一-鿿]+")
_pages_cache: dict[tuple, dict] = {}


def common_bigrams(texts: list[str], share: float = 0.02) -> set:
    """Vocabulary that a fifth of the bank's stems share is not evidence.

    `根据题干"…同比增长"' fits any growth question, so a rival that merely contains it
    must not be able to win the quotation test. Numbers are exempt: 2023 vs 2019一2022 is
    exactly how two otherwise identical stems differ.
    """
    df: Counter = Counter()
    for t in texts:
        for b in set(cjk_bigrams(t)):
            df[b] += 1
    n = max(1, len(texts))
    return {b for b, c in df.items() if c / n > share}


def quote_parts(quote: str, common: frozenset = frozenset()) -> tuple[list[str], list[str]]:
    """The quotation's own numbers and Chinese runs, kept separate because they need
    different tests: a number must match a whole printed number, while a Chinese
    fragment may sit anywhere inside the stem."""
    t = ELL.sub(" ", RANGE_DASH.sub(" ", quote or ""))
    nums = [n for n in ALL_NUM.findall(t) if len(n.replace(".", "")) >= 2]
    bigs: list[str] = []
    for run in CJK_RUN.findall(t):
        bigs += [run[i:i + 2] for i in range(len(run) - 1)] if len(run) >= 2 else []
    if common:
        bigs = [b for b in bigs if b not in common]
    return nums, bigs


def stem_parts(stem: str) -> tuple[set[str], str]:
    """Numbers a stem can vouch for: each printed run, plus runs joined across a range
    dash ("1一2" backs "12"), and never a *substring* of a longer number ("2012" does
    not back "12")."""
    t = stem or ""
    runs = ALL_NUM.findall(RANGE_DASH.sub(" ", t))
    nums = set(runs)
    for i in range(len(runs) - 1):
        nums.add(runs[i] + runs[i + 1])
    return {x for x in nums if len(x.replace(".", "")) >= 2}, "".join(CJK_RUN.findall(t))


def parts_hits(qn: list[str], qb: list[str], sn: set[str], sc: str) -> tuple[int, int]:
    """(tokens this stem vouches for, tokens in the quotation)."""
    if not qn and not qb:
        return (0, 0)
    hit = sum(1 for x in qn if x in sn) + sum(1 for x in qb if x in sc)
    return (hit, len(qn) + len(qb))


def score_parts(qn: list[str], qb: list[str], sn: set[str], sc: str) -> float:
    hit, total = parts_hits(qn, qb, sn, sc)
    return hit / total if total else 0.0


def quote_tokens(text: str) -> list[str]:
    nums, bigs = quote_parts(text)
    return nums + bigs


def quote_score(quote: str, stem: str) -> float:
    """Fraction of the quotation's content that this stem actually vouches for."""
    qn, qb = quote_parts(quote)
    sn, sc = stem_parts(stem)
    return score_parts(qn, qb, sn, sc)


def page_doc(tag: str, page: int) -> dict:
    key = (tag, page)
    if key not in _pages_cache:
        path = ROOT / "data" / "ocr" / tag / f"p{page:03d}.json"
        _pages_cache[key] = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    return _pages_cache[key]


def band_text(tag: str, segments: list, pad: int = 8) -> str:
    """OCR text inside a 资料's page band — including the numbers printed inside a chart."""
    chunks: list[str] = []
    for seg in segments or []:
        pg, y0, y1 = seg[0], seg[1], seg[2]
        doc = page_doc(tag, pg)
        if not doc:
            continue
        for ln in build_lines(doc):
            if y0 - pad <= ln.y <= y1 + pad:
                chunks.append(ln.text)
    return " ".join(chunks)


def answer_page_anchor_list(tag: str, page: int) -> list:
    """Every `N.【答案】X` printed on that 下册 page, with its y in OCR pixels.

    A page can legitimately carry the same number twice — （一）夯实基础 and
    （二）高难进阶 restart their numbering mid-page — so "first match on the page" is not
    a valid reading of the anchor: it reported letters as disagreeing when both were
    printed and belonged to different blocks.
    """
    path = ROOT / "data" / "ocr" / tag / f"p{page:03d}.json"
    if not path.exists():
        return []
    doc = json.loads(path.read_text(encoding="utf-8"))
    found: list = []
    for ln in build_lines(doc):
        m = ANS_ANCHOR.search(ln.text)
        if m:
            found.append((int(m.group(1)), m.group(2), ln.y))
    return found


def printed_anchor_letter(cands: list, num, cited_y):
    """The anchor nearest the crop the pipeline actually stored, for that number."""
    same = [c for c in cands if c[0] == num]
    if not same:
        return None
    if len(same) == 1 or cited_y is None:
        return same[0][1]
    return min(same, key=lambda c: abs(c[2] - cited_y))[1]


def answer_page_anchors(tag: str, page: int) -> dict:
    """num -> letter, as actually printed on that 下册 page (first occurrence)."""
    found: dict[int, str] = {}
    for num, letter, _y in answer_page_anchor_list(tag, page):
        found.setdefault(num, letter)
    return found


def boiler_bigrams(questions: list) -> set:
    """Stems that repeat across a chapter prove nothing; drop them from the test.

    图形推理 stems are boilerplate ("从所给的四个选项中…") and the 解析 repeats the same
    vocabulary, so a naive overlap ratio passes for every question — including a mispaired
    one. Only the rare part of a stem is evidence of marriage.
    """
    df: Counter = Counter()
    for q in questions:
        for bg in cjk_bigrams(q.get("stem") or ""):
            df[bg] += 1
    n = max(1, len(questions))
    return {bg for bg, c in df.items() if c / n > 0.30}


def marriage_evidence(q: dict, mats: dict) -> tuple[str, float]:
    """strong / weak / none — how much the stored 解析 is provably about this question."""
    stem = q.get("stem") or ""
    analysis = q.get("analysis") or ""
    if not analysis:
        return ("none", 0.0)
    pool_text = stem
    mat = None
    if q.get("materialId"):
        mat = mats.get(q["materialId"]) or {}
        pool_text += " " + (mat.get("title") or "") + " " + (mat.get("text") or "") + " " + band_text(
            (mat.get("pageRef") or {}).get("tag", ""), mat.get("segments"))
    nums_shared = len(data_values(analysis) & data_values(pool_text))
    bank_boiler = BOILER_CACHE.get(q.get("bankId") or "", {})
    boiler = bank_boiler.get(q.get("chapterIndex"), set()) if isinstance(bank_boiler, dict) else set()
    sb = cjk_bigrams(stem) - boiler
    ab = cjk_bigrams(analysis)
    rare = len(sb & ab) if sb else 0
    if nums_shared >= 2 or rare >= 6:
        return ("strong", float(nums_shared * 2 + rare))
    if nums_shared >= 1 or rare >= 2:
        return ("weak", float(nums_shared * 2 + rare))
    # 图形推理 stems are one boilerplate sentence: after the boilerplate is removed
    # there is nothing left to compare, which is not evidence of a wrong pairing.
    if len(sb) < 3 and nums_shared == 0:
        return ("untestable", 0.0)
    return ("none", 0.0)


BOILER_CACHE: dict[str, set] = {}


def verify_bank(bank_id: str) -> dict:
    cfg = books.get_bank(bank_id)
    out_dir = cfg["outDir"]
    questions = json.loads((out_dir / "questions.json").read_text(encoding="utf-8"))
    # Judge the bank the learner actually sees: corrections.json is merged by
    # src/lib/bank.ts at load, so verifying the raw OCR output would keep reporting a
    # hand-verified answer as `no-answer` and contradict the app's own 已人工校正 badge.
    fixed, drift = corrections.apply_for_bank(out_dir, questions)
    mats = {}
    mpath = out_dir / "materials.json"
    if mpath.exists():
        mats = {m["id"]: m for m in json.loads(mpath.read_text(encoding="utf-8"))}
    layout = cfg.get("layout", "flat")
    # per chapter: 图形推理 is only a quarter of 判断推理, so a bank-wide frequency
    # threshold leaves its boilerplate in place and every figure question then looks
    # either falsely proven or falsely contradicted.
    by_ch: dict[int, list] = {}
    for q in questions:
        by_ch.setdefault(q.get("chapterIndex"), []).append(q)
    BOILER_CACHE[bank_id] = {ch: boiler_bigrams(rows) for ch, rows in by_ch.items()}

    anchor_cache: dict[tuple, list] = {}
    verdicts: list[dict] = []
    seen_stems: dict[str, str] = {}
    # a printed number is only an identifier if the chapter uses it once: 夯实基础 and
    # 综合练习 both restart at 1, so page+number must be unique across the chapter's claims
    claim_ct: Counter = Counter()
    for q in questions:
        if q.get("answer"):
            apq = q.get("answerPageRef") or {}
            bb = apq.get("bbox") or [0, 0, 0, 0]
            # a page can carry two blocks that both restart at "1." — the pair is only
            # ambiguous when the two claims sit at the same height on that page
            claim_ct[(apq.get("page"), q.get("num"), int(bb[1] // 600))] += 1
    claimed_once = {k for k, c in claim_ct.items() if c == 1}
    nstem = [stem_parts(q.get("stem") or "") for q in questions]
    QM = frozenset(common_bigrams([q.get("stem") or "" for q in questions]))
    # every 资料 in the bank, flattened: a "stem" that is verbatim one of these is a
    # table row or a paragraph the OCR mistook for a question
    ALL_MAT_TEXT = [ELL.sub("", " ".join([(m.get("text") or ""),
                                          " ".join(m.get("rows") or []),
                                          band_text((m.get("pageRef") or {}).get("tag", ""),
                                                      m.get("segments"))]))
                        for m in mats.values()]

    def best_rival(quote: str, skip: int) -> tuple[str | None, float, int]:
        """Bank-wide: could any other stem explain this 解析 better than its own?"""
        qn, qb = quote_parts(quote, QM)
        if not qn and not qb:
            return (None, 0.0, 0)
        best, bid, bhits = 0.0, None, 0
        for j, (sn, sc) in enumerate(nstem):
            if j == skip or not (sn or sc):
                continue
            h, total = parts_hits(qn, qb, sn, sc)
            sv = h / total if total else 0.0
            if sv > best:
                best, bid, bhits = sv, questions[j]["id"], h
        return (bid, best, bhits)

    for i, q in enumerate(questions):
        reasons: list[str] = []
        notes: list[str] = []
        stem = q.get("stem") or ""
        analysis = q.get("analysis") or ""
        printed_on_page = None
        answer = q.get("answer")
        opts = [o.get("label") for o in q.get("options") or []]

        # ---- completeness -------------------------------------------------
        if not stem.strip():
            reasons.append("empty-stem")
        if not answer:
            reasons.append("no-answer")
        if answer and not analysis.strip():
            notes.append("no-analysis")

        # ---- the stored answer object must be unique to this question -----
        # reported as a post-pass over every claimant, not here: seeing only the later
        # claim let a 方法论段落 keep a real question's 解析 and pass while the question
        # that owns it came out the suspect one.
        ap = q.get("answerPageRef") or {}

        # ---- duplicate stems (a merged pair of items) ----------------------
        # 图形推理 stems are boilerplate and legitimately identical; only a repeated
        # stem with real content means two items got merged.
        skey = re.sub(r"\s+", "", stem)[:40]
        if len(skey) > 8 and not BOILER.search(stem):
            if skey in seen_stems:
                notes.append(f"duplicate-stem-head(with:{seen_stems[skey]})")
            else:
                seen_stems[skey] = q["id"]

        # ---- options -------------------------------------------------------
        if answer and opts and answer not in opts:
            reasons.append(f"answer-not-in-options({answer}!={'/'.join(opts) or 'none'})")
        if opts:
            long_tail = [o for o in (q.get("options") or [])
                         if (o.get("text") or "").strip() and not re.search(r"[。？?：:；;\d%]$", (o["text"] or "").strip())
                         and len((o["text"] or "").strip()) >= 28]
            if long_tail:
                notes.append("option-maybe-truncated")
        if not opts and layout == "flat" and not q.get("figureImage"):
            reasons.append("no-options-and-no-figure")

        # ---- anchor really exists on the cited 下册 page -------------------
        if answer and ap.get("page"):
            key = (ap.get("tag"), ap.get("page"))
            if key not in anchor_cache:
                anchor_cache[key] = answer_page_anchor_list(key[0], key[1])
            cands = anchor_cache[key]
            cited_y = (ap.get("bbox") or [0, 0, 0, 0])[1] or None
            printed_on_page = printed_anchor_letter(cands, q.get("num"), cited_y)
            printed = printed_on_page
            dup = sum(1 for c in cands if c[0] == q.get("num"))
            if printed is None:
                notes.append("anchor-num-not-on-page")
            else:
                if dup > 1:
                    notes.append(f"number-restarts-on-page({dup} entries share it)")
                if printed != answer:
                    reasons.append(f"anchor-letter-disagrees(page says {printed})")

        # ---- the 解析's own conclusion -------------------------------------
        concl = CONCLUSION.search(analysis)
        concl_letter = next((g for g in concl.groups() if g), None) if concl else None
        if answer and concl_letter and concl_letter != answer:
            reasons.append(f"analysis-conclusion-{concl_letter}")

        # ---- topical marriage (independent of numbering) -------------------
        q_own = 0.0
        if answer and analysis:
            if layout == "material-group":
                mat = mats.get(q.get("materialId") or "") or {}
                pool = (data_values(stem) | data_values(mat.get("text"))
                        | data_values(band_text((mat.get("pageRef") or {}).get("tag", ""), mat.get("segments"))))
                a_nums = data_values(analysis)
                shared = a_nums & pool
                # 解析 usually either quotes the 资料's numbers or names its subject; a
                # rounded calculation ("2300+2200…" for a table of 2316/2222) still shares
                # the topic, so only a double failure — no number AND no vocabulary —
                # means the answer belongs to another question.
                topic = cjk_bigrams(stem + " " + (mat.get("title") or "") + " "
                                    + band_text((mat.get("pageRef") or {}).get("tag", ""), mat.get("segments")))
                ab = cjk_bigrams(analysis)
                topic_hit = len(ab & topic) / max(1, len(ab)) if topic else 0.0
                if len(a_nums) >= 3 and len(pool) >= 4 and not shared and topic_hit < 0.06:
                    reasons.append(f"analysis-not-about-this-material(nums0,topic{topic_hit:.2f})")
                elif len(a_nums) >= 3 and len(pool) >= 4 and not shared:
                    notes.append(f"rounded-or-derived-numbers(topic{topic_hit:.2f})")
            else:
                boiler = BOILER_CACHE[bank_id].get(q.get("chapterIndex"), set())
                sb = cjk_bigrams(stem) - boiler
                ab = cjk_bigrams(analysis)
                if len(sb) >= 6 and ab:
                    jac = len(sb & ab) / max(1, len(sb))
                    if jac < 0.05:
                        reasons.append(f"analysis-off-topic({jac:.2f})")
                    elif jac < 0.12:
                        notes.append(f"low-topic-overlap({jac:.2f})")

            qm = QUOTE.search(analysis)
            if qm:
                q_own = score_parts(*quote_parts(qm.group(1), QM), *nstem[i])
                rival, r_score, r_hits = best_rival(qm.group(1), i)
                o_hits, total = parts_hits(*quote_parts(qm.group(1), QM), *nstem[i])
                # One token apart is OCR noise; a mispair has to differ by two tokens,
                # or the rival has to satisfy a long quotation that this stem cannot.
                gap = r_hits - o_hits
                if q_own >= 0.34 and (gap >= 2 or (r_hits == total >= 5 and o_hits < total)):
                    reasons.append(f"analysis-quotes-another-item({rival}:+{gap}tokens,"
                                   f"{r_score:.2f}>{q_own:.2f})")

        # ---- a stem that is verbatim inside a 资料 is prose, not a question
        if layout == "material-group":
            sn = ELL.sub("", stem)
            if (len(sn) >= 18 and any(sn in t for t in ALL_MAT_TEXT)
                    and not re.search(r"[？?：:]$", stem.strip())
                    and len(opts) < 4):
                reasons.append("stem-is-material-prose")

        # ---- structural proof: the book's own printed anchor, independent of text ----
        proof: list[str] = []
        if answer and ap.get("page"):
            if printed_on_page == answer:
                proof.append("anchor-printed-on-page")   # 该页确实印着 N.【答案】<同一字母>
            if concl_letter == answer:
                proof.append("analysis-conclusion")      # 解析末尾自己说"故正确答案为X"
            # 图形题的选项是四张图，没有可读的 A/B/C/D 文字：无选项可检 ≠ 答案越界
            if not opts or answer in opts:
                proof.append("answer-in-options" if opts else "no-options-to-test")
            if (ap.get("page"), q.get("num"), int((ap.get("bbox") or [0, 0, 0, 0])[1] // 600)) in claimed_once:
                proof.append("unique-anchor-in-chapter")

        evidence, ev_score = marriage_evidence({**q, "bankId": bank_id}, mats)
        proven = q_own >= 0.34 and not any(r.startswith("analysis-quotes-another") for r in reasons)
        if answer and proven:
            # the 解析 names this stem's own wording: item-level proof, not group-level
            evidence, ev_score = ("quoted", round(q_own * 40, 1))
        elif answer and evidence == "none" and not proven:
            reasons.append("analysis-ignores-stem-content")
        elif answer and evidence == "weak" and layout == "flat" and not data_values(stem):
            notes.append("marriage-evidence-only-from-boilerplate")

        # Page-level identity of the answer entry proves the *marriage* even when the stem
        # carries no distinguishing wording (图形推理): the cited 下册 page prints this
        # number with this letter, and nothing else at that height claims the number.
        # Whether the letter is among the parsed options is a separate question — it tests
        # the option rows, not who the answer belongs to — so it must not gate this.
        anchor_proven = ("anchor-printed-on-page" in proof
                         and "unique-anchor-in-chapter" in proof)
        verdicts.append({
            "evidence": evidence,
            "proof": proof,
            "structural": anchor_proven,
            "evidenceScore": ev_score,
            "id": q["id"],
            "chapter": q.get("chapterIndex"),
            "num": q.get("num"),
            "answer": answer,
            "ok": not reasons,
            "reasons": reasons,
            "notes": notes,
            # which fields a human/vision pass overwrote, so a clean verdict can be
            # told apart from a clean OCR run
            "corrected": (q.get("_corrected") or {}).get("fields") or None,
        })

    # ---- one printed 解析 entry cannot answer two questions -----------------
    # Every claimant is marked: this test proves the collision, not which side is wrong.
    v_by_id = {v["id"]: v for v in verdicts}
    claims: dict[tuple, list[str]] = defaultdict(list)
    for q in questions:
        ap = q.get("answerPageRef") or {}
        if not q.get("answer") or not ap.get("page"):
            continue
        bb = ap.get("bbox") or [0, 0, 0, 0]
        claims[(ap.get("tag"), ap.get("page"), bb[1])].append(q["id"])
    for ids in claims.values():
        if len(ids) < 2:
            continue
        for i in ids:
            v = v_by_id.get(i)
            if not v:
                continue
            v["reasons"].append(f"shared-answer-object(with:{'/'.join(x for x in ids if x != i)})")
            v["ok"] = False

    # ---- order: answer pages must not walk backwards inside a chapter ------
    by_ch: dict[int, list[dict]] = defaultdict(list)
    for v in verdicts:
        by_ch[v["chapter"]].append(v)
    q_by_id = {q["id"]: q for q in questions}
    for ch, rows in by_ch.items():
        last_page = 0
        for v in rows:
            page = (q_by_id[v["id"]].get("answerPageRef") or {}).get("page") or 0
            if page and page < last_page - 2:
                v["reasons"].append(f"answer-page-went-backwards({page}<{last_page})")
                v["ok"] = False
            last_page = max(last_page, page)

    bad = [v for v in verdicts if not v["ok"]]
    by_reason = Counter(r.split("(")[0] for v in bad for r in v["reasons"])
    # ---- answer-side inventory: is every printed anchor used exactly once? --
    dn_tag = (cfg.get("tag") or {}).get("dn")
    unclaimed: list[str] = []
    printed_anchors = 0
    if dn_tag and (ROOT / "data" / "ocr" / dn_tag).exists():
        claimed: set[tuple] = set()
        for q in questions:
            if q.get("answer"):
                ap = q.get("answerPageRef") or {}
                claimed.add((ap.get("page"), q.get("num")))  # inventory stays page+number
        for f in sorted((ROOT / "data" / "ocr" / dn_tag).glob("p*.json")):
            pg = int(f.stem[1:])
            for num, _ in answer_page_anchors(dn_tag, pg).items():
                printed_anchors += 1
                if (pg, num) not in claimed:
                    unclaimed.append(f"p{pg}#{num}")
    summary = {
        "bank": bank_id,
        "layout": layout,
        "questions": len(questions),
        "verified": len(questions) - len(bad),
        "suspect": len(bad),
        "reasons": dict(by_reason),
        "notes": dict(Counter(n.split("(")[0] for v in verdicts for n in v["notes"])),
        "evidence": dict(Counter(v["evidence"] for v in verdicts)),
        "anchorProven": sum(1 for v in verdicts if v.get("structural")),
        "needsEyes": sum(1 for v in verdicts if v.get("answer") and not v.get("structural")),
        "optionsIncomplete": sum(1 for v in verdicts
                                 if "answer-in-options" not in (v.get("proof") or [])
                                 and "no-options-to-test" not in (v.get("proof") or [])),
        "withAnswer": sum(1 for q in questions if q.get("answer")),
        "materials": len(mats),
        "printedAnchors": printed_anchors,
        "unclaimedAnchors": len(unclaimed),
        "unclaimedSample": unclaimed[:12],
        "correctionsApplied": fixed,
        "correctionsUnmatched": drift,
    }
    (out_dir / "verification.json").write_text(
        json.dumps({"summary": summary, "rows": verdicts}, ensure_ascii=False), encoding="utf-8")
    return summary


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bank", action="append", choices=list(books.BANKS))
    args = ap.parse_args()
    targets = args.bank or [b for b in books.BANK_ORDER
                            if (books.get_bank(b)["outDir"] / "questions.json").exists()]
    worst = 0
    grand = {"questions": 0, "suspect": 0}
    for b in targets:
        if not (books.get_bank(b)["outDir"] / "questions.json").exists():
            print(f"[{b}] not built yet — skipped")
            continue
        s = verify_bank(b)
        grand["questions"] += s["questions"]
        grand["suspect"] += s["suspect"]
        print(json.dumps(s, ensure_ascii=False))
        worst = max(worst, s["suspect"])
    print(json.dumps({"TOTAL": grand}, ensure_ascii=False))
    return 1 if worst else 0


if __name__ == "__main__":
    sys.exit(main())
