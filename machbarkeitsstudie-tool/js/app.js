// app.js — the whole tool, one page.
//
// Flow: address -> map with that parcel selected -> optionally click more
// parcels -> results recompute automatically on every selection change.
//
// Multiple selected parcels that touch are unioned and treated as ONE
// parcel under the normal zone rules: combined area, one outer boundary,
// one Grundabstand ring, same three-way reconciliation as a single parcel.
// No separate Arealüberbauung mode and no Art. 7 bonus tables -- see
// README.md for what that deliberately leaves on the table.
(function () {
  const T = window.MachbarkeitTool;

  const form = document.getElementById('address-form');
  const statusEl = document.getElementById('status');
  const mapSectionEl = document.getElementById('map-section');
  const selectionListEl = document.getElementById('selection-list');
  const resultsEl = document.getElementById('results');
  const versionBannerEl = document.getElementById('version-banner');
  const bindingSummaryEl = document.getElementById('binding-summary');
  const numbersTableEl = document.getElementById('numbers-table');
  const flagsEl = document.getElementById('flags');
  const checklistEl = document.getElementById('checklist');
  const viewerEl = document.getElementById('viewer');
  const footnotesEl = document.getElementById('footnotes');
  const sourcesSectionEl = document.getElementById('sources-section');
  const zoningMapEl = document.getElementById('zoning-map');
  const costEstimateEl = document.getElementById('cost-estimate');
  const gemeindeSelect = document.getElementById('gemeinde-select');

  const previewPdfBtn = document.getElementById('preview-pdf-btn');
  const printDocEl = document.getElementById('print-doc');
  // Kept so the print document can be composed from the last analysis
  // without re-running it.
  let lastResult = null;
  let lastFlags = [];
  // Storey count is a design choice, not a computed result -- remembered
  // across re-renders so switching it does not re-run the whole analysis.
  let storeyChoice = null;
  // Same for which parcel edge is the Hauptfassade (grosser Grenzabstand):
  // null means "use the automatic south-facing suggestion". Reset per
  // analysis (see analyse()) since the edge index is tied to a specific
  // parcel shape.
  let southFacadeIndex = null;

  async function composePrintDoc() {
    if (!lastResult) return false;
    await T.buildPrintDocument(lastResult, lastFlags, buildGrundbuchFootnote());
    return true;
  }

  // ---- Theme (light/dark) --------------------------------------------
  // Applied to <html> before first paint (inline script in index.html) so
  // there's no flash; this just keeps the toggle button and the 3D view in
  // sync with it afterwards. The Leaflet basemap and the app chrome are
  // themed entirely in CSS (var(--map-filter) inverts the raster tiles);
  // three.js has no CSS to hook into, so the viewer is re-rendered with the
  // current theme's palette instead.
  const themeToggleBtn = document.getElementById('theme-toggle');
  function currentTheme() {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  }
  function isDark() {
    return currentTheme() === 'dark';
  }
  // Line icons, not emoji: an emoji renders at its own colour and weight and
  // reads as a coloured badge, which is far too loud for a preference switch
  // sitting next to the analysis controls.
  const ICON_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.4M12 19.6V22M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2 12h2.4M19.6 12H22M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7"/></svg>';
  const ICON_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a8.6 8.6 0 1 0 11.1 11.1z"/></svg>';
  function applyThemeIcon() {
    themeToggleBtn.innerHTML = isDark() ? ICON_MOON : ICON_SUN;
  }
  applyThemeIcon();
  themeToggleBtn.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('machbarkeit-theme', next);
    applyThemeIcon();
    if (lastResult) renderViewer(lastResult);
  });

  // Tabs in the geometry pane. The 3D canvas is sized by CSS, so it must be
  // re-rendered when its pane becomes visible (a hidden canvas has no size).
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab === 'viewer' ? 'viewer-wrap' : btn.dataset.tab;
      document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab-pane').forEach((p) => p.classList.toggle('active', p.id === target));
      if (target === 'viewer-wrap' && lastResult) renderViewer(lastResult);
    });
  });

  // Renders the same A3 sheets inline so the layout can be checked without
  // opening the print dialog every time.
  previewPdfBtn.addEventListener('click', async () => {
    if (printDocEl.classList.contains('preview')) {
      printDocEl.classList.remove('preview');
      previewPdfBtn.textContent = 'Layout ansehen';
      return;
    }
    previewPdfBtn.disabled = true;
    try {
      if (await composePrintDoc()) {
        printDocEl.classList.add('preview');
        previewPdfBtn.textContent = 'Layout schliessen';
        printDocEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } finally {
      previewPdfBtn.disabled = false;
    }
  });

  // The commune is detected from the parcel itself, so the dropdown is only
  // an override -- useful on a commune boundary, or to see what a zone would
  // mean under a neighbouring commune's rules. It lists the communes whose
  // BZO values are actually on file; anything else errors rather than guesses.
  for (const g of T.availableGemeinden()) {
    const opt = document.createElement('option');
    opt.value = g;
    opt.textContent = g;
    gemeindeSelect.appendChild(opt);
  }

  // ---- search box: address or parcel number ---------------------------
  // Two ways into the same analysis. An address is the usual one; a parcel
  // number is what a Grundbuch extract, a purchase contract or a broker's
  // listing actually quotes, and having to look up its address first was
  // busywork. Both resolve to a point, and the point resolves to a parcel,
  // so everything downstream is unchanged.
  //
  // The picked suggestion is kept (not just its text): it already carries
  // LV95 coordinates, so choosing "Parzelle 1207" from the list goes
  // straight to identify without a second, ambiguous text lookup.
  const addressInput = document.getElementById('address-input');
  const optionsEl = document.getElementById('address-options');
  let suggestions = [];
  let activeIndex = -1;
  let chosen = null;
  let searchSeq = 0;
  let searchTimer = null;

  function closeOptions() {
    optionsEl.hidden = true;
    optionsEl.replaceChildren();
    addressInput.setAttribute('aria-expanded', 'false');
    suggestions = [];
    activeIndex = -1;
  }

  function setActive(i) {
    activeIndex = i;
    Array.from(optionsEl.children).forEach((li, k) => {
      li.setAttribute('aria-selected', k === i ? 'true' : 'false');
      if (k === i) li.scrollIntoView({ block: 'nearest' });
    });
  }

  function choose(i) {
    const s = suggestions[i];
    if (!s) return;
    chosen = s;
    addressInput.value = s.value;
    closeOptions();
  }

  function renderOptions(list) {
    optionsEl.replaceChildren();
    suggestions = list;
    if (!list.length) { closeOptions(); return; }
    list.forEach((s, i) => {
      const li = document.createElement('li');
      li.className = 'combo-opt';
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      const kind = document.createElement('span');
      kind.className = 'opt-kind';
      kind.textContent = s.kind === 'parcel' ? 'Parz.' : 'Adr.';
      const main = document.createElement('span');
      main.className = 'opt-main';
      main.textContent = s.primary;
      const sub = document.createElement('span');
      sub.className = 'opt-sub';
      sub.textContent = s.secondary;
      li.append(kind, main, sub);
      // mousedown, not click: the input's blur would otherwise close the
      // list before the click ever lands on the row.
      li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(i); });
      optionsEl.appendChild(li);
    });
    optionsEl.hidden = false;
    addressInput.setAttribute('aria-expanded', 'true');
    setActive(-1);
  }

  async function runSearch(text) {
    const seq = ++searchSeq;
    try {
      const hits = await T.searchLocations(text, { gemeinde: gemeindeSelect.value || null });
      if (seq !== searchSeq) return; // a newer keystroke already won
      renderOptions(hits);
    } catch (_) {
      // A failed suggestion lookup is not worth a status message: the user
      // can still submit, and submitting reports its own errors.
      if (seq === searchSeq) closeOptions();
    }
  }

  addressInput.addEventListener('input', () => {
    chosen = null;
    const text = addressInput.value.trim();
    clearTimeout(searchTimer);
    if (text.length < 2) { closeOptions(); return; }
    searchTimer = setTimeout(() => runSearch(text), 180);
  });

  addressInput.addEventListener('keydown', (e) => {
    if (optionsEl.hidden || !suggestions.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((activeIndex + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((activeIndex - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      // Picks the highlighted row without also submitting: the choice and
      // the run are two decisions, and merging them makes a mis-highlighted
      // row cost a full analysis.
      e.preventDefault();
      choose(activeIndex);
    } else if (e.key === 'Escape') {
      closeOptions();
    }
  });

  addressInput.addEventListener('blur', () => closeOptions());
  // Re-scoping the search: with a commune picked, a bare parcel number is
  // enough, so the list is worth refreshing against the new scope.
  gemeindeSelect.addEventListener('change', () => {
    const text = addressInput.value.trim();
    if (!optionsEl.hidden && text.length >= 2) runSearch(text);
  });

  function setStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.className = isError ? 'error' : '';
  }

  // "2 Vollgeschosse", "2 Vollgeschosse + 1 Attika" -- used everywhere a
  // storey count is shown so ordinary and Attika storeys never get silently
  // merged into one plain "n Vollgeschoss" figure.
  function storeyCountLabel(ordinary, attika) {
    const base = `${ordinary} Vollgeschoss${ordinary === 1 ? '' : 'e'}`;
    return attika > 0 ? `${base} + ${attika} Attika` : base;
  }

  function fmt(n, digits = 1) {
    return typeof n === 'number' ? n.toFixed(digits) : String(n);
  }

  const COMPASS = ['Nord', 'Nordost', 'Ost', 'Südost', 'Süd', 'Südwest', 'West', 'Nordwest'];
  function compassLabel(bearingDeg) {
    return COMPASS[Math.round(((bearingDeg % 360) + 360) % 360 / 45) % 8];
  }

  const BINDING_LABELS = {
    grundabstand: 'Grundabstand (Setback)',
    gruenflaechenziffer: 'Grünflächenziffer (Grünflächen-Minimum)',
    ueberbauungsziffer: 'Überbauungsziffer (Fussabdruck-Maximum, § 256 PBG)',
    ausnuetzungsziffer: 'Ausnützungsziffer (Ausnützungs-Maximum)',
  };

  // All user- and API-sourced strings pass through here before innerHTML.
  // (print.js has its own copy; the sinks here used to interpolate raw.)
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // First provenance hit among candidate keys — used to attach the "Beleg"
  // (evidence) button to a value. Returns null when nothing is on record:
  // the value then renders without a citation rather than with an invented one.
  function provFor(rules, ...keys) {
    for (const k of keys) {
      const p = T.getProvenance(rules, k);
      if (p) return p;
    }
    return null;
  }

  // A numbers-table value with an optional evidence link. The § button opens
  // the source PDF at the cited page with the passage highlighted.
  let provRegistry = [];
  function withProv(valueHtml, prov) {
    if (!prov || !T.showEvidence) return valueHtml;
    const id = provRegistry.push(prov) - 1;
    return `${valueHtml} <button type="button" class="prov-btn" data-prov="${id}" title="Beleg im Gesetzestext anzeigen (${esc(prov.article || '')})">§</button>`;
  }
  function wireProvButtons(container) {
    container.querySelectorAll('.prov-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const prov = provRegistry[Number(btn.dataset.prov)];
        if (prov) T.showEvidence(prov);
      });
    });
  }

  // ---- Grundbuchauszug (manual, footnote only) ----------------------------
  const naeherbaurechtYes = document.getElementById('naeherbaurecht-yes');
  const naeherbaurechtFields = document.getElementById('naeherbaurecht-fields');
  const naeherbaurechtDetail = document.getElementById('naeherbaurecht-detail');
  const wegrechtYes = document.getElementById('wegrecht-yes');
  const wegrechtFields = document.getElementById('wegrecht-fields');
  const wegrechtDetail = document.getElementById('wegrecht-detail');
  const otherDienstbarkeit = document.getElementById('other-dienstbarkeit');
  const grundbuchFootnotePreview = document.getElementById('grundbuch-footnote-preview');
  let staticFootnoteHtml = '';

  function buildGrundbuchFootnote() {
    const parts = [];
    if (naeherbaurechtYes.checked) {
      parts.push(`Näherbaurecht vorhanden${naeherbaurechtDetail.value.trim() ? ` (${naeherbaurechtDetail.value.trim()})` : ''}`);
    }
    if (wegrechtYes.checked) {
      parts.push(`Wegrecht vorhanden${wegrechtDetail.value.trim() ? ` (${wegrechtDetail.value.trim()})` : ''}`);
    }
    if (otherDienstbarkeit.value.trim()) parts.push(otherDienstbarkeit.value.trim());
    return parts.length
      ? `Laut manuell erfasstem Grundbuchauszug: ${parts.join('; ')}. Nicht in der obigen Berechnung berücksichtigt — betrifft ggf. die bebaubare Fläche zusätzlich.`
      : null;
  }

  function refreshGrundbuchFootnote() {
    const footnote = buildGrundbuchFootnote();
    grundbuchFootnotePreview.style.display = footnote ? 'block' : 'none';
    grundbuchFootnotePreview.textContent = footnote ? '⚠ ' + footnote : '';
    if (staticFootnoteHtml) {
      // footnote contains raw user input from the Grundbuch form — escape it.
      footnotesEl.innerHTML = staticFootnoteHtml + (footnote ? `<br><br>${esc(footnote)}` : '');
    }
  }

  naeherbaurechtYes.addEventListener('change', () => {
    naeherbaurechtFields.classList.toggle('visible', naeherbaurechtYes.checked);
    refreshGrundbuchFootnote();
  });
  wegrechtYes.addEventListener('change', () => {
    wegrechtFields.classList.toggle('visible', wegrechtYes.checked);
    refreshGrundbuchFootnote();
  });
  [naeherbaurechtDetail, wegrechtDetail, otherDienstbarkeit].forEach((el) =>
    el.addEventListener('input', refreshGrundbuchFootnote)
  );

  // ---- Analysis -----------------------------------------------------------

  // Everything from the parcel-edge buffer down to the final buildable
  // volume, as one function -- called once from analyse() (with the freshly
  // fetched wald/baulinien) and again from rerenderWithFacade()/
  // rerenderWithChoices() (reusing the cached ones), since a facade or
  // storey choice never needs the async ÖREB/Wald network calls redone.
  function deriveFootprint({ merged, parcelAreaM2, anrechenbareFlaecheM2, flaechenAbzuege, rules, wald, baulinien, facadeEdges, southFacadeIdx, storeys, hang }) {
    // The directional Grenzabstand (Zumikon Art. 18): most communes have one
    // uniform Grundabstand, but where a commune's BZO names a larger
    // Grenzabstand for the Hauptfassade(n), the chosen edge(s) get that
    // larger distance instead of the uniform one. Art. 18 Abs. 1: in W2/25
    // the grosse Grenzabstand applies to the TWO most south-facing sides
    // (grosser_grenzabstand_suedseiten = 2), elsewhere to one.
    const hasDirectional = rules.grosser_grenzabstand_min_m != null
      && rules.grosser_grenzabstand_min_m > rules.grundabstand_min_m;
    const suedCount = rules.grosser_grenzabstand_suedseiten || 1;
    const chosenIdx = southFacadeIdx != null ? southFacadeIdx : (facadeEdges ? facadeEdges.suggestedIndex : null);
    // The user's pick (or the auto suggestion) is the primary Hauptfassade;
    // where the zone demands a second one it comes from the automatic
    // south-ranking, skipping the primary.
    let chosenIndices = [];
    if (hasDirectional && facadeEdges && chosenIdx != null && facadeEdges.edges.length) {
      chosenIndices = [chosenIdx];
      for (const i of (facadeEdges.suggestedIndices || [])) {
        if (chosenIndices.length >= suedCount) break;
        if (!chosenIndices.includes(i)) chosenIndices.push(i);
      }
    }
    const chosenEdges = chosenIndices.map((i) => facadeEdges.edges[i]).filter(Boolean);

    // Mehrlängenzuschlag (Art. 14 BZO 2016, in force for Zürich): facades
    // longer than 12 m increase the Grenzabstand by a third of the excess,
    // capped per zone. The building length is only known after the massing
    // step, so this runs as one fix-point iteration: derive with the base
    // Grundabstand, measure the longest block, re-derive once with the
    // increased distance if the threshold is exceeded. Applying the Zuschlag
    // on all sides is a simplification on the safe (strict) side; the flag
    // in render() says so.
    const mlz = rules.mehrlaengenzuschlag;
    let mehrlaengen = null;

    const runSetback = (smallM) => (hasDirectional && chosenEdges.length
      ? T.anisotropicSetbackMulti(merged, chosenEdges, smallM, rules.grosser_grenzabstand_min_m)
      : T.bufferLV95(merged, -smallM));

    // One full derivation pass at a given Grundabstand — everything from the
    // setback ring to the placed massing. Runs once normally, twice when the
    // Mehrlängenzuschlag kicks in.
    const computePass = (grundabstandUsedM) => {
    let setbackFootprint = runSetback(grundabstandUsedM);

    let footprintBeforeWaldM2 = setbackFootprint ? T.planarAreaAnyLV95(setbackFootprint) : 0;
    // The slice the cut actually takes out of the buildable footprint -- kept
    // so the 3D view can show it rather than just reporting a smaller number.
    let waldRemoved = null;
    let baulinienRemoved = null;
    if (setbackFootprint && wald.forbidden) {
      try { waldRemoved = turf.intersect(setbackFootprint, wald.forbidden); } catch (e) { waldRemoved = null; }
      setbackFootprint = turf.difference(setbackFootprint, wald.forbidden);
    }
    const afterWaldM2raw = setbackFootprint ? T.planarAreaAnyLV95(setbackFootprint) : 0;
    if (setbackFootprint && baulinien.forbidden) {
      try { baulinienRemoved = turf.intersect(setbackFootprint, baulinien.forbidden); } catch (e) { baulinienRemoved = null; }
      setbackFootprint = turf.difference(setbackFootprint, baulinien.forbidden);
    }
    const baulinienLossM2 = Math.max(0, afterWaldM2raw - (setbackFootprint ? T.planarAreaAnyLV95(setbackFootprint) : 0));
    const footprintAfterWaldM2 = setbackFootprint ? T.planarAreaAnyLV95(setbackFootprint) : 0;
    const waldLossInFootprintM2 = Math.max(0, footprintBeforeWaldM2 - afterWaldM2raw);

    // Max. Gebäude-/Gesamtlänge. The area produced so far is where a building
    // may stand, not a building. If it is longer than one building may be, it
    // gets divided into compliant volumes -- and those, not the undivided
    // area, drive every number below. Gebäudeabstand between them = sum of
    // both required Grenzabstände (§271 PBG).
    const lengthLimitM = rules.gesamtlaenge_max_m != null
      ? rules.gesamtlaenge_max_m
      : rules.gebaeudelaenge_inkl_klein_anbauten_max_m;
    const areaRect = setbackFootprint ? T.minAreaRectangleLV95(setbackFootprint) : null;
    const lengthExceeded = !!(lengthLimitM != null && areaRect && areaRect.lengthM > lengthLimitM + 0.05);
    const gebaeudeabstandM = grundabstandUsedM * 2;
    const massing = lengthExceeded
      ? T.splitToMaxLength(setbackFootprint, lengthLimitM, gebaeudeabstandM)
      : null;
    const buildableArea = setbackFootprint;               // before division
    if (massing && massing.union && !massing.impossible) {
      setbackFootprint = massing.union;                   // after division
    }
    const footprintRect = setbackFootprint ? T.minAreaRectangleLV95(setbackFootprint) : areaRect;
    const lengthLossM2 = massing && !massing.impossible
      ? Math.max(0, footprintAfterWaldM2 - massing.totalAreaM2) : 0;

    const setbackFootprintAreaM2 = setbackFootprint ? T.planarAreaAnyLV95(setbackFootprint) : 0;
    // Entitlement is reconciled against the UNDIVIDED buildable area
    // (buildableArea), not the block union: the Gebäudeabstand gaps of the
    // length split are a placement matter, not a loss of the reference area.
    // Reconciling against the post-split union made adding a parcel REDUCE
    // the result ("mehr Land darf nie weniger Baurecht ergeben" — the
    // documented Fehler A) — the gaps ate the footprint-level constraint.
    const entitlementAreaM2 = buildableArea ? T.planarAreaAnyLV95(buildableArea) : 0;
    const reconciled = T.reconcileEnvelope({
      parcelAreaM2, anrechenbareFlaecheM2, flaechenAbzuege,
      setbackFootprintAreaM2: entitlementAreaM2, rules,
    });

    // The hull (whole footprint x full height) is the legal maximum, not a
    // buildable building. Where the Ausnützungsziffer binds it cannot be
    // filled, so derive the storeys that can actually be built and use those
    // for the 3D view and the cost.
    const massingModel = T.buildMassingModel({ footprintFeature: setbackFootprint, reconciled, rules, storeysOverride: storeys });
    if (massingModel && setbackFootprint) {
      if (massing && !massing.impossible) {
        // Length-split case (typically multi-parcel: the Gebäudelänge limit
        // is what mostly gets exceeded once several parcels are merged into
        // one long site). Each block is `band ∩ buildable area`, and unlike
        // the perpendicular BAND itself (which is a plain rectangle by
        // construction), that intersection inherits every notch the
        // Waldabstand/Grundabstand cuts left in the buildable area within
        // that band's span -- so without this, splitting one bad shape into
        // several still-bad shapes was the actual behaviour (25- and 46-
        // corner "rectangles" on the very case this feature exists for).
        // Same fix as the single-volume cuboid below, just per block: search
        // for a primitive rectangle inside each block's own region, sized to
        // that block's proportional share of the total floorplate, before
        // ever falling back to the notched intersection shape.
        //
        // Some bands are narrow enough (a tapering merged-parcel edge, say)
        // that NO rectangle wider than a sliver fits there at all -- that's
        // what an 1.8 m-wide "Baukörper" on the real Zumikon 3-parcel case
        // turned out to be: findBestRectangle correctly refused anything
        // under MIN_PRIMITIVE_WIDTH_M, but the code still fell through to
        // the raw clipped intersection for that band, which IS that thin.
        // A band that narrow at its own full (unshrunk) size isn't a
        // buildable volume in its own right, so it's dropped rather than
        // drawn -- its share of the floorplate is folded into the shortfall
        // already surfaced to the user (cuboidAreaShortfallM2 below), not
        // silently presented as a building nobody could construct.
        const survivingBlocks = massing.blocks.filter((block) => {
          const r = T.minAreaRectangleLV95(block);
          return r && r.widthM >= T.MIN_PRIMITIVE_WIDTH_M;
        });
        const usableBlocks = survivingBlocks.length ? survivingBlocks : massing.blocks;
        const droppedCount = massing.blocks.length - usableBlocks.length;
        const totalRawAreaM2 = usableBlocks.reduce((sum, b) => sum + T.planarAreaAnyLV95(b), 0);
        const totalTargetAreaM2 = massingModel.floorplateM2;
        let anyNotPrimitive = droppedCount > 0;
        let totalShortfallM2 = 0;
        const rectBlocks = usableBlocks.map((block) => {
          const blockRawAreaM2 = T.planarAreaAnyLV95(block);
          const blockTargetM2 = totalRawAreaM2 > 0 ? totalTargetAreaM2 * (blockRawAreaM2 / totalRawAreaM2) : 0;
          const blockRect = T.minAreaRectangleLV95(block);
          if (!blockRect || blockTargetM2 <= 0) return block;
          const best = T.findBestRectangle(block, blockTargetM2, blockRect.ang, blockRect.lengthM, blockRect.widthM);
          if (best) {
            totalShortfallM2 += Math.max(0, blockTargetM2 - best.achievedAreaM2);
            return best.rect;
          }
          anyNotPrimitive = true;
          const scale = Math.sqrt(Math.min(1, blockTargetM2 / blockRawAreaM2));
          let shrunk = T.scalePartsLV95(block, scale);
          if (!turf.booleanWithin(shrunk, block)) {
            const clipped = (() => { try { return turf.intersect(shrunk, block); } catch (e) { return null; } })();
            if (clipped) shrunk = clipped;
          }
          return shrunk;
        });
        // The fallback is the belt to massing.js's braces: an empty block
        // list reduces to null, and a null footprint reaches three renderers
        // that all dereference .geometry. Nothing downstream is prepared for
        // it, so it never leaves this function.
        massingModel.footprintFeature = rectBlocks.reduce(
          (acc, b) => (acc ? (() => { try { return turf.union(acc, b); } catch (e) { return acc; } })() : b), null
        ) || setbackFootprint;
        massingModel.cuboidNotPrimitive = anyNotPrimitive;
        massingModel.cuboidAreaShortfallM2 = totalShortfallM2;
        massingModel.droppedBlockCount = droppedCount;
      } else {
        // A single undivided volume gets built as an actual 4-facade cuboid,
        // not a uniformly-shrunk copy of the buildable area's own outline --
        // that outline can be a notched, many-sided polygon (Grundabstand cut
        // by Waldabstand, say), and nothing requires a real building to trace
        // it. This is a volumetric study, so a primitive box beats a shape
        // that happens to match the site: findBestRectangle tries a spread of
        // aspect ratios and both orientations before conceding, which matters
        // most exactly where a single fixed ratio is most likely to fail --
        // e.g. 1 Vollgeschoss needs roughly double the floorplate of 2, and
        // that bigger box is the one least likely to fit the natural ratio
        // anywhere in an irregular buildable area. Clipping (producing a
        // notched shape again, just smaller) is only the last resort if
        // truly nothing fits. Dragging (see viewer.js) is there to fix
        // placement by hand either way.
        // The true required area is floorplateM2 -- NOT areaRect's own
        // (bounding-rectangle) area scaled down, which is systematically
        // too big whenever the buildable area is notched (a rectangle
        // circumscribes a concave polygon, so rectangle area > polygon
        // area always). Using that inflated figure as the search target
        // silently over-built the box and threw off the shortfall math
        // used for the flag below. areaRect is still used for its ratio
        // (lengthM:widthM) and angle -- just not its absolute size.
        const targetAreaM2 = massingModel.floorplateM2;
        const best = buildableArea
          ? T.findBestRectangle(buildableArea, targetAreaM2, areaRect.ang, areaRect.lengthM, areaRect.widthM)
          : null;
        let cuboid = best ? best.rect : null;
        // findBestRectangle already tried shrinking the box before giving up
        // entirely -- this is the true last resort, and it produces the
        // notched shape a primitive box was meant to avoid, so it's flagged
        // (cuboidNotPrimitive) rather than silently accepted.
        let cuboidNotPrimitive = false;
        if (!cuboid) {
          cuboidNotPrimitive = true;
          const rectFeature = turf.polygon([areaRect.corners]);
          cuboid = T.scalePartsLV95(rectFeature, massingModel.linearScale);
          if (buildableArea && !turf.booleanWithin(cuboid, buildableArea)) {
            const clipped = (() => { try { return turf.intersect(cuboid, buildableArea); } catch (e) { return null; } })();
            if (clipped) cuboid = clipped;
          }
        }
        massingModel.footprintFeature = cuboid;
        massingModel.cuboidNotPrimitive = cuboidNotPrimitive;
        // If the box had to give up some area to stay a primitive rectangle,
        // say so rather than silently under-delivering the reported GFA --
        // gfaUsedM2/floorplateM2 stay as computed (they're the binding legal
        // figures), this only notes that the DRAWING is a schematic
        // approximation of them.
        massingModel.cuboidAreaShortfallM2 = best ? Math.max(0, targetAreaM2 - best.achievedAreaM2) : 0;
      }

      // Attikageschoss geometry (Art. 31 BZO Zumikon): a real inset
      // footprint, not the same outline as the storey below. One rectangle
      // per Baukörper, since each already has its own centre/angle/L/W now
      // that both branches above always build rectangles.
      // computeAttikaFootprints is shared with viewer.js's live drag update
      // (and the 2D plan drag below) so the Attika can't drift out of sync
      // with how it was originally built when the building is moved.
      if (massingModel.attikaStoreys > 0) {
        const blocks = massingModel.footprintFeature.geometry.type === 'Polygon'
          ? [massingModel.footprintFeature]
          : massingModel.footprintFeature.geometry.coordinates.map((pc) => turf.polygon(pc));
        // Art. 31 Abs. 1: the 45° plane may start up to `attika_profil_
        // ueberhoehung_m` (1 m in Zumikon) ABOVE the intersection line, so
        // the required horizontal Rücksprung is the Attika height MINUS that
        // allowance — not the full storey height. Where no such rule is on
        // file (Zürich), the full height is used, conservatively.
        const ueberhoehungM = (rules.meta && rules.meta.attika_profil_ueberhoehung_m) || 0;
        const setbackM = Math.max(0, massingModel.attikaStoreyHeightM - ueberhoehungM);
        // Art. 31 Abs. 2: hangseitig fassadenbündig is allowed when the
        // zulässige Gebäudehöhe is kept on that side INCLUDING the Attika —
        // a height condition, not a slope threshold. On the uphill facade the
        // gewachsener Boden is higher by (slope × building depth), so the
        // condition holds when that terrain rise covers the Attika's own
        // height. (The former flat "≥10% slope" gate was a tool invention.)
        let hangUphillBearingDeg = null;
        let bergseiteRiseM = null;
        if (hang && hang.slopePercent > 0) {
          const blockRect = blocks.length ? T.minAreaRectangleLV95(blocks[0]) : null;
          const depthM = blockRect ? Math.min(blockRect.lengthM, blockRect.widthM) : 0;
          bergseiteRiseM = (hang.slopePercent / 100) * depthM;
          if (bergseiteRiseM >= massingModel.attikaStoreyHeightM - 1e-6) {
            hangUphillBearingDeg = hang.uphillBearingDeg;
          }
        }
        massingModel.bergseiteRiseM = bergseiteRiseM;
        massingModel.attikaUeberhoehungM = ueberhoehungM;
        const attikaResult = T.computeAttikaFootprints(blocks, setbackM, hangUphillBearingDeg);
        massingModel.attikaBlocks = attikaResult.attikaBlocks; // one per base block, same order, null = no room there
        massingModel.attikaSetbackM = setbackM;
        massingModel.attikaFootplateM2 = attikaResult.attikaAreaM2;
        massingModel.attikaRequestedM2 = attikaResult.requestedAreaM2;
        massingModel.attikaGeometryImpossible = attikaResult.anyImpossible;
        massingModel.attikaDiagnostics = attikaResult.diagnostics;
        massingModel.hangUphillBearingDeg = hangUphillBearingDeg;
        massingModel.hang = hang || null;
      }
    }

    return { setbackFootprint, footprintBeforeWaldM2, waldRemoved, baulinienRemoved, baulinienLossM2,
             footprintAfterWaldM2, waldLossInFootprintM2, lengthLimitM, areaRect, lengthExceeded,
             gebaeudeabstandM, massing, buildableArea, footprintRect, lengthLossM2,
             setbackFootprintAreaM2, reconciled, massingModel, hasDirectional, chosenIdx,
             chosenIndices, grundabstandUsedM };
    }; // end computePass

    let pass = computePass(rules.grundabstand_min_m);

    // Mehrlängenzuschlag (Art. 14 BZO 2016): measure the longest facade of
    // what was actually drawn, and if it exceeds the 12 m threshold, run the
    // derivation once more with the increased Grenzabstand.
    if (mlz && pass.massingModel && pass.massingModel.footprintFeature) {
      const f = pass.massingModel.footprintFeature;
      const blocks = f.geometry.type === 'Polygon' ? [f] : f.geometry.coordinates.map((pc) => turf.polygon(pc));
      let longestFacadeM = 0;
      for (const b of blocks) {
        const r = T.minAreaRectangleLV95(b);
        if (r) longestFacadeM = Math.max(longestFacadeM, r.lengthM);
      }
      if (longestFacadeM > mlz.ab_fassadenlaenge_m + 0.05) {
        const requiredM = Math.min(
          mlz.grenzabstand_max_m,
          rules.grundabstand_min_m + (longestFacadeM - mlz.ab_fassadenlaenge_m) * mlz.anteil_der_mehrlaenge
        );
        if (requiredM > rules.grundabstand_min_m + 0.01) {
          pass = computePass(requiredM);
          pass.mehrlaengen = {
            facadeLengthM: longestFacadeM,
            baseM: rules.grundabstand_min_m,
            requiredM,
            capM: mlz.grenzabstand_max_m,
          };
        }
      }
    }
    if (!pass.mehrlaengen) pass.mehrlaengen = null;
    return pass;
  }

  // Per-parcel ÖREB extracts are immutable within a session — adding a third
  // parcel to a selection must not re-fetch the first two.
  const oerebCache = new Map();
  function fetchOerebCached(egrid) {
    if (!oerebCache.has(egrid)) {
      const p = T.fetchOerebExtract(egrid);
      p.catch(() => oerebCache.delete(egrid)); // don't cache failures
      oerebCache.set(egrid, p);
    }
    return oerebCache.get(egrid);
  }

  // selection: array of parcels from parcel-selector.js, each with
  // geometryLV95 / egrid / parcelNumber / zone / rules. One entry = plain
  // single-parcel case; several = merged case.
  async function analyse(selection) {
    const anchor = selection[0];
    const rules = anchor.rules;
    const rulesData = rules.meta;

    // Union first, then measure -- so overlapping or shared-edge geometry is
    // counted once, not double.
    const polygons = selection.map((p) => T.parcelToTurfPolygon(p.geometryLV95));
    const merged = polygons.reduce((acc, poly) => turf.union(acc, poly));
    const isSingleShape = merged.geometry.type === 'Polygon';
    const parcelAreaM2 = T.planarAreaAnyLV95(merged);

    // Waldabstand is a real geometric constraint, computed and subtracted --
    // not just flagged. The Grundabstand is measured from the parcel edge and
    // the Waldabstandslinie is an independent limit, so both apply: buffer
    // inward first, then cut away whatever falls on the forest side.
    // The terrain grid does double duty: the plane fit through it decides
    // Hanglage (and which way is uphill, for the Attika Bergseite exception),
    // and the same samples draw the Höhenlinien on the plan. 7x7 over the
    // parcel bbox is 49 requests -- enough to resolve the local fall line on a
    // typical plot without making the analysis wait noticeably.
    const bb = turf.bbox(merged);
    // Every upstream source degrades individually instead of killing the
    // whole analysis: a failed WFS layer or ÖREB call becomes a warning flag
    // and its constraint is reported as "nicht prüfbar", never as a silent
    // pass and never as a dead analysis.
    const degraded = [];
    const [wald, baulinien, terrainGrid] = await Promise.all([
      T.computeWaldabstand(merged).catch((e) => {
        degraded.push(`Waldabstand konnte nicht geprüft werden (${e.message || e}). Der Fussabdruck ist OHNE Waldabstands-Abzug gerechnet — manuell prüfen.`);
        return { applies: false, forbidden: null, lostAreaM2: 0, failed: true };
      }),
      T.computeBaulinien(merged).catch((e) => {
        degraded.push(`Baulinien konnten nicht geprüft werden (${e.message || e}). Der Fussabdruck ist OHNE Baulinien-Abzug gerechnet — manuell prüfen.`);
        return { applies: false, forbidden: null, lostAreaM2: 0, failed: true };
      }),
      T.sampleTerrainGrid(bb[0], bb[1], bb[2], bb[3], 7, 7).catch(() => null),
    ]);
    const slope = terrainGrid ? T.fitTerrainSlope(terrainGrid.points) : null;
    const hang = slope ? { ...slope, isHang: slope.slopePercent >= 10 } : null;

    // Anrechenbare Grundstücksfläche (§ 255/259 PBG bzw. § 259 aPBG):
    // forest inside the parcel does not count toward the AZ/ÜZ/GFZ reference
    // area (old law: "Wald ... fallen ausser Ansatz"; harmonised law: forest
    // is not Bauzone). Open water and non-Bauzone parts are NOT auto-detected
    // — reported as unchecked in the flags.
    let flaechenAbzuege = { waldM2: 0, waldChecked: !wald.failed, gewaesserChecked: false, andereZoneChecked: false };
    if (wald.forest && wald.forest.length) {
      try {
        const forestUnion = wald.forest
          .map((ff) => ff)
          .reduce((acc, ff) => (acc ? turf.union(acc, ff) : ff), null);
        const forestInParcel = forestUnion ? turf.intersect(merged, forestUnion) : null;
        if (forestInParcel) flaechenAbzuege.waldM2 = T.planarAreaAnyLV95(forestInParcel);
      } catch (e) { /* keep 0, the flag reports water/zones as unchecked anyway */ }
    }
    const anrechenbareFlaecheM2 = Math.max(0, parcelAreaM2 - flaechenAbzuege.waldM2);

    // A new shape invalidates any facade the user had picked by hand.
    southFacadeIndex = null;
    const facadeEdges = T.pickSouthFacade(merged, rules.grosser_grenzabstand_suedseiten || 1);

    const derived = deriveFootprint({
      merged, parcelAreaM2, anrechenbareFlaecheM2, flaechenAbzuege, rules, wald, baulinien, facadeEdges,
      southFacadeIdx: southFacadeIndex, storeys: storeyChoice, hang,
    });
    // deriveFootprint resolves "null = use the suggestion" down to an actual
    // edge index (derived.chosenIdx) -- feed that back so the rest of the
    // app (the flag text, the floor plan's highlighted edge) sees the real
    // index instead of the still-unresolved null.
    southFacadeIndex = derived.chosenIdx;

    const [terrainHeight, restrictionsPerParcel] = await Promise.all([
      T.getTerrainHeight(anchor.easting, anchor.northing).catch(() => null),
      Promise.all(selection.map((p) => fetchOerebCached(p.egrid).then(
        (extract) => T.checkFootprintRestrictions(extract),
        (e) => {
          degraded.push(`ÖREB-Kataster für Parzelle ${p.parcelNumber || p.egrid} nicht erreichbar (${e.message || e}) — Waldabstand/Gewässerraum/Baulinien-Betroffenheit nicht prüfbar.`);
          return { waldabstand: { concerned: false }, gewaesserraum: { concerned: false }, baulinien: { concerned: false }, failed: true };
        }
      ))),
    ]);
    // Any parcel in the selection being affected affects the whole site.
    const oerebFailed = restrictionsPerParcel.some((r) => r.failed);
    const agg = (key) => ({
      concerned: restrictionsPerParcel.some((r) => r[key].concerned),
      unchecked: oerebFailed || restrictionsPerParcel.some((r) => r[key].unknown),
    });
    const restrictions = {
      waldabstand: agg('waldabstand'),
      gewaesserraum: agg('gewaesserraum'),
      baulinien: agg('baulinien'),
    };

    const checklist = await T.buildChecklist({ parcelPolygon: merged, restrictions, rules, gemeinde: rules.gemeinde, bfsNr: anchor.bfsNr, wald, waldLossInFootprintM2: derived.waldLossInFootprintM2, baulinien, baulinienLossM2: derived.baulinienLossM2 })
      .catch((e) => {
        degraded.push(`Checkliste unvollständig: ${e.message || e}`);
        return { tierA: [], tierB: [{ status: 'warn', label: 'Checkliste', text: 'Konnte nicht vollständig erstellt werden — Datenquelle nicht erreichbar. Manuell prüfen.' }] };
      });

    return { selection, anchor, rules, rulesData, merged, isSingleShape, parcelAreaM2,
             anrechenbareFlaecheM2, flaechenAbzuege, degraded,
             mehrlaengen: derived.mehrlaengen, grundabstandUsedM: derived.grundabstandUsedM,
             chosenIndices: derived.chosenIndices,
             reconciled: derived.reconciled, terrainHeight, restrictions, checklist, wald, baulinien,
             facadeEdges, southFacadeIndex, terrainGrid, hang,
             waldLossInFootprintM2: derived.waldLossInFootprintM2, footprintBeforeWaldM2: derived.footprintBeforeWaldM2,
             waldRemoved: derived.waldRemoved, lengthLimitM: derived.lengthLimitM, footprintRect: derived.footprintRect,
             lengthExceeded: derived.lengthExceeded, massing: derived.massing, buildableArea: derived.buildableArea,
             footprintAfterWaldM2: derived.footprintAfterWaldM2, lengthLossM2: derived.lengthLossM2,
             gebaeudeabstandM: derived.gebaeudeabstandM, areaRect: derived.areaRect,
             massingModel: derived.massingModel, baulinienRemoved: derived.baulinienRemoved,
             baulinienLossM2: derived.baulinienLossM2, setbackFootprint: derived.setbackFootprint,
             hasDirectional: derived.hasDirectional };
  }

  // Kept separate so a tab switch can redraw it: three.js sizes the canvas
  // from the container, which is zero while the pane is hidden.
  const viewerHintEl = document.getElementById('viewer-hint');
  const floorplanEl = document.getElementById('floorplan');
  const floorplanLegendEl = document.getElementById('floorplan-legend');

  // Pan (drag) and zoom (wheel) for the floor plan SVG, matching the
  // isometric view's interaction model. Manipulates the SVG's own viewBox
  // rather than a CSS transform, so it stays crisp (no raster scaling) and
  // the plan's own coordinate system (already metres-to-pixels via the scale
  // computed in floorplan.js) keeps working unmodified for anything that
  // reads screen positions off it. Re-attached on every render since
  // floorplanEl.innerHTML is replaced wholesale each time.
  function enablePlanPanZoom(container) {
    const svg = container.querySelector('svg');
    if (!svg) return;
    const [vx0, vy0, vw0, vh0] = svg.getAttribute('viewBox').split(/\s+/).map(Number);
    let vx = vx0, vy = vy0, vw = vw0, vh = vh0;
    const MIN_W = vw0 * 0.06, MAX_W = vw0; // zoom in to ~6%, never zoom out past the original fit
    const apply = () => svg.setAttribute('viewBox', `${vx} ${vy} ${vw} ${vh}`);

    // Client-pixel -> SVG-user-unit point, accounting for the current pan/zoom.
    const toSvgPoint = (clientX, clientY) => {
      const rect = svg.getBoundingClientRect();
      return [vx + ((clientX - rect.left) / rect.width) * vw, vy + ((clientY - rect.top) / rect.height) * vh];
    };

    svg.style.cursor = 'grab';
    svg.style.touchAction = 'none';
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [px, py] = toSvgPoint(e.clientX, e.clientY);
      const factor = e.deltaY < 0 ? 0.88 : 1 / 0.88;
      const newW = Math.max(MIN_W, Math.min(MAX_W, vw * factor));
      const scale = newW / vw;
      // Keep the point under the cursor fixed while the box scales.
      vx = px - (px - vx) * scale;
      vy = py - (py - vy) * scale;
      vw = newW;
      vh = vh * scale;
      apply();
    }, { passive: false });

    let dragging = false, lastX = 0, lastY = 0;
    svg.addEventListener('pointerdown', (e) => {
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      svg.style.cursor = 'grabbing';
      try { svg.setPointerCapture(e.pointerId); } catch (err) { /* no active pointer (e.g. synthetic events) -- drag still works via svg-level move */ }
    });
    svg.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const rect = svg.getBoundingClientRect();
      vx -= ((e.clientX - lastX) / rect.width) * vw;
      vy -= ((e.clientY - lastY) / rect.height) * vh;
      lastX = e.clientX; lastY = e.clientY;
      apply();
    });
    const stop = (e) => {
      dragging = false; svg.style.cursor = 'grab';
      try { if (e.pointerId != null && svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    };
    svg.addEventListener('pointerup', stop);
    svg.addEventListener('pointercancel', stop);
    // Quick way back to the fitted view without hunting for a reset button.
    const reset = () => { vx = vx0; vy = vy0; vw = vw0; vh = vh0; apply(); };
    svg.addEventListener('dblclick', reset);

    // Zoom the centre of the current view by `factor` -- what the +/- buttons
    // do, since they have no cursor position to anchor on the way the wheel
    // handler does.
    const zoomCentre = (factor) => {
      const cx = vx + vw / 2, cy = vy + vh / 2;
      const newW = Math.max(MIN_W, Math.min(MAX_W, vw * factor));
      const s = newW / vw;
      vw = newW; vh = vh * s;
      vx = cx - vw / 2; vy = cy - vh / 2;
      apply();
    };

    const bar = document.createElement('div');
    bar.className = 'plan-zoom';
    bar.innerHTML = '<button type="button" data-z="in" title="Vergrössern">+</button>'
      + '<button type="button" data-z="out" title="Verkleinern">−</button>'
      + '<button type="button" data-z="fit" title="Ganze Parzelle zeigen">⤢</button>';
    bar.addEventListener('click', (e) => {
      const z = e.target.dataset && e.target.dataset.z;
      if (z === 'in') zoomCentre(0.75);
      else if (z === 'out') zoomCentre(1 / 0.75);
      else if (z === 'fit') reset();
    });
    container.appendChild(bar);
  }

  // Split out so the drag-to-move handler (below) can refresh just the plan
  // after moving the building, without re-running renderViewer (which would
  // rebuild the whole three.js scene) or the full analysis.
  function renderFloorPlan(r) {
    if (!r.setbackFootprint) { floorplanEl.innerHTML = ''; floorplanLegendEl.textContent = ''; return; }
    // `mm && mm.footprintFeature`, not just `mm`: a massing model can exist
    // (the areas and the GFA are computed) while no Baukörper could be
    // drawn. That has to fall back to plotting the buildable area itself,
    // not throw -- the numbers are still worth showing.
    const mm = r.massingModel;
    const drawnFootprint = mm && mm.footprintFeature ? mm.footprintFeature : null;
    const footprintFeature = drawnFootprint || r.setbackFootprint;
    const blocks = drawnFootprint
      ? (drawnFootprint.geometry.type === 'Polygon'
          ? [drawnFootprint]
          : drawnFootprint.geometry.coordinates.map((pc) => turf.polygon(pc)))
      : null;
    // Dragging is per block (see enablePlanBuildingDrag below), so it's
    // available whenever there's a massing model at all -- not just for a
    // single undivided volume.
    const draggableHere = !!(mm && mm.storeyOptions);
    const builtAreaM2ForHull = footprintFeature ? T.planarAreaAnyLV95(footprintFeature) : 0;
    floorplanEl.innerHTML = T.buildFloorPlanSvg({
      parcelFeature: r.merged,
      footprintFeature,
      // The full legal envelope (pre-cuboid, pre-split) -- shown so it's
      // visible on the plan, not only in 3D, where the Baukörper could be
      // placed. Only worth drawing separately from the Baukörper itself
      // when it's actually bigger than what's built.
      hullFeature: r.buildableArea && T.planarAreaAnyLV95(r.buildableArea) > builtAreaM2ForHull * 1.02 ? r.buildableArea : null,
      removedFeature: r.waldRemoved,
      // The area-rectangle overlay only earns its place on the drawing when
      // the length constraint actually did something (forced a split, or
      // couldn't be satisfied) -- for an ordinary compliant single cuboid
      // it would just duplicate the facade-length labels already on the
      // building itself.
      lengthRect: r.lengthExceeded ? (r.massing && !r.massing.impossible ? r.areaRect : r.footprintRect) : null,
      lengthLimitM: r.lengthLimitM,
      lengthResolved: !!(r.massing && !r.massing.impossible),
      blockCount: r.massing ? r.massing.count : 0,
      blocks,
      facadeEdges: r.hasDirectional ? r.facadeEdges : null,
      southFacadeIndex: r.hasDirectional ? r.southFacadeIndex : null,
      grosserGrenzabstandM: r.rules.grosser_grenzabstand_min_m,
      dragEnabled: draggableHere,
      dark: isDark(),
      terrainGrid: r.terrainGrid,
      hang: r.hang,
      widthPx: 900, heightPx: 640,
    });
    // Clicking a boundary edge picks it as the Hauptfassade -- overrides the
    // automatic south-facing suggestion without re-running the async parts
    // of the analysis (see rerenderWithChoices).
    if (r.hasDirectional) {
      floorplanEl.querySelectorAll('.facade-edge').forEach((el) => {
        el.addEventListener('click', () => {
          southFacadeIndex = Number(el.dataset.facadeIndex);
          rerenderWithChoices();
        });
      });
    }
    enablePlanPanZoom(floorplanEl);
    if (draggableHere) {
      enablePlanBuildingDrag(floorplanEl, r);
    }
    const wholeAreaM2 = r.footprintAfterWaldM2;
    const builtAreaM2 = footprintFeature ? T.planarAreaAnyLV95(footprintFeature) : 0;
    // Data only -- the how-to-interact sentence that used to live here read
    // like a cookie-consent banner sitting under the drawing. Interaction
    // hints are a hover tooltip on the plan itself instead (title attribute,
    // below), not permanent on-screen text.
    floorplanLegendEl.innerHTML =
      `<b>${fmt(wholeAreaM2)} m²</b> bebaubare Grundfläche (Baukörper: ${fmt(builtAreaM2)} m²)` +
      (r.waldLossInFootprintM2 > 0.5 ? ` · <span style="color:#c62828">schraffiert: ${fmt(r.waldLossInFootprintM2)} m² durch Waldabstand entfallen</span>` : '') +
      (r.hasDirectional ? ` · Hauptfassade im Grundriss anklickbar` : '');
    const svgEl = floorplanEl.querySelector('svg');
    if (svgEl) {
      svgEl.querySelector('title')?.remove();
      const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      titleEl.textContent = `Zum Zoomen scrollen, Hintergrund zum Verschieben ziehen${draggableHere ? ', Baukörper (je einzeln) direkt ziehen zum Verschieben' : ''}, Doppelklick setzt zurück. Fenster unten rechts vergrösserbar.`;
      svgEl.prepend(titleEl);
    }
  }

  // Drag a Baukörper directly on the plan, mirroring the 3D view's
  // drag-to-move: per block, translated within buildableArea, checked
  // against every OTHER block (buffered by the cantonal Gebäudeabstand, so
  // dragging one can't close the mandated gap to a neighbour or overlap it),
  // synced to the 3D view (and the plan's own dimension lines) on release.
  // Reads the SVG's own E/N<->pixel transform back from the data-*
  // attributes floorplan.js wrote, so this needs no knowledge of how that
  // transform is built.
  //
  // Pointer capture and the move/up listeners live on `container` (the
  // outer div, never replaced) rather than the <svg> (which IS replaced by
  // every renderFloorPlan call) -- captured pointer events keep routing to
  // whatever element captured them regardless of what happens to the DOM
  // under the cursor, so this survives the live path update below even
  // though nothing about the SVG itself is being rebuilt mid-drag. Rebuilding
  // the full plan (and its dimension lines) on every pointermove would also
  // destroy that capture, which is why only the dragged block's `d` updates
  // live and the rest catches up once, on release.
  let planDrag = null;
  function wirePlanDragOnce(container) {
    if (container.dataset.dragWired) return;
    container.dataset.dragWired = '1';
    container.style.touchAction = 'none';
    container.addEventListener('pointermove', (e) => {
      if (!planDrag) return;
      const [e2, n2] = planDrag.toLV95(e.clientX, e.clientY);
      const candidate = T.translateLV95(planDrag.original, e2 - planDrag.start[0], n2 - planDrag.start[1]);
      if (!turf.booleanWithin(candidate, planDrag.r.buildableArea)) return; // reject past the boundary, don't clamp
      const others = planDrag.allBlocks.filter((_, i) => i !== planDrag.blockIndex);
      if (others.length) {
        const gapM = planDrag.r.gebaeudeabstandM || 0;
        const checkArea = gapM > 0 ? T.bufferLV95(candidate, gapM) : candidate;
        if (checkArea && others.some((o) => !turf.booleanDisjoint(checkArea, o))) return;
      }
      const newBlocks = planDrag.allBlocks.map((b, i) => (i === planDrag.blockIndex ? candidate : b));
      const merged = newBlocks.reduce((acc, b) => {
        if (!acc) return b;
        try { return turf.union(acc, b); } catch (err) { return acc; }
      }, null);
      const mm = { ...planDrag.r.massingModel, footprintFeature: merged };
      // The Attika sits on top of a specific block, so moving that block has
      // to move its Attika with it -- otherwise the 3D view (which redraws
      // from this model on release) shows the Attika floating over the old
      // position. Same shared function the initial build and the 3D drag use.
      if (mm.attikaStoreys > 0) {
        const re = T.computeAttikaFootprints(newBlocks, mm.attikaSetbackM ?? mm.attikaStoreyHeightM, mm.hangUphillBearingDeg ?? null);
        mm.attikaBlocks = re.attikaBlocks;
        mm.attikaFootplateM2 = re.attikaAreaM2;
        mm.attikaGeometryImpossible = re.anyImpossible;
      }
      planDrag.r.massingModel = mm;
      planDrag.pathEl.setAttribute('d', planDrag.buildPathD(candidate));
    });
    const stop = (e) => {
      if (!planDrag) return;
      const { r } = planDrag;
      try { if (e.pointerId != null && container.hasPointerCapture(e.pointerId)) container.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      planDrag = null;
      renderFloorPlan(r); // dimension lines, clearances etc. catch up now
      renderViewer(r);
    };
    container.addEventListener('pointerup', stop);
    container.addEventListener('pointercancel', stop);
  }

  function enablePlanBuildingDrag(container, r) {
    wirePlanDragOnce(container);
    const svg = container.querySelector('svg');
    if (!svg) return;
    const scale = Number(svg.dataset.scale), minE = Number(svg.dataset.minE), minN = Number(svg.dataset.minN);
    const offX = Number(svg.dataset.offX), offY = Number(svg.dataset.offY), heightPx = Number(svg.dataset.heightPx);

    // Client pixel -> SVG user-space (accounting for the current pan/zoom
    // viewBox) -> real LV95 (E, N), inverting floorplan.js's own px().
    const toLV95 = (clientX, clientY) => {
      const rect = svg.getBoundingClientRect();
      const vb = svg.getAttribute('viewBox').split(/\s+/).map(Number);
      const sx = vb[0] + ((clientX - rect.left) / rect.width) * vb[2];
      const sy = vb[1] + ((clientY - rect.top) / rect.height) * vb[3];
      return [minE + (sx - offX) / scale, minN + (heightPx - offY - sy) / scale];
    };
    const px = ([e, n]) => [offX + (e - minE) * scale, heightPx - offY - (n - minN) * scale];
    const buildPathD = (feature) => {
      const rings = feature.geometry.type === 'Polygon' ? feature.geometry.coordinates : feature.geometry.coordinates.flat(1);
      return rings.map((ring) => 'M' + ring.map((c) => px(c).map((v) => v.toFixed(1)).join(',')).join('L') + 'Z').join(' ');
    };
    // Every block, in its current position -- indexed the same way the
    // .baukoerper-path elements are (floorplan.js's data-block-index), so
    // dragging one can find and check against the others.
    const blocksNow = () => {
      const f = r.massingModel && r.massingModel.footprintFeature;
      if (!f) return [];
      return f.geometry.type === 'Polygon' ? [f] : f.geometry.coordinates.map((pc) => turf.polygon(pc));
    };

    svg.querySelectorAll('.baukoerper-path').forEach((pathEl) => {
      pathEl.addEventListener('pointerdown', (e) => {
        const allBlocks = blocksNow();
        const blockIndex = Number(pathEl.dataset.blockIndex);
        planDrag = {
          start: toLV95(e.clientX, e.clientY),
          original: allBlocks[blockIndex],
          blockIndex, allBlocks,
          r, toLV95, buildPathD, pathEl,
        };
        try { container.setPointerCapture(e.pointerId); } catch (err) { /* no active pointer (e.g. synthetic events) -- drag still works via container-level move */ }
        e.stopPropagation(); // don't also start the background pan
      });
    });
  }

  function renderViewer(r) {
    if (!r.setbackFootprint) {
      viewerEl.innerHTML = '<p style="padding:1rem;color:#c62828;">Kein Volumen darstellbar.</p>';
      return;
    }
    if (!viewerEl.clientWidth) return;
    const mm = r.massingModel;
    T.renderEnvelope(viewerEl, {
      footprintFeature: r.setbackFootprint,
      parcelFeature: r.merged,
      removedFeature: r.waldRemoved,
      heightM: r.rules.heightM,
      massing: mm,
      interactive: true,
      dark: isDark(),
      // Dragging works per block now (viewer.js), so a Gebäudelänge split
      // into several Baukörper no longer disables it -- each block is
      // grabbed and moved independently, checked against both the buildable
      // area and its neighbours (blockGapM below).
      draggable: !!(mm && mm.storeyOptions),
      buildableArea: r.buildableArea,
      blockGapM: r.gebaeudeabstandM || 0,
      // viewer.js recomputes the Attika footprints live while a block is
      // dragged (otherwise the Attika volume stays behind, floating over
      // where the building used to be) and hands the updated massing back
      // here -- take it wholesale rather than only the moved outline.
      onMove: (movedFootprint, liveMassing) => {
        r.massingModel = liveMassing
          ? { ...liveMassing, footprintFeature: movedFootprint }
          : { ...r.massingModel, footprintFeature: movedFootprint };
        renderFloorPlan(r);
      },
    });
    // Same "is the ghost actually drawn" threshold as viewer.js -- explains
    // the pale volume in the scene instead of leaving it unlabelled.
    const ghostShown = mm && (mm.footprintScale < 0.97 || mm.buildingHeightM < r.rules.heightM - 0.05);
    const multiBlock = !!(r.massing && r.massing.count > 1);
    const dragHint = mm && mm.storeyOptions
      ? ` Den Baukörper${multiBlock ? ' (bei mehreren: den jeweiligen)' : ''} direkt anfassen und ziehen, um ihn innerhalb der Hülle zu verschieben. Shift+Ziehen verschiebt stattdessen den Bildausschnitt.`
      : '';
    viewerHintEl.textContent = 'Zum Drehen ziehen, zum Zoomen scrollen.' + dragHint
      + (ghostShown ? ' Das helle, transparente Volumen ist die maximal zonenrechtlich zulässige Hülle (ganzer Fussabdruck × maximale Höhe) — dort darf der Baukörper stehen; der farbige Teil ist, was bei der gewählten Geschosszahl tatsächlich gebaut wird.' : '');
  }

  // Recompute only the massing (geometry + cost depend on it) and redraw.
  // Both storey and facade choices only touch the synchronous geometry
  // chain -- the async Wald/Baulinien/ÖREB calls are cached on lastResult
  // and reused rather than re-fetched.
  function rerenderWithChoices() {
    if (!lastResult) return;
    const r = lastResult;
    const derived = deriveFootprint({
      merged: r.merged, parcelAreaM2: r.parcelAreaM2,
      anrechenbareFlaecheM2: r.anrechenbareFlaecheM2, flaechenAbzuege: r.flaechenAbzuege,
      rules: r.rules, wald: r.wald, baulinien: r.baulinien,
      facadeEdges: r.facadeEdges, southFacadeIdx: southFacadeIndex, storeys: storeyChoice, hang: r.hang,
    });
    southFacadeIndex = derived.chosenIdx;
    Object.assign(r, derived, { southFacadeIndex });
    render(r);
    // The checklist quotes wald/baulinien losses *within the footprint*,
    // which change with the facade choice — recompute it async so it can't
    // go stale against the numbers table (it used to).
    T.buildChecklist({
      parcelPolygon: r.merged, restrictions: r.restrictions, rules: r.rules, gemeinde: r.rules.gemeinde,
      bfsNr: r.anchor && r.anchor.bfsNr,
      wald: r.wald, waldLossInFootprintM2: derived.waldLossInFootprintM2,
      baulinien: r.baulinien, baulinienLossM2: derived.baulinienLossM2,
    }).then((checklist) => {
      if (lastResult !== r) return; // a full re-analysis replaced this result meanwhile
      r.checklist = checklist;
      checklistEl.innerHTML =
        `<div class="checklist-tier tier-a"><h3>Tier A — automatisch berechnet (eindeutig)</h3>${renderChecklistTier(checklist.tierA)}</div>` +
        `<div class="checklist-tier tier-b"><h3>Tier B — Vorhandensein automatisch erkannt, Inhalt manuell zu prüfen</h3>${renderChecklistTier(checklist.tierB)}</div>`;
    }).catch(() => { /* keep the previous checklist rather than blanking it */ });
  }

  function renderChecklistTier(items) {
    // label/text carry WFS-sourced strings (Objektbezeichnungen etc.) — escape.
    return items
      .map((i) => `<div class="checklist-item ${esc(i.status)}"><span class="badge">${esc(i.status).toUpperCase()}</span><span><strong>${esc(i.label)}:</strong> ${esc(i.text)}</span></div>`)
      .join('');
  }

  function render(r) {
    const { selection, anchor, rules, rulesData, merged, isSingleShape,
            setbackFootprint, reconciled, terrainHeight, restrictions, checklist } = r;
    const multi = selection.length > 1;

    versionBannerEl.textContent =
      `${rules.gemeinde} — Basis: ${rulesData.version}, ${rulesData.article_grundmasse} — Daten zuletzt geprüft: ${rulesData.data_last_verified}`;

    bindingSummaryEl.className = reconciled.usableFootprintAreaM2 <= 0 ? 'binding zero' : 'binding';
    const mm = r.massingModel;
    bindingSummaryEl.textContent = reconciled.usableFootprintAreaM2 <= 0 || !mm
      ? `Kein bebaubares Volumen: Grundabstand und/oder Grünflächenziffer beanspruchen die gesamte Fläche. Bindend: ${BINDING_LABELS[reconciled.bindingConstraint]}.`
      : `${storeyCountLabel(mm.ordinaryStoreys, mm.attikaStoreys)} à ${fmt(mm.floorplateM2)} m² — `
        + `${fmt(mm.gfaUsedM2)} m² Geschossfläche. Bindend: ${BINDING_LABELS[reconciled.bindingConstraint]}.`;

    const storeySelEl = document.getElementById('storey-select');
    if (mm && mm.storeyOptions.length > 1) {
      storeySelEl.style.display = 'block';
      const attikaNote = mm.attikaMax > 0
        ? ` Ein zusätzliches Attikageschoss ist zonenrechtlich möglich (max. 1 pro Gebäude als Attika dargestellt) — mit Rücksprung nach dem 45°-Profil von Art. 31 BZO, siehe Hinweis unten sobald gewählt. Nach § 255 Abs. 3 PBG bleibt es bis zur anteiligen Geschossfläche ohne Anrechnung an die Ausnützung.`
        : '';
      storeySelEl.innerHTML =
        `<div class="choice-label">Geschosse — freie Entwurfsentscheidung, die Ausnützungsziffer begrenzt nur die Geschossfläche (${fmt(mm.gfaUsedM2)} m²), nicht die Geschosszahl.${attikaNote}</div>` +
        `<div class="choice-row">` +
        mm.storeyOptions.map((n) => {
          const plate = mm.gfaUsedM2 / n;
          const cov = plate / reconciled.parcelAreaM2 * 100;
          const ordinary = Math.min(n, mm.ordinaryMax);
          const attika = Math.max(0, n - mm.ordinaryMax);
          const heightM = ordinary * mm.ordinaryStoreyHeightM + attika * mm.attikaStoreyHeightM;
          return `<button type="button" class="choice${n === mm.storeys ? ' active' : ''}" data-storeys="${n}">`
            + `<b>${storeyCountLabel(ordinary, attika)}</b><span>${fmt(plate)} m² je Geschoss</span>`
            + `<span>${fmt(cov, 0)} % überbaut · ${fmt(heightM)} m hoch</span></button>`;
        }).join('') +
        `</div>`;
      storeySelEl.querySelectorAll('.choice').forEach((b) => b.addEventListener('click', () => {
        storeyChoice = Number(b.dataset.storeys);
        rerenderWithChoices();
      }));
    } else {
      storeySelEl.style.display = 'none';
    }

    provRegistry = [];
    const regimeTag = (key) => (rules.regimeOverrides && rules.regimeOverrides[key]
      ? ' <span class="regime-tag" title="Strengerer Wert der in Kraft stehenden BZO 2016 (negative Vorwirkung, § 234 PBG)">BZO 2016</span>' : '');
    const mm2 = r.massingModel;
    const abz = r.flaechenAbzuege || {};
    const rows = [
      ['Adresse', esc(anchor.address || anchor.parcelNumber)],
      ['Gemeinde', esc(rules.gemeinde)],
      [multi ? 'Parzellen' : 'Parzelle', esc(selection.map((p) => p.parcelNumber).join(' + '))],
      ['EGRID', esc(multi ? selection.map((p) => p.egrid).join(', ') : anchor.egrid)],
      ['Zone', esc(`${anchor.zone}${anchor.zoneLabel ? ` — ${anchor.zoneLabel}` : ''} (${anchor.zoneSource ? anchor.zoneSource.rechtsstatus : 'inKraft'})`)],
      [multi ? 'Fläche (zusammengefasst)' : 'Parzellenfläche', `${fmt(reconciled.parcelAreaM2)} m²`],
      ['Anrechenbare Grundstücksfläche',
        withProv(
          (abz.waldM2 > 0.5
            ? `${fmt(reconciled.anrechenbareFlaecheM2)} m² (− ${fmt(abz.waldM2)} m² Wald)`
            : `${fmt(reconciled.anrechenbareFlaecheM2)} m²`),
          provFor(rules, 'massgebliche_grundflaeche', 'anrechenbare_grundstuecksflaeche', 'massgebliche_grundflaeche_altrecht'))],
      ['Fussabdruck nach Grundabstand',
        withProv(`${fmt(r.footprintBeforeWaldM2)} m² (Grundabstand ${fmt(r.grundabstandUsedM ?? rules.grundabstand_min_m)} m)`,
          provFor(rules, 'grundabstand_min_m'))],
      ...(r.waldLossInFootprintM2 > 0.5
        ? [['davon Abzug Waldabstand', withProv(`− ${fmt(r.waldLossInFootprintM2)} m²`, provFor(rules, 'waldabstand'))]]
        : []),
      ...(r.baulinienLossM2 > 0.5 ? [['davon Abzug Baulinie', `− ${fmt(r.baulinienLossM2)} m²`]] : []),
      ['Bebaubarer Bereich nach Abzügen', `${fmt(r.footprintAfterWaldM2)} m²`],
      ['Fussabdruck nach Grünflächenziffer-Deckel',
        reconciled.hasGreenCap
          ? withProv(`${fmt(reconciled.footprintAfterGreenCapAreaM2)} m²${regimeTag('gruenflaechenziffer_min_pct')}`, provFor(rules, 'gruenflaechenziffer_min_pct'))
          : '— (keine Grünflächenziffer in dieser Gemeinde)'],
      ...(reconciled.hasUeberbauungsCap ? [[
        'Fussabdruck nach Überbauungsziffer',
        withProv(`${fmt(reconciled.footprintAfterUeberbauungsCapM2)} m² (max. ${rules.ueberbauungsziffer_hauptgebaeude_max_pct} %)${regimeTag('ueberbauungsziffer_hauptgebaeude_max_pct')}`,
          provFor(rules, 'ueberbauungsziffer_hauptgebaeude_max_pct'))]] : []),
      ['Nutzbarer Fussabdruck', `${fmt(reconciled.usableFootprintAreaM2)} m²`],
      ['Maximale anrechenbare Geschossfläche (Ausnützungsziffer)',
        withProv(`${fmt(reconciled.maxGfaM2)} m² (${rules.ausnuetzungsziffer_max_pct} % von ${fmt(reconciled.anrechenbareFlaecheM2)} m²)${regimeTag('ausnuetzungsziffer_max_pct')}`,
          provFor(rules, 'ausnuetzungsziffer_max_pct'))],
      ...(mm2 ? [
        ['Bebaubar als', withProv(`${storeyCountLabel(mm2.ordinaryStoreys, mm2.attikaStoreys)} à ${fmt(mm2.floorplateM2)} m² Grundfläche${regimeTag('vollgeschosse_max')}`, provFor(rules, 'vollgeschosse_max'))],
        ...(mm2.attikaStoreys > 0 || mm2.ugStoreys > 0 || mm2.extraDachCreditM2 > 0 ? [[
          'Freibetrag Dach-/Attika-/Untergeschosse (§ 255 Abs. 3 PBG)',
          withProv(`je Geschoss bis ${fmt(mm2.perStoreyFreeM2)} m² NICHT an die AZ angerechnet` +
            (mm2.attikaStoreys > 0 ? ` — Attika ${fmt(mm2.attikaFloorplateM2)} m²` : '') +
            (mm2.ugStoreys > 0 ? ` — ${mm2.ugStoreys} Untergeschoss ${fmt(mm2.ugFloorplateM2)} m²` : '') +
            (mm2.extraDachCreditM2 > 0 ? ` — 2. Dachgeschoss möglich (+${fmt(mm2.extraDachCreditM2)} m², nicht dargestellt)` : ''),
            provFor(rules, 'dach_attika_ug_freibetrag', 'anrechenbares_untergeschoss_max'))]] : []),
        ['Nutzbare Geschossfläche total (inkl. freie Geschosse)', `${fmt(mm2.nutzflaecheTotalM2)} m²`],
        ['Gebäudehöhe der Baukörper', `${fmt(mm2.buildingHeightM)} m (${fmt(mm2.storeyHeightM)} m pro Vollgeschoss)`],
        ['Umbauter Raum (gebaut)', `${fmt(mm2.volumeM3)} m³` + (mm2.hullVolumeM3 > mm2.volumeM3 * 1.02 ? ` — max. Hülle wäre ${fmt(mm2.hullVolumeM3)} m³` : '')],
      ] : []),
      [`${esc(rules.heightMetric)} max.`,
        withProv(`${rules.heightM} m${rules.heightRegime ? ` <span class="regime-tag" title="Strengeres Mass der in Kraft stehenden BZO 2016 (negative Vorwirkung, § 234 PBG)">BZO 2016</span>` : ''}`,
          provFor(rules, rules.heightRegime ? 'gebaeudehoehe_max_m_bzo2016' : (rules.traufseitige_fassadenhoehe_max_m != null ? 'traufseitige_fassadenhoehe_max_m' : 'gebaeudehoehe_max_m')))],
      ...(r.lengthLimitM != null ? [['Max. Gebäudelänge',
        withProv(`${r.lengthLimitM} m${regimeTag('gesamtlaenge_max_m')}${regimeTag('gebaeudelaenge_inkl_klein_anbauten_max_m')}`,
          provFor(rules, 'gesamtlaenge_max_m', 'gebaeudelaenge_inkl_klein_anbauten_max_m'))]] : []),
      ...(r.massing && !r.massing.impossible ? [
        ['Länge dieses Bereichs', `${fmt(r.areaRect.lengthM)} m — zu lang für einen Baukörper`],
        ['Aufteilung in Baukörper', `${r.massing.count} Baukörper (längster ${fmt(r.massing.longestBlockM)} m), Gebäudeabstand ${r.gebaeudeabstandM} m`],
        ['davon Abzug Gebäudeabstände (nur Platzierung, nicht Ausnützung)', `− ${fmt(r.lengthLossM2)} m²`],
      ] : (r.footprintRect ? [['Länge × Breite (kleinstes Rechteck)',
        `${fmt(r.footprintRect.lengthM)} × ${fmt(r.footprintRect.widthM)} m` + (r.lengthLimitM != null ? ' — eingehalten' : '')]] : [])),
      ['Gewachsenes Terrain (Referenzpunkt)', terrainHeight != null ? `${fmt(terrainHeight)} m ü. M.` : '— (Höhendienst nicht erreichbar)'],
      ...(r.hang ? [['Terrainneigung', `${fmt(r.hang.slopePercent, 0)} % Richtung ${compassLabel(r.hang.uphillBearingDeg)}`]] : []),
    ];
    numbersTableEl.innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
    wireProvButtons(numbersTableEl);

    const flags = [];
    // Upstream sources that failed — these change what the numbers mean, so
    // they come first.
    for (const d of (r.degraded || [])) flags.push(esc(d));
    const mmForFlags = r.massingModel;
    if (mmForFlags && mmForFlags.attikaStoreys > 0) {
      const ueb = mmForFlags.attikaUeberhoehungM || 0;
      const profilText = ueb > 0
        ? `45°-Profil ab max. ${fmt(ueb)} m über der Schnittlinie (Art. 31 Abs. 1 BZO ${esc(rules.gemeinde)}), Rücksprung = Attikahöhe − ${fmt(ueb)} m = ${fmt(mmForFlags.attikaSetbackM)} m`
        : `45°-Profil ab der Schnittlinie, Rücksprung = Attikahöhe = ${fmt(mmForFlags.attikaSetbackM)} m (keine Überhöhungs-Regel für diese Gemeinde hinterlegt — konservativ)`;
      if (mmForFlags.attikaGeometryImpossible && mmForFlags.attikaFootplateM2 <= 0) {
        // Show the arithmetic, not just the verdict: the numbers are the only
        // way to see that the residual really is the honest answer here
        // rather than the tool giving up.
        const d = (mmForFlags.attikaDiagnostics || [])[0];
        const sb = mmForFlags.attikaSetbackM;
        const calc = d
          ? (d.bergseite
              ? ` Baukörper ${fmt(d.belowLengthM)} × ${fmt(d.belowWidthM)} m; auf der Bergseite ist die Wand fassadenbündig, die drei übrigen Seiten je ${fmt(sb)} m zurück — bleiben ${fmt(d.narrowestM)} m schmalste Ausdehnung.`
              : ` Baukörper ${fmt(d.belowLengthM)} × ${fmt(d.belowWidthM)} m minus ${fmt(sb)} m auf allen vier Seiten ergibt ${fmt(d.belowLengthM - 2 * sb)} × ${fmt(d.belowWidthM - 2 * sb)} m, also nur ${fmt(d.narrowestM)} m schmalste Ausdehnung.`)
          : '';
        flags.push(`Kein Attikageschoss darstellbar: ${profilText} lässt zu wenig übrig — unter ${T.MIN_PRIMITIVE_WIDTH_M} m, was kein baubarer Raum mehr ist.${calc} Die Vollgeschosse darunter bleiben davon unberührt.`);
      } else {
        const hg = mmForFlags.hang;
        const bergUsed = mmForFlags.hangUphillBearingDeg != null;
        const bergText = bergUsed
          ? ` Bergseiten-Ausnahme angewandt (Art. 31 Abs. 2): auf der Bergseite (Richtung ${compassLabel(mmForFlags.hangUphillBearingDeg)}) ist die Wand fassadenbündig, weil das Terrain dort um ca. ${fmt(mmForFlags.bergseiteRiseM)} m ansteigt und die zulässige Gebäudehöhe unter Einbezug der Attika eingehalten bleibt; die Fläche ist auf das Mass einer allseitig zurückversetzten Attika gedeckelt (Abs. 2 Satz 2).`
          : (hg && mmForFlags.bergseiteRiseM != null
              ? ` Bergseiten-Ausnahme (Art. 31 Abs. 2) NICHT angewandt: der Terrainanstieg über die Gebäudetiefe (ca. ${fmt(mmForFlags.bergseiteRiseM)} m) reicht nicht aus, um die zulässige Gebäudehöhe samt Attika auf der Bergseite einzuhalten — der Rücksprung gilt allseitig.`
              : ` Ohne Terraindaten wird der allseitige Rücksprung angenommen.`);
        flags.push(`Attikageschoss nach Art. 31 BZO: ${profilText}. Attikafläche: ${fmt(mmForFlags.attikaFootplateM2)} m².${bergText} Bis ${fmt(mmForFlags.perStoreyFreeM2)} m² je Dach-/Attika-/Untergeschoss bleibt die Fläche nach § 255 Abs. 3 PBG ohne Anrechnung an die Ausnützungsziffer.`);
      }
    }
    if (mmForFlags && mmForFlags.droppedBlockCount > 0) {
      const totalBlocks = (r.massing && r.massing.count) || mmForFlags.droppedBlockCount;
      flags.push(`${mmForFlags.droppedBlockCount} von ${totalBlocks} Baukörpern aus der Längenaufteilung ${mmForFlags.droppedBlockCount > 1 ? 'waren' : 'war'} an dieser Stelle der Parzelle zu schmal (unter ${T.MIN_PRIMITIVE_WIDTH_M} m) für ein eigenständiges Gebäude und ${mmForFlags.droppedBlockCount > 1 ? 'wurden' : 'wurde'} nicht dargestellt. Die entsprechende Fläche fehlt in der unten ausgewiesenen Differenz zur rechnerischen Geschossfläche.`);
    } else if (mmForFlags && mmForFlags.cuboidNotPrimitive) {
      flags.push(`Für ${storeyCountLabel(mmForFlags.ordinaryStoreys, mmForFlags.attikaStoreys)} liess sich in dieser Form der Parzelle kein Rechteck mit der vollen benötigten Fläche (${fmt(mmForFlags.floorplateM2)} m² je Geschoss) platzieren. Der dargestellte Baukörper folgt daher ausnahmsweise dem unregelmässigen Umriss des bebaubaren Bereichs statt einer einfachen Box.`);
    } else if (mmForFlags && mmForFlags.cuboidAreaShortfallM2 > mmForFlags.floorplateM2 * 0.03) {
      flags.push(`Der dargestellte Baukörper ist als einfache Box gezeichnet und dafür ${fmt(mmForFlags.cuboidAreaShortfallM2)} m² kleiner als die rechnerische Grundfläche von ${fmt(mmForFlags.floorplateM2)} m² je Geschoss — ein Grundriss mit mehr Ecken könnte die volle Fläche ausschöpfen. Die Geschossflächen-Zahlen oben bleiben die massgeblichen (rechnerischen) Werte.`);
    }
    if (r.massing && r.massing.impossible) {
      flags.push(`Der bebaubare Bereich ist ${fmt(r.areaRect.lengthM)} m lang, zulässig sind ${r.lengthLimitM} m. Eine Aufteilung in Baukörper mit dem nötigen Gebäudeabstand von ${r.gebaeudeabstandM} m ergibt keine sinnvoll bebaubaren Volumen mehr — die Parzelle ist in dieser Form kaum bebaubar. Manuelle Prüfung erforderlich.`);
    } else if (r.massing) {
      flags.push(`Der bebaubare Bereich ist ${fmt(r.areaRect.lengthM)} m lang; zulässig sind ${r.lengthLimitM} m (${rules.gemeinde}). Er wurde daher in ${r.massing.count} Baukörper von je ${fmt(r.massing.blockLengthM)} m Länge geteilt, mit dem kantonalen Gebäudeabstand von ${r.gebaeudeabstandM} m dazwischen (§271 PBG: Summe der beidseitigen Grenzabstände). Alle Zahlen oben beziehen sich auf diese geteilten Volumen; die Gebäudeabstände kosten ${fmt(r.lengthLossM2)} m². Die Aufteilung ist gleichmässig und schematisch — die tatsächliche Anordnung ist Sache des Entwurfs.`);
    }
    // Mehrlängenzuschlag (Art. 14 BZO 2016) applied?
    if (r.mehrlaengen) {
      const ml = r.mehrlaengen;
      flags.push(`Mehrlängenzuschlag angewandt (Art. 14 BZO 2016, geltendes Recht): die längste Fassade misst ${fmt(ml.facadeLengthM)} m (> 12 m), der Grenzabstand erhöht sich um einen Drittel der Mehrlänge auf ${fmt(ml.requiredM)} m (Maximum dieser Zone: ${fmt(ml.capM)} m). Vereinfachend wurde der erhöhte Abstand allseitig gerechnet — gesetzlich gilt er für die massgeblichen (langen) Fassaden; das Ergebnis ist damit eher konservativ.`);
    }
    // Communes with a directional setback (Zumikon: grosser Grenzabstand on
    // the south-facing side(s), Art. 17/18 BZO).
    if (r.hasDirectional && r.facadeEdges && r.facadeEdges.edges.length && r.southFacadeIndex != null) {
      const idxs = (r.chosenIndices && r.chosenIndices.length ? r.chosenIndices : [r.southFacadeIndex]);
      const edgeDescr = idxs.map((i) => {
        const e = r.facadeEdges.edges[i];
        return e ? `Fassade ${fmt(e.length, 0)} m, Ausrichtung ${fmt(e.bearingDeg, 0)}°` : null;
      }).filter(Boolean).join(' und ');
      const two = idxs.length > 1;
      const autoChosen = r.southFacadeIndex === r.facadeEdges.suggestedIndex;
      flags.push(`${esc(rules.gemeinde)} kennt zwei Grenzabstände (Art. 18 BZO ${esc(rules.gemeinde)}): ${rules.grundabstand_min_m} m normal, ${rules.grosser_grenzabstand_min_m} m an der Hauptfassade${two ? 'n' : ''}. ${two ? `In dieser Zone gilt der grosse Grenzabstand für die BEIDEN am meisten gegen Süden gerichteten Gebäudeseiten (Art. 18 Abs. 1)` : (autoChosen ? 'Automatisch die am stärksten südorientierte Seite' : 'Die von Ihnen gewählte Seite')} (${edgeDescr}) — dort wurde mit ${rules.grosser_grenzabstand_min_m} m gerechnet, alle anderen Seiten mit ${rules.grundabstand_min_m} m. Im Grundriss anklickbar, falls eine andere Seite die tatsächliche Hauptfassade ist. Hinweis: massgebend sind laut Art. 18 Abs. 2 die Seiten des GEBÄUDES (flächenkleinstes Rechteck), gemessen nach § 22 ABV rechtwinklig zur Fassade — die Näherung über die Parzellenkanten ist eine Vereinfachung auf der sicheren Seite.`);
    } else if (r.hasDirectional && (!r.facadeEdges || !r.facadeEdges.edges.length)) {
      flags.push(`${esc(rules.gemeinde)} kennt einen grossen Grenzabstand an der Hauptfassade, aber die Parzelle hat keine auswertbare Fassadenkante (alle Kanten unter 3 m). Es wurde einheitlich mit dem kleinen Grenzabstand gerechnet — der reale Fussabdruck ist auf der Südseite kleiner. Manuell prüfen.`);
    }
    if (multi && !isSingleShape) {
      flags.push('Die gewählten Parzellen berühren sich nicht durchgehend. Sie werden trotzdem zusammen gerechnet, bilden aber baurechtlich kein zusammenhängendes Grundstück — Zahlen entsprechend vorsichtig verwenden.');
    }
    if (multi) {
      flags.push(`Rechtlicher Vorbehalt der Zusammenrechnung: Die ${selection.length} Parzellen wurden als EIN Baugrundstück gerechnet (gemeinsame Ausnützung, keine Grenzabstände an den internen Grenzen). Das setzt eine Parzellenvereinigung oder eine im Grundbuch gesicherte Ausnützungsübertragung/Näherbaurecht zwischen den Eigentümern voraus. Ohne diese Sicherung gelten die internen Grenzabstände und die parzellenweise Ausnützung weiter — die Zahlen wären dann zu hoch.`);
    }
    const otherZones = [...new Set(selection.map((p) => p.zone))].filter((z) => z !== anchor.zone);
    if (otherZones.length) {
      flags.push(esc(`Die gewählten Parzellen liegen nicht alle in derselben Zone (${anchor.zone} sowie ${otherZones.join(', ')}). Gerechnet wurde durchgehend mit den Werten der Zone ${anchor.zone} (erste Parzelle). § 259 PBG verlangt die Anrechnung je Bauzone — bei gemischten Zonen sind die Flächenanteile je Zone separat zu rechnen; manuell prüfen.`));
    }
    // Zone boundary uncertainty from the point-in-polygon lookup.
    const uncertainParcels = selection.filter((p) => p.zoneSource && p.zoneSource.edgeUncertain);
    if (uncertainParcels.length) {
      flags.push(esc(`Zonenzuordnung unsicher: ${uncertainParcels.map((p) => p.parcelNumber).join(', ')} liegt/liegen nahe an einer Zonengrenze — die Zone wurde aus einem einzelnen Punkt bestimmt. Zonenplan an der Grundstücksgrenze manuell prüfen (die Parzelle könnte in zwei Zonen liegen).`));
    }
    // What the anrechenbare Fläche could NOT check automatically.
    const abzInfo = r.flaechenAbzuege || {};
    if (!abzInfo.gewaesserChecked || !abzInfo.andereZoneChecked) {
      flags.push(`Anrechenbare Grundstücksfläche: automatisch abgezogen wurde nur Wald innerhalb der Parzelle${abzInfo.waldM2 > 0.5 ? ` (${fmt(abzInfo.waldM2)} m²)` : ' (hier: keiner)'}. Offene Gewässer und allfällige Flächenanteile ausserhalb der Bauzone werden nicht automatisch erkannt und wären zusätzlich abzuziehen (§ 259 PBG bzw. § 259 aPBG) — bei Gewässernähe oder Zonengrenzlage manuell prüfen.`);
    }
    // Arealüberbauung potential (Art. 6/7 E-BZO): not computed, but too much
    // money to leave silently on the table.
    if (rules.arealueberbauung_zulaessig && r.parcelAreaM2 >= 4000) {
      flags.push(`Arealüberbauung möglich: Die Fläche (${fmt(r.parcelAreaM2, 0)} m² ≥ 4000 m²) erreicht die Schwelle von Art. 6 E-BZO. Mit Arealüberbauung wären statt ${rules.ausnuetzungsziffer_max_pct}% bis zu ${rules.arealueberbauung_ausnuetzungsziffer_max_pct}% Ausnützung, ${rules.arealueberbauung_vollgeschosse_max} Vollgeschosse und ${rules.arealueberbauung_fassadenhoehe_max_m} m Fassadenhöhe möglich (Art. 7 E-BZO). Dieser Bonus ist hier NICHT eingerechnet — separate Prüfung (erhöhte Gestaltungsanforderungen) nötig.`);
    }
    // Waldabstand is computed and subtracted (see waldabstand.js), so it is
    // reported in the checklist rather than flagged here as unhandled.
    for (const [key, label] of Object.entries({ gewaesserraum: 'Gewässerraum' })) {
      if (restrictions[key].concerned) {
        flags.push(`${label}: gemäss amtlichem ÖREB-Kataster betroffen. Automatische Fussabdruck-Reduktion wurde NICHT vorgenommen — manuelle Prüfung der Geometrie erforderlich.`);
      }
    }
    flagsEl.innerHTML = flags.map((f) => `<div class="flag">⚠ ${f}</div>`).join('');
    lastResult = r;
    lastFlags = flags;

    checklistEl.innerHTML =
      `<div class="checklist-tier tier-a"><h3>Tier A — automatisch berechnet (eindeutig)</h3>${renderChecklistTier(checklist.tierA)}</div>` +
      `<div class="checklist-tier tier-b"><h3>Tier B — Vorhandensein automatisch erkannt, Inhalt manuell zu prüfen</h3>${renderChecklistTier(checklist.tierB)}</div>`;

    renderViewer(r);
    renderFloorPlan(r);

    // Full provenance list: every legal parameter that fed the calculation,
    // with its article, the quoted passage, and a link that opens the source
    // PDF at the cited page with the passage highlighted.
    const provRows = [];
    const zoneSource = rules.source || {};
    provRows.push(
      `<div class="source-row"><strong>${esc(zoneSource.article || '')}</strong> — <span class="article">${esc(zoneSource.version || '')}</span>` +
      (zoneSource.paragraph_text
        ? `<br>„${esc(zoneSource.paragraph_text)}"`
        : `<br><em>Gesetzestext noch nicht erfasst — nur Artikelverweis verfügbar.</em>`) +
      (zoneSource.synthetic ? `<br><em>Hinweis: Sammelverweis aus den Metadaten, kein geprüftes Einzelzitat.</em>` : '') +
      `</div>`
    );
    const PROV_LIST = [
      ['Ausnützungsziffer', 'ausnuetzungsziffer_max_pct'],
      ['Überbauungsziffer', 'ueberbauungsziffer_hauptgebaeude_max_pct'],
      ['Grünflächenziffer', 'gruenflaechenziffer_min_pct'],
      ['Vollgeschosse', 'vollgeschosse_max'],
      ['Anrechenbares Untergeschoss', 'anrechenbares_untergeschoss_max'],
      ['Anrechenbare Dach-/Attikageschosse', 'anrechenbares_dach_attika_max'],
      ['Zulässige Höhe', rules.heightRegime ? 'gebaeudehoehe_max_m_bzo2016' : (rules.traufseitige_fassadenhoehe_max_m != null ? 'traufseitige_fassadenhoehe_max_m' : 'gebaeudehoehe_max_m')],
      ['Firsthöhe (Zuschlag)', 'firsthoehe_zuschlag_m'],
      ['Grenzabstand (klein/Grundabstand)', 'grundabstand_min_m'],
      ['Grosser Grenzabstand', 'grosser_grenzabstand_min_m'],
      ['Hauptfassaden-Regel', 'grosser_grenzabstand_suedseiten'],
      ['Mehrlängenzuschlag', 'mehrlaengenzuschlag'],
      ['Gebäude-/Gesamtlänge', rules.gesamtlaenge_max_m != null ? 'gesamtlaenge_max_m' : 'gebaeudelaenge_inkl_klein_anbauten_max_m'],
      ['Anrechenbare Grundstücksfläche', null],
      ['Freibetrag Dach-/Attika-/UG (§ 255 Abs. 3)', 'dach_attika_ug_freibetrag'],
      ['Attika-Profil (45°/Überhöhung)', 'attika_profil_ueberhoehung_m'],
      ['Attika Bergseite', 'attika_bergseite'],
      ['Waldabstand', 'waldabstand'],
      ['Strassenabstand ohne Baulinien', 'strassenabstand_ohne_baulinien_m'],
      ['Negative Vorwirkung (Regime)', 'negative_vorwirkung'],
    ];
    for (const [label, key] of PROV_LIST) {
      const prov = key === null
        ? provFor(rules, 'massgebliche_grundflaeche', 'anrechenbare_grundstuecksflaeche', 'massgebliche_grundflaeche_altrecht')
        : provFor(rules, key);
      if (!prov) continue;
      provRows.push(
        `<div class="source-row"><strong>${esc(label)}</strong> — <span class="article">${esc(prov.article || '')}${prov.page ? `, S. ${prov.page}` : ''}</span>` +
        (prov.quote ? `<br>„${esc(prov.quote)}"` : '') +
        `<br>${withProv('<em>Beleg im Originaldokument:</em>', prov)}</div>`
      );
    }
    provRows.push(
      `<div class="source-row"><em>Werkzeug-Annahmen ohne Gesetzeszitat (schematische Darstellung): Mindestbreite Baukörper ${T.MIN_PRIMITIVE_WIDTH_M} m; ` +
      `gleichmässige Aufteilung zu langer Bereiche in Baukörper; Rechteck-Näherung der Baukörper; Kostenansatz CHF/m³ als grobe Bandbreite. ` +
      `Diese Annahmen sind Darstellungs-, nicht Rechtsgrössen.</em></div>`
    );
    sourcesSectionEl.innerHTML = `<h2>Quellen und Entscheide</h2>` + provRows.join('');
    wireProvButtons(sourcesSectionEl);

    // Three stacked layers on one bbox so they register exactly: zone colours
    // drawn from the cantonal dataset, cadastral parcel boundaries (multiply
    // blend so its white background drops out), then the selection in red.
    const allRings = selection.map((p) => p.geometryLV95[0]);
    const { centerE, centerN, halfSpan } = T.boundingBoxForRings(allRings, 25);
    const mapW = 700, mapH = 700;
    const bbox = T.buildMapBbox(centerE, centerN, halfSpan * 1.6, mapW, mapH);
    zoningMapEl.innerHTML =
      `<h2>Zonenplan-Ausschnitt (${multi ? 'gewählte Parzellen' : 'Parzelle'} rot markiert)</h2>` +
      `<div style="position:relative;width:${mapW}px;max-width:100%;aspect-ratio:${mapW}/${mapH};">` +
      `<img src="${T.buildCadastreMapUrl(bbox, mapW, mapH)}" ` +
      `style="position:absolute;inset:0;width:100%;height:100%;mix-blend-mode:multiply;z-index:1;" alt="Parzellengrenzen">` +
      T.buildParcelOverlaySvg(allRings, bbox, mapW, mapH) +
      `</div>`;
    // Zone polygons arrive asynchronously; drop them in underneath once here.
    T.fetchZonePolygons(bbox).then((zoneFeatures) => {
      const holder = zoningMapEl.querySelector('div');
      if (!holder || !zoneFeatures.length) return;
      holder.insertAdjacentHTML('afterbegin',
        T.buildZonePlanSvg(zoneFeatures, bbox, mapW, mapH).replace('<svg ', '<svg style="position:absolute;inset:0;width:100%;height:100%;" '));
    }).catch(() => { /* zone colours are decorative here; the numbers stand alone */ });

    const envelopeVolumeM3 = r.massingModel ? r.massingModel.volumeM3 : reconciled.usableFootprintAreaM2 * rules.heightM;
    const cost = T.estimateCost(envelopeVolumeM3);
    costEstimateEl.innerHTML =
      `<h2>Grobe Kostenschätzung (optional, sehr grob)</h2>` +
      `<div>Umbauter Raum ${r.massingModel ? `(${storeyCountLabel(r.massingModel.ordinaryStoreys, r.massingModel.attikaStoreys)}, Box-Näherung)` : '(Box-Näherung)'}: ${fmt(envelopeVolumeM3)} m³ × CHF ${cost.chfPerM3}/m³</div>` +
      `<div class="total">≈ CHF ${Math.round(cost.totalChf).toLocaleString('de-CH')}</div>` +
      `<div class="note">${cost.note}</div>`;

    staticFootnoteHtml =
      `Quelle: ${rulesData.version}, ${rulesData.article_grundmasse} (Gemeinde ${rules.gemeinde}). ` +
      `${rulesData.legal_status} ` +
      `Zone und Grundmasse aus der kantonalen Nutzungsplanung (ogd-0156); Grenzabstand und Grünflächenziffer aus der kommunalen BZO. ` +
      `Bitte Zonenzuordnung an der Grundstücksgrenze zusätzlich prüfen. Kein Ersatz für eine unterschriebene Machbarkeitsstudie oder ein Baugesuch.`;

    refreshGrundbuchFootnote();
    resultsEl.style.display = 'block';
    previewPdfBtn.style.display = 'inline-block';
  }

  function renderSelectionList(selection) {
    if (!selection.length) {
      selectionListEl.innerHTML = '<li class="empty">Keine Parzelle gewählt — auf der Karte eine anklicken.</li>';
      return;
    }
    selectionListEl.innerHTML = selection
      .map((p, i) => `<li class="${i === 0 ? 'anchor' : ''}">${p.parcelNumber} — Zone ${p.zone}${i === 0 ? ' (Ausgangsparzelle)' : ''}</li>`)
      .join('');
  }

  // Recompute whenever the map selection changes. Guarded so a slow run
  // can't overwrite a newer one's results.
  let runToken = 0;
  async function refresh(selection) {
    renderSelectionList(selection);
    if (!selection.length) {
      // Everything deselected. The map deliberately stays exactly where it
      // is -- that is the whole point of being able to drop the
      // Ausgangsparzelle: the next one is one click away, without retyping
      // an address. Only the results go, since they no longer describe
      // anything on screen.
      runToken++; // and any run still in flight is now stale
      resultsEl.style.display = 'none';
      previewPdfBtn.style.display = 'none';
      printDocEl.classList.remove('preview');
      previewPdfBtn.textContent = 'Layout ansehen';
      lastResult = null;
      lastFlags = [];
      storeyChoice = null;
      southFacadeIndex = null;
      setStatus('Keine Parzelle gewählt — auf der Karte eine anklicken.');
      return;
    }
    const myToken = ++runToken;
    setStatus('Berechne…');
    try {
      const result = await analyse(selection);
      if (myToken !== runToken) return;
      setStatus('');
      render(result);
    } catch (err) {
      if (myToken !== runToken) return;
      setStatus('Fehler: ' + (err.message || err), true);
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    resultsEl.style.display = 'none';
    previewPdfBtn.style.display = 'none';
    printDocEl.classList.remove('preview');
    previewPdfBtn.textContent = 'Layout ansehen';
    mapSectionEl.style.display = 'none';
    closeOptions();
    const typed = addressInput.value.trim();
    if (!typed) return;
    try {
      // A suggestion picked from the list wins; typing straight past it
      // falls back to the same search and takes its best hit.
      let target = chosen && chosen.value === typed ? chosen : null;
      if (!target) {
        setStatus(`Suche "${typed}"…`);
        const hits = await T.searchLocations(typed, { gemeinde: gemeindeSelect.value || null, limit: 1 });
        if (!hits.length) throw new Error(`Keine Adresse und keine Parzelle gefunden für "${typed}"`);
        target = hits[0];
      }
      setStatus(`Ermittle Parzelle für "${target.value}"…`);
      const parcel = await T.resolveAndIdentify(target);
      setStatus('Ermittle Zone…');
      const zone = await T.lookupZone(parcel.easting, parcel.northing);
      const rules = await T.getZoneRules(zone, gemeindeSelect.value || null);
      const firstParcel = { ...parcel, zone: zone.zone, zoneSource: zone.zoneSource, rules };

      mapSectionEl.style.display = 'flex';
      T.parcelMap = T.initParcelMap('map', firstParcel, refresh, gemeindeSelect.value || null);
    } catch (err) {
      setStatus('Fehler: ' + (err.message || err), true);
    }
  });
})();
