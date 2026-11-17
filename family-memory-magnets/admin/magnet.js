// Family Memory Magnets: print-ready 5" x 5" magnet artwork for Printful die-cut magnets.
// Full-bleed square (Printful adds a white border unless the design fills the print area), 1500 x 1500 px at 300 DPI.
// Everything important stays 0.3" inside the edge. Drawn in the browser from the story's public QR code (SVG).
(function (root) {
  'use strict';
  var SIZE = 1500, DPI = 300, SAFE = 90; // 0.3 inch
  var NAVY = '#001a66', GOLD = '#fcd42a', WHITE = '#ffffff';
  var FONT_BASE = '/family-memory-magnets/fonts/';
  var fontsReady = null;

  function loadFonts() {
    if (fontsReady) return fontsReady;
    var list = [
      new FontFace('FMM Display', 'url(' + FONT_BASE + 'playfair-display-latin-800-normal.woff2)', { weight: '800' }),
      new FontFace('FMM Body', 'url(' + FONT_BASE + 'dm-sans-latin-800-normal.woff2)', { weight: '800' }),
      new FontFace('FMM Body', 'url(' + FONT_BASE + 'dm-sans-latin-500-normal.woff2)', { weight: '500' })
    ];
    fontsReady = Promise.all(list.map(function (f) { return f.load().then(function (l) { document.fonts.add(l); }); }));
    return fontsReady;
  }

  function svgImage(svgText) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () { res(img); };
      img.onerror = function () { rej(new Error('Could not read the QR code image.')); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
    });
  }

  function fit(ctx, text, family, weight, maxW, start, min) {
    for (var s = start; s >= min; s -= 4) {
      ctx.font = weight + ' ' + s + 'px "' + family + '"';
      if (ctx.measureText(text).width <= maxW) return s;
    }
    return min;
  }

  function heart(ctx, cx, cy, w, color) {
    ctx.save(); ctx.fillStyle = color; ctx.beginPath();
    ctx.moveTo(cx, cy + w * 0.35);
    ctx.bezierCurveTo(cx - w * 0.6, cy - w * 0.1, cx - w * 0.3, cy - w * 0.55, cx, cy - w * 0.25);
    ctx.bezierCurveTo(cx + w * 0.3, cy - w * 0.55, cx + w * 0.6, cy - w * 0.1, cx, cy + w * 0.35);
    ctx.fill(); ctx.restore();
  }

  // opts: { qrSvg (text), title ("Devon & Mimi"), line ("Scan to hear our family story") }
  function draw(canvas, opts) {
    return loadFonts().then(function () { return svgImage(opts.qrSvg); }).then(function (qr) {
      canvas.width = SIZE; canvas.height = SIZE;
      var ctx = canvas.getContext('2d');
      // background: navy with a soft light from the top
      ctx.fillStyle = NAVY; ctx.fillRect(0, 0, SIZE, SIZE);
      var g = ctx.createRadialGradient(SIZE / 2, SIZE * 0.05, 50, SIZE / 2, SIZE * 0.05, SIZE * 0.9);
      g.addColorStop(0, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, SIZE, SIZE);
      // thin gold frame inside the safe area
      ctx.strokeStyle = GOLD; ctx.lineWidth = 6;
      roundRect(ctx, SAFE + 10, SAFE + 10, SIZE - 2 * (SAFE + 10), SIZE - 2 * (SAFE + 10), 46); ctx.stroke();

      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = GOLD; ctx.font = '800 50px "FMM Body"';
      if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '6px';
      ctx.fillText('FAMILY MEMORY MAGNETS', SIZE / 2, 205);
      if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '0px';

      var maxW = SIZE - 2 * SAFE - 120;
      var ts = fit(ctx, opts.title, 'FMM Display', '800', maxW, 124, 60);
      ctx.fillStyle = WHITE; ctx.font = '800 ' + ts + 'px "FMM Display"';
      ctx.fillText(opts.title, SIZE / 2, 205 + 30 + ts);

      // QR on a white rounded card (the card's white margin is the quiet zone the scanner needs)
      var card = 760, cx = (SIZE - card) / 2, cy = 400;
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10;
      ctx.fillStyle = WHITE; roundRect(ctx, cx, cy, card, card, 44); ctx.fill(); ctx.restore();
      var pad = 36; ctx.imageSmoothingEnabled = false;
      ctx.drawImage(qr, cx + pad, cy + pad, card - 2 * pad, card - 2 * pad);

      heart(ctx, SIZE / 2, cy + card + 92, 70, GOLD);
      var ls = fit(ctx, opts.line, 'FMM Body', '800', maxW, 64, 40);
      ctx.fillStyle = WHITE; ctx.font = '800 ' + ls + 'px "FMM Body"';
      ctx.fillText(opts.line, SIZE / 2, cy + card + 205);
      return canvas;
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // PNG with a 300 DPI tag (pHYs chunk), so print tools read it as exactly 5" x 5".
  var CRC = (function () { var t = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(bytes) { var c = 0xffffffff; for (var i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function withDpi(pngBytes, dpi) {
    var ppm = Math.round(dpi / 0.0254);
    var chunk = new Uint8Array(21), dv = new DataView(chunk.buffer);
    dv.setUint32(0, 9); chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
    dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;
    dv.setUint32(17, crc32(chunk.subarray(4, 17)));
    var at = 33; // after the 8-byte signature + 25-byte IHDR chunk
    var out = new Uint8Array(pngBytes.length + 21);
    out.set(pngBytes.subarray(0, at), 0); out.set(chunk, at); out.set(pngBytes.subarray(at), at + 21);
    return out;
  }
  function toPngBlob(canvas) {
    return new Promise(function (res) { canvas.toBlob(res, 'image/png'); })
      .then(function (b) { return b.arrayBuffer(); })
      .then(function (buf) { return new Blob([withDpi(new Uint8Array(buf), DPI)], { type: 'image/png' }); });
  }

  root.FMMMagnet = { draw: draw, toPngBlob: toPngBlob, SIZE: SIZE, DPI: DPI, crc32: crc32, withDpi: withDpi };
})(typeof window !== 'undefined' ? window : globalThis);
