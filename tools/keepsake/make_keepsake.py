#!/usr/bin/env python3
"""Make a printable CustomSongMe lyric keepsake (US Letter PDF) for one song.

Usage:
    .venv/bin/python make_keepsake.py path/to/order.json

order.json fields (paths are relative to the JSON file):
    title          Song title
    for_line       Small line under the title, e.g. "For the Martinez family · Christmas 2026"
    lyrics_file    Plain-text lyrics. Lines in [brackets] (Suno tags) are skipped.
    cover_art      Cover art image (jpg/png/webp)
    mp3_url        Link that plays the MP3 (Drive share link). Center QR.
    tier           25, 50, 75 or 100
    youtube_url    The customer's video link (tiers 50 and up)
    promo_code     Stripe promotion code (tiers 75 and 100)
    output         Optional PDF filename (default: out/<title>.pdf)

The PDF is checked after it is made: the lyrics must fit on one page at a
readable size. Scan every QR from a phone before sending.
"""
import base64
import html
import json
import mimetypes
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import segno

HERE = Path(__file__).resolve().parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
LOGO = HERE.parent.parent / "img" / "customsongme-icon.png"
CHANNEL_URL = "https://youtube.com/@customsongme"
SITE_URL = "https://www.customsongme.com/"
PROMO_PAGE = "https://www.customsongme.com/holiday-songs?promo={code}"
DISCOUNT = {75: 20, 100: 25}
PROMO_USES = 3
PROMO_EXPIRES = "Dec 31, 2027"


def fail(msg):
    sys.exit(f"ERROR: {msg}")


def data_uri(path):
    mime = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    return f"data:{mime};base64,{base64.b64encode(Path(path).read_bytes()).decode()}"


def qr_svg(url):
    qr = segno.make(url, error="m")
    svg = qr.svg_inline(scale=1, border=2, dark="#001a66", light="#ffffff", omitsize=True)
    return svg.replace("<svg ", '<svg class="qr" ', 1)


def stanzas(text):
    out, cur = [], []
    for raw in text.splitlines():
        line = raw.strip()
        if re.fullmatch(r"\[.*\]|\(.*\)", line):
            line = ""  # Suno section tags and stage directions
        if line:
            cur.append(html.escape(line))
        elif cur:
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return out


def load_order(path):
    path = Path(path).resolve()
    o = json.loads(path.read_text())
    base = path.parent
    for key in ("title", "lyrics_file", "cover_art", "mp3_url", "tier"):
        if not o.get(key):
            fail(f"order.json is missing '{key}'")
    tier = int(o["tier"])
    if tier not in (25, 50, 75, 100):
        fail("tier must be 25, 50, 75 or 100")
    if tier >= 50 and not o.get("youtube_url"):
        fail(f"the ${tier} package needs youtube_url")
    if tier >= 75 and not re.fullmatch(r"[A-Za-z0-9_-]{3,40}", o.get("promo_code", "")):
        fail(f"the ${tier} package needs promo_code (letters, numbers, - or _)")
    o["tier"] = tier
    o["lyrics"] = (base / o["lyrics_file"]).read_text()
    o["cover_path"] = base / o["cover_art"]
    if not o["cover_path"].exists():
        fail(f"cover art not found: {o['cover_path']}")
    safe = re.sub(r"[^A-Za-z0-9]+", "-", o["title"]).strip("-") or "keepsake"
    o["pdf"] = (base / o["output"]) if o.get("output") else HERE / "out" / f"{safe}.pdf"
    return o


