// Movie kit for the local movie maker (tools/fmm-movie): admin-only data with long-enough signed links.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../netlify/lib/fmm-core.mjs';

const SECRET = 'test-secret';
const audio = Buffer.alloc(2000, 1);
const rec = (extra) => ({ data: audio, durationSec: 10, uploadId: 'u' + Math.random(), contentType: 'audio/mp4', ...extra });

test('movie kit lists every finished stop, intro/closing, photos, with signed links that work for 30 minutes', async () => {
  const store = C.makeMemoryStore();
  const { story, tokens } = await C.createStory(store, { childName: 'Devon', grandparentName: 'Mimi', test: true });
  await C.upload(store, tokens.grandparent, rec({ n: 0, slot: 'intro', durationSec: 30 }));
  await C.choose(store, tokens.child, { n: 1, qid: C.STOPS[0].choices[1].id });
  await C.upload(store, tokens.child, rec({ n: 1, slot: 'question' }));
  await C.upload(store, tokens.grandparent, rec({ n: 1, slot: 'answer', durationSec: 42 }));
  await C.uploadPhoto(store, tokens.grandparent, { data: Buffer.alloc(900, 3), contentType: 'image/jpeg', caption: 'Mimi at 7', uploadId: 'p1' });
  const kit = C.movieKit(await store.getJSON(`story/${story.id}`), SECRET);
  assert.equal(kit.childName, 'Devon'); assert.equal(kit.chapters.length, 6); assert.equal(kit.stops.length, 30);
  const s1 = kit.stops[0];
  assert.equal(s1.question, C.STOPS[0].choices[1].text); assert.equal(s1.chapter, 1);
  assert.equal(s1.a.seconds, 42); assert.equal(kit.stops[1].q, null);
  assert.ok(kit.intro.url); assert.equal(kit.closing, null);
  assert.equal(kit.photos[0].caption, 'Mimi at 7');
  assert.equal(kit.publishAllowed, false);
  for (const u of [s1.q.url, s1.a.url, kit.intro.url, kit.photos[0].url]) {
    const q = Object.fromEntries(new URL('https://x' + u).searchParams);
    assert.ok(Number(q.e) - Date.now() / 1000 > 1700); // ~30 minutes to download
    assert.ok((await C.readSignedAudio(store, SECRET, q)).data.length > 0);
  }
});
