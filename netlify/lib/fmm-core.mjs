// Family Memory Magnets — core logic (storage-agnostic, fully unit-tested).
// The HTTP layer (functions/fmm.mjs) wires this to Netlify Blobs; tests use an in-memory store.
//
// Rules this file enforces on the SERVER (never trusted to the browser):
//  - Link tokens and device sessions are random, stored only as SHA-256 hashes, and revocable instantly.
//  - A credential only ever reaches ITS story and ITS role (child / grandparent).
//  - A printed QR code is a public identifier, NEVER a credential. It opens a device only if that device
//    already holds a session, or the person also supplies a PIN (rate limited and locked out on guessing).
//  - Real-child recordings are blocked until parent consent is recorded (test stories excepted).
//  - PARENT-RUN BY DEFAULT: the family link belongs to the parent, who records together with the child.
//    A child's OWN link exists only after the parent turns it on AND either confirms the child is 13+
//    or uploads a signed consent form that Dan approves. The parent can turn it off at any time; the
//    purchaser and Dan can never turn it on by themselves.
//  - Stop N+1 unlocks only after the child has heard the answer to stop N.
//  - Each slot accepts one upload (duplicates are refused; same upload id is idempotent).
//  - Media is only handed out as short-lived HMAC-signed URLs.
//  - Little Hellos and teleprompter drafts never touch progression.
//
// BACKWARD COMPATIBILITY: stories written by earlier versions lack the newer fields. norm() fills defaults
// in memory only; nothing is rewritten until a normal action saves the story. No migration is required.

import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import QUESTIONS from './fmm-questions.mjs';

export const LIMITS = { question: 15, answer: 60, intro: 120, closing: 120, hello: 15 }; // seconds
export const MAX_BYTES = 4 * 1024 * 1024; // Netlify sync functions cap requests near 6 MB
export const DURATION_SLACK = 3; // seconds of tolerance for recorder timing
export const ACCESS_DAYS = 365; // "12 month adventure"
export const SIGNED_URL_SECONDS = 300;
export const CONSENT_VERSION = '2026-11-16-v1';
export const CHILD_ACCESS_VERSION = '2026-11-17-v1'; // parent notice + consent-form wording for the child's own link
export const FORM_MAX_BYTES = 4 * 1024 * 1024;
export const PUBLICATION_VERSION = '2026-11-17-v1';
export const PHOTO_MAX = 40;                    // photos per story
export const PHOTO_MAX_BYTES = 4 * 1024 * 1024; // the browser shrinks photos first; this is the hard cap
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
export const FORM_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'application/pdf'];
export const HELLO_WAIT_MS = 48 * 3600e3;      // inactivity before a Hello is offered
export const HELLO_INTERVAL_MS = 48 * 3600e3;  // one Hello per participant per 48 hours
export const HELLO_TEXT_MAX = 150;
export const DRAFT_MAX = 2000;
export const PIN_MAX_FAILS = 5;                // failures before a lockout
export const LOCK_BASE_MS = 15 * 60e3;         // first lockout; doubles each time, capped at 24 h
export const LOCK_MAX_MS = 24 * 3600e3;
export const STOPS = QUESTIONS.stops;
export const CHAPTERS = QUESTIONS.chapters;
export const ROLES = ['child', 'grandparent'];
export const ALL_ROLES = ['child', 'grandparent', 'guardian']; // guardian = the purchasing parent/guardian (optional login)
export const RETENTION_DAYS_AFTER_COMPLETION = 365; // keepsake stays open 12 months after the 30th conversation

// Little Hello suggestions. Every line is 150 characters or fewer (enforced by a test).
export const HELLO_SWEET = [
  "Just thinking about you! Can't wait to hear from you!",
  'Sending you a great big hug today!',
  "You make my whole day brighter. That's it, that's the message!",
  'Hope you are having a wonderful day. I love you!',
  'I smiled just thinking about you. Hello!',
  "Guess who's missing you? Me! Come say hi soon.",
  'Thinking of you and sending lots of love.',
  'You are one of my favorite people in the whole world.',
];
export const HELLO_FUNNY = [
  'Hello? What am I, chopped liver over here?',
  'Knock knock! Who is there? Someone who wants a story!',
  'Is this thing on? Testing, testing, one, two, three!',
  'I have been waiting so long I grew a beard. (I did not. Hello!)',
  "I'm not saying I'm bored, but I counted the ceiling tiles. Twice.",
  'Breaking news: someone is waiting for your next recording!',
  'Plot twist: I miss you. Come back to the story!',
  'Ring ring! It is your biggest fan calling.',
];

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
export function slotKey(n, slot, id) {
  if (slot === 'intro' || slot === 'closing') return slot;
  if (slot === 'hello') return `hello-${id}`;
  if (slot === 'photo') return `photo-${id}`;
  return `${slot}-${n}`;
}
const emptyStops = () => STOPS.map((s) => ({ n: s.n, chosen: null, skipped: [], q: null, a: null, heardAt: null }));

// Fill defaults for stories created by earlier versions (in memory only).
export function norm(story) {
  story.hellos ||= [];
  story.helloLast ||= {};
  story.helloSettings ||= { enabled: true, style: 'both', custom: [] };
  story.drafts ||= {};
  story.sessions ||= { child: [], grandparent: [] };
  story.sessions.guardian ||= [];
  story.sessions.kid ||= [];
  story.photos ||= [];
  story.publication ||= { parent: null, grandparent: null, history: [] };
  story.childAccess ||= { status: 'none', basis: null, enabled: false, form: null, history: [] };
  story.childPaused ||= false;
  story.pins ||= {};
  story.keepsake ||= { status: 'preparing', items: [] };
  if (!story.lastActivityAt) {
    let t = story.createdAt || 0;
    for (const s of story.stops || []) for (const k of ['q', 'a']) if (s[k]?.at > t) t = s[k].at;
    for (const s of story.stops || []) if (s.heardAt > t) t = s.heardAt;
    story.lastActivityAt = t;
  }
  return story;
}

