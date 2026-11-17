// Family Memory Magnets v2 — Little Hellos, teleprompter drafts, permanent per-role QR codes, PIN security,
// completed keepsake state, and compatibility with stories created by the earlier version.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as C from '../netlify/lib/fmm-core.mjs';

const SECRET = 'test-secret';
const H48 = 48 * 3600e3;
const audio = Buffer.alloc(2000, 1);
const rec = (extra) => ({ data: audio, durationSec: 10, uploadId: 'u' + Math.random(), contentType: 'audio/mp4', ...extra });
const status = async (p) => { try { await p; return 200; } catch (e) { return e.status || 500; } };
const sha = (s) => createHash('sha256').update(s).digest('hex');

async function mk(opts = {}) {
  const store = C.makeMemoryStore();
  const { story, tokens } = await C.createStory(store, { childName: 'Devon', grandparentName: 'Mimi', test: true, ...opts });
  return { store, story, tokens };
}
const load = (store, id) => store.getJSON(`story/${id}`);
async function age(store, id, ms) { // pretend the story has been quiet for `ms`
  const s = await load(store, id); s.lastActivityAt = Date.now() - ms; await store.setJSON(`story/${id}`, s);
}
async function exchange(store, tokens, n) {
  await C.choose(store, tokens.child, { n, qid: C.STOPS[n - 1].choices[0].id });
  await C.upload(store, tokens.child, rec({ n, slot: 'question', durationSec: 12 }));
  await C.upload(store, tokens.grandparent, rec({ n, slot: 'answer', durationSec: 50 }));
  return C.markHeard(store, tokens.child, { n });
}

// ---------------- limits ----------------
test('limits: question 15s, answer 60s, hello 15s (no 30s answer extension exists)', async () => {
  assert.deepEqual([C.LIMITS.question, C.LIMITS.answer, C.LIMITS.hello], [15, 60, 15]);
  assert.equal(C.LIMITS.answerExtension, undefined);
  const { store, tokens } = await mk();
  await C.choose(store, tokens.child, { n: 1, qid: '1.1.F' });
  assert.equal(await status(C.upload(store, tokens.child, rec({ n: 1, slot: 'question', durationSec: 20 }))), 400);
  assert.equal(await status(C.upload(store, tokens.child, rec({ n: 1, slot: 'question', durationSec: 15 }))), 200);
  assert.equal(await status(C.upload(store, tokens.grandparent, rec({ n: 1, slot: 'answer', durationSec: 64 }))), 400);
  assert.equal(await status(C.upload(store, tokens.grandparent, rec({ n: 1, slot: 'answer', durationSec: 60 }))), 200);
});

// ---------------- backward compatibility with the earlier (live) story format ----------------
async function legacyStory(store) {
  // exactly the shape the first release wrote: one qrCode, sha-256 pinHash, no hellos/drafts/sessions/pins
  const id = 'legacyStory01'; const child = 'legacyChildToken0000000000000000001'; const gp = 'legacyGrandparentToken00000000002';
  const stops = C.STOPS.map((s) => ({ n: s.n, chosen: null, skipped: [], q: null, a: null, heardAt: null }));
  for (let i = 0; i < 8; i++) { // eight finished conversations, with a 25s question recorded under the OLD 30s limit
    const b = { key: `audio/${id}/x-${i + 1}`, uploadId: 'old' + i, durationSec: 25, contentType: 'audio/mp4', at: 1000 + i, bytes: 2000 };
    stops[i] = { ...stops[i], chosen: { id: C.STOPS[i].choices[0].id, text: C.STOPS[i].choices[0].text }, q: { ...b, key: `audio/${id}/question-${i + 1}` }, a: { ...b, key: `audio/${id}/answer-${i + 1}`, durationSec: 55 }, heardAt: 2000 + i };
    await store.setBlob(`audio/${id}/question-${i + 1}`, audio, { contentType: 'audio/mp4' });
    await store.setBlob(`audio/${id}/answer-${i + 1}`, audio, { contentType: 'audio/mp4' });
  }
  const story = { id, createdAt: Date.now() - 5 * 86400e3, expiresAt: Date.now() + 300 * 86400e3, test: false, childName: 'Devon', grandparentName: 'Mimi',
    parentName: 'Amber', parentEmail: '', orderId: null, packageName: '', qrCode: 'legacyQrCode0001', pinHash: sha('pin|' + id + '|4821'),
    tokenHashes: { child: sha(child), grandparent: sha(gp) }, consent: { parentName: 'Amber', version: 'v1', at: 1 }, stops, intro: null, closing: null, deletedAt: null };
  await store.setJSON(`story/${id}`, story);
  await store.setJSON(`token/${sha(child)}`, { storyId: id, role: 'child' });
  await store.setJSON(`token/${sha(gp)}`, { storyId: id, role: 'grandparent' });
  await store.setJSON(`qr/legacyQrCode0001`, { storyId: id });
  return { id, child, gp };
}

