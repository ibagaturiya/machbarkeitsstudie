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

if (failures.length) { console.error(`\n${failures.length} Verdrahtungsfehler.`); process.exit(1); }
console.log('Verdrahtung in Ordnung.\n');
