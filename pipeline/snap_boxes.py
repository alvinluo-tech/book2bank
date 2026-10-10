"""Snap each question's stored page boxes onto what is actually printed there.

Two boxes per question, both inherited from the parse and both able to drift:
  * `answerPageRef` (下册) — the highlight for the 原书答案 link; a box on a neighbouring
    entry shows the reader somebody else's 解析 even when the stored answer is correct.

`answerPageRef.bbox` is what the 原书答案 link draws its highlight rectangle from (the app
renders the answer-page scan and overlays the box), so an off-by-one-entry box shows the
reader *someone else's* 解析 even when the stored answer is correct. A visual pass over
every question the machine could not confirm (pipeline/verify_sheets.py) found 18 such
boxes across the four banks: the crop lands on the previous entry's tail, or starts below
the printed `N.【答案】X` line so the letter is cut off.

This pass re-reads the printed anchors on the cited page and moves the box onto the anchor
whose number matches, choosing the one nearest the stored y when a page carries the same
number twice (blocks restart their numbering mid-page), then extends it down to the next
anchor so the whole entry is inside the box.

  python pipeline/snap_answer_boxes.py            # every built bank
  python pipeline/snap_answer_boxes.py --bank ziliao --dry-run
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import books  # noqa: E402
from bank_lines import build_lines, load_pages  # noqa: E402
from verify_bank import answer_page_anchor_list  # noqa: E402

ROOT = books.ROOT
OFF_SET_TOL = 40   # OCR px at 200 dpi (~0.5 line): a box nearer than this already sits on its anchor
DEGENERATE_H = 70  # below this the overlay covers less than one line, so the letter is not shown


def page_bottom(tag: str, page: int) -> int:
    try:
        lines = build_lines(load_pages(tag, page, page)[0])
        return max([ln.y2 for ln in lines], default=1900)
    except Exception:  # a missing page must not stop the pass
        return 1900


def bbox_y(q: dict) -> int:
    return (q.get("answerPageRef") or {}).get("bbox", [0, 0, 0, 0])[1] or 0


def ink_at(tag: str, page: int, y: float, tol: float = 30.0) -> bool:
    """Is there any OCR line at that height of that page? Used to catch a box whose page
    pointer and coordinates disagree (the parser stored the bbox of a neighbouring page)."""
    path = ROOT / "data" / "ocr" / tag / f"p{page:03d}.json"
    if not path.exists() or y is None:
        return False
    key = ("ink", tag, page)
    if key not in _INK:
        _INK[key] = [(ln.y, ln.y2) for ln in build_lines(json.loads(path.read_text(encoding="utf-8")))]
    return any(a - tol <= y <= b + tol for a, b in _INK[key])


_INK: dict[tuple, list] = {}


def fix_item_page(q: dict) -> bool:
    ref = q.get("pageRef") or {}
    bb = ref.get("bbox") or []
    if not ref.get("page") or not bb or ref.get("tag") not in ("up", "sl-up", "yy-up", "zl-up"):
        return False
    if ink_at(ref["tag"], ref["page"], bb[1]):
        return False
    for delta in (-1, 1):
        if ink_at(ref["tag"], ref["page"] + delta, bb[1]):
            ref["page"] += delta
            ref["bookPage"] = None
            q["pageRef"] = ref
            return True
    return False


def snap_item_box(q: dict) -> bool:
    """The 上册 box must contain the item's own figure band.

    A two-column page can make the parser record only the stem line (~80 px) while the
    figures of that item sit below it (400-1500 px), so the 原书 overlay and any crop taken
    from that box show the question without its pictures.
    """
    ref = q.get("pageRef") or {}
    bands = [b for b in (q.get("bands") or [])
             if b.get("page") == ref.get("page") and (b.get("h") or 0) >= 45]
    if not ref.get("page") or not bands:
        return False
    bbox = ref.get("bbox") or [0, 0, 0, 0]
    top, bottom = bbox[1], bbox[1] + (bbox[3] or 0)
    need_top = min(b["y0"] for b in bands)
    need_bottom = max(b["y1"] for b in bands)
    if top <= need_top + 20 and bottom >= need_bottom - 20:
        return False
    ref["bbox"] = [bbox[0] or 60, int(min(top, need_top)), bbox[2] or 1200,
                   int(max(bottom, need_bottom) - min(top, need_top))]
    q["pageRef"] = ref
    return True


def snap_bank(bank_id: str, dry: bool) -> dict:
    cfg = books.get_bank(bank_id)
    qpath = cfg["outDir"] / "questions.json"
    questions = json.loads(qpath.read_text(encoding="utf-8"))
    cache: dict[tuple, list] = {}
    extent: dict[tuple, list] = {}
    moved = aligned = orphan = page_moved = crosspage = items = page_fixed = 0
    detail: list[str] = []

    for q in questions:
        if fix_item_page(q):
            page_fixed += 1
        if snap_item_box(q):
            items += 1
        ap = q.get("answerPageRef") or {}
        if not q.get("answer") or not ap.get("page"):
            continue
        key = (ap.get("tag"), ap.get("page"))
        if key not in cache:
            cands = answer_page_anchor_list(*key)
            cache[key] = cands
            extent[key] = sorted(y for _n, _l, y in cands)
        same = [c for c in cache[key] if c[0] == q.get("num")]
        matching = [c for c in same if c[1] == q.get("answer")]
        if not matching:
            # The number is printed here but with a different letter: the answer entry the
            # parser stored lives on another page, and the highlight would point at
            # somebody else's entry. Look next door for the anchor that really carries
            # this number AND this letter — the visual pass found 18 of these, all of
            # them correct answers sitting behind a wrong page pointer.
            found = None
            for delta in (-3, -2, -1, 1, 2, 3):
                pg = ap["page"] + delta
                if pg < 1:
                    continue
                k2 = (ap.get("tag"), pg)
                if k2 not in cache:
                    c2 = answer_page_anchor_list(*k2)
                    cache[k2] = c2
                    extent[k2] = sorted(y for _n, _l, y in c2)
                hit = [c for c in cache[k2] if c[0] == q.get("num") and c[1] == q.get("answer")]
                if hit:
                    found = (k2, min(hit, key=lambda c: abs(c[2] - bbox_y(q))))
                    break
            if not found:
                crosspage += 1
                detail.append(f"{q['id']}: NO anchor {q.get('num')}={q.get('answer')} within 2 pages")
                continue
            key = found[0]
            ap["page"] = key[1]
            same = [c for c in cache[key] if c[0] == q.get("num") and c[1] == q.get("answer")]
            page_moved += 1
        bbox = ap.get("bbox") or [0, 0, 0, 0]
        stored_y = bbox[1]
        target = min(matching or same, key=lambda c: abs(c[2] - stored_y))
        ys = extent[key]
        nxt = [y for y in ys if y > target[2] + 4]
        top = target[2] - 6
        bottom = nxt[0] - 6 if nxt else page_bottom(key[0], key[1])
        height = max(90, min(bottom - top, 1500))
        # Only touch a box that is displaced onto another entry, or too short to show
        # the answer line at all; a box already sitting on its anchor is left exactly as
        # the parser measured it, because its height came from that entry's own lines.
        displaced = abs(top - stored_y) > OFF_SET_TOL
        too_short = (bbox[3] or 0) < DEGENERATE_H
        if not displaced and not too_short:
            aligned += 1
            continue
        if not displaced:
            height = max(height, 120)
        ap["bbox"] = [bbox[0] or 60, int(top), bbox[2] or 1200, int(height)]
        q["answerPageRef"] = ap
        moved += 1
        detail.append(f"{q['id']}: y {stored_y} -> {int(top)} (h {bbox[3]} -> {int(height)})")

    if (moved or items) and not dry:
        qpath.write_text(json.dumps(questions, ensure_ascii=False), encoding="utf-8")
    return {"bank": bank_id, "moved": moved, "keptAsParsed": aligned,
            "numberNotOnPage": orphan, "pagePointerMoved": page_moved,
            "itemBoxExtended": items, "itemPageFixed": page_fixed,
            "unresolved": crosspage, "movedSample": detail[:8]}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bank", action="append", choices=list(books.BANKS))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    targets = args.bank or [b for b in books.BANK_ORDER
                            if (books.get_bank(b)["outDir"] / "questions.json").exists()]
    for b in targets:
        print(json.dumps(snap_bank(b, args.dry_run), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
