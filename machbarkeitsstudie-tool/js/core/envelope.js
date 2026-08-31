// envelope.js — reconcile setback vs Grünflächenziffer vs Überbauungsziffer
// vs Ausnützungsziffer, report which constraint actually binds, and turn the
// reconciled numbers into a buildable massing.
//
// Legal basis of the arithmetic here:
//   § 255 Abs. 1 PBG  — AZ = anrechenbare Geschossfläche / anrechenbare
//                       Grundstücksfläche (NOT the raw parcel area).
//   § 255 Abs. 3 PBG  — Dach-, Attika- und Untergeschosse sind erst
//                       anrechenbar, soweit sie je Geschoss die Fläche
//                       überschreiten, die sich bei gleichmässiger Aufteilung
//                       der gesamten zulässigen Ausnützung auf die zulässige
//                       Vollgeschosszahl ergäbe (per-storey free allowance).
//   § 256 PBG         — Überbauungsziffer as a hard footprint cap.
//   § 257 PBG         — Grünflächenziffer.
//   § 259 PBG / § 259 aPBG — which ground area counts (Bauzone only;
//                       old law also deducts Wald and offene Gewässer).
window.MachbarkeitTool = window.MachbarkeitTool || {};

(function () {
  const fmt = (n, d = 1) => window.MachbarkeitTool.fmt(n, d);

  // ---- Nutzbare Geschossflaeche: der Freibetrag trifft die Geometrie ----
  // § 255 Abs. 3 PBG stellt Dach-, Attika- und Untergeschosse je Geschoss
  // bis zum Freibetrag anrechnungsfrei — er sagt aber nicht, dass diese
  // Flaeche BAUBAR ist. Fuer die Attika begrenzt Art. 31 BZO (45°-Profil)
  // die Form: auf Zumikon 5030 laesst das Profil 79.9 m² zu, der Freibetrag
  // betruege 180.7 m². Bis zum 31.08.2026 zaehlte die nutzbare
  // Geschossflaeche den vollen Freibetrag (722.8 m²) — eine Flaeche, die
  // das eigene Attika-Blatt bestreitet. Regel jetzt: je Geschoss
  // min(Freibetrag, geometrisch darstellbare Flaeche) → 5030: 622.0 m².
  //
  // Aufgerufen aus js/app.js, NACHDEM computeAttikaFootprints die
  // geometrische Attika bestimmt hat (mm.attikaFootplateM2). Ohne
  // Geometrie (reine Modellrechnung, kein Baukoerper) bleibt der
  // Freibetrag stehen — es gibt dann keine Grenze zu kennen. UG bleibt
  // unveraendert: es liegt UNTER dem Baukoerper, seine Geometrie ist die
  // Grundflaeche selbst. attikaFloorplateM2 (Rechtsgroesse des Freibetrags)
  // und das Volumen bleiben unveraendert — hier aendert allein die
  // GESCHOSSFLAECHEN-Summe und was von ihr abgeleitet wird (Parkierung).
  function begrenzeAttikaAufGeometrie(mm) {
    if (!mm || !(mm.attikaStoreys > 0)) return mm;
    if (!Number.isFinite(mm.attikaFootplateM2)) return mm;
    const freiM2 = mm.attikaFloorplateM2;
    const geometrischM2 = mm.attikaFootplateM2;
    mm.attikaNutzM2 = Math.min(freiM2, geometrischM2);
    if (geometrischM2 >= freiM2 - 0.05) return mm; // der Freibetrag bindet ohnehin
    mm.attikaGeometrischBegrenzt = true;
    mm.attikaFreibetragUngenutztM2 = freiM2 - mm.attikaNutzM2;
    mm.nutzflaecheTotalM2 =
      mm.floorplateM2 * mm.ordinaryStoreys +
      mm.attikaNutzM2 * mm.attikaStoreys +
      mm.ugFloorplateM2 * mm.ugStoreys;
    return mm;
  }
  window.MachbarkeitTool.begrenzeAttikaAufGeometrie = begrenzeAttikaAufGeometrie;

  // ---- Fuer sich allein faktisch nicht bebaubar -------------------------
  // Eine Restflaeche kann rechnerisch bestehen und trotzdem kein Gebaeude
  // tragen: Zumikon 5028 behaelt nach Grundabstand und Waldabstand 36.7 m²
  // Fussabdruck — aber als Streifen von 2.7 m Tiefe. Das als «Realistisches
  // Szenario» auszuweisen ist eine Zusage, die die Zahl nicht deckt.
  //
  // Schwelle ist MIN_PRIMITIVE_WIDTH_M (3.5 m), dieselbe Werkzeug-Annahme,
  // mit der die Baukoerper-Suche eine zu schmale Scheibe verwirft
  // (js/core/coordinates.js) — kein zweiter, eigens erfundener Grenzwert.
  // Sie ist ausdruecklich KEIN Rechtswert: ein solcher Streifen ist nicht
  // verboten, er ist bloss kein Gebaeude. Deshalb wechselt hier nur die
  // Beschriftung; keine Zahl der Auswertung aendert sich.
  //
  // Gemessen wird am flaechenkleinsten Rechteck (footprintRect), nicht am
  // achsparallelen Umschlag: ein diagonal liegender Streifen haette dort
  // eine grosse «Tiefe» und ginge durch.
  function faktischNichtBebaubar(r) {
    const T = window.MachbarkeitTool;
    const flaecheM2 = r.reconciled ? r.reconciled.usableFootprintAreaM2 : 0;
    if (!(flaecheM2 > 0)) return { ja: false, grund: null, tiefeM: null, flaecheM2: 0 };
    const rect = r.footprintRect;
    if (!rect || !isFinite(rect.widthM)) return { ja: false, grund: null, tiefeM: null, flaecheM2 };
    const tiefeM = Math.min(rect.widthM, rect.lengthM);
    if (tiefeM >= T.MIN_PRIMITIVE_WIDTH_M - 1e-6) {
      return { ja: false, grund: null, tiefeM, flaecheM2 };
    }
    return {
      ja: true, tiefeM, flaecheM2,
      grund: `Der bebaubare Rest misst ${fmt(rect.lengthM)} \u00d7 ${fmt(tiefeM)} m — `
        + `bei ${fmt(flaecheM2, 0)} m² Fl\u00e4che ist er ein Streifen, kein Baufeld. `
        + `Unter ${T.MIN_PRIMITIVE_WIDTH_M} m Tiefe l\u00e4sst sich kein Geb\u00e4ude mehr anordnen `
        + `(Werkzeug-Annahme, kein Rechtswert). Die Zahlen dieses Abschnitts bleiben `
        + `unver\u00e4ndert g\u00fcltig; sie beschreiben eine Fl\u00e4che, keinen Bauk\u00f6rper.`,
    };
  }

  // ---- Warum keine Attika: EIN Wortlaut, drei Ausgabestellen ------------
  // Lag bis zum 31.8.2026 in js/app.js und war damit nur am Bildschirm zu
  // haben; der PDF-Export baute sich seine eigene Formulierung. Hier, weil
  // die Diagnose an mm haengt und weil sowohl app.js (Regelfahne,
  // Variantenkarte) als auch print.js (Variantenkarte) sie brauchen.
  //
  // Negative Zahlen werden NIE ausgegeben. Ist der Ruecksprung tiefer als
  // der halbe Baukoerper, ist die Restbreite rechnerisch negativ (5028:
  // 2.7 m − 2 \u00d7 2.25 m = −1.8 m). «14.3 \u00d7 −1.8 m» in einem Kundendokument ist
  // keine Aussage, sondern ein durchgereichter Zwischenwert: eine Strecke
  // kann nicht negativ sein. Gesagt wird deshalb, was zutrifft — es bleibt
  // nichts uebrig — mit dem Mindestmass als Massstab.
  function attikaRestM(mm) {
    const d = (mm && mm.attikaDiagnostics || [])[0];
    return d ? Math.max(0, d.narrowestM) : null;
  }
  function attikaSuppressReason(mm) {
    const T = window.MachbarkeitTool;
    const d = (mm.attikaDiagnostics || [])[0];
    if (!d) return 'Attika zonenrechtlich zul\u00e4ssig, geometrisch nicht darstellbar';
    const rest = Math.max(0, d.narrowestM);
    return d.bergseite
      ? `Attika zul\u00e4ssig, aber nicht darstellbar: bergseitig fassadenb\u00fcndig, \u00fcbrige Seiten ${fmt(mm.attikaSetbackM)} m R\u00fccksprung — bleiben ${fmt(rest)} m, min. ${T.MIN_PRIMITIVE_WIDTH_M} m n\u00f6tig`
      : `Attika zul\u00e4ssig, aber nicht darstellbar: 45°-R\u00fccksprung ${fmt(mm.attikaSetbackM)} m je Seite l\u00e4sst von ${fmt(d.belowWidthM)} m Bauk\u00f6rpertiefe nur ${fmt(rest)} m — min. ${T.MIN_PRIMITIVE_WIDTH_M} m n\u00f6tig`;
  }
  function attikaSuppressShort(mm) {
    const T = window.MachbarkeitTool;
    const d = (mm.attikaDiagnostics || [])[0];
    if (!d) return 'geometrisch nicht darstellbar';
    return `45°-Profil l\u00e4sst nur ${fmt(Math.max(0, d.narrowestM))} m Tiefe — min. ${T.MIN_PRIMITIVE_WIDTH_M} m n\u00f6tig`;
  }

  // Die Rechnung hinter dem Verdikt, ausgeschrieben — fuer die Hinweisseite.
  // Bleibt nach dem Ruecksprung nichts uebrig, wird das GESAGT statt eine
  // negative Kantenlaenge gedruckt.
  function attikaSuppressRechnung(mm) {
    const T = window.MachbarkeitTool;
    const d = (mm.attikaDiagnostics || [])[0];
    if (!d) return '';
    const sb = mm.attikaSetbackM;
    if (d.bergseite) {
      return ` Bauk\u00f6rper ${fmt(d.belowLengthM)} \u00d7 ${fmt(d.belowWidthM)} m; auf der Bergseite ist die Wand`
        + ` fassadenb\u00fcndig, die drei \u00fcbrigen Seiten je ${fmt(sb)} m zur\u00fcck — bleiben`
        + ` ${fmt(Math.max(0, d.narrowestM))} m schmalste Ausdehnung.`;
    }
    const restL = d.belowLengthM - 2 * sb, restW = d.belowWidthM - 2 * sb;
    if (restL <= 0 || restW <= 0) {
      // Der Ruecksprung ist tiefer als der halbe Baukoerper: die beiden
      // Seiten treffen sich, bevor eine Restflaeche entsteht.
      return ` Bauk\u00f6rper ${fmt(d.belowLengthM)} \u00d7 ${fmt(d.belowWidthM)} m: der R\u00fccksprung von`
        + ` ${fmt(sb)} m auf allen vier Seiten verbraucht die Tiefe von ${fmt(d.belowWidthM)} m`
        + ` vollst\u00e4ndig (${fmt(sb)} m + ${fmt(sb)} m). Es bleibt keine Restfl\u00e4che —`
        + ` n\u00f6tig w\u00e4ren mindestens ${T.MIN_PRIMITIVE_WIDTH_M} m.`;
    }
    return ` Bauk\u00f6rper ${fmt(d.belowLengthM)} \u00d7 ${fmt(d.belowWidthM)} m minus ${fmt(sb)} m auf allen`
      + ` vier Seiten ergibt ${fmt(restL)} \u00d7 ${fmt(restW)} m, also nur`
      + ` ${fmt(Math.max(0, d.narrowestM))} m schmalste Ausdehnung.`;
  }

  window.MachbarkeitTool.faktischNichtBebaubar = faktischNichtBebaubar;
  window.MachbarkeitTool.attikaRestM = attikaRestM;
  window.MachbarkeitTool.attikaSuppressReason = attikaSuppressReason;
  window.MachbarkeitTool.attikaSuppressShort = attikaSuppressShort;
  window.MachbarkeitTool.attikaSuppressRechnung = attikaSuppressRechnung;

  // Die Zahlen jeder Geschossvariante — EINMAL gerechnet, konsumiert von den
  // Varianten-Karten am Bildschirm (js/app.js) UND vom Variantenblock des
  // PDF-Exports (js/ui/print.js). Dieselbe Arithmetik zweimal zu führen ist
  // die Driftklasse, vor der CLAUDE.md §1 warnt. AZ wird nur von den
  // Vollgeschossen verbraucht (§ 255 Abs. 2/3 PBG), deshalb teilt `plateM2`
  // durch `ordinary`, nie durch die Gesamtgeschosszahl.
  function storeyVariantData(mm, reconciled) {
    if (!mm || !mm.storeyOptions || mm.storeyOptions.length < 2) return [];
    return mm.storeyOptions.map((n) => {
      const ordinary = Math.min(n, mm.ordinaryMax);
      const attika = Math.max(0, n - mm.ordinaryMax);
      const plateM2 = Math.min(reconciled.maxGfaM2, reconciled.usableFootprintAreaM2 * ordinary) / ordinary;
      const coveragePct = plateM2 / reconciled.parcelAreaM2 * 100;
      // Ob eine Attika das 45°-Profil überlebt, ist nur für die tatsächlich
      // gebaute Option bekannt (ihr Fussabdruck entscheidet) — deshalb trägt
      // nur die gewählte Karte das Verdikt.
      const suppressed = !!mm.attikaSuppressed && n === mm.requestedStoreys;
      const heightM = ordinary * mm.ordinaryStoreyHeightM
        + (suppressed ? 0 : attika) * mm.attikaStoreyHeightM;
      const active = n === (mm.requestedStoreys != null ? mm.requestedStoreys : mm.storeys);
      return { n, ordinary, attika, plateM2, coveragePct, heightM, suppressed, active };
    });
  }
  window.MachbarkeitTool.storeyVariantData = storeyVariantData;

  // parcelAreaM2:         raw merged geometry area.
  // anrechenbareFlaecheM2: reference area per § 255/259 PBG — parcel area minus
  //   the deductions in `flaechenAbzuege` (forest, water, non-Bauzone parts).
  //   Falls back to parcelAreaM2 when no deduction could be computed; the
  //   caller flags that case.
  // setbackFootprintAreaM2: area left after Grenzabstand/Wald/Baulinien cuts,
  //   or 0 if the setback consumed the whole parcel (a real, valid outcome
  //   for small/narrow parcels, not an error).
  // rules: the object from rules.js getZoneRules().
  function reconcileEnvelope({ parcelAreaM2, anrechenbareFlaecheM2, flaechenAbzuege, setbackFootprintAreaM2, rules }) {
    const refAreaM2 = anrechenbareFlaecheM2 != null ? anrechenbareFlaecheM2 : parcelAreaM2;

    // Not every commune has a Grünflächenziffer (Zumikon's BZO doesn't).
    // Absent means the constraint doesn't exist -- it must NOT be read as 0%
    // (which would cap the footprint at the whole parcel and look like a
    // binding constraint), nor as 100% (which would forbid building).
    const hasGreenCap = rules.gruenflaechenziffer_min_pct != null;
    const footprintAfterGreenCapAreaM2 = hasGreenCap
      ? refAreaM2 * (1 - rules.gruenflaechenziffer_min_pct / 100)
      : Infinity;

    // Überbauungsziffer (§ 256 PBG; Art. 62 E-BZO for W2bI-III): hard cap on
    // the Hauptgebäude footprint relative to the anrechenbare Grundstücksfläche.
    const hasUeberbauungsCap = rules.ueberbauungsziffer_hauptgebaeude_max_pct != null;
    const footprintAfterUeberbauungsCapM2 = hasUeberbauungsCap
      ? refAreaM2 * (rules.ueberbauungsziffer_hauptgebaeude_max_pct / 100)
      : Infinity;

    const candidates = [
      ['grundabstand', setbackFootprintAreaM2],
      ['gruenflaechenziffer', footprintAfterGreenCapAreaM2],
      ['ueberbauungsziffer', footprintAfterUeberbauungsCapM2],
    ];
    let footprintLevelBinding = candidates[0][0];
    let usableFootprintAreaM2 = candidates[0][1];
    for (const [name, area] of candidates) {
      if (area < usableFootprintAreaM2) { footprintLevelBinding = name; usableFootprintAreaM2 = area; }
    }

    const maxGfaM2 = refAreaM2 * (rules.ausnuetzungsziffer_max_pct / 100);
    const gfaIfAllFloorsBuiltM2 = usableFootprintAreaM2 * rules.vollgeschosse_max;

    let bindingConstraint;
    let achievableFloors;
    let fullFloorsAchievable;

    if (usableFootprintAreaM2 <= 0) {
      // Setback (and/or a footprint cap) consumed the entire parcel -- nothing
      // buildable at all. Real outcome for small/narrow lots, must surface
      // clearly rather than silently divide by zero downstream.
      bindingConstraint = footprintLevelBinding;
      achievableFloors = 0;
      fullFloorsAchievable = false;
    } else if (gfaIfAllFloorsBuiltM2 > maxGfaM2) {
      bindingConstraint = 'ausnuetzungsziffer';
      achievableFloors = maxGfaM2 / usableFootprintAreaM2; // fractional, report as-is
      fullFloorsAchievable = false;
    } else {
      bindingConstraint = footprintLevelBinding;
      achievableFloors = rules.vollgeschosse_max;
      fullFloorsAchievable = true;
    }

    return {
      parcelAreaM2,
      anrechenbareFlaecheM2: refAreaM2,
      flaechenAbzuege: flaechenAbzuege || null,
      setbackFootprintAreaM2,
      hasGreenCap,
      footprintAfterGreenCapAreaM2,
      hasUeberbauungsCap,
      footprintAfterUeberbauungsCapM2,
      usableFootprintAreaM2,
      maxGfaM2,
      gfaIfAllFloorsBuiltM2,
      bindingConstraint, // 'grundabstand' | 'gruenflaechenziffer' | 'ueberbauungsziffer' | 'ausnuetzungsziffer'
      achievableFloors,
      fullFloorsAchievable,
    };
  }

  // Turns the reconciled numbers into a buildable massing, rather than the
  // maximum legal hull.
  //
  //   ordinary storeys = a CHOICE, not a result. Any count from the fewest
  //               that can hold the permitted GFA up to the zone maximum is
  //               equally lawful; only the ground coverage differs.
  //   floorplate= permitted GFA / ordinary storeys, never more than the
  //               available footprint.
  //   Attika / Untergeschoss: NOT charged against the AZ up to the § 255
  //               Abs. 3 free allowance of (maxGfa / Vollgeschosszahl) per
  //               storey. At the default floorplate the Attika (smaller than
  //               a full storey) is therefore fully free — the previous
  //               version of this tool charged it against the AZ and
  //               under-reported the achievable floor area.
  //
  // Only the Attikageschoss is modelled as a drawable storey (a flat-roofed,
  // set-back top storey). A pitched-roof Dachgeschoss is a distinct concept
  // (Kniestock, roof pitch — no data here) and is not drawn; where the BZO
  // credits 2 Dach-/Attikageschosse (Zumikon), only 1 is drawn as Attika and
  // the second is reported as additional creditable floor area, not geometry.
  //
  // Attika height budget: Zumikon's firsthoehe_zuschlag_m is the ADDITIONAL
  // height the roof profile may rise above the Gebäudehöhe line (§ 281 aPBG:
  // 45° planes from the Schnittlinie, up to the BZO's Firsthöhe plane). The
  // Attika storey must fit inside that budget.
  function buildMassingModel({ footprintFeature, reconciled, rules, storeysOverride }) {
    const available = reconciled.usableFootprintAreaM2;
    const ordinaryMax = rules.vollgeschosse_max;
    if (!footprintFeature || available <= 0 || !ordinaryMax) return null;

    const attikaCreditable = rules.anrechenbares_dach_attika_max || 0;
    const attikaMax = Math.min(attikaCreditable, 1); // only 1 drawable flat-roof Attika
    const ugMax = rules.anrechenbares_untergeschoss_max || 0;
    const maxStoreys = ordinaryMax + attikaMax;
    const ordinaryStoreyHeightM = rules.heightM / ordinaryMax;

    // § 255 Abs. 3 PBG: per-storey free allowance for Dach-/Attika-/Untergeschosse.
    const perStoreyFreeM2 = reconciled.maxGfaM2 / ordinaryMax;

    // Attika height: firsthoehe_zuschlag_m (Zumikon, altrechtlich) is the
    // budget above the Gebäudehöhe line. Where absent (Zürich E-BZO regime:
    // the Attika must fit under the Gesamthöhe/roof rules not modelled here)
    // fall back to the ordinary storey height, flagged as an estimate.
    const attikaHeightIsModelled = rules.firsthoehe_zuschlag_m != null;
    const attikaBudgetM = attikaHeightIsModelled
      ? rules.firsthoehe_zuschlag_m
      : ordinaryStoreyHeightM * attikaMax;
    const attikaStoreyHeightM = attikaMax > 0 ? Math.min(attikaBudgetM, ordinaryStoreyHeightM) : 0;

    // Fewest ordinary storeys that can hold the permitted GFA.
    const minOrdinary = Math.min(ordinaryMax, Math.max(1, Math.ceil(reconciled.maxGfaM2 / available - 1e-9)));
    const minStoreys = Math.min(maxStoreys, minOrdinary);
    // Default to the maximum the zone allows, Attika included -- this is a
    // Machbarkeitsstudie, so the question it answers first is how much volume
    // is possible here. Fewer storeys stay one click away in the picker.
    const storeys = Math.min(maxStoreys, Math.max(minStoreys, storeysOverride || maxStoreys));
    const ordinaryStoreys = Math.min(storeys, ordinaryMax);
    const attikaStoreys = Math.max(0, storeys - ordinaryMax);
    const storeyHeightM = ordinaryStoreyHeightM; // kept for callers that only care about the ordinary case
    const buildingHeightM = ordinaryStoreys * ordinaryStoreyHeightM + attikaStoreys * attikaStoreyHeightM;

    // AZ quota is spent by the ordinary storeys only (§ 255 Abs. 2/3 PBG).
    const gfaUsedM2 = Math.min(reconciled.maxGfaM2, available * ordinaryStoreys);
    const floorplateM2 = gfaUsedM2 / ordinaryStoreys;
    // Attika/UG floorplates: free of charge up to the § 255 Abs. 3 allowance;
    // this schematic model never draws them larger than that (the geometric
    // Attika from the 45° profile can be smaller — app.js reconciles).
    const attikaFloorplateM2 = attikaStoreys > 0 ? Math.min(floorplateM2, perStoreyFreeM2) : 0;
    const ugFloorplateM2 = ugMax > 0 ? Math.min(floorplateM2, perStoreyFreeM2) : 0;
    // Second creditable Dachgeschoss (Zumikon: anrechenbares_dach_attika_max 2)
    // — creditable floor area that is not drawn as a storey.
    const extraDachCreditM2 = attikaCreditable > attikaMax
      ? (attikaCreditable - attikaMax) * Math.min(floorplateM2, perStoreyFreeM2)
      : 0;
    const nutzflaecheTotalM2 =
      floorplateM2 * ordinaryStoreys +
      attikaFloorplateM2 * attikaStoreys +
      ugFloorplateM2 * ugMax;

    const scale = Math.min(1, floorplateM2 / available);

    return {
      storeys,
      minStoreys,
      maxStoreys,
      ordinaryMax, attikaMax, ordinaryStoreys, attikaStoreys,
      ugStoreys: ugMax,
      ordinaryStoreyHeightM, attikaStoreyHeightM, attikaHeightIsModelled,
      perStoreyFreeM2,
      attikaFloorplateM2,
      ugFloorplateM2,
      extraDachCreditM2,
      nutzflaecheTotalM2,
      storeyOptions: Array.from({ length: maxStoreys - minStoreys + 1 }, (_, i) => minStoreys + i),
      storeyHeightM,
      buildingHeightM,
      floorplateM2,
      gfaUsedM2,
      // Volume of the storeys actually built, not of the legal hull. Ordinary
      // storeys carry the full floorplate; the Attika its own smaller plate.
      volumeM3: floorplateM2 * ordinaryStoreys * ordinaryStoreyHeightM +
        attikaFloorplateM2 * attikaStoreys * attikaStoreyHeightM,
      hullVolumeM3: available * rules.heightM,
      footprintScale: scale,
      // Linear scale to apply to the footprint outline to reach the floorplate.
      linearScale: Math.sqrt(scale),
      gfaFullyUsed: gfaUsedM2 >= reconciled.maxGfaM2 - 0.5,
    };
  }

  // The Attika storey is a legal possibility until the geometry says
  // otherwise: the 45° profile of Art. 31 can eat the whole top storey on a
  // narrow Baukörper (a 7.3 m deep block minus 2 × 2.25 m Rücksprung leaves
  // 2.8 m). app.js discovers that only after the footprint exists, and when
  // it does, EVERY number derived from the Attika has to go with it --
  // otherwise the panel reports a 9.8 m building, its volume and its floor
  // area while the model draws a 6.5 m box, and the 3D height dimension
  // hangs in the air above the roof. Called from app.js the moment
  // computeAttikaFootprints comes back empty.
  //
  // requestedStoreys keeps what the user actually picked, so the storey
  // picker can still show that choice as active and label it as not
  // representable instead of silently jumping the highlight one card back.
  function suppressAttikaStorey(mm) {
    if (!mm || mm.attikaStoreys <= 0) return mm;
    mm.requestedStoreys = mm.storeys;
    mm.attikaSuppressed = true;
    mm.storeys = mm.ordinaryStoreys;
    mm.attikaStoreys = 0;
    mm.attikaFloorplateM2 = 0;
    mm.buildingHeightM = mm.ordinaryStoreys * mm.ordinaryStoreyHeightM;
    mm.nutzflaecheTotalM2 = mm.floorplateM2 * mm.ordinaryStoreys + mm.ugFloorplateM2 * mm.ugStoreys;
    mm.volumeM3 = mm.floorplateM2 * mm.ordinaryStoreys * mm.ordinaryStoreyHeightM;
    return mm;
  }

  window.MachbarkeitTool.buildMassingModel = buildMassingModel;
  window.MachbarkeitTool.suppressAttikaStorey = suppressAttikaStorey;
  window.MachbarkeitTool.reconcileEnvelope = reconcileEnvelope;
})();
