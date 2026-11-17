#!/usr/bin/env python3
"""Family Memory Magnets movie maker (v1).

Turns a finished family story (30 recorded questions + answers, optional intro/closing, family photos)
into a 1080p MP4 movie, plus YouTube chapter times and a thumbnail.

Run with Dan's video-tool Python (it already has Pillow and ffmpeg):
  PY=~/.csm-video-tool/venv/bin/python

  $PY fmm_movie.py list                        stories on the site (asks for the admin password)
  $PY fmm_movie.py fetch <story id>            download that story's movie kit to ~/FamilyMemoryMagnets/
  $PY fmm_movie.py render <kit folder>         make the movie inside that folder
        --music song.mp3    optional licensed instrumental; it gets quieter whenever someone speaks
        --fast              still pictures instead of slow zoom (much quicker; good for a first look)
        --allow-incomplete  make a movie from the finished stops even if not all 30 are done
  $PY fmm_movie.py demo                        make a short practice movie with computer voices

Privacy: kits hold private family recordings. They are saved in your home folder (not Google Drive) by
default. Delete a kit when the family's keepsake is delivered. The admin password is typed each time and
is never saved.
"""
import argparse, getpass, json, math, os, re, shutil, subprocess, sys, urllib.error, urllib.parse, urllib.request

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps
import imageio_ffmpeg

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
SITE = "https://www.customsongme.com"
KITS = os.path.expanduser("~/FamilyMemoryMagnets")

W, H = 1920, 1080          # output frame
SW, SH = 3840, 2160        # working resolution (headroom for smooth motion)
FPS = 30
PRE, POST = 0.5, 0.8       # quiet seconds before / after each recording
FADE = 0.35                # fade through dark between scenes
NAVY, INK, GOLD, CREAM = (0, 26, 102), (0, 36, 127), (252, 212, 42), (246, 247, 251)
FONT_DIR = os.path.join(REPO, "family-memory-magnets", "fonts")
FONTS = {
    "display": os.path.join(FONT_DIR, "playfair-display-latin-700-normal.woff2"),
    "display_x": os.path.join(FONT_DIR, "playfair-display-latin-800-normal.woff2"),
    "body": os.path.join(FONT_DIR, "dm-sans-latin-500-normal.woff2"),
    "bold": os.path.join(FONT_DIR, "dm-sans-latin-800-normal.woff2"),
}
FALLBACK = "/System/Library/Fonts/Supplemental/Georgia.ttf"
MOVES = ["zoom_in", "pan_right", "zoom_out", "pan_left"]


def log(stage, msg=""):
    print(f"[{stage}] {msg}", flush=True)


def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        sys.exit(f"ffmpeg failed:\n{p.stderr[-2000:]}")
    return p


def slug(text, n=40):
    return re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-")[:n].rstrip("-") or "story"


# ---------------------------------------------------------------- site (admin API)
def login(site):
    pw = getpass.getpass("Family Memory Magnets admin password (not shown, not saved): ")
    try:
        tok = post(site + "/api/fmm/admin/login", {"password": pw})["token"]
    except urllib.error.HTTPError as e:
        sys.exit("Login failed: " + (json.loads(e.read() or b"{}").get("error") or str(e)))
    return tok


def post(url, body, tok=None):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", **({"Authorization": "Bearer " + tok} if tok else {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def get_json(url, tok):
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + tok})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def download(url, path):
    with urllib.request.urlopen(url, timeout=120) as r, open(path, "wb") as fh:
        shutil.copyfileobj(r, fh)
    if os.path.getsize(path) == 0:
        sys.exit(f"Downloaded an empty file: {os.path.basename(path)}")


def cmd_list(a):
    tok = login(a.site)
    d = get_json(a.site + "/api/fmm/admin/overview", tok)
    if not d["stories"]:
        print("No stories yet.")
    for s in d["stories"]:
        print(f"{s['id']}  {s['childName']} & {s['grandparentName']}  {s['completed']}/30"
              f"{'  (test)' if s['test'] else ''}  photos: {len(s.get('photos', []))}"
              f"  publishing: {'allowed' if s.get('publication', {}).get('allowed') else 'not allowed'}")


EXT = {"audio/mp4": "m4a", "audio/aac": "m4a", "audio/webm": "webm", "audio/ogg": "ogg", "image/jpeg": "jpg",
       "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif"}


