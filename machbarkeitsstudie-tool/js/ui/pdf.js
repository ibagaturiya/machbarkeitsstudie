// pdf.js — schreibt aus den fertigen A4-Blättern eine echte PDF-Datei und
// öffnet sie in einem eigenen Tab im PDF-Viewer des Browsers. Ohne
// Druckdialog: ein Klick, die Studie steht im Viewer, und dessen eigene
// Leiste hat den Download-Pfeil, die Suche und die Seitenzahlen.
//
// Seit v1.2 werden die Seiten als VEKTOR-TEXT gesetzt (buildVectorPage):
// das gerenderte DOM ist die Layout-Engine — Zeilenkästen per Range-API
// ausgelesen, jeder Run als positionierter Base-14-Helvetica/Courier-Text
// geschrieben, Laufweite per Tz exakt auf das gemessene Kästchen gestellt;
// Flächen und Linien kommen aus den computed styles, Karten/3D/Grundriss
// bleiben eingebettete JPEGs. Ergebnis: wählbarer, durchsuchbarer Text und
// rund ein Zehntel der Dateigrösse. Scheitert der Vektor-Satz eines Blatts,
// fällt genau dieses Blatt auf die foreignObject-Rasterung unten zurück.
//
// Warum ohne Bibliothek. Eine PDF-Seite, die genau ein Bild enthält, ist ein
// sehr kleiner Ausschnitt des Formats — Katalog, Seitenbaum, je Seite ein
// Inhaltsstrom und ein JPEG-XObject, dazu die Referenztabelle. Das sind die
// ~120 Zeilen weiter unten. Dafür jsPDF plus html2canvas zu vendorisieren
// (rund 500 KB Fremdcode, zwei weitere Zeilen in vendor/README.md, zwei
// weitere Versionen, die veralten) wäre teurer als es selbst zu schreiben,
// und html2canvas bringt seine eigene, unvollständige CSS-Implementierung
// mit: die Blätter benutzen CSS-Grid, Mehrspaltensatz, aspect-ratio und
// mix-blend-mode, und genau daran scheitert html2canvas reihenweise.
//
// Stattdessen rastert der Browser selbst: das Blatt wird in ein
// <foreignObject> eines SVG serialisiert und als Bild geladen. Gerendert
// wird dabei von derselben Layout-Engine, die auch die Vorschau zeichnet —
// die PDF-Seite kann deshalb gar nicht anders aussehen als das, was am
// Bildschirm stand. Preis: die Seite ist ein Bild, der Text darin nicht
// markierbar — deshalb ist die Rasterung seit v1.2 nur noch die
// Rückfallebene je Blatt, nicht mehr der Normalfall.
//
// Zwei Fallstricke, die hier gelöst sind:
//   1. <foreignObject> lädt keine externen Bilder. Die WMS-Kartenkacheln
//      müssen vorher als data:-URI eingebettet werden.
//   2. Eingebettet wird aus dem BEREITS GELADENEN <img> im Dokument, über
//      ein Canvas — nicht über ein zweites fetch() derselben URL. Der erste
//      Versuch tat genau das und lieferte in Safari zehn Blätter mit leeren
//      Karten: das <img> war ohne CORS-Freigabe in den Cache gegangen, und
//      das nachfolgende fetch(mode:'cors') fiel auf ebendiesen Eintrag und
//      scheiterte. Was auf dem Bildschirm steht, ist bereits dekodiert im
//      Speicher — es noch einmal über das Netz zu holen, kann nur schlechter
//      ausgehen. Voraussetzung ist crossorigin="anonymous" am <img>
//      (js/ui/print.js), sonst ist das Canvas "tainted".
window.MachbarkeitTool = window.MachbarkeitTool || {};

