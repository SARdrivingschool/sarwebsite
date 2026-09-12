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
P = json.loads((ROOT / "content" / "pricing.json").read_text(encoding="utf-8"))
VIDEOS = [v for v in CONTENT["videos"]]
CATS = CONTENT["categories"]
SECTIONS = CONTENT["learnSections"]

# content/passes.json is the single source for the pass gallery, the homepage
# carousel/strip, the about page and the Bletchley hub. Newest first.
PASSES = json.loads((ROOT / "content" / "passes.json").read_text(encoding="utf-8"))["passes"]
PASS_TOTAL = len(PASSES)
RECENT_BLETCHLEY_PASSES = [p["n"] for p in PASSES if p.get("testCentre") == "Bletchley"][:6]

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


# ---------- Homepage (generated from templates/home.html) ----------
def newest_passes(n=6):
    """Pass numbers in display order (newest first) from content/passes.json, plus the total."""
    return [p["n"] for p in PASSES][:n], PASS_TOTAL

HOME_FAQS = [
    {"q": "How much are driving lessons?", "a": "Manual and automatic driving lessons start from £38 per hour, with block bookings from £34 an hour."},
    {"q": "Do you offer automatic driving lessons?", "a": "Yes, automatic driving lessons are available across Milton Keynes and nearby areas."},
    {"q": "Do you offer manual driving lessons?", "a": "Yes, manual driving lessons are available from £38 per hour."},
    {"q": "How does instructor matching work?", "a": "Tell us your pickup postcode, whether you want manual or automatic, and when you're free. SAR matches you with a DVSA-approved SAR instructor who covers your area and times, and they contact you directly — usually the same day."},
    {"q": "Can I use your car for my driving test?", "a": "Yes, subject to assessment and DVSA test-standard driving."},
    {"q": "Do you offer refresher lessons?", "a": "Yes, refresher lessons are available for parking, roundabouts, motorway driving and confidence building."},
    {"q": "Do you cover Bletchley test centre?", "a": "Yes. Most SAR pupils take their test at Bletchley, and our free Bletchley Test Centre guides cover the roads and roundabouts around it."},
]
HOME_REVIEWS = [
    {"name": "Japhet Ndembo", "when": "January 2026", "text": "I had a great experience with SAR Driving School. The instructor was calm, professional, and explained everything clearly, which made learning to drive easy. I gained a lot of confidence and would definitely recommend SAR Driving School."},
    {"name": "Siva Jampula", "when": "January 2026", "text": "I had an excellent experience with SAR Driving School in Bletchley, Milton Keynes… I really appreciated the structured lessons, punctuality, and focus on safe driving habits. I highly recommend SAR Driving School to any learner looking for reliable and high quality driving lessons."},
    {"name": "Irta Gudha", "when": "January 2026", "text": "Very professional and patient driving instructor. Clear instructions, friendly attitude, and great support throughout my lessons. Highly recommend!"},
]
_np, _pt = newest_passes(6)
_all, _ = newest_passes(10000)
generated.append(write("/index.html", env.get_template("home.html").render(
    site=SITE, path="/", nav="home",
    seo_title="Driving Lessons Milton Keynes | SAR Driving School",
    seo_description="Manual and automatic driving lessons in Milton Keynes from £38/hr. DVSA-approved instructors, 260+ five-star reviews. Tell us your postcode and we'll match you with an instructor.",
    faq_schema={"@context": "https://schema.org", "@type": "FAQPage",
                "mainEntity": [{"@type": "Question", "name": q["q"], "acceptedAnswer": {"@type": "Answer", "text": q["a"]}} for q in HOME_FAQS]},
    faqs=HOME_FAQS, reviews=HOME_REVIEWS, featured=featured, newest_passes=_np, all_passes=_all, pass_total=_pt, categories=CATS, P=P,
)))

