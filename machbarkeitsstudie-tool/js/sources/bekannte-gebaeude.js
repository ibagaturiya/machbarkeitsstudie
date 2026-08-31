// bekannte-gebaeude.js — Plausibilitätsprüfung gegen den Bestand.
//
// Ist auf einer Parzelle ein bestehendes oder bewilligtes Gebäude bekannt
// (data/bekannte-gebaeude.json, mit Beleg je Eintrag), prüft dieses Modul,
// ob dessen Rechteckmass in den BERECHNETEN bebaubaren Bereich passt.
// Passt es nicht, muss die Auswertung das als Warnung sagen statt still
// weiterzurechnen: ein Ergebnis, das einer erteilten Bewilligung
// widerspricht, ist entweder falsch — oder es beschreibt einen anderen
// Rechtszustand als die Bewilligung (z.B. getrennte Rechnung ohne die
// Näherbaurechte/Übertragungen, auf denen die Bewilligung beruht). Beides
// gehört auf den Schirm (REGELN.md §13.3).
//
// Die Prüfung ändert KEINE Zahl der Auswertung. Sie ist eine Passprobe:
// findet ein Rechteck von laenge_m × breite_m irgendwo im bebaubaren
// Bereich Platz? Gesucht wird über findCuboidPlacement in einem
// Winkelraster (Werkzeug-Annahme, Register §5) — ein «passt nicht» heisst
// deshalb «im Raster keine Lage gefunden», nicht «bewiesen unmöglich».
window.MachbarkeitTool = window.MachbarkeitTool || {};

(function () {
  const T = window.MachbarkeitTool;

  // Winkelraster der Passprobe: die Hauptachsen des bebaubaren Bereichs
  // plus ein 10°-Raster über den Halbkreis. Werkzeug-Annahme — fein genug,
  // dass ein real bewilligtes Gebäude nicht an der Winkelwahl scheitert,
  // grob genug, dass die Probe im Analyse-Lauf nicht spürbar kostet.
  const WINKELRASTER_DEG = 10;

  let geladen = null;   // die geparste Datendatei, sobald da
  let ladePromise = null;

  function ladeBekannteGebaeude() {
    if (!ladePromise) {
      ladePromise = T.fetchQuelle('Bekannte Gebäude (lokale Datendatei)', 'data/bekannte-gebaeude.json')
        .then((res) => {
          if (!res.ok) throw new Error(`data/bekannte-gebaeude.json: HTTP ${res.status}`);
          return res.json();
        })
        .then((d) => { geladen = d; return d; });
      ladePromise.catch(() => { ladePromise = null; });
    }
    return ladePromise;
  }

  // Passt ein Rechteck laenge × breite (beliebige Lage) in die Fläche?
  // Reines Ja/Nein über das Winkelraster; die Extent-Vorprüfung in
  // findCuboidPlacement macht die aussichtslosen Winkel billig.
  function rechteckPasstIn(area, laengeM, breiteM) {
    if (!area) return false;
    const mar = T.minAreaRectangleLV95(area);
    if (!mar) return false;
    const winkel = [mar.ang, mar.ang + Math.PI / 2];
    for (let g = 0; g < 180; g += WINKELRASTER_DEG) winkel.push((g * Math.PI) / 180);
    for (const ang of winkel) {
      if (T.findCuboidPlacement(area, ang, laengeM, breiteM)) return true;
    }
    return false;
  }

  // Synchrone Prüfung über ein Analyse-Ergebnis. Geprüft wird gegen den
  // UNGETEILTEN bebaubaren Bereich nach allen Abzügen (r.buildableArea) —
  // die Längenteilung ist Darstellung, nicht Rechtslage. Vor dem ersten
  // erfolgreichen ladeBekannteGebaeude() ist das Ergebnis «nicht geprüft»,
  // nie ein stilles Bestehen.
  function pruefeBestandsGebaeude(r) {
    if (!geladen) {
      return { geprueft: false, grund: 'data/bekannte-gebaeude.json nicht geladen', eintraege: [] };
    }
    const nummern = new Set(r.selection.map((p) => String(p.parcelNumber)));
    const treffer = (geladen.gebaeude || []).filter(
      (g) => g.gemeinde === r.rules.gemeinde && nummern.has(String(g.parzelle)));
    const eintraege = treffer.map((g) => {
      if (!Number.isFinite(g.laenge_m) || !Number.isFinite(g.breite_m)
          || g.laenge_m <= 0 || g.breite_m <= 0) {
        // Unbrauchbare Masse sind ein Datenfehler und erscheinen als
        // solcher — nicht als bestandene und nicht als gescheiterte Probe.
        return { ...g, passt: null, fehler: 'Masse in data/bekannte-gebaeude.json unbrauchbar (nicht endlich oder ≤ 0)' };
      }
      return { ...g, passt: rechteckPasstIn(r.buildableArea, g.laenge_m, g.breite_m) };
    });
    return { geprueft: true, eintraege, winkelrasterDeg: WINKELRASTER_DEG };
  }

  T.ladeBekannteGebaeude = ladeBekannteGebaeude;
  T.pruefeBestandsGebaeude = pruefeBestandsGebaeude;
  T.rechteckPasstIn = rechteckPasstIn;
})();
