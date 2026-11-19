// CustomSongMe Love Poems — builds the one-page 8.5 x 11 poem PDF.
// Four designs. The same function makes the watermarked preview and the clean paid file,
// so what the customer previews is exactly what they receive (minus the watermark).

import { PDFDocument, StandardFonts, rgb, degrees } from './vendor/pdf-lib.esm.min.js';

const W = 612, H = 792;
const hex = (h) => { const n = parseInt(h.slice(1), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };

export const DESIGNS = {
  cream:    { bg: '#fbf6ea', ink: '#3a2a1a', accent: '#b08a3e', soft: '#e6d6ae', title: 'TimesRomanBoldItalic', body: 'TimesRoman', italic: 'TimesRomanItalic', align: 'center', frame: 'double' },
  midnight: { bg: '#0b1d4d', ink: '#f4f1e8', accent: '#fcd42a', soft: '#2a3f7a', title: 'TimesRomanBoldItalic', body: 'TimesRoman', italic: 'TimesRomanItalic', align: 'center', frame: 'double' },
  blush:    { bg: '#fdf0f2', ink: '#5a1f2e', accent: '#c45c74', soft: '#f3c9d2', title: 'TimesRomanBoldItalic', body: 'TimesRomanItalic', italic: 'TimesRomanItalic', align: 'center', frame: 'hearts' },
  minimal:  { bg: '#ffffff', ink: '#1d1d1f', accent: '#1d1d1f', soft: '#d9d9de', title: 'HelveticaBold', body: 'TimesRoman', italic: 'TimesRomanItalic', align: 'left', frame: 'rule' },
};

// Standard PDF fonts only know Western European letters. Drop anything they can't draw (emoji etc.)
// and turn a few common look-alikes into characters they can.
function safe(font, s) {
  const map = { '′': "'", '″': '"', ' ': ' ', ' ': ' ', ' ': ' ' };
  let out = '';
  for (const ch of String(s || '')) {
    const c = map[ch] ?? ch;
    try { font.encodeText(c); out += c; } catch { /* not drawable in this font: skip */ }
  }
  return out;
}

function wrap(font, size, text, maxW) {
  const words = text.split(/ +/); const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (font.widthOfTextAtSize(t, size) <= maxW || !cur) { cur = t; continue; }
    lines.push(cur); cur = w;
  }
  if (cur || !lines.length) lines.push(cur);
  // a single word longer than the line: hard-break it
  return lines.flatMap((l) => {
    if (font.widthOfTextAtSize(l, size) <= maxW) return [l];
    const parts = []; let p = '';
    for (const ch of l) { if (font.widthOfTextAtSize(p + ch, size) > maxW && p) { parts.push(p); p = ch; } else p += ch; }
    if (p) parts.push(p); return parts;
  });
}

// Lays the poem out at the biggest size (15pt down to 9pt) that fits the box.
export function layoutPoem(font, text, maxW, maxH, { maxSize = 15, minSize = 9 } = {}) {
  const stanzas = String(text).split(/\n\s*\n/).map((s) => s.split('\n'));
  for (let size = maxSize; size >= minSize; size -= 0.5) {
    const lh = size * 1.42, gap = size * 0.75; const rows = [];
    for (let si = 0; si < stanzas.length; si++) {
      for (const raw of stanzas[si]) for (const l of wrap(font, size, raw.trim(), maxW)) rows.push({ text: l, gapBefore: 0 });
      if (si < stanzas.length - 1) rows.push({ text: '', gapBefore: gap, stanzaBreak: true });
    }
    const height = rows.reduce((h, r) => h + (r.stanzaBreak ? r.gapBefore : lh), 0);
    if (height <= maxH) return { size, lh, rows, height, fits: true };
  }
  return { fits: false };
}

function drawFrame(page, d, c) {
  if (d.frame === 'double') {
    page.drawRectangle({ x: 24, y: 24, width: W - 48, height: H - 48, borderColor: c.accent, borderWidth: 2.2 });
    page.drawRectangle({ x: 32, y: 32, width: W - 64, height: H - 64, borderColor: c.accent, borderWidth: 0.7 });
  } else if (d.frame === 'hearts') {
    page.drawRectangle({ x: 26, y: 26, width: W - 52, height: H - 52, borderColor: c.accent, borderWidth: 1.4 });
    const heart = 'M 0 4 C -2 -2 -10 -2 -10 4 C -10 9 -4 13 0 17 C 4 13 10 9 10 4 C 10 -2 2 -2 0 4 Z';
    for (const [x, y] of [[26, H - 26], [W - 26, H - 26], [26, 26], [W - 26, 26]]) {
      page.drawSvgPath(heart, { x, y: y + 8, color: c.accent, scale: 1 });
    }
  } else {
    page.drawLine({ start: { x: 54, y: H - 54 }, end: { x: W - 54, y: H - 54 }, thickness: 1.2, color: c.accent });
    page.drawLine({ start: { x: 54, y: 54 }, end: { x: W - 54, y: 54 }, thickness: 0.6, color: c.accent });
  }
}

function drawQR(page, qr, x, y, size, dark, light) {
  const n = qr.size, quiet = 2, cell = size / (n + quiet * 2);
  page.drawRectangle({ x, y, width: size, height: size, color: light });
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) {
    if (qr.get(r, col)) page.drawRectangle({ x: x + (col + quiet) * cell, y: y + size - (r + quiet + 1) * cell, width: cell + 0.05, height: cell + 0.05, color: dark });
  }
}

/**
 * Build the PDF.
 * order: { final:{title,text}, about:{recipientName,yourName}, template, dedication }
 * opts:  { watermark:boolean, photoJpg?:Uint8Array, qr?:{size,get(r,c)}, voice:boolean, siteLabel?:string }
 * Returns { bytes, fits } — fits:false means the poem is too long for one page.
 */
