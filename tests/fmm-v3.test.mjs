// Approved question bank lock, optional parent/guardian login, pause, retention after completion.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as C from '../netlify/lib/fmm-core.mjs';
import QUESTIONS from '../netlify/lib/fmm-questions.mjs';

const SECRET = 'test-secret';
const audio = Buffer.alloc(2000, 1);
const rec = (extra) => ({ data: audio, durationSec: 10, uploadId: 'u' + Math.random(), contentType: 'audio/mp4', ...extra });
const status = async (p) => { try { await p; return 200; } catch (e) { return e.status || 500; } };
const load = (store, id) => store.getJSON(`story/${id}`);
async function mk(opts = {}) {
  const store = C.makeMemoryStore();
  const { story, tokens } = await C.createStory(store, { childName: 'Devon', grandparentName: 'Mimi', test: true, ...opts });
  return { store, story, tokens };
}
async function exchange(store, tokens, n) {
  await C.choose(store, tokens.child, { n, qid: C.STOPS[n - 1].choices[0].id });
  await C.upload(store, tokens.child, rec({ n, slot: 'question', durationSec: 12 }));
  await C.upload(store, tokens.grandparent, rec({ n, slot: 'answer', durationSec: 50 }));
  return C.markHeard(store, tokens.child, { n });
}

test('approved question bank is locked: any wording change fails this test', () => {
  const canon = QUESTIONS.stops.flatMap((s) => s.choices.map((c) => `${c.id}|${c.text}`)).join('\n');
  assert.equal(canon.split('\n').length, 90);
  assert.equal(QUESTIONS.version, 'approved-1.0');
  assert.equal(createHash('sha256').update(canon).digest('hex'), '3b240b8af66088ac7ebd78b451f9de43b8f3295464d85b7e4f9ab206ac16dec5');
});

test('parent login is OPTIONAL: stories without one behave exactly as before', async () => {
  const { store, story, tokens } = await mk();
  assert.equal(tokens.guardian, undefined); assert.equal(story.tokenHashes.guardian, undefined);
  const st = C.publicState(await load(store, story.id), 'child');
  assert.equal(st.guardianManaged, false); assert.equal(st.paused, false);
});

test('parent login can be chosen at setup or added later; it is a third, separate credential', async () => {
  const { store, story, tokens } = await mk({ guardian: true });
  assert.ok(tokens.guardian && story.guardianCode);
  const g = await C.authorize(store, tokens.guardian);
  assert.equal(g.role, 'guardian');
  assert.equal(await status(C.authorize(store, story.guardianCode)), 401);           // the code is not a credential
  const later = await mk(); const t = await C.addGuardian(later.store, later.story.id);
  assert.equal((await C.authorize(later.store, t)).role, 'guardian');
  assert.equal(await status(C.addGuardian(later.store, later.story.id)), 409);       // no silent replacement
  const ex = await C.exchangeLink(store, tokens.guardian);                           // devices + PIN work for the parent too
  assert.equal(ex.role, 'guardian'); assert.equal((await C.authorize(store, ex.session)).role, 'guardian');
  await C.setStoryPin(store, story.id, 'guardian', '9090');
  assert.equal((await C.authorize(store, tokens.guardian).catch((e) => e)).pinRequired, true);
  assert.equal(await status(C.authorize(store, tokens.guardian, { pin: '9090' })), 200);
  const rv = await C.revokeToken(store, story.id, 'guardian');
  assert.equal(await status(C.authorize(store, ex.session)), 401);                    // remembered phones dropped
  assert.equal(await status(C.authorize(store, tokens.guardian, { pin: '9090' })), 401);
  assert.equal(await status(C.authorize(store, rv, { pin: '9090' })), 200);
  const none = await mk(); assert.equal(await status(C.revokeToken(none.store, none.story.id, 'guardian')), 404);
  assert.equal(await status(C.setStoryPin(none.store, none.story.id, 'guardian', '1234')), 400);
});

test('parent can oversee but never record, choose, answer or unlock', async () => {
  const { store, story, tokens } = await mk({ guardian: true });
  await C.choose(store, tokens.child, { n: 1, qid: '1.1.F' });
  await C.upload(store, tokens.child, rec({ n: 1, slot: 'question' }));
  for (const slot of ['question', 'answer', 'intro', 'closing', 'hello']) assert.equal(await status(C.upload(store, tokens.guardian, rec({ n: 1, slot }))), 403);
  assert.equal(await status(C.choose(store, tokens.guardian, { n: 1, qid: '1.1.F' })), 403);
  assert.equal(await status(C.markHeard(store, tokens.guardian, { n: 1 })), 403);
  assert.equal(await status(C.skipQuestion(store, tokens.guardian, { n: 1 })), 403);
  assert.equal(await status(C.saveDraft(store, tokens.guardian, { n: 1, text: 'x' })), 403);
  assert.equal(await status(C.sendHello(store, tokens.guardian, { suggestion: 's:0' })), 403);
  const gs = C.publicState(await load(store, story.id), 'guardian');
  assert.equal(gs.role, 'guardian'); assert.equal(gs.conversations.length, 1); assert.equal(gs.completed, 0);
  assert.ok(!('draft' in gs) && !('current' in gs));                                  // never sees anyone's private notes
  assert.equal(await status(C.mediaAccess(store, SECRET, tokens.guardian, { n: 1, slot: 'question' })), 200); // may review recordings
});

