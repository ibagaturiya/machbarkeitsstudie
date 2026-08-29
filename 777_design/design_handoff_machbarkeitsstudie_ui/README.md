# Handoff: Machbarkeitsstudie Tool — UI Upgrade (dark, orange, iOS-glass on millimeter paper)

## Overview
A single-screen desktop UI for a Baurecht feasibility tool (Kanton Zürich) that answers one question: **what is the maximum legally buildable volume on a selected parcel?** The user types an address, selects parcels on a map, presses **ANALYSIEREN**, reads the result, and exports a PDF. There is no AI in the tool — everything is deterministic Python. The UI must therefore make the *pipeline and its legal provenance* visible: a terminal-style log, a § citation per value, and a derivation line for every number.

Target option: **3a** (top-most option in the design file). Options 2a, 1b, 1a in the same file are earlier explorations — reference only.

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes of the intended look and behavior, not production code to copy. The task is to **recreate this design inside the existing tool** (Leaflet map + three.js model + SVG plan + Python backend), using its own structure and libraries. Do not port the mock's fake SVG map/model: the real Leaflet map, the real three.js scene, and the real generated Situationsplan SVG replace those placeholders. Only the chrome, layout, type, color, and interaction model come from the mock.

`Machbarkeitsstudie UI v1 (3a final).dc.html` opens in any browser. `current-tool-screenshot.png` is the tool's state before the upgrade.

## Fidelity
**High-fidelity.** Colors, type sizes, radii, spacing, blur and shadow values are final and listed below. The parcel selection, the isometry orbit/pan/zoom, the hover-to-derivation behavior and all hover states are implemented in the mock and can be probed live. Map/model/plan geometry inside the mock is a placeholder drawing.

## Screen: Machbarkeitsstudie — one window, nothing hidden
**Purpose:** run and read a feasibility study without opening a single tab, drawer or dialog. Hard requirement: every element is visible at once; no tabs, no accordions, no modals.

**Frame:** 1720 px wide design width, ~1300 px tall. Root canvas = dark architect millimeter paper:
```css
background-color:#0e0f10;
background-image:
  linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),
  linear-gradient(90deg,rgba(255,255,255,.05) 1px,transparent 1px),
  linear-gradient(rgba(255,255,255,.018) 1px,transparent 1px),
  linear-gradient(90deg,rgba(255,255,255,.018) 1px,transparent 1px);
background-size:48px 48px,48px 48px,8px 8px,8px 8px;
padding:14px; display:flex; flex-direction:column; gap:12px;
```
Every region is a **floating panel** on that canvas — no shared dividers, 12 px gutters:
```css
border-radius:18px;
border:1px solid rgba(255,255,255,.09);
box-shadow:0 12px 34px rgba(0,0,0,.55);
background:rgba(20,20,20,.72);
backdrop-filter:blur(18px) saturate(150%);
overflow:hidden;
```
Panels that hold a drawing use an opaque `#141516` fill instead of the glass. Overlay title bars inside a panel must carry `border-radius:17px 17px 0 0` — a blurred child otherwise ignores the parent's corner clip.

**Panel stack (top to bottom):**
1. **Header** — 60 px. Brand block (orange fill `var(--acc)`, `#0c0c0c` text, `margin:7px 0 7px 7px; border-radius:12px`, "MACHBARKEIT" 800/13/.1em + "MAX. VOLUMEN · KT. ZÜRICH" 600/9 mono/.14em) · ADRESSE cell (label 600/9/.18em `#6e6c6a`, value 500/15 mono `#eceae8`, zone in accent) · AUSWAHL cell (selected parcel ids in accent + summed area) · **ANALYSIEREN** capsule button (accent fill, `#0c0c0c` text, 800/13 Archivo/.1em, `border-radius:999px; margin:9px 8px; width:186px`, label flush left, hover → `var(--acc2)`) · **PDF EXPORT** capsule (`#212121`, hover `color-mix(in srgb, var(--acc) 16%, transparent)` + accent text, width 150).
2. **KPI strip** — 5 equal cells, first tinted `color-mix(in srgb, var(--acc) 10%, transparent)`: MAX. VOLUMEN LEGAL 1761.9 m³ / GESCHOSSFLÄCHE (AZ) 361.4 m² / FUSSABDRUCK 498.4 m² / HÖHE · GEBAUT 9.8 m / NUTZBAR TOTAL 722.8 m². Kicker 600/9/.18em, value 500/25 mono, sub 400/10 mono `#8c8a88`.
3. **Body** — `grid-template-columns:460px 1fr 440px; gap:12px; height:1000px`.
   - **Left column** (`gap:12px`): map panel 392 px (title bar "PARZELLEN — KLICKEN ZUM WÄHLEN" + footer showing hover hint and `n Parzellen · area`); log panel filling the rest — 28 px filter bar (`alle 18 · 7 § Belege · 2 Warnungen · timings`), the log lines, and a QUELLEN · STAND footer (4 datasets with dates).
   - **Middle column**: **Isometrie** 612 px (largest element on screen) + **Situationsplan 1:500** filling the rest.
   - **Right column**: Kennwerte table, 4 groups (PARZELLE / ABZÜGE & FUSSABDRUCK / AUSNÜTZUNG / VOLUMEN & HÖHEN), columns `1fr 116px 68px` = Kennwert / Wert / Beleg. All 21 rows visible without scrolling.
