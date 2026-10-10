"""Cut the figures out of the scans — no manual screenshots anywhere.

parse_bank.py records, per question, the vertical bands of that question's span
that contain no recognised text. This script renders exactly those bands straight
from the PDF at 300 dpi (PyMuPDF clip rendering, so quality is that of the original
6144px scan, not a re-photographed screen) and trims the result to the ink
bounding box with an OpenCV projection. Bands that turn out to be blank are
dropped, which is what makes `kind` / `hasImage` pixel-verified rather than
guessed from layout.

Question ids are unique across banks (shuliang carries the `sl-` prefix), so all
banks share one set of asset folders.

  data/banks/<bank>/questions.json  ->  public/assets/figures/<id>.png
                                        public/assets/crops/<id>.png   (whole item, 原书对照)
                                        public/assets/pages/<tag>-<n>.jpg
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

import cv2
import fitz
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import books

ROOT = books.ROOT
PUB = ROOT / "public" / "assets"
OCR_DPI = 200
FIG_DPI = 300
SCALE = FIG_DPI / OCR_DPI
PT = 72.0 / OCR_DPI  # ocr pixel -> pdf point

# Whole-item crops are photographs of a printed page, so JPEG at q85 is visually
# equivalent to PNG while costing ~1/5 the disk; 图形题 crops stay lossless PNG.
CROP_EXT = "png"
CROP_PARAMS: list[int] = [cv2.IMWRITE_PNG_COMPRESSION, 3]


def set_crop_format(fmt: str, quality: int) -> None:
    global CROP_EXT, CROP_PARAMS
    if fmt == "jpeg":
        # OpenCV 5 rejects IMWRITE_JPEG_QUALITY through imwrite/imencode (it warns and
        # falls back to its own default), so pass nothing rather than a ignored key.
        CROP_EXT, CROP_PARAMS = "jpg", []

_docs: dict[str, fitz.Document] = {}
_page_w: dict[str, float] = {}
_no_pdf: set[str] = set()


def bank_questions(bank_id: str) -> list[dict]:
    path = books.get_bank(bank_id)["outDir"] / "questions.json"
    return json.loads(path.read_text(encoding="utf-8"))


def save_bank_questions(bank_id: str, questions: list[dict]) -> None:
    path = books.get_bank(bank_id)["outDir"] / "questions.json"
    path.write_text(json.dumps(questions, ensure_ascii=False), encoding="utf-8")


def doc(tag: str) -> fitz.Document:
    if tag not in _docs:
        for cfg in books.BANKS.values():
            for side, t in cfg["tag"].items():
                if t == tag:
                    _docs[tag] = fitz.open(cfg["pdf"][side])
                    break
    return _docs[tag]


def page_width(tag: str) -> float:
    """OCR-space page width, straight from the first cached page (200 dpi)."""
    if tag not in _page_w:
        cached = ROOT / "data" / "ocr" / tag / "p001.json"
        _page_w[tag] = json.loads(cached.read_text(encoding="utf-8"))["width"]
    return _page_w[tag]


def render_clip(tag: str, page: int, x0: float, y0: float, x1: float, y1: float):
    if tag in _no_pdf:
        return None
    try:
        d = doc(tag)
    except Exception as exc:  # 源 PDF 已被清理：沿用磁盘上已有的裁图，不再重绘
        _no_pdf.add(tag)
        print(f"! {tag}: source pdf unavailable, reusing assets on disk ({exc})", file=sys.stderr)
        return None
    pg = d[page - 1]
    rect = fitz.Rect(x0 * PT, y0 * PT, x1 * PT, y1 * PT) & pg.rect
    if rect.is_empty or rect.width < 4 or rect.height < 4:
        return None
    pix = pg.get_pixmap(dpi=FIG_DPI, clip=rect)
    arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.stride)[:, : pix.width * pix.n]
    arr = arr.reshape(pix.height, pix.width, pix.n)[:, :, :3]
    return np.ascontiguousarray(arr[:, :, ::-1])


def trim(img: np.ndarray, min_ink: float = 0.0025):
    """Tight ink bounding box; None when the region is effectively blank."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    bw = (gray < 190).astype(np.uint8)
    ratio = float(bw.mean())
    if ratio < min_ink:
        return None, ratio
    rows = bw.sum(axis=1)
    cols = bw.sum(axis=0)
    nz_r = np.flatnonzero(rows > 2)
    nz_c = np.flatnonzero(cols > 2)
    if len(nz_r) < 6 or len(nz_c) < 6:
        return None, ratio
    pad = 6
    y0 = max(0, nz_r[0] - pad)
    y1 = min(gray.shape[0], nz_r[-1] + pad)
    x0 = max(0, nz_c[0] - pad)
    x1 = min(gray.shape[1], nz_c[-1] + pad)
    return img[y0:y1, x0:x1], ratio


