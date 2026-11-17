// Family Memory Magnets — critical acceptance tests.  Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../netlify/lib/fmm-core.mjs';

const SECRET = 'test-secret';
const audio = Buffer.alloc(2000, 1);
const rec = (extra) => ({ data: audio, durationSec: 10, uploadId: 'u' + Math.random(), contentType: 'audio/mp4', ...extra });
const status = async (p) => { try { await p; return 200; } catch (e) { return e.status || 500; } };

async function mk(opts = {}) {
  const store = C.makeMemoryStore();
  const { story, tokens } = await C.createStory(store, { childName: 'Devon', grandparentName: 'Mimi', test: true, ...opts });
  return { store, story, tokens };
}
async function exchange(store, tokens, n, qid) {
  const st = await C.choose(store, tokens.child, { n, qid });
  await C.upload(store, tokens.child, rec({ n, slot: 'question' }));
  await C.upload(store, tokens.grandparent, rec({ n, slot: 'answer' }));
  return C.markHeard(store, tokens.child, { n });
}

test('Devon & Mimi: choose -> record question -> Mimi hears & answers -> Devon hears -> next stop unlocks', async () => {
  const { store, story, tokens } = await mk();
  let s = C.publicState(story, 'child');
  assert.equal(s.stops[0].status, 'choose');
  assert.equal(s.stops[1].status, 'locked');
  assert.equal(s.current.choices.length, 3);
  await C.choose(store, tokens.child, { n: 1, qid: '1.1.C' });
  await C.upload(store, tokens.child, rec({ n: 1, slot: 'question' }));
  // Mimi hears the ACTUAL recorded question
  const q = await C.mediaAccess(store, SECRET, tokens.grandparent, { n: 1, slot: 'question' });
  const blob = await C.readSignedAudio(store, SECRET, Object.fromEntries(new URL('http://x' + q.url).searchParams));
  assert.equal(blob.data.length, audio.length);
  await C.upload(store, tokens.grandparent, rec({ n: 1, slot: 'answer', durationSec: 55 }));
  // Stop is NOT unlocked until Devon has heard the answer
  s = C.publicState(await store.getJSON(`story/${story.id}`), 'child');
  assert.equal(s.stops[1].status, 'locked');
  const a = await C.mediaAccess(store, SECRET, tokens.child, { n: 1, slot: 'answer' });
  assert.ok(a.url.includes('/api/fmm/audio'));
  s = await C.markHeard(store, tokens.child, { n: 1 });
  assert.equal(s.stops[0].status, 'done');
  assert.equal(s.stops[1].status, 'choose');
  assert.equal(s.completed, 1);
});

test('all 30 stops complete -> story is done, closing message allowed only then', async () => {
  const { store, tokens } = await mk();
  assert.equal(await status(C.upload(store, tokens.grandparent, rec({ slot: 'closing', durationSec: 100 }))), 409);
  let s;
  for (let n = 1; n <= 30; n++) {
    const def = C.STOPS[n - 1];
    s = await exchange(store, tokens, n, def.choices[0].id);
  }
  assert.equal(s.done, true);
  assert.equal(s.completed, 30);
  assert.equal(await status(C.upload(store, tokens.grandparent, rec({ slot: 'closing', durationSec: 100 }))), 200);
});

test('question bank: 6 chapters x 5 stops x 3 choices = 90, chronological', () => {
  assert.equal(C.STOPS.length, 30);
  assert.equal(C.CHAPTERS.length, 6);
  assert.equal(C.STOPS.reduce((a, s) => a + s.choices.length, 0), 90);
  C.STOPS.forEach((s, i) => assert.equal(s.chapter, Math.floor(i / 5) + 1));
});

test('consent: real (non-test) child cannot record until parent consent is recorded; no bypass', async () => {
  const { store, tokens } = await mk({ test: false });
  await C.choose(store, tokens.child, { n: 1, qid: '1.1.F' });
  assert.equal(await status(C.upload(store, tokens.child, rec({ n: 1, slot: 'question' }))), 403);
  assert.equal(await status(C.recordConsent(store, tokens.grandparent, { parentName: 'X', agree: true })), 403);
  assert.equal(await status(C.recordConsent(store, tokens.child, { parentName: '', agree: true })), 400);
  assert.equal(await status(C.recordConsent(store, tokens.child, { parentName: 'Pat', agree: false })), 400);
  await C.recordConsent(store, tokens.child, { parentName: 'Pat', agree: true });
  assert.equal(await status(C.upload(store, tokens.child, rec({ n: 1, slot: 'question' }))), 200);
});

