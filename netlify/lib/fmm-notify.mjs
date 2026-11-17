// Family Memory Magnets: WHEN to email WHOM. Templates live in fmm-email.mjs; this file decides and records.
// Every send is logged on the story (or order) so nothing goes out twice and Admin can see what was sent.
import * as C from './fmm-core.mjs';
import * as E from './fmm-email.mjs';

const SITE = 'https://www.customsongme.com';
const DAY = 86400e3;
const now = () => Date.now();

async function logOn(store, key, entry) {
  const obj = await store.getJSON(key); if (!obj) return;
  obj.emailLog = [...(obj.emailLog || []), { at: now(), ...entry }].slice(-60);
  await store.setJSON(key, obj);
}
async function sendAndLog(store, key, kind, to, msg, extra = {}, fetchImpl) {
  const r = await E.send({ to, ...msg }, fetchImpl);
  await logOn(store, key, { kind, to: [].concat(to).filter(Boolean).join(', '), ok: !!r.ok, skipped: r.skipped ? r.reason : undefined, ...extra });
  return r;
}
const parentOf = (s) => s.parentEmail || '';
const buyerOf = (s) => s.buyer?.email || '';
const both = (s) => [parentOf(s), buyerOf(s)].filter(Boolean);

// ---------- payment confirmed (Stripe thank-you page, or Dan marks it paid) ----------
export async function orderPaid(store, orderId, how, fetchImpl) {
  const key = `order/${orderId}`; const o = await store.getJSON(key); if (!o) return { skipped: true };
  if ((o.emailLog || []).some((x) => x.kind === 'order-received')) return { duplicate: true };
  await sendAndLog(store, key, 'order-received', [o.email, o.parentEmail], E.T.orderReceived(o), {}, fetchImpl);
  await sendAndLog(store, key, 'dan-new-order', E.DAN(), E.T.danNewOrder(o, how), {}, fetchImpl);
  return { ok: true };
}

// Stripe sends the buyer back to /thanks/?session_id=…: check with Stripe that it really is paid, then mark the order.
export async function confirmStripe(store, sessionId, fetchImpl = fetch) {
  if (!/^cs_(live|test)_[A-Za-z0-9]{10,200}$/.test(String(sessionId || ''))) return { ok: false, error: 'bad session' };
  const key = process.env.STRIPE_SECRET_KEY; if (!key) return { ok: false, error: 'stripe not configured' };
  const r = await fetchImpl(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, { headers: { Authorization: `Bearer ${key}` } });
  const s = await r.json().catch(() => ({}));
  if (!r.ok || s.payment_status !== 'paid') return { ok: false, paid: false };
  const orderId = s.metadata?.fmm_order; if (!orderId) return { ok: true, paid: true, order: null };
  const o = await store.getJSON(`order/${orderId}`); if (!o) return { ok: true, paid: true, order: null };
  if (!o.paid) {
    o.paid = { method: 'stripe', note: `$${((s.amount_total || 0) / 100).toFixed(2)} by card`, at: now(), session: sessionId.slice(0, 40) };
    if (o.status === 'awaiting-payment') o.status = 'paid';
    await store.setJSON(`order/${orderId}`, o);
  }
  await orderPaid(store, orderId, 'by card', fetchImpl);
  return { ok: true, paid: true, order: orderId };
}

// ---------- story created: the welcome email with the links and both QR codes ----------
export async function welcome(store, story, links, qrPngs, fetchImpl) {
  const key = `story/${story.id}`; const att = qrPngs.map((q) => ({ filename: q.filename, content: q.data.toString('base64') }));
  const out = [];
  if (parentOf(story)) out.push(await sendAndLog(store, key, 'welcome-parent', parentOf(story), { ...E.T.welcome(story, { forWho: 'parent', link: links.child, gpLink: links.grandparent, buyerLink: links.guardian }), attachments: att }, {}, fetchImpl));
  if (buyerOf(story) && buyerOf(story).toLowerCase() !== parentOf(story).toLowerCase()) {
    const gp = story.buyer?.relation === 'grandparent' ? links.grandparent : null; // a grandparent buyer is usually the grandparent in the story
    out.push(await sendAndLog(store, key, 'welcome-buyer', buyerOf(story), { ...E.T.welcome(story, { forWho: 'buyer', gpLink: gp, buyerLink: links.buyer }), attachments: att }, {}, fetchImpl));
  }
  return out;
}