test('purchaser controls consent: with a parent login only the parent link can say yes', async () => {
  const { store, story, tokens } = await mk({ test: false, guardian: true });
  assert.equal(await status(C.recordConsent(store, tokens.child, { parentName: 'Kid', agree: true })), 403);
  assert.equal(await status(C.recordConsent(store, tokens.grandparent, { parentName: 'Mimi', agree: true })), 403);
  await C.choose(store, tokens.child, { n: 1, qid: '1.1.F' });
  assert.equal(await status(C.upload(store, tokens.child, rec({ n: 1, slot: 'question' }))), 403);   // still blocked
  assert.equal(C.publicState(await load(store, story.id), 'guardian').consentNeeded, true);
  await C.recordConsent(store, tokens.guardian, { parentName: 'Amber', agree: true });
  assert.equal(C.publicState(await load(store, story.id), 'guardian').consentNeeded, false);
  assert.equal(await status(C.upload(store, tokens.child, rec({ n: 1, slot: 'question' }))), 200);
  // without a parent login the old behaviour (child link can give consent) is unchanged
  const old = await mk({ test: false }); assert.equal(await status(C.recordConsent(old.store, old.tokens.child, { parentName: 'Pat', agree: true })), 200);
});

test('parent can pause and resume the child; pause blocks every child action but not the grandparent', async () => {
  const { store, story, tokens } = await mk({ guardian: true });
  await C.guardianUpdate(store, tokens.guardian, { childPaused: true });
  assert.equal(C.publicState(await load(store, story.id), 'child').paused, true);
  assert.equal(await status(C.choose(store, tokens.child, { n: 1, qid: '1.1.F' })), 403);
  assert.equal(await status(C.upload(store, tokens.child, rec({ n: 1, slot: 'question' }))), 403);
  assert.equal(await status(C.upload(store, tokens.child, rec({ slot: 'hello', n: 0 }))), 403);
  assert.equal(await status(C.sendHello(store, tokens.child, { suggestion: 's:0' })), 403);
  assert.equal(await status(C.authorize(store, tokens.grandparent)), 200);
  assert.equal(await status(C.guardianUpdate(store, tokens.child, { childPaused: false })), 403);       // a child cannot un-pause
  assert.equal(await status(C.guardianUpdate(store, tokens.grandparent, { childPaused: false })), 403);
  await C.guardianUpdate(store, tokens.guardian, { childPaused: false });
  assert.equal(await status(C.choose(store, tokens.child, { n: 1, qid: '1.1.F' })), 200);
});

test('parent controls Little Hellos and can ask for deletion; settings are validated', async () => {
  const { store, story, tokens } = await mk({ guardian: true });
  await C.guardianUpdate(store, tokens.guardian, { hello: { enabled: false, style: 'sweet', custom: [] } });
  assert.equal((await load(store, story.id)).helloSettings.enabled, false);
  await C.guardianUpdate(store, tokens.guardian, { hello: { enabled: true, style: 'custom', custom: ['Love you to the moon!'] } });
  assert.equal((await load(store, story.id)).helloSettings.custom[0], 'Love you to the moon!');
  assert.equal(await status(C.guardianUpdate(store, tokens.guardian, { hello: { style: 'custom', custom: [] } })), 400);
  assert.equal(await status(C.guardianUpdate(store, tokens.guardian, { hello: { style: 'both', custom: ['x'.repeat(151)] } })), 400);
  const r = await C.guardianUpdate(store, tokens.guardian, { requestDeletion: true });
  assert.ok(r.deletionRequestedAt);                                                                   // flagged for the owner; nothing is deleted automatically
  assert.ok(await load(store, story.id));
  assert.equal((await C.guardianUpdate(store, tokens.guardian, { requestDeletion: false })).deletionRequestedAt, null);
});

test('parent sees every Little Hello (both directions) with names', async () => {
  const { store, story, tokens } = await mk({ guardian: true });
  const s = await load(store, story.id); s.lastActivityAt = Date.now() - 49 * 3600e3; await store.setJSON(`story/${story.id}`, s);
  await C.sendHello(store, tokens.grandparent, { suggestion: 's:1' });
  const gs = C.publicState(await load(store, story.id), 'guardian');
  assert.equal(gs.hellos.length, 1); assert.equal(gs.hellos[0].fromName, 'Mimi'); assert.equal(gs.hellos[0].toName, 'Devon');
});

test('RETENTION: no deadline while recording; finishing keeps the keepsake open 12 months from completion', async () => {
  const { store, story, tokens } = await mk();
  assert.equal(story.expiresAt, null); // no deadline
  const s = await load(store, story.id); s.createdAt = Date.now() - 900 * 86400e3; await store.setJSON(`story/${story.id}`, s); // started 2.5 years ago
  for (let n = 1; n <= 30; n++) await exchange(store, tokens, n); // still fine
  const done = await load(store, story.id);
  assert.ok(done.completedAt);
  const want = done.completedAt + C.RETENTION_DAYS_AFTER_COMPLETION * 86400e3;
  assert.ok(Math.abs(done.expiresAt - want) < 5000);                                 // extended to 12 months after completion
  const st = C.publicState(done, 'child'); assert.equal(st.availableUntil, done.expiresAt);
  assert.equal(C.RETENTION_DAYS_AFTER_COMPLETION, 365);
  assert.equal(C.paceMonths(done), 6);
});

test('deleting a story also removes the parent login and its remembered phones', async () => {
  const { store, story, tokens } = await mk({ guardian: true });
  await C.exchangeLink(store, tokens.guardian);
  await C.deleteStory(store, story.id);
  const d = store._dump(); assert.deepEqual(d.json, []); assert.deepEqual(d.blobs, []);
});

test('legacy stories (no parent fields) load and report no parent login', async () => {
  const store = C.makeMemoryStore();
  const { story } = await C.createStory(store, { childName: 'A', grandparentName: 'B', test: true });
  delete story.sessions; delete story.childPaused; delete story.guardianCode;   // as the first releases stored them
  const st = C.publicState(story, 'child'); assert.equal(st.guardianManaged, false);
});