def merge_bands(bands: list[dict], gap: float = 90) -> list[dict]:
    """Merge bands that are close together so 题干图 and 选项图 stay one picture."""
    by_page: dict[int, list[dict]] = {}
    for b in bands:
        by_page.setdefault(b["page"], []).append(b)
    out = []
    for pg, bs in by_page.items():
        bs = sorted(bs, key=lambda b: b["y0"])
        cur = dict(bs[0])
        for b in bs[1:]:
            if b["y0"] - cur["y1"] <= gap:
                cur["y1"] = max(cur["y1"], b["y1"])
                cur["h"] = cur["y1"] - cur["y0"]
            else:
                out.append(cur)
                cur = dict(b)
        out.append(cur)
    return sorted(out, key=lambda b: -b["h"])


def x_bounds(tag: str) -> tuple[float, float]:
    w = page_width(tag)
    # The answer book carries a QR code in the right margin; keep it out of crops.
    right = w - 300 if books.side_of(tag) == "dn" else w - 150
    return 150, right


def prune_stale_assets(bank_id: str, questions: list[dict]) -> int:
    """Delete images no live question points at.

    Re-parsing renumbers ids, so a leftover `figures/<id>.png` can be some other
    question's figure — worse than a missing one. Pointers may name an older id (parse
    re-attaches crops by item content), so keep exactly the files the bank references.
    """
    prefix = re.escape(books.get_bank(bank_id)["idPrefix"])
    own_name = re.compile(rf"{prefix}c\d+-\d+\.png")
    kept = {
        "figures": {os.path.basename(q["figureImage"]) for q in questions if q.get("figureImage")},
        "crops": {os.path.basename(q["cropImage"]) for q in questions if q.get("cropImage")},
    }
    removed = 0
    for sub, alive in kept.items():
        d = PUB / sub
        if not d.exists():
            continue
        for f in d.iterdir():
            if own_name.fullmatch(f.name) and f.name not in alive:
                f.unlink()
                removed += 1
    return removed


def crop_questions(questions: list[dict], only_missing: bool) -> int:
    (PUB / "figures").mkdir(parents=True, exist_ok=True)
    (PUB / "crops").mkdir(parents=True, exist_ok=True)
    made = 0
    for q in questions:
        name = f"{q['id']}.png"
        if only_missing and q.get("figureImage"):
            continue
        ref = q.get("pageRef") or {}
        tag, page = ref.get("tag", "up"), ref.get("page")
        if not page:
            continue
        x0, x1 = x_bounds(tag)
        bands = merge_bands(q.get("bands") or [])
        bands = [b for b in bands if b.get("h", 0) >= 45]
        best = None
        for b in bands:
            img = render_clip(tag, b["page"], x0, b["y0"], x1, b["y1"])
            if img is None:
                continue
            trimmed, ratio = trim(img)
            if trimmed is None:
                continue
            path = PUB / "figures" / name
            cv2.imwrite(str(path), trimmed, [cv2.IMWRITE_PNG_COMPRESSION, 3])
            h, w = trimmed.shape[:2]
            if best is None or h * w > best[0]:
                best = (h * w, f"/assets/figures/{name}", w, h)
            made += 1
            break  # one combined figure per question
        segs = q.get("segments") or []
        if segs:
            pg, y0, y1 = segs[0]
            img = render_clip(tag, pg, x0, y0, x1, y1 + 8)
            if img is not None:
                trimmed, _ = trim(img, min_ink=0.0)
                if trimmed is not None:
                    cv2.imwrite(str(PUB / "crops" / name), trimmed, CROP_PARAMS)
                    q["cropImage"] = f"/assets/crops/{name}"
        if best:
            q["figureImage"] = best[1]
            q["figureW"], q["figureH"] = best[2], best[3]
            q["kind"] = "figure"
        elif not q.get("figureImage") and tag not in _no_pdf:
            # 这一遍真的看过原页且裁不出图，就不该再挂图题标签。
            q["kind"] = "text"
    for q in questions:
        # hasImage = 真的有一张题图裁图；整题原书裁图每题都有，不能算图题。
        q["hasImage"] = bool(q.get("figureImage"))
    return made