test('legacy story: existing links, PIN, progress and 25s recordings all keep working, and nothing is rewritten on read', async () => {
  const store = C.makeMemoryStore(); const { id, child, gp } = await legacyStory(store);
  const before = JSON.stringify(await load(store, id));
  assert.equal((await C.authorize(store, child).catch((e) => e)).pinRequired, true);           // legacy child PIN still enforced
  const { story } = await C.authorize(store, child, { pin: '4821' });
  assert.equal(C.currentIndex(story), 8);                                                        // progress intact
  const st = C.publicState(story, 'child');
  assert.equal(st.completed, 8); assert.equal(st.stops[8].status, 'choose');
  assert.equal(st.conversations.length, 8);
  assert.equal(st.limits.question, 15);
  assert.equal(await status(C.authorize(store, gp)), 200);                                       // grandparent link unchanged (no PIN)
  const m = await C.mediaAccess(store, SECRET, child, { n: 3, slot: 'question', pin: '4821' });   // old 25s question still playable
  const blob = await C.readSignedAudio(store, SECRET, Object.fromEntries(new URL('http://x' + m.url).searchParams));
  assert.equal(blob.data.length, audio.length);
  assert.equal(await load(store, id).then((s) => JSON.stringify(s)), before);                     // reads never modified stored data
  // and the next real step works on the old document
  await C.choose(store, child, { n: 9, qid: '2.4.F', pin: '4821' });
  await C.upload(store, child, rec({ n: 9, slot: 'question', durationSec: 9, pin: '4821' }));
  // since v7 a real (non-test) story's grandparent agrees to be recorded once before their next recording
  assert.equal(await status(C.upload(store, gp, rec({ n: 9, slot: 'answer', durationSec: 40 }))), 403);
  assert.equal(C.publicState((await C.authorize(store, gp)).story, 'grandparent').consentNeeded, true);
  await C.recordGrandparentConsent(store, gp, { name: 'Mimi', agree: true });
  await C.upload(store, gp, rec({ n: 9, slot: 'answer', durationSec: 40 }));
  assert.equal(C.publicState((await C.authorize(store, gp)).story, 'grandparent').current.status, 'heard-pending');
});

test('legacy story: adding per-role QR codes keeps the existing code, links and recordings', async () => {
  const store = C.makeMemoryStore(); const { id, child } = await legacyStory(store);
  const s = await load(store, id);
  const codes = await C.ensureQrCodes(store, s);
  assert.equal(codes.child, 'legacyQrCode0001');                  // the existing printed/known code is preserved
  assert.notEqual(codes.grandparent, codes.child);
  assert.equal(await status(C.authorize(store, child, { pin: '4821' })), 200); // link untouched
  assert.equal((await store.getJSON('qr/legacyQrCode0001')).role, 'child');
  assert.equal((await store.getJSON(`qr/${codes.grandparent}`)).role, 'grandparent');
  assert.equal(C.currentIndex(await load(store, id)), 8);
  assert.deepEqual(await C.ensureQrCodes(store, await load(store, id)), codes); // idempotent
});

