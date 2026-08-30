// parcel-geometry.js — turf.js polygon prep + terrain (swissALTI3D)
// The parcel polygon itself and the EGRID come from geocode.js's
// identifyParcel() (one API call returns both, verified 2026-08-21 -- no
// point making a second network round-trip just to split responsibilities
// along the build plan's original module boundaries).
window.MachbarkeitTool = window.MachbarkeitTool || {};

(function () {
  // Netzabrufe laufen ueber T.fetchQuelle (js/core/netz.js): faellt eine
  // Quelle aus, nennt der Fehler sie beim Namen statt «Load failed».
  const T = window.MachbarkeitTool;
  const HEIGHT_URL = 'https://api3.geo.admin.ch/rest/services/height';

  // geometryLV95 = the Esri-style "rings" array from identifyParcel(), which
  // is already shaped like GeoJSON Polygon coordinates (closed rings, first
  // ring exterior). turf.polygon() accepts it directly.
  function parcelToTurfPolygon(geometryLV95) {
    return turf.polygon(geometryLV95);
  }

  async function getTerrainHeight(easting, northing) {
    const params = new URLSearchParams({ easting: String(easting), northing: String(northing) });
    const res = await T.fetchQuelle('Höhenmodell swissALTI3D', `${HEIGHT_URL}?${params}`);
    if (!res.ok) throw new Error(`height service HTTP ${res.status}`);
    const data = await res.json();
    const height = parseFloat(data.height);
    if (Number.isNaN(height)) throw new Error(`height service returned non-numeric height: ${data.height}`);
    return height; // meters, gewachsenes Terrain reference point (section 3 step 5)
  }

  // A grid of terrain samples over a bounding box, fetched in parallel (one
  // request per point -- the height service has no batch/raster endpoint).
  // Failed points come back with z:null and are excluded from whatever uses
  // the grid rather than aborting the whole thing; the height service isn't
  // guaranteed to cover every point (open water, tile edges).
  async function sampleTerrainGrid(minE, minN, maxE, maxN, nx, ny) {
    const points = [];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        points.push({
          e: minE + (maxE - minE) * (nx > 1 ? i / (nx - 1) : 0.5),
          n: minN + (maxN - minN) * (ny > 1 ? j / (ny - 1) : 0.5),
          i, j,
        });
      }
    }
    const results = await Promise.all(points.map(async (p) => {
      try { return { ...p, z: await getTerrainHeight(p.e, p.n) }; }
      catch (err) { return { ...p, z: null }; }
    }));
    return { nx, ny, points: results };
  }

  // Least-squares plane fit z ~= a*E + b*N + c over the grid -- (a, b) is the
  // gradient (steepest-ascent direction and slope), robust to a single noisy
  // sample in a way that just picking the min/max points isn't. Used both to
  // decide "is this a Hang" (>=10% per the Gemeinderecht rule of thumb the
  // Attika Bergseite exception is keyed on) and which way is uphill.
  function fitTerrainSlope(gridPoints) {
    const valid = gridPoints.filter((p) => p.z != null);
    if (valid.length < 3) return null;
    const ec = valid.reduce((s, p) => s + p.e, 0) / valid.length;
    const nc = valid.reduce((s, p) => s + p.n, 0) / valid.length;
    let Suu = 0, Suv = 0, Svv = 0, Suz = 0, Svz = 0;
    for (const p of valid) {
      const u = p.e - ec, v = p.n - nc;
      Suu += u * u; Suv += u * v; Svv += v * v; Suz += u * p.z; Svz += v * p.z;
    }
    const det = Suu * Svv - Suv * Suv;
    if (Math.abs(det) < 1e-6) return null; // degenerate (near-collinear) sample layout
    const gradE = (Suz * Svv - Svz * Suv) / det;
    const gradN = (Svz * Suu - Suz * Suv) / det;
    const slopePercent = Math.hypot(gradE, gradN) * 100;
    let uphillBearingDeg = Math.atan2(gradE, gradN) * 180 / Math.PI; // 0=N, 90=E, matches this codebase's other bearings
    if (uphillBearingDeg < 0) uphillBearingDeg += 360;
    return { slopePercent, uphillBearingDeg, gradE, gradN };
  }

  window.MachbarkeitTool.parcelToTurfPolygon = parcelToTurfPolygon;
  window.MachbarkeitTool.getTerrainHeight = getTerrainHeight;
  window.MachbarkeitTool.sampleTerrainGrid = sampleTerrainGrid;
  window.MachbarkeitTool.fitTerrainSlope = fitTerrainSlope;
})();