// ---------- events during the story ----------
export async function afterAnswer(store, storyId, n, fetchImpl) {
  const s = await store.getJSON(`story/${storyId}`); if (!s || s.emailOff || !parentOf(s)) return;
  return sendAndLog(store, `story/${storyId}`, 'your-turn', parentOf(s), E.T.yourTurn(s, C.answererFor(s, n)), { n }, fetchImpl);
}
export async function afterHeard(store, storyId, n, fetchImpl) {
  const s = C.norm(await store.getJSON(`story/${storyId}`) || {}); if (!s.id) return;
  const total = s.stops.length, i = n - 1, view = { ...s, completed: Math.min(C.currentIndex(s), total) };
  if (C.currentIndex(s) >= total) return sendAndLog(store, `story/${storyId}`, 'story-finished', both(s), E.T.storyFinished(view), {}, fetchImpl);
  const ch = C.defAt(s, i).chapter, nextCh = i + 1 < total ? C.defAt(s, i + 1).chapter : null;
  if (nextCh !== ch && !s.emailOff) {
    const chapter = C.CHAPTERS.find((c) => c.n === ch);
    return sendAndLog(store, `story/${storyId}`, 'chapter-done', both(s), E.T.chapterDone(view, ch, chapter?.title || '', view.completed), { chapter: ch }, fetchImpl);
  }
}
export async function consentReviewed(store, storyId, approved, note, fetchImpl) {
  const s = await store.getJSON(`story/${storyId}`); if (!s || !parentOf(s)) return;
  return sendAndLog(store, `story/${storyId}`, approved ? 'consent-approved' : 'consent-fix', parentOf(s), E.T.consentReviewed(s, approved, note), {}, fetchImpl);
}
export async function watchPublished(store, storyId, watchUrl, fetchImpl) {
  const s = await store.getJSON(`story/${storyId}`); if (!s) return;
  return sendAndLog(store, `story/${storyId}`, 'watch-published', both(s), E.T.watchPublished(s, watchUrl), {}, fetchImpl);
}
export async function magnetsShipped(store, storyId, tracking, fetchImpl) {
  const s = await store.getJSON(`story/${storyId}`); if (!s) return;
  s.magnetsShippedAt = now(); s.magnetsTracking = String(tracking || '').slice(0, 200); await store.setJSON(`story/${storyId}`, s);
  return sendAndLog(store, `story/${storyId}`, 'magnets-shipped', both(s), E.T.magnetsShipped(s, s.magnetsTracking), {}, fetchImpl);
}

// ---------- the daily job: reminders, nudges and Dan's morning summary ----------
export async function daily(store, fetchImpl, at = now()) {
  const lines = []; let sent = 0;
  const stories = []; for (const k of await store.list('story/')) { const s = await store.getJSON(k); if (s) stories.push(C.norm(s)); }
  const orders = []; for (const k of await store.list('order/')) { const o = await store.getJSON(k); if (o) orders.push(o); }
  for (const o of orders) if (o.paid && !(o.storyIds || []).length && o.status !== 'story-created') lines.push(`Create the story for ${o.childName} & ${o.grandparent1} (paid ${new Date(o.paid.at).toLocaleDateString('en-US')}).`);
  for (const s of stories) {
    const key = `story/${s.id}`, log = s.emailLog || [], last = (kind) => Math.max(0, ...log.filter((x) => x.kind === kind).map((x) => x.at));
    const label = `${s.childName} & ${s.grandparentName}`, done = C.currentIndex(s) >= s.stops.length;
    if (s.childAccess?.status === 'pending') lines.push(`Review the consent form for ${label}.`);
    if (!s.test && !s.magnetsShippedAt && at - s.createdAt > 2 * DAY) lines.push(`Magnets for ${label} are not marked shipped yet.`);
    if (s.unpublishRequestedAt) lines.push(`Take ${label}'s movie off YouTube (someone chose private).`);
    if (s.deletionRequestedAt) lines.push(`${label} asked for deletion.`);
    if (s.completedAt && s.expiresAt && s.expiresAt < at) lines.push(`${label}: keep-until date passed; deliver anything owed, then delete.`);
    if (s.test || s.emailOff || done || !parentOf(s)) continue;
    // permission reminder: 3 days after creation, then once a week, at most 3 times
    if (!s.consent && at - s.createdAt > 3 * DAY && log.filter((x) => x.kind === 'consent-reminder').length < 3 && at - last('consent-reminder') > 7 * DAY) {
      await sendAndLog(store, key, 'consent-reminder', parentOf(s), E.T.consentReminder(s), {}, fetchImpl); sent++; continue;
    }
    // gentle nudge: nothing happened for 7 days; then at most every 7 days
    if (s.consent && at - (s.lastActivityAt || s.createdAt) > 7 * DAY && at - last('nudge') > 7 * DAY) {
      const st = C.stopStatus(s, C.currentIndex(s));
      await sendAndLog(store, key, 'nudge', parentOf(s), E.T.nudge({ ...s, completed: C.currentIndex(s) }, st === 'awaiting-answer' ? 'grandparent' : 'child'), {}, fetchImpl); sent++;
    }
  }
  if (lines.length) await E.send({ to: E.DAN(), ...E.T.dailySummary(lines) }, fetchImpl); // only when something needs Dan
  return { sent, lines };
}
