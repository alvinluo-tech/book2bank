"""Turn the OCR caches into a structured question bank, for any registered bank.

Both books restart their printed question numbers inside every teaching block
(考点 N, （一）夯实基础, 卷二 ...), and the answer book even contains answers for
papers the question book doesn't print — so printed numbers alone cannot pair
the streams (a number-window walk drifts whole blocks sideways with every
under-detected question). Pairing is therefore scoped, strongest signal first:
the block's own 下册 footnote page range, then teaching-block keys present in
both books, then a chapter-gated ordered walk. See align().

Pairing is audited, not trusted:
  * every `N.【答案】X` anchor is cross-checked against `故正确答案为X` inside its
    own analysis (type answer-conflict + flag answer-mismatch on mismatch)
  * the printed answer letter must exist among the parsed options when those are
    text (flag answer-not-in-options otherwise)
  * unmatched / trailing answers and numbering gaps land in issues.json
  * report.json carries per-chapter question/answer counts plus which pairing
    scope matched each question, for a quick eyeball

Writes (into books.<id>.outDir, e.g. data/banks/shuliang/):
  questions.json  contract: src/lib/types.ts Question
  meta.json       taxonomy + totals (+ bankId/subject for the app registry)
  issues.json     unmatched / suspicious items for a manual pass
  report.json     pairing + flag summary

  python pipeline/parse_bank.py --bank shuliang
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import books  # noqa: E402
from bank_lines import (  # noqa: E402
    CN_NUM, RE_ACCURACY, RE_CHAPTER, RE_FINAL_ANSWER, RE_JUAN, RE_OPTION,
    RE_POINT, RE_QNUM, RE_SECTION, RE_SOURCE, RE_TOC_TAIL, RE_TRAP, Line, build_lines,
    classify, load_pages,
)

ROOT = books.ROOT
OUT_DIR = books.get_bank("panduan")["outDir"]
PUB = ROOT / "public" / "assets"

CN = {c: i + 1 for i, c in enumerate("一二三四五六七八九十")}
SUBHEAD = re.compile(rf"^[（(]\s*([{CN_NUM}])\s*[)）]\s*(.*)$")
# Footnote lines sometimes carry OCR junk in front ("?本部分题目解析见…").
PARSED_ON = re.compile(r"^[\s?？*＊·•]{0,3}本部分题目解析见")
# "本部分题目解析见下册第44～46页。" — the book's own pairing map: this block's
# answers are printed at those pages of the answer volume.
RE_FOOT = re.compile(r"解析见下册第\s*(\d{1,3})\s*[～~—\-–]{1,2}\s*(\d{1,3})\s*页?")
RE_FOOT1 = re.compile(r"解析见下册第\s*(\d{1,3})\s*页?")
# OCR renders the answer bracket inconsistently — 【答案】、（答案】、【答案）、（答案） — and one
# mismatched pair per bank was enough to make that answer entry invisible to the pairing.
ANSWER_ANCHOR = re.compile(r"^(\d{1,3})\s*[.、．]?\s*[\[【（(]{0,2}\s*答\s*案\s*(?:[\]】）)][:：]?|[:：])?\s*([A-H])")
FIG_GLYPHS = set("☆★○●□■△▲◇◆◎〇")

# which bank the module is currently building; --bank switches it
BANK_ID = "panduan"
CFG = books.get_bank(BANK_ID)
# how each question/answer pair was matched (footnote/key/seq) — reported, so a
# build dominated by the weak "seq" scope is visible at a glance
PAIR_METHODS: Counter = Counter()


def use_bank(bank_id: str) -> None:
    global BANK_ID, CFG, OUT_DIR
    BANK_ID = bank_id
    CFG = books.get_bank(bank_id)
    OUT_DIR = CFG["outDir"]


def norm(text: str) -> str:
    t = re.sub(r"\s+", "", text or "")
    return t.replace("填人", "填入").strip()


def pages_of(side: str, end: int):
    tag = CFG["tag"][side]
    for p in load_pages(tag, 1, end):
        if side == "dn":
            # The answer book prints a QR code (plus caption) in the right margin and
            # the line builder would otherwise glue it onto the 解析 prose. Drop the
            # margin column before any text is assembled.
            cut = p["width"] * 0.80
            p = {**p, "blocks": [b for b in p["blocks"] if b["box"][0] < cut]}
        yield p, [classify(ln, p["height"]) for ln in build_lines(p)]


# --------------------------------------------------------------------------
# Ordered streams
# --------------------------------------------------------------------------

def parse_answer_stream(end: int) -> tuple[list[dict], list[dict]]:
    """Every `N.【答案】X` entry of the answer book, in reading order.

    Each entry also carries its teaching-block key (chapter / section ordinal /
    point ordinal / subhead ordinal / paper), taken from the headings of the
    answer book itself. The key plus the footnote ranges parsed from the
    question book drive align() — see there for why the printed number alone
    is not a safe pairing key.
    """
    entries: list[dict] = []
    notes: list[dict] = []
    cur: dict | None = None
    chapter = 0
    bsec = bpt = bsub = None
    bpaper = None
    printed: dict[int, int] = {}  # pdf page -> printed book page
    for p, lines in pages_of("dn", end):
        page_first = len(entries)
        for ln in lines:
            m = ANSWER_ANCHOR.match(ln.text)
            if m:
                cur = {
                    "num": int(m.group(1)), "answer": m.group(2),
                    "accuracy": None, "trap": None, "analysis": "",
                    "page": p["page"], "y0": ln.y, "y1": ln.y2,
                    "chapter": chapter, "score": ln.score,
                    "bsec": bsec, "bpt": bpt, "bsub": bsub, "bpaper": bpaper,
                    "bookPage": printed.get(p["page"]),
                }
                entries.append(cur)
                a, t = RE_ACCURACY.search(ln.text), RE_TRAP.search(ln.text)
                if a:
                    cur["accuracy"] = float(a.group(1))
                if t:
                    cur["trap"] = t.group(1)
                after = re.sub(r"^.*?【\s*解析\s*】", "", ln.text)
                cur["analysis"] = after.strip() if after != ln.text else ""
                continue
            if ln.kind == "chapter":
                idx = CN.get(ln.extra["chapter"][0], 0)
                # Odd-page running heads repeat the current chapter; only a
                # genuine chapter change may reset the block context.
                if idx and idx != chapter:
                    chapter = idx
                    bsec = bpt = bsub = bpaper = None
                continue
            if ln.kind == "section":
                bsec = CN.get(ln.extra["section"][0])
                bpt = bsub = bpaper = None
                cur = None
                continue
            if ln.kind == "point":
                try:
                    bpt = int(ln.extra["point"][0])
                except ValueError:
                    pass
                bsub = bpaper = None
                cur = None
                continue
            if ln.kind == "innov" or ln.kind == "theme":
                # 「XX题的创新考法」/「XX题材」: a real block boundary printed in
                # both books. Same 考点 context, but its own answers and (for
                # 题材) its own subhead cycle.
                bsub = bpaper = None
                cur = None
                continue
            if ln.kind in ("juan", "lianxi"):
                # A bare 综合训练 heading lost its numeral in the OCR: keep the
                # paper a wildcard so the block's own footnote range does the work.
                bpaper = norm(ln.text) if (ln.kind == "juan" or ln.extra.get("lianxi")) else None
                bsub = None
                cur = None
                continue
            # （一）夯实基础 subheads are plain text to classify(); they must set
            # bsub whether or not an analysis is open, and they always cut one.
            # Titles outside the 夯实基础/高难进阶/新考法 family are material-
            # internal headings (「（二）创新文化发展工程」 inside a 公文 passage)
            # and must not split the block.
            sh = SUBHEAD.match(ln.text)
            if sh and len(norm(sh.group(2))) < 16 and not RE_TOC_TAIL.search(ln.text) \
                    and norm(sh.group(2)).endswith(("基础", "进阶", "考法")):
                bsub = CN.get(sh.group(1))
                cur = None
                continue
            # printed book page in the footer: classify() only tags the very
            # bottom strip, and this volume's footer sits above it
            t = ln.text.strip()
            if ln.kind == "page_num" or (
                t.isdigit() and len(t) <= 3 and ln.y > p["height"] * 0.88
            ):
                printed[p["page"]] = int(t)
                continue
            if cur is None or ln.kind in ("running_head", "page_num", "blank"):
                continue
            # A structural heading (考点/节/综合练习) opens the next teaching
            # block: stop feeding the previous entry's analysis right here.
            if ln.kind == "marker":
                cur = None
                continue
            cur["y1"] = max(cur["y1"], ln.y2)
            if cur["accuracy"] is None:
                a = RE_ACCURACY.search(ln.text)
                if a:
                    cur["accuracy"] = float(a.group(1))
            if cur["trap"] is None:
                t = RE_TRAP.search(ln.text)
                if t:
                    cur["trap"] = t.group(1)
            if len(cur["analysis"]) < 3500:
                cur["analysis"] += ("\n" if cur["analysis"] else "") + ln.text.strip()
        pn = printed.get(p["page"])
        if pn is not None:
            for e in entries[page_first:]:
                e["bookPage"] = pn
        if p["page"] % 60 == 0:
            print(f"  answers: {CFG['tag']['dn']} p{p['page']} -> {len(entries)}", flush=True)

    # Pages whose footer number the OCR missed get the implied book page from
    # the median pdf−printed offset.
    if printed:
        offs = sorted(pg - num for pg, num in printed.items())
        med = offs[len(offs) // 2]
        for e in entries:
            if e.get("bookPage") is None:
                e["bookPage"] = e["page"] - med

    # Independent cross-check: the analysis' own final verdict must repeat the
    # anchor. A mismatch almost always means one of the two was mis-OCR'd —
    # exactly the pairing error the pipeline must surface, never hide. The FIRST
    # verdict is the entry's own (any later ones belong to merged successors,
    # handled just below).
    for e in entries:
        verdicts = RE_FINAL_ANSWER.findall(e["analysis"] or "")
        if verdicts and verdicts[0] != e["answer"]:
            e["conflict"] = True
            notes.append({"type": "answer-conflict", "num": e["num"], "chapter": e["chapter"],
                          "anchor": e["answer"], "verdict": verdicts[0], "page": e["page"]})

    # Recover anchor lines the OCR dropped: the successor's whole analysis (with
    # its own 故正确答案为X verdict) got merged into this entry. Split the entry
    # back apart at the verdicts — the book's own text, not a guess.
    for i, e in enumerate(entries):
        marks = list(RE_FINAL_ANSWER.finditer(e["analysis"] or ""))
        if len(marks) < 2:
            continue
        nxt = entries[i + 1] if i + 1 < len(entries) else None
        hidden = len(marks) - 1
        if nxt and nxt["num"] == e["num"] + 1:
            continue  # successor's anchor survived; extra verdicts are noise
        if nxt and nxt["num"] > e["num"] + 1:
            hidden = min(hidden, nxt["num"] - e["num"] - 1)
        if not 1 <= hidden <= 4:
            continue
        cuts = [0] + [m.end() for m in marks]
        segs = [e["analysis"][cuts[j]:cuts[j + 1]] for j in range(hidden + 1)]
        e["analysis"] = segs[0].strip()
        span = (e["y1"] - e["y0"]) / (hidden + 1)
        # When the successor restarts its numbering (new teaching block), the
        # hidden anchors belong to that unknown block: their sub/paper context
        # is a wildcard, not e's.
        restart = bool(nxt and nxt["num"] <= e["num"])
        extra = []
        for j in range(hidden):
            extra.append({
                "num": e["num"] + 1 + j, "answer": marks[j + 1].group(1),
                "accuracy": None, "trap": None,
                "analysis": segs[j + 1].strip(),
                "page": e["page"], "y0": e["y0"] + span * (j + 1),
                "y1": e["y0"] + span * (j + 2),
                "chapter": e["chapter"], "score": e["score"],
                "bookPage": e.get("bookPage"),
                "bsec": e.get("bsec"), "bpt": e.get("bpt"),
                "bsub": None if restart else e.get("bsub"),
                "bpaper": None if restart else e.get("bpaper"),
                "synthetic": True,
            })
        entries[i + 1:i + 1] = extra
        notes.append({"type": "recovered-anchor", "num": e["num"], "hidden": hidden,
                      "page": e["page"], "chapter": e["chapter"]})
    return entries, notes


def parse_question_stream(end: int) -> tuple[list[dict], list[dict]]:
    """Every question of the question book, in reading order, with taxonomy.

    Items carry their teaching-block key (ordinals, OCR-noise resistant) and,
    when the block printed one, the 下册 footnote page range declaring where
    its answers live.
    """
    items: list[dict] = []
    notes: list[dict] = []
    chapter = 0
    chapter_title = ""
    section = point = drill = subhead = None
    sec_ord = pt_ord = sub_ord = paper = None
    book_page = None
    cur: dict | None = None
    prev_num = 0
    block_has_source = False
    # Footnote (page-range) attachment: a block's footnote prints on the block's
    # first page, *after* its first questions — so it declares the range for the
    # block it sits in, covering that block's items whether they fall before or
    # after the footnote line. A mark stays open until the next block boundary.
    block_start = 0
    foot_marks: list[list] = []

    def open_block():
        """A heading (or a numbering restart from a lost heading) opens a block."""
        nonlocal cur, prev_num, block_has_source, block_start
        cur = None
        prev_num = 0
        block_has_source = False
        if foot_marks and foot_marks[-1][1] is None:
            foot_marks[-1][1] = len(items)
        block_start = len(items)

    def new_item(num, ln, p, rest):
        nonlocal cur
        cur = {
            "num": num, "chapter": chapter, "chapterTitle": chapter_title,
            "section": section, "point": point, "drill": drill, "subhead": subhead,
            "bsec": sec_ord, "bpt": pt_ord, "bsub": sub_ord, "bpaper": paper,
            "foot": None,
            "page": p["page"], "bookPage": book_page,
            "y0": ln.y, "y1": ln.y2, "x0": ln.x, "x1": ln.x + ln.w, "lastY": ln.y2,
            "stem": [], "opts": [], "lines": [], "scores": [ln.score],
            "optY": 1e9,
            "source": None, "pages": [(p["page"], ln.y, ln.y2)],
            "segStem": {str(p["page"]): ln.y2},
        }
        items.append(cur)
        src = RE_SOURCE.match(rest)
        if src:
            cur["source"] = norm(rest[: src.end()])
            rest = rest[src.end():].strip()
        if rest:
            cur["stem"].append(rest)

    for p, lines in pages_of("up", end):
        for ln in split_anchors(lines):
            if ln.kind == "chapter":
                g = ln.extra["chapter"]
                # The running header of the panduan book *is* "第一章 图形推理"; it must
                # not restart the numbering the way a real in-body chapter heading does.
                if ln.y < 170:
                    idx = CN.get(g[0], 0)
                    # The running header is the only chapter marker on most pages of a
                    # new chapter, so honour a change even after chapter 1. Books whose
                    # header is the book title (数量上册) never match RE_CHAPTER here.
                    if idx and idx != chapter:
                        chapter, chapter_title = idx, norm(g[1]) if len(g) > 1 else chapter_title
                        section = point = drill = subhead = None
                        sec_ord = pt_ord = sub_ord = paper = None
                        open_block()
                    elif not chapter_title and len(g) > 1:
                        chapter_title = norm(g[1])
                    continue
                chapter = CN.get(g[0], chapter)
                if len(g) > 1:
                    chapter_title = norm(g[1])
                section = point = drill = subhead = None
                sec_ord = pt_ord = sub_ord = paper = None
                open_block()
                continue
            if ln.kind == "section":
                section = norm(ln.extra["section"][1])
                sec_ord = CN.get(ln.extra["section"][0])
                point = drill = subhead = None
                pt_ord = sub_ord = paper = None
                open_block()
                continue
            if ln.kind == "point":
                g = ln.extra["point"]
                point = f"考点{g[0]} {norm(g[1])}".strip()
                try:
                    pt_ord = int(g[0])
                except ValueError:
                    pass
                drill = subhead = None
                sub_ord = paper = None
                open_block()
                continue
            if ln.kind in ("juan", "lianxi"):
                drill = norm(ln.text)
                # bare 综合训练 (numeral lost): paper stays a wildcard, the
                # block's footnote range pairs it
                paper = drill if (ln.kind == "juan" or ln.extra.get("lianxi")) else None
                sub_ord = None
                open_block()
                continue
            if ln.kind == "innov":
                # 「XX题的创新考法」: a subsection of the current 考点/节 with its
                # own question block, footnote range and answer run.
                point = ln.extra["innov"]
                subhead = drill = None
                sub_ord = paper = None
                open_block()
                continue
            if ln.kind == "theme":
                # 「XX题材」(篇章阅读): acts as the section of its two subheads.
                section = ln.extra["theme"]
                sec_ord = None
                point = drill = subhead = None
                pt_ord = sub_ord = paper = None
                open_block()
                continue
            if ln.kind == "page_num":
                digits = re.sub(r"\D", "", ln.text)
                if digits:
                    book_page = int(digits)
                continue
            if ln.kind == "running_head":
                continue
            if ln.kind == "marker":
                # 「决战真题」/答案速览 banners never belong inside a question stem.
                cur = None
                continue

            sh = SUBHEAD.match(ln.text)
            if sh and len(norm(sh.group(2))) < 16 and not RE_TOC_TAIL.search(ln.text) \
                    and norm(sh.group(2)).endswith(("基础", "进阶", "考法")):
                subhead = norm(sh.group(2))
                sub_ord = CN.get(sh.group(1))
                paper = None
                open_block()
                continue
            if PARSED_ON.match(ln.text):
                fm = RE_FOOT.search(ln.text) or RE_FOOT1.search(ln.text)
                # The footnote may print right after the heading, *before* the
                # block's first question (综合训练二) — attach it to the current
                # block even when that block has no items yet.
                if fm and items and block_start <= len(items):
                    x = int(fm.group(1))
                    y = int(fm.group(2)) if fm.lastindex and fm.lastindex >= 2 else x
                    if foot_marks and foot_marks[-1][1] is None and foot_marks[-1][0] == block_start:
                        foot_marks[-1][2:] = [x, y]  # re-state of the same block's range
                    else:
                        foot_marks.append([block_start, None, x, y])
                continue

            m = RE_QNUM.match(ln.text)
            if m:
                num = int(m.group(1))
                rest = m.group(2).strip()
                # 真题 anchors always open with （2024 山东 65）; a numbered line shaped
                # like "1.曲直性：根据…" is a 考点介绍 list entry, not a question. An
                # untagged rest shorter than 8 chars is a theory-table term
                # ("1.转折关系" — STEM_TAIL's 关系 makes it look like a stem).
                tagged = bool(RE_SOURCE.match(rest))
                term_def = bool(re.match(r"^[^（()]{1,12}[：:]", rest))
                looks_like_stem = tagged or (
                    not term_def and len(rest) >= 8 and bool(STEM_TAIL.search(rest)))
                in_block = block_has_source and num == prev_num + 1
                # A tagged anchor whose number went backwards IS the restart signal:
                # a 综合训练/卷 heading was lost to the OCR and the next block has
                # begun. Never swallow it into the open item.
                restart = tagged and prev_num and num < prev_num
                if (looks_like_stem or in_block) and (num >= prev_num or restart):
                    if num > prev_num + 1:
                        notes.append({"type": "gap-in-question-numbers", "chapter": chapter,
                                      "point": point, "from": prev_num, "to": num,
                                      "page": p["page"]})
                    if prev_num and num <= prev_num:
                        # Numbers never restart inside a block: a lost 卷/（二） heading
                        # merged two blocks. Reopen so the next footnote lands correctly.
                        open_block()
                    new_item(num, ln, p, rest)
                    block_has_source = tagged or in_block
                    prev_num = num
                    continue

            if cur is not None:
                stripped = ln.text.strip()
                gap = ln.y - cur["lastY"]
                cur["lines"].append([ln.text, ln.x, ln.y, ln.w, ln.h])
                cur["lastY"] = max(cur["lastY"], ln.y2)
                cur["y1"] = max(cur["y1"], ln.y2)
                cur["x0"] = min(cur["x0"], ln.x)
                cur["x1"] = max(cur["x1"], ln.x + ln.w)
                cur["scores"].append(ln.score)
                if cur["pages"] and cur["pages"][-1][0] == p["page"]:
                    cur["pages"][-1] = (p["page"], cur["pages"][-1][1], cur["y1"])
                else:
                    cur["pages"].append((p["page"], ln.y, cur["y1"]))
                    cur["page"] = p["page"]
                if RE_OPTION.match(stripped):
                    cur["opts"].append(stripped)
                    cur["optY"] = min(cur["optY"], ln.y)
                elif cur["opts"]:
                    # Once the first option marker is seen, everything that follows
                    # belongs to the last option (options wrap onto 2-3 lines).
                    cur["opts"][-1] = cur["opts"][-1] + " " + stripped
                elif gap <= STEM_GAP and len(stripped) > 1:
                    # Contiguous with the stem: real prose. Text separated by a larger
                    # gap sits inside the figure and is cropped as an image instead of
                    # polluting the stem.
                    cur["stem"].append(stripped)
                    cur["segStem"][str(p["page"])] = max(
                        cur["segStem"].get(str(p["page"]), 0.0), ln.y2)
        if p["page"] % 60 == 0:
            print(f"  questions: {CFG['tag']['up']} p{p['page']} -> {len(items)}", flush=True)

    # Apply footnote marks: each covers its block's items up to the next block
    # boundary (or the end of the stream when no boundary followed).
    for start, stop, x, y in foot_marks:
        for it in items[start:stop if stop is not None else len(items)]:
            it["foot"] = (x, y)

    # A figure often runs past the question's last text line, down to the bottom of
    # the page or up to the next anchor. Extend the span so the crop stays complete.
    heights = {pg["page"]: pg["height"] for pg in load_pages(CFG["tag"]["up"], 1, end)}
    for i, it in enumerate(items):
        segs = it["pages"]
        pg, y0, y1 = segs[-1]
        nxt = items[i + 1] if i + 1 < len(items) else None
        if nxt and nxt["pages"] and nxt["pages"][0][0] == pg:
            if nxt["pages"][0][1] - y1 > STEM_GAP:
                segs[-1] = (pg, y0, nxt["pages"][0][1] - 6)
        else:
            segs[-1] = (pg, y0, heights.get(pg, 2008) - 115)
    return drop_prose_phantoms(items, notes), notes


def drop_prose_phantoms(items: list[dict], notes: list[dict]) -> list[dict]:
    """Remove 考点介绍 list entries that were accepted as questions.

    A teaching block opens with numbered explanation prose ("1.并列关系可以分为矛盾关系和
    反对关系。（1）矛盾关系是指非A即B…"). It has no options and no 真题 tag, and the real
    question that starts the block right after it carries the *same* printed number. If the
    prose survives, the alignment hands it the following question's answer from the 下册 —
    a textbook paragraph presented to the reader with someone else's answer, which is the
    one failure mode this pipeline must not ship.
    """
    last: dict[tuple, dict] = {}
    for it in items:
        last[(it["chapter"], it.get("point") or it.get("section"), it["num"])] = it
    dropped = 0
    keep: list[dict] = []
    for it in items:
        if not it["opts"] and not it.get("source"):
            later = last.get((it["chapter"], it.get("point") or it.get("section"), it["num"]))
            if later is not it and (later["opts"] or later.get("source")):
                dropped += 1
                continue
        keep.append(it)
    if dropped:
        notes.append({"type": "prose-phantom-dropped", "count": dropped})
    return keep


STEM_GAP = 72

# The scan sometimes glues the next question's anchor onto the previous question's
# last option line ("…印刷成册 4.（2024国考）根据上述定义…"), which hides an item.
EMB_ANCHOR = re.compile(r"(?<![0-9A-Za-z.])(\d{1,3})[.、．]\s*[（(]\s*(?:19|20)\d{2}")


def split_anchors(lines: list[Line]) -> list[Line]:
    out: list[Line] = []
    for ln in lines:
        m = EMB_ANCHOR.search(ln.text)
        if not m or m.start() < 4:
            out.append(ln)
            continue
        head_txt, tail_txt = ln.text[:m.start()].rstrip(), ln.text[m.start():]
        frac = len(head_txt) / max(1, len(ln.text))
        head = Line(text=head_txt, x=ln.x, y=ln.y, w=ln.w * frac, h=ln.h,
                    score=ln.score, page=ln.page, tag=ln.tag)
        tail = Line(text=tail_txt, x=ln.x + ln.w * frac, y=ln.y, w=ln.w * (1 - frac), h=ln.h,
                    score=ln.score, page=ln.page, tag=ln.tag)
        out.extend([classify(head, 10**6), classify(tail, 10**6)])
    return out


STEM_TAIL = re.compile(r"(?:的是|应该是|分别为|正确的是|不正确的是|符合|不符合|选择|填入|呈现|规律性|一项|选项|定义|类比|推理|关系|属于|不属于|能够|不能|可以|无法|是多少|多少|之比|之和|之差|概率|约为|共有)[^。]{0,80}[。：:?？]?\s*$")


# --------------------------------------------------------------------------
# Alignment
# --------------------------------------------------------------------------

def item_key(it: dict) -> tuple:
    return (it["chapter"], it.get("bsec"), it.get("bpt"), it.get("bsub"), it.get("bpaper"))


def ans_key(a: dict) -> tuple:
    return (a["chapter"], a.get("bsec"), a.get("bpt"), a.get("bsub"), a.get("bpaper"))


def key_compat(a: tuple, b: tuple) -> bool:
    """Block-key compatibility: equal where both sides know, wildcard on None.

    A heading the OCR lost leaves None on that side only — the other side's
    value still constrains. The chapter is never a wildcard: answers of
    chapter N must never pair with chapter M's questions."""
    for x, y in zip(a, b):
        if x is None or y is None:
            continue
        if x != y:
            return False
    return True


def dn_page_offset(end_dn: int = 10**9) -> int:
    """pdf page − printed page number of the answer volume (panduan: 6).

    The footnote ranges name *printed* pages; the offset converts them to the
    OCR cache's pdf page numbers. Falls back to 0 when no printed number OCR'd.
    """
    offs = []
    for p in load_pages(CFG["tag"]["dn"], 1, end_dn):
        for ln in build_lines(p):
            t = ln.text.strip()
            if ln.y > p["height"] - 130 and t.isdigit() and len(t) <= 3:
                offs.append(p["page"] - int(t))
    return round(sum(offs) / len(offs)) if offs else 0


def align(items: list[dict], answers: list[dict]) -> tuple[list[tuple], list[dict]]:
    """Marry every question to its own answer — the step that must never guess.

    Printed numbers restart inside every block and the two books don't even
    contain the same blocks (the answer book prints answers for papers the
    question book omits), so a plain number-window walk drifts whole blocks
    sideways and pairs confidently but wrongly. Two invariants make the walk
    honest, and every pair records which scope produced it:

      order  an answer may only go to a question if it sits *between* the
             answers taken by the question's stream neighbours — no pairing
             may reach backward over an already-married neighbour
      scope  candidates are filtered, strongest signal first: the block's own
             解析见下册第X～Y页 footnote range, then the teaching-block key
             (章/节/考点/(一)子块/卷名 ordinals), then a chapter-gated walk

    Anything the scopes cannot honestly match stays unpaired (flag
    no-answer) — better a visible hole than a confidently wrong answer.
    """
    issues: list[dict] = []
    consumed = [False] * len(answers)
    taken: list[int | None] = [None] * len(items)  # answer index per item
    method_of: dict[int, str] = {}
    off = dn_page_offset()

    def bounds(first: int, last: int) -> tuple[int, int]:
        """Answer-index window (lo, hi) allowed for items[first..last]: between
        what earlier stream neighbours already took and later ones will keep."""
        lo = -1
        for i in range(first - 1, -1, -1):
            if taken[i] is not None:
                lo = taken[i]
                break
        hi = len(answers)
        for i in range(last + 1, len(items)):
            if taken[i] is not None:
                hi = taken[i]
                break
        return lo + 1, hi - 1

    def greedy(group_idx: list[int], cand: list[int], method: str,
               window: int | None = None) -> None:
        j = 0
        for i in group_idx:
            it = items[i]
            hit = None
            end = len(cand) if window is None else min(j + window, len(cand))
            for k in range(j, end):
                if answers[cand[k]]["num"] == it["num"]:
                    hit = k
                    break
            if hit is None:
                continue
            for k in range(j, hit):
                issues.append({"type": "answer-without-question",
                               "num": answers[cand[k]]["num"], "page": answers[cand[k]]["page"],
                               "scope": method})
            taken[i] = cand[hit]
            method_of[i] = method
            consumed[cand[hit]] = True
            j = hit + 1

    def runs(keyfn) -> list[list[int]]:
        """Maximal runs of adjacent still-unpaired items with an equal key."""
        out: list[list[int]] = []
        for i, it in enumerate(items):
            if taken[i] is not None:
                continue
            k = keyfn(it)
            if k is None:
                continue
            if out and out[-1][-1] == i - 1 and keyfn(items[out[-1][0]]) == k:
                out[-1].append(i)
            else:
                out.append([i])
        return out

    # pass A — footnote ranges: consecutive unpaired items sharing one footnote.
    # The printed ranges of adjacent blocks share their boundary page, so the
    # page window alone can reach one block too far; the block key keeps it own.
    for run in runs(lambda it: it.get("foot")):
        x, y = items[run[0]]["foot"]
        key = item_key(items[run[0]])
        lo, hi = bounds(run[0], run[-1])
        cand = [k for k in range(lo, hi + 1) if not consumed[k]
                and x + off <= answers[k]["page"] <= y + off
                and key_compat(ans_key(answers[k]), key)]
        greedy(run, cand, "footnote")

    # pass B — block keys: consecutive unpaired items sharing one key run.
    for run in runs(item_key):
        key = item_key(items[run[0]])
        lo, hi = bounds(run[0], run[-1])
        cand = [k for k in range(lo, hi + 1) if not consumed[k]
                and key_compat(ans_key(answers[k]), key)]
        greedy(run, cand, "key")

    # pass B — block keys: consecutive unpaired items sharing one key run.
    for run in runs(lambda it: True):
        key = item_key(items[run[0]])
        if any(item_key(items[i]) != key for i in run):
            continue  # run spans a boundary (footnote split); handled below
        lo, hi = bounds(run[0], run[-1])
        cand = [k for k in range(lo, hi + 1) if not consumed[k]
                and ans_key(answers[k]) == key]
        greedy(run, cand, "key")

    # pass C — chapter-gated ordered walk, one hole at a time.
    for i, it in enumerate(items):
        if taken[i] is not None:
            continue
        lo, hi = bounds(i, i)
        cand = [k for k in range(lo, hi + 1) if not consumed[k]
                and answers[k]["chapter"] == it["chapter"]]
        greedy([i], cand[:10] if len(cand) > 10 else cand, "seq")
        if taken[i] is None and len(cand) == 1 and answers[cand[0]].get("synthetic") \
                and key_compat(ans_key(answers[cand[0]]), item_key(it)):
            # Exactly one recovered entry sits between the neighbours and the
            # block key fits — the anchor was lost across a numbering restart.
            k = cand[0]
            taken[i] = k
            method_of[i] = "recovered"
            consumed[k] = True

    pairs = []
    for i, it in enumerate(items):
        ans = answers[taken[i]] if taken[i] is not None else None
        pairs.append((it, ans, method_of.get(i, "none")))

    for k, done in enumerate(consumed):
        if not done:
            issues.append({"type": "trailing-answer", "num": answers[k]["num"],
                           "page": answers[k]["page"], "scope": str(ans_key(answers[k]))})
    return pairs, issues


# --------------------------------------------------------------------------
# Assembly
# --------------------------------------------------------------------------

def split_options(texts: list[str]) -> list[dict]:
    opts: dict[str, str] = {}
    for t in texts:
        for label, body in _split_one(t):
            opts[label] = (opts.get(label, "") + " " + body).strip()
    return [{"label": k, "text": fix_typos(norm(v)) or None} for k, v in opts.items()]


def _split_one(text: str):
    hits = list(RE_OPTION.finditer(text))
    # A label glued to the end of the previous option's CJK text is still a label
    # ("…心满意足B.差强人意"), but "AB." inside a figure caption is not.
    hits = [h for h in hits if not (h.start() and text[h.start() - 1].isascii() and text[h.start() - 1].isalnum())]
    out = []
    for i, h in enumerate(hits):
        start = h.end()
        stop = hits[i + 1].start() if i + 1 < len(hits) else len(text)
        out.append((h.group(1), text[start:stop].strip(" \t、.，,；;")))
    return out


def figure_band(it: dict, page_map: dict) -> list[dict]:
    """The figure zone: everything below the last stem line of the question.

    Gap-finding between text lines is unreliable here because the OCR invents
    noise lines *inside* the artwork ("图图图国", rows of ☆), so the zone is
    derived from where the prose stopped instead.
    """
    bands = []
    for (pg, y0, y1) in it["pages"]:
        p = page_map.get(pg)
        if not p:
            continue
        stem_bottom = (it.get("segStem") or {}).get(str(pg), y0)
        a = stem_bottom + 6
        b = min(y1, p["height"] - 110)
        # Text options are prose, not artwork: stop the figure zone above them.
        opt_y = it.get("optY")
        if opt_y and opt_y < 1e8:
            b = min(b, opt_y - 6)
        # Footnotes such as 本部分题目解析见下册第1～5页 sit under the artwork and
        # would otherwise be swallowed by the ink trim.
        for ln in [classify(x, p["height"]) for x in build_lines(p)]:
            if PARSED_ON.match(ln.text) and stem_bottom < ln.y < b:
                b = min(b, ln.y - 8)
        if b - a >= 55:
            bands.append({"page": pg, "y0": round(a), "y1": round(b), "h": round(b - a)})
    return sorted(bands, key=lambda x: -x["h"])[:3]


QR_INLINE = [
    re.compile(r"[\*＊]?\s*打开粉笔\s*APP，点击[“\"']?我[”\"']?[^。]*。?"),
    re.compile(r"[\*＊]?\s*扫描解析右侧二维码[^。]*。?"),
    re.compile(r"[\*＊]?\s*打开粉笔\s*APP"),
    re.compile(r"下载粉笔\s*APP[^。]{0,20}"),
    re.compile(r"不支持其他方式扫码。?"),
    re.compile(r"观看对应解析视频"),
    re.compile(r"正文[:：]\s*[^\s，。；]{0,10}"),
    re.compile(r"[\*＊]?\s*扫一扫"),
    re.compile(r"[\*＊]?\s*二维码"),
    re.compile(r"[\*＊]{1,2}"),
]
# Only a line that is *nothing but* QR margin boilerplate may be deleted: the QR
# caption frequently lands on the same visual line as real 解析 prose.
QR_LINE = re.compile(r"^(?:[\*＊·\s]*|扫码|扫一扫|解析右侧|二维码)+$")
# Recurrent confusions of the OCR model on this scan.
TYPO = {"题于": "题干", "自已": "自己", "填人": "填入", "一右上角": "→右上角"}
NEXT_BLOCK_HEAD = re.compile(r"[（(]\s*[一二三四五六七八九十]\s*[)）]\s*\S{0,14}\s*$")


def fix_typos(text: str) -> str:
    for a, b in TYPO.items():
        text = text.replace(a, b)
    return text


def clean_analysis(text: str | None) -> str | None:
    if not text:
        return None
    t = re.sub(r"^\s*【\s*解析\s*】\s*", "", text)
    for rx in QR_INLINE:
        t = rx.sub("", t)
    kept = [ln.strip() for ln in t.split("\n") if ln.strip() and not QR_LINE.search(ln.strip())]
    t = NEXT_BLOCK_HEAD.sub("", "\n".join(kept))
    t = fix_typos(re.sub(r"\n{2,}", "\n", t)).strip()
    return t or None


def assemble(pairs, end_up: int) -> tuple[list[dict], list[dict]]:
    page_map = {p["page"]: p for p in load_pages(CFG["tag"]["up"], 1, end_up)}
    questions: list[dict] = []
    issues: list[dict] = []
    seq: dict[int, int] = defaultdict(int)

    for it, ans, method in pairs:
        PAIR_METHODS[method if ans else f"{method}-unpaired"] += 1
        seq[it["chapter"]] += 1
        idx = seq[it["chapter"]]
        stem_raw = " ".join(it["stem"])
        stem = fix_typos(norm(re.sub(r"^【?\s*题目\s*】?", "", stem_raw)))
        options = split_options(it["opts"])
        bands = figure_band(it, page_map)
        has_fig = bool(bands and bands[0]["h"] >= 55) or any(
            ch in FIG_GLYPHS for ch in " ".join(it["stem"] + it["opts"]))

        labels = {o["label"] for o in options}
        flags: list[str] = []
        if not ans:
            flags.append("no-answer")
        if ans and ans.get("conflict"):
            flags.append("answer-mismatch")
        if ans and ans.get("synthetic"):
            flags.append("answer-recovered")
        if ans and options and ans["answer"] not in labels:
            flags.append("answer-not-in-options")
        if not has_fig and not options:
            flags.append("no-options")
        if options and len(options) < 4 and not has_fig:
            flags.append(f"options-{len(options)}")
        if len(stem) < 3:
            flags.append("empty-stem")
        conf = sum(it["scores"]) / len(it["scores"]) if it["scores"] else 0
        if conf < 0.82:
            flags.append("ocr-low")
        if ans and ans["analysis"] and len(ans["analysis"]) < 12:
            flags.append("short-analysis")

        src = None
        if it["source"]:
            m = re.search(r"[（(]?((?:19|20)\d{2})?([^{（()）]{0,14}?)(\d{1,4})?[）)]?", it["source"])
            if m:
                src = {"year": int(m.group(1)) if m.group(1) else None,
                       "region": norm(m.group(2) or "") or None,
                       "code": m.group(3), "raw": it["source"]}

        analysis = clean_analysis(ans["analysis"]) if ans else None

        questions.append({
            "id": f"{CFG['idPrefix']}c{it['chapter']}-{idx:04d}",
            "chapterIndex": it["chapter"],
            "chapterTitle": it["chapterTitle"] or f"第{it['chapter']}章",
            "sectionTitle": it["section"],
            "pointTitle": it["point"],
            "drillTitle": it["drill"],
            "blockTitle": it["subhead"],
            "num": it["num"],
            "kind": "figure" if has_fig else "text",
            "stem": stem,
            "options": options,
            "answer": ans["answer"] if ans else None,
            "analysis": analysis,
            "accuracy": ans["accuracy"] if ans else None,
            "trapOption": ans["trap"] if ans else None,
            "source": src,
            "figureImage": None,
            "cropImage": None,
            "hasImage": has_fig,
            "pageRef": {"tag": CFG["tag"]["up"], "page": it["page"], "bookPage": it["bookPage"],
                        "bbox": [round(it["x0"]), round(it["y0"]),
                                 round(it["x1"] - it["x0"]), round(it["y1"] - it["y0"])]},
            "answerPageRef": ({"tag": CFG["tag"]["dn"], "page": ans["page"],
                               "bookPage": ans.get("bookPage"),
                               "bbox": [150, round(ans["y0"]), 1150, round(ans["y1"] - ans["y0"])]}
                              if ans else None),
            "ocrConfidence": round(conf, 3),
            "flags": flags,
            "segments": it["pages"],
            "bands": bands,
        })
    return questions, issues


def _asset_key(q: dict) -> tuple:
    """What an item says, rather than which id it landed on."""
    ref = q.get("pageRef") or {}
    return (q.get("chapterIndex"), q.get("num"), ref.get("page"), re.sub(r"\s+", "", q.get("stem") or ""))


def reattach_assets(questions: list[dict]) -> int:
    """Hand back the crops an earlier pass made for items that did not change.

    A parse clears figureImage / cropImage while the PNGs stay on disk, and a parse that
    recognises more items also renumbers ids — so `/assets/figures/<id>.png` under a
    reused id is some other question's figure. Matching items by their own content lets a
    figure follow its question across the renumber instead of being guessed by position.
    """
    path = OUT_DIR / "questions.json"
    if not path.exists():
        return 0
    try:
        previous = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return 0

    by_item: dict[tuple, dict] = {}
    ambiguous: set[tuple] = set()
    for old in previous:
        if not (old.get("figureImage") or old.get("cropImage")):
            continue
        key = _asset_key(old)
        if key in by_item:
            ambiguous.add(key)  # two items indistinguishable by content: never guess
        else:
            by_item[key] = old

    attached = 0
    for q in questions:
        key = _asset_key(q)
        old = by_item.get(key)
        if not old or key in ambiguous:
            continue
        for asset in ("figureImage", "cropImage", "figureW", "figureH"):
            value = old.get(asset)
            # A pointer only survives if its file is still there.
            q[asset] = value if not isinstance(value, str) or (ROOT / "public" / value.lstrip("/")).exists() else None
        if q.get("figureImage") or q.get("cropImage"):
            attached += 1
            q["hasImage"] = bool(q.get("figureImage"))
    return attached


def write_outputs(questions: list[dict], issues: list[dict], notes: list[dict]) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"assets re-attached: {reattach_assets(questions)}", flush=True)
    (OUT_DIR / "questions.json").write_text(json.dumps(questions, ensure_ascii=False), encoding="utf-8")

    chapters: dict[int, dict] = {}
    for q in questions:
        ch = chapters.setdefault(q["chapterIndex"], {
            "index": q["chapterIndex"], "title": q["chapterTitle"],
            "count": 0, "answered": 0, "sections": {}, "points": {}})
        ch["count"] += 1
        ch["answered"] += 1 if q["answer"] else 0
        sec_t = q["sectionTitle"] or "本章综合"
        sec = ch["sections"].setdefault(sec_t, {"title": sec_t, "count": 0, "points": {}})
        sec["count"] += 1
        pt_t = q["pointTitle"] or q["sectionTitle"] or q["drillTitle"] or q["blockTitle"] or "综合"
        pt = sec["points"].setdefault(pt_t, {"title": pt_t, "count": 0})
        pt["count"] += 1
        ch["points"][pt_t] = pt

    taxonomy, points_flat = [], []
    for idx in sorted(chapters):
        ch = chapters[idx]
        secs = []
        for st in sorted(ch["sections"].values(), key=lambda s: -s["count"]):
            pts = sorted(st["points"].values(), key=lambda p: -p["count"])
            secs.append({"title": st["title"], "count": st["count"], "points": pts})
            for pt in pts:
                points_flat.append({"chapterIndex": idx, "chapterTitle": ch["title"],
                                    "sectionTitle": st["title"], "title": pt["title"], "count": pt["count"]})
        taxonomy.append({"index": ch["index"], "title": ch["title"], "count": ch["count"],
                         "answered": ch["answered"], "sections": secs})

    meta = {
        "bankId": BANK_ID,
        "subject": CFG["title"],
        "bookTitle": CFG["bookTitle"],
        "builtAt": datetime.now().isoformat(timespec="seconds"),
        "totals": {
            "questions": len(questions),
            "withAnswer": sum(1 for q in questions if q["answer"]),
            "withAnalysis": sum(1 for q in questions if q["analysis"]),
            "withFigure": sum(1 for q in questions if q["hasImage"]),
            "pagesOcr": len(list((ROOT / "data/ocr" / CFG["tag"]["up"]).glob("*.json")))
            + len(list((ROOT / "data/ocr" / CFG["tag"]["dn"]).glob("*.json"))),
            # lets the UI show OCR progress instead of an apparently empty module
            "pagesTotal": sum(CFG["pages"].values()),
        },
        "chapters": taxonomy,
        "points": points_flat,
    }
    (OUT_DIR / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    (OUT_DIR / "issues.json").write_text(
        json.dumps({"issues": issues, "notes": notes[:400]}, ensure_ascii=False, indent=1), encoding="utf-8")

    # pairing audit: per-chapter question vs answer counts, plus flags
    q_by_ch = Counter(q["chapterIndex"] for q in questions)
    a_by_ch = Counter(q["chapterIndex"] for q in questions if q["answer"])
    report = {
        "bankId": BANK_ID,
        "builtAt": meta["builtAt"],
        "questions": len(questions),
        "paired": sum(1 for q in questions if q["answer"]),
        "pairing": dict(PAIR_METHODS),
        "chapters": {str(k): {"questions": q_by_ch[k], "withAnswer": a_by_ch[k]} for k in sorted(q_by_ch)},
        "flags": dict(Counter(f for q in questions for f in q["flags"])),
        "issueCount": len(issues),
        "noteTypes": dict(Counter(n["type"] for n in notes)),
    }
    (OUT_DIR / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({"bank": BANK_ID, "questions": len(questions),
                      "withAnswer": meta["totals"]["withAnswer"],
                      "withFigure": meta["totals"]["withFigure"], "flags": report["flags"],
                      "pairing": dict(PAIR_METHODS),
                      "chapters": {str(k): v["count"] for k, v in chapters.items()},
                      "points": len(points_flat),
                      "pairingNotes": report["noteTypes"]}, ensure_ascii=False, indent=1))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bank", default="panduan", choices=list(books.BANKS))
    ap.add_argument("--end-up", type=int, default=10**9)
    ap.add_argument("--end-dn", type=int, default=10**9)
    args = ap.parse_args()
    use_bank(args.bank)
    if CFG.get("layout") == "material-group":
        # 资料分析 shares the OCR caches and the answer format but not the item
        # shape (one 资料 feeds a group of items), so it has its own parser.
        import parse_material

        return parse_material.run(args.bank, args.end_up, args.end_dn)
    answers, an = parse_answer_stream(args.end_dn)
    print(f"answer entries: {len(answers)}", flush=True)
    items, qn = parse_question_stream(args.end_up)
    print(f"question items: {len(items)}", flush=True)
    pairs, issues = align(items, answers)
    questions, more_issues = assemble(pairs, args.end_up)
    write_outputs(questions, issues + more_issues, an + qn)
    return 0


if __name__ == "__main__":
    sys.exit(main())
