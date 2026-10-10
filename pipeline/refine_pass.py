"""Targeted second OCR pass over pages where the numbering skipped a question.

The detector occasionally loses a whole line — typically the line carrying the
next question's anchor, which silently merges two questions. Rather than re-OCR
all pages at high cost, this pass re-reads only the flagged pages at 300 dpi
with a more sensitive detector, merges genuinely new lines back into the page
cache (converted to the 200 dpi coordinate space), and leaves everything else alone.

  python pipeline/refine_pass.py --bank shuliang --dry-run   # show affected pages
  python pipeline/refine_pass.py --bank shuliang             # fix them
  python pipeline/parse_bank.py --bank shuliang              # rebuild afterwards
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from multiprocessing import Pool
from pathlib import Path

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "2")

import fitz  # noqa: E402
import numpy as np  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
import books  # noqa: E402
from bank_lines import OCR_DIR, build_lines, classify  # noqa: E402
import parse_bank as PB  # noqa: E402

BASE_DPI, REFINE_DPI = 200, 300
SCALE = BASE_DPI / REFINE_DPI
_engine = None


def engine():
    global _engine
    if _engine is None:
        from rapidocr_onnxruntime import RapidOCR

        _engine = RapidOCR(**{
            "Det": {"limit_side_len": 4000, "limit_type": "max", "box_thresh": 0.30,
                    "unclip_ratio": 2.0, "thresh": 0.25},
            "Rec": {"batch_num": 8},
            "Global": {"use_angle_cls": False},
        })
    return _engine


def flagged_pages() -> dict[str, list[int]]:
    """Pages whose parse produced a numbering gap: the likely site of a lost line."""
    answers, _ = PB.parse_answer_stream(10**9)
    _items, qnotes = PB.parse_question_stream(10**9)
    tags = PB.CFG["tag"]
    out: dict[str, set[int]] = {tags["up"]: set(), tags["dn"]: set()}
    for n in qnotes:
        if n.get("type") == "gap-in-question-numbers":
            out[tags["up"]].add(n["page"])
            out[tags["up"]].add(n["page"] - 1)  # the anchor often sits at the page foot
    by_ch: dict[int, list[tuple[int, int]]] = {}
    for a in answers:
        by_ch.setdefault(a["chapter"], []).append((a["page"], a["num"]))
    for _ch, rows in by_ch.items():
        rows.sort()
        for (pg, n), (_pg2, n2) in zip(rows, rows[1:]):
            if n2 > n + 1 and n2 - n <= 3:
                out[tags["dn"]].add(pg)
                out[tags["dn"]].add(pg + 1)
    return {k: sorted(v) for k, v in out.items()}


def refine(job: tuple[str, int]) -> str:
    tag, page = job
    path = OCR_DIR / tag / f"p{page:03d}.json"
    if not path.exists():
        return "missing"
    cached = json.loads(path.read_text(encoding="utf-8"))
    if cached.get("refined"):
        return "skip"
    t0 = time.time()
    doc = fitz.open(_pdf_of(tag))
    pix = doc[page - 1].get_pixmap(dpi=REFINE_DPI)
    doc.close()
    arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.stride)
    arr = arr[:, : pix.width * pix.n].reshape(pix.height, pix.width, pix.n)[:, :, :3]
    img = np.ascontiguousarray(arr[:, :, ::-1])
    res, _ = engine()(img)

    existing = [(b["box"][0] + b["box"][2] / 2, b["box"][1] + b["box"][3] / 2) for b in cached["blocks"]]
    added = 0
    for box, text, score in (res or []):
        xs = [float(p[0]) for p in box]
        ys = [float(p[1]) for p in box]
        x0, y0, x1, y1 = (min(xs) * SCALE, min(ys) * SCALE, max(xs) * SCALE, max(ys) * SCALE)
        yc = (y0 + y1) / 2
        # A line is new only if the first pass found nothing at that height.
        if any(abs(yc - ey) < max(12.0, (y1 - y0) * 0.5) and abs(xc - (x0 + x1) / 2) < 320
               for xc, ey in existing):
            continue
        cached["blocks"].append({"text": str(text), "score": round(float(score), 4),
                                 "box": [round(x0, 1), round(y0, 1), round(x1 - x0, 1), round(y1 - y0, 1)]})
        existing.append(((x0 + x1) / 2, yc))
        added += 1
    cached["refined"] = True
    cached["refined_added"] = added
    cached["refined_secs"] = round(time.time() - t0, 1)
    cached["blocks"].sort(key=lambda b: b["box"][1])
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(cached, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)
    return f"+{added}"


def _pdf_of(tag: str) -> str:
    for cfg in books.BANKS.values():
        if tag in cfg["tag"].values():
            return cfg["pdf"][books.side_of(tag)]
    raise SystemExit(f"no PDF for tag {tag!r}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bank", default="panduan", choices=list(books.BANKS))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()
    PB.use_bank(args.bank)
    plan = flagged_pages()
    total = sum(len(v) for v in plan.values())
    print({k: len(v) for k, v in plan.items()}, "pages to refine")
    if args.dry_run or not total:
        return 0
    jobs = [(tag, p) for tag, pages in plan.items() for p in pages]
    with Pool(args.workers) as pool:
        results = pool.map(refine, jobs, chunksize=1)
    added = sum(int(r[1:]) for r in results if r.startswith("+"))
    print(f"refined {sum(1 for r in results if r.startswith('+'))} pages, recovered {added} lines")
    return 0


if __name__ == "__main__":
    sys.exit(main())