(function () {
  const T = window.MachbarkeitTool;

  // A4 quer in PDF-Punkten (1 pt = 1/72 Zoll). Exakte Literale aus
  // 297 mm bzw. 210 mm — nicht gerundet, sonst driftet das Seitenformat.
  const A4_LANDSCAPE_PT = { w: (297 / 25.4) * 72, h: (210 / 25.4) * 72 };
  // 2.5× CSS-Pixel ≈ 240 dpi — die Seite ist halb so gross wie das frühere
  // A3, feine Katasterlinien brauchen die höhere Dichte; die Dateigrösse
  // bleibt dank halber Fläche etwa gleich.
  const RASTER_SCALE = 2.5;
  const JPEG_QUALITY = 0.85;

  // ---- Vektor-Satz -------------------------------------------------------
  // true: jede Seite wird als echter PDF-Text gesetzt (waehlbar, durchsuchbar,
  // Bruchteil der Dateigroesse); Karten und 3D bleiben eingebettete Bilder.
  // Scheitert der Vektor-Satz eines Blatts, faellt GENAU dieses Blatt auf die
  // Rasterung zurueck und der Export meldet es — das ist die Rueckfallebene.
  const VECTOR_EXPORT = true;

  // Base-14-Schriften: kein Font-Embedding (die vendored Archivo/Plex liegen
  // als woff2/Brotli vor — ein Decompressor plus Subsetting waere neuer
  // Fremdcode). Helvetica steht der Grotesk Archivo nahe genug; Mono-Spalten
  // werden Courier. Die Laufweite wird je Zeile exakt auf das im Browser
  // gemessene Kaestchen gestellt (Tz), deshalb fluchten die Zahlenspalten.
  const PDF_FONTS = {
    HELV:    { res: 'F1', ps: 'Helvetica' },
    HELV_B:  { res: 'F2', ps: 'Helvetica-Bold' },
    HELV_O:  { res: 'F3', ps: 'Helvetica-Oblique' },
    HELV_BO: { res: 'F4', ps: 'Helvetica-BoldOblique' },
    COUR:    { res: 'F5', ps: 'Courier' },
    COUR_B:  { res: 'F6', ps: 'Courier-Bold' },
  };
  function fontKeyFor(cs) {
    const mono = /mono|courier/i.test(cs.fontFamily);
    const bold = (parseInt(cs.fontWeight, 10) || 400) >= 600;
    const ital = cs.fontStyle === 'italic' || cs.fontStyle === 'oblique';
    if (mono) return bold ? 'COUR_B' : 'COUR';
    if (bold) return ital ? 'HELV_BO' : 'HELV_B';
    return ital ? 'HELV_O' : 'HELV';
  }
  // Natuerliche Breite eines Runs in px — gemessen mit der Browser-Helvetica/
  // -Courier, denselben Metriken wie die Base-14-Fonts. Ersetzt eine
  // handgeschriebene AFM-Tabelle.
  let measureCtx = null;
  function naturalWidthPx(text, key, sizePx, letterSpacingPx) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    const fam = key.startsWith('COUR') ? 'Courier' : 'Helvetica';
    const bold = key === 'HELV_B' || key === 'HELV_BO' || key === 'COUR_B';
    const ital = key === 'HELV_O' || key === 'HELV_BO';
    measureCtx.font = `${ital ? 'italic ' : ''}${bold ? 'bold ' : ''}${sizePx}px ${fam}`;
    return measureCtx.measureText(text).width + (letterSpacingPx || 0) * text.length;
  }

  // WinAnsi fuer die Zeichen ausserhalb Latin-1, die dieses Dokument benutzt.
  const WINANSI = {
    0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x201E: 0x84,
    0x2013: 0x96, 0x2014: 0x97, 0x2026: 0x85, 0x20AC: 0x80, 0x2022: 0x95,
    0x2039: 0x8B, 0x203A: 0x9B, 0x2122: 0x99, 0x0160: 0x8A, 0x017E: 0x9E,
  };
  function pdfEscapeWinAnsi(str) {
    let out = '';
    for (const ch of str) {
      const cp = ch.codePointAt(0);
      let b;
      if (cp === 0x2248) b = 0x7E;            // ≈ → ~ (nicht in WinAnsi)
      else if (cp === 0x2212) b = 0x2D;       // Minuszeichen → Bindestrich
      else if (cp === 0x2192) b = 0x3E;       // → wird >
      else if (cp <= 0xFF) b = cp;
      else b = WINANSI[cp] ?? 0x3F;           // ? fuer alles Unbekannte
      if (b === 0x28 || b === 0x29 || b === 0x5C) out += '\\' + String.fromCharCode(b);
      else if (b >= 32 && b < 127) out += String.fromCharCode(b);
      else out += '\\' + b.toString(8).padStart(3, '0');
    }
    return out;
  }

  // 'rgb(a)(r, g, b[, a])' → 'r g b' als PDF-Bruchteile, oder null bei alpha 0.
  function parseColor(str) {
    const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(str || '');
    if (!m) return null;
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
    const f = (v) => (parseFloat(v) / 255).toFixed(3);
    return `${f(m[1])} ${f(m[2])} ${f(m[3])}`;
  }
  const n2 = (v) => v.toFixed(2);

  // Zeilenfragmente eines Textknotens: [{start, end, rect}], eines je
  // Zeilenkasten. Der Browser hat den Umbruch schon gerechnet — das Range-
  // API liest ihn aus, statt ihn nachzubauen.
  function lineFragments(nd, range) {
    const len = nd.textContent.length;
    range.selectNodeContents(nd);
    const all = [...range.getClientRects()].filter((r) => r.width > 0.1);
    if (all.length === 0) return [];
    if (all.length === 1) return [{ start: 0, end: len, rect: all[0] }];
    const frags = [];
    let lineStart = 0;
    for (let i = 1; i <= len; i++) {
      range.setStart(nd, lineStart); range.setEnd(nd, i);
      const rs = [...range.getClientRects()].filter((r) => r.width > 0.1);
      if (rs.length > 1) {
        range.setEnd(nd, i - 1);
        const r = [...range.getClientRects()].filter((q) => q.width > 0.1)[0];
        if (r) frags.push({ start: lineStart, end: i - 1, rect: r });
        lineStart = i - 1;
      }
    }
    range.setStart(nd, lineStart); range.setEnd(nd, len);
    const last = [...range.getClientRects()].filter((r) => r.width > 0.1)[0];
    if (last) frags.push({ start: lineStart, end: len, rect: last });
    return frags;
  }

  // Ein Blatt als Vektorseite: Flaechen und Linien aus den computed styles,
  // Text als positionierte Runs (das gerenderte DOM ist die Layout-Engine),
  // Karten/3D/Grundriss als eingebettete JPEG-XObjects.
  async function buildVectorPage(sheetEl, problems) {
    const sheetRect = sheetEl.getBoundingClientRect();
    if (!sheetRect.width || !sheetRect.height) throw new Error('Blatt ohne Ausmasse');
    const S = A4_LANDSCAPE_PT.w / sheetRect.width;
    const X = (px) => n2((px - sheetRect.left) * S);
    const Y = (px) => n2(A4_LANDSCAPE_PT.h - (px - sheetRect.top) * S);
    const label = (sheetEl.querySelector('h2, h1') || {}).textContent || 'Blatt';
    const out = [];
    const images = [];

    // -- 1. Flaechen und Linien, in DOM-Reihenfolge --
    for (const el of [sheetEl, ...sheetEl.querySelectorAll('*')]) {
      if (el.tagName === 'IMG' || el.closest('svg')) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 0.5 || r.height < 0.5) continue;
      const bg = parseColor(cs.backgroundColor);
      if (bg && !(el === sheetEl)) {
        out.push(`${bg} rg ${X(r.left)} ${Y(r.bottom)} ${n2(r.width * S)} ${n2(r.height * S)} re f`);
      }
      const SIDES = [
        ['Top', r.left, r.top, r.right, r.top, 0, 1],
        ['Bottom', r.left, r.bottom, r.right, r.bottom, 0, -1],
        ['Left', r.left, r.top, r.left, r.bottom, 1, 0],
        ['Right', r.right, r.top, r.right, r.bottom, -1, 0],
      ];
      for (const [side, x1, y1, x2, y2, dx, dy] of SIDES) {
        const wpx = parseFloat(cs[`border${side}Width`]) || 0;
        if (!wpx || cs[`border${side}Style`] === 'none') continue;
        const col = parseColor(cs[`border${side}Color`]);
        if (!col) continue;
        const off = wpx / 2;
        out.push(`${col} RG ${n2(wpx * S)} w `
          + `${X(x1 + dx * off)} ${Y(y1 + dy * off)} m ${X(x2 + dx * off)} ${Y(y2 + dy * off)} l S`);
      }
      // Absolut positionierte ::before/::after mit Hintergrund — die Akzent-
      // Ticks der Kopfregel und der Argumentliste. Pseudo-Elemente haben kein
      // getBoundingClientRect; Lage und Mass stehen aber in ihren computed
      // styles (left/top/bottom, width/height in px).
      for (const which of ['::before', '::after']) {
        const ps = getComputedStyle(el, which);
        if (ps.content === 'none' || ps.position !== 'absolute') continue;
        const bg2 = parseColor(ps.backgroundColor);
        if (!bg2) continue;
        const pw = parseFloat(ps.width) || 0, ph = parseFloat(ps.height) || 0;
        if (!pw || !ph) continue;
        const left = parseFloat(ps.left);
        const top = parseFloat(ps.top);
        const bottom = parseFloat(ps.bottom);
        const px = r.left + (Number.isFinite(left) ? left : 0);
        const py = Number.isFinite(top) ? r.top + top : (Number.isFinite(bottom) ? r.bottom - bottom - ph : r.top);
        out.push(`${bg2} rg ${X(px)} ${Y(py + ph)} ${n2(pw * S)} ${n2(ph * S)} re f`);
      }
    }

    // -- 2. Karten, Bilder, Grundriss-SVG als JPEG-XObjects --
    // Die .mapwrap-Stapel werden EINMAL ueber die bestehende Rastermaschine
    // (paintRasterLayers, inkl. multiply) auf ein Blatt-Canvas gelegt und je
    // Rahmen ausgeschnitten — dieselben Pixel wie im Rasterexport.
    const flat = document.createElement('canvas');
    flat.width = Math.max(1, Math.round(sheetRect.width * 2));
    flat.height = Math.max(1, Math.round(sheetRect.height * 2));
    const fctx = flat.getContext('2d');
    fctx.fillStyle = '#ffffff'; fctx.fillRect(0, 0, flat.width, flat.height);
    await paintRasterLayers(sheetEl, fctx, 2, label, problems);
    const addImage = (canvas, rect) => {
      const name = `Im${images.length}`;
      images.push({ name, jpeg: dataUrlToBytes(canvas.toDataURL('image/jpeg', 0.88)),
                    width: canvas.width, height: canvas.height });
      out.push(`q ${n2(rect.width * S)} 0 0 ${n2(rect.height * S)} ${X(rect.left)} ${Y(rect.bottom)} cm /${name} Do Q`);
    };
    const cropFlat = (rect) => {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(rect.width * 2));
      c.height = Math.max(1, Math.round(rect.height * 2));
      c.getContext('2d').drawImage(flat,
        (rect.left - sheetRect.left) * 2, (rect.top - sheetRect.top) * 2, rect.width * 2, rect.height * 2,
        0, 0, c.width, c.height);
      return c;
    };
    for (const wrap of sheetEl.querySelectorAll('.mapwrap')) {
      const r = wrap.getBoundingClientRect();
      if (r.width > 1 && r.height > 1) addImage(cropFlat(r), r);
    }
    for (const img of sheetEl.querySelectorAll('img')) {
      if (img.closest('.mapwrap')) continue;
      const r = img.getBoundingClientRect();
      if (r.width > 1 && r.height > 1) addImage(cropFlat(r), r);
    }
    for (const svg of sheetEl.querySelectorAll('svg')) {
      if (svg.closest('.mapwrap')) continue;
      const r = svg.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const im = await svgElementToImage(svg, r.width * 2, r.height * 2);
      const c = document.createElement('canvas');
      c.width = Math.round(r.width * 2); c.height = Math.round(r.height * 2);
      const cc = c.getContext('2d');
      cc.fillStyle = '#ffffff'; cc.fillRect(0, 0, c.width, c.height);
      cc.drawImage(im, 0, 0, c.width, c.height);
      addImage(c, r);
    }

    // -- 3. Text, zuletzt (liegt ueber allen Flaechen) --
    const walker = document.createTreeWalker(sheetEl, NodeFilter.SHOW_TEXT, {
      acceptNode(nd) {
        if (!nd.textContent.trim()) return NodeFilter.FILTER_REJECT;
        const pe = nd.parentElement;
        if (!pe || pe.closest('svg')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const range = document.createRange();
    let nd;
    while ((nd = walker.nextNode())) {
      const pe = nd.parentElement;
      const cs = getComputedStyle(pe);
      if (cs.visibility === 'hidden') continue;
      const fontSizePx = parseFloat(cs.fontSize);
      if (!fontSizePx) continue;
      const key = fontKeyFor(cs);
      const col = parseColor(cs.color) || '0 0 0';
      const lsp = parseFloat(cs.letterSpacing) || 0;
      const upper = cs.textTransform === 'uppercase'
        || (cs.fontVariantCaps && cs.fontVariantCaps.includes('small-caps'));
      for (const frag of lineFragments(nd, range)) {
        let t = nd.textContent.slice(frag.start, frag.end).replace(/\s+/g, ' ');
        if (!t.trim()) continue;
        // Fuehrende/abschliessende Leerzeichen sind im Kasten enthalten —
        // NICHT trimmen, sonst verschiebt sich der Anker.
        const disp = upper ? t.toUpperCase() : t;
        const natural = naturalWidthPx(disp, key, fontSizePx, lsp);
        const tz = natural > 0.1 ? Math.max(55, Math.min(170, 100 * frag.rect.width / natural)) : 100;
        // Grundlinie: Zeilenkasten-Mitte plus ~0.30 em — die Konstante ist
        // gegen den Rasterexport kalibriert, nicht aus einer Fontmetrik.
        const baselinePx = frag.rect.top + (frag.rect.height - fontSizePx) / 2 + 0.80 * fontSizePx;
        out.push(`BT /${PDF_FONTS[key].res} ${n2(fontSizePx * S)} Tf ${n2(tz)} Tz `
          + (lsp ? `${n2(lsp * S)} Tc ` : '0 Tc ')
          + `${col} rg 1 0 0 1 ${X(frag.rect.left)} ${Y(baselinePx)} Tm `
          + `(${pdfEscapeWinAnsi(disp)}) Tj ET`);
      }
    }

    return { kind: 'vector', content: out.join('\n') + '\n', images };
  }

  // ---- öffentlicher Einstieg ---------------------------------------------

  // Die zuletzt ausgegebene Objekt-URL. Sie darf NICHT widerrufen werden,
  // solange der Viewer-Tab sie anzeigt — sonst bricht dort der Download-Pfeil
  // ab. Widerrufen wird deshalb immer nur die URL des VORIGEN Exports, wenn
  // ein neuer entsteht; so bleibt höchstens eine Datei im Speicher.
  let lastObjectUrl = null;

  // Öffnet den Viewer-Tab und füllt ihn, sobald die Datei fertig ist.
  //
  // Der Tab muss SYNCHRON im Klick-Handler geöffnet werden. Das Rastern
  // dauert mehrere Sekunden; ein window.open() danach gilt nicht mehr als
  // Folge einer Nutzeraktion und wird von Safari als Popup blockiert. Also:
  // erst der leere Tab mit einer Wartemeldung, dann die fertige Datei
  // hineinnavigiert.
  //
  // tab — das bereits geöffnete Fenster (oder null, wenn blockiert)
  // meta — { author, subject, keywords } für das Info-Wörterbuch der PDF.
  async function openSheetsAsPdf(tab, host, filename, meta, onProgress) {
    let blob;
    try {
      blob = await buildSheetsPdf(host, filename, meta, onProgress);
    } catch (e) {
      if (tab && !tab.closed) tab.close();
      throw e;
    }
    if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
    lastObjectUrl = URL.createObjectURL(blob);

    if (!tab || tab.closed) {
      // Popup blockiert oder Tab zugemacht: die Datei ist fertig und darf
      // nicht verlorengehen — dann eben als Download, und der Aufrufer sagt
      // es in der Statuszeile. Lieber ein anderer Weg als gar keiner.
      triggerDownload(blob, `${filename}.pdf`);
      return { blocked: true, pages: blob.__pages, problems: blob.__problems, bytes: blob.size };
    }
    tab.location.replace(lastObjectUrl);
    return { blocked: false, pages: blob.__pages, problems: blob.__problems, bytes: blob.size };
  }

  // Das leere Wartefenster. Wird synchron im Klick-Handler aufgerufen.
  function openPendingTab(title) {
    const tab = window.open('', '_blank');
    if (!tab) return null;
    tab.document.write(
      `<!doctype html><html lang="de"><head><meta charset="utf-8">` +
      `<title>${title}</title><style>` +
      `body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;` +
      `font:15px/1.6 -apple-system,"Helvetica Neue",Arial,sans-serif;background:#2b2b2e;color:#cfcabf}` +
      `div{text-align:center}b{display:block;font-size:17px;color:#fff;margin-bottom:.4rem}` +
      `</style></head><body><div><b>Die Studie wird gesetzt …</b>` +
      `Die Blätter werden gerendert. Das dauert einige Sekunden;` +
      `<br>dieser Tab füllt sich von selbst.</div></body></html>`
    );
    tab.document.close();
    return tab;
  }

  // host      — das #print-doc-Element mit den fertigen .sheet-Kindern
  // filename  — Dateiname ohne Endung
  // onProgress(i, n) — für die Fortschrittsanzeige am Knopf
  async function buildSheetsPdf(host, filename, meta, onProgress) {
    const sheets = [...host.querySelectorAll('.sheet')];
    if (!sheets.length) throw new Error('Kein Export-Dokument vorhanden.');

    // Bookmarks aus den Blättern selbst: jedes nummerierte Blatt wird ein
    // Eintrag, Fortsetzungsblätter zählen zum Eintrag ihres Themas, die
    // Anhangs-Blätter (A.*) sammeln sich unter einem Knoten «Anhang».
    const bookmarks = [];
    sheets.forEach((sh, i) => {
      if (sh.dataset.continuation) return;
      const t = sh.dataset.outlineTitle
        || (sh.querySelector('h2, h1') || {}).textContent || `Seite ${i + 1}`;
      const num = sh.dataset.outlineNum || '';
      bookmarks.push({
        title: num ? `${num} · ${t}` : t,
        pageIndex: i,
        appendix: num.startsWith('A.'),
      });
    });

    const css = VECTOR_EXPORT ? null : (await fontFaceCssAsDataUris()) + '\n' + collectCss();
    const pages = [];
    const problems = [];
    for (let i = 0; i < sheets.length; i++) {
      if (onProgress) onProgress(i, sheets.length);
      let page = null;
      if (VECTOR_EXPORT) {
        try {
          page = await buildVectorPage(sheets[i], problems);
        } catch (e) {
          problems.push(`Blatt ${i + 1}: Vektor-Satz fehlgeschlagen (${e.message}) — gerastert`);
        }
      }
      if (!page) {
        const r = await rasteriseSheet(sheets[i],
          css ?? (await fontFaceCssAsDataUris()) + '\n' + collectCss(), problems);
        page = { kind: 'raster', ...r };
      }
      pages.push(page);
      // Dem Browser zwischen den Blättern Luft lassen, sonst friert die
      // Vorschau während des Exports sichtbar ein.
      await new Promise((r) => setTimeout(r, 0));
    }
    if (onProgress) onProgress(sheets.length, sheets.length);

    const blob = buildPdfBlob(pages, A4_LANDSCAPE_PT.w, A4_LANDSCAPE_PT.h, filename,
      { ...(meta || {}), bookmarks });
    blob.__pages = pages.length;
    blob.__problems = problems;
    return blob;
  }

  // ---- Blatt → JPEG ------------------------------------------------------

  // Die @font-face-Regeln mit den woff2-Dateien als data:-URIs. Nötig, weil
  // ein als <img> geladenes SVG ein eigenständiges Dokument ist, das KEINE
  // Subresourcen nachlädt — die Datei-URLs aus vendor/fonts/fonts.css laufen
  // im foreignObject ins Leere, und die Blätter fielen still auf die
  // Systemschrift zurück. Einmal geholt, dann modulweit gecacht.
  let fontCssPromise = null;
  function fontFaceCssAsDataUris() {
    if (fontCssPromise) return fontCssPromise;
    fontCssPromise = (async () => {
      const sheet = [...document.styleSheets].find((s) => s.href && s.href.includes('fonts.css'));
      if (!sheet) return '';
      const base = sheet.href;
      const parts = [];
      for (const rule of sheet.cssRules) {
        if (!(rule instanceof CSSFontFaceRule)) continue;
        const m = rule.cssText.match(/url\((["']?)([^"')]+)\1\)/);
        if (!m) continue;
        try {
          const abs = new URL(m[2], base).href;
          const buf = await (await fetch(abs)).arrayBuffer();
          let bin = '';
          const bytes = new Uint8Array(buf);
          for (let i = 0; i < bytes.length; i += 0x8000) {
            bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          }
          parts.push(rule.cssText.replace(m[0], `url(data:font/woff2;base64,${btoa(bin)})`));
        } catch { /* eine fehlende Fontdatei bricht den Export nicht */ }
      }
      return parts.join('\n');
    })();
    return fontCssPromise;
  }

  // Alle Regeln aller Stylesheets als Text. Ein <link>-Stylesheet gleicher
  // Herkunft lässt sich auslesen; sollte eines je fremd sein, wirft der
  // Zugriff auf cssRules — dann lieber diese eine Datei überspringen als den
  // Export abbrechen. @font-face-Regeln werden ÜBERSPRUNGEN: ihre Datei-URLs
  // laden im SVG-Bild ohnehin nicht, und sie dürfen nicht mit den
  // data:-URI-Fassungen aus fontFaceCssAsDataUris() konkurrieren.
  function collectCss() {
    return [...document.styleSheets].map((s) => {
      try {
        return [...s.cssRules]
          .filter((r) => !(r instanceof CSSFontFaceRule))
          .map((r) => r.cssText).join('\n');
      }
      catch { return ''; }
    }).join('\n');
  }

  // Rasterbilder werden NICHT mehr ueber das <foreignObject> gerendert,
  // sondern nach dem Rastern des Blatts direkt auf das Canvas gezeichnet.
  // Grund: WebKit (Safari) zeichnet <img>-Elemente innerhalb eines
  // <foreignObject>, das als SVG-Bild gerastert wird, schlicht nicht — der
  // Export vom 28.8.2026 hatte deshalb auf JEDEM Blatt leere Kartenrahmen
  // und eine leere Isometrie, waehrend alle Inline-SVGs (Grundriss,
  // Zonenfarben, Parzellenumrisse) korrekt erschienen. Ein data:-URI aendert
  // daran nichts; die 30-s-Wartefrist (print.js) auch nicht. Deshalb:
  //   1. Im Klon werden alle <img> und alle .mapwrap-Ebenen unsichtbar
  //      gestellt (Layout bleibt, damit Masse und Positionen stimmen).
  //   2. Nach dem Zeichnen des Blatt-Bilds malt paintRasterLayers() jede
  //      Kartenebene in DOM-Reihenfolge direkt auf das Canvas — inklusive
  //      mix-blend-mode:multiply (Kataster ueber Zonenfarben) via
  //      globalCompositeOperation. Die SVG-Ebenen der Karten werden dabei
  //      einzeln als eigenstaendige SVG-Bilder gezeichnet (das rastert auch
  //      Safari korrekt), damit die Stapelfolge Zonen → Kataster → Umriss
  //      erhalten bleibt.
  // Scheitert ein Bild, wird es NICHT stillschweigend weggelassen: der Grund
  // wandert in `problems` und der Aufrufer sagt es in der Statuszeile. Ein
  // leerer Kartenrahmen, den niemand erwaehnt, ist genau die Art Fehler, die
  // erst beim Empfaenger auffaellt (REGELN §2: eine fehlgeschlagene Quelle
  // darf nie wie ein sauberes Ergebnis aussehen).

  // Versteckt im Klon alles, was paintRasterLayers spaeter selbst zeichnet.
  function hidePaintedLayers(clone) {
    for (const el of clone.querySelectorAll('.mapwrap > *, img')) {
      el.style.visibility = 'hidden';
    }
  }

  // Zeichnet die Kartenstapel und freistehenden Bilder des ORIGINAL-Blatts
  // auf das bereits gerasterte Canvas. `scale` = Canvas-Pixel je CSS-Pixel.
  async function paintRasterLayers(sheetEl, ctx, scale, sheetLabel, problems) {
    const sheetRect = sheetEl.getBoundingClientRect();
    const destRect = (el) => {
      const r = el.getBoundingClientRect();
      return {
        x: (r.left - sheetRect.left) * scale,
        y: (r.top - sheetRect.top) * scale,
        w: r.width * scale,
        h: r.height * scale,
      };
    };

    // Kartenstapel: alle Ebenen eines .mapwrap in DOM-Reihenfolge, auf den
    // Rahmen beschnitten. Freistehende Bilder (Isometrie): einzeln.
    const jobs = [];
    for (const wrap of sheetEl.querySelectorAll('.mapwrap')) {
      for (const layer of wrap.children) jobs.push({ el: layer, clip: wrap });
    }
    for (const img of sheetEl.querySelectorAll('img')) {
      if (!img.closest('.mapwrap')) jobs.push({ el: img, clip: null });
    }

    for (const { el, clip } of jobs) {
      const d = destRect(el);
      if (!d.w || !d.h) continue;
      let source;
      if (el.tagName === 'IMG') {
        if (!el.getAttribute('src') || !el.complete || !el.naturalWidth) {
          problems.push(`${sheetLabel}: ${el.getAttribute('alt') || 'Bild'} fehlt (Bild war nicht geladen)`);
          continue;
        }
        source = el;
      } else {
        try {
          source = await svgElementToImage(el, d.w, d.h);
        } catch (e) {
          problems.push(`${sheetLabel}: Kartenebene fehlt (${e.message})`);
          continue;
        }
      }
      ctx.save();
      if (clip) {
        const c = destRect(clip);
        ctx.beginPath();
        ctx.rect(c.x, c.y, c.w, c.h);
        ctx.clip();
      }
      // mix-blend-mode:multiply der Katasterebene (schwarze Linien ueber
      // Zonenfarben) hat im Canvas eine direkte Entsprechung.
      ctx.globalCompositeOperation = el.classList.contains('multiply') ? 'multiply' : 'source-over';
      // object-fit:contain (die Isometrie) darf nicht in den Rahmen gestreckt
      // werden — Seitenverhaeltnis halten und zentrieren, wie der Browser.
      let dd = d;
      if (el.tagName === 'IMG' && el.naturalWidth && getComputedStyle(el).objectFit === 'contain') {
        const k = Math.min(d.w / el.naturalWidth, d.h / el.naturalHeight);
        dd = { x: d.x + (d.w - el.naturalWidth * k) / 2, y: d.y + (d.h - el.naturalHeight * k) / 2,
               w: el.naturalWidth * k, h: el.naturalHeight * k };
      }
      try {
        ctx.drawImage(source, dd.x, dd.y, dd.w, dd.h);
      } catch (e) {
        problems.push(`${sheetLabel}: ${el.getAttribute('alt') || 'Ebene'} fehlt (${e.message})`);
      }
      ctx.restore();
    }
  }

  // Ein Inline-SVG als eigenstaendiges Bild. Breite/Hoehe muessen als
  // Attribute gesetzt sein — Safari rastert ein SVG-Bild ohne konkrete
  // Masse mit Groesse null.
  function svgElementToImage(svgEl, wPx, hPx) {
    const copy = svgEl.cloneNode(true);
    // Das Inline-style (width:100% etc.) wuerde als CSS die width/height-
    // Attribute uebersteuern und das SVG auf die Ersatzgroesse 300x150
    // rastern lassen — im Dokument positioniert es die Ebene, hier stoert es.
    copy.removeAttribute('style');
    copy.removeAttribute('class');
    copy.setAttribute('width', Math.round(wPx));
    copy.setAttribute('height', Math.round(hPx));
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const markup = new XMLSerializer().serializeToString(copy);
    return loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup));
  }

  function rasteriseSheet(sheetEl, css, problems) {
    const rect = sheetEl.getBoundingClientRect();
    const w = Math.round(rect.width), h = Math.round(rect.height);
    if (!w || !h) throw new Error('Das Blatt hat keine Ausmasse — #print-doc ist nicht dargestellt.');

    const clone = sheetEl.cloneNode(true);
    const label = (sheetEl.querySelector('h2, h1') || {}).textContent || 'Blatt';
    hidePaintedLayers(clone);
    return Promise.resolve().then(() => {
      // Der Klon braucht denselben Kontext wie im Dokument: die Blattregeln
      // hängen an `#print-doc .sheet`, und `#print-doc` ist am Bildschirm
      // display:none. Die Vorschau-Klasse macht es sichtbar; Position und
      // Schatten werden zurückgenommen, weil das Blatt hier allein steht.
      const wrap = document.createElement('div');
      wrap.id = 'print-doc';
      wrap.className = 'preview';
      wrap.setAttribute('style', `display:block;position:static;inset:auto;overflow:visible;background:#fff;padding:0;width:${w}px`);
      clone.setAttribute('style', 'margin:0;box-shadow:none');
      wrap.appendChild(clone);

      const markup = new XMLSerializer().serializeToString(wrap);
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
        `<foreignObject width="100%" height="100%">` +
        `<div xmlns="http://www.w3.org/1999/xhtml">` +
        `<style>${css.replace(/</g, '&lt;')}</style>${markup}</div>` +
        `</foreignObject></svg>`;

      return loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
    }).then(async (img) => {
      const canvas = document.createElement('canvas');
      canvas.width = w * RASTER_SCALE;
      canvas.height = h * RASTER_SCALE;
      const ctx = canvas.getContext('2d');
      // JPEG kennt keine Transparenz: ohne diesen Anstrich wird alles
      // Ungezeichnete schwarz statt weiss.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      // Karten und Bilder direkt aufs Canvas — siehe Kommentar oben.
      await paintRasterLayers(sheetEl, ctx, RASTER_SCALE, label, problems);
      return {
        width: canvas.width,
        height: canvas.height,
        jpeg: dataUrlToBytes(canvas.toDataURL('image/jpeg', JPEG_QUALITY)),
      };
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Das Blatt liess sich nicht rastern (SVG-Bild wurde nicht geladen).'));
      img.src = src;
    });
  }

  function dataUrlToBytes(dataUrl) {
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // ---- JPEGs → PDF -------------------------------------------------------

  // Aufbau: 1 Katalog, 1 Seitenbaum, je Seite drei Objekte (Seite,
  // Inhaltsstrom, Bild-XObject), dazu Info-Wörterbuch und xref-Tabelle.
  // Die xref-Tabelle nennt Byte-Offsets, deshalb wird die Datei als Folge
  // von Uint8Arrays zusammengesetzt und die Länge in BYTES mitgezählt —
  // String.length wäre bei den JPEG-Daten schlicht falsch.
  function buildPdfBlob(pages, pageW, pageH, title, meta) {
    const enc = new TextEncoder();
    const chunks = [];
    let length = 0;
    const offsets = [0]; // Objekt 0 ist immer der freie Kopfeintrag

    const push = (data) => {
      const bytes = typeof data === 'string' ? enc.encode(data) : data;
      chunks.push(bytes);
      length += bytes.length;
    };
    const beginObject = (num) => { offsets[num] = length; push(`${num} 0 obj\n`); };

    // Objektnummern vorab vergeben: 1 Katalog, 2 Seitenbaum, 3 Info,
    // 4–9 die sechs Base-14-Fonts, danach je Seite Seite/Inhalt/Bilder
    // (variabel viele — Vektorseiten tragen 0..n Karten-XObjects, Raster-
    // seiten genau eines) — und ANS ENDE die Outline-Objekte. Alles ist vor
    // dem ersten Schreiben ausgerechnet, damit der Katalog vorwaerts
    // referenzieren kann.
    const CATALOG = 1, PAGES = 2, INFO = 3;
    const FONT_KEYS = Object.keys(PDF_FONTS);
    const fontId = (key) => 4 + FONT_KEYS.indexOf(key);
    let nextId = 4 + FONT_KEYS.length;
    const pageIds = pages.map((page) => {
      const ids = { page: nextId++, content: nextId++, images: [] };
      const imgCount = page.kind === 'vector' ? page.images.length : 1;
      for (let k = 0; k < imgCount; k++) ids.images.push(nextId++);
      return ids;
    });
    const pageObjNum = (i) => pageIds[i].page;
    const baseObjects = nextId - 1;

    // Bookmarks: Hauptblätter als oberste Ebene, die Anhangs-Blätter als
    // Kinder eines eingeklappten «Anhang»-Knotens.
    const bm = (meta && meta.bookmarks) || [];
    const tops = bm.filter((b) => !b.appendix);
    const apps = bm.filter((b) => b.appendix);
    const hasOutline = bm.length > 0;
    const OUTLINE_ROOT = baseObjects + 1;
    const topIds = tops.map((_, k) => OUTLINE_ROOT + 1 + k);
    const appNodeId = apps.length ? OUTLINE_ROOT + 1 + tops.length : null;
    const appIds = apps.map((_, k) => appNodeId + 1 + k);
    const totalObjects = hasOutline
      ? baseObjects + 1 + tops.length + (apps.length ? 1 + apps.length : 0)
      : baseObjects;

    push('%PDF-1.4\n');
    // Binär-Kommentar: sagt jedem Werkzeug, dass die Datei binäre Ströme
    // enthält und nicht zeilenweise umkodiert werden darf.
    push(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));

    beginObject(CATALOG);
    push(`<< /Type /Catalog /Pages ${PAGES} 0 R` +
      (hasOutline ? ` /Outlines ${OUTLINE_ROOT} 0 R /PageMode /UseOutlines` : '') +
      ` >>\nendobj\n`);

    beginObject(PAGES);
    push(`<< /Type /Pages /Count ${pages.length} /Kids [` +
      pages.map((_, i) => `${pageObjNum(i)} 0 R`).join(' ') + `] >>\nendobj\n`);

    beginObject(INFO);
    push(`<< /Title ${pdfTextString(title)} /Producer ${pdfTextString('Machbarkeitsstudie-Werkzeug')} ` +
      (meta && meta.author ? `/Author ${pdfTextString(meta.author)} ` : '') +
      (meta && meta.subject ? `/Subject ${pdfTextString(meta.subject)} ` : '') +
      (meta && meta.keywords ? `/Keywords ${pdfTextString(meta.keywords)} ` : '') +
      `/CreationDate (${pdfDate(new Date())}) >>\nendobj\n`);

    // Die sechs Base-14-Fonts: keine Einbettung noetig, jeder Viewer
    // bringt sie mit. WinAnsi, damit Umlaute und «»–„" als EIN Byte gehen.
    for (const key of FONT_KEYS) {
      beginObject(fontId(key));
      push(`<< /Type /Font /Subtype /Type1 /BaseFont /${PDF_FONTS[key].ps} ` +
        `/Encoding /WinAnsiEncoding >>\nendobj\n`);
    }

    const w = pageW.toFixed(4), h = pageH.toFixed(4);
    const fontsDict = FONT_KEYS.map((key) => `/${PDF_FONTS[key].res} ${fontId(key)} 0 R`).join(' ');
    pages.forEach((page, i) => {
      const ids = pageIds[i];
      const imgs = page.kind === 'vector'
        ? page.images
        : [{ name: 'Im0', jpeg: page.jpeg, width: page.width, height: page.height }];
      const xobjDict = imgs.map((im, k) => `/${im.name} ${ids.images[k]} 0 R`).join(' ');

      beginObject(ids.page);
      push(`<< /Type /Page /Parent ${PAGES} 0 R /MediaBox [0 0 ${w} ${h}] ` +
        `/Resources << /Font << ${fontsDict} >>` +
        (imgs.length ? ` /XObject << ${xobjDict} >>` : '') + ` >> ` +
        `/Contents ${ids.content} 0 R >>\nendobj\n`);

      // Rasterseite: das Bild füllt die Seite exakt. Vektorseite: der in
      // buildVectorPage gesetzte Inhaltsstrom.
      const content = page.kind === 'vector'
        ? page.content
        : `q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ\n`;
      beginObject(ids.content);
      push(`<< /Length ${enc.encode(content).length} >>\nstream\n${content}endstream\nendobj\n`);

      imgs.forEach((im, k) => {
        beginObject(ids.images[k]);
        push(`<< /Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.jpeg.length} >>\nstream\n`);
        push(im.jpeg);
        push('\nendstream\nendobj\n');
      });
    });

    // ---- Outline-Objekte -------------------------------------------------
    // /Dest [Seite /XYZ 0 <Seitenhöhe> null]: springt an den Seitenanfang.
    if (hasOutline) {
      const destOf = (b) => `[${pageObjNum(b.pageIndex)} 0 R /XYZ 0 ${h} null]`;
      const topSiblings = [...topIds, ...(appNodeId ? [appNodeId] : [])];
      beginObject(OUTLINE_ROOT);
      push(`<< /Type /Outlines /First ${topSiblings[0]} 0 R /Last ${topSiblings[topSiblings.length - 1]} 0 R ` +
        `/Count ${topSiblings.length} >>\nendobj\n`);
      tops.forEach((b, k) => {
        const id = topIds[k];
        const prev = k > 0 ? topIds[k - 1] : null;
        const next = k < topIds.length - 1 ? topIds[k + 1] : (appNodeId || null);
        beginObject(id);
        push(`<< /Title ${pdfTextString(b.title)} /Parent ${OUTLINE_ROOT} 0 R` +
          (prev ? ` /Prev ${prev} 0 R` : '') + (next ? ` /Next ${next} 0 R` : '') +
          ` /Dest ${destOf(b)} >>\nendobj\n`);
      });
      if (appNodeId) {
        beginObject(appNodeId);
        // Negativer /Count: der Anhang startet eingeklappt.
        push(`<< /Title ${pdfTextString('Anhang')} /Parent ${OUTLINE_ROOT} 0 R` +
          (topIds.length ? ` /Prev ${topIds[topIds.length - 1]} 0 R` : '') +
          ` /First ${appIds[0]} 0 R /Last ${appIds[appIds.length - 1]} 0 R /Count -${apps.length}` +
          ` /Dest ${destOf(apps[0])} >>\nendobj\n`);
        apps.forEach((b, k) => {
          beginObject(appIds[k]);
          push(`<< /Title ${pdfTextString(b.title)} /Parent ${appNodeId} 0 R` +
            (k > 0 ? ` /Prev ${appIds[k - 1]} 0 R` : '') +
            (k < appIds.length - 1 ? ` /Next ${appIds[k + 1]} 0 R` : '') +
            ` /Dest ${destOf(b)} >>\nendobj\n`);
        });
      }
    }

    const xrefOffset = length;
    let xref = `xref\n0 ${totalObjects + 1}\n0000000000 65535 f \n`;
    for (let n = 1; n <= totalObjects; n++) {
      xref += String(offsets[n]).padStart(10, '0') + ' 00000 n \n';
    }
    push(xref);
    push(`trailer\n<< /Size ${totalObjects + 1} /Root ${CATALOG} 0 R /Info ${INFO} 0 R >>\n` +
      `startxref\n${xrefOffset}\n%%EOF\n`);

    return new Blob(chunks, { type: 'application/pdf' });
  }

  // Textwerte als UTF-16BE-Hexstring. Umlaute in einem literalen (…)-String
  // wären PDFDocEncoding und kämen im Dateititel falsch an.
  function pdfTextString(s) {
    let hex = 'FEFF';
    for (const ch of String(s)) {
      const cp = ch.codePointAt(0);
      if (cp > 0xFFFF) {
        const v = cp - 0x10000;
        hex += (0xD800 + (v >> 10)).toString(16).padStart(4, '0').toUpperCase();
        hex += (0xDC00 + (v & 0x3FF)).toString(16).padStart(4, '0').toUpperCase();
      } else {
        hex += cp.toString(16).padStart(4, '0').toUpperCase();
      }
    }
    return `<${hex}>`;
  }

  function pdfDate(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
      `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Nicht sofort freigeben: Safari bricht den Download ab, wenn die
    // Objekt-URL widerrufen wird, bevor er begonnen hat.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // Dateiname aus Adresse/Parzelle: alles, was in einem Dateinamen stört,
  // fliegt raus, Umlaute werden ausgeschrieben statt entfernt.
  function safeFilename(parts) {
    const base = parts.filter(Boolean).join('_')
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
      .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
      .replace(/[^\w.\-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    return base || 'Machbarkeit';
  }

  T.openSheetsAsPdf = openSheetsAsPdf;
  T.openPendingTab = openPendingTab;
  T.safeFilename = safeFilename;
})();
