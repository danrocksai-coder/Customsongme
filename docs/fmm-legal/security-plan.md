# Written Information Security Program: Family Memory Magnets

Owner: Dan Rock (security coordinator). Version 1, November 17, 2026. Review at least once a year and after any incident.

## 1. What we protect
Voice recordings (children, parents, grandparents), names used in stories, parent email/phone, consent records, uploaded consent forms, private notes, link tokens and PINs.

## 2. Where it lives
- Recordings, consent forms and story data: Netlify Blobs, private store `fmm`. Never at a public URL.
- Order and form notices: Formspree inbox (no recordings, no consent forms).
- Payments: Stripe (we never see card numbers).

## 3. Safeguards in place
- **Access:** private random links (stored only as SHA-256 hashes), optional PIN (scrypt-hashed, lockout after 5 wrong tries, doubling up to 24 h). Device sessions are revocable per role. The QR code is a public identifier, never a credential.
- **Authorization on the server** for every action (role checks; a child's own link cannot manage consent or access).
- **Media:** served only through HMAC-signed links that expire after 5 minutes.
- **Admin:** password in Netlify environment variables only; 12-hour signed sessions.
- **Secrets** (`FMM_SECRET`, `FMM_ADMIN_PASSWORD`, `STRIPE_SECRET_KEY`): Netlify environment variables only, never in code or chat.
- **Tests:** `npm test` checks the access rules on every change.

## 4. People
Only Dan has admin access. Do not share the admin password. Listen to private recordings only to make the keepsake or fix a reported problem.

## 5. Gaps to close before real families
- [ ] Independent automatic backups (for example Backblaze B2), plus one test restore.
- [ ] Admin access log (who opened which recording or form, when).
- [ ] Turn on two-factor authentication for Netlify, GitHub, Stripe and the email account.
- [ ] Use a long, unique admin password stored in a password manager.

## 6. If something goes wrong
1. Revoke affected links/devices in Admin; rotate `FMM_SECRET` and the admin password if needed.
2. Write down what happened, when, and what data was involved.
3. Notify affected families promptly and follow any state breach-notice law that applies.
4. Fix the cause and update this plan.
