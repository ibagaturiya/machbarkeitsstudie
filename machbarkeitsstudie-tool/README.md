# Machbarkeitsstudie — Kanton Zürich

Local, single-user tool. Address in → buildable volume out, with sources and
open questions flagged. Wohnzonen only. Zone data covers the whole canton;
the commune-specific rules on file are Zürich and Zumikon (see "Adding
another commune").

## Running it

```
python3 serve.py
```

Then open <http://localhost:8000>.

Use `serve.py`, not `python3 -m http.server`. Same thing with caching turned
off — there's no build step here, so nothing else invalidates edited JS/JSON
in the browser, and stale files fail silently and confusingly.

Opening `index.html` directly (`file://`) does **not** work: browsers block
`fetch()` from `file://`, and the rules table is loaded by absolute path.

## How it works

1. Type an address → the parcel is resolved and analysed immediately.
2. The map shows that parcel (blue). Click any neighbouring parcel to add it
   (click again to remove). Results recompute on every change.
3. **Parcels that touch are treated as one parcel**: unioned into a single
   shape, one combined area, one outer Grundabstand ring, normal zone rules.
4. Review on screen, then "PDF exportieren" for an A3 print.

## PDF export

"PDF exportieren (A3)" builds a separate A3 landscape document — six sheets,
one topic each — and prints that, rather than printing the web page:

1. **Übersicht** — headline result, key figures, situation plan
2. **Volumetrie** — the full derivation, and the isometric envelope
3. **Zonenplan** — zoning excerpt with parcel boundaries, zone facts
4. **Einschränkungen** — checklist, plus a map of the Waldabstand geometry
5. **Kostenschätzung** — estimate with a CHF 800/900/1000 per m³ range
6. **Quellen und Vorbehalte** — sources and limits

"Layout ansehen" renders the same sheets inline so the layout can be checked
without opening the print dialog. In the browser's print dialog, set margins
to **None** and enable background graphics; the sheets carry their own margins.

The 3D view is baked to a PNG at print resolution before printing (the
on-screen canvas is far too coarse for A3), and the export waits for every
map image to finish loading, so pages never come out with blank boxes.

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
- and the divided volumes, not the undivided area, drive every downstream
  number. The gaps cost real floor area and that loss is shown as its own line.

Worked example — Haldenstrasse 5 plus its two neighbours: buildable area
1233.7 m² but 99.6 m long, so 3 blocks of 26.5 m with 10 m gaps →
**1063.0 m²**, the gaps costing 170.7 m².

This is a deterministic split, **not a massing optimiser**. Equal blocks on one
axis is the simplest lawful arrangement, not the best one; a real design would
place volumes differently and might recover some of the lost area. The point is
to report an area that *could* lawfully be built rather than one that could not.

## What this deliberately does not do

- **No Arealüberbauung mode.** Merged parcels are computed as one ordinary
  parcel. That is the conservative reading. If a merged site is ≥4000 m² and
  otherwise qualifies under Art. 6 E-BZO, real Arealüberbauung rules (Art. 7)
  allow a *significantly* higher Ausnützungsziffer — W3 goes 90% → 120%, and
  more floors/height. The numbers are already in
  `data/bzo-zurich-wohnzonen.json` (`arealueberbauung_*` fields) and the
  cantonal distance research is in `data/kantonale-abstandsvorschriften.json`,
  but nothing reads them. **So for large merged sites this tool under-reports
  what is buildable.** Worth revisiting if that case comes up.
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
3. Register it in `GEMEINDE_FILES` at the top of `js/rules.js`.

Use `null` (not `0`) for a rule the commune doesn't have — Zumikon has no
Grünflächenziffer, and `null` makes the tool skip that constraint instead of
treating it as 0 %.

Currently on file: **Zürich** (E-BZO draft) and **Zumikon** (BZO 2019). Any
other commune resolves its zone fine but then errors with a clear message
rather than guessing a setback.

Two commune-specific things to watch:

- **Height is not the same measurement everywhere.** Zürich's E-BZO uses
  *traufseitige Fassadenhöhe*, Zumikon uses *Gebäudehöhe*. The label shown in
  the output follows the commune's file; don't treat the numbers as comparable.
- **Directional setbacks aren't modelled.** Zumikon has a grosser and a
  kleiner Grenzabstand (Art. 17/18), where the large one applies to the
  south-facing side(s). The tool buffers uniformly with the small one and
  flags this — so for those zones the footprint shown is optimistic.

Also note the Sonderbauvorschriften / Gestaltungsplan and Denkmalpflege
checks use Stadt-Zürich datasets. Outside the city they report "nicht
geprüft" rather than a green PASS.

## Data and sources

- `data/bzo-zurich-wohnzonen.json`, `data/bzo-zumikon.json` — the
  commune-specific rules, each cross-checked against its source PDF.
  `paragraph_text` / `screenshot` fields are intentionally empty: filling
  those in by hand is a manual job, and the PDF falls back to showing the
  article reference alone.
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