def cmd_fetch(a):
    tok = login(a.site)
    kit = get_json(f"{a.site}/api/fmm/admin/movie-kit?id={urllib.parse.quote(a.story_id)}", tok)
    out = os.path.abspath(a.out or os.path.join(KITS, f"{slug(kit['childName'])}-{slug(kit['grandparentName'])}-{kit['storyId']}"))
    os.makedirs(os.path.join(out, "audio"), exist_ok=True)
    os.makedirs(os.path.join(out, "photos"), exist_ok=True)
    n_files = 0

    def grab(item, name):
        nonlocal n_files
        if not item:
            return None
        fn = f"{name}.{EXT.get(item['type'], 'bin')}"
        download(a.site + item.pop("url"), os.path.join(out, "audio" if not item["type"].startswith("image") else "photos", fn))
        n_files += 1
        item["file"] = fn
        return item

    for s in kit["stops"]:
        s["q"] = grab(s["q"], f"{s['n']:02d}a-question")
        s["a"] = grab(s["a"], f"{s['n']:02d}b-answer")
    kit["intro"] = grab(kit["intro"], "00-intro")
    kit["closing"] = grab(kit["closing"], "99-closing")
    for i, p in enumerate(kit["photos"], 1):
        grab(p, f"photo-{i:02d}")
    with open(os.path.join(out, "story.json"), "w") as fh:
        json.dump(kit, fh, indent=1)
    log("fetch", f"{n_files} files saved to {out}")
    if not kit["publishAllowed"]:
        log("note", "Publishing is NOT allowed yet: keep this movie private (download only) unless both the parent and the grandparent say share.")
    print(f"\nNext:\n  {sys.executable} {os.path.abspath(__file__)} render \"{out}\"")


# ---------------------------------------------------------------- pictures
def font(kind, size):
    try:
        return ImageFont.truetype(FONTS[kind], size)
    except OSError:
        return ImageFont.truetype(FALLBACK, size)


def wrap(draw, text, kind, max_w, max_lines, start, minimum):
    words = text.split()
    for size in range(start, minimum - 1, -6):
        f = font(kind, size)
        lines, cur = [], ""
        for wd in words:
            t = f"{cur} {wd}".strip()
            if draw.textlength(t, font=f) <= max_w or not cur:
                cur = t
            else:
                lines.append(cur)
                cur = wd
        lines.append(cur)
        if len(lines) <= max_lines and all(draw.textlength(l, font=f) <= max_w for l in lines):
            return f, lines
    return f, lines[:max_lines - 1] + [" ".join(lines[max_lines - 1:])[:80] + "…"] if len(lines) > max_lines else lines


def text_block(img, lines, f, top, fill, center=True, left=0, spacing=1.2, shadow=False):
    d = ImageDraw.Draw(img)
    asc, desc = f.getmetrics()
    lh = int((asc + desc) * spacing)
    if shadow:
        layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        for i, line in enumerate(lines):
            x = (img.width - ld.textlength(line, font=f)) / 2 if center else left
            ld.text((x, top + i * lh), line, font=f, fill=(0, 0, 0, 190))
        img.alpha_composite(layer.filter(ImageFilter.GaussianBlur(16)))
    for i, line in enumerate(lines):
        x = (img.width - d.textlength(line, font=f)) / 2 if center else left
        d.text((x, top + i * lh), line, font=f, fill=fill)
    return top + lh * len(lines)


def block_height(f, n, spacing=1.2):
    a, d = f.getmetrics()
    return int((a + d) * spacing) * n


def load_photo(path):
    try:
        img = Image.open(path)
        img = ImageOps.exif_transpose(img)
        return img.convert("RGB")
    except Exception:
        tmp = path + ".jpg"  # e.g. HEIC that Pillow cannot read: let ffmpeg try
        if subprocess.run([FFMPEG, "-y", "-v", "error", "-i", path, tmp]).returncode == 0 and os.path.exists(tmp):
            return Image.open(tmp).convert("RGB")
        log("warning", f"skipping a photo that could not be opened: {os.path.basename(path)}")
        return None


def cover(img, w, h):
    s = max(w / img.width, h / img.height)
    img = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    l, t = (img.width - w) // 2, (img.height - h) // 2
    return img.crop((l, t, l + w, t + h))


