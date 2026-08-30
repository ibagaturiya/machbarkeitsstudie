// parkierung.js — Pflichtparkplätze als Grenze der Volumengrösse.
//
// Bei einem Mehrfamilienhaus ist die Ausnützungsziffer selten allein
// bindend: die Pflichtparkplätze wachsen mit der Geschossfläche, sie müssen
// nach Art. 26 Abs. 3 BZO Zumikon in der Regel unterirdisch oder im Gebäude
// liegen, und unter einen Baukörper gegebener Grundfläche passt nur eine
// bestimmte Zahl. Ab da begrenzt nicht mehr die AZ das Volumen, sondern die
// Garage.
//
// Dieses Modul beantwortet deshalb zwei Fragen und hält sie streng getrennt:
//   1. Wieviele Plätze verlangt die BZO?  — Rechtswert, mit Beleg.
//   2. Passen sie unter den Baukörper?    — Werkzeug-Annahme über die Fläche
//      je Platz, ausdrücklich als solche gekennzeichnet.
//
// Es wird NICHTS stillschweigend vom Fussabdruck abgezogen. Ob eine Garage
// zweigeschossig wird oder der Baukörper schrumpft, ist eine Entwurfs-
// entscheidung; das Werkzeug sagt nur, ab wann sie ansteht.
window.MachbarkeitTool = window.MachbarkeitTool || {};

