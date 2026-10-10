"""One command to (re)build question banks from the scanned PDFs.

  python pipeline/build.py                    # every bank, skipping finished work
  python pipeline/build.py --bank shuliang    # one bank
  python pipeline/build.py --only crop --bank panduan
  python pipeline/build.py --force            # re-run every stage

Stages are resumable: OCR writes one JSON per page and skips pages it already did,
so an interrupted run continues where it stopped.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import books

ROOT = books.ROOT
HERE = ROOT / "pipeline"


def run(cmd: list[str]) -> None:
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True, cwd=str(ROOT))


def ocr_done(tag: str) -> int:
    d = ROOT / "data" / "ocr" / tag
    return len(list(d.glob("p*.json"))) if d.exists() else 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bank", action="append", choices=list(books.BANKS),
                    help="repeatable; default is every bank")
    ap.add_argument("--only", choices=["ocr", "parse", "crop"])
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--pages", action="store_true", help="crop: also export full page JPEGs")
    args = ap.parse_args()
    bank_ids = args.bank or books.BANK_ORDER

    for bank_id in bank_ids:
        cfg = books.get_bank(bank_id)
        print(f"== bank {bank_id} ({cfg['title']}) ==", flush=True)
        if args.only in (None, "ocr"):
            for side, total in cfg["pages"].items():
                tag = cfg["tag"][side]
                if not args.force and ocr_done(tag) >= total:
                    print(f"ocr {tag}: already complete ({ocr_done(tag)}/{total})")
                    continue
                run([sys.executable, str(HERE / "ocr_pages.py"), "--bank", bank_id,
                     "--side", side, "--workers", str(args.workers),
                     "--log", str(ROOT / "data" / f"ocr_{tag}.log")])
        if args.only in (None, "parse"):
            run([sys.executable, str(HERE / "parse_bank.py"), "--bank", bank_id])
            # 先把页框吸附到印刷锚点上：下面的裁图按这些坐标切，"原书答案"高亮也按它们画
            run([sys.executable, str(HERE / "snap_boxes.py"), "--bank", bank_id])
        if args.only in (None, "crop"):
            cmd = [sys.executable, str(HERE / "crop_images.py"), "--bank", bank_id]
            if args.pages or args.only == "crop":
                cmd.append("--pages")
            run(cmd + (["--all"] if args.force else []))
        if args.only in (None, "crop"):
            # 校验是报告不是闸门：只要还有题被标记它就退出非 0，那不该让构建失败
            subprocess.run([sys.executable, str(HERE / "verify_bank.py"), "--bank", bank_id],
                           check=False, cwd=str(ROOT))
        print(f"bank ready: {cfg['outDir'] / 'questions.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