def photo_frame(img):
    """Whole photo, never cropped: blurred copy fills the frame behind it (portrait photos look right)."""
    bg = cover(img, SW, SH).filter(ImageFilter.GaussianBlur(60))
    bg = Image.blend(bg, Image.new("RGB", bg.size, NAVY), 0.45).convert("RGBA")
    s = min(SW * 0.92 / img.width, SH * 0.9 / img.height)
    fg = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    sh = Image.new("RGBA", bg.size, (0, 0, 0, 0))
    x, y = (SW - fg.width) // 2, (SH - fg.height) // 2
    ImageDraw.Draw(sh).rectangle((x + 20, y + 30, x + fg.width + 20, y + fg.height + 30), fill=(0, 0, 0, 150))
    bg.alpha_composite(sh.filter(ImageFilter.GaussianBlur(40)))
    bg.paste(fg, (x, y))
    return bg


def brand_bg(color=NAVY):
    img = Image.new("RGBA", (SW, SH), color + (255,))
    glow = Image.new("L", (SW, SH), 0)
    ImageDraw.Draw(glow).ellipse((SW * 0.1, -SH * 0.4, SW * 0.9, SH * 0.9), fill=70)
    light = Image.new("RGBA", (SW, SH), (255, 255, 255, 0))
    light.putalpha(glow.filter(ImageFilter.GaussianBlur(300)))
    img.alpha_composite(light)
    return img


def gold_rule(img, y, w=360):
    ImageDraw.Draw(img).rounded_rectangle(((SW - w) / 2, y, (SW + w) / 2, y + 14), 7, fill=GOLD)


def names(k):
    g = k.get("grandparents")
    return f"{k['childName']}, {g[0]} & {g[1]}" if g and len(g) == 2 else f"{k['childName']} & {k['grandparentName']}"


def title_card(k, photo):
    img = photo_frame(photo) if photo else brand_bg()
    if photo:
        over = Image.new("RGBA", img.size, NAVY + (150,))
        img.alpha_composite(over)
    d = ImageDraw.Draw(img)
    small = font("bold", 84)
    text_block(img, ["FAMILY MEMORY MAGNETS"], small, SH * 0.25, GOLD)
    f, lines = wrap(d, names(k), "display_x", SW * 0.84, 2, 330, 180)
    if len(lines) > 1:  # long names: smaller and higher, so the subtitle stays well inside the frame
        f, lines = wrap(d, names(k), "display_x", SW * 0.84, 2, 230, 150)
    bottom = text_block(img, lines, f, SH * (0.36 if len(lines) == 1 else 0.33), (255, 255, 255), shadow=True)
    gold_rule(img, bottom + 60)
    text_block(img, ["Our Family Story"], font("display", 150), bottom + 140, (255, 255, 255))
    return img


def chapter_card(n, title):
    img = brand_bg()
    text_block(img, [f"CHAPTER {n}"], font("bold", 110), SH * 0.33, GOLD)
    d = ImageDraw.Draw(img)
    f, lines = wrap(d, title, "display_x", SW * 0.8, 2, 280, 170)
    bottom = text_block(img, lines, f, SH * 0.45, (255, 255, 255))
    gold_rule(img, bottom + 70)
    return img


def question_card(k, stop):
    img = brand_bg(CREAM)
    d = ImageDraw.Draw(img)
    text_block(img, [f"STOP {stop['n']}  ·  {stop['title'].upper()}"], font("bold", 76), SH * 0.16, INK)
    q = stop["question"] or "A question"
    who = stop.get("answerer") or k["grandparentName"]  # "together" stories: grandparents take turns
    if not q.lower().startswith(who.lower()):
        q = f"{who}, {q[0].lower()}{q[1:]}"
    f, lines = wrap(d, f"“{q}”", "display", SW * 0.8, 4, 190, 110)
    top = SH * 0.5 - block_height(f, len(lines)) / 2
    bottom = text_block(img, lines, f, top, NAVY)
    gold_rule(img, bottom + 50)
    text_block(img, [f"{k['childName']} asks"], font("bold", 96), bottom + 110, INK)
    return img


