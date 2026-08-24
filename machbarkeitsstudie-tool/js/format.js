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

  window.MachbarkeitTool.esc = esc;
  window.MachbarkeitTool.fmt = fmt;
  window.MachbarkeitTool.fmtInt = fmtInt;
})();