// ---------- PIN (scrypt, per-role) ----------
function hashPin(pin, salt) { return scryptSync(String(pin), salt, 32).toString('hex'); }
function cleanPin(pin) {
  const p = String(pin == null ? '' : pin).replace(/\D/g, '').slice(0, 6);
  if (p.length < 4) fail(400, 'PIN must be 4 to 6 digits.');
  return p;
}
export function pinRequired(story, role) {
  return !!(story.pins?.[role] || (role === 'child' && story.pinHash));
}
function pinOk(story, role, pin) {
  const p = story.pins?.[role];
  if (p) return safeEq(hashPin(pin, p.salt), p.hash);
  if (role === 'child' && story.pinHash) return safeEq(sha('pin|' + story.id + '|' + String(pin || '')), story.pinHash); // legacy
  return true;
}
export function setPin(story, role, pin) { // pin '' clears
  if (!ALL_ROLES.includes(role) || (role === 'guardian' && !story.tokenHashes.guardian)) fail(400, 'Bad role.');
  if (pin === '' || pin == null) { delete story.pins[role]; if (role === 'child') story.pinHash = null; return; }
  const salt = newToken(12);
  story.pins[role] = { salt, hash: hashPin(cleanPin(pin), salt) };
  if (role === 'child') story.pinHash = null;
}

// ---------- rate limiting (persisted, so it survives cold starts) ----------
async function rlCheck(store, key) {
  const r = await store.getJSON(`rl/${sha(key)}`);
  if (r?.lockedUntil > now()) fail(429, 'Too many tries. Please wait and try again later.');
}
async function rlFail(store, key) {
  const k = `rl/${sha(key)}`;
  const r = (await store.getJSON(k)) || { count: 0, strikes: 0, lockedUntil: 0 };
  r.count++;
  if (r.count >= PIN_MAX_FAILS) {
    r.lockedUntil = now() + Math.min(LOCK_MAX_MS, LOCK_BASE_MS * 2 ** r.strikes);
    r.strikes++; r.count = 0;
  }
  await store.setJSON(k, r);
}
async function rlClear(store, key) { await store.del(`rl/${sha(key)}`); }

// ---------- story lifecycle ----------
export async function createStory(store, input) {
  const childName = String(input.childName || '').trim().slice(0, 40);
  const grandparentName = String(input.grandparentName || '').trim().slice(0, 40);
  if (!childName || !grandparentName) fail(400, 'Child name and grandparent name are required.');
  const id = newToken(9);
  const tokens = { child: newToken(), grandparent: newToken() };
  if (input.guardian) tokens.guardian = newToken();
  const qrCodes = { child: newToken(12), grandparent: newToken(12) };
  const story = norm({
    id, createdAt: now(), expiresAt: now() + ACCESS_DAYS * 86400e3,
    test: !!input.test, childName, grandparentName,
    parentName: String(input.parentName || '').slice(0, 80),
    parentEmail: String(input.parentEmail || '').slice(0, 120),
    orderId: input.orderId || null, packageName: String(input.packageName || '').slice(0, 60),
    qrCode: qrCodes.child, qrCodes, pinHash: null,
    tokenHashes: { child: sha(tokens.child), grandparent: sha(tokens.grandparent) },
    consent: null, stops: emptyStops(), intro: null, closing: null, deletedAt: null,
  });
  if (tokens.guardian) { story.tokenHashes.guardian = sha(tokens.guardian); story.guardianCode = newToken(12); }
  const pc = input.pinChild ?? input.pin; // `pin` kept for older callers
  if (pc) setPin(story, 'child', pc);
  if (input.pinGrandparent) setPin(story, 'grandparent', input.pinGrandparent);
  await store.setJSON(`story/${id}`, story);
  await store.setJSON(`token/${story.tokenHashes.child}`, { storyId: id, role: 'child' });
  await store.setJSON(`token/${story.tokenHashes.grandparent}`, { storyId: id, role: 'grandparent' });
  for (const r of ROLES) await store.setJSON(`qr/${qrCodes[r]}`, { storyId: id, role: r });
  if (tokens.guardian) await store.setJSON(`token/${story.tokenHashes.guardian}`, { storyId: id, role: 'guardian' });
  return { story, tokens };
}

// Add the optional parent/guardian login to an existing story (no other credential changes).
export async function addGuardian(store, storyId) {
  const story = norm(await store.getJSON(`story/${storyId}`) || fail(404, 'No such story.'));
  if (story.tokenHashes.guardian) fail(409, 'This story already has a parent login. Use "Revoke & new link" to replace it.');
  const t = newToken();
  story.tokenHashes.guardian = sha(t); story.guardianCode = newToken(12);
  await store.setJSON(`token/${story.tokenHashes.guardian}`, { storyId, role: 'guardian' });
  await store.setJSON(`story/${storyId}`, story);
  return t;
}

// Older stories have one QR id (stored as qrCode). Keep it as the child's permanent code and add the
// grandparent's. Additive only: no link, token, id or recording changes.
export async function ensureQrCodes(store, story) {
  norm(story);
  if (story.qrCodes?.child && story.qrCodes?.grandparent) return story.qrCodes;
  const child = story.qrCodes?.child || story.qrCode || newToken(12);
  const grandparent = story.qrCodes?.grandparent || newToken(12);
  story.qrCodes = { child, grandparent }; story.qrCode = child;
  await store.setJSON(`qr/${child}`, { storyId: story.id, role: 'child' });
  await store.setJSON(`qr/${grandparent}`, { storyId: story.id, role: 'grandparent' });
  await store.setJSON(`story/${story.id}`, story);
  return story.qrCodes;
}

async function dropSessions(store, story, role) {
  for (const h of story.sessions[role] || []) await store.del(`sess/${h}`);
  story.sessions[role] = [];
}

export async function revokeToken(store, storyId, role) {
  if (!ALL_ROLES.includes(role)) fail(400, 'Bad role.');
  const story = norm(await store.getJSON(`story/${storyId}`) || fail(404, 'No such story.'));
  if (!story.tokenHashes[role]) fail(404, 'That login does not exist.');
  await store.del(`token/${story.tokenHashes[role]}`); // old link dies immediately
  await dropSessions(store, story, role);              // and so does every remembered device
  const t = newToken();
  story.tokenHashes[role] = sha(t);
  await store.setJSON(`token/${story.tokenHashes[role]}`, { storyId, role });
  await store.setJSON(`story/${storyId}`, story);
  return t;
}

