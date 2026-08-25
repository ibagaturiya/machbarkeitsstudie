// normkette.js — Normhierarchie, Ablaufprotokoll und Schicht-Animation.
//
// Drei Fragen, die das Zahlenpanel nicht beantwortet:
//   1. In welchem Rang steht die Vorschrift, die hier gerade Fläche wegnimmt
//      — Bund, Kanton, Gemeinde oder Privatrecht? (Issue #5)
//   2. Was ist bei diesem Durchlauf der Reihe nach passiert, auch während er
//      noch läuft? (Issue #4)
//   3. Wieviel Fläche kostet jede einzelne Schicht — sichtbar, nicht als
//      Zahlenkolonne? (Issue #3)
//
// Dieses Modul rechnet NICHTS neu. Es liest ausschliesslich das fertige
// Ergebnisobjekt von analyse() und ordnet es. Eine zweite Rechenstelle wäre
// genau die Duplizierung, vor der CLAUDE.md §1 warnt: die Kette hier würde
// bei der nächsten Regeländerung aus dem Tritt geraten, ohne dass ein Test
// anschlägt.
window.MachbarkeitTool = window.MachbarkeitTool || {};

(function () {
  const T = window.MachbarkeitTool;

  // ---- 1. Normhierarchie -------------------------------------------------
  // Die Rangordnung des öffentlichen Baurechts. `rang` ist die Stufe im
  // Stufenbau: tieferes Recht konkretisiert höheres, darf ihm aber nicht
  // widersprechen. Sie ist NICHT die Reihenfolge der Anwendung — das Tool
  // rechnet in der Reihenfolge von REGELN.md §3, und die mischt die Stufen
  // (Grundabstand Gemeinde → Waldabstand Kanton → Ausnützung Kanton+Gemeinde).
  // Beide Ordnungen nebeneinander zu zeigen ist der ganze Zweck des Panels.
  const NORM_EBENEN = {
    bund: {
      rang: 1, kurz: 'Bund', label: 'Bundesrecht',
      beispiel: 'RPG — Trennung Baugebiet/Nichtbaugebiet',
      farbe: '#7e57c2', farbeDark: '#b39ddb',
    },
    kanton: {
      rang: 2, kurz: 'Kanton', label: 'Kantonales Recht',
      beispiel: 'PBG 700.1, ABV 700.2 — Begriffe, Messweisen, Waldabstand',
      farbe: '#3f7cac', farbeDark: '#7fb3d9',
    },
    gemeinde: {
      rang: 3, kurz: 'Gemeinde', label: 'Kommunales Recht',
      beispiel: 'BZO und Zonenplan — Grenzabstände, Ziffern, Höhen',
      farbe: '#4a7d3f', farbeDark: '#8fc07f',
    },
    privat: {
      rang: 4, kurz: 'Privatrecht', label: 'Privatrecht',
      beispiel: 'Grundbuch, Dienstbarkeiten, Näherbau- und Leitungsbaurechte',
      farbe: '#b8860b', farbeDark: '#e0b64a',
    },
    daten: {
      rang: 5, kurz: 'Daten', label: 'Amtliche Daten',
      beispiel: 'Amtliche Vermessung, ÖREB-Kataster, swissALTI3D',
      farbe: '#6b6b6b', farbeDark: '#a5a3a0',
    },
    annahme: {
      rang: 6, kurz: 'Annahme', label: 'Werkzeug-Annahme',
      beispiel: 'ohne Gesetzeszitat — als solche gekennzeichnet',
      farbe: '#c07a2c', farbeDark: '#f0a35c',
    },
  };
  const EBENEN_RANG = Object.keys(NORM_EBENEN).sort((a, b) => NORM_EBENEN[a].rang - NORM_EBENEN[b].rang);
  function farbeOf(key, dark) {
    const e = NORM_EBENEN[key];
    return dark && e.farbeDark ? e.farbeDark : e.farbe;
  }

  // ---- 2. Die Kette ------------------------------------------------------

  function m2(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function areaOf(feature) {
    if (!feature || typeof turf === 'undefined' || !T.planarAreaAnyLV95) return null;
    try { return T.planarAreaAnyLV95(feature); } catch (e) { return null; }
  }
  // Was diese Schicht weggenommen hat, als Geometrie — nur für die Animation.
  // Fehlschläge sind hier folgenlos (dann wird der Verlust nicht schraffiert,
  // die Zahl daneben steht trotzdem), deshalb bewusst still.
  function removedBetween(before, after) {
    if (!before || !after || typeof turf === 'undefined') return null;
    try { return turf.difference(before, after); } catch (e) { return null; }
  }

  // Baut die Kette aus dem Ergebnisobjekt von analyse(). Rein lesend.
  // `withGeometry` false ⇒ nur die Textkette (so testbar ohne turf).
  function buildNormkette(r, { withGeometry = true } = {}) {
    const schritte = [];
    const push = (s) => {
      if (!s.titel) throw new Error('Normketten-Schritt ohne Titel');
      if (!NORM_EBENEN[s.ebene]) throw new Error(`Unbekannte Normebene "${s.ebene}"`);
      schritte.push({
        nr: schritte.length + 1, status: 'ok', wert: null, detail: null,
        flaecheM2: null, verlustM2: null, geometry: null, entfernt: null, ...s,
      });
    };
    const rules = (r && r.rules) || {};
    const meta = rules.meta || {};
    const gemeinde = rules.gemeinde || meta.gemeinde || 'Gemeinde';
    const artGrundmasse = meta.article_grundmasse || `BZO ${gemeinde}`;
    const rec = (r && r.reconciled) || {};
    const mm = (r && r.massingModel) || null;
    const geo = withGeometry && typeof turf !== 'undefined';

    // — Stufe 1: Bund. Das Werkzeug rechnet nichts davon; es steht hier, weil
    //   eine Normkette, die bei der Gemeinde anfängt, die Rangordnung falsch
    //   darstellt. Status 'info' heisst: eingeordnet, nicht geprüft.
    push({
      ebene: 'bund', titel: 'Bauzone', status: 'info',
      grundlage: 'RPG (Bundesrecht)', wert: 'nicht gerechnet',
      detail: 'Das Bundesrecht trennt Bau- von Nichtbaugebiet und bindet die kantonale und kommunale Planung. Dieses Werkzeug prüft die Bauzonen­zugehörigkeit nicht selbst — es setzt sie voraus und rechnet ausschliesslich Wohnzonen.',
    });

    // — Ausgangsgrösse: die Parzelle, wie sie die amtliche Vermessung führt.
    const parcelAreaM2 = m2(r && r.parcelAreaM2);
    push({
      ebene: 'daten', titel: 'Parzelle', status: 'ok',
      grundlage: 'Amtliche Vermessung (ch.swisstopo-vd.amtliche-vermessung)',
      wert: parcelAreaM2 != null ? `${Math.round(parcelAreaM2)} m²` : null,
      flaecheM2: parcelAreaM2,
      geometry: geo ? (r.merged || null) : null,
      detail: r && r.selection && r.selection.length > 1
        ? `${r.selection.length} Parzellen vereinigt; die gemeinsame Grenze entfällt. Setzt eine Parzellenvereinigung oder ein im Grundbuch gesichertes Näherbaurecht voraus.`
        : null,
    });

    push({
      ebene: 'gemeinde', titel: 'Zone', status: 'ok',
      grundlage: `Zonenplan ${gemeinde} (kantonaler Datensatz ogd-0156)`,
      wert: (r && r.anchor && r.anchor.zone) || null,
      detail: 'Die Zone entscheidet über sämtliche Grundmasse darunter. Bei mehreren Parzellen gilt die Zone der Ausgangsparzelle für die ganze Auswahl.',
    });

    // — Anrechenbare Grundstücksfläche: die Bezugsgrösse aller Ziffern.
    const anrechenbar = m2(r && r.anrechenbareFlaecheM2);
    const waldAbzugM2 = m2(r && r.flaechenAbzuege && r.flaechenAbzuege.waldM2) || 0;
    push({
      ebene: 'kanton', titel: 'Anrechenbare Grundstücksfläche',
      grundlage: '§ 255/259 PBG', status: 'ok',
      wert: anrechenbar != null ? `${Math.round(anrechenbar)} m²` : null,
      flaecheM2: anrechenbar,
      verlustM2: waldAbzugM2 > 0 ? waldAbzugM2 : null,
      detail: 'Bezugsgrösse für Ausnützungs-, Überbauungs- und Grünflächenziffer. Wald innerhalb der Parzelle wird abgezogen; offene Gewässer und Flächen ausserhalb der Bauzone erkennt das Werkzeug nicht automatisch.',
    });

    // — Grundabstand. Für die Animation wird der reine, allseitige Ring
    //   zusätzlich gezeigt: er ist die Schicht, die JEDE Parzelle trifft,
    //   während der grosse Grenzabstand nur einzelne Fassaden betrifft.
    const grundM = r && r.grundabstandUsedM;
    let ringOnly = null;
    if (geo && r.merged && grundM != null && T.bufferLV95) {
      try { ringOnly = T.bufferLV95(r.merged, -grundM); } catch (e) { ringOnly = null; }
    }
    push({
      ebene: 'gemeinde', titel: 'Grundabstand (kleiner Grenzabstand)',
      grundlage: artGrundmasse, status: 'ok',
      wert: grundM != null ? `− ${grundM.toFixed(1)} m allseitig` : null,
      flaecheM2: areaOf(ringOnly),
      verlustM2: parcelAreaM2 != null && areaOf(ringOnly) != null ? Math.max(0, parcelAreaM2 - areaOf(ringOnly)) : null,
      geometry: ringOnly,
      entfernt: removedBetween(r && r.merged, ringOnly),
      detail: 'Gemessen rechtwinklig zur Fassade (§ 260 PBG, § 22 ABV). Das Werkzeug nähert über die Parzellenkanten — eine Vereinfachung auf der sicheren Seite.',
    });

    if (r && r.mehrlaengen) {
      push({
        ebene: 'gemeinde', titel: 'Mehrlängenzuschlag',
        grundlage: 'Art. 14 BZO 2016 (Zürich)', status: 'ok',
        wert: `${r.mehrlaengen.baseM.toFixed(1)} m → ${r.mehrlaengen.requiredM.toFixed(1)} m`,
        detail: `Die längste Fassade misst ${r.mehrlaengen.facadeLengthM.toFixed(1)} m. Ein Drittel der Mehrlänge über 12 m erhöht den Grenzabstand, gedeckelt bei ${r.mehrlaengen.capM} m. Allseitig angewandt — konservativ.`,
      });
    }

    const setbackRing = (r && r.setbackRingFeature) || null;
    if (r && r.hasDirectional) {
      push({
        ebene: 'gemeinde', titel: 'Grosser Grenzabstand (Hauptfassaden)',
        grundlage: artGrundmasse, status: r.grenzabstandDegraded ? 'review' : 'ok',
        wert: rules.grosser_grenzabstand_min_m != null
          ? `− ${rules.grosser_grenzabstand_min_m.toFixed(1)} m auf ${(r.chosenIndices || []).length || 1} Seite(n)`
          : null,
        flaecheM2: areaOf(setbackRing),
        geometry: geo ? setbackRing : null,
        entfernt: removedBetween(ringOnly, setbackRing),
        detail: r.grenzabstandDegraded
          ? `Die gerichtete Abstandsfigur liess sich nicht bilden; ersatzweise gilt der grosse Abstand allseitig (${r.grenzabstandDegraded.appliedM} m) — strenger als das Gesetz verlangt, nie milder.`
          : 'Die am stärksten nach Süden gerichtete(n) Seite(n). § 22 Abs. 2 ABV schlägt an den Ecken den kleineren Abstand um — der Streifen endet bündig, ohne Bogen.',
      });
    }

    // — Waldabstand: kantonale Schicht, geometrisch abgezogen.
    const wald = (r && r.wald) || {};
    const afterWald = (r && r.afterWaldFeature) || null;
    push({
      ebene: 'kanton', titel: 'Waldabstand',
      grundlage: '§ 262 PBG (Waldabstandslinie im Zonenplan)',
      status: wald.failed ? 'review' : (wald.applies ? 'ok' : 'skip'),
      wert: wald.failed ? 'nicht prüfbar'
        : (r && r.waldLossInFootprintM2 > 0 ? `− ${Math.round(r.waldLossInFootprintM2)} m²` : 'kein Abzug'),
      flaecheM2: areaOf(afterWald),
      verlustM2: m2(r && r.waldLossInFootprintM2),
      geometry: geo ? afterWald : null,
      entfernt: geo ? (r && r.waldRemoved) || null : null,
      detail: wald.failed
        ? 'Die Datenquelle war nicht erreichbar. Der Fussabdruck ist OHNE Waldabstands-Abzug gerechnet — manuell prüfen. Ein Ausfall wird nie als bestanden dargestellt.'
        : null,
    });

    // — Baulinien: gleiche Mechanik, andere Rechtsgrundlage. Hier landen auch
    //   die Baulinien für Versorgungsleitungen (§ 96 Abs. 2 lit. c PBG) —
    //   siehe den Privatrechts-Schritt unten zur Abgrenzung.
    const baulinien = (r && r.baulinien) || {};
    push({
      ebene: 'kanton', titel: 'Baulinien',
      grundlage: '§ 96/99 PBG (inkl. Baulinien für Versorgungsleitungen, § 96 Abs. 2 lit. c)',
      status: baulinien.failed ? 'review' : (baulinien.applies ? 'ok' : 'skip'),
      wert: baulinien.failed ? 'nicht prüfbar'
        : (r && r.baulinienLossM2 > 0 ? `− ${Math.round(r.baulinienLossM2)} m²` : 'kein Abzug'),
      flaecheM2: areaOf(r && r.buildableArea),
      verlustM2: m2(r && r.baulinienLossM2),
      geometry: geo ? (r && r.buildableArea) || null : null,
      entfernt: geo ? (r && r.baulinienRemoved) || null : null,
      detail: baulinien.failed
        ? 'Die Datenquelle war nicht erreichbar. Der Fussabdruck ist OHNE Baulinien-Abzug gerechnet — manuell prüfen.'
        : null,
    });

    // — Längenteilung: bestimmt nur die gezeichneten Baukörper, nicht die
    //   Bezugsfläche (REGELN.md §3.8, behobener Fehler A).
    if (r && r.lengthExceeded) {
      push({
        ebene: 'gemeinde', titel: 'Max. Gebäudelänge → Aufteilung',
        grundlage: `${artGrundmasse} · Gebäudeabstand § 271 PBG`,
        status: r.massing && r.massing.impossible ? 'review' : 'ok',
        wert: r.lengthLimitM != null ? `max. ${r.lengthLimitM} m je Baukörper` : null,
        flaecheM2: areaOf(r.massing && r.massing.union),
        verlustM2: m2(r.lengthLossM2),
        geometry: geo ? (r.massing && r.massing.union) || null : null,
        entfernt: removedBetween(r.buildableArea, r.massing && r.massing.union),
        detail: `Abstand zwischen den Baukörpern = 2 × Grundabstand = ${r.gebaeudeabstandM != null ? r.gebaeudeabstandM.toFixed(1) : '?'} m. Die Lücken kosten keine Ausnützung: Bezugsfläche bleibt die ungeteilte bebaubare Fläche.`,
      });
    }

    // — Flächendeckel: keine Geometrie, sondern Obergrenzen auf die Fläche.
    if (rec.hasGreenCap) {
      push({
        ebene: 'gemeinde', titel: 'Grünflächenziffer',
        grundlage: `§ 257 PBG · ${artGrundmasse}`, status: 'ok',
        wert: rules.gruenflaechenziffer_min_pct != null
          ? `min. ${rules.gruenflaechenziffer_min_pct} % grün → Deckel ${Math.round(rec.footprintAfterGreenCapAreaM2)} m²`
          : null,
        flaecheM2: m2(rec.footprintAfterGreenCapAreaM2),
      });
    }
    if (rec.hasUeberbauungsCap) {
      push({
        ebene: 'gemeinde', titel: 'Überbauungsziffer',
        grundlage: `§ 256 PBG · ${artGrundmasse}`, status: 'ok',
        wert: `Deckel ${Math.round(rec.footprintAfterUeberbauungsCapM2)} m²`,
        flaecheM2: m2(rec.footprintAfterUeberbauungsCapM2),
      });
    }

    push({
      ebene: 'gemeinde', titel: 'Ausnützungsziffer',
      grundlage: `§ 255 PBG · ${artGrundmasse}`, status: 'ok',
      wert: rules.ausnuetzungsziffer_max_pct != null && rec.maxGfaM2 != null
        ? `${rules.ausnuetzungsziffer_max_pct} % → ${Math.round(rec.maxGfaM2)} m² Geschossfläche`
        : null,
      detail: 'Nach § 255 Abs. 3 PBG verbrauchen nur die Vollgeschosse das Kontingent; Dach-, Attika- und Untergeschosse bleiben je Geschoss bis zur anteiligen Fläche frei.',
    });

    push({
      ebene: 'gemeinde', titel: 'Höhe und Vollgeschosse',
      grundlage: `${artGrundmasse} · Messweise ${meta.hoehenmetrik || 'siehe BZO'}`, status: 'ok',
      wert: rules.heightM != null
        ? `${rules.heightM} m · max. ${rules.vollgeschosse_max} Vollgeschosse`
        : null,
      detail: 'Die Geschosszahl ist eine Entwurfsentscheidung innerhalb dieser Grenze, kein Rechenergebnis.',
    });

    if (mm && mm.attikaStoreys > 0) {
      push({
        ebene: 'gemeinde', titel: 'Attikageschoss',
        grundlage: meta.attika_profil_ueberhoehung_m != null
          ? 'Art. 31 BZO Zumikon (45°-Profil) · § 281 aPBG'
          : '§ 281 aPBG (45°-Profil, ohne kommunale Überhöhung)',
        status: mm.attikaGeometryImpossible ? 'review' : 'ok',
        wert: mm.attikaSetbackM != null ? `Rücksprung ${mm.attikaSetbackM.toFixed(2)} m` : null,
        flaecheM2: m2(mm.attikaFootplateM2),
        detail: mm.attikaGeometryImpossible
          ? 'Auf mindestens einem Baukörper bleibt unter dem 45°-Profil keine Attika übrig; die betroffenen Flächen sind aus den Zahlen entfernt.'
          : null,
      });
    }

    // — Privatrecht. Bewusst als eigener, ungerechneter Rang: es steht nicht
    //   im Stufenbau des öffentlichen Rechts, begrenzt das Bauvorhaben aber
    //   genauso wirksam. Hier hängt auch die Antwort auf «Werkleitung
    //   mitinbezogen?»: die Leitungs-BAULINIE oben ist gerechnet, das
    //   Leitungsbaurecht und die tatsächliche Werkleitung sind es nicht.
    push({
      ebene: 'privat', titel: 'Grundbuch, Dienstbarkeiten, Werkleitungen',
      grundlage: 'ZGB · Grundbuchauszug, Katasterplan, Höhenaufnahme',
      status: 'review', wert: 'nicht gerechnet',
      detail: 'Näherbau-, Weg- und Leitungsbaurechte, Dienstbarkeiten und der Werkleitungskataster der Gemeinde liegen dem Werkzeug nicht vor. Beizubringen: Grundbuchauszug, Katasterplan der amtlichen Vermessung, Höhenaufnahme. Erfasste Rechte lassen sich unter «Mehr › Grundbuch» als Fussnote hinterlegen.',
    });

    push({
      ebene: 'annahme', titel: 'Werkzeug-Annahmen', status: 'info',
      grundlage: 'ohne Gesetzeszitat', wert: 'siehe Quellen',
      detail: 'Kostenkennwert, Mindestbreiten, Suchradien und die Fassadenkanten-Näherung sind Annahmen des Werkzeugs, keine Rechtswerte. Vollständige Liste im Abschnitt «Quellen».',
    });

    return { schritte, ebenen: NORM_EBENEN, ebenenRang: EBENEN_RANG };
  }

  // ---- 3. Animation ------------------------------------------------------
  // Eigene, sehr reduzierte Zeichnung statt einer Erweiterung von
  // floorplan.js: der Grundriss ist ein Messplan (Fassadenlängen, Abstände,
  // Höhenlinien), diese Sequenz ist ein Erklärbild. Beides in eine Funktion
  // zu zwingen hiesse, jeden Schritt mit einem Schalter zu versehen.
  function stagesOf(kette) {
    return kette.schritte.filter((s) => s.geometry);
  }

  function buildNormketteSvg({ kette, index = 0, widthPx = 320, heightPx = 240, dark = false }) {
    const stages = stagesOf(kette);
    if (!stages.length || typeof turf === 'undefined') return '';
    const i = Math.max(0, Math.min(index, stages.length - 1));
    const base = stages[0].geometry;
    const ringsOf = (f) => {
      if (!f || !f.geometry) return [];
      const g = f.geometry;
      return g.type === 'Polygon' ? g.coordinates : g.coordinates.flat(1);
    };
    const pts = ringsOf(base).flat();
    if (!pts.length) return '';
    const es = pts.map((p) => p[0]), ns = pts.map((p) => p[1]);
    const minE = Math.min(...es), maxE = Math.max(...es);
    const minN = Math.min(...ns), maxN = Math.max(...ns);
    const pad = 12;
    const scale = Math.min((widthPx - 2 * pad) / Math.max(1e-6, maxE - minE),
                           (heightPx - 2 * pad) / Math.max(1e-6, maxN - minN));
    const offX = (widthPx - (maxE - minE) * scale) / 2;
    const offY = (heightPx - (maxN - minN) * scale) / 2;
    const px = ([e, n]) => [offX + (e - minE) * scale, heightPx - offY - (n - minN) * scale];
    const path = (f) => ringsOf(f).map((ring) =>
      'M' + ring.map((c) => px(c).map((v) => v.toFixed(1)).join(',')).join('L') + 'Z').join(' ');

    const ink = dark ? '#8d8a85' : '#8a8a8a';
    const bg = dark ? '#1a1a1d' : '#ffffff';
    const cur = stages[i];
    const out = [`<svg viewBox="0 0 ${widthPx} ${heightPx}" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Normkette Schritt ${i + 1} von ${stages.length}: ${cur.titel}">`];
    out.push(`<rect width="${widthPx}" height="${heightPx}" fill="${bg}"/>`);
    out.push(`<defs><pattern id="nk-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#c62828" stroke-width="2"/></pattern></defs>`);
    // Die Parzelle bleibt immer sichtbar — sie ist der Massstab, an dem der
    // Betrachter den Verlust misst.
    out.push(`<path d="${path(base)}" fill="none" stroke="${ink}" stroke-width="1.4" fill-rule="evenodd"/>`);
    // Was frühere Schichten schon weggenommen haben: blass, aber nicht weg.
    for (let k = 1; k <= i; k++) {
      if (stages[k].entfernt) {
        out.push(`<path d="${path(stages[k].entfernt)}" fill="${ink}" fill-opacity=".16" fill-rule="evenodd" stroke="none"/>`);
      }
    }
    // Der aktuelle Schnitt, rot schraffiert — die Schicht, die gerade greift.
    if (i > 0 && cur.entfernt) {
      out.push(`<path d="${path(cur.entfernt)}" fill="url(#nk-hatch)" fill-opacity=".55" fill-rule="evenodd" stroke="#c62828" stroke-width="1.2" stroke-dasharray="5 3"/>`);
    }
    const farbe = farbeOf(cur.ebene, dark);
    out.push(`<path d="${path(cur.geometry)}" fill="${farbe}" fill-opacity=".34" fill-rule="evenodd" stroke="${farbe}" stroke-width="2"/>`);
    out.push('</svg>');
    return out.join('');
  }

  // ---- 4. Panel ----------------------------------------------------------
  // Ein einziges einklappbares Panel: Live-Protokoll während des Laufs,
  // Normkette danach, Animation daneben. Der Controller hält den
  // Abspielzustand, damit app.js davon nichts wissen muss.
  function mountAblaufPanel({ panelEl, liveEl, listEl, stageEl, captionEl, playBtn, legendEl, isDark }) {
    let kette = null;
    let index = 0;
    let timer = null;

    function drawStage() {
      if (!kette || !stageEl) return;
      const stages = stagesOf(kette);
      if (!stages.length) { stageEl.innerHTML = ''; if (captionEl) captionEl.textContent = ''; return; }
      const i = Math.max(0, Math.min(index, stages.length - 1));
      stageEl.innerHTML = buildNormketteSvg({
        kette, index: i, widthPx: 320, heightPx: 240,
        dark: dark(),
      });
      const s = stages[i];
      if (captionEl) {
        const verlust = s.verlustM2 != null && s.verlustM2 > 0.5 ? ` · −${Math.round(s.verlustM2)} m²` : '';
        const flaeche = s.flaecheM2 != null ? ` · ${Math.round(s.flaecheM2)} m² übrig` : '';
        captionEl.textContent = `${i + 1}/${stages.length} · ${NORM_EBENEN[s.ebene].kurz}: ${s.titel}${verlust}${flaeche}`;
      }
      if (listEl) {
        listEl.querySelectorAll('.nk-step').forEach((el) => {
          el.classList.toggle('is-current', Number(el.dataset.nr) === s.nr);
        });
      }
    }

    function stop() {
      if (timer) { clearInterval(timer); timer = null; }
      if (playBtn) playBtn.textContent = '▶ Abspielen';
    }
    function play() {
      if (!kette) return;
      const stages = stagesOf(kette);
      if (stages.length < 2) return;
      if (timer) { stop(); return; }
      index = 0; drawStage();
      if (playBtn) playBtn.textContent = '❚❚ Pause';
      timer = setInterval(() => {
        index++;
        if (index >= stages.length) { index = stages.length - 1; drawStage(); stop(); return; }
        drawStage();
      }, 1100);
    }
    if (playBtn) playBtn.addEventListener('click', play);

    const dark = () => (typeof isDark === 'function' ? isDark() : false);

    function renderLegend() {
      if (!legendEl) return;
      legendEl.innerHTML = EBENEN_RANG.map((k) => {
        const e = NORM_EBENEN[k];
        return `<span class="nk-ebene" style="--nk-col:${farbeOf(k, dark())}" title="${e.label} — ${e.beispiel}">${e.kurz}</span>`;
      }).join('');
    }
    renderLegend();

    function renderList() {
      if (!listEl || !kette) return;
      const esc = T.esc || ((s) => String(s));
      listEl.innerHTML = kette.schritte.map((s) => {
        const e = NORM_EBENEN[s.ebene];
        const stages = stagesOf(kette);
        const stageIdx = stages.indexOf(s);
        const verlust = s.verlustM2 != null && s.verlustM2 > 0.5
          ? `<span class="nk-verlust">−${Math.round(s.verlustM2)} m²</span>` : '';
        return `<li class="nk-step nk-${s.status}" data-nr="${s.nr}" data-stage="${stageIdx}"${stageIdx >= 0 ? ' tabindex="0" role="button"' : ''}>` +
          `<span class="nk-rang" style="--nk-col:${farbeOf(s.ebene, dark())}" title="${esc(e.label)} — Rang ${e.rang}">${esc(e.kurz)}</span>` +
          `<span class="nk-body"><span class="nk-titel">${esc(s.titel)}</span>` +
          (s.wert ? `<span class="nk-wert">${esc(s.wert)}</span>` : '') + verlust +
          `<span class="nk-grundlage">${esc(s.grundlage || '')}</span>` +
          (s.detail ? `<span class="nk-detail">${esc(s.detail)}</span>` : '') +
          `</span></li>`;
      }).join('');
      listEl.querySelectorAll('.nk-step[data-stage]').forEach((el) => {
        const idx = Number(el.dataset.stage);
        if (idx < 0) return;
        const jump = () => { stop(); index = idx; drawStage(); };
        el.addEventListener('click', jump);
        el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); jump(); } });
      });
    }

    return {
      // Live-Zeile während des Laufs. Nur die letzten Zeilen bleiben stehen —
      // das Protokoll soll den Fortschritt zeigen, nicht die Sitzung archivieren.
      live(text) {
        if (!liveEl || !text) return;
        const line = document.createElement('div');
        line.className = 'nk-live-line';
        line.textContent = text;
        liveEl.appendChild(line);
        while (liveEl.children.length > 40) liveEl.removeChild(liveEl.firstChild);
        liveEl.scrollTop = liveEl.scrollHeight;
      },
      reset() {
        stop();
        if (liveEl) liveEl.innerHTML = '';
        if (listEl) listEl.innerHTML = '';
        if (stageEl) stageEl.innerHTML = '';
        if (captionEl) captionEl.textContent = '';
        kette = null; index = 0;
      },
      setResult(r) {
        stop();
        kette = buildNormkette(r);
        index = Math.max(0, stagesOf(kette).length - 1);
        renderList();
        drawStage();
        if (panelEl) panelEl.classList.add('has-kette');
      },
      redraw() { renderLegend(); renderList(); drawStage(); },
      get kette() { return kette; },
    };
  }

  T.NORM_EBENEN = NORM_EBENEN;
  T.NORM_EBENEN_RANG = EBENEN_RANG;
  T.buildNormkette = buildNormkette;
  T.buildNormketteSvg = buildNormketteSvg;
  T.mountAblaufPanel = mountAblaufPanel;
})();
