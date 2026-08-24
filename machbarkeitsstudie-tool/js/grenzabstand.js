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

  function safeOp(fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
  }

  function exteriorRingsOf(feature) {
    return feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates[0]]
      : feature.geometry.coordinates.map((poly) => poly[0]);
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

  // Suggests the edge whose outward normal is closest to due south (180°).
  // Ties (rare, e.g. a square lot) go to the longer edge.
  function pickSouthFacade(parcelFeature) {
    const edges = facadeEdgesOf(parcelFeature);
    if (!edges.length) return { edges, suggestedIndex: null };
    let best = 0, bestScore = Infinity;
    edges.forEach((e, i) => {
      const diff = Math.abs(e.bearingDeg - 180);
      const angularDiff = Math.min(diff, 360 - diff);
      const score = angularDiff - e.length * 0.01; // slight bias to the longer of near-ties
      if (score < bestScore) { bestScore = score; best = i; }
    });
    return { edges, suggestedIndex: best };
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
  function anisotropicSetback(parcelFeature, edge, smallM, bigM) {
    const base = T.bufferLV95(parcelFeature, -smallM);
    if (!base || !edge || bigM == null || bigM <= smallM) return base;
    const edgeLine = turf.lineString([edge.a, edge.b]);
    const band = T.bufferLV95(edgeLine, bigM);
    if (!band) return base;
    const bandInside = safeOp(() => turf.intersect(band, parcelFeature), null);
    if (!bandInside) return base;
    return safeOp(() => turf.difference(base, bandInside), base) || base;
  }

  T.pickSouthFacade = pickSouthFacade;
  T.anisotropicSetback = anisotropicSetback;
})();
