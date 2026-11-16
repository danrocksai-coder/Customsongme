// Parent-run by default; the child's own link needs the parent's choice plus 13+ confirmation or an approved signed form.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../netlify/lib/fmm-core.mjs';

const audio = Buffer.alloc(2000, 1);
const form = Buffer.alloc(5000, 7);
const rec = (extra) => ({ data: audio, durationSec: 10, uploadId: 'u' + Math.random(), contentType: 'audio/mp4', ...extra });
const status = async (p) => { try { await p; return 200; } catch (e) { return e.status || 500; } };
const load = (store, id) => store.getJSON(`story/${id}`);
async function mk(opts = {}) {
  const store = C.makeMemoryStore();
  const { story, tokens } = await C.createStory(store, { childName: 'Devon', grandparentName: 'Mimi', test: false, ...opts });
  return { store, story, tokens };
}
const consent = (store, t) => C.recordConsent(store, t, { parentName: 'Amber', agree: true });
const upForm = (store, t, extra = {}) => C.uploadConsentForm(store, t, { data: form, contentType: 'image/jpeg', parentName: 'Amber', ...extra });

test('default is parent-run: no child link exists and the family link reports parent control', async () => {
  const { store, story, tokens } = await mk();
  await consent(store, tokens.child);
  const st = C.publicState(await load(store, story.id), 'child');
  assert.equal(st.own, false);
  assert.equal(st.childAccess.status, 'none'); assert.equal(st.childAccess.linkActive, false);
  assert.equal((await load(store, story.id)).tokenHashes.kid, undefined);
});

test('child link cannot be turned on before permission is approved', async () => {
  const { store, tokens } = await mk();
  await consent(store, tokens.child);
  assert.equal(await status(C.setChildLink(store, tokens.child, { on: true })), 409);
});

test('base recording permission is required before any child-access step', async () => {
  const { store, tokens } = await mk();
  assert.equal(await status(C.childAccessTeen(store, tokens.child, { parentName: 'Amber', agree: true })), 409);
  assert.equal(await status(upForm(store, tokens.child)), 409);
});

test('13+ path: parent confirms age, then turns the link on; the child link records', async () => {
  const { store, story, tokens } = await mk();
  await consent(store, tokens.child);
  assert.equal(await status(C.childAccessTeen(store, tokens.child, { parentName: 'Amber', agree: false })), 400);
  const st = await C.childAccessTeen(store, tokens.child, { parentName: 'Amber', agree: true });
  assert.equal(st.childAccess.status, 'approved'); assert.equal(st.childAccess.basis, 'age-13-plus');
  assert.equal(st.childAccess.linkActive, false); // approval alone never turns it on
  const { link } = await C.setChildLink(store, tokens.child, { on: true });
  assert.ok(link);
  const me = C.publicState((await C.authorize(store, link)).story, 'child', true);
  assert.equal(me.own, true); assert.equal(me.childAccess, null); // the child cannot manage their own access
  await C.choose(store, link, { n: 1, qid: C.STOPS[0].choices[0].id });
  await C.upload(store, link, rec({ n: 1, slot: 'question' }));
  assert.ok((await load(store, story.id)).stops[0].q);
});

test('under-13 path: form upload -> pending -> admin approves -> parent turns link on', async () => {
  const { store, story, tokens } = await mk();
  await consent(store, tokens.child);
  assert.equal(await status(upForm(store, tokens.child, { contentType: 'text/html' })), 415);
  assert.equal(await status(upForm(store, tokens.child, { parentName: '' })), 400);
  assert.equal(await status(upForm(store, tokens.child, { data: Buffer.alloc(C.FORM_MAX_BYTES + 1) })), 413);
  const st = await upForm(store, tokens.child);
  assert.equal(st.childAccess.status, 'pending');
  assert.equal(await status(C.setChildLink(store, tokens.child, { on: true })), 409); // still pending
  await C.reviewConsentForm(store, story.id, { approve: true });
  const { link } = await C.setChildLink(store, tokens.child, { on: true });
  assert.equal((await C.authorize(store, link)).own, true);
  const s = await load(store, story.id);
  assert.deepEqual(s.childAccess.history.map((h) => h.event), ['form-uploaded', 'form-approved', 'link-on']);
});

test('rejected form shows the note to the parent and can be uploaded again', async () => {
  const { store, story, tokens } = await mk();
  await consent(store, tokens.child);
  await upForm(store, tokens.child);
  await C.reviewConsentForm(store, story.id, { approve: false, note: 'Not signed.' });
  const st = C.publicState(await load(store, story.id), 'child');
  assert.equal(st.childAccess.status, 'rejected'); assert.equal(st.childAccess.reviewNote, 'Not signed.');
  assert.equal(await status(C.reviewConsentForm(store, story.id, { approve: true })), 409); // nothing pending
  await upForm(store, tokens.child);
  assert.equal(C.publicState(await load(store, story.id), 'child').childAccess.status, 'pending');
});

