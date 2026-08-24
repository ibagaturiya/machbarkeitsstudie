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

**"PDF exportieren"** composes an A3 landscape presentation — **one argument
per page**, each page carrying its plans *and its own sources line* (article +
page in the legal PDF) — and opens it as a full-screen preview:

1. **Übersicht** — headline result, key figures, situation plan
2. **Volumetrie** — the full derivation (anrechenbare Fläche → caps → GFA →
   § 255 Abs. 3 free storeys), and the isometric of the *built* massing
3. **Grundriss** — the buildable ground area, to scale
4. **Zonenplan** — zoning excerpt with parcel boundaries, zone facts
5. **Einschränkungen** — checklist, plus a map of the Waldabstand geometry
6. **Kostenschätzung** — estimate with a CHF 800/900/1000 per m³ range
7. **Quellen und Vorbehalte** — sources and limits

Only inside the preview, next to **"Zurück"**, sits **"PDF speichern"** — it
hands the composed document to the print dialog. Set margins to **None** and
enable background graphics; the sheets carry their own margins.

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
3. Register it in `GEMEINDE_FILES` at the top of `js/rules.js`.

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