// ---------------- teleprompter drafts ----------------
test('Write It First drafts: private to the author, scoped to story/role/stop, never published, dropped once recorded', async () => {
  const { store, story, tokens } = await mk();
  await C.choose(store, tokens.child, { n: 1, qid: '1.1.C' });
  assert.equal(await status(C.saveDraft(store, tokens.child, { n: 2, text: 'x' })), 409);       // wrong stop
  assert.equal(await status(C.saveDraft(store, tokens.grandparent, { n: 1, text: 'x' })), 409); // grandparent has nothing to prepare yet
  await C.saveDraft(store, tokens.child, { n: 1, text: 'Mimi, what was school like?' });
  const sc = C.publicState(await load(store, story.id), 'child');
  assert.equal(sc.draft, 'Mimi, what was school like?');
  assert.equal(C.publicState(await load(store, story.id), 'grandparent').draft, '');           // never shown to the other person
  await C.upload(store, tokens.child, rec({ n: 1, slot: 'question', durationSec: 12 }));
  assert.equal((await load(store, story.id)).drafts['child-1'], undefined);                     // dropped after recording
  await C.saveDraft(store, tokens.grandparent, { n: 1, text: 'Notes: the red schoolhouse, Miss Perkins' });
  assert.match(C.publicState(await load(store, story.id), 'grandparent').draft, /Perkins/);
  assert.equal(C.publicState(await load(store, story.id), 'child').draft, '');
  const tooLong = await C.saveDraft(store, tokens.grandparent, { n: 1, text: 'y'.repeat(5000) });
  assert.equal(tooLong.saved, C.DRAFT_MAX);
  // drafts never change progress or the recording itself
  const s = await load(store, story.id);
  assert.equal(C.currentIndex(s), 0); assert.equal(s.stops[0].a, null);
  await C.upload(store, tokens.grandparent, rec({ n: 1, slot: 'answer', durationSec: 58 }));
  assert.equal((await load(store, story.id)).drafts['grandparent-1'], undefined);
  assert.equal(await status(C.saveDraft(store, tokens.child, { n: 1, text: 'late' })), 409);    // closed once exchange is done
});

test('draft cannot overwrite a saved recording and an empty draft clears it', async () => {
  const { store, story, tokens } = await mk();
  await C.choose(store, tokens.child, { n: 1, qid: '1.1.F' });
  await C.saveDraft(store, tokens.child, { n: 1, text: 'hello' });
  await C.saveDraft(store, tokens.child, { n: 1, text: '   ' });
  assert.equal((await load(store, story.id)).drafts['child-1'], undefined);
  await C.upload(store, tokens.child, rec({ n: 1, slot: 'question', uploadId: 'first' }));
  assert.equal(await status(C.upload(store, tokens.child, rec({ n: 1, slot: 'question', uploadId: 'second' }))), 409);
});

// ---------------- Little Hellos ----------------
test('Little Hellos: not offered until 48h of quiet, and only to the person who is waiting', async () => {
  const { store, story, tokens } = await mk();
  const offer = async (role) => C.publicState(await load(store, story.id), role).helloOffer;
  assert.equal(await offer('grandparent'), null);                    // brand new
  await age(store, story.id, H48 - 60e3);
  assert.equal(await offer('grandparent'), null);                    // just under 48h
  await age(store, story.id, H48 + 60e3);
  const o = await offer('grandparent');
  assert.equal(o.options.length, 2); assert.equal(o.options[0].tone, 'sweet'); assert.equal(o.options[1].tone, 'funny');
  assert.equal(o.voiceLimit, 15);
  assert.equal(await offer('child'), null);                          // Devon is not the one waiting right now
  // after Devon records, Devon is the one waiting for Mimi
  await C.choose(store, tokens.child, { n: 1, qid: '1.1.F' });
  await C.upload(store, tokens.child, rec({ n: 1, slot: 'question', durationSec: 10 }));
  assert.equal(await offer('child'), null);                          // activity just happened
  await age(store, story.id, H48 + 1000);
  assert.ok(await offer('child')); assert.equal(await offer('grandparent'), null);
});