(function () {
  const T = window.MachbarkeitTool;

  // Werkzeug-Annahmen, keine Rechtswerte. Bandbreiten aus der üblichen
  // Praxis; das Werkzeug rechnet mit dem mittleren Wert und weist ihn aus.
  // VSS SN 640 291a liegt diesem Werkzeug nicht als Quelle vor — deshalb
  // steht hier ausdrücklich "Annahme" und keine Normnummer.
  const PARKIERUNG_ANNAHMEN = {
    // Bruttofläche je Platz in einer Tiefgarage: Stellplatz plus Anteil
    // Fahrgasse, Rampe und Erschliessung.
    flaecheJePlatzTiefgarageM2: 28,
    flaecheJePlatzTiefgarageBandM2: [25, 35],
    // Oberirdisch, senkrecht angeordnet, inkl. Anteil Zufahrt.
    flaecheJePlatzOberirdischM2: 25,
    flaecheJePlatzOberirdischBandM2: [20, 30],
  };

  function ceilPos(x) { return x > 0 ? Math.ceil(x - 1e-9) : 0; }

  // rules      — aus getZoneRules(); rules.meta.parkierung trägt die BZO-Werte
  // gnfM2      — Bezugsgrösse für die Platzzahl (nutzbare Geschossfläche total)
  // fussabdruckM2 — Grundfläche EINES Untergeschosses unter dem Baukörper
  // parzelleM2 — anrechenbare Grundstücksfläche, für die oberirdische Prüfung
  // wohnungen  — Entwurfsentscheidung; null ⇒ aus der GNF hergeleitet (Annahme)
  function computeParkierung({ rules, gnfM2, fussabdruckM2, parzelleM2, wohnungen = null }) {
    const cfg = rules && rules.meta && rules.meta.parkierung;
    if (!cfg) {
      return { erfasst: false, grund: 'Für diese Gemeinde sind keine Parkierungsvorschriften hinterlegt.' };
    }
    if (cfg.erfasst === false) {
      return { erfasst: false, grund: cfg.grund || 'Parkierungsvorschriften nicht erfasst.' };
    }
    // Ab hier MUSS die Datei vollständig sein. Eine halb erfasste
    // Parkierungsregel ist gefährlicher als gar keine: sie sieht aus wie ein
    // Ergebnis. Darum Abbruch statt Default (CLAUDE.md §2).
    for (const k of ['wohnen_bewohner_je_m2_gnf', 'wohnen_bewohner_je_wohnung', 'wohnen_besucher_je_wohnungen']) {
      if (typeof cfg[k] !== 'number' || !(cfg[k] > 0)) {
        throw new Error(`Parkierung: "${k}" fehlt oder ist unbrauchbar in der BZO-Datei von ${rules.gemeinde}.`);
      }
    }
    const gnf = Number(gnfM2) || 0;

    // Wohnungszahl: eine Entwurfsentscheidung wie die Geschosszahl. Ohne
    // Angabe wird sie aus der GNF mit genau der Bezugsgrösse hergeleitet, die
    // die BZO selbst nennt (100 m² GNF) — das ist die Annahme, die am
    // wenigsten hinzuerfindet, und sie ist als solche markiert.
    const hergeleitet = wohnungen == null;
    const wohnungenN = hergeleitet
      ? Math.max(1, Math.round(gnf / cfg.wohnen_bewohner_je_m2_gnf))
      : Math.max(1, Math.round(wohnungen));

    // Art. 26: "mindestens je ein P für ... pro 100 m2 GNF ODER pro Wohnung".
    // Das Maximum beider Lesarten ist die einzige, die nie zu wenig verlangt.
    const bewohnerAusGnf = ceilPos(gnf / cfg.wohnen_bewohner_je_m2_gnf);
    const bewohnerAusWohnungen = ceilPos(wohnungenN / cfg.wohnen_bewohner_je_wohnung);
    const bewohnerP = Math.max(bewohnerAusGnf, bewohnerAusWohnungen);
    const besucherP = ceilPos(wohnungenN / cfg.wohnen_besucher_je_wohnungen);
    const totalP = bewohnerP + besucherP;

    const A = PARKIERUNG_ANNAHMEN;
    const tiefgarageBedarfM2 = bewohnerP * A.flaecheJePlatzTiefgarageM2;
    const oberirdischBedarfM2 = besucherP * A.flaecheJePlatzOberirdischM2;

    const fp = Number(fussabdruckM2) || 0;
    const parzelle = Number(parzelleM2) || 0;
    // Wieviele Plätze trägt EIN Untergeschoss unter dem Baukörper?
    const plaetzeJeUgGeschoss = fp > 0 ? Math.floor(fp / A.flaecheJePlatzTiefgarageM2) : 0;
    const ugGeschosseNoetig = plaetzeJeUgGeschoss > 0 ? Math.ceil(bewohnerP / plaetzeJeUgGeschoss) : null;
    // Die eigentliche Antwort auf "Parkplätze limitieren das Volumen": wieviel
    // Geschossfläche trägt eine eingeschossige Tiefgarage unter diesem
    // Baukörper überhaupt?
    const gnfAusEinemUgM2 = plaetzeJeUgGeschoss * cfg.wohnen_bewohner_je_m2_gnf;
    const bindet = gnf > 0 && gnfAusEinemUgM2 > 0 && gnfAusEinemUgM2 < gnf - 1e-6;

    const freiflaecheM2 = Math.max(0, parzelle - fp);
    const oberirdischPasst = oberirdischBedarfM2 <= freiflaecheM2 + 1e-6;

    const hinweise = [];
    if (hergeleitet) {
      hinweise.push(`Die Wohnungszahl (${wohnungenN}) ist aus der Geschossfläche hergeleitet (${cfg.wohnen_bewohner_je_m2_gnf} m² GNF je Wohnung) — eine Annahme, kein Rechtswert. Sie lässt sich oben überschreiben; die Besucherplätze hängen direkt daran.`);
    }
    if (cfg._gnf_note) hinweise.push(cfg._gnf_note);
    if (cfg._oev_reduktion_note) hinweise.push(cfg._oev_reduktion_note);
    // Nicht in `hinweise`: siehe bindendHinweis unten.
    const bindendHinweis = bindet
      ? (`Bindend: unter diesem Baukörper (${Math.round(fp)} m²) fasst ein Untergeschoss rund ${plaetzeJeUgGeschoss} Plätze, das trägt etwa ${Math.round(gnfAusEinemUgM2)} m² Geschossfläche — gerechnet sind aber ${Math.round(gnf)} m². Entweder ${ugGeschosseNoetig} Untergeschosse, eine über den Baukörper hinausreichende Tiefgarage, oder weniger Geschossfläche.`)
      : null;
    if (!oberirdischPasst) {
      hinweise.push(`Die ${besucherP} Besucherplätze brauchen rund ${Math.round(oberirdischBedarfM2)} m² oberirdisch; frei sind nur ${Math.round(freiflaecheM2)} m². Sie sind nach Art. 26 Abs. 3 nicht von der Pflicht zur unterirdischen Anordnung erfasst und müssen an der Oberfläche untergebracht werden.`);
    }

    return {
      erfasst: true,
      artikel: cfg.art || null,
      unterbringung: cfg.unterbringung || null,
      gnfM2: gnf, wohnungen: wohnungenN, wohnungenHergeleitet: hergeleitet,
      bewohnerP, besucherP, totalP, bewohnerAusGnf, bewohnerAusWohnungen,
      tiefgarageBedarfM2, oberirdischBedarfM2,
      fussabdruckM2: fp, freiflaecheM2, oberirdischPasst,
      plaetzeJeUgGeschoss, ugGeschosseNoetig, gnfAusEinemUgM2, bindet,
      annahmen: A, hinweise, bindendHinweis,
    };
  }

  T.PARKIERUNG_ANNAHMEN = PARKIERUNG_ANNAHMEN;
  T.computeParkierung = computeParkierung;
})();
