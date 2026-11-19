// CustomSongMe Love Poems — calls Claude through Netlify AI Gateway.
// Netlify injects ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL automatically when AI is enabled for the
// project. No key is stored in code. POEMS_AI_MODEL can switch the model without a code change.

import * as P from './poems-core.mjs';

const DEFAULT_MODEL = 'claude-sonnet-5-5';
const FALLBACK_MODEL = 'claude-haiku-5-5';

export const aiConfigured = () => !!(process.env.ANTHROPIC_BASE_URL || process.env.ANTHROPIC_API_KEY);

async function callOnce(model, prompt, { fetchImpl = fetch, timeoutMs = 24000 } = {}) {
  const base = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(`${base}/v1/messages`, {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY || '', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 900, system: P.SYSTEM_PROMPT, messages: [{ role: 'user', content: prompt }] }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, status: r.status, error: j?.error?.message || `HTTP ${r.status}` };
    const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { ok: true, text, usage: j.usage || null, model };
  } catch (e) {
    return { ok: false, status: 0, error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e) };
  } finally { clearTimeout(timer); }
}

// One poem. Tries the chosen model, then a faster fallback if the model is unavailable or slow.
export async function writePoem(prompt, opts = {}) {
  const model = process.env.POEMS_AI_MODEL || DEFAULT_MODEL;
  let r = await callOnce(model, prompt, opts);
  if (!r.ok && (r.status === 400 || r.status === 404 || r.status === 0 || r.status >= 500) && model !== FALLBACK_MODEL) {
    console.log('poems ai: falling back', r.status, r.error);
    r = await callOnce(FALLBACK_MODEL, prompt, { ...opts, timeoutMs: 15000 });
  }
  if (!r.ok) return { ok: false, error: r.error, status: r.status };
  const poem = P.parsePoem(r.text);
  if (!poem) return { ok: false, error: 'unreadable reply', usage: r.usage };
  return { ok: true, poem, usage: r.usage, model: r.model };
}
