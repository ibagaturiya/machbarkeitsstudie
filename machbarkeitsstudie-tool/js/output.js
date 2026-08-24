// output.js — section 8: PDF export (window.print() + @page CSS, per the
// plan's own note that this is a solved problem, not a design question),
// the WMS zoning-plan excerpt with parcel overlay, and the cost estimate.
window.MachbarkeitTool = window.MachbarkeitTool || {};

(function () {

  // CHF/m³ benchmark, BKP 2 (Gebäudekosten) only -- excludes land and
  // Baunebenkosten (BKP 1/4/5), which typically add another 25-40% on top
  // (see footnote text below). Researched 2026-08-21: triangulated from
  // multiple sources (general CH Normalstandard-Neubau range CHF 800-950/m³;
  // a cited Wüest-Partner-sourced multi-family rental figure of CHF 680/m³
  // SIA416 without parking; general CH range CHF 600-1200/m³ depending on
  // standard/region). Zürich sits toward the upper end of the national
  // range as a high-cost urban market. Not the official current Zürcher
  // Index der Wohnbaupreise (ZIW) figure -- that index's current numeric
  // value wasn't retrievable from official sources during this session
  // (page structure didn't expose it) -- so this is a deliberately chosen,
  // reasoned estimate, not an authoritative index reading. Label as rough
  // estimate in the UI regardless (plan section 8.8's explicit instruction).
  const COST_BENCHMARK_CHF_PER_M3 = 900;

  // Map extent for a given pixel box. The bbox aspect ratio must match the
  // pixel aspect ratio, otherwise the returned raster is stretched and the
  // vector overlays no longer line up with it.
  function buildMapBbox(centerE, centerN, halfSpanM, widthPx, heightPx) {
    const aspect = widthPx / heightPx;
    const halfW = aspect >= 1 ? halfSpanM * aspect : halfSpanM;
    const halfH = aspect >= 1 ? halfSpanM : halfSpanM / aspect;
    return [centerE - halfW, centerN - halfH, centerE + halfW, centerN + halfH];
  }

  // Zone plan drawn from the CANTONAL zoning dataset (ogd-0156) rather than
  // fetched as a raster. The Stadt-Zürich zoning WMS that was used before
  // covers only the city, so the zone plan came back blank for every other
  // commune -- Zumikon included. The canton's WFS covers the whole canton,
  // and drawing it as SVG also prints sharper than a raster at A3.
  const ZONE_WFS = 'https://maps.zh.ch/wfs/OGDZHWFS';
  const ZONE_TYPENAME = 'ogd-0156_arv_basis_np_gn_zonenflaeche_f';

  async function fetchZonePolygons(bbox) {
    const params = new URLSearchParams({
      SERVICE: 'WFS', VERSION: '1.1.0', REQUEST: 'GetFeature',
      TYPENAME: ZONE_TYPENAME, SRSNAME: 'EPSG:2056',
      BBOX: `${bbox.join(',')},EPSG:2056`,
      outputFormat: 'application/json',
    });
    const res = await fetch(`${ZONE_WFS}?${params}`);
    if (!res.ok) return [];
    const fc = await res.json();
    return fc.features || [];
  }

  // Conventional Swiss zoning-plan palette, keyed by the canton's own type
  // code (typ_zh_code): C11xx/C12xx Wohnzonen, C13xx Kern-/Zentrumszonen,
  // C14xx-C15xx Arbeiten, C16xx öffentliche Bauten, C3xxx Freihalte-/
  // Erholungszonen, C4401 Wald, C41xx Landwirtschaft.
  function zoneColor(props) {
    const code = String(props.typ_zh_code || '');
    const floors = props.vollgeschosse_max;
    if (code.startsWith('C11') || code.startsWith('C12')) {
      // Wohnzonen: deeper orange with more permitted floors.
      const shades = ['#fbe3cd', '#f9d3b0', '#f7bf8c', '#f3a869', '#ee8f4c', '#e4763a', '#d55f2c'];
      return shades[Math.min(Math.max((floors || 2) - 1, 0), shades.length - 1)];
    }
    if (code.startsWith('C13')) return '#c9a06a';             // Kern-/Zentrumszonen
    if (code.startsWith('C14') || code.startsWith('C15')) return '#d6b3d9'; // Arbeiten
    if (code.startsWith('C16')) return '#c8ccd6';             // öffentliche Bauten
    if (code === 'C4401') return '#a8c99a';                   // Wald
    if (code.startsWith('C31') || code.startsWith('C32')) return '#dcecc9'; // Freihalte/Erholung
    if (code.startsWith('C41')) return '#eef3e2';             // Landwirtschaft
    return '#ededed';                                          // nicht zugewiesen / übrige
  }

  function buildZonePlanSvg(features, bbox, widthPx, heightPx) {
    const [minE, minN, maxE, maxN] = bbox;
    const px = ([e, n]) => [
      ((e - minE) / (maxE - minE)) * widthPx,
      heightPx - ((n - minN) / (maxN - minN)) * heightPx,
    ];
    const parts = [];
    const labels = [];
    for (const f of features) {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      const fill = zoneColor(f.properties);
      for (const rings of polys) {
        const d = rings.map((ring) => 'M' + ring.map((c) => px(c).map((v) => v.toFixed(1)).join(',')).join('L') + 'Z').join(' ');
        parts.push(`<path d="${d}" fill="${fill}" fill-rule="evenodd" stroke="#8d8d8d" stroke-width="1"/>`);
      }
      // Label the zone where there is room for it.
      const label = f.properties.typ_gde_abkuerzung || f.properties.typ_zh_abkuerzung;
      if (label) {
        try {
          const c = px(turf.centroid(f).geometry.coordinates);
          if (c[0] > 8 && c[0] < widthPx - 8 && c[1] > 8 && c[1] < heightPx - 8) {
            labels.push(`<text x="${c[0].toFixed(1)}" y="${c[1].toFixed(1)}" text-anchor="middle" font-size="${Math.round(widthPx / 55)}" font-family="Helvetica,Arial,sans-serif" fill="#3a3a3a" paint-order="stroke" stroke="#ffffff" stroke-width="3">${label}</text>`);
          }
        } catch (e) { /* skip label */ }
      }
    }
    return `<svg class="layer" viewBox="0 0 ${widthPx} ${heightPx}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${parts.join('')}${labels.join('')}</svg>`;
  }

  // Cadastral parcel boundaries for the same bbox, from the federal WMS.
  // The zoning WMS draws zone colours only -- without this the excerpt shows
  // no neighbouring parcel borders at all, so there's no way to see how the
  // subject parcel sits among its neighbours. Rendered over the zoning image
  // with CSS mix-blend-mode: multiply, which keeps the layer's white
  // background invisible while its black boundary lines and labels stay
  // legible over the zone colour.
  function buildCadastreMapUrl(bbox, widthPx, heightPx) {
    const params = new URLSearchParams({
      SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.3.0',
      LAYERS: 'ch.kantone.cadastralwebmap-farbe', STYLES: '', CRS: 'EPSG:2056',
      BBOX: bbox.join(','), WIDTH: String(widthPx), HEIGHT: String(heightPx),
      FORMAT: 'image/png', TRANSPARENT: 'true',
    });
    return `https://wms.geo.admin.ch/?${params}`;
  }

  // SVG polygon overlay for the parcel outline, positioned over the WMS
  // image via the same BBOX/WIDTH/HEIGHT used to request it. WMS GetMap
  // with CRS=EPSG:2056 (not the axis-swapped urn form) follows standard
  // north-up image convention -- verified 2026-08-21 by visual inspection
  // (requested bbox centered on the confirmed W3 test parcel; the "W3"
  // label appeared centered in the returned image, as expected).
  // rings: an array of LV95 exterior rings (one per parcel/part). The
  // single-parcel case passes one ring; Arealüberbauung passes one per
  // selected parcel, so each stays individually outlined on the zoning
  // excerpt rather than being merged into an indistinct blob.
  function buildParcelOverlaySvg(rings, bbox, widthPx, heightPx) {
    const [minE, minN, maxE, maxN] = bbox;
    const toPixel = ([e, n]) => {
      const x = ((e - minE) / (maxE - minE)) * widthPx;
      const y = heightPx - ((n - minN) / (maxN - minN)) * heightPx;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    };
    const polygons = rings
      .map((ring) => `<polygon points="${ring.map(toPixel).join(' ')}" fill="rgba(255,0,0,0.15)" stroke="red" stroke-width="3" />`)
      .join('');
    return `<svg width="${widthPx}" height="${heightPx}" style="position:absolute;top:0;left:0;pointer-events:none;">${polygons}</svg>`;
  }

  // Bbox covering every given LV95 ring, padded by marginM, forced square
  // so the WMS image isn't distorted relative to the requested WIDTH/HEIGHT.
  function boundingBoxForRings(rings, marginM) {
    const points = rings.flat();
    const es = points.map((p) => p[0]);
    const ns = points.map((p) => p[1]);
    const centerE = (Math.min(...es) + Math.max(...es)) / 2;
    const centerN = (Math.min(...ns) + Math.max(...ns)) / 2;
    const halfSpan = Math.max(Math.max(...es) - Math.min(...es), Math.max(...ns) - Math.min(...ns)) / 2 + marginM;
    return { centerE, centerN, halfSpan };
  }

  // Always rounded UP, to the next CHF 10'000: a rough estimate that rounds
  // down reads as more precise than it is and understates the budget.
  function roundUpChf(value, step = 10000) {
    return Math.ceil(value / step) * step;
  }

  function estimateCost(envelopeVolumeM3) {
    return {
      chfPerM3: COST_BENCHMARK_CHF_PER_M3,
      totalChf: roundUpChf(envelopeVolumeM3 * COST_BENCHMARK_CHF_PER_M3),
      note:
        'Grobschätzung BKP 2 (reine Gebäudekosten) auf Basis eines pauschal gewählten ' +
        `Kennwerts von CHF ${COST_BENCHMARK_CHF_PER_M3}/m³ für Neubau Mehrfamilienhaus, Normalstandard, Raum Zürich. ` +
        'Nicht die amtliche Kennzahl des Zürcher Index der Wohnbaupreise. Exklusive Landkosten und ' +
        'Baunebenkosten (BKP 1/4/5), die üblicherweise nochmals 25-40% aufschlagen. Sehr grobe Schätzung, keine Kostenplanung.',
    };
  }

  window.MachbarkeitTool.buildMapBbox = buildMapBbox;
  window.MachbarkeitTool.fetchZonePolygons = fetchZonePolygons;
  window.MachbarkeitTool.buildZonePlanSvg = buildZonePlanSvg;
  window.MachbarkeitTool.buildCadastreMapUrl = buildCadastreMapUrl;
  window.MachbarkeitTool.buildParcelOverlaySvg = buildParcelOverlaySvg;
  window.MachbarkeitTool.boundingBoxForRings = boundingBoxForRings;
  window.MachbarkeitTool.roundUpChf = roundUpChf;
  window.MachbarkeitTool.estimateCost = estimateCost;
})();
