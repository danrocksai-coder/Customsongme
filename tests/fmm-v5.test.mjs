// Family photos, separate publication consent (parent AND grandparent), YouTube guard, admin audit log.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../netlify/lib/fmm-core.mjs';

const SECRET = 'test-secret';
const img = Buffer.alloc(3000, 9);
const audio = Buffer.alloc(2000, 1);
const rec = (extra) => ({ data: audio, durationSec: 10, uploadId: 'u' + Math.random(), contentType: 'audio/mp4', ...extra });
const status = async (p) => { try { await p; return 200; } catch (e) { return e.status || 500; } };
const load = (store, id) => store.getJSON(`story/${id}`);
async function mk(opts = {}) {
  const store = C.makeMemoryStore();
  const { story, tokens } = await C.createStory(store, { childName: 'Devon', grandparentName: 'Mimi', test: true, ...opts });
  return { store, story, tokens };
}
const photo = (store, t, extra = {}) => C.uploadPhoto(store, t, { data: img, contentType: 'image/jpeg', caption: 'Mimi at 7', uploadId: 'p' + Math.random(), ...extra });
async function finishAll(store, tokens) {
  for (let n = 1; n <= 30; n++) {
    await C.choose(store, tokens.child, { n, qid: C.STOPS[n - 1].choices[0].id });
    await C.upload(store, tokens.child, rec({ n, slot: 'question' }));
    await C.upload(store, tokens.grandparent, rec({ n, slot: 'answer', durationSec: 40 }));
    await C.markHeard(store, tokens.child, { n });
  }
}

test('parent and grandparent can add photos; a child\'s own link cannot', async () => {
  const { store, story, tokens } = await mk();
  await photo(store, tokens.child); await photo(store, tokens.grandparent);
  const s = await load(store, story.id);
  assert.equal(s.photos.length, 2); assert.deepEqual(s.photos.map((p) => p.by), ['child', 'grandparent']);
  await C.childAccessTeen(store, tokens.child, { parentName: 'Amber', agree: true });
  const { link } = await C.setChildLink(store, tokens.child, { on: true });
  assert.equal(await status(photo(store, link)), 403);
  const own = C.publicState((await C.authorize(store, link)).story, 'child', true);
  assert.equal(own.canAddPhotos, false); assert.equal(own.photos.length, 2); // can still see them
});

test('photo rules: type, size, limit, duplicate upload id', async () => {
  const { store, story, tokens } = await mk();
  assert.equal(await status(photo(store, tokens.child, { contentType: 'application/pdf' })), 415);
  assert.equal(await status(photo(store, tokens.child, { data: Buffer.alloc(C.PHOTO_MAX_BYTES + 1) })), 413);
  await photo(store, tokens.child, { uploadId: 'same' });
  const again = await photo(store, tokens.child, { uploadId: 'same' });
  assert.equal(again.duplicate, true); assert.equal((await load(store, story.id)).photos.length, 1);
  const s = await load(store, story.id);
  s.photos = Array.from({ length: C.PHOTO_MAX }, (_, i) => ({ id: 'x' + i, key: 'k' + i, by: 'child', caption: '', at: 1 }));
  await store.setJSON(`story/${story.id}`, s);
  assert.equal(await status(photo(store, tokens.child)), 409);
});

test('non-test story: the parent must give permission before adding photos', async () => {
  const { store, tokens } = await mk({ test: false });
  assert.equal(await status(photo(store, tokens.child)), 409);
  await C.recordConsent(store, tokens.child, { parentName: 'Amber', agree: true });
  assert.equal(await status(photo(store, tokens.child)), 200);
});

test('photo removal: the grandparent removes only their own; the parent can remove any', async () => {
  const { store, story, tokens } = await mk();
  await photo(store, tokens.child); await photo(store, tokens.grandparent);
  const [p1, p2] = (await load(store, story.id)).photos;
  assert.equal(await status(C.deletePhoto(store, tokens.grandparent, { id: p1.id })), 403);
  await C.deletePhoto(store, tokens.grandparent, { id: p2.id });
  await C.deletePhoto(store, tokens.child, { id: p1.id });
  assert.equal((await load(store, story.id)).photos.length, 0);
  assert.equal(store._dump().blobs.filter((k) => k.includes('photo-')).length, 0);
});

