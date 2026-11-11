# Spanish Pages (ES) Implementation Plan

> **For agentic workers:** This plan is for a single-session static-content task (no test suite exists in this repo). Execution method: **Native** — implemented directly in the same session that wrote this plan, with manual verification steps in place of automated tests. There is no subagent handoff.

**Goal:** Add three Spanish pages (`/es/`, `/es/canciones-de-quinceanera/`, `/es/gracias/`) to CustomSongMe without touching any existing English URL, title tag, or meta description.

**Architecture:** This is a flat static HTML site (Netlify-hosted, no build step, no shared templates — every page duplicates its own `<style>` block and JS). The Spanish pages follow the exact same pattern: copy the matching English page's structure 1:1 (CSS untouched, same classes, same JS logic, same Stripe/PayPal/CashApp/Venmo links, same Formspree endpoint), translate the visible copy, and add `language=es` (+ `occasion=quinceañera` on the quinceañera page) as additional hidden form fields. New folders (`es/`, `es/canciones-de-quinceanera/`, `es/gracias/`) each hold an `index.html`, so Netlify serves them at the clean trailing-slash URL automatically — no `_redirects` changes needed.

**Tech Stack:** Plain HTML/CSS/JS, Formspree (form backend), Stripe Payment Links, GA4 (gtag.js), schema.org JSON-LD.

**Spec:** User-supplied spec (pasted in conversation, 2026-10-03) — full text preserved in conversation history. Source pages read in full before writing this plan: `index.html`, `birthday-songs.html`, `thanks.html`, `sitemap.xml`, `_headers`, `_redirects`.

## Global Constraints

