// rules.js — merges the canton's per-zone numbers with the commune-specific
// values the cantonal dataset doesn't carry (Grenzabstand, Grünflächenziffer,
// and any newer local rules).
//
// Add a commune by dropping a file in /data and registering it below. Zones
// are keyed by the canton's `typ_gde_abkuerzung` (e.g. "W3", "W2/25").
window.MachbarkeitTool = window.MachbarkeitTool || {};

(function () {
  const GEMEINDE_FILES = {
    'Zürich': '/data/bzo-zurich-wohnzonen.json',
    'Zumikon': '/data/bzo-zumikon.json',
  };

  const cache = {};

  function availableGemeinden() {
    return Object.keys(GEMEINDE_FILES);
  }

  async function loadGemeindeData(gemeinde) {
    if (cache[gemeinde]) return cache[gemeinde];
    const url = GEMEINDE_FILES[gemeinde];
    if (!url) {
      throw new Error(
        `Für die Gemeinde "${gemeinde}" sind keine Bauvorschriften hinterlegt. ` +
        `Die kantonale Nutzungsplanung liefert zwar Ausnützung und Geschosszahl, aber ` +
        `Grenzabstand und Grünflächenziffer stehen nur in der kommunalen BZO. ` +
        `Ohne diese Werte lässt sich kein Fussabdruck berechnen. ` +
        `Hinterlegt sind aktuell: ${availableGemeinden().join(', ')}.`
      );
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Konnte ${url} nicht laden: HTTP ${res.status}`);
    cache[gemeinde] = await res.json();
    return cache[gemeinde];
  }

  // zoneInfo = the object returned by lookupZone(). Commune values win over
  // the cantonal ones where both exist: for Zürich the local file holds the
  // E-BZO draft, which is newer than the cantonal dataset and is what new
  // Baugesuche are actually assessed against (negative Vorwirkung, §234 PBG).
  async function getZoneRules(zoneInfo, gemeindeOverride) {
    const gemeinde = gemeindeOverride || zoneInfo.gemeinde;
    const data = await loadGemeindeData(gemeinde);
    const local = data[zoneInfo.zone];
    if (!local) {
      const known = Object.keys(data).filter((k) => !k.startsWith('_'));
      throw new Error(
        `Zone "${zoneInfo.zone}" ist für ${gemeinde} nicht hinterlegt. ` +
        `Erfasst sind: ${known.join(', ')}. ` +
        `(Dieses Tool deckt nur Wohnzonen ab.)`
      );
    }

    const merged = { ...zoneInfo.kantonaleWerte, ...stripNulls(local) };

    // Height: Zürich's E-BZO uses traufseitige Fassadenhöhe, Zumikon (and the
    // cantonal dataset) use Gebäudehöhe. These are different measurements --
    // carry the label so the output never implies they're interchangeable.
    const heightMetric = data._meta.hoehenmetrik || 'Gebäudehöhe';
    const heightM = merged.traufseitige_fassadenhoehe_max_m != null
      ? merged.traufseitige_fassadenhoehe_max_m
      : merged.gebaeudehoehe_max_m;

    return {
      ...merged,
      zoneLabel: zoneInfo.zone,
      gemeinde,
      heightMetric,
      heightM,
      meta: data._meta,
      source: local.source || { article: data._meta.article_grundmasse, version: data._meta.version, paragraph_text: '', screenshot: null },
    };
  }

  // null in a commune file means "this rule does not exist here" (e.g. Zumikon
  // has no Grünflächenziffer). Those keys must not shadow the cantonal value
  // with null, but must also not be silently replaced by a Zürich default --
  // downstream code checks for undefined/null and skips the constraint.
  function stripNulls(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== null) out[k] = v;
      else out[k] = null;
    }
    return out;
  }

  window.MachbarkeitTool.getZoneRules = getZoneRules;
  window.MachbarkeitTool.availableGemeinden = availableGemeinden;
  window.MachbarkeitTool.loadGemeindeData = loadGemeindeData;
})();