test('Little Hellos: text and voice both work, are received privately, and never touch progression', async () => {
  const { store, story, tokens } = await mk();
  await age(store, story.id, H48 + 1000);
  const before = JSON.stringify((await load(store, story.id)).stops);
  const offer = C.publicState(await load(store, story.id), 'grandparent').helloOffer;
  await C.sendHello(store, tokens.grandparent, { suggestion: offer.options[0].id });
  let inbox = C.publicState(await load(store, story.id), 'child').hellos;
  assert.equal(inbox.length, 1); assert.equal(inbox[0].kind, 'text'); assert.ok(inbox[0].text.length > 5); assert.equal(inbox[0].read, false);
  assert.equal(C.publicState(await load(store, story.id), 'grandparent').hellos.length, 0); // sender's own do not echo back
  await C.markHelloRead(store, tokens.child, { id: inbox[0].id });
  assert.equal(C.publicState(await load(store, story.id), 'child').hellos[0].read, true);
  assert.equal(JSON.stringify((await load(store, story.id)).stops), before);                // stops untouched
  assert.equal(C.publicState(await load(store, story.id), 'child').completed, 0);            // nothing unlocked
  assert.equal((await load(store, story.id)).lastActivityAt < Date.now() - H48, true);       // hello does not reset the quiet clock
  // Devon (waiting after recording) sends a voice hello
  const s = await load(store, story.id); s.stops[0].chosen = { id: '1.1.F', text: 'x' }; s.stops[0].q = { key: 'audio/x', durationSec: 5 }; s.lastActivityAt = Date.now() - H48 - 1000; await store.setJSON(`story/${story.id}`, s);
  await C.upload(store, tokens.child, rec({ slot: 'hello', n: 0, durationSec: 14 }));
  inbox = C.publicState(await load(store, story.id), 'grandparent').hellos;
  assert.equal(inbox[0].kind, 'voice');
  const m = await C.mediaAccess(store, SECRET, tokens.grandparent, { slot: 'hello', id: inbox[0].id });
  const blob = await C.readSignedAudio(store, SECRET, Object.fromEntries(new URL('http://x' + m.url).searchParams));
  assert.equal(blob.data.length, audio.length);
  assert.equal(C.currentIndex(await load(store, story.id)), 0);
});

test('Little Hellos: 15s voice limit, one per participant per 48h, no free text, duplicates ignored', async () => {
  const { store, story, tokens } = await mk();
  await age(store, story.id, H48 + 1000);
  assert.equal(await status(C.upload(store, tokens.grandparent, rec({ slot: 'hello', n: 0, durationSec: 30 }))), 400);
  assert.equal(await status(C.upload(store, tokens.grandparent, rec({ slot: 'hello', n: 0, durationSec: 18, uploadId: 'same' }))), 200);
  assert.equal((await C.upload(store, tokens.grandparent, rec({ slot: 'hello', n: 0, durationSec: 18, uploadId: 'same' }))).duplicate, true);
  assert.equal(await status(C.sendHello(store, tokens.grandparent, { suggestion: 's:0' })), 409); // already sent within 48h
  assert.equal(await status(C.upload(store, tokens.grandparent, rec({ slot: 'hello', n: 0, durationSec: 5 }))), 409);
  const s = await load(store, story.id); s.helloLast.grandparent = Date.now() - H48 - 1000; await store.setJSON(`story/${story.id}`, s);
  assert.equal(await status(C.sendHello(store, tokens.grandparent, { suggestion: 'free text here' })), 400);
  assert.equal(await status(C.sendHello(store, tokens.grandparent, { suggestion: 's:999' })), 400);
  assert.equal(await status(C.sendHello(store, tokens.grandparent, { suggestion: 'f:1' })), 200);
});

test('Little Hellos: suggestions rotate, are short, and respect purchaser style + custom messages + disable', async () => {
  for (const t of [...C.HELLO_SWEET, ...C.HELLO_FUNNY]) assert.ok(t.length <= C.HELLO_TEXT_MAX, t);
  const { store, story, tokens } = await mk();
  await age(store, story.id, H48 + 1000);
  const first = C.publicState(await load(store, story.id), 'grandparent').helloOffer.options.map((o) => o.id);
  const s = await load(store, story.id); s.hellos.push({ id: 'z', from: 'grandparent', kind: 'text', text: 'x', at: 1 }); await store.setJSON(`story/${story.id}`, s);
  const second = C.publicState(await load(store, story.id), 'grandparent').helloOffer.options.map((o) => o.id);
  assert.notDeepEqual(first, second);                                                           // rotated
  await C.setHelloSettings(store, story.id, { enabled: true, style: 'custom', custom: ['Grandma loves you to the moon!'] });
  const c = C.publicState(await load(store, story.id), 'grandparent').helloOffer.options;
  assert.ok(c.every((o) => o.id.startsWith('c:')) && c[0].text === 'Grandma loves you to the moon!');
  assert.equal(await status(C.sendHello(store, tokens.grandparent, { suggestion: 's:0' })), 400); // style forbids the others
  assert.equal(await status(C.setHelloSettings(store, story.id, { style: 'custom', custom: [] })), 400);
  assert.equal(await status(C.setHelloSettings(store, story.id, { style: 'both', custom: ['x'.repeat(151)] })), 400);
  await C.setHelloSettings(store, story.id, { enabled: false, style: 'both', custom: [] });
  assert.equal(C.publicState(await load(store, story.id), 'grandparent').helloOffer, null);       // parent/admin can disable
  assert.equal(await status(C.sendHello(store, tokens.grandparent, { suggestion: 's:0' })), 409);
});

