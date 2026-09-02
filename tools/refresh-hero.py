#!/usr/bin/env python3
"""Rebuild the homepage pass strip from the newest photos in the gallery.

Reads the displayOrder array in gallery.html (newest pass first) and rebuilds
images/hero-passes.webp (5x2, desktop) and images/hero-passes-mobile.webp
(4x1, mobile) from the top of that list.

Run from the repo root:   python3 tools/refresh-hero.py
"""
import os
import re
import pathlib
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
GALLERY = ROOT / "images" / "pass-gallery"

DESKTOP = dict(path="images/hero-passes.webp", w=1672, h=941, cols=5, rows=2, q=80)
MOBILE = dict(path="images/hero-passes-mobile.webp", w=1170, h=528, cols=4, rows=1, q=82)


def display_order():
    text = (ROOT / "gallery.html").read_text()
    match = re.search(r"const displayOrder = \[(.*?)\];", text, re.S)
    if not match:
        raise SystemExit("could not find displayOrder in gallery.html")
    return [int(n) for n in re.findall(r"\d+", match.group(1))]


def cover(img, tw, th):
    """Scale to fill the tile, then centre-crop the overflow."""
    sw, sh = img.size
    scale = max(tw / sw, th / sh)
    nw, nh = round(sw * scale), round(sh * scale)
    img = img.resize((nw, nh), Image.LANCZOS)
    left, top = (nw - tw) // 2, (nh - th) // 2
    return img.crop((left, top, left + tw, top + th))


def build(numbers, spec):
    sheet = Image.new("RGB", (spec["w"], spec["h"]), (255, 255, 255))
    xs = [round(i * spec["w"] / spec["cols"]) for i in range(spec["cols"] + 1)]
    ys = [round(j * spec["h"] / spec["rows"]) for j in range(spec["rows"] + 1)]
    for idx, n in enumerate(numbers):
        col, row = idx % spec["cols"], idx // spec["cols"]
        tile = GALLERY / f"pass-{n:03d}.webp"
        if not tile.exists():
            raise SystemExit(f"missing {tile}")
        src = Image.open(tile).convert("RGB")
        sheet.paste(cover(src, xs[col + 1] - xs[col], ys[row + 1] - ys[row]),
                    (xs[col], ys[row]))
    out = ROOT / spec["path"]
    sheet.save(out, "WEBP", quality=spec["q"], method=6)
    print(f"{spec['path']}  {spec['w']}x{spec['h']}  {os.path.getsize(out):,} bytes")


def main():
    order = display_order()
    print("newest passes:", ", ".join(str(n) for n in order[:10]))
    for spec in (DESKTOP, MOBILE):
        build(order[: spec["cols"] * spec["rows"]], spec)


if __name__ == "__main__":
    main()
