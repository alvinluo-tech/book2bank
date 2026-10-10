"""Line reconstruction + structural classification for the OCR'd books.

Shared by the dump tool (bank_lines.py --dump) and the parser (parse_bank.py).
Blocks come from data/ocr/<tag>/pNNN.json produced by ocr_pages.py (dpi 200).
"""
from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OCR_DIR = ROOT / "data" / "ocr"

CJK = r"\u4e00-\u9fff\u3400-\u4dbf"
CN_NUM = "一二三四五六七八九十"

# The scan keeps gluing a bracket onto in-body chapter headings ("第二章「定义判断",
# "第二章」定义判断"); a heading with that noise still identifies its chapter. The
# leading 一 tolerates OCR noise BEFORE 第 ("一第一章片段阅读"), and a duplicated
# numeral ("第一一章") is crushed in classify before the CN lookup.
RE_CHAPTER = re.compile(rf"^[·•\s一]*第([{CN_NUM}]+)章[「」『』【】\s·•]*([{CJK}]+)")
RE_SECTION = re.compile(rf"^[·•\s]*第([{CN_NUM}]+)节\s*([{CJK}][{CJK}、/·（）()\-]*)")
# 数学运算/数字推理的选项可以到 E–H（江苏卷 8 选项），不只是 A–D。
RE_POINT = re.compile(rf"^考点\s*(\d+)\s*(.*)")
RE_JUAN = re.compile(rf"^卷\s*([{CN_NUM}]+)\s*$")
# 综合训练（言语）/综合练习（判断推理）是同一层级的训练块标题。
RE_LIANXI = re.compile(rf"^综合[训练][练习]\s*([{CN_NUM}]+)?\s*$")
# 章内的创新考法小节（"逻辑填空题的创新考法"）与篇章阅读的题材小节
# （"普通题材"/"公文题材"）：两册都以同样的裸标题印刷，是真实的块边界。
RE_INNOV = re.compile(rf"^[·•\s]*([{CJK}]{{2,10}}题)的创新考法\s*$")
RE_THEME = re.compile(rf"^[·•\s]*([{CJK}]{{1,8}}题材)\s*$")
RE_ANSWER_KEY = re.compile(r"^答案速览\s*$")
# 目录行以点线+印刷页码结尾（"第三章逻辑填空 216"）；正文标题从不这样收尾。
RE_TOC_TAIL = re.compile(r"[·•\s.…·]{0,8}\d{1,3}$")
RE_MARKER = re.compile(rf"^[「【『]?\s*([{CJK}]{{2,6}})\s*[」】』]?$")
RE_PAGE_NUM = re.compile(r"^[IVXLCivxlcdm0-9·\s]{1,8}$")
RE_QNUM = re.compile(r"^(\d{1,3})\s*[.、．,，]\s*(.*)$", re.S)
RE_ANSWER = re.compile(r"^(\d{1,3})\s*[.、．]?\s*【\s*答案\s*】\s*[:：]?\s*([A-H])")  # 上册行分类用严格式：放宽会把普通行当成答案条目，导致同一区域被切成两道题
RE_OPTION = re.compile(r"(?<![A-Za-z0-9])([A-H])\s*[.、．,，:]")
RE_ACCURACY = re.compile(r"本题正确率为\s*(\d{1,3}(?:\.\d+)?)\s*%")
RE_TRAP = re.compile(r"易错项为\s*([A-H])")
RE_FINAL_ANSWER = re.compile(r"故正确答案为\s*([A-H])")
RE_SOURCE = re.compile(r"^[（(]\s*((?:19|20)\d{2})?\s*([^{（()）]{0,12}?)\s*(\d{1,4})?\s*[)）]")

# Markers that open a theory block vs. a question block.
THEORY_MARKERS = {"考点介绍", "知识讲解", "考点讲解", "理论速览", "要点提示"}
QUESTION_MARKERS = {
    "真题演练", "实战演练", "考点演练", "真题精选", "强化训练", "巩固训练",
    "专项训练", "精准训练", "考点预测", "模拟预测", "刷题", "小试牛刀",
}


@dataclass
class Line:
    text: str
    x: float
    y: float
    w: float
    h: float
    score: float
    page: int
    tag: str
    kind: str = "text"
    num: int | None = None
    extra: dict = field(default_factory=dict)

    @property
    def y2(self) -> float:
        return self.y + self.h

    @property
    def x2(self) -> float:
        return self.x + self.w


def _join(parts: list[tuple[float, str]]) -> str:
    """Glue same-line fragments: no space between CJK, space around latin/digits."""
    out = ""
    for _, txt in parts:
        if not out:
            out = txt
            continue
        a, b = out[-1], txt[0]
        needs_space = not (re.match(rf"[{CJK}]", a) and re.match(rf"[{CJK}]", b))
        out += (" " if needs_space else "") + txt
    return out


def load_pages(tag: str, start: int = 1, end: int = 10**9) -> list[dict]:
    pages = []
    d = OCR_DIR / tag
    if not d.exists():
        return pages
    for f in sorted(d.glob("p*.json")):
        n = int(f.stem[1:])
        if n < start or n > end:
            continue
        pages.append(json.loads(f.read_text(encoding="utf-8")))
    return pages


