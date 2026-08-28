// pdf.js — schreibt aus den fertigen A3-Blättern eine echte PDF-Datei und
// öffnet sie in einem eigenen Tab im PDF-Viewer des Browsers. Ohne
// Druckdialog: ein Klick, die Studie steht im Viewer, und dessen eigene
// Leiste hat den Download-Pfeil, die Suche und die Seitenzahlen.
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
// Bildschirm stand. Preis: die Seite ist ein Bild, der Text darin also nicht
// mehr markierbar. Wer zitierfähigen Text braucht, druckt weiterhin über
// «Drucken» (vektoriell, dafür mit Dialog).
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

  // A3 quer in PDF-Punkten (1 pt = 1/72 Zoll). Exakte Literale aus
  // 420 mm bzw. 297 mm — nicht gerundet, sonst driftet das Seitenformat.
  const A3_LANDSCAPE_PT = { w: (420 / 25.4) * 72, h: (297 / 25.4) * 72 };
  // 2× CSS-Pixel ≈ 192 dpi. Bei 3× wird die Datei drei- bis viermal so gross,
  // ohne dass man auf Papier etwas sieht.
  const RASTER_SCALE = 2;
  const JPEG_QUALITY = 0.85;

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
  async function openSheetsAsPdf(tab, host, filename, onProgress) {
    let blob;
    try {
      blob = await buildSheetsPdf(host, filename, onProgress);
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
      `Die A3-Blätter werden gerendert. Das dauert einige Sekunden;` +
      `<br>dieser Tab füllt sich von selbst.</div></body></html>`
    );
    tab.document.close();
    return tab;
  }

  // host      — das #print-doc-Element mit den fertigen .sheet-Kindern
  // filename  — Dateiname ohne Endung
  // onProgress(i, n) — für die Fortschrittsanzeige am Knopf
  async function buildSheetsPdf(host, filename, onProgress) {
    const sheets = [...host.querySelectorAll('.sheet')];
    if (!sheets.length) throw new Error('Kein Export-Dokument vorhanden.');

    const css = collectCss();
    const pages = [];
    const problems = [];
    for (let i = 0; i < sheets.length; i++) {
      if (onProgress) onProgress(i, sheets.length);
      pages.push(await rasteriseSheet(sheets[i], css, problems));
      // Dem Browser zwischen den Blättern Luft lassen, sonst friert die
      // Vorschau während des Exports sichtbar ein.
      await new Promise((r) => setTimeout(r, 0));
    }
    if (onProgress) onProgress(sheets.length, sheets.length);

    const blob = buildPdfBlob(pages, A3_LANDSCAPE_PT.w, A3_LANDSCAPE_PT.h, filename);
    blob.__pages = pages.length;
    blob.__problems = problems;
    return blob;
  }

  // ---- Blatt → JPEG ------------------------------------------------------

  // Alle Regeln aller Stylesheets als Text. Ein <link>-Stylesheet gleicher
  // Herkunft lässt sich auslesen; sollte eines je fremd sein, wirft der
  // Zugriff auf cssRules — dann lieber diese eine Datei überspringen als den
  // Export abbrechen.
  function collectCss() {
    return [...document.styleSheets].map((s) => {
      try { return [...s.cssRules].map((r) => r.cssText).join('\n'); }
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
      try {
        ctx.drawImage(source, d.x, d.y, d.w, d.h);
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
  function buildPdfBlob(pages, pageW, pageH, title) {
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
    // danach je Seite Seite/Inhalt/Bild.
    const CATALOG = 1, PAGES = 2, INFO = 3;
    const pageObjNum = (i) => 4 + i * 3;
    const contentObjNum = (i) => 5 + i * 3;
    const imageObjNum = (i) => 6 + i * 3;
    const totalObjects = 3 + pages.length * 3;

    push('%PDF-1.4\n');
    // Binär-Kommentar: sagt jedem Werkzeug, dass die Datei binäre Ströme
    // enthält und nicht zeilenweise umkodiert werden darf.
    push(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));

    beginObject(CATALOG);
    push(`<< /Type /Catalog /Pages ${PAGES} 0 R >>\nendobj\n`);

    beginObject(PAGES);
    push(`<< /Type /Pages /Count ${pages.length} /Kids [` +
      pages.map((_, i) => `${pageObjNum(i)} 0 R`).join(' ') + `] >>\nendobj\n`);

    beginObject(INFO);
    push(`<< /Title ${pdfTextString(title)} /Producer ${pdfTextString('Machbarkeitsstudie-Werkzeug')} ` +
      `/CreationDate (${pdfDate(new Date())}) >>\nendobj\n`);

    const w = pageW.toFixed(4), h = pageH.toFixed(4);
    pages.forEach((page, i) => {
      beginObject(pageObjNum(i));
      push(`<< /Type /Page /Parent ${PAGES} 0 R /MediaBox [0 0 ${w} ${h}] ` +
        `/Resources << /XObject << /Im0 ${imageObjNum(i)} 0 R >> >> ` +
        `/Contents ${contentObjNum(i)} 0 R >>\nendobj\n`);

      // Das Bild füllt die Seite exakt: Skalierung = Seitenmass, kein Rand.
      // Die Blätter bringen ihre Ränder selbst mit (16/18/12 mm in print.css).
      const content = `q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ\n`;
      beginObject(contentObjNum(i));
      push(`<< /Length ${enc.encode(content).length} >>\nstream\n${content}endstream\nendobj\n`);

      beginObject(imageObjNum(i));
      push(`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`);
      push(page.jpeg);
      push('\nendstream\nendobj\n');
    });

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