- Do not change any existing English URL, `<title>`, or `<meta name="description">`. Only additive changes to existing files (hreflang `<link>` tags in `<head>`, a language-switcher element in `<nav>`), plus three brand-new files.
- Packages/prices/links are identical across languages: Complete (Público) $50 — default/recommended, Complete (No listado) $75 — revealed only via the unlisted toggle, Solo MP3 $30. Stripe links: `https://buy.stripe.com/3cIaEWcLKb09cS7fcy9Ve0f` ($50), `https://buy.stripe.com/8x2fZgh20fgp8BRc0m9Ve0h` ($75), `https://buy.stripe.com/cNieVc2767NX3hxd4q9Ve06` ($30). PayPal `https://www.paypal.me/DanRock834/{50,75,30}`, Cash App `https://cash.app/$optimistic01/{50,75,30}`, Venmo `https://venmo.com/u/Dan-Rock-5` (no amount suffix).
- Formspree endpoint for every new page's form: `https://formspree.io/f/xwpqlypv` (same as all existing forms).
- **JS-keyed values stay byte-identical English strings** — do not translate these, only the visible label text next to them: the `package-tier` radio `value`s (`complete`, `mp3`), the `payment-method` radio `value`s (`Card (Stripe)`, `PayPal`, `Cash App`, `Venmo`), and the `package-hidden-field` default value / `PAYMENT_LINKS` object keys (`Complete (Public) — $50`, `Complete (Unlisted) — $75`, `MP3 Only — $30`). The JS in every page does exact string lookups against these; translating them breaks the payment-link routing silently.
- Every new form gets one extra hidden field: `<input type="hidden" name="language" value="es" />`. The quinceañera page additionally gets `<input type="hidden" name="occasion" value="Quinceañera" />` (fixed, like `birthday-songs.html`'s `occasion` field) instead of a user-selectable occasion dropdown.
- Verbatim customer review quotes (text in quotation marks attributed to a named reviewer, e.g. "My husband cried like a baby!!" — S.H.) stay in their original English wording on the Spanish homepage — translating a direct quote would misrepresent what the customer actually said. Everything else (labels, questions, CTAs, FAQ, schema) is translated.
- Brand/proper nouns stay as-is: `CustomSongMe`, `Dan the Song Man` (kept as the English nickname inside Spanish copy — common in bilingual branding, reads natural rather than forced), `Stripe`, `PayPal`, `Cash App`, `Venmo`.
- "Personal Happiness Guarantee" → "Garantía de Felicidad Personal" everywhere on the Spanish pages.
- Voice: first-person singular ("yo/mi/me"), "tú" form, natural Mexican-American Spanish. Never claim Dan is a native Spanish speaker — frame it as "tu canción, escrita en español."
- GA4 tag is identical on every new page: `G-HGQ54E69BZ` (same snippet already on all English pages).
- Reuse binary/base64 image data (the two inline `package-art` base64 images in the homepage) and external image URLs (`dan-the-song-man.jpg`, `/img/customsongme-icon.png`) byte-for-byte — these are not translatable content.
- No new folder needs an `_redirects` entry: Netlify serves `index.html` for a directory request automatically, unlike the flat top-level pages (`/birthday-songs` etc.) which need an explicit rewrite because they have no directory.
- `lang="es"` on the `<html>` tag of all three new pages (vs. `lang="en"` on existing pages).

## Review Focus

- **Price/link drift**: a typo in a Stripe/PayPal/CashApp/Venmo URL or price silently breaks checkout for Spanish customers — Task 5 includes a byte-for-byte diff check against the English source values.
- **JS value mistranslation**: translating a `payment-method` or `package-tier` radio `value` (instead of just its label) silently breaks `PAYMENT_LINKS` lookup — Task 2 and 3 explicitly call this out and Task 5 greps for the exact required English value strings.
- **FAQ schema/page mismatch**: JSON-LD FAQPage text must match the visible FAQ accordion text exactly, or Google Search Console will flag it — Task 2/3 write both from the same translated copy, Task 5 spot-checks pairing.
- **Double-submit / redirect regression**: copying the JS block wrong (e.g. wrong form selector) could silently break the submit→Stripe redirect — Task 5 manually submits each new form in a browser against a live preview before sign-off.
- **Dead/wrong language-switcher links**: the quinceañera page has no English counterpart, so its switcher's "English" link must point somewhere real (the English homepage), not a 404 — covered explicitly in Task 3.

---

## File Structure

- Create `es/index.html` — Spanish homepage, full translation of `index.html`.
- Create `es/canciones-de-quinceanera/index.html` — new Spanish-only occasion page, structured like `birthday-songs.html`.
- Create `es/gracias/index.html` — Spanish translation of `thanks.html`.
- Modify `index.html` — add hreflang `<link>` tags + language-switcher markup/CSS in `<nav>`. No other change.
- Modify `sitemap.xml` — add `/es/` and `/es/canciones-de-quinceanera/` entries (not `/es/gracias/`, matching the existing pattern where noindex utility pages like `/thanks` are excluded from the sitemap).
- Modify `_headers` — add `X-Robots-Tag: noindex, nofollow` + `Cache-Control: no-cache` rules for `/es/gracias` and `/es/gracias/`, mirroring the existing `/thanks` rule.

## Task 1: Language-switcher + hreflang on the English homepage

**Files:** Modify `index.html` (head `<link>` tags around line 15; `<style>` block around line 275-310 for `.nav-inner`/`.nav-cta`; `<nav>` markup around line 1613-1618).

- [ ] Add to `<head>`, right after the existing `<link rel="canonical" .../>` (line 15):
```html
<link rel="alternate" hreflang="en" href="https://www.customsongme.com/" />
<link rel="alternate" hreflang="es" href="https://www.customsongme.com/es/" />
<link rel="alternate" hreflang="x-default" href="https://www.customsongme.com/" />
```
- [ ] In the `<style>` block, immediately after the existing `.nav-cta:hover { background: var(--gold-light); }` rule, add:
```css
.nav-right { display: flex; align-items: center; gap: 16px; }
.nav-lang { display: flex; align-items: center; gap: 6px; font-size: 0.78rem; }
.nav-lang a { color: rgba(255,255,255,0.55); text-decoration: none; }
.nav-lang a:hover { color: var(--gold-light); }
.nav-lang .current { color: var(--gold); font-weight: 600; }
.nav-lang .sep { color: rgba(255,255,255,0.25); }
```
- [ ] In `<nav>`, wrap the existing `.nav-cta` link together with a new `.nav-lang` switcher in a `.nav-right` div:
```html
<nav>
  <div class="nav-inner">
    <a href="/" class="nav-logo"><img src="/img/customsongme-icon.png" alt="" class="nav-logo-icon" />CustomSongMe</a>
    <div class="nav-right">
      <div class="nav-lang"><span class="current">English</span><span class="sep">|</span><a href="/es/">Español</a></div>
      <a href="#order-form" class="nav-cta">🎁 Start My Song</a>
    </div>
  </div>
</nav>
```
- [ ] Verify: `grep -c 'hreflang' index.html` returns 3; open the page locally and confirm the nav still shows the logo on the left and the CTA button on the right, now with "English | Español" beside it, and the layout doesn't wrap/break at mobile width (375px).

## Task 2: Spanish homepage (`es/index.html`)

**Files:** Create `es/index.html` (full translation of `index.html`, same CSS/JS, `lang="es"`).

- [ ] Copy `index.html` to `es/index.html` as the starting point.
- [ ] Update `<head>`: `<html lang="es">`; translate `<title>` to something like `Canciones Personalizadas para Cualquier Ocasión | CustomSongMe`; translate `<meta name="description">`, `og:title`, `og:description`; set `og:url` and `<link rel="canonical">` to `https://www.customsongme.com/es/`; keep `og:image` unchanged (`https://www.customsongme.com/img/customsongme-icon.png`).
- [ ] Add hreflang tags (self-referencing es + en + x-default), mirroring Task 1:
```html
<link rel="alternate" hreflang="en" href="https://www.customsongme.com/" />
<link rel="alternate" hreflang="es" href="https://www.customsongme.com/es/" />
<link rel="alternate" hreflang="x-default" href="https://www.customsongme.com/" />
```
- [ ] Translate both JSON-LD blocks (`OnlineBusiness` + `FAQPage`) into Spanish, add `"inLanguage": "es"` to the `OnlineBusiness` object, and make sure every translated FAQ question/answer in the schema matches the translated on-page FAQ accordion text exactly, word for word.
- [ ] Translate all visible copy throughout the body (nav CTA, hero, trust bar, video section, pricing intro, both package cards, real-stories section, samples section labels, how-it-works steps, the entire order form's labels/placeholders/options — except the JS-keyed `value`s per Global Constraints — guarantee section, tip jar, reviews section labels (quotes stay in English), why-dan section, FAQ, occasions grid link labels (hrefs stay pointing at the existing English occasion pages, since no Spanish occasion pages exist for those besides quinceañera — add one extra link `<a href="/es/canciones-de-quinceanera/" class="occasion-link"><span class="em">👑</span>Canciones de Quinceañera</a>` into the occasions grid), rescue-dog teaser, copyright notice, social links, and footer nav.
- [ ] Add the hidden `language` field to the form: `<input type="hidden" name="language" value="es" />` next to the existing hidden `_next`/`package` fields.
- [ ] Add the same language-switcher markup as Task 1, mirrored (current = Español, link = `/` labeled English):
```html
<div class="nav-lang"><a href="/">English</a><span class="sep">|</span><span class="current">Español</span></div>
```
- [ ] Verify: `python3 -c "import re,json,sys; s=open('es/index.html').read(); [json.loads(m) for m in re.findall(r'<script type=\"application/ld\\+json\">(.*?)</script>', s, re.S)]"` parses without error (confirms both JSON-LD blocks are valid JSON). `grep -c 'language" value="es"' es/index.html` returns 1. `grep -o "buy.stripe.com/[A-Za-z0-9]*" es/index.html | sort -u` returns exactly the same 3 Stripe link IDs as `grep -o "buy.stripe.com/[A-Za-z0-9]*" index.html | sort -u`.

## Task 3: Spanish quinceañera page (`es/canciones-de-quinceanera/index.html`)

**Files:** Create `es/canciones-de-quinceanera/index.html` (structured like `birthday-songs.html`: same CSS, same JS, `lang="es"`, fixed `occasion` hidden field instead of a dropdown).

- [ ] Use `birthday-songs.html` as the structural template (hero → trust-bar → pricing-intro → package → how-it-works → order-form → guarantee → reviews → why-dan → faq → occasions → copyright-notice → footer → script), but write original Spanish copy about quinceañera songs (padrinos, familia, el vals, la ceremonia, cumplir quince años) — not a translation of an existing English page, since none exists.
- [ ] `<head>`: `lang="es"`, title targeting "canción personalizada para quinceañera" (e.g. `Canción Personalizada para Quinceañera | CustomSongMe`), meta description targeting "canción para quinceañera" / "canción personalizada", `og:url`/canonical = `https://www.customsongme.com/es/canciones-de-quinceanera/`, `og:image` = `https://www.customsongme.com/dan-the-song-man.jpg` (same pattern as `birthday-songs.html`).
- [ ] Add **only** a self-referencing hreflang tag (no English counterpart exists):
```html
<link rel="alternate" hreflang="es" href="https://www.customsongme.com/es/canciones-de-quinceanera/" />
```
- [ ] Write a `Product` JSON-LD block (mirroring `birthday-songs.html`'s structure) with `"inLanguage": "es"` and the same three offers/prices, plus a `FAQPage` JSON-LD block whose Q&A matches the on-page FAQ accordion exactly.
- [ ] Form: same package-tier/payment-method/fields pattern as `birthday-songs.html`, with `<input type="hidden" name="occasion" value="Quinceañera" />` and `<input type="hidden" name="language" value="es" />` both fixed (no occasion dropdown — mirrors how `birthday-songs.html` fixes `occasion` to `"Birthday"`). Add a quinceañera-relevant field in place of birthday's "milestone" field, e.g. `pronunciation`/`padrinos` detail, keeping the same `name`/`required` pattern as other occasion-page fields.
- [ ] Language switcher: since there's no Spanish→English equivalent page, point "English" at the English homepage, not a 404:
```html
<div class="nav-lang"><a href="/">English</a><span class="sep">|</span><span class="current">Español</span></div>
```
- [ ] Occasions grid at the bottom: link to the existing English occasion pages (same hrefs as `birthday-songs.html`'s grid) plus the Spanish homepage, since there are no other Spanish occasion pages to link to yet.
- [ ] Verify: same JSON-LD/Stripe-link checks as Task 2's verify step, run against this file; manually confirm in a preview that selecting MP3/Complete + each payment method updates the hidden `_next` field correctly (open devtools, inspect `#next-redirect` value after each radio change).

## Task 4: Spanish thank-you page (`es/gracias/index.html`)

**Files:** Create `es/gracias/index.html` (translation of `thanks.html`, same CSS, no nav/header — `thanks.html` has none, so no language switcher here either).

- [ ] Copy `thanks.html` to `es/gracias/index.html`.
- [ ] `<html lang="es" style="background-color:#0a0a0a;">`; translate `<title>` (e.g. `Pago Confirmado | CustomSongMe`), `<meta name="description">`; keep `<meta name="robots" content="noindex">`; canonical → `https://www.customsongme.com/es/gracias/`.
- [ ] Translate all visible copy: heading, confirmation paragraph, "What Happens Next" list, studio-hours badge, "Personal Happiness Guarantee" → "Garantía de Felicidad Personal" paragraph, back-to-site button (href stays `https://www.customsongme.com/es/` — link to the Spanish homepage, not the English one, since this is the Spanish flow), and the "Questions? Text Dan" contact line.
- [ ] Keep the GA4 snippet byte-identical.
- [ ] Verify: `diff <(grep -oE '(sms|tel):\+[0-9]+' thanks.html) <(grep -oE '(sms|tel):\+[0-9]+' es/gracias/index.html)` shows no differences (phone number/contact links unchanged).

## Task 5: Sitemap, headers, and final cross-file verification

**Files:** Modify `sitemap.xml`, modify `_headers`.

- [ ] In `sitemap.xml`, add two new `<url>` entries (after the homepage entry, before the occasion pages) for `/es/` (priority 1.0, matching the English homepage) and `/es/canciones-de-quinceanera/` (priority 0.8, matching other occasion pages). Do not add `/es/gracias/` (noindex, matches the existing exclusion of `/thanks` etc.).
- [ ] In `_headers`, add, mirroring the existing `/thanks` block:
```
/es/gracias
  X-Robots-Tag: noindex, nofollow
  Cache-Control: no-cache

/es/gracias/
  X-Robots-Tag: noindex, nofollow
  Cache-Control: no-cache
```
- [ ] Final verification pass:
  - `python3 -c "import xml.dom.minidom as m; m.parse('sitemap.xml')"` parses without error.
  - `grep -L 'G-HGQ54E69BZ' index.html es/index.html es/canciones-de-quinceanera/index.html es/gracias/index.html` prints nothing (GA4 present on every page).
  - `grep -rn 'value="complete"\|value="mp3"\|value="Card (Stripe)"\|value="PayPal"\|value="Cash App"\|value="Venmo"' es/index.html es/canciones-de-quinceanera/index.html` confirms the JS-keyed English values survived untranslated in both new order forms.
  - Confirm no existing English file's `<title>`, `<meta name="description">`, or URL changed: `git diff --stat` should show only `index.html`, `sitemap.xml`, `_headers` modified (plus the 3 new files), and `git diff index.html` should show only the hreflang `<link>` block, the `.nav-*` CSS addition, and the `<nav>` markup change — nothing else.
  - Present the full file-by-file summary to the user and wait for explicit approval before `git add`/`git commit`/`git push`.