test('turning the link off kills the link and every remembered device immediately', async () => {
  const { store, tokens } = await mk();
  await consent(store, tokens.child);
  await C.childAccessTeen(store, tokens.child, { parentName: 'Amber', agree: true });
  const { link } = await C.setChildLink(store, tokens.child, { on: true });
  const { session } = await C.exchangeLink(store, link);
  assert.equal((await C.authorize(store, session)).own, true);
  await C.setChildLink(store, tokens.child, { on: false });
  assert.equal(await status(C.authorize(store, link)), 401);
  assert.equal(await status(C.authorize(store, session)), 401);
});

test('making a new link stops the old one', async () => {
  const { store, tokens } = await mk();
  await consent(store, tokens.child);
  await C.childAccessTeen(store, tokens.child, { parentName: 'Amber', agree: true });
  const a = (await C.setChildLink(store, tokens.child, { on: true })).link;
  const b = (await C.setChildLink(store, tokens.child, { on: true })).link;
  assert.equal(await status(C.authorize(store, a)), 401);
  assert.equal((await C.authorize(store, b)).own, true);
});

test('withdrawing permission turns the link off and requires a new yes', async () => {
  const { store, tokens } = await mk();
  await consent(store, tokens.child);
  await C.childAccessTeen(store, tokens.child, { parentName: 'Amber', agree: true });
  const { link } = await C.setChildLink(store, tokens.child, { on: true });
  const st = await C.withdrawChildAccess(store, tokens.child, {});
  assert.equal(st.childAccess.status, 'none');
  assert.equal(await status(C.authorize(store, link)), 401);
  assert.equal(await status(C.setChildLink(store, tokens.child, { on: true })), 409);
});

test('only the parent controls access: not the grandparent, not the child link, and with a parent login only that login', async () => {
  const { store, tokens } = await mk({ guardian: true });
  await C.recordConsent(store, tokens.guardian, { parentName: 'Amber', agree: true });
  assert.equal(await status(C.childAccessTeen(store, tokens.grandparent, { parentName: 'X', agree: true })), 403);
  assert.equal(await status(C.childAccessTeen(store, tokens.child, { parentName: 'X', agree: true })), 403); // parent login exists
  await C.childAccessTeen(store, tokens.guardian, { parentName: 'Amber', agree: true });
  const { link } = await C.setChildLink(store, tokens.guardian, { on: true });
  assert.equal(await status(C.setChildLink(store, link, { on: true })), 403); // the child cannot re-issue
  assert.equal(await status(C.withdrawChildAccess(store, link, {})), 403);
  assert.equal(await status(C.recordConsent(store, link, { parentName: 'Kid', agree: true })), 403);
  assert.equal(await status(upForm(store, link)), 403);
  assert.ok(C.guardianState(await store.getJSON(`story/${(await C.authorize(store, tokens.guardian)).story.id}`)).childAccess);
});

test('pausing by the parent also stops the child\'s own link from recording', async () => {
  const { store, tokens } = await mk({ guardian: true });
  await C.recordConsent(store, tokens.guardian, { parentName: 'Amber', agree: true });
  await C.childAccessTeen(store, tokens.guardian, { parentName: 'Amber', agree: true });
  const { link } = await C.setChildLink(store, tokens.guardian, { on: true });
  await C.guardianUpdate(store, tokens.guardian, { childPaused: true });
  assert.equal(await status(C.choose(store, link, { n: 1, qid: C.STOPS[0].choices[0].id })), 403);
});

test('deleting a story removes the consent form, the child link and its devices', async () => {
  const { store, story, tokens } = await mk();
  await consent(store, tokens.child);
  await upForm(store, tokens.child);
  await C.reviewConsentForm(store, story.id, { approve: true });
  const { link } = await C.setChildLink(store, tokens.child, { on: true });
  await C.exchangeLink(store, link);
  await C.deleteStory(store, story.id);
  const left = store._dump();
  assert.equal(left.blobs.length, 0);
  assert.equal(left.json.filter((k) => k.startsWith('token/') || k.startsWith('sess/')).length, 0);
});

test('stories from earlier versions keep working and default to parent-run', async () => {
  const { store, story, tokens } = await mk({ test: true });
  const raw = await load(store, story.id);
  delete raw.childAccess; delete raw.sessions.kid;
  await store.setJSON(`story/${story.id}`, raw);
  const st = C.publicState((await C.authorize(store, tokens.child)).story, 'child');
  assert.equal(st.childAccess.status, 'none'); assert.equal(st.own, false);
});