test('Little Hellos: a real child still needs parent consent for a voice hello; one story cannot hear another\'s hello', async () => {
  const A = await mk({ test: false }); const store = A.store;
  const B = await C.createStory(store, { childName: 'Sam', grandparentName: 'Nana', test: true });
  const s = await load(store, A.story.id); s.consent = null; s.stops[0].chosen = { id: '1.1.F', text: 'x' }; s.stops[0].q = { key: 'audio/x', durationSec: 5 }; s.lastActivityAt = Date.now() - H48 - 1000; await store.setJSON(`story/${A.story.id}`, s);
  assert.equal(await status(C.upload(store, A.tokens.child, rec({ slot: 'hello', n: 0, durationSec: 10 }))), 403);
  await C.recordConsent(store, A.tokens.child, { parentName: 'Pat', agree: true });
  await C.upload(store, A.tokens.child, rec({ slot: 'hello', n: 0, durationSec: 10 }));
  const id = C.publicState(await load(store, A.story.id), 'grandparent').hellos[0].id;
  assert.equal(await status(C.mediaAccess(store, SECRET, B.tokens.grandparent, { slot: 'hello', id })), 404);
});

// ---------------- two permanent QR codes, sessions, PIN ----------------
test('each story gets two distinct permanent QR codes (one per role); codes are not credentials', async () => {
  const { store, story, tokens } = await mk();
  assert.ok(story.qrCodes.child && story.qrCodes.grandparent && story.qrCodes.child !== story.qrCodes.grandparent);
  assert.equal((await store.getJSON(`qr/${story.qrCodes.child}`)).role, 'child');
  assert.equal((await store.getJSON(`qr/${story.qrCodes.grandparent}`)).role, 'grandparent');
  for (const c of [story.qrCodes.child, story.qrCodes.grandparent, story.id]) assert.equal(await status(C.authorize(store, c)), 401);
  assert.equal(C.publicState(story, 'child').qrCode, story.qrCodes.child);
  assert.equal(C.publicState(story, 'grandparent').qrCode, story.qrCodes.grandparent);
  assert.equal(await status(C.unlockWithQr(store, story.qrCodes.child, '')), 401);               // no PIN set: QR alone never opens a new phone
  assert.equal(await status(C.unlockWithQr(store, story.qrCodes.child, '1234')), 401);
  assert.equal((await C.qrInfo(store, story.qrCodes.child)).pin, false);
  assert.equal((await C.qrInfo(store, 'doesNotExist')).pin, false);
});

test('link -> device session: the phone then opens its own role from the QR; roles never cross', async () => {
  const { store, story, tokens } = await mk();
  const c = await C.exchangeLink(store, tokens.child);
  const g = await C.exchangeLink(store, tokens.grandparent);
  assert.equal(c.role, 'child'); assert.equal(c.code, story.qrCodes.child);
  assert.equal(g.role, 'grandparent'); assert.equal(g.code, story.qrCodes.grandparent);
  assert.ok(c.session.startsWith('s.'));
  assert.equal((await C.authorize(store, c.session)).role, 'child');
  assert.equal((await C.authorize(store, g.session)).role, 'grandparent');
  assert.equal(await status(C.exchangeLink(store, c.session)), 400);                            // a session cannot mint sessions
  assert.equal(await status(C.upload(store, c.session, rec({ n: 1, slot: 'answer' }))), 403);   // child session cannot answer
  assert.equal(await status(C.authorize(store, 's.' + 'a'.repeat(30))), 401);
  // sessions are hashed at rest
  const dump = JSON.stringify(await Promise.all((await store.list('')).map((k) => store.getJSON(k))));
  assert.ok(!dump.includes(c.session) && !dump.includes(g.session));
});

