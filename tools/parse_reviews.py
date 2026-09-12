#!/usr/bin/env python3
"""
Turn raw tesseract dumps of Google-review screenshots into structured records.

Input:  a directory of .txt files (one per screenshot) plus an optional
        manifest.tsv of "<txt basename>\t<png mtime epoch>" lines, used to turn
        Google's relative timestamps ("2 days ago") into a real month.
Output: reviews.raw.json — every record found, with a confidence flag and the
        source file, so the curation pass can sort and spot-check.

Usage:
    python3 tools/parse_reviews.py <ocr-dir> [manifest.tsv] > reviews.raw.json
    python3 tools/parse_reviews.py <ocr-dir> --report     # human-readable audit

Nothing here invents text. Where OCR is ambiguous the record is flagged
"check": True so a human verifies it against the screenshot before publishing.
"""
import json, re, sys, os, datetime
from pathlib import Path

# A Google review card OCRs as, roughly:
#   Rizwan Ashraf [4 ©            <- display name (+ UI junk)
#   O reviews + O photos          <- the anchor; "0" often reads as "O"
#   wok ww o®  2 days ago  NEW    <- stars, relative time, badges
#   Reasonable price              <- optional attribute chip
#   <review body, one or more lines>
# The reviewer's stat line. Sometimes it OCRs on its own ("5 reviews * 0 photos"),
# sometimes glued to the name ("SA AnkitaR % © oy a' 5 reviews * 0 photos"), so this
# is searched anywhere in the line, not just anchored at the start.
ANCHOR = re.compile(r"(?:[\dOolt|]{1,4}\s*)?reviews?\b(?:\W{0,6}\d*\s*photos?\b)?", re.I)
COUNTISH = re.compile(r"(?:[\dOolt|]\s*reviews?\b|reviews?\W{0,8}photos?\b)", re.I)
LOCAL_GUIDE = re.compile(r"local\s*guide", re.I)
# No leading \b: OCR glues the star glyphs onto the number ("we wwe Z3weeksago").
AGO = re.compile(
    r"(?:(a|an|\d{1,3})\s*)?(hour|day|week|month|year)s?\s*ago", re.I)
# Attribute chips Google shows under the stars — never part of the review body.
CHIPS = {
    "great price", "reasonable price", "good price", "expensive",
    "professional", "friendly", "patient", "punctual", "new",
}
# Lines that are pure Google UI and never review text.
UI_NOISE = re.compile(
    r"^(?:like|share|see all reviews|read more|more|helpful|\d+\s*photos?"
    r"|response from the owner|sar driving school|driving school|sar)\W*$", re.I)
STARS = re.compile(r"[*★☆]|\bw[ok]+\b", re.I)


def clean_line(s: str) -> str:
    """Fix the OCR artefacts that recur in this corpus."""
    s = s.replace("’", "'").replace("‘", "'")
    s = s.replace("“", '"').replace("”", '"')
    # A bare pipe or bar is nearly always a capital I in these dumps. It can also
    # end a wrapped line, so the lookahead has to accept end-of-string too.
    s = re.sub(r"(?<![A-Za-z0-9])[|l](?=\s|$)", "I", s)
    s = re.sub(r"^\|\s", "I ", s)
    # Strip emoji and the mojibake tesseract leaves in their place.
    s = re.sub(r"[\U0001F000-\U0001FAFF☀-➿️]", "", s)
    s = re.sub(r"(?:\s|^)(?:©|®|£a2e|GB|Ji,|\[4|\(4|\bo®\b)(?=\s|$)", " ", s)
    # A capital I glued to the next word, or misread as a lowercase L.
    s = re.sub(r"\b[Il]am\b", "I am", s)
    s = re.sub(r"\b[Il](had|have|has|was|would|will|can|could|got|felt|found"
               r"|really|highly|honestly|only|passed|started|recently)\b", r"I \1", s)
    return re.sub(r"[ \t]+", " ", s).strip()


