// Automatic emails: nothing sends without a key; with one, the right people get the right email exactly once.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../netlify/lib/fmm-core.mjs';
import * as E from '../netlify/lib/fmm-email.mjs';
import * as N from '../netlify/lib/fmm-notify.mjs';

const audio = Buffer.alloc(2000, 1);
const rec = (extra) => ({ data: audio, durationSec: 10, uploadId: 'u' + Math.random(), contentType: 'audio/mp4', ...extra });
function mailbox() { // a fake Resend (and Stripe) that records what would be sent
  const sent = [];
  const f = async (url, opts) => {
    if (String(url).startsWith('https://api.resend.com')) { const b = JSON.parse(opts.body); sent.push(b); return new Response(JSON.stringify({ id: 'e' + sent.length }), { status: 200 }); }
    if (String(url).includes('api.stripe.com')) return new Response(JSON.stringify(f.stripe), { status: 200 });
    throw new Error('unexpected ' + url);
  };
  f.sent = sent; return f;
}
const withKey = async (fn) => { process.env.RESEND_API_KEY = 're_test'; process.env.STRIPE_SECRET_KEY = 'sk_test_x'; try { await fn(); } finally { delete process.env.RESEND_API_KEY; delete process.env.STRIPE_SECRET_KEY; } };

test('without a key nothing is sent and nothing fails', async () => {
  const mb = mailbox();
  const r = await E.send({ to: 'a@b.co', subject: 's', html: 'h', text: 't' }, mb);
  assert.deepEqual(r, { skipped: true, reason: 'email not configured' }); assert.equal(mb.sent.length, 0);
});

test('a send goes to Resend from the brand address, replies go to Dan, bad addresses are dropped', async () => withKey(async () => {
  const mb = mailbox();
  await E.send({ to: ['Amber@X.co', 'not-an-email', 'amber@x.co'], subject: 'Hi', html: '<b>h</b>', text: 'h' }, mb);
  assert.equal(mb.sent.length, 1); assert.deepEqual(mb.sent[0].to, ['amber@x.co']);
  assert.match(mb.sent[0].from, /Family Memory Magnets/); assert.equal(mb.sent[0].reply_to, 'danrocksai@gmail.com');
  assert.deepEqual(await E.send({ to: 'nope', subject: 's', html: 'h' }, mb), { skipped: true, reason: 'no address' });
}));

test('every template renders in the navy & gold layout with plain-text too', () => {
  const s = { childName: 'Devon', grandparentName: 'Mimi', stops: new Array(30) };
  const all = [E.T.orderReceived({ buyerName: 'A', childName: 'Devon', grandparent1: 'Mimi' }), E.T.danNewOrder({ childName: 'D', grandparent1: 'M', email: 'a@b.co' }),
    E.T.welcome(s, { forWho: 'parent', link: 'https://x/s?t=1', gpLink: 'https://x/s?t=2' }), E.T.consentReminder(s), E.T.yourTurn(s, 'Mimi'), E.T.nudge(s, 'child'),
    E.T.chapterDone(s, 2, 'The Growing-Up Years', 10), E.T.storyFinished(s), E.T.consentReviewed(s, true), E.T.watchPublished(s, 'https://x/q'), E.T.magnetsShipped(s, '1Z'), E.T.dailySummary(['x'])];
  for (const m of all) { assert.ok(m.subject && m.html.includes('#fcd42a') && m.html.includes('FAMILY MEMORY MAGNETS') && m.text.length > 20, m.subject); }
  assert.ok(!E.T.welcome({ ...s, childName: '<script>' }, { forWho: 'parent', link: 'x' }).html.includes('<script>')); // names are escaped
});

test('Stripe confirmation marks the order paid and emails the buyer and Dan exactly once', async () => withKey(async () => {
  const store = C.makeMemoryStore(); const mb = mailbox();
  await store.setJSON('order/o1', { id: 'o1', email: 'buyer@x.co', parentEmail: 'parent@x.co', buyerName: 'Rose', childName: 'Devon', grandparent1: 'Mimi', packageLabel: 'Just the Two of Us (30)', status: 'awaiting-payment' });
  mb.stripe = { payment_status: 'unpaid', metadata: { fmm_order: 'o1' } };
  assert.equal((await N.confirmStripe(store, 'cs_test_abcdefghijk', mb)).paid, false);
  mb.stripe = { payment_status: 'paid', amount_total: 9999, metadata: { fmm_order: 'o1' } };
  assert.equal((await N.confirmStripe(store, 'cs_test_abcdefghijk', mb)).paid, true);
  await N.confirmStripe(store, 'cs_test_abcdefghijk', mb); // page reloaded: no duplicates
  const o = await store.getJSON('order/o1');
  assert.equal(o.status, 'paid'); assert.equal(o.paid.method, 'stripe'); assert.equal(o.paid.note, '$99.99 by card');
  assert.equal(mb.sent.length, 2); assert.deepEqual(mb.sent[0].to, ['buyer@x.co', 'parent@x.co']); assert.deepEqual(mb.sent[1].to, ['danrocksai@gmail.com']);
  assert.equal((await N.confirmStripe(store, 'not-a-session', mb)).ok, false);
}));

