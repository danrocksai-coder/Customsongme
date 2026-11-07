/*
 * Reverse Gift — recipient (child) experience.
 * Scan → choose a design → talk/type → card image → Copy Image → Text Mom → paste → send.
 *
 * Profile loading:
 *   /reverse-gift/p/<id>           -> /reverse-gift/profiles/<id>.json   (prototype storage)
 *   /reverse-gift/p/demo?...       -> profile built from the URL (internal testing / onboarding preview)
 * When durable storage is added (Phase 4) only loadProfile() needs to change.
 */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var state = { profile: null, template: null, blob: null, file: null, url: null };

  function idFromUrl() {
    var segs = location.pathname.split('/').filter(Boolean); // ['reverse-gift','p','<id>']
    var i = segs.indexOf('p');
    var id = (i >= 0 && segs[i + 1] && segs[i + 1] !== 'index.html') ? segs[i + 1] : params.get('id');
    return id ? decodeURIComponent(id).toLowerCase() : '';
  }

  function cleanPhone(p) {
    p = String(p || '').replace(/[^\d+]/g, '');
    if (p && p[0] !== '+') p = (p.length === 10 ? '+1' : '+') + p;
    return /^\+\d{8,15}$/.test(p) ? p : '';
  }

  function demoProfile() {
    var type = ['mom', 'dad', 'both'].indexOf(params.get('type')) >= 0 ? params.get('type') : 'mom';
    var photo = null;
    if (params.get('photo') === 'session') {
      try { photo = sessionStorage.getItem('rg-demo-photo'); } catch (e) {}
    } else if (params.get('photo') === 'sample') {
      photo = '/reverse-gift/profiles/media/sample-photo.svg';
    }
    return {
      id: 'demo', status: 'active', test: true, parentType: type,
      displayName: (params.get('name') || RG.parentLabel(type)).slice(0, 40),
      welcome: (params.get('msg') || 'I love hearing from you. Send me a little note anytime!').slice(0, 100),
      recipientName: (params.get('to') || '').slice(0, 30),
      theme: params.get('theme') || (type === 'dad' ? 'dads-reminder' : 'moms-love'),
      photo: photo,
      phone: params.get('phone') || '+15550100123'
    };
  }

  function loadProfile(id) {
    if (id === 'demo') return Promise.resolve(demoProfile());
    if (!/^[a-z0-9-]{4,40}$/.test(id)) return Promise.reject(new Error('bad id'));
    return fetch('/reverse-gift/profiles/' + id + '.json', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('not found');
      return r.json();
    });
  }

  /* ---------------- Hero ---------------- */
  function renderHero(p) {
    var hero = $('hero');
    var label = RG.parentLabel(p.parentType);
    $('heroEyebrow').textContent = 'A note from ' + (p.displayName || label);
    $('heroTitle').textContent = p.recipientName ? 'Hi ' + p.recipientName + '!' : 'Hi sweetheart!';
    $('heroMsg').textContent = p.welcome ? '“' + p.welcome + '”' : '';

    if (p.photo) {
      var img = document.createElement('img');
      img.className = 'hero-photo';
      img.alt = 'Photo of ' + (p.displayName || label);
      img.src = p.photo;
      hero.classList.add('has-photo');
      hero.insertBefore(img, hero.firstChild);
    } else {
      var t = RG.LANDING_THEMES[p.theme] || RG.LANDING_THEMES['moms-love'];
      hero.style.setProperty('--hero-bg', t.bg);
      hero.style.setProperty('--hero-ink', t.ink);
      hero.insertAdjacentHTML('afterbegin', t.art);
    }
    document.querySelectorAll('.pl').forEach(function (el) { el.textContent = label; });
    document.querySelectorAll('.pl-up').forEach(function (el) { el.textContent = label.toUpperCase(); });
    $('message').placeholder = 'Hey ' + label + ', I love you. Just thinking about you today…';
    if (p.recipientName) $('from').value = p.recipientName;
    document.title = 'A note from ' + (p.displayName || label);
  }

  /* ---------------- Steps ---------------- */
  function go(n) {
    [1, 2, 3].forEach(function (i) { $('step' + i).classList.toggle('hidden', i !== n); });
    var target = n === 1 ? $('hero') : $('step' + n);
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function buildDesigns(label) {
    var box = $('designs');
    Object.keys(RG.CARD_TEMPLATES).forEach(function (id) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'design'; b.setAttribute('aria-pressed', 'false'); b.dataset.id = id;
      var c = document.createElement('canvas');
      RG.renderCard(c, id, { to: label, message: 'I love you and I’m thinking about you today!', from: '' });
      var img = document.createElement('img');
      img.alt = '';
      img.src = c.toDataURL('image/jpeg', .7);
      var s = document.createElement('span'); s.textContent = RG.CARD_TEMPLATES[id].name;
      b.appendChild(img); b.appendChild(s);
      b.addEventListener('click', function () {
        box.querySelectorAll('.design').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
        b.setAttribute('aria-pressed', 'true');
        state.template = id;
        $('toStep2').disabled = false;
      });
      box.appendChild(b);
    });
  }

  /* ---------------- Message + speech ---------------- */
  function updateCounter() {
    var m = $('message');
    if (m.value.length > RG.MESSAGE_MAX) m.value = m.value.slice(0, RG.MESSAGE_MAX);
    var n = m.value.length;
    $('counter').textContent = n + ' / ' + RG.MESSAGE_MAX;
    $('counter').classList.toggle('max', n >= RG.MESSAGE_MAX);
    $('makeCard').disabled = !m.value.trim();
  }

  // iPhone/iPad: the browser's own speech feature is unreliable and can hang,
  // so we use the keyboard's microphone, which works on every iPhone.
  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function micHint(html) {
    var h = $('micHint');
    h.innerHTML = html;
    h.classList.remove('hidden');
  }

  function useKeyboardMic() {
    var m = $('message');
    m.focus();
    micHint('Now tap the <strong>🎤 microphone on your keyboard</strong> and start talking. ' +
      'Tap it again when you’re done.');
  }

  function setupSpeech() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    var mic = $('mic');
    if (!SR || isIOS()) {
      mic.addEventListener('click', useKeyboardMic);
      return;
    }

    var rec = null, listening = false, base = '', heard = false, watchdog = null, maxTimer = null;

    function reset() {
      listening = false;
      clearTimeout(watchdog); clearTimeout(maxTimer);
      mic.classList.remove('listening'); mic.setAttribute('aria-pressed', 'false');
      $('micLabel').textContent = '🎤 Tap to talk';
      updateCounter();
    }

    // Always stop right away when asked; never wait on the browser.
    function stopNow() {
      if (rec) { try { rec.abort(); } catch (e) {} rec.onresult = rec.onerror = rec.onend = null; rec = null; }
      reset();
    }

    mic.addEventListener('click', function () {
      if (listening) { stopNow(); return; }
      $('micHint').classList.add('hidden');
      rec = new SR();
      rec.lang = navigator.language || 'en-US';
      rec.interimResults = true;
      rec.continuous = false;
      base = $('message').value.trim();
      heard = false;
      var r = rec;
      r.onresult = function (e) {
        if (r !== rec) return;
        heard = true;
        clearTimeout(watchdog);
        var text = '';
        for (var i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
        text = text.replace(/\s+/g, ' ').trim();
        if (text) text = text.charAt(0).toUpperCase() + text.slice(1);
        $('message').value = (base ? base + ' ' : '') + text;
        updateCounter();
      };
      r.onerror = function (e) {
        if (r !== rec) return;
        stopNow();
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          micHint('The microphone is blocked. Tap the <strong>🎤 on your keyboard</strong> instead, or just type.');
        } else if (e.error === 'no-speech') {
          micHint('I didn’t hear anything. Tap <strong>Tap to talk</strong> and try again, or use the 🎤 on your keyboard.');
        }
      };
      r.onend = function () { if (r === rec) { rec = null; reset(); } };
      try {
        r.start();
        listening = true;
        mic.classList.add('listening'); mic.setAttribute('aria-pressed', 'true');
        $('micLabel').textContent = 'Listening… tap to stop';
        // Safety stops so the button can never get stuck.
        watchdog = setTimeout(function () {
          if (!heard) {
            stopNow();
            micHint('I didn’t hear anything. Try again, or tap the <strong>🎤 on your keyboard</strong>.');
          }
        }, 8000);
        maxTimer = setTimeout(stopNow, 60000);
      } catch (err) {
        stopNow();
        useKeyboardMic();
      }
    });
  }

  /* ---------------- Card image ---------------- */
  function makeCard() {
    var p = state.profile;
    var canvas = $('work');
    RG.renderCard(canvas, state.template, {
      to: RG.parentLabel(p.parentType),
      message: $('message').value,
      from: $('from').value
    });
    return new Promise(function (resolve) {
      canvas.toBlob(function (blob) {
        if (state.url) URL.revokeObjectURL(state.url);
        state.blob = blob;
        state.file = new File([blob], 'card-for-' + RG.parentLabel(p.parentType).toLowerCase().replace(/\W+/g, '-') + '.png', { type: 'image/png' });
        state.url = URL.createObjectURL(blob);
        $('cardImg').src = state.url;
        resolve();
      }, 'image/png');
    });
  }

  function status(kind, html) {
    var s = $('copyStatus');
    s.className = 'status ' + kind;
    s.innerHTML = html;
  }

  function copyImage() {
    var label = RG.parentLabel(state.profile.parentType);
    if (!state.blob) return;
    if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
      // The image is already made, so this runs straight from the tap (Safari requires that).
      navigator.clipboard.write([new ClipboardItem({ 'image/png': state.blob })]).then(function () {
        status('ok', '✅ Copied! Now tap <strong>Text ' + label + '</strong> and paste it.');
      }, function () { copyFailed(); });
    } else {
      copyFailed();
    }
  }

  function copyFailed() {
    status('err', 'This phone won’t copy pictures from a web page. ' +
      'Press and hold the card above and choose <strong>Copy</strong> or <strong>Save</strong>, ' +
      'or tap <strong>Share / Save</strong> below.');
  }

  function shareImage() {
    if (!state.file) return;
    if (navigator.canShare && navigator.canShare({ files: [state.file] })) {
      navigator.share({ files: [state.file] }).catch(function () {});
      return;
    }
    var a = document.createElement('a');
    a.href = state.url; a.download = state.file.name;
    document.body.appendChild(a); a.click(); a.remove();
    status('info', 'Saved. If you don’t see it, press and hold the card above and choose <strong>Save</strong>.');
  }

  /* ---------------- Text parent ---------------- */
  // The number is only put into the link at tap time, so it isn't shown on the page.
  function textParent(e) {
    var phone = cleanPhone(state.profile.phone);
    if (!phone) { e.preventDefault(); showNumber(); return; }
    e.currentTarget.href = 'sms:' + phone;
  }

  function showNumber() {
    var phone = cleanPhone(state.profile.phone);
    var label = RG.parentLabel(state.profile.parentType);
    var box = $('numBox');
    box.classList.remove('hidden');
    if (!phone) { box.textContent = 'Sorry, no number is set up for this page yet.'; return; }
    var pretty = phone.indexOf('+1') === 0 && phone.length === 12
      ? '(' + phone.slice(2, 5) + ') ' + phone.slice(5, 8) + '-' + phone.slice(8) : phone;
    box.innerHTML = 'If Messages opened without ' + label + '’s number, type it in: <strong></strong>';
    box.querySelector('strong').textContent = pretty;
  }

  /* ---------------- Start ---------------- */
  function start(p) {
    if (!p || p.status !== 'active') throw new Error('inactive');
    state.profile = p;
    if (p.test) $('testBanner').classList.remove('hidden');
    renderHero(p);
    $('loading').classList.add('hidden');
    $('app').classList.remove('hidden');

    RG.fontsReady().then(function () { buildDesigns(RG.parentLabel(p.parentType)); });
    setupSpeech();
    updateCounter();
    go(1);
    window.scrollTo(0, 0);

    $('toStep2').addEventListener('click', function () { go(2); });
    $('back1').addEventListener('click', function () { go(1); });
    $('back2').addEventListener('click', function () { go(2); });
    $('message').addEventListener('input', updateCounter);
    $('makeCard').addEventListener('click', function () {
      $('makeCard').disabled = true;
      RG.fontsReady().then(makeCard).then(function () {
        $('copyStatus').classList.add('hidden');
        $('numBox').classList.add('hidden');
        $('makeCard').disabled = false;
        go(3);
      });
    });
    $('copyBtn').addEventListener('click', function () {
      $('copyStatus').classList.remove('hidden');
      copyImage();
    });
    $('shareBtn').addEventListener('click', function () {
      $('copyStatus').classList.remove('hidden');
      shareImage();
    });
    $('textBtn').addEventListener('click', textParent);
    $('showNum').addEventListener('click', showNumber);
  }

  loadProfile(idFromUrl()).then(start).catch(function () {
    $('loading').classList.add('hidden');
    $('notFound').classList.remove('hidden');
  });
})();
