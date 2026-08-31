// format.js — the two string helpers every rendering module needs, in one
// place. Loaded first; depends on nothing.
//
// Why a module for four lines: app.js, print.js and evidence.js each carried
// their own `esc`, and the copies had already drifted — app.js escaped the
// single quote, print.js did not. An escaping helper that means something
// slightly different depending on which file you are reading is exactly the
// duplication CLAUDE.md §1 exists to stop, and the drift direction (less
// escaping in the PDF path) is the unsafe one. Same for `fmt`, where one copy
// checked isFinite and the other didn't.
window.MachbarkeitTool = window.MachbarkeitTool || {};

(function () {
  // ---- Wie ein Grundstueck im Dokument heisst ---------------------------
  // EINE Quelle fuer den Namen einer Parzelle. Benutzt von Titelblatt,
  // Trennseite, Kopfzeile jedes Blatts, Kennwerte-Tafel, Bildschirm und
  // PDF-Dateinamen.
  //
  // Anlass (Export Zumikon 5030+5029+5028 vom 31.8.2026): jede Ausgabestelle
  // hatte ihre eigene Kette, und die Ketten waren nicht dieselben. Das
  // Deckblatt und die Trennseiten lasen das Adressregister
  // («Haldenstrasse 5a»), die Kopfzeilen der Innenseiten die EINGETIPPTE
  // Adresse («Haldenstrasse 5» — das bestehende Nachbarhaus) oder die nackte
  // Parzellennummer. Dasselbe Grundstueck trug im selben Dokument drei Namen;
  // welcher davon gilt, war fuer den Leser nicht entscheidbar.
  //
  // Reihenfolge: Adressregister (GWR) zuerst, dann die eingetippte Adresse,
  // zuletzt «Parzelle NNNN». Das Register geht VOR der Eingabe, weil die
  // Eingabe nur zur Parzelle fuehrt, nicht zu ihrer Adresse: wer
  // «Haldenstrasse 5» sucht, landet auf Parzelle 5030 — deren Wohnhaus aber
  // anders heissen kann. Erfunden wird nie etwas: liefert das Register keine
  // Hausnummer und wurde keine eingetippt, steht ueberall «Parzelle NNNN» —
  // nie eine Mischung aus beidem.
  //
  // `r` ist eine Auswertung aus analyse(): { selection: [...], anchor }.

  // Die Parzellennummern einer Auswertung, in Auswahlreihenfolge.
  function parzellenNummern(r) {
    return r.selection.map((p) => p.parcelNumber || p.egrid).join(' + ');
  }

  // Die Adresse, oder null — NICHT die Parzellennummer als Ersatz. Wer den
  // Unterschied braucht (etwa um «· Parzelle NNNN» nur dann anzuhaengen,
  // wenn davor wirklich eine Adresse steht), fragt hier.
  function adresseVon(r) {
    const ausRegister = r.selection
      .map((p) => (p.adressen && p.adressen.label) || null)
      .filter(Boolean);
    if (ausRegister.length) return ausRegister.join(' \u00b7 ');
    return (r.anchor && r.anchor.address) || null;
  }

  // Der Name, unter dem das Grundstueck im Dokument erscheint.
  function betreffVon(r) {
    return adresseVon(r) || `Parzelle ${parzellenNummern(r)}`;
  }

  // Wie betreffVon, aber mit der Parzellennummer dahinter — fuer Tabellen
  // und Uebersichten, wo die Zeile beides zugleich leisten muss: benennen
  // und zuordnen. Ohne Adresse bleibt es bei der Nummer allein, damit nicht
  // «Parzelle 5030 \u00b7 Parzelle 5030» entsteht.
  function grundstueckLabel(r) {
    const a = adresseVon(r);
    return a ? `${a} \u00b7 Parzelle ${parzellenNummern(r)}` : `Parzelle ${parzellenNummern(r)}`;
  }

  // Absender des Exports: Titelblatt-Signatur und /Author der PDF-Metadaten.
  // EINE Konstante statt eines im Blattaufbau vergrabenen Strings — wer das
  // Werkzeug unter eigenem Namen nutzt, aendert genau diese Zeile.
  window.MachbarkeitTool.ABSENDER = 'Ivan Bagaturia';

  // Version des Werkzeugs, wie sie im PDF-Dateinamen und auf dem Titelblatt
  // des Exports erscheint. Hier, weil format.js als erstes Modul laedt und
  // sowohl js/app.js (Dateiname) als auch js/ui/print.js (Titelblatt) sie
  // brauchen. Bei inhaltlichen Aenderungen am Export hochzaehlen — zwei
  // Studien mit verschiedenen Zahlen duerfen nicht denselben Namen tragen.
  // v1.1: Umbau auf A4 quer, neue Blattfolge (Verkaufsdokument), Bookmarks.
  // v1.2: Vektor-Satz — waehlbarer Text statt Seiten-JPEGs.
  // v1.3: Berichtspruefung Multi-Parzellen — eine Adressquelle, Areal-Zeile
  //       als Zahl, gemeinsamer Anhang statt dreifacher Wiederholung.
  window.MachbarkeitTool.WERKZEUG_VERSION = 'v1.3';

  // Every user- and API-sourced string passes through here before innerHTML.
  // Escapes the single quote too, so a value is safe in a single-quoted
  // attribute as well as in text — the strictest of the former copies.
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // Fixed decimals for display only — never for a value that is computed on
  // (CLAUDE.md §4: rounding happens once, at display time). Non-finite input
  // is passed through as its own text rather than becoming "NaN.0".
  function fmt(n, digits = 1) {
    return typeof n === 'number' && isFinite(n) ? n.toFixed(digits) : String(n);
  }

  // Thousands-separated whole numbers (Swiss locale) — costs, volumes.
  function fmtInt(n) {
    return typeof n === 'number' && isFinite(n) ? Math.round(n).toLocaleString('de-CH') : String(n);
  }

  window.MachbarkeitTool.parzellenNummern = parzellenNummern;
  window.MachbarkeitTool.adresseVon = adresseVon;
  window.MachbarkeitTool.betreffVon = betreffVon;
  window.MachbarkeitTool.grundstueckLabel = grundstueckLabel;
  window.MachbarkeitTool.esc = esc;
  window.MachbarkeitTool.fmt = fmt;
  window.MachbarkeitTool.fmtInt = fmtInt;
})();