test('story isolation: a token never reaches another story; media URLs are story-bound', async () => {
  const A = await mk(); const store = A.store;
  const B = await C.createStory(store, { childName: 'Sam', grandparentName: 'Nana', test: true });
  await C.choose(store, A.tokens.child, { n: 1, qid: '1.1.F' });
  await C.upload(store, A.tokens.child, rec({ n: 1, slot: 'question' }));
  const sa = C.publicState((await C.authorize(store, A.tokens.child)).story, 'child');
  const sb = C.publicState((await C.authorize(store, B.tokens.child)).story, 'child');
  assert.equal(sa.childName, 'Devon'); assert.equal(sb.childName, 'Sam');
  assert.equal(sb.stops[0].status, 'choose'); // B untouched by A
  // B's grandparent has nothing to hear and cannot read A's audio
  assert.equal(await status(C.mediaAccess(store, SECRET, B.tokens.grandparent, { n: 1, slot: 'question' })), 404);
  const q = await C.mediaAccess(store, SECRET, A.tokens.grandparent, { n: 1, slot: 'question' });
  const p = Object.fromEntries(new URL('http://x' + q.url).searchParams);
  assert.equal(await status(C.readSignedAudio(store, SECRET, { ...p, s: B.story.id })), 403); // signature bound to story
  assert.equal(await status(C.authorize(store, 'nonsense')), 401);
  assert.equal(await status(C.authorize(store, A.story.qrCode)), 401); // public QR code is NOT a token
  assert.equal(await status(C.authorize(store, A.story.id)), 401); // story id is NOT a token
});

test('immediate revocation: old link dies the moment a new one is issued', async () => {
  const { store, story, tokens } = await mk();
  assert.equal(await status(C.authorize(store, tokens.grandparent)), 200);
  const fresh = await C.revokeToken(store, story.id, 'grandparent');
  assert.equal(await status(C.authorize(store, tokens.grandparent)), 401);
  assert.equal(await status(C.authorize(store, fresh)), 200);
  assert.equal(await status(C.authorize(store, tokens.child)), 200); // other role unaffected
});

test('tokens are stored only as hashes', async () => {
  const { store, tokens } = await mk();
  const dump = JSON.stringify(await Promise.all((await store.list('')).map((k) => store.getJSON(k))));
  assert.ok(!dump.includes(tokens.child));
  assert.ok(!dump.includes(tokens.grandparent));
});

test('role separation: child cannot record answers; grandparent cannot record questions or pick', async () => {
  const { store, tokens } = await mk();
  await C.choose(store, tokens.child, { n: 1, qid: '1.1.F' });
  assert.equal(await status(C.upload(store, tokens.child, rec({ n: 1, slot: 'answer' }))), 403);
  assert.equal(await status(C.upload(store, tokens.grandparent, rec({ n: 1, slot: 'question' }))), 403);
  assert.equal(await status(C.choose(store, tokens.grandparent, { n: 1, qid: '1.1.F' })), 403);
  assert.equal(await status(C.markHeard(store, tokens.grandparent, { n: 1 })), 403);
});

test('order is enforced: cannot answer before question, skip ahead, or unlock without an answer', async () => {
  const { store, tokens } = await mk();
  assert.equal(await status(C.upload(store, tokens.child, rec({ n: 1, slot: 'question' }))), 409); // no pick yet
  await C.choose(store, tokens.child, { n: 1, qid: '1.1.F' });
  assert.equal(await status(C.upload(store, tokens.grandparent, rec({ n: 1, slot: 'answer' }))), 409); // no question yet
  assert.equal(await status(C.choose(store, tokens.child, { n: 2, qid: '1.2.F' })), 409); // stop 2 locked
  await C.upload(store, tokens.child, rec({ n: 1, slot: 'question' }));
  assert.equal(await status(C.markHeard(store, tokens.child, { n: 1 })), 409); // no answer yet
  assert.equal(await status(C.mediaAccess(store, SECRET, tokens.child, { n: 1, slot: 'answer' })), 404);
  assert.equal(await status(C.mediaAccess(store, SECRET, tokens.grandparent, { n: 2, slot: 'question' })), 403);
});

test('duplicate uploads: same upload id is idempotent; a second different recording is refused', async () => {
  const { store, tokens } = await mk();
  await C.choose(store, tokens.child, { n: 1, qid: '1.1.F' });
  const r = rec({ n: 1, slot: 'question', uploadId: 'same' });
  assert.equal((await C.upload(store, tokens.child, r)).duplicate, undefined);
  assert.equal((await C.upload(store, tokens.child, r)).duplicate, true);
  assert.equal(await status(C.upload(store, tokens.child, rec({ n: 1, slot: 'question', uploadId: 'other' }))), 409);
});

