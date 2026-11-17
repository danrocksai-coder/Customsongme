// Netlify Blobs store used by the Family Memory Magnets functions (private, server-side only).
import { getStore } from '@netlify/blobs';
export function blobStore() {
  const s = getStore({ name: 'fmm', consistency: 'strong' });
  return {
    async getJSON(k) { return (await s.get(k, { type: 'json' })) ?? null; },
    async setJSON(k, v) { await s.setJSON(k, v); },
    async del(k) { await s.delete(k); },
    async setBlob(k, data, meta) { await s.set(k, data, { metadata: meta }); },
    async getBlob(k) { const r = await s.getWithMetadata(k, { type: 'arrayBuffer' }); return r ? { data: Buffer.from(r.data), meta: r.metadata } : null; },
    async list(prefix) { return (await s.list({ prefix })).blobs.map((b) => b.key); },
  };
}