# Google's "NEW" badge and the separators OCR leaves around it.
BADGE = re.compile(r"^[\s|Il\[\]•·,.*~]*(?:NEW)?[\s|Il\[\]•·,.*~]*", re.I)
# A run of glyphs tesseract produces for ★★★★★ — but never a real word.
STAR_TOK = re.compile(r"^[wWoOrRkKeEzZxX*×~•%®©]{1,5}$")
NOT_STARS = {"we", "or", "ow", "own", "ore", "word", "work", "were", "wore",
             "who", "how", "now", "new", "one", "once", "over", "our", "out",
             "ok", "oz", "xx", "wo", "row", "rooe"}


def strip_lead_meta(s: str):
    """Drop the NEW badge and any attribute chip from the front of a line.

    Returns (remainder, chip) so a review that OCR'd onto the timestamp line
    still keeps its opening sentence.
    """
    s = BADGE.sub("", s, count=1)
    chip = ""
    again = True
    while again:
        again = False
        for c in sorted(CHIPS, key=len, reverse=True):
            m = re.match(re.escape(c) + r"\b[\s|Il,.·•]*", s, re.I)
            if m:
                chip = chip or s[:m.end()].strip(" |Il,.·•")
                s = s[m.end():]
                again = True
    return s.strip(" |,.·•"), chip


def strip_star_lead(s: str) -> str:
    """Remove OCR'd star glyphs from the start of a review's first line."""
    toks = s.split()
    while toks and STAR_TOK.match(toks[0]) and toks[0].lower() not in NOT_STARS:
        toks.pop(0)
    return " ".join(toks)


# Google appends a "Services" tag list under some reviews; it is not review text.
SERVICES = re.compile(
    r"\s*\bServices\b\s+(?:[A-Z][a-z]+(?:\s+[a-z]+)*)(?:\s*,\s*[A-Z]?[a-z][^,.]*)*\.?\s*$")
# What tesseract leaves where an emoji was: stray symbol runs and doubled vowels.
EMOJI_RESIDUE = re.compile(
    r"(?<!\w)(?:[@()\[\]{}<>»«¢©®~^*_+=/\\|]{1,4}|ee|ww|oe|eo|wo|ge)(?!\w)")


# Reviews with a photo attached pick up the words inside that photo — usually a
# pass certificate or a branded graphic carrying the school's own web address.
PHOTO_TAIL = re.compile(r"(?:www\.|https?://|\b[\w-]+\.(?:co\.uk|com)\b)", re.I)


def drop_photo_tail(s: str) -> str:
    m = PHOTO_TAIL.search(s)
    if not m:
        return s
    cut = max(s.rfind(c, 0, m.start()) for c in ".!?")
    return s[:cut + 1] if cut > 40 else s


def tidy_text(s: str) -> str:
    """Final pass over an assembled review body."""
    s = re.sub(r"\s+", " ", s).strip()
    s = SERVICES.sub("", s)
    s = drop_photo_tail(s)
    s = EMOJI_RESIDUE.sub(" ", s)
    s = re.sub(r"\s+([,.!?;:])", r"\1", s)     # space before punctuation
    s = re.sub(r",(?=[A-Za-z])", ", ", s)      # comma glued to the next word
    s = re.sub(r"([,.!?;:]){4,}", r"\1\1\1", s)  # runaway dot runs
    # "0 minors" / "0 faults" reads as a capital O at screenshot resolution.
    s = re.sub(r"\bO(?=\s+(?:minors?|faults?|driving faults?)\b)", "0", s)
    s = re.sub(r"\s{2,}", " ", s)
    return s.strip(" ,;:-")


def clean_name_hi(s: str) -> str:
    """Tidy a name that name_ocr.py already isolated — no aggressive stripping."""
    s = re.sub(r"\s+", " ", (s or "")).strip(" .'-")
    s = re.sub(r"[^A-Za-z0-9'() \-\.]", "", s)
    s = s.strip(" .'-")
    # Google shows a few names in caps; shouting looks wrong in a byline.
    if s and s == s.upper() and len(re.sub(r"[^A-Za-z]", "", s)) > 3:
        s = s.title()
    return s


