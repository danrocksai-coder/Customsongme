// Every Family Memory Magnets page must load the CURRENT version of the shared CSS/JS (the site caches them for a year).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pages, stamp } from '../tools/fmm-version-assets.mjs';

test('asset links carry the current content version (run: node tools/fmm-version-assets.mjs)', () => {
  for (const p of pages()) {
    const html = readFileSync(p, 'utf8');
    assert.equal(html, stamp(html), `${p} links an out-of-date fmm.css/magnet.js version`);
  }
});