test('photos are viewed only through short-lived signed links, and deleted with the story', async () => {
  const { store, story, tokens } = await mk();
  await photo(store, tokens.grandparent);
  const id = (await load(store, story.id)).photos[0].id;
  const m = await C.mediaAccess(store, SECRET, tokens.child, { slot: 'photo', id });
  const q = Object.fromEntries(new URL('https://x' + m.url).searchParams);
  assert.equal((await C.readSignedAudio(store, SECRET, q)).meta.contentType, 'image/jpeg');
  await C.deleteStory(store, story.id);
  assert.equal(store._dump().blobs.length, 0);
});

test('publication: only after all 30, and only when BOTH parent and grandparent choose share', async () => {
  const { store, story, tokens } = await mk();
  const ans = (t, choice) => C.setPublication(store, t, { choice, name: 'X', agree: true });
  assert.equal(await status(ans(tokens.child, 'share')), 409); // not finished yet
  await finishAll(store, tokens);
  assert.equal(await status(C.setPublication(store, tokens.child, { choice: 'share', name: '', agree: true })), 400);
  await ans(tokens.child, 'share');
  assert.equal(C.publishAllowed(await load(store, story.id)), false);
  await ans(tokens.grandparent, 'share');
  assert.equal(C.publishAllowed(await load(store, story.id)), true);
});

test('taking back a yes flags the video for removal', async () => {
  const { store, story, tokens } = await mk();
  await finishAll(store, tokens);
  await C.setPublication(store, tokens.child, { choice: 'share', name: 'A', agree: true });
  await C.setPublication(store, tokens.grandparent, { choice: 'share', name: 'M', agree: true });
  await C.setPublication(store, tokens.grandparent, { choice: 'private', name: 'M', agree: true });
  const s = await load(store, story.id);
  assert.equal(C.publishAllowed(s), false); assert.ok(s.unpublishRequestedAt);
  assert.equal(s.publication.history.length, 3);
});

test('publication is decided by the parent login when one exists, never by a child\'s own link', async () => {
  const { store, tokens } = await mk({ guardian: true });
  await finishAll(store, tokens);
  assert.equal(await status(C.setPublication(store, tokens.child, { choice: 'share', name: 'A', agree: true })), 403);
  assert.equal(await status(C.setPublication(store, tokens.guardian, { choice: 'share', name: 'A', agree: true })), 200);
});

test('admin cannot put a YouTube link in the keepsake without both yeses', async () => {
  const { store, story, tokens } = await mk();
  await finishAll(store, tokens);
  const yt = [{ label: 'Movie', url: 'https://www.youtube.com/watch?v=abc' }];
  assert.equal(await status(C.setKeepsake(store, story.id, { status: 'ready', items: yt })), 409);
  assert.equal(await status(C.setKeepsake(store, story.id, { status: 'ready', items: [{ label: 'Movie', url: 'https://youtu.be/abc' }] })), 409);
  assert.equal(await status(C.setKeepsake(store, story.id, { status: 'ready', items: [{ label: 'Download', url: 'https://example.com/movie.mp4' }] })), 200);
  await C.setPublication(store, tokens.child, { choice: 'share', name: 'A', agree: true });
  await C.setPublication(store, tokens.grandparent, { choice: 'share', name: 'M', agree: true });
  assert.equal(await status(C.setKeepsake(store, story.id, { status: 'ready', items: yt })), 200);
});

test('audit log keeps admin actions on the story, newest last, capped', async () => {
  const { store, story } = await mk();
  for (let i = 0; i < C.AUDIT_MAX + 5; i++) await C.auditLog(store, story.id, 'opened recording', 'question-' + i);
  const s = await load(store, story.id);
  assert.equal(s.audit.length, C.AUDIT_MAX);
  assert.equal(s.audit.at(-1).detail, 'question-' + (C.AUDIT_MAX + 4));
  await C.auditLog(store, 'missing', 'x'); // no story: no crash
});
