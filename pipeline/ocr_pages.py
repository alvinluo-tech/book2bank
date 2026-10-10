"""OCR the scanned question/answer books into per-page JSON caches.

Output: data/ocr/<tag>/p<NNN>.json  ->  {page, dpi, width, height, blocks:[{text, score, box}]}
Resumable: existing JSON files are skipped, so the run can be restarted safely.
Tags come from books.py: every bank owns two cache dirs (its 题目/答案 scans).
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

for _var in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_var, "2")

import fitz
import numpy as np
from multiprocessing import Pool

import books

ROOT = books.ROOT
OUT = ROOT / "data" / "ocr"
DPI = 200

_engine = None


def get_engine():
    global _engine
    if _engine is None:
        from rapidocr_onnxruntime import RapidOCR

        _engine = RapidOCR(
            **{
                "Det": {"limit_side_len": 2600, "limit_type": "max", "box_thresh": 0.45,
                        "unclip_ratio": 1.8},
                "Rec": {"batch_num": 8},
                "Global": {"use_angle_cls": False},
            }
        )
    return _engine


def render(doc, page_index, dpi=DPI):
    pix = doc[page_index].get_pixmap(dpi=dpi)
    buf = np.frombuffer(pix.samples, dtype=np.uint8)
    arr = buf.reshape(pix.height, pix.stride)[:, : pix.width * pix.n]
    arr = arr.reshape(pix.height, pix.width, pix.n)[:, :, :3]
    return np.ascontiguousarray(arr[:, :, ::-1]), pix.width, pix.height


def ocr_page(job):
    bank_id, side, page_index = job
    cfg = books.get_bank(bank_id)
    out_dir = OUT / books.cache_tag(bank_id, side)
    out = out_dir / f"p{page_index + 1:03d}.json"
    if out.exists():
        return "skip"
    out_dir.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    doc = fitz.open(cfg["pdf"][side])
    img, w, h = render(doc, page_index)
    doc.close()
    res, _ = get_engine()(img)
    blocks = []
    for box, text, score in (res or []):
        xs = [float(p[0]) for p in box]
        ys = [float(p[1]) for p in box]
        blocks.append({
            "text": str(text),
            "score": round(float(score), 4),
            "box": [round(min(xs), 1), round(min(ys), 1),
                    round(max(xs) - min(xs), 1), round(max(ys) - min(ys), 1)],
        })
    payload = {"page": page_index + 1, "tag": out_dir.name, "dpi": DPI, "width": w, "height": h,
               "blocks": blocks, "secs": round(time.time() - t0, 2)}
    tmp = out.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, out)
    return "ok"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bank", default="panduan", choices=list(books.BANKS))
    ap.add_argument("--side", required=True, choices=["up", "dn"])
    ap.add_argument("--start", type=int, default=1)
    ap.add_argument("--end", type=int, default=10**6)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--log", default="")
    args = ap.parse_args()
    doc = fitz.open(books.get_bank(args.bank)["pdf"][args.side])
    total = len(doc)
    doc.close()
    end = min(args.end, total)
    jobs = [(args.bank, args.side, i) for i in range(args.start - 1, end)]
    t0 = time.time()
    done = 0
    label = books.cache_tag(args.bank, args.side)
    with Pool(args.workers) as pool:
        for r in pool.imap_unordered(ocr_page, jobs, chunksize=1):
            done += 1
            if done % 20 == 0 or done == len(jobs):
                rate = done / max(time.time() - t0, 1e-6)
                msg = f"[{label}] {done}/{len(jobs)} {rate:.2f} pg/s eta={(len(jobs)-done)/max(rate,1e-6)/60:.1f}m"
                print(msg, flush=True)
                if args.log:
                    with open(args.log, "a", encoding="utf-8") as fh:
                        fh.write(msg + "\n")


if __name__ == "__main__":
    sys.exit(main())
