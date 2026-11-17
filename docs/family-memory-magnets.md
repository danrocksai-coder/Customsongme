# Family Memory Magnets — setup and status

Sub-site: `/family-memory-magnets/` (sales page + order form), `/s/` (story app), `/admin/`, `/q/` (public QR page), `/thanks/`.
API: `netlify/functions/fmm.mjs` (`/api/fmm/*`). Logic + tests: `netlify/lib/fmm-core.mjs`, `tests/fmm.test.mjs`. Questions: `netlify/lib/fmm-questions.mjs` (draft v0.1, 90 questions).

## One-time setup in Netlify (Site settings > Environment variables)
| Name | Value |
|---|---|
| `FMM_SECRET` | a long random string (signs media links and admin sessions) |
| `FMM_ADMIN_PASSWORD` | the admin login password |
| `STRIPE_SECRET_KEY` | already set for the rest of the site |

Without the first two the API fails closed (503). Never put these in the code.

## Selling
- Prices live on the server in `netlify/functions/pay.mjs` (`fmm1` = $99.99, `fmm2` = $179.99).
- Order form -> `/api/fmm/order` (stored + emailed to the existing Formspree inbox) -> Stripe Checkout.
- After payment arrives: Admin > Orders > "Create story" > send the parent the two private links.

## Storage
Recordings and story data are in private Netlify Blobs (store `fmm`). No public links; audio is served through short-lived signed URLs (5 min).
"Finish & delete recordings" in Admin permanently removes a story, its audio, tokens and QR mapping.

## Tests
`npm test` (38 server-rule tests, including a legacy-story compatibility fixture).

## Known limits (v1)
- One story file per story, no record locking: fine for two people per story; not for high volume.
- Audio only, up to ~4 MB per recording (Netlify function limit).
- The family movie, magnet and storybook are produced by hand from the saved recordings.
- Android (webm) recordings played on very old iPhones may not play; iPhones record mp4/aac.