def crop_materials(bank_id: str) -> int:
    """资料分析: cut each 资料 (table / chart / text block) out as one image.

    The material is shared by a group of items, so it is cropped once and referenced
    by every question in the group — the app keeps it on screen while those items are
    answered instead of repeating it.
    """
    path = books.get_bank(bank_id)["outDir"] / "materials.json"
    if not path.exists():
        return 0
    materials = json.loads(path.read_text(encoding="utf-8"))
    out = PUB / "materials"
    out.mkdir(parents=True, exist_ok=True)
    made = 0
    for m in materials:
        segs = m.get("segments") or []
        best = None
        for (pg, y0, y1) in sorted(segs, key=lambda s: -(s[2] - s[1])):
            tag = m.get("pageRef", {}).get("tag", "up")
            x0, x1 = x_bounds(tag)
            img = render_clip(tag, pg, x0, y0, x1, y1)
            if img is None:
                continue
            trimmed, ratio = trim(img, min_ink=0.0008)
            if trimmed is None:
                continue
            h, w = trimmed.shape[:2]
            if best is None or h * w > best[0]:
                best = (h * w, trimmed, w, h, pg)
        if not best:
            m["image"] = None
            continue
        _area, img, w, h, pg = best
        name = f"{m['id']}.{CROP_EXT}"
        (out / name).write_bytes(cv2.imencode(f".{CROP_EXT}", img, CROP_PARAMS)[1].tobytes())
        m["image"] = f"/assets/materials/{name}"
        m["imageW"], m["imageH"] = w, h
        m["imagePages"] = sorted({s[0] for s in segs})
        made += 1
    path.write_text(json.dumps(materials, ensure_ascii=False), encoding="utf-8")
    return made


def _export_one(spec: tuple[str, int]) -> int:
    tag, page = spec
    out = PUB / "pages"
    path = out / f"{tag}-{page:03d}.jpg"
    if path.exists():
        return 0
    d = doc(tag)
    if page > len(d):
        return 0
    pix = d[page - 1].get_pixmap(dpi=115)
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(pix.tobytes(output="jpg", jpg_quality=72))
    os.replace(tmp, path)
    return 1


def export_pages(tags_pages: list[tuple[str, int]], workers: int = 6) -> int:
    from multiprocessing import Pool

    (PUB / "pages").mkdir(parents=True, exist_ok=True)
    specs = sorted(set(tags_pages))
    with Pool(workers) as pool:
        return sum(pool.map(_export_one, specs, chunksize=4))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bank", default="panduan", choices=list(books.BANKS))
    ap.add_argument("--pages", action="store_true", help="also export full page JPEGs")
    ap.add_argument("--all", action="store_true", help="re-crop even when a figure already exists")
    ap.add_argument("--crop-format", choices=["png", "jpeg"], default="png",
                    help="整题裁图与资料裁图的编码；jpeg 省约 5 倍磁盘")
    ap.add_argument("--jpeg-quality", type=int, default=85)
    args = ap.parse_args()

    set_crop_format(args.crop_format, args.jpeg_quality)
    questions = bank_questions(args.bank)
    made = crop_questions(questions, only_missing=not args.all)
    if _no_pdf:
        print(f"! {_no_pdf} 的源 PDF 读不到：本次未重绘，保留磁盘上已有的裁图，不做清理")
    else:
        dropped = prune_stale_assets(args.bank, questions)
        if dropped:
            print(f"stale images removed: {dropped}")
    save_bank_questions(args.bank, questions)
    mats = crop_materials(args.bank)
    with_fig = sum(1 for q in questions if q.get("figureImage"))
    print(f"[{args.bank}] crops written: {made}, questions with figure: {with_fig}/{len(questions)}"
          + (f", materials cropped: {mats}" if mats else ""))
    if args.pages:
        refs = [(q["pageRef"]["tag"], q["pageRef"]["page"]) for q in questions if q.get("pageRef")]
        refs += [(q["answerPageRef"]["tag"], q["answerPageRef"]["page"]) for q in questions if q.get("answerPageRef")]
        mpath = books.get_bank(args.bank)["outDir"] / "materials.json"
        if mpath.exists():
            for m in json.loads(mpath.read_text(encoding="utf-8")):
                for (pg, _y0, _y1) in m.get("segments") or []:
                    refs.append((m.get("pageRef", {}).get("tag", "up"), pg))
        n = export_pages(refs)
        print(f"page images written: {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
