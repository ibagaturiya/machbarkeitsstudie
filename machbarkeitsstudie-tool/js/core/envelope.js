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