export async function buildPoemPdf(order, opts = {}) {
  const d = DESIGNS[order.template] || DESIGNS.cream;
  const c = { bg: hex(d.bg), ink: hex(d.ink), accent: hex(d.accent), soft: hex(d.soft), white: rgb(1, 1, 1) };
  const doc = await PDFDocument.create();
  doc.setTitle(order.final?.title || 'A Love Poem'); doc.setAuthor('CustomSongMe'); doc.setCreator('CustomSongMe Love Poems');
  doc.setProducer('CustomSongMe');
  const page = doc.addPage([W, H]);
  const F = {
    title: await doc.embedFont(StandardFonts[d.title]), body: await doc.embedFont(StandardFonts[d.body]),
    italic: await doc.embedFont(StandardFonts[d.italic]), small: await doc.embedFont(StandardFonts.Helvetica),
    smallBold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: c.bg });
  drawFrame(page, d, c);

  const left = d.align === 'left' ? 78 : 72, right = W - left, boxW = right - left;
  const put = (font, size, text, y, color, align = d.align) => {
    const t = safe(font, text); const w = font.widthOfTextAtSize(t, size);
    const x = align === 'center' ? (W - w) / 2 : left;
    page.drawText(t, { x, y, size, font, color });
  };
  let y = H - 86;

  // small overline: "A love poem for Maria"
  const who = order.about?.recipientName ? `A love poem for ${order.about.recipientName}` : 'A love poem';
  put(F.small, 9.5, who.toUpperCase(), y, c.accent); y -= 34;

  // title (shrinks to fit one or two lines)
  let tSize = 30; let tLines;
  for (; tSize >= 18; tSize -= 1) { tLines = wrap(F.title, tSize, safe(F.title, order.final?.title || ''), boxW); if (tLines.length <= 2) break; }
  for (const l of tLines.slice(0, 2)) { put(F.title, tSize, l, y, c.ink); y -= tSize * 1.15; }
  y -= 6;
  if (d.align === 'center') page.drawLine({ start: { x: W / 2 - 40, y }, end: { x: W / 2 + 40, y }, thickness: 1, color: c.accent });
  y -= 22;

  // optional photo
  if (opts.photoJpg) {
    try {
      const img = await doc.embedJpg(opts.photoJpg);
      const maxW = 200, maxH = opts.voice ? 120 : 150; const s = Math.min(maxW / img.width, maxH / img.height);
      const w = img.width * s, h = img.height * s; const x = d.align === 'center' ? (W - w) / 2 : left;
      page.drawRectangle({ x: x - 4, y: y - h - 4, width: w + 8, height: h + 8, color: c.white, borderColor: c.accent, borderWidth: 1 });
      page.drawImage(img, { x, y: y - h, width: w, height: h });
      y -= h + 26;
    } catch { /* unreadable photo: leave it out rather than fail the order */ }
  }

  // bottom area: QR + dedication + footer
  const qrSize = 78;
  const bottomReserved = (opts.voice ? qrSize + 34 : 0) + 64;
  const poemTop = y, poemBottom = 54 + bottomReserved;
  const bodyText = String(order.final?.text || '').split('\n').map((l) => safe(F.body, l)).join('\n');
  const lay = layoutPoem(F.body, bodyText, boxW, poemTop - poemBottom);
  if (!lay.fits) return { bytes: null, fits: false };

  // centre the poem block vertically in its space
  let py = poemTop - Math.max(0, (poemTop - poemBottom - lay.height) / 2) - lay.size;
  for (const r of lay.rows) {
    if (r.stanzaBreak) { py -= r.gapBefore; continue; }
    put(F.body, lay.size, r.text, py, c.ink); py -= lay.lh;
  }

  let by = 54 + (opts.voice ? qrSize + 34 : 0) + 30;
  const dedication = order.dedication || (order.about?.yourName ? `With all my love, ${order.about.yourName}` : '');
  if (dedication) put(F.italic, 13, dedication, by, c.accent);

  if (opts.voice) {
    const qx = (W - qrSize) / 2, qy = 58 + 22;
    if (opts.qr) {
      drawQR(page, opts.qr, qx, qy, qrSize, hex('#000000'), c.white);
    } else {
      page.drawRectangle({ x: qx, y: qy, width: qrSize, height: qrSize, color: c.soft, borderColor: c.accent, borderWidth: 1 });
      put(F.small, 7, 'Your QR code', qy + qrSize / 2 + 2, c.ink, 'center');
      put(F.small, 7, 'appears here', qy + qrSize / 2 - 8, c.ink, 'center');
    }
    put(F.smallBold, 8.5, 'SCAN TO HEAR THIS POEM IN MY VOICE', qy - 14, c.accent, 'center');
  }
  put(F.small, 7, opts.siteLabel || 'customsongme.com', 40, c.accent, 'center');

  if (opts.watermark) {
    const wm = await doc.embedFont(StandardFonts.HelveticaBold);
    const col = d.bg === '#0b1d4d' ? rgb(1, 1, 1) : rgb(0.45, 0.45, 0.5);
    for (const [x, yy] of [[70, 120], [70, 360], [70, 600]]) page.drawText('PREVIEW', { x, y: yy, size: 118, font: wm, color: col, opacity: 0.17, rotate: degrees(28) });
    for (const yy of [250, 500]) page.drawText('NOT FOR PRINT  •  CUSTOMSONGME.COM', { x: 120, y: yy, size: 16, font: wm, color: col, opacity: 0.28, rotate: degrees(28) });
  }
  return { bytes: await doc.save(), fits: true };
}