# ---------- Pricing ----------
_lo = P["blocks"][-1]["direct"] / P["blocks"][-1]["hours"]
PRICE_FAQS = [
    {"q": "How much are driving lessons in Milton Keynes?", "a": f"Manual and automatic lessons are £{P['hourly']['standard']} an hour in {P['hourly']['standardAreas']}, or from £{_lo:g} an hour on a 30-hour block. {P['hourly']['outerAreas']} are £{P['hourly']['outer']} an hour with a {P['hourly']['outerMinHours']}-hour minimum."},
    {"q": "Are block bookings cheaper?", "a": "Yes. " + ", ".join(f"{b['hours']} hours saves £{b['hours']*P['hourly']['standard']-b['direct']:g}" for b in P["blocks"]) + " compared with paying hourly. Block hours are used within " + str(P["blockValidityMonths"]) + " months."},
    {"q": "Why does paying SAR cost 5% more?", "a": "The hourly rate is identical either way. Paying SAR Driving School adds 5%, whichever payment method you use, and buys protection: your hours are held by the company, move with you if you change instructor, and are covered by our refund terms. It is never a charge for using a card."},
    {"q": "Do I pay before my first lesson?", "a": "No. Request an instructor, agree your first lesson with them, then pay — your instructor directly with no fee, or SAR with a protected balance."},
    {"q": "Do manual and automatic cost the same?", "a": "Yes — the same hourly and block rates for both."},
    {"q": "What if I need to cancel a lesson?", "a": "More than 48 hours' notice is free; 24–48 hours is charged at 50%; under 24 hours or a no-show is charged in full. Full details are in our terms."},
    {"q": "Can I use your car for my driving test?", "a": "Yes, subject to an assessment lesson and driving to DVSA test standard. Ask us about driving test car hire."},
]
generated.append(write("/pricing.html", env.get_template("pricing.html").render(
    site=SITE, path="/pricing.html", nav="prices", P=P,
    seo_title="Driving Lesson Prices Milton Keynes | SAR Driving School",
    seo_description=f"Manual and automatic driving lessons from £{P['hourly']['standard']} an hour in Milton Keynes, block bookings from £{_lo:g} an hour. Work out your cost in seconds, pay your instructor or pay SAR with a protected balance.",
    breadcrumbs=breadcrumb_schema([("Home", "/"), ("Prices", "/pricing.html")]),
    faq_schema={"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": q["q"], "acceptedAnswer": {"@type": "Answer", "text": q["a"]}} for q in PRICE_FAQS]},
    faqs=PRICE_FAQS, categories=CATS,
)))

# ---------- Lessons + About ----------
SYLLABUS_TOPICS = 53  # matches src/constants/syllabus.json in the SAR instructor app
generated.append(write("/lessons.html", env.get_template("lessons.html").render(
    site=SITE, path="/lessons.html", nav="lessons", P=P, syllabus_count=SYLLABUS_TOPICS,
    seo_title="Driving Lessons & Lesson Types | SAR Driving School",
    seo_description=f"Manual, automatic and refresher driving lessons in Milton Keynes from £{P['hourly']['standard']} an hour. One structured syllabus, progress recorded every lesson, DVSA-approved instructors.",
    breadcrumbs=breadcrumb_schema([("Home", "/"), ("Lessons", "/lessons.html")]), categories=CATS,
)))
generated.append(write("/about.html", env.get_template("about.html").render(
    site=SITE, path="/about.html", nav="about", P=P, syllabus_count=SYLLABUS_TOPICS, hotspot_count=len(hotspots),
    newest_passes=_np, pass_total=_pt,
    seo_title="About SAR Driving School | Milton Keynes",
    seo_description="A family-run Milton Keynes driving school with DVSA-approved instructors, one structured syllabus, progress recorded every lesson and 260+ five-star reviews. Here's how SAR works.",
    breadcrumbs=breadcrumb_schema([("Home", "/"), ("About", "/about.html")]), categories=CATS,
)))

# ---------- Book + thank-you ----------
def _gbp(n):
    return "£" + (f"{n:,.2f}".rstrip("0").rstrip(".") if n % 1 else f"{int(n):,}")
