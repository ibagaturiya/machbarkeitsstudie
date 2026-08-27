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
  // Shared with print.js and evidence.js — see js/core/format.js.
  const esc = T.esc, fmt = T.fmt;

  const form = document.getElementById('address-form');
  const statusEl = document.getElementById('status');
  const mapSectionEl = document.getElementById('map-section');
  const selectionListEl = document.getElementById('selection-list');
  const resultsEl = document.getElementById('results');
  const versionBannerEl = document.getElementById('version-banner');
  const zoneHeadlineEl = document.getElementById('zone-headline');
  const bindingSummaryEl = document.getElementById('binding-summary');
  const numbersTableEl = document.getElementById('numbers-table');
  const parkierungEl = document.getElementById('parkierung');
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
  let wohnungenChoice = null;
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
    ablaufPanel.redraw();
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

  // Export flow: "PDF exportieren" composes the presentation document (one
  // argument per page, each with its plans and its sources) and opens it as
  // a full-screen preview. There, "PDF öffnen" writes a real PDF file and
  // opens it in its own tab, in the browser's PDF viewer — whose own toolbar
  // carries the download arrow, search and page numbers (js/ui/pdf.js). No
  // print dialog. "Drucken" is kept beside it: the print path produces vector
  // text instead of a page image, which is what you want if the quoted
  // provisions have to stay selectable.
  const printToolbarEl = document.getElementById('print-toolbar');
  const printBackBtn = document.getElementById('print-back-btn');
  const printOpenBtn = document.getElementById('print-open-btn');
  const printPrintBtn = document.getElementById('print-print-btn');

  function closePrintPreview() {
    printDocEl.classList.remove('preview');
    printToolbarEl.classList.remove('open');
  }

  previewPdfBtn.addEventListener('click', async () => {
    previewPdfBtn.disabled = true;
    try {
      if (await composePrintDoc()) {
        printDocEl.classList.add('preview');
        printToolbarEl.classList.add('open');
        printDocEl.scrollTop = 0;
      }
    } finally {
      previewPdfBtn.disabled = false;
    }
  });
  printBackBtn.addEventListener('click', closePrintPreview);
  printPrintBtn.addEventListener('click', () => window.print());

  // Der Dateiname trägt Adresse (oder Parzellennummern) und Datum, damit im
  // Download-Ordner nicht zehn "Machbarkeit.pdf" nebeneinander liegen.
  function pdfFilename() {
    const r = lastResult;
    const subject = r
      ? (r.anchor.address || r.selection.map((p) => `Parzelle-${p.parcelNumber}`).join('_'))
      : '';
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return T.safeFilename(['Machbarkeit', subject, stamp]);
  }

  printOpenBtn.addEventListener('click', async () => {
    const label = printOpenBtn.textContent;
    const filename = pdfFilename();
    // SYNCHRON, noch im Klick: nach dem Rastern gilt window.open() nicht mehr
    // als Folge einer Nutzeraktion und Safari blockiert es als Popup.
    const tab = T.openPendingTab(filename);
    printOpenBtn.disabled = true;
    try {
      const res = await T.openSheetsAsPdf(tab, printDocEl, filename, (i, n) => {
        printOpenBtn.textContent = i < n ? `Blatt ${i + 1} von ${n} …` : 'PDF wird geschrieben …';
      });
      if (res.blocked) {
        setStatus('Der Browser hat den neuen Tab blockiert — die PDF wurde stattdessen '
          + 'heruntergeladen. Popups für diese Seite erlauben, dann öffnet sie sich im Viewer.', true);
      }
    } catch (e) {
      // Ein fehlgeschlagener Export darf nicht als leerer Klick enden: der
      // Grund gehört in dieselbe Statuszeile wie jeder andere Fehler.
      setStatus(`Fehler beim PDF-Export: ${e.message}`, true);
      console.error(e);
    } finally {
      printOpenBtn.textContent = label;
      printOpenBtn.disabled = false;
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

  // Ablauf & Normkette (js/core/normkette.js). Das Panel haelt seinen Abspiel-
  // zustand selbst; app.js meldet ihm nur den Fortschritt und am Ende das
  // fertige Ergebnisobjekt.
  const ablaufPanel = T.mountAblaufPanel({
    panelEl: document.getElementById('pane-ablauf'),
    liveEl: document.getElementById('nk-live'),
    listEl: document.getElementById('nk-list'),
    stageEl: document.getElementById('nk-stage'),
    captionEl: document.getElementById('nk-caption'),
    playBtn: document.getElementById('nk-play'),
    legendEl: document.getElementById('nk-legend'),
    isDark,
  });

  // Jede Statusmeldung ist zugleich eine Protokollzeile: der Nutzer sieht im
  // Kopf nur die aktuelle, im Panel die ganze Abfolge des Laufs. Eine zweite
  // Aufrufstelle je Schritt waere sonst unvermeidlich aus dem Tritt geraten.
  function setStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.className = isError ? 'error' : '';
    if (text) ablaufPanel.live(isError ? `FEHLER — ${text}` : text);
  }

  // "2 Vollgeschosse", "2 Vollgeschosse + 1 Attika" -- used everywhere a
  // storey count is shown so ordinary and Attika storeys never get silently
  // merged into one plain "n Vollgeschoss" figure.
  function storeyCountLabel(ordinary, attika) {
    const base = `${ordinary} Vollgeschoss${ordinary === 1 ? '' : 'e'}`;
    return attika > 0 ? `${base} + ${attika} Attika` : base;
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


  // The canton writes its zone names lowercase ("dreigeschossige Wohnzone");
  // as a headline they read as a sentence, so lift the first letter.
  function capitalize(s) {
    const t = String(s ?? '');
    return t ? t[0].toUpperCase() + t.slice(1) : t;
  }

  // Dates out of the cantonal WFS arrive as ISO timestamps. Anything that
  // isn't one is passed through untouched rather than turned into "Invalid
  // Date" — the source string is still more useful than that.
  function formatDateCH(value) {
    if (!value) return null;
    const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : String(value);
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
  const leitungsrechtYes = document.getElementById('leitungsrecht-yes');
  const leitungsrechtFields = document.getElementById('leitungsrecht-fields');
  const leitungsrechtDetail = document.getElementById('leitungsrecht-detail');
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
    // Leitungsbaurecht zuerst: es ist das einzige der drei, das regelmaessig
    // das Untergeschoss und die Fundation trifft, nicht nur die Grundflaeche.
    if (leitungsrechtYes.checked) {
      parts.push(`Durchleitungs-/Leitungsbaurecht vorhanden${leitungsrechtDetail.value.trim() ? ` (${leitungsrechtDetail.value.trim()})` : ''}`);
    }
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

  leitungsrechtYes.addEventListener('change', () => {
    leitungsrechtFields.classList.toggle('visible', leitungsrechtYes.checked);
    refreshGrundbuchFootnote();
  });
  naeherbaurechtYes.addEventListener('change', () => {
    naeherbaurechtFields.classList.toggle('visible', naeherbaurechtYes.checked);
    refreshGrundbuchFootnote();
  });
  wegrechtYes.addEventListener('change', () => {
    wegrechtFields.classList.toggle('visible', wegrechtYes.checked);
    refreshGrundbuchFootnote();
  });
  [leitungsrechtDetail, naeherbaurechtDetail, wegrechtDetail, otherDienstbarkeit].forEach((el) =>
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
    // No `|| 1` fallback: rules.js refuses a zone that has a grosser
    // Grenzabstand without saying how many sides it covers.
    const suedCount = rules.grosser_grenzabstand_suedseiten;
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

    // Returns { feature, degradedTo } — degradedTo is set only when the
    // differential offset could not be built for one or more Hauptfassaden.
    // The fallback is then the grosse Grenzabstand on ALL sides: a failure of
    // the geometry must never hand back MORE buildable area than the law
    // allows, and applying the larger distance everywhere is the only variant
    // that cannot overstate. render() turns degradedTo into a flag — the user
    // sees a smaller, explained footprint instead of a silently wrong one.
    const runSetback = (smallM) => {
      if (!(hasDirectional && chosenEdges.length)) {
        return { feature: T.bufferLV95(merged, -smallM), degradedTo: null };
      }
      const bigM = rules.grosser_grenzabstand_min_m;
      const res = T.anisotropicSetbackMulti(merged, chosenEdges, smallM, bigM);
      if (!res.failedEdges) return { feature: res.feature, degradedTo: null };
      return {
        feature: T.bufferLV95(merged, -bigM),
        degradedTo: { appliedM: bigM, failedEdges: res.failedEdges, edgeCount: chosenEdges.length },
      };
    };

    // One full derivation pass at a given Grundabstand — everything from the
    // setback ring to the placed massing. Runs once normally, twice when the
    // Mehrlängenzuschlag kicks in.
    const computePass = (grundabstandUsedM) => {
    const setbackResult = runSetback(grundabstandUsedM);
    let setbackFootprint = setbackResult.feature;
    const grenzabstandDegraded = setbackResult.degradedTo;
    // Momentaufnahme fuer die Normketten-Animation (normkette.js): der Ring
    // NACH den Grenzabstaenden, aber VOR Wald- und Baulinienabzug. Reines
    // Festhalten, keine zusaetzliche Rechnung.
    const setbackRingFeature = setbackFootprint;

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
    const afterWaldFeature = setbackFootprint;   // Momentaufnahme, siehe oben
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
    // The Attika's Rücksprung has to be known BEFORE the box is shaped, not
    // after: a 45°-Profil that eats `setback` off every side leaves a top
    // storey only on a block at least 2 × setback + Mindestbreite deep, and
    // the shape of the box is exactly what decides that. Passed into the
    // rectangle search below as a preference (never as a requirement — where
    // no such shape fits the buildable area, the search runs as before).
    const attikaUeberhoehungM = (rules.meta && rules.meta.attika_profil_ueberhoehung_m) || 0;
    const attikaSetbackM = massingModel && massingModel.attikaStoreys > 0
      ? Math.max(0, massingModel.attikaStoreyHeightM - attikaUeberhoehungM)
      : 0;
    const attikaMinSideM = attikaSetbackM > 0 ? 2 * attikaSetbackM + T.MIN_PRIMITIVE_WIDTH_M : 0;
    const shapeOpts = { minSideM: attikaMinSideM };
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
          const best = T.findBestRectangle(block, blockTargetM2, blockRect.ang, blockRect.lengthM, blockRect.widthM, shapeOpts);
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
          ? T.findBestRectangle(buildableArea, targetAreaM2, areaRect.ang, areaRect.lengthM, areaRect.widthM, shapeOpts)
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
        // file (Zürich), the full height is used, conservatively. Derived
        // above (attikaSetbackM), because the box was shaped to it.
        const ueberhoehungM = attikaUeberhoehungM;
        const setbackM = attikaSetbackM;
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
        // Nothing survived the 45° profile on any Baukörper: there is no
        // Attika to draw, so there is no Attika to REPORT either. Height,
        // Volumen and Nutzfläche all fall back to the Vollgeschosse (the
        // flag below explains why), which keeps the panel, the 3D height
        // dimension and the printed sheet describing the same building.
        if (attikaResult.anyImpossible && attikaResult.attikaAreaM2 <= 0) {
          T.suppressAttikaStorey(massingModel);
        }
      }
    }

    return { setbackRingFeature, afterWaldFeature,
             setbackFootprint, footprintBeforeWaldM2, waldRemoved, baulinienRemoved, baulinienLossM2,
             footprintAfterWaldM2, waldLossInFootprintM2, lengthLimitM, areaRect, lengthExceeded,
             gebaeudeabstandM, massing, buildableArea, footprintRect, lengthLossM2,
             setbackFootprintAreaM2, reconciled, massingModel, hasDirectional, chosenIdx,
             chosenIndices, grundabstandUsedM, grenzabstandDegraded };
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
    ablaufPanel.live(selection.length > 1
      ? `${selection.length} Parzellen vereinigt — ${Math.round(parcelAreaM2)} m²`
      : `Parzelle ${anchor.parcelNumber || anchor.egrid || ''} — ${Math.round(parcelAreaM2)} m²`);
    ablaufPanel.live(`Zone ${anchor.zone} · ${rules.gemeinde} · ${rulesData.article_grundmasse}`);

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
    ablaufPanel.live('Waldabstandslinie, Baulinien und Terrain werden abgefragt…');
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
    ablaufPanel.live(`Wald: ${wald.failed ? 'nicht prüfbar' : (wald.applies ? 'Abstandslinie schneidet die Parzelle' : 'kein Abzug')} · Baulinien: ${baulinien.failed ? 'nicht prüfbar' : (baulinien.applies ? 'vorhanden' : 'kein Abzug')}`);
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

    // A new shape invalidates any facade the user had picked by hand -- and
    // the Wohnungszahl, die zur alten Geschossflaeche gehoerte.
    southFacadeIndex = null;
    wohnungenChoice = null;
    const facadeEdges = T.pickSouthFacade(merged, rules.grosser_grenzabstand_suedseiten);

    const derived = deriveFootprint({
      merged, parcelAreaM2, anrechenbareFlaecheM2, flaechenAbzuege, rules, wald, baulinien, facadeEdges,
      southFacadeIdx: southFacadeIndex, storeys: storeyChoice, hang,
    });
    // deriveFootprint resolves "null = use the suggestion" down to an actual
    // edge index (derived.chosenIdx) -- feed that back so the rest of the
    // app (the flag text, the floor plan's highlighted edge) sees the real
    // index instead of the still-unresolved null.
    southFacadeIndex = derived.chosenIdx;
    ablaufPanel.live(`Fussabdruck abgeleitet — ${Math.round(derived.reconciled.usableFootprintAreaM2)} m² bebaubar, bindend: ${derived.reconciled.bindingConstraint}`);
    ablaufPanel.live('ÖREB-Kataster und Höhenmodell werden abgefragt…');

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

    ablaufPanel.live('Checkliste wird erstellt…');
    const checklist = await T.buildChecklist({ parcelPolygon: merged, restrictions, rules, gemeinde: rules.gemeinde, bfsNr: anchor.bfsNr, wald, waldLossInFootprintM2: derived.waldLossInFootprintM2, baulinien, baulinienLossM2: derived.baulinienLossM2 })
      .catch((e) => {
        degraded.push(`Checkliste unvollständig: ${e.message || e}`);
        return { tierA: [], tierB: [{ status: 'warn', label: 'Checkliste', text: 'Konnte nicht vollständig erstellt werden — Datenquelle nicht erreichbar. Manuell prüfen.' }] };
      });

    return { setbackRingFeature: derived.setbackRingFeature, afterWaldFeature: derived.afterWaldFeature,
             selection, anchor, rules, rulesData, merged, isSingleShape, parcelAreaM2,
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
             hasDirectional: derived.hasDirectional,
             grenzabstandDegraded: derived.grenzabstandDegraded };
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

  // The Zonenplan tab used to hold a map and nothing else, which left the two
  // questions the map raises unanswered: WHY this zone, and what it permits.
  // Both are answered here, next to the picture — the derivation (which
  // dataset was queried, at which point, with what legal status) and the full
  // Grundmasse of the zone, each with its § button into the BZO page it is
  // read from. Nothing here is recomputed: these are the same `rules` values
  // the whole analysis runs on, shown in full instead of only where a number
  // happened to be needed.
  function buildZoneSteckbrief({ anchor, selection, rules, rulesData, reconciled, multi, regimeTag }) {
    const zs = anchor.zoneSource || {};
    const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
    const val = (v, unit = '') => (v == null || v === '' ? '—' : `${v}${unit}`);
    // A value that doesn't exist in this zone gets no § button: there is no
    // passage to show, and offering one would suggest the "—" was read
    // somewhere rather than simply not being regulated here.
    const massRow = (label, value, unit, provKeys, regimeKey) => {
      if (value == null) return row(esc(label), '— (in dieser Zone nicht festgelegt)');
      return row(esc(label), withProv(`${value}${unit}${regimeKey ? regimeTag(regimeKey) : ''}`, provFor(rules, ...provKeys)));
    };

    const objektRows = [
      row('Adresse', esc(anchor.address || anchor.parcelNumber || '—')),
      row('Gemeinde', esc(`${rules.gemeinde}${anchor.bfsNr ? ` (BFS-Nr. ${anchor.bfsNr})` : ''}`)),
      row(multi ? 'Parzellen' : 'Parzelle', esc(selection.map((p) => p.parcelNumber).join(' + '))),
      row('EGRID', esc(selection.map((p) => p.egrid).join(', '))),
      row(multi ? 'Fläche (zusammengefasst)' : 'Parzellenfläche', `${fmt(reconciled.parcelAreaM2)} m²`),
    ].join('');

    const zoneRows = [
      row('Zone', esc(anchor.zone)),
      row('Bezeichnung', esc(anchor.zoneLabel ? capitalize(anchor.zoneLabel) : '—')),
      ...(anchor.zoneDescription ? [row('Beschreibung', esc(anchor.zoneDescription))] : []),
      row('Rechtsstatus', esc(val(zs.rechtsstatus))),
      // The WFS hands back a full ISO timestamp ("2019-02-08T00:00:00"); the
      // time of day is noise on an approval date.
      row('Genehmigungsdatum', esc(val(formatDateCH(zs.genehmigungsdatum)))),
      row('Kommunale Grundlage', esc(`${rulesData.version} — ${rulesData.article_grundmasse}`)),
      row('Rechtsstatus der Grundlage', esc(rulesData.legal_status || '—')),
      ...(zs.rechtsvorschriftUrl
        ? [row('Rechtsvorschrift', `<a href="${esc(zs.rechtsvorschriftUrl)}" target="_blank" rel="noopener">Dokument der Gemeinde öffnen</a>`)]
        : []),
    ].join('');

    // Which point produced the zone — the honest answer to "says who": a
    // polygon lookup at one coordinate per parcel, not a reading of the plan.
    const pointRows = selection.map((p) => row(
      esc(`Abfragepunkt Parzelle ${p.parcelNumber}`),
      esc(Number.isFinite(p.easting) ? `${p.easting.toFixed(1)} / ${p.northing.toFixed(1)} (LV95)` : '—') +
      (p.zoneSource && p.zoneSource.edgeUncertain
        ? ' <strong>— Punkt lag auf einer Zonengrenze, Zuordnung unsicher</strong>' : '')
    )).join('');

    const herleitungRows = [
      row('Datensatz', 'Kantonale Nutzungsplanung, Grundnutzung (ogd-0156)'),
      row('Dienst', 'WFS maps.zh.ch/wfs/OGDZHWFS, Layer ogd-0156_arv_basis_np_gn_zonenflaeche_f'),
      pointRows,
      row('Verfahren', 'Punkt-in-Polygon-Abfrage: die Zone stammt aus dem Polygon, das den Abfragepunkt enthält. Liegt eine Parzelle in zwei Zonen, erkennt das diese Abfrage nicht — Zonengrenze im Plan prüfen.'),
    ].join('');

    const heightIsFassade = rules.traufseitige_fassadenhoehe_max_m != null;
    const massRows = [
      massRow('Ausnützungsziffer max.', rules.ausnuetzungsziffer_max_pct, ' %', ['ausnuetzungsziffer_max_pct'], 'ausnuetzungsziffer_max_pct'),
      massRow('Vollgeschosse max.', rules.vollgeschosse_max, '', ['vollgeschosse_max'], 'vollgeschosse_max'),
      massRow('Anrechenbare Dach-/Attikageschosse', rules.anrechenbares_dach_attika_max, '', ['anrechenbares_dach_attika_max'], null),
      massRow('Anrechenbare Untergeschosse', rules.anrechenbares_untergeschoss_max, '', ['anrechenbares_untergeschoss_max'], 'anrechenbares_untergeschoss_max'),
      // Zürich under § 234 PBG: the height shown may be the in-force BZO 2016
      // value rather than the draft's, and the row has to say which.
      massRow(`${rules.heightMetric} max.`,
        rules.heightM != null
          ? `${rules.heightM} m${rules.heightRegime ? ' <span class="regime-tag" title="Strengeres Mass der in Kraft stehenden BZO 2016 (negative Vorwirkung, § 234 PBG)">BZO 2016</span>' : ''}`
          : null,
        '',
        [rules.heightRegime ? 'gebaeudehoehe_max_m_bzo2016' : (heightIsFassade ? 'traufseitige_fassadenhoehe_max_m' : 'gebaeudehoehe_max_m')], null),
      ...(rules.firsthoehe_zuschlag_m != null
        ? [massRow('Firsthöhe (Zuschlag über der Gebäudehöhe, § 281 aPBG)', rules.firsthoehe_zuschlag_m, ' m', ['firsthoehe_zuschlag_m'], null)] : []),
      massRow('Gesamtlänge max.', rules.gesamtlaenge_max_m != null ? rules.gesamtlaenge_max_m : rules.gebaeudelaenge_inkl_klein_anbauten_max_m, ' m',
        ['gesamtlaenge_max_m', 'gebaeudelaenge_inkl_klein_anbauten_max_m'], 'gesamtlaenge_max_m'),
      massRow('Kleiner Grenzabstand (Grundabstand) min.', rules.grundabstand_min_m, ' m', ['grundabstand_min_m'], null),
      ...(rules.grosser_grenzabstand_min_m != null
        ? [massRow('Grosser Grenzabstand min.', rules.grosser_grenzabstand_min_m, ' m', ['grosser_grenzabstand_min_m', 'grundabstand_min_m'], null)] : []),
      massRow('Grünflächenziffer min.', rules.gruenflaechenziffer_min_pct, ' %', ['gruenflaechenziffer_min_pct'], 'gruenflaechenziffer_min_pct'),
      ...(rules.ueberbauungsziffer_hauptgebaeude_max_pct != null
        ? [massRow('Überbauungsziffer Hauptgebäude max.', rules.ueberbauungsziffer_hauptgebaeude_max_pct, ' %', ['ueberbauungsziffer_hauptgebaeude_max_pct'], 'ueberbauungsziffer_hauptgebaeude_max_pct')] : []),
      ...(rules.attika_profil_ueberhoehung_m != null || (rules.meta && rules.meta.attika_profil_ueberhoehung_m != null)
        ? [massRow('Attika-Profil: Überhöhung über der Schnittlinie', (rules.meta && rules.meta.attika_profil_ueberhoehung_m), ' m (45°-Profil)', ['attika_profil_ueberhoehung_m'], null)] : []),
    ].join('');

    return `<h2>Zonen-Steckbrief — ${esc(anchor.zone)}</h2>` +
      `<div class="caption-line">Alle Angaben zu dieser Adresse und der Zone, aus der jede Zahl der Auswertung stammt. § öffnet die Belegstelle im Originaldokument.</div>` +
      `<h3 class="steckbrief-h">Objekt</h3><table class="numbers">${objektRows}</table>` +
      `<h3 class="steckbrief-h">Zone</h3><table class="numbers">${zoneRows}</table>` +
      `<h3 class="steckbrief-h">Woher die Zonenzuordnung stammt</h3><table class="numbers">${herleitungRows}</table>` +
      `<h3 class="steckbrief-h">Grundmasse dieser Zone</h3><table class="numbers">${massRows}</table>`;
  }

  // Parkierung (Issue #2): die Pflichtplaetze wachsen mit der Geschossflaeche
  // und muessen nach Art. 26 Abs. 3 BZO in der Regel unter den Baukoerper --
  // ab einer bestimmten Groesse bindet nicht mehr die Ausnuetzungsziffer,
  // sondern die Garage. Der Block sagt das, zieht aber nichts ab: ob die
  // Garage zweigeschossig wird oder das Haus kleiner, ist Entwurf.
  function renderParkierung(r) {
    const pk = r.parkierung;
    if (!pk) { parkierungEl.innerHTML = ''; return; }
    if (!pk.erfasst) {
      parkierungEl.innerHTML =
        `<h3 class="sub-head">Parkierung</h3>` +
        `<div class="flag">⚠ Nicht prüfbar. ${esc(pk.grund)} § 242 PBG überlässt die Zahl der Abstellplätze der BZO — ohne diese Quelle wird hier nichts gerechnet und nichts geschätzt.</div>`;
      return;
    }
    const A = pk.annahmen;
    const prov = provFor(r.rules, 'parkierung');
    const rows = [
      ['Pflichtplätze total', `<strong>${pk.totalP}</strong> (${pk.bewohnerP} Bewohner + ${pk.besucherP} Besucher)`],
      ['Bezugsgrösse', `${fmt(pk.gnfM2)} m² nutzbare Geschossfläche`],
      ['Tiefgarage, Flächenbedarf', `${fmt(pk.tiefgarageBedarfM2)} m² <span class="assumption">(Annahme ${A.flaecheJePlatzTiefgarageM2} m²/Platz, Bandbreite ${A.flaecheJePlatzTiefgarageBandM2[0]}–${A.flaecheJePlatzTiefgarageBandM2[1]})</span>`],
      ['Plätze je Untergeschoss', `${pk.plaetzeJeUgGeschoss} unter ${fmt(pk.fussabdruckM2)} m² Baukörper`],
      ['Geschossfläche, die ein UG trägt', `${fmt(pk.gnfAusEinemUgM2)} m²`],
    ];
    parkierungEl.innerHTML =
      `<h3 class="sub-head">Parkierung${prov ? withProv('', prov) : ''} ${pk.artikel ? `<span class="sub-note">${esc(pk.artikel)}</span>` : ''}</h3>` +
      `<div class="choice-label">Wohnungen — Entwurfsentscheidung. Die Besucherplätze hängen daran (1 je ${r.rules.meta.parkierung.wohnen_besucher_je_wohnungen} Wohnungen).` +
      ` <input type="number" min="1" step="1" id="wohnungen-input" value="${pk.wohnungen}" style="width:5.5em">` +
      (pk.wohnungenHergeleitet ? ` <span class="assumption">hergeleitet</span>` : '') + `</div>` +
      `<table class="numbers">${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>` +
      (pk.bindet ? `<div class="flag flag-binding">⚠ Die Parkierung bindet, nicht die Ausnützungsziffer.</div>` : '') +
      pk.hinweise.map((h) => `<div class="flag">⚠ ${esc(h)}</div>`).join('');
    wireProvButtons(parkierungEl);
    const wi = document.getElementById('wohnungen-input');
    if (wi) {
      wi.addEventListener('change', () => {
        const n = Math.max(1, Math.round(Number(wi.value) || 1));
        wohnungenChoice = n;
        rerenderWithChoices();
      });
    }
  }

  function render(r) {
    // Parkierung haengt an der GEBAUTEN Geschossflaeche, also am Ergebnis der
    // Kette, nicht an ihren Zwischenschritten -- deshalb hier und nicht in
    // deriveFootprint(). Vor setResult(), weil die Normkette sie ausweist.
    try {
      r.parkierung = T.computeParkierung({
        rules: r.rules,
        gnfM2: r.massingModel ? r.massingModel.nutzflaecheTotalM2 : 0,
        fussabdruckM2: r.massingModel ? r.massingModel.floorplateM2 : 0,
        parzelleM2: r.anrechenbareFlaecheM2,
        wohnungen: wohnungenChoice,
      });
    } catch (e) {
      // Eine unbrauchbare Parkierungsdatei darf die Analyse nicht toeten,
      // aber auch nicht als "keine Pflicht" durchgehen.
      r.parkierung = { erfasst: false, grund: `Parkierung nicht berechenbar: ${e.message}` };
    }
    ablaufPanel.setResult(r);
    const { selection, anchor, rules, rulesData, merged, isSingleShape,
            setbackFootprint, reconciled, terrainHeight, restrictions, checklist } = r;
    const multi = selection.length > 1;

    versionBannerEl.textContent =
      `${rules.gemeinde} — Basis: ${rulesData.version}, ${rulesData.article_grundmasse} — Daten zuletzt geprüft: ${rulesData.data_last_verified}`;

    // The zone leads the panel: every number underneath is derived from it,
    // so it must be readable without hunting through the table.
    // Two different questions hang on it, and they need two different proofs:
    // WHICH zone this parcel is in (a point query against the cantonal
    // dataset — the Steckbrief in the Zonenplan tab shows that derivation),
    // and WHAT that zone permits (the BZO article — the § button opens the
    // page with the Grundmasse table highlighted).
    provRegistry = [];
    const otherZonesInSelection = [...new Set(selection.map((p) => p.zone))].filter((z) => z !== anchor.zone);
    const zoneGrundmasseProv = provFor(rules, 'ausnuetzungsziffer_max_pct', 'vollgeschosse_max', 'gebaeudehoehe_max_m');
    zoneHeadlineEl.innerHTML =
      `<div class="zone-code">Zone ${esc(anchor.zone)}${withProv('', zoneGrundmasseProv)}` +
      `<button type="button" class="zone-proof-btn" id="zone-proof-btn" title="Herleitung der Zonenzuordnung und alle Grundmasse dieser Zone">Zonen-Beleg</button></div>` +
      (anchor.zoneLabel ? `<div class="zone-label">${esc(capitalize(anchor.zoneLabel))}</div>` : '') +
      `<div class="zone-meta">Gemeinde ${esc(rules.gemeinde)}` +
      ` · Rechtsstatus ${esc(anchor.zoneSource ? anchor.zoneSource.rechtsstatus : 'inKraft')}` +
      ` · kantonale Nutzungsplanung (ogd-0156)` +
      (otherZonesInSelection.length
        ? ` · Auswahl enthält auch ${esc(otherZonesInSelection.join(', '))} — gerechnet wird durchgehend mit ${esc(anchor.zone)}`
        : '') +
      `</div>`;
    wireProvButtons(zoneHeadlineEl);
    // "Zonen-Beleg" jumps to the Steckbrief rather than opening a second kind
    // of modal: the derivation, the Grundmasse and the map belong together,
    // and that is what the Zonenplan tab now holds.
    const zoneProofBtn = document.getElementById('zone-proof-btn');
    if (zoneProofBtn) {
      zoneProofBtn.addEventListener('click', () => {
        const tabBtn = document.querySelector('.tab[data-tab="zoning-map"]');
        if (tabBtn) tabBtn.click();
        zoningMapEl.scrollIntoView({ block: 'nearest' });
      });
    }

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
          const ordinary = Math.min(n, mm.ordinaryMax);
          const attika = Math.max(0, n - mm.ordinaryMax);
          // Same arithmetic buildMassingModel does for the chosen option: the
          // AZ is spent by the ORDINARY storeys only (§ 255 Abs. 2/3 PBG).
          // Dividing the permitted GFA by the TOTAL storey count sold the
          // Attika variant short -- the card advertised 74.3 m² je Geschoss
          // for a building the tool then drew with 111.5 m² plates.
          const plate = Math.min(reconciled.maxGfaM2, reconciled.usableFootprintAreaM2 * ordinary) / ordinary;
          const cov = plate / reconciled.parcelAreaM2 * 100;
          // Whether an Attika survives the 45° profile is only known for the
          // option that was actually built (its footprint decides it), so the
          // active card is the one that can carry the verdict.
          const suppressedHere = !!mm.attikaSuppressed && n === mm.requestedStoreys;
          const heightM = ordinary * mm.ordinaryStoreyHeightM
            + (suppressedHere ? 0 : attika) * mm.attikaStoreyHeightM;
          const active = n === (mm.requestedStoreys != null ? mm.requestedStoreys : mm.storeys);
          return `<button type="button" class="choice${active ? ' active' : ''}${suppressedHere ? ' unavailable' : ''}" data-storeys="${n}">`
            + `<b>${storeyCountLabel(ordinary, attika)}</b><span>${fmt(plate)} m² je Geschoss</span>`
            + `<span>${fmt(cov, 0)} % überbaut · ${fmt(heightM)} m hoch</span>`
            + (suppressedHere ? `<span class="choice-warn">Attika hier nicht darstellbar — gerechnet mit ${storeyCountLabel(ordinary, 0)}</span>` : '')
            + `</button>`;
        }).join('') +
        `</div>`;
      storeySelEl.querySelectorAll('.choice').forEach((b) => b.addEventListener('click', () => {
        storeyChoice = Number(b.dataset.storeys);
        rerenderWithChoices();
      }));
    } else {
      storeySelEl.style.display = 'none';
    }

    // NOT reset here: the zone headline above already registered its § button
    // against this same registry, and clearing it left that button pointing
    // at a citation that no longer existed.
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
    renderParkierung(r);

    const flags = [];
    // Upstream sources that failed — these change what the numbers mean, so
    // they come first.
    for (const d of (r.degraded || [])) flags.push(esc(d));
    const mmForFlags = r.massingModel;
    // attikaSuppressed: the storey was chosen and then dropped for want of
    // room under the 45° profile — attikaStoreys is 0 by then, but that is
    // exactly the case this flag has to explain.
    if (mmForFlags && (mmForFlags.attikaStoreys > 0 || mmForFlags.attikaSuppressed)) {
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
        flags.push(`Kein Attikageschoss darstellbar: ${profilText} lässt zu wenig übrig — unter ${T.MIN_PRIMITIVE_WIDTH_M} m, was kein baubarer Raum mehr ist.${calc} Die Vollgeschosse darunter bleiben davon unberührt: gerechnet und dargestellt wird ${storeyCountLabel(mmForFlags.ordinaryStoreys, 0)} mit ${fmt(mmForFlags.buildingHeightM)} m Gebäudehöhe — Höhe, Volumen und Nutzfläche oben enthalten die Attika daher nicht. Zonenrechtlich zulässig wäre sie; sie scheitert allein an der Tiefe des Baukörpers.`);
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
    // The differential offset failed geometrically. Reported, never absorbed:
    // the alternative (carrying on with the uncut band) would have quietly
    // handed back a footprint that is too large on exactly the side where the
    // law is strictest.
    if (r.grenzabstandDegraded) {
      const d = r.grenzabstandDegraded;
      flags.push(`Der seitenweise Grenzabstand liess sich auf ${d.failedEdges} von ${d.edgeCount} Hauptfassade${d.edgeCount > 1 ? 'n' : ''} geometrisch nicht bilden (unregelmässige Parzellengeometrie). Ersatzweise wurde der GROSSE Grenzabstand von ${fmt(d.appliedM)} m ringsum angewandt — das ist konservativ: der wirkliche bebaubare Bereich ist eher grösser als der hier gezeigte. Nicht als Ergebnis verwenden, ohne die Situation von Hand zu prüfen.`);
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
    // Parkierung in die Hinweisliste heben, nicht nur in ihren eigenen Block:
    // lastFlags ist es, was der PDF-Export als Blatt "Hinweise" ausgibt, und
    // eine Studie, die eine bindende Einschraenkung nur am Bildschirm zeigt,
    // ist auf Papier falsch.
    const pkFlag = r.parkierung;
    if (pkFlag && !pkFlag.erfasst) {
      flags.push(`Parkierung nicht prüfbar: ${pkFlag.grund} § 242 PBG überlässt die Zahl der Abstellplätze der BZO — hier wurde nichts gerechnet und nichts geschätzt.`);
    } else if (pkFlag && pkFlag.bindet) {
      flags.push(`Parkierung bindet: ${pkFlag.totalP} Pflichtplätze (${pkFlag.artikel}). Unter dem Baukörper (${fmt(pkFlag.fussabdruckM2, 0)} m²) fasst ein Untergeschoss rund ${pkFlag.plaetzeJeUgGeschoss} Plätze und trägt damit ${fmt(pkFlag.gnfAusEinemUgM2, 0)} m² Geschossfläche — gerechnet sind ${fmt(pkFlag.gnfM2, 0)} m². Nötig sind ${pkFlag.ugGeschosseNoetig} Untergeschosse, eine über den Baukörper hinausreichende Tiefgarage oder weniger Geschossfläche. Fläche je Platz ist eine Werkzeug-Annahme.`);
    } else if (pkFlag && !pkFlag.oberirdischPasst) {
      flags.push(`Parkierung: die ${pkFlag.besucherP} Besucherplätze brauchen rund ${fmt(pkFlag.oberirdischBedarfM2, 0)} m² oberirdisch, frei sind ${fmt(pkFlag.freiflaecheM2, 0)} m².`);
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
      buildZoneSteckbrief({ anchor, selection, rules, rulesData, reconciled, multi, regimeTag }) +
      `<h2>Zonenplan-Ausschnitt — Zone ${esc(anchor.zone)}${anchor.zoneLabel ? ` (${esc(anchor.zoneLabel)})` : ''}</h2>` +
      `<div class="caption-line">${multi ? 'Gewählte Parzellen' : 'Parzelle'} rot markiert.</div>` +
      `<div class="zoning-holder" style="position:relative;width:${mapW}px;max-width:100%;aspect-ratio:${mapW}/${mapH};">` +
      `<img src="${T.buildCadastreMapUrl(bbox, mapW, mapH)}" ` +
      `style="position:absolute;inset:0;width:100%;height:100%;mix-blend-mode:multiply;z-index:1;" alt="Parzellengrenzen">` +
      T.buildParcelOverlaySvg(allRings, bbox, mapW, mapH) +
      `</div>`;
    // Zone polygons arrive asynchronously; drop them in underneath once here.
    T.fetchZonePolygons(bbox).then((zoneFeatures) => {
      const holder = zoningMapEl.querySelector('.zoning-holder');
      if (!holder || !zoneFeatures.length) return;
      holder.insertAdjacentHTML('afterbegin',
        T.buildZonePlanSvg(zoneFeatures, bbox, mapW, mapH).replace('<svg ', '<svg style="position:absolute;inset:0;width:100%;height:100%;" '));
    }).catch(() => { /* zone colours are decorative here; the numbers stand alone */ });
    wireProvButtons(zoningMapEl);

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
      ablaufPanel.reset();
      resultsEl.style.display = 'none';
      previewPdfBtn.style.display = 'none';
      closePrintPreview();
      lastResult = null;
      lastFlags = [];
      storeyChoice = null;
      wohnungenChoice = null;
      southFacadeIndex = null;
      setStatus('Keine Parzelle gewählt — auf der Karte eine anklicken.');
      return;
    }
    const myToken = ++runToken;
    ablaufPanel.reset();
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
    closePrintPreview();
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
      // zoneLabel travels with the parcel like it does for map-clicked ones
      // (parcel-selector.js) — without it the Ausgangsparzelle showed a bare
      // code ("W2/25") everywhere, never the zone's actual name.
      const firstParcel = {
        ...parcel,
        zone: zone.zone,
        zoneLabel: zone.zoneLabel,
        zoneDescription: zone.zoneDescription,
        zoneSource: zone.zoneSource,
        rules,
      };

      mapSectionEl.style.display = 'flex';
      T.parcelMap = T.initParcelMap('map', firstParcel, refresh, gemeindeSelect.value || null);
    } catch (err) {
      setStatus('Fehler: ' + (err.message || err), true);
    }
  });
})();
