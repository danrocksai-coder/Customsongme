// Payment recorded on a story (Stripe, cash, other, free) so orders paid outside Stripe are tracked.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../netlify/lib/fmm-core.mjs';

test('a story records how it was paid; unknown methods become "other"; none = null', async () => {
  const store = C.makeMemoryStore();
  const a = (await C.createStory(store, { childName: 'Devon', grandparentName: 'Mimi', payment: 'cash', paymentNote: '$99.99 cash' })).story;
  assert.equal(a.payment.method, 'cash'); assert.equal(a.payment.note, '$99.99 cash'); assert.ok(a.payment.at);
  const b = (await C.createStory(store, { childName: 'Devon', grandparentName: 'Mimi', payment: 'bitcoin' })).story;
  assert.equal(b.payment.method, 'other');
  const c = (await C.createStory(store, { childName: 'Devon', grandparentName: 'Mimi', test: true })).story;
  assert.equal(c.payment, null);
});
