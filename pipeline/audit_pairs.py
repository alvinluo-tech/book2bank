"""Pairing audit: prove that every question is married to its own answer.

Checks (per bank):
  1. positional order — pairs must consume the answer stream monotonically
  2. per-chapter question/answer counts and numbering continuity
  3. answer-anchor vs in-analysis verdict (answer-conflict from parse_bank)
  4. printed answer letter present among the question's options
Then renders an eyeball sample: for every flagged pair plus N random pairs, a
composite PNG (question crop from the 题目册 above, answer crop from the 答案册
below) so a human can verify the marriage in seconds.

  python pipeline/audit_pairs.py --bank shuliang --sample 12
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

import cv2
import fitz
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import books  # noqa: E402

ROOT = books.ROOT
OUT = ROOT / "pipeline" / "_audit"
OCR_DPI = 200
PT = 72.0 / OCR_DPI


def load(bank_id: str) -> list[dict]:
    path = books.get_bank(bank_id)["outDir"] / "questions.json"
    return json.loads(path.read_text(encoding="utf-8"))


def doc(tag: str) -> fitz.Document:
    cfg = next(cfg for cfg in books.BANKS.values() if tag in cfg["tag"].values())
    return fitz.open(cfg["pdf"][books.side_of(tag)])


def clip(tag: str, page: int, bbox: list[float] | None) -> np.ndarray | None:
    if not page or not bbox:
        return None
    d = doc(tag)
    if page > len(d):
        return None
    x, y, w, h = bbox
    rect = fitz.Rect(x * PT, y * PT, (x + w) * PT, (y + h) * PT) & d[page - 1].rect
    if rect.is_empty or rect.width < 4 or rect.height < 4:
        return None
    pix = d[page - 1].get_pixmap(dpi=150, clip=rect)
    buf = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.stride)
    img = buf[:, : pix.width * pix.n].reshape(pix.height, pix.width, pix.n)
    if pix.n == 1:  # greyscale scan: widen to 3 channels so cv2 hstack stays legal
        return np.ascontiguousarray(np.repeat(img, 3, axis=2))
    return np.ascontiguousarray(img[:, :, :3][:, :, ::-1])


def composite(top: np.ndarray | None, bottom: np.ndarray | None, qid: str, note: str) -> Path | None:
    if top is None and bottom is None:
        return None
    width = max(top.shape[1] if top is not None else 0, bottom.shape[1] if bottom is not None else 0, 400)
    def pad(img: np.ndarray | None) -> np.ndarray:
        if img is None:
            return np.full((40, width, 3), 255, dtype=np.uint8)
        if img.shape[1] < width:
            img = np.pad(img, ((0, 0), (0, width - img.shape[1]), (0, 0)), constant_values=255)
        return img
    top, bottom = pad(top), pad(bottom)
    sep = np.full((8, width, 3), 120, dtype=np.uint8)
    img = np.vstack([top, sep, bottom])
    out_dir = OUT
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{qid}.png"
    cv2.imwrite(str(path), img, [cv2.IMWRITE_JPEG_QUALITY, 80])
    return path


def audit(bank_id: str, sample: int, seed: int) -> int:
    qs = load(bank_id)
    problems: list[str] = []

    # 1. positional order: answer stream must be consumed in order
    last_page = 0
    for q in qs:
        ref = q.get("answerPageRef")
        if not ref:
            continue
        key = (ref["page"], q["num"])
        if (ref["page"], 0) < (last_page, 0):
            problems.append(f"{q['id']}: answer page went backwards to p{ref['page']}")
        last_page = ref["page"]

    # 2. numbering continuity per chapter+block
    by_ch: dict[int, list[dict]] = {}
    for q in qs:
        by_ch.setdefault(q["chapterIndex"], []).append(q)
    for ch, rows in sorted(by_ch.items()):
        nums = [q["num"] for q in rows]
        restarts = sum(1 for a, b in zip(nums, nums[1:]) if b <= a)
        missing = sum(1 for q in rows if q["answer"] is None)
        print(f"  ch{ch}: {len(rows)} questions, {missing} without answer, {restarts} number-restarts")

    # 3/4. flag-driven issues
    conflicts = [q["id"] for q in qs if "answer-mismatch" in q["flags"]]
    not_in_opts = [q["id"] for q in qs if "answer-not-in-options" in q["flags"]]
    if conflicts:
        problems.append(f"answer-mismatch: {conflicts}")
    if not_in_opts:
        problems.append(f"answer-not-in-options: {not_in_opts[:20]}{'…' if len(not_in_opts) > 20 else ''}")

    flagged = [q for q in qs if q["answer"] is None or q["flags"]]
    rng = random.Random(seed)
    pool = list({q["id"] for q in flagged} | set(rng.sample([q["id"] for q in qs], min(sample, len(qs)))))
    by_id = {q["id"]: q for q in qs}
    made = 0
    for qid in sorted(pool):
        q = by_id[qid]
        up_ref, dn_ref = q.get("pageRef"), q.get("answerPageRef")
        top = clip(up_ref["tag"], up_ref["page"], up_ref.get("bbox")) if up_ref else None
        bottom = clip(dn_ref["tag"], dn_ref["page"], dn_ref.get("bbox")) if dn_ref else None
        note = f"ans={q['answer']} flags={','.join(q['flags'])}"
        if composite(top, bottom, qid, note):
            made += 1
    print(json.dumps({
        "bank": bank_id,
        "questions": len(qs),
        "paired": sum(1 for q in qs if q["answer"]),
        "flagged": len(flagged),
        "sampleRendered": made,
        "outDir": str(OUT),
        "problems": problems,
    }, ensure_ascii=False, indent=1))
    return len(problems)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bank", default="shuliang", choices=list(books.BANKS))
    ap.add_argument("--sample", type=int, default=12)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    return 1 if audit(args.bank, args.sample, args.seed) else 0


if __name__ == "__main__":
    sys.exit(main())
