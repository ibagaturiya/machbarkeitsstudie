// massing.js — splits a buildable area that is longer than the permitted
// building length into several compliant volumes.
//
// Why this exists: the footprint produced by the setback/Waldabstand steps is
// an AREA a building must sit inside, not a building. Where that area is
// longer than the commune's max. Gebäude-/Gesamtlänge, showing it as one
// volume states something unlawful -- a 99.6 m block against a 35 m limit.
// So the area is cut into blocks of at most the permitted length, separated
// by the cantonal Gebäudeabstand (§271 PBG: the sum of both required
// Grenzabstände, i.e. 2x the Grundabstand for two ordinary buildings).
//
// This is a deterministic split, NOT a massing optimiser: blocks are of equal
// length, cut perpendicular to the long axis of the smallest enclosing
// rectangle. Real designs would place volumes differently; the point here is
// to report an area that could lawfully be built on, instead of one that
// could not.
window.MachbarkeitTool = window.MachbarkeitTool || {};

(function () {
  const T = window.MachbarkeitTool;
  const MIN_BLOCK_AREA_M2 = 5;   // ignore slivers left by concave outlines
  const MIN_BLOCK_LENGTH_M = 4;  // below this a "building" is meaningless
  const MAX_DEPTH = 3;           // fat shapes may need splitting twice

  const safeOp = T.safeOp; // js/core/coordinates.js

  function areaOf(feature) {
    return feature ? T.planarAreaAnyLV95(feature) : 0;
  }

  // One round of slicing along the long axis of `feature`.
  function sliceOnce(feature, maxLenM, gapM) {
    const rect = T.minAreaRectangleLV95(feature);
    if (!rect || rect.lengthM <= maxLenM + 0.05) return null;

    const { ang, minX, maxX, minY, maxY, longAxisIsX } = rect;
    const L = longAxisIsX ? maxX - minX : maxY - minY;

    // Smallest number of blocks whose length fits once the gaps are removed.
    // Total built length is L - (n-1)*gap whatever the distribution, so equal
    // blocks lose nothing and read better than one full block plus a stub.
    let n = 2;
    while ((L - (n - 1) * gapM) / n > maxLenM && n < 40) n++;
    const blockLen = (L - (n - 1) * gapM) / n;
    if (blockLen < MIN_BLOCK_LENGTH_M) return { blocks: [], impossible: true, n, blockLen };

    const c = Math.cos(ang), s = Math.sin(ang);
    const toWorld = (x, y) => [x * c - y * s, x * s + y * c];
    const start = longAxisIsX ? minX : minY;

    const blocks = [];
    for (let i = 0; i < n; i++) {
      const t0 = start + i * (blockLen + gapM);
      const t1 = t0 + blockLen;
      const ring = (longAxisIsX
        ? [[t0, minY], [t1, minY], [t1, maxY], [t0, maxY], [t0, minY]]
        : [[minX, t0], [maxX, t0], [maxX, t1], [minX, t1], [minX, t0]]
      ).map(([x, y]) => toWorld(x, y));
      const band = turf.polygon([ring]);
      const piece = safeOp(() => turf.intersect(feature, band), null);
      if (piece && areaOf(piece) >= MIN_BLOCK_AREA_M2) blocks.push(piece);
    }
    return { blocks, blockLen, gapM, n };
  }

  // Returns null when no split is needed. Otherwise { blocks, ... } where the
  // blocks all respect maxLenM in both directions.
  function splitToMaxLength(footprintFeature, maxLenM, gapM) {
    if (!footprintFeature || maxLenM == null) return null;
    const first = sliceOnce(footprintFeature, maxLenM, gapM);
    if (!first) return null;
    if (first.impossible) {
      return { blocks: [], impossible: true, blockLengthM: first.blockLen, gapM, requested: first.n };
    }

    // A wide shape can still exceed the limit across the other axis.
    let blocks = first.blocks;
    for (let depth = 1; depth < MAX_DEPTH; depth++) {
      let changed = false;
      const next = [];
      for (const b of blocks) {
        const again = sliceOnce(b, maxLenM, gapM);
        if (again && !again.impossible && again.blocks.length) {
          next.push(...again.blocks);
          changed = true;
        } else {
          next.push(b);
        }
      }
      blocks = next;
      if (!changed) break;
    }

    // Every candidate block came out below MIN_BLOCK_AREA_M2, so the division
    // produced nothing that could be built on. Legally the same outcome as
    // blockLen < MIN_BLOCK_LENGTH_M above, and it has to be reported the same
    // way: reported as a successful split with an empty block list, callers
    // reduce that list to a null footprint and then dereference it (app.js's
    // massing branch did exactly that, and the analysis died with a
    // TypeError instead of showing the numbers it had already computed).
    if (!blocks.length) {
      return { blocks: [], impossible: true, blockLengthM: first.blockLen, gapM, requested: first.n };
    }

    const totalAreaM2 = blocks.reduce((sum, b) => sum + areaOf(b), 0);
    const union = blocks.reduce((acc, b) => (acc ? safeOp(() => turf.union(acc, b), acc) : b), null);
    const longest = blocks.reduce((mx, b) => {
      const r = T.minAreaRectangleLV95(b);
      return r ? Math.max(mx, r.lengthM) : mx;
    }, 0);

    return {
      blocks,
      union,
      count: blocks.length,
      totalAreaM2,
      // The real longest block after ALL split rounds — a depth-2 re-slice
      // across the other axis grows blocks.length, so the first pass's
      // blockLen would overstate what "count × length" multiplies out to.
      blockLengthM: longest,
      longestBlockM: longest,
      gapM,
    };
  }

  T.splitToMaxLength = splitToMaxLength;
})();