4. **HERLEITUNG bar** — 38 px, `background:rgba(30,27,24,.74)`, label 600/9/.16em accent + live derivation text 500/11.5 mono.
5. **Status bar** — 30 px, `rgba(18,18,18,.62)`: `● lokal · python 3.12` (accent) · version · per-stage timings · dataset list · Bund · Kanton · Gemeinde · Privatrecht.

## Interactions & Behavior
- **Parcel select (map):** hover → fill `color-mix(in srgb, var(--acc) 14%, transparent)`, stroke `var(--acc2)` 1.8 px, label brightens to `#eceae8`, area label fades in; footer reads "Parzelle 5029 — klicken zum Hinzufügen/Entfernen". Click toggles membership in the selection; selected → fill accent 30 %, stroke accent 2.5 px, label 600/14 accent. Header AUSWAHL and map footer show ids joined by "+" and the summed area. Idle parcels stay visible: `fill rgba(255,255,255,.035)`, `stroke rgba(255,255,255,.3)` 1 px, `cursor:pointer`. In production these are the real Leaflet parcel polygons; the whole calculation should follow the selection.
- **Isometry orbit:** pointer drag = rotate (azimuth, 0.5°/px) + tilt (vertical drag, clamped 0.35–1.25); **Shift+drag** = pan; **wheel** = zoom (clamped 0.6–2.4, factor 1.08/0.93); ⟲ / ⟳ step ±15°; RESET restores rotation, tilt, zoom and pan. Readout: "Azimut 3° · Neigung 125% · 1.00×". Transform is `translate(px,py) scale(z) rotate(r*0.35deg) scaleY(tilt)` with `transition:transform .22s ease` while not dragging, `none` while dragging, `touch-action:none`, cursor grab/grabbing. In production this maps to OrbitControls on the real three.js scene.
- **Hover-to-derivation:** hovering any Kennwert row writes that value's formula into the HERLEITUNG bar (e.g. `1445.7 × 0.25 = 361.425 → 361.4 m² (bindendes Maximum)`), and tints the row `color-mix(in srgb, var(--acc) 9%, transparent)` with `border-radius:10px`. Every value carries this string server-side.
- **Rules overlays:** the Isometrie carries a "REGELN IM MODELL" checklist (Traufhöhe 6.5 m § 8 BZO, Gesamthöhe 9.8 m, 45°-Profil Attika Art. 31, AZ 0.25, Freibetrag UG § 255 Abs. 3, Baumassenziffer keine) and dimension lines; the Situationsplan carries "ABSTÄNDE & ABZÜGE" (Grundabstand 5.0 m Art. 21, Grenzabstand gross 10.0 m, Mehrlängenzuschlag +1.0 m Art. 22, Strassenabstand/Baulinie 6.0 m § 265 PBG, Gebäudeabstand Nachbar 12.9 m § 260 PBG, Waldabstand −4.2 m² WaG 17, Gebäudelänge 30.4/35 m Art. 9). Checks render `✓` in `#9ec98c`, assumptions/deductions in `#e9c78d`, non-applicable rules in `#6e6c6a`.
- **Buttons:** every interactive element gets a hover tint from the accent and a `:focus-visible { outline:2px solid var(--acc); outline-offset:2px }` ring.
- **ANALYSIEREN** runs the pipeline and streams log lines; **PDF EXPORT** renders the result set as a presentation-grade PDF.

## Log window (the reason the tool looks like this)
Grid `88px 30px 1fr`, `font:400 11px/1.35 "IBM Plex Mono"`, row hover `rgba(255,255,255,.05)` + `border-radius:10px`. Columns: timestamp `#5a5856`, kind badge, message. Kinds and colors:

| kind | badge | badge color | message color | example |
| --- | --- | --- | --- | --- |
| step | `run` | `#6e6c6a` | `#a9a7a4` | `geometry.solve buffer(−5.0 m) → 502.6 m²` |
| ok | `ok` | `#9ec98c` | `#d2ded0` | `check.length 30.4 × 19.4 m ≤ 35 m — eingehalten` |
| citation | `§` | `var(--acc)` | `#ffd3a1` | `PBG § 255 Abs. 3 — Freibetrag Dach-/Attika-/Untergeschoss` |
| warn | `!` | `#e9c78d` | `#f0dcc0` | `Geschosshöhe 3.3 m angenommen — nicht aus BZO ableitbar` |