def clean_name(s: str) -> str:
    s = clean_line(s)
    s = re.sub(r"[\[\(].*$", "", s)           # trailing icon glyphs
    s = re.sub(r"[^A-Za-z' \-\.]", " ", s)     # names are letters and punctuation
    s = re.sub(r"\s+", " ", s).strip(" -.")
    # Google draws a letter avatar beside the name; with no profile photo tesseract
    # reads it as a stray one-or-two-letter token at either end. Drop those, but
    # never strip a name down to nothing.
    parts = s.split()
    while len(parts) > 1 and len(parts[0]) <= 2:
        parts.pop(0)
    while len(parts) > 1 and len(parts[-1]) < 2:
        parts.pop()
    s = " ".join(parts)
    # Google shows some names in caps; title-case them for the page.
    if s and s == s.upper() and len(s) > 3:
        s = s.title()
    return s


def rel_to_date(rel: str, mtime: float | None):
    """'2 days ago' + the screenshot's mtime -> (date, 'August 2026')."""
    if mtime is None:
        return None, None
    m = AGO.search(rel or "")
    if not m:
        return None, None
    n_raw, unit = m.group(1), m.group(2).lower()
    n = 1 if (n_raw is None or n_raw.lower() in ("a", "an")) else int(n_raw)
    days = {"hour": n / 24, "day": n, "week": n * 7,
            "month": n * 30.4, "year": n * 365.25}[unit]
    when = datetime.datetime.fromtimestamp(mtime) - datetime.timedelta(days=days)
    return when.date().isoformat(), when.strftime("%B %Y")


