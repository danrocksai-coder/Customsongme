// Family Memory Magnets: automatic emails (sent through Resend, https://resend.com).
// Turned on by Netlify environment variables (never in code or chat):
//   RESEND_API_KEY   the sending key from Resend
//   FMM_EMAIL_FROM   optional, default "Family Memory Magnets <hello@customsongme.com>"
//   FMM_DAN_EMAIL    optional, where Dan's alerts and morning summary go (default danrocksai@gmail.com)
// Without RESEND_API_KEY nothing is sent and nothing fails: every send returns { skipped: true }.

const SITE = 'https://www.customsongme.com';
const NAVY = '#001a66', GOLD = '#fcd42a', INK = '#00247f';
export const DAN = () => process.env.FMM_DAN_EMAIL || 'danrocksai@gmail.com';
export const enabled = () => !!process.env.RESEND_API_KEY;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Send one email. `fetchImpl` lets tests capture what would be sent.
export async function send({ to, subject, html, text, attachments, replyTo }, fetchImpl = fetch) {
  const list = [...new Set((Array.isArray(to) ? to : [to]).map((x) => String(x || '').trim().toLowerCase()).filter((x) => EMAIL.test(x)))];
  if (!list.length) return { skipped: true, reason: 'no address' };
  if (!enabled()) return { skipped: true, reason: 'email not configured' };
  try {
    const r = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.FMM_EMAIL_FROM || 'Family Memory Magnets <hello@customsongme.com>', to: list, subject, html, text,
        reply_to: replyTo || DAN(), ...(attachments?.length ? { attachments } : {}) }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { console.log('email failed', r.status, j?.message || ''); return { ok: false, status: r.status }; }
    return { ok: true, id: j.id };
  } catch (e) { console.log('email error', String(e)); return { ok: false }; }
}