test('limits: 15s question, 60s answer, 15s hello, size cap, audio only', async () => {
  const { store, tokens } = await mk();
  await C.choose(store, tokens.child, { n: 1, qid: '1.1.F' });
  assert.equal(await status(C.upload(store, tokens.child, rec({ n: 1, slot: 'question', durationSec: 30 }))), 400); // old 30s limit is gone
  assert.equal(await status(C.upload(store, tokens.child, rec({ n: 1, slot: 'question', data: Buffer.alloc(5 * 1024 * 1024) }))), 413);
  assert.equal(await status(C.upload(store, tokens.child, rec({ n: 1, slot: 'question', contentType: 'video/mp4' }))), 415);
  assert.equal(await status(C.upload(store, tokens.child, rec({ n: 1, slot: 'question', durationSec: 16 }))), 200); // small timing slack
  assert.equal(await status(C.upload(store, tokens.grandparent, rec({ n: 1, slot: 'answer', durationSec: 75 }))), 400);
  assert.equal(await status(C.upload(store, tokens.grandparent, rec({ slot: 'intro', durationSec: 118 }))), 200);
});

test('signed media URLs expire and cannot be tampered with', async () => {
  const k = C.signMedia(SECRET, 's1', 'question-1', 300);
  assert.equal(C.verifyMedia(SECRET, 's1', 'question-1', k.exp, k.sig), true);
  assert.equal(C.verifyMedia(SECRET, 's1', 'answer-1', k.exp, k.sig), false);
  assert.equal(C.verifyMedia('wrong', 's1', 'question-1', k.exp, k.sig), false);
  const old = C.signMedia(SECRET, 's1', 'question-1', -5);
  assert.equal(C.verifyMedia(SECRET, 's1', 'question-1', old.exp, old.sig), false);
});

test('grandparent can skip a question; child must pick a different one; skipped audio is deleted', async () => {
  const { store, tokens } = await mk();
  await C.choose(store, tokens.child, { n: 1, qid: '1.1.M' });
  await C.upload(store, tokens.child, rec({ n: 1, slot: 'question' }));
  const s = await C.skipQuestion(store, tokens.grandparent, { n: 1 });
  assert.equal(s.current.status, 'choose');
  assert.equal(s.current.choices.length, 2);
  assert.ok(!s.current.choices.some((c) => c.id === '1.1.M'));
  assert.equal(await status(C.mediaAccess(store, SECRET, tokens.child, { n: 1, slot: 'question' })), 404);
  assert.equal(await status(C.choose(store, tokens.child, { n: 1, qid: '1.1.M' })), 400);
});

test('custom question is allowed and length-capped', async () => {
  const { store, tokens } = await mk();
  const s = await C.choose(store, tokens.child, { n: 1, custom: 'x'.repeat(500) });
  assert.equal(s.current.chosen.text.length, 200);
  assert.equal(s.current.chosen.custom, true);
});

test('optional PIN protects the child link', async () => {
  const { store, tokens } = await mk({ pin: '4821' });
  assert.equal((await C.authorize(store, tokens.child).catch((e) => e)).pinRequired, true);
  assert.equal(await status(C.authorize(store, tokens.child, { pin: '0000' })), 401);
  assert.equal(await status(C.authorize(store, tokens.child, { pin: '4821' })), 200);
  assert.equal(await status(C.authorize(store, tokens.grandparent)), 200); // grandparent needs no PIN
});

test('no deadline while recording; a finished story closes 12 months after completion', async () => {
  const { store, story, tokens } = await mk();
  story.expiresAt = Date.now() - 1000; await store.setJSON(`story/${story.id}`, story); // an old-style date on an unfinished story
  assert.equal(await status(C.authorize(store, tokens.child)), 200);                  // is ignored
  story.completedAt = Date.now() - 2000; await store.setJSON(`story/${story.id}`, story);
  assert.equal(await status(C.authorize(store, tokens.child)), 410);
});

test('deleting a story removes recordings, tokens and QR mapping', async () => {
  const { store, story, tokens } = await mk();
  await exchange(store, tokens, 1, '1.1.F');
  await C.upload(store, tokens.grandparent, rec({ slot: 'intro' }));
  await C.deleteStory(store, story.id);
  const d = store._dump();
  assert.deepEqual(d.json, []); assert.deepEqual(d.blobs, []);
  assert.equal(await status(C.authorize(store, tokens.child)), 401);
});

test('public QR message is fixed and the QR code never works as a token', () => {
  assert.equal(C.QR_MESSAGE, 'A Family Memory Magnets story is being created.');
});

test('admin sessions verify and expire', () => {
  const t = C.adminSession(SECRET);
  assert.equal(C.verifyAdmin(SECRET, t), true);
  assert.equal(C.verifyAdmin('other', t), false);
  assert.equal(C.verifyAdmin(SECRET, '1.abc'), false);
  assert.equal(C.verifyAdmin(SECRET, ''), false);
});