def lower_third(img, label, line2="", caption=""):
    band_h = 380 if line2 else 250
    band = Image.new("RGBA", (SW, band_h + 120), (0, 0, 0, 0))
    g = Image.new("L", (1, band.height))
    for y in range(band.height):
        g.putpixel((0, y), int(225 * min(1, y / 120)))
    band.putalpha(g.resize(band.size))
    tint = Image.new("RGBA", band.size, NAVY + (0,))
    tint.putalpha(band.getchannel("A"))
    img.alpha_composite(tint, (0, SH - band.height))
    d = ImageDraw.Draw(img)
    y = SH - band_h + 40
    d.text((180, y), label, font=font("display_x", 120), fill=GOLD)
    if line2:
        f, lines = wrap(d, line2, "body", SW - 360, 1, 84, 56)
        d.text((180, y + 170), lines[0], font=f, fill=(255, 255, 255))
    if caption:
        f = font("body", 64)
        tw = d.textlength(caption, font=f)
        d.rounded_rectangle((SW - tw - 260, 120, SW - 140, 240), 24, fill=(0, 0, 0, 140))
        d.text((SW - tw - 200, 145), caption, font=f, fill=(255, 255, 255))
    return img


def answer_frame(k, stop, photo, caption):
    img = photo_frame(photo) if photo else question_card(k, stop)
    return lower_third(img, f"{stop.get('answerer') or k['grandparentName']} answers", stop["question"], caption if photo else "")


def message_frame(k, photo, label, caption):
    img = photo_frame(photo) if photo else brand_bg()
    return lower_third(img, label, "", caption if photo else "")


def end_card(k):
    img = brand_bg()
    d = ImageDraw.Draw(img)
    f, lines = wrap(d, names(k), "display_x", SW * 0.8, 2, 260, 160)
    bottom = text_block(img, lines, f, SH * 0.32, (255, 255, 255))
    text_block(img, ["Thirty conversations. Two voices. One lasting family story."], font("body", 92), bottom + 80, (255, 255, 255))
    gold_rule(img, SH * 0.72)
    text_block(img, ["FAMILY MEMORY MAGNETS"], font("bold", 80), SH * 0.76, GOLD)
    return img


# ---------------------------------------------------------------- audio + video pieces
def clip_seconds(path):
    p = subprocess.run([FFMPEG, "-hide_banner", "-v", "error", "-stats", "-i", path, "-f", "null", "-"], capture_output=True, text=True)
    t = re.findall(r"time=(\d+):(\d+):([\d.]+)", p.stderr)
    if p.returncode != 0 or not t:
        sys.exit(f"Could not read the recording {os.path.basename(path)}:\n{p.stderr[-600:]}")
    h, m, s = t[-1]
    return int(h) * 3600 + int(m) * 60 + float(s)


def make_audio(src, out, seconds):
    """Recording (evened-out loudness) with quiet before/after, exactly `seconds` long. src None = silence."""
    if src:
        af = f"loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,asetpts=N/SR/TB,adelay={int(PRE * 1000)}:all=1,apad"
        run([FFMPEG, "-y", "-v", "error", "-i", src, "-af", af, "-t", f"{seconds:.4f}", "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", out])
    else:
        run([FFMPEG, "-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", f"{seconds:.4f}", "-c:a", "pcm_s16le", out])


def motion(move, frames):
    p = f"(on/{max(frames - 1, 1)})"
    cx, cy = "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"
    return {
        "still": ("1", cx, cy),
        "zoom_in": (f"1+0.08*{p}", cx, cy),
        "zoom_out": (f"1.08-0.08*{p}", cx, cy),
        "pan_right": ("1.08", f"(iw-iw/zoom)*{p}", cy),
        "pan_left": ("1.08", f"(iw-iw/zoom)*(1-{p})", cy),
    }[move]


def make_video(img_path, move, frames, out, fast):
    secs = frames / FPS
    fade = f"fade=t=in:st=0:d={FADE},fade=t=out:st={max(secs - FADE, 0):.3f}:d={FADE}"
    if fast or move == "still":
        vf = f"scale={W}:{H}:flags=lanczos,{fade},format=yuv420p"
        cmd = [FFMPEG, "-y", "-v", "error", "-loop", "1", "-framerate", str(FPS), "-i", img_path, "-vf", vf,
               "-frames:v", str(frames), "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage"]
    else:
        z, x, y = motion(move, frames)
        vf = f"zoompan=z='{z}':x='{x}':y='{y}':d={frames}:s={W}x{H}:fps={FPS},{fade},format=yuv420p"
        cmd = [FFMPEG, "-y", "-v", "error", "-i", img_path, "-vf", vf, "-frames:v", str(frames), "-c:v", "libx264", "-preset", "medium"]
    run(cmd + ["-crf", "18", "-pix_fmt", "yuv420p", "-r", str(FPS), out])


