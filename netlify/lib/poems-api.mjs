// CustomSongMe Love Poems — every API route, written against injected parts (store, Stripe key, AI, QR)
// so the whole customer journey can be tested without Netlify. netlify/functions/poems.mjs wires it up.

import * as P from './poems-core.mjs';
import { buildPoemPdf } from './poems-pdf.mjs';
import * as AI from './poems-ai.mjs';
import * as E from './poems-email.mjs';

const SITE = 'https://www.customsongme.com';
const HOUR = 3600e3, DAY = 24 * HOUR;

const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', ...extra },
});
const fail = (status, error, extra) => json({ error, ...(extra || {}) }, status);

// ---------- small helpers that need the store ----------
async function bump(store, key, limit, windowMs, now) {
  const r = (await store.getJSON(key)) || { n: 0, start: now };
  if (now - r.start > windowMs) { r.n = 0; r.start = now; }
  if (r.n >= limit) return false;
  r.n += 1; r.exp = r.start + windowMs; await store.setJSON(key, r); return true;
}
const today = (now) => new Date(now).toISOString().slice(0, 10);
async function aiAllowed(d) {
  const day = today(d.now());
  if (!(await bump(d.store, `rl/ai-h/${d.ipHash}`, 12, HOUR, d.now()))) return 'You have written a lot of poems in the last hour. Please try again a little later.';
  if (!(await bump(d.store, `rl/ai-d/${d.ipHash}`, 30, DAY, d.now()))) return 'You have reached today\'s limit for writing poems. Please come back tomorrow.';
  const cap = Number(d.env.POEMS_AI_DAILY_CAP || 250);
  if (!(await bump(d.store, `rl/ai-g/${day}`, cap, DAY, d.now()))) return 'The poem writer is very busy today. Please try again tomorrow, or text Dan at (661) 714-0903.';
  return null;
}
async function logAi(d, kind, results) {
  const key = `stats/ai/${today(d.now())}`; const s = (await d.store.getJSON(key)) || { calls: 0, ok: 0, input: 0, output: 0, generate: 0, revise: 0, models: {} };
  for (const r of results) {
    s.calls += 1; if (r.ok) s.ok += 1;
    s.input += r.usage?.input_tokens || 0; s.output += r.usage?.output_tokens || 0;
    if (r.model) s.models[r.model] = (s.models[r.model] || 0) + 1;
  }
  s[kind] += 1; await d.store.setJSON(key, s);
}

async function loadDraft(d, id, token) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{8,40}$/.test(id)) return [null, fail(404, 'Order not found.')];
  const o = await d.store.getJSON(`order/${id}`);
  if (!o) return [null, fail(404, 'This order was not found. It may have expired; please start a new poem.')];
  if (!P.sameHash(token, o.editHash)) return [null, fail(401, 'This page lost its connection to your order. Please start a new poem.')];
  return [o, null];
}
async function loadGift(d, t) {
  if (typeof t !== 'string' || t.length < 16 || t.length > 100) return [null, fail(404, 'Gift not found.')];
  const ref = await d.store.getJSON(`gift/${P.sha256(t)}`);
  const o = ref && (await d.store.getJSON(`order/${ref.order}`));
  if (!o || !o.paid) return [null, fail(404, 'Gift not found.')];
  return [o, null];
}
const save = (d, o) => { o.updatedAt = d.now(); return d.store.setJSON(`order/${o.id}`, o); };
const view = (o) => ({ order: P.draftView(o), questions: P.questions(o.about || {}) });

