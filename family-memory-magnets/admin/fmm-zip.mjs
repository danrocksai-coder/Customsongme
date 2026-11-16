// Family Memory Magnets - "Download all recordings" helpers (Admin only).
// Pure functions, no network, no storage: they only turn clip details + audio bytes into a ZIP in memory.
// Used by /family-memory-magnets/admin/ in the browser and by tests/fmm-export.test.mjs in Node.
// The ZIP is "stored" (uncompressed): audio is already compressed, and this keeps the builder tiny.

const enc = new TextEncoder();

// ---------- file names ----------
export function extFor(contentType) {
  const t = String(contentType || '').toLowerCase();
  if (/webm/.test(t)) return 'webm';
  if (/ogg/.test(t)) return 'ogg';
  if (/mpeg|mp3/.test(t)) return 'mp3';
  if (/wav/.test(t)) return 'wav';
  return 'm4a'; // audio/mp4, audio/aac, audio/x-m4a and anything else an iPhone records
}
const pad2 = (n) => String(n).padStart(2, '0');

// Sorts in story order: 01-question, 01-answer, 02-question ... 30-answer, closing, hello-01.., intro.
// Returns the clips (same objects, copied) in that order, each with .base (file name without extension).
export function planClips(clips) {
  const helloOrder = clips.filter((c) => c.slot === 'hello').sort((a, b) => (a.at || 0) - (b.at || 0));
  const out = clips.map((c) => {
    let base;
    if (c.slot === 'question' || c.slot === 'answer') base = `${pad2(c.n)}-${c.slot}`;
    else if (c.slot === 'hello') base = `hello-${pad2(helloOrder.indexOf(c) + 1)}`;
    else if (c.slot === 'intro' || c.slot === 'closing') base = c.slot;
    else throw new Error('Unknown clip type: ' + c.slot);
    return { ...c, base };
  });
  const rank = (c) => (c.slot === 'question' ? 0 : c.slot === 'answer' ? 1 : 2);
  out.sort((a, b) => {
    const na = a.slot === 'question' || a.slot === 'answer', nb = b.slot === 'question' || b.slot === 'answer';
    if (na && nb) return a.n - b.n || rank(a) - rank(b);
    if (na !== nb) return na ? -1 : 1;
    return a.base < b.base ? -1 : a.base > b.base ? 1 : 0;
  });
  const seen = new Set();
  for (const c of out) { if (seen.has(c.base)) throw new Error('Two clips would have the same file name: ' + c.base); seen.add(c.base); }
  return out;
}

// ---------- manifest.csv ----------
// A cell that starts with = + - @ could run as a formula when opened in Excel/Sheets, so it gets a leading apostrophe.
function cell(v) {
  let s = v == null ? '' : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export const MANIFEST_HEADER = ['file', 'stop_number', 'chapter', 'stop_title', 'question', 'recorded_by', 'duration_seconds', 'date_recorded'];
// clips: planned clips where .file is the final file name including extension.
export function buildManifestCsv(clips) {
  const rows = [MANIFEST_HEADER.map(cell).join(',')];
  for (const c of clips) {
    rows.push([
      c.file, c.n > 0 ? c.n : '', c.chapter, c.stopTitle, c.question, c.by,
      c.durationSec == null ? '' : Math.round(c.durationSec * 10) / 10,
      c.at ? new Date(c.at).toISOString() : '',
    ].map(cell).join(','));
  }
  return '﻿' + rows.join('\r\n') + '\r\n'; // BOM so Excel reads accents/apostrophes correctly
}

export function buildReadme({ childName, grandparentName, test, count, when }) {
  return [
    'FAMILY MEMORY MAGNETS - ALL RECORDINGS',
    '',
    `Story: ${childName} & ${grandparentName}${test ? ' (TEST story)' : ''}`,
    `Clips in this folder: ${count}`,
    `Downloaded: ${new Date(when).toISOString()}`,
    '',
    'These are PRIVATE family recordings. Please keep them private, store them safely, and do not share them',
    'or post them anywhere without the family\'s permission.',
    '',
    'What the files are:',
    '  01-question, 01-answer, 02-question ...   Each stop: the grandchild\'s question, then the grandparent\'s answer.',
    '  intro            The optional introduction.',
    '  closing          The optional closing message.',
    '  hello-01, ...    Optional voice "Little Hellos", in the order they were sent.',
    '  manifest.csv     One row per clip: file, stop, chapter, question text, who recorded it, length, date.',
    '',
    'File types: .m4a (iPhone) and .webm (some Android phones). Most players open .m4a; for .webm try VLC.',
    '',
  ].join('\r\n');
}

// ---------- ZIP (stored, no compression) ----------
let TABLE;
export function crc32(bytes) {
  if (!TABLE) { TABLE = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; TABLE[n] = c >>> 0; } }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function dosDateTime(d) {
  const y = Math.max(1980, d.getFullYear());
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}
// entries: [{ name: 'a.txt', data: Uint8Array }] -> Uint8Array (a valid .zip)
export function makeZip(entries, when = new Date()) {
  if (entries.length > 65535) throw new Error('Too many files for a ZIP.');
  const { time, date } = dosDateTime(when);
  const parts = []; const central = []; let offset = 0;
  const names = new Set();
  for (const e of entries) {
    if (names.has(e.name)) throw new Error('Duplicate file name in ZIP: ' + e.name);
    names.add(e.name);
    const name = enc.encode(e.name); const data = e.data; const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
    if (offset > 0xFFFFFFFF - 1e6) throw new Error('This story is too large for a simple ZIP (over 4 GB).');
  }
  let cdSize = 0; for (const p of central) cdSize += p.length;
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  let total = 0; for (const p of all) total += p.length;
  const out = new Uint8Array(total); let o = 0;
  for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}

// ---------- the whole job ----------
// manifest: what the server's export-clips route returned.
// getAudio(clip): async -> { bytes: Uint8Array, contentType: string }; the page fetches one clip at a time.
// onProgress(done, total). Returns { zip: Uint8Array, fileName, count }. Throws (no partial ZIP) if any clip cannot be fetched.
export async function buildStoryZip(manifest, getAudio, onProgress = () => {}, when = new Date()) {
  const plan = planClips(manifest.clips);
  const entries = []; const done = [];
  for (let i = 0; i < plan.length; i++) {
    onProgress(i + 1, plan.length);
    const c = plan[i];
    const got = await getAudio(c);
    if (!got || !got.bytes || !got.bytes.length) throw new Error('Clip ' + c.base + ' came back empty.');
    const file = c.base + '.' + extFor(got.contentType || c.contentType);
    entries.push({ name: file, data: got.bytes });
    done.push({ ...c, file });
  }
  entries.push({ name: 'manifest.csv', data: enc.encode(buildManifestCsv(done)) });
  entries.push({ name: 'README.txt', data: enc.encode(buildReadme({ childName: manifest.childName, grandparentName: manifest.grandparentName, test: manifest.test, count: plan.length, when })) });
  const safe = (s) => String(s || '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'story';
  return { zip: makeZip(entries, when), fileName: `fmm-${safe(manifest.childName)}-${safe(manifest.grandparentName)}-recordings.zip`, count: plan.length };
}
