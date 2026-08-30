// viewer.js — three.js isometric render of the buildable envelope (section 3
// step 9, section 8.2). Extrudes the footprint straight up to
// traufseitige_fassadenhoehe_max_m: a flat-topped box, not a pitched roof.
//
// Per Art. 32, E-BZO: this is legally correct as the WALL height cap (up to
// the eave/Traufe) -- roof shapes above it must additionally fit a 45°
// profile, and total height is separately capped by giebelseitige
// Fassadenhöhe (§280 Abs. 1 PBG). Modeling that roof volume is deliberately
// out of scope here (plan section 10 explicitly excludes photorealistic /
// generative massing) -- the flat top is a simplification of the render
// only, not of the GFA/floor-count math, which already accounts for the
// included Dach-/Attikageschoss via rules.js's numbers. Note this
// simplification in the PDF footnotes (section 8, output.js).
window.MachbarkeitTool = window.MachbarkeitTool || {};

(function () {
  const T = window.MachbarkeitTool;

  // Both Polygon and MultiPolygon features are real inputs here -- the
  // build plan explicitly allows selecting non-contiguous parcels for
  // Arealüberbauung (section 11 step 4: "No adjacency requirement is
  // enforced by the tool"), which makes turf.union produce a MultiPolygon.
  // Verified 2026-08-21: two real, genuinely non-touching Zürich parcels
  // (turf.booleanIntersects === false) crashed this renderer before this
  // fix, because it assumed a single exterior ring. Returns one exterior
  // ring per disconnected part.
  const exteriorRingsOf = T.exteriorRingsOf; // js/core/coordinates.js

  // Scene frame: X = East, Y = up, Z = SOUTH (i.e. -north). Three.js is
  // right-handed with Y up, so east/up/north would be a LEFT-handed basis --
  // the whole scene then renders as its own mirror image (compass directions
  // swap sides against the north-up Grundriss of the same building). Z = -north
  // is the mapping that keeps it right-handed, so every LV95 -> scene
  // conversion in this file negates northing; see ringToVector2 for the one
  // place where the extrusion's own rotation does the negating instead.
  //
  // ExtrudeGeometry builds in the XY plane and extrudes along +Z, and
  // rotateX(-90°) below maps (x, y, z) -> (x, z, -y) -- so northing goes in
  // unnegated here and comes out as Z = -north after that rotation, matching
  // the outlines. Negating it here as well would cancel that and put the
  // solids at Z = +north, mirrored against every outline around them.
  function ringToVector2(ring, centerE, centerN) {
    return ring.map(([e, n]) => new THREE.Vector2(e - centerE, n - centerN));
  }

  // Dashed variant. LineDashedMaterial needs computeLineDistances().
  function buildDashedLoop(ring, centerE, centerN, color, y = 0.05) {
    const pts = ring.map(([e, n]) => new THREE.Vector3(e - centerE, y, -(n - centerN)));
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geom, new THREE.LineDashedMaterial({ color, dashSize: 1.2, gapSize: 0.9 }));
    line.computeLineDistances();
    return line;
  }

  // An architectural dimension: short extension lines running from the
  // actual edge (a, b) out to a dimension line right beside it, ticks at
  // both ends, and a label centred on that line. `offset` is kept small on
  // purpose -- the dimension has to read as belonging to that specific edge,
  // not floating free in the scene.
  function buildDimension(a, b, text, offset = new THREE.Vector3(0, 0, 0), labelH = 2, dark = false) {
    const g = new THREE.Group();
    const p1 = a.clone().add(offset), p2 = b.clone().add(offset);
    // depthTest off, like the label: a dimension sitting a few tens of cm off
    // a building edge is otherwise *inside* the solid (or the ghost hull) from
    // most orbit angles and reads as invisible or as a faint smear through
    // the material -- which was the main readability complaint. Drawing it
    // regardless of what is in front makes it read as an annotation layer,
    // the way a real dimension drawing does, rather than part of the model.
    const mat = new THREE.LineBasicMaterial({ color: dark ? 0xffffff : 0x000000, depthTest: false });
    const lines = [];
    // Extension lines: from the real edge endpoints out to the dimension line.
    lines.push(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, p1]), mat));
    lines.push(new THREE.Line(new THREE.BufferGeometry().setFromPoints([b, p2]), mat));
    lines.push(new THREE.Line(new THREE.BufferGeometry().setFromPoints([p1, p2]), mat));
    const dir = p2.clone().sub(p1).normalize();
    const tick = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(0.35);
    if (Math.abs(dir.y) > 0.9) tick.set(0.35, 0, 0);
    lines.push(new THREE.Line(new THREE.BufferGeometry().setFromPoints([p1.clone().sub(tick), p1.clone().add(tick)]), mat));
    lines.push(new THREE.Line(new THREE.BufferGeometry().setFromPoints([p2.clone().sub(tick), p2.clone().add(tick)]), mat));
    lines.forEach((l) => { l.renderOrder = 10; g.add(l); });
    const label = makeLabel(text, p1.clone().add(p2).multiplyScalar(0.5), labelH, dark);
    label.renderOrder = 11;
    g.add(label);
    // The sprite is also returned on its own: the caller keeps it, along
    // with the two points it sits between, so its in-plane rotation can be
    // kept aligned with the edge's on-screen direction as the camera orbits
    // (see updateLabelAlignment below) -- a billboard sprite always faces the
    // camera, but by default its text stays screen-horizontal regardless of
    // which way the dimension line runs, which is what made diagonal edges'
    // labels hard to read.
    return { obj: g, sprite: label };
  }

  // Text as a camera-facing sprite: readable at any orbit angle, which a
  // mesh-based label would not be. Italic per the drawing convention for
  // dimension figures; black-on-white or white-on-dark depending on theme.
  function makeLabel(text, position, worldHeight = 2, dark = false) {
    const pad = 10, font = 42;
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d');
    ctx.font = `italic 600 ${font}px Helvetica, Arial, sans-serif`;
    cv.width = Math.ceil(ctx.measureText(text).width) + pad * 2;
    cv.height = font + pad * 2;
    const c2 = cv.getContext('2d');
    c2.font = `italic 600 ${font}px Helvetica, Arial, sans-serif`;
    // Fully opaque chip with a thin border, not a translucent wash: the
    // earlier semi-transparent background let the warm building colour
    // bleed through and made the text hard to pick out against it.
    c2.fillStyle = dark ? '#101012' : '#ffffff';
    c2.fillRect(0, 0, cv.width, cv.height);
    c2.strokeStyle = dark ? '#55524c' : '#c9bfae';
    c2.lineWidth = 2;
    c2.strokeRect(1, 1, cv.width - 2, cv.height - 2);
    c2.fillStyle = dark ? '#ffffff' : '#000000';
    c2.textBaseline = 'middle';
    c2.fillText(text, pad, cv.height / 2 + 1);
    const tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.LinearFilter;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sprite.position.copy(position);
    // Sized in world units so labels stay legible relative to the model.
    sprite.scale.set((cv.width / cv.height) * worldHeight, worldHeight, 1);
    return sprite;
  }

  function buildOutlineLoop(ring, centerE, centerN, color, y = 0.05) {
    const points = ring.map(([e, n]) => new THREE.Vector3(e - centerE, y, -(n - centerN)));
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    return new THREE.LineLoop(geometry, new THREE.LineBasicMaterial({ color }));
  }

  // footprintFeature: the setback/reconciled footprint, a turf Polygon or
  // MultiPolygon Feature. parcelFeature: the original, unbuffered parcel
  // (or merged-parcels) geometry, shown as a reference outline. Both may
  // have multiple disconnected parts (non-contiguous Areal selection).
  // removedFeature (optional): the slice the Waldabstand boolean difference
  // took out of the footprint. Drawn as a separate red block so the cut is
  // visible as a shape, not just a smaller number -- otherwise the envelope
  // reads as an ordinary box and there is no way to tell the subtraction
  // happened at all.
  // One palette per theme. The warm building colour and the red Waldabstand
  // dashes stay constant -- only what needs to change for legibility against
  // a near-black background (ground, outlines, ghost hull) is themed.
  const PALETTE = {
    light: {
      bg: 0xf5f5f5, outline: 0x8a4b08, storeyLine: 0x6d3d07, attikaLine: 0x8a8a8a, attikaTint: 0xffffff,
      ghostColor: 0x8a6a3a, ghostOpacity: 0.09, ghostOutline: 0xb09a72,
      parcelOutline: 0x333333, ambient: 0.6, sun: 0.8,
    },
    dark: {
      bg: 0x1b1b1f, outline: 0xffb066, storeyLine: 0xffcf9e, attikaLine: 0xffffff, attikaTint: 0xffffff,
      ghostColor: 0xd8b98a, ghostOpacity: 0.16, ghostOutline: 0x8a795f,
      parcelOutline: 0xcfcfcf, ambient: 0.75, sun: 0.65,
    },
  };

  function renderEnvelope(container, { footprintFeature, parcelFeature, heightM, removedFeature, massing = null, interactive = false, dark = false, draggable = false, buildableArea = null, blockGapM = 0, onMove = null, onCamera = null }) {
    const pal = dark ? PALETTE.dark : PALETTE.light;
    const footprintRings = exteriorRingsOf(footprintFeature);
    const parcelRings = exteriorRingsOf(parcelFeature);
    const removedRings = removedFeature ? exteriorRingsOf(removedFeature) : [];
    const allFootprintPoints = footprintRings.flat();

    const centroid = allFootprintPoints.reduce(
      (acc, [e, n]) => [acc[0] + e / allFootprintPoints.length, acc[1] + n / allFootprintPoints.length],
      [0, 0]
    );
    const [centerE, centerN] = centroid;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(pal.bg);
    // DoubleSide because ring winding from turf/Esri isn't guaranteed CCW,
    // and the y-negation above flips it again -- rather than chase winding,
    // just render both faces so the solid is never invisible from outside.
    // polygonOffset pulls this mesh's depth slightly toward the camera. When
    // the built volume uses the full permitted height and footprint (nothing
    // for the ghost hull to show), its faces are numerically coincident with
    // the ghost's -- without this, the GPU depth test resolves that tie
    // per-pixel and near-randomly, which is the diagonal moiré/"striped
    // duplicate surface" artifact. The offset makes the resolution
    // deterministic instead of relying on the visibility threshold below to
    // always catch the coincident case.
    // Baukörper in der Akzentfarbe des Werkzeugs (--acc, #ff9d2e) — dieselbe
    // Farbe wie die gewählte Parzelle auf der Karte, ein Orange im ganzen UI.
    const material = new THREE.MeshStandardMaterial({
      color: 0xff9d2e, opacity: 0.85, transparent: true, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    // Attikageschosse: weiss und deutlich durchscheinender als der Baukörper
    // darunter — der Rücksprung liest sich als leichter Aufsatz, nicht als
    // andersfarbiges Vollgeschoss.
    const attikaMaterial = new THREE.MeshStandardMaterial({
      color: pal.attikaTint, opacity: 0.45, transparent: true, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });

    // Ghost of the maximum legal hull, where it is bigger than what is built.
    // Thresholds widened well past floating-point noise (a scale of 0.997 from
    // an sqrt(area-ratio) computation reads as "basically the same volume",
    // not as something worth drawing a second, near-coincident mesh for).
    if (massing && (massing.footprintScale < 0.97 || massing.buildingHeightM < heightM - 0.05)) {
      const ghost = new THREE.MeshBasicMaterial({
        color: pal.ghostColor, transparent: true, opacity: pal.ghostOpacity, side: THREE.DoubleSide, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      });
      footprintRings.forEach((ring) => {
        const shape = new THREE.Shape(ringToVector2(ring.slice(0, -1), centerE, centerN));
        const geom = new THREE.ExtrudeGeometry(shape, { depth: heightM, bevelEnabled: false });
        geom.rotateX(-Math.PI / 2);
        scene.add(new THREE.Mesh(geom, ghost));
        scene.add(buildOutlineLoop(ring, centerE, centerN, pal.ghostOutline, heightM));
      });
    }
    // What the restriction cuts removed: a dashed outline on the ground, not
    // a solid. A translucent red block reads as something you could build.
    removedRings.forEach((ring) => {
      scene.add(buildDashedLoop(ring, centerE, centerN, 0xc62828, 0.08));
    });

    parcelRings.forEach((ring) => scene.add(buildOutlineLoop(ring, centerE, centerN, pal.parcelOutline)));

    // The buildable storeys, the per-edge dimensioning, and the raycast
    // targets for dragging are all rebuilt together whenever the footprint
    // moves -- wrapped in one function so a drag doesn't require throwing
    // away and reconstructing the whole scene (which would also reset the
    // camera orbit). Everything else in the scene (ghost hull, parcel
    // outline, lights) is unaffected by a translation and stays put.
    let solidGroup = null;
    let solidMeshes = [];       // raycast targets for "did the pointer grab the building"
    let meshBlockIndex = new Map(); // mesh -> which block (ring) it belongs to, for per-block dragging
    let blockPolygons = [];     // turf Polygon per block, current positions -- dragging moves exactly one
    let alignedLabels = [];     // {sprite, p1, p2} kept upright to their edge, updated every draw
    const extent = Math.max(...allFootprintPoints.map(([e, n]) => Math.hypot(e - centerE, n - centerN))) * 2;
    const out = Math.max(0.6, extent * 0.02);
    // Deliberately small relative to the model: dimension figures are there
    // to be read once, not to compete with the massing. At the earlier size
    // the long storey-breakdown chip was taller than the building itself.
    const labelH = Math.max(0.5, extent * 0.011);
    const MIN_EDGE_M = 1.2; // shorter than this is a construction sliver, not a facade

    function buildSolidGroup(liveMassing) {
      const group = new THREE.Group();
      const meshes = [];
      const meshBlock = new Map();
      const blocks = [];
      const labels = [];
      const rings = liveMassing ? exteriorRingsOf(liveMassing.footprintFeature) : footprintRings;
      const solidHeight = liveMassing ? liveMassing.buildingHeightM : heightM;
      const v = ([e, n], y = 0) => new THREE.Vector3(e - centerE, y, -(n - centerN));

      const addDim = (a, b, text, offset, h) => {
        const { obj, sprite } = buildDimension(a, b, text, offset, h, dark);
        group.add(obj);
        labels.push({ sprite, p1: a.clone().add(offset), p2: b.clone().add(offset) });
      };

      // Split at the top of the ordinary Vollgeschosse: everything below
      // gets the normal material, everything from there up (the Attika
      // allowance) gets its own tint. Same footprint for both -- the real
      // BZO setback requirement for an Attikageschoss isn't in this tool's
      // data, so this is schematic, not to be read as the actual footprint
      // of that storey.
      const baseHeight = liveMassing ? liveMassing.ordinaryStoreys * liveMassing.ordinaryStoreyHeightM : solidHeight;
      const attikaHeight = Math.max(0, solidHeight - baseHeight);

      rings.forEach((ring, blockIndex) => {
        blocks.push(turf.polygon([ring]));
        const shape = new THREE.Shape(ringToVector2(ring.slice(0, -1), centerE, centerN));
        const extrudeGeometry = new THREE.ExtrudeGeometry(shape, { depth: baseHeight, bevelEnabled: false });
        extrudeGeometry.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(extrudeGeometry, material);
        group.add(mesh);
        meshes.push(mesh);
        meshBlock.set(mesh, blockIndex);
        // The Attika footprint is genuinely smaller than the storey below it
        // (45°-Regel + 60%-Deckel, computed in app.js -- see attikaBlocks),
        // not the same outline stretched up. A block with no room for one
        // (attikaBlocks[i] is null: the setback alone would consume the
        // whole footprint) simply gets no Attika volume.
        const attikaRing = liveMassing?.attikaBlocks?.[blockIndex]
          ? exteriorRingsOf(liveMassing.attikaBlocks[blockIndex])[0] : null;
        if (attikaHeight > 0.01 && attikaRing) {
          const attikaShape = new THREE.Shape(ringToVector2(attikaRing.slice(0, -1), centerE, centerN));
          const attikaGeom = new THREE.ExtrudeGeometry(attikaShape, { depth: attikaHeight, bevelEnabled: false });
          attikaGeom.rotateX(-Math.PI / 2);
          const attikaMesh = new THREE.Mesh(attikaGeom, attikaMaterial);
          attikaMesh.position.y = baseHeight;
          group.add(attikaMesh);
          meshes.push(attikaMesh); // still part of the same block for drag hit-testing
          meshBlock.set(attikaMesh, blockIndex);
          // Outline of the smaller footprint right at the step, so the
          // Rücksprung reads as a real setback, not just a colour change.
          group.add(buildOutlineLoop(attikaRing, centerE, centerN, pal.attikaLine, baseHeight));
        }
        group.add(buildOutlineLoop(ring, centerE, centerN, pal.outline));
        if (liveMassing) {
          // Ordinary Vollgeschosse and Attikageschosse can have different
          // storey heights, so the line at each level is at a cumulative Y,
          // not a plain multiple -- and Attika lines are drawn in a
          // distinct colour so the step in the massing reads as something
          // different from an ordinary floor even where the Rücksprung
          // outline above is hard to see from the current angle.
          let y = 0;
          for (let i = 1; i <= liveMassing.ordinaryStoreys; i++) {
            y += liveMassing.ordinaryStoreyHeightM;
            group.add(buildOutlineLoop(ring, centerE, centerN, pal.storeyLine, y));
          }
          // The attika range uses its own (smaller, inset) ring, not the
          // base footprint's -- the top-of-attika outline should trace the
          // Rücksprung too, not the wider storey below it.
          for (let i = 1; i <= liveMassing.attikaStoreys; i++) {
            y += liveMassing.attikaStoreyHeightM;
            if (attikaRing) group.add(buildOutlineLoop(attikaRing, centerE, centerN, pal.attikaLine, y));
          }
        }

        // Full dimensioning: every real facade edge (not just the two sides
        // of a simplifying bounding rectangle -- the actual footprint has
        // notches from the Grundabstand/Waldabstand cuts, and a
        // rectangle-only dimension either skipped those edges or, worse,
        // labelled a diagonal that isn't a wall at all), the block's floor
        // area, and a height dimension with the per-storey breakdown.
        if (liveMassing) {
          const poly = turf.polygon([ring]);
          const centroidPt = turf.centroid(poly).geometry.coordinates;

          for (let i = 0; i < ring.length - 1; i++) {
            const a = ring[i], b = ring[i + 1];
            const len = Math.hypot(a[0] - b[0], a[1] - b[1]);
            if (len < MIN_EDGE_M) continue;
            const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
            const dx = b[0] - a[0], dy = b[1] - a[1];
            let nx = -dy / len, ny = dx / len;
            const probe = turf.point([mx + nx * 0.5, my + ny * 0.5]);
            if (turf.booleanPointInPolygon(probe, poly)) { nx = -nx; ny = -ny; }
            const offset = new THREE.Vector3(nx * out, 0, -(ny * out));
            addDim(v(a), v(b), `${len.toFixed(1)} m`, offset, labelH);
          }

          const areaM2 = T.planarAreaLV95([ring]);
          const areaLabel = makeLabel(`${areaM2.toFixed(1)} m²`, v(centroidPt, solidHeight + labelH * 2.4), labelH, dark);
          areaLabel.renderOrder = 11;
          // The Attika's own (smaller, profile-constrained) footprint area, labelled
          // separately right at its own level -- otherwise the only number
          // in the scene describes the storey below, not the setback one.
          if (attikaRing) {
            const attikaCentroid = turf.centroid(turf.polygon([attikaRing])).geometry.coordinates;
            const attikaAreaM2 = T.planarAreaLV95([attikaRing]);
            const attikaAreaLabel = makeLabel(`Attika ${attikaAreaM2.toFixed(1)} m²`, v(attikaCentroid, baseHeight + attikaHeight + labelH * 1.1), labelH * 0.85, dark);
            attikaAreaLabel.renderOrder = 11;
            group.add(attikaAreaLabel);
          }
          group.add(areaLabel);

          const cx = centroidPt[0], cy = centroidPt[1];
          let farCorner = ring[0], farD = -1;
          for (const p of ring) {
            const d = Math.hypot(p[0] - cx, p[1] - cy);
            if (d > farD) { farD = d; farCorner = p; }
          }
          const hCorner = v(farCorner);
          const d0 = farD || 1;
          const hOut = new THREE.Vector3((farCorner[0] - cx) / d0 * out * 2.5, 0, -(farCorner[1] - cy) / d0 * out * 2.5);
          const parts = [];
          if (liveMassing.ordinaryStoreys > 0) parts.push(`${liveMassing.ordinaryStoreys} × ${liveMassing.ordinaryStoreyHeightM.toFixed(1)} m`);
          if (liveMassing.attikaStoreys > 0) {
            parts.push(`${liveMassing.attikaStoreys} Attika × ${liveMassing.attikaStoreyHeightM.toFixed(1)} m${liveMassing.attikaHeightIsModelled ? '' : ' (geschätzt)'}`);
          }
          const storeyPart = parts.length ? ` (${parts.join(' + ')})` : '';
          // Smaller again: this one carries the whole storey breakdown, so its
          // chip is many times wider than any edge dimension at the same height.
          addDim(hCorner, hCorner.clone().setY(solidHeight), `${solidHeight.toFixed(1)} m${storeyPart}`, hOut, labelH * 0.75);
        }
      });

      solidMeshes = meshes;
      meshBlockIndex = meshBlock;
      blockPolygons = blocks;
      alignedLabels = labels;
      return group;
    }

    solidGroup = buildSolidGroup(massing);
    scene.add(solidGroup);

    scene.add(new THREE.AmbientLight(0xffffff, pal.ambient));
    const sun = new THREE.DirectionalLight(0xffffff, pal.sun);
    sun.position.set(50, 80, 30);
    scene.add(sun);

    const width = container.clientWidth || 600;
    const height = container.clientHeight || 450;
    const aspect = width / height;
    // viewSize is the camera's VERTICAL span; horizontal span is
    // viewSize * aspect. In a pane narrower than tall (aspect < 1) a fit
    // computed from the radius alone loses its sides, so divide by aspect
    // there to guarantee the whole model stays inside the visible frame.
    const fitRadius = Math.max(...allFootprintPoints.map(([e, n]) => Math.hypot(e - centerE, n - centerN)));
    const viewSize = Math.max(40, (fitRadius * 3) / Math.min(1, aspect));
    let zoom = 1;
    const camera = new THREE.OrthographicCamera(
      (-viewSize * aspect) / 2, (viewSize * aspect) / 2,
      viewSize / 2, -viewSize / 2,
      0.1, 4000
    );

    // Camera orbits the model on a sphere. Starting angles give the classic
    // isometric view; dragging changes them. `target` is what the camera
    // orbits AROUND and looks at -- normally the model's own centre (0,0,0
    // in this scene's local frame), but Shift+drag pans it, which is just
    // moving this point in the view plane and re-orbiting around the new one.
    const dist = viewSize * 1.5;
    const AZIMUTH_0 = Math.PI / 4;               // 45°, the classic isometric plan angle
    const POLAR_0 = Math.atan(1 / Math.SQRT2);   // ~35.26°, true isometric elevation
    let azimuth = AZIMUTH_0;                     // around the vertical axis
    let polar = POLAR_0;
    // Resting look-at point sits a little below the ground plane: the model
    // then rides in the upper part of the frame, clear of the § overlay that
    // occupies the pane's lower-left corner. RESET returns here too.
    const TARGET_0_Y = -viewSize * 0.1;
    const target = new THREE.Vector3(0, TARGET_0_Y, 0);

    // The camera's own numbers, handed back so the panel can print them.
    // Reported as they really are -- azimuth and elevation in degrees, zoom
    // as a factor -- rather than as the mock's scaleY percentage, which was
    // a property of a flattened SVG and has no counterpart on a real camera.
    const cameraState = () => ({
      azimuthDeg: ((Math.round((azimuth * 180) / Math.PI) % 360) + 360) % 360,
      polarDeg: Math.round((polar * 180) / Math.PI),
      zoom,
    });
    const reportCamera = () => { if (onCamera) onCamera(cameraState()); };

    function applyCamera() {
      const r = dist * Math.cos(polar);
      camera.position.set(target.x + r * Math.sin(azimuth), target.y + dist * Math.sin(polar), target.z + r * Math.cos(azimuth));
      camera.lookAt(target);
      camera.left = (-viewSize * aspect) / 2 / zoom;
      camera.right = (viewSize * aspect) / 2 / zoom;
      camera.top = viewSize / 2 / zoom;
      camera.bottom = -viewSize / 2 / zoom;
      camera.updateProjectionMatrix();
      reportCamera();
    }
    applyCamera();

    // preserveDrawingBuffer keeps the rendered pixels readable after the draw
    // call, which is what makes toDataURL() work for the PDF export. Without
    // it the canvas reads back blank on most browsers.
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(width, height);
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // Keeps each dimension label's in-plane rotation matched to the on-screen
    // direction of the edge it belongs to. A billboard sprite always faces
    // the camera, but without this its text stays screen-horizontal no
    // matter which way the edge runs -- fine for an edge that happens to be
    // roughly horizontal on screen, unreadable for one running diagonally or
    // steeply, which is most of them from an isometric angle. Recomputed
    // every draw because the on-screen angle changes as the camera orbits.
    function updateLabelAlignment() {
      const toPx = (p) => {
        const s = p.clone().project(camera);
        return [(s.x + 1) / 2 * width, (1 - s.y) / 2 * height];
      };
      for (const { sprite, p1, p2 } of alignedLabels) {
        const [x1, y1] = toPx(p1), [x2, y2] = toPx(p2);
        let angle = Math.atan2(y2 - y1, x2 - x1);
        // Keep text upright: past ±90° it would read upside down.
        if (angle > Math.PI / 2) angle -= Math.PI;
        if (angle < -Math.PI / 2) angle += Math.PI;
        sprite.material.rotation = -angle;
      }
    }
    const draw = () => { updateLabelAlignment(); renderer.render(scene, camera); };
    draw();

    // Hand-rolled orbit control. three.js r160 ships OrbitControls only as an
    // ES module, and this project deliberately has no build step -- a few
    // lines of pointer maths is a better trade than a bundler.
    if (interactive) {
      const el = renderer.domElement;
      el.style.cursor = 'grab';
      el.style.touchAction = 'none';
      let dragging = false, lastX = 0, lastY = 0;

      // Dragging a Baukörper: wired up whenever the caller passes both a
      // buildable-area boundary to stay inside and an onMove callback. Works
      // per block -- with several blocks (a Gebäudelänge split, typically
      // multi-parcel) each one is grabbed and moved independently, checked
      // against both the buildable area AND every OTHER block (buffered by
      // blockGapM, the cantonal Gebäudeabstand) so dragging one can never
      // close the mandated gap to its neighbours or make them overlap.
      //
      // A pointerdown that raycasts onto a block enters move mode for that
      // block; a plain drag anywhere else orbits; Shift held down PANS the
      // view instead of orbiting (moves `target`, the point the camera looks
      // at and orbits around) -- Shift is a viewport-navigation modifier
      // here, not a way to grab geometry from a miss.
      const canMove = interactive && draggable && buildableArea && massing && typeof onMove === 'function';
      const raycaster = new THREE.Raycaster();
      const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const ndc = (e) => {
        const rect = el.getBoundingClientRect();
        return new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1
        );
      };
      const groundPoint = (n) => {
        raycaster.setFromCamera(n, camera);
        const pt = new THREE.Vector3();
        return raycaster.ray.intersectPlane(groundPlane, pt) ? pt : null;
      };
      let moving = false, moveStartWorld = null, moveOriginalBlock = null, moveBlockIndex = -1, liveMassing = massing;
      let panning = false, panLastX = 0, panLastY = 0;

      el.addEventListener('pointerdown', (e) => {
        if (canMove && !e.shiftKey) {
          raycaster.setFromCamera(ndc(e), camera);
          const hit = raycaster.intersectObjects(solidMeshes, false)[0];
          const blockIndex = hit ? (meshBlockIndex.get(hit.object) ?? -1) : -1;
          if (blockIndex >= 0) {
            moving = true;
            moveBlockIndex = blockIndex;
            moveStartWorld = groundPoint(ndc(e));
            moveOriginalBlock = blockPolygons[blockIndex];
            el.style.cursor = 'move';
            try { el.setPointerCapture(e.pointerId); } catch (err) { /* no active pointer (e.g. synthetic events) -- drag still works via document-level move */ }
            return;
          }
        }
        if (e.shiftKey) {
          panning = true; panLastX = e.clientX; panLastY = e.clientY;
          el.style.cursor = 'grabbing';
          try { el.setPointerCapture(e.pointerId); } catch (err) { /* no active pointer (e.g. synthetic events) */ }
          return;
        }
        dragging = true; lastX = e.clientX; lastY = e.clientY;
        el.style.cursor = 'grabbing';
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* no active pointer (e.g. synthetic events) */ }
      });
      el.addEventListener('pointermove', (e) => {
        if (moving) {
          const p = groundPoint(ndc(e));
          if (!p || !moveStartWorld) return;
          // Scene units are metres (world X = E - centerE, world Z =
          // -(N - centerN)), so the ground-plane delta converts to a LV95
          // offset with no further scaling -- but northing runs opposite to
          // world Z, hence the sign flip on dN.
          const dE = p.x - moveStartWorld.x, dN = -(p.z - moveStartWorld.z);
          const candidate = T.translateLV95(moveOriginalBlock, dE, dN);
          // Reject rather than clamp: staying at the last valid position
          // when the pointer pushes past the boundary or a neighbour is a
          // simpler, less surprising interaction than sliding along it.
          if (!turf.booleanWithin(candidate, buildableArea)) return;
          const others = blockPolygons.filter((_, i) => i !== moveBlockIndex);
          if (others.length) {
            const checkArea = blockGapM > 0 ? T.bufferLV95(candidate, blockGapM) : candidate;
            if (checkArea && others.some((o) => !turf.booleanDisjoint(checkArea, o))) return;
          }
          const newBlocks = blockPolygons.map((b, i) => (i === moveBlockIndex ? candidate : b));
          const merged = newBlocks.reduce((acc, b) => {
            if (!acc) return b;
            try { return turf.union(acc, b); } catch (err) { return acc; }
          }, null);
          // The Attika sits on top of a specific block, at that block's own
          // position -- move the block without recomputing this and it's
          // left floating over the block's old spot instead of following it.
          liveMassing = { ...liveMassing, footprintFeature: merged };
          if (liveMassing.attikaStoreys > 0) {
            const recomputed = T.computeAttikaFootprints(newBlocks, liveMassing.attikaSetbackM ?? liveMassing.attikaStoreyHeightM, liveMassing.hangUphillBearingDeg ?? null);
            liveMassing.attikaBlocks = recomputed.attikaBlocks;
            liveMassing.attikaFootplateM2 = recomputed.attikaAreaM2;
            liveMassing.attikaGeometryImpossible = recomputed.anyImpossible;
          }
          scene.remove(solidGroup);
          solidGroup = buildSolidGroup(liveMassing);
          scene.add(solidGroup);
          draw();
          onMove(merged, liveMassing);
          return;
        }
        if (panning) {
          // Screen-space right/up vectors from the camera's own basis --
          // robust at any orbit angle, unlike hand-deriving them from
          // azimuth/polar. Moving the mouse right should make the content
          // appear to follow it, i.e. the target moves the OPPOSITE way.
          const worldPerPxX = (viewSize * aspect / zoom) / width;
          const worldPerPxY = (viewSize / zoom) / height;
          const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
          const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
          const dx = e.clientX - panLastX, dy = e.clientY - panLastY;
          target.addScaledVector(right, -dx * worldPerPxX);
          target.addScaledVector(up, dy * worldPerPxY);
          panLastX = e.clientX; panLastY = e.clientY;
          applyCamera(); draw();
          return;
        }
        if (!dragging) return;
        azimuth -= (e.clientX - lastX) * 0.01;
        // Clamp just short of straight down/horizon so the model never flips.
        polar = Math.max(0.05, Math.min(Math.PI / 2 - 0.02, polar + (e.clientY - lastY) * 0.01));
        lastX = e.clientX; lastY = e.clientY;
        applyCamera(); draw();
      });
      const stop = (e) => {
        dragging = false; moving = false; panning = false; el.style.cursor = 'grab';
        try { if (e.pointerId != null && el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      };
      el.addEventListener('pointerup', stop);
      el.addEventListener('pointercancel', stop);
      el.addEventListener('wheel', (e) => {
        e.preventDefault();
        zoom = Math.max(0.4, Math.min(6, zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
        applyCamera(); draw();
      }, { passive: false });
    }

    // The same orbit the pointer drives, exposed for the panel's ⟲ / ⟳ and
    // RESET buttons. One code path for both -- a second, button-only
    // rotation would drift out of step with the drag the first time either
    // side gained a clamp.
    const orbit = {
      state: cameraState,
      stepAzimuth(deg) { azimuth += (deg * Math.PI) / 180; applyCamera(); draw(); },
      zoomBy(factor) { zoom = Math.max(0.4, Math.min(6, zoom * factor)); applyCamera(); draw(); },
      reset() {
        azimuth = AZIMUTH_0; polar = POLAR_0; zoom = 1;
        target.set(0, TARGET_0_Y, 0);
        applyCamera(); draw();
      },
    };

    return { scene, camera, renderer, draw, orbit };
  }

  // Renders the same envelope off-screen at an arbitrary size and returns a
  // PNG data URL. Used for the print/PDF output, where the on-screen canvas
  // is far too low-resolution for A3.
  function renderEnvelopeToDataURL(opts, widthPx, heightPx) {
    const offscreen = document.createElement('div');
    offscreen.style.cssText = `position:fixed;left:-99999px;top:0;width:${widthPx}px;height:${heightPx}px;`;
    document.body.appendChild(offscreen);
    try {
      const { renderer } = renderEnvelope(offscreen, { ...opts, interactive: false });
      const url = renderer.domElement.toDataURL('image/png');
      renderer.dispose();
      return url;
    } finally {
      offscreen.remove();
    }
  }

  window.MachbarkeitTool.renderEnvelope = renderEnvelope;
  window.MachbarkeitTool.renderEnvelopeToDataURL = renderEnvelopeToDataURL;
})();
