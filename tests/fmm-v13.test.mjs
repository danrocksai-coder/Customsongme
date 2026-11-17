// Watch page: what a scanned magnet shows once the movie is published (both yeses required, instant take-down).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../netlify/lib/fmm-core.mjs';

const audio = Buffer.alloc(2000, 1);
const rec = (extra) => ({ data: audio, durationSec: 10, uploadId: 'u' + Math.random(), contentType: 'audio/mp4', ...extra });
const status = async (p) => { try { await p; return 200; } catch (e) { return e.status || 500; } };
async function finished() {
  const store = C.makeMemoryStore();
  const { story, tokens } = await C.createStory(store, { childName: 'Devon', grandparentName: 'Mimi', test: true });
  for (let n = 1; n <= 30; n++) {
    await C.choose(store, tokens.child, { n, qid: C.STOPS[n - 1].choices[0].id });
    await C.upload(store, tokens.child, rec({ n, slot: 'question' }));
    await C.upload(store, tokens.grandparent, rec({ n, slot: 'answer' }));
    await C.markHeard(store, tokens.child, { n });
  }
  return { store, story, tokens };
}
const yes = (store, t) => C.setPublication(store, t, { choice: 'share', name: 'X', agree: true });

test('YouTube links of every common shape are understood; junk is refused', () => {
  for (const u of ['https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3', 'https://m.youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'])
    assert.equal(C.youtubeId(u), 'dQw4w9WgXcQ');
  for (const u of ['https://vimeo.com/123', 'not a link', 'https://youtu.be/short']) assert.equal(C.youtubeId(u), null);
});

test('nothing shows until finished, both said share, links are set and Dan publishes', async () => {
  const { store, story, tokens } = await finished();
  const code = story.qrCodes.grandparent;
  assert.deepEqual(await C.watchInfo(store, code), { published: false });
  assert.equal(await status(C.publishWatch(store, story.id, true)), 409); // no yeses
  await yes(store, tokens.child); await yes(store, tokens.grandparent);
  assert.equal(await status(C.publishWatch(store, story.id, true)), 409); // no links yet
  assert.equal(await status(C.setWatch(store, story.id, { youtube: 'https://vimeo.com/1' })), 400);
  assert.equal(await status(C.setWatch(store, story.id, { youtube: 'https://youtu.be/dQw4w9WgXcQ', fallback: 'http://insecure' })), 400);
  await C.setWatch(store, story.id, { youtube: 'https://youtu.be/dQw4w9WgXcQ', fallback: 'https://example.com/movie.mp4' });
  await C.publishWatch(store, story.id, true);
  const w = await C.watchInfo(store, code);
  assert.deepEqual(w, { published: true, title: 'Devon & Mimi', youtubeId: 'dQw4w9WgXcQ', fallbackUrl: 'https://example.com/movie.mp4' });
  assert.equal((await C.watchInfo(store, story.qrCodes.child)).published, true); // both magnets
  assert.deepEqual(await C.watchInfo(store, 'nope'), { published: false });
});

test('an unfinished story can never be published', async () => {
  const store = C.makeMemoryStore();
  const { story } = await C.createStory(store, { childName: 'Devon', grandparentName: 'Mimi', test: true });
  await C.setWatch(store, story.id, { youtube: 'dQw4w9WgXcQ' });
  assert.equal(await status(C.publishWatch(store, story.id, true)), 409);
});

test('if anyone takes back their yes, the watch page goes dark immediately', async () => {
  const { store, story, tokens } = await finished();
  await yes(store, tokens.child); await yes(store, tokens.grandparent);
  await C.setWatch(store, story.id, { youtube: 'dQw4w9WgXcQ' });
  await C.publishWatch(store, story.id, true);
  await C.setPublication(store, tokens.grandparent, { choice: 'private', name: 'M', agree: true });
  assert.deepEqual(await C.watchInfo(store, story.qrCodes.child), { published: false });
  const s = await store.getJSON(`story/${story.id}`);
  assert.equal(s.watch.published, false); assert.ok(s.unpublishRequestedAt);
});

test('Dan can unpublish at any time', async () => {
  const { store, story, tokens } = await finished();
  await yes(store, tokens.child); await yes(store, tokens.grandparent);
  await C.setWatch(store, story.id, { fallback: 'https://example.com/movie.mp4' }); // backup only is allowed
  await C.publishWatch(store, story.id, true);
  assert.equal((await C.watchInfo(store, story.qrCodes.child)).youtubeId, null);
  await C.publishWatch(store, story.id, false);
  assert.equal((await C.watchInfo(store, story.qrCodes.child)).published, false);
});
