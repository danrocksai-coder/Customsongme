/*
 * CustomSongMe — order confirmation + payment step for PayPal, Cash App and Venmo.
 *
 * Card (Stripe) orders still go straight to Stripe checkout (unchanged).
 * For the app-based methods, sending the customer away right after the form
 * submits meant they lost the order page, and Cash App / Venmo don't reliably
 * show the amount. Instead we keep them on the page, confirm the order went
 * through, show the exact amount, and let them open the payment app in a new tab.
 */
(function () {
  var HANDLES = {
    'Cash App': '$optimistic01',
    'Venmo': '@Dan-Rock-5',
    'PayPal': 'paypal.me/DanRock834'
  };

  function findAmount(opts) {
    if (opts.amount) return String(opts.amount);
    var m = (opts.pkg || '').match(/\$(\d+)/);
    if (m) return m[1];
    m = (opts.url || '').match(/\/(\d+)(?:[/?#]|$)/);
    if (m) return m[1];
    return '';
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  window.CSMPayConfirm = function (opts) {
    var form = opts.form;
    var method = opts.method;
    var url = opts.url;
    var amount = findAmount(opts);
    var es = (document.documentElement.lang || '').toLowerCase().indexOf('es') === 0;
    var amt = amount ? '$' + amount : '';
    var handle = HANDLES[method] || '';

    var t = es ? {
      title: '✅ ¡Listo! Recibí tu solicitud de canción.',
      last: 'Último paso: paga ' + (amt ? '<strong>' + amt + '</strong> ' : '') + 'con ' + esc(method) + '.',
      btn: 'Abrir ' + esc(method) + (amt ? ' para pagar ' + amt : ''),
      to: 'Paga a:',
      note: 'En la nota del pago escribe <strong>tu nombre</strong> para que pueda conectarlo con tu pedido.',
      check: 'Si la app no muestra el monto, escribe <strong>' + (amt || 'el monto de tu paquete') + '</strong> tú mismo.',
      after: 'En cuanto llegue tu pago, empiezo tu canción. Se entrega dentro de 24 horas después de confirmar el pago.',
      q: '¿Preguntas? Mándame un texto al <a href="sms:+16617140903">(661) 714-0903</a>.'
    } : {
      title: '✅ Got it — your song request is in!',
      last: 'Last step: pay ' + (amt ? '<strong>' + amt + '</strong> ' : '') + 'with ' + esc(method) + '.',
      btn: 'Open ' + esc(method) + (amt ? ' to pay ' + amt : ''),
      to: 'Pay to:',
      note: 'Put <strong>your name</strong> in the payment note so I can match it to your order.',
      check: 'If the app doesn’t show the amount, type in <strong>' + (amt || 'your package price') + '</strong> yourself.',
      after: 'As soon as your payment comes through, I start on your song. It’s delivered within 24 hours of confirmed payment.',
      q: 'Questions? Text me at <a href="sms:+16617140903">(661) 714-0903</a>.'
    };

    var box = document.createElement('div');
    box.className = 'csm-pay-confirm';
    box.setAttribute('role', 'status');
    box.setAttribute('tabindex', '-1');
    box.style.cssText = 'background:#fff;color:#1a1a1a;border:2px solid #2e9e5b;border-radius:14px;' +
      'padding:24px 20px;margin:0 auto;max-width:560px;text-align:center;line-height:1.5;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.12);font-size:17px;';
    box.innerHTML =
      '<h3 style="margin:0 0 10px;font-size:22px;color:#1a1a1a;">' + t.title + '</h3>' +
      '<p style="margin:0 0 18px;">' + t.last + '</p>' +
      '<a href="' + esc(url) + '" target="_blank" rel="noopener" ' +
      'style="display:inline-block;background:#2e9e5b;color:#fff;text-decoration:none;font-weight:700;' +
      'padding:14px 22px;border-radius:10px;font-size:18px;">' + t.btn + '</a>' +
      (handle ? '<p style="margin:16px 0 4px;">' + t.to + ' <strong>' + esc(handle) + '</strong></p>' : '') +
      '<p style="margin:12px 0 4px;">' + t.note + '</p>' +
      '<p style="margin:4px 0 12px;">' + t.check + '</p>' +
      '<p style="margin:12px 0 4px;color:#444;font-size:15px;">' + t.after + '</p>' +
      '<p style="margin:4px 0 0;color:#444;font-size:15px;">' + t.q + '</p>';

    if (form && form.parentNode) {
      form.parentNode.insertBefore(box, form);
      form.style.display = 'none';
    } else {
      document.body.insertBefore(box, document.body.firstChild);
    }
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    try { box.focus({ preventScroll: true }); } catch (e) {}
  };
})();
