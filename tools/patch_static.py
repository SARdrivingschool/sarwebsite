#!/usr/bin/env python3
"""
One-off Phase 1 patch for the hand-written pages:
  - header nav → Home · Lessons · Prices · Bletchley · Learn · Passes · About · Contact · Book lessons
  - footer     → adds Bletchley Test Centre / Hotspots / Learn links
  - loads sar-content.js (harmless on pages without a player)
  - inserts <!-- sar:hotspots --> markers on index.html and driving-lessons-bletchley.html
    which tools/build.py fills with the featured hotspot cards on every build.
Safe to re-run: every change checks whether it has already been applied.
"""
import re, glob
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent

NEW_ITEMS = [
    ("index.html", "Home"), ("lessons.html", "Lessons"), ("pricing.html", "Prices"),
    ("/bletchley-test-centre/", "Bletchley"), ("/learn/", "Learn"), ("gallery.html", "Passes"),
    ("about.html", "About"), ("contact.html", "Contact"),
]
def nav_html(cls_ul, cls_cta, id_ul):
    items = "".join(f'      <li><a href="{h}">{t}</a></li>\n' for h, t in NEW_ITEMS)
    return f'    <ul class="{cls_ul}" id="{id_ul}">\n{items}      <li><a href="book.html" class="{cls_cta}">Book lessons</a></li>\n    </ul>'

FOOT_OLD = '<a href="driving-lessons-northampton.html">Driving Lessons Northampton</a>'
FOOT_ADD = ('\n      <a href="/bletchley-test-centre/">Bletchley Test Centre</a>'
            '\n      <a href="/bletchley-test-centre/hotspots/">Bletchley Test Centre Hotspots</a>'
            '\n      <a href="/learn/">Learn to Drive Guides</a>')

HOME_ANCHOR = '      <div class="btn-row"><a class="btn btn-quiet arrow" href="gallery.html">See the full pass gallery</a></div>\n    </div>\n  </section>\n'
HOME_BLOCK = HOME_ANCHOR + '\n  <!-- sar:hotspots:start -->\n  <!-- sar:hotspots:end -->\n'
BLETCH_ANCHOR = '    <section class="soft">\n      <div class="container">\n        <div class="section-head">\n          <div class="label">Bletchley Test Route Practice</div>'
BLETCH_BLOCK = '    <!-- sar:hotspots:start -->\n    <!-- sar:hotspots:end -->\n\n' + BLETCH_ANCHOR

changed = []
for p in sorted(ROOT.glob("*.html")):
    if p.name.startswith("google"): continue
    s = p.read_text(encoding="utf-8"); o = s
    # header (two historical markups)
    s = re.sub(r'    <ul class="nav" id="nav">.*?</ul>', nav_html("nav", "nav-cta", "nav"), s, count=1, flags=re.S)
    s = re.sub(r'    <ul class="nav-links" id="navMenu">.*?</ul>', nav_html("nav-links", "btn-nav", "navMenu"), s, count=1, flags=re.S)
    s = re.sub(r'      <ul id="nav-menu">.*?</ul>', nav_html("", "btn-nav", "nav-menu").replace(' class=""', ''), s, count=1, flags=re.S)
    # footer
    if FOOT_OLD in s and '/bletchley-test-centre/">Bletchley Test Centre</a>' not in s:
        s = s.replace(FOOT_OLD, FOOT_OLD + FOOT_ADD, 1)
    # script
    if "sar-content.js" not in s and '<script src="cookie-consent.js" defer></script>' in s:
        s = s.replace('<script src="cookie-consent.js" defer></script>', '<script src="sar-content.js" defer></script>\n<script src="cookie-consent.js" defer></script>', 1)
    # markers
    if p.name == "index.html" and "sar:hotspots:start" not in s and HOME_ANCHOR in s:
        s = s.replace(HOME_ANCHOR, HOME_BLOCK, 1)
    if p.name == "driving-lessons-bletchley.html" and "sar:hotspots:start" not in s and BLETCH_ANCHOR in s:
        s = s.replace(BLETCH_ANCHOR, BLETCH_BLOCK, 1)
    if s != o:
        p.write_text(s, encoding="utf-8"); changed.append(p.name)

print(f"patched {len(changed)} pages")
todo = [p.name for p in ROOT.glob("*.html") if not p.name.startswith("google") and '/learn/">Learn</a>' not in p.read_text(encoding="utf-8")]
print("pages still without the new nav:", todo or "none")
for n in ("index.html", "driving-lessons-bletchley.html"):
    print(n, "markers:", "yes" if "sar:hotspots:start" in (ROOT / n).read_text(encoding="utf-8") else "NO")
