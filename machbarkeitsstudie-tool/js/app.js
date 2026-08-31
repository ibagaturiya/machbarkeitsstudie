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

  const $ = (id) => document.getElementById(id);

  // Bright-paper switch: the unexplained little checkbox in the status bar
  // flips body.bg-bright (shell.css). Survives reloads via localStorage;
  // nothing else re-themes with it.
  {
    const bgToggle = $('bg-toggle');
    const applyBg = (on) => document.body.classList.toggle('bg-bright', on);
    let savedBg = null;
    try { savedBg = localStorage.getItem('bg-bright'); } catch (_) { /* private mode */ }
    if (bgToggle) {
      bgToggle.checked = savedBg === '1';
      applyBg(bgToggle.checked);
      bgToggle.addEventListener('change', () => {
        applyBg(bgToggle.checked);
        try { localStorage.setItem('bg-bright', bgToggle.checked ? '1' : '0'); } catch (_) { /* private mode */ }
      });
    }
  }

  // ---- analysis screen -------------------------------------------------
  const form = $('address-form');
  const gemeindeSelect = $('gemeinde-select');
  const auswahlValueEl = $('auswahl-value');
  const arealOptEl = $('areal-opt');
  const arealToggleEl = $('areal-toggle');
  const einzelnEl = $('einzeln');
  const analyseBtn = $('analyse-btn');
  const previewPdfBtn = $('pdf-btn');
  const detailBtn = $('detail-btn');

  const mapHoverEl = $('map-hover');
  const mapSelEl = $('map-sel');
  const viewerEl = $('viewer');
  const isoNoteEl = $('iso-note');
  const isoReadoutEl = $('iso-readout');
  const isoControlsEl = $('iso-controls');
  const ovlModellEl = $('ovl-modell');
  const ovlPlanEl = $('ovl-plan');
  const planNoteEl = $('plan-note');
  const variantsEl = $('variants');

  const logEl = $('log');
  const logFilterEl = $('log-filter');
  const logNoteEl = $('log-note');
  const logSourcesEl = $('log-sources');

  const kennwerteEl = $('kennwerte');
  const kwNoteEl = $('kw-note');

  // The five KPI cells, each a value and a sub-line.
  // Im getrennten Modus wird das Kennzahlenband durch eine Zeile JE PARZELLE
  // ersetzt. Danach muss es sich wiederherstellen lassen — deshalb der
  // Urzustand hier, einmal beim Laden, und deshalb werden die Felder bei
  // jedem Setzen frisch geholt statt beim Start gemerkt: gemerkte Referenzen
  // zeigen nach dem Austausch ins Leere.
  const kpisEl = $('kpis');
  const KPI_BAND_URZUSTAND = kpisEl.innerHTML;
  const KPI_KEYS = ['volumen', 'gfa', 'fuss', 'hoehe', 'nutz'];

  // ---- status bar ------------------------------------------------------
  const statusEl = $('status-msg');
  const statusStandEl = $('status-stand');
  const statusTimingsEl = $('status-timings');

  // ---- detail screen ---------------------------------------------------
  const versionBannerEl = $('version-banner');
  const zoneHeadlineEl = $('zone-headline');
  const bindingSummaryEl = $('binding-summary');
  const parkierungEl = $('parkierung');
  const flagsEl = $('flags');
  const flagsNoteEl = $('flags-note');
  const checklistEl = $('checklist');
  const footnotesEl = $('footnotes');
  const sourcesSectionEl = $('sources-section');
  const zoningMapEl = $('zoning-map');
  const costEstimateEl = $('cost-estimate');
  const printDocEl = $('print-doc');
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
  // Ob der Index eine BEWUSSTE Wahl im Grundriss ist (Klick) oder nur der
  // zurueckgeschriebene automatische Vorschlag. Nur die bewusste Wahl bindet
  // im Gebaeuderechteck-Verfahren die erste Suedrichtung an die Kante.
  let southFacadeUserPicked = false;

  // ---- Arealmodus -------------------------------------------------------
  // Angehakt (Voreinstellung): die gewaehlten Parzellen gelten als EIN
  // Baugrundstueck — gemeinsame Ausnuetzung, keine Grenzabstaende an den
  // inneren Grenzen. Das setzt rechtlich eine Vereinigung oder eine im
  // Grundbuch gesicherte Uebertragung voraus; darauf weist die Auswertung
  // seit jeher hin (siehe den Vorbehalt zur Zusammenrechnung).
  //
  // Ohne Haken rechnet JEDE Parzelle fuer sich, mit ihren eigenen
  // Grenzabstaenden ringsum. Das ist der Zustand ohne Vereinigung und
  // liefert regelmaessig weniger Geschossflaeche — die Summe der Einzelnen
  // ist kleiner als das Areal, weil die inneren Abstaende zweimal kosten.
  let arealModus = true;
  // Im getrennten Modus das vollstaendige Ergebnis JE Parzelle; im
  // Arealmodus genau ein Eintrag. lastResult bleibt das, was der Bildschirm
  // im Detail zeigt (die erste Parzelle) — daran haengen Viewer, Grundriss
  // und der Beleg-Betrachter.
  let lastResults = [];

  // Drei Werte sind bisher IN render() entstanden, obwohl sie Berechnung
  // sind und keine Darstellung: die Kennwerte-Tafel, die Parkierung und die
  // Hinweise. Solange genau ein Ergebnis gerendert wurde, fiel das nicht
  // auf. Im getrennten Modus werden n Ergebnisse gerechnet und nur EINES
  // gerendert — den uebrigen fehlten dadurch im Export das Blatt
  // «Belastbarkeit der Zahlen» und das Parkierungsblatt, und ihre
  // Hinweisseite haette die Hinweise der ersten Parzelle getragen.
  //
  // Hier werden sie nachgezogen, und zwar nur, was fehlt: das gerenderte
  // Ergebnis bringt seine Werte schon mit.
  function ergaenzeAbleitungen(r) {
    if (!r.parkierung) {
      try {
        r.parkierung = T.computeParkierung({
          rules: r.rules,
          gnfM2: r.massingModel ? r.massingModel.nutzflaecheTotalM2 : 0,
          fussabdruckM2: r.massingModel ? r.massingModel.floorplateM2 : 0,
          parzelleM2: r.anrechenbareFlaecheM2,
          wohnungen: null,
        });
      } catch (e) {
        r.parkierung = { erfasst: false, grund: `Parkierung nicht berechenbar: ${e.message}` };
      }
    }
    if (!r.flags) r.flags = baueFlags(r);
    if (!r.kennwerte) r.kennwerte = T.buildKennwerte(r, { provFor, storeyCountLabel, compassLabel });
    return r;
  }

  // ---- Die Areal-Variante als ZAHL --------------------------------------
  // Getrennt gerechnet zeigt das Dokument n Auswertungen und ihre Summe. Die
  // Summe ist nicht, was die Grundstuecke ZUSAMMEN hergeben: an den inneren
  // Grenzen faellt der Grenzabstand weg (er kostet dort zweimal), und die
  // Ausnuetzung wird ueber die vereinigte Flaeche gerechnet. Bis zum
  // 31.8.2026 stand dieser Unterschied nur qualitativ im Bericht — «der
  // bebaubare Fussabdruck wird groesser», ohne zu sagen, um wieviel. Das ist
  // das Verkaufsargument des Dokuments, und es ist rechenbar.
  //
  // Gerechnet wird mit derselben Kette wie alles andere: EIN Lauf von
  // analyse() ueber die vereinigte Auswahl. Kein zweites, vereinfachtes
  // Modell und keine Hochrechnung aus den Einzelergebnissen — beides waere
  // eine Zahl ohne Herleitung (CLAUDE.md §4).
  //
  // Erst beim Export, nicht bei jeder Auswahlaenderung: der Lauf kostet die
  // vollen Quellenabfragen (Waldabstand, Baulinien, Terrainraster, OEREB,
  // Pruefliste), und gebraucht wird er allein auf dem Uebersichtsblatt.
  //
  // Scheitert er, entfaellt die Zeile MIT benannter Begruendung. Ein
  // geschaetzter Ersatzwert waere hier das Schlimmste: er stuende neben
  // gerechneten Zahlen und saehe aus wie eine von ihnen (REGELN.md §2).
  async function arealVergleich(liste) {
    if (liste.length < 2) return null;
    const alleParzellen = liste.flatMap((r) => r.selection);
    if (alleParzellen.length < 2) return null;
    // analyse() setzt southFacadeIndex und wohnungenChoice zurueck — beides
    // sind Wahlen des Nutzers am BILDSCHIRM. Ein Lauf, der nur eine Zeile im
    // Anhang fuellt, darf sie nicht ueberschreiben.
    const gemerkt = { south: southFacadeIndex, wohnungen: wohnungenChoice };
    try {
      const P = T.createProtokoll({ onLine: () => {} });
      const areal = await analyse(alleParzellen, P);
      ergaenzeAbleitungen(areal);
      return { areal, parzellen: alleParzellen.length };
    } catch (e) {
      return { fehler: e && (e.message || String(e)) };
    } finally {
      southFacadeIndex = gemerkt.south;
      wohnungenChoice = gemerkt.wohnungen;
    }
  }

  async function composePrintDoc() {
    if (!lastResult) return false;
    const liste = lastResults.length ? lastResults : [lastResult];
    liste.forEach(ergaenzeAbleitungen);
    const areal = await arealVergleich(liste);
    await T.buildPrintDocument(liste, buildGrundbuchFootnote(), areal);
    return true;
  }

  // Je Parzelle eine Zeile mit ihren Schlagzahlen, darunter die Summe.
  // Ohne diese Liste waere «getrennt gerechnet» am Bildschirm eine blosse
  // Behauptung: die Tafeln darueber zeigen immer nur die erste Parzelle.
  function renderEinzelliste(results) {
    if (!results || results.length < 2) { einzelnEl.innerHTML = ''; return; }
    const zeile = (r, i) => {
      const p = r.selection[0];
      return `<div class="ez-row${i === 0 ? ' is-anchor' : ''}">`
        + `<span class="ez-p">Parzelle ${esc(p.parcelNumber || p.egrid)}</span>`
        + `<span>${fmt(r.reconciled.parcelAreaM2, 0)} m²</span>`
        + `<span>${fmt(r.reconciled.usableFootprintAreaM2, 0)} m² Fussabdruck</span>`
        + `<span>${fmt(r.reconciled.maxGfaM2, 0)} m² GF</span></div>`;
    };
    const sum = (f) => results.reduce((a, r) => a + f(r), 0);
    einzelnEl.innerHTML = results.map(zeile).join('')
      + `<div class="ez-row is-total"><span class="ez-p">Summe — getrennt gerechnet</span>`
      + `<span>${fmt(sum((r) => r.reconciled.parcelAreaM2), 0)} m²</span>`
      + `<span>${fmt(sum((r) => r.reconciled.usableFootprintAreaM2), 0)} m² Fussabdruck</span>`
      + `<span>${fmt(sum((r) => r.reconciled.maxGfaM2), 0)} m² GF</span></div>`;
  }

  // ---- One theme, and one screen at a time ---------------------------
  // The light/dark toggle is gone with the 3a shell: the glass, the
  // millimetre paper and every accent tint are calibrated for #0e0f10, and
  // a light counterpart would be a second design rather than a variable
  // swap. isDark() stays -- viewer.js, floorplan.js and normkette.js all
  // take a palette flag, and the honest answer here is now simply "yes".
  // The print document is unaffected: it is a paper document, always light.
  function isDark() { return true; }

  // The analysis screen shows everything at once. What design 3a has no
  // slot for -- Zonen-Steckbrief, Prüfliste, Quellen, Kosten, Grundbuch,
  // Normkette -- lives on a second screen behind this button, never behind
  // a click that would hide part of the result on the screen it left.
  detailBtn.addEventListener('click', () => {
    const open = document.body.classList.toggle('detail-open');
    detailBtn.textContent = open ? 'ZURÜCK' : 'DETAILS';
    // A WebGL canvas sized while hidden has no size; coming back needs a
    // redraw at the real dimensions.
    if (!open && lastResult) {
      // Beim Zurueckkommen denselben Modus zeichnen wie zuvor, sonst zeigte
      // der Schirm nach dem Detailabstecher ploetzlich nur noch eine Parzelle.
      const alle = lastResults.length > 1 ? lastResults : null;
      renderViewer(lastResult, alle);
      renderFloorPlan(lastResult, alle);
    }
    if (open) ablaufPanel.redraw();
  });

  // Der Dateiname ist: Adresse, Exportdatum, Exportzeit (hhmmss).
  //
  // Die Uhrzeit ist der Grund, warum das Datum allein nicht reicht: wer an
  // einem Nachmittag dieselbe Parzelle dreimal exportiert — nach einer
  // Aenderung an der Geschosszahl etwa —, hatte vorher dreimal denselben
  // Namen und im Download-Ordner «(1)», «(2)». Auf die Sekunde genau sind
  // sie unterscheidbar UND in der Sortierung chronologisch.
  //
  // Die Adresse kommt aus derselben Kette wie im Dokument: eingetippte
  // Adresse, sonst die aus dem Gebaeuderegister, sonst die Parzellennummer.
  // Erfunden wird auch hier nichts.
  function pdfFilename() {
    const liste = lastResults.length ? lastResults : (lastResult ? [lastResult] : []);
    const r = liste[0];
    let betreff = '';
    if (r) {
      // Dieselbe Kette wie im Dokument (T.betreffVon, js/core/format.js):
      // Register vor Eingabe, damit Datei und Titelblatt dasselbe sagen. Fuer
      // den Dateinamen wird die erste Registeradresse OHNE Ortszusatz und
      // ohne die uebrigen Hausnummern genommen — sonst wuerde der Name bei
      // drei Adressen unbrauchbar lang.
      const ersteAusRegister = r.selection
        .map((p) => (p.adressen && p.adressen.liste && p.adressen.liste[0]) || null)
        .filter(Boolean)[0];
      betreff = ersteAusRegister
        || r.anchor.address
        || r.selection.map((p) => `Parzelle-${p.parcelNumber}`).join('_');
      // Mehrere Grundstuecke in einer Datei: die erste Adresse plus die Zahl
      // der uebrigen. Alle aneinanderzuhaengen ergaebe bei drei Adressen
      // rund 120 Zeichen, und manche Systeme schneiden das ab.
      if (liste.length > 1) betreff += `-und-${liste.length - 1}-weitere`;
    }
    const d = new Date();
    const z = (n) => String(n).padStart(2, '0');
    const datum = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
    const zeit = `${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
    return T.safeFilename([betreff, datum, zeit]);
  }

  // Startzustand: ohne Analyse gibt es nichts zu exportieren und nichts
  // aufzuschlüsseln.
  previewPdfBtn.disabled = true;
  detailBtn.disabled = true;
  previewPdfBtn.addEventListener('click', async () => {
    const label = previewPdfBtn.textContent;
    const filename = pdfFilename();
    // SYNCHRON, noch im Klick: nach dem Rastern gilt window.open() nicht mehr
    // als Folge einer Nutzeraktion und Safari blockiert es als Popup.
    const tab = T.openPendingTab(filename);
    previewPdfBtn.disabled = true;
    try {
      previewPdfBtn.textContent = 'Dokument wird gebaut …';
      // Layout ja, Sichtbarkeit nein (css/print.css). Muss VOR dem Bauen
      // gesetzt sein: print.js misst die Blätter, um überlaufende Warnungen
      // auf Fortsetzungsblätter umzubrechen — ohne Layout misst es null.
      printDocEl.classList.add('exporting');
      if (!(await composePrintDoc())) throw new Error('Keine Analyse vorhanden.');
      // Metadaten der Datei: wer im Viewer «Dokumentinfo» öffnet oder die
      // Datei indexiert, sieht Autor, Gegenstand und Suchbegriffe.
      const lr = lastResult;
      const meta = lr ? {
        author: T.ABSENDER,
        subject: `Baurechtliche Machbarkeitsstudie ${lr.anchor.address || lr.selection.map((p) => `Parzelle ${p.parcelNumber}`).join(' + ')}`,
        keywords: [lr.rules.gemeinde, ...lr.selection.map((p) => `Parzelle ${p.parcelNumber}`),
          `Zone ${lr.anchor.zone}`, ...lr.selection.map((p) => p.egrid)].join(', '),
      } : { author: T.ABSENDER };
      const res = await T.openSheetsAsPdf(tab, printDocEl, filename, meta, (i, n) => {
        previewPdfBtn.textContent = i < n ? `Blatt ${i + 1} von ${n} …` : 'PDF wird geschrieben …';
      });
      if (res.blocked) {
        setStatus('Der Browser hat den neuen Tab blockiert — die PDF wurde stattdessen '
          + 'heruntergeladen. Popups für diese Seite erlauben, dann öffnet sie sich im Viewer.', true);
      } else if (res.problems && res.problems.length) {
        // Ein leerer Kartenrahmen, den niemand erwähnt, fällt erst beim
        // Empfänger auf. Also hier sagen, nicht dort.
        setStatus(`PDF erstellt, aber unvollständig — ${res.problems.join('; ')}.`, true);
      }
    } catch (e) {
      // Ein fehlgeschlagener Export darf nicht als leerer Klick enden: der
      // Grund gehört in dieselbe Statuszeile wie jeder andere Fehler.
      setStatus(`Fehler beim PDF-Export: ${e.message}`, true);
      console.error(e);
    } finally {
      printDocEl.classList.remove('exporting');
      previewPdfBtn.textContent = label;
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

  // ---- the run protocol ------------------------------------------------
  // One protokoll per analysis run. Lines stream into the log panel as they
  // are emitted rather than appearing all at once at the end -- during a run
  // the log IS the progress indicator, which is why there is no spinner and
  // no fake percentage anywhere in this tool.
  let protokoll = null;

  function appendLogLine(line) {
    const el = document.createElement('div');
    el.className = `log-line ${line.kind}`;
    el.innerHTML = `<span class="t">${esc(line.t)}</span>`
      + `<span class="b">${esc(line.badge)}</span>`
      + `<span class="m">${esc(line.msg)}</span>`;
    logEl.appendChild(el);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function startProtokoll() {
    logEl.innerHTML = '';
    logFilterEl.innerHTML = '';
    logSourcesEl.innerHTML = '';
    logNoteEl.textContent = 'läuft …';
    protokoll = T.createProtokoll({ onLine: appendLogLine });
    return protokoll;
  }

  // The filter line and the run summary are COUNTED from the protocol and
  // the Kennwerte, never typed: "2 Annahmen" that disagreed with the two
  // rows tagged ANNAHME would be worse than no number at all.
  function renderLogSummary(sum) {
    logNoteEl.textContent = `${(sum.durationMs / 1000).toFixed(2)} s`;
    logFilterEl.innerHTML =
      `<span>alle ${protokoll.lines.length}</span>` +
      `<span class="lf-acc">${sum.citations} § Belege</span>` +
      `<span class="lf-warn">${sum.warnings} Warnung${sum.warnings === 1 ? '' : 'en'}</span>` +
      `<span class="lf-right">${sum.rulesChecked} Regeln · ${sum.assumptions} Annahmen · ${sum.conflicts} Konflikte</span>`;
    statusTimingsEl.textContent = protokoll.timings
      .map((t) => `${t.key} ${Math.round(t.ms)} ms`).join(' · ');
  }

  // QUELLEN · STAND: which dataset every number came out of, and when it
  // was last verified. Dates come from the data files, not from here.
  function renderLogSources(r) {
    const md = r.rulesData || {};
    const rows = [
      ['Kommunale BZO', `${md.version || '—'}`, md.data_last_verified || null],
      ['Nutzungsplanung Kanton', 'ogd-0156 (WFS maps.zh.ch)', null],
      ['Amtliche Vermessung', 'geo.admin.ch — Liegenschaften', null],
      ['Höhenmodell', 'swissALTI3D', null],
    ];
    logSourcesEl.innerHTML = '<span class="ls-k">QUELLEN · STAND</span>' +
      rows.map(([k, v, d]) =>
        `<div class="ls-row"><span>${esc(k)}</span><span class="d">${esc(d ? `${v} · ${formatDateCH(d)}` : v)}</span></div>`
      ).join('');
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
  function deriveFootprint({ merged, parcelAreaM2, anrechenbareFlaecheM2, flaechenAbzuege, rules, wald, baulinien, facadeEdges, southFacadeIdx, southFacadePicked, storeys, hang }) {
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

    // Returns { feature, degradedTo, verfahren }.
    //
    // Hauptweg ist seit dem 31.08.2026 das GEBÄUDERECHTECK-Verfahren
    // (Art. 18 Abs. 2 BZO: massgebend sind die Seiten des Gebäudes am
    // flächenkleinsten Rechteck, gemessen nach § 22 ABV rechtwinklig zur
    // Fassade — T.gebaeudeSeitenSetback, iterativ). Die bisherige
    // Parzellenkanten-Näherung wird zum VERGLEICH mitgerechnet und im
    // Hinweis ausgewiesen; sie ist NICHT verlässlich konservativ: auf
    // Zumikon 5029 wählte sie zwei kurze Süd-Kantenstücke (5.1 m + 9.6 m)
    // und beschnitt fast nichts — 132 m² statt der 34 m², die der
    // 10-m-Ansatz an den Gebäudeseiten wirklich übrig lässt (REGELN.md §13).
    //
    // Rückfallkette, jede Stufe wird benannt statt still gewechselt:
    //   1. Gebäuderechteck-Verfahren (verfahren.methode = 'gebaeuderechteck')
    //   2. Parzellenkanten-Näherung  ('parzellenkanten', mit Grund aus 1)
    //   3. grosser Abstand ringsum   (degradedTo — kann nie zu viel zeigen)
    const runSetback = (smallM) => {
      if (!(hasDirectional && chosenEdges.length)) {
        return { feature: T.bufferLV95(merged, -smallM), degradedTo: null, verfahren: null };
      }
      const bigM = rules.grosser_grenzabstand_min_m;
      // Nur eine BEWUSSTE Wahl im Grundriss bindet die erste Südrichtung an
      // die angeklickte Kante — der automatische Vorschlag bindet nichts,
      // sonst würde die Rechteck-Rangfolge stillschweigend übersteuert.
      const preferBearingDeg = southFacadePicked && chosenEdges[0]
        ? chosenEdges[0].bearingDeg : null;
      const geb = T.gebaeudeSeitenSetback(merged, smallM, bigM, suedCount, preferBearingDeg);
      const approx = T.anisotropicSetbackMulti(merged, chosenEdges, smallM, bigM);
      if (!geb.failed) {
        return {
          feature: geb.feature, degradedTo: null,
          verfahren: {
            methode: 'gebaeuderechteck',
            iterationen: geb.iterations,
            suedSeiten: (geb.suedSeiten || []).map((s) => ({ bearingDeg: s.bearingDeg, lengthM: s.length })),
            vergleichParzellenkantenM2: (!approx.failedEdges && approx.feature)
              ? T.planarAreaAnyLV95(approx.feature) : null,
          },
        };
      }
      if (!approx.failedEdges) {
        return {
          feature: approx.feature, degradedTo: null,
          verfahren: { methode: 'parzellenkanten', gebaeuderechteckFehler: geb.failed },
        };
      }
      return {
        feature: T.bufferLV95(merged, -bigM),
        degradedTo: { appliedM: bigM, failedEdges: approx.failedEdges, edgeCount: chosenEdges.length },
        verfahren: { methode: 'ringsum', gebaeuderechteckFehler: geb.failed },
      };
    };

    // One full derivation pass at a given Grundabstand — everything from the
    // setback ring to the placed massing. Runs once normally, twice when the
    // Mehrlängenzuschlag kicks in.
    const computePass = (grundabstandUsedM) => {
    const setbackResult = runSetback(grundabstandUsedM);
    let setbackFootprint = setbackResult.feature;
    const grenzabstandDegraded = setbackResult.degradedTo;
    const grenzabstandVerfahren = setbackResult.verfahren;
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
             chosenIndices, grundabstandUsedM, grenzabstandDegraded, grenzabstandVerfahren };
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
  // Welche Normen dieser Durchgang tatsaechlich angewandt hat, als Paare
  // [Schluessel im _provenance-Block, was sie hier bewirkt hat]. Bedingt
  // notierte Zeilen stehen nur drin, wenn die Regel wirklich gegriffen hat --
  // ein Paragraph, der nichts getan hat, gehoert nicht ins Protokoll.
  function citedRules(rules, d) {
    const out = [
      ['grundabstand_min_m', `Grundabstand ${fmt(d.grundabstandUsedM ?? rules.grundabstand_min_m)} m`],
      ['ausnuetzungsziffer_max_pct', `Ausnützungsziffer ${(rules.ausnuetzungsziffer_max_pct / 100).toFixed(2)} — bindendes Maximum`],
      ['vollgeschosse_max', `Vollgeschosse max. ${rules.vollgeschosse_max}`],
      [rules.heightRegime ? 'gebaeudehoehe_max_m_bzo2016'
        : (rules.traufseitige_fassadenhoehe_max_m != null ? 'traufseitige_fassadenhoehe_max_m' : 'gebaeudehoehe_max_m'),
        `${rules.heightMetric} max. ${rules.heightM} m`],
    ];
    if (d.hasDirectional && rules.grosser_grenzabstand_min_m != null) {
      out.push(['grosser_grenzabstand_min_m', `grosser Grenzabstand ${fmt(rules.grosser_grenzabstand_min_m)} m an der Hauptfassade`]);
    }
    if (d.mehrlaengen) out.push(['mehrlaengenzuschlag', `Mehrlängenzuschlag auf ${fmt(d.mehrlaengen.requiredM)} m`]);
    if (d.waldLossInFootprintM2 > 0.5) out.push(['waldabstand', `Waldabstand — ${fmt(d.waldLossInFootprintM2)} m² entfallen`]);
    if (d.reconciled.hasGreenCap) out.push(['gruenflaechenziffer_min_pct', `Grünflächenziffer min. ${rules.gruenflaechenziffer_min_pct} %`]);
    if (d.reconciled.hasUeberbauungsCap) out.push(['ueberbauungsziffer_hauptgebaeude_max_pct', `Überbauungsziffer max. ${rules.ueberbauungsziffer_hauptgebaeude_max_pct} %`]);
    if (d.lengthLimitM != null) {
      out.push([rules.gesamtlaenge_max_m != null ? 'gesamtlaenge_max_m' : 'gebaeudelaenge_inkl_klein_anbauten_max_m',
        `Gebäudelänge max. ${d.lengthLimitM} m`]);
    }
    const mm = d.massingModel;
    if (mm && (mm.attikaStoreys > 0 || mm.ugStoreys > 0)) {
      out.push(['dach_attika_ug_freibetrag', `Freibetrag Dach-/Attika-/Untergeschoss bis ${fmt(mm.perStoreyFreeM2)} m² je Geschoss`]);
    }
    if (mm && mm.attikaStoreys > 0) out.push(['attika_profil_ueberhoehung_m', `45°-Profil Attika, Rücksprung ${fmt(mm.attikaSetbackM)} m`]);
    return out;
  }

  async function analyse(selection, P) {
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
    P.stage('parcel', selection.length > 1
      ? `parcel.union ${selection.length} Parzellen → ${fmt(parcelAreaM2)} m²`
      : `parcel.fetch ${anchor.parcelNumber || anchor.egrid} → Polygon ${fmt(parcelAreaM2)} m²`);
    P.stage('zone', `zone.match ogd-0156 → ${anchor.zone} (${anchor.zoneSource ? anchor.zoneSource.rechtsstatus : 'inKraft'})`);
    P.mark('sources');

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
    P.stage('sources', 'sources.fetch Waldabstand · Baulinien · Terrain');
    if (!wald.failed && !wald.applies) P.ok('check.wald keine Waldabstandslinie auf der Parzelle');
    if (!baulinien.failed && !baulinien.applies) P.ok('check.baulinien keine Baulinie auf der Parzelle');
    // Der Hoehendienst faellt still aus (catch -> null) und landet nicht in
    // `degraded`; deshalb hier eigens gemeldet.
    if (!terrainGrid) P.warn('Höhenmodell nicht erreichbar — Hanglage und Attika-Bergseite ungeprüft');
    const slope = terrainGrid ? T.fitTerrainSlope(terrainGrid.points) : null;
    const hang = slope ? { ...slope, isHang: slope.slopePercent >= 10 } : null;

    // Anrechenbare Grundstücksfläche (§ 255/259 PBG bzw. § 259 aPBG):
    // forest inside the parcel does not count toward the AZ/ÜZ/GFZ reference
    // area (old law: "Wald ... fallen ausser Ansatz"; harmonised law: forest
    // is not Bauzone), and neither do Waldabstandsflächen more than 15 m
    // behind the Waldabstandslinie (§ 259 aPBG; computed geometrically in
    // js/sources/waldabstand.js — the Zumikon-2999 reference filing deducts
    // exactly this before applying the AZ). Open water and non-Bauzone parts
    // are NOT auto-detected — reported as unchecked in the flags.
    let flaechenAbzuege = {
      waldM2: 0,
      // null = nicht ermittelbar (Quelle ausgefallen oder Seite unbestimmt),
      // nie stillschweigend 0 — die Flags sagen es dann.
      waldAbstand15M2: typeof wald.ausserAnsatzM2 === 'number' ? wald.ausserAnsatzM2 : null,
      waldChecked: !wald.failed, gewaesserChecked: false, andereZoneChecked: false,
    };
    if (wald.forest && wald.forest.length) {
      try {
        const forestUnion = wald.forest
          .map((ff) => ff)
          .reduce((acc, ff) => (acc ? turf.union(acc, ff) : ff), null);
        const forestInParcel = forestUnion ? turf.intersect(merged, forestUnion) : null;
        if (forestInParcel) flaechenAbzuege.waldM2 = T.planarAreaAnyLV95(forestInParcel);
      } catch (e) { /* keep 0, the flag reports water/zones as unchecked anyway */ }
    }
    const anrechenbareFlaecheM2 = Math.max(0,
      parcelAreaM2 - flaechenAbzuege.waldM2 - (flaechenAbzuege.waldAbstand15M2 || 0));

    // A new shape invalidates any facade the user had picked by hand -- and
    // the Wohnungszahl, die zur alten Geschossflaeche gehoerte.
    southFacadeIndex = null;
    southFacadeUserPicked = false;
    wohnungenChoice = null;
    const facadeEdges = T.pickSouthFacade(merged, rules.grosser_grenzabstand_suedseiten);

    const derived = deriveFootprint({
      merged, parcelAreaM2, anrechenbareFlaecheM2, flaechenAbzuege, rules, wald, baulinien, facadeEdges,
      southFacadeIdx: southFacadeIndex, southFacadePicked: false, storeys: storeyChoice, hang,
    });
    // deriveFootprint resolves "null = use the suggestion" down to an actual
    // edge index (derived.chosenIdx) -- feed that back so the rest of the
    // app (the flag text, the floor plan's highlighted edge) sees the real
    // index instead of the still-unresolved null.
    southFacadeIndex = derived.chosenIdx;
    ablaufPanel.live(`Fussabdruck abgeleitet — ${Math.round(derived.reconciled.usableFootprintAreaM2)} m² bebaubar, bindend: ${derived.reconciled.bindingConstraint}`);
    // Eine Zitatzeile je Norm, die in DIESEM Lauf wirklich gegriffen hat --
    // deshalb hier und nicht vor der Ableitung: vorher ist nur bekannt, was
    // die Zone kennt, nicht was angewandt wurde. Der Artikeltext kommt aus
    // dem _provenance-Block der Datendatei; hier wird kein Paragraph
    // formuliert (CLAUDE.md §4).
    for (const [key, was] of citedRules(rules, derived)) {
      const prov = T.getProvenance(rules, key);
      if (prov && prov.article) P.cite(prov.article, was);
    }
    P.stage('geometry', `geometry.solve buffer(−${fmt(derived.grundabstandUsedM ?? rules.grundabstand_min_m)} m) → ${fmt(derived.footprintBeforeWaldM2)} m²`);
    if (derived.waldLossInFootprintM2 > 0.5) P.step(`forest.setback −${fmt(derived.waldLossInFootprintM2)} m² im Fussabdruck`);
    if (derived.baulinienLossM2 > 0.5) P.step(`baulinie.cut −${fmt(derived.baulinienLossM2)} m² im Fussabdruck`);
    if (flaechenAbzuege.waldAbstand15M2 > 0.5) {
      P.step(`flaeche.ausserAnsatz § 259 aPBG: − ${fmt(flaechenAbzuege.waldAbstand15M2)} m² Waldabstandsfläche > 15 m hinter der Linie`);
    }
    P.step(`az.apply ${fmt(anrechenbareFlaecheM2)} × ${(rules.ausnuetzungsziffer_max_pct / 100).toFixed(2)} = ${fmt(derived.reconciled.maxGfaM2)} m²`);
    if (derived.massingModel) {
      const m = derived.massingModel;
      P.step(`massing.stack ${m.ordinaryStoreys} VG${m.attikaStoreys ? ' + Attika' : ''} à ${fmt(m.floorplateM2)} m² → H ${fmt(m.buildingHeightM)} m`);
    }
    if (derived.lengthLimitM != null && derived.footprintRect && !derived.lengthExceeded) {
      P.ok(`check.length ${fmt(derived.footprintRect.lengthM)} × ${fmt(derived.footprintRect.widthM)} m ≤ ${derived.lengthLimitM} m — eingehalten`);
    } else if (derived.lengthExceeded) {
      P.warn(`check.length ${fmt(derived.areaRect.lengthM)} m > ${derived.lengthLimitM} m — Aufteilung in Baukörper`);
    }
    // Plausibilitätsprüfung gegen den Bestand (js/sources/bekannte-gebaeude.js):
    // ist auf einer der gewählten Parzellen ein bestehendes oder bewilligtes
    // Gebäude bekannt, muss es in den berechneten bebaubaren Bereich passen —
    // sonst wird gewarnt statt still weitergerechnet. Die Prüfung ändert
    // keine Zahl; sie ist eine Passprobe des Ergebnisses gegen die Realität.
    let bestandsPruefung;
    try {
      await T.ladeBekannteGebaeude();
      bestandsPruefung = T.pruefeBestandsGebaeude({ selection, rules, buildableArea: derived.buildableArea });
    } catch (e) {
      bestandsPruefung = { geprueft: false, grund: `data/bekannte-gebaeude.json nicht ladbar (${e.message || e})`, eintraege: [] };
    }
    for (const g of (bestandsPruefung.eintraege || [])) {
      if (g.fehler) P.warn(`check.bestand ${g.name} (Parzelle ${g.parzelle}): ${g.fehler}`);
      else if (g.passt) P.ok(`check.bestand ${g.name} (${g.status}, ${fmt(g.laenge_m)} × ${fmt(g.breite_m)} m) findet im bebaubaren Bereich Platz`);
      else P.warn(`check.bestand ${g.name} (${g.status}, ${fmt(g.laenge_m)} × ${fmt(g.breite_m)} m) findet im bebaubaren Bereich KEINEN Platz — Ergebnis widerspricht der Bewilligung, siehe Hinweise`);
    }

    P.mark('oereb');
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

    P.stage('oereb', 'oereb.fetch ÖREB-Kataster · Höhenpunkt');
    // Jede ausgefallene Quelle wird hier gemeldet — an EINER Stelle, nachdem
    // alle abgefragt sind. Vorher stand die Zaehlung ("1 Konflikt") in der
    // Filterzeile, ohne dass eine einzige Zeile im Protokoll sagte, welche
    // Quelle es war: eine Zahl ohne Beleg, genau das, was dieses Fenster
    // verhindern soll. Eine ausgefallene Quelle ist kein bestandener Test
    // (REGELN.md §2).
    for (const d of degraded) P.warn(d);
    ablaufPanel.live('Checkliste wird erstellt…');
    P.mark('checklist');
    const checklist = await T.buildChecklist({ parcelPolygon: merged, restrictions, rules, gemeinde: rules.gemeinde, bfsNr: anchor.bfsNr, wald, waldLossInFootprintM2: derived.waldLossInFootprintM2, baulinien, baulinienLossM2: derived.baulinienLossM2 })
      .catch((e) => {
        degraded.push(`Checkliste unvollständig: ${e.message || e}`);
        return { tierA: [], tierB: [{ status: 'warn', label: 'Checkliste', text: 'Konnte nicht vollständig erstellt werden — Datenquelle nicht erreichbar. Manuell prüfen.' }] };
      });

    P.stage('checklist', `check.list ${checklist.tierA.length} automatisch · ${checklist.tierB.length} manuell zu prüfen`);

    return { setbackRingFeature: derived.setbackRingFeature, afterWaldFeature: derived.afterWaldFeature,
             selection, anchor, rules, rulesData, merged, isSingleShape, parcelAreaM2,
             anrechenbareFlaecheM2, flaechenAbzuege, degraded,
             mehrlaengen: derived.mehrlaengen, grundabstandUsedM: derived.grundabstandUsedM,
             chosenIndices: derived.chosenIndices,
             grenzabstandVerfahren: derived.grenzabstandVerfahren, bestandsPruefung,
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
  const floorplanEl = document.getElementById('floorplan');

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
  function renderFloorPlan(r, alle) {
    if (!r.setbackFootprint) { floorplanEl.innerHTML = ''; planNoteEl.textContent = ''; return; }
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
    // Getrennt gerechnet: alle Parzellen und alle Baukoerper in EINER
    // Zeichnung. Die Bemassungen und die Fassadenwahl beziehen sich weiterhin
    // auf die erste Parzelle — sie stehen unten ausdruecklich nur fuer diese,
    // und ein Laengenrechteck ueber fremde Parzellen waere schlicht falsch.
    const mehrere = alle && alle.length > 1;
    const parcelZeichnung = mehrere
      ? T.multiPolygonAus(alle.map((x) => x.merged)) : r.merged;
    const fussZeichnung = mehrere
      ? T.multiPolygonAus(alle.map(T.gezeichneterFussabdruck)) : footprintFeature;
    floorplanEl.innerHTML = T.buildFloorPlanSvg({
      parcelFeature: parcelZeichnung,
      footprintFeature: fussZeichnung,
      // The full legal envelope (pre-cuboid, pre-split) -- shown so it's
      // visible on the plan, not only in 3D, where the Baukörper could be
      // placed. Only worth drawing separately from the Baukörper itself
      // when it's actually bigger than what's built.
      hullFeature: r.buildableArea && T.planarAreaAnyLV95(r.buildableArea) > builtAreaM2ForHull * 1.02 ? r.buildableArea : null,
      removedFeature: mehrere ? T.multiPolygonAus(alle.map((x) => x.waldRemoved)) : r.waldRemoved,
      // The area-rectangle overlay only earns its place on the drawing when
      // the length constraint actually did something (forced a split, or
      // couldn't be satisfied) -- for an ordinary compliant single cuboid
      // it would just duplicate the facade-length labels already on the
      // building itself.
      lengthRect: mehrere ? null
        : (r.lengthExceeded ? (r.massing && !r.massing.impossible ? r.areaRect : r.footprintRect) : null),
      lengthLimitM: r.lengthLimitM,
      lengthResolved: !!(r.massing && !r.massing.impossible),
      blockCount: mehrere
        ? alle.reduce((n, x) => n + (x.massing ? x.massing.count : 0), 0)
        : (r.massing ? r.massing.count : 0),
      blocks: mehrere ? alle.flatMap(T.bloeckeVon) : blocks,
      facadeEdges: (!mehrere && r.hasDirectional) ? r.facadeEdges : null,
      southFacadeIndex: (!mehrere && r.hasDirectional) ? r.southFacadeIndex : null,
      grosserGrenzabstandM: r.rules.grosser_grenzabstand_min_m,
      dragEnabled: draggableHere && !mehrere,
      dark: isDark(),
      terrainGrid: r.terrainGrid,
      hang: r.hang,
      // Die Waldabstandslinie laeuft DURCHGEHEND ueber die Zeichnung —
      // unbeschnitten von Parzellengrenzen; im getrennten Modus ueber alle
      // Auswertungen gesammelt und dedupliziert (js/sources/waldabstand.js).
      waldLinien: mehrere ? T.sammleWaldLinien(alle) : T.sammleWaldLinien([r]),
      widthPx: 900, heightPx: 640,
    });
    // Clicking a boundary edge picks it as the Hauptfassade -- overrides the
    // automatic south-facing suggestion without re-running the async parts
    // of the analysis (see rerenderWithChoices).
    if (r.hasDirectional) {
      floorplanEl.querySelectorAll('.facade-edge').forEach((el) => {
        el.addEventListener('click', () => {
          southFacadeIndex = Number(el.dataset.facadeIndex);
          southFacadeUserPicked = true;
          rerenderWithChoices();
        });
      });
    }
    enablePlanPanZoom(floorplanEl);
    if (draggableHere) {
      enablePlanBuildingDrag(floorplanEl, r);
    }
    // Die Legende ist in die Notizzeile des Panelkopfs gewandert: eine
    // Textzeile unter der Zeichnung kostete Zeichenflaeche, und im 3a-Raster
    // ist der Situationsplan das kleinere der beiden Fenster.
    const builtAreaM2 = footprintFeature ? T.planarAreaAnyLV95(footprintFeature) : 0;
    planNoteEl.textContent = `${fmt(r.footprintAfterWaldM2)} m² bebaubar · Baukörper ${fmt(builtAreaM2)} m²`
      + (r.waldLossInFootprintM2 > 0.5 ? ` · ${fmt(r.waldLossInFootprintM2)} m² Waldabstand` : '');

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

  // Die drei Knoepfe an der Isometrie. Einmal verdrahtet, danach zeigt der
  // Handler nur noch auf die jeweils aktuelle Umlaufbahn -- renderViewer
  // baut die Szene bei jeder Aenderung neu, und ein pro Aufbau neu
  // registrierter Listener haette sich mit jedem Rendern vervielfacht.
  let isoOrbit = null;
  function wireIsoControls(orbit) {
    isoOrbit = orbit;
    if (isoControlsEl.dataset.wired) return;
    isoControlsEl.dataset.wired = '1';
    document.getElementById('iso-ccw').addEventListener('click', () => isoOrbit && isoOrbit.stepAzimuth(-15));
    document.getElementById('iso-cw').addEventListener('click', () => isoOrbit && isoOrbit.stepAzimuth(15));
    document.getElementById('iso-reset').addEventListener('click', () => isoOrbit && isoOrbit.reset());
  }

  function renderViewer(r, alle) {
    if (!r.setbackFootprint) {
      viewerEl.innerHTML = '<p class="pane-empty">Kein Volumen darstellbar.</p>';
      isoControlsEl.hidden = true; isoReadoutEl.hidden = true; ovlModellEl.hidden = true;
      return;
    }
    if (!viewerEl.clientWidth) return;
    const mm = r.massingModel;
    // Getrennt gerechnet: alle Parzellen in einer Szene. Die Nachbarn kommen
    // als eigene Baukoerper mit EIGENER Hoehe (weitereMassings) — sie in den
    // ersten hineinzufalten wuerde sie auf dessen Hoehe ziehen.
    const mehrere = alle && alle.length > 1;
    const view = T.renderEnvelope(viewerEl, {
      footprintFeature: mehrere
        ? T.multiPolygonAus(alle.map((x) => x.setbackFootprint)) : r.setbackFootprint,
      parcelFeature: mehrere
        ? T.multiPolygonAus(alle.map((x) => x.merged)) : r.merged,
      removedFeature: mehrere
        ? T.multiPolygonAus(alle.map((x) => x.waldRemoved)) : r.waldRemoved,
      waldLinien: mehrere ? T.sammleWaldLinien(alle) : T.sammleWaldLinien([r]),
      heightM: r.rules.heightM,
      massing: mm,
      weitereMassings: mehrere ? alle.slice(1).map((x) => x.massingModel) : null,
      interactive: true,
      dark: isDark(),
      // Dragging works per block now (viewer.js), so a Gebäudelänge split
      // into several Baukörper no longer disables it -- each block is
      // grabbed and moved independently, checked against both the buildable
      // area and its neighbours (blockGapM below).
      draggable: !!(mm && mm.storeyOptions) && !mehrere,
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
      // Die Kamera meldet ihre eigenen Zahlen zurueck; die Ableseleiste
      // erfindet nichts und rechnet nichts nach.
      onCamera: (c) => {
        isoReadoutEl.textContent = `Azimut ${c.azimuthDeg}° · Neigung ${c.polarDeg}° · ${c.zoom.toFixed(2)}×`;
      },
    });
    // ⟲ / ⟳ / RESET fahren dieselbe Umlaufbahn wie das Ziehen (viewer.js
    // orbit) -- eine zweite, knopfeigene Drehung waere beim ersten Clamp auf
    // einer der beiden Seiten aus dem Tritt geraten.
    isoControlsEl.hidden = false;
    isoReadoutEl.hidden = false;
    wireIsoControls(view.orbit);
    // Same "is the ghost actually drawn" threshold as viewer.js -- explains
    // the pale volume in the scene instead of leaving it unlabelled.
    const ghostShown = mm && (mm.footprintScale < 0.97 || mm.buildingHeightM < r.rules.heightM - 0.05);
    const multiBlock = !!(r.massing && r.massing.count > 1);
    const dragHint = mm && mm.storeyOptions
      ? ` Den Baukörper${multiBlock ? ' (bei mehreren: den jeweiligen)' : ''} direkt anfassen und ziehen, um ihn innerhalb der Hülle zu verschieben. Shift+Ziehen verschiebt stattdessen den Bildausschnitt.`
      : '';
    const canvasEl = viewerEl.querySelector('canvas');
    if (canvasEl) {
      canvasEl.title = 'Zum Drehen ziehen, Shift+Ziehen verschiebt den Ausschnitt, Scrollen zoomt.' + dragHint
        + (ghostShown ? ' Das helle, transparente Volumen ist die maximal zonenrechtlich zulässige Hülle (ganzer Fussabdruck × maximale Höhe); der farbige Teil ist, was bei der gewählten Geschosszahl gebaut wird.' : '');
    }
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
      facadeEdges: r.facadeEdges, southFacadeIdx: southFacadeIndex,
      southFacadePicked: southFacadeUserPicked, storeys: storeyChoice, hang: r.hang,
    });
    southFacadeIndex = derived.chosenIdx;
    Object.assign(r, derived, { southFacadeIndex });
    // Die Fassadenwahl aendert den bebaubaren Bereich — die Bestandsprobe
    // muss gegen den NEUEN laufen, sonst warnt (oder schweigt) sie zur alten
    // Geometrie. Synchron moeglich: die Datendatei ist seit analyse() da.
    r.bestandsPruefung = T.pruefeBestandsGebaeude(r);
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
      // Eine Quelle fuer den Namen (js/core/format.js): Adressregister,
      // sonst die eingetippte Adresse, sonst «Parzelle NNNN». Vorher stand
      // hier `anchor.address || anchor.parcelNumber` — auf einer angeklickten
      // Nachbarparzelle also die Nummer, waehrend Deckblatt und Trennseite
      // fuer dasselbe Grundstueck die Adresse zeigten.
      row('Adresse', esc(T.betreffVon({ selection, anchor }))),
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
      [...(pk.bindendHinweis ? [pk.bindendHinweis] : []), ...pk.hinweise]
        .map((h) => `<div class="flag">⚠ ${esc(h)}</div>`).join('');
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

  // ---- Nicht gerechnet: Gemeinde ohne hinterlegte BZO ------------------
  // Der Lauf bricht weiterhin ab — es wird keine Zahl geschaetzt und kein
  // Teilergebnis als Ergebnis dargestellt (CLAUDE.md §2). Neu ist nur, dass
  // der Abbruch die Luecke BENENNT: was das kantonale Recht auch ohne BZO
  // hergibt, was die BZO liefern muesste, und was beizubringen ist. Genau an
  // dieser Stelle wird die Ableitung PBG/ABV → BZO sichtbar.
  function renderNichtGerechnet(err) {
    const liste = (items) => `<ul class="ng-list">${items.join('')}</ul>`;
    const kantonal = err.vorhandenAusKanton.length
      ? liste(err.vorhandenAusKanton.map((v) =>
          `<li><span class="sich s-BELEGT">§</span>`
          + `<span class="ng-lb">${esc(v.label.replace(/_/g, ' '))}</span>`
          + `<span class="ng-src">${esc(v.artikel || '—')}</span></li>`))
      : `<p class="ng-none">Auch der kantonale Datensatz liess sich nicht laden.</p>`;
    const kommunal = liste(err.erforderlichAusBzo.map((v) =>
      `<li><span class="sich s-NICHT_ERMITTELBAR">?</span>`
      + `<span class="ng-lb">${esc(v.label)}</span>`
      + `<span class="ng-src">${esc(v.wofuer)}</span></li>`));
    kennwerteEl.innerHTML =
      `<div class="nicht-gerechnet">`
      + `<div class="ng-head">Nicht gerechnet — ${esc(err.gemeinde)}</div>`
      + `<p class="ng-intro">Für diese Gemeinde ist keine Bau- und Zonenordnung hinterlegt. `
      + `Das kantonale Recht allein trägt keinen Fussabdruck und keine Geschossfläche, `
      + `deshalb wird hier nichts gerechnet statt geschätzt.</p>`
      + `<div class="ng-sec"><h4>Aus PBG / ABV vorhanden</h4>${kantonal}</div>`
      + `<div class="ng-sec"><h4>Aus der BZO erforderlich — fehlt</h4>${kommunal}</div>`
      + `<div class="ng-sec"><h4>Beizubringen</h4>`
      + liste(err.beizubringen.map((b) => `<li><span class="ng-lb ng-wide">${esc(b)}</span></li>`))
      + `</div>`
      + `<p class="ng-foot">Hinterlegt sind zurzeit: ${esc(err.erfassteGemeinden.join(', '))}.</p>`
      + `</div>`;
    kwNoteEl.textContent = 'nicht gerechnet';
  }

  // ---- Kennwerte-Tafel ------------------------------------------------
  // Kennwert / Wert / Beleg, gruppiert. Beim Ueberfahren einer Zeile steht
  // ihre Herleitung in der Leiste unten -- jeder Wert traegt den String, es
  // gibt also auf diesem Bildschirm keine Zahl ohne sichtbaren Rechenweg.
  // Die Herleitung erscheint als Popover NEBEN der Zeile: die eine Leiste
  // unten war fuer lange Formeln zu kurz und zu weit vom Blick entfernt.
  // Die Leiste bleibt bestehen und zeigt weiterhin denselben Text.
  const kwTip = document.createElement('div');
  kwTip.id = 'kw-tip';
  kwTip.hidden = true;
  document.body.appendChild(kwTip);
  function showKwTip(rowEl, text) {
    kwTip.textContent = text;
    kwTip.hidden = false;
    const r = rowEl.getBoundingClientRect();
    if (r.left >= 260) {
      // Genug Platz links neben der Tafel (Desktop-Dreispalter).
      kwTip.style.right = `${Math.round(window.innerWidth - r.left + 8)}px`;
      kwTip.style.left = 'auto';
      const h = kwTip.offsetHeight;
      kwTip.style.top = `${Math.round(Math.max(8, Math.min(r.top, window.innerHeight - h - 8)))}px`;
    } else {
      // Schmales Fenster / iPhone: unter der Zeile, ueber die volle Breite —
      // links waere das Popover ausserhalb des Bildschirms.
      kwTip.style.left = '12px';
      kwTip.style.right = '12px';
      const h = kwTip.offsetHeight;
      const below = r.bottom + 6;
      kwTip.style.top = `${Math.round(below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : below)}px`;
    }
  }
  function renderKennwerte(groups) {
    const cssKind = (k) => `kd-${k.replace('Ü', 'UE').replace('Ä', 'AE').replace('Ö', 'OE')}`;
    kennwerteEl.innerHTML = groups.map((g) => {
      const rows = g.rows.map((row) => {
        const id = row.prov ? provRegistry.push(row.prov) - 1 : null;
        // Zweites Abzeichen: wie belastbar ist der Wert (js/core/sicherheit.js).
        // `kind` sagt woher er kommt, `sicherheit` sagt was er traegt — die
        // beiden Achsen werden bewusst nicht zusammengelegt.
        const st = T.SICHERHEIT_STUFEN[row.sicherheit];
        const stTitle = `${st.label}: ${row.sicherheitGrund || st.erklaerung}`
          + (row.sicherheitVererbt ? ' · geerbt von einem Eingangswert' : '');
        // Das Sicherheitszeichen steht VORNE, in einer eigenen schmalen
        // Spalte: so bildet es eine Kolonne, die sich von oben nach unten
        // ueberfliegen laesst. Stuende es hinten, muesste man es je Zeile
        // suchen. Das Wort dazu steht im Titel und in der Legende.
        return `<div class="kw-row kw-s-${row.sicherheit}" data-formula="${esc(row.formula || '')}" data-sicher="${esc(stTitle)}" data-source="${esc(row.source || '')}">`
          + `<span class="sich s-${row.sicherheit}${row.sicherheitVererbt ? ' is-vererbt' : ''}" title="${esc(stTitle)}" aria-label="${esc(st.label)}">${esc(st.zeichen)}</span>`
          + `<span class="lb">${esc(row.label)}</span>`
          + `<span class="vl">${esc(row.value)}</span>`
          + `<span class="bg ${row.isCitation ? 'is-par' : 'is-src'}" title="${esc(row.source)}">`
          + esc(row.source)
          + (id != null ? `<button type="button" class="prov-btn" data-prov="${id}" title="Beleg im Originaldokument">§</button>` : '')
          + `</span>`
          + `<span class="kd ${cssKind(row.kind)}">${esc(row.kind)}</span>`
          + `</div>`;
      }).join('');
      return `<div class="kw-group">`
        + `<div class="kw-group-head">${esc(g.title)}<span class="note">${esc(g.note)}</span></div>`
        + rows + `</div>`;
    }).join('');
    // Die Zahlen hier kommen aus derselben Zaehlung wie die Abzeichen in der
    // Tabelle — sie koennen deshalb nicht davon abweichen.
    const alleRows = groups.flatMap((g) => g.rows);
    const z = T.zaehleSicherheit(alleRows);
    // Legende der Sicherheitsstufen, mit den Zaehlern direkt IN ihr. Der
    // Panel-Titel traegt nur noch "22 Werte": die volle Aufschluesselung
    // dort quetschte sich zweizeilig in die 30-px-Titelleiste.
    kennwerteEl.insertAdjacentHTML('afterbegin',
      `<div class="sich-legende">`
      + T.SICHERHEIT_STUFEN_NACH_RANG.map((st) =>
        `<span title="${esc(st.erklaerung)}"><i class="sich s-${st.key}">${esc(st.zeichen)}</i>${z[st.key]} ${esc(st.kurz)}</span>`).join('')
      + `</div>`);
    wireProvButtons(kennwerteEl);
    kennwerteEl.querySelectorAll('.kw-row').forEach((el) => {
      el.addEventListener('mouseenter', () => {
        const f = el.dataset.formula || 'keine Herleitung hinterlegt';
        const s = el.dataset.sicher;
        // Die Quelle steht ZUERST — wer hovert, fragt als Erstes "sagt wer?"
        // (Artikel, BZO, Dienst), erst danach kommt der Rechenweg.
        const src = el.dataset.source;
        showKwTip(el, [src ? `Quelle: ${src}` : null, f, s].filter(Boolean).join('\n'));
      });
    });
    kwNoteEl.textContent = `${alleRows.length} Werte`;
  }
  kennwerteEl.addEventListener('mouseleave', () => {
    kwTip.hidden = true;
  });

  // ---- Kopfzahlen -----------------------------------------------------
  // Fuenf Zahlen, die die Studie beantwortet. Alle stammen aus demselben
  // Ergebnisobjekt wie die Tafel rechts; keine wird hier nachgerechnet.
  // Die fuenf Kennzahlen einer Auswertung, als Wert und Unterzeile.
  // Einmal beschrieben, zweimal benutzt: fuer das Band (eine Auswertung) und
  // fuer die Zeilen je Parzelle (mehrere).
  function kpiWerte(r) {
    const { reconciled, rules } = r;
    const mm = r.massingModel;
    return {
      volumen: [mm ? `${fmt(mm.volumeM3)} m³` : '—',
        mm && mm.hullVolumeM3 > mm.volumeM3 * 1.02 ? `max. Hülle ${fmt(mm.hullVolumeM3)} m³` : 'gebautes Volumen'],
      gfa: [`${fmt(reconciled.maxGfaM2)} m²`,
        `AZ ${rules.ausnuetzungsziffer_max_pct} % von ${fmt(reconciled.anrechenbareFlaecheM2)} m²`],
      fuss: [`${fmt(reconciled.usableFootprintAreaM2)} m²`,
        `bindend: ${BINDING_LABELS[reconciled.bindingConstraint] || reconciled.bindingConstraint}`],
      hoehe: [mm ? `${fmt(mm.buildingHeightM)} m` : '—',
        `${rules.heightMetric} max. ${rules.heightM} m`],
      nutz: [mm ? `${fmt(mm.nutzflaecheTotalM2)} m²` : '—',
        mm && mm.nutzflaecheTotalM2 > mm.gfaUsedM2 + 0.5 ? 'inkl. anrechnungsfreier Geschosse' : 'nur Vollgeschosse'],
    };
  }

  // Getrennt gerechnet: je Parzelle eine Zeile mit denselben fuenf Zahlen.
  // Keine Summe — die Parzellen sind in diesem Modus eigene Baugrundstuecke,
  // und eine addierte Gebaeudehoehe waere Unsinn. Was sich sinnvoll addieren
  // laesst (Flaeche, Fussabdruck, Geschossflaeche), steht in der Liste unter
  // der Isometrie.
  function renderKpisEinzeln(results) {
    const titel = { volumen: 'Volumen', gfa: 'Geschossfläche (AZ)', fuss: 'Fussabdruck',
                    hoehe: 'Höhe · gebaut', nutz: 'Nutzbar total' };
    kpisEl.classList.add('kpis-einzeln');
    kpisEl.innerHTML = results.map((r, i) => {
      const w = kpiWerte(r);
      const p = r.selection[0];
      return `<div class="kpi-row${i === 0 ? ' is-anchor' : ''}">`
        + `<span class="kr-p">Parzelle ${esc(p.parcelNumber || p.egrid)}</span>`
        + KPI_KEYS.map((k) => `<span class="kr-c"><i>${esc(titel[k])}</i>`
            + `<b>${esc(w[k][0])}</b><u>${esc(w[k][1])}</u></span>`).join('')
        + `</div>`;
    }).join('');
  }

  // Zurueck auf das Band mit fuenf Kacheln.
  function restoreKpiBand() {
    if (!kpisEl.classList.contains('kpis-einzeln')) return;
    kpisEl.classList.remove('kpis-einzeln');
    kpisEl.innerHTML = KPI_BAND_URZUSTAND;
  }

  function renderKpis(r) {
    restoreKpiBand();
    const w = kpiWerte(r);
    const set = (k, v, sub) => {
      const ve = $(`kpi-${k}`), se = $(`kpi-${k}-s`);
      if (ve) ve.textContent = v;
      if (se) se.textContent = sub;
    };
    KPI_KEYS.forEach((k) => set(k, w[k][0], w[k][1]));
  }


  // ---- Regelfahnen auf den Zeichnungen --------------------------------
  // REGELN IM MODELL ueber der Isometrie, ABSTAENDE & ABZUEGE ueber dem
  // Plan. Jede Zeile stammt aus einem Wert, der in diesem Lauf gegriffen
  // hat; nicht anwendbare Regeln stehen ausdrücklich als solche da, statt zu
  // fehlen -- eine fehlende Zeile liest sich wie eine vergessene Pruefung.
  // Warum keine Attika steht, in einer Zeile MIT den Zahlen. Die lange
  // Fassung steht unter Hinweise & Vorbehalte — aber die Frage "wieso
  // nicht?" muss die Zeichnung selbst beantworten, nicht ein zweiter
  // Bildschirm.
  // Beide Wortlaute liegen seit dem 31.8.2026 in js/core/envelope.js, neben
  // der Diagnose, aus der sie lesen: der PDF-Export braucht denselben Satz
  // fuer seine Variantenkarten, und zwei Formulierungen desselben Verdikts
  // waeren genau die Drift, vor der CLAUDE.md §1 warnt.
  const attikaSuppressReason = (mm) => T.attikaSuppressReason(mm);
  const attikaSuppressShort = (mm) => T.attikaSuppressShort(mm);
  function ovlRow(state, text, cite) {
    const glyph = state === 'ok' ? '✓' : (state === 'assume' ? '!' : '·');
    return `<div class="o-row is-${state}"><span class="g">${glyph}</span>`
      + `<span>${esc(text)}</span>`
      + (cite ? `<span class="p">${esc(cite)}</span>` : '') + `</div>`;
  }
  function renderOverlays(r) {
    const { rules, reconciled } = r;
    const mm = r.massingModel;
    const artOf = (...keys) => { const p = provFor(rules, ...keys); return p && p.article ? p.article : ''; };

    const modell = [
      ovlRow('ok', `${rules.heightMetric} ${fmt(rules.heightM)} m`,
        artOf(rules.heightRegime ? 'gebaeudehoehe_max_m_bzo2016'
          : (rules.traufseitige_fassadenhoehe_max_m != null ? 'traufseitige_fassadenhoehe_max_m' : 'gebaeudehoehe_max_m'))),
      ...(mm ? [ovlRow('ok',
        mm.attikaStoreys > 0
          ? `gebaut ${fmt(mm.buildingHeightM)} m inkl. Attika über der Schnittlinie`
          : `gebaut ${fmt(mm.buildingHeightM)} m`, '')] : []),
      ...(mm && mm.attikaStoreys > 0
        ? [ovlRow(mm.attikaHeightIsModelled ? 'ok' : 'assume',
            `45°-Profil Attika, Rücksprung ${fmt(mm.attikaSetbackM)} m`,
            artOf('attika_profil_ueberhoehung_m'))]
        : (mm && mm.attikaSuppressed
            ? [ovlRow('assume', attikaSuppressReason(mm), artOf('attika_profil_ueberhoehung_m'))]
            : [])),
      ovlRow('ok', `Ausnützungsziffer ${(rules.ausnuetzungsziffer_max_pct / 100).toFixed(2)}`,
        artOf('ausnuetzungsziffer_max_pct')),
      ...(mm && (mm.attikaStoreys > 0 || mm.ugStoreys > 0)
        ? [ovlRow('ok', `Freibetrag Dach/Attika/UG ${fmt(mm.perStoreyFreeM2)} m²`,
            artOf('dach_attika_ug_freibetrag') || '§ 255 Abs. 3 PBG')]
        : []),
      // Ausdruecklich als nicht anwendbar ausgewiesen: die Zuercher BZOs
      // dieses Datenbestands kennen keine Baumassenziffer. Weglassen liesse
      // offen, ob sie geprueft wurde.
      ovlRow('na', 'Baumassenziffer — in dieser Zone keine', ''),
    ];
    ovlModellEl.innerHTML = '<span class="o-k">Regeln im Modell</span>' + modell.join('');
    ovlModellEl.hidden = false;

    const grundabstandM = r.grundabstandUsedM ?? rules.grundabstand_min_m;
    const plan = [
      ovlRow('ok', `Grundabstand ${fmt(grundabstandM)} m`, artOf('grundabstand_min_m')),
      ...(r.hasDirectional && rules.grosser_grenzabstand_min_m != null
        ? [ovlRow(r.grenzabstandDegraded ? 'assume' : 'ok',
            `Grenzabstand gross ${fmt(rules.grosser_grenzabstand_min_m)} m`
            + (r.grenzabstandDegraded ? ' — ersatzweise ringsum' : ''),
            artOf('grosser_grenzabstand_min_m'))]
        : []),
      ...(r.mehrlaengen
        ? [ovlRow('ok', `Mehrlängenzuschlag +${fmt(r.mehrlaengen.requiredM - rules.grundabstand_min_m)} m`, artOf('mehrlaengenzuschlag'))]
        : []),
      ...(r.baulinienLossM2 > 0.5
        ? [ovlRow('ok', `Baulinie − ${fmt(r.baulinienLossM2)} m²`, '§ 265 PBG')]
        : [ovlRow('na', 'Baulinie — keine auf dieser Parzelle', '')]),
      ...(r.massing && !r.massing.impossible
        ? [ovlRow('ok', `Gebäudeabstand ${fmt(r.gebaeudeabstandM)} m`, '§ 271 PBG')]
        : []),
      ...(r.waldLossInFootprintM2 > 0.5
        ? [ovlRow('assume', `Waldabstand − ${fmt(r.waldLossInFootprintM2)} m²`, artOf('waldabstand') || 'WaG 17')]
        : [ovlRow('na', 'Waldabstand — keine Linie auf der Parzelle', '')]),
      ...(r.lengthLimitM != null && r.footprintRect
        ? [ovlRow(r.lengthExceeded ? 'assume' : 'ok',
            `Gebäudelänge ${fmt(r.lengthExceeded && r.areaRect ? r.areaRect.lengthM : r.footprintRect.lengthM)} / ${r.lengthLimitM} m`,
            artOf('gesamtlaenge_max_m', 'gebaeudelaenge_inkl_klein_anbauten_max_m'))]
        : []),
    ];
    ovlPlanEl.innerHTML = '<span class="o-k">Abstände &amp; Abzüge</span>' + plan.join('');
    ovlPlanEl.hidden = false;

    planNoteEl.textContent = `${fmt(r.footprintAfterWaldM2)} m² bebaubar`;
    isoNoteEl.textContent = mm
      ? `${storeyCountLabel(mm.ordinaryStoreys, mm.attikaStoreys)} · ${fmt(mm.volumeM3)} m³`
      : 'kein Volumen darstellbar';
  }

  // Baut die Hinweiszeilen einer Auswertung. Reine Ableitung aus r --
  // keine Anzeige, kein Zustand ausser dem, was an r haengt.
  function baueFlags(r) {
    // Dieselbe Zerlegung wie in render() — die Hinweise wurden von dort
    // herausgeloest und lasen ihre Bezugsgroessen aus jenem Geltungsbereich.
    const { selection, anchor, rules, rulesData, merged, isSingleShape,
            setbackFootprint, reconciled, terrainHeight, restrictions, checklist } = r;
    const multi = selection.length > 1;
    const flags = [];
    // Upstream sources that failed — these change what the numbers mean, so
    // they come first.
    for (const d of (r.degraded || [])) flags.push(esc(d));
    // Plausibilitätsprüfung gegen den Bestand: ein Ergebnis, das einer
    // erteilten Bewilligung widerspricht, steht direkt nach den
    // Quellenausfällen — es stellt die Aussagekraft der Zahlen in Frage,
    // bevor irgendeine von ihnen gelesen wird.
    const bp = r.bestandsPruefung;
    if (bp && !bp.geprueft) {
      flags.push(esc(`Plausibilitätsprüfung gegen den Bestand nicht möglich: ${bp.grund}. Bekannte bestehende oder bewilligte Gebäude wurden nicht gegen den berechneten Fussabdruck geprüft.`));
    }
    for (const g of ((bp && bp.eintraege) || [])) {
      if (g.fehler) {
        flags.push(esc(`Plausibilitätsprüfung gegen den Bestand: Eintrag «${g.name}» (Parzelle ${g.parzelle}) nicht prüfbar — ${g.fehler}.`));
      } else if (g.passt === false) {
        flags.push(esc(`Plausibilitätsprüfung gegen den Bestand: Für Parzelle ${g.parzelle} ist ein Gebäude bekannt — «${g.name}», ${g.status}, ${fmt(g.laenge_m)} × ${fmt(g.breite_m)} m (Beleg in data/bekannte-gebaeude.json: Baueingabe Kat.-Nr. 2999, Plan 113B/121). Es findet im hier berechneten bebaubaren Bereich keinen Platz (Passprobe als Rechteck im ${bp.winkelrasterDeg}°-Winkelraster). Das Ergebnis widerspricht damit einer erteilten Bewilligung. Mögliche Gründe: Die Bewilligung beruht auf der gemeinsamen Beurteilung mehrerer Parzellen oder auf privatrechtlichen Sicherungen (Näherbaurecht, Ausnützungsübertragung — der Parzellierungsplan der Baueingabe vermerkt ein Servitut), die eine getrennte Rechnung bewusst nicht abbildet; oder Verfahren bzw. Datengrundlage dieses Werkzeugs weichen ab. Manuell prüfen — die Zahlen dieser Auswertung bleiben die Rechnung nach BZO/PBG ohne solche Sicherungen.`));
      }
    }
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
        // Die Rechnung kommt aus js/core/envelope.js, damit sie nur EINMAL
        // formuliert ist — und weil sie dort die negativen Zwischenwerte
        // abfaengt: ein Ruecksprung, der tiefer ist als der halbe
        // Baukoerper, ergab hier früher «ergibt 14.3 × −1.8 m» im
        // Kundendokument. Eine Kantenlaenge kann nicht negativ sein.
        const calc = T.attikaSuppressRechnung(mmForFlags);
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
      flags.push(`${mmForFlags.droppedBlockCount} von ${totalBlocks} Baukörpern aus der Längenaufteilung ${mmForFlags.droppedBlockCount > 1 ? 'waren' : 'war'} an dieser Stelle der Parzelle zu schmal (unter ${T.MIN_PRIMITIVE_WIDTH_M} m) für ein eigenständiges Gebäude und ${mmForFlags.droppedBlockCount > 1 ? 'wurden' : 'wurde'} nicht dargestellt. Das ist eine Folge der schematischen Gleichteilung mit festem Gebäudeabstand, keine Rechtsaussage: ein anders platzierter oder schmalerer Baukörper kann an dieser Stelle zulässig sein — die Anordnung der Gebäude ist Sache des Entwurfs. Die entsprechende Fläche fehlt in der unten ausgewiesenen Differenz zur rechnerischen Geschossfläche.`);
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
    // the south-facing side(s), Art. 17/18 BZO). Der Text folgt dem
    // tatsaechlich verwendeten Verfahren (r.grenzabstandVerfahren) — ein
    // Hinweis, der ein anderes Verfahren beschreibt als das gerechnete,
    // waere selbst der Fehler aus REGELN.md §12.2.
    if (r.hasDirectional && r.facadeEdges && r.facadeEdges.edges.length && r.southFacadeIndex != null) {
      const v = r.grenzabstandVerfahren;
      const two = rules.grosser_grenzabstand_suedseiten > 1;
      const basis = `${esc(rules.gemeinde)} kennt zwei Grenzabstände (Art. 17/18 BZO ${esc(rules.gemeinde)}): ${rules.grundabstand_min_m} m normal, ${rules.grosser_grenzabstand_min_m} m für ${two ? 'die BEIDEN am meisten gegen Süden gerichteten GEBÄUDEseiten' : 'die längere, am stärksten gegen Süden gerichtete GEBÄUDEseite'} (Art. 18 Abs. 1), bestimmt am flächenkleinsten Rechteck, das das Gebäude umfasst (Abs. 2), gemessen nach § 22 ABV rechtwinklig zur Fassade — der kleine Abstand schlägt radial um die Ecken (§ 22 Abs. 2 ABV).`;
      if (v && v.methode === 'gebaeuderechteck') {
        const seiten = (v.suedSeiten || []).map((s) => `${fmt(s.bearingDeg, 0)}° (${compassLabel(s.bearingDeg)})`).join(' und ');
        // Der Vergleichssatz nur, wenn er etwas vergleicht: liefern beide
        // Verfahren denselben ANZEIGEwert, stand hier «ergäbe 164.3 m² statt
        // 164.3 m²» — ein Satz, der seine eigene Aussage bestreitet.
        // Verglichen werden die formatierten Werte, weil der Leser genau
        // diese sieht; eine Abweichung unterhalb der Anzeigerundung ist
        // keine mitteilenswerte Differenz.
        const vergleich = v.vergleichParzellenkantenM2 != null
          && fmt(v.vergleichParzellenkantenM2) !== fmt(r.footprintBeforeWaldM2)
          ? ` Zum Vergleich: die frühere Näherung über die Parzellenkanten ergäbe ${fmt(v.vergleichParzellenkantenM2)} m² nach Grundabstand statt ${fmt(r.footprintBeforeWaldM2)} m² — sie ist NICHT verlässlich konservativ (sie hängt an der zufälligen Stückelung der Parzellenkanten) und dient nur noch als Vergleichswert.`
          : '';
        flags.push(`${basis} Umsetzung iterativ: grösstmögliches Gebäuderechteck im ${fmt(r.grundabstandUsedM ?? rules.grundabstand_min_m)}-m-Bereich platzieren, dessen Südseiten bestimmen, dort ${rules.grosser_grenzabstand_min_m} m rechtwinklig zur Fassade ansetzen, wiederholen bis stabil — hier nach ${v.iterationen} Iteration${v.iterationen === 1 ? '' : 'en'} stabil, Südrichtungen ${seiten}.${vergleich} Im Grundriss ist die Hauptfassaden-Kante anklickbar, falls die tatsächliche Hauptfassade in eine andere Richtung weist; die Stellung des künftigen Gebäudes bleibt eine Entwurfsentscheidung, die das Rechteck nur nähert.`);
      } else if (v && v.methode === 'parzellenkanten') {
        const idxs = (r.chosenIndices && r.chosenIndices.length ? r.chosenIndices : [r.southFacadeIndex]);
        const edgeDescr = idxs.map((i) => {
          const e = r.facadeEdges.edges[i];
          return e ? `Kante ${fmt(e.length, 0)} m, Ausrichtung ${fmt(e.bearingDeg, 0)}°` : null;
        }).filter(Boolean).join(' und ');
        flags.push(`${basis} Das Gebäuderechteck-Verfahren liess sich auf dieser Parzelle nicht bilden (${esc(v.gebaeuderechteckFehler || 'Geometrie')}). Ersatzweise gilt hier die PARZELLENKANTEN-Näherung (~ vereinfacht): der ${rules.grosser_grenzabstand_min_m}-m-Streifen hängt an ${two ? 'den beiden am meisten gegen Süden gerichteten Parzellenkanten' : 'der am meisten gegen Süden gerichteten Parzellenkante'} (${edgeDescr}). Diese Näherung kann zu gross ODER zu klein ausfallen — nicht ohne Handprüfung verwenden.`);
      }
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
      flags.push(`Anrechenbare Grundstücksfläche: automatisch abgezogen wurden Wald innerhalb der Parzelle${abzInfo.waldM2 > 0.5 ? ` (${fmt(abzInfo.waldM2)} m²)` : ' (hier: keiner)'} und Waldabstandsflächen mehr als 15 m hinter der Waldabstandslinie${abzInfo.waldAbstand15M2 > 0.5 ? ` (${fmt(abzInfo.waldAbstand15M2)} m², § 259 aPBG)` : abzInfo.waldAbstand15M2 == null ? ' (nicht ermittelbar — Waldquelle oder Seitenbestimmung fehlt, manuell prüfen)' : ' (hier: keine)'}. Offene Gewässer und allfällige Flächenanteile ausserhalb der Bauzone werden nicht automatisch erkannt und wären zusätzlich abzuziehen (§ 259 PBG bzw. § 259 aPBG) — bei Gewässernähe oder Zonengrenzlage manuell prüfen.`);
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
    const parkierungFlags = [];
    if (pkFlag && !pkFlag.erfasst) {
      parkierungFlags.push(`Parkierung nicht prüfbar: ${pkFlag.grund} § 242 PBG überlässt die Zahl der Abstellplätze der BZO — hier wurde nichts gerechnet und nichts geschätzt.`);
    } else if (pkFlag && pkFlag.bindet) {
      parkierungFlags.push(`Parkierung bindet: ${pkFlag.totalP} Pflichtplätze (${pkFlag.artikel}). Unter dem Baukörper (${fmt(pkFlag.fussabdruckM2, 0)} m²) fasst ein Untergeschoss rund ${pkFlag.plaetzeJeUgGeschoss} Plätze und trägt damit ${fmt(pkFlag.gnfAusEinemUgM2, 0)} m² Geschossfläche — gerechnet sind ${fmt(pkFlag.gnfM2, 0)} m². Nötig sind ${pkFlag.ugGeschosseNoetig} Untergeschosse, eine über den Baukörper hinausreichende Tiefgarage oder weniger Geschossfläche. Fläche je Platz ist eine Werkzeug-Annahme.`);
    } else if (pkFlag && !pkFlag.oberirdischPasst) {
      parkierungFlags.push(`Parkierung: die ${pkFlag.besucherP} Besucherplätze brauchen rund ${fmt(pkFlag.oberirdischBedarfM2, 0)} m² oberirdisch, frei sind ${fmt(pkFlag.freiflaecheM2, 0)} m².`);
    }
    flags.push(...parkierungFlags);
    r.parkierungFlags = parkierungFlags;
    return flags;
  }

  function render(r, alle) {
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
    // "Zonen-Beleg" fuehrt zum Steckbrief statt eine zweite Art von Fenster
    // zu oeffnen: die Herleitung, die Grundmasse und der Plan gehoeren
    // zusammen, und das ist der Detailbildschirm.
    const zoneProofBtn = document.getElementById('zone-proof-btn');
    if (zoneProofBtn) {
      zoneProofBtn.addEventListener('click', () => zoningMapEl.scrollIntoView({ block: 'nearest' }));
    }

    bindingSummaryEl.className = reconciled.usableFootprintAreaM2 <= 0 ? 'binding zero' : 'binding';
    const mm = r.massingModel;
    bindingSummaryEl.textContent = reconciled.usableFootprintAreaM2 <= 0 || !mm
      ? `Kein bebaubares Volumen: Grundabstand und/oder Grünflächenziffer beanspruchen die gesamte Fläche. Bindend: ${BINDING_LABELS[reconciled.bindingConstraint]}.`
      : `${storeyCountLabel(mm.ordinaryStoreys, mm.attikaStoreys)} à ${fmt(mm.floorplateM2)} m² — `
        + `${fmt(mm.gfaUsedM2)} m² Geschossfläche. Bindend: ${BINDING_LABELS[reconciled.bindingConstraint]}.`;

    // ---- Geschossvarianten, unter der Isometrie ------------------------
    // Die Geschosszahl ist eine Entwurfsentscheidung: jede Zahl zwischen dem
    // Minimum, das die zulaessige Geschossflaeche noch fasst, und dem
    // Zonenmaximum ist gleich zulaessig -- nur die Ueberbauung unterscheidet
    // sich. Deshalb steht die Reihe unter dem Modell, das sich beim Klick
    // aendert, und nicht in der Zahlentafel, die Ergebnisse zeigt.
    // Die Zahlen je Variante kommen aus T.storeyVariantData (js/core/
    // envelope.js) — dieselbe Quelle, aus der auch der PDF-Export seine
    // Variantenreihe baut. AZ wird nur von den Vollgeschossen verbraucht
    // (§ 255 Abs. 2/3 PBG); die Arithmetik steht dort, nicht hier.
    const variantData = T.storeyVariantData(mm, reconciled);
    if (variantData.length) {
      variantsEl.innerHTML = variantData.map((v) => {
        return `<button type="button" class="variant${v.active ? ' active' : ''}${v.suppressed ? ' unavailable' : ''}" data-storeys="${v.n}"`
          + ` title="${esc(v.suppressed ? `${attikaSuppressReason(mm)} — gerechnet mit ${storeyCountLabel(v.ordinary, 0)}` : 'Freie Entwurfsentscheidung — die Ausnützungsziffer begrenzt die Geschossfläche, nicht die Geschosszahl.')}">`
          + `<span class="n">${esc(storeyCountLabel(v.ordinary, v.attika))}</span>`
          // Der gesperrten Karte gehoert ihre Begruendung, nicht dieselben
          // Zahlen wie der Nachbarkarte — die erklaeren das Verbot nicht.
          + `<span class="d">${esc(v.suppressed ? attikaSuppressShort(mm) : `${fmt(v.plateM2)} m²/G · ${fmt(v.coveragePct, 0)} % üb. · ${fmt(v.heightM)} m`)}</span>`
          + `</button>`;
      }).join('');
      variantsEl.querySelectorAll('.variant').forEach((btn) => btn.addEventListener('click', () => {
        storeyChoice = Number(btn.dataset.storeys);
        rerenderWithChoices();
      }));
    } else {
      variantsEl.innerHTML = '';
    }

    // NOT reset here: the zone headline above already registered its § button
    // against this same registry, and clearing it left that button pointing
    // at a citation that no longer existed.
    const regimeTag = (key) => (rules.regimeOverrides && rules.regimeOverrides[key]
      ? ' <span class="regime-tag" title="Strengerer Wert der in Kraft stehenden BZO 2016 (negative Vorwirkung, § 234 PBG)">BZO 2016</span>' : '');

    // ---- Kennwerte, Kopfzahlen, Regelfahnen ----------------------------
    r.kennwerte = T.buildKennwerte(r, { provFor, storeyCountLabel, compassLabel });
    renderKennwerte(r.kennwerte);
    renderKpis(r);
    renderOverlays(r);

    renderParkierung(r);

    // Die Hinweise entstehen aus dem Ergebnis, nicht aus der Anzeige --
    // deshalb stehen sie an r und werden ueber baueFlags() gebaut. Solange
    // nur EIN Ergebnis gerendert wurde, fiel der Unterschied nicht auf; im
    // getrennten Modus werden n Ergebnisse gerechnet und nur eines
    // gerendert, und die uebrigen haetten sonst die Hinweise der ERSTEN
    // Parzelle getragen -- fremde Hinweise unter eigenen Zahlen.
    const flags = baueFlags(r);
    r.flags = flags;
    flagsEl.innerHTML = flags.map((f) => `<div class="flag">⚠ ${f}</div>`).join('');
    lastResult = r;
    lastFlags = flags;

    checklistEl.innerHTML =
      `<div class="checklist-tier tier-a"><h3>Tier A — automatisch berechnet (eindeutig)</h3>${renderChecklistTier(checklist.tierA)}</div>` +
      `<div class="checklist-tier tier-b"><h3>Tier B — Vorhandensein automatisch erkannt, Inhalt manuell zu prüfen</h3>${renderChecklistTier(checklist.tierB)}</div>`;

    // Eine Zeichnung, die nicht zustande kommt, darf die Zahlen nicht
    // mitnehmen. Beobachtet an einem Rechner ohne WebGL-Kontext: der Fehler
    // aus three.js flog durch render() hindurch, und die fertig berechnete
    // Studie endete als rote Statuszeile mit leeren Tafeln. Die Zahlen sind
    // das Ergebnis; das Modell ist ihre Darstellung. Also: Grund anzeigen,
    // Warnung ins Protokoll, weiterrendern.
    for (const [what, fn, host] of [['Isometrie', renderViewer, viewerEl], ['Situationsplan', renderFloorPlan, floorplanEl]]) {
      try {
        fn(r, alle);
      } catch (e) {
        host.innerHTML = `<p class="pane-empty">${what} nicht darstellbar — ${esc(e.message || e)}<br>Die Zahlen rechts sind davon unberührt.</p>`;
        if (protokoll) protokoll.warn(`${what} nicht darstellbar: ${e.message || e}`);
      }
    }

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
    flagsNoteEl.textContent = flags.length
      ? `${flags.length} Hinweis${flags.length === 1 ? '' : 'e'}`
      : 'keine Vorbehalte';
    statusStandEl.textContent = `${rulesData.version} · Stand ${formatDateCH(rulesData.data_last_verified)}`;
    previewPdfBtn.disabled = false;
    detailBtn.disabled = false;

    // Die Laufzusammenfassung wird jetzt gezaehlt -- die Kennwerte stehen,
    // also sind Annahmen und geprüfte Regeln zaehlbar. Konflikte sind die
    // ausgefallenen Quellen: eine Quelle, die nicht antwortet, ist kein
    // bestandener Test (REGELN.md §2).
    if (protokoll) {
      const sum = protokoll.summary({ kennwerte: r.kennwerte, conflicts: (r.degraded || []).length });
      protokoll.ok(`fertig · ${(sum.durationMs / 1000).toFixed(2)} s · ${sum.rulesChecked} Regeln · ${sum.assumptions} Annahmen · ${sum.conflicts} Konflikte`);
      renderLogSummary(sum);
      renderLogSources(r);
    }
  }

  // Fuss der Kartentafel: was unter dem Zeiger liegt. Nur die gewaehlten
  // Polygone melden das (siehe parcel-selector.js) -- fuer die uebrigen
  // Parzellen gibt es hier keine Geometrie, nur Katasterkacheln.
  const MAP_HINT_IDLE = 'klicken zum Hinzufügen / Entfernen';
  function onParcelHover(parcelNumber) {
    mapHoverEl.textContent = parcelNumber
      ? `Parzelle ${parcelNumber} — klicken zum Entfernen`
      : MAP_HINT_IDLE;
  }
  mapHoverEl.textContent = MAP_HINT_IDLE;

  // Alles, was ein Ergebnis zeigt, auf einmal leeren. Ohne das blieben nach
  // einer neuen Suche die Kopfzahlen und die Zahlentafel der VORIGEN
  // Parzelle stehen, waehrend Karte und Modell schon die neue zeigten --
  // die gefaehrlichste Art von Fehler in einem Werkzeug, dessen Zweck es
  // ist, Zahlen einer bestimmten Parzelle zuzuordnen.
  function clearResultPanels() {
    kennwerteEl.innerHTML = '';
    kwNoteEl.textContent = '';
    variantsEl.innerHTML = '';
    logEl.innerHTML = '';
    logFilterEl.innerHTML = '';
    logSourcesEl.innerHTML = '';
    logNoteEl.textContent = '';
    statusTimingsEl.textContent = '';
    statusStandEl.textContent = '';
    flagsNoteEl.textContent = '';
    ovlModellEl.hidden = true;
    ovlPlanEl.hidden = true;
    isoControlsEl.hidden = true;
    isoReadoutEl.hidden = true;
    isoNoteEl.textContent = '';
    planNoteEl.textContent = '';
    viewerEl.innerHTML = '';
    floorplanEl.innerHTML = '';
    // Leeren heisst zuerst: zurueck aufs Band. Sonst blieben die Zeilen der
    // vorigen getrennten Auswertung stehen, waehrend die neue laeuft.
    restoreKpiBand();
    for (const k of KPI_KEYS) {
      const ve = $(`kpi-${k}`), se = $(`kpi-${k}-s`);
      if (ve) ve.textContent = '—';
      if (se) se.textContent = '';
    }
  }

  // Die Auswahl steht an zwei Stellen: in der Kopfzeile (AUSWAHL) und im
  // Fuss der Kartentafel. Beide aus derselben Quelle, sonst driften sie.
  function renderSelectionList(selection) {
    if (!selection.length) {
      auswahlValueEl.innerHTML = '<span style="color:var(--faint)">—</span>';
      mapSelEl.innerHTML = '<span class="sel-empty">keine Parzelle gewählt</span>';
      return;
    }
    const totalM2 = selection.reduce((sum, p) => {
      try { return sum + T.planarAreaAnyLV95(T.parcelToTurfPolygon(p.geometryLV95)); } catch (e) { return sum; }
    }, 0);
    const ids = selection.map((p) => p.parcelNumber).join(' + ');
    auswahlValueEl.innerHTML = `<span class="acc">${esc(ids)}</span> · ${fmt(totalM2, 0)} m²`;
    // Bei einer einzigen Parzelle gibt es nichts zusammenzufassen — ein
    // Schalter ohne Wirkung ist schlimmer als keiner.
    arealOptEl.hidden = selection.length < 2;
    mapSelEl.textContent = `${selection.length} Parzelle${selection.length === 1 ? '' : 'n'} · ${fmt(totalM2, 0)} m²`;
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
      previewPdfBtn.disabled = true;
      detailBtn.disabled = true;
      clearResultPanels();
      lastResult = null;
      lastFlags = [];
      storeyChoice = null;
      wohnungenChoice = null;
      southFacadeIndex = null;
      southFacadeUserPicked = false;
      setStatus('Keine Parzelle gewählt — auf der Karte eine anklicken.');
      return;
    }
    const myToken = ++runToken;
    ablaufPanel.reset();
    const P = startProtokoll();
    P.step(`selection ${selection.map((p) => p.parcelNumber).join(' + ')} → Analyse startet`);
    setStatus('Berechne…');
    try {
      // Arealmodus: EIN Lauf ueber die vereinigte Flaeche. Getrennt: ein
      // Lauf JE Parzelle. analyse() nimmt ohnehin eine Auswahl entgegen —
      // die Trennung kostet deshalb keine zweite Rechenkette, nur n Aufrufe.
      // Adressen nachschlagen, bevor gerechnet wird: angeklickte Parzellen
      // kennen nur ihre Nummer, und im Export soll «Haldenstrasse 5b» statt
      // «Parzelle 5029» stehen. Findet das Register nichts, bleibt die
      // Nummer — erfunden wird nichts. Parallel, weil die Abfragen
      // voneinander unabhaengig sind, und fehlertolerant: eine Adresse ist
      // Beschriftung, keine Rechengroesse.
      await Promise.all(selection.map(async (p) => {
        if (p.adressen !== undefined) return;
        try { p.adressen = await T.addressesForParcel(p.geometryLV95); }
        catch (e) { p.adressen = null; }
      }));

      const einzeln = !arealModus && selection.length > 1;
      let results;
      if (einzeln) {
        results = [];
        for (const p of selection) {
          P.step(`getrennt — Parzelle ${p.parcelNumber || p.egrid}`);
          results.push(await analyse([p], P));
          if (myToken !== runToken) return;
        }
      } else {
        results = [await analyse(selection, P)];
      }
      if (myToken !== runToken) return;
      setStatus('');
      lastResults = results;
      document.body.classList.toggle('modus-einzeln', einzeln);
      renderEinzelliste(einzeln ? results : null);
      // Tabellen, Kennwerte und Belege beziehen sich auf die erste Parzelle;
      // die Zeichnungen und das Kennzahlenband zeigen alle.
      render(results[0], einzeln ? results : null);
      // Nach render(): das Band hat dort die Werte der ersten Parzelle
      // gesetzt und wird jetzt durch die Zeilen je Parzelle ersetzt.
      if (einzeln) renderKpisEinzeln(results);
    } catch (err) {
      if (myToken !== runToken) return;
      // Ein Abbruch ist ein Ergebnis des Laufs und gehoert ins Protokoll,
      // nicht nur in die Statuszeile.
      P.warn(`Abbruch — ${err.message || err}`);
      logNoteEl.textContent = 'abgebrochen';
      // Der Abbruch wegen fehlender BZO ist kein Programmfehler, sondern ein
      // Ergebnis: er sagt, welche Norm fehlt. Deshalb Tafel statt Popup.
      if (err && err.name === 'GemeindeNichtHinterlegtError') {
        renderNichtGerechnet(err);
        setStatus(`Nicht gerechnet — für ${err.gemeinde} ist keine BZO hinterlegt.`, true);
      } else {
        setStatus('Fehler: ' + (err.message || err), true);
      }
    }
  }

  // Der Haken aendert das Ergebnis, nicht die Darstellung — also neu rechnen.
  arealToggleEl.addEventListener('change', () => {
    arealModus = arealToggleEl.checked;
    const sel = T.parcelMap && T.parcelMap.getSelection ? T.parcelMap.getSelection() : [];
    if (sel.length) refresh(sel);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    // Vom Startbild (grosses Suchfeld, sonst nichts) ins Arbeitsbild. Der
    // Wechsel passiert beim ABSCHICKEN, nicht erst beim Ergebnis: sonst
    // stuende die Suche mehrere Sekunden lang ohne jede Regung da.
    document.body.classList.remove('start');
    previewPdfBtn.disabled = true;
    detailBtn.disabled = true;
    clearResultPanels();
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

      T.parcelMap = T.initParcelMap('map', firstParcel, refresh, gemeindeSelect.value || null, onParcelHover);
    } catch (err) {
      setStatus('Fehler: ' + (err.message || err), true);
    }
  });
})();
