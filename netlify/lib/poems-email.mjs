// CustomSongMe Love Poems — delivery emails, sent through the same Resend account as Family Memory Magnets.
//   RESEND_API_KEY      already set in Netlify (shared)
//   POEMS_EMAIL_FROM    optional, default "Dan at CustomSongMe <hello@customsongme.com>"
//   FMM_DAN_EMAIL       optional, where Dan's order alerts go (default danrocksai@gmail.com)
// Without RESEND_API_KEY nothing is sent and nothing fails: every send returns { skipped: true }.

const NAVY = '#001a66', GOLD = '#fcd42a';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const DAN = () => process.env.FMM_DAN_EMAIL || 'danrocksai@gmail.com';

export async function send({ to, subject, html, text, attachments }, fetchImpl = fetch) {
  const list = [...new Set([].concat(to).map((x) => String(x || '').trim().toLowerCase()).filter((x) => EMAIL.test(x)))];
  if (!list.length) return { skipped: true, reason: 'no address' };
  if (!process.env.RESEND_API_KEY) return { skipped: true, reason: 'email not configured' };
  try {
    const r = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.POEMS_EMAIL_FROM || 'Dan at CustomSongMe <hello@customsongme.com>', to: list, subject, html, text,
        reply_to: DAN(), ...(attachments?.length ? { attachments } : {}) }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { console.log('poems email failed', r.status, j?.message || ''); return { ok: false, status: r.status, error: j?.message || '' }; }
    return { ok: true, id: j.id };
  } catch (e) { console.log('poems email error', String(e)); return { ok: false }; }
}

function layout({ title, intro, blocks = [], button, test }) {
  const btn = button ? `<tr><td align="center" style="padding:6px 0 20px"><a href="${esc(button.url)}" style="display:inline-block;background:${GOLD};color:${NAVY};font:800 17px Arial,sans-serif;text-decoration:none;padding:14px 26px;border-radius:14px">${esc(button.label)}</a></td></tr>` : '';
  const body = blocks.map((b) => `<tr><td style="padding:0 26px 14px;font:16px/1.55 Arial,sans-serif;color:#1b1f2a">${b}</td></tr>`).join('');
  const banner = test ? `<tr><td align="center" style="background:#ffe08a;padding:8px;font:700 13px Arial,sans-serif;color:#5a3d00">TEST ORDER — no real payment was taken</td></tr>` : '';
  const html = `<!doctype html><html><body style="margin:0;background:#e8eefc">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e8eefc;padding:22px 10px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:4px solid ${GOLD};border-radius:22px;overflow:hidden">
${banner}<tr><td align="center" style="background:${NAVY};padding:22px 18px;border-bottom:4px solid ${GOLD}">
<div style="font:800 12px Arial,sans-serif;letter-spacing:2px;color:${GOLD}">CUSTOMSONGME LOVE POEMS</div>
<div style="font:700 26px Georgia,serif;color:#ffffff;margin-top:8px">${esc(title)}</div></td></tr>
<tr><td style="padding:22px 26px 10px;font:17px/1.55 Arial,sans-serif;color:#1b1f2a">${intro}</td></tr>
${body}${btn}
<tr><td align="center" style="padding:14px 22px 22px;font:13px/1.5 Arial,sans-serif;color:#5b6478;border-top:1px solid #dde3f2">Questions? Just reply, or text me at (661) 714-0903.<br>CustomSongMe &middot; 1340 Kumquat Pl, Oxnard, CA 93030</td></tr>
</table></td></tr></table></body></html>`;
  const strip = (h) => String(h).replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
  const text = [test ? 'TEST ORDER — no real payment was taken.\n' : '', title, '', strip(intro), ...blocks.map(strip), button ? `${button.label}: ${button.url}` : '', '', 'Questions? Reply, or text me at (661) 714-0903.'].join('\n');
  return { html, text };
}

export const T = {
  delivered(o, giftUrl) {
    const voice = o.pkg === 'voice';
    return {
      subject: `${o.test ? '[TEST] ' : ''}Your love poem is ready: "${o.final.title}"`,
      ...layout({
        test: o.test, title: 'Your poem is ready',
        intro: `Hi${o.about?.yourName ? ' ' + esc(o.about.yourName) : ''}, thank you! Your poem <b>"${esc(o.final.title)}"</b> is attached as a print-ready PDF (no watermark).`,
        blocks: [
          'Print it on nice paper (8.5 x 11), frame it, or send the PDF straight to them.',
          voice ? (o.audio ? 'The QR code on the page plays your recording. You can re-record any time from your private gift page, and the same QR code will play the new version.'
            : '<b>Next step:</b> record yourself reading the poem on your private gift page. The QR code on the page will play it as soon as you save it.') : '',
          'Keep this email: the button below is your private link to download the poem again.',
        ].filter(Boolean),
        button: { label: voice && !o.audio ? 'Record my voice' : 'Open my gift page', url: giftUrl },
      }),
    };
  },
  danNewOrder(o, giftUrl, amountText) {
    return {
      subject: `${o.test ? '[TEST] ' : ''}New love poem order: ${o.pkg === 'voice' ? '$25 voice' : '$20 PDF'} (${amountText})`,
      ...layout({
        test: o.test, title: 'New love poem order',
        intro: `Paid and delivered automatically to ${esc(o.email)}.`,
        blocks: [`Title: <b>${esc(o.final.title)}</b><br>For: ${esc(o.about?.recipientName || '(no name)')} &middot; From: ${esc(o.about?.yourName || '(no name)')}<br>Package: ${o.pkg === 'voice' ? 'Love Poem in Your Voice ($25)' : 'Love Poem PDF ($20)'}<br>Order: ${esc(o.id)}`],
        button: { label: 'Open the gift page', url: giftUrl },
      }),
    };
  },
  danProblem(o, what) {
    return { subject: `${o?.test ? '[TEST] ' : ''}Love poem order needs a look`, ...layout({ test: o?.test, title: 'Something needs a look', intro: esc(what), blocks: [o ? `Order: ${esc(o.id)} &middot; ${esc(o.email || '')}` : ''] }) };
  },
};
