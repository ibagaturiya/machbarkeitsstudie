// rules.js — merges the canton's per-zone numbers with the commune-specific
// values the cantonal dataset doesn't carry (Grenzabstand, Grünflächenziffer,
// and any newer local rules), and — for Zürich — resolves the two parallel
// regimes (BZO 2016 in force vs. E-BZO draft under negativer Vorwirkung,
// § 234 PBG) to the STRICTER value per parameter.
//
// Add a commune by dropping a file in /data and registering it below. Zones
// are keyed by the canton's `typ_gde_abkuerzung` (e.g. "W3", "W2/25").
window.MachbarkeitTool = window.MachbarkeitTool || {};

(function () {
  // Netzabrufe laufen ueber T.fetchQuelle (js/core/netz.js): faellt eine
  // Quelle aus, nennt der Fehler sie beim Namen statt «Load failed».
  const T = window.MachbarkeitTool;
  // Which values ONLY the communal BZO can supply, and what each one is needed
  // for in the pipeline of REGELN.md §3. Without them there is no footprint and
  // no floor area — the run stops (CLAUDE.md §2), but it stops with a named
  // list instead of a bare error, so the gap between PBG/ABV and BZO is
  // visible rather than merely fatal.
  const KOMMUNAL_ERFORDERLICH = [
    { param: 'grundabstand_min_m', label: 'Grenzabstand (klein)', wofuer: 'Fussabdruck — Rückversatz von der Parzellengrenze' },
    { param: 'grosser_grenzabstand_min_m', label: 'Grosser Grenzabstand', wofuer: 'Fussabdruck — Hauptfassaden nach Süden' },
    { param: 'ausnuetzungsziffer_max_pct', label: 'Ausnützungsziffer', wofuer: 'anrechenbare Geschossfläche' },
    { param: 'vollgeschosse_max', label: 'Zahl der Vollgeschosse', wofuer: 'Geschossaufteilung und Freibetrag § 255 Abs. 3 PBG' },
    { param: 'gebaeudehoehe_max_m', label: 'Gebäude- oder Fassadenhöhe', wofuer: 'Hüllkurve und Geschosshöhe' },
    { param: 'firsthoehe_zuschlag_m', label: 'Firsthöhe (Zuschlag)', wofuer: 'Dach- und Attikaprofil' },
    { param: 'gesamtlaenge_max_m', label: 'Max. Gebäudelänge', wofuer: 'Aufteilung in Baukörper' },
    { param: 'gruenflaechenziffer_min_pct', label: 'Grünflächenziffer', wofuer: 'Fussabdruck-Deckel (kann fehlen — dann null, nie 0)' },
  ];

  // Typed error: app.js renders the lists instead of a bare popup.
  class GemeindeNichtHinterlegtError extends Error {
    constructor(gemeinde, vorhanden, erfasst) {
      super(
        `Für die Gemeinde "${gemeinde}" sind keine Bauvorschriften hinterlegt. ` +
        `Grenzabstand, Ausnützungsziffer und Höhen stehen nur in der kommunalen BZO. ` +
        `Hinterlegt sind aktuell: ${erfasst.join(', ')}.`
      );
      this.name = 'GemeindeNichtHinterlegtError';
      this.gemeinde = gemeinde;
      this.vorhandenAusKanton = vorhanden;
      this.erforderlichAusBzo = KOMMUNAL_ERFORDERLICH;
      this.erfassteGemeinden = erfasst;
      this.beizubringen = [
        `Bau- und Zonenordnung (BZO) der Gemeinde ${gemeinde} als PDF`,
        'Zonenplan der Gemeinde (für die Zonenzuordnung der Parzelle)',
        `Daraus eine data/bzo-${gemeinde.toLowerCase()}.json mit Provenienz je Wert (Artikel, Seite, Wortlaut) — Verfahren in README.md`,
      ];
    }
  }

  // Relative to index.html, NOT absolute: the app is served both locally
  // (serve.py, site root) and on GitHub Pages under /machbarkeitsstudie/,
  // where a leading slash would point outside the site.
  const GEMEINDE_FILES = {
    'Zürich': 'data/bzo-zurich-wohnzonen.json',
    'Zumikon': 'data/bzo-zumikon.json',
  };
  const KANTONAL_FILE = 'data/kantonale-abstandsvorschriften.json';

  const cache = {};
  let kantonalCache = null;

  function availableGemeinden() {
    return Object.keys(GEMEINDE_FILES);
  }

  async function loadGemeindeData(gemeinde) {
    if (cache[gemeinde]) return cache[gemeinde];
    const url = GEMEINDE_FILES[gemeinde];
    if (!url) {
      // Was das kantonale Recht auch ohne BZO liefert — aus der Datendatei
      // gelesen, nicht hier aufgezählt, damit die Liste nicht driftet.
      let vorhanden = [];
      try {
        const kant = await loadKantonalesRecht();
        vorhanden = Object.entries(kant.normen || {}).map(([param, n]) => ({
          param,
          label: n.label || param,
          artikel: (n.source && n.source.article) || null,
        }));
      } catch (e) {
        // Auch der kantonale Datensatz fehlt — dann bleibt die Liste leer.
        // Kein Grund, den eigentlichen Abbruch zu verschlucken.
        vorhanden = [];
      }
      throw new GemeindeNichtHinterlegtError(gemeinde, vorhanden, availableGemeinden());
    }
    const res = await T.fetchQuelle(`BZO ${gemeinde}`, url);
    if (!res.ok) throw new Error(`Konnte ${url} nicht laden: HTTP ${res.status}`);
    cache[gemeinde] = await res.json();
    return cache[gemeinde];
  }

  async function loadKantonalesRecht() {
    if (kantonalCache) return kantonalCache;
    const res = await T.fetchQuelle('Kantonale Abstandsvorschriften', KANTONAL_FILE);
    if (!res.ok) throw new Error(`Konnte ${KANTONAL_FILE} nicht laden: HTTP ${res.status}`);
    kantonalCache = await res.json();
    return kantonalCache;
  }

  // How to compare a parameter across the two Zürich regimes (§ 234 PBG,
  // negative Vorwirkung: the draft binds only where STRICTER than BZO 2016).
  // 'lower' = smaller value is stricter (caps), 'higher' = larger value is
  // stricter (minimum distances / minimum green ratios).
  const STRICTER = {
    vollgeschosse_max: 'lower',
    anrechenbares_untergeschoss_max: 'lower',
    anrechenbares_dach_attika_max: 'lower',
    ausnuetzungsziffer_max_pct: 'lower',
    ueberbauungsziffer_hauptgebaeude_max_pct: 'lower',
    gebaeudelaenge_inkl_klein_anbauten_max_m: 'lower',
    gesamtlaenge_max_m: 'lower',
    grundabstand_min_m: 'higher',
    gruenflaechenziffer_min_pct: 'higher',
    kronenbedeckungsgrad_min_pct: 'higher',
  };

  // Applies the stricter-of comparison between the E-BZO values already in
  // `merged` and the zone's `bzo2016` block. Returns a map of parameters
  // where the in-force BZO 2016 value won, for labeling in the output.
  function applyStricterOf(merged, bzo2016) {
    const overridden = {};
    if (!bzo2016) return overridden;
    for (const [key, mode] of Object.entries(STRICTER)) {
      const oldVal = bzo2016[key];
      const newVal = merged[key];
      if (oldVal == null) continue;
      if (newVal == null) {
        // Constraint exists only under BZO 2016 (in force) — it applies.
        merged[key] = oldVal;
        overridden[key] = { value: oldVal, regime: 'BZO 2016' };
        continue;
      }
      const stricter = mode === 'lower' ? Math.min(oldVal, newVal) : Math.max(oldVal, newVal);
      if (stricter !== newVal) {
        merged[key] = stricter;
        overridden[key] = { value: stricter, regime: 'BZO 2016' };
      }
    }
    return overridden;
  }

  // zoneInfo = the object returned by lookupZone(). Commune values win over
  // the cantonal dataset where both exist; an explicit null in the commune
  // file means "this rule does not exist here" (e.g. Zumikon has no
  // Grünflächenziffer) and deliberately shadows any cantonal value —
  // downstream code checks for == null and skips the constraint.
  async function getZoneRules(zoneInfo, gemeindeOverride) {
    const gemeinde = gemeindeOverride || zoneInfo.gemeinde;
    const [data, kantonal] = await Promise.all([loadGemeindeData(gemeinde), loadKantonalesRecht()]);
    const local = data[zoneInfo.zone];
    if (!local) {
      const known = Object.keys(data).filter((k) => !k.startsWith('_'));
      throw new Error(
        `Zone "${zoneInfo.zone}" ist für ${gemeinde} nicht hinterlegt. ` +
        `Erfasst sind: ${known.join(', ')}. ` +
        `(Dieses Tool deckt nur Wohnzonen ab.)`
      );
    }

    // A commune with a grosser Grenzabstand must also say to how many sides it
    // applies: Art. 18 Abs. 1 BZO Zumikon puts it on the TWO most south-facing
    // sides in W2/25 but on ONE in W2/35-W2/60. Defaulting the count to 1 was
    // silently re-introducing a bug already fixed once for W2/25 (REGELN.md §8)
    // for every commune added later — so the missing value halts here instead
    // (CLAUDE.md §2: never a default on a legal value).
    if (local.grosser_grenzabstand_min_m != null && local.grosser_grenzabstand_suedseiten == null) {
      throw new Error(
        `Zone "${zoneInfo.zone}" (${gemeinde}) kennt einen grossen Grenzabstand ` +
        `(${local.grosser_grenzabstand_min_m} m), aber die Datei sagt nicht, für wie viele ` +
        `Gebäudeseiten er gilt ("grosser_grenzabstand_suedseiten" fehlt). Ohne diese Angabe ` +
        `lässt sich der Fussabdruck nicht bestimmen — Wert aus der BZO ergänzen (Art. 18 Abs. 1).`
      );
    }

    const merged = { ...zoneInfo.kantonaleWerte, ...local };

    // Zürich: the E-BZO draft binds only where stricter than the in-force
    // BZO 2016 (§ 234 PBG). Take the stricter value per parameter and
    // remember which regime supplied it.
    const regimeOverrides = applyStricterOf(merged, local.bzo2016);

    // Height: Zürich's E-BZO uses traufseitige Fassadenhöhe, BZO 2016 and
    // Zumikon use Gebäudehöhe. These are different measurements — carry the
    // label so the output never implies they're interchangeable. Under
    // stricter-of, the smaller of the two caps governs the envelope.
    let heightMetric = data._meta.hoehenmetrik || 'Gebäudehöhe';
    let heightM = merged.traufseitige_fassadenhoehe_max_m != null
      ? merged.traufseitige_fassadenhoehe_max_m
      : merged.gebaeudehoehe_max_m;
    let heightRegime = null;
    const bzo2016Height = local.bzo2016 && local.bzo2016.gebaeudehoehe_max_m;
    if (bzo2016Height != null && heightM != null && bzo2016Height < heightM) {
      heightM = bzo2016Height;
      heightMetric = 'Gebäudehöhe';
      heightRegime = 'BZO 2016';
      regimeOverrides.heightM = { value: bzo2016Height, regime: 'BZO 2016' };
    }
    if (heightM == null || !isFinite(heightM)) {
      throw new Error(
        `Für die Zone "${zoneInfo.zone}" (${gemeinde}) ist keine zulässige Höhe hinterlegt ` +
        `(weder traufseitige Fassadenhöhe noch Gebäudehöhe). Ohne Höhenmass ist keine ` +
        `Hüllkurven-Berechnung möglich.`
      );
    }

    // Mehrlängenzuschlag (Art. 14 BZO 2016): in force, no E-BZO equivalent —
    // under negative Vorwirkung the stricter in-force rule keeps applying.
    const mehrlaengenzuschlag = (local.bzo2016 && local.bzo2016.mehrlaengenzuschlag) || null;

    const source = local.source || {
      article: data._meta.article_grundmasse,
      version: data._meta.version,
      paragraph_text: '',
      screenshot: null,
      synthetic: true, // no per-zone citation on file — do not present as a verified quote
    };

    return {
      ...merged,
      zoneLabel: zoneInfo.zone,
      gemeinde,
      heightMetric,
      heightM,
      heightRegime,
      regimeOverrides,
      mehrlaengenzuschlag,
      meta: data._meta,
      provenance: data._provenance || null,
      kantonal,
      source,
    };
  }

  // Resolves the evidence reference for a parameter: commune file first,
  // then the cantonal norms. Returns { file, title, page, article, quote,
  // highlight } or null if nothing is on record — callers must then label
  // the value as a tool assumption, never invent a citation.
  function getProvenance(rules, param) {
    const fromBlock = (block) => {
      if (!block || !block.params || !block.params[param]) return null;
      const p = block.params[param];
      const doc = block.docs && block.docs[p.doc];
      if (!doc) return null;
      return {
        file: doc.file, title: doc.title, page: p.page, article: p.article,
        quote: p.quote, highlight: p.highlight || null, seeAlso: p.see_also || null,
      };
    };
    const local = fromBlock(rules && rules.provenance);
    if (local) return local;
    // Cantonal norms: keyed differently (normen.<name>.source)
    const kant = rules && rules.kantonal;
    if (kant && kant.normen && kant.normen[param]) {
      const n = kant.normen[param];
      const s = n.source || {};
      const doc = kant._docs && kant._docs[s.doc];
      return {
        file: doc ? doc.file : null, title: doc ? doc.title : s.article,
        page: s.page, article: s.article, quote: s.paragraph_text,
        highlight: s.highlight || null, seeAlso: null,
      };
    }
    return null;
  }

  window.MachbarkeitTool.GemeindeNichtHinterlegtError = GemeindeNichtHinterlegtError;
  window.MachbarkeitTool.KOMMUNAL_ERFORDERLICH = KOMMUNAL_ERFORDERLICH;
  window.MachbarkeitTool.getZoneRules = getZoneRules;
  window.MachbarkeitTool.availableGemeinden = availableGemeinden;
  window.MachbarkeitTool.loadGemeindeData = loadGemeindeData;
  window.MachbarkeitTool.loadKantonalesRecht = loadKantonalesRecht;
  window.MachbarkeitTool.getProvenance = getProvenance;
})();