// Forget remembered devices without changing the link (e.g. a lost phone).
export async function revokeDevices(store, storyId, role) {
  if (!ALL_ROLES.includes(role)) fail(400, 'Bad role.');
  const story = norm(await store.getJSON(`story/${storyId}`) || fail(404, 'No such story.'));
  await dropSessions(store, story, role);
  await store.setJSON(`story/${storyId}`, story);
  return { ok: true };
}

export async function deleteStory(store, storyId) {
  const story = norm(await store.getJSON(`story/${storyId}`) || fail(404, 'No such story.'));
  for (const s of story.stops) for (const slot of ['q', 'a']) if (s[slot]) await store.del(s[slot].key);
  for (const k of ['intro', 'closing']) if (story[k]) await store.del(story[k].key);
  for (const h of story.hellos) if (h.audio) await store.del(h.audio.key);
  if (story.childAccess.form) await store.del(story.childAccess.form.key);
  for (const ph of story.photos) await store.del(ph.key);
  if (story.tokenHashes.kid) await store.del(`token/${story.tokenHashes.kid}`);
  await dropSessions(store, story, 'kid');
  for (const r of ALL_ROLES) { if (story.tokenHashes[r]) await store.del(`token/${story.tokenHashes[r]}`); await dropSessions(store, story, r); }
  for (const c of new Set([story.qrCode, story.qrCodes?.child, story.qrCodes?.grandparent].filter(Boolean))) {
    await store.del(`qr/${c}`); await store.del(`rl/${sha('qr|' + c)}`);
  }
  await store.del(`story/${storyId}`);
  return { deleted: true, test: story.test };
}

// ---------- authorization ----------
async function loadSession(store, token) {
  const ref = await store.getJSON(`sess/${sha(token)}`);
  if (!ref) fail(401, 'This phone needs to be reconnected.');
  const story = norm(await store.getJSON(`story/${ref.storyId}`) || fail(401, 'This phone needs to be reconnected.'));
  if (!story.sessions[ref.own ? 'kid' : ref.role]?.includes(sha(token))) fail(401, 'This phone needs to be reconnected.');
  if (story.expiresAt < now()) fail(410, 'This story has passed its 12-month window.');
  if (ref.own) assertKidAllowed(story);
  return { story, role: ref.role, own: !!ref.own, via: 'session' };
}

// The child's own link works only while the parent keeps it switched on and consent is approved.
export function kidAllowed(story) {
  const a = norm(story).childAccess;
  return !!(a.enabled && a.status === 'approved' && story.tokenHashes.kid);
}
function assertKidAllowed(story) { if (!kidAllowed(story)) fail(403, 'Your parent has turned off your own link for now.'); }

// token may be a private link token OR a device session ("s." prefix). Links need the PIN (if set); sessions
// were already earned with it.
export async function authorize(store, token, { pin } = {}) {
  if (!token || typeof token !== 'string' || token.length > 90) fail(401, 'Invalid link.');
  if (token.startsWith('s.')) return loadSession(store, token);
  const ref = await store.getJSON(`token/${sha(token)}`);
  if (!ref) fail(401, 'This link is no longer valid.');
  const story = norm(await store.getJSON(`story/${ref.storyId}`) || fail(401, 'This link is no longer valid.'));
  if (story.tokenHashes[ref.own ? 'kid' : ref.role] !== sha(token)) fail(401, 'This link is no longer valid.');
  if (story.expiresAt < now()) fail(410, 'This story has passed its 12-month window.');
  if (ref.own) { assertKidAllowed(story); return { story, role: 'child', own: true, via: 'link' }; }
  if (pinRequired(story, ref.role)) {
    const key = `pin|${story.id}|${ref.role}`;
    if (!pin) throw Object.assign(new HttpError(401, 'PIN required.'), { pinRequired: true });
    await rlCheck(store, key);
    if (!pinOk(story, ref.role, pin)) { await rlFail(store, key); fail(401, 'That PIN is not right.'); }
    await rlClear(store, key);
  }
  return { story, role: ref.role, via: 'link' };
}

// Trade a private link (+PIN) for a long-lived device session, so the printed QR works on this phone from now on.
export async function exchangeLink(store, linkToken, { pin } = {}) {
  if (typeof linkToken === 'string' && linkToken.startsWith('s.')) fail(400, 'Not a link.');
  const { story, role, own } = await authorize(store, linkToken, { pin });
  const session = await createSession(store, story, role, own);
  const qrCodes = await ensureQrCodes(store, story);
  return { session, role, code: qrCodes[role] || story.guardianCode };
}

async function createSession(store, story, role, own = false) {
  const token = 's.' + newToken();
  const h = sha(token);
  await store.setJSON(`sess/${h}`, own ? { storyId: story.id, role, own: true } : { storyId: story.id, role });
  const list = story.sessions[own ? 'kid' : role];
  list.push(h);
  while (list.length > 12) await store.del(`sess/${list.shift()}`); // oldest devices drop off
  await store.setJSON(`story/${story.id}`, story);
  return token;
}

// Public QR scan on a phone that holds no session: QR id + PIN unlocks it. Anything else fails with one generic
// message, so a stranger cannot tell whether a code exists or has a PIN.
const GENERIC_UNLOCK = 'Could not unlock this phone.';
export async function unlockWithQr(store, code, pin) {
  if (!code || typeof code !== 'string' || code.length > 40) fail(401, GENERIC_UNLOCK);
  const key = `qr|${code}`;
  await rlCheck(store, key);
  const ref = await store.getJSON(`qr/${code}`);
  const story = ref ? norm((await store.getJSON(`story/${ref.storyId}`)) || {}) : null;
  const role = ref ? (ref.role || 'child') : null;
  const okExists = story && story.id && story.expiresAt >= now() && pinRequired(story, role);
  if (!okExists || !pin || !pinOk(story, role, pin)) { if (ref) await rlFail(store, key); fail(401, GENERIC_UNLOCK); }
  await rlClear(store, key);
  return { session: await createSession(store, story, role), role, code };
}

