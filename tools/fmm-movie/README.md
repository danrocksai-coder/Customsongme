# Family Memory Magnets movie maker

Makes a family's 1080p movie on your Mac from their finished story: the 30 recorded questions and answers, the optional intro and closing messages, and their family photos.

## What the movie looks like
1. **Title card:** "Devon & Mimi · Our Family Story" over their first photo.
2. **"A hello from Mimi"** (if Mimi recorded an introduction).
3. **For each of the 6 chapters:**
   - a chapter card;
   - then for each stop, the **question card** (the question in big type while the child's voice plays), followed by the **answer** (a family photo with a slow zoom or pan while the grandparent answers, labeled "Mimi answers").
4. **"A message from Mimi"** (the closing message, if recorded), then an end card.

**Photos:** they are never cropped. Portrait photos sit on a blurred copy of themselves, and captions appear in the corner.

**Sound:**
- Every recording is brought to the same loudness, so a quiet child and a loud grandparent sound even.
- Optional background music gets quieter whenever someone speaks, so voices always come first.

**You also get** a thumbnail and a list of YouTube chapter times.

## Commands (Terminal)

Run these in the Terminal app. They use the Python from your song-video tool.

**1. Practice movie (no real family; computer voices):**
```bash
~/.csm-video-tool/venv/bin/python ~/Projects/Customsongme/tools/fmm-movie/fmm_movie.py demo
```

**2. See the stories and their story IDs** (asks for your admin password; it isn't shown or saved):
```bash
~/.csm-video-tool/venv/bin/python ~/Projects/Customsongme/tools/fmm-movie/fmm_movie.py list
```

**3. Download one story's movie kit** (the story ID is also shown in Admin):
```bash
~/.csm-video-tool/venv/bin/python ~/Projects/Customsongme/tools/fmm-movie/fmm_movie.py fetch STORY_ID
```

**4. Make the movie.** `fetch` prints this exact line for you:
```bash
~/.csm-video-tool/venv/bin/python ~/Projects/Customsongme/tools/fmm-movie/fmm_movie.py render ~/FamilyMemoryMagnets/KIT_FOLDER
```

Options for `render`:
- `--music song.mp3`: add background music. Use only music licensed for client videos and YouTube.
- `--fast`: still pictures instead of slow motion, for a quick first look.
- `--allow-incomplete`: a draft movie before all 30 stops are done.

The movie, thumbnail and chapter list are saved in the kit folder. The tool checks the finished file (format, size, sound and length) and says **FAIL** if anything is wrong.

## Rules
- **Watch the whole movie before delivering it.**
- **Publishing:** only upload to YouTube if Admin shows "Publishing: ALLOWED". That means both the parent and the grandparent chose "share". Otherwise, deliver the movie privately as a download.
- **Privacy:** kits are private family recordings. They're saved in `~/FamilyMemoryMagnets/`, not Google Drive. Delete a kit after the keepsake is delivered. Every kit download is recorded in the story's Admin activity log.
- **Timing:** a full 30-conversation movie takes about 10–15 minutes on your Mac, or a few minutes with `--fast`.
