// Family Memory Magnets — core logic (storage-agnostic, fully unit-tested).
// The HTTP layer (fmm.mjs) wires this to Netlify Blobs; tests use an in-memory store.
//
// Rules this file enforces on the SERVER (never trusted to the browser):
//  - Tokens are random, stored only as SHA-256 hashes, and revocable instantly.
//  - A token only ever reaches ITS story and ITS role (child / grandparent).
//  - Real-child recordings are blocked until parent consent is recorded (test stories excepted).
//  - Stop N+1 unlocks only after the child has heard the answer to stop N.
//  - Each slot accepts one upload (duplicates are refused; same upload id is idempotent).
//  - Media is only handed out as short-lived HMAC-signed URLs.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import QUESTIONS from './fmm-questions.mjs';

export const LIMITS = { question: 30, answer: 60, intro: 120, closing: 120 }; // seconds
export const MAX_BYTES = 4 * 1024 * 1024; // Netlify sync functions cap requests near 6 MB
export const DURATION_SLACK = 3; // seconds of tolerance for recorder timing
export const ACCESS_DAYS = 365; // "12 month adventure"
export const SIGNED_URL_SECONDS = 300;
export const CONSENT_VERSION = '2026-11-16-v1';
export const STOPS = QUESTIONS.stops;
export const CHAPTERS = QUESTIONS.chapters;

const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const newToken = (bytes = 24) => randomBytes(bytes).toString('base64url');
const now = () => Date.now();

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

// ---------- store contract ----------
// getJSON(key) -> object|null, setJSON(key, obj), del(key), setBlob(key, Buffer, meta), getBlob(key) -> {data:Buffer, meta}|null

export function makeMemoryStore() {
  const j = new Map(); const b = new Map();
  return {
    async getJSON(k) { return j.has(k) ? structuredClone(j.get(k)) : null; },
    async setJSON(k, v) { j.set(k, structuredClone(v)); },
    async del(k) { j.delete(k); b.delete(k); },
    async setBlob(k, data, meta) { b.set(k, { data: Buffer.from(data), meta }); },
    async getBlob(k) { return b.has(k) ? b.get(k) : null; },
    async list(prefix) { return [...j.keys()].filter((k) => k.startsWith(prefix)); },
    _dump: () => ({ json: [...j.keys()], blobs: [...b.keys()] }),
  };
}