export async function qrInfo(store, code) { // public: only tells the page whether to show a PIN box
  if (!code || typeof code !== 'string' || code.length > 40) return { pin: false };
  const ref = await store.getJSON(`qr/${code}`);
  if (!ref) return { pin: false };
  const story = norm((await store.getJSON(`story/${ref.storyId}`)) || {});
  return { pin: !!(story.id && pinRequired(story, ref.role || 'child')) };
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
// Who is currently waiting on the other person (the one who may send a Little Hello).
export function waitingRole(story) {
  const i = currentIndex(story);
  if (i >= STOPS.length) return null;
  const st = stopStatus(story, i);
  if (st === 'awaiting-answer') return 'child';
  return 'grandparent'; // choose / record-question / heard-pending: Mimi is waiting on Devon
}

// ----- Little Hello suggestions -----
function helloPools(story) {
  const { style, custom } = story.helloSettings;
  const c = (custom || []).map((t, i) => ({ id: `c:${i}`, text: t }));
  const s = HELLO_SWEET.map((t, i) => ({ id: `s:${i}`, text: t }));
  const f = HELLO_FUNNY.map((t, i) => ({ id: `f:${i}`, text: t }));
  if (style === 'custom' && c.length) return { a: c, b: c.slice().reverse().concat(c) };
  if (style === 'sweet') return { a: s.concat(c), b: s.slice(3).concat(s.slice(0, 3)) };
  if (style === 'funny') return { a: f.concat(c), b: f.slice(3).concat(f.slice(0, 3)) };
  return { a: s.concat(c), b: f.concat(c) };
}
function helloOptions(story, role) {
  const n = story.hellos.filter((h) => h.from === role).length; // rotate: never the same pair back-to-back
  const { a, b } = helloPools(story);
  const one = a[n % a.length]; let two = b[n % b.length];
  if (two.id === one.id) two = b[(n + 1) % b.length];
  return [{ ...one, kind: 'text', tone: 'sweet' }, { ...two, kind: 'text', tone: 'funny' }];
}
function helloText(story, id) {
  const [list, i] = String(id).split(':'); const idx = Number(i);
  const pool = { s: HELLO_SWEET, f: HELLO_FUNNY, c: story.helloSettings.custom || [] }[list];
  if (!pool || !Number.isInteger(idx) || idx < 0 || idx >= pool.length) return null;
  const st = story.helloSettings.style;
  if (list === 'c' && !pool.length) return null;
  if (st === 'custom' && list !== 'c') return null;
  if (st === 'sweet' && list === 'f') return null;
  if (st === 'funny' && list === 's') return null;
  return pool[idx];
}
export function helloEligibility(story, role, at = now()) {
  if (!story.helloSettings.enabled) return { ok: false, reason: 'disabled' };
  if (waitingRole(story) !== role) return { ok: false, reason: 'not-waiting' };
  const wait = story.lastActivityAt + HELLO_WAIT_MS;
  if (at < wait) return { ok: false, reason: 'too-soon', at: wait };
  const next = (story.helloLast[role] || 0) + HELLO_INTERVAL_MS;
  if (at < next) return { ok: false, reason: 'sent-recently', at: next };
  return { ok: true };
}

// What the purchasing parent/guardian sees: oversight and controls, never recording.
export function guardianState(story) {
  norm(story);
  const ci = currentIndex(story);
  const name = (r) => (r === 'child' ? story.childName : story.grandparentName);
  return {
    role: 'guardian', childName: story.childName, grandparentName: story.grandparentName, test: story.test,
    expiresAt: story.expiresAt, completed: Math.min(ci, STOPS.length), done: ci >= STOPS.length, completedAt: story.completedAt || null,
    consent: story.consent ? { parentName: story.consent.parentName, at: story.consent.at } : null,
    consentNeeded: !story.test && !story.consent,
    childPaused: !!story.childPaused, helloSettings: story.helloSettings,
    hellos: story.hellos.slice(-30).reverse().map((h) => ({ id: h.id, kind: h.kind, text: h.text || '', at: h.at, from: h.from, fromName: name(h.from), toName: name(h.from === 'child' ? 'grandparent' : 'child') })),
    conversations: story.stops.map((s, i) => ((s.q || s.a) ? { n: i + 1, title: STOPS[i].title, question: s.chosen?.text || '', hasQ: !!s.q, hasA: !!s.a } : null)).filter(Boolean),
    keepsake: ci >= STOPS.length ? { status: story.keepsake.status, items: story.keepsake.status === 'ready' ? story.keepsake.items : [] } : null,
    availableUntil: ci >= STOPS.length ? story.expiresAt : null,
    deletionRequestedAt: story.deletionRequestedAt || null, limits: LIMITS, retentionDays: RETENTION_DAYS_AFTER_COMPLETION,
    childAccess: childAccessView(story),
    photos: photoList(story, 'guardian', false), canAddPhotos: true, photoMax: PHOTO_MAX,
    publication: publicationView(story, 'parent'),
  };
}

// Publishing (unlisted YouTube + the magnet's movie page) needs a separate yes from BOTH the parent and the grandparent.
export function publishAllowed(story) {
  const p = norm(story).publication;
  return p.parent?.choice === 'share' && p.grandparent?.choice === 'share';
}
export function publicationView(story, side) {
  const p = norm(story).publication;
  const mine = p[side];
  return { side, mine: mine ? { choice: mine.choice, name: mine.name, at: mine.at } : null, allowed: publishAllowed(story), otherAnswered: !!p[side === 'parent' ? 'grandparent' : 'parent'] };
}
function pubSide(story, role, own) { if (role === 'grandparent') return 'grandparent'; return isController(story, role, own) ? 'parent' : null; }

// Who may add photos: the parent (parent login or parent-held family link) and the grandparent. Never a child's own link.
function canAddPhotos(story, role, own) { return !own && (role === 'grandparent' || isController(story, role, own)); }
function photoList(story, role, own) {
  const parentSide = isController(story, role, own);
  return story.photos.map((p) => ({ id: p.id, caption: p.caption, by: p.by, at: p.at, canDelete: parentSide || (p.by === role && !own) }));
}

// What the parent sees about the child's own link (never the form itself).
export function childAccessView(story) {
  const a = norm(story).childAccess;
  return {
    status: a.status, basis: a.basis, enabled: !!a.enabled, linkActive: kidAllowed(story),
    formUploadedAt: a.form?.uploadedAt || null, reviewNote: a.status === 'rejected' ? (a.note || '') : '',
    baseConsent: !!(story.consent || story.test),
  };
}
// Who may manage the child's own link: the parent login if there is one, otherwise the parent-held family link.
function isController(story, role, own) {
  if (own) return false;
  if (story.tokenHashes.guardian) return role === 'guardian';
  return role === 'child';
}

export function publicState(story, role, own = false) {
  norm(story);
  if (role === 'guardian') return guardianState(story);
  const ci = currentIndex(story);
  const stops = STOPS.map((def, i) => ({
    n: def.n, chapter: def.chapter, title: def.title,
    status: i < ci ? 'done' : i === ci ? stopStatus(story, i) : 'locked',
  }));
  const cur = ci < STOPS.length ? story.stops[ci] : null;
  const def = ci < STOPS.length ? STOPS[ci] : null;
  const other = role === 'child' ? 'grandparent' : 'child';
  const out = {
    role, childName: story.childName, grandparentName: story.grandparentName,
    qrCode: story.qrCodes?.[role] || story.qrCode, test: story.test, expiresAt: story.expiresAt,
    consentNeeded: role === 'child' && !own && !story.test && !story.consent,
    own: role === 'child' && !!own, // true = the child's own link; false = the parent-held family link
    childAccess: isController(story, role, own) ? childAccessView(story) : null,
    photos: photoList(story, role, own), canAddPhotos: canAddPhotos(story, role, own), photoMax: PHOTO_MAX,
    publication: pubSide(story, role, own) && ci >= STOPS.length ? publicationView(story, pubSide(story, role, own)) : null,
    guardianManaged: !!story.tokenHashes.guardian, paused: role === 'child' && !!story.childPaused,
    availableUntil: ci >= STOPS.length ? story.expiresAt : null,
    done: ci >= STOPS.length, completed: Math.min(ci, STOPS.length),
    chapters: CHAPTERS, stops, introDone: !!story.intro, closingDone: !!story.closing,
    limits: LIMITS, current: null, draft: '',
    // finished conversations the participant can replay (real recordings only)
    conversations: story.stops.map((s, i) => (s.heardAt ? { n: i + 1, title: STOPS[i].title, question: s.chosen?.text || '' } : null)).filter(Boolean),
    keepsake: ci >= STOPS.length ? { status: story.keepsake.status, items: story.keepsake.status === 'ready' ? story.keepsake.items : [] } : null,
    hellos: story.hellos.filter((h) => h.from === other).slice(-20).reverse().map((h) => ({ id: h.id, kind: h.kind, text: h.text || '', at: h.at, read: !!h.readAt })),
    helloOffer: null,
  };
  const el = helloEligibility(story, role);
  if (el.ok) out.helloOffer = { options: helloOptions(story, role), voiceLimit: LIMITS.hello, from: role === 'child' ? story.childName : story.grandparentName };
  if (cur) {
    out.current = {
      n: def.n, title: def.title, status: stopStatus(story, ci),
      choices: def.choices.filter((c) => !cur.skipped.includes(c.id)).map((c) => ({ id: c.id, text: c.text, type: c.type, sensitive: c.sensitive })),
      chosen: cur.chosen,
    };
    // the grandparent sees the child's pick only once the question is actually recorded
    if (role === 'grandparent' && !cur.q) out.current.chosen = null;
    // each person only ever sees their OWN preparation notes for the open stop
    out.draft = story.drafts[`${role}-${def.n}`]?.text || '';
  }
  return out;
}

// ---------- actions ----------
export async function recordConsent(store, token, { parentName, agree, pin }) {
  const { story, role, own } = await authorize(store, token, { pin });
  if (role === 'grandparent' || own) fail(403, 'Only the parent can give consent.');
  if (role === 'child' && story.tokenHashes.guardian) fail(403, 'A parent needs to say yes from their own parent link.');
  if (!agree || !String(parentName || '').trim()) fail(400, 'Parent name and agreement are required.');
  story.consent = { parentName: String(parentName).trim().slice(0, 80), version: CONSENT_VERSION, at: now() };
  await store.setJSON(`story/${story.id}`, story);
  return { ok: true };
}

export async function choose(store, token, { n, qid, custom, pin }) {
  const { story, role, own } = await authorize(store, token, { pin });
  if (role !== 'child') fail(403, 'Only the child picks the question.');
  assertNotPaused(story, role);
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
  return publicState(story, role, own);
}

// ----- teleprompter drafts (private to the author; server-side so they survive refresh and device changes) -----
export async function saveDraft(store, token, { n, text, pin }) {
  const { story, role } = await authorize(store, token, { pin });
  if (role === 'guardian') fail(403, 'Parents do not write recording notes.');
  assertNotPaused(story, role);
  const i = currentIndex(story);
  if (n !== STOPS[i]?.n) fail(409, 'That stop is not open.');
  const st = stopStatus(story, i);
  const allowed = role === 'child' ? ['choose', 'record-question'] : ['awaiting-answer'];
  if (!allowed.includes(st)) fail(409, 'Nothing to prepare right now.');
  const t = String(text == null ? '' : text).slice(0, DRAFT_MAX);
  const key = `${role}-${n}`;
  if (!t.trim()) delete story.drafts[key]; else story.drafts[key] = { text: t, at: now() };
  await store.setJSON(`story/${story.id}`, story);
  return { ok: true, saved: t.length };
}

const ROLE_SLOT = { child: ['question', 'hello'], grandparent: ['answer', 'intro', 'closing', 'hello'], guardian: [] };
const PAUSED = 'Your parent has paused this for now. Ask them to turn it back on.';
const assertNotPaused = (story, role) => { if (role === 'child' && story.childPaused) fail(403, PAUSED); };

export async function upload(store, token, { n, slot, data, durationSec, uploadId, contentType, pin }) {
  const { story, role, own } = await authorize(store, token, { pin });
  if (!ROLE_SLOT[role].includes(slot)) fail(403, 'This link cannot record that.');
  assertNotPaused(story, role);
  if (role === 'child' && !story.test && !story.consent) fail(403, 'A parent must give consent before recording.');
  if (!data || !data.length) fail(400, 'Empty recording.');
  if (data.length > MAX_BYTES) fail(413, 'Recording is too large.');
  const limit = LIMITS[slot];
  if (!(durationSec > 0) || durationSec > limit + DURATION_SLACK) fail(400, `Recording must be ${limit} seconds or less.`);
  if (!/^audio\//.test(String(contentType || ''))) fail(415, 'Audio only.');

  // ---- Little Hello voice (never touches progress or the 48h inactivity clock) ----
  if (slot === 'hello') {
    const dup = story.hellos.find((h) => h.from === role && h.uploadId && h.uploadId === uploadId);
    if (dup) return { ok: true, duplicate: true };
    const el = helloEligibility(story, role);
    if (!el.ok) fail(409, 'A Little Hello is not available right now.');
    const id = newToken(6);
    const key = `audio/${story.id}/hello-${id}`;
    await store.setBlob(key, data, { contentType, durationSec });
    story.hellos.push({ id, from: role, kind: 'voice', at: now(), uploadId: String(uploadId || ''), audio: { key, durationSec, contentType, bytes: data.length } });
    story.helloLast[role] = now();
    await store.setJSON(`story/${story.id}`, story);
    return { ok: true, state: publicState(story, role, own) };
  }

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
  if (slot === 'question' || slot === 'answer') { story.lastActivityAt = now(); delete story.drafts[`${role}-${n}`]; } // notes stay private and are dropped once recorded
  await store.setJSON(`story/${story.id}`, story);
  return { ok: true, state: publicState(story, role, own) };
}

export async function markHeard(store, token, { n, pin }) {
  const { story, role, own } = await authorize(store, token, { pin });
  if (role !== 'child') fail(403, 'Only the child unlocks the next stop.');
  assertNotPaused(story, role);
  const i = currentIndex(story);
  if (n !== STOPS[i]?.n) fail(409, 'That stop is not open.');
  if (!story.stops[i].a) fail(409, 'The answer has not been recorded yet.');
  story.stops[i].heardAt = now();
  story.lastActivityAt = now();
  if (currentIndex(story) >= STOPS.length) { // retention policy: the keepsake stays open 12 months after completion
    story.completedAt = now();
    story.expiresAt = Math.max(story.expiresAt, story.completedAt + RETENTION_DAYS_AFTER_COMPLETION * 86400e3);
  }
  await store.setJSON(`story/${story.id}`, story);
  return publicState(story, role, own);
}

// grandparent may skip a question they'd rather not answer: the child picks again
export async function skipQuestion(store, token, { n, pin }) {
  const { story, role } = await authorize(store, token, { pin });
  if (role !== 'grandparent') fail(403, 'Only the grandparent can skip.');
  const i = currentIndex(story);
  if (n !== STOPS[i]?.n) fail(409, 'That stop is not open.');
  const cur = story.stops[i];
  if (!cur.q) fail(409, 'No question to skip.');
  if (cur.a) fail(409, 'Already answered.');
  if (cur.chosen?.id && cur.chosen.id !== 'custom') cur.skipped.push(cur.chosen.id);
  await store.del(cur.q.key);
  cur.q = null; cur.chosen = null;
  story.lastActivityAt = now();
  await store.setJSON(`story/${story.id}`, story);
  return publicState(story, role);
}

// ----- Little Hellos (text) -----
export async function sendHello(store, token, { suggestion, pin }) {
  const { story, role, own } = await authorize(store, token, { pin });
  if (role === 'guardian') fail(403, 'Parents manage Little Hellos from the parent page.');
  assertNotPaused(story, role);
  const el = helloEligibility(story, role);
  if (!el.ok) fail(409, 'A Little Hello is not available right now.');
  const text = helloText(story, suggestion);
  if (!text) fail(400, 'Unknown suggestion.');
  story.hellos.push({ id: newToken(6), from: role, kind: 'text', text: String(text).slice(0, HELLO_TEXT_MAX), at: now() });
  story.helloLast[role] = now();
  await store.setJSON(`story/${story.id}`, story);
  return { ok: true, state: publicState(story, role, own) };
}
export async function markHelloRead(store, token, { id, pin }) {
  const { story, role } = await authorize(store, token, { pin });
  if (role === 'guardian') return { ok: true };
  const h = story.hellos.find((x) => x.id === id && x.from !== role);
  if (!h) fail(404, 'No such message.');
  if (!h.readAt) { h.readAt = now(); await store.setJSON(`story/${story.id}`, story); }
  return { ok: true };
}

// ----- parent/guardian controls (server checks the role; the purchaser decides) -----
export async function guardianUpdate(store, token, input) {
  const { story, role } = await authorize(store, token, { pin: input.pin });
  if (role !== 'guardian') fail(403, 'Only the parent can change these settings.');
  if (typeof input.childPaused === 'boolean') story.childPaused = input.childPaused;
  if (input.hello) {
    const { enabled, style, custom } = input.hello;
    if (!['both', 'sweet', 'funny', 'custom'].includes(style || 'both')) fail(400, 'Bad style.');
    const list = (Array.isArray(custom) ? custom : []).map((t) => String(t).trim()).filter(Boolean);
    if (list.length > 10) fail(400, 'At most 10 custom messages.');
    if (list.some((t) => t.length > HELLO_TEXT_MAX)) fail(400, `Messages are limited to ${HELLO_TEXT_MAX} characters.`);
    if ((style || 'both') === 'custom' && !list.length) fail(400, 'Add at least one custom message.');
    story.helloSettings = { enabled: enabled !== false, style: style || 'both', custom: list };
  }
  if (input.requestDeletion === true) story.deletionRequestedAt = story.deletionRequestedAt || now();
  if (input.requestDeletion === false) story.deletionRequestedAt = null;
  await store.setJSON(`story/${story.id}`, story);
  return guardianState(story);
}

// ----- the child's own link (parent decides; Dan only reviews signed forms) -----
const accessLog = (a, event, extra = {}) => { a.history = [...(a.history || []), { event, at: now(), ...extra }].slice(-50); };
async function controller(store, token, pin) {
  const ctx = await authorize(store, token, { pin });
  if (!isController(ctx.story, ctx.role, ctx.own)) fail(403, 'Only the parent can change this.');
  if (!ctx.story.consent && !ctx.story.test) fail(409, 'Please give permission for recording first.');
  return ctx;
}
const stateFor = (story, role, own) => (role === 'guardian' ? guardianState(story) : publicState(story, role, own));

// Parent confirms the child is 13 or older: COPPA does not apply, so no form is needed.
export async function childAccessTeen(store, token, { parentName, agree, pin }) {
  const { story, role, own } = await controller(store, token, pin);
  const name = String(parentName || '').trim().slice(0, 80);
  if (!agree || !name) fail(400, 'Your name and the confirmation are required.');
  const a = story.childAccess;
  if (a.status === 'approved') fail(409, 'Already approved.');
  Object.assign(a, { status: 'approved', basis: 'age-13-plus', parentName: name, decidedAt: now(), version: CHILD_ACCESS_VERSION, note: '' });
  accessLog(a, 'teen-confirmed', { parentName: name });
  await store.setJSON(`story/${story.id}`, story);
  return stateFor(story, role, own);
}

// Parent uploads a signed consent form (photo or PDF) for a child under 13. Dan reviews it.
export async function uploadConsentForm(store, token, { data, contentType, parentName, pin }) {
  const { story, role, own } = await controller(store, token, pin);
  const name = String(parentName || '').trim().slice(0, 80);
  if (!name) fail(400, 'Please type your name.');
  if (!data || !data.length) fail(400, 'Please choose a photo or PDF of the signed form.');
  if (data.length > FORM_MAX_BYTES) fail(413, 'That file is too large. Please use a photo under 4 MB.');
  if (!FORM_TYPES.includes(String(contentType || ''))) fail(415, 'Please upload a photo (JPG, PNG, HEIC) or a PDF.');
  const a = story.childAccess;
  if (a.status === 'approved') fail(409, 'Already approved.');
  const key = `audio/${story.id}/consent-form`; // private store; served only through an admin-signed link
  await store.setBlob(key, data, { contentType });
  a.form = { key, contentType, bytes: data.length, uploadedAt: now(), parentName: name };
  Object.assign(a, { status: 'pending', basis: 'signed-form', parentName: name, note: '', version: CHILD_ACCESS_VERSION });
  accessLog(a, 'form-uploaded', { parentName: name });
  await store.setJSON(`story/${story.id}`, story);
  return stateFor(story, role, own);
}

// Parent switches the child's own link on (returns the new link token ONCE) or off (link dies immediately).
export async function setChildLink(store, token, { on, pin }) {
  const { story, role, own } = await controller(store, token, pin);
  const a = story.childAccess;
  if (story.tokenHashes.kid) { await store.del(`token/${story.tokenHashes.kid}`); delete story.tokenHashes.kid; }
  await dropSessions(store, story, 'kid');
  let link = null;
  if (on) {
    if (a.status !== 'approved') fail(409, 'The child\'s own link can be turned on only after permission is approved.');
    link = newToken();
    story.tokenHashes.kid = sha(link);
    await store.setJSON(`token/${story.tokenHashes.kid}`, { storyId: story.id, role: 'child', own: true });
    a.enabled = true; accessLog(a, 'link-on');
  } else { a.enabled = false; accessLog(a, 'link-off'); }
  await store.setJSON(`story/${story.id}`, story);
  return { link, state: stateFor(story, role, own) };
}

// Parent withdraws permission for the child's own link entirely (link off; a new yes is needed to turn it back on).
export async function withdrawChildAccess(store, token, { pin }) {
  const { story, role, own } = await controller(store, token, pin);
  const a = story.childAccess;
  if (story.tokenHashes.kid) { await store.del(`token/${story.tokenHashes.kid}`); delete story.tokenHashes.kid; }
  await dropSessions(store, story, 'kid');
  Object.assign(a, { status: 'none', basis: null, enabled: false, note: '' });
  accessLog(a, 'withdrawn');
  await store.setJSON(`story/${story.id}`, story);
  return stateFor(story, role, own);
}

// Dan reviews an uploaded form. Approval does NOT turn the link on: the parent still decides.
export async function reviewConsentForm(store, storyId, { approve, note }) {
  const story = norm(await store.getJSON(`story/${storyId}`) || fail(404, 'No such story.'));
  const a = story.childAccess;
  if (a.status !== 'pending' || !a.form) fail(409, 'There is no form waiting for review.');
  a.status = approve ? 'approved' : 'rejected';
  a.note = approve ? '' : String(note || 'Please upload a clear photo of the signed form.').slice(0, 300);
  a.decidedAt = now();
  accessLog(a, approve ? 'form-approved' : 'form-rejected', approve ? {} : { note: a.note });
  await store.setJSON(`story/${storyId}`, story);
  return { status: a.status };
}

// ----- publication consent (Stage 2): each side answers for themselves; either can change their answer later -----
export async function setPublication(store, token, { choice, name, agree, pin }) {
  const { story, role, own } = await authorize(store, token, { pin });
  const side = pubSide(story, role, own);
  if (!side) fail(403, 'Only the parent and the grandparent can decide this.');
  if (currentIndex(story) < STOPS.length) fail(409, 'This comes after all 30 conversations are finished.');
  if (!['private', 'share'].includes(choice)) fail(400, 'Please choose an option.');
  const nm = String(name || '').trim().slice(0, 80);
  if (!nm || !agree) fail(400, 'Your name and the confirmation are required.');
  const p = story.publication;
  const was = publishAllowed(story);
  p[side] = { choice, name: nm, at: now(), version: PUBLICATION_VERSION };
  p.history = [...(p.history || []), { side, choice, name: nm, at: now() }].slice(-50);
  if (was && !publishAllowed(story)) story.unpublishRequestedAt = now(); // someone took back their yes: Dan must take it down
  await store.setJSON(`story/${story.id}`, story);
  return stateFor(story, role, own);
}

// ----- family photos (for the movie and storybook) -----
export async function uploadPhoto(store, token, { data, contentType, caption, uploadId, pin }) {
  const { story, role, own } = await authorize(store, token, { pin });
  if (!canAddPhotos(story, role, own)) fail(403, 'Only a parent or the grandparent can add photos.');
  if (role !== 'grandparent' && !story.consent && !story.test) fail(409, 'Please give permission for recording first.');
  const dup = story.photos.find((p) => uploadId && p.uploadId === uploadId);
  if (dup) return { ok: true, duplicate: true, state: stateFor(story, role, own) };
  if (story.photos.length >= PHOTO_MAX) fail(409, `This story already has ${PHOTO_MAX} photos. Remove one to add another.`);
  if (!data || !data.length) fail(400, 'Empty photo.');
  if (data.length > PHOTO_MAX_BYTES) fail(413, 'That photo is too large.');
  if (!PHOTO_TYPES.includes(String(contentType || ''))) fail(415, 'Please choose a photo (JPG, PNG or HEIC).');
  const id = newToken(6);
  const key = `audio/${story.id}/photo-${id}`; // private store; served only through short-lived signed links
  await store.setBlob(key, data, { contentType });
  story.photos.push({ id, key, by: role, caption: String(caption || '').trim().slice(0, 150), at: now(), bytes: data.length, contentType, uploadId: String(uploadId || '').slice(0, 60) });
  await store.setJSON(`story/${story.id}`, story);
  return { ok: true, state: stateFor(story, role, own) };
}
export async function deletePhoto(store, token, { id, pin }) {
  const { story, role, own } = await authorize(store, token, { pin });
  const i = story.photos.findIndex((p) => p.id === id);
  if (i < 0) fail(404, 'No such photo.');
  if (!photoList(story, role, own)[i].canDelete) fail(403, 'You can remove only photos you added.');
  await store.del(story.photos[i].key);
  story.photos.splice(i, 1);
  await store.setJSON(`story/${story.id}`, story);
  return stateFor(story, role, own);
}

// ----- admin audit log: every admin look at private material, and every admin change -----
export const AUDIT_MAX = 300;
export async function auditLog(store, storyId, action, detail = '') {
  const story = await store.getJSON(`story/${storyId}`);
  if (!story) return;
  story.audit = [...(story.audit || []), { at: now(), action: String(action).slice(0, 40), detail: String(detail || '').slice(0, 120) }].slice(-AUDIT_MAX);
  await store.setJSON(`story/${storyId}`, story);
}

// ----- admin-side settings (callers verify admin) -----
export async function setHelloSettings(store, storyId, { enabled, style, custom }) {
  const story = norm(await store.getJSON(`story/${storyId}`) || fail(404, 'No such story.'));
  if (!['both', 'sweet', 'funny', 'custom'].includes(style || 'both')) fail(400, 'Bad style.');
  const list = (Array.isArray(custom) ? custom : []).map((t) => String(t).trim()).filter(Boolean);
  if (list.length > 10) fail(400, 'At most 10 custom messages.');
  if (list.some((t) => t.length > HELLO_TEXT_MAX)) fail(400, `Messages are limited to ${HELLO_TEXT_MAX} characters.`);
  if ((style || 'both') === 'custom' && !list.length) fail(400, 'Add at least one custom message.');
  story.helloSettings = { enabled: enabled !== false, style: style || 'both', custom: list };
  await store.setJSON(`story/${storyId}`, story);
  return story.helloSettings;
}
export async function setStoryPin(store, storyId, role, pin) {
  const story = norm(await store.getJSON(`story/${storyId}`) || fail(404, 'No such story.'));
  setPin(story, role, pin);
  await store.setJSON(`story/${storyId}`, story);
  return { ok: true, set: pinRequired(story, role) };
}
export async function setKeepsake(store, storyId, { status, items }) {
  const story = norm(await store.getJSON(`story/${storyId}`) || fail(404, 'No such story.'));
  if (!['preparing', 'ready'].includes(status)) fail(400, 'Bad status.');
  const list = (Array.isArray(items) ? items : []).slice(0, 10).map((x) => ({ label: String(x.label || '').slice(0, 60), url: String(x.url || '').slice(0, 500) }));
  if (list.some((x) => !x.label || !/^https:\/\//.test(x.url))) fail(400, 'Each item needs a label and an https link.');
  if (status === 'ready' && !list.length) fail(400, 'Add at least one item before marking the keepsake ready.');
  if (list.some((x) => /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)\//i.test(x.url.replace(/^https:\/\//, ''))) && !publishAllowed(story)) {
    fail(409, 'A YouTube link needs a "share" answer from both the parent and the grandparent first.');
  }
  story.keepsake = { status, items: list };
  await store.setJSON(`story/${storyId}`, story);
  return story.keepsake;
}

// What each role may hear, decided here (never by the browser).
export async function mediaAccess(store, secret, token, { n, slot, id, pin }) {
  const { story, role } = await authorize(store, token, { pin });
  const i = currentIndex(story);
  const idx = STOPS.findIndex((s) => s.n === n);
  let item; let key;
  if (slot === 'question' || slot === 'answer') {
    item = story.stops[idx]?.[slot === 'question' ? 'q' : 'a'];
    // the open stop, or any stop already finished (replay); never a future one
    if (idx < 0 || idx > i) fail(403, 'Not available.');
    key = slotKey(n, slot);
  } else if (slot === 'intro' || slot === 'closing') {
    item = story[slot]; key = slot;
  } else if (slot === 'photo') {
    const ph = story.photos.find((x) => x.id === id);
    if (!ph) fail(404, 'No such photo.');
    item = ph; key = `photo-${id}`;
  } else if (slot === 'hello') {
    const h = story.hellos.find((x) => x.id === id && x.kind === 'voice');
    if (!h) fail(404, 'Nothing recorded yet.');
    item = h.audio; key = slotKey(0, 'hello', id); // both sender and recipient are in this story
  } else fail(400, 'Bad slot.');
  if (!item) fail(404, 'Nothing recorded yet.');
  const s = signMedia(secret, story.id, key);
  return { url: `/api/fmm/audio?s=${story.id}&k=${encodeURIComponent(key)}&e=${s.exp}&sig=${s.sig}`, expiresIn: SIGNED_URL_SECONDS };
}

export async function readSignedAudio(store, secret, { s, k, e, sig }) {
  if (!verifyMedia(secret, s, k, e, sig)) fail(403, 'Link expired.');
  const blob = await store.getBlob(`audio/${s}/${k}`);
  if (!blob) fail(404, 'Not found.');
  return blob;
}

// Public QR page: always the same sentence; leaks nothing about whether a code exists.
export const QR_MESSAGE = 'A Family Memory Magnets story is being created.';