// Navy & gold layout, written with inline styles (email programs ignore most stylesheets).
export function layout({ title, intro, blocks = [], button, footnote }) {
  const btn = button ? `<tr><td align="center" style="padding:6px 0 18px"><a href="${esc(button.url)}" style="display:inline-block;background:${GOLD};color:${NAVY};font:800 17px Arial,sans-serif;text-decoration:none;padding:14px 26px;border-radius:14px">${esc(button.label)}</a></td></tr>` : '';
  const body = blocks.map((b) => `<tr><td style="padding:0 26px 14px;font:16px/1.55 Arial,sans-serif;color:#1b1f2a">${b}</td></tr>`).join('');
  const html = `<!doctype html><html><body style="margin:0;background:#e8eefc">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e8eefc;padding:22px 10px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:4px solid ${GOLD};border-radius:22px;overflow:hidden">
<tr><td align="center" style="background:${NAVY};padding:22px 18px;border-bottom:4px solid ${GOLD}">
<div style="font:800 12px Arial,sans-serif;letter-spacing:2px;color:${GOLD}">FAMILY MEMORY MAGNETS</div>
<div style="font:700 26px Georgia,serif;color:#ffffff;margin-top:8px">${esc(title)}</div></td></tr>
<tr><td style="padding:22px 26px 10px;font:17px/1.55 Arial,sans-serif;color:#1b1f2a">${intro || ''}</td></tr>
${body}${btn}
<tr><td align="center" style="padding:14px 22px 22px;font:13px/1.5 Arial,sans-serif;color:#5b6478;border-top:1px solid #dde3f2">${footnote ? esc(footnote) + '<br>' : ''}Questions? Just reply, or text Dan at (661) 714-0903.<br><a href="${SITE}/family-memory-magnets/help/" style="color:${INK}">Help page</a> &middot; <a href="${SITE}/family-memory-magnets/privacy/" style="color:${INK}">Privacy</a></td></tr>
</table></td></tr></table></body></html>`;
  const text = [title, '', stripTags(intro), ...blocks.map(stripTags), button ? `${button.label}: ${button.url}` : '', '', 'Questions? Reply, or text Dan at (661) 714-0903.'].filter((x) => x !== undefined).join('\n');
  return { html, text };
}
const stripTags = (h) => String(h || '').replace(/<br\s*\/?>/g, '\n').replace(/<li>/g, '• ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&middot;/g, '·').trim();
const names = (s) => (Array.isArray(s.grandparents) && s.grandparents.length === 2 ? `${s.grandparents[0]} & ${s.grandparents[1]}` : s.grandparentName);
const pace = (s) => ((s.stops?.length || 30) === 60 ? 'about a year' : 'about 6 months');

// ---------- the emails ----------
export const T = {
  orderReceived(o) {
    return { subject: 'Your Family Memory Magnets order is in', ...layout({ title: 'Thank you!',
      intro: `Hi ${esc(o.buyerName || o.parentName)}, your order for <b>${esc(o.childName)} &amp; ${esc(o.grandparent1)}${o.grandparent2 ? ' &amp; ' + esc(o.grandparent2) : ''}</b> is paid and in.`,
      blocks: ['<b>What happens next</b><ul style="margin:6px 0 0 18px;padding:0"><li>Within 24 hours I set up your story and email you the private links and two QR codes to print.</li><li>Your two custom magnets are ordered within 24 hours, and I let you know when they ship.</li><li>The suggested pace is about one conversation a week. There is no deadline.</li></ul>'],
      footnote: `Package: ${o.packageLabel || ''}` }) };
  },
  danNewOrder(o, how) {
    return { subject: `New paid order: ${o.childName} & ${o.grandparent1} (${o.packageLabel || o.package})`, ...layout({ title: 'New paid order',
      intro: `${esc(o.buyerName)} (${esc(o.email)}) paid ${how ? esc(how) : ''} for <b>${esc(o.packageLabel || o.package)}</b>.`,
      blocks: [`Child: ${esc(o.childName)} · Grandparent(s): ${esc(o.grandparent1)}${o.grandparent2 ? ', ' + esc(o.grandparent2) : ''}`, 'Create the story in Admin and order the two magnets today.'],
      button: { label: 'Open Admin', url: `${SITE}/family-memory-magnets/admin/` } }) };
  },
  welcome(s, { forWho, link, gpLink, buyerLink }) {
    const parent = forWho === 'parent';
    const blocks = [];
    if (parent) blocks.push(`<b>Your family link</b> (you and ${esc(s.childName)} record together):<br><a href="${esc(link)}" style="color:${INK};word-break:break-all">${esc(link)}</a>`);
    if (gpLink) blocks.push(`<b>${esc(names(s))}'s link</b> (send it to them by text, or they can scan their magnet once it arrives):<br><a href="${esc(gpLink)}" style="color:${INK};word-break:break-all">${esc(gpLink)}</a>`);
    if (buyerLink) blocks.push(`<b>Your settings link</b> (profiles, photos and progress):<br><a href="${esc(buyerLink)}" style="color:${INK};word-break:break-all">${esc(buyerLink)}</a>`);
    blocks.push('The two QR codes are attached. Print them and start right away; your magnets are on their way.');
    blocks.push('Please keep these links private. They open your family\'s story.');
    return { subject: `Your family story is ready: ${s.childName} & ${names(s)}`, ...layout({ title: 'Your story is ready!',
      intro: `${esc(s.childName)} &amp; ${esc(names(s))}'s Family Story is set up. ${parent ? 'First, open your family link and give permission. Then pick the first question together.' : ''}`,
      blocks, button: parent ? { label: 'Open our family story', url: link } : (buyerLink ? { label: 'Open my settings', url: buyerLink } : null),
      footnote: `Designed to take ${pace(s)}. There is no deadline.` }) };
  },
  consentReminder(s) {
    return { subject: `One quick step to start ${s.childName}'s story`, ...layout({ title: 'Ready when you are',
      intro: `${esc(s.childName)} &amp; ${esc(names(s))}'s story is waiting for one thing: your permission. It takes a few seconds.`,
      blocks: ['Open your family link (or scan the child\'s magnet) and tap <b>I agree and continue</b>. Then pick the first question together.'],
      footnote: 'Nothing is recorded until a parent says yes.' }) };
  },
  yourTurn(s, who) {
    return { subject: `${who} answered! It's ${s.childName}'s turn`, ...layout({ title: `${esc(who)} answered!`,
      intro: `${esc(who)} just recorded an answer for ${esc(s.childName)}. Listen together, then pick the next question.`,
      blocks: ['Open your family link or scan the magnet to listen.'] }) };
  },
  nudge(s, waitingOn) {
    return { subject: `A gentle nudge for ${s.childName} & ${names(s)}`, ...layout({ title: 'Your story is waiting',
      intro: waitingOn === 'grandparent' ? `${esc(s.childName)}'s question is waiting for ${esc(names(s))}. A quick text with their link might help.` : `It's ${esc(s.childName)}'s turn to pick the next question. About one a week keeps the story moving.`,
      blocks: [`${s.completed || 0} of ${s.stops?.length || 30} conversations saved so far.`], footnote: 'No rush and no deadline. Reply "stop reminders" and I will turn these off.' }) };
  },
  chapterDone(s, n, title, done) {
    return { subject: `Chapter ${n} complete: ${title}`, ...layout({ title: `Chapter ${n} complete!`,
      intro: `${esc(s.childName)} &amp; ${esc(names(s))} finished <b>${esc(title)}</b>. ${done} of ${s.stops?.length || 30} conversations saved.`,
      blocks: [n < 6 ? `Next up: Chapter ${n + 1}.` : 'That was the final chapter!'] }) };
  },
  storyFinished(s) {
    return { subject: `${s.childName} & ${names(s)}: your story is complete!`, ...layout({ title: 'The whole story is saved!',
      intro: `Every conversation is recorded. Your family movie, storybook and keepsake are now being made.`,
      blocks: ['One question for you and the grandparent: should the finished movie stay <b>private</b>, or be <b>shared</b> on the magnet page? Each of you answers on your own page.', 'Grandparents can also record an optional closing message.'] }) };
  },
  consentReviewed(s, approved, note) {
    return { subject: approved ? `${s.childName}'s own link can now be turned on` : `About ${s.childName}'s consent form`, ...layout({ title: approved ? 'Form approved' : 'One small fix needed',
      intro: approved ? `Thank you. Your signed form is approved. You can now turn on ${esc(s.childName)}'s own link from your page whenever you're ready.` : `Your form could not be approved yet: ${esc(note || '')}`,
      blocks: [approved ? 'You can turn it off again at any time.' : 'Please upload a clear photo of the whole signed and dated form from your page.'] }) };
  },
  watchPublished(s, watchUrl) {
    return { subject: `Your family movie is ready: ${s.childName} & ${names(s)}`, ...layout({ title: 'Your movie is ready!',
      intro: `${esc(s.childName)} &amp; ${esc(names(s))}'s Family Story is now playing on both magnets. Scan either one, or open the link below.`,
      button: { label: 'Watch our movie', url: watchUrl } }) };
  },
  magnetsShipped(s, tracking) {
    return { subject: 'Your Family Memory Magnets are on the way', ...layout({ title: 'Magnets on the way!',
      intro: `Your two custom magnets for ${esc(s.childName)} &amp; ${esc(names(s))} have shipped, one to each home.`,
      blocks: tracking ? [`Tracking: ${esc(tracking)}`] : [] }) };
  },
  dailySummary(lines) {
    return { subject: `Family Memory Magnets: today's to-do (${lines.length})`, ...layout({ title: 'Good morning, Dan',
      intro: lines.length ? 'Here is what needs you today:' : 'Nothing needs you today.',
      blocks: lines.length ? [`<ul style="margin:0 0 0 18px;padding:0">${lines.map((l) => `<li style="margin:4px 0">${esc(l)}</li>`).join('')}</ul>`] : [],
      button: { label: 'Open Admin', url: `${SITE}/family-memory-magnets/admin/` } }) };
  },
};
