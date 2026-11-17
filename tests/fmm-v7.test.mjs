// Grandparent agrees to be recorded (own consent, separate from the parent's permission for the child).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../netlify/lib/fmm-core.mjs';

const audio = Buffer.alloc(2000, 1);
const rec = (extra) => ({ data: audio, durationSec: 10, uploadId: 'u' + Math.random(), contentType: 'audio/mp4', ...extra });
const status = async (p) => { try { await p; return 200; } catch (e) { return e.status || 500; } };
const load = (store, id) => store.getJSON(`story/${id}`);
async function mk(opts = {}) {
  const store = C.makeMemoryStore();
  const { story, tokens } = await C.createStory(store, { childName: 'Devon', grandparentName: 'Mimi', test: false, ...opts });
  await C.recordConsent(store, tokens.child, { parentName: 'Amber', agree: true });
  await C.choose(store, tokens.child, { n: 1, qid: C.STOPS[0].choices[0].id });
  await C.upload(store, tokens.child, rec({ n: 1, slot: 'question' }));
  return { store, story, tokens };
}

test('real story: the grandparent cannot record, add photos or a voice intro before agreeing', async () => {
  const { store, story, tokens } = await mk();
  assert.equal(C.publicState(await load(store, story.id), 'grandparent').consentNeeded, true);
  assert.equal(await status(C.upload(store, tokens.grandparent, rec({ n: 1, slot: 'answer' }))), 403);
  assert.equal(await status(C.upload(store, tokens.grandparent, rec({ n: 0, slot: 'intro' }))), 403);
  assert.equal(await status(C.uploadPhoto(store, tokens.grandparent, { data: Buffer.alloc(500, 2), contentType: 'image/jpeg', uploadId: 'p' })), 409);
});

test('the grandparent agrees with name + checkbox; recording then works and the record is kept', async () => {
  const { store, story, tokens } = await mk();
  assert.equal(await status(C.recordGrandparentConsent(store, tokens.grandparent, { name: 'Mimi', agree: false })), 400);
  assert.equal(await status(C.recordGrandparentConsent(store, tokens.grandparent, { name: '', agree: true })), 400);
  await C.recordGrandparentConsent(store, tokens.grandparent, { name: 'Mimi Rock', agree: true });
  const s = await load(store, story.id);
  assert.equal(s.grandparentConsent.name, 'Mimi Rock'); assert.equal(s.grandparentConsent.version, C.GRANDPARENT_CONSENT_VERSION);
  assert.equal(C.publicState(s, 'grandparent').consentNeeded, false);
  await C.upload(store, tokens.grandparent, rec({ n: 1, slot: 'answer' }));
});

test('only the grandparent can give this agreement, and it never counts as the parent\'s permission', async () => {
  const store = C.makeMemoryStore();
  const { story, tokens } = await C.createStory(store, { childName: 'Devon', grandparentName: 'Mimi', test: false, guardian: true });
  assert.equal(await status(C.recordGrandparentConsent(store, tokens.child, { name: 'X', agree: true })), 403);
  assert.equal(await status(C.recordGrandparentConsent(store, tokens.guardian, { name: 'X', agree: true })), 403);
  await C.recordGrandparentConsent(store, tokens.grandparent, { name: 'Mimi', agree: true });
  assert.equal((await load(store, story.id)).consent, null); // parent permission still missing
  assert.equal(await status(C.recordConsent(store, tokens.grandparent, { parentName: 'Mimi', agree: true })), 403);
});

test('test stories skip the agreement (adult fictional recordings only)', async () => {
  const { store, tokens } = await mk({ test: true });
  await C.upload(store, tokens.grandparent, rec({ n: 1, slot: 'answer' }));
});
