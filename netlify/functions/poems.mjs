// CustomSongMe Love Poems — HTTP API (/api/poems/*). The logic lives in netlify/lib/poems-api.mjs.
//
// Storage: Netlify Blobs. The live site uses the "love-poems" store; every preview / branch copy uses
// "love-poems-test", so testing can never touch real customer orders.
//
// Netlify environment variables (values are never in code or chat):
//   STRIPE_SECRET_KEY                live key (already set; used only on the live site)
//   POEMS_STRIPE_WEBHOOK_SECRET      live webhook signing secret (whsec_...), needed before launch
//   POEMS_TEST_STRIPE_SECRET_KEY     Stripe TEST key, used only on previews (a live key is refused there)
//   POEMS_TEST_STRIPE_WEBHOOK_SECRET optional test webhook signing secret
//   POEMS_SECRET (or FMM_SECRET)     signs preview links and hashes visitor IPs for rate limits
//   POEMS_AI_MODEL / POEMS_AI_DAILY_CAP / POEMS_STRIPE_TAX=off / POEMS_TAX_CODE   optional switches
//   ANTHROPIC_API_KEY + ANTHROPIC_BASE_URL are injected by Netlify AI Gateway (do not set them).

import { getStore } from '@netlify/blobs';
import QRCode from 'qrcode';
import { handle } from '../lib/poems-api.mjs';
import * as AI from '../lib/poems-ai.mjs';
import { sha256 } from '../lib/poems-core.mjs';

export function blobStore(name) {
  const s = getStore({ name, consistency: 'strong' });
  return {
    async getJSON(k) { return (await s.get(k, { type: 'json' })) ?? null; },
    async setJSON(k, v) { await s.setJSON(k, v); },
    async del(k) { await s.delete(k); },
    async setBlob(k, data, meta) { await s.set(k, data, { metadata: meta }); },
    async getBlob(k) { const r = await s.getWithMetadata(k, { type: 'arrayBuffer' }); return r ? { data: Buffer.from(r.data), meta: r.metadata } : null; },
    async list(prefix) { return (await s.list({ prefix })).blobs.map((b) => b.key); },
    // true only for the first caller (used so two requests never send the same email)
    async claim(k, at) {
      try { const r = await s.setJSON(k, { at }, { onlyIfNew: true }); return r?.modified !== false; }
      catch { const cur = await s.get(k, { type: 'json' }); if (cur && at - cur.at < 120e3) return false; await s.setJSON(k, { at }); return true; }
    },
  };
}

export function isLiveContext(context, url) {
  const ctx = context?.deploy?.context || process.env.CONTEXT || '';
  if (ctx) return ctx === 'production';
  return url.hostname === 'www.customsongme.com';
}

export default async (req, context) => {
  const url = new URL(req.url);
  const isLive = isLiveContext(context, url);
  const secret = process.env.POEMS_SECRET || process.env.FMM_SECRET || '';
  if (!secret) return new Response(JSON.stringify({ error: 'Love Poems is not configured yet.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  const ip = context?.ip || req.headers.get('x-nf-client-connection-ip') || 'unknown';
  return handle(req, {
    store: blobStore(isLive ? 'love-poems' : 'love-poems-test'),
    isLive, env: process.env, origin: url.origin, secret,
    ipHash: sha256(`${secret}|${ip}`).slice(0, 24),
    now: () => Date.now(), fetch: (...a) => fetch(...a), ai: AI,
    qr: (text) => { const q = QRCode.create(text, { errorCorrectionLevel: 'M' }); return { size: q.modules.size, get: (r, c) => !!q.modules.get(r, c) }; },
  });
};

export const config = { path: '/api/poems/*' };
