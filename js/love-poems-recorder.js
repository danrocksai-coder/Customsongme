/* CustomSongMe Love Poems — record your own voice in the browser (no AI voice, ever).
   Record, listen back, re-record, then save. iPhone records audio/mp4, Android webm or mp4.
   Usage: LPRecorder.mount(el, { maxSec: 180, script: 'poem text', saved: bool, save: (blob) => Promise }) */
(function () {
  'use strict';
  function pickMime() {
    if (!window.MediaRecorder) return null;
    var c = ['audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
    for (var i = 0; i < c.length; i++) { try { if (MediaRecorder.isTypeSupported(c[i])) return c[i]; } catch (e) { /* ignore */ } }
    return '';
  }
  function fmt(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function mount(el, opts) {
    var maxSec = opts.maxSec || 180, state = opts.saved ? 'saved' : 'idle', mr = null, stream = null, chunks = [], t0 = 0, timer = null, rec = null, err = '';
    var mime = pickMime();

    function draw() {
      var h = '';
      if (opts.script) h += '<div class="tele" aria-label="Your poem to read">' + esc(opts.script) + '</div>';
      if (state === 'idle') {
        h += '<p>Find a quiet spot, hold your phone about a hand-width away, and read slowly. You can listen back and try again as many times as you like.</p>'
          + '<button type="button" class="btn btn-gold" data-a="start">🎙️ Start recording</button>';
      } else if (state === 'recording') {
        h += '<div class="time live"><span class="dot"></span> <span data-t>0:00</span> / ' + fmt(maxSec) + '</div>'
          + '<button type="button" class="btn btn-navy" data-a="stop">■ Stop</button>';
      } else if (state === 'review') {
        h += '<p><b>Listen back.</b> Happy with it? Save it. If not, record again.</p><audio controls src="' + rec.url + '"></audio>'
          + '<div class="row" style="justify-content:center"><button type="button" class="btn btn-ghost" data-a="redo">↺ Record again</button>'
          + '<button type="button" class="btn btn-gold" data-a="save">✓ Save this recording</button></div>';
      } else if (state === 'saving') {
        h += '<div class="time">Saving…</div><button type="button" class="btn btn-gold busy">Saving</button>';
      } else if (state === 'saved') {
        h += '<div class="msg ok">✓ Your recording is saved.</div>'
          + (opts.playUrl ? '<audio controls preload="none" src="' + esc(opts.playUrl()) + '"></audio>' : '')
          + '<div class="row" style="justify-content:center;margin-top:8px"><button type="button" class="btn btn-ghost" data-a="redo">↺ Record a new version</button></div>';
      }
      if (err) h += '<div class="msg err">' + esc(err) + '</div>';
      el.innerHTML = '<div class="rec">' + h + '</div>';
    }

    function start() {
      err = '';
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || mime === null) { err = 'This browser can\'t record audio. Please open this page in Safari (iPhone) or Chrome (Android or computer).'; draw(); return; }
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (s) {
        stream = s; chunks = [];
        try { mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); } catch (e) { mr = new MediaRecorder(stream); }
        mr.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        mr.onstop = stopped;
        mr.start(1000); t0 = Date.now(); state = 'recording'; draw();
        timer = setInterval(function () {
          var sec = (Date.now() - t0) / 1000, t = el.querySelector('[data-t]');
          if (t) t.textContent = fmt(sec);
          if (sec >= maxSec) stop();
        }, 250);
      }).catch(function (e) {
        err = e && e.name === 'NotAllowedError' ? 'Your microphone is blocked. Allow microphone access for this website in your browser settings, then tap Start again.' : 'The microphone could not start. Please try again.';
        state = 'idle'; draw();
      });
    }
    function stop() { clearInterval(timer); if (mr && mr.state !== 'inactive') mr.stop(); }
    function stopped() {
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
      var type = (mr && mr.mimeType) || mime || 'audio/mp4';
      var blob = new Blob(chunks, { type: type }); var sec = (Date.now() - t0) / 1000;
      if (sec < 2 || blob.size < 1000) { err = 'That was too short. Please try again.'; state = 'idle'; draw(); return; }
      if (rec && rec.url) URL.revokeObjectURL(rec.url);
      rec = { blob: blob, type: type, url: URL.createObjectURL(blob) }; state = 'review'; draw();
    }
    function save() {
      if (!rec) return; state = 'saving'; err = ''; draw();
      opts.save(rec.blob).then(function () { state = 'saved'; draw(); if (opts.onSaved) opts.onSaved(); })
        .catch(function (e) { err = (e && e.message) || 'Saving failed. Check your connection and tap Save again.'; state = 'review'; draw(); });
    }
    el.addEventListener('click', function (e) {
      var a = e.target.closest('[data-a]'); if (!a) return;
      var act = a.getAttribute('data-a');
      if (act === 'start') start(); else if (act === 'stop') stop(); else if (act === 'save') save();
      else if (act === 'redo') { rec = null; err = ''; state = 'idle'; draw(); start(); }
    });
    draw();
    return { setScript: function (s) { opts.script = s; if (state === 'idle' || state === 'saved') draw(); } };
  }
  window.LPRecorder = { mount: mount };
})();
