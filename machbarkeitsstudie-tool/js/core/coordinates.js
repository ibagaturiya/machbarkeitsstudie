// coordinates.js — LV95 (EPSG:2056) <-> WGS84 conversion, and LV95-safe geometry helpers.
//
// Not in the build plan's original file list (section 1) -- added because the
// plan didn't anticipate a real problem: turf.js functions that do metric
// math (buffer, area, distance) assume WGS84 lon/lat input. All our parcel
// and zoning geometry comes back in LV95 (planar meters, EPSG:2056). Feeding
// LV95 coordinates straight into turf.buffer() does NOT error -- it silently
// reinterprets meters as degrees and returns nonsense (verified 2026-08-21:
// a real ~35m Zürich parcel buffered to a "polygon" near Antarctica).
//
// Purely topological turf ops (booleanPointInPolygon, intersect, difference,
// union, booleanIntersects) are fine directly in LV95 -- they don't care
// what the coordinate units mean, only their relative positions. Only
// metric ops need this module.
//
// Formulas: swisstopo's published approximate LV95<->WGS84 transform
// (~1m accuracy). Verified 2026-08-21 against a known-exact pair from a
// live geo.admin.ch SearchServer response (Imbisbühlstrasse 57, 8049
// Zürich): round-trip residual <0.5m, well within tolerance for the
// 3.5-5m setback distances this tool works with.
window.MachbarkeitTool = window.MachbarkeitTool || {};

