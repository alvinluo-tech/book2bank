"""Regression tests for the 资料分析 (material-group) layout.

These lock the rules that the scan forced on us and that the 判断推理 parser does
NOT share:

  * one 资料 belongs to the group of items below it, and to no other group
  * printed item numbers are **continuous** across groups inside a set — the second
    资料 starts at 6, not at 1
  * the material caption is picked by the CJK/digit balance, so a table row
    ("全国 1318 1565 …") never becomes the title
  * a chapter change resets numbering, a group change does not

Run:  python pipeline/test_material.py
"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import books  # noqa: E402
import parse_bank as PB  # noqa: E402
import parse_material as PM  # noqa: E402

WORK = Path(tempfile.mkdtemp(prefix="quizmat-"))


def page(tag: str, n: int, blocks, height: int = 2016, width: int = 1394) -> dict:
    return {"page": n, "tag": tag, "dpi": 200, "width": width, "height": height,
            "blocks": [{"text": t, "score": s, "box": [x, y, w, h]} for t, x, y, w, h, s in blocks]}


def install(up_pages, dn_pages) -> None:
    dirs = {"up": WORK / "zl-up", "dn": WORK / "zl-dn"}
    for side, pages in (("up", up_pages), ("dn", dn_pages)):
        d = dirs[side]
        d.mkdir(parents=True, exist_ok=True)
        for f in d.glob("p*.json"):
            f.unlink()
        for p in pages:
            (d / f"p{p['page']:03d}.json").write_text(json.dumps(p, ensure_ascii=False), encoding="utf-8")

    PB.books = books  # type: ignore[attr-defined]
    orig = books.get_bank("ziliao")
    cfg = {**orig, "tag": {"up": "zl-up", "dn": "zl-dn"}, "outDir": WORK / "out",
           "idPrefix": "zl-", "layout": "material-group"}
    books.BANKS["ziliao"] = cfg
    PB.use_bank("ziliao")

    def loader(tag, start=1, end=10**9):
        d = WORK / tag
        return [json.loads(f.read_text(encoding="utf-8"))
                for f in sorted(d.glob("p*.json"))
                if start <= int(f.stem[1:]) <= end] if d.exists() else []

    PB.load_pages = loader
    PM.load_pages = loader


HEAD = [("决战行测5000题·资料分析（上册）", 143, 106, 401, 28, 0.9)]
CH1 = [("第一章表格资料", 974, 120, 248, 28, 0.75)]

UP = [
    page("zl-up", 12, CH1 + [
        ("「夯实基础」", 139, 190, 188, 34, 0.85),
        ("【作业题1】", 192, 260, 162, 28, 0.8),
        ("（一）", 638, 309, 73, 26, 0.6),
        ("（2023国考副省121～125）根据下列资料完成以下各题。", 196, 363, 727, 30, 0.93),
        ("2016一2021年全国及部分省市集成电路产量", 392, 414, 563, 30, 0.9),
        ("单位：亿块", 1072, 465, 134, 26, 0.9),
        ("2016年 2017年 2018年 2019年 2020年 2021年", 323, 528, 854, 28, 0.88),
        ("全国 1318 1565 1853 2018 2614 3594", 191, 581, 968, 28, 0.9),
        ("江苏 454 518 554 516 835 1186", 191, 633, 968, 28, 0.9),
        ("1.2021年，表中所列省市集成电路产量约占全国总产量的：", 198, 1005, 735, 30, 0.93),
        ("A. 80% B. 84%", 196, 1056, 560, 28, 0.9),
        ("C. 88% D. 92%", 197, 1107, 562, 28, 0.9),
        ("2.2017一2021年间，全国集成电路产量同比增速超过20%的年份有几个？", 195, 1160, 921, 30, 0.93),
        ("A. 1 B. 2", 195, 1212, 526, 28, 0.9),
        ("C. 3 D. 4", 195, 1263, 529, 28, 0.9),
        ("本部分题目解析见下册第1～10页。", 197, 1825, 433, 28, 0.9),
    ]),
    page("zl-up", 13, CH1 + [
        ("（二）", 654, 620, 71, 26, 0.7),
        ("（2025国考行政执法116～120）根据下列资料完成以下各题。", 209, 672, 784, 30, 0.93),
        ("2020-2023年Z省律师、基层法律服务工作数据", 378, 727, 623, 30, 0.9),
        ("律师事务所总数（家） 1636 1705 1755 1826", 166, 851, 1019, 28, 0.9),
        ("律师人数（人） 27302 30889 36938 41924", 167, 908, 1024, 28, 0.9),
        ("6.2023年，Z省含村、社区在内的法律顾问数约是2020年的多少倍？", 214, 1320, 860, 30, 0.93),
        ("A. 1.2 B. 1.4", 212, 1373, 543, 28, 0.9),
        ("C. 1.6 D. 1.8", 212, 1423, 546, 28, 0.9),
        ("13", 1177, 1904, 30, 26, 0.9),
    ]),
]

DN = [
    page("zl-dn", 5, [("·第一章表格资料", 1085, 144, 106, 28, 0.7)] + [
        ("1.【答案】D。粉笔大数据：本题正确率为76.4%，易错项为C。", 182, 380, 804, 32, 0.93),
        ("【解析】比重=部分/整体。故正确答案为D。", 177, 435, 1014, 31, 0.91),
        ("2.【答案】B。粉笔大数据：本题正确率为77.94%，易错项为C。", 181, 640, 806, 31, 0.93),
        ("【解析】增长量比较。故正确答案为B。", 176, 693, 1013, 33, 0.92),
    ]),
    page("zl-dn", 6, [("·第一章表格资料", 1085, 144, 106, 28, 0.7)] + [
        ("6.【答案】C。粉笔大数据：本题正确率为62.1%，易错项为D。", 181, 956, 805, 32, 0.95),
        ("【解析】倍数计算。故正确答案为C。", 177, 1009, 1012, 32, 0.93),
    ]),
]


def parse():
    install(UP, DN)
    answers, _ = PB.parse_answer_stream(999)
    materials, items, notes = PM.parse_stream(999)
    questions, out_mats, issues = PM.assemble(materials, items, answers, 999)
    return questions, out_mats, items, notes, issues


def test_group_owns_its_items_and_numbering_is_continuous() -> None:
    questions, mats, items, notes, issues = parse()
    assert [q["num"] for q in questions] == [1, 2, 6], [q["num"] for q in questions]
    assert questions[0]["materialId"] == questions[1]["materialId"], "same 资料 for the group"
    assert questions[2]["materialId"] != questions[0]["materialId"], "second 资料 is its own group"
    assert len(mats) == 2, f"two groups expected, got {len(mats)}"
    assert mats[0]["title"] == "2016一2021年全国及部分省市集成电路产量", mats[0]["title"]
    assert mats[0]["unit"] == "亿块", mats[0]["unit"]
    assert "全国" in (mats[0]["text"] or ""), "table rows belong to the material text"
    assert not any("1318" in (m["title"] or "") for m in mats), "a table row must never become a title"
    assert mats[0]["groupLabel"] == "（一）" and mats[1]["groupLabel"] == "（二）"
    assert [q["answer"] for q in questions] == ["D", "B", "C"], [q["answer"] for q in questions]
    assert questions[0]["accuracy"] == 76.4
    assert questions[0]["source"]["year"] == 2023 and questions[0]["source"]["region"]
    assert not any(i["type"] == "answer-without-question" for i in issues), issues
    assert all(q["bankId"] == "ziliao" for q in questions)
    assert questions[0]["id"].startswith("zl-c"), questions[0]["id"]
    assert "本部分题目解析见" not in (mats[0]["text"] or "")


def test_material_geometry_is_recorded_for_cropping() -> None:
    _questions, mats, _items, _notes, _issues = parse()
    seg = mats[0]["segments"][-1]
    assert seg[0] == 12 and seg[1] <= 400 and seg[2] >= 600, mats[0]["segments"]
    assert mats[0]["pageRef"]["tag"] == "zl-up" and mats[0]["pageRef"]["page"] == 12


def test_phantom_and_missing_anchors_still_pair() -> None:
    """One stray numbered line inside a table and one lost anchor must not cascade.

    This is what the DP aligner is for: the printed numbers repeat every 作业题, so a
    plain positional zip or a number-only key loses the rest of the chapter after a
    single miss.
    """
    up = [page("zl-up", 20, CH1 + [
        ("（一）", 638, 200, 73, 26, 0.7),
        ("（2024联考101～105）根据下列资料完成以下各题。", 196, 250, 727, 30, 0.93),
        ("2019-2023年某市公路货运量", 392, 300, 563, 30, 0.9),
        ("1.2023年该市公路货运量比上年约：", 198, 420, 735, 30, 0.93),
        ("A. 增长5% B. 减少5%", 196, 470, 560, 28, 0.9),
        ("C. 增长15% D. 减少15%", 197, 520, 562, 28, 0.9),
        ("68.36 76.43 81.24 93.55", 191, 570, 968, 28, 0.9),  # table row, not question 68
        ("3.则2021—2023年该市货物周转量年均增速约为：", 195, 640, 921, 30, 0.93),
        ("A. 3% B. 5%", 195, 690, 526, 28, 0.9),
        ("C. 7% D. 9%", 195, 740, 529, 28, 0.9),
    ])]
    dn = [page("zl-dn", 9, [("·第一章图形资料", 1085, 144, 106, 28, 0.7)] + [
        ("1.【答案】A。粉笔大数据：本题正确率为81.2%，易错项为C。", 182, 380, 804, 32, 0.93),
        ("【解析】基期量比较。故正确答案为A。", 177, 435, 1014, 31, 0.91),
        ("2.【答案】D。粉笔大数据：本题正确率为66.0%，易错项为B。", 181, 500, 806, 31, 0.93),
        ("【解析】年均增速。故正确答案为D。", 176, 555, 1013, 33, 0.92),
    ])]
    install(up, dn)
    answers, _ = PB.parse_answer_stream(999)
    mats, items, _notes = PM.parse_stream(999)
    nums = [it["num"] for it in items]
    assert 68 not in nums, f"a table row became question 68: {nums}"
    seq, _stray = PM.sequence(items)
    pairs, issues = PM.align_local(seq, answers)
    by_num = {it["num"]: a for it, a, _m in pairs}
    assert by_num.get(1) is not None and by_num[1]["answer"] == "A", by_num
    # The 上册 printed 3 but the 下册 only answered 1 and 2, so which item that answer
    # belongs to is genuinely unknown: the safe outcome is a visible gap, not a guess.
    assert by_num.get(3) is None, f"invented a pairing: {by_num[3]}"
    assert any(i["type"] == "question-without-answer" and i["num"] == 3 for i in issues), issues


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
    books.BANKS["ziliao"] = dict(books.BANKS["ziliao"])
    print(f"{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
