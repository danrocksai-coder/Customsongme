/*
 * CustomSongMe — shared step-by-step order builder.
 * Used by the homepage (EN + ES) and every converted occasion page.
 *
 * The page supplies the builder markup (<section id="order-form">, Steps 1-6) and loads this file.
 * Everything else lives here: package picker + totals, "who is it for" boxes, occasion tiles and
 * routing, required picks, order summary, mobile step bar, double-submit protection.
 *
 * Optional per-page hooks on <section id="order-form">:
 *   data-occasion-key="birthday"   pre-select that occasion and show it as "chosen" with a "change" link
 *   [data-occ-only="birthday"]     markup shown only while that occasion is selected
 *   [data-me][data-other]          text that switches wording when "for me" / "for someone else" is checked
 *
 * Totals are display-only here; netlify/functions/pay.mjs works out the real amount server-side.
 */
(function () {
  'use strict';
  var builderSection = document.getElementById('order-form');
  if (!builderSection || !document.querySelector('form[name="customsong-request"]')) return;

  var LANG = (document.documentElement.lang || 'en').slice(0, 2) === 'es' ? 'es' : 'en';

  // ───────────────────────── OCCASION ROUTING (edit these lists as pages are converted) ─────────────────────────
  // Occasions that have a converted page. Key = the tile's data-key. Only used when "for someone else" is checked.
  // Spanish converted pages: only the quinceañera page so far; other Spanish occasions stay on the Spanish homepage.
  var CONVERTED_PAGES = {
    en: {
      birthday: '/birthday-songs',
      anniversary: '/anniversary-songs',
      wedding: '/wedding-songs',
      love: '/love-songs',
      'mothers-day': '/mothers-day-songs',
      'fathers-day': '/fathers-day-songs',
      pet: '/pet-songs',
      roast: '/roast-songs',
      celebration: '/memorial-songs',
      quince: '/quinceanera-songs'
    },
    es: {
      quince: '/es/canciones-de-quinceanera',
      birthday: '/es/canciones-de-cumpleanos',
      'mothers-day': '/es/canciones-dia-de-las-madres',
      anniversary: '/es/canciones-de-aniversario',
      wedding: '/es/canciones-de-boda'
    }
  };
  // Occasions that always jump straight to their own page and pricing, even with nothing checked.
  var OWN_PAGES = {
    jingle: '/business-jingles',
    getwell: '/get-well-song-cards',
    lullaby: '/custom-lullaby-me',
    holiday: '/holiday-songs'
  };

  var I18N = {
    en: {
      pkgNames: { 1: "Custom Single", 2: "Music Video Release", 3: "Keepsake Set", 4: "Collector's Edition" },
      pkgNameTpl: 'Package {n} — {name} — ${price}',
      unlNote: ' + Keep it Private (Google Drive) +$25',
      rushNote: ' + Rush delivery (4 hours) +$10',
      rushLabel: 'Rush delivery +$10 (your song in 4 hours instead of 24)',
      rushHelp: 'Your phone number is required for rush orders so Dan can reach you, and you can reach him. You will get his number too.',
      rushRow: 'Rush delivery (4 hours)',
      rushPhone: 'Phone number (required for rush delivery. Reply STOP any time.)',
      totalLabel: 'Your total: ',
      charsWord: 'characters',
      msgLabels: ['Your message on the card', 'Your personal message on the card'],
      msgNeeded: 'Please add your message for the card.',
      yes: 'Yes (+$25)', rushYes: 'Yes (+$10)', no: 'No', none: 'Not chosen yet',
      barStep: 'Step {n} of 5', barReady: 'Ready to submit',
      pkgWord: 'Package',
      mePh: 'Me! (Your name, so I can write it from your point of view)',
      submitting: 'Submitting your request…',
      needEmail: 'Please add your email so Dan can reach you.',
      noPaySubject: '⚠️ Has questions, not paid yet: ',
      detailsSubject: '📝 Song details saved, not paid yet: ',
      noPayPage: 'https://www.customsongme.com/got-your-info',
      alertMsg: 'Something went wrong submitting your request. Please try again, or text Dan directly at (661) 714-0903.'
    },
    es: {
      pkgNames: { 1: "Sencillo Personalizado", 2: "Lanzamiento con Video Musical", 3: "Set de Recuerdo", 4: "Edición de Colección" },
      pkgNameTpl: 'Paquete {n} — {name} — ${price}',
      unlNote: ' + Mantenlo privado (Google Drive) +$25',
      rushNote: ' + Entrega urgente (4 horas) +$10',
      rushLabel: 'Entrega urgente +$10 (tu canción en 4 horas en vez de 24)',
      rushHelp: 'El teléfono es obligatorio en pedidos urgentes para que Dan pueda contactarte y tú a él. También recibirás su número.',
      rushRow: 'Entrega urgente (4 horas)',
      rushPhone: 'Teléfono (obligatorio para entrega urgente. Responde STOP en cualquier momento.)',
      totalLabel: 'Tu total: ',
      charsWord: 'caracteres',
      msgLabels: ['Tu mensaje en la tarjeta', 'Tu mensaje personal en la tarjeta'],
      msgNeeded: 'Por favor agrega tu mensaje para la tarjeta.',
      yes: 'Sí (+$25)', rushYes: 'Sí (+$10)', no: 'No', none: 'Aún sin elegir',
      barStep: 'Paso {n} de 5', barReady: 'Listo para enviar',
      pkgWord: 'Paquete',
      mePh: '¡Yo! (Tu nombre, para que la escriba desde tu punto de vista)',
      submitting: 'Enviando tu solicitud…',
      needEmail: 'Por favor agrega tu correo para que Dan pueda contactarte.',
      noPaySubject: '⚠️ Tiene preguntas, aún no paga: ',
      detailsSubject: '📝 Detalles guardados, aún no paga: ',
      noPayPage: 'https://www.customsongme.com/es/recibimos-tu-info',
      alertMsg: 'Algo salió mal al enviar tu solicitud. Por favor intenta de nuevo, o envíale un mensaje de texto a Dan directamente al (661) 714-0903.'
    }
  };
  var L = I18N[LANG];

  // The old payment links are kept here, unused, until the final cleanup pass.
  var LEGACY_PAYMENT_LINKS = {
    'Complete (Public) — $50': { 'Card (Stripe)': 'https://www.customsongme.com/pay/3cIaEWcLKb09cS7fcy9Ve0f' },
    'Complete (Unlisted) — $75': { 'Card (Stripe)': 'https://www.customsongme.com/pay/8x2fZgh20fgp8BRc0m9Ve0h' },
    'MP3 Only — $25': { 'Card (Stripe)': 'https://www.customsongme.com/pay/cNieVc2767NX3hxd4q9Ve06' }
  };

  var PKGS = {
    '1': { name: L.pkgNames[1], price: 25 },
    '2': { name: L.pkgNames[2], price: 50 },
    '3': { name: L.pkgNames[3], price: 75 },
    '4': { name: L.pkgNames[4], price: 100 }
  };
  var UNLISTED_PRICE = 25;
  var RUSH_PRICE = 10; // works on every package; the real amount is checked again in netlify/functions/pay.mjs

  var $ = function (id) { return document.getElementById(id); };
  var $q = function (sel) { return document.querySelector(sel); };
  var checked = function (name) { return document.querySelector('input[name="' + name + '"]:checked'); };

  var orderFormEl = $q('form[name="customsong-request"]');
  var nextRedirectField = $('next-redirect');
  var packageHiddenField = $('package-hidden-field');
  var totalHiddenField = $('total-hidden-field');
  var paymentMethodNote = $('payment-method-note');
  var publicNote = $('public-note');
  var unlistedCheckbox = $('unlisted-checkbox');
  // Rush delivery add-on: built here so every order page (English and Spanish) gets the same box.
  var rushCheckbox = null, phoneField = $('phone');
  (function addRush() {
    var addons = $q('.addons h4');
    if (!addons) return;
    var box = document.createElement('div');
    box.className = 'rush-block';
    box.style.cssText = 'margin:0 0 14px';
    box.innerHTML = '<label class="unlisted-toggle"><input type="checkbox" id="rush-checkbox" name="rush-addon" value="Yes" /><span></span></label><p class="rush-help"></p>';
    box.querySelector('span').textContent = L.rushLabel;
    box.querySelector('.rush-help').textContent = L.rushHelp;
    addons.parentNode.insertBefore(box, addons.nextSibling);
    rushCheckbox = box.querySelector('input');
    var dl = $q('#receipt dl'), total = dl && dl.querySelector('.rc-total');
    if (total) {
      var row = document.createElement('div');
      row.className = 'rc-row';
      row.innerHTML = '<dt></dt><dd id="rc-rush">—</dd>';
      row.querySelector('dt').textContent = L.rushRow;
      dl.insertBefore(row, total);
    }
  })();
  var phoneLabel = phoneField && phoneField.parentNode.querySelector('label');
  var phoneLabelDefault = phoneLabel ? phoneLabel.innerHTML : '';
  var orderTotal = $('order-total'); // optional; the total lives in the receipt and the phone bar
  var emailField = $('email');
  var msg1 = $('msg1');
  var msg1Group = $('msg1-group');

  function selectedPackage() {
    var r = checked('package-tier');
    return r ? r.value : '2';
  }
  function countText(el) { return el.value.length + ' / ' + el.maxLength + ' ' + L.charsWord; }
  // Packages 2, 3 and 4 each have ONE personal message for the card. It is optional (recommended).
  function configureMessages(n) {
    var needs = n !== '1';
    msg1Group.style.display = needs ? '' : 'none';
    msg1.disabled = !needs; msg1.required = false;
    msg1.maxLength = n === '2' ? 60 : 150;
    msg1.rows = n === '2' ? 2 : 6;
    $('msg1-label-text').textContent = n === '2' ? L.msgLabels[0] : L.msgLabels[1];
    if (msg1.value.length > msg1.maxLength) msg1.value = msg1.value.slice(0, msg1.maxLength);
    checkMsg();
    $('msg1-count').textContent = countText(msg1);
  }
  // Spaces alone do not count as a message.
  function checkMsg() {
    msg1.setCustomValidity(msg1.required && msg1.value.trim() === '' ? L.msgNeeded : '');
  }

  // ───────────────────────── TOTALS + CHECKOUT LINK ─────────────────────────
  function syncPaymentRedirect() {
    var n = selectedPackage();
    var p = PKGS[n];
    var canUnlist = n !== '1';
    if (!canUnlist && unlistedCheckbox) unlistedCheckbox.checked = false;
    if (publicNote) publicNote.style.display = canUnlist ? 'block' : 'none';
    var unlisted = canUnlist && unlistedCheckbox && unlistedCheckbox.checked;
    var rush = !!(rushCheckbox && rushCheckbox.checked);
    var total = p.price + (unlisted ? UNLISTED_PRICE : 0) + (rush ? RUSH_PRICE : 0);
    configureMessages(n);
    if (phoneField) {
      phoneField.required = rush;
      if (phoneLabel) { if (rush) phoneLabel.textContent = L.rushPhone; else phoneLabel.innerHTML = phoneLabelDefault; }
    }

    var pkgName = L.pkgNameTpl.replace('{n}', n).replace('{name}', p.name).replace('{price}', p.price);
    if (packageHiddenField) packageHiddenField.value = pkgName + (unlisted ? L.unlNote : '') + (rush ? L.rushNote : '') + ' = $' + total;
    if (totalHiddenField) totalHiddenField.value = '$' + total;
    if (orderTotal) orderTotal.textContent = L.totalLabel + '$' + total;

    var params = [];
    if (unlisted) params.push('unlisted=1');
    if (rush) params.push('rush=1');
    if (emailField && emailField.value) params.push('prefilled_email=' + encodeURIComponent(emailField.value));
    nextRedirectField.value = 'https://www.customsongme.com/pay/pkg' + n + (params.length ? '?' + params.join('&') : '');
    if (paymentMethodNote) paymentMethodNote.style.display = 'none';
  }
  document.querySelectorAll('input[name="package-tier"], input[name="payment-method"]').forEach(function (radio) {
    radio.addEventListener('change', syncPaymentRedirect);
  });
  if (unlistedCheckbox) unlistedCheckbox.addEventListener('change', syncPaymentRedirect);
  if (rushCheckbox) rushCheckbox.addEventListener('change', syncPaymentRedirect);
  if (emailField) emailField.addEventListener('input', syncPaymentRedirect);
  msg1.addEventListener('input', function () { checkMsg(); $('msg1-count').textContent = countText(msg1); });
  syncPaymentRedirect(); // set correctly on page load, not just on change

  // ───────────────────────── SAMPLE COLOR SWITCH (blue / sunset) ─────────────────────────
  // Swaps the sample picture on a package card; never selects the package itself.
  document.querySelectorAll('.pkg-colors').forEach(function (group) {
    var card = group.closest('.pkg-card-inner');
    var img = card.querySelector('.pkg-preview img');
    var zoom = card.querySelector('.pkg-zoom');
    group.querySelectorAll('.pkg-color').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        img.src = btn.dataset.thumb;
        zoom.dataset.full = btn.dataset.full;
        group.querySelectorAll('.pkg-color').forEach(function (b) {
          var on = b === btn;
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      });
    });
  });

  // ───────────────────────── "SEE EXAMPLE" POP-UP ─────────────────────────
  var pkgDialog = $('pkg-dialog');
  var pkgDialogImg = $('pkg-dialog-img');
  document.querySelectorAll('.pkg-example').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation(); // "See example" never selects the package
      pkgDialogImg.src = btn.dataset.full;
      pkgDialogImg.alt = btn.dataset.alt;
      if (pkgDialog.showModal) pkgDialog.showModal(); else pkgDialog.setAttribute('open', '');
    });
  });
  $('pkg-dialog-close').addEventListener('click', function () {
    if (pkgDialog.close) pkgDialog.close(); else pkgDialog.removeAttribute('open');
  });
  pkgDialog.addEventListener('click', function (e) { if (e.target === pkgDialog && pkgDialog.close) pkgDialog.close(); });

  // ───────────────────────── STORY STARTER CHIPS ─────────────────────────
  var storyField = $('story');
  document.querySelectorAll('.hint-chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var v = storyField.value;
      storyField.value = (v && !v.endsWith('\n') ? v + '\n' : v) + chip.dataset.add;
      storyField.focus();
      storyField.setSelectionRange(storyField.value.length, storyField.value.length);
      storyField.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });

  // ───────────────────────── ORDER SUMMARY + MOBILE STEP BAR ─────────────────────────
  var subjectField = $('subject');
  var nameField = $('name');
  var barBtn = $('step-bar');
  function refreshBuilder() {
    var n = selectedPackage(), p = PKGS[n];
    var unlisted = n !== '1' && unlistedCheckbox && unlistedCheckbox.checked;
    var rush = !!(rushCheckbox && rushCheckbox.checked);
    var total = p.price + (unlisted ? UNLISTED_PRICE : 0) + (rush ? RUSH_PRICE : 0);
    var occ = checked('occasion');
    var otherTxt = $('occasion-other');
    $('rc-occasion').textContent = occ ? (occ.dataset.other && otherTxt.value.trim() ? occ.value + ' — ' + otherTxt.value.trim() : occ.value) : L.none;
    var sfSel = checked('song-for');
    $('rc-songfor').textContent = sfSel ? sfSel.dataset.short : L.none;
    $('rc-package').textContent = L.pkgWord + ' ' + n + ' · ' + p.name + ' ($' + p.price + ')';
    $('rc-unlisted').textContent = unlisted ? L.yes : L.no;
    if ($('rc-rush')) $('rc-rush').textContent = rush ? L.rushYes : L.no;
    var styleSel = checked('genre'), vocSel = checked('vocalist');
    $('rc-style').textContent = styleSel ? styleSel.nextElementSibling.lastChild.textContent.trim() : L.none;
    $('rc-vocals').textContent = vocSel ? vocSel.nextElementSibling.lastChild.textContent.trim() : L.none;
    $('rc-total').textContent = '$' + total;
    $('addon-p1').style.display = n === '1' ? 'block' : 'none';
    var done1 = !!sfSel && !!occ && (!occ.dataset.other || otherTxt.value.trim() !== '');
    var done3 = subjectField.value.trim() !== '' && storyField.value.trim() !== '';
    var done6 = nameField.value.trim() !== '' && emailField && emailField.value.trim() !== '' && emailField.checkValidity();
    var done4 = !!(styleSel && vocSel);
    var next = !done1 ? 1 : !done4 ? 3 : !done3 ? 4 : !done6 ? 5 : 0; // sound (step 3) now comes before the story (step 4)
    barBtn.dataset.next = next;
    $('sb-pkg').textContent = L.pkgWord + ' ' + n + ' · ' + p.name;
    $('sb-total').textContent = '$' + total;
    $('sb-step').textContent = (next ? L.barStep.replace('{n}', next) : L.barReady) + ' ›';
  }
  barBtn.addEventListener('click', function () {
    var next = barBtn.dataset.next;
    var target = next && next !== '0' ? $('step-' + next) : orderFormEl.querySelector('.form-submit-area');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) { barBtn.classList.toggle('show', entries[0].isIntersecting); }, { threshold: 0 }).observe(builderSection);
  } else { barBtn.classList.add('show'); }
  orderFormEl.addEventListener('change', refreshBuilder);
  orderFormEl.addEventListener('input', refreshBuilder);

  // ───────────────────────── REQUIRED PICKS + FRIENDLY NOTES ─────────────────────────
  var soundNote = $('sound-note');
  var submitButton = orderFormEl.querySelector('button[type="submit"]');
  var SOUND_NOTE = soundNote.textContent;
  var giftNote = $('gift-note');
  var songForRow = $('songfor-row');
  function showGiftNote() {
    giftNote.style.display = 'block';
    songForRow.classList.add('flash');
    clearTimeout(showGiftNote.t);
    showGiftNote.t = setTimeout(function () { songForRow.classList.remove('flash'); }, 2600);
  }

  // ───────────────────────── OCCASION TILES ─────────────────────────
  var occGrid = $q('.occ-grid');
  var chosenBox = $('occ-chosen');
  var chosenLabel = $('occ-chosen-label');
  function currentPath() { return location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/'; }
  function destinationFor(input) {
    var key = input.dataset.key;
    if (OWN_PAGES[key]) return OWN_PAGES[key];
    var sf = checked('song-for');
    var page = CONVERTED_PAGES[LANG][key];
    if (sf && sf.dataset.gift && page && page !== currentPath()) return page + '?for=gift';
    return null;
  }
  occGrid.addEventListener('click', function (e) {
    var tile = e.target.closest('.occ-tile');
    if (!tile) return;
    var input = tile.querySelector('input');
    if (OWN_PAGES[input.dataset.key]) { e.preventDefault(); location.href = OWN_PAGES[input.dataset.key]; return; }
    if (!checked('song-for')) { // check "who is it for" first: gently stop and point at the row
      e.preventDefault();
      showGiftNote();
      songForRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    var dest = destinationFor(input);
    if (dest) { e.preventDefault(); location.href = dest; }
  });
  occGrid.addEventListener('change', function (e) { // keyboard fallback
    if (!e.target.checked) return;
    var dest = destinationFor(e.target);
    if (dest && (OWN_PAGES[e.target.dataset.key] || checked('song-for'))) { location.href = dest; return; }
    if (!checked('song-for')) {
      e.target.checked = false;
      showGiftNote();
      orderFormEl.dispatchEvent(new Event('change'));
      return;
    }
    collapseToChosen();
  });

  // Occasion pages start with their occasion already chosen, with a small "change" link.
  function collapseToChosen() {
    var r = checked('occasion');
    if (!chosenBox || !r) return;
    var face = r.nextElementSibling;
    chosenLabel.textContent = face.querySelector('.em').textContent + ' ' + face.lastChild.textContent.trim();
    chosenBox.hidden = false;
    occGrid.hidden = true;
  }
  var presetKey = builderSection.dataset.occasionKey;
  if (presetKey && chosenBox) {
    var presetInput = $q('input[name="occasion"][data-key="' + presetKey + '"]');
    if (presetInput) { presetInput.checked = true; collapseToChosen(); }
    $('occ-change').addEventListener('click', function () {
      chosenBox.hidden = true;
      occGrid.hidden = false;
    });
  }

  // ───────────────────────── SUBMIT GATE ─────────────────────────
  // "Who is it for", style and vocals are required. If one is missing (and nothing else blocks the form),
  // send them back to the right step with a friendly note.
  submitButton.addEventListener('click', function (e) {
    var hasFor = checked('song-for');
    var hasSound = checked('genre') && checked('vocalist');
    if (hasFor && hasSound) return;
    var gated = ['song-for', 'genre', 'vocalist'];
    var otherInvalid = Array.prototype.some.call(orderFormEl.elements, function (el) {
      return el.required && !el.disabled && gated.indexOf(el.name) === -1 && !el.checkValidity();
    });
    if (otherInvalid) return; // the browser points at that field first
    e.preventDefault();
    if (!hasFor) {
      showGiftNote();
      $('step-1').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    soundNote.textContent = SOUND_NOTE;
    soundNote.style.display = 'block';
    $('step-3').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // ───────────────────────── OCCASION-DEPENDENT BITS ─────────────────────────
  var otherWrap = $('other-wrap'), otherInput = $('occasion-other');
  var SUBJECT_PH = subjectField.placeholder;
  function applyOccasionAndAudience() {
    var occ = checked('occasion');
    var key = occ ? occ.dataset.key : '';
    var isOther = !!(occ && occ.dataset.other);
    otherWrap.style.display = isOther ? 'block' : 'none';
    otherInput.disabled = !isOther; otherInput.required = isOther;
    // "Not sure, you pick" music style opens an optional box for a song or artist to sound like
    var genreSel = checked('genre'), styleWrap = $('style-notes-wrap');
    if (styleWrap) {
      var wantsNote = !!(genreSel && genreSel.dataset.surprise);
      styleWrap.style.display = wantsNote ? 'block' : 'none';
      $('style-notes').disabled = !wantsNote;
    }

    var sf = checked('song-for');
    if (sf) { giftNote.style.display = 'none'; songForRow.classList.remove('flash'); }
    var forMe = !!(sf && sf.dataset.me);
    subjectField.placeholder = forMe ? L.mePh : SUBJECT_PH;

    // Occasion-only questions (e.g. the Birthday questions in Step 4)
    document.querySelectorAll('[data-occ-only]').forEach(function (box) {
      var on = box.dataset.occOnly === key;
      box.style.display = on ? '' : 'none';
      box.querySelectorAll('input, textarea, select').forEach(function (f) { f.disabled = !on; });
    });
    // Wording that follows "for me" / "for someone else"
    document.querySelectorAll('[data-me][data-other]').forEach(function (el) {
      el.textContent = forMe ? el.dataset.me : el.dataset.other;
    });
    document.querySelectorAll('[data-ph-me][data-ph-other]').forEach(function (el) {
      el.placeholder = forMe ? el.dataset.phMe : el.dataset.phOther;
    });
  }
  orderFormEl.addEventListener('change', applyOccasionAndAudience);
  orderFormEl.addEventListener('change', function () {
    if (checked('genre') && checked('vocalist')) soundNote.style.display = 'none';
  });
  applyOccasionAndAudience();

  // Arriving from a homepage tile (?for=gift): pre-check "for someone else" and start at Step 2.
  if (new URLSearchParams(location.search).get('for') === 'gift') {
    var giftBox = $q('input[name="song-for"][data-gift]');
    if (giftBox) {
      giftBox.checked = true;
      orderFormEl.dispatchEvent(new Event('change'));
      setTimeout(function () { $('step-2').scrollIntoView({ behavior: 'auto', block: 'start' }); }, 80);
    }
  }
  refreshBuilder();

  // ───────────────────────── DOUBLE-SUBMIT PROTECTION ─────────────────────────
  // Disable the button and show a loading state the moment the form is submitted, so a slow connection
  // or an impatient double-tap can't send two orders.
  var submitBtn = submitButton;
  var formErrorMsg = $('form-error-msg');
  var submitBtnOriginalText = submitBtn.textContent;
  // "Send my info without paying": only an email is needed. Dan gets the details and reaches out; no checkout.
  var noPayBtn = $('nopay-btn');
  var detailsBtn = $('details-btn');
  var noPaySubject = $('nopay-subject');
  var paymentMethodField = $('payment-method');
  [noPayBtn, detailsBtn].forEach(function (b) { if (b) b.addEventListener('click', function (e) {
    if (!emailField || !emailField.value.trim() || !emailField.checkValidity()) {
      e.preventDefault();
      emailField.setCustomValidity(L.needEmail);
      emailField.reportValidity();
      emailField.addEventListener('input', function clear() { emailField.setCustomValidity(''); emailField.removeEventListener('input', clear); });
    }
  }); });
  orderFormEl.addEventListener('submit', function (e) {
    e.preventDefault();
    var isDetails = !!(detailsBtn && e.submitter === detailsBtn);
    var noPay = isDetails || !!(noPayBtn && e.submitter === noPayBtn);
    if (paymentMethodField) paymentMethodField.value = isDetails ? 'NOT PAID YET (saved song details)' : noPay ? 'NOT PAID YET (has questions)' : 'Card (Stripe)';
    if (noPaySubject) {
      noPaySubject.disabled = !noPay;
      noPaySubject.value = noPay ? (isDetails ? L.detailsSubject : L.noPaySubject) + ($('name').value.trim() || emailField.value.trim()) : '';
    }
    if (noPay) nextRedirectField.value = L.noPayPage; else syncPaymentRedirect();
    var btn = isDetails ? detailsBtn : noPay ? noPayBtn : submitBtn;
    var btnText = btn.textContent;
    [submitBtn, noPayBtn, detailsBtn].forEach(function (b) { if (b) b.disabled = true; });
    btn.textContent = L.submitting;
    if (formErrorMsg) formErrorMsg.style.display = 'none';

    var formData = new FormData(orderFormEl);
    fetch(orderFormEl.action, {
      method: 'POST',
      body: formData,
      headers: { 'Accept': 'application/json' }
    })
    .then(function (response) {
      if (response.ok) {
        window.location.href = nextRedirectField.value;
      } else {
        throw new Error('Submission failed');
      }
    })
    .catch(function () {
      [submitBtn, noPayBtn, detailsBtn].forEach(function (b) { if (b) b.disabled = false; });
      btn.textContent = btnText;
      if (formErrorMsg) {
        formErrorMsg.style.display = 'block';
        formErrorMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        alert(L.alertMsg);
      }
    });
  });
})();
