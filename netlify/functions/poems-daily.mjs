// CustomSongMe Love Poems — once a day, delete unpaid drafts (and their photos and recordings)
// that have not been touched for 14 days, plus expired rate-limit counters. Paid orders are kept.
// Netlify runs scheduled functions only on the published live site, so this only cleans the live store.
import { cleanup } from '../lib/poems-api.mjs';
import { blobStore } from './poems.mjs';

export default async () => {
  const r = await cleanup({ store: blobStore('love-poems'), now: () => Date.now() });
  console.log('love poems cleanup', r);
};

export const config = { schedule: '@daily' };
