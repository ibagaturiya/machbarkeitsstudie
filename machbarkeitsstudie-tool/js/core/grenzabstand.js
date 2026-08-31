// grenzabstand.js — the directional Grenzabstand some communes have (Zumikon
// Art. 18 BZO: a small Grenzabstand on most sides, a larger one specifically
// on the Hauptfassade -- in practice the side most oriented south).
//
// Two things live here: picking which parcel boundary edge is the suggested
// Hauptfassade, and applying a differential (not uniform) inward offset that
// respects it -- the plain uniform buffer used everywhere else can't express
// "5 m here, 10 m there" on one polygon.
window.MachbarkeitTool = window.MachbarkeitTool || {};

(function () {
  const T = window.MachbarkeitTool;

  const safeOp = T.safeOp; // js/core/coordinates.js

  const exteriorRingsOf = T.exteriorRingsOf; // js/core/coordinates.js

  // ---- Gebäuderechteck-Verfahren (Art. 18 Abs. 2 BZO Zumikon) ------------
  // Massgebend für den grossen Grenzabstand sind die Seiten des GEBÄUDES,
  // bestimmt am flächenkleinsten Rechteck, das es umfasst — nicht die
  // Parzellenkanten. Welche Seiten das sind, hängt aber davon ab, wo und wie
  // das Gebäude steht, und das hängt wieder vom verfügbaren Bereich ab.
  // Deshalb iterativ (Fixpunkt):
  //
  //   1. Bereich mit dem kleinen Abstand ringsum bilden (bufferLV95 −smallM).
  //   2. Darin das grösstmögliche Gebäuderechteck platzieren
  //      (findBestRectangle — dieselbe Suche, die auch den Baukörper setzt).
  //   3. Dessen `suedCount` am meisten gegen Süden gerichtete Seiten
  //      bestimmen und den Bereich neu bilden: kleiner Abstand ringsum,
  //      geschnitten mit der gerichteten Erosion der PARZELLE um bigM je
  //      Südrichtung (erodeDirectionalLV95 — rechtwinklig zur Fassade,
  //      § 22 ABV; der kleine Abstand schlägt radial um die Ecken,
  //      § 22 Abs. 2 ABV, das leistet der Ring aus Schritt 1).
  //   4. Wiederholen, bis die Südrichtungen stabil sind (max. MAX_ITER).
  //
  // Rückgabe { feature, converged, iterations, suedSeiten } bei Erfolg,
  // sonst { failed: <Grund> } — der Aufrufer fällt dann auf die
  // Parzellenkanten-Näherung zurück und SAGT es (kein stiller Wechsel des
  // Verfahrens; REGELN.md §13). Ein leeres Ergebnis nach dem 10-m-Ansatz
  // gilt als nicht konvergiert: eine andere Gebäudestellung könnte mehr
  // übrig lassen, und das Verfahren kann sie nicht mehr prüfen.
  const MAX_ITER = 6;
  // Zwei Südrichtungen gelten als gleich, wenn sie sich um höchstens so viel
  // unterscheiden (Werkzeug-Annahme; verhindert Endlositeration über
  // Rundungsrauschen der Rechtecksuche).
  const BEARING_TOL_DEG = 1;

  // Die vier Seiten eines Rechteck-Features mit Länge und Aussennormale
  // (Kompass-Peilung wie überall hier: 0° = Nord, 90° = Ost).
  function rectSides(rectFeature) {
    const ring = rectFeature.geometry.coordinates[0];
    const sides = [];
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i], b = ring[i + 1];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < 1e-6) continue;
      let nx = -(b[1] - a[1]) / length, ny = (b[0] - a[0]) / length;
      const probe = turf.point([(a[0] + b[0]) / 2 + nx * 0.05, (a[1] + b[1]) / 2 + ny * 0.05]);
      if (turf.booleanPointInPolygon(probe, rectFeature)) { nx = -nx; ny = -ny; }
      let bearingDeg = Math.atan2(nx, ny) * 180 / Math.PI;
      if (bearingDeg < 0) bearingDeg += 360;
      sides.push({ a, b, length, bearingDeg, nx, ny });
    }
    return sides;
  }

  // Rangfolge wie pickSouthFacade: Winkelabstand zu Süden (180°), bei
  // nahezu Gleichstand die längere Seite (deckt «die längere, am stärksten
  // gegen Süden gerichtete Gebäudeseite» der Zonen W2/35–W2/60 ab).
  // preferBearingDeg (optional): die vom Nutzer im Grundriss gewählte
  // Hauptfassaden-Richtung — die Rechteckseite, deren Normale ihr am
  // nächsten liegt, wird als erste Südseite gesetzt statt der automatischen.
  function pickSuedSeiten(sides, count, preferBearingDeg) {
    const angDiff = (x, y) => { const d = Math.abs(x - y) % 360; return Math.min(d, 360 - d); };
    const score = (s) => angDiff(s.bearingDeg, 180) - s.length * 0.01;
    const ranked = [...sides].sort((a, b) => score(a) - score(b));
    if (preferBearingDeg == null) return ranked.slice(0, Math.max(1, count));
    const primary = [...sides].sort((a, b) =>
      angDiff(a.bearingDeg, preferBearingDeg) - angDiff(b.bearingDeg, preferBearingDeg))[0];
    const picked = [primary];
    for (const s of ranked) {
      if (picked.length >= Math.max(1, count)) break;
      if (!picked.includes(s)) picked.push(s);
    }
    return picked;
  }

  function gebaeudeSeitenSetback(parcelFeature, smallM, bigM, suedCount, preferBearingDeg = null) {
    const base = T.bufferLV95(parcelFeature, -smallM);
    // Schon der kleine Abstand lässt nichts übrig — bestimmtes, leeres
    // Ergebnis, kein Fehlerfall.
    if (!base) return { feature: null, converged: true, iterations: 0, suedSeiten: [] };
    let feasible = base;
    let prev = null;
    let picked = null;
    for (let it = 0; it < MAX_ITER; it++) {
      // Seitenquelle: das grösste platzierbare Rechteck. Ist der Bereich
      // dafür zu schmal (unter MIN_PRIMITIVE_WIDTH_M), ersatzweise das
      // flächenkleinste UMSCHLIESSENDE Rechteck — für einen schmalen
      // Streifen fällt beides praktisch zusammen.
      const mar = T.minAreaRectangleLV95(feasible);
      if (!mar) return { failed: 'kein umschliessendes Rechteck bestimmbar' };
      const best = T.findBestRectangle(feasible, T.planarAreaAnyLV95(feasible), mar.ang, mar.lengthM, mar.widthM);
      const seitenQuelle = best ? best.rect : turf.polygon([mar.corners]);
      picked = pickSuedSeiten(rectSides(seitenQuelle), suedCount, preferBearingDeg);
      if (!picked.length) return { failed: 'keine Gebäudeseite bestimmbar' };
      const bearings = picked.map((s) => s.bearingDeg).sort((a, b) => a - b);
      if (prev && bearings.length === prev.length
          && bearings.every((b, i) => { const d = Math.abs(b - prev[i]) % 360; return Math.min(d, 360 - d) <= BEARING_TOL_DEG; })) {
        return { feature: feasible, converged: true, iterations: it + 1, suedSeiten: picked };
      }
      prev = bearings;
      let f = base;
      for (const s of picked) {
        const eroded = T.erodeDirectionalLV95(parcelFeature, s.nx, s.ny, bigM);
        if (eroded === undefined) return { failed: 'gerichtete Erosion geometrisch gescheitert' };
        if (!eroded) { f = null; break; }
        f = safeOp(() => turf.intersect(f, eroded), undefined);
        if (f === undefined) return { failed: 'Verschnitt der Abstandsflächen gescheitert' };
        if (!f) break;
      }
      if (!f) return { failed: 'der grosse Grenzabstand lässt in den bestimmten Südrichtungen nichts übrig — Gebäudestellung nicht mehr prüfbar' };
      feasible = f;
    }
    return { failed: `Südseiten nach ${MAX_ITER} Iterationen nicht stabil` };
  }

  // Every boundary edge of the parcel, at least MIN_EDGE_M long (shorter is a
  // corner notch, not a facade), with its outward-facing compass bearing.
  // Bearing 180 deg = due south, which is what the BZO's "am stärksten nach
  // Süden ausgerichtet" language keys off.
  const MIN_EDGE_M = 3;

  function facadeEdgesOf(parcelFeature) {
    const rings = exteriorRingsOf(parcelFeature);
    const edges = [];
    rings.forEach((ring) => {
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i], b = ring[i + 1];
        const length = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (length < MIN_EDGE_M) continue;
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        const dx = b[0] - a[0], dy = b[1] - a[1];
        let nx = -dy / length, ny = dx / length;
        // Outward = the side NOT inside the parcel.
        const probe = turf.point([mx + nx * 0.5, my + ny * 0.5]);
        if (turf.booleanPointInPolygon(probe, parcelFeature)) { nx = -nx; ny = -ny; }
        // Compass bearing of the outward normal: 0=N (+northing), 90=E
        // (+easting), matching how the flag text already talks about "gegen
        // Süden".
        let bearingDeg = Math.atan2(nx, ny) * 180 / Math.PI;
        if (bearingDeg < 0) bearingDeg += 360;
        edges.push({ a, b, length, bearingDeg });
      }
    });
    return edges;
  }

  // Ranks the edges by how close their outward normal is to due south (180°).
  // Ties (rare, e.g. a square lot) go to the longer edge. suggestedIndex is
  // the single best edge; suggestedIndices are the `count` best-ranked ones —
  // Art. 18 BZO Zumikon needs TWO for W2/25 ("die beiden am meisten gegen
  // Süden gerichteten Gebäudeseiten"), one for the other zones.
  function pickSouthFacade(parcelFeature, count = 1) {
    const edges = facadeEdgesOf(parcelFeature);
    if (!edges.length) return { edges, suggestedIndex: null, suggestedIndices: [] };
    const score = (e) => {
      const diff = Math.abs(e.bearingDeg - 180);
      const angularDiff = Math.min(diff, 360 - diff);
      return angularDiff - e.length * 0.01; // slight bias to the longer of near-ties
    };
    const ranked = edges.map((e, i) => [score(e), i]).sort((a, b) => a[0] - b[0]);
    const suggestedIndices = ranked.slice(0, Math.max(1, count)).map(([, i]) => i);
    return { edges, suggestedIndex: suggestedIndices[0], suggestedIndices };
  }

  // The differential offset. Baseline is the ordinary uniform buffer at
  // smallM (same as every other commune gets); the chosen edge additionally
  // loses a band reaching bigM in from the ORIGINAL parcel edge (not from the
  // already-inset baseline boundary -- buffering the edge itself by bigM and
  // intersecting with the baseline naturally yields exactly the smallM..bigM
  // strip that needs to come off, without double-subtracting the smallM
  // already removed everywhere).
  //
  // This is confined to the chosen edge's own span (rounded at its ends,
  // since bufferLV95 on a LineString produces a stadium shape) -- a
  // simplification the tool's own flag already names as such, not a full
  // per-edge variable offset around the whole polygon.
  //
  // Returns the same { feature, failedEdges } shape as the multi-edge version
  // it delegates to — a caller that ignores failedEdges is reading a footprint
  // that may be too large.
  function anisotropicSetback(parcelFeature, edge, smallM, bigM) {
    return anisotropicSetbackMulti(parcelFeature, edge ? [edge] : [], smallM, bigM);
  }

  // The bigM strip along one edge, with FLAT ends: a quad spanning exactly
  // the edge's own extent, offset inward by bigM. NOT a line buffer — a
  // buffer's stadium shape puts bigM-radius arcs around the edge ENDPOINTS,
  // carving circular bites out of the parcel beyond the facade's span. That
  // is stricter than the law: § 22 Abs. 2 ABV ("Bestehen gemäss Bau- und
  // Zonenordnung zwei verschieden grosse Grundabstände, so ist der kleinere
  // über die Gebäudeecken radial herumzuschlagen") wraps the SMALLER
  // distance around the corners — beyond the Hauptfassade only the small
  // Grundabstand applies. The rounded band also produced crescent-shaped
  // buildable areas no rectangular building could fill (parcel 5029).
  function edgeBandInward(parcelFeature, edge, bigM) {
    const [ax, ay] = edge.a, [bx, by] = edge.b;
    const len = Math.hypot(bx - ax, by - ay);
    if (!len) return null;
    let nx = -(by - ay) / len, ny = (bx - ax) / len;
    // Point the normal INTO the parcel.
    const probe = turf.point([(ax + bx) / 2 + nx * 0.5, (ay + by) / 2 + ny * 0.5]);
    if (!turf.booleanPointInPolygon(probe, parcelFeature)) { nx = -nx; ny = -ny; }
    return turf.polygon([[
      [ax, ay], [bx, by],
      [bx + nx * bigM, by + ny * bigM],
      [ax + nx * bigM, ay + ny * bigM],
      [ax, ay],
    ]]);
  }

  // Same differential offset for SEVERAL Hauptfassaden at once (Art. 18 BZO
  // Zumikon: W2/25 puts the grosse Grenzabstand on the TWO most south-facing
  // sides). Each edge loses its own bigM band; the bands may overlap at a
  // shared corner, which difference() handles naturally.
  //
  // Returns { feature, failedEdges } — NOT a bare feature. Every step here can
  // fail on degenerate geometry, and each failure used to be swallowed: a
  // thrown intersect() or difference() simply skipped that Hauptfassade, so
  // the 10 m band was never cut and the buildable area came out TOO LARGE,
  // silently. That is the one direction a Machbarkeitsstudie must never fail
  // in. The count is reported so the caller can fall back to something
  // conservative and say so (CLAUDE.md §4; REGELN.md §2 — ein Ausfall wird nie
  // als grünes PASS dargestellt).
  function anisotropicSetbackMulti(parcelFeature, edges, smallM, bigM) {
    let base = T.bufferLV95(parcelFeature, -smallM);
    let failedEdges = 0;
    if (!base || !edges || !edges.length || bigM == null || bigM <= smallM) {
      return { feature: base, failedEdges: 0 };
    }
    for (const edge of edges) {
      if (!edge) continue;
      // Explicit try/catch rather than safeOp: the two outcomes have to be
      // told apart. A THROW means this facade's band was never cut and the
      // area is too large — count it. A difference() that returns null is not
      // a failure: the band covers everything that was left, so nothing
      // remains buildable, which is a legitimate (and correct) result.
      let band, bandInside;
      try {
        band = edgeBandInward(parcelFeature, edge, bigM);
        bandInside = band ? turf.intersect(band, parcelFeature) : null;
      } catch (e) {
        failedEdges++;
        continue;
      }
      if (!band || !bandInside) { failedEdges++; continue; }

      let cut;
      try {
        cut = turf.difference(base, bandInside);
      } catch (e) {
        failedEdges++;
        continue;
      }
      base = cut;
      if (!base) return { feature: null, failedEdges };
    }
    return { feature: base, failedEdges };
  }

  T.gebaeudeSeitenSetback = gebaeudeSeitenSetback;
  T.pickSouthFacade = pickSouthFacade;
  T.anisotropicSetback = anisotropicSetback;
  T.anisotropicSetbackMulti = anisotropicSetbackMulti;
})();
