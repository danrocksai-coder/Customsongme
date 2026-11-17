// Stamps the Family Memory Magnets pages with a version for each shared asset (?v=<content hash>).
// The site caches .css/.js for a year, so a changed file must get a new URL or returning visitors keep the old one.
// Run after editing fmm.css or admin/magnet.js:  node tools/fmm-version-assets.mjs   (tests/fmm-assets.test.mjs checks it)
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
export const ASSETS = ['/family-memory-magnets/fmm.css', '/family-memory-magnets/admin/magnet.js'];
export const hashOf = (url) => createHash('sha256').update(readFileSync(join(ROOT, url))).digest('hex').slice(0, 10);
export function pages(dir = join(ROOT, 'family-memory-magnets')) {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? pages(p) : p.endsWith('.html') ? [p] : []; });
}
export function stamp(html) {
  for (const url of ASSETS) {
    const esc = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp(`(["'])${esc}(\\?v=[\\w-]*)?\\1`, 'g'), `$1${url}?v=${hashOf(url)}$1`);
  }
  return html;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  let n = 0;
  for (const p of pages()) { const a = readFileSync(p, 'utf8'); const b = stamp(a); if (a !== b) { writeFileSync(p, b); n++; } }
  console.log(`stamped ${n} page(s):`, ASSETS.map((u) => `${u}?v=${hashOf(u)}`).join(' '));
}
