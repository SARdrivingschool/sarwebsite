#!/usr/bin/env python3
"""
Re-read the reviewer's display name at high resolution.

Whole-screenshot OCR reads a name like "Waqas Saeed" as "Wagas Saeed" — the text
is ~15px tall and tesseract is segmenting a whole page. Publishing a real
customer's name misspelled is not acceptable, so this reads the name separately.

Google renders the display name as a blue link, which is the only blue text at
the top of a review card. Finding it by colour is far more reliable than
tesseract's layout analysis: crop the blue run, drop the trailing
"open in new tab" icon, upscale 3x and read it as a single line (--psm 7).

Usage:
    python3 tools/name_ocr.py <png-dir> > names.json
"""
import json, re, subprocess, sys, tempfile
from pathlib import Path

import numpy as np
from PIL import Image

LINK_BLUE = dict(b_min=120, br_gap=50, bg_gap=30)  # Google link blue vs. page
LINE_H = 44        # a name line is never taller than this
GAP = 6            # column gap that separates glyph runs
ICON_W = (18, 30)  # the "open in new tab" icon is a fixed ~24px square, always last
MAX_GLYPH_H = 32   # taller than this is the avatar circle, not text
JOIN_GAP = 16      # re-join a letter-spaced name that split into runs
WHITELIST = ("ABCDEFGHIJKLMNOPQRSTUVWXYZ"
             "abcdefghijklmnopqrstuvwxyz0123456789 .'-")


def blue_mask(im: Image.Image):
    a = np.asarray(im.convert("RGB")).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    return ((b > LINK_BLUE["b_min"]) & (b - r > LINK_BLUE["br_gap"])
            & (b - g > LINK_BLUE["bg_gap"]))


def clusters(xs, gap=GAP):
    """Contiguous column runs, as (start, end) pairs."""
    if len(xs) == 0:
        return []
    xs = np.unique(xs)
    out, start, prev = [], xs[0], xs[0]
    for x in xs[1:]:
        if x - prev > gap:
            out.append((start, prev))
            start = x
        prev = x
    out.append((start, prev))
    return out


def name_box(im: Image.Image):
    m = blue_mask(im)
    ys, xs = np.nonzero(m)
    if len(ys) == 0:
        return None
    top = ys.min()
    band = (ys >= top) & (ys <= top + LINE_H)
    bx, by = xs[band], ys[band]
    if len(bx) == 0:
        return None
    runs = clusters(bx)
    if not runs:
        return None

    def span(run):
        k = (bx >= run[0]) & (bx <= run[1])
        return int(by[k].min()), int(by[k].max())

    # The avatar is a filled circle: much taller than a line of text.
    runs = [r for r in runs if (lambda s: s[1] - s[0] + 1 <= MAX_GLYPH_H)(span(r))] or runs
    # The trailing "open in new tab" icon is a fixed ~24px square.
    if len(runs) > 1 and ICON_W[0] <= runs[-1][1] - runs[-1][0] + 1 <= ICON_W[1]:
        runs.pop()
    # The name is the widest run; letter-spaced names split, so re-join any
    # run sitting right beside it, but never the detached avatar initial.
    i = max(range(len(runs)), key=lambda k: runs[k][1] - runs[k][0])
    lo = hi = i
    while lo > 0 and runs[lo][0] - runs[lo - 1][1] <= JOIN_GAP:
        lo -= 1
    while hi + 1 < len(runs) and runs[hi + 1][0] - runs[hi][1] <= JOIN_GAP:
        hi += 1
    x0, x1 = runs[lo][0], runs[hi][1]
    keep = (bx >= x0) & (bx <= x1)
    return int(x0), int(by[keep].min()), int(x1), int(by[keep].max())


def read_name(png: Path):
    im = Image.open(png)
    box = name_box(im)
    if not box:
        return None
    l, t, r, b = box
    if r - l < 8 or b - t < 6:
        return None
    crop = im.convert("L").crop((max(0, l - 8), max(0, t - 7),
                                min(im.width, r + 8), min(im.height, b + 7)))
    crop = crop.resize((crop.width * 3, crop.height * 3), Image.LANCZOS)
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tf:
        crop.save(tf.name)
        out = subprocess.run(
            ["tesseract", tf.name, "-", "--psm", "7",
             "-c", "tessedit_char_whitelist=" + WHITELIST],
            capture_output=True, text=True).stdout
    Path(tf.name).unlink(missing_ok=True)
    name = re.sub(r"\s+", " ", out).strip(" .-'")
    name = re.sub(r"\blocal\s*guide\b", "", name, flags=re.I).strip(" .-'")
    return name or None


def main():
    d = Path(sys.argv[1])
    out = {}
    for p in sorted(d.glob("*.png")):
        try:
            out[p.stem] = read_name(p)
        except Exception as e:              # a bad crop must not kill the run
            out[p.stem] = None
            print(f"{p.name}: {e}", file=sys.stderr)
    json.dump(out, sys.stdout, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
