/* CustomSongMe Love Poems — the step-by-step builder on /love-poems.
   Everything the customer types is saved to the server as they go (and the order id is kept in this
   browser), so a refresh, a dropped connection or a cancelled payment never loses their work. */
(function () {
  'use strict';
  var API = '/api/poems/';
  var KEY = 'lp-draft-v1';
  var S = { order: null, token: '', questions: [], step: 'pkg', pkg: null, busy: false, photoUrl: '', prevText: null, recorder: null };
  var root = document.getElementById('lp-builder');
  if (!root) return;

  var PRICES = { pdf: 20, voice: 25 };
  var FORMS = {
    sonnet: { label: 'Classic Sonnet', desc: '14 lines, the timeless romantic form', rhymes: ['shakespearean', 'petrarchan'] },
    rhyming: { label: 'Rhyming Love Poem', desc: '4–5 stanzas with a steady, sweet rhythm', rhymes: ['abab', 'aabb', 'abcb'] },
    free: { label: 'Free Verse', desc: 'No set rhythm, reads like a heartfelt letter', rhymes: ['none', 'light'] },
    short: { label: 'Short & Sweet', desc: '8–12 lines, perfect to read aloud', rhymes: ['aabb', 'abab', 'none'] },
  };
  var RHYMES = { shakespearean: 'Shakespearean (ABAB CDCD EFEF GG)', petrarchan: 'Petrarchan (ABBA ABBA CDE CDE)', abab: 'Alternating lines (ABAB)', aabb: 'Couplets (AABB)', abcb: 'Ballad (ABCB)', none: 'No rhyme', light: 'Light, occasional rhyme' };
  var TEMPLATES = { cream: 'Classic Cream', midnight: 'Midnight & Gold', blush: 'Blush Rose', minimal: 'Modern Minimal' };
  var TEMPLATE_COLORS = { cream: ['#fbf6ea', '#b08a3e'], midnight: ['#0b1d4d', '#fcd42a'], blush: ['#fdf0f2', '#c45c74'], minimal: ['#ffffff', '#1d1d1f'] };

  // ---------- helpers ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel) { return root.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }
  function store(v) { try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch (e) { /* private mode */ } }
  function stored() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function track(name, params) { try { if (window.gtag) window.gtag('event', name, params || {}); } catch (e) { /* ignore */ } }

  function api(path, opts) {
    opts = opts || {};
    var headers = opts.headers || {};
    if (S.token) headers['x-poem-token'] = S.token;
    var init = { method: opts.method || 'GET', headers: headers, cache: 'no-store' };
    if (opts.json !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.json); }
    if (opts.raw) { headers['Content-Type'] = opts.type || 'application/octet-stream'; init.body = opts.raw; }
    var url = API + path + (S.order && path.indexOf('?') < 0 && path !== 'start' ? '?order=' + encodeURIComponent(S.order.id) : '');
    return fetch(url, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || 'Something went wrong. Please try again.'); e.status = r.status; throw e; }
        return j;
      });
    }, function () { throw new Error('No connection. Your work is saved; check your internet and try again.'); });
  }
  function take(j) { if (j.order) S.order = j.order; if (j.questions) S.questions = j.questions; }
  function message(text, kind) { var m = $('#lp-msg'); if (m) m.innerHTML = text ? '<div class="msg ' + (kind || 'err') + '" role="alert">' + esc(text) + '</div>' : ''; }
  // double-submit protection: one action at a time
  function busy(btn, fn) {
    if (S.busy) return; S.busy = true; message('');
    if (btn) btn.classList.add('busy');
    return Promise.resolve().then(fn).catch(function (e) {
      message(e.message);
      if (e.status === 401 || e.status === 404) { store(null); }
    }).then(function () { S.busy = false; if (btn) btn.classList.remove('busy'); });
  }

  // ---------- steps ----------
  function stepList() {
    var l = [['pkg', 'Package'], ['about', 'About them'], ['story', 'Your story'], ['style', 'Style'], ['poems', 'Poems'], ['edit', 'Edit'], ['design', 'Design']];
    if ((S.order && S.order.pkg) === 'voice' || S.pkg === 'voice') l.push(['voice', 'Your voice']);
    l.push(['preview', 'Preview & pay']);
    return l;
  }
  function go(step) {
    S.step = step; render();
    var top = root.getBoundingClientRect().top + window.scrollY - 76;
    window.scrollTo({ top: top, behavior: 'smooth' });
    track('love_poem_step', { step: step });
  }
  function header(title, hint) {
    var list = stepList(), idx = list.findIndex(function (s) { return s[0] === S.step; });
    var chips = list.map(function (s, i) { return '<li class="' + (i < idx ? 'done' : i === idx ? 'on' : '') + '">' + (i + 1) + '. ' + s[1] + '</li>'; }).join('');
    return '<ol class="steps" aria-label="Steps">' + chips + '</ol><h2 class="step-title">' + title + '</h2>' + (hint ? '<p class="hint">' + hint + '</p>' : '');
  }
  function nav(back, nextLabel, nextId) {
    return '<div id="lp-msg" aria-live="polite"></div><div class="row end">' + (back ? '<button type="button" class="btn btn-ghost" data-back="' + back + '">← Back</button>' : '<span></span>')
      + (nextLabel ? '<button type="button" class="btn btn-gold" id="' + (nextId || 'lp-next') + '">' + nextLabel + '</button>' : '') + '</div>';
  }
  function sel(name, options, value) {
    return '<select id="' + name + '">' + options.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === value ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
  }

  function render() {
    var o = S.order || {}; var a = o.about || {}; var h = '';
    switch (S.step) {
      case 'pkg':
        h = header('Choose your poem', 'Both include four personalized poems to choose from, editing, two AI revisions and four PDF designs.')
          + '<div class="choice">'
          + pkgCard('pdf', 'Personalized Love Poem PDF', ['Four poems written from your story', 'Edit every word, plus 2 AI revisions', '4 print-ready designs, optional photo', 'Instant download after payment'])
          + pkgCard('voice', 'Love Poem in Your Voice', ['Everything in the PDF package', 'Record yourself reading it, right here', 'A QR code on the page plays your voice', 'Re-record any time; the QR never changes'])
          + '</div>' + nav(null, 'Continue →');
        break;
      case 'about':
        h = header('Who is this poem for?', 'Names are optional. Leave anything blank you would rather not share.')
          + '<div class="grid2"><div><label class="f" for="recipientName">Their name <span class="opt">(optional)</span></label><input type="text" id="recipientName" maxlength="40" autocomplete="off" value="' + esc(a.recipientName) + '"></div>'
          + '<div><label class="f" for="yourName">Your name <span class="opt">(optional)</span></label><input type="text" id="yourName" maxlength="40" autocomplete="given-name" value="' + esc(a.yourName) + '"></div></div>'
          + '<div class="grid2"><div><label class="f" for="relationship">They are my…</label>' + sel('relationship', [['spouse', 'Husband / wife / spouse'], ['partner', 'Partner'], ['fiance', 'Fiancé / fiancée'], ['dating', 'Boyfriend / girlfriend'], ['crush', 'Someone I\'m falling for']], a.relationship || 'partner') + '</div>'
          + '<div><label class="f" for="occasion">Occasion</label>' + sel('occasion', [['anniversary', 'Anniversary'], ['valentines', 'Valentine\'s Day'], ['wedding', 'Wedding / vows'], ['birthday', 'Birthday'], ['longdistance', 'Long distance'], ['justbecause', 'Just because']], a.occasion || 'justbecause') + '</div></div>'
          + '<label class="f">Mood</label><div class="chips" id="mood">' + ['sweet', 'passionate', 'playful', 'sentimental'].map(function (m) { return '<button type="button" class="chip" data-v="' + m + '" aria-pressed="' + ((a.mood || 'sweet') === m) + '">' + m.charAt(0).toUpperCase() + m.slice(1) + '</button>'; }).join('') + '</div>'
          + '<details style="margin-top:16px"><summary style="cursor:pointer;font-weight:700">Optional: age, gender and pronouns</summary>'
          + '<div class="grid2"><div><label class="f" for="age">Their age <span class="opt">(optional, 18+)</span></label><input type="number" id="age" min="18" max="110" inputmode="numeric" value="' + esc(a.age) + '"></div>'
          + '<div><label class="f" for="gender">Gender <span class="opt">(optional)</span></label>' + sel('gender', [['', 'Prefer not to say'], ['woman', 'Woman'], ['man', 'Man'], ['nonbinary', 'Nonbinary']], a.gender || '') + '</div></div>'
          + '<div class="grid2"><div><label class="f" for="pronouns">Pronouns <span class="opt">(optional)</span></label>' + sel('pronouns', [['', 'Not specified'], ['she/her', 'she/her'], ['he/him', 'he/him'], ['they/them', 'they/them'], ['custom', 'Other…']], a.pronouns || '') + '</div>'
          + '<div id="pc-wrap"' + (a.pronouns === 'custom' ? '' : ' hidden') + '><label class="f" for="pronounsCustom">Their pronouns</label><input type="text" id="pronounsCustom" maxlength="30" value="' + esc(a.pronounsCustom) + '"></div></div></details>'
          + nav('pkg', 'Continue →');
        break;
      case 'story':
        h = header('Tell me your story', 'Answer at least 4 of these 7 (up to 300 characters each). Real details make the best poems: names, places, little habits.')
          + S.questions.map(function (q, i) {
            var v = (o.answers || {})[q.id] || '';
            return '<label class="f" for="' + q.id + '">' + (i + 1) + '. ' + esc(q.text) + '</label><textarea id="' + q.id + '" maxlength="300" rows="3" data-q>' + esc(v) + '</textarea><div class="count" data-c="' + q.id + '">' + v.length + '/300</div>';
          }).join('') + '<p class="meter" id="lp-meter"></p>' + nav('about', 'Continue →');
        break;
      case 'style':
        var st = o.style || {};
        h = header('Choose the style', 'Pick a form, the kind of language, and a rhyme that fits the form.')
          + '<label class="f">Poetry form</label><div class="choice" id="form">' + Object.keys(FORMS).map(function (k) { return '<button type="button" class="opt-card" data-v="' + k + '" aria-pressed="' + (st.form === k) + '"><b>' + FORMS[k].label + '</b><span>' + FORMS[k].desc + '</span></button>'; }).join('') + '</div>'
          + '<label class="f">Language</label><div class="chips" id="language"><button type="button" class="chip" data-v="modern" aria-pressed="' + (st.language !== 'classic') + '">Modern</button><button type="button" class="chip" data-v="classic" aria-pressed="' + (st.language === 'classic') + '">Classic</button></div>'
          + '<label class="f">Rhyme</label><div class="chips" id="rhyme"></div>'
          + nav('story', '✍️ Write my 4 poems', 'lp-generate');
        break;
      case 'poems':
        var poems = o.poems || [];
        h = header('Pick your favorite', 'Choose the one that sounds most like you. You can edit every word in the next step.')
          + '<div class="poems">' + [0, 1, 2, 3].map(function (i) {
            var p = poems[i];
            if (!p) return '<div class="poem-card missing"><b>Poem ' + (i + 1) + ' did not come through.</b></div>';
            return '<div class="poem-card"><h3>' + esc(p.title) + '</h3><pre>' + esc(p.text) + '</pre><button type="button" class="btn btn-gold" data-choose="' + i + '">Choose this poem</button></div>';
          }).join('') + '</div>'
          + (poems.some(function (p) { return !p; }) ? '<div class="row" style="margin-top:12px"><button type="button" class="btn btn-navy" id="lp-fill">Fill in the missing poems</button></div>' : '')
          + (o.gensLeft > 0 ? '<p class="hint" style="margin-top:16px">Not quite right? <button type="button" class="btn btn-ghost" id="lp-regen">Write 4 new poems (' + o.gensLeft + ' set left)</button></p>' : '')
          + nav('style', null);
        break;
      case 'edit':
        var f = o.final || {};
        h = header('Make it perfect', 'Edit anything you like. Or tell the AI what to change (' + o.revisionsLeft + ' of 2 revisions left).')
          + '<label class="f" for="title">Title</label><input type="text" id="title" maxlength="80" value="' + esc(f.title) + '">'
          + '<label class="f" for="poem">Poem</label><textarea id="poem" class="edit-poem" maxlength="2400">' + esc(f.text) + '</textarea>'
          + '<div class="card" style="margin:18px 0 0;padding:16px;box-shadow:none;background:var(--gold-pale)"><label class="f" for="instruction" style="margin-top:0">Ask for an AI revision <span class="opt">(' + o.revisionsLeft + ' left)</span></label>'
          + '<input type="text" id="instruction" maxlength="200" placeholder="e.g. make the ending more playful, mention our dog Max" ' + (o.revisionsLeft ? '' : 'disabled') + '>'
          + '<div class="row" style="margin-top:10px"><button type="button" class="btn btn-navy" id="lp-revise" ' + (o.revisionsLeft ? '' : 'disabled') + '>Revise with AI</button>'
          + (S.prevText ? '<button type="button" class="btn btn-ghost" id="lp-undo">↶ Undo revision</button>' : '') + '</div></div>'
          + '<div class="row" style="margin-top:8px"><button type="button" class="btn btn-ghost" data-back="poems">See the 4 poems again</button></div>'
          + nav(null, '✓ Approve this poem');
        break;
      case 'design':
        h = header('Choose a design', 'Pick a page design. Add one photo if you like (optional).')
          + '<div class="tiles" id="template">' + Object.keys(TEMPLATES).map(function (k) { var c = TEMPLATE_COLORS[k]; return '<button type="button" class="tile" data-v="' + k + '" aria-pressed="' + ((S.template || o.template || 'cream') === k) + '"><div class="mini" style="background:' + c[0] + ';color:' + c[1] + ';border:1px solid ' + c[1] + '">Love<span></span><span></span><span></span></div>' + TEMPLATES[k] + '</button>'; }).join('') + '</div>'
          + '<label class="f" for="dedication">Signature line <span class="opt">(optional)</span></label><input type="text" id="dedication" maxlength="120" placeholder="' + esc(a.yourName ? 'With all my love, ' + a.yourName : 'With all my love') + '" value="' + esc(o.dedication) + '">'
          + '<label class="f">One photo <span class="opt">(optional)</span></label><div class="photo-box">' + (S.photoUrl || o.hasPhoto ? (S.photoUrl ? '<img src="' + S.photoUrl + '" alt="Your photo">' : '<span>✓ Photo added</span>') + '<button type="button" class="btn btn-ghost" id="lp-photo-del">Remove photo</button>' : '<label class="btn btn-ghost" for="photo">📷 Add a photo</label>') + '<input type="file" id="photo" accept="image/*" hidden></div>'
          + '<p class="hint" style="margin-top:8px">Only you and the people you share the poem with see the photo. It is never posted anywhere.</p>'
          + nav('edit', 'Continue →');
        break;
      case 'voice':
        h = header('Record your voice', 'Read your poem out loud. The QR code on the printed page will play this recording. No AI voice is ever used: it is really you.')
          + '<div id="lp-rec"></div><p class="hint" style="margin-top:12px">Not ready? You can skip this and record after checkout from your private gift page. The QR code will play your recording as soon as you save it.</p>'
          + nav('design', 'Continue →');
        break;
      case 'preview':
        h = header('Your preview', 'This is your page exactly as it will print. The watermark disappears on the file you receive after payment.')
          + sheetHtml() + '<div class="row" style="justify-content:center;margin-top:14px"><button type="button" class="btn btn-ghost" id="lp-pdf">🔍 Full-size PDF preview</button></div>'
          + (o.pkg === 'voice' && !o.hasAudio ? '<div class="msg info">You have not recorded your voice yet. That is fine: you can record it after checkout and the QR code will play it. <button type="button" class="btn btn-ghost" data-back="voice">Record now</button></div>' : '')
          + '<label class="f" for="email">Your email <span class="opt">(your poem is delivered here)</span></label><input type="email" id="email" autocomplete="email" maxlength="254" value="' + esc(o.email) + '">'
          + '<label style="display:flex;gap:10px;align-items:flex-start;margin-top:14px;font-size:.95rem"><input type="checkbox" id="agree" style="width:22px;height:22px;flex:0 0 auto;margin-top:2px"> <span>I have checked the names, spelling and wording. I understand this is a personalized digital gift, delivered right after payment.</span></label>'
          + '<p style="margin:18px 0 0;font-size:1.05rem"><b>' + (o.pkg === 'voice' ? 'Love Poem in Your Voice' : 'Personalized Love Poem PDF') + ': $' + PRICES[o.pkg || 'pdf'] + '</b> plus applicable tax</p>'
          + '<p class="hint" style="margin:4px 0 0">Secure checkout by Stripe. Tax, if any, is shown before you pay.</p>'
          + nav('design', '🔒 Pay $' + PRICES[o.pkg || 'pdf'] + ' + tax', 'lp-pay');
        break;
    }
    root.innerHTML = h;
    var on = $('.steps .on'); if (on) on.parentNode.scrollLeft = on.offsetLeft - 40;
    after();
  }
  function pkgCard(id, title, list) {
    var on = (S.order && S.order.pkg || S.pkg) === id;
    return '<button type="button" class="opt-card" data-pkg="' + id + '" aria-pressed="' + on + '"><b style="font-size:1.6rem;font-family:var(--display)">$' + PRICES[id] + ' <span style="font:400 .8rem var(--body);color:var(--muted)">plus applicable tax</span></b><b>' + title + '</b><span><ul style="margin:6px 0 0;padding-left:18px">' + list.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul></span></button>';
  }
  function sheetHtml() {
    var o = S.order || {}, a = o.about || {}, f = o.final || {}, t = S.template || o.template || 'cream';
    var ded = o.dedication || (a.yourName ? 'With all my love, ' + a.yourName : '');
    return '<div class="sheet-wrap" oncontextmenu="return false"><div class="sheet ' + t + '">'
      + '<div class="over">' + esc(a.recipientName ? 'A love poem for ' + a.recipientName : 'A love poem') + '</div>'
      + '<div class="t">' + esc(f.title) + '</div><div class="rule"></div>'
      + (S.photoUrl ? '<img class="ph" src="' + S.photoUrl + '" alt="">' : (o.hasPhoto ? '<div class="ph" style="font-size:.8em;margin-bottom:1em">[your photo]</div>' : ''))
      + '<div class="b">' + esc(f.text) + '</div>' + (ded ? '<div class="ded">' + esc(ded) + '</div>' : '')
      + (o.pkg === 'voice' ? '<div class="qr">QR code</div><div class="qrcap">SCAN TO HEAR THIS POEM IN MY VOICE</div>' : '')
      + '</div><div class="watermark" aria-hidden="true"><b>PREVIEW</b><b>PREVIEW</b><b>PREVIEW</b></div></div>';
  }

  // ---------- wiring after each render ----------
  function readAbout() {
    var mood = $('#mood [aria-pressed="true"]');
    return { recipientName: $('#recipientName').value, yourName: $('#yourName').value, relationship: $('#relationship').value, occasion: $('#occasion').value,
      mood: mood ? mood.getAttribute('data-v') : 'sweet', age: $('#age').value, gender: $('#gender').value, pronouns: $('#pronouns').value, pronounsCustom: ($('#pronounsCustom') || {}).value || '' };
  }
  function readAnswers() { var a = {}; $$('[data-q]').forEach(function (t) { a[t.id] = t.value; }); return a; }
  function answered() { return $$('[data-q]').filter(function (t) { return t.value.trim().length >= 3; }).length; }
  function pressGroup(id, cb) {
    var g = $('#' + id); if (!g) return;
    g.addEventListener('click', function (e) {
      var b = e.target.closest('[data-v]'); if (!b) return;
      g.querySelectorAll('[data-v]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      if (cb) cb(b.getAttribute('data-v'));
    });
  }
  function current(id) { var b = $('#' + id + ' [aria-pressed="true"]'); return b ? b.getAttribute('data-v') : ''; }
  function drawRhymes(form, chosen) {
    var list = FORMS[form] ? FORMS[form].rhymes : [];
    if (list.indexOf(chosen) < 0) chosen = list[0];
    $('#rhyme').innerHTML = list.map(function (r) { return '<button type="button" class="chip" data-v="' + r + '" aria-pressed="' + (r === chosen) + '">' + RHYMES[r] + '</button>'; }).join('');
  }
  var saveTimer = null;
  function autosave(payload) { clearTimeout(saveTimer); saveTimer = setTimeout(function () { api('save', { method: 'POST', json: payload }).then(take).catch(function () { /* will retry on next action */ }); }, 900); }

  function after() {
    $$('[data-back]').forEach(function (b) { b.addEventListener('click', function () { go(b.getAttribute('data-back')); }); });
    var next = $('#lp-next');
    if (S.step === 'pkg') {
      $$('[data-pkg]').forEach(function (b) { b.addEventListener('click', function () { S.pkg = b.getAttribute('data-pkg'); $$('[data-pkg]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); }); });
      next.addEventListener('click', function () {
        if (!S.pkg) { message('Please choose a package.'); return; }
        busy(next, function () {
          if (S.order && !S.order.paid) return api('save', { method: 'POST', json: { pkg: S.pkg } }).then(function (j) { take(j); go('about'); });
          return api('start', { method: 'POST', json: { pkg: S.pkg, website: (document.getElementById('lp-hp') || {}).value || '' } }).then(function (j) {
            S.token = j.token; take(j); store({ id: S.order.id, token: S.token }); track('love_poem_start', { package: S.pkg }); go('about');
          });
        });
      });
    }
    if (S.step === 'about') {
      pressGroup('mood');
      $('#pronouns').addEventListener('change', function () { $('#pc-wrap').hidden = this.value !== 'custom'; });
      next.addEventListener('click', function () { busy(next, function () { return api('save', { method: 'POST', json: { about: readAbout() } }).then(function (j) { take(j); go('story'); }); }); });
    }
    if (S.step === 'story') {
      var meter = function () { var n = answered(), m = $('#lp-meter'); m.textContent = n + ' of 7 answered' + (n < 4 ? ' (please answer at least 4)' : ' ✓'); m.className = 'meter' + (n >= 4 ? ' ok' : ''); };
      $$('[data-q]').forEach(function (t) {
        t.addEventListener('input', function () { var c = $('[data-c="' + t.id + '"]'); c.textContent = t.value.length + '/300'; c.className = 'count' + (t.value.length >= 300 ? ' full' : ''); meter(); if (answered() >= 4) message(''); autosave({ answers: readAnswers() }); });
      });
      meter();
      next.addEventListener('click', function () {
        if (answered() < 4) { message('Please answer at least 4 of the 7 questions.'); return; }
        busy(next, function () { return api('save', { method: 'POST', json: { answers: readAnswers() } }).then(function (j) { take(j); go('style'); }); });
      });
    }
    if (S.step === 'style') {
      var st = S.order.style || {};
      pressGroup('form', function (f) { drawRhymes(f, current('rhyme')); });
      pressGroup('language'); pressGroup('rhyme');
      if (!current('form')) $('#form [data-v="rhyming"]').setAttribute('aria-pressed', 'true');
      drawRhymes(current('form'), st.rhyme);
      var gen = $('#lp-generate');
      gen.addEventListener('click', function () {
        var style = { form: current('form'), language: current('language') || 'modern', rhyme: current('rhyme') };
        if (S.order.gensLeft === 0 && (S.order.poems || []).length) { api('save', { method: 'POST', json: { style: style } }).then(take); go('poems'); return; }
        generate(gen, { style: style });
      });
    }
    if (S.step === 'poems') {
      $$('[data-choose]').forEach(function (b) {
        b.addEventListener('click', function () { busy(b, function () { return api('save', { method: 'POST', json: { chosen: Number(b.getAttribute('data-choose')) } }).then(function (j) { take(j); S.prevText = null; track('love_poem_chosen'); go('edit'); }); }); });
      });
      var regen = $('#lp-regen'); if (regen) regen.addEventListener('click', function () { if (confirm('Write 4 brand-new poems? This uses your last set. (Your current four will be replaced.)')) generate(regen, {}); });
      var fill = $('#lp-fill'); if (fill) fill.addEventListener('click', function () { generate(fill, { fill: true }); });
    }
    if (S.step === 'edit') {
      var read = function () { return { title: $('#title').value, text: $('#poem').value }; };
      ['title', 'poem'].forEach(function (id) { $('#' + id).addEventListener('input', function () { autosave({ final: read() }); }); });
      var rev = $('#lp-revise');
      rev.addEventListener('click', function () {
        var ins = $('#instruction').value.trim();
        if (ins.length < 4) { message('Tell the AI what to change, e.g. "make it more playful".'); return; }
        busy(rev, function () {
          var before = read();
          return api('revise', { method: 'POST', json: { final: before, instruction: ins } }).then(function (j) { S.prevText = before; take(j); render(); message('Revised. Read it through, then edit or approve.', 'ok'); });
        });
      });
      var undo = $('#lp-undo');
      if (undo) undo.addEventListener('click', function () { var p = S.prevText; S.prevText = null; busy(undo, function () { return api('save', { method: 'POST', json: { final: p } }).then(function (j) { take(j); render(); }); }); });
      next.addEventListener('click', function () {
        busy(next, function () { return api('approve', { method: 'POST', json: { final: read() } }).then(function (j) { take(j); track('love_poem_approved'); go('design'); }); });
      });
    }
    if (S.step === 'design') {
      pressGroup('template', function (t) { S.template = t; autosave({ template: t }); });
      $('#dedication').addEventListener('input', function () { S.order.dedication = this.value; autosave({ dedication: this.value }); });
      $('#photo').addEventListener('change', function () { if (this.files && this.files[0]) uploadPhoto(this.files[0]); });
      var del = $('#lp-photo-del');
      if (del) del.addEventListener('click', function () { busy(del, function () { return api('photo', { method: 'DELETE' }).then(function (j) { take(j); S.photoUrl = ''; render(); }); }); });
      next.addEventListener('click', function () {
        busy(next, function () {
          return api('approve', { method: 'POST', json: { final: S.order.final, template: current('template') } })
            .then(function () { return api('save', { method: 'POST', json: { dedication: $('#dedication').value } }); })
            .then(function (j) { take(j); go(S.order.pkg === 'voice' ? 'voice' : 'preview'); });
        });
      });
    }
    if (S.step === 'voice') {
      S.recorder = window.LPRecorder.mount($('#lp-rec'), {
        maxSec: 180, script: (S.order.final || {}).title + '\n\n' + (S.order.final || {}).text, saved: S.order.hasAudio,
        playUrl: null,
        save: function (blob) { return api('audio', { method: 'PUT', raw: blob, type: blob.type || 'application/octet-stream' }).then(function () { S.order.hasAudio = true; track('love_poem_recorded'); }); },
      });
      next.addEventListener('click', function () { go('preview'); });
    }
    if (S.step === 'preview') {
      var pdfBtn = $('#lp-pdf');
      // open the window first (inside the tap) so phones don't block it, then point it at the signed link
      pdfBtn.addEventListener('click', function () {
        var w = window.open('', '_blank');
        busy(pdfBtn, function () { return api('preview-link', { method: 'POST', json: {} }).then(function (j) { if (w) w.location = j.url; else location.href = j.url; }, function (e) { if (w) w.close(); throw e; }); });
      });
      var pay = $('#lp-pay');
      pay.addEventListener('click', function () {
        var email = $('#email').value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { message('Please enter your email address so I can deliver your poem.'); return; }
        if (!$('#agree').checked) { message('Please tick the box to confirm you have checked the wording.'); return; }
        busy(pay, function () {
          track('love_poem_checkout', { package: S.order.pkg });
          return api('checkout', { method: 'POST', json: { email: email, agree: true } }).then(function (j) { location.href = j.url; return new Promise(function () {}); });
        });
      });
    }
  }

  function generate(btn, extra) {
    busy(btn, function () {
      root.querySelector('#lp-msg').insertAdjacentHTML('beforebegin', '<div class="writing" id="lp-writing"><div class="quill">✍️</div><p><b>Writing your poems…</b><br>This takes about 15–30 seconds. Please keep this page open.</p></div>');
      var p = extra.style ? api('save', { method: 'POST', json: { style: extra.style } }).then(take) : Promise.resolve();
      return p.then(function () { return api('generate', { method: 'POST', json: { fill: !!extra.fill } }); })
        .then(function (j) { take(j); track('love_poem_generated'); go('poems'); })
        .catch(function (e) { var w = document.getElementById('lp-writing'); if (w) w.remove(); throw e; });
    });
  }

  // Phones take huge photos: shrink to 1600px JPEG in the browser before uploading.
  function uploadPhoto(file) {
    if (!/^image\//.test(file.type) && !/\.(heic|heif|jpe?g|png|webp)$/i.test(file.name)) { message('Please choose a photo.'); return; }
    busy(null, function () {
      return new Promise(function (resolve, reject) {
        var img = new Image(); var url = URL.createObjectURL(file);
        img.onload = function () {
          var s = Math.min(1, 1600 / Math.max(img.width, img.height)); var c = document.createElement('canvas');
          c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
          c.toBlob(function (b) { b ? resolve(b) : reject(new Error('That photo could not be read. Please try another one.')); }, 'image/jpeg', 0.86);
        };
        img.onerror = function () { reject(new Error('That photo could not be opened. Please try a different one (JPG or PNG).')); };
        img.src = url;
      }).then(function (blob) {
        return api('photo', { method: 'PUT', raw: blob, type: 'image/jpeg' }).then(function (j) { take(j); S.photoUrl = URL.createObjectURL(blob); render(); });
      });
    });
  }

  // ---------- start: resume a saved draft if there is one ----------
  function where() {
    var o = S.order; if (!o) return 'pkg';
    if (o.paid) return 'pkg';
    if (o.approved && o.final) return 'preview';
    if (o.final) return 'edit';
    if ((o.poems || []).length) return 'poems';
    return 'about';
  }
  var saved = stored();
  var resume = /[?&]resume=1/.test(location.search);
  document.querySelectorAll('[data-start-pkg]').forEach(function (b) {
    b.addEventListener('click', function () { S.pkg = b.getAttribute('data-start-pkg'); if (S.step === 'pkg') render(); root.scrollIntoView({ behavior: 'smooth' }); });
  });
  if (saved && saved.id && saved.token) {
    S.token = saved.token; S.order = { id: saved.id };
    api('load').then(function (j) {
      take(j);
      if (S.order.paid) { store(null); S.order = null; S.token = ''; render(); return; }
      S.step = where(); render();
      if (!resume) message('Welcome back! I saved your poem so you can pick up where you left off.', 'info');
      else message('Payment was not completed. Your poem is saved: check it over and try again whenever you are ready.', 'info');
      if (resume) root.scrollIntoView();
    }).catch(function () { store(null); S.order = null; S.token = ''; render(); });
  } else { render(); }
})();
