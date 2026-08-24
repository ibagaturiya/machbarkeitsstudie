// checklist.js — section 6: Tier A (computed, no ambiguity) vs Tier B
// (existence detected automatically, content flagged for manual review).
// Tier A reuses oereb.js's restriction check (step 7) -- same ÖREB gate,
// just relabeled as PASS/FLAG for display instead of a footprint decision.
window.MachbarkeitTool = window.MachbarkeitTool || {};

(function () {
  const WFS_BASE = 'https://www.ogd.stadt-zuerich.ch/wfs/geoportal/Nutzungsplanung___kommunale_Bau__und_Zonenordnung__BZO_';
  const DENKMAL_WFS_BASE = 'https://www.ogd.stadt-zuerich.ch/wfs/geoportal/Denkmalpflege_Inventar';

  async function fetchFeaturesInBbox(base, typeName, minE, minN, maxE, maxN) {
    const params = new URLSearchParams({
      SERVICE: 'WFS', VERSION: '1.1.0', REQUEST: 'GetFeature',
      TYPENAME: typeName, SRSNAME: 'EPSG:2056',
      BBOX: `${minE},${minN},${maxE},${maxN},EPSG:2056`,
      outputFormat: 'application/vnd.geo+json',
    });
    const res = await fetch(`${base}?${params}`);
    if (!res.ok) throw new Error(`WFS HTTP ${res.status} (${typeName})`);
    return res.json();
  }

  // Takes a turf Polygon OR MultiPolygon Feature. A plain .flat() on
  // MultiPolygon coordinates silently produces a bogus bbox (extra nesting
  // level means each "point" is actually a whole ring array) rather than
  // erroring -- caught 2026-08-21 while fixing the same bug in viewer.js
  // for non-contiguous Areal selections, and pre-emptively fixed here too
  // before it caused an equally silent wrong-bbox bug for the Areal
  // checklist WFS queries.
  function parcelBbox(parcelFeature, marginM) {
    const points =
      parcelFeature.geometry.type === 'Polygon'
        ? parcelFeature.geometry.coordinates.flat(1)
        : parcelFeature.geometry.coordinates.flat(2);
    const es = points.map((p) => p[0]);
    const ns = points.map((p) => p[1]);
    return [Math.min(...es) - marginM, Math.min(...ns) - marginM, Math.max(...es) + marginM, Math.max(...ns) + marginM];
  }

  // Sonderbauvorschriften / Gestaltungsplan: does the parcel polygon
  // actually overlap one of these overlay-zone polygons (not just a point
  // check -- these can partially cover a parcel).
  async function checkSonderbauvorschriften(parcelPolygon) {
    const [minE, minN, maxE, maxN] = parcelBbox(parcelPolygon, 5);
    const [sbvFc, gpFc] = await Promise.all([
      fetchFeaturesInBbox(WFS_BASE, 'bzo_sbv_v', minE, minN, maxE, maxN),
      fetchFeaturesInBbox(WFS_BASE, 'bzo_gp_v', minE, minN, maxE, maxN),
    ]);
    const overlapping = [...sbvFc.features, ...gpFc.features].filter((f) =>
      turf.booleanIntersects(parcelPolygon, f)
    );
    return overlapping.map((f) => ({
      name: f.properties.name || f.properties.typ,
      typ: f.properties.typ,
      rechtsvorschriftUrl: f.properties.rechtsvorschrift_url,
    }));
  }

  // Ortsbildschutz / Denkmalpflege: any protected-object point located
  // within this parcel? (Municipal inventory only, per build plan section
  // 6 -- ktzh cantonal supra-municipal layer not wired in for v1.)
  async function checkHeritageProtection(parcelPolygon) {
    const [minE, minN, maxE, maxN] = parcelBbox(parcelPolygon, 5);
    const fc = await fetchFeaturesInBbox(DENKMAL_WFS_BASE, 'denkmalpflege_inventar_p', minE, minN, maxE, maxN);
    // SRSNAME=EPSG:2056 above is honored by this service (verified
    // 2026-08-21) -- coordinates are already LV95, no reprojection needed.
    const inside = fc.features.filter((f) =>
      turf.booleanPointInPolygon(turf.point(f.geometry.coordinates), parcelPolygon)
    );
    return inside.map((f) => ({
      objectDescription: f.properties.objektbeze,
      inventoryCategory: f.properties.inventarka,
      underProtection: f.properties.unterschut,
    }));
  }

  function waldabstandItem(restrictions, wald, waldLossInFootprintM2) {
    // Waldabstand is genuinely computed now (waldabstand.js), so this reports
    // the geometric result rather than a "please check manually" flag.
    if (wald && wald.forbidden) {
      const lost = Math.round(waldLossInFootprintM2 || 0);
      const caveat = wald.sideUndetermined
        ? ' Hinweis: für einen Teil der Umgebung liess sich die wirksame Seite der Abstandslinie nicht eindeutig bestimmen — Geometrie manuell prüfen.'
        : '';
      // Not a warning: the restriction is computed and already subtracted, so
      // this reports a resolved constraint rather than an open question.
      return {
        key: 'waldabstand', label: 'Waldabstand', status: wald.sideUndetermined ? 'review' : 'pass',
        text: (lost > 0
          ? `Berücksichtigt. Die Waldabstandslinie schneidet die Parzelle; die auf der Waldseite liegende Fläche (${Math.round(wald.lostAreaM2)} m² der Parzelle, davon ${lost} m² im bereits reduzierten Fussabdruck) ist geometrisch abgezogen und in allen Zahlen und Darstellungen oben enthalten.`
          : `Die Waldabstandslinie schneidet die Parzelle (${Math.round(wald.lostAreaM2)} m²), liegt aber vollständig im Bereich, der ohnehin schon durch den Grundabstand wegfällt. Kein zusätzlicher Abzug.`) + caveat,
      };
    }
    if (wald && wald.undetermined) {
      return {
        key: 'waldabstand', label: 'Waldabstand', status: 'review',
        text: `${wald.reason}. Manuelle Prüfung erforderlich — der Fussabdruck oben ist insoweit möglicherweise zu gross.`,
      };
    }
    if (wald && wald.applies) {
      return {
        key: 'waldabstand', label: 'Waldabstand', status: 'pass',
        text: `Waldabstandslinie in der Umgebung vorhanden, sie schneidet diese Parzelle aber nicht. Kein Abzug nötig.`,
      };
    }
    // No line found at all. Cross-check against the ÖREB cadastre: if ÖREB
    // says the parcel IS concerned but no line geometry turned up, that's a
    // data gap worth surfacing, not a clean pass.
    if (restrictions.waldabstand.concerned) {
      return {
        key: 'waldabstand', label: 'Waldabstand', status: 'review',
        text: `Der ÖREB-Kataster weist für diese Parzelle eine Waldabstandslinie aus, in den kantonalen Geodaten (ogd-0152) wurde in der Umgebung aber keine Liniengeometrie gefunden. Widersprüchliche Datenlage — manuell prüfen.`,
      };
    }
    return {
      key: 'waldabstand', label: 'Waldabstand', status: 'pass',
      text: 'Keine Waldabstandslinie betrifft diese Parzelle (kantonale Geodaten und ÖREB-Kataster).',
    };
  }

  // Baulinien (Verkehrsbaulinien etc.) carry the same links/rechts
  // `wirksamkeit` as the Waldabstandslinie, so they are computed and
  // subtracted rather than flagged for manual work.
  function baulinienItem(restrictions, baulinien, lossM2) {
    if (baulinien && baulinien.forbidden) {
      const kinds = baulinien.types && baulinien.types.length ? ` (${baulinien.types.join(', ')})` : '';
      return {
        key: 'baulinien', label: 'Baulinien', status: baulinien.sideUndetermined ? 'review' : 'pass',
        text: `Berücksichtigt. Eine Baulinie${kinds} schneidet die Parzelle; die dahinter liegende Fläche (${Math.round(baulinien.lostAreaM2)} m², davon ${Math.round(lossM2 || 0)} m² im Fussabdruck) ist abgezogen.`
          + (baulinien.sideUndetermined ? ' Für einen Teil liess sich die wirksame Seite nicht eindeutig bestimmen — manuell prüfen.' : ''),
      };
    }
    if (baulinien && baulinien.undetermined) {
      return { key: 'baulinien', label: 'Baulinien', status: 'review',
        text: `${baulinien.reason}. Manuelle Prüfung erforderlich.` };
    }
    if (baulinien && baulinien.applies) {
      return { key: 'baulinien', label: 'Baulinien', status: 'pass',
        text: 'Baulinie in der Umgebung vorhanden, sie schneidet diese Parzelle aber nicht.' };
    }
    if (restrictions.baulinien.concerned) {
      return { key: 'baulinien', label: 'Baulinien', status: 'review',
        text: 'Der ÖREB-Kataster weist eine Baulinie aus, in den kantonalen Geodaten (ogd-0158) wurde aber keine Liniengeometrie gefunden. Widersprüchliche Datenlage — manuell prüfen.' };
    }
    return { key: 'baulinien', label: 'Baulinien', status: 'pass',
      text: 'Keine Baulinie betrifft diese Parzelle (kantonale Geodaten und ÖREB-Kataster).' };
  }

  async function buildChecklist({ parcelPolygon, restrictions, rules, gemeinde, bfsNr, wald, waldLossInFootprintM2, baulinien, baulinienLossM2 }) {
    // The Sonderbauvorschriften/Gestaltungsplan and Denkmalpflege layers are
    // Stadt-Zürich datasets. Outside the city they return nothing, which would
    // render as a green PASS -- a false all-clear. Gate on the parcel's actual
    // location (BFS-Nr. 261 = Stadt Zürich), NOT the commune name: the name
    // can come from the manual override dropdown, and overriding to "Zürich"
    // for a parcel physically elsewhere must not produce a fake PASS.
    const cityDataAvailable = bfsNr != null ? bfsNr === 261 : gemeinde === 'Zürich';
    // A city-WFS outage must degrade to "nicht prüfbar", not kill the whole
    // analysis (it used to).
    let cityFetchFailed = false;
    const [sbvHits, heritageHits] = cityDataAvailable
      ? await Promise.all([
          checkSonderbauvorschriften(parcelPolygon).catch(() => { cityFetchFailed = true; return null; }),
          checkHeritageProtection(parcelPolygon).catch(() => { cityFetchFailed = true; return null; }),
        ])
      : [null, null];

    const tierA = [
      waldabstandItem(restrictions, wald, waldLossInFootprintM2),
      {
        key: 'gewaesserraum',
        label: 'Gewässerraum',
        status: restrictions.gewaesserraum.concerned ? 'flag' : (restrictions.gewaesserraum.unchecked ? 'review' : 'pass'),
        text: restrictions.gewaesserraum.concerned
          ? 'Diese Parzelle unterliegt gemäss ÖREB-Kataster einem Gewässerraum. Automatische Fussabdruck-Reduktion nicht vorgenommen.'
          : restrictions.gewaesserraum.unchecked
            ? 'Nicht prüfbar: der ÖREB-Kataster war nicht erreichbar oder verwendet unbekannte Themen-Codes. Manuell prüfen.'
            : 'Kein Gewässerraum betrifft diese Parzelle (gemäss ÖREB-Kataster).',
      },
      baulinienItem(restrictions, baulinien, baulinienLossM2),
    ];

    const tierB = [
      {
        key: 'sonderbauvorschriften',
        label: 'Sonderbauvorschriften / Gestaltungsplan',
        status: !cityDataAvailable || sbvHits == null ? 'review' : sbvHits.length > 0 ? 'review' : 'pass',
        text: !cityDataAvailable
          ? `Nicht geprüft: die verwendeten Datensätze für Sonderbauvorschriften und Gestaltungspläne decken nur die Stadt Zürich ab, diese Parzelle liegt in ${gemeinde}. Manuell prüfen — solche Überlagerungen überschreiben die Grundmasse oben.`
          : sbvHits == null
            ? 'Nicht prüfbar: der Stadt-Zürich-Geodatendienst war nicht erreichbar. Manuell prüfen — Sonderbauvorschriften/Gestaltungspläne überschreiben die Grundmasse oben.'
            : sbvHits.length > 0
              ? `Diese Parzelle liegt innerhalb von: ${sbvHits.map((h) => h.name).join(', ')}. Deren Sondervorschriften überschreiben die Standard-BZO-Werte oben und wurden von diesem Tool nicht ausgewertet. Manuelle Prüfung erforderlich.`
              : 'Keine Sonderbauvorschriften oder Gestaltungspläne gefunden, die diese Parzelle betreffen.',
        detail: sbvHits,
      },
      {
        key: 'ortsbildschutz',
        label: 'Ortsbildschutz / Denkmalpflege',
        status: !cityDataAvailable || heritageHits == null ? 'review' : heritageHits.length > 0 ? 'review' : 'pass',
        text: !cityDataAvailable
          ? `Nicht geprüft: das verwendete Denkmalpflege-Inventar deckt nur die Stadt Zürich ab, diese Parzelle liegt in ${gemeinde}. Manuell prüfen (kommunales Inventar der Gemeinde sowie kantonales Inventar).`
          : heritageHits == null
            ? 'Nicht prüfbar: das Denkmalpflege-Inventar (Stadt-Zürich-WFS) war nicht erreichbar. Manuell prüfen.'
            : heritageHits.length > 0
              ? `Diese Parzelle/dieses Gebäude erscheint im kommunalen Denkmalpflege-Inventar (${heritageHits.map((h) => h.objectDescription).join(', ')}). Manuelle Prüfung erforderlich, was dies einschränkt. Hinweis: nur das kommunale Inventar wurde geprüft, nicht das kantonale (überkommunale) Inventar.`
              : 'Kein Eintrag im kommunalen Denkmalpflege-Inventar für diese Parzelle gefunden.',
        detail: heritageHits,
      },
      ...(rules.meta && rules.meta.strassenabstand_ohne_baulinien_m != null ? [{
        key: 'strassenabstand',
        label: 'Strassenabstand',
        status: 'review',
        text: `Art. 32 BZO ${gemeinde}: Wo Verkehrsbaulinien fehlen, gilt ein Abstand von ${rules.meta.strassenabstand_ohne_baulinien_m} m gegenüber öffentlichen Strassen, Plätzen und Wegen (auch für unterirdische Gebäude). Nicht automatisch geprüft — bei Parzellen an öffentlichen Strassen ohne Baulinie manuell berücksichtigen.`,
      }] : []),
      ...(rules.meta && rules.meta.begruenung_perimeter_min_pct != null ? [{
        key: 'begruenung',
        label: 'Begrünung (Perimeter hoher Grünanteil)',
        status: 'review',
        text: `Art. 29 Abs. 2 BZO ${gemeinde}: Im Perimeter "Gemeindegebiet mit hohem Grünanteil" sind in der Regel mindestens ${rules.meta.begruenung_perimeter_min_pct}% der massgeblichen Grundfläche zu begrünen. Ob die Parzelle im Perimeter liegt, wurde nicht automatisch geprüft (Zonenplan/Ergänzungsplan konsultieren).`,
      }] : []),
      {
        key: 'kronenbedeckungsgrad',
        label: 'Kronenbedeckungsgrad',
        status: 'review',
        text: rules.kronenbedeckungsgrad_min_pct != null
          ? `Diese Zone erfordert einen minimalen Kronenbedeckungsgrad von ${rules.kronenbedeckungsgrad_min_pct}%. Nicht ausgewertet — erfordert Vor-Ort-Besichtigung oder Luftbildauswertung.`
          : `Für diese Zone ist in der kommunalen BZO kein Kronenbedeckungsgrad erfasst. Allfällige Baum-/Begrünungsvorschriften der Gemeinde manuell prüfen.`,
      },
    ];

    return { tierA, tierB };
  }

  window.MachbarkeitTool.buildChecklist = buildChecklist;
})();
