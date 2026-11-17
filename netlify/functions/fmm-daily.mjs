// Family Memory Magnets daily job (Netlify scheduled function): permission reminders, gentle nudges,
// and Dan's morning to-do email. Sends nothing until RESEND_API_KEY is set in Netlify.
import { blobStore } from '../lib/fmm-store.mjs';
import * as N from '../lib/fmm-notify.mjs';

export default async () => {
  const r = await N.daily(blobStore());
  console.log('fmm-daily', JSON.stringify({ sent: r.sent, todo: r.lines.length }));
  return new Response('ok');
};
export const config = { schedule: '0 15 * * *' }; // every day at 15:00 UTC = 7 or 8 am in California
