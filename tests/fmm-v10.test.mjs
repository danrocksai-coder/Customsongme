// "Grandma & Grandpa together" package: one story, two grandparents taking turns (15 stops each), both agree to be recorded.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../netlify/lib/fmm-core.mjs';

const audio = Buffer.alloc(2000, 1);
const rec = (extra) => ({ data: audio, durationSec: 10, uploadId: 'u' + Math.random(), contentType: 'audio/mp4', ...extra });
const status = async (p) => { try { await p; return 200; } catch (e) { return e.status || 500; } };
const load = (store, id) => store.getJSON(`story/${id}`);

test('together story: names joined, stops alternate, exactly 15 each', async () => {
  const store = C.makeMemoryStore();
  const { story } = await C.createStory(store, { childName: 'Devon', grandparentName: 'Mimi', grandparentName2: 'Papa', test: true });
  assert.equal(story.grandparentName, 'Mimi and Papa'); assert.deepEqual(story.grandparents, ['Mimi', 'Papa']);
  const who = C.STOPS.map((s) => C.answererFor(story, s.n));
  assert.equal(who[0], 'Mimi'); assert.equal(who[1], 'Papa'); assert.equal(who[29], 'Papa');
  assert.equal(who.filter((w) => w === 'Mimi').length, 15); assert.equal(who.filter((w) => w === 'Papa').length, 15);
});

test('one-grandparent stories are unchanged: every stop is theirs', async () => {
  const store = C.makeMemoryStore();
  const { story } = await C.createStory(store, { childName: 'Devon', grandparentName: 'Mimi', test: true });
  assert.equal(story.grandparents, null);
  assert.ok(C.STOPS.every((s) => C.answererFor(story, s.n) === 'Mimi'));
});

test('state and movie kit name who answers the open stop and each finished one', async () => {
  const store = C.makeMemoryStore();
  const { story, tokens } = await C.createStory(store, { childName: 'Devon', grandparentName: 'Mimi', grandparentName2: 'Papa', test: true });
  for (const n of [1, 2]) {
    await C.choose(store, tokens.child, { n, qid: C.STOPS[n - 1].choices[0].id });
    await C.upload(store, tokens.child, rec({ n, slot: 'question' }));
    await C.upload(store, tokens.grandparent, rec({ n, slot: 'answer' }));
    await C.markHeard(store, tokens.child, { n });
  }
  const s = await load(store, story.id);
  const st = C.publicState(s, 'child');
  assert.equal(st.current.n, 3); assert.equal(st.current.answerer, 'Mimi');
  assert.deepEqual(st.conversations.map((c) => c.answerer), ['Mimi', 'Papa']);
  assert.deepEqual(st.grandparents, ['Mimi', 'Papa']);
  const kit = C.movieKit(s, 'secret');
  assert.equal(kit.stops[1].answerer, 'Papa'); assert.deepEqual(kit.grandparents, ['Mimi', 'Papa']);
});

test('together story (real): BOTH grandparents must agree before recording', async () => {
  const store = C.makeMemoryStore();
  const { tokens } = await C.createStory(store, { childName: 'Devon', grandparentName: 'Mimi', grandparentName2: 'Papa', test: false });
  await C.recordConsent(store, tokens.child, { parentName: 'Amber', agree: true });
  await C.choose(store, tokens.child, { n: 1, qid: C.STOPS[0].choices[0].id });
  await C.upload(store, tokens.child, rec({ n: 1, slot: 'question' }));
  assert.equal(await status(C.recordGrandparentConsent(store, tokens.grandparent, { name: 'Mimi', agree: true })), 400);
  assert.equal(await status(C.recordGrandparentConsent(store, tokens.grandparent, { name: 'Mimi', agree: true, name2: 'Papa', agree2: false })), 400);
  await C.recordGrandparentConsent(store, tokens.grandparent, { name: 'Mimi', agree: true, name2: 'Papa', agree2: true });
  await C.upload(store, tokens.grandparent, rec({ n: 1, slot: 'answer' }));
});
