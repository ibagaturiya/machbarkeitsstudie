# Machbarkeitsstudie Tool — Build Plan for Claude Code

## 0. What this is

A local, single-user tool that takes a Swiss (Zürich-only, v1) property address and outputs a quick feasibility PDF: the maximum legally compliant buildable volume (Volumetrie) on that parcel, with sources cited and open questions flagged. Real-world use case: the owner works at a real estate development firm and needs a fast, defensible "what's buildable here" PDF to show prospective land buyers, to justify asking price. Not a substitute for a signed-off Machbarkeitsstudie or Baugesuch; a fast, honest first-pass estimate.

**Core v1 feature, not optional:** the tool must also support merging multiple parcels into a single combined Arealüberbauung analysis (see section 11), since combining parcels changes the applicable rules significantly (higher Ausnützungsziffer, different boundary-distance treatment between merged parcels).

Read this whole document before writing any code. It reflects real decisions made over a long planning conversation. Do not silently reintroduce features listed under "Explicitly out of scope."

---

## 1. Architecture (non-negotiable constraints)

- **No backend, no database, no accounts.** Single local folder, opened in a browser. Single user (the owner), running it locally.
- **No build step, no bundler.** Plain HTML + JS with `<script>` tags. Use CDN-hosted libraries directly (Turf.js, Three.js). Keep it something that can be opened by pointing a browser at a folder, or served with a one-line static server command.
- **Language:** vanilla JS in the browser. No Python backend (an earlier plan used Python/Shapely; that is superseded, do not build it).
- **Geometry engine:** [Turf.js](https://turfjs.org/) — the JS equivalent of Shapely. Use it for buffering (setback offsets) and boolean difference/intersection (subtracting Waldabstand, Gewässerraum, Baulinien geometries from the buildable footprint).
- **3D/isometric viewer:** Three.js, to render the buildable envelope.
- **Suggested folder structure:**
  ```
  /machbarkeitsstudie-tool
    index.html
    /js
      app.js            (orchestration)
      geocode.js         (address -> coordinates + EGRID)
      zone-lookup.js      (coordinates -> zone label)
      rules.js            (hardcoded BZO numbers per zone, see section 4)
      parcel-geometry.js  (fetch parcel polygon, terrain)
      envelope.js         (turf.js setback/boolean/reconciliation logic)
      parcel-selector.js  (map click-to-select UI for merging parcels, see section 11)
      areal.js            (Arealüberbauung combined-geometry and bonus-rules logic, see section 11)
      checklist.js        (Tier A / Tier B checklist, see section 6)
      viewer.js           (three.js isometric render)
      output.js           (assemble the PDF/print view)
    /data
      bzo-zurich-wohnzonen.json  (hardcoded rules table, section 4)
    /tests
      cors_test.html       (already built, see section 8 — run this FIRST)
  ```

---

## 2. Step 0: verify before building anything else

**Before writing any feature code, verify that the target APIs are reachable directly from browser JS (CORS).** A finished `cors_test.html` already exists from the planning conversation and should be reused/extended: it fetches `api3.geo.admin.ch/rest/services/api/SearchServer` and `api3.geo.admin.ch/rest/services/height`, and displays PASS/FAIL directly on the page.

Important nuance already discovered: opening the HTML file directly (`file://`) may cause browsers to block `fetch()` regardless of whether the API itself allows CORS. Serve the folder locally instead:
```
python3 -m http.server 8000
```
then open `http://localhost:8000/tests/cors_test.html`.

**Do not proceed to build the zoning/parcel data pipeline until this test passes.** If it fails, the whole "no backend" architecture assumption breaks and needs to be revisited (e.g. a tiny local proxy server) before continuing.

---

## 3. Data pipeline (address in, envelope out)

Implement in this order, each step depends on the last:

1. **Geocode**: address string → coordinates (LV95) + EGRID, via `api3.geo.admin.ch/rest/services/api/SearchServer?searchText={address}&type=locations&origins=address`.
2. **Zone lookup**: query the zoning layer at those coordinates (Zürich's open BZO dataset, see section 7 for the dataset reference) → get a zone label back, e.g. `"W3"`.
3. **Rule lookup**: zone label → look up numeric rules from the hardcoded table in `/data/bzo-zurich-wohnzonen.json` (section 4). Do not attempt to parse BZO PDF text live; the table is hardcoded on purpose.
4. **Parcel geometry**: fetch the parcel polygon via Amtliche Vermessung at the same coordinates/EGRID. Allow an optional manual override: let the user drag individual polygon vertices afterward (stretch goal, not blocking v1).
5. **Terrain**: fetch elevation at the parcel via swissALTI3D (`api3.geo.admin.ch/rest/services/height`), to establish gewachsenes Terrain as the height reference point.
6. **Buildable footprint**: inward-buffer the parcel polygon by `Grundgrenzabstand` (turf.js `buffer` with negative distance).
7. **Subtract other restriction layers** from that footprint via turf.js boolean difference, each is its own geometry layer:
   - Waldabstand (forest-edge buffer)
   - Gewässerraum (water body buffer — often already included in the ÖREB extract itself)
   - Baulinien (road/other building lines)
8. **Reconcile footprint vs. Grünflächenziffer vs. GFA cap**: this is the important part, validated already in a Python prototype during planning for the two-way case (numbers in that test are illustrative, not from real geometry, and predate the Grünflächenziffer requirement, section 4 has the current three-way version):
   - `footprint_after_setback` = parcel buffered inward by Grundabstand (step 6/7 result).
   - `footprint_after_green_cap` = the largest footprint that still leaves at least `Grünflächenziffer_min` of the parcel area green, i.e. footprint ≤ `parcel_area * (1 - Grünflächenziffer_min)`. If `footprint_after_setback` already exceeds this, the green requirement is the binding one, not the setback, cap the footprint at this value.
   - `usable_footprint = min(footprint_after_setback, footprint_after_green_cap)`.
   - `max_gfa = parcel_area * Ausnuetzungsziffer`
   - `gfa_if_all_floors_built = usable_footprint_area * Vollgeschosse_max`
   - if `gfa_if_all_floors_built > max_gfa`: the **binding constraint is Ausnützungsziffer**. Report `achievable_floors = max_gfa / usable_footprint_area` (fractional, report as-is, e.g. "2.7 of 3 permitted floors").
   - else: the footprint (setback- or green-limited, whichever was smaller) is binding, full floor count is achievable.
   - **The tool must explicitly state which of the three constraints is binding in the output**, not just setback vs. Ausnützungsziffer as originally scoped. This is not a minor detail, it was the single most useful thing the Python prototype surfaced, and now has one more real candidate to check.
9. **Extrude** the footprint to `traufseitige Fassadenhöhe_max` for the 3D envelope (Three.js). Note this is the E-BZO's height metric, not the old BZO 2016 `Gebäudehöhe`, confirm the measurement definition (Art. 32/138 of the E-BZO) before treating it as a simple vertical extrusion height, it may need the roof-profile logic from those articles rather than a flat cap.
10. **Run the checklist** (section 6).
11. If a Grundbuchauszug form was filled in (section 5), factor any stated Dienstbarkeiten in as an additional footnote/constraint, do not attempt to auto-parse a PDF.

**Note:** this is the single-parcel pipeline. For merging multiple parcels into one Arealüberbauung, see section 11, it reuses this pipeline but changes several steps (a different Ausnützungsziffer table, different boundary-distance treatment, and a combined-geometry step).

---

## 4. Hardcoded rules data (2026 version, per explicit instruction)

**Updated per explicit instruction: use the 2026 version, not BZO 2016.** Source: the E-BZO ("Entwurf der Bau- und Zonenordnung der Stadt Zürich"), Art. 62 (Wohnzonen Grundmasse), dated 6 January 2026, fetched directly from the official PDF at `stadt-zuerich.ch` during planning.

**Important legal-status nuance, do not gloss over this:** this is formally still a **draft**, not a finalized law. It was publicly displayed 18 March to 1 June 2026 for consultation, was submitted to the canton for Vorprüfung in parallel, and still needs Gemeinderat adoption before it's formally `rechtskräftig`. However, under §234 PBG a **"negative Vorwirkung"** took effect the moment it went on public display: new Baugesuche are already assessed against these draft numbers wherever they're stricter than the old BZO 2016. That's why this is the version to use, it's the one that actually governs new permit decisions right now, even though it isn't formally final. Claude Code should re-check whether Gemeinderat has since formally adopted it (status may have advanced since this was written) and update the "data last verified" date accordingly.

Note the zone taxonomy itself changed, not just the numbers: several new intermediate zones exist now (W4b, W5b, W5c, W6) that didn't exist in BZO 2016.

**a. Zones W2bI, W2bII, W2bIII, W2, W3:**

| | W2bI | W2bII | W2bIII | W2 | W3 |
|---|---|---|---|---|---|
| Vollgeschosse max | 2 | 2 | 2 | 2 | 3 |
| anrechenbares Untergeschoss max | 1 | 1 | 1 | 1 | **0** |
| anrechenbares Dach-/Attikageschoss max | 1 | 1 | 1 | 1 | 1 |
| traufseitige Fassadenhöhe max (m) | 10 | 10 | 10 | 10 | 10.5 |
| Grundabstand min (m) | 5 | 5 | 5 | 5 | 5 |
| Gebäudelänge inkl. Klein-/Anbauten max (m) | 25 | 20 | — | — | — |
| Ausnützungsziffer max (%) | 40 | 40 | 45 | 60 | 90 |
| Überbauungsziffer Hauptgebäude max (%) | 22 | 22 | 25 | — | — |
| **Grünflächenziffer min (%)** | 60 | 60 | 55 | 50 | 50 |

**b. Zones W4b, W4, W5b, W5c, W5, W6:**

| | W4b | W4 | W5b | W5c | W5 | W6 |
|---|---|---|---|---|---|---|
| Vollgeschosse max | 4 | 4 | 5 | 5 | 5 | 6 |
| anrechenbares Untergeschoss | 0 | 0 | 0 | 0 | 0 | 0 |
| anrechenbares Dach-/Attikageschoss max | 1 | 1 | 1 | 1 | 1 | 1 |
| traufseitige Fassadenhöhe max (m) | 13.5 | 13.5 | 16.5 | 16.5 | 16.5 | 19.5 |
| Grundabstand min (m) | 5 | 5 | 5 | 5 | 5 | 5 |
| Ausnützungsziffer max (%) | 105 | 120 | 135 | 150 | 165 | 205 |
| **Grünflächenziffer min (%)** | 50 | 45 | 45 | 45 | 40 | 30 |

### Data schema: every hardcoded number needs its source text attached, not just a citation

The PDF (section 8) must show the actual paragraph that states each result, not a link or an article number alone, since the owner needs to visually verify the tool against the real source. That means `/data/bzo-zurich-wohnzonen.json` can't just store numbers, each rule needs a small bundle of source material next to it:

```json
{
  "W3": {
    "ausnuetzungsziffer_max": 90,
    "source": {
      "article": "Art. 62 lit. a, E-BZO",
      "version": "E-BZO Entwurf, Stand 6. Januar 2026",
      "paragraph_text": "<verbatim legal text goes here>",
      "screenshot": "<path to a zoning-plan excerpt / WMS image proving this parcel is W3, once available>"
    }
  }
}
```

**Explicit decision: this is filled in by hand for v1, not scraped or auto-extracted.** Claude Code should build the schema and the PDF rendering logic to display `paragraph_text` and `screenshot` wherever they're present, but leave the actual verbatim text and screenshots as a manual data-entry task for the owner to do afterward, not an automated extraction pipeline. Ship with the fields present but empty/placeholder is fine for a first pass, don't block on this.

**The BZO version used must also be visible as a standing element of the output, not just buried in a footnote.** Show it prominently (e.g. a header/subtitle line on the first page: *"Basis: E-BZO Entwurf, Stand 6. Januar 2026, Art. 62"*), in addition to the fuller caveat footnote already specified in section 8.

**Three real substantive changes vs. the old BZO 2016 numbers, all must be reflected in the pipeline, not just the data file:**

1. **W3's anrechenbares Untergeschoss dropped from 1 to 0.** A basement level that used to count toward the building is no longer creditable in W3 under the draft.
2. **The height metric changed name and definition, not just number**: BZO 2016 used `Gebäudehöhe max`. The E-BZO uses `traufseitige Fassadenhöhe max` (eave-side facade height), a different measurement method, not just a renamed field with the same meaning. Do not silently treat these as interchangeable when extruding the envelope, they need their own definition (per Art. 32/Art. 138 of the E-BZO, this is tied to how the roof profile and floor-to-floor heights are calculated), and this genuinely affects the extrusion logic in section 3, step 9.
3. **Grünflächenziffer (minimum green area ratio) is now an explicit numeric requirement per zone** (e.g. 50% for W3), and it directly competes with the buildable footprint, exactly like Grundabstand does. This was not accounted for in the original pipeline design and needs to be added as a third candidate binding constraint in section 3, step 8 (see the updated reconciliation logic below).

There is also a new **Kronenbedeckungsgrad** (minimum tree-canopy coverage) requirement per zone (Art. 53, e.g. 25% for W3), which is a site-landscaping constraint rather than a footprint constraint, add it to the Tier B checklist (section 6) rather than the envelope math, since whether it's satisfiable depends on actual existing trees on site.

Note: 1 Dach-/Attikageschoss is already included in the baseline for every zone. It is not an exception or bonus, do not treat it as one (this was a real mistake caught during planning).

---

## 5. Grundbuchauszug (private-law restrictions)

**v1: structured manual form, not automated PDF extraction.** Automated extraction is explicitly deferred to a later version; Dienstbarkeiten are free-text legal prose that varies by Notariat, unreliable to parse automatically, and the accuracy risk isn't worth it for v1.

Form fields (minimum):
- Does a Näherbaurecht exist? If yes: distance, direction/affected boundary.
- Does a Wegrecht exist? If yes: rough location/extent.
- Any other Dienstbarkeit affecting buildable area? Free text field.

Whatever is entered here should appear as a footnote/caveat in the output, not silently baked into the computed number.

---

## 6. Checklist (open/unresolved items) — replaces the "optimistic scenario"

**Important decision from planning: there is no "optimistic" scenario.** An earlier plan computed a second, higher number based on named exceptions (e.g. Mehrlängenzuschlag). This was deliberately dropped: a computed "optimistic" number reads as a promise even when labeled otherwise, which is counterproductive when the buyer is asking "what is actually feasible." Do not reintroduce it.

Instead, output **one realistic number**, plus a checklist of items that could affect it, split into two tiers, and the tool must visually distinguish these tiers rather than presenting them uniformly:

**Tier A — computed automatically (pass/fail/distance, no ambiguity):**
- Waldabstand: distance to nearest forest-edge geometry vs. the required minimum.
- Gewässerraum: usually already present in the ÖREB extract as a formal restriction with its own geometry.
- Baulinien: geometry-based, same pattern as Waldabstand.

**Tier B — existence detected automatically, content flagged for manual review:**
- Sonderbauvorschriften / Gestaltungsplan: check if the parcel falls inside one of these overlay zones (published as vector geodata alongside the Zonenplan). If yes, flag clearly: *"This parcel is covered by [name]. Its custom rules override the standard BZO numbers above and have not been read by this tool. Manual review required."*
- Ortsbildschutz / heritage protection: check against the cantonal Bauinventar / ISOS inventory datasets. If listed, flag: *"This parcel/building appears in [inventory]. Manual review required for what this restricts."*
- Kronenbedeckungsgrad (minimum tree-canopy coverage, new in the E-BZO, e.g. 25% for W3): whether this is satisfiable depends on actual existing trees on site, which the tool can't verify remotely. Flag as: *"This zone requires [X]% tree-canopy coverage. Not evaluated, requires a site visit or aerial imagery check."*

---

## 7. Data sources / APIs (starting references, verify current shape before relying on them)

- Federal geocoding + general search: `https://api3.geo.admin.ch/rest/services/api/SearchServer` (params: `searchText`, `type=locations`, `origins=address` for addresses, `origins=parcel` for parcels)
- Height/terrain: `https://api3.geo.admin.ch/rest/services/height?easting={E}&northing={N}` (swissALTI3D)
- Feature detail lookup: `https://api3.geo.admin.ch/rest/services/api/MapServer/{layer}/{feature_id}`
- API docs: `https://geoadmin.readthedocs.io/en/latest/services/sdiservices.html` and `https://docs.geo.admin.ch/access-data/search.html`
- Zürich's own BZO/zoning geodata (open data): dataset "kommunale Bau- und Zonenordnung (BZO)" on `data.stadt-zuerich.ch`, available as GeoJSON/Shapefile/DXF/GeoPackage, CH1903+/LV95 (EPSG:2056). This is the dataset to query for the zone label per parcel.
- Note found during planning: the geo.admin.ch API has changed shape before without much warning (a coordinate x/y swap was reported in a November 2025 release). Do not assume long-term API stability; print a "data last verified: [date]" line somewhere in the tool's output so staleness is visible rather than silent.

---

## 8. Output: the PDF

- **Workflow: preview first, PDF only on confirm.** Running the pipeline for an address must not immediately generate a PDF. Show all computed results on-screen first (the numbers, the binding constraint, the isometric render, the checklist), let the owner review them, and only generate/export the actual PDF after an explicit confirm/export action (e.g. a button click). This matters because it's the review step where a wrong zone assumption or a stale number gets caught before it goes out as a document.
- **Format:** A3. Generation mechanism deferred to implementation (browser `window.print()` with `@page` CSS, or a JS PDF library like jsPDF) — the owner has done this successfully in JS before on another project, so treat as a solved problem, not a design question.
- **Must include:**
  1. The realistic scenario: buildable footprint, achievable floors, GFA, height, and which constraint is binding (setback vs. Ausnützungsziffer).
  2. An isometric render of the envelope (Three.js).
  3. **Sources and decisions, shown as actual text, not just a citation.** Every number in the output must show the real paragraph that states it (from the `paragraph_text` field in section 4's data schema), not just "BZO Art. 62" as a label. A link or article number alone is not enough, the owner needs to be able to read the actual rule right there and check it against the number. Where `paragraph_text` hasn't been filled in yet (see section 4), show the article reference alone as a fallback, don't block the PDF on it being complete.
  4. A prominent statement of which BZO version was used (see section 4's "data schema" note), not just a footnote, this should be visible as soon as someone opens the document.
  5. Real source map images embedded and scaled to fit A3: not a screenshot of a webpage, but an actual WMS `GetMap` request to the official rendering service (same family of API as the geometry data), for the parcel's bounding box, at whatever resolution the page needs. This should specifically include a zoning-plan excerpt that shows the parcel and its zone label, this is the visual proof behind the zone-detection step, not just a generic location map. Where a per-rule `screenshot` (section 4) exists, show it next to that rule.
  6. The Tier A / Tier B checklist (section 6), visually distinguished.
  7. Footnotes: *"Source: E-BZO (Entwurf), Art. 62, Stand 6 January 2026. Formally still a draft under negative Vorwirkung since 18 March 2026, not yet adopted by Gemeinderat, re-verify status before relying on this for anything beyond a rough estimate."* and *"Please double-check zone assignment"* (zone-boundary edge case caveat).
  8. **Optional last page:** a rough cost estimate, `CHF/m3 x envelope volume`. Use one deliberately chosen benchmark number appropriate for normal-standard Zürich residential construction (not a generic/placeholder figure), and label it clearly as a rough estimate.

---

## 9. Test case

Address used throughout planning: **Imbisbühlstrasse 57, 8049 Zürich** (note: commonly spelled with a single "s" — "Imbisbühlstrasse" — double-check spelling when geocoding, an earlier attempt used the double-s spelling "Imbissbühlstrasse").

Zone was **assumed as W3 as a placeholder during planning and was never actually verified** (the planning conversation's sandbox couldn't reach the live geo APIs). Claude Code has real internet access — confirm the actual zone for this address as one of the first real end-to-end tests, don't assume W3 is correct.

---

## 10. Explicitly out of scope for v1 — do not build these

- Optimistic/exception-based second scenario (dropped, see section 6).
- Automated Grundbuchauszug PDF extraction (deferred, manual form only, see section 5).
- Teardown/redevelopment sites, existing structures, Bestandsschutz — real scenario for this use case, but explicitly deferred as too complex for now. Assume every parcel is empty land.
- Variant comparison (multiple massing options side by side) — undecided, not needed yet.
- Cantons other than Zürich, or communes other than the one(s) the owner actually needs — do not build a general cantonal-law parser.
- Photorealistic terrain rendering — explicitly rejected as unnecessary.
- Any kind of accounts, multi-user support, or server/database — single local user only.
- A general massing-optimization/generative-design engine. If multiple massing strategies are ever wanted, implement a small fixed menu of 2-4 deterministic heuristics (e.g. "full box to max height," "stepped with Attikageschoss set back"), not a search/optimization algorithm — that's a different, much larger engineering problem (this is the core product of companies like Autodesk Forma and TestFit) and out of scope.
- CAD export was agreed to be worth adding, but was not scoped in detail during planning — treat as a v1.1 nice-to-have (e.g. export the footprint/envelope as DXF), not a launch blocker.

---

## 11. Parcel merging (Arealüberbauung)

A second mode, extending the single-parcel pipeline in section 3, for checking whether combining several parcels into one Arealüberbauung is worthwhile, and where the resulting mass should sit (e.g. the "middle parcel of three in a row has no neighbor-distance problem" case).

### UI flow

1. Same as before: ask for an address, resolve it to a parcel.
2. Show that parcel highlighted on the map. Grey out everything else, but keep other parcels visible and clickable.
3. Clicking inside any other visible parcel adds it to the selection (highlighted like the first one). Clicking an already-selected parcel again removes it.
4. **No adjacency requirement is enforced by the tool** — this was an explicit decision, the user can select any parcels, touching or not. Still, since real Arealüberbauung law requires a genuine contiguous area, if the selected parcels don't actually touch (check via turf.js, e.g. `booleanIntersects` or a small tolerance distance check), show a visible warning in the output: *"Selected parcels are not contiguous. This does not qualify as a single Areal under Art. 6 E-BZO as selected."* Don't block the calculation, just don't let it pretend to be legally valid if it isn't.
5. Once selection is done (an explicit "analyze as one Areal" action, consistent with the existing preview-before-PDF pattern in section 8), run the combined pipeline below.
6. **Output shows only the merged result, not a standalone-vs-merged comparison** (explicit decision). If the person wants to compare, they re-run the single-parcel tool separately.

### Legal basis (E-BZO Art. 6–9, already fetched during planning, use these directly)

- **Art. 6**: Arealüberbauung is only allowed if combined Arealfläche ≥ 4000 m², and only in Wohnzonen, Zentrumszonen, or Zonen für öffentliche Bauten. **Explicitly excluded**: zones W2bI, W2bII, W2bIII, W2. If any selected parcel is in one of these excluded zones, flag it clearly, don't silently drop it from the calculation.
- **Art. 7(1)**: Arealüberbauung gets a **higher Ausnützungsziffer** than the standalone table in section 4. Use this table instead of the standalone one once parcels are merged:

  | Zone | W3 | W4b | W4 | W5b | W5c | W5 | W6 |
  |---|---|---|---|---|---|---|---|
  | Ausnützungsziffer max (%), Arealüberbauung | 120 | 130 | 150 | 160 | 180 | 200 | 240 |

  (Compare to standalone: W3=90, W4b=105, W4=120, W5b=135, W5c=150, W5=165, W6=205, from section 4, this is a real, significant bonus, worth surfacing prominently in the output since it's the main reason someone would bother merging parcels.)

- **Art. 7(2)**: Arealüberbauung also allows **more floors and height** than the standalone table:

  | | W3 | W4b | übrige Zonen (other zones) |
  |---|---|---|---|
  | Vollgeschosse max | 4 | 5 | 7 |
  | traufseitige Fassadenhöhe max (m) | 13.5 | 16.5 | 25 |

- **Art. 8**: an *additional* bonus (not automatic, must be explicitly opted into, this is a real business commitment, not a passive site property) if Arealfläche ≥ 6000 m² **and** the extra floor area is used exclusively for preisgünstiger Wohnraum (affordable housing, §49b PBG): +15 percentage points for W3/W4b, +20 percentage points for other zones. Implement this as an explicit checkbox in the UI ("commit to affordable housing for the bonus area, yes/no"), never apply it automatically just because the area qualifies.
- **Art. 9**: within an Arealüberbauung, **cantonal** distance rules (kantonale Abstandsvorschriften) apply for Grenz- and Gebäudeabstände, not the communal Grundabstand from section 4. **This is the mechanism behind the "middle parcel" effect.** Important: this does not necessarily mean zero distance internally, it means a *different, cantonal* rule applies. **Known data gap: the actual kantonale Abstandsvorschriften figures have not been sourced yet.** Claude Code needs to find these (they live in the kantonales PBG/ABV, referenced generally in section 3's rule-lookup step) before this part of the calculation can be trusted, do not guess a number or assume zero.

### Combined geometry computation

1. **Union** all selected parcel polygons into one combined shape (turf.js `union`).
2. **Outer boundary vs. internal boundary**: the outer boundary of the unioned shape (facing actual outside neighbors or streets) gets the setback treatment. Edges that were previously between two merged parcels are internal and use the cantonal rule from Art. 9 above (see the data gap noted there), not the communal Grundabstand.
3. **Multi-zone handling (sensible default, since the user wasn't sure)**: intersect the combined polygon against the zoning layer to get per-zone sub-areas. Compute each sub-area's Ausnützung entitlement using its own zone's Arealüberbauung numbers (the Art. 7(1) table above), then sum for the total combined GFA cap. **Show each zone's contribution separately in the output**, not just the summed total, this keeps the "sources and decisions" audit trail intact and makes the simplification visible rather than hidden. Flag this whole multi-zone case as worth a manual sanity check, real Arealüberbauung practice may have nuances beyond a simple area-weighted split.
4. **Grünflächenziffer**: apply against the total combined parcel area, using the same per-zone-weighted approach as GFA if the Areal spans multiple zones.
5. Otherwise, reuse the same reconciliation logic as section 3 step 8 (setback/green-cap vs. GFA cap, report the binding constraint), just against the combined geometry and the Arealüberbauung numbers instead of the standalone ones.

### What this does NOT need to handle in v1

- Ownership/legal agreement between parcel owners to actually combine them, that's a real-world precondition, not something the tool checks.
- The Art. 8 affordable-housing bonus being applied automatically, it's opt-in only (see above).
- Non-Wohnzonen Arealüberbauung rules (Zentrumszonen, Zonen für öffentliche Bauten) beyond what's quoted above, add if it comes up, don't pre-build it.

---

## 12. Definition of done for v1

Given the test address (or a real one, once the zone is confirmed): the tool takes an address as input, automatically resolves zone and parcel geometry, computes the realistic buildable envelope with the binding constraint clearly stated, runs the Tier A/B checklist, and outputs an A3 PDF with sources, an isometric render, and footnotes — all from a single local HTML folder with no backend. It also supports selecting additional parcels on the map and re-running the same pipeline as a combined Arealüberbauung (section 11), showing the merged result only.
