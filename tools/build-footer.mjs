// Builds the one shared footer and puts it on every public page.
// Run:  node tools/build-footer.mjs        (safe to run again; it replaces the old footer each time)
// Edit the links below, run it, commit. Styles live in css/footer.css.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SOCIAL = [
  ['Facebook', 'https://www.facebook.com/customsongme'],
  ['Instagram', 'https://www.instagram.com/customsongme'],
  ['TikTok', 'https://www.tiktok.com/@customsongme'],
  ['YouTube', 'https://www.youtube.com/@customsongme'],
];
const REVIEW = 'https://g.page/r/CUJZcUwU_iIFEAE/review';

const EN = {
  tag: 'Songs written from your story by Dan the Song Man. Delivered within 24 hours.',
  text: 'Text or call Dan',
  follow: 'Follow us',
  review: '⭐ Leave a Google Review',
  cols: [
    ['Occasions', [['/birthday-songs', 'Birthday Songs'], ['/wedding-songs', 'Wedding Songs'], ['/anniversary-songs', 'Anniversary Songs'], ['/love-songs', 'Love Songs'], ['/mothers-day-songs', "Mother's Day"], ['/fathers-day-songs', "Father's Day"], ['/quinceanera-songs', 'Quinceañera Songs'], ['/pet-songs', 'Pet Songs'], ['/roast-songs', 'Roast Songs'], ['/memorial-songs', 'Celebration of Life']]],
    ['More from CustomSongMe', [['/holiday-songs', 'Holiday Songs'], ['/get-well-song-cards', 'Get Well Song Cards'], ['/business-jingles', 'Business Jingles'], ['/custom-lullaby-me', 'Baby Lullabies'], ['/adopt-a-rescue-dog', 'Adopt a Rescue Dog'], ['/es/', 'En español']]],
    ['Guides', [['/custom-song-cost', 'Song Cost Guide'], ['/how-long-does-a-custom-song-take', 'Delivery Time Guide'], ['/what-to-include-in-an-anniversary-song', 'Anniversary Song Tips'], ['/how-to-give-a-custom-song-as-a-gift', 'Gift Ideas'], ['/custom-song-vs-personalized-gift', 'Song vs Gift']]],
    ['Company', [['/', 'Home'], ['/#order-form', 'Order a Song'], ['/#faq', 'FAQ'], ['/privacy-terms', 'Privacy Policy'], ['/privacy-terms#who', 'Terms'], ['/privacy-terms#guarantee', 'Guarantee & Refunds'], ['/privacy-terms#ai', 'AI & Copyright'], ['/privacy-terms#contact', 'Contact']]],
  ],
  fine: 'Songs are made with AI-assisted music tools under Dan’s personal creative direction. Prices are in US dollars. Packages 2–4 include a public YouTube video unless you add Keep it Private. Text updates are optional: message and data rates may apply, and you can reply STOP any time. By ordering, you agree to the <a href="/privacy-terms">Privacy Policy &amp; Terms</a>.',
  copy: '© 2026 CustomSongMe. All Rights Reserved. Serving customers worldwide, online only.',
};
const ES = {
  tag: 'Canciones escritas a partir de tu historia por Dan the Song Man. Entregadas en 24 horas.',
  text: 'Escríbele o llama a Dan',
  follow: 'Síguenos',
  review: '⭐ Deja una reseña en Google',
  three: true,
  cols: [
    ['Ocasiones', [['/es/canciones-de-cumpleanos/', 'Canciones de cumpleaños'], ['/es/canciones-de-boda/', 'Canciones de boda'], ['/es/canciones-de-aniversario/', 'Canciones de aniversario'], ['/es/canciones-de-quinceanera/', 'Canciones de quinceañera'], ['/es/canciones-dia-de-las-madres/', 'Día de las Madres'], ['/love-songs', 'Canciones de amor'], ['/fathers-day-songs', 'Día del Padre'], ['/pet-songs', 'Canciones para mascotas'], ['/roast-songs', 'Canciones de burla'], ['/memorial-songs', 'Celebración de vida']]],
    ['Más de CustomSongMe', [['/business-jingles', 'Jingles para negocios'], ['/custom-lullaby-me', 'Canciones de cuna'], ['/adopt-a-rescue-dog', 'Adopta un perro rescatado'], ['/', 'English']]],
    ['Empresa', [['/es/', 'Inicio'], ['/es/#order-form', 'Ordenar una canción'], ['/es/#faq', 'Preguntas frecuentes'], ['/privacy-terms', 'Privacidad y términos'], ['/privacy-terms#guarantee', 'Garantía y reembolsos'], ['/privacy-terms#contact', 'Contacto']]],
  ],
  fine: 'Las canciones se hacen con herramientas musicales asistidas por IA bajo la dirección creativa personal de Dan. Precios en dólares estadounidenses. Los paquetes 2 a 4 incluyen un video público en YouTube, a menos que agregues Mantenlo privado. Las actualizaciones por texto son opcionales: pueden aplicar tarifas de mensajes y datos, y puedes responder STOP en cualquier momento. Al ordenar, aceptas la <a href="/privacy-terms">Política de privacidad y términos</a>.',
  copy: '© 2026 CustomSongMe. Todos los derechos reservados. Atendemos a clientes en todo el mundo, solo en línea.',
};

const li = ([href, label]) => `<li><a href="${href}">${label.replace(/&/g, '&amp;')}</a></li>`;
function footer(T) {
  const cols = T.cols.map(([h, links]) => `      <div class="sf-col">\n        <h3>${h}</h3>\n        <ul>\n          ${links.map(li).join('\n          ')}\n        </ul>\n      </div>`).join('\n');
  const social = SOCIAL.map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener me">${n}</a>`).join('');
  return `<footer class="site-footer">
  <div class="sf-inner">
    <div class="sf-top${T.three ? ' sf-three' : ''}">
      <div class="sf-brand">
        <p class="sf-brand-name">CustomSongMe</p>
        <p class="sf-tag">${T.tag}</p>
        <p class="sf-contact">${T.text}: <a href="tel:+16617140903">+1 (661) 714-0903</a></p>
        <div class="sf-social" aria-label="${T.follow}">${social}</div>
        <a class="sf-review" href="${REVIEW}" target="_blank" rel="noopener">${T.review}</a>
      </div>
${cols}
    </div>
    <div class="sf-bottom">
      <p class="sf-fine">${T.fine}</p>
      <p class="sf-copy">${T.copy}</p>
    </div>
  </div>
</footer>`;
}

const SKIP = new Set(['404.html', 'google5f8134af3193f7f5.html', 'landscapers.html', 'thanks.html', 'thanks-rescue.html', 'got-your-info.html', 'payment-links.html']);
const SKIP_DIRS = ['node_modules', '.git', 'docs', 'oxnard', 'songs', 'family-memory-magnets', 'reverse-gift', 'lullaby', 'netlify', 'tests', 'tools'];
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}
let changed = 0;
for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file);
  if (SKIP.has(rel)) continue;
  let s = fs.readFileSync(file, 'utf8');
  if (!/<footer[\s>]/.test(s)) continue;
  s = s.replace(/<footer[\s\S]*?<\/footer>/, footer(rel.startsWith('es/') ? ES : EN));
  if (!s.includes('/css/footer.css')) s = s.replace('</head>', '  <link rel="stylesheet" href="/css/footer.css?v=1" />\n</head>');
  fs.writeFileSync(file, s);
  changed++;
}
console.log('footer updated on', changed, 'pages');
