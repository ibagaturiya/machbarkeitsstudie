// Golden regression tests for the legal arithmetic — run with:
//   node tests/run-tests.mjs
// No browser needed: envelope.js and rules.js are pure logic over
// window.MachbarkeitTool; fetch is stubbed to read the local data files.
// Every expected value below is hand-derived from the cited article, so a
// failing test means the code (or the data) no longer matches the law as
// last verified — not merely that "something changed".
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

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

for (const f of ['js/envelope.js', 'js/rules.js']) {
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
    [zumikon, ['ausnuetzungsziffer_max_pct', 'grosser_grenzabstand_suedseiten', 'attika_profil_ueberhoehung_m', 'firsthoehe_zuschlag_m', 'strassenabstand_ohne_baulinien_m', 'dach_attika_ug_freibetrag']],
    [zuerich, ['ausnuetzungsziffer_max_pct', 'ueberbauungsziffer_hauptgebaeude_max_pct', 'mehrlaengenzuschlag', 'gebaeudehoehe_max_m_bzo2016', 'negative_vorwirkung']],
  ]) {
    for (const k of keys) {
      const p = T.getProvenance(rules, k);
      check(`Beleg für ${rules.gemeinde}/${k} vorhanden (Datei+Seite)`, !!(p && p.file && p.page), true);
    }
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAlle Tests bestanden.');
process.exit(failures ? 1 : 0);
