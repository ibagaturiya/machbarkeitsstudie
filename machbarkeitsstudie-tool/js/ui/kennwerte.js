// kennwerte.js — die Zahlentafel als Daten statt als HTML.
//
// Frueher baute app.js render() eine Liste aus [Beschriftung, HTML] und
// schrieb sie direkt in eine Tabelle. Damit war der Wert mit seiner
// Erklaerung in einem String verklebt, und woher er kam, stand nirgends.
//
// Hier traegt jede Zeile vier Dinge:
//   value    der formatierte Wert allein, einstellig gerundet an EINER
//            Stelle (fmt), nie in der Rechenkette (CLAUDE.md §4)
//   source   die Fundstelle: ein Artikel aus dem _provenance-Block der
//            Datendatei, oder der Name des Datensatzes. Nie erfunden.
//   kind     GEHOLT | BERECHNET | GEPRÜFT | ANNAHME | ENTWURF
//   formula  die Herleitung als Text, die in der HERLEITUNG-Leiste steht
//
// `kind` wird abgeleitet, nicht getippt: GEHOLT kommt aus einer Quelle,
// BERECHNET aus js/core/, GEPRÜFT ist eine Pruefung, die gehalten hat,
// ANNAHME steht im Register REGELN.md §5, ENTWURF ist eine Entscheidung des
// Benutzers. Die Laufzusammenfassung zaehlt diese Werte — sie kann deshalb
// nicht von der Tabelle abweichen.
window.MachbarkeitTool = window.MachbarkeitTool || {};

