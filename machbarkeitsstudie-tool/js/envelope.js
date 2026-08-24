// envelope.js — section 3 step 8: reconcile setback vs Grünflächenziffer vs
// Ausnützungsziffer, report which constraint actually binds.
window.MachbarkeitTool = window.MachbarkeitTool || {};

(function () {
  // parcelAreaM2: from planarAreaLV95(parcel geometry).
  // setbackFootprintAreaM2: from planarAreaLV95(bufferLV95(parcel, -grundabstand)),
  //   or 0 if bufferLV95 returned null (setback consumed the whole parcel --
  //   a real, valid outcome for small/narrow parcels, not an error).
  // rules: the object from rules.js getZoneRules() (needs gruenflaechenziffer_min_pct,
  //   ausnuetzungsziffer_max_pct, vollgeschosse_max).
  function reconcileEnvelope({ parcelAreaM2, setbackFootprintAreaM2, rules }) {
    // Not every commune has a Grünflächenziffer (Zumikon's BZO doesn't).
    // Absent means the constraint doesn't exist -- it must NOT be read as 0%
    // (which would cap the footprint at the whole parcel and look like a
    // binding constraint), nor as 100% (which would forbid building).
    const hasGreenCap = rules.gruenflaechenziffer_min_pct != null;
    const footprintAfterGreenCapAreaM2 = hasGreenCap
      ? parcelAreaM2 * (1 - rules.gruenflaechenziffer_min_pct / 100)
      : Infinity;

    const footprintLevelBinding =
      setbackFootprintAreaM2 <= footprintAfterGreenCapAreaM2 ? 'grundabstand' : 'gruenflaechenziffer';
    const usableFootprintAreaM2 = Math.min(setbackFootprintAreaM2, footprintAfterGreenCapAreaM2);

    const maxGfaM2 = parcelAreaM2 * (rules.ausnuetzungsziffer_max_pct / 100);
    const gfaIfAllFloorsBuiltM2 = usableFootprintAreaM2 * rules.vollgeschosse_max;

    let bindingConstraint;
    let achievableFloors;
    let fullFloorsAchievable;

    if (usableFootprintAreaM2 <= 0) {
      // Setback (and/or green cap) consumed the entire parcel -- nothing
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
      setbackFootprintAreaM2,
      hasGreenCap,
      footprintAfterGreenCapAreaM2,
      usableFootprintAreaM2,
      maxGfaM2,
      gfaIfAllFloorsBuiltM2,
      bindingConstraint, // 'grundabstand' | 'gruenflaechenziffer' | 'ausnuetzungsziffer'
      achievableFloors,
      fullFloorsAchievable,
    };
  }

  // Turns the reconciled numbers into a buildable massing, rather than the
  // maximum legal hull.
  //
  // The hull -- whole footprint extruded to the full permitted height -- is
  // what the zone allows in the abstract, but where the Ausnützungsziffer
  // binds it cannot be filled: on the Zumikon test case it is ~2.6x the floor
  // area actually permitted, which made the cost estimate overstate by the
  // same factor. So the model here spends the permitted GFA instead:
  //
  //   storeys   = a CHOICE, not a result. Any count from the fewest that can
  //               hold the GFA up to the zone maximum is equally lawful and
  //               yields exactly the same floor area and the same volume --
  //               only the ground coverage differs. Defaults to the zone
  //               maximum (smallest footprint, most open ground), and the
  //               caller can override it;
  //   floorplate= GFA / storeys, never more than the available footprint;
  //   height    = storeys x storey height (permitted height / permitted storeys).
  //
  // Deliberately schematic: it spreads the floorplate evenly over the
  // available footprint shape rather than choosing where the building sits.
  //
  // Vollgeschosse are not the whole story: rules.js's anrechenbares_dach_
  // attika_max (from the BZO) counts additional Dach-/Attikageschosse the
  // zone credits on top -- e.g. Zumikon's BZO allows up to 2 (a Dachgeschoss
  // AND an Attikageschoss are separate concepts there), Zürich W3 allows 1.
  // This tool only models the Attikageschoss specifically (a flat-roofed,
  // set-back top storey subject to the rules below) -- a Dachgeschoss (built
  // into a pitched roof, governed by different rules: Kniestock height, roof
  // pitch, none of which this tool has data for) is a distinct thing it does
  // not attempt. So the SELECTABLE Attika count is capped at 1 regardless of
  // what the BZO field says is creditable in total -- "es ist strengstens
  // maximal 1 Attikageschoss pro Gebäude erlaubt" is the general cantonal
  // rule of thumb, and conflating it with a second Dachgeschoss storey drawn
  // the same way would overstate what's actually a flat-roofed Attika.
  //
  // Height budget: Zumikon's firsthoehe_max_m (the ridge height cap) minus
  // the ordinary Gebäudehöhe, when that field is larger (it usually isn't --
  // Firsthöhe is often a SEPARATE, smaller figure measured from a different
  // reference, not "ordinary height + attika headroom"; where it doesn't fit
  // that reading the ordinary storey height is reused as a placeholder,
  // flagged in the returned object so callers can say so rather than
  // presenting it as precise.
  //
  // What IS geometrically modelled now (see app.js, which has the actual
  // rectangle geometry buildMassingModel doesn't): the 45° roof-line
  // (kantonales Recht) sets the minimum setback on all four sides equal to
  // the Attika's own height (tan 45° = 1), and the resulting footprint is
  // additionally capped at 60% of the storey below's. What is NOT modelled:
  // the Bergseite exception (facade-flush on the uphill side for up to 2/3
  // of that facade), which app.js applies where the terrain plane fit puts
  // the parcel at 10% or steeper.
  function buildMassingModel({ footprintFeature, reconciled, rules, storeysOverride }) {
    const available = reconciled.usableFootprintAreaM2;
    const ordinaryMax = rules.vollgeschosse_max;
    if (!footprintFeature || available <= 0 || !ordinaryMax) return null;

    const attikaMax = Math.min(rules.anrechenbares_dach_attika_max || 0, 1);
    const maxStoreys = ordinaryMax + attikaMax;
    const ordinaryStoreyHeightM = rules.heightM / ordinaryMax;
    const attikaHeightIsModelled = rules.firsthoehe_max_m != null && rules.firsthoehe_max_m > rules.heightM;
    const attikaBudgetM = attikaHeightIsModelled ? rules.firsthoehe_max_m - rules.heightM : ordinaryStoreyHeightM * attikaMax;
    const attikaStoreyHeightM = attikaMax > 0 ? attikaBudgetM / attikaMax : 0;

    // Fewest storeys that can hold the permitted GFA: below this the floor
    // area would not fit on the available footprint.
    const minStoreys = Math.min(maxStoreys, Math.max(1, Math.ceil(reconciled.achievableFloors - 1e-9)));
    // Default to the maximum the zone allows, Attika included -- this is a
    // Machbarkeitsstudie, so the question it answers first is how much volume
    // is possible here. Fewer storeys stay one click away in the picker.
    const storeys = Math.min(maxStoreys, Math.max(minStoreys, storeysOverride || maxStoreys));
    const ordinaryStoreys = Math.min(storeys, ordinaryMax);
    const attikaStoreys = Math.max(0, storeys - ordinaryMax);
    const storeyHeightM = ordinaryStoreyHeightM; // kept for callers that only care about the ordinary case
    const buildingHeightM = ordinaryStoreys * ordinaryStoreyHeightM + attikaStoreys * attikaStoreyHeightM;

    const gfaUsedM2 = Math.min(reconciled.maxGfaM2, available * storeys);
    const floorplateM2 = gfaUsedM2 / storeys;
    const scale = Math.min(1, floorplateM2 / available);

    return {
      storeys,
      minStoreys,
      maxStoreys,
      ordinaryMax, attikaMax, ordinaryStoreys, attikaStoreys,
      ordinaryStoreyHeightM, attikaStoreyHeightM, attikaHeightIsModelled,
      storeyOptions: Array.from({ length: maxStoreys - minStoreys + 1 }, (_, i) => minStoreys + i),
      storeyHeightM,
      buildingHeightM,
      floorplateM2,
      gfaUsedM2,
      // Volume of the storeys actually built, not of the legal hull. Uses
      // buildingHeightM (not storeys x storeyHeightM) because ordinary and
      // Attika storeys can have different heights.
      volumeM3: floorplateM2 * buildingHeightM,
      hullVolumeM3: available * rules.heightM,
      footprintScale: scale,
      // Linear scale to apply to the footprint outline to reach the floorplate.
      linearScale: Math.sqrt(scale),
      gfaFullyUsed: gfaUsedM2 >= reconciled.maxGfaM2 - 0.5,
    };
  }

  window.MachbarkeitTool.buildMassingModel = buildMassingModel;
  window.MachbarkeitTool.reconcileEnvelope = reconcileEnvelope;
})();