def ts(sec):
    sec = int(sec)
    return f"{sec // 3600}:{sec % 3600 // 60:02d}:{sec % 60:02d}" if sec >= 3600 else f"{sec // 60}:{sec % 60:02d}"


# ---------------------------------------------------------------- render
def cmd_render(a):
    kit_dir = os.path.abspath(a.kit)
    with open(os.path.join(kit_dir, "story.json")) as fh:
        k = json.load(fh)
    stops = [s for s in k["stops"] if s.get("q") and s.get("a")]
    if len(stops) < 30 and not a.allow_incomplete:
        sys.exit(f"Only {len(stops)} of 30 stops have both a question and an answer. Finish the story first, "
                 "or add --allow-incomplete for a draft movie.")
    if not stops:
        sys.exit("No finished stops to put in a movie yet.")
    work = os.path.join(kit_dir, "_work")
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work)
    audio_dir, photo_dir = os.path.join(kit_dir, "audio"), os.path.join(kit_dir, "photos")

    photos = []
    for p in k["photos"]:
        img = load_photo(os.path.join(photo_dir, p["file"])) if p.get("file") else None
        if img:
            photos.append((img, p.get("caption", "")))
    log("photos", f"{len(photos)} usable")
    pick = lambda i: photos[i % len(photos)] if photos else (None, "")

    scenes = []  # (kind, image, move, audio file or None, seconds, chapter marker)

    def add(image, move, audio, secs, marker=None):
        frames = math.ceil(secs * FPS)
        scenes.append({"img": image, "move": move, "audio": audio, "frames": frames, "marker": marker})

    def clip_len(item):
        return PRE + clip_seconds(os.path.join(audio_dir, item["file"])) + POST

    first_photo = pick(0)[0]
    add(title_card(k, first_photo), "zoom_in" if first_photo else "still", None, 6.0, "Welcome")
    if k.get("intro"):
        ph, cap = pick(len(stops))
        add(message_frame(k, ph, f"A hello from {k['grandparentName']}", cap), "zoom_out", k["intro"]["file"], clip_len(k["intro"]))
    pi = 1
    for ch in k["chapters"]:
        in_ch = [s for s in stops if s["chapter"] == ch["n"]]
        if not in_ch:
            continue
        add(chapter_card(ch["n"], ch["title"]), "still", None, 4.0, f"Chapter {ch['n']}: {ch['title']}")
        for s in in_ch:
            add(question_card(k, s), "still", s["q"]["file"], clip_len(s["q"]))
            ph, cap = pick(pi)
            add(answer_frame(k, s, ph, cap), MOVES[pi % len(MOVES)] if ph else "still", s["a"]["file"], clip_len(s["a"]))
            pi += 1
    if k.get("closing"):
        ph, cap = pick(pi)
        add(message_frame(k, ph, f"A message from {k['grandparentName']}", cap), "zoom_in", k["closing"]["file"], clip_len(k["closing"]), "A closing message")
    add(end_card(k), "still", None, 7.0, None)

    total_frames = sum(s["frames"] for s in scenes)
    log("plan", f"{len(scenes)} scenes, {ts(total_frames / FPS)} long{' (fast mode)' if a.fast else ''}")

    vlist, alist, chapters, t = [], [], [], 0.0
    for i, sc in enumerate(scenes, 1):
        png, mp4, wav = (os.path.join(work, f"{i:03d}.{e}") for e in ("png", "mp4", "wav"))
        sc["img"].convert("RGB").save(png)
        secs = sc["frames"] / FPS
        make_audio(os.path.join(audio_dir, sc["audio"]) if sc["audio"] else None, wav, secs)
        make_video(png, sc["move"], sc["frames"], mp4, a.fast)
        vlist.append(mp4)
        alist.append(wav)
        if sc["marker"]:
            chapters.append(f"{ts(t)} {sc['marker']}")
        t += secs
        log("scene", f"{i}/{len(scenes)}")

    for name, items in (("video.txt", vlist), ("audio.txt", alist)):
        with open(os.path.join(work, name), "w") as fh:
            fh.writelines(f"file '{p}'\n" for p in items)
    video, voice = os.path.join(work, "video.mp4"), os.path.join(work, "voice.wav")
    run([FFMPEG, "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", os.path.join(work, "video.txt"), "-c", "copy", video])
    run([FFMPEG, "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", os.path.join(work, "audio.txt"), "-c", "copy", voice])

    total = total_frames / FPS
    mix = voice
    if a.music:
        mix = os.path.join(work, "mix.wav")
        # music plays softly and ducks further whenever someone speaks; voices always win
        fc = (f"[0:a]asplit=2[v][key];[1:a]aresample=48000,volume=0.22,afade=t=in:d=2,afade=t=out:st={max(total - 4, 0):.2f}:d=4[m];"
              f"[m][key]sidechaincompress=threshold=0.015:ratio=10:attack=15:release=600[duck];"
              f"[v][duck]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[out]")
        run([FFMPEG, "-y", "-v", "error", "-i", voice, "-stream_loop", "-1", "-i", os.path.abspath(a.music), "-filter_complex", fc,
             "-map", "[out]", "-t", f"{total:.3f}", "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", mix])

    name = f"{slug(k['childName'])}-and-{slug(k['grandparentName'])}-Family-Memory-Magnets"
    out = os.path.join(kit_dir, name + ".mp4")
    run([FFMPEG, "-y", "-v", "error", "-i", video, "-i", mix, "-map", "0:v", "-map", "1:a", "-c:v", "copy",
         "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-t", f"{total:.3f}", "-movflags", "+faststart", out])
    scenes[0]["img"].convert("RGB").resize((1280, 720), Image.LANCZOS).save(os.path.join(kit_dir, name + "-thumbnail.jpg"), quality=90)
    with open(os.path.join(kit_dir, name + "-chapters.txt"), "w") as fh:
        fh.write("YouTube chapters (paste into the description):\n" + "\n".join(chapters) + "\n")

    checks = validate(out, total, work)
    for label, ok in checks.items():
        print(f"  {'PASS' if ok else 'FAIL'}  {label}")
    if not all(checks.values()):
        sys.exit("The movie did not pass every check. Do not deliver it.")
    if not a.keep_work:
        shutil.rmtree(work, ignore_errors=True)
    log("done", out)
    if not k.get("publishAllowed"):
        log("note", "Publishing is NOT allowed for this story yet: deliver it privately (download) only.")


