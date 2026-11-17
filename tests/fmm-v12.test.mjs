// Buyer login (when someone other than the parent buys) and order-page choices carried into the story.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../netlify/lib/fmm-core.mjs';

const audio = Buffer.alloc(2000, 1);
const rec = (extra) => ({ data: audio, durationSec: 10, uploadId: 'u' + Math.random(), contentType: 'audio/mp4', ...extra });
const status = async (p) => { try { await p; return 200; } catch (e) { return e.status || 500; } };
const load = (store, id) => store.getJSON(`story/${id}`);
async function mk(opts = {}) {
  const store = C.makeMemoryStore();
  const { story, tokens } = await C.createStory(store, { childName: 'Devon', grandparentName: 'Mimi', test: false, buyer: true, buyerName: 'Gma Rose', buyerEmail: 'r@x.co', buyerRole: 'grandparent', ...opts });
  return { store, story, tokens };
}

test('buyer gets their own link with set-up powers, but never parent-only decisions', async () => {
  const { store, story, tokens } = await mk();
  assert.ok(tokens.buyer); assert.equal(story.buyer.name, 'Gma Rose');
  const st = C.publicState((await C.authorize(store, tokens.buyer)).story, 'buyer');
  assert.equal(st.role, 'buyer'); assert.equal(st.consentNeeded, false); assert.equal(st.consentPending, true);
  assert.equal(st.childAccess, null); assert.equal(st.publication, null); assert.equal(st.canAddPhotos, true);
  assert.equal(await status(C.recordConsent(store, tokens.buyer, { parentName: 'X', agree: true })), 403);
  assert.equal(await status(C.childAccessTeen(store, tokens.buyer, { parentName: 'X', agree: true })), 403);
  assert.equal(await status(C.guardianUpdate(store, tokens.buyer, { childPaused: true })), 403);
  const up = await C.guardianUpdate(store, tokens.buyer, { hello: { enabled: true, style: 'sweet', custom: [] } });
  assert.equal(up.role, 'buyer'); assert.equal((await load(store, story.id)).helloSettings.style, 'sweet');
  await C.saveProfile(store, tokens.buyer, { k: 0, qid: 'born', answer: 1 });
  assert.equal((await load(store, story.id)).profiles[0].answers.born, 1);
});

test('buyer can add photos but cannot play the family\'s recordings', async () => {
  const { store, story, tokens } = await mk();
  await C.recordConsent(store, tokens.child, { parentName: 'Amber', agree: true });
  await C.recordGrandparentConsent(store, tokens.grandparent, { name: 'Mimi', agree: true });
  await C.choose(store, tokens.child, { n: 1, qid: C.STOPS[0].choices[0].id });
  await C.upload(store, tokens.child, rec({ n: 1, slot: 'question' }));
  await C.uploadPhoto(store, tokens.buyer, { data: Buffer.alloc(500, 1), contentType: 'image/jpeg', uploadId: 'b1' });
  const ph = (await load(store, story.id)).photos[0];
  assert.equal(ph.by, 'buyer');
  assert.equal(await status(C.mediaAccess(store, 'secret', tokens.buyer, { n: 1, slot: 'question' })), 403);
  assert.equal(await status(C.mediaAccess(store, 'secret', tokens.buyer, { slot: 'photo', id: ph.id })), 200);
  const st = C.publicState(await load(store, story.id), 'buyer');
  assert.equal(st.conversations[0].hasQ, false); // progress only
});

test('buyer link can be revoked and reissued, and is removed when the story is deleted', async () => {
  const { store, story, tokens } = await mk();
  const fresh = await C.revokeToken(store, story.id, 'buyer');
  assert.equal(await status(C.authorize(store, tokens.buyer)), 401);
  assert.equal((await C.authorize(store, fresh)).role, 'buyer');
  await C.exchangeLink(store, fresh);
  await C.deleteStory(store, story.id);
  assert.equal(store._dump().json.length, 0);
});

test('a buyer login can be added later; only one at a time', async () => {
  const store = C.makeMemoryStore();
  const { story } = await C.createStory(store, { childName: 'Devon', grandparentName: 'Mimi', test: true });
  const t = await C.addBuyer(store, story.id, { buyerName: 'Uncle Ray', buyerRole: 'other' });
  assert.equal((await C.authorize(store, t)).role, 'buyer');
  assert.equal(await status(C.addBuyer(store, story.id, {})), 409);
});

test('order-page choices become the story\'s starting settings and profiles', async () => {
  const store = C.makeMemoryStore();
  const { story } = await C.createStory(store, { childName: 'Devon', grandparentName: 'Mimi', grandparentName2: 'Papa', test: true,
    fromOrder: { settings: { hello: 'off', music: 'none', share: 'open' }, childRecording: 'own', childAge: '9 to 12',
      profiles: [{ answers: { born: 2, grewup: 1, bogus: 3 } }, { answers: { born: 99 } }] } });
  assert.equal(story.helloSettings.enabled, false);
  assert.deepEqual(story.prefs, { music: 'none', share: 'open', childRecording: 'own', childAge: '9 to 12' });
  assert.deepEqual(story.profiles[0].answers, { born: 2, grewup: 1 }); // unknown questions dropped
  assert.equal(story.profiles[1], undefined);                         // out-of-range answer dropped
  assert.deepEqual(C.movieKit(story, 'x').prefs, story.prefs);
});