// ---------- signing ----------
export function sign(secret, payload) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}
function safeEq(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
export function signMedia(secret, storyId, slot, ttl = SIGNED_URL_SECONDS) {
  const exp = Math.floor(now() / 1000) + ttl;
  return { exp, sig: sign(secret, `media|${storyId}|${slot}|${exp}`) };
}
export function verifyMedia(secret, storyId, slot, exp, sig) {
  if (!exp || !sig || Number(exp) < Math.floor(now() / 1000)) return false;
  return safeEq(sign(secret, `media|${storyId}|${slot}|${exp}`), sig);
}
export function adminSession(secret, ttlHours = 12) {
  const exp = now() + ttlHours * 3600e3;
  return `${exp}.${sign(secret, 'admin|' + exp)}`;
}
export function verifyAdmin(secret, tok) {
  const [exp, sig] = String(tok || '').split('.');
  if (!exp || !sig || Number(exp) < now()) return false;
  return safeEq(sign(secret, 'admin|' + exp), sig);
}

// ---------- slots ----------
export function slotKey(n, slot) { return slot === 'intro' || slot === 'closing' ? slot : `${slot}-${n}`; }
const emptyStops = () => STOPS.map((s) => ({ n: s.n, chosen: null, skipped: [], q: null, a: null, heardAt: null }));

// ---------- story lifecycle ----------
export async function createStory(store, input) {
  const childName = String(input.childName || '').trim().slice(0, 40);
  const grandparentName = String(input.grandparentName || '').trim().slice(0, 40);
  if (!childName || !grandparentName) fail(400, 'Child name and grandparent name are required.');
  const id = newToken(9);
  const tokens = { child: newToken(), grandparent: newToken() };
  const qrCode = newToken(12);
  const pin = input.pin ? String(input.pin).replace(/\D/g, '').slice(0, 6) : '';
  if (input.pin && pin.length < 4) fail(400, 'PIN must be 4 to 6 digits.');
  const story = {
    id, createdAt: now(), expiresAt: now() + ACCESS_DAYS * 86400e3,
    test: !!input.test, childName, grandparentName,
    parentName: String(input.parentName || '').slice(0, 80),
    parentEmail: String(input.parentEmail || '').slice(0, 120),
    orderId: input.orderId || null, packageName: String(input.packageName || '').slice(0, 60),
    qrCode, pinHash: pin ? sha('pin|' + id + '|' + pin) : null,
    tokenHashes: { child: sha(tokens.child), grandparent: sha(tokens.grandparent) },
    consent: null, stops: emptyStops(), intro: null, closing: null, deletedAt: null,
  };
  await store.setJSON(`story/${id}`, story);
  await store.setJSON(`token/${story.tokenHashes.child}`, { storyId: id, role: 'child' });
  await store.setJSON(`token/${story.tokenHashes.grandparent}`, { storyId: id, role: 'grandparent' });
  await store.setJSON(`qr/${qrCode}`, { storyId: id });
  return { story, tokens };
}

export async function revokeToken(store, storyId, role) {
  if (!['child', 'grandparent'].includes(role)) fail(400, 'Bad role.');
  const story = await store.getJSON(`story/${storyId}`) || fail(404, 'No such story.');
  await store.del(`token/${story.tokenHashes[role]}`); // old link dies immediately
  const t = newToken();
  story.tokenHashes[role] = sha(t);
  await store.setJSON(`token/${story.tokenHashes[role]}`, { storyId, role });
  await store.setJSON(`story/${storyId}`, story);
  return t;
}

export async function deleteStory(store, storyId) {
  const story = await store.getJSON(`story/${storyId}`) || fail(404, 'No such story.');
  for (const s of story.stops) {
    for (const slot of ['q', 'a']) if (s[slot]) await store.del(s[slot].key);
  }
  for (const k of ['intro', 'closing']) if (story[k]) await store.del(story[k].key);
  for (const r of ['child', 'grandparent']) await store.del(`token/${story.tokenHashes[r]}`);
  await store.del(`qr/${story.qrCode}`);
  await store.del(`story/${storyId}`);
  return { deleted: true, test: story.test };
}

// ---------- authorization ----------
export async function authorize(store, token, { pin } = {}) {
  if (!token || typeof token !== 'string' || token.length > 80) fail(401, 'Invalid link.');
  const ref = await store.getJSON(`token/${sha(token)}`);
  if (!ref) fail(401, 'This link is no longer valid.');
  const story = await store.getJSON(`story/${ref.storyId}`);
  if (!story || story.tokenHashes[ref.role] !== sha(token)) fail(401, 'This link is no longer valid.');
  if (story.expiresAt < now()) fail(410, 'This story has passed its 12-month window.');
  if (ref.role === 'child' && story.pinHash && sha('pin|' + story.id + '|' + String(pin || '')) !== story.pinHash) {
    throw Object.assign(new HttpError(401, 'PIN required.'), { pinRequired: true });
  }
  return { story, role: ref.role };
}

// ---------- state ----------
export function stopStatus(story, i) {
  const s = story.stops[i];
  if (s.heardAt) return 'done';
  if (s.a) return 'heard-pending';   // answer recorded, child hasn't listened yet
  if (s.q) return 'awaiting-answer'; // question recorded, grandparent's turn
  if (s.chosen) return 'record-question';
  return 'choose';
}
export function currentIndex(story) {
  const i = story.stops.findIndex((s) => !s.heardAt);
  return i === -1 ? STOPS.length : i;
}

export function publicState(story, role) {
  const ci = currentIndex(story);
  const stops = STOPS.map((def, i) => ({
    n: def.n, chapter: def.chapter, title: def.title,
    status: i < ci ? 'done' : i === ci ? stopStatus(story, i) : 'locked',
  }));
  const cur = ci < STOPS.length ? story.stops[ci] : null;
  const def = ci < STOPS.length ? STOPS[ci] : null;
  const out = {
    role, childName: story.childName, grandparentName: story.grandparentName,
    qrCode: story.qrCode, test: story.test, expiresAt: story.expiresAt,
    consentNeeded: role === 'child' && !story.test && !story.consent,
    done: ci >= STOPS.length, completed: Math.min(ci, STOPS.length),
    chapters: CHAPTERS, stops, introDone: !!story.intro, closingDone: !!story.closing,
    limits: LIMITS, current: null,
  };
  if (cur) {
    out.current = {
      n: def.n, title: def.title, status: stopStatus(story, ci),
      choices: def.choices.filter((c) => !cur.skipped.includes(c.id)).map((c) => ({ id: c.id, text: c.text, type: c.type, sensitive: c.sensitive })),
      chosen: cur.chosen,
    };
    // the child's pick is irrelevant to nobody else: grandparent sees it only once recorded
    if (role === 'grandparent' && !cur.q) out.current.chosen = null;
  }
  return out;
}

// ---------- actions ----------
export async function recordConsent(store, token, { parentName, agree }) {
  const { story, role } = await authorize(store, token);
  if (role !== 'child') fail(403, 'Only the parent link can give consent.');
  if (!agree || !String(parentName || '').trim()) fail(400, 'Parent name and agreement are required.');
  story.consent = { parentName: String(parentName).trim().slice(0, 80), version: CONSENT_VERSION, at: now() };
  await store.setJSON(`story/${story.id}`, story);
  return { ok: true };
}

export async function choose(store, token, { n, qid, custom, pin }) {
  const { story, role } = await authorize(store, token, { pin });
  if (role !== 'child') fail(403, 'Only the child picks the question.');
  const i = currentIndex(story);
  if (n !== STOPS[i]?.n) fail(409, 'That stop is not open yet.');
  const cur = story.stops[i];
  if (cur.q) fail(409, 'This question is already recorded.');
  if (custom) {
    const text = String(custom).trim().slice(0, 200);
    if (!text) fail(400, 'Empty custom question.');
    cur.chosen = { id: 'custom', text, custom: true };
  } else {
    const c = STOPS[i].choices.find((x) => x.id === qid && !cur.skipped.includes(x.id));
    if (!c) fail(400, 'Unknown question choice.');
    cur.chosen = { id: c.id, text: c.text };
  }
  await store.setJSON(`story/${story.id}`, story);
  return publicState(story, role);
}

const ROLE_SLOT = { child: ['question'], grandparent: ['answer', 'intro', 'closing'] };

export async function upload(store, token, { n, slot, data, durationSec, uploadId, contentType, pin }) {
  const { story, role } = await authorize(store, token, { pin });
  if (!ROLE_SLOT[role].includes(slot)) fail(403, 'This link cannot record that.');
  if (role === 'child' && !story.test && !story.consent) fail(403, 'A parent must give consent before recording.');
  if (!data || !data.length) fail(400, 'Empty recording.');
  if (data.length > MAX_BYTES) fail(413, 'Recording is too large.');
  const limit = LIMITS[slot];
  if (!(durationSec > 0) || durationSec > limit + DURATION_SLACK) fail(400, `Recording must be ${limit} seconds or less.`);
  if (!/^audio\//.test(String(contentType || ''))) fail(415, 'Audio only.');

  let target; let key;
  if (slot === 'intro' || slot === 'closing') {
    if (slot === 'closing' && currentIndex(story) < STOPS.length) fail(409, 'The closing message comes after all 30 conversations.');
    target = story; key = slot; // story.intro / story.closing
    if (story[key]) {
      if (story[key].uploadId === uploadId) return { ok: true, duplicate: true };
      fail(409, 'Already recorded.');
    }
  } else {
    const i = currentIndex(story);
    if (n !== STOPS[i]?.n) fail(409, 'That stop is not open.');
    target = story.stops[i]; key = slot === 'question' ? 'q' : 'a';
    if (slot === 'question' && !target.chosen) fail(409, 'Pick a question first.');
    if (slot === 'answer' && !target.q) fail(409, 'The question has not been recorded yet.');
    if (target[key]) {
      if (target[key].uploadId === uploadId) return { ok: true, duplicate: true };
      fail(409, 'Already recorded for this stop.');
    }
  }
  const blobKey = `audio/${story.id}/${slotKey(n, slot)}`;
  await store.setBlob(blobKey, data, { contentType, durationSec });
  target[key] = { key: blobKey, uploadId: String(uploadId || ''), durationSec, contentType, at: now(), bytes: data.length };
  await store.setJSON(`story/${story.id}`, story);
  return { ok: true, state: publicState(story, role) };
}

export async function markHeard(store, token, { n, pin }) {
  const { story, role } = await authorize(store, token, { pin });
  if (role !== 'child') fail(403, 'Only the child unlocks the next stop.');
  const i = currentIndex(story);
  if (n !== STOPS[i]?.n) fail(409, 'That stop is not open.');
  if (!story.stops[i].a) fail(409, 'The answer has not been recorded yet.');
  story.stops[i].heardAt = now();
  await store.setJSON(`story/${story.id}`, story);
  return publicState(story, role);
}

// grandparent may skip a question they'd rather not answer: the child picks again
export async function skipQuestion(store, token, { n }) {
  const { story, role } = await authorize(store, token);
  if (role !== 'grandparent') fail(403, 'Only the grandparent can skip.');
  const i = currentIndex(story);
  if (n !== STOPS[i]?.n) fail(409, 'That stop is not open.');
  const cur = story.stops[i];
  if (!cur.q) fail(409, 'No question to skip.');
  if (cur.a) fail(409, 'Already answered.');
  if (cur.chosen?.id && cur.chosen.id !== 'custom') cur.skipped.push(cur.chosen.id);
  await store.del(cur.q.key);
  cur.q = null; cur.chosen = null;
  await store.setJSON(`story/${story.id}`, story);
  return publicState(story, role);
}

// What each role may hear, decided here (never by the browser).
export async function mediaAccess(store, secret, token, { n, slot, pin }) {
  const { story, role } = await authorize(store, token, { pin });
  const i = currentIndex(story);
  let item;
  if (slot === 'question') {
    // the grandparent hears the real recorded question; the child can replay it
    item = story.stops[STOPS.findIndex((s) => s.n === n)]?.q;
    if (role === 'grandparent' && n !== STOPS[i]?.n) fail(403, 'Not available.');
  } else if (slot === 'answer') {
    item = story.stops[STOPS.findIndex((s) => s.n === n)]?.a;
    if (role === 'grandparent' && n !== STOPS[i]?.n) fail(403, 'Not available.');
  } else if (slot === 'intro' || slot === 'closing') {
    item = story[slot];
  } else fail(400, 'Bad slot.');
  if (!item) fail(404, 'Nothing recorded yet.');
  const s = signMedia(secret, story.id, slotKey(n, slot));
  return { url: `/api/fmm/audio?s=${story.id}&k=${encodeURIComponent(slotKey(n, slot))}&e=${s.exp}&sig=${s.sig}`, expiresIn: SIGNED_URL_SECONDS };
}

export async function readSignedAudio(store, secret, { s, k, e, sig }) {
  if (!verifyMedia(secret, s, k, e, sig)) fail(403, 'Link expired.');
  const blob = await store.getBlob(`audio/${s}/${k}`);
  if (!blob) fail(404, 'Not found.');
  return blob;
}

// Public QR page: always the same sentence; leaks nothing about whether a code exists.
export const QR_MESSAGE = 'A Family Memory Magnets story is being created.';