def validate(out, expected, work):
    err = subprocess.run([FFMPEG, "-hide_banner", "-i", out], capture_output=True, text=True).stderr
    secs = clip_seconds(out)
    with open(out, "rb") as fh:
        head = fh.read(4 * 1024 * 1024)
    moov, mdat = head.find(b"moov"), head.find(b"mdat")
    return {
        "video h264 1920x1080": bool(re.search(r"Video: h264.*1920x1080", err)),
        "30 fps": " 30 fps" in err,
        "audio aac 48 kHz stereo": bool(re.search(r"Audio: aac.*48000 Hz, stereo", err)),
        "starts playing quickly (faststart)": moov != -1 and (mdat == -1 or moov < mdat),
        f"length matches plan ({ts(expected)})": abs(secs - expected) <= 1.0,
        "plays all the way through": secs > 1,
    }


# ---------------------------------------------------------------- demo (fake family, computer voices)
DEMO = [
    (1, "Where It All Began", "Childhood home", "What did your house look like when you were my age?",
     "Our house was small and yellow, with a big oak tree out front. Every summer we hung a tire swing from it."),
    (1, "Where It All Began", "Best friend", "Who was your best friend when you were little?",
     "My best friend was Linda from next door. We rode our bikes everywhere and shared every secret."),
    (2, "The Growing-Up Years", "School days", "What was your favorite subject in school?",
     "I loved art class. Our teacher let us paint on the windows every December, and the whole school smiled."),
]


