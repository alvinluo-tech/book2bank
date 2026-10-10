"""Regression tests for the parsing rules, on synthetic OCR pages.

These lock the decisions that the real 902-page scan forced on us:
  * printed numbers restart inside every teaching block, so a restart is legal
  * the odd-page running header *is* the chapter title and must not restart numbering
  * text separated from the stem by a large vertical gap belongs to the figure
  * the answer book is aligned positionally, resyncing on the printed number

Run:  python pipeline/test_parse.py
"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bank_lines as BL  # noqa: E402
import parse_bank as PB  # noqa: E402

WORK = Path(tempfile.mkdtemp(prefix="quiztest-"))
OCR = WORK / "data" / "ocr"


def page(tag: str, n: int, blocks, height: int = 2008, width: int = 1386) -> dict:
    return {"page": n, "tag": tag, "dpi": 200, "width": width, "height": height,
            "blocks": [{"text": t, "score": s, "box": [x, y, w, h]} for t, x, y, w, h, s in blocks]}


def write(pages_dir: Path, pages) -> None:
    pages_dir.mkdir(parents=True, exist_ok=True)
    for p in pages:
        (pages_dir / f"p{p['page']:03d}.json").write_text(json.dumps(p, ensure_ascii=False), encoding="utf-8")


def patch(monkey_dirs: dict) -> None:
    PB.ROOT = WORK
    PB.OUT_DIR = WORK / "data" / "bank"
    PB.load_pages = lambda tag, start=1, end=10**9: [
        json.loads(f.read_text(encoding="utf-8"))
        for f in sorted((monkey_dirs[tag]).glob("p*.json"))
        if start <= int(f.stem[1:]) <= end
    ]
    BL.load_pages = PB.load_pages


UP_HEAD = [("第一章图形推理", 984, 105, 110, 30, 0.75)]
DN_HEAD = [("·第一章图形推理", 1085, 144, 106, 28, 0.70)]


def test_restart_and_running_head_and_figure_zone() -> None:
    up = [
        page("up", 11, UP_HEAD + [
            ("1.（2025广东49）从所给的四个选项中，选择最合适的一个填入问号处，使之", 215, 1334, 1008, 32, 0.94),
            ("呈现一定的规律性。", 160, 1383, 238, 27, 0.86),
            ("本部分题目解析见下册第1～5页。", 213, 1860, 500, 28, 0.90),
        ]),
        page("up", 12, [("决战行测5000题·判断推理（上册）", 164, 95, 400, 26, 0.9)] + [
            ("2.（2020四川58）从所给的四个选项中，选择最合适的一个填入问号处，使之", 215, 174, 1008, 32, 0.95),
            ("呈现一定的规律性。", 164, 230, 238, 27, 0.84),
            ("☆☆☆ ☆☆", 592, 1155, 200, 26, 0.61),  # inside the artwork: not stem
            ("A. ☆☆ B. ☆☆☆", 211, 1359, 300, 26, 0.63),
            ("11", 1191, 1901, 37, 28, 0.9),
        ]),
        page("up", 13, UP_HEAD + [
            ("考点 2 旋转、翻转", 158, 971, 400, 34, 0.85),
            ("「考点介绍」", 157, 1082, 189, 34, 0.76),
            ("1.曲直性：根据组成图形的线条是曲线还是直线，可将图形分为全曲线图形", 219, 1166, 1004, 29, 0.89),
            ("3.（2023国考地市73）分析下图中图形的变化规律，变化后第五行的图形应该是：", 213, 1400, 1008, 32, 0.90),
        ]),
    ]
    dn = [
        page("dn", 5, DN_HEAD + [
            ("1.【答案】B。粉笔大数据：本题正确率为86.53%，易错项为C。", 182, 380, 804, 32, 0.93),
            ("【解析】元素组成相同，优先考虑位置规律。故正确答案为B。", 177, 435, 1014, 31, 0.91),
            ("*打开粉笔APP扫一扫", 1250, 470, 90, 90, 0.60),
        ]),
        page("dn", 6, DN_HEAD + [
            ("2.【答案】D。粉笔大数据：本题正确率为84.07%，易错项为C。", 181, 640, 806, 31, 0.93),
            ("【解析】观察发现，题干每幅图均由两个封闭图形相交而成。故正确答案为D。", 176, 693, 1013, 33, 0.92),
        ]),
        page("dn", 7, DN_HEAD + [
            ("3.【答案】A。", 181, 956, 805, 32, 0.95),
            ("【解析】题干每幅图均出现几个小图形连在一起。故正确答案为A。", 177, 1009, 1012, 32, 0.93),
        ]),
    ]
    patch({"up": WORK / "data/ocr/up", "dn": WORK / "data/ocr/dn"})
    write(WORK / "data/ocr/up", up)
    write(WORK / "data/ocr/dn", dn)

    answers, _ = PB.parse_answer_stream(999)
    items, notes = PB.parse_question_stream(999)
    pairs, issues = PB.align(items, answers)
    questions, more = PB.assemble(pairs, 999)

    assert [q["num"] for q in questions] == [1, 2, 3], [q["num"] for q in questions]
    assert all(q["chapterIndex"] == 1 for q in questions), "running head must not zero the chapter"
    assert questions[0]["pointTitle"] == "考点1" or questions[0]["pointTitle"] is None
    assert questions[2]["pointTitle"] == "考点2 旋转、翻转"
    assert "☆☆☆" not in questions[1]["stem"], questions[1]["stem"]
    assert "本部分题目解析见" not in questions[0]["stem"]
    assert questions[1]["options"] and questions[1]["options"][0]["label"] == "A"
    assert [q["answer"] for q in questions] == ["B", "D", "A"], [q["answer"] for q in questions]
    assert questions[0]["accuracy"] == 86.53
    assert questions[0]["trapOption"] == "C"
    assert "打开粉笔APP" not in (questions[0]["analysis"] or "")
    assert questions[0]["bands"], "the figure zone below the stem must be detected"
    assert questions[0]["bands"][0]["y0"] >= 1410
    assert not any(i["type"] == "answer-without-question" for i in issues), issues
    assert all(q["num"] in (1, 2, 3) for q in questions), "the printed page number is not question 11"


def test_number_gap_is_recorded_not_dropped_silently() -> None:
    up = [page("up", 20, UP_HEAD + [
        ("1.（2024山东65）从所给的四个选项中，选择最合适的一个填入问号处，使之呈现一定的规律性。", 215, 400, 1008, 32, 0.94),
        ("3.（2024国考77）分析所给图形，选择最合适的一项。", 215, 900, 1008, 32, 0.94),
    ])]
    patch({"up": WORK / "data/ocr/up2", "dn": WORK / "data/ocr/dn2"})
    write(WORK / "data/ocr/up2", up)
    write(WORK / "data/ocr/dn2", [])
    items, notes = PB.parse_question_stream(999)
    assert [it["num"] for it in items] == [1, 3]
    assert any(n["type"] == "gap-in-question-numbers" and n["from"] == 1 and n["to"] == 3 for n in notes), notes


def test_prose_numbered_list_is_not_a_question() -> None:
    up = [page("up", 30, UP_HEAD + [
        ("考点 3 遍历", 158, 200, 400, 34, 0.85),
        ("1.遍历：定义遍历规律如下，先横着或竖着看某些图形中存在的相同元素。", 219, 400, 1004, 29, 0.89),
        ("2.整体是两个部分组成的题目，考虑整体组合。", 219, 460, 1004, 29, 0.89),
    ])]
    patch({"up": WORK / "data/ocr/up3", "dn": WORK / "data/ocr/dn3"})
    write(WORK / "data/ocr/up3", up)
    write(WORK / "data/ocr/dn3", [])
    items, _ = PB.parse_question_stream(999)
    assert items == [], f"theory list must not become questions: {[i['num'] for i in items]}"


def test_prose_phantom_loses_the_answer_to_the_real_question() -> None:
    """A 考点介绍 paragraph numbered "1." that slipped past the shape test must be dropped
    when the block's first real question carries the same number. The first panduan build
    kept both, so the paragraph was served the question's 解析 — a textbook list item with
    someone else's answer, found by the visual pass (c3-0041/c3-0042)."""
    up = [page("up", 55, UP_HEAD + [
        ("考点2 并列关系", 158, 200, 400, 34, 0.85),
        ("1.并列关系可以分为矛盾关系和反对关系。（1）矛盾关系是指非A即B，没有第三种情况存在。",
         219, 400, 1004, 29, 0.89),
        ("（一）夯实基础", 158, 700, 300, 30, 0.9),
        ("1.（2021海南81）就地保护：易地保护", 219, 760, 1004, 29, 0.9),
        ("A.在海洋中建立自然保护区", 219, 820, 1004, 29, 0.9),
        ("B.在植物园中迁地保护", 219, 860, 1004, 29, 0.9),
    ])]
    patch({"up": WORK / "data/ocr/up9", "dn": WORK / "data/ocr/dn9"})
    write(WORK / "data/ocr/up9", up)
    write(WORK / "data/ocr/dn9", [])
    items, notes = PB.parse_question_stream(999)
    assert len(items) == 1, f"prose phantom survived: {[(i['num'], i['stem'][:12]) for i in items]}"
    assert items[0]["source"], "the surviving item must be the tagged real question"
    assert any(n.get("type") == "prose-phantom-dropped" for n in notes), notes


