#!/usr/bin/env python3
"""
SAR Driving School — content builder.

Reads content/videos.json and renders the Bletchley Test Centre hub, the
hotspots index, one page per video, the Learn hub and its sections. Then
rewrites sitemap.xml so every page (static and generated) is listed once.

Usage, from the repo root:
    python3 tools/build.py

Adding a video:
    1. Encode it:  ffmpeg -i in.mp4 -vf scale=720:1280 -c:v libx264 -crf 30 -maxrate 950k -bufsize 1900k \
                     -pix_fmt yuv420p -c:a aac -b:a 64k -ac 1 -movflags +faststart video/hotspots/<slug>.mp4
    2. Poster:     ffmpeg -ss 3 -i in.mp4 -frames:v 1 -vf scale=720:1280 poster.png  → save as
                   images/hotspots/<slug>-poster.webp (720×1280) and <slug>-card.webp (480×854)
    3. Add a record to content/videos.json (copy an existing one).
    4. Run this script, check the page, commit.

Requires: python3 + jinja2 (pip3 install jinja2). No other dependencies.
"""
import json, os, re, sys, glob, datetime
from pathlib import Path

try:
    from jinja2 import Environment, FileSystemLoader, select_autoescape
except ImportError:
    sys.exit("jinja2 is missing — run:  pip3 install jinja2")

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://sardrivingschool.co.uk"
CONTENT = json.loads((ROOT / "content" / "videos.json").read_text(encoding="utf-8"))
VIDEOS = [v for v in CONTENT["videos"]]
CATS = CONTENT["categories"]
SECTIONS = CONTENT["learnSections"]

# Newest gallery numbers known to be Bletchley passes (used on the hub until
# content/passes.json carries a testCentre field per pass).
RECENT_BLETCHLEY_PASSES = [229, 228, 227, 226, 225, 224]

env = Environment(
    loader=FileSystemLoader(str(ROOT / "templates")),
    autoescape=select_autoescape(["html"]),
    trim_blocks=True, lstrip_blocks=True,
)

def dur_label(sec):
    m, s = divmod(int(sec), 60)
    return f"{m}:{s:02d}"

def iso_dur(sec):
    m, s = divmod(int(sec), 60)
    return f"PT{m}M{s}S"

def url_for(v):
    if v["kind"] == "hotspot":
        return f"/bletchley-test-centre/hotspots/{v['slug']}/"
    return f"/learn/{v['learnSection']}/{v['slug']}/"

by_slug = {}
for v in VIDEOS:
    v["url"] = url_for(v)
    v["durationLabel"] = dur_label(v["durationSec"])
    by_slug[v["slug"]] = v

hotspots = sorted([v for v in VIDEOS if v["kind"] == "hotspot"], key=lambda v: v["order"])
learn = [v for v in VIDEOS if v["kind"] == "learn"]

def breadcrumb_schema(items):
    return {
        "@context": "https://schema.org", "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": n, "item": SITE + u}
            for i, (n, u) in enumerate(items)
        ],
    }

def itemlist_schema(vs):
    return {
        "@context": "https://schema.org", "@type": "ItemList",
        "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "url": SITE + v["url"], "name": v["title"]}
            for i, v in enumerate(vs)
        ],
    }

def video_schema(v):
    d = {
        "@context": "https://schema.org", "@type": "VideoObject",
        "name": v["title"],
        "description": v["seo"]["description"],
        "thumbnailUrl": [SITE + v["poster"]],
        "uploadDate": v["published"],
        "duration": iso_dur(v["durationSec"]),
        "publisher": {"@type": "Organization", "name": "SAR Driving School", "logo": {"@type": "ImageObject", "url": SITE + "/images/logo.webp"}},
    }
    if v["video"].get("youtube"):
        d["embedUrl"] = f"https://www.youtube-nocookie.com/embed/{v['video']['youtube']}"
    if v["video"].get("file"):
        d["contentUrl"] = SITE + v["video"]["file"]
    if v.get("location"):
        d["contentLocation"] = {"@type": "Place", "name": v["location"]}
    return d

def write(path, html):
    out = ROOT / path.lstrip("/")
    if path.endswith("/"):
        out = out / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    return path

generated = []