def cmd_demo(a):
    out = os.path.abspath(a.out or os.path.join(KITS, "DEMO-Devon-Mimi"))
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(os.path.join(out, "audio"))
    os.makedirs(os.path.join(out, "photos"))

    def say(voice, text, path):
        aiff = path + ".aiff"
        if subprocess.run(["say", "-v", voice, "-o", aiff, text]).returncode != 0:
            subprocess.run(["say", "-o", aiff, text], check=True)
        run([FFMPEG, "-y", "-v", "error", "-i", aiff, "-c:a", "aac", "-b:a", "128k", path])
        os.remove(aiff)

    stops = []
    for n, (ch, chtitle, title, q, ans) in enumerate(DEMO, 1):
        say("Junior", q, os.path.join(out, "audio", f"{n:02d}a-question.m4a"))
        say("Grandma (English (US))", ans, os.path.join(out, "audio", f"{n:02d}b-answer.m4a"))
        stops.append({"n": n, "chapter": ch, "title": title, "question": q,
                      "q": {"file": f"{n:02d}a-question.m4a", "type": "audio/mp4"}, "a": {"file": f"{n:02d}b-answer.m4a", "type": "audio/mp4"}})
    say("Grandma (English (US))", "Hello Devon! I am so happy we get to do this together.", os.path.join(out, "audio", "00-intro.m4a"))
    say("Grandma (English (US))", "Thank you for asking me all of these questions. I love you so much.", os.path.join(out, "audio", "99-closing.m4a"))
    photos = []
    for i, (c1, c2, label) in enumerate([((240, 170, 90), (90, 60, 140), "Demo photo 1: a sunny day"),
                                         ((60, 120, 180), (20, 40, 90), "Demo photo 2 (portrait)"),
                                         ((80, 150, 90), (30, 70, 40), "Demo photo 3")], 1):
        w, h = (1200, 1600) if "portrait" in label else (1600, 1100)
        img = Image.new("RGB", (w, h))
        d = ImageDraw.Draw(img)
        for y in range(h):
            t = y / h
            d.line([(0, y), (w, y)], fill=tuple(int(c1[j] * (1 - t) + c2[j] * t) for j in range(3)))
        d.ellipse((w * 0.6, h * 0.15, w * 0.8, h * 0.15 + w * 0.2), fill=(255, 236, 170))
        d.text((60, h - 140), label, font=font("bold", 64), fill=(255, 255, 255))
        img.save(os.path.join(out, "photos", f"photo-{i:02d}.jpg"), quality=90)
        photos.append({"id": str(i), "caption": "Mimi at age 7, 1962" if i == 1 else "", "by": "grandparent", "type": "image/jpeg", "file": f"photo-{i:02d}.jpg"})
    kit = {"version": 1, "storyId": "demo", "childName": "Devon", "grandparentName": "Mimi", "test": True, "completed": 3,
           "publishAllowed": False, "chapters": [{"n": 1, "title": "Where It All Began"}, {"n": 2, "title": "The Growing-Up Years"}],
           "stops": stops, "intro": {"file": "00-intro.m4a", "type": "audio/mp4"}, "closing": {"file": "99-closing.m4a", "type": "audio/mp4"},
           "photos": photos}
    with open(os.path.join(out, "story.json"), "w") as fh:
        json.dump(kit, fh, indent=1)
    log("demo", f"practice kit made in {out}")
    cmd_render(argparse.Namespace(kit=out, music=a.music, fast=a.fast, allow_incomplete=True, keep_work=False))


def main():
    ap = argparse.ArgumentParser(description="Family Memory Magnets movie maker")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("list"); p.add_argument("--site", default=SITE)
    p = sub.add_parser("fetch"); p.add_argument("story_id"); p.add_argument("--site", default=SITE); p.add_argument("--out")
    p = sub.add_parser("render"); p.add_argument("kit"); p.add_argument("--music"); p.add_argument("--fast", action="store_true")
    p.add_argument("--allow-incomplete", action="store_true"); p.add_argument("--keep-work", action="store_true")
    p = sub.add_parser("demo"); p.add_argument("--out"); p.add_argument("--music"); p.add_argument("--fast", action="store_true")
    a = ap.parse_args()
    {"list": cmd_list, "fetch": cmd_fetch, "render": cmd_render, "demo": cmd_demo}[a.cmd](a)


if __name__ == "__main__":
    main()