def test_underdetected_block_cannot_steal_the_next_blocks_answers() -> None:
    """The regression that corrupted the first panduan build: a whole 卷 of the
    question book failed to parse, and the number-window walk let the *next*
    卷's questions eat the missing 卷's answers — same nums, wrong questions.
    Footnote ranges and block keys must keep the marriage honest."""
    up = [
        page("up", 40, UP_HEAD + [
            # 卷二 block: 2 questions detectable (pretend q3+ were lost to OCR)
            ("卷二", 158, 200, 200, 34, 0.9),
            ("1.（2024山东63）从所给的四个选项中，选择最合适的一个填入问号处。", 215, 400, 1008, 32, 0.94),
            ("2.（2024山东64）从所给的四个选项中，选择最合适的一个填入问号处。", 215, 900, 1008, 32, 0.94),
            ("本部分题目解析见下册第10～11页。", 213, 1860, 500, 28, 0.90),
        ]),
        # 卷五 block: its questions come AFTER 卷二's in the book, but the answer
        # book holds answers for the (unparsed) 卷三/卷四 in between.
        page("up", 41, UP_HEAD + [
            ("卷五", 158, 200, 200, 34, 0.9),
            ("1.（2025国考78）把下面的六个图形分为两类。", 215, 400, 1008, 32, 0.94),
            ("2.（2025国考79）把下面的六个图形分为两类。", 215, 900, 1008, 32, 0.94),
            ("本部分题目解析见下册第20～21页。", 213, 1860, 500, 28, 0.90),
        ]),
    ]
    # answer book: 卷二 at pdf 10-11, 卷三/卷四 (no question pages) at 12-19,
    # 卷五 at 20-21. Printed page numbers make the pdf↔book offset 0.
    def dn_page(n, juan, answers):
        blocks = [("·第一章图形推理", 1085, 144, 106, 28, 0.70), (juan, 182, 380, 300, 30, 0.9)]
        for num, letter in answers:
            y = 600 + 200 * (num - 1)
            blocks.append((f"{num}.【答案】{letter}。粉笔大数据：本题正确率为70%，易错项为A。", 181, y, 806, 31, 0.93))
            blocks.append((f"【解析】卷面分析。故正确答案为{letter}。", 177, y + 50, 1013, 31, 0.92))
        blocks.append((str(n), 1191, 1901, 37, 28, 0.9))
        return page("dn", n, blocks)

    dn = [
        dn_page(10, "卷二", [(1, "B"), (2, "D")]),
        dn_page(12, "卷三", [(1, "C"), (2, "A")]),
        dn_page(20, "卷五", [(1, "D"), (2, "A")]),
    ]
    patch({"up": WORK / "data/ocr/up4", "dn": WORK / "data/ocr/dn4"})
    write(WORK / "data/ocr/up4", up)
    write(WORK / "data/ocr/dn4", dn)

    answers, _ = PB.parse_answer_stream(999)
    items, _ = PB.parse_question_stream(999)
    pairs, issues = PB.align(items, answers)
    questions, _ = PB.assemble(pairs, 999)

    assert [q["num"] for q in questions] == [1, 2, 1, 2]
    # 卷二's answers B/D … and 卷五's D/A. If the walk drifted, 卷五 would get
    # 卷三's C/A — that exact theft is what this test locks out.
    assert [q["answer"] for q in questions] == ["B", "D", "D", "A"], [q["answer"] for q in questions]
    assert [q["answerPageRef"]["page"] for q in questions] == [10, 10, 20, 20]
    # 卷三's answers must stay unconsumed, not married to anyone
    stolen = [i for i in issues if i["type"] == "trailing-answer"]
    assert any(i["page"] == 12 for i in stolen), issues