def build_html(o):
    tier = o["tier"]
    if tier >= 50:
        left = (o["youtube_url"], "Watch your video")
    else:
        left = (CHANNEL_URL, "More songs on YouTube")
    if tier >= 75:
        code = o["promo_code"].upper()
        right_url = PROMO_PAGE.format(code=code)
        right_label = (f"<span style='white-space:nowrap'>{DISCOUNT[tier]}% off your next song</span>"
                       f"<br><b>Code {html.escape(code)}</b>"
                       f"<br><small>Up to {PROMO_USES} uses · expires {PROMO_EXPIRES}</small>")
    else:
        right_url, right_label = SITE_URL, "Make another song<br><b>CustomSongMe.com</b>"

    lyric_html = "".join(
        '<div class="st">' + "".join(f'<div class="ln">{line}</div>' for line in s) + "</div>"
        for s in stanzas(o["lyrics"]))
    if not lyric_html:
        fail("the lyrics file is empty")

    return f"""<!doctype html><html><head><meta charset="utf-8">
<title>{html.escape(o['title'])}</title>
<style>
@page {{ size: 8.5in 11in; margin: 0; }}
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
html, body {{ width: 8.5in; height: 11in; }}
body {{ position: relative; overflow: hidden; background: #fffaf0; color: #13204a; font-family: Georgia, serif;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
.page {{ position: absolute; inset: .25in; border: .07in solid #fcd42a; display: flex; flex-direction: column; }}
.head {{ background: #001a66; color: #fff; text-align: center; padding: .2in .35in .18in; }}
.kicker {{ color: #fcd42a; font: 700 8.5pt/1 Helvetica, Arial, sans-serif; letter-spacing: .22em; text-transform: uppercase; }}
h1 {{ color: #fcd42a; font-size: 30pt; line-height: 1.08; margin: .08in 0 .05in; }}
.for {{ font: italic 11.5pt/1.3 Georgia, serif; }}
.body {{ flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; padding: .2in .4in .14in; }}
.disc {{ position: relative; width: 2.85in; height: 2.85in; flex: none; border-radius: 50%;
  background: url('{data_uri(o['cover_path'])}') center/cover; box-shadow: 0 0 0 .05in #c9ced8, 0 0 0 .065in #8f97a8; }}
.disc::before {{ content: ""; position: absolute; inset: 0; border-radius: 50%;
  background: repeating-radial-gradient(circle, rgba(255,255,255,.10) 0 .6px, transparent .6px 4px),
              conic-gradient(from 30deg, rgba(255,255,255,.28), transparent 18%, rgba(255,255,255,.22) 50%, transparent 68%, rgba(255,255,255,.28)); }}
.label {{ position: absolute; left: 50%; top: 50%; width: 1.32in; height: 1.32in; transform: translate(-50%,-50%);
  border-radius: 50%; background: #fff; border: .03in solid #001a66; display: grid; place-items: center; }}
.label .qr {{ width: .86in; height: .86in; }}
.cap {{ font: 700 8pt/1 Helvetica, Arial, sans-serif; color: #001a66; letter-spacing: .08em; text-transform: uppercase; margin: .13in 0 .12in; }}
.lyrics {{ flex: 1; min-height: 0; width: 100%; overflow: hidden; column-count: 2; column-gap: .4in;
  column-rule: 1px solid #e8d9a8; font-size: 11pt; line-height: 1.38; text-align: center; }}
.st {{ break-inside: avoid; margin-bottom: .75em; }}
.ln {{ text-wrap: balance; }}
.ln + .ln {{ margin-top: .08em; }}
.foot {{ background: #001a66; color: #fff; display: grid; grid-template-columns: 1fr .9fr 1.3fr; align-items: center;
  gap: .15in; padding: .14in .25in; font: 8.5pt/1.3 Helvetica, Arial, sans-serif; }}
.code {{ display: flex; align-items: center; gap: .1in; }}
.code.r {{ flex-direction: row-reverse; text-align: right; }}
.tile {{ background: #fff; padding: .03in; border-radius: .05in; flex: none; }}
.tile .qr {{ display: block; width: .92in; height: .92in; }}
.code b {{ color: #fcd42a; }}
.code small {{ font-size: 7pt; color: #d7dcef; }}
.brand {{ text-align: center; }}
.brand img {{ width: .42in; height: .42in; }}
.brand .n {{ color: #fcd42a; font: 700 12pt/1.1 Georgia, serif; }}
.brand .t {{ font-style: italic; color: #d7dcef; }}
</style></head><body>
<div class="page">
  <div class="head">
    <div class="kicker">A CustomSongMe Original</div>
    <h1 id="title">{html.escape(o['title'])}</h1>
    {f'<div class="for">{html.escape(o["for_line"])}</div>' if o.get('for_line') else ''}
  </div>
  <div class="body">
    <div class="disc"><div class="label">{qr_svg(o['mp3_url'])}</div></div>
    <div class="cap">Scan the center of the disc to play your song</div>
    <div class="lyrics" id="lyrics">{lyric_html}</div>
  </div>
  <div class="foot">
    <div class="code"><div class="tile">{qr_svg(left[0])}</div><div>{left[1]}</div></div>
    <div class="brand"><img src="{data_uri(LOGO)}" alt=""><div class="n">CustomSongMe</div><div class="t">Your story. Your song.</div></div>
    <div class="code r"><div class="tile">{qr_svg(right_url)}</div><div>{right_label}</div></div>
  </div>
</div>
<script>
function fit(el, start, min, step) {{
  let s = start;
  el.style.fontSize = s + 'pt';
  while ((el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) && s > min) {{
    s = Math.round((s - step) * 100) / 100;
    el.style.fontSize = s + 'pt';
  }}
  return s;
}}
const t = document.getElementById('title');
let ts = 30; while (t.offsetHeight > 0.95 * 96 && ts > 16) {{ ts -= 1; t.style.fontSize = ts + 'pt'; }}
const ls = fit(document.getElementById('lyrics'), 11, 7, 0.25);
const lyr = document.getElementById('lyrics');
const ok = lyr.scrollHeight <= lyr.clientHeight + 1 && lyr.scrollWidth <= lyr.clientWidth + 1;
document.body.dataset.fit = (ok ? 'ok' : 'overflow') + ':' + ls;
</script>
</body></html>"""


def chrome(*args):
    r = subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-first-run",
                        "--virtual-time-budget=4000", *args], capture_output=True, text=True, timeout=90)
    return r.stdout


def main():
    if len(sys.argv) != 2:
        fail("usage: .venv/bin/python make_keepsake.py path/to/order.json")
    o = load_order(sys.argv[1])
    with tempfile.TemporaryDirectory() as tmp:
        page = Path(tmp) / "keepsake.html"
        page.write_text(build_html(o))
        dom = chrome("--window-size=816,1056", "--dump-dom", page.as_uri())
        m = re.search(r'data-fit="(\w+):([\d.]+)"', dom)
        if not m:
            fail("could not measure the layout (Chrome didn't run the page script)")
        if m.group(1) != "ok":
            fail(f"the lyrics don't fit on one page even at {m.group(2)}pt. Shorten them or split the song.")
        o["pdf"].parent.mkdir(parents=True, exist_ok=True)
        chrome("--no-pdf-header-footer", f"--print-to-pdf={o['pdf']}", page.as_uri())
    if not o["pdf"].exists() or o["pdf"].stat().st_size < 10_000:
        fail("Chrome didn't produce the PDF")
    size = float(m.group(2))
    note = "" if size >= 8.5 else "  (small text: consider trimming the lyrics)"
    print(f"Made {o['pdf']}  ·  lyrics at {size}pt{note}")
    print("Before sending: scan every QR code from a phone that isn't signed in to Google.")


if __name__ == "__main__":
    main()
