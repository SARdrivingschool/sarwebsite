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


AREA_PAGES = ["driving-lessons-milton-keynes.html", "driving-lessons-bletchley.html", "driving-lessons-bedford.html",
              "driving-lessons-northampton.html", "driving-lessons-leighton-buzzard.html"]
def add_area_markers(name, s):
    """Matcher block after the intro section (2nd </section> after the hero); hotspots on the MK page after it."""
    if "sar:matcher:start" not in s:
        i = s.find('<section class="hero">'); j = s.find("</section>", i); j = s.find("</section>", j + 1)
        if i > -1 and j > -1:
            j += len("</section>")
            s = s[:j] + "\n\n    <!-- sar:matcher:start -->\n    <!-- sar:matcher:end -->\n" + s[j:]
    if name == "driving-lessons-milton-keynes.html" and "sar:hotspots:start" not in s and "sar:matcher:end -->" in s:
        s = s.replace("    <!-- sar:matcher:end -->\n", "    <!-- sar:matcher:end -->\n\n    <!-- sar:hotspots:start -->\n    <!-- sar:hotspots:end -->\n", 1)
    return s


# Replace the AI-generated hero renders with real SAR photos (Phase 3)
HERO_SWAP = {
    "female-driver-right-side.webp": {
        "default": ("hero-real-area.webp", "A SAR Driving School pupil holding their pass certificate beside a SAR tuition car"),
        "automatic-driving-lessons-milton-keynes.html": ("hero-real-auto.webp", "A SAR Driving School pupil holding their pass certificate after an automatic driving test"),
        "manual-driving-lessons-milton-keynes.html": ("hero-real-manual.webp", "A SAR Driving School pupil holding their pass certificate beside a SAR tuition car"),
        "refresher-driving-lessons-milton-keynes.html": ("hero-real-refresher.webp", "A SAR Driving School pupil holding their pass certificate beside a SAR tuition car"),
        "instructor-training.html": ("hero-real-manual.webp", "A SAR Driving School pupil holding their pass certificate beside a SAR tuition car"),
    },
    "video-review-hero.webp": {"default": ("hero-real-dashcam.webp", "Dashcam footage from a SAR Driving School car on Regent Street, Bletchley")},
}
def swap_hero(name, s):
    for old, m in HERO_SWAP.items():
        if old not in s: continue
        new, alt = m.get(name, m["default"])
        s = re.sub(r'<img src="images/' + re.escape(old) + r'" alt="[^"]*" width="\d+" height="\d+"',
                   f'<img src="images/{new}" alt="{alt}" width="1280" height="720"', s)
    return s

# Pages rendered by tools/build.py — never patch these
GENERATED = {"index.html", "book.html", "thank-you.html", "pricing.html", "lessons.html", "about.html"}

changed = []
for p in sorted(ROOT.glob("*.html")):
    if p.name.startswith("google") or p.name in GENERATED: continue
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
    # sticky mobile bar (shared markup lives in templates/_bar.html)
    if 'class="b-bar"' not in s and '<script src="sar-content.js" defer></script>' in s:
        bar = (ROOT / "templates" / "_bar.html").read_text(encoding="utf-8")
        s = s.replace('<script src="sar-content.js" defer></script>', bar + '\n<script src="sar-content.js" defer></script>', 1)
    # markers
    if p.name == "index.html" and "sar:hotspots:start" not in s and HOME_ANCHOR in s:
        s = s.replace(HOME_ANCHOR, HOME_BLOCK, 1)
    s = swap_hero(p.name, s)
    if p.name in AREA_PAGES:
        s = add_area_markers(p.name, s)
    if p.name == "driving-lessons-bletchley.html" and "sar:hotspots:start" not in s and BLETCH_ANCHOR in s:
        s = s.replace(BLETCH_ANCHOR, BLETCH_BLOCK, 1)
    if s != o:
        p.write_text(s, encoding="utf-8"); changed.append(p.name)

print(f"patched {len(changed)} pages")
todo = [p.name for p in ROOT.glob("*.html") if not p.name.startswith("google") and p.name not in GENERATED and '/learn/">Learn</a>' not in p.read_text(encoding="utf-8")]
print("pages still without the new nav:", todo or "none")
for n in AREA_PAGES:
    print(n, "matcher marker:", "yes" if "sar:matcher:start" in (ROOT / n).read_text(encoding="utf-8") else "NO")
