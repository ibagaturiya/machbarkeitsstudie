// Golden regression tests for the legal arithmetic — run with:
//   node tests/run-tests.mjs
// No browser needed: envelope.js and rules.js are pure logic over
// window.MachbarkeitTool; fetch is stubbed to read the local data files.
// Every expected value below is hand-derived from the cited article, so a
// failing test means the code (or the data) no longer matches the law as
// last verified — not merely that "something changed".
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Step 0 — wiring. Runs before any arithmetic: if index.html no longer loads
// the modules that are on disk, every number below is computed by code the
// browser never sees, and a green suite would be a lie. See
// tests/check-wiring.mjs.
const wiring = spawnSync(process.execPath, [join(root, 'tests/check-wiring.mjs')], { stdio: 'inherit' });
if (wiring.status !== 0) process.exit(wiring.status ?? 1);

globalThis.window = globalThis;
// fetch stub: serve /data/*.json from disk.
globalThis.fetch = async (url) => {
  const path = join(root, String(url).replace(/^\//, ''));
  try {
    const body = await readFile(path, 'utf8');
    return { ok: true, json: async () => JSON.parse(body) };
  } catch (e) {
    return { ok: false, status: 404 };
  }
};

// turf zuerst: coordinates.js und waldabstand.js greifen beim Aufruf darauf
// zu. Die UMD nimmt in ESM den globalThis-Zweig.
(0, eval)(await readFile(join(root, 'vendor/turf-6.5.0/turf.min.js'), 'utf8'));

// netz.js vor allem, was eine Quelle abruft (rules.js, checklist.js,
// waldabstand.js) — es stellt T.fetchQuelle bereit.
for (const f of ['js/core/format.js', 'js/core/netz.js', 'js/core/sicherheit.js', 'js/core/parkierung.js', 'js/core/normkette.js', 'js/sources/checklist.js', 'js/core/envelope.js', 'js/core/rules.js', 'js/ui/kennwerte.js', 'js/core/coordinates.js', 'js/sources/waldabstand.js']) {
  // Plain scripts attaching to window.MachbarkeitTool — evaluate in order.
  // eslint-disable-next-line no-eval
  (0, eval)(await readFile(join(root, f), 'utf8'));
}
const T = window.MachbarkeitTool;

let failures = 0;
function check(name, actual, expected, tol = 0.01) {
  const ok = typeof expected === 'number'
    ? Math.abs(actual - expected) <= tol
    : actual === expected;
  if (!ok) {
    failures++;
    console.error(`FAIL ${name}: expected ${expected}, got ${actual}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

// ---------------------------------------------------------------------------
// 000000) Ein gemeinsamer Abschnitt darf nichts ueber EINE Parzelle behaupten
//      Der PDF-Export fasst bei mehreren Grundstuecken die Pruefpunkte
//      zusammen, die auf jedem Blatt wortgleich stuenden. Wortgleich ist
//      dafuer nicht genug: der Werkleitungs-Punkt lautete auf allen drei
//      Zumikoner Grundstuecken identisch «… schneidet diese Parzelle und ist
//      oben abgezogen» und behauptete das im gemeinsamen Anhang fuer alle
//      drei — waehrend ihre eigenen Blaetter dreimal das Gegenteil
//      festhielten. Drei gleichlautende Befunde sind keine gemeinsame Regel.
//      REGELN.md §12.7.
// ---------------------------------------------------------------------------
{
  const einzelfall = (o) => T.istEinzelfallAussage(o);

  // Die Wortprobe: Verben eines Ergebnisses und konkrete Flaechen.
  check('«schneidet diese Parzelle» ist eine Einzelfall-Aussage',
    einzelfall({ text: 'Eine solche Linie schneidet diese Parzelle und ist oben abgezogen.' }), true);
  check('«… gefunden» ebenso (auch der leere Befund)',
    einzelfall({ text: 'Kein Eintrag im kommunalen Denkmalpflege-Inventar für diese Parzelle gefunden.' }), true);
  check('eine konkrete Flaechenangabe ebenso',
    einzelfall({ text: 'Davon entfallen 117.6 m² auf die Waldseite.' }), true);
  check('ein reiner Regeltext nicht',
    einzelfall({ text: 'Art. 32 BZO Zumikon: Wo Verkehrsbaulinien fehlen, gilt ein Abstand von 2 m gegenüber öffentlichen Strassen.' }), false);

  // Die Kennzeichnung am Punkt schlaegt zu, auch wenn der Wortlaut harmlos ist.
  check('`einzelfall: true` genuegt allein',
    einzelfall({ einzelfall: true, text: 'Nicht geprüft.' }), true);
  // … und die Wortprobe schlaegt zu, auch wenn die Kennzeichnung fehlt.
  check('`einzelfall: false` hebt die Wortprobe NICHT auf',
    einzelfall({ einzelfall: false, text: 'Eine Baulinie schneidet diese Parzelle.' }), true);

  // Der reale Punkt, an dem es passiert ist: er darf jetzt gemeinsam stehen —
  // und muss dafuer ohne Befund auskommen.
  const cl = await T.buildChecklist({
    parcelPolygon: turf.polygon([[[2690300, 1242900], [2690340, 1242900], [2690340, 1242940], [2690300, 1242940], [2690300, 1242900]]]),
    restrictions: {
      waldabstand: { concerned: false }, gewaesserraum: { concerned: false }, baulinien: { concerned: false },
    },
    rules: await T.getZoneRules({ zone: 'W2/25' }, 'Zumikon'),
    gemeinde: 'Zumikon', bfsNr: 160,
    wald: { applies: false }, waldLossInFootprintM2: 0,
    baulinien: { applies: true }, baulinienLossM2: 0,
  });
  const werk = cl.tierB.find((i) => i.key === 'werkleitungen');
  check('der Werkleitungs-Punkt existiert', !!werk, true);
  check('… und behauptet nichts ueber die einzelne Parzelle', einzelfall(werk), false);
  check('… nennt aber, WO das Ergebnis steht',
    werk.text.includes('auf dessen eigenem Blatt'), true);
  check('… und weiterhin, was NICHT geprueft ist',
    werk.text.includes('Werkleitungskataster'), true);

  // Ausserhalb der Stadt Zuerich wird gar nicht abgefragt — dann ist der Text
  // eine Aussage ueber den DATENSATZ und darf gemeinsam stehen.
  const sbv = cl.tierB.find((i) => i.key === 'sonderbauvorschriften');
  check('Sonderbauvorschriften ohne Abfrage: parzellenunabhaengig', einzelfall(sbv), false);

  // Jeder Punkt, der als gemeinsam durchgeht, muss BEIDE Schranken passieren.
  const gemeinsamTauglich = cl.tierB.filter((i) => !einzelfall(i));
  check('kein gemeinsam-tauglicher Punkt traegt einen Einzelfall-Marker',
    gemeinsamTauglich.every((i) => !/\b(schneidet|abgezogen|gefunden)\b/i.test(i.text)), true);
}

// ---------------------------------------------------------------------------
// 00000) Was der Bericht ueber ein Grundstueck BEHAUPTET, muss stimmen
//      Vier Befunde aus dem Export Zumikon 5030+5029+5028 vom 31.8.2026. Jeder
//      war eine Aussage, die das Dokument selbst an anderer Stelle bestreitet —
//      die teuerste Fehlerklasse hier, weil keine Zahl falsch war und der
//      Widerspruch trotzdem im Kundendokument stand.
// ---------------------------------------------------------------------------
{
  // (a) EIN Name je Grundstueck. Deckblatt und Trennseite lasen das
  //     Adressregister, die Innenseiten die eingetippte Adresse oder die
  //     nackte Nummer — dasselbe Grundstueck trug drei Namen. Gemischt wird
  //     nie: entweder eine Adresse, oder «Parzelle NNNN».
  const mitAdresse = {
    selection: [{ parcelNumber: '5028', adressen: { label: 'Haldenstrasse 5a, 8126 Zumikon' } }],
    anchor: { address: 'Haldenstrasse 5' },
  };
  check('Adressregister schlaegt die eingetippte Adresse',
    T.betreffVon(mitAdresse), 'Haldenstrasse 5a, 8126 Zumikon');
  check('Tabellenzeile nennt Adresse UND Parzelle',
    T.grundstueckLabel(mitAdresse), 'Haldenstrasse 5a, 8126 Zumikon · Parzelle 5028');

  const ohneAdresse = { selection: [{ parcelNumber: '5028' }], anchor: {} };
  check('ohne Registertreffer und ohne Eingabe: die Parzellennummer',
    T.betreffVon(ohneAdresse), 'Parzelle 5028');
  check('… und dann NICHT zusaetzlich «· Parzelle 5028» dahinter',
    T.grundstueckLabel(ohneAdresse), 'Parzelle 5028');

  const nurEingabe = { selection: [{ parcelNumber: '5030' }], anchor: { address: 'Haldenstrasse 5' } };
  check('die eingetippte Adresse traegt, wenn das Register nichts liefert',
    T.betreffVon(nurEingabe), 'Haldenstrasse 5');

  // (b) Eine Kantenlaenge kann nicht negativ sein. Ist der Attika-Ruecksprung
  //     tiefer als der halbe Baukoerper, war die Restbreite rechnerisch
  //     negativ und stand als «ergibt 14.3 × −1.8 m» im Kundendokument.
  const engerBau = {
    attikaSetbackM: 2.25,
    attikaDiagnostics: [{ belowLengthM: 18.8, belowWidthM: 2.7, narrowestM: -1.8, bergseite: false }],
  };
  const satz = T.attikaSuppressRechnung(engerBau);
  check('kein negatives Mass im Hinweistext', /[−-]\s?\d/.test(satz.replace(/\d+\.\d+ m/g, 'X m')), false);
  check('stattdessen die Aussage «keine Restfläche»', satz.includes('Es bleibt keine Restfläche'), true);
  check('… mit dem Mindestmass als Massstab',
    satz.includes(`mindestens ${T.MIN_PRIMITIVE_WIDTH_M} m`), true);

  const weiterBau = {
    attikaSetbackM: 2.3,
    attikaDiagnostics: [{ belowLengthM: 14.7, belowWidthM: 7.1, narrowestM: 2.5, bergseite: false }],
  };
  check('bei positivem Rest wird weiterhin gerechnet gezeigt',
    T.attikaSuppressRechnung(weiterBau).includes('ergibt'), true);

  // (c) 37 m² auf 2.7 m Tiefe sind ein Streifen, kein Baufeld. Als
  //     «Realistisches Szenario» ausgewiesen war das eine Zusage, die die
  //     Zahl nicht deckt. Schwelle ist MIN_PRIMITIVE_WIDTH_M — kein zweiter,
  //     eigens erfundener Grenzwert.
  const streifen = T.faktischNichtBebaubar({
    reconciled: { usableFootprintAreaM2: 36.7 }, footprintRect: { lengthM: 14.3, widthM: 2.7 },
  });
  check('Streifen unter der Mindestbreite: faktisch nicht bebaubar', streifen.ja, true);
  check('… und die Begruendung nennt die gemessene Tiefe', streifen.tiefeM, 2.7);

  const baufeld = T.faktischNichtBebaubar({
    reconciled: { usableFootprintAreaM2: 132 }, footprintRect: { lengthM: 18.6, widthM: 7.1 },
  });
  check('ein normales Baufeld bleibt unbeanstandet', baufeld.ja, false);

  const genauAufDerSchwelle = T.faktischNichtBebaubar({
    reconciled: { usableFootprintAreaM2: 50 },
    footprintRect: { lengthM: 14.3, widthM: T.MIN_PRIMITIVE_WIDTH_M },
  });
  check('genau auf der Schwelle gilt noch als bebaubar', genauAufDerSchwelle.ja, false);

  check('ohne bebaubare Flaeche wird nicht zusaetzlich etikettiert',
    T.faktischNichtBebaubar({ reconciled: { usableFootprintAreaM2: 0 }, footprintRect: null }).ja, false);

  // (d) Die Falle hinter der Variantenkarte: die GEWAEHLTE Variante ist
  //     zugleich die gesperrte, wenn ihre Attika am 45°-Profil scheitert.
  //     Wer `active` vor `suppressed` prueft, druckt «gerechnet &
  //     dargestellt» auf eine Variante, die nicht gebaut wird.
  const mm = {
    storeyOptions: [2, 3], ordinaryMax: 2, requestedStoreys: 3, storeys: 3,
    attikaSuppressed: true, ordinaryStoreyHeightM: 3.25, attikaStoreyHeightM: 3.25,
  };
  const varianten = T.storeyVariantData(mm, { maxGfaM2: 221.9, usableFootprintAreaM2: 36.7, parcelAreaM2: 919.8 });
  const gewaehlt = varianten.find((v) => v.active);
  check('die gewaehlte Variante kann zugleich gesperrt sein',
    !!(gewaehlt && gewaehlt.suppressed), true);
  check('… und traegt dann keine Attika-Hoehe', gewaehlt.heightM, 2 * 3.25);
}

// ---------------------------------------------------------------------------
// 0000) Ausgefallene Quelle wird BENANNT — js/core/netz.js
//      Anlass: eine Studie brach mit «Fehler: Load failed» ab. Das ist
//      Safaris Wortlaut fuer ein fetch(), das nie zustande kam, und er sagt
//      nicht, welcher der sieben Dienste ausgefallen ist. REGELN.md §2
//      verlangt, dass eine ausgefallene Datenquelle als solche sichtbar
//      bleibt — dazu muss sie erst einmal einen Namen tragen.
// ---------------------------------------------------------------------------
{
  const echtesFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('Load failed'); };
  let gefangen = null;
  try {
    await T.fetchQuelle('Waldabstand (ogd-0152)', 'https://maps.zh.ch/wfs/OGDZHWFS?x=1');
  } catch (e) { gefangen = e; }
  globalThis.fetch = echtesFetch;

  check('Netzfehler wird als Quellenausfall typisiert',
    gefangen && gefangen.name, 'QuelleNichtErreichbarError');
  check('die Meldung nennt die Quelle',
    !!(gefangen && gefangen.message.includes('Waldabstand (ogd-0152)')), true);
  check('die Meldung nennt den Host',
    !!(gefangen && gefangen.message.includes('maps.zh.ch')), true);
  check('die urspruengliche Meldung bleibt erhalten',
    !!(gefangen && gefangen.message.includes('Load failed')), true);
  check('Quelle und Host stehen auch strukturiert bereit',
    gefangen && gefangen.quelle + ' @ ' + gefangen.host,
    'Waldabstand (ogd-0152) @ maps.zh.ch');

  // file:// ist der haeufigste Fehlstart: Datei doppelgeklickt statt ueber
  // den Server geoeffnet. Safari meldet ihn wortgleich wie eine Netzstoerung
  // («Load failed»), er geht aber nie von selbst weg — die Meldung muss ihn
  // daher unterscheiden und den Startbefehl nennen statt «erneut versuchen».
  {
    const echteLoc = window.location;
    Object.defineProperty(window, 'location',
      { value: { protocol: 'file:', href: 'file:///X/index.html' }, configurable: true });
    globalThis.fetch = async () => { throw new TypeError('Load failed'); };
    let ausFile = null;
    try {
      await T.fetchQuelle('BZO Zumikon', 'data/bzo-zumikon.json');
    } catch (e) { ausFile = e; }
    globalThis.fetch = echtesFetch;
    Object.defineProperty(window, 'location', { value: echteLoc, configurable: true });

    check('file:// wird als eigener Fall erkannt', ausFile && ausFile.dauerhaft, true);
    check('… nennt file:// als Ursache',
      !!(ausFile && ausFile.message.includes('file://')), true);
    check('… nennt den Startbefehl',
      !!(ausFile && ausFile.message.includes('serve.py')), true);
    check('… raet NICHT zum erneuten Versuchen',
      !!(ausFile && /Erneut versuchen/.test(ausFile.message)), false);
    check('echte Netzstoerung bleibt nicht dauerhaft', gefangen && !!gefangen.dauerhaft, false);
  }

  // Ein gewollter Abbruch ist kein Quellenausfall und darf nicht als solcher
  // gemeldet werden — sonst meldet jeder Nutzerabbruch einen toten Dienst.
  globalThis.fetch = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
  let abbruch = null;
  try {
    await T.fetchQuelle('Adresssuche', 'https://api3.geo.admin.ch/x');
  } catch (e) { abbruch = e; }
  globalThis.fetch = echtesFetch;
  check('AbortError bleibt AbortError', abbruch && abbruch.name, 'AbortError');
}

// ---------------------------------------------------------------------------
// 000) § 259 aPBG — Waldabstandsfläche > 15 m hinter der Linie fällt ausser
//      Ansatz (js/sources/waldabstand.js, waldAusserAnsatz).
//      Referenzfall Zumikon 2999 (999_cookies/referenz-zumikon-2999-
//      ausnuetzung.md): die eingereichte Ausnützungsberechnung zieht 69.0 m²
//      Waldabstandsfläche von 3'259.0 m² ab und wendet die AZ auf 3'190.0 m²
//      an → 797.50 m². Ohne diesen Abzug rechnete das Werkzeug 2.1 % zu viel.
//      Toleranzen: bufferLV95 läuft über WGS84 (turf.buffer, sphärisch) und
//      weicht ~0.3 % vom exakten 15-m-Band ab — in Richtung MEHR Abzug, also
//      auf der sicheren Seite.
{
  const E = 2685000, N = 1245000; // gültige LV95-Koordinaten (Raum ZH)
  const sq = (x0, y0, x1, y1) => turf.polygon([[
    [E + x0, N + y0], [E + x1, N + y0], [E + x1, N + y1], [E + x0, N + y1], [E + x0, N + y0],
  ]]);
  // Linie bei x = 20, Waldseite links: forbidden = Parzellenteil x ∈ [0, 20].
  const line = turf.lineString([[E + 20, N - 50], [E + 20, N + 90]]);

  // Streifen weiter als 15 m hinter der Linie: x ∈ [0, 5] × 40 m = 200 m².
  let r = T.waldAusserAnsatz(sq(0, 0, 20, 40), line, null);
  check('§ 259: Fläche > 15 m hinter der Linie fällt ausser Ansatz (200 m²)', r.areaM2, 200, 2.5);
  check('§ 259: die Abzugsgeometrie wird mitgeliefert', !!r.feature, true);

  // Wald wird ausgenommen — er fällt separat ausser Ansatz (kein Doppelzählen).
  r = T.waldAusserAnsatz(sq(0, 0, 20, 40), line, sq(0, 0, 3, 40));
  check('§ 259: Wald im Streifen zählt nicht doppelt (200 − 120 = 80 m²)', r.areaM2, 80, 2.5);

  // Alles näher als 15 m an der Linie: kein Abzug — und ausdrücklich 0, nicht null.
  r = T.waldAusserAnsatz(sq(6, 0, 20, 40), line, null);
  check('§ 259: innerhalb 15 m hinter der Linie bleibt anrechenbar (0 m²)', r.areaM2, 0);

  // Keine Waldseite auf der Parzelle: bestimmt 0.
  r = T.waldAusserAnsatz(null, line, null);
  check('§ 259: ohne Waldseite ist der Abzug 0', r.areaM2, 0);

  // Referenz-Arithmetik (Kette wie in js/app.js analyse()):
  // anrechenbar = GF − ausserAnsatz; maxGFA = anrechenbar × AZ;
  // Freibetrag je befreitem Geschoss = maxGFA / Vollgeschosszahl (§ 255 Abs. 3).
  const anrechenbar = 3259.0 - 69.0;
  check('Referenz 2999: anrechenbare Grundfläche', anrechenbar, 3190.0);
  const maxGfa = anrechenbar * 0.25;
  check('Referenz 2999: max. Ausnützung (AZ 25 %)', maxGfa, 797.5);
  check('Referenz 2999: Freibetrag je Geschoss (§ 255 Abs. 3)', maxGfa / 2, 398.75);
}

// ---------------------------------------------------------------------------
// 00) Parkierung — js/core/parkierung.js
//     Die Platzzahl ist Rechtswert (Art. 26 BZO Zumikon), die Flaeche je
//     Platz eine Werkzeug-Annahme. Geprueft wird beides getrennt, dazu die
//     eigentliche Aussage des Moduls: ab wann die Garage und nicht die
//     Ausnuetzungsziffer das Volumen begrenzt.
{
  const zumikon = await T.getZoneRules({ zone: 'W2/25', gemeinde: 'Zumikon', kantonaleWerte: {} });

  // 600 m² GNF, 6 Wohnungen: Bewohner max(ceil(600/100), 6) = 6,
  // Besucher ceil(6/4) = 2, total 8.
  const a = T.computeParkierung({ rules: zumikon, gnfM2: 600, fussabdruckM2: 300, parzelleM2: 1000, wohnungen: 6 });
  check('Bewohnerplaetze 6 (Art. 26: je 100 m² GNF oder je Wohnung)', a.bewohnerP, 6);
  check('Besucherplaetze 2 (je 4 Wohnungen)', a.besucherP, 2);
  check('Pflichtplaetze total 8', a.totalP, 8);
  check('Wohnungszahl als Eingabe gilt, nicht hergeleitet', a.wohnungenHergeleitet, false);

  // Die "oder"-Lesart muss die STRENGERE nehmen: 12 kleine Wohnungen auf
  // 600 m² verlangen 12 Plaetze, nicht 6.
  const klein = T.computeParkierung({ rules: zumikon, gnfM2: 600, fussabdruckM2: 300, parzelleM2: 1000, wohnungen: 12 });
  check('viele kleine Wohnungen erhoehen die Platzzahl', klein.bewohnerP, 12);

  // Ohne Angabe wird die Wohnungszahl hergeleitet — und als Annahme markiert.
  const auto = T.computeParkierung({ rules: zumikon, gnfM2: 600, fussabdruckM2: 300, parzelleM2: 1000 });
  check('ohne Angabe hergeleitet', auto.wohnungenHergeleitet, true);
  check('Herleitung wird als Annahme ausgewiesen',
    auto.hinweise.some((h) => h.includes('Annahme')), true);

  // Der Kern von Issue #2: 300 m² Baukoerper fassen bei 28 m²/Platz
  // 10 Plaetze je Untergeschoss, das traegt 1000 m² GNF. Bei 600 m² GNF
  // bindet die Garage also nicht — bei 1600 m² schon.
  check('300 m² UG fassen 10 Plaetze', a.plaetzeJeUgGeschoss, 10);
  check('ein UG traegt 1000 m² Geschossflaeche', a.gnfAusEinemUgM2, 1000);
  check('bei 600 m² GNF bindet die Parkierung nicht', a.bindet, false);
  const eng = T.computeParkierung({ rules: zumikon, gnfM2: 1600, fussabdruckM2: 300, parzelleM2: 1000, wohnungen: 16 });
  check('bei 1600 m² GNF bindet die Parkierung', eng.bindet, true);
  check('zwei Untergeschosse noetig', eng.ugGeschosseNoetig, 2);
  // Der bindende Fall muss in Worten dastehen, nicht nur als Boolean --
  // seit dem Export-Aufraeumen in einem eigenen Feld: das Parkierungsblatt
  // sagt ihn schon als Verdict-Kachel, der Bildschirm setzt bindendHinweis
  // wieder vorne an die Hinweisliste (js/app.js, js/ui/print.js).
  check('der bindende Fall wird auch in Worten gesagt',
    (eng.bindendHinweis || '').startsWith('Bindend:'), true);
  check('und steht nicht zusaetzlich in hinweise',
    eng.hinweise.some((h) => h.startsWith('Bindend:')), false);
  check('der nicht bindende Fall hat keinen bindendHinweis', a.bindendHinweis, null);

  // Zuerich: die Vorschrift EXISTIERT, steht aber nicht im hinterlegten PDF.
  // Das ist NICHT dasselbe wie null ("gibt es hier nicht") und darf nie als
  // "keine Pflicht" durchgehen.
  const zuerich = await T.getZoneRules({ zone: 'W2bI', gemeinde: 'Zürich', kantonaleWerte: {} });
  const zh = T.computeParkierung({ rules: zuerich, gnfM2: 600, fussabdruckM2: 300, parzelleM2: 1000 });
  check('Zuerich: nicht erfasst statt geraten', zh.erfasst, false);
  check('Zuerich: Grund wird genannt', typeof zh.grund === 'string' && zh.grund.length > 40, true);
  check('Zuerich: keine erfundene Platzzahl', zh.totalP, undefined);

  // Eine halb erfasste Regel bricht ab, statt einen Default zu erfinden.
  let threw = false;
  try {
    T.computeParkierung({
      rules: { gemeinde: 'X', meta: { parkierung: { wohnen_bewohner_je_m2_gnf: 100 } } },
      gnfM2: 600, fussabdruckM2: 300, parzelleM2: 1000,
    });
  } catch (e) { threw = true; }
  check('unvollstaendige Parkierungsdaten brechen ab', threw, true);
}

// ---------------------------------------------------------------------------
// 0) Normhierarchie, Normkette und die Werkleitungs-Abgrenzung
//    Die Kette ist reine Ordnung ueber ein fertiges Ergebnis, kein zweiter
//    Rechenweg. Geprueft wird deshalb genau das: dass die Raenge des
//    Stufenbaus stimmen, dass die Anwendungsreihenfolge von REGELN.md 3
//    eingehalten ist, und dass ein Datenausfall nie als bestanden erscheint.
{
  const E = T.NORM_EBENEN;
  check('Stufenbau: Bund vor Kanton vor Gemeinde', E.bund.rang < E.kanton.rang && E.kanton.rang < E.gemeinde.rang, true);
  check('Privatrecht steht neben, nicht im oeffentlichen Stufenbau (Rang 4)', E.privat.rang, 4);
  const raenge = Object.values(E).map((e) => e.rang);
  check('jede Ebene hat einen eigenen Rang', new Set(raenge).size, raenge.length);

  const rules = await T.getZoneRules({ zone: 'W2/25', gemeinde: 'Zumikon', kantonaleWerte: {} });
  const reconciled = T.reconcileEnvelope({
    parcelAreaM2: 1000, anrechenbareFlaecheM2: 1000, flaechenAbzuege: null,
    setbackFootprintAreaM2: 400, rules,
  });
  // Minimales Ergebnisobjekt: nur die Felder, die die Kette liest. Ohne turf
  // laeuft buildNormkette textuell durch — genau dafuer ist withGeometry da.
  const fakeResult = {
    rules, reconciled, anchor: { zone: 'W2/25' }, selection: [{}],
    parcelAreaM2: 1000, anrechenbareFlaecheM2: 1000,
    flaechenAbzuege: { waldM2: 0 }, grundabstandUsedM: 5,
    hasDirectional: true, chosenIndices: [0, 1],
    wald: { applies: true, failed: true }, baulinien: { applies: false, failed: false },
    waldLossInFootprintM2: 0, baulinienLossM2: 0,
    lengthExceeded: false, massingModel: null,
  };
  const kette = T.buildNormkette(fakeResult, { withGeometry: false });
  const titel = kette.schritte.map((x) => x.titel);
  const pos = (t) => titel.findIndex((x) => x.startsWith(t));
  check('Kette beginnt beim Bundesrecht', kette.schritte[0].ebene, 'bund');
  check('Grundabstand vor Waldabstand', pos('Grundabstand') < pos('Waldabstand'), true);
  check('Waldabstand vor Baulinien', pos('Waldabstand') < pos('Baulinien'), true);
  check('Baulinien vor Ausnuetzungsziffer', pos('Baulinien') < pos('Ausnützungsziffer'), true);
  check('grosser Grenzabstand nur bei gerichteter Figur', pos('Grosser Grenzabstand') > 0, true);
  check('Privatrecht wird ausgewiesen, nicht gerechnet',
    kette.schritte.find((x) => x.ebene === 'privat').status, 'review');
  const waldStep = kette.schritte[pos('Waldabstand')];
  check('Ausfall des Wald-Dienstes ist review, nie ok', waldStep.status, 'review');
  check('Ausfall wird als "nicht pruefbar" beziffert', waldStep.wert, 'nicht prüfbar');
  check('jeder Schritt traegt eine bekannte Normebene',
    kette.schritte.every((x) => !!E[x.ebene]), true);
  check('Schrittnummern sind lueckenlos',
    kette.schritte.every((x, i) => x.nr === i + 1), true);

  // Ohne gerichtete Abstandsfigur faellt der Schritt weg statt mit 0 zu erscheinen.
  const ohne = T.buildNormkette({ ...fakeResult, hasDirectional: false }, { withGeometry: false });
  check('ohne grossen Grenzabstand fehlt der Schritt',
    ohne.schritte.some((x) => x.titel.startsWith('Grosser Grenzabstand')), false);

  // Werkleitungen: die Leitungs-BAULINIE ist gerechnet (§ 96 Abs. 2 lit. c
  // PBG), der Kataster und das Leitungsbaurecht sind es nicht. Der Eintrag
  // darf deshalb NIE 'pass' werden — auch dann nicht, wenn gar keine Baulinie
  // gefunden wurde, denn "keine Baulinie" heisst nicht "keine Leitung".
  const leer = { concerned: false };
  for (const [fall, baulinien] of [['ohne Baulinie', { applies: false }], ['mit Baulinie', { applies: true }]]) {
    const cl = await T.buildChecklist({
      parcelPolygon: null, rules: { meta: {} }, gemeinde: 'Zumikon', bfsNr: 160,
      restrictions: { waldabstand: leer, gewaesserraum: leer, baulinien: leer },
      wald: { applies: false }, waldLossInFootprintM2: 0, baulinien, baulinienLossM2: 0,
    });
    const wl = cl.tierB.find((x) => x.key === 'werkleitungen');
    check(`Werkleitungen erscheinen (${fall})`, !!wl, true);
    check(`Werkleitungen bleiben review (${fall})`, wl.status, 'review');
    check(`Werkleitungen nennen den Kataster als ungeprueft (${fall})`,
      wl.text.includes('Werkleitungskataster'), true);
    check(`Werkleitungen nennen die Rechtsgrundlage der Baulinie (${fall})`,
      wl.text.includes('§ 96 Abs. 2 lit. c PBG'), true);
  }
}

// ---------------------------------------------------------------------------
// 1) Zumikon W2/25 — Art. 17 BZO Zumikon + § 255 PBG
//    Parcel 1000 m², no deductions, buildable area after setbacks 400 m².
{
  const rules = await T.getZoneRules({ zone: 'W2/25', gemeinde: 'Zumikon', kantonaleWerte: {} });
  check('Zumikon heightM = Gebäudehöhe 6.5', rules.heightM, 6.5);
  check('Zumikon Firsthöhe als Zuschlag 4.5', rules.firsthoehe_zuschlag_m, 4.5);
  check('Zumikon W2/25 zwei Südseiten (Art. 18)', rules.grosser_grenzabstand_suedseiten, 2);

  const rec = T.reconcileEnvelope({
    parcelAreaM2: 1000, anrechenbareFlaecheM2: 1000, flaechenAbzuege: null,
    setbackFootprintAreaM2: 400, rules,
  });
  check('AZ 25% von 1000 = 250 m² GFA', rec.maxGfaM2, 250);
  check('bindend: Ausnützungsziffer', rec.bindingConstraint, 'ausnuetzungsziffer');
  check('erreichbare VG 0.625', rec.achievableFloors, 0.625);

  const mm = T.buildMassingModel({ footprintFeature: { fake: true }, reconciled: rec, rules });
  check('2 VG + 1 Attika', mm.storeys, 3);
  check('Vollgeschoss-Floorplate 125 m²', mm.floorplateM2, 125);
  check('§255 Abs.3 Freibetrag je Geschoss 125 m²', mm.perStoreyFreeM2, 125);
  check('Attika frei (125 m², nicht an AZ angerechnet)', mm.attikaFloorplateM2, 125);
  check('1 Untergeschoss mit 125 m²', mm.ugFloorplateM2, 125);
  check('2. Dachgeschoss-Kredit 125 m²', mm.extraDachCreditM2, 125);
  check('Nutzfläche total 500 m² (2×125 + Attika 125 + UG 125)', mm.nutzflaecheTotalM2, 500);
  check('AZ-Verbrauch bleibt 250 m² (Attika/UG frei)', mm.gfaUsedM2, 250);
  check('Attika-Geschosshöhe 3.25 m (min aus Zuschlag 4.5 und 3.25)', mm.attikaStoreyHeightM, 3.25);
  check('Volumen 1218.75 m³', mm.volumeM3, 1218.75);

  // Der Baukörper ist zu schmal für das 45°-Profil (Art. 31 BZO): die Attika
  // fällt weg — und mit ihr JEDE aus ihr abgeleitete Zahl. Sonst weist das
  // Panel 9.75 m Höhe und 500 m² Nutzfläche aus, während das Modell einen
  // 6.5-m-Kubus zeichnet (Parzelle 5029, Zumikon: 15.2 × 7.3 m Baukörper).
  const dropped = T.suppressAttikaStorey(T.buildMassingModel({ footprintFeature: { fake: true }, reconciled: rec, rules }));
  check('ohne darstellbare Attika: 2 Geschosse', dropped.storeys, 2);
  check('gewählte Geschosszahl bleibt bekannt', dropped.requestedStoreys, 3);
  check('Höhe fällt auf 6.5 m (2 × 3.25)', dropped.buildingHeightM, 6.5);
  check('Attika-Fläche 0 m²', dropped.attikaFloorplateM2, 0);
  check('Nutzfläche 375 m² (2×125 + UG 125, ohne Attika)', dropped.nutzflaecheTotalM2, 375);
  check('Volumen 812.5 m³ (2 × 125 × 3.25)', dropped.volumeM3, 812.5);
  check('AZ-Verbrauch unverändert 250 m²', dropped.gfaUsedM2, 250);
}

// ---------------------------------------------------------------------------
// 1b) Eine Zone mit grossem Grenzabstand MUSS sagen, für wie viele Seiten er
//     gilt (Art. 18 Abs. 1 BZO Zumikon: W2/25 zwei, W2/35-60 eine). Fehlt die
//     Angabe, wurde früher stillschweigend 1 angenommen — genau der Fehler,
//     der für W2/25 schon einmal behoben werden musste (REGELN.md §8).
{
  const rules = await T.getZoneRules({ zone: 'W2/25', gemeinde: 'Zumikon', kantonaleWerte: {} });
  check('Zumikon W2/25: Südseiten-Angabe vorhanden', rules.grosser_grenzabstand_suedseiten, 2);

  // Same lookup against a zone whose Südseiten-Angabe has been removed.
  const zumikon = await T.loadGemeindeData('Zumikon');
  const saved = zumikon['W2/25'].grosser_grenzabstand_suedseiten;
  delete zumikon['W2/25'].grosser_grenzabstand_suedseiten;
  let halted = false;
  try {
    await T.getZoneRules({ zone: 'W2/25', gemeinde: 'Zumikon', kantonaleWerte: {} });
  } catch (e) {
    halted = /grosser_grenzabstand_suedseiten/.test(e.message);
  }
  zumikon['W2/25'].grosser_grenzabstand_suedseiten = saved;
  check('fehlende Südseiten-Angabe bricht ab statt zu raten', halted, true);
}

// ---------------------------------------------------------------------------
// 2) Zürich W2bI — Art. 62 E-BZO / Art. 13+14 BZO 2016, § 234 PBG stricter-of
{
  const rules = await T.getZoneRules({ zone: 'W2bI', gemeinde: 'Zürich', kantonaleWerte: {} });
  check('Höhe = 9 m (Gebäudehöhe BZO 2016, strenger als 10 m Fassadenhöhe)', rules.heightM, 9);
  check('Höhen-Regime BZO 2016', rules.heightRegime, 'BZO 2016');
  check('Höhenmetrik Gebäudehöhe', rules.heightMetric, 'Gebäudehöhe');
  check('Mehrlängenzuschlag vorhanden (Art. 14 BZO 2016)', !!rules.mehrlaengenzuschlag, true);
  check('Mehrlängenzuschlag Deckel 10 m', rules.mehrlaengenzuschlag.grenzabstand_max_m, 10);

  const rec = T.reconcileEnvelope({
    parcelAreaM2: 1000, anrechenbareFlaecheM2: 1000, flaechenAbzuege: null,
    setbackFootprintAreaM2: 600, rules,
  });
  check('ÜZ-Deckel aktiv (§ 256 PBG)', rec.hasUeberbauungsCap, true);
  check('ÜZ 22% von 1000 = 220 m² Fussabdruck-Deckel', rec.footprintAfterUeberbauungsCapM2, 220);
  check('GFZ 60% ⇒ 400 m² Deckel', rec.footprintAfterGreenCapAreaM2, 400);
  check('nutzbarer Fussabdruck = 220 m² (ÜZ bindet auf Fussabdruck-Ebene)', rec.usableFootprintAreaM2, 220);
  check('AZ 40% ⇒ 400 m² GFA', rec.maxGfaM2, 400);
}

// ---------------------------------------------------------------------------
// 3) Anrechenbare Fläche: Wald reduziert die AZ-Basis (§ 259 aPBG)
{
  const rules = await T.getZoneRules({ zone: 'W2/25', gemeinde: 'Zumikon', kantonaleWerte: {} });
  const rec = T.reconcileEnvelope({
    parcelAreaM2: 1000, anrechenbareFlaecheM2: 800,
    flaechenAbzuege: { waldM2: 200 }, setbackFootprintAreaM2: 400, rules,
  });
  check('AZ-Basis 800 m² (1000 − 200 Wald)', rec.anrechenbareFlaecheM2, 800);
  check('maxGfa 200 m² (25% von 800)', rec.maxGfaM2, 200);
}

// ---------------------------------------------------------------------------
// 4) Monotonie: mehr Land ⇒ nie weniger Baurecht (Fehler-A-Invariante auf
//    Reconcile-Ebene; die App reicht seit dem Fix die UNGETEILTE Fläche durch)
{
  const rules = await T.getZoneRules({ zone: 'W2/25', gemeinde: 'Zumikon', kantonaleWerte: {} });
  const a = T.reconcileEnvelope({ parcelAreaM2: 1000, anrechenbareFlaecheM2: 1000, setbackFootprintAreaM2: 400, rules });
  const b = T.reconcileEnvelope({ parcelAreaM2: 1600, anrechenbareFlaecheM2: 1600, setbackFootprintAreaM2: 700, rules });
  check('GFA wächst mit der Fläche', b.maxGfaM2 > a.maxGfaM2, true);
  check('Fussabdruck wächst mit der Fläche', b.usableFootprintAreaM2 >= a.usableFootprintAreaM2, true);
}

// ---------------------------------------------------------------------------
// 5) Null-Semantik: Zumikons fehlende Grünflächenziffer darf weder 0% noch
//    100% werden (rules.js merge behaviour)
{
  const rules = await T.getZoneRules({
    zone: 'W2/25', gemeinde: 'Zumikon',
    kantonaleWerte: { gruenflaechenziffer_min_pct: 45 }, // kantonaler Wert, den die BZO nicht kennt
  });
  check('Grünflächenziffer bleibt null (BZO Zumikon kennt keine)', rules.gruenflaechenziffer_min_pct, null);
  const rec = T.reconcileEnvelope({ parcelAreaM2: 1000, anrechenbareFlaecheM2: 1000, setbackFootprintAreaM2: 400, rules });
  check('kein Grün-Deckel aktiv', rec.hasGreenCap, false);
}

// ---------------------------------------------------------------------------
// 6) Provenienz: jeder zentrale Parameter hat einen Beleg mit Seite und Zitat
{
  const zumikon = await T.getZoneRules({ zone: 'W2/25', gemeinde: 'Zumikon', kantonaleWerte: {} });
  const zuerich = await T.getZoneRules({ zone: 'W2bI', gemeinde: 'Zürich', kantonaleWerte: {} });
  for (const [rules, keys] of [
    [zumikon, ['parkierung', 'ausnuetzungsziffer_max_pct', 'grosser_grenzabstand_suedseiten', 'attika_profil_ueberhoehung_m', 'firsthoehe_zuschlag_m', 'strassenabstand_ohne_baulinien_m', 'dach_attika_ug_freibetrag']],
    [zuerich, ['ausnuetzungsziffer_max_pct', 'ueberbauungsziffer_hauptgebaeude_max_pct', 'mehrlaengenzuschlag', 'gebaeudehoehe_max_m_bzo2016', 'negative_vorwirkung']],
  ]) {
    for (const k of keys) {
      const p = T.getProvenance(rules, k);
      check(`Beleg für ${rules.gemeinde}/${k} vorhanden (Datei+Seite)`, !!(p && p.file && p.page), true);
    }
  }
}

// ---------------------------------------------------------------------------
// 7) Sicherheitsstufen — js/core/sicherheit.js
//    Die Skala beantwortet "wie belastbar", nicht "woher". Geprueft wird die
//    Kaskade in beide Richtungen: dass jeder benannte Fall die erwartete Stufe
//    ergibt UND dass ein unbenannter Fall wirft statt zu raten (CLAUDE.md §4).
{
  const S = (d) => T.stufeVon(d).stufe;

  // Ordnung und Vererbung
  check('Rangordnung belegt < vereinfacht', T.schwaechsteSicherheit('BELEGT', 'VEREINFACHT'), 'VEREINFACHT');
  check('Rangordnung vereinfacht < Annahme', T.schwaechsteSicherheit('VEREINFACHT', 'ANNAHME'), 'ANNAHME');
  check('Rangordnung Annahme < nicht ermittelbar', T.schwaechsteSicherheit('ANNAHME', 'NICHT_ERMITTELBAR'), 'NICHT_ERMITTELBAR');
  check('schwaechste ist reihenfolgeunabhaengig', T.schwaechsteSicherheit('NICHT_ERMITTELBAR', 'BELEGT'), 'NICHT_ERMITTELBAR');
  let threw = false;
  try { T.schwaechsteSicherheit('ERFUNDEN'); } catch (e) { threw = true; }
  check('unbekannte Stufe wirft', threw, true);

  // Die vier Faelle der Kaskade
  const beleg = { article: 'Art. 17, BZO Zumikon', file: 'source/bzo-zumikon-2019.pdf', page: 8 };
  check('Gesetzeszitat mit Datei+Seite ⇒ BELEGT',
    S({ wert: '5 m', kind: 'GEHOLT', prov: beleg, label: 'Grenzabstand' }), 'BELEGT');
  check('amtlicher Datensatz ohne Artikel ⇒ BELEGT',
    S({ wert: '1240 m²', kind: 'GEHOLT', prov: null, source: 'Amtliche Vermessung', label: 'Parzellenfläche' }), 'BELEGT');
  check('Belegtyp wird unterschieden',
    T.stufeVon({ wert: '5 m', kind: 'GEHOLT', prov: beleg, label: 'x' }).belegtyp, 'gesetzeszitat');
  check('Registrierte Vereinfachung ⇒ VEREINFACHT',
    S({ wert: '400 m²', kind: 'BERECHNET', prov: beleg, schluessel: 'grenzabstand_parzellenkante', label: 'Fussabdruck' }), 'VEREINFACHT');
  check('Zonenwert ohne zonenscharfes Zitat ⇒ VEREINFACHT',
    S({ wert: '5 m', kind: 'GEHOLT', prov: { article: 'Art. 17', synthetic: true }, label: 'x' }), 'VEREINFACHT');
  check('kind ANNAHME ⇒ ANNAHME',
    S({ wert: '28 m²', kind: 'ANNAHME', source: 'Werkzeug-Annahme', label: 'Tiefgarage' }), 'ANNAHME');
  check('Registrierte Werkzeug-Annahme ⇒ ANNAHME',
    S({ wert: '900', kind: 'BERECHNET', schluessel: 'kostenkennwert_chf_m3', label: 'Kosten' }), 'ANNAHME');
  check('Entwurfsentscheidung ⇒ ANNAHME',
    S({ wert: '2 Geschosse', kind: 'ENTWURF', source: 'Entwurf', label: 'Bebaubar als' }), 'ANNAHME');
  check('null ⇒ NICHT_ERMITTELBAR (nie 0)',
    S({ wert: null, kind: 'GEPRÜFT', label: 'Grünflächenziffer' }), 'NICHT_ERMITTELBAR');
  check('"— nicht anwendbar" ⇒ NICHT_ERMITTELBAR',
    S({ wert: '— nicht anwendbar', kind: 'GEPRÜFT', source: 'BZO Zumikon', label: 'GFZ-Deckel' }), 'NICHT_ERMITTELBAR');
  check('ausgefallene Quelle ⇒ NICHT_ERMITTELBAR',
    S({ wert: '712 m ü. M.', kind: 'GEHOLT', source: 'swissALTI3D', quelleAusgefallen: true, label: 'Terrain' }), 'NICHT_ERMITTELBAR');

  // Kein stiller Durchfall: ein Wert ohne Beleg, ohne Register und ohne
  // Rechenherkunft ist ein Datenfehler und muss auffallen.
  threw = false;
  try { S({ wert: '42', kind: 'GEHOLT', source: 'irgendwoher', label: 'Phantasiewert' }); } catch (e) { threw = true; }
  check('unbelegter GEHOLT-Wert wirft', threw, true);

  // Vererbung ueber eine Kette: die schwaechste Stufe gewinnt und wird
  // transitiv weitergereicht.
  const rows = [
    { id: 'a', label: 'Parzelle', sicherheit: 'BELEGT' },
    { id: 'b', label: 'anrechenbar', sicherheit: 'VEREINFACHT', dependsOn: ['a'] },
    { id: 'c', label: 'Geschossfläche', sicherheit: 'BELEGT', dependsOn: ['b'] },
    { id: 'd', label: 'Kosten', sicherheit: 'ANNAHME', dependsOn: ['c'] },
    { id: 'e', label: 'Ergebnis', sicherheit: 'BELEGT', dependsOn: ['d'] },
  ];
  T.vererbeSicherheit(rows);
  check('Vererbung: b bleibt vereinfacht', rows[1].sicherheit, 'VEREINFACHT');
  check('Vererbung: c erbt vereinfacht', rows[2].sicherheit, 'VEREINFACHT');
  check('Vererbung: c ist als geerbt markiert', rows[2].sicherheitVererbt, true);
  check('Vererbung: e erbt Annahme über zwei Stufen', rows[4].sicherheit, 'ANNAHME');
  check('Zählung stimmt mit den Zeilen überein', T.zaehleSicherheit(rows).VEREINFACHT, 2);

  threw = false;
  try { T.vererbeSicherheit([{ id: 'x', label: 'x', sicherheit: 'BELEGT', dependsOn: ['fehlt'] }]); } catch (e) { threw = true; }
  check('Abhängigkeit auf unbekannte id wirft', threw, true);
}

// ---------------------------------------------------------------------------
// 8) Fremde Gemeinde: Abbruch, aber benannt. Die Rechnung liefert weiterhin
//    KEINE Zahl (CLAUDE.md §2) — sie sagt nur praezise, was fehlt.
{
  let err = null;
  try {
    await T.getZoneRules({ zone: 'W2', gemeinde: 'Küsnacht', kantonaleWerte: {} });
  } catch (e) { err = e; }
  check('fremde Gemeinde bricht ab', err !== null, true);
  check('Fehlertyp ist benannt', err && err.name, 'GemeindeNichtHinterlegtError');
  check('nennt die Gemeinde', err && err.gemeinde, 'Küsnacht');
  check('listet kantonal Vorhandenes', !!(err && err.vorhandenAusKanton.length > 0), true);
  check('jeder kantonale Eintrag trägt einen Artikel',
    err ? err.vorhandenAusKanton.every((v) => !!v.artikel) : false, true);
  check('listet die fehlenden BZO-Werte', !!(err && err.erforderlichAusBzo.length >= 6), true);
  check('jeder fehlende Wert sagt, wofür er gebraucht wird',
    err ? err.erforderlichAusBzo.every((v) => !!v.wofuer && !!v.label) : false, true);
  check('nennt, was beizubringen ist', !!(err && err.beizubringen.length === 3), true);
  check('nennt die erfassten Gemeinden', err ? err.erfassteGemeinden.join(',') : '', 'Zürich,Zumikon');
}

// ---------------------------------------------------------------------------
// 9) Die Kennwerte-Tafel als Ganzes, am Referenzfall Zumikon W2/25.
//    Ohne Browser: buildKennwerte ist reine Logik ueber das Ergebnisobjekt.
//    Geprueft wird, dass JEDE Zeile eine gueltige Stufe bekommt (sonst wirft
//    stufeVon), dass die Vererbung durch die Kette laeuft und dass die
//    Zaehlung der Tafel entspricht — die Zahl in der Kopfzeile kann damit
//    nicht von den Abzeichen darunter abweichen.
{
  const rules = await T.getZoneRules({ zone: 'W2/25', gemeinde: 'Zumikon', kantonaleWerte: {} });
  const anrechenbar = 3190;
  const reconciled = T.reconcileEnvelope({
    parcelAreaM2: 3259, anrechenbareFlaecheM2: anrechenbar,
    setbackFootprintAreaM2: 900, rules,
  });
  const r = {
    anchor: { address: 'Haldenstrasse 5, 8126 Zumikon', parcelNumber: '2999', zone: 'W2/25', zoneSource: { rechtsstatus: 'inKraft' } },
    rules, rulesData: null, reconciled, selection: [{ parcelNumber: '2999', egrid: 'CH796077735733' }],
    terrainHeight: 717.6,
    parcelAreaM2: 3259, anrechenbareFlaecheM2: anrechenbar,
    flaechenAbzuege: { waldM2: 69 },
    footprintBeforeWaldM2: 960, footprintAfterWaldM2: 900,
    waldLossInFootprintM2: 60, baulinienLossM2: 0,
    grundabstandUsedM: 5, hasDirectional: true, lengthLimitM: 35,
    footprintRect: { lengthM: 30, widthM: 20 },
    massingModel: {
      ordinaryStoreys: 2, ordinaryMax: 2, attikaStoreys: 1, ugStoreys: 1, maxStoreys: 3,
      floorplateM2: 398, attikaFloorplateM2: 200, ugFloorplateM2: 300,
      gfaUsedM2: 797, perStoreyFreeM2: 398, extraDachCreditM2: 0,
      nutzflaecheTotalM2: 1296, buildingHeightM: 6.5, ordinaryStoreyHeightM: 3.25,
      attikaStoreyHeightM: 3.25, attikaHeightIsModelled: false,
      volumeM3: 2587, hullVolumeM3: 5850,
    },
    hang: null, mehrlaengen: null, grenzabstandDegraded: null, massing: null,
  };
  const groups = T.buildKennwerte(r, {
    provFor: (rl, ...keys) => { for (const k of keys) { const p = T.getProvenance(rl, k); if (p) return p; } return null; },
    storeyCountLabel: (o, a) => `${o} Vollgeschosse${a ? ` + ${a} Attika` : ''}`,
    compassLabel: () => 'N',
  });
  const alle = groups.flatMap((g) => g.rows);
  check('Tafel gebaut (4 Gruppen)', groups.length, 4);
  check('jede Zeile traegt eine gueltige Stufe',
    alle.every((rw) => !!T.SICHERHEIT_STUFEN[rw.sicherheit]), true);
  check('jede Zeile traegt eine Begruendung',
    alle.every((rw) => typeof rw.sicherheitGrund === 'string' && rw.sicherheitGrund.length > 0), true);

  const byLabel = (l) => alle.find((rw) => rw.label === l);
  // Der Kern der Sache, an vier Zeilen: die vier Stufen kommen wirklich vor.
  check('Zone ist belegt', byLabel('Zone').sicherheit, 'BELEGT');
  check('Ausnützungsziffer-Zeile erbt die Vereinfachung der Bezugsfläche',
    byLabel('Max. anrechenbare Geschossfläche').sicherheit, 'VEREINFACHT');
  check('… und ist als geerbt markiert',
    byLabel('Max. anrechenbare Geschossfläche').sicherheitVererbt, true);
  check('anrechenbare Fläche ist vereinfacht (nur Wald abgezogen)',
    byLabel('Anrechenbare Grundstücksfläche').sicherheit, 'VEREINFACHT');
  check('Grünflächenziffer Zumikon ⇒ nicht ermittelbar (nie 0)',
    byLabel('Grünflächenziffer-Deckel').sicherheit, 'NICHT_ERMITTELBAR');
  check('Attikahöhe ohne Höhenzuschlag ⇒ Annahme',
    byLabel('Attikahöhe').sicherheit, 'ANNAHME');
  check('Geschosszahl ist Entwurf ⇒ Annahme', byLabel('Bebaubar als').sicherheit, 'ANNAHME');

  // Jede belegte Zeile muss ihren Beleg auch tragen koennen.
  const belegt = alle.filter((rw) => rw.sicherheit === 'BELEGT');
  check('jede belegte Zeile nennt ihren Belegtyp',
    belegt.every((rw) => ['gesetzeszitat', 'amtliche_daten', 'abgeleitet'].includes(rw.belegtyp)), true);
  check('jede per Gesetzeszitat belegte Zeile hat Datei und Seite',
    belegt.filter((rw) => rw.belegtyp === 'gesetzeszitat')
      .every((rw) => !!(rw.prov && rw.prov.file && rw.prov.page != null)), true);

  const z = T.zaehleSicherheit(alle);
  check('Zählung deckt alle Zeilen ab',
    z.BELEGT + z.VEREINFACHT + z.ANNAHME + z.NICHT_ERMITTELBAR, alle.length);
  console.log(`     → ${alle.length} Werte: ${z.BELEGT} belegt · ${z.VEREINFACHT} vereinfacht · ${z.ANNAHME} Annahme · ${z.NICHT_ERMITTELBAR} nicht ermittelbar`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAlle Tests bestanden.');
process.exit(failures ? 1 : 0);
