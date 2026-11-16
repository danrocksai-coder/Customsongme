// Family Memory Magnets — HTTP API  (/api/fmm/*)
// Storage: Netlify Blobs (private, server-side only). Secrets come from Netlify environment settings:
//   FMM_SECRET          long random string (signs media links + admin sessions)
//   FMM_ADMIN_PASSWORD  Dan's admin password
// No secret is ever sent to the browser. If either is missing the API fails closed.

import { getStore } from '@netlify/blobs';
import { randomBytes } from 'node:crypto';
import * as C from '../lib/fmm-core.mjs';

const FORMSPREE = process.env.FMM_FORMSPREE_URL || 'https://formspree.io/f/xwpqlypv';
const PACKAGES = { one: { id: 'fmm1', label: 'One grandparent', grandparents: 1 }, two: { id: 'fmm2', label: 'Two grandparents', grandparents: 2 } };

function blobStore() {
  const s = getStore({ name: 'fmm', consistency: 'strong' });
  return {
    async getJSON(k) { return (await s.get(k, { type: 'json' })) ?? null; },
    async setJSON(k, v) { await s.setJSON(k, v); },
    async del(k) { await s.delete(k); },
    async setBlob(k, data, meta) { await s.set(k, data, { metadata: meta }); },
    async getBlob(k) {
      const r = await s.getWithMetadata(k, { type: 'arrayBuffer' });
      return r ? { data: Buffer.from(r.data), meta: r.metadata } : null;
    },
    async list(prefix) { return (await s.list({ prefix })).blobs.map((b) => b.key); },
  };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
});

