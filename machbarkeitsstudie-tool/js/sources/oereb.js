// oereb.js — official ÖREB-Kataster extract (Kanton ZH), by EGRID.
//
// Not in the build plan's original file list -- added to resolve step 7
// (section 3) properly. The plan assumed Waldabstand/Gewässerraum/Baulinien
// could just be subtracted from the footprint as ready-made polygon layers.
// Verified 2026-08-21 this isn't true: the city's WFS layers for these are
// LINES with no side/direction attribute, and the ÖREB extract itself
// carries only legal citations + a rendered map image per restriction, not
// vector geometry. Decided with the user: use the ÖREB extract as the
// authoritative per-parcel "does this restriction even apply" gate. When a
// restriction is NOT concerned (the common case for ordinary urban infill
// parcels -- confirmed against the test address), skip it, footprint
// unaffected. When it IS concerned, do NOT attempt automatic polygon
// subtraction -- flag it for manual review instead of guessing which side
// of a line is buildable. This is a conservative under-restriction, not an
// over-restriction: the reported footprint could be too generous in the
// flagged case, never too small.
window.MachbarkeitTool = window.MachbarkeitTool || {};

(function () {
  // Netzabrufe laufen ueber T.fetchQuelle (js/core/netz.js): faellt eine
  // Quelle aus, nennt der Fehler sie beim Namen statt «Load failed».
  const T = window.MachbarkeitTool;
  const OEREB_BASE = 'https://maps.zh.ch/oereb/v2/extract/json';

  // Verified against two real extracts 2026-08-21: an unaffected parcel
  // (Imbisbühlstrasse 57) and a forest-edge parcel that IS concerned.
  // "...proj" variants are the draft/projected version of the same theme,
  // following the same current/proj split seen in the BZO zoning WFS layers.
  const THEME_CODES = {
    waldabstand: ['ch.Waldabstandslinien', 'ch.Waldabstandslinienproj'],
    gewaesserraum: ['ch.Gewaesserraum', 'ch.Gewaesserabstandslinien'],
    baulinien: [
      'ch.ZH.Baulinien',
      'ch.BaulinienNationalstrassen',
      'ch.BaulinienEisenbahnanlagen',
      'ch.BaulinienFlughafenanlagen',
      'ch.BaulinienStarkstromanlagen',
    ],
  };

  async function fetchOerebExtract(egrid) {
    const res = await T.fetchQuelle('ÖREB-Kataster', `${OEREB_BASE}?EGRID=${encodeURIComponent(egrid)}`);
    if (!res.ok) throw new Error(`ÖREB webservice HTTP ${res.status} for EGRID ${egrid}`);
    const data = await res.json();
    if (!data.GetExtractByIdResponse) {
      throw new Error(`Unexpected ÖREB response shape for EGRID ${egrid}`);
    }
    return data.GetExtractByIdResponse.Extract;
  }

  // A theme code that upstream renamed would silently degrade to "not
  // concerned" — a false all-clear. So each theme also reports `unknown`:
  // true when NONE of its known codes appear in the extract's concerned OR
  // not-concerned theme lists, i.e. the extract no longer speaks the
  // vocabulary this tool expects for that theme.
  function themeStatus(extract, codes) {
    const concernedCodes = new Set((extract.ConcernedTheme || []).map((t) => t.code));
    const allCodes = new Set([
      ...concernedCodes,
      ...((extract.NotConcernedTheme || []).map((t) => t.code)),
      ...((extract.ThemeWithoutData || []).map((t) => t.code)),
    ]);
    const known = codes.some((c) => allCodes.has(c));
    return {
      concerned: codes.some((c) => concernedCodes.has(c)),
      unknown: !known && allCodes.size > 0,
    };
  }

  function checkFootprintRestrictions(extract) {
    return {
      waldabstand: themeStatus(extract, THEME_CODES.waldabstand),
      gewaesserraum: themeStatus(extract, THEME_CODES.gewaesserraum),
      baulinien: themeStatus(extract, THEME_CODES.baulinien),
    };
  }

  window.MachbarkeitTool.fetchOerebExtract = fetchOerebExtract;
  window.MachbarkeitTool.checkFootprintRestrictions = checkFootprintRestrictions;
})();