def parse_file(path: Path, mtime: float | None):
    lines = [clean_line(x) for x in path.read_text(
        encoding="utf-8", errors="replace").splitlines()]
    lines = [x for x in lines if x]
    anchors = []
    for i, x in enumerate(lines):
        m = COUNTISH.search(x) or (LOCAL_GUIDE.search(x) and ANCHOR.search(x))
        if m:
            anchors.append((i, m))
    out = []
    for k, (a, m) in enumerate(anchors):
        head = lines[a][:m.start()].strip(" |*·•,-")
        head = LOCAL_GUIDE.sub("", head).strip(" |*·•,-")  # a badge, not a name
        if len(re.sub(r"[^A-Za-z]", "", head)) >= 3:
            # Name shares the line with the stat block.
            name = clean_name(head)
            tail_same_line = ANCHOR.sub("", lines[a][m.start():], count=1).strip(" |*·•,-")
        else:
            name = clean_name(lines[a - 1]) if a > 0 else ""
            tail_same_line = ""
        # Body runs to the line before the next review's name — unless that name
        # sits on its own stat line, in which case it stops at the stat line.
        if k + 1 < len(anchors):
            nxt, nm = anchors[k + 1]
            stop = nxt if lines[nxt][:nm.start()].strip(" |*·•,-") else nxt - 1
        else:
            stop = len(lines)
        rest = ([tail_same_line] if tail_same_line else []) + lines[a + 1:stop]
        rel, body, tag = "", [], ""
        for ln in rest:
            m = AGO.search(ln)
            if not rel and m:
                # OCR often glues "★★★★★ 3 weeks ago NEW Great price" and the first
                # line of the review into one line. Keep the timestamp, drop the
                # badges and the chip, and let whatever is left start the review.
                rel = ln[:m.end()]
                tail, chip = strip_lead_meta(ln[m.end():])
                tag = tag or chip
                if tail:
                    body.append(tail)
                continue
            if not body and (STARS.search(ln) and len(ln) < 40):
                continue
            low = ln.lower().strip(" .!")
            if not body and low in CHIPS:
                tag = ln
                continue
            if UI_NOISE.match(ln):
                continue
            if not body:
                ln = strip_star_lead(ln)
                if not ln:
                    continue
            body.append(ln)
        text = tidy_text(" ".join(body))
        iso, month = rel_to_date(rel, mtime)
        rec = {
            "name": name,
            "text": text,
            "date": iso,
            "when": month,
            "relative": AGO.search(rel).group(0) if AGO.search(rel) else None,
            "tag": tag or None,
            "source": path.name,
            "words": len(text.split()),
        }
        # Flag anything a human should eyeball before it goes on the site.
        rec["check"] = bool(
            not name or len(name) < 3 or rec["words"] < 4 or "  " in name
        )
        out.append(rec)
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    report = "--report" in sys.argv
    if not args:
        sys.exit(__doc__)
    ocr_dir = Path(args[0])
    # Names re-read at 3x by tools/name_ocr.py beat the whole-page read.
    hires = {}
    nf = next((a for a in args if a.endswith("names.json")), None)
    if nf and Path(nf).exists():
        hires = {k: v for k, v in json.loads(
            Path(nf).read_text(encoding="utf-8")).items() if v}
    # Names checked by eye against the screenshot always win over OCR.
    fixes = {}
    ff = next((a for a in args if "fixes" in a), None)
    if ff and Path(ff).exists():
        fixes = {k: v for k, v in json.loads(
            Path(ff).read_text(encoding="utf-8")).items()
            if not k.startswith("_")}
    mtimes = {}
    if len(args) > 1 and Path(args[1]).exists():
        for ln in Path(args[1]).read_text(encoding="utf-8").splitlines():
            if "\t" in ln:
                k, v = ln.rsplit("\t", 1)
                try:
                    mtimes[k.strip()] = float(v)
                except ValueError:
                    pass

    def mtime_for(f: Path):
        # Manifest keys are sanitised (spaces -> underscores); filenames may not be.
        for k in (f.stem, f.name, f.stem.replace(" ", "_"), f.name.replace(" ", "_")):
            if k in mtimes:
                return mtimes[k]
        return None

    records, empty = [], []
    for f in sorted(ocr_dir.glob("*.txt")):
        recs = parse_file(f, mtime_for(f))
        if not recs:
            empty.append(f.name)
        # One card per screenshot is the norm here, so the high-res name applies
        # to the single record; a screenshot holding two cards keeps page OCR.
        if len(recs) == 1 and f.stem in hires:
            recs[0]["nameOcr"] = recs[0]["name"]
            recs[0]["name"] = clean_name_hi(hires[f.stem]) or recs[0]["name"]
        key = f.stem.replace(" ", "_")
        if len(recs) == 1 and key in fixes:
            recs[0]["nameOcr"] = recs[0]["name"]
            recs[0]["name"] = fixes[key]
            recs[0]["verified"] = True
        records.extend(recs)

    # Dedupe: scroll captures overlap, so the same review appears more than
    # once. Key on name + a normalised prefix of the text.
    # Key on the text alone: the same review shot twice can OCR two slightly
    # different names ("shreya Pillai" / "shreya Pillai GZ"), so keying on the
    # name too would let the duplicate through.
    seen, uniq, dupes = {}, [], 0
    for r in records:
        key = re.sub(r"[^a-z0-9]", "", r["text"].lower())[:80]
        if key and key in seen:
            dupes += 1
            prev = seen[key]
            # Keep the fuller capture, preferring a name checked against the image.
            better = (bool(r.get("verified")), r["words"]) > \
                     (bool(prev.get("verified")), prev["words"])
            if better:
                uniq[uniq.index(prev)] = r
                seen[key] = r
            continue
        if key:
            seen[key] = r
        uniq.append(r)

    if report:
        ok = [r for r in uniq if not r["check"]]
        print(f"files parsed      : {len(list(ocr_dir.glob('*.txt')))}")
        print(f"files with no card: {len(empty)}")
        print(f"records found      : {len(records)}")
        print(f"duplicates merged  : {dupes}")
        print(f"unique reviews     : {len(uniq)}  ({len(ok)} clean, "
              f"{len(uniq) - len(ok)} need a look)")
        print(f"dated              : {sum(1 for r in uniq if r['when'])}")
        print()
        for r in sorted(uniq, key=lambda r: -r["words"])[:400]:
            flag = "!" if r["check"] else " "
            print(f"{flag} {r['words']:>4}w  {r['when'] or '?':<14} "
                  f"{r['name'][:28]:<28} {r['text'][:70]}")
        if empty:
            print("\nno review card found in:")
            for e in empty:
                print("   ", e)
        return

    json.dump({"reviews": uniq}, sys.stdout, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