function audioResponse(blob, req) {
  const data = blob.data; const type = blob.meta?.contentType || 'audio/mp4';
  const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' };
  const range = req.headers.get('range');
  if (range) { // iPhone Safari will not play audio without Range support
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : data.length - 1;
    if (start >= data.length || end < start) return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${data.length}` } });
    end = Math.min(end, data.length - 1);
    return new Response(data.subarray(start, end + 1), { status: 206, headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': String(end - start + 1) } });
  }
  return new Response(data, { status: 200, headers: { ...base, 'Content-Length': String(data.length) } });
}

const summary = (s) => ({
  id: s.id, childName: s.childName, grandparentName: s.grandparentName, test: s.test, packageName: s.packageName,
  parentName: s.parentName, parentEmail: s.parentEmail, createdAt: s.createdAt, expiresAt: s.expiresAt,
  completed: C.currentIndex(s), consent: s.consent ? { parentName: s.consent.parentName, at: s.consent.at, version: s.consent.version } : null,
  hasIntro: !!s.intro, hasClosing: !!s.closing, qrCode: s.qrCode, pin: !!s.pinHash, failures: (s.failures || []).slice(-10),
  recordings: s.stops.map((x, i) => ({ n: i + 1, q: !!x.q, a: !!x.a, chosen: x.chosen?.text || null })).filter((x) => x.q || x.a),
});

export default async (req) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/fmm\/?/, '').replace(/\/$/, '');
  const secret = process.env.FMM_SECRET;
  const store = blobStore();
  const origin = url.origin;

  try {
    // ---------- public ----------
    if (route === 'qr') return json({ message: C.QR_MESSAGE }); // identical for every code
    if (route === 'order' && req.method === 'POST') return await order(req, store);

    if (!secret) return json({ error: 'Not configured.' }, 503);

    if (route === 'audio' && req.method === 'GET') {
      const p = Object.fromEntries(url.searchParams);
      return audioResponse(await C.readSignedAudio(store, secret, p), req);
    }

    // ---------- admin ----------
    if (route.startsWith('admin/')) return await admin(route.slice(6), req, url, store, secret, origin);

    // ---------- participant ----------
    const t = url.searchParams.get('t') || '';
    const pin = req.headers.get('x-pin') || '';
    if (route === 'state' && req.method === 'GET') {
      const { story, role } = await C.authorize(store, t, { pin });
      return json(C.publicState(story, role));
    }
    if (route === 'consent' && req.method === 'POST') return json(await C.recordConsent(store, t, await req.json()));
    if (route === 'choose' && req.method === 'POST') return json(await C.choose(store, t, { ...(await req.json()), pin }));
    if (route === 'heard' && req.method === 'POST') return json(await C.markHeard(store, t, { ...(await req.json()), pin }));
    if (route === 'skip' && req.method === 'POST') return json(await C.skipQuestion(store, t, await req.json()));
    if (route === 'media' && req.method === 'GET') {
      return json(await C.mediaAccess(store, secret, t, { n: Number(url.searchParams.get('n')), slot: url.searchParams.get('slot'), pin }));
    }
    if (route === 'upload' && req.method === 'POST') {
      const data = Buffer.from(await req.arrayBuffer());
      return json(await C.upload(store, t, {
        n: Number(url.searchParams.get('n')), slot: url.searchParams.get('slot'), data,
        durationSec: Number(req.headers.get('x-duration')), uploadId: req.headers.get('x-upload-id') || '',
        contentType: (req.headers.get('content-type') || '').split(';')[0], pin,
      }));
    }
    if (route === 'report' && req.method === 'POST') { // browser reports an upload failure so Dan can see it
      const { story } = await C.authorize(store, t, { pin });
      const b = await req.json();
      story.failures = [...(story.failures || []), { at: Date.now(), slot: String(b.slot || '').slice(0, 20), n: Number(b.n) || 0, error: String(b.error || '').slice(0, 160) }].slice(-20);
      await store.setJSON(`story/${story.id}`, story);
      return json({ ok: true });
    }
    return json({ error: 'Not found.' }, 404);
  } catch (e) {
    if (e instanceof C.HttpError) return json({ error: e.message, pinRequired: !!e.pinRequired }, e.status);
    console.log('fmm error', String(e && e.stack || e));
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
};

async function order(req, store) {
  const b = await req.json().catch(() => ({}));
  if (b.website) return json({ ok: true }); // honeypot
  const clean = (v, n) => String(v || '').trim().slice(0, n);
  const pkg = PACKAGES[b.package];
  const email = clean(b.email, 120);
  const o = {
    id: randomBytes(8).toString('base64url'), createdAt: Date.now(), package: b.package, packageLabel: pkg?.label,
    parentName: clean(b.parentName, 80), email, phone: clean(b.phone, 30),
    childName: clean(b.childName, 40), grandparent1: clean(b.grandparent1, 40), grandparent2: clean(b.grandparent2, 40), notes: clean(b.notes, 400),
    status: 'awaiting-payment',
  };
  if (!pkg || !o.parentName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !o.childName || !o.grandparent1 || (pkg.grandparents === 2 && !o.grandparent2)) {
    return json({ error: 'Please complete all required fields.' }, 400);
  }
  await store.setJSON(`order/${o.id}`, o);
  try { // tell Dan (same Formspree inbox the rest of the site uses); never block the customer on it
    await fetch(FORMSPREE, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ _subject: 'New Family Memory Magnets order (awaiting payment)', ...o }) });
  } catch { /* ignore */ }
  return json({ ok: true, orderId: o.id, payUrl: `/pay/${pkg.id}?order=${encodeURIComponent(o.id)}&prefilled_email=${encodeURIComponent(email)}` });
}

async function admin(route, req, url, store, secret, origin) {
  const pw = process.env.FMM_ADMIN_PASSWORD;
  if (!pw) return json({ error: 'Admin not configured.' }, 503);
  if (route === 'login' && req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    if (!b.password || b.password !== pw) { await new Promise((r) => setTimeout(r, 600)); return json({ error: 'Wrong password.' }, 401); }
    return json({ token: C.adminSession(secret) });
  }
  const auth = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
  if (!C.verifyAdmin(secret, auth)) return json({ error: 'Please log in.' }, 401);
  const link = (tok) => `${origin}/family-memory-magnets/s/?t=${tok}`;

  if (route === 'overview') {
    const stories = [];
    for (const k of await store.list('story/')) { const s = await store.getJSON(k); if (s) stories.push(summary(s)); }
    const orders = [];
    for (const k of await store.list('order/')) { const o = await store.getJSON(k); if (o) orders.push(o); }
    stories.sort((a, b) => b.createdAt - a.createdAt); orders.sort((a, b) => b.createdAt - a.createdAt);
    return json({ stories, orders });
  }
  const b = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  if (route === 'create' && req.method === 'POST') {
    const { story, tokens } = await C.createStory(store, b);
    if (b.orderId) { const o = await store.getJSON(`order/${b.orderId}`); if (o) { o.status = 'story-created'; o.storyId = story.id; await store.setJSON(`order/${o.id}`, o); } }
    return json({ story: summary(story), links: { child: link(tokens.child), grandparent: link(tokens.grandparent) } });
  }
  if (route === 'revoke' && req.method === 'POST') return json({ link: link(await C.revokeToken(store, b.id, b.role)) });
  if (route === 'delete' && req.method === 'POST') { if (b.confirm !== 'DELETE') return json({ error: 'Type DELETE to confirm.' }, 400); return json(await C.deleteStory(store, b.id)); }
  if (route === 'media' && req.method === 'GET') {
    const id = url.searchParams.get('id'); const slot = url.searchParams.get('slot'); const n = Number(url.searchParams.get('n')) || 0;
    const story = await store.getJSON(`story/${id}`); if (!story) return json({ error: 'No such story.' }, 404);
    const key = C.slotKey(n, slot); const s = C.signMedia(secret, id, key);
    return json({ url: `/api/fmm/audio?s=${id}&k=${encodeURIComponent(key)}&e=${s.exp}&sig=${s.sig}` });
  }
  return json({ error: 'Not found.' }, 404);
}

export const config = { path: '/api/fmm/*' };