PAY = [{"name": "1 hour lesson", "sar": _gbp(P["single"]["sar"]), "direct": _gbp(P["single"]["direct"]), "href": P["single"]["stripe"], "cta": "Pay for 1 hour"}]
PAY += [{"name": f"{b['hours']} hour block", "sar": _gbp(b["sar"]), "direct": _gbp(b["direct"]), "href": b["stripe"], "cta": f"Pay for {b['hours']} hours"} for b in P["blocks"]]
PAY.append({"name": "Custom amount", "sar": "As agreed with SAR", "direct": "", "note": "Only use this if SAR has confirmed a custom amount with you — you enter it at checkout.", "href": P["custom"]["stripe"], "cta": "Pay a custom amount"})
BOOK_FAQS = [
    {"q": "Do I have to pay before my first lesson?", "a": "No. Send your request, agree your first lesson with your instructor, then pay — either your instructor directly with no fee, or SAR Driving School with a protected balance."},
    {"q": "Can I choose my instructor?", "a": "You book with SAR and we match you to a DVSA-approved SAR instructor based on your area, transmission and availability. If you have a preference — for example a female instructor — put it in the notes and we'll do our best."},
    {"q": "What if my instructor isn't right for me?", "a": "Tell us. Pupils can change instructor within SAR, and if you've paid SAR your remaining hours move with you."},
    {"q": "How quickly will I hear back?", "a": "Usually the same day. We answer 9am–8pm, seven days a week; requests sent late in the evening are answered the next morning."},
    {"q": "Where do lessons start?", "a": "From your address in Milton Keynes. Bedford and Northampton are covered at £43 an hour with a 2-hour minimum; Leighton Buzzard at £38 an hour."},
]
generated.append(write("/book.html", env.get_template("book.html").render(
    site=SITE, path="/book.html", nav="book",
    seo_title="Book Driving Lessons | Find Your Instructor | SAR Driving School Milton Keynes",
    seo_description="Tell us your postcode, manual or automatic and when you're free — SAR matches you with a DVSA-approved instructor in Milton Keynes, usually the same day. No account, nothing to pay up front.",
    breadcrumbs=breadcrumb_schema([("Home", "/"), ("Book lessons", "/book.html")]),
    pay=PAY, faqs=BOOK_FAQS, categories=CATS,
)))
generated.append(write("/thank-you.html", env.get_template("thankyou.html").render(
    site=SITE, path="/thank-you.html", nav="",
    seo_title="Thank You | SAR Driving School",
    seo_description="Thanks for getting in touch with SAR Driving School. We'll be back to you shortly to arrange your driving lessons in Milton Keynes.",
    categories=CATS,
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

inject("driving-lessons-bletchley.html", "soft", "container", "    ")

def inject_block(name, start, end, html, indent):
    f = ROOT / name
    if not f.exists(): return
    s = f.read_text(encoding="utf-8")
    if start not in s or end not in s: return
    html = "\n".join((indent + ln) if ln.strip() else ln for ln in html.splitlines())
    i = s.index(start) + len(start); j = s.index(end)
    s = s[:i] + "\n" + html + "\n" + " " * len(indent) + s[j:]
    f.write_text(s, encoding="utf-8")

AREA_PAGES = {
    "driving-lessons-milton-keynes.html": "Milton Keynes", "driving-lessons-bletchley.html": "Bletchley",
    "driving-lessons-bedford.html": "Bedford", "driving-lessons-northampton.html": "Northampton",
    "driving-lessons-leighton-buzzard.html": "Leighton Buzzard",
}
for _name, _town in AREA_PAGES.items():
    _html = env.get_template("_area_matcher.html").render(town=_town, path="/" + _name)
    inject_block(_name, "<!-- sar:matcher:start -->", "<!-- sar:matcher:end -->", _html, "    ")
inject("driving-lessons-milton-keynes.html", "soft", "container", "    ")

# ---------- Pass gallery (generated from content/passes.json) ----------
_centre_order = ["Bletchley", "Bedford", "Leighton Buzzard", "Northampton"]
_centres = [{"name": c, "key": c.lower().replace(" ", "-"), "count": sum(1 for p in PASSES if p.get("testCentre") == c)}
            for c in _centre_order if any(p.get("testCentre") == c for p in PASSES)]
_counts = {"first": sum(1 for p in PASSES if p.get("firstTime"))}
generated.append(write("/gallery.html", env.get_template("gallery.html").render(
    site=SITE, path="/gallery.html", nav="passes", P=P, passes=PASSES, pass_total=PASS_TOTAL, centres=_centres, counts=_counts,
    seo_title="Recent Driving Test Passes | SAR Driving School",
    seo_description=f"{PASS_TOTAL} real SAR Driving School pupils photographed on the day they passed their driving test — most at Bletchley test centre. Filter by first-time passes and test centre.",
    breadcrumbs=breadcrumb_schema([("Home", "/"), ("Passes", "/gallery.html")]), categories=CATS,
)))

# ---------- Asset version stamp (cache-busting) ----------
# Browsers may cache sar-apple.css / sar-content.js for a day (vercel.json). Every
# build stamps the current content hash on those URLs in EVERY page so a deploy
# always ships fresh CSS/JS without waiting for caches to expire.
import hashlib
def _ver(name):
    return hashlib.md5((ROOT / name).read_bytes()).hexdigest()[:8]
_vcss, _vjs = _ver("sar-apple.css"), _ver("sar-content.js")
_stamped = 0
for f in list(ROOT.glob("*.html")) + list(ROOT.glob("bletchley-test-centre/**/*.html")) + list(ROOT.glob("learn/**/*.html")):
    if f.name.startswith("google"): continue
    h = f.read_text(encoding="utf-8"); o = h
    h = re.sub(r'(href="/?sar-apple\.css)(\?v=[0-9a-f]+)?"', r'\1?v=' + _vcss + '"', h)
    h = re.sub(r'(src="/?sar-content\.js)(\?v=[0-9a-f]+)?"', r'\1?v=' + _vjs + '"', h)
    if h != o:
        f.write_text(h, encoding="utf-8"); _stamped += 1
print(f"Asset versions: css={_vcss} js={_vjs} (stamped {_stamped} pages)")

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
    if path in ("/index.html", "/thank-you.html"): continue  # "/" is listed with the static pages
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