def test_chapter_gate_blocks_cross_chapter_theft() -> None:
    """Answers of chapter 1 must never be handed to chapter 2 questions. The
    old window walk let a ch2 question whose num matched a *leftover* ch1
    answer steal it — the exact 专项集训/定义判断 corruption of the first build."""
    up = [
        # ch1: q1 parsed, q2/q3 lost to OCR → their answers linger unconsumed
        page("up", 50, UP_HEAD + [
            ("1.（2024山东63）从所给的四个选项中，选择最合适的一个填入问号处。", 215, 400, 1008, 32, 0.94),
        ]),
        # ch2: q1 lost too; its questions start at num 2 — the theft bait
        page("up", 51, [("第二章「定义判断", 164, 300, 600, 26, 0.9)] + [
            ("2.（2025广西73）文化再生产是指文化模式、信仰、价值观的传递。", 215, 400, 1008, 32, 0.94),
            ("3.（2025广西74）负性偏向是指负性信息得到优先的注意和加工。", 215, 900, 1008, 32, 0.94),
        ]),
    ]
    dn = [
        page("dn", 30, DN_HEAD + [
            ("1.【答案】B。粉笔大数据：本题正确率为86%，易错项为C。", 181, 380, 806, 32, 0.93),
            ("【解析】图形推理分析。故正确答案为B。", 177, 435, 1014, 31, 0.91),
            ("2.【答案】D。粉笔大数据：本题正确率为86%，易错项为C。", 181, 520, 806, 32, 0.93),
            ("【解析】图形推理分析。故正确答案为D。", 177, 575, 1014, 31, 0.91),
            ("第二章「定义判断", 182, 700, 600, 30, 0.9),
            ("1.【答案】C。粉笔大数据：本题正确率为91%，易错项为A。", 181, 900, 806, 32, 0.93),
            ("【解析】定义判断分析。故正确答案为C。", 177, 955, 1014, 31, 0.91),
            ("2.【答案】B。粉笔大数据：本题正确率为91%，易错项为A。", 181, 1050, 806, 32, 0.93),
            ("【解析】定义判断分析。故正确答案为B。", 177, 1105, 1014, 31, 0.91),
            ("3.【答案】D。粉笔大数据：本题正确率为91%，易错项为A。", 181, 1200, 806, 32, 0.93),
            ("【解析】定义判断分析。故正确答案为D。", 177, 1255, 1014, 31, 0.91),
        ]),
    ]
    patch({"up": WORK / "data/ocr/up5", "dn": WORK / "data/ocr/dn5"})
    write(WORK / "data/ocr/up5", up)
    write(WORK / "data/ocr/dn5", dn)

    answers, _ = PB.parse_answer_stream(999)
    items, _ = PB.parse_question_stream(999)
    assert [a["chapter"] for a in answers] == [1, 1, 2, 2, 2], "mangled 第二章 heading must still switch chapters"
    pairs, _ = PB.align(items, answers)
    questions, _ = PB.assemble(pairs, 999)
    # old window walk: ch2 q2 (num 2) steals ch1's leftover answer D here
    assert [q["answer"] for q in questions] == ["B", "B", "D"], [q["answer"] for q in questions]


