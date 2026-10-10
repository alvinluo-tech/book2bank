"""Bank registry: one entry per question bank (a pair of scanned books).

A bank is a (题目上册, 答案下册) pair plus where its artifacts live:
  * pdf      source scans (WeChat temp dir — the same place the first bank used)
  * tag      OCR cache directory names under data/ocr/<tag>; must be globally
             unique across banks because public/assets/pages uses them too
  * outDir   parsed bank artifacts (questions/meta/issues/report)
  * idPrefix question-id prefix; empty for the first bank so existing learner
             history in data/app.db keeps resolving

Adding a bank = adding an entry here. Nothing else in the pipeline is per-bank.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

_SRC = r"D:\data\wechat\xwechat_files\wxid_6oaud0me7ubp22_098d\temp\RWTemp\2026-10\ea26bb2c398aa4c8c0bdc5578b5e8ab7"

BANKS: dict[str, dict] = {
    "panduan": {
        "title": "判断推理",
        "bookTitle": "决战行测5000题·判断推理（粉笔公考 2025年9月版）",
        "pdf": {
            "up": fr"{_SRC}\9月版判断上.pdf",
            "dn": fr"{_SRC}\9月版判断下.pdf",
        },
        # legacy cache dirs: the first bank ran before banks existed
        "tag": {"up": "up", "dn": "dn"},
        "outDir": DATA / "banks" / "panduan",
        "idPrefix": "",
        "pages": {"up": 392, "dn": 510},
    },
    "shuliang": {
        "title": "数量关系",
        "bookTitle": "决战行测5000题·数量关系（粉笔公考 2025年9月版）",
        "pdf": {
            "up": fr"{_SRC}\9月版数量上(1)(1).pdf",
            "dn": fr"{_SRC}\9月版数量下.pdf",
        },
        "tag": {"up": "sl-up", "dn": "sl-dn"},
        "outDir": DATA / "banks" / "shuliang",
        "idPrefix": "sl-",
        "pages": {"up": 256, "dn": 368},
    },
    "ziliao": {
        "title": "资料分析",
        "bookTitle": "决战行测5000题·资料分析（粉笔公考 2025年9月版）",
        "pdf": {
            "up": fr"{_SRC}\9月版资料上.pdf",
            "dn": fr"{_SRC}\9月版资料下.pdf",
        },
        "tag": {"up": "zl-up", "dn": "zl-dn"},
        "outDir": DATA / "banks" / "ziliao",
        "idPrefix": "zl-",
        "pages": {"up": 312, "dn": 504},
        # One 资料 (table / chart / text) is shared by a group of ~5 items, and the
        # printed numbering restarts inside every group.
        "layout": "material-group",
    },
    "yanyu": {
        "title": "言语理解",
        "bookTitle": "决战行测5000题·言语理解与表达（粉笔公考 2025年9月版）",
        "pdf": {
            "up": r"D:\data\wechat\xwechat_files\wxid_6oaud0me7ubp22_098d\msg\file\2026-10\9月版言语上.pdf",
            "dn": r"D:\data\wechat\xwechat_files\wxid_6oaud0me7ubp22_098d\msg\file\2026-10\9月版言语下.pdf",
        },
        "tag": {"up": "yy-up", "dn": "yy-dn"},
        "outDir": DATA / "banks" / "yanyu",
        "idPrefix": "yy-",
        "pages": {"up": 360, "dn": 412},
    },
}

BANK_ORDER = ["panduan", "shuliang", "ziliao", "yanyu"]


def get_bank(bank_id: str) -> dict:
    if bank_id not in BANKS:
        raise SystemExit(f"unknown bank {bank_id!r}; known: {', '.join(BANKS)}")
    return BANKS[bank_id]


def cache_tag(bank_id: str, side: str) -> str:
    """side is 'up' or 'dn'; returns the OCR cache directory name."""
    return get_bank(bank_id)["tag"][side]


def side_of(cache_tag: str) -> str:
    for cfg in BANKS.values():
        for side, tag in cfg["tag"].items():
            if tag == cache_tag:
                return side
    raise SystemExit(f"unknown cache tag {cache_tag!r}")
