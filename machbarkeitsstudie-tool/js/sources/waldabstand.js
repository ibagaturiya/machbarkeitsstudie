// waldabstand.js — actually computes the forest-setback restriction and
// subtracts it from the buildable footprint, instead of only flagging it.
//
// The legal rule (§262 PBG): a building may not cross the Waldabstandslinie
// fixed in the Zonenplan. So the ground truth is a LINE, and the question is
// which side of it you may build on. The line dataset alone can't answer
// that -- so this module also pulls the forest area itself and decides the
// side geometrically: a piece of the parcel is off-limits if you can walk
// from it to the forest WITHOUT crossing the Waldabstandslinie.
//
// Data (both canton-wide, so this works outside the city too):
//   ogd-0152  Waldabstandslinie          (LineString) -- the legal limit
//   ogd-0111  Waldareal                  (Polygon)    -- the forest itself
//
// Everything here is planar LV95 maths. turf's own distance helpers assume
// WGS84 and silently return nonsense on LV95 input, so nearest-point is
// implemented directly below. Purely topological turf calls (difference,
// booleanIntersects, union) are safe in LV95 and are used as-is.
window.MachbarkeitTool = window.MachbarkeitTool || {};

(function () {
  const T = window.MachbarkeitTool;

  // Die Waldabstandslinien mehrerer Auswertungen fuer EINE Zeichnung: im
  // getrennten Modus holt jede Parzelle die Linien ihres eigenen Umkreises,
  // und dieselbe festgesetzte Linie kommt mehrfach zurueck. Fuer die
  // Darstellung (durchgehende Linie ueber alle Parzellen) wird je objid nur
  // ein Feature behalten — reine Deduplizierung, keine Geometrieaenderung.
  function sammleWaldLinien(results) {
    const seen = new Set();
    const out = [];
    for (const r of (results || [])) {
      for (const f of ((r && r.wald && r.wald.lines) || [])) {
        if (!f || !f.geometry) continue;
        const key = (f.properties && f.properties.objid) || JSON.stringify(coordsOf(f)[0] || f.geometry.coordinates);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(f);
      }
    }
    return out.length ? out : null;
  }

  // § 259 aPBG (Anhang bisheriges Recht): "Ausser Ansatz fallen
  // Waldabstandsflächen, soweit sie mehr als 15 m hinter der
  // Waldabstandslinie liegen, Wald und offene Gewässer." Rechtswert aus dem
  // zitierten Wortlaut (Beleg: data/kantonale-abstandsvorschriften.json,
  // massgebliche_grundflaeche_altrecht, S. 97) — kein Werkzeugwert.
  const AUSSER_ANSATZ_HINTER_LINIE_M = 15;

  // Pure Geometrie fuer den § 259-Flaechenabzug: der Teil der bereits
  // bestimmten Waldseite der Parzelle (forbidden = Parzelle ∩ Waldseite der
  // Linie inkl. Wald), der mehr als 15 m hinter der Linie liegt. Der Wald
  // selbst wird ausgenommen: er faellt ohnehin ausser Ansatz und wird in
  // js/app.js separat abgezogen (flaechenAbzuege.waldM2) — sonst zaehlte er
  // doppelt. Rueckgabe { feature, areaM2 }; areaM2 ist null, wenn die
  // Geometrie nicht bestimmbar war — nie stillschweigend 0 (CLAUDE.md §2).
  //
  // Referenzfall Zumikon 2999 (999_cookies/referenz-zumikon-2999-
  // ausnuetzung.md): die eingereichte Ausnuetzungsberechnung zieht genau
  // diese Flaeche (dort 69.0 m²) von der Grundstuecksflaeche ab, bevor die
  // AZ angewendet wird. Ohne den Abzug lag das Werkzeug 2.1 % zu hoch.
  function waldAusserAnsatz(forbidden, lineFeature, forestUnion) {
    if (!forbidden) return { feature: null, areaM2: 0 };
    const nearBand = T.bufferLV95(lineFeature, AUSSER_ANSATZ_HINTER_LINIE_M);
    if (!nearBand) return { feature: null, areaM2: null };
    // undefined = Operation gescheitert; null = leeres Ergebnis (zulaessig).
    let far = safeOp(() => turf.difference(forbidden, nearBand), undefined);
    if (far === undefined) return { feature: null, areaM2: null };
    if (far && forestUnion) {
      const noForest = safeOp(() => turf.difference(far, forestUnion), undefined);
      if (noForest === undefined) return { feature: null, areaM2: null };
      far = noForest;
    }
    const areaM2 = far ? T.planarAreaAnyLV95(far) : 0;
    return areaM2 > 0.5 ? { feature: far, areaM2 } : { feature: null, areaM2: 0 };
  }

  const WFS = 'https://maps.zh.ch/wfs/OGDZHWFS';
  const LAYER_ABSTANDSLINIE = 'ogd-0152_arv_basis_abstandslinie_wald_l';
  const LAYER_WALDAREAL = 'ogd-0111_giszhpub_wald_waldareal_f';
  const LAYER_BAULINIE = 'ogd-0158_arv_basis_abstandslinie_baulinie_l';
  // The line must be fetched well beyond the parcel: it only separates
  // reliably if it spans past both sides of the parcel. The forest needs an
  // even wider window -- it can sit some way back from its own setback line.
  const LINE_MARGIN_M = 250;
  const FOREST_MARGIN_M = 400;
  // Width of the sliver used to cut the parcel along the line. Big enough
  // that turf's difference reliably separates the two sides, small enough to
  // be irrelevant to the area result (~0.15 m along one edge).
  const CUT_WIDTH_M = 0.15;
  // The working area cut by the line has to extend past the parcel, or a line
  // that clips a corner won't separate anything.
  const WORK_MARGIN_M = 60;

  async function fetchLayer(typeName, bbox) {
    const [minE, minN, maxE, maxN] = bbox;
    const params = new URLSearchParams({
      SERVICE: 'WFS', VERSION: '1.1.0', REQUEST: 'GetFeature',
      TYPENAME: typeName, SRSNAME: 'EPSG:2056',
      BBOX: `${minE},${minN},${maxE},${maxN},EPSG:2056`,
      outputFormat: 'application/json',
    });
    const res = await T.fetchQuelle(`Waldabstand (${typeName})`, `${WFS}?${params}`);
    if (!res.ok) throw new Error(`${typeName}: HTTP ${res.status}`);
    const fc = await res.json();
    return fc.features || [];
  }

  function bboxAround(feature, marginM) {
    const pts = coordsOf(feature);
    const es = pts.map((p) => p[0]);
    const ns = pts.map((p) => p[1]);
    return [Math.min(...es) - marginM, Math.min(...ns) - marginM,
            Math.max(...es) + marginM, Math.max(...ns) + marginM];
  }

  function coordsOf(feature) {
    const g = feature.geometry;
    if (g.type === 'Polygon') return g.coordinates.flat(1);
    if (g.type === 'MultiPolygon') return g.coordinates.flat(2);
    if (g.type === 'LineString') return g.coordinates;
    if (g.type === 'MultiLineString') return g.coordinates.flat(1);
    return [];
  }

  function polygonParts(feature) {
    if (!feature) return [];
    return feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  }

  const safeOp = T.safeOp; // js/core/coordinates.js

  function unionAll(features) {
    return features.reduce((acc, f) => (acc ? safeOp(() => turf.union(acc, f), acc) : f), null);
  }

  // Which side of the Waldabstandslinie a point lies on, plus that line's
  // own "wirksamkeit" attribute. The dataset records which side each line
  // acts on ('links' / 'rechts', relative to the direction the line is
  // digitised in), so the restricted side is simply the side whose name
  // matches -- no inference from the forest position required.
  //
  // Verified 2026-08-22 against the Zumikon case, where the answer is known
  // independently: the strip nearest the forest came out 'rechts' on a line
  // whose wirksamkeit is 'rechts', and the buildable remainder came out
  // 'links'.
  //
  // This replaced a forest-proximity test, which broke whenever a parcel
  // contained a patch of forest itself: everything then looked like "the
  // forest side" and whole parcels were wrongly reported as unbuildable.
  function sideOfLine(point, lineFeatures) {
    let best = null;
    let bestDist = Infinity;
    for (const f of lineFeatures) {
      const segLists = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const coords of segLists) {
        for (let i = 0; i < coords.length - 1; i++) {
          const a = coords[i], b = coords[i + 1];
          const dx = b[0] - a[0], dy = b[1] - a[1];
          const lenSq = dx * dx + dy * dy;
          let t = lenSq ? ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lenSq : 0;
          t = Math.max(0, Math.min(1, t));
          const d = Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy));
          if (d < bestDist) { bestDist = d; best = { a, b, wirksamkeit: f.properties.wirksamkeit }; }
        }
      }
    }
    if (!best) return null;
    const cross = (best.b[0] - best.a[0]) * (point[1] - best.a[1])
                - (best.b[1] - best.a[1]) * (point[0] - best.a[0]);
    return { side: cross > 0 ? 'links' : 'rechts', wirksamkeit: best.wirksamkeit, distance: bestDist };
  }

  // Nearest point on a set of rings, in planar LV95. Used to close a line's
  // open end onto the forest edge.
  function nearestPointOnRings(point, rings) {
    let best = null;
    let bestDist = Infinity;
    for (const ring of rings) {
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i], b = ring[i + 1];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const lenSq = dx * dx + dy * dy;
        let t = lenSq ? ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lenSq : 0;
        t = Math.max(0, Math.min(1, t));
        const q = [a[0] + t * dx, a[1] + t * dy];
        const d = Math.hypot(point[0] - q[0], point[1] - q[1]);
        if (d < bestDist) { bestDist = d; best = q; }
      }
    }
    return best;
  }

  function representativePoint(polyCoords) {
    const feat = turf.polygon(polyCoords);
    const p = safeOp(() => turf.pointOnFeature(feat), null);
    if (p && safeOp(() => turf.booleanPointInPolygon(p, feat), false)) return p.geometry.coordinates;
    return turf.centroid(feat).geometry.coordinates;
  }

  // Generic engine: given restriction lines that each declare which side they
  // act on (`wirksamkeit`), return the part of the parcel that is off-limits.
  // `closingRings` are boundaries that help close a strip whose line stops
  // short (the forest edge, for Waldabstand). `alwaysForbidden` is folded in
  // regardless of sides (the forest itself).
  function restrictionFromLines(parcelFeature, lineFeatures, closingRings, alwaysForbidden) {
    const lineCoords = lineFeatures.map((f) =>
      f.geometry.type === 'LineString' ? f.geometry.coordinates : f.geometry.coordinates.flat(1)
    );
    const [minE, minN, maxE, maxN] = bboxAround(parcelFeature, WORK_MARGIN_M);
    const work = turf.polygon([[[minE, minN], [maxE, minN], [maxE, maxN], [minE, maxN], [minE, minN]]]);
    const insideWork = (p) => p[0] > minE && p[0] < maxE && p[1] > minN && p[1] < maxN;

    const closers = [];
    if (closingRings && closingRings.length) {
      for (const coords of lineCoords) {
        for (const end of [coords[0], coords[coords.length - 1]]) {
          if (!insideWork(end)) continue;
          const nearest = nearestPointOnRings(end, closingRings);
          if (nearest) closers.push([end, nearest]);
        }
      }
    }

    const cutter = T.bufferLV95(
      turf.multiLineString([...lineCoords, ...(closingRings || []), ...closers]), CUT_WIDTH_M
    );
    const pieces = cutter ? safeOp(() => turf.difference(work, cutter), work) : work;
    const components = polygonParts(pieces);
    if (components.length < 2) return { undetermined: true, restricted: null };

    const restrictedParts = [];
    let sideUndetermined = false;
    for (const polyCoords of components) {
      const info = sideOfLine(representativePoint(polyCoords), lineFeatures);
      const wirk = info && info.wirksamkeit;
      if (!info || (wirk !== 'links' && wirk !== 'rechts')) { sideUndetermined = true; continue; }
      if (info.side === wirk) restrictedParts.push(polyCoords);
    }

    let restricted = unionAll(restrictedParts.map((c) => turf.polygon(c)));
    if (alwaysForbidden) {
      restricted = restricted ? safeOp(() => turf.union(restricted, alwaysForbidden), restricted) : alwaysForbidden;
    }
    return { restricted, sideUndetermined };
  }

  // Baulinien (ogd-0158) work exactly like the Waldabstandslinie: a line plus
  // a `wirksamkeit` naming the side that may not be built on. They are
  // therefore computed and subtracted too, not merely flagged.
  async function computeBaulinien(parcelFeature) {
    const lines = await fetchLayer(LAYER_BAULINIE, bboxAround(parcelFeature, LINE_MARGIN_M));
    if (lines.length === 0) {
      return { applies: false, forbidden: null, lostAreaM2: 0, reason: 'keine Baulinie in der Umgebung' };
    }
    const { restricted, sideUndetermined, undetermined } = restrictionFromLines(parcelFeature, lines, null, null);
    if (undetermined || !restricted) {
      return { applies: true, undetermined: !!undetermined, forbidden: null, lostAreaM2: 0, lines,
               reason: 'Baulinie vorhanden, Seite nicht eindeutig bestimmbar' };
    }
    const forbidden = safeOp(() => turf.intersect(parcelFeature, restricted), null);
    const lostAreaM2 = forbidden ? T.planarAreaAnyLV95(forbidden) : 0;
    if (!forbidden || lostAreaM2 < 1) {
      return { applies: true, forbidden: null, lostAreaM2: 0, lines,
               reason: 'Baulinie in der Nähe, schneidet die Parzelle aber nicht' };
    }
    return { applies: true, forbidden, lostAreaM2, sideUndetermined, lines,
             types: [...new Set(lines.map((f) => f.properties.typ_txt).filter(Boolean))] };
  }

  // parcelFeature: turf Polygon/MultiPolygon in LV95 (the parcel, or the
  // union of merged parcels). Returns the part of it that is off-limits.
  async function computeWaldabstand(parcelFeature) {
    const [lineFeatures, forestFeatures] = await Promise.all([
      fetchLayer(LAYER_ABSTANDSLINIE, bboxAround(parcelFeature, LINE_MARGIN_M)),
      fetchLayer(LAYER_WALDAREAL, bboxAround(parcelFeature, FOREST_MARGIN_M)),
    ]);

    if (lineFeatures.length === 0) {
      // Keine Linie: nichts liegt "hinter" einer Linie — Abzug bestimmt 0.
      return { applies: false, reason: 'keine Waldabstandslinie in der Umgebung', forbidden: null, lostAreaM2: 0, ausserAnsatzM2: 0 };
    }
    if (forestFeatures.length === 0) {
      // Line but no forest polygon nearby: the side test has no reference, so
      // say so rather than guessing a side.
      return {
        applies: true, undetermined: true, forbidden: null, lostAreaM2: 0, ausserAnsatzM2: null,
        reason: 'Waldabstandslinie vorhanden, aber kein Waldareal in der Umgebung gefunden — Seite nicht bestimmbar',
        lines: lineFeatures,
      };
    }

    const lineCoords = lineFeatures.map((f) =>
      f.geometry.type === 'LineString' ? f.geometry.coordinates : f.geometry.coordinates.flat(1)
    );
    const lineFeature = turf.multiLineString(lineCoords);
    const forestUnion = unionAll(forestFeatures);

    // Cut a working area (larger than the parcel) into regions, then decide
    // each region's side from the line's own `wirksamkeit`.
    //
    // The cut uses three things, and all three are needed:
    //   1. the Waldabstandslinien themselves;
    //   2. the forest outlines -- the restricted strip is bounded by the line
    //      on one side and the forest on the other, so without the forest edge
    //      the strip is not a closed region;
    //   3. "closing" segments from any line END that falls inside the working
    //      area to the nearest point on the forest edge.
    //
    // (3) is what makes this reliable. A Waldabstandslinie generally stops
    // somewhere -- the fetched stretch ends, or the plan simply ends it -- and
    // where it does, the two sides remain connected around its tip. The whole
    // area then becomes one region, one representative point decides it, and
    // the answer is wrong: the same parcel returned 195 m² alone but 0 m² when
    // merged with two neighbours, because the bigger working area reached past
    // the line's end. Closing the tip to the forest edge restores a genuine
    // two-sided partition.
    const [minE, minN, maxE, maxN] = bboxAround(parcelFeature, WORK_MARGIN_M);
    const work = turf.polygon([[[minE, minN], [maxE, minN], [maxE, maxN], [minE, maxN], [minE, minN]]]);
    const insideWork = (p) => p[0] > minE && p[0] < maxE && p[1] > minN && p[1] < maxN;

    const forestRings = forestFeatures.flatMap((f) => polygonParts(f)).flatMap((poly) => poly);
    const closers = [];
    for (const coords of lineCoords) {
      for (const end of [coords[0], coords[coords.length - 1]]) {
        if (!insideWork(end)) continue;
        const nearest = nearestPointOnRings(end, forestRings);
        if (nearest) closers.push([end, nearest]);
      }
    }

    const cutter = T.bufferLV95(
      turf.multiLineString([...lineCoords, ...forestRings, ...closers]), CUT_WIDTH_M
    );
    const pieces = cutter ? safeOp(() => turf.difference(work, cutter), work) : work;
    const components = polygonParts(pieces);
    const forestOnlyInParcel = forestUnion
      ? safeOp(() => turf.intersect(parcelFeature, forestUnion), null)
      : null;

    if (components.length < 2) {
      const lost = forestOnlyInParcel ? T.planarAreaAnyLV95(forestOnlyInParcel) : 0;
      return {
        applies: true,
        undetermined: true,
        forbidden: lost > 1 ? forestOnlyInParcel : null,
        lostAreaM2: lost > 1 ? lost : 0,
        // Ohne Seitenaufloesung ist auch der 15-m-Streifen unbestimmt.
        ausserAnsatzM2: null,
        reason: 'Die Waldabstandslinie liess sich nicht in zwei Seiten auflösen; abgezogen wurde nur die tatsächliche Waldfläche',
        lines: lineFeatures,
        forest: forestFeatures,
      };
    }

    const forestSideParts = [];
    const openParts = [];
    let sideUndetermined = false;
    for (const polyCoords of components) {
      const info = sideOfLine(representativePoint(polyCoords), lineFeatures);
      const wirk = info && info.wirksamkeit;
      if (!info || (wirk !== 'links' && wirk !== 'rechts')) {
        // Unexpected or missing wirksamkeit (e.g. 'beidseitig'): don't guess.
        sideUndetermined = true;
        openParts.push(polyCoords);
        continue;
      }
      (info.side === wirk ? forestSideParts : openParts).push(polyCoords);
    }

    // The forest itself is off-limits regardless of which side of any line it
    // sits on, so fold it into the restricted region.
    let restricted = unionAll(forestSideParts.map((c) => turf.polygon(c)));
    if (forestUnion) restricted = restricted ? safeOp(() => turf.union(restricted, forestUnion), restricted) : forestUnion;

    const forbidden = restricted ? safeOp(() => turf.intersect(parcelFeature, restricted), null) : null;
    const lostAreaM2 = forbidden ? T.planarAreaAnyLV95(forbidden) : 0;
    const parcelAreaM2 = T.planarAreaAnyLV95(parcelFeature);

    if (!forbidden || lostAreaM2 < 1) {
      // Kein Parzellenteil auf der Waldseite → auch nichts > 15 m dahinter.
      return { applies: true, forbidden: null, lostAreaM2: 0, ausserAnsatzM2: 0,
               reason: 'Waldabstandslinie in der Nähe, schneidet die Parzelle aber nicht',
               lines: lineFeatures, forest: forestFeatures };
    }

    // § 259-Abzug von der massgeblichen Grundflaeche (nicht vom
    // Fussabdruck): Waldabstandsflaeche > 15 m hinter der Linie, ohne Wald.
    const ausserAnsatz = waldAusserAnsatz(forbidden, lineFeature, forestUnion);
    return {
      applies: true,
      forbidden,
      lostAreaM2,
      ausserAnsatzM2: ausserAnsatz.areaM2,
      ausserAnsatzFeature: ausserAnsatz.feature,
      fullyBlocked: lostAreaM2 > parcelAreaM2 - 1,
      sideUndetermined,
      lines: lineFeatures,
      forest: forestFeatures,
      lineSource: lineFeatures[0].properties,
    };
  }

  T.sammleWaldLinien = sammleWaldLinien;
  T.waldAusserAnsatz = waldAusserAnsatz;
  T.computeWaldabstand = computeWaldabstand;
  T.computeBaulinien = computeBaulinien;
})();
