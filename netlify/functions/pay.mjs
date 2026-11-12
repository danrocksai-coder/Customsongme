// CustomSongMe — dynamic Stripe Checkout.
//
// Every "Card (Stripe)" button on the site points to /pay/<payment-link-id>.
// This function looks up the package for that id, creates a Stripe Checkout
// Session with the right price, and sends the customer to Stripe's hosted page.
//
// SAFETY NET: if anything goes wrong (unknown id, missing key, Stripe error),
// the customer is sent to the original buy.stripe.com payment link instead,
// so a card payment can never get stuck.
//
// Needs the Netlify environment variable STRIPE_SECRET_KEY (restricted key
// with "Checkout Sessions: Write" permission).

const SITE = 'https://www.customsongme.com';

// Prices live here on the server so nobody can change them from the browser.
// Key = the id at the end of the old buy.stripe.com link.
const PACKAGES = {
  '3cIaEWcLKb09cS7fcy9Ve0f': { name: 'Custom Song — Complete (Public)', amount: 5000 },
  '8x2fZgh20fgp8BRc0m9Ve0h': { name: 'Custom Song — Complete (Unlisted)', amount: 7500 },
  'cNieVc2767NX3hxd4q9Ve06': { name: 'Custom Song — MP3 Only', amount: 3000 },
  'fZu4gy4fe2tDcS70hE9Ve01': { name: 'Business Jingle', amount: 10000 },
  '3cI8wOcLK6JT05l9Se9Ve0l': { name: 'Family Gratitude MP3 (Thanksgiving)', amount: 2500 },
  'cNiaEW3ba5FP19pe8u9Ve0k': { name: 'Ultimate Family (Thanksgiving, Public)', amount: 7500 },
  'aFadR8132c4d6tJ6G29Ve0j': { name: 'Ultimate Family (Thanksgiving, Unlisted)', amount: 10000 },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fallback(id, email) {
  let url = 'https://buy.stripe.com/' + encodeURIComponent(id);
  if (email) url += '?prefilled_email=' + encodeURIComponent(email);
  return Response.redirect(url, 302);
}

export default async (req, context) => {
  const url = new URL(req.url);
  const id = (context.params && context.params.id) || url.pathname.split('/').filter(Boolean).pop() || '';
  const rawEmail = (url.searchParams.get('prefilled_email') || '').trim();
  const email = EMAIL_RE.test(rawEmail) ? rawEmail : '';

  const pkg = PACKAGES[id];
  const key = process.env.STRIPE_SECRET_KEY;
  if (!pkg || !key) {
    console.log('pay: falling back', { id, hasPkg: !!pkg, hasKey: !!key });
    return fallback(id, email);
  }

  // Send the customer back to the page they came from if they cancel.
  let cancelUrl = SITE + '/';
  const ref = req.headers.get('referer');
  if (ref && ref.startsWith(SITE)) cancelUrl = ref;

  const body = new URLSearchParams({
    mode: 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(pkg.amount),
    'line_items[0][price_data][product_data][name]': pkg.name,
    success_url: SITE + '/thanks?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: cancelUrl,
    'metadata[package]': pkg.name,
    'metadata[link_id]': id,
    'payment_intent_data[description]': 'CustomSongMe — ' + pkg.name,
  });
  if (email) body.set('customer_email', email);

  try {
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    const data = await res.json();
    if (!res.ok || !data.url) {
      console.log('pay: Stripe error', res.status, data && data.error && data.error.message);
      return fallback(id, email);
    }
    return Response.redirect(data.url, 303);
  } catch (err) {
    console.log('pay: request failed', String(err));
    return fallback(id, email);
  }
};

export const config = { path: '/pay/:id' };
