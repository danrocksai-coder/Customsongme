/*
 * Reverse Gift — design library (shared by the recipient page and, later, onboarding previews).
 *
 *  RG.parentLabel(type)      -> "Mom" | "Dad" | "Mom & Dad"
 *  RG.LANDING_THEMES         -> the six faceless parent landing-page designs
 *  RG.CARD_TEMPLATES         -> the four child greeting-card image templates
 *  RG.renderCard(canvas, templateId, { to, message, from }) -> draws a 1080x1350 card
 *
 * Everything is drawn in the browser: no paid image generation, no per-message cost.
 */
(function () {
  var RG = (window.RG = window.RG || {});

  RG.parentLabel = function (type) {
    return type === 'dad' ? 'Dad' : type === 'both' ? 'Mom & Dad' : 'Mom';
  };

  /* ------------------------------------------------------------------ */
  /* Parent landing-page designs (faceless option)                       */
  /* ------------------------------------------------------------------ */
  var flowers =
    '<g fill="#f7a8b8" opacity=".55">' +
    [[60, 60, 1], [330, 40, .7], [380, 210, .9], [30, 250, .6]].map(function (f) {
      var p = '';
      for (var i = 0; i < 5; i++) {
        p += '<ellipse cx="0" cy="-22" rx="14" ry="24" transform="rotate(' + i * 72 + ')"/>';
      }
      return '<g transform="translate(' + f[0] + ' ' + f[1] + ') scale(' + f[2] + ')">' + p +
        '<circle r="10" fill="#fff3c4"/></g>';
    }).join('') + '</g>';

  var sparkles = '<g fill="#fff" opacity=".7">' +
    [[50, 50, 1], [340, 70, .7], [300, 230, 1.1], [90, 200, .6], [210, 30, .5]].map(function (s) {
      return '<path transform="translate(' + s[0] + ' ' + s[1] + ') scale(' + s[2] + ')" d="M0-16C2-4 4-2 16 0C4 2 2 4 0 16C-2 4-4 2-16 0C-4-2-2-4 0-16Z"/>';
    }).join('') + '</g>' +
    '<circle cx="360" cy="300" r="120" fill="#fff" opacity=".18"/><circle cx="20" cy="20" r="90" fill="#fff" opacity=".15"/>';

  var sunrise = '<g opacity=".8"><circle cx="200" cy="300" r="110" fill="#fff6dc"/>' +
    Array.apply(null, Array(9)).map(function (_, i) {
      var a = Math.PI + (i + 1) * Math.PI / 10;
      return '<line x1="' + (200 + Math.cos(a) * 130) + '" y1="' + (300 + Math.sin(a) * 130) +
        '" x2="' + (200 + Math.cos(a) * 190) + '" y2="' + (300 + Math.sin(a) * 190) +
        '" stroke="#d4a24c" stroke-width="5" stroke-linecap="round"/>';
    }).join('') + '</g>';

  var geo = '<g stroke="#c9d3e6" stroke-width="2" fill="none" opacity=".45">' +
    '<path d="M-20 80 L120 -20 M-20 160 L220 -20 M-20 240 L320 -20 M60 320 L420 40 M160 320 L420 120"/>' +
    '<circle cx="330" cy="70" r="40"/><circle cx="330" cy="70" r="60"/></g>';

  var mountains = '<g opacity=".9"><circle cx="320" cy="70" r="30" fill="#f1e9c9" opacity=".7"/>' +
    '<path d="M0 230 L80 140 L140 200 L230 90 L320 190 L400 130 L400 320 L0 320Z" fill="#5f8d6b" opacity=".6"/>' +
    '<path d="M0 270 L60 220 L120 260 L200 180 L290 260 L360 210 L400 240 L400 320 L0 320Z" fill="#244a33"/></g>';

  var copper = '<g fill="none" stroke="#c07a46" opacity=".75">' +
    '<rect x="14" y="14" width="372" height="292" rx="10" stroke-width="3"/>' +
    '<rect x="26" y="26" width="348" height="268" rx="6" stroke-width="1"/></g>' +
    '<g fill="#c07a46" opacity=".75"><circle cx="200" cy="40" r="4"/><circle cx="185" cy="40" r="2"/><circle cx="215" cy="40" r="2"/></g>';

  function svg(inner) {
    return '<svg class="hero-art" viewBox="0 0 400 320" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' + inner + '</svg>';
  }

  RG.LANDING_THEMES = {
    'moms-love': {
      name: "Mom's Love", style: 'Blush, floral, warm',
      bg: 'linear-gradient(160deg,#ffe3e8 0%,#f9c5d1 55%,#f4a7b9 100%)', ink: '#6b1d34', art: svg(flowers)
    },
    'thinking-of-you': {
      name: 'Always Thinking of You', style: 'Lavender, soft, elegant',
      bg: 'linear-gradient(160deg,#efe7fb 0%,#cdb8ef 60%,#a88bd8 100%)', ink: '#3b2366', art: svg(sparkles)
    },
    'hugs-from-mom': {
      name: 'Hugs From Mom', style: 'Champagne, gold, sunrise',
      bg: 'linear-gradient(180deg,#fff8e7 0%,#f7dfae 55%,#e9b965 100%)', ink: '#5a3d0c', art: svg(sunrise)
    },
    'dads-reminder': {
      name: "Dad's Reminder", style: 'Navy, silver, modern',
      bg: 'linear-gradient(160deg,#0b1d3a 0%,#173468 60%,#284d8c 100%)', ink: '#ffffff', art: svg(geo)
    },
    'always-here': {
      name: 'Always Here for You', style: 'Forest green, mountains, outdoors',
      bg: 'linear-gradient(180deg,#9cc5a8 0%,#5d8f6c 50%,#1d3b2a 100%)', ink: '#ffffff', art: svg(mountains)
    },
    'note-from-dad': {
      name: 'A Note From Dad', style: 'Charcoal, copper, classic',
      bg: 'linear-gradient(160deg,#2a2826 0%,#3a3633 60%,#4a433d 100%)', ink: '#f5e6d8', art: svg(copper)
    }
  };

  /* ------------------------------------------------------------------ */
  /* Greeting-card templates (what the child sends)                      */
  /* ------------------------------------------------------------------ */
  var W = 1080, H = 1350;

  // Small deterministic random generator so every card looks the same each time.
  function rng(seed) {
    return function () {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
  }

  function heart(ctx, x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * .3);
    ctx.bezierCurveTo(x, y, x - s * .5, y, x - s * .5, y + s * .3);
    ctx.bezierCurveTo(x - s * .5, y + s * .6, x, y + s * .75, x, y + s);
    ctx.bezierCurveTo(x, y + s * .75, x + s * .5, y + s * .6, x + s * .5, y + s * .3);
    ctx.bezierCurveTo(x + s * .5, y, x, y, x, y + s * .3);
    ctx.fill();
  }

  function star(ctx, x, y, r) {
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .45 : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }

  function lin(ctx, y0, y1, stops) {
    var g = ctx.createLinearGradient(0, y0, 0, y1);
    stops.forEach(function (s, i) { g.addColorStop(i / (stops.length - 1), s); });
    return g;
  }

  var BG = {
    hearts: function (ctx) {
      var g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#ffb3c6'); g.addColorStop(.5, '#ff6f91'); g.addColorStop(1, '#d6336c');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      var r = rng(7);
      for (var i = 0; i < 46; i++) {
        ctx.fillStyle = 'rgba(255,255,255,' + (0.12 + r() * 0.3).toFixed(2) + ')';
        heart(ctx, r() * W, r() * H - 40, 40 + r() * 110);
      }
    },
    beach: function (ctx) {
      ctx.fillStyle = lin(ctx, 0, 820, ['#5fc6f5', '#a8e3ff', '#ffe7a8']); ctx.fillRect(0, 0, W, 820);
      var sg = ctx.createRadialGradient(820, 210, 40, 820, 210, 260);
      sg.addColorStop(0, 'rgba(255,214,102,1)'); sg.addColorStop(.45, 'rgba(255,214,102,.9)'); sg.addColorStop(1, 'rgba(255,214,102,0)');
      ctx.fillStyle = sg; ctx.fillRect(500, 0, 580, 520);
      ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.arc(820, 210, 110, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = lin(ctx, 800, 1150, ['#22b8cf', '#1286a8']); ctx.fillRect(0, 800, W, 360);
      ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 6; ctx.lineCap = 'round';
      for (var row = 0; row < 5; row++) {
        ctx.beginPath();
        var yy = 850 + row * 60;
        for (var x = -40; x <= W + 40; x += 20) ctx.lineTo(x, yy + Math.sin((x + row * 70) / 45) * 9);
        ctx.stroke();
      }
      ctx.fillStyle = '#f3d29b'; ctx.beginPath(); ctx.moveTo(0, 1160);
      for (var x2 = 0; x2 <= W; x2 += 30) ctx.lineTo(x2, 1150 + Math.sin(x2 / 90) * 18);
      ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();
      // Small clouds tucked low in the sky, away from the heading
      ctx.fillStyle = 'rgba(255,255,255,.8)';
      [[-30, 300, .9], [930, 760, .7]].forEach(function (c) {
        ctx.beginPath();
        ctx.arc(c[0], c[1], 44 * c[2], 0, Math.PI * 2); ctx.arc(c[0] + 50 * c[2], c[1] - 18 * c[2], 54 * c[2], 0, Math.PI * 2);
        ctx.arc(c[0] + 105 * c[2], c[1], 42 * c[2], 0, Math.PI * 2); ctx.fill();
      });
    },
    nature: function (ctx) {
      ctx.fillStyle = lin(ctx, 0, H, ['#cfe8ff', '#eaf6e3', '#d7ecc8']); ctx.fillRect(0, 0, W, H);
      function ridge(base, amp, freq, color, phase) {
        ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0, H);
        for (var x = 0; x <= W; x += 15) {
          ctx.lineTo(x, base - Math.abs(Math.sin(x / freq + phase)) * amp - Math.sin(x / (freq * .37)) * amp * .18);
        }
        ctx.lineTo(W, H); ctx.fill();
      }
      ridge(560, 260, 260, '#a9c9b0', .4);
      ridge(800, 230, 200, '#6f9f7e', 1.6);
      ridge(1080, 160, 150, '#3d6b4f', 2.6);
      var r = rng(3);
      ctx.fillStyle = '#244a33';
      for (var i = 0; i < 22; i++) {
        var tx = r() * W, ty = 1130 + r() * 200, th = 120 + r() * 120;
        ctx.beginPath(); ctx.moveTo(tx, ty - th); ctx.lineTo(tx - th * .28, ty); ctx.lineTo(tx + th * .28, ty); ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.beginPath(); ctx.arc(860, 170, 70, 0, Math.PI * 2); ctx.fill();
    },
    fun: function (ctx) {
      var g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#7b2ff7'); g.addColorStop(.55, '#c026d3'); g.addColorStop(1, '#ff7a18');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      var colors = ['#ffd60a', '#4cc9f0', '#80ffdb', '#ff70a6', '#ffffff', '#f15bb5'];
      var r = rng(11);
      for (var i = 0; i < 120; i++) {
        ctx.save();
        ctx.fillStyle = colors[Math.floor(r() * colors.length)];
        ctx.globalAlpha = .55 + r() * .45;
        var x = r() * W, y = r() * H, kind = r();
        ctx.translate(x, y); ctx.rotate(r() * Math.PI);
        if (kind < .5) ctx.fillRect(-14, -6, 28, 12);
        else if (kind < .8) { ctx.beginPath(); ctx.arc(0, 0, 8 + r() * 8, 0, Math.PI * 2); ctx.fill(); }
        else star(ctx, 0, 0, 16 + r() * 18);
        ctx.restore();
      }
    }
  };

  RG.CARD_TEMPLATES = {
    hearts: { name: 'Hearts & Love', head: '#ffffff', panel: 'rgba(255,255,255,.93)', text: '#5c0f2e', accent: '#d6336c' },
    beach: { name: 'Beach & Sunshine', head: '#ffffff', panel: 'rgba(255,255,255,.9)', text: '#0b4058', accent: '#1286a8' },
    nature: { name: 'Beautiful Nature', head: '#1f4d33', panel: 'rgba(255,255,255,.9)', text: '#1e3a2a', accent: '#3d6b4f' },
    fun: { name: 'Fun & Colorful', head: '#ffffff', panel: 'rgba(255,255,255,.94)', text: '#3a0f63', accent: '#c026d3' }
  };

  // Max characters for the child's message. Tested so the longest message still
  // renders at a comfortable size on a phone screen.
  RG.MESSAGE_MAX = 220;

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // Word-wrap text to a width; very long words are broken so nothing can overflow.
  function wrap(ctx, text, maxW) {
    var out = [];
    String(text).split(/\n/).forEach(function (para) {
      var words = para.split(/\s+/).filter(Boolean), line = '';
      if (!words.length) { out.push(''); return; }
      words.forEach(function (w) {
        while (ctx.measureText(w).width > maxW) {
          var cut = w.length - 1;
          while (cut > 1 && ctx.measureText(w.slice(0, cut) + '-').width > maxW) cut--;
          if (line) { out.push(line); line = ''; }
          out.push(w.slice(0, cut) + '-');
          w = w.slice(cut);
        }
        var test = line ? line + ' ' + w : w;
        if (ctx.measureText(test).width <= maxW) line = test;
        else { out.push(line); line = w; }
      });
      if (line) out.push(line);
    });
    // Collapse runs of blank lines.
    return out.filter(function (l, i) { return l !== '' || (i > 0 && out[i - 1] !== ''); });
  }

  var BODY_FONT = '"DM Sans", system-ui, -apple-system, "Segoe UI", sans-serif';
  var DISPLAY_FONT = '"Playfair Display", Georgia, serif';

  RG.fontsReady = function () {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all([
      document.fonts.load('700 80px "Playfair Display"'),
      document.fonts.load('italic 600 40px "Playfair Display"'),
      document.fonts.load('500 50px "DM Sans"')
    ]).catch(function () {});
  };

  RG.renderCard = function (canvas, templateId, data) {
    var t = RG.CARD_TEMPLATES[templateId] || RG.CARD_TEMPLATES.hearts;
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    ctx.textBaseline = 'alphabetic';
    BG[templateId in BG ? templateId : 'hearts'](ctx);

    // Heading: "For Mom"
    var heading = 'For ' + (data.to || 'Mom');
    ctx.textAlign = 'center';
    var hs = 104;
    do { ctx.font = '700 ' + hs + 'px ' + DISPLAY_FONT; hs -= 4; } while (ctx.measureText(heading).width > W - 160 && hs > 50);
    ctx.save();
    ctx.shadowColor = t.head === '#ffffff' ? 'rgba(0,0,0,.28)' : 'rgba(255,255,255,.6)';
    ctx.shadowBlur = 18; ctx.shadowOffsetY = 4;
    ctx.fillStyle = t.head;
    ctx.fillText(heading, W / 2, 215);
    ctx.restore();

    // Message panel
    var px = 80, py = 290, pw = W - 160, ph = 830;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.18)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 12;
    ctx.fillStyle = t.panel; roundRect(ctx, px, py, pw, ph, 48); ctx.fill();
    ctx.restore();

    // Heart mark at the top of the panel
    ctx.fillStyle = t.accent; heart(ctx, W / 2, py + 44, 46);

    var hasFrom = !!(data.from && data.from.trim());
    var innerX = px + 70, innerW = pw - 140;
    var top = py + 130, bottom = py + ph - (hasFrom ? 150 : 70);
    var maxH = bottom - top;
    var msg = (data.message || '').trim() || 'I love you!';

    // Shrink the text until it fits the panel. It can never overflow.
    var size = 76, lines, lh;
    for (; size >= 30; size -= 2) {
      ctx.font = '500 ' + size + 'px ' + BODY_FONT;
      lines = wrap(ctx, msg, innerW);
      lh = size * 1.32;
      if (lines.length * lh <= maxH) break;
    }
    if (lines.length * lh > maxH) lines = lines.slice(0, Math.floor(maxH / lh));
    ctx.fillStyle = t.text;
    ctx.textAlign = 'center';
    var blockH = lines.length * lh;
    var y = top + (maxH - blockH) / 2 + size * .95;
    lines.forEach(function (l) { ctx.fillText(l, W / 2, y); y += lh; });

    if (hasFrom) {
      var from = '— ' + data.from.trim().slice(0, 40);
      var fs = 58;
      do { ctx.font = 'italic 600 ' + fs + 'px ' + DISPLAY_FONT; fs -= 2; } while (ctx.measureText(from).width > innerW && fs > 30);
      ctx.fillStyle = t.accent;
      ctx.fillText(from, W / 2, py + ph - 70);
    }

    // Small, subtle footer
    ctx.font = '500 26px ' + BODY_FONT;
    ctx.fillStyle = 'rgba(255,255,255,.88)';
    if (templateId === 'beach') ctx.fillStyle = 'rgba(90,60,20,.7)';
    ctx.fillText('Sent with love · customsongme.com', W / 2, H - 50);
    return canvas;
  };
})();
