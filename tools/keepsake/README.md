# Keepsake maker

Turns one finished song into a printable 8.5 x 11 keepsake PDF: title, lyrics, the cover
art as a "CD" whose center QR plays the MP3, and two QR codes at the bottom (video or
channel on the left; the site, or the customer's discount code for $75 / $100, on the right).

## Make one
1. Make a folder for the order with `lyrics.txt`, the cover art, and an `order.json`
   (copy `sample/order.json` and change the values).
2. Run, from this folder:

   ```bash
   .venv/bin/python make_keepsake.py path/to/order.json
   ```
3. The PDF lands in `out/` (or wherever `output` says). Open it, then scan every QR code
   from a phone that isn't signed in to Google before sending.

The script stops with a plain message if something's missing (no YouTube link on a $50+
order, no promo code on $75 / $100) or if the lyrics can't fit on one page at a readable size.

## Rules
- Keep customer files out of the website repo's published folders. `out/` is ignored by git;
  don't upload anything from `tools/` to GitHub with customer details in it.
- Discounts: $75 = 20%, $100 = 25%. Create the customer's code in Stripe first
  (3 uses, expires Dec 31, 2027). The code's QR opens `holiday-songs?promo=CODE`; that
  only fills in the code once the holiday page change from the Christmas plan is live.
- The sample uses demo lyrics written for testing, not the real song's lyrics.

## Setup (already done on Dan's Mac)
```bash
python3 -m venv .venv && .venv/bin/pip install segno
```
Needs Google Chrome in /Applications.
