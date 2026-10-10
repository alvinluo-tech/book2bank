"""OCR queue driver: finish every bank's OCR, one side at a time.

Order: panduan up/dn first (a previous session's worker pool may still be
writing those caches — wait for it to finish or stall, then fill the gaps),
then the shuliang books. Existing pages are always skipped, so overlapping
with the legacy pool wastes at most a few duplicated pages.

  python pipeline/ocr_queue.py            # runs until all four caches complete
"""
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import books  # noqa: E402

ROOT = books.ROOT
OUT = ROOT / "data" / "ocr"
PY = sys.executable
LOG = ROOT / "data" / "ocr_queue.log"


def log(msg: str) -> None:
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with open(LOG, "a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def count(tag: str) -> int:
    d = OUT / tag
    return len(list(d.glob("p*.json"))) if d.exists() else 0


def total_pages(bank: str, side: str) -> int:
    import fitz

    doc = fitz.open(books.get_bank(bank)["pdf"][side])
    n = len(doc)
    doc.close()
    return n


def wait_quiet(tag: str, expect: int, window: int = 180) -> None:
    """Block until the cache is complete or untouched for `window` seconds."""
    if count(tag) == 0:
        return
    last, since = count(tag), time.time()
    while last < expect:
        time.sleep(15)
        c = count(tag)
        if c != last:
            last, since = c, time.time()
            log(f"  {tag}: external progress {c}/{expect}")
        elif time.time() - since >= window:
            return


def run(bank: str, side: str) -> None:
    cmd = [PY, str(ROOT / "pipeline" / "ocr_pages.py"), "--bank", bank, "--side", side,
           "--workers", "8", "--log", str(LOG)]
    log("+ " + " ".join(cmd))
    subprocess.run(cmd, check=True, cwd=str(ROOT))


def main() -> int:
    for bank, side in [("panduan", "up"), ("panduan", "dn"), ("shuliang", "up"), ("shuliang", "dn")]:
        tag = books.cache_tag(bank, side)
        tot = total_pages(bank, side)
        if count(tag) >= tot:
            log(f"{tag}: already complete ({tot}/{tot})")
            continue
        log(f"{tag}: {count(tag)}/{tot} queued")
        wait_quiet(tag, tot)
        for attempt in (1, 2):
            run(bank, side)
            if count(tag) >= tot:
                break
            log(f"{tag}: still {count(tag)}/{tot} after attempt {attempt}, retrying")
        log(f"{tag}: done ({count(tag)}/{tot})")
    log("all caches complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
