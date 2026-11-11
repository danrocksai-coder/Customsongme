# Christmas Keepsake Upgrade: Plan (written 2026-11-04)

Add a printable lyric keepsake to every Christmas order and a return-customer discount
to the two top packages. Built on what already works: the four-tier prices tested on
Thanksgiving, the existing Stripe payment links, and the Formspree request form.
No new server, no new checkout.

Christmas goes up on the holiday page automatically on Fri, Nov 27 (the day after
Thanksgiving). Christmas order cutoff stays **Tue, Dec 22**.

## What the customer gets

| Package | Price | Song and video (same as Thanksgiving) | New for Christmas |
|---|---|---|---|
| MP3 | $25 | One downloadable MP3 | Keepsake PDF |
| Song + Video | $50 | Public YouTube video with AI artwork, cover art, lyric sheet | Keepsake PDF |
| Ultimate | $75 | Up to 10 of their own photos, public YouTube video + MP4 | Keepsake PDF + return-customer code |
| Ultimate Unlisted | $100 | Same as $75, YouTube video unlisted | Keepsake PDF + bigger return-customer code |

**The keepsake:** one 8.5 x 11 PDF per song. It has the song title and full lyrics around a
centered "CD" with the cover art, in CustomSongMe colors (royal blue #001a66 and yellow #fcd42a,
matching the thumbnails). QR codes:
- Center: plays the MP3 (Drive link from the order folder)
- Bottom left: the YouTube video ($50 and up); the CustomSongMe channel for $25
- Bottom right: customsongme.com, or the discount code page for $75 / $100

Customers print it themselves or keep it digital. No mailing.

**Left out on purpose** (from the draft page you pasted):
- Silver, platinum and gold finishes: an extra choice that doesn't help anyone pick.
- Unlimited lifetime discounts: a shared QR would mean half price forever for anyone.
- 2% off a second song: too small to notice.
- Private files for +$25: the $100 unlisted package already covers privacy.

## How the discount works (no backend needed)

Your Stripe links already accept promo codes. For each $75 / $100 order:
1. You create one Stripe promotion code for that customer (for example `ROSE20`).
   Limits: **3 uses, expires Dec 31, 2027.**
2. The keepsake QR opens `customsongme.com/holiday-songs?promo=ROSE20`.
3. A few lines of page code add the code to every Stripe button, so it's already filled in
   at checkout (Stripe's `prefilled_promo_code`). If someone shares the QR, the 3-use cap
   limits what it can cost you.

## Decisions (approved by Dan, 2026-11-04)

1. Discount size: **20% for $75, 25% for $100.**
2. Code limits: **3 uses, expires Dec 31, 2027.**
3. Keepsake on the $25 MP3 too: **yes.**
4. Christmas prices: **$25/$50/$75/$100, same tiers as Thanksgiving** (replacing $30/$50/$75).
5. Sample to show on the page: **"One More Thing Before We Eat" with demo lyrics** (Dan OK'd the demo, Nov 4), replaced by your
   first public Christmas song.

## Steps and dates

| When | Step | Who |
|---|---|---|
| Nov 5–8 | Answer the 5 decisions above | Dan |
| Nov 6–12 ✅ done Nov 4 | Build a keepsake generator: drop in title, lyrics, cover art and links, get a print-ready PDF with working QR codes. Make the sample PDF. | Claude |
| Nov 9–14 | In Stripe, duplicate the Thanksgiving links into 4 Christmas links (Payment links → ⋯ → Duplicate, rename for Christmas). Make one 100%-off single-use test code. | Dan (the SOP says AIs never change Stripe) |
| Nov 12–20 | On a branch: Christmas four tiers on the holiday page, "See sample" buttons, promo pass-through code, FAQ and Google structured data prices updated. Netlify preview. | Claude |
| Nov 20–24 | Test: scan every QR from a signed-out phone, check a promo link fills in at Stripe, place a $0 order with the test code. | Dan + Claude |
| Nov 27, morning | Switch the page title, share previews, headline and quick answer from Thanksgiving back to Christmas (PR #20 put Thanksgiving first). Merge (after Thanksgiving, so the Thanksgiving box and prices aren't touched before then). Check the live site, ask Google and Bing to recrawl. | Claude, after your OK |
| Nov 27 | Add a keepsake step to the Operator Playbook: make the PDF after final delivery, plus the promo code for $75 / $100. | Dan (Claude drafts the text) |

## How we'll know it worked

After Christmas, compare by package: how many orders each tier got and the average order,
plus how many return codes get used by spring. Stripe already sends buyers to
`/thanks?value=`, but the thanks page only logs a visit, not the amount. Part of the
Nov 12–20 page work: have it record a Google Analytics purchase with that value, so the
tier mix shows up in Analytics.

## Not decided yet (later, not for Christmas)
- Mailing printed cardstock copies, and what to charge.
- Using the keepsake on other pages (birthday, anniversary).