def test_yanyu_theory_terms_and_toc_rows_are_not_questions() -> None:
    """言语 book regressions: 考点介绍 tables number their terms ("1.转折关系",
    which STEM_TAIL's 关系 alternative makes look like a stem); the 目录 prints
    chapter rows with trailing page numbers ("第三章逻辑填空 216"); the body
    divider OCRs with a doubled numeral ("第一一章"). None of these may corrupt
    either stream's chapter state or manufacture phantom items that would steal
    夯实基础's answers."""
    up = [
        page("up", 3, [
            ("第一章片段阅读 1", 412, 413, 400, 30, 0.9),
            ("第一节 中心理解题 1", 300, 521, 500, 30, 0.9),
            ("考点1 关联词 2", 300, 620, 400, 30, 0.9),
        ]),
        page("up", 10, UP_HEAD + [
            ("考点 1 关联词", 158, 213, 400, 34, 0.85),
            ("1.转折关系", 202, 510, 200, 30, 0.9),
            ("虽然…但是…；尽管…可是…", 219, 593, 500, 29, 0.89),
            ("2.因果关系", 190, 700, 200, 30, 0.9),
            ("「决战真题」", 157, 900, 189, 34, 0.76),
        ]),
        page("up", 15, UP_HEAD + [
            ("第一章片段阅读", 984, 136, 110, 30, 0.75),
            ("（一）夯实基础", 326, 326, 300, 30, 0.9),
            ("1.（2024江苏A29）生产性服务业包括研发设计、信息数据等领域，环节众多。", 200, 384, 1008, 32, 0.94),
        ]),
    ]
    dn = [
        page("dn", 5, [
            ("第三章逻辑填空 216", 158, 413, 400, 30, 0.9),
            ("考点1 词语辨析搭配对象 216", 300, 521, 500, 30, 0.9),
            ("（一）夯实基础 216", 300, 581, 400, 30, 0.9),
        ]),
        page("dn", 7, [
            ("第一一章片段阅读", 182, 423, 400, 30, 0.9),
            ("第一节中心理解题", 182, 639, 400, 30, 0.9),
            ("考点1关关联词", 182, 805, 400, 30, 0.9),
            ("（一）夯实基础", 182, 1021, 300, 30, 0.9),
            ("1.【答案】A。粉笔大数据：本题正确率为79.74%，易错项为C。", 181, 1093, 804, 32, 0.93),
            ("【解析】开篇引出话题。故正确答案为A。", 177, 1145, 1014, 31, 0.91),
        ]),
        page("dn", 9, [
            ("第一章　 片段阅读", 182, 144, 400, 30, 0.9),
            ("2.【答案】D。粉笔大数据：本题正确率为75.89%，易错项为D。", 181, 1618, 804, 32, 0.93),
            ("【解析】文学翻译话题。故正确答案为D。", 177, 1671, 1014, 31, 0.91),
        ]),
    ]
    patch({"up": WORK / "data/ocr/up6", "dn": WORK / "data/ocr/dn6"})
    write(WORK / "data/ocr/up6", up)
    write(WORK / "data/ocr/dn6", dn)

    answers, _ = PB.parse_answer_stream(999)
    items, _ = PB.parse_question_stream(999)
    # the dn 目录 rows (ch3/ch4 + 考点/(一) with page numbers) must leave no trace:
    # the body divider "第一一章" is what sets chapter 1
    assert [a["chapter"] for a in answers] == [1, 1], [a["chapter"] for a in answers]
    assert all((a["bsec"], a["bpt"], a["bsub"]) == (1, 1, 1) for a in answers), \
        [(a["num"], a["bsec"], a["bpt"], a["bsub"]) for a in answers]
    # theory-table rows must not become questions, tagged real ones must
    assert [it["num"] for it in items] == [1], [(it["num"], it["stem"]) for it in items]
    assert items[0]["bsub"] == 1 and items[0]["source"], items[0]
    pairs, _ = PB.align(items, answers)
    assert pairs[0][1] is not None and pairs[0][1]["answer"] == "A", pairs[0][1]
    assert pairs[0][2] == "key", pairs[0][2]