## v2 additions (this branch)
- Limits: question 15 s, answer 60 s, Little Hello voice 15 s (server allows ~3 s timing slack). No answer-extension button.
- **Write It First**: optional teleprompter for BOTH roles. Notes are saved server-side for the author only (never shown to the other person, never in the movie/storybook), survive refresh, and are deleted once the recording is saved. A session-only (tab) backup is used; nothing is kept in long-term phone storage.
- **Little Hellos**: offered to the person who is waiting after 48 h without conversation activity; two rotating suggested texts (sweet / playful) or a 15 s voice hello; one per participant per 48 h; never counts toward the 30, never unlocks anything; admin can disable, pick a style, or add approved custom messages. No SMS/email.
- **Two permanent QR codes** per story (child, grandparent). A QR code is a public identifier, not a credential. It opens a dashboard only on a phone that already holds a device session (earned by opening the private link once, plus the PIN if set) or after QR + PIN on a new phone. PINs (both roles, optional) are scrypt-hashed; 5 wrong tries lock out for 15 min, doubling up to 24 h.
- **Same QR after completion**: the dashboard turns into the keepsake view. It truthfully says "being prepared" until you mark real https deliverables ready in Admin.
- Admin: view/download each QR as SVG or PNG (encodes only the public address), set/clear PINs, forget remembered phones, Little Hello settings, keepsake links.
- Existing stories keep working with no migration; older stories get a second QR id added the first time Admin is opened (their existing code stays the child's).

## v3 additions: approved questions, retention, optional parent login
- **Questions are approved and locked** (`netlify/lib/fmm-questions.mjs`, version `approved-1.0`). A test fingerprints all 90, so any wording change fails until the fingerprint is updated on purpose.
- **Retention policy:** a story is open for 12 months from creation. When the 30th conversation is finished, access is extended to 12 months after completion (never shortened). The family sees the date. Deletion is manual: the parent can *ask* for deletion (Admin shows a red banner) and Dan deletes after delivering what is owed.
- **Optional parent/guardian login** (third credential): chosen at setup or added later in Admin. The purchaser decides, depending on the child's age. The parent can: give consent (child link can no longer do so once a parent login exists), pause/resume the child, control Little Hellos (on/off, style, own messages), listen to all recordings and hellos, see progress, and ask for deletion. The parent cannot record. Optional PIN and device sessions work as for the other roles.
- Admin: add/revoke the parent link, download any recording (m4a/webm).

## Known limits / decisions needed
- Without a parent login the parent uses the child's link (unchanged from v2).
- Rate-limit counters and story files are read-modify-write (fine for low volume).
- Real-device audio (iPhone Safari, Android Chrome) has not been tested.

## v4: parent-run by default, child's own link by parent choice
- The "child" link is now the **family recording link**: it is given to the parent, who records together with the child.
- **Child's own link** (optional, parent decides): from the family link (or the parent login, if the story has one).
  - 13+: the parent confirms age, then turns the link on.
  - Under 13: the parent prints `/family-memory-magnets/consent-form/`, signs it, uploads a photo or PDF. Admin shows "Consent form waiting for review" (and Formspree sends a notice). Approve or reject with a note. Approval does not turn the link on; the parent does.
  - The parent can turn the link off (link and devices die immediately), make a new link, or withdraw permission.
- API: `POST /api/fmm/child-access` (`action`: `teen` | `link` | `withdraw`), `POST /api/fmm/consent-form` (raw file, `X-Parent-Name`), admin `GET consent-form?id=`, `POST consent-review`.
- Privacy policy: `/family-memory-magnets/privacy/`. Legal pack and to-dos: `docs/fmm-legal/`.
- Admin flags stories past their keep-until date.
- 62 tests (`tests/fmm-v4.test.mjs` covers the new rules).

## v5: photos, publishing consent, activity log, self-hosted fonts
- **Family photos:** the parent (parent login or family link) and the grandparent can add up to 40 photos per story, with optional captions. The phone shrinks them to max 2400 px JPEG before upload. A child's own link can view but not add. The grandparent removes only their own; the parent can remove any. Private storage, 5-minute signed links, deleted with the story. Admin > Family photos: View / Download.
- **Publishing consent:** after all 30 conversations, the parent and the grandparent each choose "Keep it private" or "Share it with the magnet (unlisted YouTube)". Publishing is allowed only when both choose share. Either can change their answer; if a yes is taken back, Admin shows a red "take it down within 7 days" banner. The server refuses YouTube links in the keepsake until both have said share.
- **Admin activity log:** every admin view of a recording, photo or consent form, and every admin change, is logged on the story (Admin > Admin activity log, last 300).
- **Fonts** are served from `/family-memory-magnets/fonts/` (SIL OFL), with no requests to Google.
- Stripe receipts for these orders now read "Family Memory Magnets — …".
- 72 tests (`tests/fmm-v5.test.mjs` covers this release).

## v6: movie maker
- `tools/fmm-movie/fmm_movie.py` (see its README): `demo`, `list`, `fetch <story id>`, `render <kit>`. It runs on Dan's Mac with `~/.csm-video-tool/venv/bin/python`.
- New admin endpoint `GET /api/fmm/admin/movie-kit?id=`: story data plus 30-minute signed links. Each download is logged in the story's activity log.
- Output: a 1080p H.264/AAC MP4 (faststart), a thumbnail, and YouTube chapter times. Loudness is evened out per recording, and music ducks under voices. The output is checked automatically.
- Admin shows each story's ID for the movie maker.
- 73 tests.

## v7: grandparent consent
- On a real (non-test) story, the grandparent sees "Before you record" once: a short notice, their name and "I agree to be recorded for this family story." Until they agree, the server refuses their recordings (answers, intro, closing, voice hellos) and photos.
- Stored as `grandparentConsent` {name, version, at}. Admin shows "Grandparent agreed: yes/not yet". `POST /api/fmm/grandparent-consent`.
- It is separate from the parent's permission: a grandparent can never give the parent's consent.
- Existing stories: the grandparent agrees once before their next recording. Earlier recordings are kept.
- 77 tests.

## v8: magnet artwork (Printful 5" x 5" die-cut magnet)
- Admin > a story > "QR codes, PINs…" > each person's QR card > **Magnet artwork (5×5 in, Printful)** downloads `magnet-5x5in-300dpi-<name>-<code>.png`.
- 1500 x 1500 px, tagged 300 DPI, full bleed (Printful adds a white border unless the design fills the print area). Navy with a gold frame, "FAMILY MEMORY MAGNETS", the names, the QR code on a white card, "Scan to hear our family story". Everything important sits at least 0.3" inside the edge. Very long names wrap to two lines.
- The QR code encodes only the public `/q/?c=` address. It now uses error correction level Q (it still scans with some of the code scuffed). Existing codes keep working: the address is the same.
- Drawn in the browser (`family-memory-magnets/admin/magnet.js`); no server image tools needed.
- Checked: full-size and phone-distance scans decode to the right address.
- 79 tests.

## v9: cash payments, checkout switch, refund page
- **Paid outside Stripe:** Admin > Orders > "Mark paid (cash / other)" records method, note and date. The Create story form has "How was it paid?" (card, cash, other, free, or not paid/test) plus a note, and each story shows "Paid: …".
- **Checkout switch:** the sales page asks `/api/fmm/sales`. With `FMM_SALES_OPEN=true` in Netlify it shows the order form ("Start Our Story", then Stripe). Otherwise it shows the waiting list. The server enforces the same switch.
- **Preview the checkout any time:** `https://www.customsongme.com/family-memory-magnets/?preview=checkout#order`. It never submits or charges.
- **Refund policy page:** `/family-memory-magnets/refunds/`, linked from the order form and the footer. Still to be confirmed by the attorney review.
- Orders also record where the buyer came from (e.g. youtube / video).
- 80 tests.

## Sales switch (updated)
- Sales are **open by default**. To pause them, set `FMM_SALES_OPEN=false` in Netlify (Site settings > Environment variables), then redeploy. Delete it, or set it to `true`, to reopen.

## v10: three packages, no jump buttons
- **Packages:**
  - **One Grandparent:** $99.99 (`fmm1`), 30 conversations.
  - **Grandma & Grandpa Together:** $99.99 (`fmm3`). One shared story; the grandparents take turns (odd stops = first grandparent, even stops = second), 15 each. One movie and one magnet.
  - **Two Separate Stories:** $179.99 (`fmm2`). A full story with each grandparent.
- **Together stories:** `createStory({ grandparentName, grandparentName2 })` sets `grandparents: [a, b]` and `grandparentName: "a and b"`. `answererFor(story, n)` names who answers each stop. The app, movie kit and movie maker all use it (question cards, "Papa answers", "Papa's answer"). Both grandparents agree to be recorded on the consent screen.
- **Admin:** the Create story form has a "Second grandparent" field for Together. Two-separate-stories orders get one "Create story with …" button per grandparent, and the order tracks both stories.
- **Sales page:** no hero jump button; people scroll. Three package cards on the order form and the waiting list. A new FAQ explains Together vs Two Separate Stories.
- 84 tests.

## v11: four packages, grandparent profile, no deadline
| Package | Value | Stripe | Stops | Grandparents | Photos |
|---|---|---|---|---|---|
| Just the Two of Us | `one` | fmm1 $99.99 | 30 | 1 | 30 |
| Grandma & Grandpa Together | `together` | fmm3 $99.99 | 30 (15 each) | 2 | 30 |
| The Big Story | `big` | fmm4 $189.99 | 60 | 1 | 60 |
| The Big Story, Together | `bigtogether` | fmm5 $189.99 | 60 (30 each) | 2 | 60 |
- **60-stop stories** walk the 30 approved stops twice in a row (`baseIndex`, `defAt`, `choicesAt`). With one grandparent, the second visit hides the question used on the first. With two grandparents, they alternate (`answererFor`), so each gets every stop once.
- **Grandparent profile:** 20 optional multiple-choice questions (`netlify/lib/fmm-profile.mjs`), one profile per grandparent. Filled by the grandparent or the parent (not a child's own link). Included in the movie kit. Admin shows progress.
- **Photos:** one per conversation (`photoMax(story)` = 30 or 60).
- **No deadline:** `expiresAt` is null while recording. Finishing sets it to completion + 12 months (`isExpired` only applies to finished stories). The pace shown to families is about 6 months for 30 and about 1 year for 60. Admin flags an unfinished story with no activity for 2 years (contact the family before deleting).
- **Order form:** asks who's buying (parent / grandparent / someone else). When the buyer isn't the parent, the parent's name and email are required, because the parent always gives permission. Admin shows the buyer and the parent, and prefills the story with the parent's email and the package size.
- **Sales page:** hero, video, the 4 packages, the order form, 3-step "How it works", privacy, 5 FAQs. The 10-step list and the chapter list are gone.
- 92 tests.

## v12: sales page v3 (SEO, silhouettes, 4 steps, addresses, pace, FAQ)
- **Keyword positioning:** the gap is "the grandchild asks", which competitors (Storyworth, Remento, Storii) don't own. Title, description, H1 and FAQ target: gift for grandparents from grandkids, grandchild interviews grandparent, questions grandkids ask grandparents, long-distance grandparents, voice keepsake, QR magnet.
- **Page order:** hero → video → "Get to know the life they lived" + the 6 chapters → 4 package cards (silhouettes: one grandparent + child, or two + child; Big Story cards tinted) → "How to order" (4 steps) + what happens next (magnets ordered within 24 h; 2 QR codes emailed to print) → Your details (buyer controls; parent always gives permission) with both mailing addresses, child-recording setting and the waiver → suggested pace tables (30 = 1 chapter/month; 60 = 1 chapter per 2 months) → privacy → 14-question FAQ.
- **Structured data:** Product with 4 Offers, plus a FAQPage that mirrors the visible FAQ.
- **Orders** store `gpAddress`, `childAddress`, `childRecording` ('parent' | 'own') and `waiverAt`, and the server requires both addresses and the waiver. Admin shows them on each order.
- **Packages** now include two magnets (one per home). The privacy policy lists the addresses and Printful as a provider.

## v13: buyer login + set everything up on the order page
- **Buyer login (role `buyer`):** for when a grandparent or relative buys.
  - **Can:** fill in or edit the grandparent profiles, add photos, change Little Hello settings, follow progress, and ask for deletion.
  - **Cannot:** give permission, turn on the child's own link, pause the child, give the parent's publishing answer, or play the family's recordings (only progress and photos).
  - **Admin:** add, revoke and set a PIN on the buyer login. It's prefilled when the order's buyer isn't the parent.
- **Order page, step by step:**
  1. Your details.
  2. Your settings: how the child records, a parent settings link, Little Hellos, movie music, movie sharing.
  3. The profiles: the child's first name and age; each grandparent's name, plus optional prefilled answers to the 20 profile questions.
  4. Both magnet addresses.
  5. Sign the waiver and pay.
- **On the order and the story:** the order stores `settings`, `childAge` and `profiles`. When Dan creates the story from the order, the story starts with those choices (`story.prefs`, `helloSettings`, `profiles`), and the movie kit includes `prefs`.
- 97 tests.

## v14: watch page
- **Admin → story → Watch page:** paste the unlisted YouTube link and a backup MP4 link (any https link), then **Publish watch page**. Publishing is only possible once the story is finished and both the parent and the grandparent chose "share." **Unpublish now** takes it down at any time.
- **Both magnets** (`/q/?c=…`) then show a branded page: "<names>'s Family Story," a big play button (privacy-mode YouTube player), **Open in YouTube**, and "Trouble playing? Watch the backup copy." A connected family phone also sees "Open our private story."
- **If anyone changes their answer to private,** the watch page goes dark immediately. Admin still shows the red banner to take the video off YouTube.
- `GET /api/fmm/watch?c=` returns only `{ published, title, youtubeId, fallbackUrl }`, and nothing at all before publishing.
- 103 tests.

## v15: automatic emails + payment auto-check
- **Payment auto-check:** the thank-you page calls `GET /api/fmm/confirm?session_id=`. The server asks Stripe whether the Checkout Session is paid; if so, it marks the order paid ("$X by card") and sends the confirmation emails. It works now and needs no new keys.
- **Emails** (`netlify/lib/fmm-email.mjs` for the templates, `fmm-notify.mjs` for when to send), sent through Resend. They're **off until `RESEND_API_KEY` is set in Netlify**. Optional: `FMM_EMAIL_FROM`, `FMM_DAN_EMAIL`. Replies go to Dan.
  - Order paid → buyer (and parent) confirmation, plus a "new paid order" alert to Dan.
  - Story created (Admin "Email the private links…" box, on by default) → welcome emails with the links and both QR codes attached.
  - Grandparent answered → "your turn" to the parent. Chapter finished → milestone. Story finished → congratulations and the sharing question.
  - Consent form reviewed, watch page published, magnets shipped (new Admin button with tracking) → family emails.
  - **Daily job** (`netlify/functions/fmm-daily.mjs`, 15:00 UTC): a permission reminder after 3 days (weekly, at most 3), a gentle nudge after 7 quiet days (at most weekly), and Dan's morning to-do email (only when something needs him). Test stories and families with reminders switched off get none.
- **Admin:** an Emails card per story (recent emails and their status, a magnets-shipped button, a stop/restart reminders toggle).
- The privacy policy names Resend. 110 tests.
