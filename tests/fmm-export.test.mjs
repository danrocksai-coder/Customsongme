// "Download all recordings (ZIP)" tests. Run: node --test tests/fmm-export.test.mjs
// Fictional adult test voices only (fake bytes). Everything runs in memory; no network, no real data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as C from '../netlify/lib/fmm-core.mjs';
import * as Z from '../family-memory-magnets/admin/fmm-zip.mjs';

const SECRET = 'test-secret';
const dec = new TextDecoder();

// ---- a small independent ZIP reader, so we check the bytes rather than trust our own writer ----
function readZip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const eocd = u8.length - 22;
  assert.equal(dv.getUint32(eocd, true), 0x06054b50, 'end-of-ZIP marker');
  const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014b50, 'central directory entry');
    const method = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true), size = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
    assert.equal(dv.getUint32(off, true), 0x04034b50, 'local header');
    const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    const data = u8.subarray(start, start + size);
    files.set(name, { method, crc, data, order: i });
    p += 46 + nl + el + cl;
  }
  return files;
}
function parseCsv(text) { // tiny RFC-4180 reader
  const rows = []; let row = [], f = '', q = false; text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\r') { /* skip */ }
    else if (ch === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else f += ch;
  }
  return rows;
}

const bytesFor = (n, slot) => new Uint8Array(1500 + n * 7 + (slot === 'answer' ? 11 : 0)).fill((n * 13 + (slot === 'answer' ? 5 : 1)) % 251);

// A complete TEST story: 30 stops, intro, closing, 2 voice hellos. Answers alternate m4a / webm.
async function fullStory() {
  const store = C.makeMemoryStore();
  const { story, tokens } = await C.createStory(store, { childName: 'Devon', grandparentName: 'Mimi', test: true });
  for (const stop of C.STOPS) {
    const n = stop.n;
    await C.choose(store, tokens.child, { n, qid: stop.choices[0].id });
    await C.upload(store, tokens.child, { n, slot: 'question', data: Buffer.from(bytesFor(n, 'question')), durationSec: 9 + (n % 5), uploadId: 'q' + n, contentType: 'audio/mp4' });
    await C.upload(store, tokens.grandparent, { n, slot: 'answer', data: Buffer.from(bytesFor(n, 'answer')), durationSec: 40 + (n % 9), uploadId: 'a' + n, contentType: n % 2 ? 'audio/webm;codecs=opus' : 'audio/mp4' });
    await C.markHeard(store, tokens.child, { n });
  }
  await C.upload(store, tokens.grandparent, { n: 0, slot: 'intro', data: Buffer.from(bytesFor(100, 'intro')), durationSec: 70, uploadId: 'i', contentType: 'audio/mp4' });
  await C.upload(store, tokens.grandparent, { n: 0, slot: 'closing', data: Buffer.from(bytesFor(101, 'closing')), durationSec: 80, uploadId: 'c', contentType: 'audio/webm' });
  // two voice Little Hellos (injected directly: the 48-hour rule would otherwise block them in a test)
  const s = await store.getJSON(`story/${story.id}`);
  s.hellos = s.hellos || [];
  for (const [id, from, at, ct] of [['zz9', 'grandparent', Date.UTC(2026, 10, 20, 9, 30), 'audio/mp4'], ['aa1', 'child', Date.UTC(2026, 10, 18, 9, 30), 'audio/webm']]) {
    await store.setBlob(`audio/${story.id}/hello-${id}`, Buffer.from(bytesFor(id.length + 200, 'hello' + id)), { contentType: ct, durationSec: 7 });
    s.hellos.push({ id, from, kind: 'voice', at, uploadId: 'h' + id, audio: { key: `audio/${story.id}/hello-${id}`, durationSec: 7, contentType: ct, bytes: 1 } });
  }
  s.hellos.push({ id: 'tx1', from: 'child', kind: 'text', text: 'Hi Mimi!', at: Date.UTC(2026, 10, 19) }); // text hellos must NOT be exported
  await store.setJSON(`story/${story.id}`, s);
  return { store, id: story.id };
}
// What the page does for each clip: ask for a signed admin link, then fetch it.
const audioFrom = (store, id) => async (c) => {
  const key = C.slotKey(c.n, c.slot, c.hid); const sg = C.signMedia(SECRET, id, key);
  const blob = await C.readSignedAudio(store, SECRET, { s: id, k: key, e: sg.exp, sig: sg.sig });
  return { bytes: new Uint8Array(blob.data), contentType: blob.meta.contentType };
};