def test_tagged_restart_opens_block_when_heading_is_lost() -> None:
    """言语 prints 综合训练一~五 whose headings the OCR can lose entirely; the
    papers' numbers then restart 20→1 with no heading in between. The restart
    rule must open the new block — otherwise the next paper's q1..q9 are
    swallowed into the previous paper's last item (a 7-page monster) and only
    every 10th question survives."""
    up = [
        page("up", 60, UP_HEAD + [
            ("19.（2024贵州36）开发前沿技术应用场景的实践价值在于。", 215, 300, 1008, 32, 0.94),
            ("20.（2025广东21）我国农业基础还不稳固。", 215, 900, 1008, 32, 0.94),
        ]),
        page("up", 61, UP_HEAD + [
            ("1.（2022国考副省48）行政处罚不是为罚而罚。", 215, 300, 1008, 32, 0.94),
            ("2.（2025安徽70）人工智能带来的智能化趋势提升了社会治理效能。", 215, 900, 1008, 32, 0.94),
        ]),
        page("up", 62, UP_HEAD + [
            ("综合训练三", 158, 150, 300, 34, 0.9),
            ("1.（2024浙江C47）行星撞击说认为，6500万年前一颗小行星撞击了地球。", 215, 400, 1008, 32, 0.94),
        ]),
    ]
    patch({"up": WORK / "data/ocr/up7", "dn": WORK / "data/ocr/dn7"})
    write(WORK / "data/ocr/up7", up)
    write(WORK / "data/ocr/dn7", [])
    items, _ = PB.parse_question_stream(999)
    assert [it["num"] for it in items] == [19, 20, 1, 2, 1], [(it["num"], it["stem"]) for it in items]
    # the swallowed-question regression: q20's stem must not contain the next
    # paper's text, and the restarted q1 must carry its own stem
    assert "行政处罚" not in " ".join(items[1]["stem"]), items[1]["stem"]
    assert "行政处罚" in " ".join(items[2]["stem"]), items[2]["stem"]
    # a parseable 综合训练 heading sets the paper context on its block
    assert items[4]["bpaper"] == "综合训练三" and items[4]["drill"] == "综合训练三", items[4]


def main() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {t.__name__}: {e}")
    shutil.rmtree(WORK, ignore_errors=True)
    print(f"{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
