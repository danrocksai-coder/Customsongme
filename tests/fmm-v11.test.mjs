// Four packages (30/60 stops × one grandparent / together), grandparent profile, photo limits, no deadline.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../netlify/lib/fmm-core.mjs';

const audio = Buffer.alloc(2000, 1);
const rec = (extra) => ({ data: audio, durationSec: 10, uploadId: 'u' + Math.random(), contentType: 'audio/mp4', ...extra });
const status = async (p) => { try { await p; return 200; } catch (e) { return e.status || 500; } };
const load = (store, id) => store.getJSON(`story/${id}`);
async function mk(opts = {}) {
  const store = C.makeMemoryStore();
  const { story, tokens } = await C.createStory(store, { childName: 'Devon', grandparentName: 'Mimi', test: true, ...opts });
  return { store, story, tokens };
}
async function exchange(store, tokens, n, qid) {
  const st = C.publicState((await C.authorize(store, tokens.child)).story, 'child');
  await C.choose(store, tokens.child, { n, qid: qid || st.current.choices[0].id });
  await C.upload(store, tokens.child, rec({ n, slot: 'question' }));
  await C.upload(store, tokens.grandparent, rec({ n, slot: 'answer' }));
  return C.markHeard(store, tokens.child, { n });
}

test('package sizes: 30 by default, 60 for the Big Story; anything else falls back to 30', async () => {
  assert.equal((await mk()).story.stops.length, 30);
  assert.equal((await mk({ stops: 60 })).story.stops.length, 60);
  assert.equal((await mk({ stops: 45 })).story.stops.length, 30);
});

test('Big Story, one grandparent: each approved stop twice in a row, never the same question twice', async () => {
  const { store, story, tokens } = await mk({ stops: 60 });
  let st = C.publicState(await load(store, story.id), 'child');
  assert.equal(st.total, 60); assert.equal(st.current.title, C.STOPS[0].title);
  const first = st.current.choices[0].id;
  await exchange(store, tokens, 1, first);
  st = C.publicState(await load(store, story.id), 'child');
  assert.equal(st.current.n, 2); assert.equal(st.current.title, C.STOPS[0].title); // same stop, second visit
  assert.ok(!st.current.choices.some((c) => c.id === first));                      // the first question is not offered again
  assert.equal(await status(C.choose(store, tokens.child, { n: 2, qid: first })), 400);
  await exchange(store, tokens, 2);
  st = C.publicState(await load(store, story.id), 'child');
  assert.equal(st.current.n, 3); assert.equal(st.current.title, C.STOPS[1].title);
  assert.equal(st.stops.filter((s) => s.chapter === 1).length, 10);
});

test('Big Story, together: grandparents alternate on each stop, 30 each, and may get the same question', async () => {
  const { story } = await mk({ stops: 60, grandparentName2: 'Papa' });
  const who = story.stops.map((_, i) => C.answererFor(story, i + 1));
  assert.equal(who.filter((w) => w === 'Mimi').length, 30); assert.equal(who.filter((w) => w === 'Papa').length, 30);
  assert.deepEqual([who[0], who[1]], ['Mimi', 'Papa']);
  assert.equal(C.choicesAt(story, 1).length, 3); // Papa sees all three choices for the stop Mimi just had
});

test('a full 60-stop story completes, starts the 12-month keepsake clock and allows the closing message', async () => {
  const { store, story, tokens } = await mk({ stops: 60, grandparentName2: 'Papa' });
  for (let n = 1; n <= 60; n++) await exchange(store, tokens, n);
  const s = await load(store, story.id);
  assert.ok(s.completedAt); assert.ok(Math.abs(s.expiresAt - (s.completedAt + 365 * 86400e3)) < 5000);
  assert.equal(C.publicState(s, 'child').done, true);
  await C.upload(store, tokens.grandparent, rec({ n: 0, slot: 'closing', durationSec: 60 }));
  assert.equal(C.movieKit(s, 'x').stops.length, 60);
});

test('no deadline: a story started years ago keeps working until it is finished', async () => {
  const { store, story, tokens } = await mk();
  assert.equal(story.expiresAt, null); assert.equal(C.paceMonths(story), 6);
  const s = await load(store, story.id); s.createdAt = Date.now() - 1500 * 86400e3; await store.setJSON(`story/${story.id}`, s);
  await exchange(store, tokens, 1);
  assert.equal(C.paceMonths((await mk({ stops: 60 })).story), 12);
});

test('photos: one per conversation (30 or 60)', async () => {
  const a = await mk(); const b = await mk({ stops: 60 });
  assert.equal(C.photoMax(a.story), 30); assert.equal(C.photoMax(b.story), 60);
  const s = await load(b.store, b.story.id);
  s.photos = Array.from({ length: 59 }, (_, i) => ({ id: 'x' + i, key: 'k' + i, by: 'grandparent', caption: '', at: 1 }));
  await b.store.setJSON(`story/${b.story.id}`, s);
  await C.uploadPhoto(b.store, b.tokens.grandparent, { data: Buffer.alloc(500, 1), contentType: 'image/jpeg', uploadId: 'last' });
  assert.equal(await status(C.uploadPhoto(b.store, b.tokens.grandparent, { data: Buffer.alloc(500, 1), contentType: 'image/jpeg', uploadId: 'over' })), 409);
});

test('profile: 20 multiple-choice questions, one profile per grandparent, all optional', async () => {
  assert.equal(C.PROFILE_QUESTIONS.length, 20);
  assert.equal(new Set(C.PROFILE_QUESTIONS.map((q) => q.id)).size, 20);
  const { store, story, tokens } = await mk({ grandparentName2: 'Papa' });
  let r = await C.saveProfile(store, tokens.grandparent, { k: 1, qid: 'born', answer: 2 });
  assert.deepEqual(r.profiles.map((p) => [p.name, p.answered]), [['Mimi', 0], ['Papa', 1]]);
  r = await C.saveProfile(store, tokens.child, { k: 0, qid: 'grewup', answer: 1 }); // the parent may help
  assert.equal(r.profiles[0].answers.grewup, 1);
  r = await C.saveProfile(store, tokens.grandparent, { k: 1, qid: 'born', answer: '' }); // clear
  assert.equal(r.profiles[1].answered, 0);
  assert.equal(await status(C.saveProfile(store, tokens.grandparent, { k: 0, qid: 'born', answer: 99 })), 400);
  assert.equal(await status(C.saveProfile(store, tokens.grandparent, { k: 0, qid: 'nope', answer: 0 })), 400);
  assert.equal(await status(C.saveProfile(store, tokens.grandparent, { k: 2, qid: 'born', answer: 0 })), 400);
  const kit = C.movieKit(await load(store, story.id), 'x');
  assert.equal(kit.profiles[0].answers['Where did you grow up?'], 'A small town');
});

test('profile: a child\'s own link cannot edit it and does not see it', async () => {
  const { store, tokens } = await mk();
  await C.childAccessTeen(store, tokens.child, { parentName: 'Amber', agree: true });
  const { link } = await C.setChildLink(store, tokens.child, { on: true });
  assert.equal(await status(C.saveProfile(store, link, { k: 0, qid: 'born', answer: 1 })), 403);
  assert.equal(C.publicState((await C.authorize(store, link)).story, 'child', true).profiles, null);
});
