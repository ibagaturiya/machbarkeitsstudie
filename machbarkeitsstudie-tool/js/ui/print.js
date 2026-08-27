// print.js — builds a real A3 landscape document for the PDF export.
//
// The export used to just print the web page, which produced a long scroll
// broken across pages at arbitrary points. This instead composes a separate
// document of fixed A3 sheets, one topic per sheet, and prints that while
// hiding the app UI. Each sheet is exactly 420x297mm so nothing reflows.
//
// Images are the tricky part: WMS map tiles and the Three.js canvas both have
// to be fully materialised BEFORE window.print(), or the PDF gets blank boxes.
// The 3D view is baked to a PNG data URL up front, and buildPrintDocument
// resolves only once every <img> has finished loading.
window.MachbarkeitTool = window.MachbarkeitTool || {};

(function () {
  const T = window.MachbarkeitTool;
  // Shared with app.js — see js/core/format.js. The local copy of esc used to
  // leave the single quote unescaped; this one does not.
  const esc = T.esc, fmt = T.fmt, fmtInt = T.fmtInt;


  // ---- Seitenumbruch ------------------------------------------------------
  // Ein Blatt ist 420x297 mm und schneidet ab, was nicht hineinpasst
  // (print.css: .sheet-body overflow hidden — sonst malt der Text über die
  // Quellenzeile und den Fusszeilenbereich). Abschneiden ist bei Warnungen
  // aber keine zulässige Antwort: eine Prüfung, die nur halb im Dokument
  // steht, ist schlimmer als gar keine, weil sie so aussieht, als stünde sie
  // vollständig da. Deshalb wandert alles, was nicht mehr passt, auf ein
  // Fortsetzungsblatt statt in den Beschnitt.
  //
  // Jedes Blatt, das umbrochen werden darf, markiert seinen umbrechbaren
  // Bereich mit [data-flow]. Läuft es über, wandern von hinten so lange
  // Kinder auf ein neues Blatt, bis es passt; das neue Blatt trägt selbst
  // wieder [data-flow] und wird in derselben Schleife erneut geprüft — damit
  // sind auch drei und mehr Fortsetzungen abgedeckt.
  function splitOverflowingSheets(host, foot) {
    // Mehrspaltensatz (columns: 2) läuft nicht nach unten, sondern nach
    // RECHTS aus dem Kasten: eine dritte Spalte entsteht ausserhalb. Beide
    // Richtungen müssen also geprüft werden, sonst bleibt der Überlauf der
    // Hinweis- und Quellenblätter unentdeckt.
    const overflows = (el) =>
      el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2;

    for (let i = 0; i < host.children.length; i++) {
      const sheet = host.children[i];
      const body = sheet.querySelector('.sheet-body');
      const flow = sheet.querySelector('[data-flow]');
      if (!body || !flow) continue;

      const moved = [];
      // Ein Kind muss stehen bleiben, sonst entstünde ein leeres Blatt und
      // die Schleife liefe endlos.
      while (overflows(body) && flow.children.length > 1) {
        const last = flow.lastElementChild;
        flow.removeChild(last);
        moved.unshift(last);
      }
      if (!moved.length) continue;

      const cont = continuationSheet(sheet, foot);
      const contFlow = cont.querySelector('[data-flow]');
      moved.forEach((el) => contFlow.appendChild(el));
      host.insertBefore(cont, sheet.nextSibling);
      // Die Schleife erreicht `cont` als Nächstes und bricht es nötigenfalls
      // erneut um.
    }
  }

  // Das Fortsetzungsblatt trägt denselben Titel mit dem Zusatz
  // «(Fortsetzung)» — wer nur eine Seite in der Hand hält, muss erkennen,
  // wozu sie gehört. Der Inhalt steht zweispaltig über die volle Breite:
  // die Karte oder Tabelle daneben stand schon auf dem ersten Blatt.
  function continuationSheet(sourceSheet, foot) {
    const title = (sourceSheet.querySelector('h2') || {}).textContent || '';
    const kicker = (sourceSheet.querySelector('.kicker') || {}).textContent || '';
    const el = document.createElement('div');
    el.innerHTML = sheet(
      `${title} (Fortsetzung)`, kicker,
      '<div class="flags-cols" data-flow></div>', foot, ''
    );
    return el.firstElementChild;
  }

  // "2 Vollgeschosse", "2 Vollgeschosse + 1 Attika" — ganze Geschosse, nie
  // ein Bruch. Gleiche Formulierung wie am Bildschirm (js/app.js).
  function storeyLabel(ordinary, attika) {
    const base = `${ordinary} Vollgeschoss${ordinary === 1 ? '' : 'e'}`;
    return attika > 0 ? `${base} + ${attika} Attika` : base;
  }


  // ---- Abgrenzung -------------------------------------------------------
  // Was dieses Werkzeug NICHT beantwortet, ausgeschrieben. Die Phase
  // Machbarkeit (SIA 112, 2014, Teilphase 21) prueft rechtliche, technische,
  // staedtebauliche, oekologische und wirtschaftliche Rahmenbedingungen;
  // gerechnet wird hier nur der baurechtliche Teil. Ein Bericht, der die
  // uebrigen Themen stillschweigend weglaesst, liest sich wie eine
  // vollstaendige Machbarkeitsstudie und ist damit falsch — deshalb stehen
  // sie als benannte Luecke im Dokument statt gar nicht.
  function abgrenzungSheetBody() {
    const notChecked = [
      ['Altlasten', 'Ob der Standort im Altlastenkataster des Kantons verzeichnet ist, wurde nicht abgefragt. Ein Eintrag kann Aushub, Entsorgung und Termine erheblich verteuern.'],
      ['Naturgefahren', 'Die Gefahrenkarte (Hochwasser, Rutschung, Sturz) wurde nicht ausgewertet. Sie kann Kotenlage, Untergeschoss und Konstruktion vorgeben.'],
      ['Lärm', 'Lärmbelastungskataster und Empfindlichkeitsstufe wurden nicht abgefragt. Bei Wohnnutzung ist der Lärmschutz häufig grundrissbestimmend und kann die hier gerechnete Geschossfläche unbenutzbar machen.'],
      ['Baugrund und Grundwasser', 'Kein geologisches Gutachten. Tragfähigkeit, Aushubklasse und Grundwasserspiegel sind offen — sie entscheiden mit, ob das oben gerechnete Untergeschoss überhaupt wirtschaftlich ist.'],
      ['Erschliessung (technisch)', 'Wasser, Abwasser, Energie und der Werkleitungskataster wurden nicht geprüft; siehe dazu den Punkt «Werkleitungen» auf dem Blatt «Einschränkungen».'],
      ['Standort und Umfeld', 'Keine Analyse zu Zentren, Arbeitsplätzen, Naherholung oder Nachbarschaft. Die Eignung der Nutzung am Ort ist damit nicht belegt.'],
    ];
    const notScope = [
      ['Raumprogramm und Nutzungsvarianten', 'Diese Auswertung rechnet eine Hüllform, keinen Entwurf. Wohnungsspiegel, Raumgrössen und Betriebskonzept sind Gegenstand der Projektdefinition.'],
      ['Varianten', 'Es wird genau ein Szenario gerechnet — die maximale baurechtliche Ausnützung. Eine Machbarkeitsstudie stellt üblicherweise mehrere Lösungsmöglichkeiten gegenüber.'],
      ['Nachhaltigkeit und Energie', 'Standards, Energiekonzept und Materialwahl sind nicht behandelt; sie werden in dieser Phase mit der Bauherrschaft festgelegt.'],
      ['Wirtschaftlichkeit', 'Enthalten ist eine Grobkostenschätzung der Erstellungskosten. NICHT enthalten sind Erträge, Betriebs- und Lebenszykluskosten und damit jede Renditeaussage.'],
      ['Termine', 'Kein Terminplan, keine Aussage zum Bewilligungsverfahren und zu dessen Dauer.'],
      ['Bestand', 'Es wird von unbebautem Land ausgegangen. Bestehende Bauten, Abbruch und Bestandesschutz sind nicht berücksichtigt.'],
    ];
    const block = (items) => items.map(([k, v]) =>
      `<div class="ci ci-review"><span class="ci-badge">OFFEN</span>` +
      `<span><b>${esc(k)}</b><br>${esc(v)}</span></div>`).join('');
    return `<div class="note-box" style="margin-top:0;margin-bottom:6mm">
        <b>Was dieses Dokument ist.</b> Eine baurechtliche Machbarkeitsprüfung: Zone,
        Ausnützung, Abstände, Volumen und eine grobe Kostenschätzung, hergeleitet aus
        den auf dem Blatt «Quellen und Vorbehalte» zitierten Bestimmungen. Sie deckt
        den rechtlichen Teil der Phase Machbarkeit ab (SIA 112, 2014, Teilphase 21) —
        nicht die Phase als Ganzes. Die folgenden Themen sind offen; keines davon
        wurde geprüft und als unproblematisch befunden.
      </div>
      <div class="cols c-5050">
        <div><h3>Standort, Umwelt, Technik — nicht geprüft</h3>${block(notChecked)}</div>
        <div><h3>Nicht Gegenstand dieses Werkzeugs</h3>${block(notScope)}</div>
      </div>`;
  }

  // ---- Parkierung -------------------------------------------------------
  // Die Pflichtplaetze wachsen mit der Geschossflaeche und muessen in der
  // Regel unter den Baukoerper — ab einer bestimmten Groesse bindet nicht
  // mehr die Ausnuetzungsziffer, sondern die Garage. Gerechnet wurde das
  // schon (core/parkierung.js), im Export fehlte es: die Zahlen standen nur
  // am Bildschirm, auf Papier kam allenfalls eine Warnzeile an.
  // Es wird weiterhin NICHTS vom Fussabdruck abgezogen — ob die Garage
  // zweigeschossig wird oder das Haus kleiner, ist eine Entwurfsentscheidung.
  function parkierungSheetBody(pk, rules) {
    if (!pk.erfasst) {
      return `<div class="cols c-5050">
        <div>
          <div class="hero">
            <div class="hero-label">Pflichtparkplätze</div>
            <div class="hero-value">Nicht prüfbar</div>
            <div class="hero-sub">Hier wird nichts gerechnet und nichts geschätzt.</div>
          </div>
          <div class="note-box">${esc(pk.grund)}</div>
        </div>
        <div>
          <h3>Warum das offen bleibt</h3>
          <div class="note-box small">
            § 242 PBG überlässt die Zahl der Abstellplätze der kommunalen Regelung.
            Liegt diese Quelle dem Werkzeug nicht vor, wäre jede Zahl erfunden —
            deshalb steht hier keine.<br><br>
            <b>Nächster Schritt:</b> Parkplatzverordnung der Gemeinde samt Wegleitung
            beiziehen und die Pflichtplätze festlegen, bevor das Volumen weiterbearbeitet
            wird. Müssen die Plätze unterirdisch unter den Baukörper, können sie die auf
            den Blättern «Volumetrie» und «Grundriss» gerechnete Geschossfläche
            begrenzen — dann bindet die Garage und nicht die Ausnützungsziffer.
          </div>
        </div>
      </div>`;
    }
    const A = pk.annahmen;
    const rows = [
      ['Bezugsgrösse (nutzbare Geschossfläche)', fmt(pk.gnfM2) + ' m²', ''],
      ['Wohnungen', pk.wohnungen + (pk.wohnungenHergeleitet ? ' — hergeleitet, Annahme' : ' — gesetzt'), ''],
      ['Plätze Bewohner', String(pk.bewohnerP), ''],
      ['Plätze Besucher', String(pk.besucherP), ''],
      ['Pflichtplätze total', String(pk.totalP), 'result'],
      ['Flächenbedarf Tiefgarage', fmt(pk.tiefgarageBedarfM2) + ' m²', ''],
      ['Flächenbedarf oberirdisch (Besucher)', fmt(pk.oberirdischBedarfM2) + ' m²', ''],
      ['Freifläche auf der Parzelle', fmt(pk.freiflaecheM2) + ' m²', pk.oberirdischPasst ? '' : 'minus'],
      ['Plätze je Untergeschoss', pk.plaetzeJeUgGeschoss + ' unter ' + fmt(pk.fussabdruckM2) + ' m² Baukörper', ''],
      ['Geschossfläche, die ein UG trägt', fmt(pk.gnfAusEinemUgM2) + ' m²', 'result'],
    ];
    const verdict = pk.bindet
      ? {
          label: 'Bindend',
          value: 'Die Parkierung begrenzt das Volumen',
          sub: `${pk.ugGeschosseNoetig} Untergeschosse nötig — oder weniger Geschossfläche`,
        }
      : {
          label: 'Nicht bindend',
          value: `${pk.totalP} Pflichtplätze, unterbringbar`,
          sub: 'Ein Untergeschoss trägt die gerechnete Geschossfläche',
        };
    return `<div class="cols c-5545">
      <div>
        <div class="hero">
          <div class="hero-label">${esc(verdict.label)}</div>
          <div class="hero-value">${esc(verdict.value)}</div>
          <div class="hero-sub">${esc(verdict.sub)}</div>
        </div>
        <table class="derive">
          ${rows.map(([k, v, cls]) => `<tr class="${cls}"><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}
        </table>
      </div>
      <div>
        <h3>Rechtswert und Werkzeug-Annahme, getrennt</h3>
        <table class="facts">
          <tr><td>Rechtswert</td><td>${esc(rules.meta.parkierung.art || '—')}: Zahl der Pflichtplätze, hergeleitet aus Geschossfläche und Wohnungszahl.</td></tr>
          <tr><td>Werkzeug-Annahme</td><td>Fläche je Platz Tiefgarage ${A.flaecheJePlatzTiefgarageM2} m² (Bandbreite ${A.flaecheJePlatzTiefgarageBandM2[0]}–${A.flaecheJePlatzTiefgarageBandM2[1]} m²), oberirdisch ${A.flaecheJePlatzOberirdischM2} m² (${A.flaecheJePlatzOberirdischBandM2[0]}–${A.flaecheJePlatzOberirdischBandM2[1]} m²), je inkl. Anteil Fahrgasse und Rampe. <b>Kein Gesetzeswert</b> — die Platzzahl oben ist belegt, der Flächenbedarf ist geschätzt.</td></tr>
          ${pk.unterbringung ? `<tr><td>Unterbringung</td><td>${esc(pk.unterbringung)}</td></tr>` : ''}
        </table>
        <div class="note-box small">
          Von der bebaubaren Fläche wurde für die Parkierung <b>nichts abgezogen</b>.
          Ob die Garage zweigeschossig wird, über den Baukörper hinausreicht oder das
          Haus kleiner wird, ist eine Entwurfsentscheidung — dieses Blatt sagt nur,
          ab wann sie ansteht.
        </div>
        ${pk.hinweise.length ? `<div class="flags">${pk.hinweise.map((h) => `<div class="flagline">${esc(h)}</div>`).join('')}</div>` : ''}
      </div>
    </div>`;
  }


  function sheet(title, kicker, bodyHtml, footerHtml, sourcesHtml) {
    return `<section class="sheet">
      <header class="sheet-head">
        <div class="kicker">${esc(kicker)}</div>
        <h2>${esc(title)}</h2>
      </header>
      <div class="sheet-body">${bodyHtml}</div>
      ${sourcesHtml ? `<div class="sheet-sources">${sourcesHtml}</div>` : ''}
      <footer class="sheet-foot">${footerHtml || ''}</footer>
    </section>`;
  }

  // One compact line naming the legal sources this sheet's argument rests on
  // — document, article and page, from the provenance records. Every sheet
  // carries its own sources so each page of the export is self-supporting.
  function sourcesLine(rules, entries) {
    const parts = [];
    for (const [label, ...keys] of entries) {
      let prov = null;
      for (const k of keys) {
        prov = T.getProvenance ? T.getProvenance(rules, k) : null;
        if (prov) break;
      }
      if (prov) {
        parts.push(`${esc(label)}: ${esc(prov.article || '')}${prov.page ? `, S. ${prov.page}` : ''}${prov.title ? ` (${esc(prov.title)})` : ''}`);
      }
    }
    return parts.length ? `<b>Quellen:</b> ${parts.join(' · ')}` : '';
  }

  function kpi(label, value, sub) {
    return `<div class="kpi"><div class="kpi-label">${esc(label)}</div>
      <div class="kpi-value">${esc(value)}</div>
      ${sub ? `<div class="kpi-sub">${esc(sub)}</div>` : ''}</div>`;
  }

  // crossorigin="anonymous" auf den WMS-Kacheln ist nicht optional: der
  // PDF-Export (js/ui/pdf.js) zeichnet diese Bilder in ein Canvas, und ohne
  // CORS-Freigabe waere das Canvas "tainted" und nicht auslesbar. Der Dienst
  // liefert access-control-allow-origin: * (geprueft 2026-08-27).
  //
  // w/h are the pixel dimensions the map is composed at; the bbox is derived
  // from them so raster and vector layers stay registered to each other.
  // zoneFeatures is pre-fetched by the caller (one request, reused per sheet).
  function mapBlock(rings, centerE, centerN, halfSpan, layers, zoneFeatures, w, h) {
    const bbox = T.buildMapBbox(centerE, centerN, halfSpan, w, h);
    const zoning = layers.includes('zoning') && zoneFeatures
      ? T.buildZonePlanSvg(zoneFeatures, bbox, w, h) : '';
    const cadastre = layers.includes('cadastre')
      ? `<img class="layer ${layers.includes('zoning') ? 'multiply' : ''}" crossorigin="anonymous" src="${T.buildCadastreMapUrl(bbox, w, h)}" alt="Parzellengrenzen">` : '';
    const overlay = T.buildParcelOverlaySvg(rings, bbox, w, h);
    return `<div class="mapwrap" style="aspect-ratio:${w}/${h}">${zoning}${cadastre}${overlay}</div>`;
  }

  // Draws what the Waldabstand computation actually did: the forest, the
  // Waldabstandslinie, and the strip of parcel it removed. Without this the
  // deduction is just a number the reader has to take on trust.
  function restrictionMapSvg(wald, rings, bbox, w, h) {
    const [minE, minN, maxE, maxN] = bbox;
    const px = ([e, n]) => [
      ((e - minE) / (maxE - minE)) * w,
      h - ((n - minN) / (maxN - minN)) * h,
    ];
    const ringPath = (ring) => 'M' + ring.map((c) => px(c).map((v) => v.toFixed(1)).join(',')).join('L') + 'Z';
    const linePath = (coords) => 'M' + coords.map((c) => px(c).map((v) => v.toFixed(1)).join(',')).join('L');
    const out = [];

    out.push(`<defs><pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="8" stroke="#c62828" stroke-width="3"/></pattern></defs>`);

    for (const f of (wald.forest || [])) {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const p of polys) {
        out.push(`<path d="${p.map(ringPath).join(' ')}" fill="#9fc38f" fill-opacity=".85" fill-rule="evenodd" stroke="#5f8a52" stroke-width="1.5"/>`);
      }
    }
    if (wald.forbidden) {
      const polys = wald.forbidden.geometry.type === 'Polygon'
        ? [wald.forbidden.geometry.coordinates] : wald.forbidden.geometry.coordinates;
      for (const p of polys) {
        out.push(`<path d="${p.map(ringPath).join(' ')}" fill="url(#hatch)" fill-opacity=".55" fill-rule="evenodd" stroke="#c62828" stroke-width="1.5"/>`);
      }
    }
    for (const f of (wald.lines || [])) {
      const segs = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const seg of segs) {
        out.push(`<path d="${linePath(seg)}" fill="none" stroke="#2f6b23" stroke-width="3" stroke-dasharray="10 6"/>`);
      }
    }
    for (const ring of rings) {
      out.push(`<path d="${ringPath(ring)}" fill="none" stroke="#c62828" stroke-width="3"/>`);
    }
    return `<svg class="layer" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${out.join('')}</svg>`;
  }

  function legend(entries) {
    return `<div class="legend">${entries.map(([swatch, label]) =>
      `<div class="lg"><span class="lg-sw" style="${swatch}"></span>${esc(label)}</div>`).join('')}</div>`;
  }

  function checklistHtml(items) {
    return items.map((i) => `<div class="ci ci-${i.status}">
      <span class="ci-badge">${esc(i.status.toUpperCase())}</span>
      <span><b>${esc(i.label)}</b><br>${esc(i.text)}</span></div>`).join('');
  }

  // r = the result object from app.js analyse(); flags = the rendered flag
  // strings; grundbuchFootnote may be null.
  async function buildPrintDocument(r, flags, grundbuchFootnote) {
    const { selection, anchor, rules, rulesData, reconciled, terrainHeight,
            checklist, merged, setbackFootprint, waldLossInFootprintM2, footprintBeforeWaldM2, wald,
            waldRemoved, lengthLimitM, footprintRect, lengthExceeded, massing, areaRect,
            lengthLossM2, gebaeudeabstandM, massingModel, terrainGrid, hang } = r;
    const multi = selection.length > 1;
    const rings = selection.map((p) => p.geometryLV95[0]);
    const { centerE, centerN, halfSpan } = T.boundingBoxForRings(rings, 25);
    const wideSpan = halfSpan * 2.2;

    // One zoning request covering the widest extent any sheet uses.
    const zoneBbox = T.buildMapBbox(centerE, centerN, Math.max(wideSpan * 1.6, 260), 1, 1);
    const zoneFeatures = await T.fetchZonePolygons(zoneBbox);

    // The PDF must show the SAME building the screen shows: the massing model
    // (chosen storeys, GFA-constrained), not the abstract legal hull — the
    // hull overstated volume and cost by a large factor on AZ-bound parcels.
    const envelopePng = setbackFootprint
      ? T.renderEnvelopeToDataURL({
          footprintFeature: setbackFootprint,
          parcelFeature: merged,
          removedFeature: waldRemoved,
          heightM: rules.heightM,
          massing: massingModel,
        }, 1600, 1450)
      : null;

    // Ein Geschoss ist eine ganze Zahl. "0.73 von 2 Vollgeschossen" war der
    // Quotient Geschossfläche/Fussabdruck und las sich wie "nicht einmal ein
    // Geschoss möglich" — während in Wahrheit zwei Geschosse auf halbem
    // Fussabdruck gebaut werden. Gezeigt wird deshalb der Baukörper, den das
    // Werkzeug tatsächlich modelliert: ganze Geschosse mit ihrer Grundfläche.
    const headline = reconciled.usableFootprintAreaM2 <= 0
      ? 'Kein bebaubares Volumen'
      : massingModel
        ? `${storeyLabel(massingModel.ordinaryStoreys, massingModel.attikaStoreys)} à ${fmt(massingModel.floorplateM2, 0)} m²`
        : `${rules.vollgeschosse_max} Vollgeschosse`;

    const BINDING = {
      grundabstand: 'Grundabstand',
      gruenflaechenziffer: 'Grünflächenziffer',
      ueberbauungsziffer: 'Überbauungsziffer',
      ausnuetzungsziffer: 'Ausnützungsziffer',
    };
    const binding = BINDING[reconciled.bindingConstraint] || reconciled.bindingConstraint;

    // Cost from the built massing (same figure as on screen); the hull only
    // as fallback when no massing model exists.
    const envelopeVolumeM3 = massingModel ? massingModel.volumeM3 : reconciled.usableFootprintAreaM2 * rules.heightM;
    const cost = T.estimateCost(envelopeVolumeM3);
    const dateStr = new Date().toLocaleDateString('de-CH');
    // The zone rides in the running footer of every sheet: it is the premise
    // of every number in the document, and a page read on its own has to say
    // which zone it is talking about.
    const foot = `${esc(rules.gemeinde)} · Zone ${esc(anchor.zone)} · ${esc(rulesData.version)} · erstellt ${dateStr}`;

    // ---- Sheet 1: Übersicht ------------------------------------------------
    const s1 = sheet(anchor.address || selection.map((p) => p.parcelNumber).join(' + '),
      // "Machbarkeitsstudie" versprach die ganze Phase (SIA 112 Teilphase 21:
      // auch Standort, Umwelt, Nachhaltigkeit, Ertrag, Termine). Gerechnet wird
      // hier der baurechtliche Teil — der Kicker sagt jetzt das, und das Blatt
      // "Nicht Gegenstand dieser Auswertung" fuehrt den Rest als offene Punkte.
      `Baurechtliche Machbarkeit — Ausnützungs- und Volumenanalyse · Zone ${anchor.zone}${anchor.zoneLabel ? ` (${anchor.zoneLabel})` : ''}`,
      `<div class="cols c-6040">
        <div>
          <div class="hero">
            <div class="hero-label">Realistisches Szenario</div>
            <div class="hero-value">${esc(headline)}</div>
            <div class="hero-sub">${fmt(reconciled.maxGfaM2, 0)} m² Geschossfläche · bindend: ${esc(binding)}</div>
          </div>
          <div class="kpis">
            ${kpi(multi ? 'Fläche zusammengefasst' : 'Parzellenfläche', fmt(reconciled.parcelAreaM2) + ' m²')}
            ${kpi('Nutzbarer Fussabdruck', fmt(reconciled.usableFootprintAreaM2) + ' m²')}
            ${kpi('Max. Geschossfläche', fmt(reconciled.maxGfaM2) + ' m²', 'Ausnützungsziffer ' + rules.ausnuetzungsziffer_max_pct + '%')}
            ${kpi(rules.heightMetric, rules.heightM + ' m')}
          </div>
          <table class="facts">
            <tr><td>Gemeinde</td><td>${esc(rules.gemeinde)}</td></tr>
            <tr><td>${multi ? 'Parzellen' : 'Parzelle'}</td><td>${esc(selection.map((p) => p.parcelNumber).join(' + '))}</td></tr>
            <tr><td>EGRID</td><td>${esc(selection.map((p) => p.egrid).join(', '))}</td></tr>
            <tr><td>Zone</td><td>${esc(anchor.zone)}${anchor.zoneLabel ? ' — ' + esc(anchor.zoneLabel) : ''}</td></tr>
            <tr><td>Gewachsenes Terrain</td><td>${fmt(terrainHeight)} m ü. M.</td></tr>
            ${hang ? `<tr><td>Terrainneigung</td><td>${fmt(hang.slopePercent, 0)} %${hang.isHang ? ' — Hanglage' : ' — keine Hanglage'}</td></tr>` : ''}
          </table>
          <div class="note-box">
            <b>Was diese Zahl bedeutet.</b><br>
            ${esc(bindingExplanation(reconciled, rules))}
            ${waldLossInFootprintM2 > 0.5
              ? ` Der Waldabstand wurde geometrisch berücksichtigt und reduziert den Fussabdruck um ${fmt(waldLossInFootprintM2)} m².`
              : ''}
            Grundlage ist unbebautes Land; Bestand und Abbruch sind nicht berücksichtigt.
          </div>
        </div>
        <div>${mapBlock(rings, centerE, centerN, wideSpan, ['cadastre'], null, 900, 1120)}
          <div class="caption">Situationsplan — ${multi ? 'gewählte Parzellen' : 'Parzelle'} rot markiert. Amtliche Vermessung (swisstopo / Kantone).</div>
        </div>
      </div>`, foot,
      sourcesLine(rules, [
        ['Ausnützungsziffer', 'ausnuetzungsziffer_max_pct'],
        ['Vollgeschosse', 'vollgeschosse_max'],
        ['Höhe', rules.heightRegime ? 'gebaeudehoehe_max_m_bzo2016' : 'traufseitige_fassadenhoehe_max_m', 'gebaeudehoehe_max_m'],
        ['Regime', 'negative_vorwirkung'],
      ]));

    // ---- Sheet 2: Volumetrie ----------------------------------------------
    const abz = r.flaechenAbzuege || {};
    const derivation = [
      [multi ? 'Fläche zusammengefasst' : 'Parzellenfläche', fmt(reconciled.parcelAreaM2) + ' m²', ''],
    ];
    if (abz.waldM2 > 0.5) {
      derivation.push(['Abzug Wald (§ 259 PBG: fällt ausser Ansatz)', '− ' + fmt(abz.waldM2) + ' m²', 'minus']);
    }
    derivation.push(['Anrechenbare Grundstücksfläche', fmt(reconciled.anrechenbareFlaecheM2) + ' m²', '']);
    derivation.push([`Fussabdruck nach Grundabstand (${fmt(r.grundabstandUsedM ?? rules.grundabstand_min_m)} m)`, fmt(footprintBeforeWaldM2) + ' m²', 'minus']);
    if (waldLossInFootprintM2 > 0.5) {
      derivation.push(['Abzug Waldabstand', '− ' + fmt(waldLossInFootprintM2) + ' m²', 'minus']);
      derivation.push(['Fussabdruck nach Waldabstand', fmt(reconciled.setbackFootprintAreaM2) + ' m²', '']);
    }
    derivation.push(['Deckel Grünflächenziffer',
      reconciled.hasGreenCap ? fmt(reconciled.footprintAfterGreenCapAreaM2) + ' m²' : '— nicht vorhanden', '']);
    if (reconciled.hasUeberbauungsCap) {
      derivation.push([`Deckel Überbauungsziffer (${rules.ueberbauungsziffer_hauptgebaeude_max_pct} %)`,
        fmt(reconciled.footprintAfterUeberbauungsCapM2) + ' m²', '']);
    }
    derivation.push(['Nutzbarer Fussabdruck', fmt(reconciled.usableFootprintAreaM2) + ' m²', 'result']);
    derivation.push(['Max. anrechenbare Geschossfläche (AZ ' + rules.ausnuetzungsziffer_max_pct + '%)', fmt(reconciled.maxGfaM2) + ' m²', '']);
    derivation.push(['Bebaubar als', massingModel
      ? `${storeyLabel(massingModel.ordinaryStoreys, massingModel.attikaStoreys)} à ${fmt(massingModel.floorplateM2, 0)} m²`
      : `max. ${rules.vollgeschosse_max} Vollgeschosse`, 'result']);
    if (massingModel && (massingModel.attikaStoreys > 0 || massingModel.ugStoreys > 0)) {
      derivation.push(['Freibetrag Dach-/Attika-/UG (§ 255 Abs. 3 PBG)',
        `je Geschoss bis ${fmt(massingModel.perStoreyFreeM2)} m² frei`, '']);
      derivation.push(['Nutzbare Geschossfläche total', fmt(massingModel.nutzflaecheTotalM2) + ' m²', 'result']);
    }

    const s2 = sheet('Volumetrie', 'Wie die Zahl zustande kommt',
      `<div class="cols c-4555">
        <div>
          <table class="derive">
            ${derivation.map(([k, v, cls]) => `<tr class="${cls}"><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}
          </table>
          <div class="note-box">
            <b>Bindende Einschränkung: ${esc(binding)}.</b><br>
            ${esc(bindingExplanation(reconciled, rules))}
          </div>
        </div>
        <div>
          ${envelopePng ? `<img class="render" src="${envelopePng}" alt="Isometrie">` : '<div class="empty">Kein Volumen darstellbar.</div>'}
          ${waldRemoved ? legend([['background:#b08b4f;', 'zulässige Hüllform'],['background:rgba(198,40,40,.35);border:1px solid #c62828;', 'durch Waldabstand entfallen'],['background:transparent;border:1px solid #333;', 'Parzellengrenze']]) : ''}<div class="caption">Maximal zulässige Hüllform, auf ${esc(rules.heightMetric)} ${rules.heightM} m extrudiert.${waldRemoved ? ' Der rot dargestellte Teil ist durch die boolesche Differenz mit der Waldabstands-Fläche entfallen und in den Zahlen links bereits abgezogen.' : ''} Flaches Dach ist eine Vereinfachung der Darstellung.</div>
        </div>
      </div>`, foot,
      sourcesLine(rules, [
        ['Anrechenbare Fläche', 'massgebliche_grundflaeche', 'anrechenbare_grundstuecksflaeche', 'massgebliche_grundflaeche_altrecht'],
        ['Grundabstand', 'grundabstand_min_m'],
        ['Grünflächenziffer', 'gruenflaechenziffer_min_pct'],
        ['Überbauungsziffer', 'ueberbauungsziffer_hauptgebaeude_max_pct'],
        ['Ausnützungsziffer', 'ausnuetzungsziffer_max_pct'],
        ['Freibetrag', 'dach_attika_ug_freibetrag'],
      ]));

    // ---- Sheet 3: Grundriss ------------------------------------------------
    const fpDims = (() => {
      if (!setbackFootprint) return null;
      const g = setbackFootprint.geometry;
      const pts = g.type === 'Polygon' ? g.coordinates.flat(1) : g.coordinates.flat(2);
      const e = pts.map((q) => q[0]), n = pts.map((q) => q[1]);
      return { w: Math.max(...e) - Math.min(...e), d: Math.max(...n) - Math.min(...n) };
    })();

    const s2b = sheet('Grundriss Erdgeschoss', 'Bebaubare Grundfläche, massstäblich',
      `<div class="cols c-6040">
        <div>${setbackFootprint
          ? T.buildFloorPlanSvg({ parcelFeature: merged,
              footprintFeature: massingModel ? massingModel.footprintFeature : setbackFootprint,
              removedFeature: waldRemoved, lengthRect: massing && !massing.impossible ? areaRect : footprintRect,
              lengthLimitM, lengthResolved: !!(massing && !massing.impossible), blockCount: massing ? massing.count : 0,
              terrainGrid, hang,
              widthPx: 1150, heightPx: 900 })
          : '<div class="empty">Keine bebaubare Grundfläche.</div>'}
        </div>
        <div>
          <table class="facts big">
            <tr><td>Bebaubare Grundfläche</td><td><b>${fmt(reconciled.usableFootprintAreaM2)} m²</b></td></tr>
            ${lengthLimitM != null ? `<tr><td>Max. Gebäudelänge</td><td>${lengthLimitM} m</td></tr>` : ''}
            ${massing && !massing.impossible
              ? `<tr><td>Bereich zu lang</td><td>${fmt(areaRect.lengthM)} m → geteilt</td></tr>
                 <tr><td>Baukörper</td><td><b>${massing.count} × ${fmt(massing.blockLengthM)} m</b> (längster ${fmt(massing.longestBlockM)} m)</td></tr>
                 <tr><td>Gebäudeabstand</td><td>${gebaeudeabstandM} m · kostet ${fmt(lengthLossM2)} m²</td></tr>`
              : (footprintRect ? `<tr><td>Kleinstes Rechteck (L × B)</td><td>${fmt(footprintRect.lengthM)} × ${fmt(footprintRect.widthM)} m${lengthLimitM != null ? ' — eingehalten' : ''}</td></tr>` : '')}
            <tr><td>Grundabstand</td><td>${rules.grundabstand_min_m} m ringsum</td></tr>
            ${waldRemoved ? `<tr><td>Abzug Waldabstand</td><td>− ${fmt(waldLossInFootprintM2)} m²</td></tr>` : ''}
            <tr><td>Max. Geschossfläche</td><td>${fmt(reconciled.maxGfaM2)} m²</td></tr>
            <tr><td>Bebaubar als</td><td>${massingModel ? esc(storeyLabel(massingModel.ordinaryStoreys, massingModel.attikaStoreys)) + ' à ' + fmt(massingModel.floorplateM2, 0) + ' m²' : 'max. ' + rules.vollgeschosse_max + ' Vollgeschosse'}</td></tr>
          </table>
          ${legend([
            ['background:#d9a066;border:1px solid #8a4b08;', 'bebaubare Grundfläche'],
            ...(waldRemoved ? [['background:repeating-linear-gradient(45deg,#c62828 0 3px,transparent 3px 6px);border:1px dashed #c62828;', 'durch Waldabstand entfallen']] : []),
            ['background:#fafafa;border:1px solid #333;', 'Parzelle'],
          ])}
          <div class="note-box small">
            Nordorientiert und massstäblich gezeichnet. Die Bemassung ist das Hüllmass
            des Fussabdrucks, nicht eine Gebäudekante — die tatsächliche Gebäudeform ist
            innerhalb dieser Fläche frei wählbar.
          </div>
        </div>
      </div>`, foot,
      sourcesLine(rules, [
        ['Grundabstand', 'grundabstand_min_m'],
        ['Grosser Grenzabstand', 'grosser_grenzabstand_min_m'],
        ['Hauptfassaden', 'grosser_grenzabstand_suedseiten'],
        ['Mehrlängenzuschlag', 'mehrlaengenzuschlag'],
        ['Gebäudelänge', 'gesamtlaenge_max_m', 'gebaeudelaenge_inkl_klein_anbauten_max_m'],
        ['Waldabstand', 'waldabstand'],
      ]));

    // ---- Sheet 3: Zonenplan ------------------------------------------------
    const s3 = sheet('Zonenplan', 'Grundlage der Zonenzuordnung',
      `<div class="cols c-6040">
        <div>${mapBlock(rings, centerE, centerN, halfSpan * 1.8, ['zoning', 'cadastre'], zoneFeatures, 1200, 980)}
          <div class="caption">Zonenplan-Ausschnitt mit Parzellengrenzen. ${multi ? 'Gewählte Parzellen' : 'Parzelle'} rot markiert.</div>
        </div>
        <div>
          <table class="facts big">
            <tr><td>Zone</td><td><b>${esc(anchor.zone)}</b></td></tr>
            <tr><td>Bezeichnung</td><td>${esc(anchor.zoneLabel || '—')}</td></tr>
            <tr><td>Rechtsstatus</td><td>${esc(anchor.zoneSource ? anchor.zoneSource.rechtsstatus : '—')}</td></tr>
            <tr><td>Ausnützungsziffer</td><td>${rules.ausnuetzungsziffer_max_pct} %</td></tr>
            <tr><td>Vollgeschosse</td><td>max. ${rules.vollgeschosse_max}</td></tr>
            <tr><td>${esc(rules.heightMetric)}</td><td>max. ${rules.heightM} m</td></tr>
            <tr><td>Grundabstand</td><td>min. ${rules.grundabstand_min_m} m</td></tr>
            ${rules.grosser_grenzabstand_min_m != null ? `<tr><td>Grosser Grenzabstand</td><td>min. ${rules.grosser_grenzabstand_min_m} m</td></tr>` : ''}
            ${rules.gruenflaechenziffer_min_pct != null ? `<tr><td>Grünflächenziffer</td><td>min. ${rules.gruenflaechenziffer_min_pct} %</td></tr>` : ''}
          </table>
          <div class="note-box small">
            Zone und Grundmasse: kantonale Nutzungsplanung (ogd-0156).<br>
            Grenzabstand / Grünflächenziffer: ${esc(rules.source.article)}, ${esc(rules.source.version)}.
          </div>
        </div>
      </div>`, foot,
      sourcesLine(rules, [
        ['Grundmasse', 'ausnuetzungsziffer_max_pct'],
        ['Höhe', rules.heightRegime ? 'gebaeudehoehe_max_m_bzo2016' : 'traufseitige_fassadenhoehe_max_m', 'gebaeudehoehe_max_m'],
        ['Regime', 'negative_vorwirkung'],
      ]));

    // ---- Sheet 4: Einschränkungen -----------------------------------------
    // Show the Waldabstand geometry where it actually bites; otherwise fall
    // back to the ordinary situation map so the sheet still carries context.
    const showWaldMap = !!(wald && wald.forbidden);
    const rmW = 1000, rmH = 820;
    const rmBbox = T.buildMapBbox(centerE, centerN, halfSpan * 1.45, rmW, rmH);
    const restrictionMap = showWaldMap
      ? `<div class="mapwrap" style="aspect-ratio:${rmW}/${rmH}">
           <img class="layer multiply" crossorigin="anonymous" src="${T.buildCadastreMapUrl(rmBbox, rmW, rmH)}" alt="Parzellengrenzen">
           ${restrictionMapSvg(wald, rings, rmBbox, rmW, rmH)}
         </div>
         ${legend([
           ['background:#9fc38f;border:1px solid #5f8a52;', 'Waldareal'],
           ['background:transparent;border-top:3px dashed #2f6b23;height:0;margin-top:6px;', 'Waldabstandslinie'],
           ['background:repeating-linear-gradient(45deg,#c62828 0 3px,transparent 3px 6px);border:1px solid #c62828;', 'nicht bebaubar (Waldseite)'],
           ['background:transparent;border:2px solid #c62828;', multi ? 'gewählte Parzellen' : 'Parzelle'],
         ])}
         <div class="caption">Waldabstand geometrisch ermittelt: ${fmt(wald.lostAreaM2)} m² der Parzelle liegen auf der Waldseite der Abstandslinie und sind vom Fussabdruck abgezogen. Quellen: ogd-0152 (Abstandslinie), ogd-0111 (Waldareal).</div>`
      : `${mapBlock(rings, centerE, centerN, halfSpan * 1.45, ['cadastre'], null, rmW, rmH)}
         <div class="caption">Situationsplan. Für diese Parzelle wurde keine einschneidende Waldabstandslinie gefunden.</div>`;

    const s4 = sheet('Einschränkungen', 'Was geprüft wurde — und was nicht',
      `<div class="cols c-5545">
        <div data-flow>
          <h3>Automatisch berechnet</h3>
          ${checklistHtml(checklist.tierA)}
          <h3 style="margin-top:6mm">Manuell zu prüfen</h3>
          ${checklistHtml(checklist.tierB)}
        </div>
        <div>${restrictionMap}</div>
      </div>`,
      foot,
      sourcesLine(rules, [
        ['Waldabstand', 'waldabstand'],
        ['Strassenabstand', 'strassenabstand_ohne_baulinien_m'],
        ['Begrünung', 'begruenung_perimeter_min_pct'],
        ['Attika', 'attika_profil_ueberhoehung_m'],
      ]));

    // ---- Sheet 4b: Hinweise (the flags) ------------------------------------
    // The warnings are numerous and legally load-bearing; squeezed under the
    // checklist they overflowed the fixed sheet and painted over the sources
    // line. They get their own sheet, two columns.
    const s4b = flags.length
      ? sheet('Hinweise und Vorbehalte der Berechnung', 'Jede Vereinfachung, ausgeschrieben',
          `<div class="flags-cols" data-flow>${flags.map((f) => `<div class="flagline">${esc(f)}</div>`).join('')}</div>`,
          foot,
          '<b>Quellen:</b> je Hinweis im Text genannt (Artikel/Paragraph); Wortlaut der zitierten Bestimmungen auf dem Blatt «Quellen und Vorbehalte».')
      : '';

    // ---- Sheet 4c: Parkierung ---------------------------------------------
    // Position: nach den Einschränkungen, vor den Kosten. Die Parkierung ist
    // eine Einschränkung des Volumens und zugleich Voraussetzung des Volumens,
    // aus dem die Kosten gerechnet werden — sie gehört zwischen beide.
    const pk = r.parkierung;
    const sPk = pk
      ? sheet('Parkierung', pk.erfasst && pk.bindet
          ? 'Wann die Garage das Volumen begrenzt — nicht die Ausnützungsziffer'
          : 'Pflichtplätze und ihr Flächenbedarf',
          parkierungSheetBody(pk, rules), foot,
          pk.erfasst
            ? sourcesLine(rules, [['Parkierung', 'parkierung']])
              + ' · <b>Werkzeug-Annahme (kein Rechtswert):</b> Fläche je Abstellplatz.'
            : '<b>Quellen:</b> § 242 PBG überlässt die Zahl der Abstellplätze der kommunalen Regelung; diese liegt dem Werkzeug für diese Gemeinde nicht vor — deshalb keine Zahl.')
      : '';

    // ---- Sheet 5: Kosten ---------------------------------------------------
    const s5 = sheet('Grobe Kostenschätzung', 'Sehr grob — keine Kostenplanung',
      `<div class="cols c-5050">
        <div>
          <div class="hero">
            <div class="hero-label">Erstellungskosten BKP 2, überschlägig</div>
            <div class="hero-value">≈ CHF ${fmtInt(cost.totalChf)}</div>
            <div class="hero-sub">${fmt(envelopeVolumeM3)} m³ × CHF ${cost.chfPerM3}/m³</div>
          </div>
          <table class="facts">
            <tr><td>Nutzbarer Fussabdruck</td><td>${fmt(reconciled.usableFootprintAreaM2)} m²</td></tr>
            <tr><td>${esc(rules.heightMetric)}</td><td>${rules.heightM} m</td></tr>
            <tr><td>Umbauter Raum (Box-Näherung)</td><td>${fmt(envelopeVolumeM3)} m³</td></tr>
          </table>
        </div>
        <div>
          <h3>Bandbreite</h3>
          <table class="derive">
            <tr><td><b>Kennwert BKP 2</b></td><td><b>Gebäudekosten</b></td><td><b>inkl. BNK +30%</b></td></tr>
            ${[800, 900, 1000].map((k) => `<tr class="${k === cost.chfPerM3 ? 'result' : ''}">
              <td>CHF ${k}/m³</td>
              <td>CHF ${fmtInt(T.roundUpChf(envelopeVolumeM3 * k))}</td>
              <td>CHF ${fmtInt(T.roundUpChf(envelopeVolumeM3 * k * 1.3))}</td></tr>`).join('')}
          </table>
          <div class="note-box small">${esc(cost.note)}</div>
        </div>
      </div>`, foot,
      '<b>Quellen:</b> Kostenkennwert ist eine Werkzeug-Annahme (Bandbreite CHF 800–1000/m³ BKP 2), kein Gesetzeswert. Volumen aus dem oben hergeleiteten Baukörper.');

    // ---- Sheet 5b: Abgrenzung ---------------------------------------------
    // Direkt vor den Quellen: das Dokument schliesst mit Umfang und Grundlage.
    const sAbg = sheet('Nicht Gegenstand dieser Auswertung', 'Was offen bleibt — benannt statt weggelassen',
      abgrenzungSheetBody(), foot,
      '<b>Quellen:</b> auf diesem Blatt wird nichts gerechnet. Der Umfang der Phase Machbarkeit folgt der Norm SIA 112, Modell Bauplanung, 2014, Teilphase 21.');

    // ---- Sheet 6: Quellen & Vorbehalte ------------------------------------
    // Full WORDING of every cited provision (from the provenance records) —
    // the report has to carry the paragraphs it quotes, not just references.
    const QUOTE_LIST = [
      ['Ausnützungsziffer', 'ausnuetzungsziffer_max_pct'],
      ['Überbauungsziffer', 'ueberbauungsziffer_hauptgebaeude_max_pct'],
      ['Grünflächenziffer', 'gruenflaechenziffer_min_pct'],
      ['Vollgeschosse', 'vollgeschosse_max'],
      ['Anrechenbares Untergeschoss', 'anrechenbares_untergeschoss_max'],
      ['Anrechenbare Dach-/Attikageschosse', 'anrechenbares_dach_attika_max'],
      ['Zulässige Höhe', rules.heightRegime ? 'gebaeudehoehe_max_m_bzo2016' : (rules.traufseitige_fassadenhoehe_max_m != null ? 'traufseitige_fassadenhoehe_max_m' : 'gebaeudehoehe_max_m')],
      ['Firsthöhe (Zuschlag)', 'firsthoehe_zuschlag_m'],
      ['Grenzabstand (Grundabstand)', 'grundabstand_min_m'],
      ['Grosser Grenzabstand / Hauptfassaden', 'grosser_grenzabstand_suedseiten', 'grosser_grenzabstand_min_m'],
      ['Mehrlängenzuschlag', 'mehrlaengenzuschlag'],
      ['Gebäude-/Gesamtlänge', rules.gesamtlaenge_max_m != null ? 'gesamtlaenge_max_m' : 'gebaeudelaenge_inkl_klein_anbauten_max_m'],
      ['Anrechenbare Grundstücksfläche', 'massgebliche_grundflaeche', 'anrechenbare_grundstuecksflaeche', 'massgebliche_grundflaeche_altrecht'],
      ['Freibetrag Dach-/Attika-/UG', 'dach_attika_ug_freibetrag'],
      ['Attika-Profil (45°)', 'attika_profil_ueberhoehung_m'],
      ['Attika Bergseite', 'attika_bergseite'],
      ['Waldabstand', 'waldabstand'],
      ['Strassenabstand ohne Baulinien', 'strassenabstand_ohne_baulinien_m'],
      ['Begrünung', 'begruenung_perimeter_min_pct'],
      ['Negative Vorwirkung (Regime)', 'negative_vorwirkung'],
    ];
    const quoteItems = [];
    for (const [label, ...keys] of QUOTE_LIST) {
      let prov = null;
      for (const k of keys) {
        prov = T.getProvenance ? T.getProvenance(rules, k) : null;
        if (prov) break;
      }
      if (!prov || !prov.quote) continue;
      quoteItems.push(
        `<div class="quote-item"><div class="q-head">${esc(label)}</div>` +
        `<div class="q-ref">${esc(prov.article || '')}${prov.page ? `, S. ${prov.page}` : ''}${prov.title ? ` — ${esc(prov.title)}` : ''}</div>` +
        `<div class="q-text">„${esc(prov.quote)}"</div></div>`
      );
    }

    const s6 = sheet('Quellen und Vorbehalte', 'Grundlage und Grenzen dieser Auswertung — mit Wortlaut',
      `<div class="cols c-5050" style="margin-bottom:5mm">
        <div>
          <h3>Quellen</h3>
          <table class="facts">
            <tr><td>Zone / Grundmasse</td><td>Kantonale Nutzungsplanung ZH, Datensatz ogd-0156</td></tr>
            <tr><td>Bauvorschriften</td><td>${esc(rules.source.article)}, ${esc(rules.source.version)}</td></tr>
            <tr><td>Parzellengeometrie</td><td>Amtliche Vermessung (swisstopo)</td></tr>
            <tr><td>Eigentumsbeschränkungen</td><td>ÖREB-Kataster Kanton Zürich</td></tr>
            <tr><td>Waldabstand</td><td>Kantonale Geodaten ogd-0152 (Abstandslinie) und ogd-0111 (Waldareal)</td></tr>
            <tr><td>Terrain</td><td>swissALTI3D</td></tr>
          </table>
        </div>
        <div>
          <h3>Vorbehalte</h3>
          <div class="note-box small">${esc(rulesData.legal_status || '')}</div>
          ${grundbuchFootnote ? `<div class="note-box small"><b>Grundbuchauszug:</b> ${esc(grundbuchFootnote)}</div>` : ''}
          <div class="note-box small">
            Zonenzuordnung an der Grundstücksgrenze zusätzlich prüfen.
            Diese Auswertung geht von unbebautem Land aus; Bestand, Abbruch und Bestandesschutz sind nicht berücksichtigt.
            Kein Ersatz für eine unterschriebene Machbarkeitsstudie oder ein Baugesuch.
          </div>
        </div>
      </div>
      <h3>Zitierte Bestimmungen (Wortlaut)</h3>
      <div class="quote-list" data-flow>${quoteItems.join('')}</div>`, foot);

    const html = [s1, s2, s2b, s3, s4, s4b, sPk, s5, sAbg, s6].join('');
    const host = document.getElementById('print-doc');
    host.innerHTML = html;

    // Erst umbrechen, dann numerieren — der Umbruch erzeugt neue Blätter.
    splitOverflowingSheets(host, foot);

    // Number the sheets now that we know how many there are.
    const sheets = host.querySelectorAll('.sheet');
    sheets.forEach((s, i) => {
      const f = s.querySelector('.sheet-foot');
      f.innerHTML = `<span>${f.innerHTML}</span><span>${i + 1} / ${sheets.length}</span>`;
    });

    await waitForImages(host);
    return host;
  }

  function bindingExplanation(reconciled, rules) {
    switch (reconciled.bindingConstraint) {
      case 'ausnuetzungsziffer':
        return `Die zulässige Geschossfläche ist ausgeschöpft, bevor die Geschosszahl erreicht wird. Ein grösserer Fussabdruck bringt keine zusätzliche Fläche — die Ausnützungsziffer von ${rules.ausnuetzungsziffer_max_pct} % ist die Obergrenze.`;
      case 'gruenflaechenziffer':
        return `Der Fussabdruck wird durch die Grünflächenziffer begrenzt, nicht durch den Grundabstand: es muss mehr Fläche unbebaut bleiben, als der Grenzabstand allein verlangen würde.`;
      case 'grundabstand':
      default:
        return `Der Fussabdruck wird durch den Grenzabstand begrenzt. Die Ausnützungsziffer wäre noch nicht ausgeschöpft — die Parzellengeometrie ist der limitierende Faktor.`;
    }
  }

  // Der Export darf nicht an einer einzelnen Kachel haengen — aber er darf
  // auch nicht zu frueh weitergehen. Mit 8 s Frist kam genau das heraus:
  // bei kaltem Cache brauchen die WMS-Kacheln (900x1300, 1200x1150 px)
  // laenger, waitForImages gab auf, und der Export rasterte Blaetter mit
  // leeren Kartenrahmen. Im Safari-Export vom 27.8.2026 fehlte deshalb auf
  // ALLEN drei Kartenblaettern die Katasterebene.
  //
  // 30 s ist grosszuegig, weil hier ein Dokument entsteht und nicht eine
  // Bildschirmansicht: ein paar Sekunden mehr sind billiger als eine
  // ausgelieferte Studie mit weissen Karten. Laeuft die Frist doch ab,
  // meldet js/ui/pdf.js das Bild als fehlend — still bleibt es nie.
  const IMAGE_TIMEOUT_MS = 30000;

  function waitForImages(root) {
    const imgs = [...root.querySelectorAll('img')];
    return Promise.all(imgs.map((img) => (img.complete && img.naturalWidth
      ? Promise.resolve()
      : new Promise((resolve) => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
          setTimeout(resolve, IMAGE_TIMEOUT_MS);
        }))));
  }

  T.buildPrintDocument = buildPrintDocument;
})();
