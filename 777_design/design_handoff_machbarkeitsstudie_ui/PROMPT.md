# Paste this into Claude Code

Drop the whole `design_handoff_machbarkeitsstudie_ui/` folder into your repo (or attach it in Claude Code), then paste the prompt below. Adjust the two bracketed lines.

---

Read `design_handoff_machbarkeitsstudie_ui/README.md` and open `design_handoff_machbarkeitsstudie_ui/Machbarkeitsstudie UI v1 (3a final).dc.html` in a browser to see the target design. Option **3a**, at the top of that file, is the design to implement — the other options (2a, 1b, 1a) are earlier explorations, ignore them.

This is my Machbarkeitsstudie tool: [describe your stack, e.g. "single-page index.html + vanilla JS, Leaflet map, three.js model, Python 3.12 backend that computes the zoning result and returns JSON"]. `current-tool-screenshot.png` shows what it looks like today.

Task: rebuild the frontend of my tool to match design 3a, using my existing map, model, plan and backend. Do NOT copy the HTML from the design file and do not reproduce its placeholder SVG map/model/plan — those are stand-ins for my real Leaflet map, my real three.js scene and my real generated Situationsplan. Take from the design: layout, panel structure, colors, typography, radii, shadows, blur, the log window, the provenance columns, the hover-to-derivation bar, and all interaction behavior described in the README.

Work in this order:

1. Read my current frontend and backend result structure first. Tell me what data the design needs that the backend does not return yet — specifically: per-value `source`, `kind` (GEHOLT / BERECHNET / GEPRÜFT / ANNAHME / ENTWURF) and `formula` derivation string, plus the pipeline log lines with timestamps, kinds and § citations, and the run summary (rules checked / assumptions / conflicts / timings / dataset versions). Propose the JSON shape before writing code.
2. Build the shell: millimeter-paper canvas, floating glass panels with the exact tokens from the README, header with ANALYSIEREN + PDF EXPORT, KPI strip, three-column body, HERLEITUNG bar, status bar. Everything visible at once — no tabs, no drawers, no modals, nothing behind a click.
3. Wire the real Leaflet map into the PARZELLEN panel with the hover and click-to-select/deselect behavior from the README (idle parcels always visible, hover tint, selected in accent, footer showing selection count and summed area). The whole calculation follows the selection.
4. Wire the real three.js scene into the ISOMETRIE panel as the largest element, with OrbitControls: drag to rotate, Shift+drag to pan, wheel to zoom, ⟲/⟳ ±15°, RESET. Keep the azimuth/tilt/zoom readout. Put the Situationsplan directly underneath it.
5. Implement the log panel from the real pipeline output, and the Kennwerte table with the Beleg column and hover-to-derivation.
6. Add the § rule overlays on the isometry and the plan (REGELN IM MODELL / ABSTÄNDE & ABZÜGE) from real computed values, not hardcoded ones.

Rules for the implementation:
- Every number in the UI renders in IBM Plex Mono; all labels and headings in Archivo.
- Orange is one CSS variable (`--acc`) plus a light step (`--acc2`); all tints are `color-mix()` off it, including SVG fills and strokes (use `style="fill:var(--acc)"`, not the `fill` attribute). I want to be able to change the accent in one place.
- No hardcoded values in the UI that the backend can compute. If a value is an assumption (e.g. Geschosshöhe 3.3 m), it must be tagged ANNAHME and appear as a warning line in the log.
- No AI, no fake progress, no invented legal reasoning: every § reference in the UI comes from the rule that actually fired.
- German UI copy, exactly as in the design.

Ask me before changing my calculation logic. Show me the plan before you start writing files.
