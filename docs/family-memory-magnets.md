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