def build_lines(page: dict) -> list[Line]:
    """Merge OCR blocks into visual lines, sorted top-to-bottom."""
    blocks = [b for b in page["blocks"] if b["text"].strip()]
    blocks.sort(key=lambda b: (b["box"][1] + b["box"][3] / 2))
    groups: list[list[dict]] = []
    for b in blocks:
        x, y, w, h = b["box"]
        yc = y + h / 2
        placed = False
        for g in groups[::-1][:4]:
            gy = sum(bb["box"][1] + bb["box"][3] / 2 for bb in g) / len(g)
            gh = max(bb["box"][3] for bb in g)
            if abs(yc - gy) <= max(9.0, gh * 0.62):
                g.append(b)
                placed = True
                break
        if not placed:
            groups.append([b])
    lines: list[Line] = []
    for g in groups:
        g.sort(key=lambda b: b["box"][0])
        text = _join([(b["box"][0], b["text"]) for b in g])
        x = min(b["box"][0] for b in g)
        y = min(b["box"][1] for b in g)
        x2 = max(b["box"][0] + b["box"][2] for b in g)
        y2 = max(b["box"][1] + b["box"][3] for b in g)
        lines.append(Line(
            text=text.strip(), x=x, y=y, w=x2 - x, h=y2 - y,
            score=sum(b["score"] for b in g) / len(g),
            page=page["page"], tag=page["tag"],
        ))
    return lines


def _crush_num(s: str) -> str:
    """OCR doubles chapter/section numerals ("第一一章"); collapse the run."""
    return re.sub(r"(.)\1+", r"\1", s)


def classify(line: Line, page_h: int) -> Line:
    t = line.text.strip()
    if not t:
        line.kind = "blank"
        return line
    # Structural headings win over the running-head test: the running header of
    # this book *is* "第一章 图形推理", and it is the most reliable chapter cue.
    # A trailing printed page number means the line is a 目录 row, not a heading.
    m = RE_CHAPTER.match(t)
    if m and not RE_TOC_TAIL.search(t):
        line.kind = "chapter"
        g = m.groups()
        line.extra["chapter"] = (_crush_num(g[0]),) + tuple(g[1:])
        return line
    m = RE_SECTION.match(t)
    if m and not RE_TOC_TAIL.search(t):
        line.kind = "section"
        g = m.groups()
        line.extra["section"] = (_crush_num(g[0]),) + tuple(g[1:])
        return line
    if RE_LIANXI.match(t) and not RE_TOC_TAIL.search(t):
        line.kind = "lianxi"
        line.extra["lianxi"] = RE_LIANXI.match(t).group(1) or ""
        return line
    m = RE_INNOV.match(t)
    if m and not RE_TOC_TAIL.search(t):
        line.kind = "innov"
        line.extra["innov"] = m.group(1)
        return line
    m = RE_THEME.match(t)
    if m and not RE_TOC_TAIL.search(t):
        line.kind = "theme"
        line.extra["theme"] = m.group(1)
        return line
    if RE_POINT.match(t) and not RE_TOC_TAIL.search(t):
        line.kind = "point"
        line.extra["point"] = RE_POINT.match(t).groups()
        return line
    if line.y < 150 and (len(t) < 24 or "上册" in t or "下册" in t):
        line.kind = "running_head"
        return line
    if line.y > page_h - 130 and RE_PAGE_NUM.match(t):
        line.kind = "page_num"
        return line
    if RE_JUAN.match(t):
        line.kind = "juan"
        return line
    m = RE_MARKER.match(t)
    if m and (m.group(1) in THEORY_MARKERS | QUESTION_MARKERS or t.startswith(("「", "【"))):
        line.kind = "marker"
        line.extra["marker"] = m.group(1)
        return line
    if RE_ANSWER_KEY.match(t):
        # 上册末尾的答案速览列表：标题行切掉开着的题干，随后的 "1-5 BBABD"
        # 行不满足 RE_QNUM，自然落空。
        line.kind = "marker"
        line.extra["marker"] = "答案速览"
        return line
    if RE_ANSWER.match(t):
        line.kind = "answer"
        line.num = int(RE_ANSWER.match(t).group(1))
        line.extra["answer"] = RE_ANSWER.match(t).group(2)
        return line
    m = RE_QNUM.match(t)
    if m:
        line.kind = "numbered"
        line.num = int(m.group(1))
        line.extra["rest"] = m.group(2)
        return line
    if RE_OPTION.search(t):
        line.kind = "options"
        return line
    line.kind = "text"
    return line


def iter_lines(tags: list[str], start=1, end=10**9):
    for tag in tags:
        for page in load_pages(tag, start, end):
            for ln in build_lines(page):
                yield classify(ln, page["height"])


def main() -> int:
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", default="up")
    ap.add_argument("--start", type=int, default=1)
    ap.add_argument("--end", type=int, default=40)
    ap.add_argument("--only", default="", help="comma separated kinds to show")
    args = ap.parse_args()
    only = set(filter(None, args.only.split(",")))
    for page in load_pages(args.tag, args.start, args.end):
        print(f"\n########## {args.tag} p{page['page']} (h={page['height']})")
        for ln in build_lines(page):
            classify(ln, page["height"])
            if only and ln.kind not in only:
                continue
            print(f"  {ln.kind:14s} y={ln.y:6.0f} x={ln.x:5.0f} s={ln.score:.2f} | {ln.text[:110]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
