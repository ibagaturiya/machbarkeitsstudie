# Machbarkeitsstudie — Kanton Zürich

Local, single-user tool. Address in → buildable volume out, with sources and
open questions flagged. Wohnzonen only. Zone data covers the whole canton;
the commune-specific rules on file are Zürich and Zumikon (see "Adding
another commune").

## Layout

The folder `machbarkeitsstudie-tool/` **is** the published site root — there is
no build step, so what you see here is byte-for-byte what the browser gets.

```
machbarkeitsstudie-tool/
├── index.html          ← the main HTML. The only page. ~240 lines of markup.
├── css/                ← all styling. Load order IS the cascade:
│   ├── tokens.css        colour + spacing vocabulary; nothing else
│   │                     anywhere may hardcode a UI colour
│   ├── components.css    Parkierung, Normkette, combobox, Gemeinde picker,
│   │                     result panels, Quellen, cost estimate
│   ├── layout.css        the one-page dashboard shell and breakpoints —
│   │                     deliberately overrides component geometry
│   └── print.css         the A3 document; the only place allowed mm/pt and
│                         fixed hex colours, because print has no theme
├── vendor/             ← Leaflet, Turf, Three — pinned and served from here,
│                         not from a CDN. Versions, checksums and the Three.js
│                         upgrade cliff are in vendor/README.md
├── js/
│   ├── core/           ← DETERMINISTIC. Same inputs + same data/*.json ⇒ same
│   │                     numbers. No network, no DOM. This is the layer
│   │                     tests/run-tests.mjs guards, and the layer CLAUDE.md
│   │                     §4 is written about.
│   │                     format · coordinates · rules · envelope ·
│   │                     grenzabstand · massing · parkierung · normkette
│   ├── sources/        ← EXTERNAL REGISTRIES. geo.admin.ch, maps.zh.ch,
│   │                     ogd.stadt-zuerich.ch, ÖREB. These can fail, lag or
│   │                     change under us — so a failure here surfaces as a
│   │                     flag or a `review`, never as a green PASS
│   │                     (REGELN.md §2).
│   │                     geocode · zone-lookup · oereb · parcel-geometry ·
│   │                     waldabstand · checklist
│   ├── ui/             ← DOM, canvas, SVG, Leaflet, the print document.
│   │                     viewer · floorplan · parcel-selector · print ·
│   │                     evidence · output
│   └── app.js          ← the orchestrator; loaded last
├── data/               ← legal values as JSON, each with `_provenance`
├── source/             ← the statute PDFs the provenance entries cite
├── tests/              ← run-tests.mjs (golden) + check-wiring.mjs
└── serve.py            ← the dev server
```

**Why this split and not "one folder per feature".** The line between `core/`
and `sources/` is the line between what a test can prove and what only the
internet can answer. Everything a Machbarkeitsstudie has to reproduce twice
lives in `core/`; everything that can be down at 4pm on a Friday lives in
`sources/`. Grouping by feature would put those two on the same shelf.

Scripts in `index.html` are plain `<script>` tags sharing
`window.MachbarkeitTool`, so **load order is load-bearing** — it is unchanged
from before the folders existed, and only the paths moved.

## Running it

**Hosted:** <https://ibagaturiya.github.io/machbarkeitsstudie/> — deployed
automatically from `main` by `.github/workflows/pages.yml` (the golden tests
must pass first). GitHub Pages caches assets for ~10 minutes, so a fresh push
can take a few minutes to appear.

**Locally (development):**

```
python3 serve.py
```

Then open <http://localhost:8000>.

Use `serve.py`, not `python3 -m http.server`. Same thing with caching turned
off — there's no build step here, so nothing else invalidates edited JS/JSON
in the browser, and stale files fail silently and confusingly.

Opening `index.html` directly (`file://`) does **not** work: browsers block
`fetch()` from `file://`, which the data files are loaded with.

**Verify before you push.** One command covers both halves — the wiring
(does `index.html` load the files that are actually on disk?) and the legal
arithmetic:

```
node tests/run-tests.mjs
```

Then start `serve.py` and look at the running app. Leaflet, Turf and Three are
served from `vendor/`, so the page shell, the styling and the 3D view all work
with the network off; only the registry lookups in `js/sources/` need it — and
they are meant to fail visibly (see `tests/check-wiring.mjs`).

## How it works

1. Type an address → the parcel is resolved and analysed immediately.
2. The map shows that parcel (blue). Click any neighbouring parcel to add it
   (click again to remove). Results recompute on every change.
3. **Parcels that touch are treated as one parcel**: unioned into a single
   shape, one combined area, one outer Grundabstand ring, normal zone rules.
4. Review on screen, then "PDF exportieren" for an A3 print.

**Parkierung** sits under the numbers table: the mandatory parking spaces
(Art. 26 BZO Zumikon, delegated by § 242 PBG) grow with the floor area and
have to go under the building — so past a certain size the garage, not the
Ausnützungsziffer, is what caps the volume. The tool says when that happens
and how many basement levels it would take; it never silently subtracts
anything. Area per space is a tool assumption and labelled as one. For Zürich
the rule is *not on file* (it lives in the city's Parkplatzverordnung, not the
BZO), so it reports "nicht prüfbar" rather than guessing (`js/core/parkierung.js`).

**Ablauf & Normkette** (collapsible panel, bottom of the left column) is the
audit trail for a single run: the live log while the analysis is fetching and
computing, then every step of the derivation with its legal level (Bund →
Kanton → Gemeinde → Privatrecht), its Rechtsgrundlage and the area it costs.
Press "Abspielen" — or click a step — to watch the buildable area shrink layer
by layer. It orders the finished result object; it never recomputes anything
(`js/core/normkette.js`).

## PDF export

The full-screen preview is a screen construction (`#print-doc.preview` is
`position: fixed` with `overflow: auto`) and is explicitly reset inside
`@media print`. Without that reset the browser prints only the slice that
happens to be visible — one page instead of the whole document, and a blank
one whenever the preview is scrolled to the grey gap between two sheets.
Verified with headless Chromium (`page.pdf()`): 1 page before, all sheets
after.

**"PDF exportieren"** composes an A3 landscape presentation — **one argument
per page**, each page carrying its plans *and its own sources line* (article +
page in the legal PDF) — and opens it as a full-screen preview:

1. **Übersicht** — headline result, key figures, situation plan
2. **Volumetrie** — the full derivation (anrechenbare Fläche → caps → GFA →
   § 255 Abs. 3 free storeys), and the isometric of the *built* massing
3. **Grundriss** — the buildable ground area, to scale
4. **Zonenplan** — zoning excerpt with parcel boundaries, zone facts
5. **Einschränkungen** — checklist, plus a map of the Waldabstand geometry
6. **Hinweise** — every simplification, written out (only when there are flags)
7. **Parkierung** — required spaces, their floor-area demand, and whether the
   garage — not the Ausnützungsziffer — is what binds the volume. Rechtswert
   (the number of spaces) and Werkzeug-Annahme (area per space) stated apart.
8. **Kostenschätzung** — estimate with a CHF 800/900/1000 per m³ range
9. **Nicht Gegenstand dieser Auswertung** — the scope boundary, named rather
   than left out: Altlasten, Naturgefahren, Lärm, Baugrund, Erschliessung,
   Standort; and Raumprogramm, Varianten, Nachhaltigkeit, Ertrag, Termine,
   Bestand. This export covers the *legal* part of SIA 112 Teilphase 21 — the
   first sheet says so ("Baurechtliche Machbarkeit"), and this sheet says what
   the rest of the phase still owes.
10. **Quellen und Vorbehalte** — sources and limits, with the full wording

**"PDF exportieren"** sits in the header next to **"Analysieren"** and does the
whole thing in one press — compose, rasterise, open. There is no preview step:
the document is built off-screen (class `exporting`, so it has a layout without
being visible) and the finished PDF opens in its own tab.

It writes a real PDF file and opens it in **its own tab, in
  the browser's PDF viewer** — whose own toolbar carries the download arrow,
  search and page numbers. No print dialog, no "Save as PDF" detour. Pages are
  exact A3 landscape (420 × 297 mm), one rasterised sheet each at ~190 dpi;
  a ten-sheet export lands around 5 MB. Written by `js/ui/pdf.js` with **no
  library**: the browser rasterises each sheet through an SVG `foreignObject`
  (so the page is laid out by the same engine that drew the preview — CSS
  grid, `columns`, `aspect-ratio` and `mix-blend-mode` all survive, which is
  exactly where html2canvas fails), and the PDF container itself is ~120 lines
  of object table and xref. Verified against macOS Quick Look / Preview, which
  is the same Core Graphics engine Safari uses.

  The tab is opened **synchronously in the click handler**, showing a waiting
  page, and navigated to the finished file some seconds later. Opening it
  afterwards would no longer count as user-initiated and Safari would block it
  as a popup. If it is blocked anyway, the file is downloaded instead and the
  status line says so — a finished export is never silently dropped.

  Known limitation: the viewer is fed a `blob:` URL, which carries no
  filename. The document title is in the PDF's `/Title`, but what the viewer's
  own download arrow suggests as a filename is up to the browser. Serving the
  file under a real name would need a service worker.
There is no longer a "Drucken" button, and with it went the only path to
**vector** (selectable) text — every page in the exported PDF is an image. The
browser's own PDF viewer can still print. `@media print` in `print.css` is kept
so Cmd+P on the app still yields the A3 sheets.

The PDF shows the **same building as the screen** (the massing model with the
chosen storeys — not the abstract legal hull, which used to overstate volume
and cost by a large factor on AZ-bound parcels). The 3D view is baked to a PNG
at print resolution, and the export waits for every map image to load.

## Evidence viewer ("Beleg")

Every legal value in the results table and the sources section carries a **§
button**. Clicking it opens the source PDF (PDF.js) at the cited page with the
passage highlighted — the provenance (document, page, article, quote) lives in
the `_provenance` blocks of the data files. Values with no legal citation are
explicitly listed as tool assumptions; the tool never invents a citation.

## Legal regime for Zürich (stricter-of)

Zürich runs under **two parallel regimes**: the in-force BZO 2016 and the
E-BZO draft (negative Vorwirkung, § 234 PBG — the draft binds only where
STRICTER). `rules.js` computes with the stricter value per parameter (each
zone's `bzo2016` block) and tags such values "BZO 2016" in the UI. In practice
that means the BZO 2016 **Gebäudehöhe** (e.g. 9 m in W2b vs. 10 m
Fassadenhöhe) and the **Mehrlängenzuschlag** (Art. 14 BZO 2016: +⅓ of the
facade length beyond 12 m) keep applying.

## Tests

```
node tests/run-tests.mjs
```

Golden regression tests over the legal arithmetic — every expected value is
hand-derived from the cited article (Zumikon W2/25 incl. § 255 Abs. 3 free
storeys, Zürich W2bI incl. Überbauungsziffer and stricter-of, forest deduction,
the "more land never less" invariant, null semantics, provenance completeness).
Run them before every commit.

**Step 0 is a wiring check** (`tests/check-wiring.mjs`, also runnable on its
own). Without a bundler nothing resolves a path until the browser does, so a
moved or renamed module fails at runtime as a silently missing script — and
the first symptom is usually a wrong number, not an error. The check asserts
three things:

1. every local `<script src>`/`<link href>` in `index.html` exists on disk;
2. every file in `js/` and `css/` is actually loaded — no orphans, no dead code;
3. no asset is fetched from a remote host, which is the offline guarantee
   `vendor/` exists to provide.

It runs first on purpose: if the browser never loads the module a test just
exercised, a green suite is a lie.

## Waldabstand

Unlike the other ÖREB restrictions, Waldabstand is **computed and subtracted**,
not just flagged. Two cantonal datasets are combined: `ogd-0152`
(Waldabstandslinie) and `ogd-0111` (Waldareal).

Deciding which side of the line may be built on is the hard part. The line
dataset carries a `wirksamkeit` attribute ('links' / 'rechts') recording which
side the restriction acts on, relative to the direction the line is digitised
in — so the restricted side is the one whose computed geometric side matches
that value. This was verified against a case where the answer is known
independently (Haldenstrasse 5: the strip nearest the forest comes out
'rechts' on a line whose wirksamkeit is 'rechts'; the buildable remainder
comes out 'links').

An earlier version instead asked "can this piece reach the forest without
crossing the line". That is wrong for any parcel that contains a patch of
forest itself — every point is then near forest, and whole parcels came out
100 % unbuildable. If the line cannot be resolved into two sides at all (it
stops inside the working area), the tool says so and subtracts only the
actual forest area, which is off-limits either way.

## Max. Gebäudelänge and the division into volumes

Communes cap how long a single building may be (Zumikon 35 m, Art. 17; Zürich
only in the two-storey W2b zones). The buildable area that comes out of the
setback and Waldabstand steps is an *area*, not a building — and on merged
parcels it is routinely longer than one building may be.

Where that happens the area is **divided into compliant volumes** rather than
reported as one impossible block:

- blocks of equal length, each within the limit, cut perpendicular to the long
  axis of the smallest enclosing rectangle (the measure the BZO itself
  prescribes — Zumikon Art. 18);
- separated by the cantonal **Gebäudeabstand**, which is the sum of both
  required Grenzabstände (§271 PBG) — 2 × Grundabstand for two ordinary
  buildings, so 10 m in Zumikon;
- the division determines only the **drawn Baukörper**. The reference area for
  Grünflächenziffer/Überbauungsziffer/Ausnützung stays the UNDIVIDED buildable
  area — the gaps are a placement matter, not a loss of entitlement. (The
  earlier behaviour, where the gaps permanently reduced the numbers, was the
  documented "Fehler A": adding a parcel could REDUCE the result. Fixed, and
  guarded by a regression test.)

This is a deterministic split, **not a massing optimiser**. Equal blocks on one
axis is the simplest lawful arrangement, not the best one; a real design would
place volumes differently and might recover some of the lost area. The point is
to report an area that *could* lawfully be built rather than one that could not.

## What this deliberately does not do

- **No Arealüberbauung mode.** Merged parcels are computed as one ordinary
  parcel. That is the conservative reading. If a merged site is ≥4000 m² and
  otherwise qualifies under Art. 6 E-BZO, real Arealüberbauung rules (Art. 7)
  allow a *significantly* higher Ausnützungsziffer — W3 goes 90% → 120%, and
  more floors/height. The tool now **flags the unused potential** (with the
  per-zone bonus figures) whenever a qualifying selection reaches 4000 m², but
  it does not compute the bonus. **So for large merged sites the reported
  number is the conservative Regelbauweise figure.**
- **Gewässerraum and Baulinien are flagged, not subtracted.** The official
  ÖREB cadastre is queried per parcel to say whether they apply; if they do,
  they're flagged for manual review rather than guessed at geometrically, so
  the footprint may be too generous in that case, never too small.
  (Waldabstand *is* computed — see above.)
- **No teardown/existing-building logic.** Every parcel is treated as empty land.
- **No optimistic scenario.** One realistic number, plus a checklist.
- **No massing optimisation.** The division into volumes above is a fixed
  heuristic; it does not search for the arrangement that yields the most
  floor area.
- **No CAD export** (v1.1 idea).

## Adding another commune

Zone and Grundmasse (Ausnützungsziffer, Vollgeschosse, Dach-/Untergeschosse,
Gebäudehöhe) come from the **cantonal** zoning dataset `ogd-0156`, which covers
every commune in Kanton Zürich — nothing to add there.

What the cantonal dataset does *not* carry is **Grenzabstand** and
**Grünflächenziffer**. Those only exist in each commune's own BZO text, and
without a Grenzabstand no footprint can be computed. So each commune needs a
small file:

1. Get the commune's BZO (the ÖREB extract for any parcel there links it).
2. Copy `data/bzo-zumikon.json` as a template, keyed by the canton's zone
   abbreviation (`typ_gde_abkuerzung`, e.g. `W2/25`).
3. Register it in `GEMEINDE_FILES` at the top of `js/core/rules.js`.

Use `null` (not `0`) for a rule the commune doesn't have — Zumikon has no
Grünflächenziffer, and `null` makes the tool skip that constraint instead of
treating it as 0 %.

Currently on file: **Zürich** (E-BZO draft) and **Zumikon** (BZO 2019). Any
other commune resolves its zone fine but then errors with a clear message
rather than guessing a setback.

Two commune-specific things to watch:

- **Height is not the same measurement everywhere.** Zürich's E-BZO uses
  *traufseitige Fassadenhöhe*, BZO 2016 and Zumikon use *Gebäudehöhe*. The
  label shown in the output follows the measure actually applied (under
  stricter-of the BZO 2016 Gebäudehöhe can govern); don't treat the numbers as
  interchangeable.
- **Directional setbacks ARE modelled.** Zumikon's grosser Grenzabstand
  applies to the most south-facing side — in W2/25 to the TWO most
  south-facing sides (Art. 18 Abs. 1) — via a differential inward offset; the
  primary facade is clickable on the plan. The remaining simplification
  (measuring along parcel edges instead of the building's bounding rectangle
  per Art. 18 Abs. 2 / § 22 ABV) errs on the strict side and is flagged.

Also note the Sonderbauvorschriften / Gestaltungsplan and Denkmalpflege
checks use Stadt-Zürich datasets. Outside the city they report "nicht
geprüft" rather than a green PASS.

## Data and sources

- `data/bzo-zurich-wohnzonen.json`, `data/bzo-zumikon.json` — the
  commune-specific rules, each cross-checked against its source PDF. Each file
  carries a `_provenance` block (document, page, article, quote, highlight
  term per parameter) that feeds the evidence viewer and the per-sheet sources
  lines of the PDF export. For Zürich, each zone additionally carries its
  `bzo2016` block for the stricter-of regime.
- `data/kantonale-abstandsvorschriften.json` — the cantonal norms the engine
  cites (§ 255/256/257/259 PBG incl. Abs.-3 free allowance, § 259 aPBG, § 260,
  § 262, §§ 270/271, § 281 aPBG, §§ 21/22 ABV, § 234 PBG), each with page and
  quote. Loaded by `rules.js`.
- Zone, Grundmasse, Waldabstandslinie and Waldareal come live from the
  cantonal open-data WFS (`ogd-0156`, `ogd-0152`, `ogd-0111`); parcel
  geometry from swisstopo; restrictions from the ÖREB cadastre.
- `source/` — the actual legal PDFs, with `source/README.md` explaining what
  each is used for and what's still unresolved.
- For Zürich the legal basis is the **E-BZO draft (Stand 6. Januar 2026)**,
  not yet formally adopted but already governing new Baugesuche via negative
  Vorwirkung (§234 PBG). For Zumikon it is the **BZO of 17.09.2019**, in
  force, but with a partial non-approval dated 1 April 2026 pending. Re-check
  both before relying on any output.

Not a substitute for a signed-off Machbarkeitsstudie or a Baugesuch.