test('exportClips lists every clip, is read-only, and rejects unknown stories', async () => {
  const { store, id } = await fullStory();
  const before = JSON.stringify([await store.getJSON(`story/${id}`), store._dump()]);
  const m = await C.exportClips(store, id);
  assert.equal(m.clips.length, 30 * 2 + 1 + 1 + 2); // text hello excluded
  assert.equal(JSON.stringify([await store.getJSON(`story/${id}`), store._dump()]), before, 'nothing was changed');
  assert.equal((await C.exportClips(store, id)).clips.length, 64); // repeatable
  await assert.rejects(() => C.exportClips(store, 'nope'), (e) => e.status === 404);
});

test('file names sort in story order and use each clip\'s real file type', async () => {
  const { store, id } = await fullStory();
  const m = await C.exportClips(store, id);
  const r = await Z.buildStoryZip(m, audioFrom(store, id), () => {}, new Date(2026, 10, 21, 12, 0, 0));
  const files = readZip(r.zip);
  const names = [...files.entries()].sort((a, b) => a[1].order - b[1].order).map(([n]) => n);
  assert.deepEqual(names.slice(0, 5), ['01-question.m4a', '01-answer.webm', '02-question.m4a', '02-answer.m4a', '03-question.m4a']);
  assert.equal(names[59], '30-answer.m4a');
  assert.deepEqual(names.slice(60), ['closing.webm', 'hello-01.webm', 'hello-02.m4a', 'intro.m4a', 'manifest.csv', 'README.txt']);
  // stop numbers never go backwards, and the stop files stay in the ZIP in story order (question, then answer)
  const stops = names.slice(0, 60).map((n) => Number(n.slice(0, 2)));
  assert.deepEqual(stops, stops.map((_, i) => Math.floor(i / 2) + 1));
  // (Known quirk of the requested names: a file manager sorting A-Z lists "01-answer" before "01-question".)
  assert.equal(r.count, 64);
  assert.equal(r.fileName, 'fmm-Devon-Mimi-recordings.zip');
});

