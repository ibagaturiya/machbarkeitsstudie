// evidence.js — the "Beleg" viewer: every legal value in the UI links here,
// and this renders the SOURCE PDF PAGE the value comes from, with the cited
// passage highlighted. The point is auditability: no number without the
// original document behind it, one click away.
//
// Rendering uses PDF.js (pinned CDN version, same pattern as Leaflet/turf/
// three). The library is lazy-loaded on first use so the main page doesn't
// pay for it. Highlighting works off the page's text items: items matching
// the provenance entry's `highlight` term (or the start of the quote) get a
// translucent marker drawn over the canvas. If nothing matches (scanned
// page, hyphenation), the viewer says so and shows the quote as text — it
// never silently pretends the passage isn't there.
window.MachbarkeitTool = window.MachbarkeitTool || {};

(function () {
  const esc = window.MachbarkeitTool.esc; // js/core/format.js
  const PDFJS_VERSION = '3.11.174';
  const PDFJS_URL = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.js`;
  const PDFJS_WORKER_URL = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.js`;

  let pdfjsPromise = null;
  function loadPdfJs() {
    if (pdfjsPromise) return pdfjsPromise;
    pdfjsPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PDFJS_URL;
      s.onload = () => {
        try {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
          resolve(window.pdfjsLib);
        } catch (e) { reject(e); }
      };
      s.onerror = () => reject(new Error('PDF.js konnte nicht geladen werden (CDN nicht erreichbar).'));
      document.head.appendChild(s);
    });
    return pdfjsPromise;
  }

  const docCache = new Map(); // file -> Promise<PDFDocumentProxy>


  function normalize(s) {
    return String(s).toLowerCase().replace(/\s+/g, ' ').replace(/[«»„“”"']/g, '').trim();
  }

  let overlay = null;
  let current = null; // { prov, pageNum }

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'evidence-overlay';
    overlay.innerHTML =
      '<div id="evidence-panel" role="dialog" aria-modal="true" aria-label="Beleg im Gesetzestext">' +
      '  <div id="evidence-head">' +
      '    <div id="evidence-title"></div>' +
      '    <div id="evidence-actions">' +
      '      <button type="button" id="evidence-prev" title="Vorherige Seite">‹</button>' +
      '      <span id="evidence-pageinfo"></span>' +
      '      <button type="button" id="evidence-next" title="Nächste Seite">›</button>' +
      '      <a id="evidence-open" target="_blank" rel="noopener">PDF öffnen</a>' +
      '      <button type="button" id="evidence-close">Schliessen</button>' +
      '    </div>' +
      '  </div>' +
      '  <div id="evidence-note"></div>' +
      '  <div id="evidence-canvas-wrap"><canvas id="evidence-canvas"></canvas></div>' +
      '  <div id="evidence-quote"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) hide(); });
    overlay.querySelector('#evidence-close').addEventListener('click', hide);
    overlay.querySelector('#evidence-prev').addEventListener('click', () => turnPage(-1));
    overlay.querySelector('#evidence-next').addEventListener('click', () => turnPage(1));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('open')) hide();
    });
    return overlay;
  }

  function hide() {
    if (overlay) overlay.classList.remove('open');
    current = null;
  }

  function turnPage(delta) {
    if (!current) return;
    const target = current.pageNum + delta;
    if (target < 1) return;
    renderPage(current.prov, target, /* highlightHere */ target === current.prov.page);
  }

  async function renderPage(prov, pageNum, highlightHere) {
    const o = ensureOverlay();
    o.classList.add('open');
    current = { prov, pageNum };
    o.querySelector('#evidence-title').innerHTML =
      `<strong>${esc(prov.article || '')}</strong>` +
      (prov.title ? ` — ${esc(prov.title)}` : '');
    o.querySelector('#evidence-open').href = `${prov.file}#page=${pageNum}`;
    o.querySelector('#evidence-quote').innerHTML = prov.quote
      ? `„${esc(prov.quote)}"` : '';
    const noteEl = o.querySelector('#evidence-note');
    noteEl.textContent = 'Lade Dokument…';

    let pdfjs, doc;
    try {
      pdfjs = await loadPdfJs();
      if (!docCache.has(prov.file)) docCache.set(prov.file, pdfjs.getDocument(prov.file).promise);
      doc = await docCache.get(prov.file);
    } catch (e) {
      docCache.delete(prov.file);
      noteEl.textContent = `Dokument konnte nicht geladen werden (${e.message || e}). Das Zitat unten bleibt massgebend; PDF: ${prov.file}`;
      return;
    }
    if (!current || current.prov !== prov || current.pageNum !== pageNum) return; // superseded
    const clamped = Math.min(Math.max(1, pageNum), doc.numPages);
    current.pageNum = clamped;
    o.querySelector('#evidence-pageinfo').textContent = `Seite ${clamped} / ${doc.numPages}`;

    const page = await doc.getPage(clamped);
    if (!current || current.prov !== prov || current.pageNum !== clamped) return;
    const canvas = o.querySelector('#evidence-canvas');
    const wrap = o.querySelector('#evidence-canvas-wrap');
    const baseViewport = page.getViewport({ scale: 1 });
    const cssScale = Math.min(2, Math.max(1, (wrap.clientWidth - 24) / baseViewport.width));
    const dpr = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: cssScale * dpr });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = `${viewport.width / dpr}px`;
    canvas.style.height = `${viewport.height / dpr}px`;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;

    // Highlight pass: mark every text item containing the search term.
    let matched = 0;
    if (highlightHere) {
      const terms = [];
      if (prov.highlight) terms.push(normalize(prov.highlight));
      if (prov.quote) terms.push(normalize(prov.quote).split(' ').slice(0, 4).join(' '));
      const textContent = await page.getTextContent();
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#ffd54f';
      for (const item of textContent.items) {
        const t = normalize(item.str);
        if (!t) continue;
        if (!terms.some((term) => term && (t.includes(term) || term.includes(t) && t.length > 3))) continue;
        // Item position: transform[4]/[5] are the baseline origin in PDF
        // space; convert through the viewport to canvas pixels.
        const tx = pdfjs.Util.transform(viewport.transform, item.transform);
        const fontH = Math.hypot(tx[2], tx[3]);
        const w = (item.width || 0) * (viewport.scale);
        ctx.fillRect(tx[4], tx[5] - fontH, Math.max(w, fontH * 2), fontH * 1.25);
        matched++;
      }
      ctx.restore();
    }
    noteEl.textContent = highlightHere
      ? (matched > 0
          ? `Zitierte Stelle auf dieser Seite markiert (${prov.article || ''}).`
          : 'Die zitierte Stelle konnte auf der Seite nicht automatisch markiert werden — massgebend ist das Zitat unten.')
      : 'Zum Vergleich geblättert — die zitierte Stelle liegt auf einer anderen Seite.';
  }

  // prov: { file, title, page, article, quote, highlight } — from
  // rules.js getProvenance(). Opens the modal on the cited page.
  function showEvidence(prov) {
    if (!prov || !prov.file || !prov.page) return;
    renderPage(prov, prov.page, true);
  }

  window.MachbarkeitTool.showEvidence = showEvidence;
})();