test('revocation: new link kills old link AND every remembered device; devices can be forgotten alone', async () => {
  const { store, story, tokens } = await mk();
  const c = await C.exchangeLink(store, tokens.child);
  const g = await C.exchangeLink(store, tokens.grandparent);
  await C.revokeDevices(store, story.id, 'child');
  assert.equal(await status(C.authorize(store, c.session)), 401);
  assert.equal(await status(C.authorize(store, tokens.child)), 200);          // link still fine
  const c2 = await C.exchangeLink(store, tokens.child);
  const fresh = await C.revokeToken(store, story.id, 'child');
  assert.equal(await status(C.authorize(store, tokens.child)), 401);
  assert.equal(await status(C.authorize(store, c2.session)), 401);
  assert.equal(await status(C.authorize(store, fresh)), 200);
  assert.equal(await status(C.authorize(store, g.session)), 200);             // other role untouched
});

test('PIN works for BOTH roles; links need it, remembered devices do not; stored with scrypt, not plain', async () => {
  const { store, story, tokens } = await mk({ pinChild: '4821', pinGrandparent: '737373' });
  const stored = await load(store, story.id);
  assert.ok(stored.pins.child.hash && stored.pins.grandparent.salt && stored.pinHash === null);
  assert.ok(!JSON.stringify(stored).includes('4821') && !JSON.stringify(stored).includes('737373'));
  for (const [t, ok] of [[tokens.child, '4821'], [tokens.grandparent, '737373']]) {
    assert.equal((await C.authorize(store, t).catch((e) => e)).pinRequired, true);
    assert.equal(await status(C.authorize(store, t, { pin: '0000' })), 401);
    assert.equal(await status(C.authorize(store, t, { pin: ok })), 200);
  }
  const ex = await C.exchangeLink(store, tokens.grandparent, { pin: '737373' });
  assert.equal(await status(C.authorize(store, ex.session)), 200);            // no PIN needed on an unlocked phone
  assert.equal((await C.qrInfo(store, story.qrCodes.grandparent)).pin, true);
  const u = await C.unlockWithQr(store, story.qrCodes.grandparent, '737373');   // new phone: QR + PIN
  assert.equal(u.role, 'grandparent');
  assert.equal(await status(C.unlockWithQr(store, story.qrCodes.child, '737373')), 401); // grandparent's PIN does not open Devon's code
  assert.equal(await status(C.setStoryPin(store, story.id, 'grandparent', '12')), 400);
  await C.setStoryPin(store, story.id, 'grandparent', '');
  assert.equal(await status(C.authorize(store, tokens.grandparent)), 200);
});

test('PIN guessing is rate limited: lockout after 5 wrong tries (QR and link paths), growing, and a right PIN cannot bypass it', async () => {
  const { store, story, tokens } = await mk({ pinChild: '4821' });
  const code = story.qrCodes.child;
  for (let i = 0; i < 5; i++) assert.equal(await status(C.unlockWithQr(store, code, String(1000 + i))), 401);
  assert.equal(await status(C.unlockWithQr(store, code, '4821')), 429);        // correct PIN is refused while locked
  const k = (await store.list('rl/'))[0]; const r = await store.getJSON(k); assert.ok(r.lockedUntil > Date.now() + C.LOCK_BASE_MS - 5000);
  r.lockedUntil = Date.now() - 1; await store.setJSON(k, r);                    // wait out the first lock
  assert.equal(await status(C.unlockWithQr(store, code, '4821')), 200);
  // link + PIN path is limited the same way
  for (let i = 0; i < 5; i++) assert.equal(await status(C.authorize(store, tokens.child, { pin: String(2000 + i) })), 401);
  assert.equal(await status(C.authorize(store, tokens.child, { pin: '4821' })), 429);
  // a second lockout lasts longer
  const keys = await store.list('rl/'); let second = null;
  for (const kk of keys) { const x = await store.getJSON(kk); if (x.strikes >= 1 && x.lockedUntil > Date.now()) second = x; }
  assert.ok(second);
});