Style: terse machine lines with short German notes. Emit one line per pipeline step with its ms, one per § that fires, one per assumption. Log must be complete and visible without scrolling at the design height (18 lines fit).

## Provenance model
Every Kennwert row carries: `label`, `value` (formatted, mono), `source` (dataset id or § reference — § references render in `var(--acc)`, plain sources in `#8c8a88`), `kind` (`GEHOLT` `#8c8a88` / `BERECHNET` `#ffbe63` / `GEPRÜFT` `#9ec98c` / `ANNAHME` `#e9c78d` / `ENTWURF` `#a9a7a4`), and `formula` (the derivation string for the HERLEITUNG bar). The run summary (`14 Regeln · 2 Annahmen · 0 Konflikte · 1.84 s`) is computed from those kinds, not typed.

## State Management
- `selection: Set<parcelId>` — drives the whole calculation, the header AUSWAHL and the map footer.
- `hoveredParcel: parcelId | null`.
- `camera: { azimuth, tilt, zoom, pan:{x,y}, dragging }`.
- `hoveredRow → derivation: string` for the HERLEITUNG bar.
- `run: { lines[], timings, rulesChecked, assumptions, conflicts, version, datasets[] }` — filled by the analyse call.
- `accent: string` — theme color, see tokens.

## Design Tokens
Colors (CSS variables `--acc`, `--acc2` drive everything orange, including SVG strokes/fills; SVG uses `style="fill:var(--acc)"`, not the `fill` attribute):
- accent `#ff9d2e` (default; alternates `#ffb700`, `#ff7a1a`, `#f2542d`, `#d9a021`), accent-light `--acc2` `#ffbe63`
- tints: `color-mix(in srgb, var(--acc) 9% / 10% / 12% / 14% / 16% / 30% / 46%, transparent)`
- canvas `#0e0f10`, drawing panel `#141516`, glass `rgba(20,20,20,.72)`, bar glass `rgba(30,27,24,.74)`, status glass `rgba(18,18,18,.62)`, overlay box `rgba(28,28,28,.6)`
- text `#eceae8`, secondary `#a9a7a4`, tertiary `#8c8a88`, label `#6e6c6a`, faint `#5a5856`
- semantic: ok `#9ec98c`, warn/assumption `#e9c78d`, log-ok text `#d2ded0`, log-cite text `#ffd3a1`, log-warn text `#f0dcc0`
- lines: hairline `rgba(255,255,255,.07)`–`.1`, row rule `rgba(255,255,255,.045)`
Type: **Archivo** 400/500/600/800 for labels and headings (letter-spacing .1em–.18em on all-caps kickers, sizes 9–13 px), **IBM Plex Mono** 400/500/600 for every number, id, timestamp and log line (9–25 px). Numbers are always mono, never Archivo.
Radii: frame 24, panel 18, inner title bar 17 (top only), overlay box 16, brand block 12, rows 10, buttons/pills 999.
Shadows: frame `0 24px 60px rgba(0,0,0,.55)`, panel `0 12px 34px rgba(0,0,0,.55)`.
Spacing: canvas padding 14, gutter 12, panel padding 8–16, row padding 3 × 14.
Blur: `blur(18px) saturate(150%)` on glass, `blur(20px)` on overlay boxes.
Motion: transform `.22s ease`; color/background transitions `.15s`.

## Assets
No bitmap assets. Icons: Lucide (per design system) — the mock uses text glyphs (⟲ ⟳ ↑ ✓ §) as placeholders; replace with Lucide equivalents (`rotate-ccw`, `rotate-cw`, `check`, `arrow-up`) at 14–16 px, `stroke-width:1.5`. Fonts: Archivo + IBM Plex Mono, Google Fonts.

## Design system note
Derived from the **Modernist** system (Archivo, flush-left labels, visible grid, accent used sparingly). Two deliberate departures, requested by the tool's owner: dark ground with a yellow-orange accent instead of red on light, and rounded corners instead of the system's 0 px radius (iOS-style glass). Keep those departures.

## Files
- `Machbarkeitsstudie UI v1 (3a final).dc.html` — all four options; **3a is the target**, at the top of the file. Template markup is inline-styled; interaction logic is the `class Component` block at the bottom (`parcelDefs`, `parcelStyle`, camera handlers, row `formula` strings, log lines, Kennwerte groups).
- `current-tool-screenshot.png` — the tool before the upgrade, for diffing what moves where.
- `PROMPT.md` — paste-ready prompt for Claude Code.