(function () {
  const T = window.MachbarkeitTool;

  const KINDS = ['GEHOLT', 'BERECHNET', 'GEPRÜFT', 'ANNAHME', 'ENTWURF'];

  // Eine Fundstelle ist ein Gesetzeszitat, wenn sie wie eines aussieht —
  // § fuer PBG/ABV, Art. fuer BZO und WaG. Nur die faerbt die Tabelle
  // orange; ein Datensatzname bleibt grau.
  function isCitation(source) {
    return /^\s*(§|Art\.)/.test(String(source || ''));
  }

  function buildKennwerte(r, { provFor, storeyCountLabel, compassLabel }) {
    const fmt = T.fmt;
    const { anchor, rules, rulesData, reconciled, selection, terrainHeight } = r;
    const mm = r.massingModel;
    const abz = r.flaechenAbzuege || {};
    const multi = selection.length > 1;

    // Artikel aus der Datendatei; null, wenn fuer diesen Wert keine
    // Belegstelle erfasst ist — dann steht dort der Datensatz, nicht ein
    // erfundener Paragraph.
    const art = (...keys) => {
      const p = provFor(rules, ...keys);
      return p && p.article ? { source: p.article, prov: p } : null;
    };
    // Baut eine Zeile. `fallbackSource` greift, wenn keine Belegstelle da ist.
    //
    // `opts` traegt die zweite Achse (js/core/sicherheit.js): WIE SICHER ist
    // der Wert, im Unterschied zu `kind` = WOHER kommt er.
    //   id            Name dieser Zeile, damit spaetere Zeilen an ihr haengen koennen
    //   dependsOn     ids der Eingaenge; die Zeile erbt deren schwaechste Stufe
    //   schluessel    Registerschluessel in VEREINFACHUNGEN / WERKZEUG_ANNAHMEN
    //   quelleAusgefallen  Datendienst nicht erreichbar
    const row = (label, value, kind, formula, provOrSource, fallbackSource, opts = {}) => {
      if (!KINDS.includes(kind)) throw new Error(`Unbekannte Kennwert-Art "${kind}" bei "${label}"`);
      const a = provOrSource && typeof provOrSource === 'object' ? provOrSource : null;
      const source = a ? a.source : (provOrSource || fallbackSource || 'abgeleitet');
      const prov = a ? a.prov : null;
      const s = T.stufeVon({
        label, wert: value, kind, source, prov,
        schluessel: opts.schluessel || null,
        quelleAusgefallen: !!opts.quelleAusgefallen,
      });
      return {
        label, value, kind, formula: formula || null,
        source, isCitation: isCitation(source), prov,
        id: opts.id || null,
        dependsOn: opts.dependsOn || null,
        sicherheit: s.stufe,
        sicherheitGrund: s.grund,
        sicherheitRegister: s.register || null,
        belegtyp: s.belegtyp || null,
      };
    };

    // ---- 1. PARZELLE ----------------------------------------------------
    const zoneRechtsstatus = anchor.zoneSource ? anchor.zoneSource.rechtsstatus : 'inKraft';
    const parzelleRows = [
      // EIN Name je Grundstueck, aus js/core/format.js — dieselbe Kette,
      // die Deckblatt, Trennseite und Kopfzeile benutzen. Vorher las diese
      // Zeile `anchor.address`, die EINGETIPPTE Adresse: bei drei getrennt
      // gerechneten Parzellen trug die Tafel jeder von ihnen den Namen des
      // gesuchten Nachbarhauses oder die nackte Nummer.
      row('Adresse', T.betreffVon(r), 'GEHOLT',
        'Adressregister (GWR) zur Parzelle; ohne Treffer die eingetippte Adresse, sonst die Parzellennummer',
        'Adressregister'),
      row('Gemeinde / Parzelle', `${rules.gemeinde} · ${selection.map((p) => p.parcelNumber).join(' + ')}`,
        'GEHOLT', null, 'Amtliche Vermessung'),
      row('EGRID', selection.map((p) => p.egrid).join(', '), 'GEHOLT', null, 'Amtliche Vermessung'),
      row('Zone', `${anchor.zone} (${zoneRechtsstatus})`,
        'GEHOLT', `Punkt-in-Polygon-Abfrage ogd-0156 → ${anchor.zone} (${zoneRechtsstatus})`, 'ogd-0156'),
      row(multi ? 'Fläche (zusammengefasst)' : 'Parzellenfläche', `${fmt(reconciled.parcelAreaM2)} m²`,
        multi ? 'BERECHNET' : 'GEHOLT',
        multi
          ? `${selection.length} Parzellen vereinigt (gemeinsame Kanten einmal gezählt) = ${fmt(reconciled.parcelAreaM2)} m²`
          : `Polygonfläche ${anchor.parcelNumber} = ${fmt(reconciled.parcelAreaM2)} m² (planar, LV95)`,
        'Amtliche Vermessung'),
      row('Anrechenbare Grundstücksfläche', `${fmt(reconciled.anrechenbareFlaecheM2)} m²`, 'BERECHNET',
        (abz.waldM2 > 0.5 || abz.waldAbstand15M2 > 0.5)
          ? `${fmt(reconciled.parcelAreaM2)}`
            + (abz.waldM2 > 0.5 ? ` − ${fmt(abz.waldM2)} m² Wald in der Parzelle` : '')
            + (abz.waldAbstand15M2 > 0.5 ? ` − ${fmt(abz.waldAbstand15M2)} m² Waldabstandsfläche > 15 m hinter der Linie (§ 259 aPBG)` : '')
            + ` = ${fmt(reconciled.anrechenbareFlaecheM2)} m²`
          : `${fmt(reconciled.parcelAreaM2)} m² − 0 m² (kein Wald, keine Fläche > 15 m hinter der Waldabstandslinie${abz.waldAbstand15M2 == null ? ' ermittelbar — manuell prüfen' : ''}; Gewässer und Zonenanteile nicht automatisch geprüft)`,
        art('massgebliche_grundflaeche', 'anrechenbare_grundstuecksflaeche', 'massgebliche_grundflaeche_altrecht'),
        null, { id: 'anrechenbar', schluessel: 'anrechenbare_flaeche_nur_wald' }),
    ];

    // ---- 2. ABZÜGE & FUSSABDRUCK ---------------------------------------
    const grundabstandM = r.grundabstandUsedM ?? rules.grundabstand_min_m;
    const abzugRows = [
      row('Fussabdruck nach Grundabstand', `${fmt(r.footprintBeforeWaldM2)} m²`, 'BERECHNET',
        r.hasDirectional && rules.grosser_grenzabstand_min_m != null
          ? (r.grenzabstandVerfahren && r.grenzabstandVerfahren.methode === 'gebaeuderechteck'
              ? `Rückversatz ${fmt(grundabstandM)} m ringsum, ${fmt(rules.grosser_grenzabstand_min_m)} m rechtwinklig zu den Südseiten des Gebäuderechtecks (Art. 18 Abs. 2, iterativ) → ${fmt(r.footprintBeforeWaldM2)} m²`
              : `Rückversatz ${fmt(grundabstandM)} m ringsum, ${fmt(rules.grosser_grenzabstand_min_m)} m an der Hauptfassaden-Parzellenkante (Näherung) → ${fmt(r.footprintBeforeWaldM2)} m²`)
          : `Rückversatz der Parzelle um ${fmt(grundabstandM)} m → ${fmt(r.footprintBeforeWaldM2)} m²`,
        art('grundabstand_min_m'),
        // Das Abzeichen folgt dem tatsaechlich verwendeten Verfahren
        // (js/app.js runSetback): Gebaeuderechteck iterativ, Parzellenkanten-
        // Naeherung oder der Ringsum-Rueckfall — je mit eigenem Registereintrag.
        null, { id: 'fussabdruck', schluessel: r.grenzabstandDegraded ? 'grosser_grenzabstand_ringsum'
          : (r.grenzabstandVerfahren && r.grenzabstandVerfahren.methode === 'gebaeuderechteck'
              ? 'grenzabstand_gebaeuderechteck_iterativ' : 'grenzabstand_parzellenkante') }),
      ...(r.mehrlaengen ? [row('Mehrlängenzuschlag', `+ ${fmt(r.mehrlaengen.requiredM - rules.grundabstand_min_m)} m`, 'BERECHNET',
        `Fassade ${fmt(r.mehrlaengen.facadeLengthM)} m > 12 m → Grenzabstand ${fmt(rules.grundabstand_min_m)} + ⅓ der Mehrlänge = ${fmt(r.mehrlaengen.requiredM)} m (Maximum ${fmt(r.mehrlaengen.capM)} m)`,
        art('mehrlaengenzuschlag'),
        null, { schluessel: 'mehrlaengenzuschlag_allseitig' })] : []),
      ...(r.waldLossInFootprintM2 > 0.5 ? [row('davon Abzug Waldabstand', `− ${fmt(r.waldLossInFootprintM2)} m²`, 'BERECHNET',
        `Schnittfläche des Fussabdrucks mit der Waldabstandslinie = ${fmt(r.waldLossInFootprintM2)} m²`,
        art('waldabstand'),
        null, { schluessel: 'waldabstand_seitenbestimmung' })] : []),
      ...(r.baulinienLossM2 > 0.5 ? [row('davon Abzug Baulinie', `− ${fmt(r.baulinienLossM2)} m²`, 'BERECHNET',
        `Schnittfläche des Fussabdrucks mit der Baulinie = ${fmt(r.baulinienLossM2)} m²`,
        art('strassenabstand_ohne_baulinien_m'), '§ 265 PBG')] : []),
      row('Bebaubarer Bereich nach Abzügen', `${fmt(r.footprintAfterWaldM2)} m²`, 'BERECHNET',
        `${fmt(r.footprintBeforeWaldM2)}${r.waldLossInFootprintM2 > 0.5 ? ` − ${fmt(r.waldLossInFootprintM2)}` : ''}` +
        `${r.baulinienLossM2 > 0.5 ? ` − ${fmt(r.baulinienLossM2)}` : ''} = ${fmt(r.footprintAfterWaldM2)} m²`,
        null, null, { id: 'bebaubar', dependsOn: ['fussabdruck'] }),
      reconciled.hasGreenCap
        ? row('Fussabdruck nach Grünflächenziffer-Deckel', `${fmt(reconciled.footprintAfterGreenCapAreaM2)} m²`, 'BERECHNET',
            `höchstens ${100 - rules.gruenflaechenziffer_min_pct} % von ${fmt(reconciled.anrechenbareFlaecheM2)} m² überbaut → ${fmt(reconciled.footprintAfterGreenCapAreaM2)} m²`,
            art('gruenflaechenziffer_min_pct'), null, { dependsOn: ['anrechenbar', 'bebaubar'] })
        : row('Grünflächenziffer-Deckel', '— keine GFZ', 'GEPRÜFT',
            `Regel geprüft und übersprungen: die BZO ${rules.gemeinde} führt für diese Zone keine Grünflächenziffer`,
            `BZO ${rules.gemeinde}`),
      ...(reconciled.hasUeberbauungsCap ? [row('Fussabdruck nach Überbauungsziffer',
        `${fmt(reconciled.footprintAfterUeberbauungsCapM2)} m²`, 'BERECHNET',
        `höchstens ${rules.ueberbauungsziffer_hauptgebaeude_max_pct} % von ${fmt(reconciled.anrechenbareFlaecheM2)} m² → ${fmt(reconciled.footprintAfterUeberbauungsCapM2)} m²`,
        art('ueberbauungsziffer_hauptgebaeude_max_pct'))] : []),
      row('Nutzbarer Fussabdruck', `${fmt(reconciled.usableFootprintAreaM2)} m²`, 'BERECHNET',
        `kleinster der vorstehenden Werte = ${fmt(reconciled.usableFootprintAreaM2)} m² — bindend: ${reconciled.bindingConstraint}`,
        null, null, { id: 'nutzbarerFussabdruck', dependsOn: ['bebaubar'] }),
    ];

    // ---- 3. AUSNÜTZUNG --------------------------------------------------
    const az = rules.ausnuetzungsziffer_max_pct;
    const ausnRows = [
      row('Max. anrechenbare Geschossfläche', `${fmt(reconciled.maxGfaM2)} m²`, 'BERECHNET',
        `${fmt(reconciled.anrechenbareFlaecheM2)} × ${(az / 100).toFixed(2)} = ${(reconciled.anrechenbareFlaecheM2 * az / 100).toFixed(3)} → ${fmt(reconciled.maxGfaM2)} m² (${az} % — bindendes Maximum)`,
        art('ausnuetzungsziffer_max_pct'), null, { id: 'maxGfa', dependsOn: ['anrechenbar'] }),
      ...(mm ? [
        // Die Geschosszahl ist eine Entwurfsentscheidung, kein Ergebnis:
        // jede Zahl zwischen dem Minimum und dem Zonenmaximum ist gleich
        // zulaessig, nur die Ueberbauung unterscheidet sich.
        // Kurzform in der Spalte, ausgeschrieben in der Herleitung: die
        // Wertspalte ist 108 px breit, und "2 Vollgeschosse + 1 Attika à
        // 180.7 m²" umbrach dort auf drei Zeilen.
        row('Bebaubar als', `${mm.ordinaryStoreys} VG${mm.attikaStoreys > 0 ? ` + ${mm.attikaStoreys} Attika` : ''} à ${fmt(mm.floorplateM2)} m²`, 'ENTWURF',
          `${fmt(mm.gfaUsedM2)} m² Geschossfläche / ${mm.ordinaryStoreys} Vollgeschoss${mm.ordinaryStoreys === 1 ? '' : 'e'} = ${fmt(mm.floorplateM2)} m² je Geschoss` +
          `${mm.attikaStoreys > 0 ? ` + ${mm.attikaStoreys} Attika (höchstens 1 je Gebäude dargestellt)` : ''} — frei wählbar bis ${mm.maxStoreys}`,
          'Entwurf', null, { dependsOn: ['maxGfa'] }),
        ...(mm.attikaStoreys > 0 || mm.ugStoreys > 0 || mm.extraDachCreditM2 > 0 ? [
          row('Freibetrag Dach-/Attika-/UG', `bis ${fmt(mm.perStoreyFreeM2)} m² je Geschoss`, 'GEPRÜFT',
            `${fmt(reconciled.maxGfaM2)} m² / ${mm.ordinaryMax} Vollgeschosse = ${fmt(mm.perStoreyFreeM2)} m² je Dach-/Attika-/Untergeschoss ohne Anrechnung an die Ausnützung` +
            `${mm.extraDachCreditM2 > 0 ? ` · 2. Dachgeschoss möglich (+${fmt(mm.extraDachCreditM2)} m², nicht dargestellt)` : ''}`,
            art('dach_attika_ug_freibetrag', 'anrechenbares_untergeschoss_max'), '§ 255 Abs. 3 PBG'),
        ] : []),
        row('Nutzbare Geschossfläche total', `${fmt(mm.nutzflaecheTotalM2)} m²`, 'BERECHNET',
          `${fmt(mm.floorplateM2 * mm.ordinaryStoreys)} (Vollgeschosse)` +
          `${mm.attikaStoreys > 0 ? ` + ${fmt(mm.attikaFloorplateM2 * mm.attikaStoreys)} (Attika)` : ''}` +
          `${mm.ugStoreys > 0 ? ` + ${fmt(mm.ugFloorplateM2 * mm.ugStoreys)} (Untergeschoss)` : ''}` +
          ` = ${fmt(mm.nutzflaecheTotalM2)} m²`,
          null, null, { id: 'nutzflaeche', dependsOn: ['maxGfa', 'nutzbarerFussabdruck'] }),
      ] : []),
    ];

    // ---- 4. VOLUMEN & HÖHEN ---------------------------------------------
    const heightProv = art(rules.heightRegime
      ? 'gebaeudehoehe_max_m_bzo2016'
      : (rules.traufseitige_fassadenhoehe_max_m != null ? 'traufseitige_fassadenhoehe_max_m' : 'gebaeudehoehe_max_m'));
    const volumenRows = [
      row(`${rules.heightMetric} max.`, `${rules.heightM} m`, 'GEHOLT',
        `Zonenwert ${rules.heightM} m${rules.heightRegime ? ' — strengeres Mass der in Kraft stehenden BZO 2016 (negative Vorwirkung, § 234 PBG)' : ''}`,
        heightProv),
      ...(mm ? [
        // Die Geschosshoehe ist hier KEINE Annahme: sie ist die zulaessige
        // Hoehe geteilt durch die zulaessige Zahl der Vollgeschosse. Beide
        // Werte stehen in der BZO.
        row('Gebäudehöhe der Baukörper', `${fmt(mm.buildingHeightM)} m`, 'BERECHNET',
          `${fmt(rules.heightM)} m / ${mm.ordinaryMax} Vollgeschosse = ${fmt(mm.ordinaryStoreyHeightM)} m je Geschoss` +
          ` × ${mm.ordinaryStoreys}${mm.attikaStoreys > 0 ? ` + ${mm.attikaStoreys} × ${fmt(mm.attikaStoreyHeightM)} m Attika` : ''}` +
          ` = ${fmt(mm.buildingHeightM)} m`,
          heightProv),
        // Ohne firsthoehe_zuschlag_m gibt es kein Hoehenbudget fuer die
        // Attika in den Daten — dann greift ersatzweise die gewoehnliche
        // Geschosshoehe. Das ist eine Werkzeug-Annahme und wird so benannt.
        ...(mm.attikaStoreys > 0 && !mm.attikaHeightIsModelled ? [
          row('Attikahöhe', `${fmt(mm.attikaStoreyHeightM)} m`, 'ANNAHME',
            `Kein Höhenzuschlag für das Dachprofil in den Daten dieser Gemeinde — ersatzweise die gewöhnliche Geschosshöhe ${fmt(mm.ordinaryStoreyHeightM)} m angesetzt. Werkzeug-Annahme, kein Rechtswert.`,
            'Werkzeug-Annahme', null, { id: 'attikahoehe', schluessel: 'attika_ersatzhoehe' }),
        ] : []),
        row('Umbauter Raum (gebaut)', `${fmt(mm.volumeM3)} m³`, 'BERECHNET',
          `${fmt(mm.floorplateM2)} m² × ${fmt(mm.buildingHeightM)} m Bauhöhe = ${fmt(mm.volumeM3)} m³` +
          (mm.hullVolumeM3 > mm.volumeM3 * 1.02
            ? ` · maximale Hülle wäre ${fmt(mm.hullVolumeM3)} m³ (ganzer Fussabdruck × ${fmt(rules.heightM)} m)` : ''),
          null, null, { id: 'volumen', dependsOn: ['nutzbarerFussabdruck'] }),
      ] : []),
      ...(r.lengthLimitM != null ? [row('Max. Gebäudelänge', `${r.lengthLimitM} m`, 'GEHOLT', null,
        art('gesamtlaenge_max_m', 'gebaeudelaenge_inkl_klein_anbauten_max_m'))] : []),
      ...(r.massing && !r.massing.impossible
        ? [
            row('Länge dieses Bereichs', `${fmt(r.areaRect.lengthM)} m`, 'BERECHNET',
              `${fmt(r.areaRect.lengthM)} m > ${r.lengthLimitM} m — zu lang für einen Baukörper`),
            row('Aufteilung in Baukörper', `${r.massing.count} × ${fmt(r.massing.blockLengthM)} m`, 'BERECHNET',
              `${r.massing.count} Baukörper von je ${fmt(r.massing.blockLengthM)} m, Gebäudeabstand ${r.gebaeudeabstandM} m = 2 × Grundabstand ${fmt(grundabstandM)} m — kostet ${fmt(r.lengthLossM2)} m² Stellfläche`,
              '§ 271 PBG'),
          ]
        : (r.footprintRect ? [row('Länge × Breite (kleinstes Rechteck)',
            `${fmt(r.footprintRect.lengthM)} × ${fmt(r.footprintRect.widthM)} m`,
            r.lengthLimitM != null ? 'GEPRÜFT' : 'BERECHNET',
            r.lengthLimitM != null
              ? `${fmt(r.footprintRect.lengthM)} m ≤ ${r.lengthLimitM} m → eingehalten (flächenkleinstes umschliessendes Rechteck)`
              : `flächenkleinstes umschliessendes Rechteck ${fmt(r.footprintRect.lengthM)} × ${fmt(r.footprintRect.widthM)} m`,
            r.lengthLimitM != null ? art('gesamtlaenge_max_m', 'gebaeudelaenge_inkl_klein_anbauten_max_m') : null)] : [])),
      row('Gewachsenes Terrain (Referenzpunkt)',
        terrainHeight != null ? `${fmt(terrainHeight)} m ü. M.` : '— nicht erreichbar',
        terrainHeight != null ? 'GEHOLT' : 'ANNAHME',
        terrainHeight != null
          ? `Höhenabfrage swissALTI3D am Bezugspunkt der Parzelle = ${fmt(terrainHeight)} m ü. M.`
          : 'Höhendienst nicht erreichbar — die Höhen sind ohne Terrainbezug gerechnet, manuell prüfen',
        terrainHeight != null ? 'swissALTI3D' : 'Quelle ausgefallen',
        null, { quelleAusgefallen: terrainHeight == null }),
      ...(r.hang ? [row('Terrainneigung', `${fmt(r.hang.slopePercent, 0)} % ${compassLabel(r.hang.uphillBearingDeg)}`,
        'BERECHNET',
        `Ebene durch 7 × 7 Höhenpunkte über der Parzelle: ${fmt(r.hang.slopePercent, 0)} % Gefälle, bergwärts Richtung ${compassLabel(r.hang.uphillBearingDeg)}` +
        `${r.hang.isHang ? ' — als Hanglage behandelt (≥ 10 %)' : ''}`,
        'swissALTI3D')] : []),
    ];

    const gruppen = [
      { title: 'PARZELLE', note: `${rules.gemeinde} · ogd-0156`, rows: parzelleRows },
      { title: 'ABZÜGE & FUSSABDRUCK', note: `Grundabstand ${fmt(grundabstandM)} m`, rows: abzugRows },
      { title: 'AUSNÜTZUNG', note: `AZ ${(az / 100).toFixed(2)} · bindend`, rows: ausnRows },
      { title: 'VOLUMEN & HÖHEN', note: terrainHeight != null ? `Referenz ${fmt(terrainHeight)} m ü. M.` : 'ohne Terrainbezug', rows: volumenRows },
    ];

    // Vererbung ueber ALLE Zeilen, nicht je Gruppe: der Umbaute Raum steht in
    // VOLUMEN, haengt aber am Nutzbaren Fussabdruck in ABZUEGE. Ein Durchlauf
    // in Ableitungsreihenfolge genuegt, weil die Zeilen in dieser Reihenfolge
    // gebaut sind — eine Zeile haengt nie an einer spaeteren.
    T.vererbeSicherheit(gruppen.flatMap((g) => g.rows));
    return gruppen;
  }

  T.buildKennwerte = buildKennwerte;
  T.KENNWERT_KINDS = KINDS;
})();
