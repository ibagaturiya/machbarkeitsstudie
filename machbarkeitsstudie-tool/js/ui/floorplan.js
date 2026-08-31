// floorplan.js — a to-scale ground-floor plan (Grundriss) of the buildable
// footprint, drawn as SVG.
//
// The isometry shows the mass; this shows the shape you can actually build on
// at ground level, north-up and measurable: parcel boundary, the buildable
// footprint, whatever the Waldabstand cut removed, every facade length, the
// clearance from each facade to the parcel boundary, a scale bar and a north
// arrow. Pure SVG, so the same drawing serves the screen and the A3 print
// without a second rendering path. The root <svg> carries its E/N<->pixel
// transform as data-* attributes so app.js can drag the Baukörper directly
// on this plan without floorplan.js needing to know anything about pointer
// events itself.
window.MachbarkeitTool = window.MachbarkeitTool || {};

(function () {
  const T = window.MachbarkeitTool;

  function ringsOf(feature) {
    if (!feature) return [];
    const g = feature.geometry;
    return g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map((p) => p[0]);
  }
  function allRingsOf(feature) {
    if (!feature) return [];
    const g = feature.geometry;
    return g.type === 'Polygon' ? g.coordinates : g.coordinates.flat(1);
  }

  // "Nice" round number for the scale bar, given how many metres fit.
  function niceScaleLength(metresAcross) {
    const target = metresAcross / 4;
    const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200];
    return steps.reduce((best, s) => (Math.abs(s - target) < Math.abs(best - target) ? s : best), steps[0]);
  }

  // First hit of the ray `origin + t * dir` (t > 0) against any ring segment,
  // in planar LV95. Returns the hit point and its distance, or null.
  function rayHitRings(origin, dir, rings) {
    let bestT = Infinity, bestPt = null;
    for (const ring of rings) {
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i], b = ring[i + 1];
        const ex = b[0] - a[0], ey = b[1] - a[1];
        const den = dir[0] * ey - dir[1] * ex;
        if (Math.abs(den) < 1e-9) continue; // ray parallel to this edge
        const wx = a[0] - origin[0], wy = a[1] - origin[1];
        const t = (wx * ey - wy * ex) / den;        // along the ray
        const u = (wx * dir[1] - wy * dir[0]) / den; // along the edge
        if (t > 1e-6 && u >= 0 && u <= 1 && t < bestT) {
          bestT = t;
          bestPt = [origin[0] + dir[0] * t, origin[1] + dir[1] * t];
        }
      }
    }
    return bestPt ? { point: bestPt, distance: bestT, from: origin } : null;
  }

  // A facade's clearance to the parcel boundary, measured perpendicular to
  // that facade (§ 260 PBG: der Grenzabstand wird rechtwinklig zur Fassade
  // gemessen) rather than as the nearest point on the boundary in any
  // direction. The two only agree when the facade happens to be parallel to
  // the boundary; whenever the building sits skew to the parcel -- which is
  // the normal case -- the free nearest point runs off at an angle and
  // reports a shorter, legally meaningless number.
  // Sampled along the facade, not just at its midpoint, because a boundary
  // that converges on the building gives each point a different perpendicular
  // distance and it is the smallest one that has to satisfy the rule.
  function facadeClearance(a, b, normal, rings) {
    const SAMPLES = 9;
    let best = null;
    for (let i = 0; i < SAMPLES; i++) {
      const s = (i + 0.5) / SAMPLES;
      const origin = [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
      const hit = rayHitRings(origin, normal, rings);
      if (hit && (!best || hit.distance < best.distance)) best = hit;
    }
    return best;
  }

  // One palette per theme, matching the isometric viewer's approach: the
  // functional colours (Waldabstand hatch red, buildable-footprint amber,
  // rectangle-measure green) stay constant, only what needs contrast against
  // a dark ground (background, parcel fill/stroke, dimension ink) changes.
  const PALETTE = {
    light: {
      bg: '#ffffff', parcelFill: '#fafafa', parcelStroke: '#333',
      dimStroke: '#666', dimText: '#444', dimHalo: '#fff',
      blockStroke: '#7a6a55', blockText: '#5b4d3c', blockLabel: '#6d3d07',
      scaleStroke: '#333', facadeOther: '#8a8a8a', clearStroke: '#4a7ba6', clearText: '#2f5a80',
      contour: '#a08b6a',
    },
    dark: {
      bg: '#1b1b1f', parcelFill: '#232327', parcelStroke: '#cfcfcf',
      dimStroke: '#a8a8a8', dimText: '#e8e8e8', dimHalo: '#1b1b1f',
      blockStroke: '#c9b48a', blockText: '#f0e4c8', blockLabel: '#ffcf9e',
      scaleStroke: '#cfcfcf', facadeOther: '#77746f', clearStroke: '#7ab0e0', clearText: '#a8d0f0',
      contour: '#8e7d61',
    },
  };

  // Marching squares over the regular terrain grid -> one array of LV95
  // polylines per contour level. Cells with a missing sample (the height
  // service doesn't cover every point) are skipped rather than interpolated
  // through, so a gap in the data leaves a gap in the line instead of a
  // plausible-looking invented one. Segments are emitted independently and
  // not stitched into long paths -- at plan scale the difference isn't
  // visible, and stitching would be a lot of machinery for nothing.
  function contourSegments(grid, level) {
    const { nx, ny, points } = grid;
    const at = (i, j) => points[j * nx + i];
    const segs = [];
    const interp = (a, b) => {
      const t = (level - a.z) / (b.z - a.z);
      return [a.e + (b.e - a.e) * t, a.n + (b.n - a.n) * t];
    };
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const c = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
        if (c.some((p) => !p || p.z == null)) continue;
        const crossings = [];
        for (let k = 0; k < 4; k++) {
          const a = c[k], b = c[(k + 1) % 4];
          if ((a.z >= level) !== (b.z >= level)) crossings.push(interp(a, b));
        }
        // 2 crossings = one line through the cell; 4 = an ambiguous saddle,
        // where joining them in index order is as defensible as the
        // alternative and no worse at this resolution.
        if (crossings.length === 2) segs.push([crossings[0], crossings[1]]);
        else if (crossings.length === 4) { segs.push([crossings[0], crossings[1]]); segs.push([crossings[2], crossings[3]]); }
      }
    }
    return segs;
  }

  function buildFloorPlanSvg({
    parcelFeature, footprintFeature, hullFeature, removedFeature, lengthRect, lengthLimitM, lengthResolved,
    blockCount, blocks, facadeEdges, southFacadeIndex, grosserGrenzabstandM, dragEnabled, dark = false,
    terrainGrid, hang,
    widthPx, heightPx, padPx = 46,
  }) {
    const pal = dark ? PALETTE.dark : PALETTE.light;
    const parcelRings = allRingsOf(parcelFeature);
    // Der Ausschnitt richtete sich allein nach der Parzelle. Die
    // Waldabstandsflaeche reicht aber regelmaessig UEBER sie hinaus — und
    // wurde dann am Blattrand abgeschnitten, also ausgerechnet die Flaeche,
    // die erklaert, warum der Baukoerper so klein ist. Jetzt zaehlen alle
    // gezeichneten Geometrien mit.
    const pts = [
      ...parcelRings,
      ...allRingsOf(removedFeature),
      ...allRingsOf(hullFeature),
      ...allRingsOf(footprintFeature),
    ].flat();
    const es = pts.map((p) => p[0]);
    const ns = pts.map((p) => p[1]);
    const minE = Math.min(...es), maxE = Math.max(...es);
    const minN = Math.min(...ns), maxN = Math.max(...ns);
    const spanE = maxE - minE, spanN = maxN - minN;

    // One shared scale for both axes so the plan stays true to shape.
    const scale = Math.min((widthPx - 2 * padPx) / spanE, (heightPx - 2 * padPx) / spanN);
    const offX = (widthPx - spanE * scale) / 2;
    const offY = (heightPx - spanN * scale) / 2;
    const px = ([e, n]) => [offX + (e - minE) * scale, heightPx - offY - (n - minN) * scale];
    const path = (rings) => rings.map((r) => 'M' + r.map((c) => px(c).map((v) => v.toFixed(1)).join(',')).join('L') + 'Z').join(' ');

    const out = [];
    out.push(`<defs><pattern id="fp-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="7" stroke="#c62828" stroke-width="2.5"/></pattern></defs>`);
    out.push(`<rect width="${widthPx}" height="${heightPx}" fill="${pal.bg}"/>`);

    // Parcel
    out.push(`<path d="${path(parcelRings)}" fill="${pal.parcelFill}" fill-rule="evenodd" stroke="${pal.parcelStroke}" stroke-width="1.6"/>`);

    // Höhenlinien (swissALTI3D). Interval picked from the elevation range on
    // this parcel so a flat plot doesn't get a single line and a steep one
    // doesn't get fifty. Drawn under everything else and kept visually quiet:
    // this is site context, not a constraint the study is measuring against.
    if (terrainGrid) {
      const zs = terrainGrid.points.map((p) => p.z).filter((z) => z != null);
      if (zs.length >= 4) {
        const zMin = Math.min(...zs), zMax = Math.max(...zs);
        const range = zMax - zMin;
        const step = range > 40 ? 10 : range > 16 ? 5 : range > 6 ? 2 : range > 2 ? 1 : 0.5;
        const lines = [];
        for (let lvl = Math.ceil(zMin / step) * step; lvl <= zMax; lvl += step) {
          const segs = contourSegments(terrainGrid, lvl);
          if (!segs.length) continue;
          const d = segs.map((s) => 'M' + s.map((c) => px(c).map((v) => v.toFixed(1)).join(',')).join('L')).join(' ');
          lines.push(`<path d="${d}" fill="none" stroke="${pal.contour}" stroke-width="1" stroke-opacity=".85"/>`);
          const mid = px(segs[Math.floor(segs.length / 2)][0]);
          lines.push(`<text x="${mid[0].toFixed(1)}" y="${mid[1].toFixed(1)}" font-size="9" font-family="Helvetica,Arial" fill="${pal.contour}" paint-order="stroke" stroke="${pal.bg}" stroke-width="2.5">${lvl.toFixed(step < 1 ? 1 : 0)}</text>`);
        }
        if (lines.length) out.push(`<g class="hoehenlinien">${lines.join('')}</g>`);
      }
      // Fall line + the Hanglage verdict the Attika's Bergseite rule turns on.
      if (hang) {
        const cx = offX + (spanE / 2) * scale, cy = heightPx - offY - (spanN / 2) * scale;
        const len = Math.min(widthPx, heightPx) * 0.16;
        const rad = hang.uphillBearingDeg * Math.PI / 180;
        const ux = Math.sin(rad) * len, uy = -Math.cos(rad) * len; // screen y grows downward
        out.push(`<g opacity=".9"><line x1="${(cx - ux).toFixed(1)}" y1="${(cy - uy).toFixed(1)}" x2="${(cx + ux).toFixed(1)}" y2="${(cy + uy).toFixed(1)}" stroke="${pal.contour}" stroke-width="1.6" stroke-dasharray="5 3"/>` +
          `<text x="${(cx + ux).toFixed(1)}" y="${(cy + uy - 5).toFixed(1)}" text-anchor="middle" font-size="10.5" font-family="Helvetica,Arial" fill="${pal.contour}" paint-order="stroke" stroke="${pal.bg}" stroke-width="3">↑ Bergseite · ${hang.slopePercent.toFixed(0)}% ${hang.isHang ? '(Hanglage)' : ''}</text></g>`);
      }
    }

    // The full legal envelope the Baukörper can be dragged around inside --
    // the 2D equivalent of the 3D view's pale ghost hull. Drawn behind the
    // Baukörper itself so the actual building still reads as the solid,
    // attention-grabbing shape; this is deliberately just an outline plus a
    // faint fill, not competing with it.
    if (hullFeature) {
      out.push(`<path d="${path(allRingsOf(hullFeature))}" fill="${dark ? '#8a6a3a' : '#d9c9a8'}" fill-opacity=".14" fill-rule="evenodd" stroke="${dark ? '#b09a72' : '#8a7a5a'}" stroke-width="1.2" stroke-dasharray="4 3"/>`);
    }

    // What the Waldabstand cut removed
    // Die entfallene Flaeche wird erst weiter unten gezeichnet, NACH den
    // Baukoerpern — sonst deckt das Haus sie zu, und der Plan zeigt einen
    // Baukoerper ohne den Grund seiner Groesse.

    // The smallest enclosing rectangle of the UNDIVIDED buildable area -- the
    // measure the BZO uses for max. Gebäudelänge. Only relevant, and only
    // drawn, when that length was actually a problem (r.lengthExceeded):
    // once the building is a plain rectangle with its own facade lengths
    // labelled below, showing this too just duplicates it.
    if (lengthRect && lengthRect.corners) {
      const over = lengthLimitM != null && lengthRect.lengthM > lengthLimitM + 0.05 && !lengthResolved;
      const col = over ? '#c62828' : '#4a7d3f';
      out.push(`<path d="${path([lengthRect.corners])}" fill="none" stroke="${col}" stroke-width="1.6" stroke-dasharray="9 5"/>`);
      const mid = px(lengthRect.corners[0]).map((v, i) => (v + px(lengthRect.corners[2])[i]) / 2);
      out.push(`<text x="${mid[0].toFixed(1)}" y="${(mid[1] - 4).toFixed(1)}" text-anchor="middle" font-size="12.5" font-family="Helvetica,Arial" fill="${col}" paint-order="stroke" stroke="${pal.dimHalo}" stroke-width="3.5">Ungeteilter Bereich: L = ${lengthRect.lengthM.toFixed(1)} m${lengthResolved ? ` → ${blockCount} Baukörper (max. ${lengthLimitM} m)` : (lengthLimitM != null ? ` (max. ${lengthLimitM} m)` : '')}</text>`);
    }

    // Each Baukörper: its own fill (tagged for drag hit-testing), every
    // facade's length (aligned to that facade, not the coordinate grid --
    // the building is rarely square to it), and its clearance to the nearest
    // point on the parcel boundary from each facade.
    const parts = blocks && blocks.length
      ? blocks
      : (footprintFeature
          ? (footprintFeature.geometry.type === 'Polygon'
              ? [footprintFeature]
              : footprintFeature.geometry.coordinates.map((pc) => turf.polygon(pc)))
          : []);

    parts.forEach((part, i) => {
      out.push(`<path class="baukoerper-path" data-block-index="${i}" d="${path(allRingsOf(part))}" fill="#d9a066" fill-opacity=".62" fill-rule="evenodd" stroke="#8a4b08" stroke-width="2.4" ${dragEnabled ? 'style="cursor:move"' : ''}/>`);

      const rect = T.minAreaRectangleLV95(part);
      if (!rect) return;
      const areaM2 = T.planarAreaAnyLV95(part);
      const c = rect.corners;
      const cx = (c[0][0] + c[2][0]) / 2, cy = (c[0][1] + c[2][1]) / 2;

      // All four sides (not just two): a plain cuboid has two unique lengths,
      // but a length-split block or an odd shape doesn't, and "every facade"
      // means every facade.
      for (let k = 0; k < 4; k++) {
        const a = c[k], b = c[k + 1];
        const len = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (len < 1.2) continue;
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        // Outward unit normal of this facade: the edge direction turned 90
        // degrees, flipped to point away from the block's centre. Taken from
        // the edge itself rather than from centre-to-midpoint so it stays
        // exactly perpendicular to the wall for any block shape.
        let nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
        if (nx * (mx - cx) + ny * (my - cy) < 0) { nx = -nx; ny = -ny; }

        // Facade length, offset just outside the wall.
        const offM = 2.2;
        const p1 = px([a[0] + nx * offM, a[1] + ny * offM]), p2 = px([b[0] + nx * offM, b[1] + ny * offM]);
        const ang = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
        const deg = (Math.abs(ang) > Math.PI / 2 ? ang + Math.PI : ang) * 180 / Math.PI;
        const tx = (p1[0] + p2[0]) / 2, ty = (p1[1] + p2[1]) / 2;
        out.push(`<line x1="${p1[0].toFixed(1)}" y1="${p1[1].toFixed(1)}" x2="${p2[0].toFixed(1)}" y2="${p2[1].toFixed(1)}" stroke="${pal.blockStroke}" stroke-width="1"/>`);
        out.push(`<text x="${tx.toFixed(1)}" y="${(ty - 3).toFixed(1)}" text-anchor="middle" font-size="11" font-family="Helvetica,Arial" fill="${pal.blockText}" paint-order="stroke" stroke="${pal.dimHalo}" stroke-width="3" transform="rotate(${deg.toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)})">${len.toFixed(1)} m</text>`);

        // Clearance to the parcel boundary: the actual achieved Grenzabstand
        // for this facade, not just the rule's minimum -- meaningful now
        // that the Baukörper can be dragged to any position.
        const near = facadeClearance(a, b, [nx, ny], parcelRings);
        if (near && near.distance > 0.3 && near.distance < 80) {
          const q1 = px(near.from), q2 = px(near.point);
          const qa = Math.atan2(q2[1] - q1[1], q2[0] - q1[0]);
          const qdeg = (Math.abs(qa) > Math.PI / 2 ? qa + Math.PI : qa) * 180 / Math.PI;
          const qm = [(q1[0] + q2[0]) / 2, (q1[1] + q2[1]) / 2];
          out.push(`<line x1="${q1[0].toFixed(1)}" y1="${q1[1].toFixed(1)}" x2="${q2[0].toFixed(1)}" y2="${q2[1].toFixed(1)}" stroke="${pal.clearStroke}" stroke-width="1" stroke-dasharray="3 3"/>`);
          out.push(`<text x="${qm[0].toFixed(1)}" y="${(qm[1] - 3).toFixed(1)}" text-anchor="middle" font-size="10" font-family="Helvetica,Arial" font-style="italic" fill="${pal.clearText}" paint-order="stroke" stroke="${pal.dimHalo}" stroke-width="3" transform="rotate(${qdeg.toFixed(1)} ${qm[0].toFixed(1)} ${(qm[1] - 3).toFixed(1)})">${near.distance.toFixed(1)} m</text>`);
        }
      }

      const ctr = px([cx, cy]);
      const label = parts.length > 1 ? `Baukörper ${i + 1}` : 'Baukörper';
      out.push(`<text x="${ctr[0].toFixed(1)}" y="${(ctr[1] - 6).toFixed(1)}" text-anchor="middle" font-size="12" font-family="Helvetica,Arial" font-weight="600" fill="${pal.blockLabel}" paint-order="stroke" stroke="${pal.dimHalo}" stroke-width="3.5" pointer-events="none">${label}</text>`);
      out.push(`<text x="${ctr[0].toFixed(1)}" y="${(ctr[1] + 9).toFixed(1)}" text-anchor="middle" font-size="12" font-family="Helvetica,Arial" fill="${pal.blockLabel}" paint-order="stroke" stroke="${pal.dimHalo}" stroke-width="3.5" pointer-events="none">${areaM2.toFixed(1)} m²</text>`);
    });

    // Parcel boundary edges, clickable: lets the Hauptfassade (the side the
    // grosser Grenzabstand applies to, Art. 18 BZO) be picked by hand instead
    // of only trusting the automatic south-facing suggestion. Each edge gets
    // a fat, mostly-invisible hit target plus a thin visible line so it's
    // easy to click without needing pixel-perfect accuracy.
    if (facadeEdges && facadeEdges.edges && facadeEdges.edges.length) {
      facadeEdges.edges.forEach((edge, i) => {
        const isChosen = i === southFacadeIndex;
        const p1 = px(edge.a), p2 = px(edge.b);
        const line = (w, stroke, dash, extra) =>
          `<line class="facade-edge" data-facade-index="${i}" x1="${p1[0].toFixed(1)}" y1="${p1[1].toFixed(1)}" x2="${p2[0].toFixed(1)}" y2="${p2[1].toFixed(1)}" stroke="${stroke}" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ''} stroke-linecap="round" style="cursor:pointer" ${extra || ''}/>`;
        // Fat transparent hit target, always present so even the unselected,
        // thin grey edges are easy to click.
        out.push(line(14, 'transparent', null, ''));
        out.push(isChosen
          ? line(4, 'var(--accent, #e8792e)', null, '')
          : line(2, pal.facadeOther, '5 4', ''));
        if (isChosen) {
          const mid = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
          const ang = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
          const deg = (Math.abs(ang) > Math.PI / 2 ? ang + Math.PI : ang) * 180 / Math.PI;
          out.push(`<text x="${mid[0].toFixed(1)}" y="${(mid[1] - 8).toFixed(1)}" text-anchor="middle" font-size="12" font-family="Helvetica,Arial" font-weight="600" fill="var(--accent, #e8792e)" paint-order="stroke" stroke="${pal.dimHalo}" stroke-width="3.5" transform="rotate(${deg.toFixed(1)} ${mid[0].toFixed(1)} ${(mid[1] - 8).toFixed(1)})" pointer-events="none">Hauptfassade — grosser Grenzabstand ${grosserGrenzabstandM} m</text>`);
        }
      });
    }

    // Scale bar + north arrow
    const barM = niceScaleLength(spanE);
    const barPx = barM * scale;
    const bx = widthPx - padPx - barPx, by = heightPx - 18;
    // Zuletzt (ausser Massstab und Nordpfeil): so liegt die entfallene
    // Flaeche ueber dem Baukoerper und bleibt sichtbar.
    if (removedFeature) {
      out.push(`<path d="${path(allRingsOf(removedFeature))}" fill="url(#fp-hatch)" fill-opacity=".5" fill-rule="evenodd" stroke="#c62828" stroke-width="1.4" stroke-dasharray="6 4"/>`);
    }
    out.push(`<line x1="${bx}" y1="${by}" x2="${bx + barPx}" y2="${by}" stroke="${pal.scaleStroke}" stroke-width="2.5"/>
      <line x1="${bx}" y1="${by - 4}" x2="${bx}" y2="${by + 4}" stroke="${pal.scaleStroke}" stroke-width="2"/>
      <line x1="${bx + barPx}" y1="${by - 4}" x2="${bx + barPx}" y2="${by + 4}" stroke="${pal.scaleStroke}" stroke-width="2"/>
      <text x="${bx + barPx / 2}" y="${by - 7}" text-anchor="middle" font-size="11.5" font-family="Helvetica,Arial" fill="${pal.scaleStroke}" paint-order="stroke" stroke="${pal.dimHalo}" stroke-width="3">${barM} m</text>`);
    const nx = padPx - 12, ny = 26;
    out.push(`<g><line x1="${nx}" y1="${ny + 20}" x2="${nx}" y2="${ny}" stroke="${pal.scaleStroke}" stroke-width="2"/>
      <path d="M${nx - 5},${ny + 6} L${nx},${ny - 2} L${nx + 5},${ny + 6} Z" fill="${pal.scaleStroke}"/>
      <text x="${nx}" y="${ny + 34}" text-anchor="middle" font-size="11.5" font-family="Helvetica,Arial" fill="${pal.scaleStroke}">N</text></g>`);

    // Transform metadata so app.js can convert pointer positions on this SVG
    // back to real LV95 coordinates for dragging, without floorplan.js
    // needing to know anything about pointer events.
    return `<svg viewBox="0 0 ${widthPx} ${heightPx}" width="100%" xmlns="http://www.w3.org/2000/svg" style="display:block;background:${pal.bg}" ` +
      `data-scale="${scale}" data-min-e="${minE}" data-min-n="${minN}" data-off-x="${offX}" data-off-y="${offY}" data-height-px="${heightPx}">` +
      `${out.join('')}</svg>`;
  }

  T.buildFloorPlanSvg = buildFloorPlanSvg;
})();