# ---------- Bletchley hub ----------
faqs = [
    {"q": "Where is Bletchley driving test centre?",
     "a": "Block 4, Government Buildings, Wilton Avenue, Bletchley, Milton Keynes MK3 6DH. There is parking at the centre."},
    {"q": "Are these the Bletchley test routes?",
     "a": "No. DVSA does not publish test routes and examiners vary them. These are the roads and areas around the centre that learners may benefit from understanding and practising."},
    {"q": "Do SAR instructors cover the Bletchley area?",
     "a": "Yes. Most SAR pupils take their test at Bletchley, and every SAR instructor teaches on these roads regularly. Lessons start from your pickup address in Milton Keynes."},
    {"q": "Can I use a SAR car for my test at Bletchley?",
     "a": "If you learn with SAR you normally take the test in your instructor's car. If you already have a test booked and need a car and instructor, see driving test car hire on our prices page."},
    {"q": "What happens at the start of the test?",
     "a": "An eyesight check, then one 'tell me' question before you drive and one 'show me' question while driving. Our Show Me / Tell Me guides cover the answers."},
]
faq_schema = {"@context": "https://schema.org", "@type": "FAQPage",
              "mainEntity": [{"@type": "Question", "name": q["q"], "acceptedAnswer": {"@type": "Answer", "text": q["a"]}} for q in faqs]}
featured = [v for v in hotspots if v.get("featured")][:4]
generated.append(write("/bletchley-test-centre/", env.get_template("hub.html").render(
    site=SITE, path="/bletchley-test-centre/", nav="bletchley",
    seo_title="Bletchley Driving Test Centre Guide — Hotspots, Roads & Tips | SAR Driving School",
    seo_description="Preparing for a driving test at Bletchley? SAR's local guide: video hotspots on the roads and roundabouts around the test centre, what to expect on the day, and recent passes.",
    breadcrumbs=breadcrumb_schema([("Home", "/"), ("Bletchley Test Centre", "/bletchley-test-centre/")]),
    faq_schema=faq_schema, faqs=faqs, featured=featured, hotspot_count=len(hotspots),
    recent_passes=RECENT_BLETCHLEY_PASSES, categories=CATS,
)))

# ---------- Hotspots index ----------
cat_counts = {}
for v in hotspots:
    cat_counts[v["category"]] = cat_counts.get(v["category"], 0) + 1
cats_used = [(k, CATS[k]) for k in CATS if k in cat_counts]
generated.append(write("/bletchley-test-centre/hotspots/", env.get_template("hotspots.html").render(
    site=SITE, path="/bletchley-test-centre/hotspots/", nav="bletchley",
    seo_title="Bletchley Test Centre Hotspots — Video Guides to the Tricky Roads | SAR Driving School",
    seo_description="Video guides to the roundabouts, junctions and roads around Bletchley Test Centre, filmed and explained by SAR instructors. Know the tricky areas before your test.",
    breadcrumbs=breadcrumb_schema([("Home", "/"), ("Bletchley Test Centre", "/bletchley-test-centre/"), ("Hotspots", "/bletchley-test-centre/hotspots/")]),
    itemlist=itemlist_schema(hotspots), videos=hotspots, cats_used=cats_used, cat_counts=cat_counts, categories=CATS,
)))

# ---------- Video pages ----------
def render_video(v):
    if v["kind"] == "hotspot":
        crumbs = [{"name": "Home", "url": "/"}, {"name": "Bletchley Test Centre", "url": "/bletchley-test-centre/"},
                  {"name": "Hotspots", "url": "/bletchley-test-centre/hotspots/"}, {"name": v["shortTitle"], "url": v["url"]}]
        nav = "bletchley"
    else:
        sec = next(s for s in SECTIONS if s["slug"] == v["learnSection"])
        crumbs = [{"name": "Home", "url": "/"}, {"name": "Learn", "url": "/learn/"},
                  {"name": sec["title"], "url": f"/learn/{sec['slug']}/"}, {"name": v["shortTitle"], "url": v["url"]}]
        nav = "learn"
    series_items = []
    if v.get("series"):
        series_items = sorted([x for x in VIDEOS if x.get("series") and x["series"]["name"] == v["series"]["name"]], key=lambda x: x["series"]["part"])
    related = [by_slug[s] for s in v.get("related", []) if s in by_slug][:3]
    return write(v["url"], env.get_template("video.html").render(
        site=SITE, path=v["url"], nav=nav, og_type="video.other", og_image=v["poster"], og_alt=v["title"],
        seo_title=v["seo"]["title"], seo_description=v["seo"]["description"],
        breadcrumbs=breadcrumb_schema([(c["name"], c["url"]) for c in crumbs]), crumbs=crumbs,
        video_schema=video_schema(v), v=v, series_items=series_items, related=related, categories=CATS,
    ))

