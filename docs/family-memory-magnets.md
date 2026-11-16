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
`npm test` (19 server-rule tests). Browser walkthrough: Devon/Mimi role test described in the PR.

## Known limits (v1)
- One story file per story, no record locking: fine for two people per story; not for high volume.
- Audio only, up to ~4 MB per recording (Netlify function limit).
- The family movie, magnet and storybook are produced by hand from the saved recordings.
- Android (webm) recordings played on very old iPhones may not play; iPhones record mp4/aac.
