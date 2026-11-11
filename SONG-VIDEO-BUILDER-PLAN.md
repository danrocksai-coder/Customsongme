# Song Video Builder — Saved Plan (paused 2026-10-28)

A local Mac app for CustomSongMe. One library holds all your images and video clips.
Drop in an MP3 (and optionally paste the lyrics), and it builds a finished music video
from your library or tells you exactly what's missing.

## Where we stopped
- Nothing installed yet, no code written.
- Paused until the Claude API billing is sorted out (you need it for auto-tagging in Phase 1).

## Your Mac (checked 2026-10-28)
- Apple Silicon MacBook Air, macOS 27
- Has: Apple Command Line Tools, git, Python 3.9.6 (too old)
- Missing: Homebrew, Python 3.12, FFmpeg

## Setup steps (all free except #4)
1. Homebrew: free installer for developer tools  <- NEXT STEP
2. Python 3.12 (via Homebrew): free
3. FFmpeg (via Homebrew): free
4. Claude API key from console.anthropic.com: PAID per use (cents per image tagged)
5. Python libraries: free, the launch file installs them on its own

## The four phases (finish and test each before the next)
1. Media library: browser UI, drag-and-drop images (jpg/png/webp/heic) and clips (mp4/mov),
   SQLite, Claude vision auto-tags (subjects, setting, mood, colors, people/animals, objects,
   season, time of day, orientation, one-sentence description; sampled frames + length for video),
   search/browse/edit/delete, skip duplicates, tag only once, API key in .env.
2. Song analysis: local faster-whisper with word timestamps, align pasted lyrics (no section labels),
   scenes per lyric line plus instrumentals with start/end times and an ideal-visual description.
3. Matching + gap report: best library match per scene, no back-to-back reuse, storyboard with swap,
   gap list with ready-to-use AI image prompts, upload straight into a scene.
4. Video assembly (FFmpeg): every image always pans or zooms, crossfades synced to lyrics,
   YouTube-thumbnail-style title card, CTA end card "Get your own custom song at customsongme.com",
   9:16 and 16:9 with smart crop, high-quality MP4 into an exports folder.

## Requirements
Python backend, runs fully on the MacBook, one-click launch, plain-English errors, short README.
Don't keep the project in Google Drive (syncing can damage the SQLite database). Use something like ~/Documents.

## Media collected so far
- Created ~/Documents/Song Video Library/Images To Review (renamed from Inbox) on 2026-10-28. Export photos and clips there from the Photos app
  (File > Export > Export Unmodified Original). Phase 1 should import from this folder.
- Broad occasion subfolders (e.g. Weddings, Birthdays) are welcome: Phase 1 must read the folder name as a tag.
