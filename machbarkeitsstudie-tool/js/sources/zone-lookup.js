// zone-lookup.js — LV95 point -> Gemeinde + zone + the canton's own numbers.
//
// Uses the CANTONAL zoning dataset (ogd-0156, "Nutzungsplanung Grundnutzung"),
// not the Stadt-Zürich BZO WFS. Two reasons:
//   1. It covers every commune in Kanton Zürich. The Stadt Zürich layer only
//      covers the city, so anything outside it failed outright ("No BZO zone
//      polygon contains point ...") -- that's what broke for Zumikon.
//   2. It carries the numeric Grundmasse as attributes (Ausnützungsziffer,
//      Vollgeschosse, Dach-/Untergeschosse, Gebäudehöhe, Firsthöhe), so those
//      don't have to be transcribed per commune by hand.
//
// What it does NOT carry: Grenzabstand and Grünflächenziffer. Those live in
// each commune's own BZO text and come from the per-commune files in /data
// via rules.js. A commune without such a file can't be computed -- rules.js
// raises a clear error rather than guessing a setback.
window.MachbarkeitTool = window.MachbarkeitTool || {};

(function () {
  // Netzabrufe laufen ueber T.fetchQuelle (js/core/netz.js): faellt eine
  // Quelle aus, nennt der Fehler sie beim Namen statt «Load failed».
  const T = window.MachbarkeitTool;
  const WFS_BASE = 'https://maps.zh.ch/wfs/OGDZHWFS';
  const TYPENAME = 'ogd-0156_arv_basis_np_gn_zonenflaeche_f';
  const BBOX_HALFWIDTH_M = 30;

  async function lookupZone(easting, northing) {
    const d = BBOX_HALFWIDTH_M;
    const params = new URLSearchParams({
      SERVICE: 'WFS', VERSION: '1.1.0', REQUEST: 'GetFeature',
      TYPENAME, SRSNAME: 'EPSG:2056',
      BBOX: `${easting - d},${northing - d},${easting + d},${northing + d},EPSG:2056`,
      outputFormat: 'application/json',
    });
    const res = await T.fetchQuelle('Kantonale Nutzungsplanung', `${WFS_BASE}?${params}`);
    if (!res.ok) throw new Error(`Kantonale Nutzungsplanung: HTTP ${res.status}`);
    const fc = await res.json();

    const point = turf.point([easting, northing]);
    let feature = (fc.features || []).find((f) => turf.booleanPointInPolygon(point, f));
    let edgeUncertain = false;
    // Fallback: point landed exactly on a shared edge/vertex where the
    // in-polygon test can miss on floating point. One candidate from the
    // bbox is overwhelmingly likely to be the right one -- use it, but say so.
    if (!feature && (fc.features || []).length === 1) {
      feature = fc.features[0];
      edgeUncertain = true;
    }
    if (!feature) {
      throw new Error(
        `Keine Nutzungszone gefunden für Punkt ${easting}, ${northing}. ` +
        `Liegt die Parzelle ausserhalb des Kantons Zürich oder ausserhalb der Bauzone?`
      );
    }

    const p = feature.properties;
    return {
      gemeinde: p.typ_gemeindename,
      bfsNr: p.typ_bfsnr,
      zone: p.typ_gde_abkuerzung,      // e.g. "W3" (Zürich), "W2/25" (Zumikon)
      zoneLabel: p.typ_gde_bezeichnung, // e.g. "dreigeschossige Wohnzone"
      zoneDescription: p.typ_gde_beschreibung,
      // The canton's own numbers. rules.js may override these per commune
      // (Zürich uses the E-BZO draft, which is newer than this dataset).
      kantonaleWerte: {
        ausnuetzungsziffer_max_pct: p.ausnuetzungsziffer_max,
        vollgeschosse_max: p.vollgeschosse_max,
        anrechenbares_dach_attika_max: p.dachgeschosse_max,
        anrechenbares_untergeschoss_max: p.untergeschosse_max,
        gebaeudehoehe_max_m: p.gebaeudehoehe_max,
        // Old-law semantics (§ 281 aPBG): the BZO Firsthöhe is the ADDITIONAL
        // ridge height above the Gebäudehöhe line, not an absolute height —
        // same key the commune files use.
        firsthoehe_zuschlag_m: p.firsthoehe_max,
      },
      zoneSource: {
        rechtsstatus: p.rechtsstatus,
        rechtsvorschriftUrl: p.dokument || '',
        genehmigungsdatum: p.genehmigungsdatum,
        edgeUncertain,
      },
    };
  }

  window.MachbarkeitTool.lookupZone = lookupZone;
})();