for v in VIDEOS:
    generated.append(render_video(v))

# ---------- Learn hub + sections ----------
def section_videos(sec):
    vs = [v for v in learn if v["learnSection"] == sec["slug"]]
    vs += [v for v in hotspots if v["category"] in sec.get("includeHotspotCategories", [])]
    return sorted(vs, key=lambda v: (v.get("series") or {}).get("part", 0) or v["order"])

for s in SECTIONS:
    s["count"] = len(section_videos(s))
latest = sorted(VIDEOS, key=lambda v: v["published"], reverse=True)[:8]
generated.append(write("/learn/", env.get_template("learn.html").render(
    site=SITE, path="/learn/", nav="learn",
    seo_title="Learn to Drive — Free Video Guides from SAR Driving School, Milton Keynes",
    seo_description="Free driving guides from SAR instructors: roundabout lane choice, show me / tell me answers, the mistakes that fail people, and video hotspots around Bletchley Test Centre.",
    breadcrumbs=breadcrumb_schema([("Home", "/"), ("Learn", "/learn/")]),
    sections=SECTIONS, latest=latest, hotspot_count=len(hotspots), categories=CATS,
)))
for s in SECTIONS:
    vs = section_videos(s)
    others = [o for o in SECTIONS if o["slug"] != s["slug"]]
    generated.append(write(f"/learn/{s['slug']}/", env.get_template("learn_section.html").render(
        site=SITE, path=f"/learn/{s['slug']}/", nav="learn",
        seo_title=f"{s['title']} — Driving Guides | SAR Driving School",
        seo_description=s["intro"],
        breadcrumbs=breadcrumb_schema([("Home", "/"), ("Learn", "/learn/"), (s["title"], f"/learn/{s['slug']}/")]),
        itemlist=itemlist_schema(vs), section=s, videos=vs, other_sections=others, hotspot_count=len(hotspots), categories=CATS,
    )))


# ---------- Inject featured cards into the hand-written pages ----------
def inject(name, section_class, wrap_class, indent):
    f = ROOT / name
    if not f.exists(): return
    s = f.read_text(encoding="utf-8")
    start, end = "<!-- sar:hotspots:start -->", "<!-- sar:hotspots:end -->"
    if start not in s or end not in s:
        print(f"  (no markers in {name}; run tools/patch_static.py first)"); return
    html = env.get_template("_home_hotspots.html").render(featured=featured, section_class=section_class, wrap_class=wrap_class, categories=CATS)
    html = "\n".join((indent + ln) if ln.strip() else ln for ln in html.splitlines())
    i = s.index(start) + len(start); j = s.index(end)
    s = s[:i] + "\n" + html + "\n" + " " * len(indent) + s[j:]
    f.write_text(s, encoding="utf-8"); print(f"  injected {len(featured)} cards into {name}")

inject("index.html", "section-alt", "wrap", "  ")
inject("driving-lessons-bletchley.html", "soft", "container", "    ")

# ---------- Sitemap ----------
EXCLUDE = {"thank-you.html", "google0e1b20059f84a409.html"}
static = sorted(p.name for p in ROOT.glob("*.html") if p.name not in EXCLUDE)
today = datetime.date.today().isoformat()
urls = []
for name in static:
    loc = SITE + ("/" if name == "index.html" else f"/{name}")
    pri = "1.0" if name == "index.html" else "0.8"
    urls.append((loc, pri))
for path in generated:
    pri = "0.9" if path.count("/") <= 3 else "0.7"
    urls.append((SITE + path, pri))
seen = set(); lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
for loc, pri in urls:
    if loc in seen: continue
    seen.add(loc)
    lines += ["  <url>", f"    <loc>{loc}</loc>", f"    <lastmod>{today}</lastmod>", f"    <priority>{pri}</priority>", "  </url>"]
lines.append("</urlset>")
(ROOT / "sitemap.xml").write_text("\n".join(lines) + "\n", encoding="utf-8")

print(f"Rendered {len(generated)} pages; sitemap has {len(seen)} URLs.")
for g in generated: print("  ", g)