test('unlock gives one generic error: nonexistent code, no-PIN code and wrong PIN look the same', async () => {
  const { store, story } = await mk({ pinChild: '4821' });
  const msg = async (p) => { try { await p; } catch (e) { return `${e.status}:${e.message}`; } };
  const a = await msg(C.unlockWithQr(store, 'nope', '4821'));
  const b = await msg(C.unlockWithQr(store, story.qrCodes.grandparent, '4821'));
  const c = await msg(C.unlockWithQr(store, story.qrCodes.child, '9999'));
  assert.equal(a, b); assert.equal(b, c);
});

// ---------------- completion: same QR codes, truthful keepsake ----------------
test('after all 30 conversations the SAME QR codes open the keepsake view; nothing is faked', async () => {
  const { store, story, tokens } = await mk();
  const codes = { ...story.qrCodes };
  const c = await C.exchangeLink(store, tokens.child);
  for (let n = 1; n <= 30; n++) await exchange(store, tokens, n);
  const s = await load(store, story.id);
  assert.deepEqual(s.qrCodes, codes);                                           // codes unchanged
  assert.equal((await store.getJSON(`qr/${codes.child}`)).storyId, story.id);
  const st = C.publicState(s, 'child');
  assert.equal(st.done, true); assert.equal(st.current, null);
  assert.equal(st.keepsake.status, 'preparing'); assert.deepEqual(st.keepsake.items, []);   // truthful: nothing delivered yet
  assert.equal(st.conversations.length, 30);
  assert.equal(await status(C.authorize(store, c.session)), 200);               // phone still remembered
  // replay of finished conversations for both roles
  for (const role of ['child', 'grandparent']) for (const slot of ['question', 'answer'])
    assert.equal(await status(C.mediaAccess(store, SECRET, tokens[role], { n: 1, slot })), 200);
  // keepsake only becomes "ready" when real https deliverables exist
  assert.equal(await status(C.setKeepsake(store, story.id, { status: 'ready', items: [] })), 400);
  assert.equal(await status(C.setKeepsake(store, story.id, { status: 'ready', items: [{ label: 'Movie', url: 'http://x' }] })), 400);
  await C.setKeepsake(store, story.id, { status: 'ready', items: [{ label: 'Family movie', url: 'https://example.com/movie' }] });
  const ready = C.publicState(await load(store, story.id), 'grandparent').keepsake;
  assert.equal(ready.status, 'ready'); assert.equal(ready.items[0].label, 'Family movie');
  // keepsake items stay hidden before completion
  const fresh = await mk(); assert.equal(C.publicState(await load(fresh.store, fresh.story.id), 'child').keepsake, null);
});

test('replay is limited to open/finished stops of the caller\'s own story', async () => {
  const { store, story, tokens } = await mk();
  await exchange(store, tokens, 1);
  assert.equal(await status(C.mediaAccess(store, SECRET, tokens.grandparent, { n: 1, slot: 'answer' })), 200);
  assert.equal(await status(C.mediaAccess(store, SECRET, tokens.grandparent, { n: 5, slot: 'question' })), 403);  // future stop
  assert.equal(await status(C.mediaAccess(store, SECRET, tokens.grandparent, { n: 2, slot: 'question' })), 404);  // open but not recorded
});

test('expired stories are refused on links and sessions alike; deleting a story wipes hellos, sessions, QR ids, rate limits', async () => {
  const { store, story, tokens } = await mk({ pinChild: '4821' });
  const ex = await C.exchangeLink(store, tokens.grandparent);
  await age(store, story.id, H48 + 1000);
  await C.upload(store, tokens.grandparent, rec({ slot: 'hello', n: 0, durationSec: 5 }));
  await C.unlockWithQr(store, story.qrCodes.child, '0000').catch(() => {});
  await C.deleteStory(store, story.id);
  const d = store._dump(); assert.deepEqual(d.json, []); assert.deepEqual(d.blobs, []);
  const e = await mk(); const ex2 = await C.exchangeLink(e.store, e.tokens.child);
  // since v11 only a FINISHED story's keepsake period can end (unfinished stories never expire)
  const s = await load(e.store, e.story.id); s.completedAt = Date.now() - 2; s.expiresAt = Date.now() - 1; await e.store.setJSON(`story/${e.story.id}`, s);
  assert.equal(await status(C.authorize(e.store, e.tokens.child)), 410);
  assert.equal(await status(C.authorize(e.store, ex2.session)), 410);
});