test('welcome: parent gets the family + grandparent links and both QR codes; a grandparent buyer gets their own', async () => withKey(async () => {
  const store = C.makeMemoryStore(); const mb = mailbox();
  const { story } = await C.createStory(store, { childName: 'Devon', grandparentName: 'Mimi', parentEmail: 'amber@x.co', buyer: true, buyerEmail: 'rose@x.co', buyerRole: 'grandparent', test: true });
  const links = { child: 'https://s/?t=CHILD', grandparent: 'https://s/?t=GP', buyer: 'https://s/?t=BUY' };
  await N.welcome(store, story, links, [{ filename: 'qr-child.png', data: Buffer.from('a') }, { filename: 'qr-grandparent.png', data: Buffer.from('b') }], mb);
  assert.equal(mb.sent.length, 2);
  const [p, b] = mb.sent;
  assert.deepEqual(p.to, ['amber@x.co']); assert.ok(p.html.includes('t=CHILD') && p.html.includes('t=GP')); assert.equal(p.attachments.length, 2);
  assert.deepEqual(b.to, ['rose@x.co']); assert.ok(b.html.includes('t=BUY') && b.html.includes('t=GP') && !b.html.includes('t=CHILD'));
  assert.equal((await store.getJSON(`story/${story.id}`)).emailLog.length, 2);
}));

test('story events: your turn, chapter complete, story finished', async () => withKey(async () => {
  const store = C.makeMemoryStore(); const mb = mailbox();
  const { story, tokens } = await C.createStory(store, { childName: 'Devon', grandparentName: 'Mimi', parentEmail: 'amber@x.co', test: true });
  for (let n = 1; n <= 30; n++) {
    await C.choose(store, tokens.child, { n, qid: C.STOPS[n - 1].choices[0].id });
    await C.upload(store, tokens.child, rec({ n, slot: 'question' }));
    await C.upload(store, tokens.grandparent, rec({ n, slot: 'answer' }));
    if (n === 1) await N.afterAnswer(store, story.id, n, mb);
    await C.markHeard(store, tokens.child, { n });
    await N.afterHeard(store, story.id, n, mb);
  }
  const kinds = mb.sent.map((m) => m.subject);
  assert.match(kinds[0], /Mimi answered/);
  assert.equal(kinds.filter((k) => /^Chapter \d complete/.test(k)).length, 5); // chapters 1-5; the 6th is the finish
  assert.match(kinds.at(-1), /story is complete/);
}));

test('daily job: permission reminder after 3 days, nudge after 7 quiet days, never for test stories or when switched off', async () => withKey(async () => {
  const store = C.makeMemoryStore(); const mb = mailbox(); const DAY = 86400e3;
  const a = (await C.createStory(store, { childName: 'Ava', grandparentName: 'Nana', parentEmail: 'ava@x.co' })).story;
  const b = (await C.createStory(store, { childName: 'Ben', grandparentName: 'Papa', parentEmail: 'ben@x.co' })).story;
  const c = (await C.createStory(store, { childName: 'Cal', grandparentName: 'Gigi', parentEmail: 'cal@x.co', test: true })).story;
  const d = (await C.createStory(store, { childName: 'Dee', grandparentName: 'Pop', parentEmail: 'dee@x.co' })).story;
  for (const [s, patch] of [[a, { createdAt: Date.now() - 4 * DAY }], [b, { createdAt: Date.now() - 20 * DAY, lastActivityAt: Date.now() - 9 * DAY, consent: { parentName: 'B', at: 1 } }],
    [c, { createdAt: Date.now() - 30 * DAY }], [d, { createdAt: Date.now() - 30 * DAY, emailOff: true }]]) { const x = await store.getJSON(`story/${s.id}`); Object.assign(x, patch); await store.setJSON(`story/${s.id}`, x); }
  const r = await N.daily(store, mb);
  const to = mb.sent.map((m) => m.to[0]);
  assert.ok(to.includes('ava@x.co')); assert.ok(to.includes('ben@x.co')); assert.ok(!to.includes('cal@x.co')); assert.ok(!to.includes('dee@x.co'));
  assert.ok(to.includes('danrocksai@gmail.com')); assert.ok(r.lines.some((l) => /Magnets for Ava/.test(l)));
  const again = mailbox(); await N.daily(store, again); // the next day: nothing repeats inside a week
  assert.ok(!again.sent.some((m) => ['ava@x.co', 'ben@x.co'].includes(m.to[0])));
}));
