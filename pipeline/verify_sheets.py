"""Render labelled contact sheets so a human (or a vision pass) can check the marriage
of every question the text evidence cannot settle.

Two populations need this:
  * `suspect`  — something contradicts (answer letter not among the options, the 解析's
    own conclusion disagrees, the 解析 ignores what the stem is about, …)
  * `untestable` — 图形推理 items whose stem is one boilerplate sentence, so no amount of
    text can prove the answer belongs to them

Each sheet holds 10 questions: the 上册 item image on top, the 下册 answer image below,
labelled with the question id, the stored answer and the reason it is here.

  python pipeline/verify_sheets.py                 # every bank
  python pipeline/verify_sheets.py --bank panduan --per 10
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import fitz
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import books  # noqa: E402

ROOT = books.ROOT
OUT = ROOT / "pipeline" / "_audit" / "sheets"
OCR_DPI = 200
PT = 72.0 / OCR_DPI
LABEL_H = 34
GAP = 14


def clip_png(doc: fitz.Document, page: int, bbox, width: int):
    if not page or not bbox:
        return None
    x, y, w, h = bbox
    rect = fitz.Rect(x * PT, y * PT, (x + w) * PT, (y + h) * PT) & doc[page - 1].rect
    if rect.is_empty or rect.width < 4 or rect.height < 4:
        return None
    pix = doc[page - 1].get_pixmap(dpi=200, clip=rect)
    buf = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.stride)
    img = buf[:, : pix.width * pix.n].reshape(pix.height, pix.width, pix.n)[:, :, :3]
    img = np.ascontiguousarray(img[:, :, ::-1])
    scale = width / img.shape[1]
    return cv2.resize(img, (width, max(1, int(img.shape[0] * scale))))


def page_png(doc: fitz.Document, page, width: int):
    """Whole page: used when the item has no recorded bbox, so the reader has to find
    the printed number in context instead of being shown a crop of it."""
    if not page or page > doc.page_count:
        return None
    pix = doc[int(page) - 1].get_pixmap(dpi=150)
    buf = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.stride)
    img = buf[:, : pix.width * pix.n].reshape(pix.height, pix.width, pix.n)[:, :, :3]
    img = np.ascontiguousarray(img[:, :, ::-1])
    return cv2.resize(img, (width, max(1, int(img.shape[0] * width / img.shape[1]))))


def label(text: str, width: int) -> np.ndarray:
    band = np.full((LABEL_H, width, 3), 245, dtype=np.uint8)
    cv2.putText(band, text[:110], (8, 23), cv2.FONT_HERSHEY_SIMPLEX, 0.62, (20, 20, 20), 2)
    return band


def build(bank_id: str, per: int, limit: int, tier: str = "eyes") -> list[Path]:
    cfg = books.get_bank(bank_id)
    out_dir = cfg["outDir"]
    vpath = out_dir / "verification.json"
    if not vpath.exists():
        print(f"[{bank_id}] run verify_bank.py first")
        return []
    data = json.loads(vpath.read_text(encoding="utf-8"))
    questions = {q["id"]: q for q in json.loads((out_dir / "questions.json").read_text(encoding="utf-8"))}
    # tier "eyes": the printed anchor does NOT settle these, so only the page image can.
    # tier "suspect": anchor is fine but some text assertion contradicts — worth a look
    # after the first tier is cleared.
    if tier == "eyes":
        sel = [r for r in data["rows"] if r.get("answer") and not r.get("structural")]
    elif tier == "suspect":
        sel = [r for r in data["rows"] if r.get("answer") and not r["ok"] and r.get("structural")]
    else:
        sel = [r for r in data["rows"] if r.get("answer") and (not r.get("structural") or not r["ok"])]
    rows = [r for r in sel if questions.get(r["id"], {}).get("answer")]
    print(f"[{bank_id}] {len(rows)} questions need a visual check")
    rows = rows[:limit]

    up = fitz.open(cfg["pdf"]["up"])
    dn = fitz.open(cfg["pdf"]["dn"])
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob(f"{bank_id}-*.jpg"):
        old.unlink()
    for old in OUT.glob(f"{bank_id}-*.json"):
        old.unlink()

    width = 1500
    sheets: list[Path] = []
    for start in range(0, len(rows), per):
        chunk = rows[start:start + per]
        panels = []
        for r in chunk:
            q = questions[r["id"]]
            ref, aref = q.get("pageRef") or {}, q.get("answerPageRef") or {}
            top = clip_png(up, ref.get("page"), ref.get("bbox"), width)
            if top is None:
                top = page_png(up, ref.get("page"), width)
            bottom = clip_png(dn, aref.get("page"), aref.get("bbox"), width)
            if bottom is None:
                bottom = page_png(dn, aref.get("page"), width)
            miss = [m for m in ("anchor-printed-on-page", "unique-anchor-in-chapter",
                                "answer-in-options") if m not in (r.get("proof") or [])]
            tag = (f"{r['id']}  ans={q.get('answer')}  num={r['num']}  "
                   f"unproven={'>'.join(m.replace('-','_') for m in miss)[:70]}  "
                   f"{';'.join(r['reasons'])[:60]}")
            parts = [label(tag, width), top, bottom]
            parts = [p for p in parts if p is not None]
            h = sum(p.shape[0] for p in parts) + GAP * (len(parts) - 1)
            canvas = np.full((h, width, 3), 255, dtype=np.uint8)
            y = 0
            for i, p in enumerate(parts):
                canvas[y:y + p.shape[0]] = p
                y += p.shape[0] + GAP
            panels.append(canvas)
        total_h = sum(p.shape[0] for p in panels) + GAP * (len(panels) - 1)
        sheet = np.full((total_h, width, 3), 235, dtype=np.uint8)
        y = 0
        for p in panels:
            sheet[y:y + p.shape[0]] = p
            y += p.shape[0] + GAP
        n = start // per + 1
        # jpg, not png: 540MB of free space on this drive and scanned pages at 1500px
        # compress to ~400KB as jpg while staying legible for a vision pass
        path = OUT / f"{bank_id}-{n:02d}.jpg"
        cv2.imwrite(str(path), sheet, [int(cv2.IMWRITE_JPEG_QUALITY), 88])
        (OUT / f"{bank_id}-{n:02d}.json").write_text(
            json.dumps([{"id": r["id"], "answer": questions[r["id"]].get("answer"),
                         "num": r["num"], "reasons": r["reasons"],
                         "unproven": [m for m in ("anchor-printed-on-page",
                                                  "unique-anchor-in-chapter",
                                                  "answer-in-options")
                                      if m not in (r.get("proof") or [])]} for r in chunk],
                       ensure_ascii=False), encoding="utf-8")
        sheets.append(path)
    up.close()
    dn.close()
    print(f"[{bank_id}] wrote {len(sheets)} sheets to {OUT}")
    return sheets


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bank", action="append", choices=list(books.BANKS))
    ap.add_argument("--per", type=int, default=10)
    ap.add_argument("--limit", type=int, default=10**6)
    ap.add_argument("--tier", default="eyes", choices=["eyes", "suspect", "all"])
    args = ap.parse_args()
    targets = args.bank or books.BANK_ORDER
    for b in targets:
        if (books.get_bank(b)["outDir"] / "questions.json").exists():
            build(b, args.per, args.limit, args.tier)
    return 0


if __name__ == "__main__":
    sys.exit(main())
