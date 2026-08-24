# Source documents

Reference legal PDFs backing the hardcoded numbers in `/data/bzo-zurich-wohnzonen.json`
and `/data/kantonale-abstandsvorschriften.json` (Arealüberbauung rules, build plan section 11).
Downloaded 2026-08-21; PBG swapped for the full consolidated text on the same day (see below).

| File | What it is | Used for |
|---|---|---|
| `ebzo-entwurf-2026-01-06.pdf` | E-BZO Entwurf (Stadt Zürich), Stand 6. Januar 2026, öffentliche Auflage version | **Primary source.** Art. 62 (Wohnzonen Grundmasse, section 4), Art. 6–9 (Arealüberbauung, section 11), Art. 32/138 (traufseitige Fassadenhöhe definition), Art. 53 (Kronenbedeckungsgrad) |
| `bzo-2016.pdf` | BZO 2016 (current, still formally in force pending Gemeinderat adoption of the E-BZO) | Comparison only — confirms the Untergeschoss/Gebäudehöhe changes called out in section 4. Not load-bearing for computed numbers. |
| `pbg-700.1-current.pdf` | Kantonales Planungs- und Baugesetz (PBG), Ordnungsnummer 700.1, **Nachtrag 134 (current consolidated text, Stand 1.10.2026)** | **Resolved the Art. 9 data gap** (see below): §§260, 269–272 (cantonal Grenz-/Gebäudeabstand), §72 Abs. 2 (why outer vs. internal Areal boundaries are treated differently), §69–71 (Arealüberbauung Zulässigkeit/Anforderungen), §234 (negative Vorwirkung), §49b (preisgünstiger Wohnraum) |
| `pbg-700.1-amendment-2015-harmonisierung.pdf` | Original download — turned out to be only the 2015 "Harmonisierung der Baubegriffe" *amendment* document, not the full law (only 372 lines, missing §261 and most of the Abstände chapter). Kept for reference but superseded by `pbg-700.1-current.pdf` above. | Not used going forward. |
| `abv-700.2.pdf` | Allgemeine Bauverordnung (ABV), Kanton Zürich, Ordnungsnummer 700.2 | **Read and ruled out** for the Art. 9 gap: ABV §§21–26 govern the *communal* Grenzabstand system (Grundabstand + Zuschläge "gemäss Bau- und Zonenordnung") — the system Art. 9 explicitly opts *out* of. The real answer was in the PBG main text directly. Still useful for §8–13 (Nutzungsziffern-Messweise, Arealfläche computation). |

## Not included: ISOS / Bauinventar

These are **not standalone PDFs to source** — per build plan section 6, both are queried as
**geodata layers** at runtime (existence-check for Tier B: "is this parcel inside a protected
area, yes/no"), not documents whose text gets extracted. There is no single canonical PDF
covering "ISOS for Zürich"; ISOS Ortsbildaufnahmen are per-site survey documents on the
federal ISOS-Geoportal, and the city's Denkmalpflege-Inventar is published as
GeoJSON/Shapefile/GeoPackage/CSV only (data.stadt-zuerich.ch/geodaten/download/Denkmalpflege_Inventar),
no accompanying PDF.

The one general-methodology PDF that would have been useful as background reading
("Weisungen über das Bundesinventar der schützenswerten Ortsbilder", bak.admin.ch) returned
a 502 from the source server on 2026-08-21 — worth retrying, not blocking, since the tool
doesn't need it to implement the geodata existence-check.

## Art. 9 gap — resolved 2026-08-21

Closed. See `/data/kantonale-abstandsvorschriften.json` for the sourced numbers
(§270 Abs. 1 PBG: 3.5 m cantonal Grenzabstand base; §271 PBG: 7 m minimum Gebäudeabstand
between areal-internal buildings; §260 Abs. 3/4 PBG: Mehrhöhenzuschlag and small-structure
exemption; §72 Abs. 2 PBG: legal basis for the outer-vs-internal boundary split already
scoped in build plan section 11 step 2).

**One sub-gap remains, deliberately not resolved:** which reference Fassadenhöhe the
Mehrhöhenzuschlag (§260 Abs. 3 PBG) measures against for an Arealüberbauung specifically —
the standalone zone's traufseitige Fassadenhöhe max, or the Areal-bonus figure from Art. 7(2)
E-BZO. Not addressed by anything read so far. This matters once envelope math reaches
taller Areal buildings (e.g. 25 m in "übrige Zonen"), which will be well past whatever the
reference height turns out to be. Flagged in the data file's `not_yet_resolved` field —
don't guess a value for it either.

## Verify before relying on `ebzo-entwurf-2026-01-06.pdf` or `pbg-700.1-current.pdf`

Per section 4, check whether Gemeinderat has since formally adopted the E-BZO, and whether
Nachtrag 134 is still the current PBG version, before treating these numbers as current.