test('the ZIP opens: every file has the right bytes and checksum', async () => {
  const { store, id } = await fullStory();
  const m = await C.exportClips(store, id);
  const r = await Z.buildStoryZip(m, audioFrom(store, id));
  const files = readZip(r.zip);
  assert.equal(files.size, 66);
  for (const [name, f] of files) { assert.equal(f.method, 0, name + ' is stored uncompressed'); assert.equal(Z.crc32(f.data), f.crc, name + ' checksum'); }
  assert.deepEqual([...files.get('07-question.m4a').data], [...bytesFor(7, 'question')]);
  assert.deepEqual([...files.get('08-answer.m4a').data], [...bytesFor(8, 'answer')]);
  assert.deepEqual([...files.get('09-answer.webm').data], [...bytesFor(9, 'answer')]);
  assert.deepEqual([...files.get('intro.m4a').data], [...bytesFor(100, 'intro')]);
  assert.deepEqual([...files.get('closing.webm').data], [...bytesFor(101, 'closing')]);
  // an outside, independent tool agrees
  const dir = mkdtempSync(join(tmpdir(), 'fmmzip-'));
  try { writeFileSync(join(dir, 't.zip'), r.zip); assert.match(execFileSync('unzip', ['-t', join(dir, 't.zip')]).toString(), /No errors detected/); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test('manifest.csv has one correct row per clip, and README says the recordings are private', async () => {
  const { store, id } = await fullStory();
  const m = await C.exportClips(store, id);
  const r = await Z.buildStoryZip(m, audioFrom(store, id), () => {}, new Date(2026, 10, 21, 12, 0, 0));
  const files = readZip(r.zip);
  const rows = parseCsv(dec.decode(files.get('manifest.csv').data));
  assert.deepEqual(rows[0], ['file', 'stop_number', 'chapter', 'stop_title', 'question', 'recorded_by', 'duration_seconds', 'date_recorded']);
  assert.equal(rows.length - 1, 64);
  const row = (f) => rows.find((x) => x[0] === f);
  const stop1 = C.STOPS[0], ch1 = C.CHAPTERS.find((c) => c.n === stop1.chapter);
  const q1 = row('01-question.m4a'), a1 = row('01-answer.webm');
  assert.deepEqual(q1.slice(1, 6), ['1', ch1.title, stop1.title, stop1.choices[0].text, 'Devon']);
  assert.equal(q1[6], '10'); assert.match(q1[7], /^2026-\d\d-\d\dT[\d:.]+Z$/);
  assert.deepEqual(a1.slice(1, 6), ['1', ch1.title, stop1.title, stop1.choices[0].text, 'Mimi']);
  assert.equal(a1[6], '41');
  const last = C.STOPS[29], row30 = row('30-answer.m4a');
  assert.equal(row30[1], '30'); assert.equal(row30[2], C.CHAPTERS.find((c) => c.n === last.chapter).title);
  assert.deepEqual(row('intro.m4a').slice(1, 6), ['', '', 'Introduction', '', 'Mimi']);
  assert.deepEqual(row('closing.webm').slice(1, 6), ['', '', 'Closing message', '', 'Mimi']);
  assert.deepEqual(row('hello-01.webm').slice(1, 6), ['', '', 'Little Hello', '', 'Devon']); // sent first (Nov 18)
  assert.deepEqual(row('hello-02.m4a').slice(1, 6), ['', '', 'Little Hello', '', 'Mimi']);
  assert.equal(row('hello-02.m4a')[7], '2026-11-20T09:30:00.000Z');
  const readme = dec.decode(files.get('README.txt').data);
  assert.match(readme, /PRIVATE family recordings/); assert.match(readme, /Devon & Mimi \(TEST story\)/); assert.match(readme, /Clips in this folder: 64/);
});

test('progress is reported as "i of total", in order, one clip at a time', async () => {
  const { store, id } = await fullStory();
  const m = await C.exportClips(store, id);
  const seen = []; let inFlight = 0, maxInFlight = 0; const get = audioFrom(store, id);
  await Z.buildStoryZip(m, async (c) => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); const x = await get(c); inFlight--; return x; }, (i, t) => seen.push([i, t]));
  assert.equal(seen.length, 64); assert.deepEqual(seen[0], [1, 64]); assert.deepEqual(seen[11], [12, 64]); assert.deepEqual(seen[63], [64, 64]);
  assert.equal(maxInFlight, 1, 'clips are fetched strictly one at a time');
});

test('if any clip fails there is no partial ZIP', async () => {
  const { store, id } = await fullStory();
  const m = await C.exportClips(store, id); const get = audioFrom(store, id); let n = 0;
  await assert.rejects(() => Z.buildStoryZip(m, async (c) => { if (++n === 5) throw new Error('network down'); return get(c); }), /network down/);
  await assert.rejects(() => Z.buildStoryZip(m, async () => ({ bytes: new Uint8Array(0), contentType: 'audio/mp4' })), /empty/);
});

test('manifest text is safe in Excel/Sheets and survives commas and quotes', () => {
  const csv = Z.buildManifestCsv([{ file: '01-question.m4a', n: 1, chapter: 'A, B', stopTitle: 'He said "hi"', question: '=HYPERLINK("x")', by: '-Dev', durationSec: 9.04, at: Date.UTC(2026, 0, 2) }]);
  const rows = parseCsv(csv);
  assert.equal(rows[1][2], 'A, B'); assert.equal(rows[1][3], 'He said "hi"');
  assert.equal(rows[1][4], "'=HYPERLINK(\"x\")"); assert.equal(rows[1][5], "'-Dev"); assert.equal(rows[1][6], '9');
});

test('an empty story still makes a valid (empty) ZIP builder input and bad names are refused', () => {
  assert.throws(() => Z.makeZip([{ name: 'a', data: new Uint8Array(1) }, { name: 'a', data: new Uint8Array(1) }]), /Duplicate/);
  assert.throws(() => Z.planClips([{ slot: 'question', n: 1 }, { slot: 'question', n: 1 }]), /same file name/);
  assert.equal(readZip(Z.makeZip([])).size, 0);
  assert.equal(Z.extFor('audio/mp4'), 'm4a'); assert.equal(Z.extFor('audio/webm;codecs=opus'), 'webm'); assert.equal(Z.extFor(''), 'm4a');
});