(function () {
  // Gerichtete Erosion in planarem LV95: der Teil eines Polygons, dessen
  // Punkte sich um distM Meter in EINE Richtung (dirE, dirN) bewegen können,
  // ohne das Polygon zu verlassen — also alle Punkte mit mindestens distM
  // freier Strecke bis zum Rand, gemessen entlang dieser einen Richtung.
  //
  // Das ist die Geometrie von § 22 ABV / Art. 18 Abs. 2 BZO Zumikon: eine
  // Fassade mit Aussennormale n̂ und Grenzabstand d darf nur dort stehen, wo
  // der Rand entlang n̂ mindestens d entfernt ist. Punkte HINTER der Fassade
  // erfüllen die Bedingung automatisch (ihr Strahl entlang n̂ verlässt das
  // Gebäude durch die Fassade und hat ab dort deren volle Distanz), darum
  // ist die Erosion zugleich die zulässige Standfläche des ganzen Gebäudes.
  //
  // Umsetzung als dyadische Verschiebungs-Schnitte: erode(P, Strecke[0,d])
  // = P ∩ (P−t·n̂) für alle t ∈ [0,d]. Die Schrittweiten d/2, d/4, …, d/32,
  // d/32 erreichen als Teilsummen jedes Vielfache von d/32 bis exakt d.
  // Für KONVEXE Polygone ist das Ergebnis exakt (liegen x und x+d·n̂ im
  // Polygon, liegt die ganze Strecke darin); für nicht konvexe kann eine
  // Randkerbe, die schmaler als d/32 (~0.31 m bei d=10) in dieser Richtung
  // ist, übersehen werden — das Ergebnis wäre dort um höchstens diese Kerbe
  // zu gross. Register-Eintrag: grenzabstand_gebaeuderechteck_iterativ.
  //
  // Rückgabe: Feature, null (leer — zulässiges Ergebnis) oder undefined
  // (Geometrie-Operation gescheitert — der Aufrufer muss degradieren und es
  // sagen, CLAUDE.md §4).
  function erodeDirectionalLV95(feature, dirE, dirN, distM) {
    const len = Math.hypot(dirE, dirN);
    if (!len || !(distM > 0)) return feature;
    const ux = dirE / len, uy = dirN / len;
    const steps = [distM / 2, distM / 4, distM / 8, distM / 16, distM / 32, distM / 32];
    let out = feature;
    for (const s of steps) {
      if (!out) return null;
      const shifted = translateLV95(out, -ux * s, -uy * s);
      try { out = turf.intersect(out, shifted); } catch (e) { return undefined; }
    }
    return out;
  }

  // A turf op that may throw on degenerate geometry (self-touching rings left
  // by a buffer, zero-area slivers), with an explicit fallback. Was copied
  // into massing.js, grenzabstand.js and waldabstand.js.
  //
  // The fallback is a legal decision, not a formality: callers must pick one
  // that cannot overstate what may be built, and must surface the failure
  // (CLAUDE.md §4 — no silent fallthrough). `onFail` is called with the error
  // so the caller can count and report it.
  function safeOp(fn, fallback, onFail) {
    try {
      return fn();
    } catch (e) {
      if (onFail) onFail(e);
      return fallback;
    }
  }

  // Outer ring(s) of a Polygon/MultiPolygon, holes dropped. Was copied into
  // grenzabstand.js and viewer.js.
  function exteriorRingsOf(feature) {
    return feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates[0]]
      : feature.geometry.coordinates.map((poly) => poly[0]);
  }

  function lv95ToWgs84(easting, northing) {
    const yPrime = (easting - 2600000) / 1000000;
    const xPrime = (northing - 1200000) / 1000000;

    const latSec =
      16.9023892 +
      3.238272 * xPrime -
      0.270978 * yPrime ** 2 -
      0.002528 * xPrime ** 2 -
      0.0447 * yPrime ** 2 * xPrime -
      0.014 * xPrime ** 3;

    const lonSec =
      2.6779094 +
      4.728982 * yPrime +
      0.791484 * yPrime * xPrime +
      0.1306 * yPrime * xPrime ** 2 -
      0.0436 * yPrime ** 3;

    return { lat: (latSec * 100) / 36, lon: (lonSec * 100) / 36 };
  }

  function wgs84ToLv95(lon, lat) {
    const latPrime = (lat * 3600 - 169028.66) / 10000;
    const lonPrime = (lon * 3600 - 26782.5) / 10000;

    const easting =
      2600072.37 +
      211455.93 * lonPrime -
      10938.51 * lonPrime * latPrime -
      0.36 * lonPrime * latPrime ** 2 -
      44.54 * lonPrime ** 3;

    const northing =
      1200147.07 +
      308807.95 * latPrime +
      3745.25 * lonPrime ** 2 +
      76.63 * latPrime ** 2 -
      194.56 * lonPrime ** 2 * latPrime +
      119.79 * latPrime ** 3;

    return { easting, northing };
  }

  // Generic LV95<->WGS84 coordinate-array mapper, one nesting level per
  // geometry type: LineString=[pt], Polygon/MultiLineString=[[pt]],
  // MultiPolygon=[[[pt]]].
  function mapCoordsDeep(coords, fn, depth) {
    if (depth === 0) return fn(coords);
    return coords.map((c) => mapCoordsDeep(c, fn, depth - 1));
  }
  const GEOM_DEPTH = { LineString: 1, Polygon: 2, MultiLineString: 2, MultiPolygon: 3 };

  // Reprojects an LV95 turf geometry (LineString/Polygon/MultiLineString/
  // MultiPolygon) to WGS84, buffers it there (turf.buffer's native
  // assumption), reprojects the result back to LV95. distanceMeters
  // negative = inward buffer (setback); only meaningful for
  // Polygon/MultiPolygon. Buffering a LineString always grows outward from
  // the line (used for internal-vs-external Grenzabstand strips in
  // areal.js), so distanceMeters should be positive there.
  function bufferLV95(featureLV95, distanceMeters) {
    const type = featureLV95.geometry.type;
    const depth = GEOM_DEPTH[type];
    const wgs84Coords = mapCoordsDeep(featureLV95.geometry.coordinates, ([e, n]) => {
      const { lon, lat } = lv95ToWgs84(e, n);
      return [lon, lat];
    }, depth);

    const featureWgs84 = { type: 'Feature', properties: {}, geometry: { type, coordinates: wgs84Coords } };
    const bufferedWgs84 = turf.buffer(featureWgs84, distanceMeters, { units: 'meters' });
    if (!bufferedWgs84) return null; // negative buffer can collapse the polygon to nothing

    // Die Näherungsformeln hin und zurück sind nicht exakt invers: der
    // Rücktransport landet im Raum Zürich bis ~0.4 m neben dem Ausgangspunkt.
    // Ungefiltert versetzte das den gesamten Ring gegenüber der (nie
    // transformierten) Parzelle — beobachtet ~0.4 m nach Süden, womit der
    // Grundabstand auf der Südseite UNTERbemessen gezeigt wurde. Der Fehler
    // ist über eine Parzelle praktisch konstant; er wird deshalb am
    // Schwerpunkt der Eingabe gemessen und vom Ergebnis abgezogen.
    let sumE = 0, sumN = 0, nPts = 0;
    mapCoordsDeep(featureLV95.geometry.coordinates, ([e, n]) => {
      sumE += e; sumN += n; nPts++;
      return [e, n];
    }, depth);
    const cE = sumE / nPts, cN = sumN / nPts;
    const rt = wgs84ToLv95(lv95ToWgs84(cE, cN).lon, lv95ToWgs84(cE, cN).lat);
    const driftE = rt.easting - cE, driftN = rt.northing - cN;

    const outType = bufferedWgs84.geometry.type; // buffer() always outputs (Multi)Polygon
    const backCoords = mapCoordsDeep(bufferedWgs84.geometry.coordinates, ([lon, lat]) => {
      const { easting, northing } = wgs84ToLv95(lon, lat);
      return [easting - driftE, northing - driftN];
    }, GEOM_DEPTH[outType]);

    return outType === 'Polygon' ? turf.polygon(backCoords) : turf.multiPolygon(backCoords);
  }

  // Exact planar area via the shoelace formula -- no reprojection needed or
  // wanted, since LV95 coordinates are already Cartesian meters. Do not use
  // turf.area() on LV95 geometry (same WGS84 assumption problem as buffer).
  // Subtracts hole rings (coordinates[1:]) from the exterior ring's area.
  function planarAreaLV95(polygonCoordinates) {
    function ringArea(ring) {
      let sum = 0;
      for (let i = 0; i < ring.length - 1; i++) {
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[i + 1];
        sum += x1 * y2 - x2 * y1;
      }
      return Math.abs(sum / 2);
    }
    const [exterior, ...holes] = polygonCoordinates;
    return ringArea(exterior) - holes.reduce((sum, hole) => sum + ringArea(hole), 0);
  }

  // Handles Polygon OR MultiPolygon features -- unlike planarAreaLV95 above
  // (which takes raw Polygon .coordinates only), this takes a full turf
  // Feature and sums area across parts for MultiPolygon. Needed because
  // Arealüberbauung selections can legitimately produce a MultiPolygon
  // (non-contiguous parcel selection, section 11 step 4 -- the plan
  // explicitly doesn't require adjacency).
  function planarAreaAnyLV95(feature) {
    return feature.geometry.type === 'Polygon'
      ? planarAreaLV95(feature.geometry.coordinates)
      : feature.geometry.coordinates.reduce((sum, poly) => sum + planarAreaLV95(poly), 0);
  }

  // Smallest-area rectangle enclosing a feature, by rotating calipers over
  // the convex hull. This is the measure the BZO itself uses for building
  // length -- Zumikon Art. 18 says explicitly to start from "dem
  // flächenkleinsten Rechteck, welches das Gebäude umfasst". An axis-aligned
  // bounding box would overstate the length of any building sitting at an
  // angle to the coordinate grid, which most of them do.
  function minAreaRectangleLV95(feature) {
    const g = feature.geometry;
    const pts = g.type === 'Polygon' ? g.coordinates.flat(1) : g.coordinates.flat(2);
    if (pts.length < 3) return null;
    let hull;
    try {
      hull = turf.convex(turf.featureCollection(pts.map((p) => turf.point(p))));
    } catch (e) { return null; }
    if (!hull) return null;
    const ring = hull.geometry.coordinates[0];

    let best = null;
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i], b = ring[i + 1];
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const c = Math.cos(-ang), s = Math.sin(-ang);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of ring) {
        const x = p[0] * c - p[1] * s;
        const y = p[0] * s + p[1] * c;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      const area = (maxX - minX) * (maxY - minY);
      if (!best || area < best.area) best = { area, ang, minX, maxX, minY, maxY };
    }
    if (!best) return null;

    const c = Math.cos(best.ang), s = Math.sin(best.ang);
    const toWorld = (x, y) => [x * c - y * s, x * s + y * c];
    const corners = [
      toWorld(best.minX, best.minY), toWorld(best.maxX, best.minY),
      toWorld(best.maxX, best.maxY), toWorld(best.minX, best.maxY),
    ];
    corners.push(corners[0]);
    const w = best.maxX - best.minX, h = best.maxY - best.minY;
    return {
      lengthM: Math.max(w, h), widthM: Math.min(w, h), corners,
      // Rotated frame, so callers can slice along the long axis.
      ang: best.ang, minX: best.minX, maxX: best.maxX, minY: best.minY, maxY: best.maxY,
      longAxisIsX: w >= h,
    };
  }

  // Scales each part of a Polygon/MultiPolygon about its OWN centroid, in
  // planar LV95. Per-part centroids keep separate volumes where they are
  // instead of pulling them together. turf.transformScale is not used: it
  // works in WGS84 and would distort LV95 input.
  function scalePartsLV95(feature, factor) {
    if (factor >= 0.999) return feature;
    const scaleRings = (rings) => {
      const pts = rings.flat();
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      return rings.map((r) => r.map(([x, y]) => [cx + (x - cx) * factor, cy + (y - cy) * factor]));
    };
    const g = feature.geometry;
    return g.type === 'Polygon'
      ? turf.polygon(scaleRings(g.coordinates))
      : turf.multiPolygon(g.coordinates.map(scaleRings));
  }

  // Rigid translation in planar LV95 -- used to drag the built volume around
  // inside its legal envelope. Unlike scalePartsLV95, this moves the whole
  // feature as one body (all parts together), which is what dragging one
  // building means; per-part translation would let disjoint pieces of the
  // same footprint drift apart.
  function translateLV95(feature, dE, dN) {
    const shift = (rings) => rings.map((r) => r.map(([x, y]) => [x + dE, y + dN]));
    const g = feature.geometry;
    return g.type === 'Polygon'
      ? turf.polygon(shift(g.coordinates))
      : turf.multiPolygon(g.coordinates.map(shift));
  }

  // Finds a position (not just centred, and not clipped) where a
  // lengthM x widthM rectangle at the given angle sits ENTIRELY inside
  // `area` -- used to place the default cuboid building volume. Centring it
  // on the buildable area's own bounding rectangle and clipping whatever
  // poked out of a concave notch (Waldabstand, say) produced exactly the
  // notched, non-rectangular shape a cuboid was meant to avoid; this instead
  // searches nearby positions for one where the full rectangle actually
  // fits, and only falls back to clipping if genuinely none does.
  //
  // Search is a grid over the candidate centre in the rectangle's own
  // (rotated) frame, tried nearest-to-natural-centre first: cheap (a few
  // hundred turf.booleanWithin calls at most, each O(vertices)) and
  // sufficient for the roughly-convex-with-one-notch shapes this tool
  // produces -- not a general bin-packing solver.
  // No real building is sensibly narrower than this. Without a floor, the
  // ratio/area search below (findBestRectangle) can satisfy "fits and has
  // the right area" with an absurdly thin sliver -- e.g. a 0.3x-ratio
  // rectangle at a shrunk area can come out under 2 m wide, which happened
  // in practice (Zumikon parcel 5028's Baukörper). Better to refuse that
  // combination outright and let the search try something else, or
  // concede, than to draw a "building" nobody could construct.
  const MIN_PRIMITIVE_WIDTH_M = 3.5;

  function findCuboidPlacement(area, angle, lengthM, widthM) {
    if (Math.min(lengthM, widthM) < MIN_PRIMITIVE_WIDTH_M) return null;
    const g = area.geometry;
    const pts = g.type === 'Polygon' ? g.coordinates.flat(1) : g.coordinates.flat(2);
    const c = Math.cos(-angle), s = Math.sin(-angle);
    const toLocal = (x, y) => [x * c - y * s, x * s + y * c];
    const toWorld = (x, y) => [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];

    const local = pts.map(([x, y]) => toLocal(x, y));
    const minX = Math.min(...local.map((p) => p[0])), maxX = Math.max(...local.map((p) => p[0]));
    const minY = Math.min(...local.map((p) => p[1])), maxY = Math.max(...local.map((p) => p[1]));
    const halfL = lengthM / 2, halfW = widthM / 2;
    const rangeX = maxX - minX - lengthM, rangeY = maxY - minY - widthM;
    if (rangeX < 0 || rangeY < 0) return null; // doesn't fit at this size at all

    const rectAt = (cx, cy) => {
      const corners = [[cx - halfL, cy - halfW], [cx + halfL, cy - halfW], [cx + halfL, cy + halfW], [cx - halfL, cy + halfW]];
      const worldRing = corners.map(([x, y]) => toWorld(x, y));
      worldRing.push(worldRing[0]);
      return turf.polygon([worldRing]);
    };

    const cx0 = (minX + maxX) / 2, cy0 = (minY + maxY) / 2;
    const N = 12;
    const candidates = [];
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const cx = rangeX > 0 ? minX + halfL + (rangeX * i) / N : cx0;
        const cy = rangeY > 0 ? minY + halfW + (rangeY * j) / N : cy0;
        candidates.push([cx, cy, Math.hypot(cx - cx0, cy - cy0)]);
      }
    }
    candidates.sort((a, b) => a[2] - b[2]); // nearest the natural centre first

    for (const [cx, cy] of candidates) {
      const rect = rectAt(cx, cy);
      if (turf.booleanWithin(rect, area)) return rect;
    }
    return null;
  }

  // Like findCuboidPlacement, but doesn't insist on one fixed aspect ratio
  // OR the exact target area. A volumetric study should show a plain box
  // wherever one fits: fixing the shape to the buildable area's own
  // length:width ratio at its exact area works for most parcels, but for a
  // buildable area that's mostly taken up by its own bounding box (a large
  // floorplate relative to a notched, irregular buildable area -- the 1-
  // Vollgeschoss case is exactly this, needing roughly double the 2-Voll-
  // geschoss floorplate), NO rectangle of that exact area may fit anywhere,
  // at any ratio or orientation, even though a slightly smaller one would.
  // So the search has two dimensions: try a spread of ratios and both
  // orientations (inner loop, as before) at the FULL target area first, and
  // only if truly nothing fits at that area, retry the whole spread at a
  // slightly smaller area, and so on. Returns { rect, achievedAreaM2 } so
  // the caller can tell (and disclose) whether the box had to give up some
  // area to stay a primitive shape -- returns null only if even a fairly
  // small box doesn't fit anywhere, which should not happen for any real
  // buildable area.
  // opts.minSideM (optional): prefer a rectangle whose SHORT side is at least
  // this long, at the full target area, before falling back to the ordinary
  // search. That is how an Attikageschoss survives: the 45° profile of
  // Art. 31 BZO eats `setback` off every side, so a top storey only exists on
  // a block at least 2 × setback + MIN_PRIMITIVE_WIDTH_M deep. The natural
  // ratio of a buildable area cut by Waldabstand and Grundabstand is often a
  // long thin strip (Zumikon 5029: 15.2 × 7.3 m), and the first fitting shape
  // won -- so the same 111.5 m² that a 12 × 9.3 m box would have carried an
  // Attika on was drawn as a strip that could not. A real design picks the
  // shape that keeps the storey; the area is identical either way, and where
  // no such shape fits the search proceeds exactly as before.
  function findBestRectangle(area, targetAreaM2, baseAngle, naturalLengthM, naturalWidthM, opts = {}) {
    const naturalRatio = naturalWidthM > 0 ? naturalLengthM / naturalWidthM : 1;
    const ratios = [1, 1.3, 0.77, 1.6, 0.63, 2, 0.5, 2.6, 0.4, 3.5, 0.3]
      .map((f) => naturalRatio * f)
      .filter((r) => r > 0);
    const allRatios = [naturalRatio, ...ratios];
    const areaScales = [1, 0.95, 0.9, 0.85, 0.8, 0.72, 0.65, 0.55, 0.45, 0.35, 0.25];

    // One sweep over both orientations and every ratio at a fixed area.
    // `accept` filters the SHAPE before placement is attempted; `order` lets
    // the Attika pass go squarest-first instead of natural-ratio-first.
    const sweep = (areaM2, accept, order = allRatios) => {
      for (const angle of [baseAngle, baseAngle + Math.PI / 2]) {
        for (const ratio of order) {
          const lengthM = Math.sqrt(areaM2 * ratio);
          const widthM = Math.sqrt(areaM2 / ratio);
          if (accept && !accept(lengthM, widthM)) continue;
          const rect = findCuboidPlacement(area, angle, lengthM, widthM);
          if (rect) return rect;
        }
      }
      return null;
    };

    const minSideM = opts.minSideM || 0;
    if (minSideM > 0) {
      // Squarest first: at a fixed area the short side is longest at ratio 1,
      // so the nearer to square, the more room is left under the 45° profile.
      const squarestFirst = [...allRatios].sort((a, b) => Math.abs(Math.log(a)) - Math.abs(Math.log(b)));
      const attikaCapable = sweep(targetAreaM2, (l, w) => Math.min(l, w) >= minSideM, squarestFirst);
      if (attikaCapable) return { rect: attikaCapable, achievedAreaM2: targetAreaM2, attikaShaped: true };
    }

    for (const areaScale of areaScales) {
      const areaM2 = targetAreaM2 * areaScale;
      const rect = sweep(areaM2, null);
      if (rect) return { rect, achievedAreaM2: areaM2 };
    }
    return null;
  }

  // A rectangle from its own centre, angle and dimensions -- the inverse of
  // reading corners/ang/lengthM/widthM back off minAreaRectangleLV95. Used
  // to build an Attikageschoss footprint: same centre and orientation as the
  // storey below, just smaller (inset per the 45° roof-profile rule of
  // Art. 31 BZO).
  function rectangleFromCenterLV95(cx, cy, angle, lengthM, widthM) {
    const hL = lengthM / 2, hW = widthM / 2;
    const toWorld = (x, y) => [cx + x * Math.cos(angle) - y * Math.sin(angle), cy + x * Math.sin(angle) + y * Math.cos(angle)];
    const corners = [[-hL, -hW], [hL, -hW], [hL, hW], [-hL, hW]].map(([x, y]) => toWorld(x, y));
    corners.push(corners[0]);
    return turf.polygon([corners]);
  }

  // Attikageschoss footprint per block, per Art. 31 BZO Zumikon (and the
  // cantonal 45° profile): inset by setbackM on all four sides. setbackM is
  // the horizontal Rücksprung the 45° profile requires — the CALLER derives
  // it from the Attika storey height minus the BZO's Überhöhung allowance
  // (Art. 31 Abs. 1: the 45° plane starts up to 1 m ABOVE the intersection
  // line, so Rücksprung = Attikahöhe − 1 m in Zumikon, not the full height).
  // There is NO general area cap in Art. 31 — the former "60% Faustregel"
  // was a tool invention and has been removed. Shared between the initial
  // computation (app.js) and every live recompute needed to keep the Attika
  // following its block during a drag (viewer.js, and the 2D plan drag in
  // app.js) -- one implementation, so "the Attika follows when you move the
  // building" can't drift out of sync with how it was built.
  //
  // uphillBearingDeg (optional, compass bearing 0=N/90=E the slope rises
  // toward): when given, the edge whose outward normal is closest to that
  // bearing is the Bergseite (Art. 31 Abs. 2: hangseitig fassadenbündig
  // zulässig — the caller checks the Gebäudehöhe condition of Abs. 2 before
  // passing this) and is left flush with the facade below over its full
  // length. Abs. 2 sentence 2 caps such an Attika's AREA at what an Abs.-1
  // Attika (all-sides setback) would have.
  function computeAttikaFootprints(blocks, setbackM, uphillBearingDeg = null) {
    let attikaAreaM2 = 0, requestedAreaM2 = 0, anyImpossible = false;
    // Per block, why it came out the size it did -- so the UI can show its
    // working when it reports "no Attika fits here" instead of just asserting it.
    const diagnostics = [];
    const attikaBlocks = blocks.map((block) => {
      const rect = minAreaRectangleLV95(block);
      if (!rect) return null;
      // Art. 31 Abs. 1 reference: the all-sides-setback Attika. Its area is
      // both the "requested" size for the normal case and the legal cap for
      // the fassadenbündige Bergseite variant (Abs. 2 sentence 2).
      const abs1L = rect.lengthM - 2 * setbackM;
      const abs1W = rect.widthM - 2 * setbackM;
      const abs1AreaM2 = Math.max(0, abs1L) * Math.max(0, abs1W);
      requestedAreaM2 += abs1AreaM2;
      const cx = (rect.corners[0][0] + rect.corners[2][0]) / 2, cy = (rect.corners[0][1] + rect.corners[2][1]) / 2;

      // Everything below works in the rectangle's own frame: u along rect.ang
      // (extent = lengthM), v perpendicular (extent = widthM), which is
      // exactly what rectangleFromCenterLV95 consumes. Deriving the Bergseite
      // from corner INDICES instead looked equivalent and wasn't --
      // minAreaRectangleLV95 doesn't guarantee which corner it starts at, so
      // the same block could come back with lengthM and widthM swapped
      // between two calls and the flush side would land on the wrong facade.
      // minAreaRectangleLV95's `ang` is its rotated FRAME's x-axis, which is
      // the long axis only when longAxisIsX -- otherwise lengthM runs along
      // the frame's y-axis and the true long-axis bearing is ang + 90°.
      // rectangleFromCenterLV95 always puts lengthM along the angle it is
      // given, so it needs the long-axis bearing, not the frame's.
      const axisAng = rect.longAxisIsX ? rect.ang : rect.ang + Math.PI / 2;
      const cosA = Math.cos(axisAng), sinA = Math.sin(axisAng);
      const hL = rect.lengthM / 2, hW = rect.widthM / 2;

      // Which of the four outward normals (+u, -u, +v, -v) points most nearly
      // uphill -- that facade is the Bergseite.
      let bergAxis = null, bergSign = 0;
      if (uphillBearingDeg != null) {
        let bestDiff = Infinity;
        for (const [axis, sign] of [['u', 1], ['u', -1], ['v', 1], ['v', -1]]) {
          const du = axis === 'u' ? sign : 0, dv = axis === 'v' ? sign : 0;
          const dE = du * cosA - dv * sinA, dN = du * sinA + dv * cosA;
          let bearing = Math.atan2(dE, dN) * 180 / Math.PI;
          if (bearing < 0) bearing += 360;
          const raw = Math.abs(bearing - uphillBearingDeg);
          const diff = Math.min(raw, 360 - raw);
          if (diff < bestDiff) { bestDiff = diff; bergAxis = axis; bergSign = sign; }
        }
      }

      // Extent along each local axis, and where the rectangle's centre sits.
      let extU, extV, offU = 0, offV = 0;
      if (bergAxis === null) {
        extU = abs1L;
        extV = abs1W;
      } else {
        // Bergseite flush per Art. 31 Abs. 2: no setback on the uphill
        // facade, over its full length (the former 2/3 limit was a tool
        // invention with no basis in Art. 31 and has been removed). The
        // remaining sides keep the ordinary setback. The area cap to the
        // Abs.-1 size is applied below.
        const facadeLen = bergAxis === 'u' ? rect.widthM : rect.lengthM;
        const depthAxis = bergAxis === 'u' ? rect.lengthM : rect.widthM;
        const depth = depthAxis - setbackM;
        if (bergAxis === 'u') { extU = depth; extV = facadeLen; }
        else { extV = depth; extU = facadeLen; }
        // Push the centre toward the Bergseite by half the one-sided setback,
        // so the flush facade actually lands on the facade below rather than
        // the block staying centred and merely getting smaller.
        const shift = bergSign * setbackM / 2;
        if (bergAxis === 'u') offU = shift; else offV = shift;
      }
      const diag = {
        belowLengthM: rect.lengthM, belowWidthM: rect.widthM,
        bergseite: bergAxis !== null,
        // The facade the flush run sits on, and how long that run may be.
        bergseiteFacadeLenM: bergAxis === null ? null : (bergAxis === 'u' ? rect.widthM : rect.lengthM),
        flushLenM: bergAxis === null ? null : (bergAxis === 'u' ? extV : extU),
        narrowestM: Math.min(extU, extV), possible: false,
      };
      diagnostics.push(diag);
      if (extU <= 0 || extV <= 0) { anyImpossible = true; return null; }
      // Art. 31 Abs. 2 sentence 2: a fassadenbündige (Bergseite) Attika may
      // not be larger than an Abs.-1 Attika would be. The normal case has no
      // area cap — the 45° profile itself is the constraint.
      const capAreaM2 = bergAxis === null ? Infinity : abs1AreaM2;
      const scale = Math.min(1, Math.sqrt(capAreaM2 / (extU * extV)));
      const finalL = extU * scale, finalW = extV * scale;
      diag.narrowestM = Math.min(finalL, finalW);
      if (finalL < MIN_PRIMITIVE_WIDTH_M || finalW < MIN_PRIMITIVE_WIDTH_M) { anyImpossible = true; return null; }
      diag.possible = true;
      // Re-anchor after the Abs.-2 area cap shrinks the box: the Bergseite facade has
      // to stay ON the facade below, so pin that edge and let the cap eat into
      // the valley side instead of scaling the offset (which would pull the
      // flush wall inward and quietly turn it back into a setback).
      if (bergAxis !== null) {
        const edgePos = bergSign * (bergAxis === 'u' ? hL : hW);
        const half = (bergAxis === 'u' ? finalL : finalW) / 2;
        if (bergAxis === 'u') offU = edgePos - bergSign * half; else offV = edgePos - bergSign * half;
      }
      const offCx = cx + offU * cosA - offV * sinA;
      const offCy = cy + offU * sinA + offV * cosA;
      attikaAreaM2 += finalL * finalW;
      return rectangleFromCenterLV95(offCx, offCy, axisAng, finalL, finalW);
    });
    return { attikaBlocks, attikaAreaM2, requestedAreaM2, anyImpossible, diagnostics };
  }

  window.MachbarkeitTool.erodeDirectionalLV95 = erodeDirectionalLV95;
  window.MachbarkeitTool.safeOp = safeOp;
  window.MachbarkeitTool.exteriorRingsOf = exteriorRingsOf;
  window.MachbarkeitTool.computeAttikaFootprints = computeAttikaFootprints;
  window.MachbarkeitTool.rectangleFromCenterLV95 = rectangleFromCenterLV95;
  window.MachbarkeitTool.MIN_PRIMITIVE_WIDTH_M = MIN_PRIMITIVE_WIDTH_M;
  window.MachbarkeitTool.findBestRectangle = findBestRectangle;
  window.MachbarkeitTool.findCuboidPlacement = findCuboidPlacement;
  window.MachbarkeitTool.translateLV95 = translateLV95;
  window.MachbarkeitTool.scalePartsLV95 = scalePartsLV95;
  window.MachbarkeitTool.minAreaRectangleLV95 = minAreaRectangleLV95;
  window.MachbarkeitTool.lv95ToWgs84 = lv95ToWgs84;
  window.MachbarkeitTool.wgs84ToLv95 = wgs84ToLv95;
  window.MachbarkeitTool.bufferLV95 = bufferLV95;
  window.MachbarkeitTool.planarAreaLV95 = planarAreaLV95;
  // Mehrere Polygone/MultiPolygone zu EINEM MultiPolygon. Die Zeichen-
  // werkzeuge lesen ihre Ringe ueber allRingsOf/exteriorRingsOf und kommen
  // mit Multi zurecht — so zeigen Grundriss und Isometrie mehrere Parzellen,
  // ohne dass beide Werkzeuge Listen verstehen muessten.
  // Steht hier, weil js/app.js UND js/ui/print.js es brauchen.
  function multiPolygonAus(features) {
    const polys = (features || []).filter(Boolean).flatMap((f) =>
      (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates));
    return polys.length ? turf.multiPolygon(polys) : null;
  }

  // Der gezeichnete Baukoerper einer Auswertung — ersatzweise die bebaubare
  // Flaeche, wenn kein Koerper zustande kam.
  function gezeichneterFussabdruck(r) {
    const mm = r.massingModel;
    return (mm && mm.footprintFeature) ? mm.footprintFeature : r.setbackFootprint;
  }

  // Die einzelnen Haeuser einer Auswertung als Polygone. Der Grundriss
  // zeichnet die Gebaeude aus DIESER Liste, nicht aus dem Fussabdruck.
  function bloeckeVon(r) {
    const f = r.massingModel && r.massingModel.footprintFeature;
    if (!f) return [];
    return f.geometry.type === 'Polygon'
      ? [f] : f.geometry.coordinates.map((pc) => turf.polygon(pc));
  }

  window.MachbarkeitTool.planarAreaAnyLV95 = planarAreaAnyLV95;
  window.MachbarkeitTool.multiPolygonAus = multiPolygonAus;
  window.MachbarkeitTool.gezeichneterFussabdruck = gezeichneterFussabdruck;
  window.MachbarkeitTool.bloeckeVon = bloeckeVon;
})();
