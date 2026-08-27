# vendor/ — third-party libraries, pinned and served from this repo

These three libraries used to be loaded live from `unpkg.com` on every page
view. They are now committed here and served from the same origin as the app.

**Why pinned locally**

- A local run (`python3 serve.py`) works without internet, so the tool can be
  verified — and demonstrated to a client — offline.
- `@turf/turf@6` is a *floating* range: unpkg resolved it to whatever the
  newest 6.x happened to be at request time. The legal arithmetic depends on
  Turf's geometry (union, buffer, area). A silent minor bump upstream could
  change a computed area without a single commit in this repo — which is
  exactly what `CLAUDE.md` §4 forbids ("a Machbarkeitsstudie has to produce
  the same numbers twice").
- Version lives in the folder name, so an upgrade is a visible file move, not
  an invisible cache refresh.

**What is here**

| Path | Version | Source | SHA-256 |
|---|---|---|---|
| `leaflet-1.9.4/leaflet.js` | 1.9.4 | `unpkg.com/leaflet@1.9.4/dist/leaflet.js` | `db49d009c841f5ca34a888c96511ae936fd9f5533e90d8b2c4d57596f4e5641a` |
| `leaflet-1.9.4/leaflet.css` | 1.9.4 | `unpkg.com/leaflet@1.9.4/dist/leaflet.css` | `a7837102824184820dfa198d1ebcd109ff6d0ff9a2672a074b9a1b4d147d04c6` |
| `leaflet-1.9.4/images/` | 1.9.4 | `unpkg.com/leaflet@1.9.4/dist/images/` | marker + layers sprites referenced by `leaflet.css` |
| `turf-6.5.0/turf.min.js` | 6.5.0 | `unpkg.com/@turf/turf@6/turf.min.js` → resolved `6.5.0` | `d00f3e8ff8a8f9c103dad61c2fd4bb58143e1404aadfdf09e29b6db1a2de0a3f` |
| `three-0.160.0/three.min.js` | 0.160.0 | `unpkg.com/three@0.160.0/build/three.min.js` | `170c6789f43217c96b3170f4b42fafe135de7f7cd48497a4218f9757ee1d49fa` |

Vendored 2026-08-27. Verify a file with `shasum -a 256 <path>`.

**Known upgrade cliff — Three.js.** `three.min.js` prints a deprecation
warning on load: the UMD build was removed after r160. Moving past 0.160.0
means switching to ES modules, which means a build step or an import map —
per `CLAUDE.md` §4 that is a decision to raise explicitly, not to smuggle in.
0.160.0 is deliberately the last version that works without one.

**Upgrading anything here**

1. Download into a *new* versioned folder; never overwrite in place.
2. Update the script/link tags in `index.html` and the table above.
3. `node tests/run-tests.mjs`, then run the app and re-check a known parcel —
   Turf changes surface as shifted areas, not as errors.