// Which Stripe key this copy of the site may use. A test copy can never charge a real card, and the live site never uses a test key.
export function stripeKey(d) {
  const key = d.isLive ? d.env.STRIPE_SECRET_KEY : d.env.POEMS_TEST_STRIPE_SECRET_KEY;
  if (!key) return { error: d.isLive ? 'Card payments are not set up yet.' : 'Test payments are not set up in this preview yet (POEMS_TEST_STRIPE_SECRET_KEY is missing).' };
  if (d.isLive && /_test_/.test(key)) return { error: 'The live site has a test Stripe key. Payments are paused.' };
  if (!d.isLive && /_live_/.test(key)) return { error: 'This preview has a LIVE Stripe key. Test payments are refused so no real card is charged.' };
  return { key };
}
async function stripe(d, method, path, key, params) {
  const r = await d.fetch(`https://api.stripe.com/v1/${path}`, {
    method, headers: { Authorization: `Bearer ${key}`, ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: params ? new URLSearchParams(params) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data: j };
}

async function renderPdf(d, o, { watermark, qr }) {
  const photo = o.photo ? await d.store.getBlob(`photo/${o.id}`) : null;
  return buildPoemPdf(o, { watermark, qr, voice: !!P.PACKAGES[o.pkg]?.voice, photoJpg: photo?.data, siteLabel: 'customsongme.com/love-poems' });
}
const listenUrl = (d, o) => `${d.isLive ? SITE : d.origin}/lp/${o.delivery.listenId}`;
const giftUrl = (d, o) => `${d.isLive ? SITE : d.origin}/love-poems/gift/?t=${o.delivery.giftToken}`;
const slug = (s) => String(s || 'love-poem').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'love-poem';

// ---------- fulfilment: runs from the thank-you page AND the Stripe webhook; safe to run twice ----------
export async function fulfill(d, o, session) {
  if (session.metadata?.poem_order !== o.id || session.payment_status !== 'paid') return { ok: false, error: 'not paid' };
  if (!o.paid) {
    o.paid = { at: d.now(), session: String(session.id).slice(0, 80), amount: session.amount_total ?? null, tax: session.total_details?.amount_tax ?? null, currency: session.currency || 'usd', livemode: !!session.livemode };
    o.email = P.validEmail(session.customer_details?.email || '') ? session.customer_details.email : o.email;
    o.status = 'paid';
  }
  if (!o.delivery) {
    o.delivery = { giftToken: P.newId(24), listenId: P.newId(12) };
    await d.store.setJSON(`gift/${P.sha256(o.delivery.giftToken)}`, { order: o.id });
    await d.store.setJSON(`listen/${o.delivery.listenId}`, { order: o.id });
  }
  await save(d, o);

  if (!o.delivery.pdfAt) {
    const qr = P.PACKAGES[o.pkg]?.voice ? d.qr(listenUrl(d, o)) : null;
    const pdf = await renderPdf(d, o, { watermark: false, qr });
    if (!pdf.fits) { await E.send({ to: E.DAN(), ...E.T.danProblem(o, 'A paid love poem did not fit on one page. Please fix and send by hand.') }, d.fetch); return { ok: false, error: 'pdf' }; }
    await d.store.setBlob(`pdf/${o.id}`, Buffer.from(pdf.bytes), { contentType: 'application/pdf' });
    o.delivery.pdfAt = d.now(); await save(d, o);
  }

  // only one request may send the emails, even if the webhook and the thank-you page arrive together
  if (!o.delivery.emailedAt && (await d.store.claim(`lock/email/${o.id}`, d.now()))) {
    const pdfBlob = await d.store.getBlob(`pdf/${o.id}`);
    const msg = E.T.delivered(o, giftUrl(d, o));
    const r = await E.send({ to: o.email, ...msg, attachments: [{ filename: `${slug(o.final.title)}.pdf`, content: pdfBlob.data.toString('base64') }] }, d.fetch);
    o.emailLog = [...(o.emailLog || []), { at: d.now(), kind: 'delivered', ok: !!r.ok, skipped: r.skipped ? r.reason : undefined }];
    if (r.ok || r.skipped) o.delivery.emailedAt = d.now();
    else await d.store.del(`lock/email/${o.id}`); // let the next try send it
    const amount = o.paid.amount != null ? `$${(o.paid.amount / 100).toFixed(2)}${o.paid.tax ? ` incl. $${(o.paid.tax / 100).toFixed(2)} tax` : ''}` : 'paid';
    await E.send({ to: E.DAN(), ...E.T.danNewOrder(o, giftUrl(d, o), amount) }, d.fetch);
    if (!r.ok && !r.skipped) await E.send({ to: E.DAN(), ...E.T.danProblem(o, `The delivery email to ${o.email} failed. The customer can still open their gift from the thank-you page.`) }, d.fetch);
    await save(d, o);
  }
  return { ok: true, giftUrl: giftUrl(d, o) };
}

// ---------- routes ----------
export async function handle(req, d) {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/poems\/?/, '').replace(/\/$/, '');
  const m = req.method;
  const token = req.headers.get('x-poem-token') || '';
  const body = async () => { try { return await req.json(); } catch { return {}; } };
  const bytes = async (max) => {
    const len = Number(req.headers.get('content-length') || 0); if (len > max) return null;
    const b = Buffer.from(await req.arrayBuffer()); return b.length > max ? null : b;
  };

  try {
    // ----- start a new order -----
    if (route === 'start' && m === 'POST') {
      const b = await body();
      if (b.website) return fail(400, 'Something went wrong.'); // honeypot: real people never fill this in
      if (!P.PACKAGES[b.pkg]) return fail(400, 'Please pick a package.');
      if (!(await bump(d.store, `rl/start/${d.ipHash}`, 15, HOUR, d.now()))) return fail(429, 'Too many new poems from this connection. Please try again in an hour.');
      const tok = P.newId(24);
      const o = { id: P.newId(12), editHash: P.sha256(tok), createdAt: d.now(), status: 'draft', pkg: b.pkg, test: !d.isLive, gens: 0, revisions: 0, template: 'cream', about: P.cleanAbout({}), answers: P.cleanAnswers({}), style: P.cleanStyle({}) };
      await save(d, o);
      return json({ token: tok, ...view(o) });
    }

    // ----- routes for an unpaid order (need the order's private token) -----
    const DRAFT = ['load', 'save', 'generate', 'revise', 'approve', 'photo', 'audio', 'draft-audio', 'preview-link', 'checkout'];
    if (DRAFT.includes(route)) {
      const id = url.searchParams.get('order') || '';
      const [o, err] = await loadDraft(d, id, token); if (err) return err;
      if (o.paid && route !== 'load') return fail(409, 'This poem is already paid for. Open your gift page from the email to see it.');

      if (route === 'load' && m === 'GET') return json(view(o));

      if (route === 'save' && m === 'POST') {
        const b = await body();
        if (b.pkg && P.PACKAGES[b.pkg]) o.pkg = b.pkg;
        if (b.about) o.about = P.cleanAbout(b.about);
        if (b.answers) o.answers = P.cleanAnswers(b.answers);
        if (b.style) o.style = P.cleanStyle(b.style);
        if (b.template && P.TEMPLATES[b.template]) o.template = b.template;
        if (typeof b.dedication === 'string') o.dedication = P.clean(b.dedication, P.LIMITS.dedicationMax);
        if (typeof b.email === 'string' && (b.email === '' || P.validEmail(b.email.trim()))) o.email = b.email.trim();
        if (Number.isInteger(b.chosen) && o.poems?.[b.chosen]) { o.chosen = b.chosen; o.final = { ...o.poems[b.chosen] }; o.approvedAt = null; }
        if (b.final) { const p = P.cleanPoem(b.final); if (p.title !== o.final?.title || p.text !== o.final?.text) { o.final = p; o.approvedAt = null; } }
        await save(d, o); return json(view(o));
      }

      if (route === 'generate' && m === 'POST') {
        const b = await body();
        const problems = P.readyToGenerate(o); if (problems.length) return fail(400, problems[0]);
        const fill = !!b.fill && Array.isArray(o.poems) && o.poems.some((x) => !x);
        if (!fill && (o.gens || 0) >= P.LIMITS.generations) return fail(429, 'You have used both sets of poems. Pick your favorite and edit it, or use an AI revision.');
        if (!AI.aiConfigured()) return fail(503, 'The poem writer is not switched on yet. Please text Dan at (661) 714-0903.');
        const limited = await aiAllowed(d); if (limited) return fail(429, limited);
        const want = fill ? o.poems.map((x, i) => (x ? null : i)).filter((i) => i !== null) : [0, 1, 2, 3];
        const results = await Promise.all(want.map((i) => d.ai.writePoem(P.generatePrompt(o, i))));
        await logAi(d, 'generate', results);
        if (!results.some((r) => r.ok)) return fail(502, 'The poem writer did not answer. Nothing was used up; please tap "Write my poems" again.');
        const poems = fill ? [...o.poems] : [null, null, null, null];
        want.forEach((i, k) => { poems[i] = results[k].ok ? results[k].poem : null; });
        o.poems = poems;
        if (!fill) { o.gens = (o.gens || 0) + 1; o.chosen = null; o.final = null; o.approvedAt = null; }
        o.status = 'generated'; await save(d, o);
        return json(view(o));
      }

      if (route === 'revise' && m === 'POST') {
        const b = await body();
        const instruction = P.clean(b.instruction, P.LIMITS.instructionMax);
        if (instruction.length < 4) return fail(400, 'Tell the poem writer what to change (for example: "make it more playful" or "mention our dog Max").');
        if ((o.revisions || 0) >= P.LIMITS.revisions) return fail(429, 'You have used both AI revisions. You can still edit the words yourself.');
        const current = P.cleanPoem(b.final || o.final || {});
        if (!current.text) return fail(400, 'Choose a poem first.');
        if (!AI.aiConfigured()) return fail(503, 'The poem writer is not switched on yet.');
        const limited = await aiAllowed(d); if (limited) return fail(429, limited);
        const r = await d.ai.writePoem(P.revisePrompt(o, current, instruction));
        await logAi(d, 'revise', [r]);
        if (!r.ok) return fail(502, 'The revision did not come through. Nothing was used up; please try again.');
        o.history = [...(o.history || []), { at: d.now(), ...current }].slice(-6);
        o.final = r.poem; o.revisions = (o.revisions || 0) + 1; o.approvedAt = null;
        await save(d, o); return json(view(o));
      }

      if (route === 'approve' && m === 'POST') {
        const b = await body();
        const p = P.cleanPoem(b.final || o.final || {});
        const problems = P.poemProblems(p); if (problems.length) return fail(400, problems[0]);
        if (b.template && P.TEMPLATES[b.template]) o.template = b.template;
        o.final = p;
        const test = await renderPdf(d, o, { watermark: true, qr: null });
        if (!test.fits) return fail(422, 'This poem is a little too long for one page. Please shorten it a few lines (or remove the photo).');
        o.approvedAt = d.now(); o.status = 'approved'; await save(d, o);
        return json(view(o));
      }

      if (route === 'photo' && m === 'PUT') {
        const b = await bytes(P.LIMITS.photoMax);
        if (!b) return fail(413, 'That photo is too large. Please choose a smaller one.');
        if (!P.isJpeg(b)) return fail(415, 'Please choose a photo (JPG). Your browser should convert it automatically; if not, try a different photo.');
        await d.store.setBlob(`photo/${o.id}`, b, { contentType: 'image/jpeg' });
        o.photo = { size: b.length, at: d.now() }; if (o.approvedAt) o.approvedAt = null;
        await save(d, o); return json(view(o));
      }
      if (route === 'photo' && m === 'DELETE') {
        await d.store.del(`photo/${o.id}`); o.photo = null; await save(d, o); return json(view(o));
      }

      if (route === 'audio' && m === 'PUT') {
        if (!P.PACKAGES[o.pkg]?.voice) return fail(400, 'Voice recording is part of the $25 package.');
        return putAudio(d, o, await bytes(P.LIMITS.audioMax));
      }
      if (route === 'draft-audio' && m === 'GET') {
        const blob = o.audio ? await d.store.getBlob(`audio/${o.id}`) : null;
        return blob ? audioResponse(blob, req) : fail(404, 'No recording yet.');
      }

      if (route === 'preview-link' && m === 'POST') {
        if (!o.final) return fail(400, 'Choose and approve your poem first.');
        const { exp, sig } = P.signedPreview(d.secret, o.id, 30 * 60e3, d.now());
        return json({ url: `/api/poems/preview?order=${o.id}&exp=${exp}&sig=${sig}` });
      }

      if (route === 'checkout' && m === 'POST') {
        const b = await body();
        const email = String(b.email || '').trim();
        if (!P.validEmail(email)) return fail(400, 'Please enter a valid email address. Your poem is delivered there.');
        if (!b.agree) return fail(400, 'Please confirm you have checked the spelling and wording.');
        if (!o.final || !o.approvedAt) return fail(400, 'Please approve your final poem first.');
        if (!(await bump(d.store, `rl/co/${d.ipHash}`, 20, HOUR, d.now()))) return fail(429, 'Too many checkout attempts. Please wait a few minutes.');
        const k = stripeKey(d); if (k.error) return fail(503, k.error);
        const pkg = P.PACKAGES[o.pkg]; const origin = d.isLive ? SITE : d.origin;
        const params = {
          mode: 'payment',
          'line_items[0][quantity]': '1',
          'line_items[0][price_data][currency]': 'usd',
          'line_items[0][price_data][unit_amount]': String(pkg.amount),
          'line_items[0][price_data][tax_behavior]': 'exclusive',
          'line_items[0][price_data][product_data][name]': `${pkg.name}${o.test ? ' (TEST)' : ''}`,
          'line_items[0][price_data][product_data][description]': `"${o.final.title}"`.slice(0, 200),
          ...(d.env.POEMS_TAX_CODE ? { 'line_items[0][price_data][product_data][tax_code]': d.env.POEMS_TAX_CODE } : {}),
          customer_email: email,
          client_reference_id: o.id,
          success_url: `${origin}/love-poems/thanks/?order=${o.id}&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin}/love-poems/?resume=1`,
          'metadata[product]': 'love-poem', 'metadata[poem_order]': o.id, 'metadata[package]': pkg.id,
          'payment_intent_data[description]': `CustomSongMe — ${pkg.name}`,
          'payment_intent_data[metadata][poem_order]': o.id,
        };
        const useTax = d.env.POEMS_STRIPE_TAX !== 'off';
        let r = await stripe(d, 'POST', 'checkout/sessions', k.key, useTax ? { ...params, 'automatic_tax[enabled]': 'true' } : params);
        if (!r.ok && useTax && /tax/i.test(r.data?.error?.message || '')) {
          // Stripe Tax isn't active on this account: let the customer pay rather than lose the sale, and tell Dan.
          console.log('poems checkout: tax refused, retrying without', r.data?.error?.message);
          await E.send({ to: E.DAN(), ...E.T.danProblem(o, `Stripe refused automatic tax: "${r.data?.error?.message}". The checkout went ahead without tax. Turn on Stripe Tax, or set POEMS_STRIPE_TAX=off in Netlify.`) }, d.fetch);
          r = await stripe(d, 'POST', 'checkout/sessions', k.key, params);
        }
        if (!r.ok || !r.data.url) { console.log('poems checkout: stripe error', r.status, r.data?.error?.message); return fail(502, 'The secure payment page did not open. Please try again in a minute, or text Dan at (661) 714-0903.'); }
        o.email = email; o.checkout = { session: r.data.id, at: d.now() }; o.status = 'checkout'; await save(d, o);
        return json({ url: r.data.url });
      }
      return fail(405, 'Not allowed.');
    }

    // ----- watermarked preview PDF (signed link, 30 minutes) -----
    if (route === 'preview' && m === 'GET') {
      const id = url.searchParams.get('order') || '';
      if (!P.checkPreview(d.secret, id, url.searchParams.get('exp'), url.searchParams.get('sig'), d.now())) return fail(403, 'This preview link has expired. Go back and tap "Full-size preview" again.');
      const o = await d.store.getJSON(`order/${id}`); if (!o?.final) return fail(404, 'Preview not found.');
      const pdf = await renderPdf(d, o, { watermark: true, qr: null });
      if (!pdf.fits) return fail(422, 'This poem is too long for one page.');
      return new Response(pdf.bytes, { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="love-poem-preview.pdf"', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
    }

    // ----- after payment: thank-you page asks Stripe directly -----
    if (route === 'confirm' && m === 'GET') {
      const id = url.searchParams.get('order') || ''; const sid = url.searchParams.get('session_id') || '';
      if (!/^cs_(live|test)_[A-Za-z0-9]{10,200}$/.test(sid)) return fail(400, 'Missing payment reference.');
      if (!(await bump(d.store, `rl/confirm/${d.ipHash}`, 120, HOUR, d.now()))) return fail(429, 'Please wait a moment and refresh.');
      const o = await d.store.getJSON(`order/${id}`); if (!o) return fail(404, 'Order not found.');
      if (o.delivery?.emailedAt && o.paid?.session === sid) return json({ paid: true, giftUrl: giftUrl(d, o) });
      const k = stripeKey(d); if (k.error) return fail(503, k.error);
      const r = await stripe(d, 'GET', `checkout/sessions/${encodeURIComponent(sid)}`, k.key);
      if (!r.ok) return fail(502, 'Could not reach Stripe. Please refresh in a moment.');
      if (r.data.metadata?.poem_order !== o.id) return fail(400, 'This payment does not belong to this poem.');
      if (r.data.payment_status !== 'paid') return json({ paid: false });
      const f = await fulfill(d, o, r.data);
      return f.ok ? json({ paid: true, giftUrl: f.giftUrl }) : fail(500, 'Your payment went through. Your poem is being prepared; Dan has been told and will email it to you shortly.');
    }

    // ----- Stripe webhook: the reliable path, even if the customer closes the tab -----
    if (route === 'stripe-webhook' && m === 'POST') {
      const raw = await req.text();
      const secret = d.isLive ? d.env.POEMS_STRIPE_WEBHOOK_SECRET : (d.env.POEMS_TEST_STRIPE_WEBHOOK_SECRET || '');
      if (secret && !P.verifyStripeSignature(raw, req.headers.get('stripe-signature'), secret, Math.floor(d.now() / 1000))) return fail(400, 'bad signature');
      if (!secret && d.isLive) return fail(503, 'webhook secret missing');
      let ev; try { ev = JSON.parse(raw); } catch { return fail(400, 'bad json'); }
      if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(ev.type)) return json({ ignored: true });
      const obj = ev.data?.object || {};
      if (obj.metadata?.product !== 'love-poem') return json({ ignored: true });
      if (!!ev.livemode !== d.isLive) return json({ ignored: 'mode' });
      const k = stripeKey(d); if (k.error) return fail(503, k.error);
      // never trust the event body: fetch the session from Stripe with our own key
      const r = await stripe(d, 'GET', `checkout/sessions/${encodeURIComponent(obj.id)}`, k.key);
      if (!r.ok) return fail(502, 'stripe unreachable');
      if (r.data.payment_status !== 'paid') return json({ waiting: true });
      const o = await d.store.getJSON(`order/${r.data.metadata?.poem_order}`); if (!o) return json({ missing: true });
      const f = await fulfill(d, o, r.data);
      return f.ok ? json({ ok: true }) : fail(500, 'fulfil failed');
    }

    // ----- the buyer's private gift page -----
    if (route === 'gift' && m === 'GET') {
      const [o, err] = await loadGift(d, url.searchParams.get('t')); if (err) return err;
      return json(P.giftView(o, d.isLive ? SITE : d.origin));
    }
    if (route === 'pdf' && m === 'GET') {
      const [o, err] = await loadGift(d, url.searchParams.get('t')); if (err) return err;
      let blob = await d.store.getBlob(`pdf/${o.id}`);
      if (!blob) { o.delivery.pdfAt = null; await fulfill(d, o, { id: o.paid.session, metadata: { poem_order: o.id }, payment_status: 'paid' }); blob = await d.store.getBlob(`pdf/${o.id}`); }
      if (!blob) return fail(500, 'Your PDF is being rebuilt. Please try again in a minute.');
      return new Response(blob.data, { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${slug(o.final.title)}.pdf"`, 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' } });
    }
    if (route === 'gift-audio' && m === 'PUT') {
      const [o, err] = await loadGift(d, url.searchParams.get('t')); if (err) return err;
      if (!P.PACKAGES[o.pkg]?.voice) return fail(400, 'Voice recording is part of the $25 package.');
      if (!(await bump(d.store, `rl/rerecord/${o.id}`, 20, DAY, d.now()))) return fail(429, 'You have re-recorded a lot today. Please try again tomorrow.');
      return putAudio(d, o, await bytes(P.LIMITS.audioMax));
    }

    // ----- the public QR page (only the unguessable id is needed) -----
    if (route === 'listen' && m === 'GET') {
      const o = await orderForListen(d, url.searchParams.get('id')); if (!o) return fail(404, 'This QR code is not active.');
      return json(P.listenView(o));
    }
    if (route === 'listen-audio' && m === 'GET') {
      const o = await orderForListen(d, url.searchParams.get('id'));
      const blob = o?.audio ? await d.store.getBlob(`audio/${o.id}`) : null;
      return blob ? audioResponse(blob, req) : fail(404, 'No recording yet.');
    }

    return fail(404, 'Not found.');
  } catch (e) {
    console.log('poems error', route, e?.stack || String(e));
    return fail(500, 'Something went wrong on my end. Your work is saved; please try again in a moment.');
  }
}

async function orderForListen(d, id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{8,40}$/.test(id)) return null;
  const ref = await d.store.getJSON(`listen/${id}`);
  const o = ref && (await d.store.getJSON(`order/${ref.order}`));
  return o?.paid ? o : null;
}

async function putAudio(d, o, b) {
  if (!b) return fail(413, 'That recording is too long. Please keep it under 3 minutes.');
  const type = P.sniffAudio(b);
  if (!type) return fail(415, 'That recording could not be read. Please record again.');
  await d.store.setBlob(`audio/${o.id}`, b, { contentType: type });
  o.audio = { type, size: b.length, at: d.now(), v: (o.audio?.v || 0) + 1 };
  await save(d, o);
  return json({ ok: true, audio: { v: o.audio.v, size: b.length, type } });
}

// iPhone Safari will not play audio without Range support.
function audioResponse(blob, req) {
  const data = blob.data; const type = blob.meta?.contentType || 'audio/mp4';
  const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' };
  const range = req.headers.get('range');
  if (range) {
    const mm = /bytes=(\d*)-(\d*)/.exec(range);
    const start = mm && mm[1] ? parseInt(mm[1], 10) : 0;
    let end = mm && mm[2] ? parseInt(mm[2], 10) : data.length - 1;
    if (start >= data.length || end < start) return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${data.length}` } });
    end = Math.min(end, data.length - 1);
    return new Response(data.subarray(start, end + 1), { status: 206, headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': String(end - start + 1) } });
  }
  return new Response(data, { status: 200, headers: { ...base, 'Content-Length': String(data.length) } });
}

// ---------- daily clean-up: unpaid drafts and their files are deleted after 14 days ----------
export async function cleanup(d) {
  const cutoff = d.now() - P.LIMITS.draftDays * DAY; let removed = 0;
  for (const key of await d.store.list('order/')) {
    const o = await d.store.getJSON(key);
    if (!o || o.paid) continue;
    if ((o.updatedAt || o.createdAt || 0) < cutoff) {
      for (const k of [key, `photo/${o.id}`, `audio/${o.id}`, `lock/email/${o.id}`]) await d.store.del(k);
      removed += 1;
    }
  }
  for (const key of await d.store.list('rl/')) {
    const r = await d.store.getJSON(key); if (!r || (r.exp || 0) < d.now()) await d.store.del(key);
  }
  return { removed };
}
