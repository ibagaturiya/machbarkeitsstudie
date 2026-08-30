// Wiring check — run with:
//   node tests/check-wiring.mjs        (also runs as step 0 of run-tests.mjs)
//
// There is no bundler here, so nothing but the browser ever resolves a path.
// A renamed or moved file therefore fails at *runtime*, in the page, as a
// silently missing module — and the first symptom is usually a wrong number
// rather than an error. This check closes that gap without adding a build
// step: it asserts that what index.html asks for and what is on disk are the
// same set, in both directions.
//
//   1. every local <script src>/<link href> in index.html exists on disk
//   2. every js/**/*.js and css/*.css on disk is actually loaded (no orphans)
//   3. no asset is fetched from a remote host — the app must run offline,
//      which is what vendor/ is for (see vendor/README.md)
import { readFile, readdir, access } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = await readFile(join(root, 'index.html'), 'utf8');

const failures = [];
const fail = (msg) => { failures.push(msg); console.error(`FAIL ${msg}`); };
const ok = (msg) => console.log(`ok   ${msg}`);

// --- referenced assets, in index.html's own order -------------------------
const refs = [...html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*\shref)="([^"]+)"/g)]
  .map((m) => m[1]);

// 3) offline guarantee
const remote = refs.filter((r) => /^(https?:)?\/\//.test(r));
if (remote.length) fail(`index.html loads ${remote.length} asset(s) from a remote host: ${remote.join(', ')} — vendor them under vendor/ instead`);
else ok('kein Asset von einem fremden Host (App läuft offline)');

// 1) every referenced local file exists
const local = refs.filter((r) => !/^(https?:)?\/\//.test(r)).map((r) => r.split('?')[0]);
for (const rel of local) {
  try { await access(join(root, rel)); }
  catch { fail(`index.html verweist auf ${rel} — Datei existiert nicht`); }
}
if (!failures.length) ok(`alle ${local.length} referenzierten Dateien vorhanden`);

// 2) no orphans on disk
async function walk(dir) {
  const out = [];
  for (const e of await readdir(join(root, dir), { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...await walk(join(dir, e.name)));
    else out.push(join(dir, e.name));
  }
  return out;
}
const onDisk = [...await walk('js'), ...await walk('css')]
  .map((p) => relative('.', p))
  .filter((p) => /\.(js|css)$/.test(p));
const loaded = new Set(local);
const orphans = onDisk.filter((p) => !loaded.has(p));
if (orphans.length) fail(`nicht von index.html geladen (toter Code?): ${orphans.join(', ')}`);
else ok(`alle ${onDisk.length} Dateien in js/ und css/ werden geladen`);

// 3) Kapitaelchen: die zwei Fallen, die beim Umstellen zugeschlagen haben.
//    (a) `font-variant-caps` wirkt nicht auf Versalien — bleibt irgendwo
//        `text-transform: uppercase` stehen, sind die Kapitaelchen dort
//        unsichtbar, ohne dass etwas kaputt aussieht.
//    (b) Die Kurzform `font:` setzt `font-variant` still zurueck. Genau so
//        verlor `.steckbrief-h` seine Kapitaelchen an `#screen-detail h3`.
//        Dagegen hilft, dass der Kapitaelchen-Block die LETZTE Regel in
//        shell.css ist: bei gleicher Spezifitaet gewinnt er dann immer.
//        Was ihn ueber die Spezifitaet schlaegt, muss weiterhin von Hand in
//        die Liste — deshalb prueft (c) die bekannten ID-Selektoren mit.
const uiCss = ['css/shell.css', 'css/panels.css', 'css/components.css'];
let versalien = [];
for (const f of uiCss) {
  const src = await readFile(join(root, f), 'utf8');
  const n = (src.match(/text-transform:\s*uppercase/g) || []).length;
  if (n) versalien.push(`${f} (${n}x)`);
}
if (versalien.length) {
  fail(`text-transform: uppercase in ${versalien.join(', ')} — dort bleiben die `
     + `Kapitaelchen unsichtbar (font-variant-caps wirkt nicht auf Versalien). `
     + `lowercase verwenden. css/print.css ist ausgenommen: das Exportdokument `
     + `behaelt seine Versalien.`);
} else ok('keine Versalien in der Oberflaeche (Kapitaelchen bleiben sichtbar)');

const shell = await readFile(join(root, 'css/shell.css'), 'utf8');
const capsIdx = shell.indexOf('font-variant-caps: small-caps');
if (capsIdx === -1) fail('css/shell.css: der Kapitaelchen-Block fehlt');
else {
  // (c) Jede Regel, die die Kurzform `font:` mit einer ID benutzt, schlaegt
  //     eine Klasse — sie muss selbst in der Kapitaelchen-Liste stehen.
  // Ab dem Abschnittskopf, nicht ab dem letzten Kommentar davor: der Block
  // enthaelt selbst Kommentare, und die Grenze rutschte sonst mitten in die
  // Selektorliste — die erste Haelfte galt dann faelschlich als fehlend.
  const block = shell.slice(shell.indexOf('9. Kapit'));
  const idFont = [...shell.matchAll(/^(#[^{,\n]*?)\s*\{[^}]*\bfont:\s/gm)].map((m) => m[1].trim());
  // Bewusst ohne Kapitaelchen: in ein Eingabefeld tippt der Nutzer selbst.
  // `text-transform: lowercase` wuerde ihm seine eigene Schreibweise
  // umschreiben, waehrend er sie eingibt — bei einer Adresse ist das falsch.
  const KEINE_KAPITAELCHEN = ['#address-input'];
  const fehlend = idFont.filter((sel) => !block.includes(sel)
    && !KEINE_KAPITAELCHEN.includes(sel));
  if (fehlend.length) {
    fail(`diese Regeln setzen die Kurzform \`font:\` mit ID-Spezifitaet und `
       + `stehen NICHT im Kapitaelchen-Block — dort fallen die Kapitaelchen `
       + `still aus: ${fehlend.join(', ')}`);
  } else ok(`Kapitaelchen: alle ${idFont.length} ID-Regeln mit \`font:\` sind abgedeckt`);
}

if (failures.length) { console.error(`\n${failures.length} Verdrahtungsfehler.`); process.exit(1); }
console.log('Verdrahtung in Ordnung.\n');
