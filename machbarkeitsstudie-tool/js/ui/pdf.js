// pdf.js — schreibt aus den fertigen A3-Blättern eine echte PDF-Datei und
// gibt sie als Download aus. Ohne Druckdialog: ein Klick, die Datei liegt
// im Download-Ordner.
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
//      müssen vorher als data:-URI eingebettet werden (wms.geo.admin.ch
//      liefert `access-control-allow-origin: *`, geprüft 2026-08-27).
//   2. Ein Canvas mit fremdem Bild wäre "tainted" und toDataURL würde
//      werfen. Nach dem Einbetten sind alle Bilder gleicher Herkunft, damit
//      entfällt das Problem — deshalb ist Schritt 1 keine Kosmetik.
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

  // host      — das #print-doc-Element mit den fertigen .sheet-Kindern
  // filename  — Dateiname ohne Endung
  // onProgress(i, n) — für die Fortschrittsanzeige am Knopf
  async function exportSheetsAsPdf(host, filename, onProgress) {
    const sheets = [...host.querySelectorAll('.sheet')];
    if (!sheets.length) throw new Error('Kein Export-Dokument vorhanden.');

    const css = collectCss();
    const pages = [];
    for (let i = 0; i < sheets.length; i++) {
      if (onProgress) onProgress(i, sheets.length);
      pages.push(await rasteriseSheet(sheets[i], css));
      // Dem Browser zwischen den Blättern Luft lassen, sonst friert die
      // Vorschau während des Exports sichtbar ein.
      await new Promise((r) => setTimeout(r, 0));
    }
    if (onProgress) onProgress(sheets.length, sheets.length);

    const blob = buildPdfBlob(pages, A3_LANDSCAPE_PT.w, A3_LANDSCAPE_PT.h, filename);
    triggerDownload(blob, `${filename}.pdf`);
    return { pages: pages.length, bytes: blob.size };
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

  async function inlineImages(root) {
    const imgs = [...root.querySelectorAll('img')].filter((i) => i.src && !i.src.startsWith('data:'));
    await Promise.all(imgs.map(async (img) => {
      try {
        const res = await fetch(img.src, { mode: 'cors' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        img.src = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.onerror = () => reject(new Error('FileReader'));
          fr.readAsDataURL(blob);
        });
      } catch {
        // Eine einzelne Kachel, die nicht kommt, darf den Export nicht
        // kosten: das Bild verschwindet, das Blatt bleibt. Sichtbar als
        // leerer Kartenrahmen — nicht als stillschweigend fehlende Seite.
        img.removeAttribute('src');
      }
    }));
  }

  function rasteriseSheet(sheetEl, css) {
    const rect = sheetEl.getBoundingClientRect();
    const w = Math.round(rect.width), h = Math.round(rect.height);

    const clone = sheetEl.cloneNode(true);
    return inlineImages(clone).then(() => {
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
    }).then((img) => {
      const canvas = document.createElement('canvas');
      canvas.width = w * RASTER_SCALE;
      canvas.height = h * RASTER_SCALE;
      const ctx = canvas.getContext('2d');
      // JPEG kennt keine Transparenz: ohne diesen Anstrich wird alles
      // Ungezeichnete schwarz statt weiss.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
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

  T.exportSheetsAsPdf = exportSheetsAsPdf;
  T.safeFilename = safeFilename;
})();
