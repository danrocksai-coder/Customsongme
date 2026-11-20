/* CustomSongMe quick-order forms.
   Each /q/<occasion>.html page sets window.QUICK_FORM = { occasion, questions: [...] }
   and loads this file. Shared questions (style, vocals, timing, contact) are added here,
   so every occasion link stays consistent. Submissions go to Formspree (same inbox as
   the main order form). No payment step: Dan follows up with a payment link. */
(function () {
  var ENDPOINT = 'https://formspree.io/f/xwpqlypv';
  var DAN_SMS = 'sms:+16617140903';

  var GENRES = ['Pop', 'Country', 'R&B / Soul', 'Romantic Ballad', 'Folk / Acoustic', 'Rock',
    'Hip-Hop', 'Jazz', 'Gospel / Worship', 'Reggae', 'Latin / Reggaeton', 'EDM / Dance',
    'Oldies / Motown', '80s Vibe', '90s Vibe', 'Kids / Sing-Along', 'Surprise me'];

  var SHARED_STYLE = [
    { type: 'chips', name: 'genre', title: 'Pick a music style', hint: 'Choose up to 2.', multi: true, max: 2, options: GENRES },
    { type: 'chips', name: 'vocalist', title: 'Who should sing it?', options: ['Male vocals', 'Female vocals', 'Duet (both)', 'No preference'] },
    { type: 'chips', name: 'tempo', title: 'Tempo', options: ['Slow', 'Medium', 'Upbeat', 'Dan decides'] }
  ];

  var SHARED_END = [
    { type: 'chips', name: 'detail_level', title: 'How closely should Dan use your details?',
      options: ['As close as possible', 'Somewhere in between', 'Use them as inspiration'] },
    { type: 'chips', name: 'needed_by', title: 'When do you need it?',
      options: ['ASAP (24 hrs)', 'This week', 'In a couple weeks', 'No rush'] },
    { type: 'contact' }
  ];

  var cfg = window.QUICK_FORM;
  var root = document.getElementById('quick-form');
  if (!cfg || !root) return;

  var questions = cfg.questions.slice();
  // The story box sits right before the shared style questions unless the page placed it.
  var hasStory = questions.some(function (q) { return q.type === 'story'; });
  if (!hasStory) questions.push({ type: 'story' });
  questions = questions.concat(SHARED_STYLE, SHARED_END);

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var uid = 0;
  function chipsHtml(q) {
    var type = q.multi ? 'checkbox' : 'radio';
    return '<div class="chips">' + q.options.map(function (opt) {
      var id = 'c' + (uid++);
      return '<label class="chip" for="' + id + '"><input type="' + type + '" id="' + id + '" name="' + esc(q.name) +
        '" value="' + esc(opt) + '"><span>' + esc(opt) + '</span></label>';
    }).join('') + '</div>';
  }

  function titleHtml(q) {
    return '<h2>' + esc(q.title) + (q.required ? ' <span class="req">*</span>' : '') + '</h2>' +
      (q.hint ? '<p class="hint">' + esc(q.hint) + '</p>' : (q.multi && !q.max ? '<p class="hint">Pick as many as fit.</p>' : ''));
  }

  function questionHtml(q, i) {
    var attrs = ' data-q="' + i + '"' + (q.required ? ' data-required="1"' : '') + (q.name ? ' data-name="' + esc(q.name) + '"' : '');
    if (q.type === 'chips') {
      return '<section class="q"' + attrs + '>' + titleHtml(q) + chipsHtml(q) +
        '<p class="err">Please pick one.</p></section>';
    }
    if (q.type === 'text') {
      return '<section class="q"' + attrs + '>' + titleHtml(q) + '<div class="fields' + (q.fields.length > 1 ? ' two' : '') + '">' +
        q.fields.map(function (f) {
          return '<div class="field"><label for="f_' + esc(f.name) + '">' + esc(f.label) +
            (f.optional ? ' <span class="opt">(optional)</span>' : '') + '</label><input type="text" id="f_' + esc(f.name) +
            '" name="' + esc(f.name) + '" placeholder="' + esc(f.placeholder || '') + '"' + (f.optional ? '' : ' required') +
            ' autocomplete="off"></div>';
        }).join('') + '</div><p class="err">Please fill this in.</p></section>';
    }
    if (q.type === 'story') {
      var s = cfg.story || {};
      return '<section class="q" data-q="' + i + '" data-required="1" data-name="story">' +
        '<h2>' + esc(s.title || 'Tell the story') + ' <span class="req">*</span></h2>' +
        '<p class="hint">' + esc(s.hint || 'A few sentences is plenty. Bullet points are fine.') + '</p>' +
        (s.prompts ? '<ul class="prompts">' + s.prompts.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' : '') +
        '<textarea id="f_story" name="story" required placeholder="' + esc(s.placeholder || '') + '"></textarea>' +
        '<p class="err">Just a few sentences so Dan has something to write from.</p></section>';
    }
    if (q.type === 'contact') {
      return '<section class="q" data-q="' + i + '" data-required="1" data-name="contact">' +
        '<h2>Where should Dan send the details? <span class="req">*</span></h2>' +
        '<p class="hint">No card needed. Dan will text you a short sample and a payment link. Pay only if you love it.</p>' +
        '<div class="fields">' +
        '<div class="field"><label for="f_name">Your name</label><input type="text" id="f_name" name="name" autocomplete="name" required placeholder="First and last"></div>' +
        '<div class="fields two">' +
        '<div class="field"><label for="f_phone">Phone</label><input type="tel" id="f_phone" name="phone" autocomplete="tel" inputmode="tel" required placeholder="Best number to text"></div>' +
        '<div class="field"><label for="f_email">Email <span class="opt">(optional)</span></label><input type="email" id="f_email" name="email" autocomplete="email" inputmode="email" placeholder="you@email.com"></div>' +
        '</div></div>' +
        '<p class="err">Please add your name and a phone number.</p></section>';
    }
    return '';
  }

  root.innerHTML =
    '<div class="progress"><div class="bar"><div class="fill"></div></div><div class="label">0% done</div></div>' +
    '<form id="qf" novalidate>' +
    '<label class="hp" aria-hidden="true">Leave blank <input type="text" name="_gotcha" tabindex="-1" autocomplete="off"></label>' +
    questions.map(questionHtml).join('') +
    '<div class="submit-area"><button type="submit" class="btn">Send it to Dan 🎶</button>' +
    '<div class="form-error" id="qf-error">Something went wrong sending this. Please try again, or <a href="' + DAN_SMS + '">text Dan at (661) 714-0903</a>.</div>' +
    '<p class="small">No card needed. Free sample first. Questions? <a href="' + DAN_SMS + '">Text Dan</a></p></div>' +
    '</form>';

  var form = document.getElementById('qf');
  var sections = Array.prototype.slice.call(form.querySelectorAll('.q'));
  var fill = root.querySelector('.fill');
  var plabel = root.querySelector('.progress .label');

  // Limit multi-select chips that have a max.
  questions.forEach(function (q, i) {
    if (q.type !== 'chips' || !q.max) return;
    var sec = form.querySelector('[data-q="' + i + '"]');
    sec.addEventListener('change', function (e) {
      if (sec.querySelectorAll('input:checked').length > q.max) e.target.checked = false;
    });
  });

  function answered(sec) {
    var inputs = sec.querySelectorAll('input:not([type=checkbox]):not([type=radio]), textarea');
    var chips = sec.querySelectorAll('input[type=checkbox], input[type=radio]');
    if (chips.length) return sec.querySelectorAll('input:checked').length > 0;
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].required && !inputs[i].value.trim()) return false;
    }
    if (inputs.length && !Array.prototype.some.call(inputs, function (x) { return x.value.trim(); })) return false;
    return true;
  }

  function updateProgress() {
    var done = sections.filter(answered).length;
    var pct = Math.round(done / sections.length * 100);
    fill.style.width = pct + '%';
    plabel.textContent = pct === 100 ? 'All set! Hit send 👇' : pct + '% done';
  }
  form.addEventListener('input', updateProgress);
  form.addEventListener('change', function (e) {
    updateProgress();
    var sec = e.target.closest('.q');
    if (sec && answered(sec)) sec.classList.remove('error');
  });
  updateProgress();

  function collect() {
    var data = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || el.type === 'submit') return;
      if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) return;
      var v = el.value.trim();
      if (!v) return;
      data[el.name] = data[el.name] ? data[el.name] + ', ' + v : v;
    });
    return data;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var firstBad = null;
    sections.forEach(function (sec) {
      if (sec.dataset.required && !answered(sec)) { sec.classList.add('error'); firstBad = firstBad || sec; }
    });
    var phone = form.querySelector('#f_phone');
    if (phone && phone.value.replace(/\D/g, '').length < 10) {
      var cs = phone.closest('.q'); cs.classList.add('error'); firstBad = firstBad || cs;
    }
    if (firstBad) { firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }

    var data = collect();
    if (data._gotcha) return;
    var params = new URLSearchParams(location.search);
    data.occasion = cfg.occasion;
    data.source = 'Quick link /q/' + cfg.slug + (params.get('ref') ? ' (ref: ' + params.get('ref') + ')' : '');
    data._subject = 'Quick ' + cfg.occasion + ' song request from ' + (data.name || 'someone') + ' — for ' + (data[cfg.subjectField] || '?');
    data.payment = 'Not collected. Send sample + payment link';

    var btn = form.querySelector('.btn');
    var errBox = document.getElementById('qf-error');
    btn.disabled = true; btn.textContent = 'Sending…'; errBox.style.display = 'none';

    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(function (r) {
      if (!r.ok) throw new Error('bad status');
      if (window.gtag) gtag('event', 'generate_lead', { form: 'quick_' + cfg.slug });
      root.style.display = 'none';
      var hero = document.querySelector('.hero'); if (hero) hero.style.display = 'none';
      var done = document.getElementById('done');
      var first = (data.name || '').split(' ')[0];
      done.querySelector('.who').textContent = first ? ', ' + first : '';
      done.style.display = 'block';
      window.scrollTo(0, 0);
    }).catch(function () {
      btn.disabled = false; btn.textContent = 'Send it to Dan 🎶'; errBox.style.display = 'block';
    });
  });
})();
