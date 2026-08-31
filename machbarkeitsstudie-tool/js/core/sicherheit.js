// sicherheit.js — wie belastbar ist dieser Wert?
//
// Die Zahlentafel beantwortet seit kennwerte.js die Frage WOHER ein Wert
// kommt (`kind`: GEHOLT | BERECHNET | GEPRÜFT | ANNAHME | ENTWURF). Sie
// beantwortet nicht, WIE SICHER er ist. Das sind zwei verschiedene Achsen:
// ein Grenzabstand aus Art. 17 BZO Zumikon und ein Kostenkennwert von
// CHF 900/m³ sind beide "GEHOLT" bzw. "BERECHNET" und sehen in der Tabelle
// gleich aus — vor einer Behörde trägt nur der eine.
//
// Vier Stufen, eine Skala, an jedem Wert:
//
//   BELEGT             Rechtswert mit Artikel, Seite und Wortlaut — oder eine
//                      benannte amtliche Datenquelle.
//   VEREINFACHT        Rechtswert, aber das Werkzeug wendet ihn genähert an.
//                      Die Näherung ist benannt und liegt auf der sicheren Seite.
//   ANNAHME            kein Gesetzeszitat. Werkzeug-Grösse oder Entwurfsentscheid.
//   NICHT_ERMITTELBAR  Regel existiert hier nicht (null), Datenquelle
//                      ausgefallen, oder bewusst nicht geprüft.
//
// Dieses Modul rechnet NICHTS. Es stuft ein. Die Belegstelle holt es über
// das bestehende T.getProvenance() aus rules.js — eine zweite Lesestelle
// wäre genau die Duplizierung, vor der CLAUDE.md §1 warnt.
//
// Die Kaskade in stufeVon() ist erschöpfend und endet in jedem Zweig in
// einer benannten Stufe. Ein unbekannter Fall WIRFT (CLAUDE.md §4: nie
// stiller Durchfall, nie impliziter Default).
window.MachbarkeitTool = window.MachbarkeitTool || {};

(function () {
  const T = window.MachbarkeitTool;

  // ---- 1. Die vier Stufen ------------------------------------------------
  // `rang` 1 = am stärksten. Die Vererbung nimmt immer den höchsten Rang
  // (= die schwächste Stufe) aller Eingänge.
  //
  // `zeichen` ist nicht Dekoration: das PDF wird schwarzweiss gedruckt, und
  // Farbe allein ist keine Kennzeichnung. Jede Stufe muss ohne Farbe lesbar
  // bleiben.
  const STUFEN = {
    BELEGT: {
      rang: 1, key: 'BELEGT', kurz: 'belegt', zeichen: '§',
      label: 'Belegter Rechtswert',
      erklaerung: 'Artikel, Seite und Wortlaut liegen vor — oder der Wert stammt aus einer benannten amtlichen Datenquelle.',
      farbe: '#4a7d3f', farbeDark: '#8fc07f',
    },
    VEREINFACHT: {
      rang: 2, key: 'VEREINFACHT', kurz: 'vereinfacht', zeichen: '≈',
      label: 'Rechtswert, vereinfacht angewandt',
      erklaerung: 'Der Wert ist belegt, das Werkzeug wendet ihn aber genähert an. Die Näherung ist benannt und liegt auf der sicheren Seite.',
      farbe: '#3f7cac', farbeDark: '#7fb3d9',
    },
    ANNAHME: {
      rang: 3, key: 'ANNAHME', kurz: 'Annahme', zeichen: '~',
      label: 'Werkzeug-Annahme',
      erklaerung: 'Ohne Gesetzeszitat. Erfahrungswert des Werkzeugs oder Entwurfsentscheidung — keine Rechtsgrösse.',
      farbe: '#c07a2c', farbeDark: '#f0a35c',
    },
    NICHT_ERMITTELBAR: {
      rang: 4, key: 'NICHT_ERMITTELBAR', kurz: 'nicht ermittelbar', zeichen: '?',
      label: 'Nicht ermittelbar',
      erklaerung: 'Die Regel existiert hier nicht, die Datenquelle ist ausgefallen, oder das Thema wird bewusst nicht geprüft. Kein Wert — und ausdrücklich nicht null gleich 0.',
      farbe: '#8a8580', farbeDark: '#a5a3a0',
    },
  };
  const STUFEN_NACH_RANG = Object.values(STUFEN).sort((a, b) => a.rang - b.rang);

  // ---- 2. Register: Vereinfachungen -------------------------------------
  // Rechtswerte, die das Werkzeug genähert anwendet. Jeder Eintrag nennt den
  // Artikel, der eigentlich gilt, was das Werkzeug stattdessen tut, und warum
  // das konservativ ist.
  //
  // Diese Texte standen bisher als Fliesstext in den Flags von app.js und als
  // Prosa in REGELN.md §9. Hier sind sie maschinenlesbar; app.js liest sie von
  // hier, statt sie ein zweites Mal zu formulieren.
  const VEREINFACHUNGEN = {
    grenzabstand_gebaeuderechteck_iterativ: {
      artikel: 'Art. 18 Abs. 2 BZO Zumikon / § 22 ABV',
      gilt: 'Massgebend für den grossen Grenzabstand sind die Südseiten des GEBÄUDES, bestimmt am flächenkleinsten Rechteck, das es umfasst; gemessen wird rechtwinklig zur Fassade, der kleine Abstand radial um die Ecken (§ 22 Abs. 2 ABV).',
      werkzeug: 'Das Werkzeug kennt das künftige Gebäude nicht und nähert es iterativ: grösstmögliches Rechteck im Bereich des kleinen Abstands, Südseiten bestimmen, dort den grossen Abstand rechtwinklig ansetzen (gerichtete Erosion, exakt für konvexe Parzellen, sonst bis ~0.31 m zu grosszügig an schmalen Randkerben), wiederholen bis stabil.',
      konservativ: 'Für ein Gebäude in der gefundenen Stellung korrekt. Ein Entwurf mit anderer Stellung oder Form kann andere Südseiten haben — das Ergebnis ist dann eine Näherung, keine Rechtsauskunft je Fassade.',
    },
    grenzabstand_parzellenkante: {
      artikel: '§ 22 ABV / Art. 18 Abs. 2 BZO',
      gilt: 'Der Grenzabstand wird rechtwinklig zur Fassade auf dem flächenkleinsten Rechteck gemessen, welches das GEBÄUDE umfasst.',
      werkzeug: 'Rückfall-Näherung, wenn das Gebäuderechteck-Verfahren geometrisch scheitert: der grosse Abstand hängt an den südorientierten Parzellenkanten statt an den Gebäudeseiten.',
      konservativ: 'NICHT verlässlich konservativ: sie hängt an der zufälligen Stückelung der Parzellenkanten. Auf Zumikon 5029 traf sie zwei kurze Süd-Kantenstücke (5.1 m + 9.6 m) und liess 132 m² stehen, wo der Ansatz an den Gebäudeseiten 34 m² ergibt. Nicht ohne Handprüfung verwenden.',
    },
    mehrlaengenzuschlag_allseitig: {
      artikel: 'Art. 14 BZO 2016 (Zürich)',
      gilt: 'Der Zuschlag erhöht den Grenzabstand an den massgeblichen (langen) Fassaden.',
      werkzeug: 'Das Werkzeug rechnet den erhöhten Abstand allseitig.',
      konservativ: 'Allseitig ist strenger als fassadenweise.',
    },
    grosser_grenzabstand_ringsum: {
      artikel: 'Art. 18 Abs. 1 BZO',
      gilt: 'Der grosse Grenzabstand gilt für die bezeichneten südorientierten Gebäudeseiten, der kleine für alle übrigen.',
      werkzeug: 'Liess sich der seitenweise Abstand geometrisch nicht bilden (unregelmässige Parzelle), wendet das Werkzeug ersatzweise den GROSSEN Abstand ringsum an.',
      konservativ: 'Der wirkliche bebaubare Bereich ist grösser als der gezeigte. Nicht ohne Handprüfung verwenden.',
    },
    attika_ohne_ueberhoehung: {
      artikel: 'Art. 31 Abs. 1 BZO Zumikon (Vorbild)',
      gilt: 'Das Attikaprofil wird unter 45° ab einer Linie angelegt, die um die Überhöhung über der Schnittlinie liegt; der Rücksprung ist Attikahöhe minus Überhöhung.',
      werkzeug: 'Für Gemeinden ohne hinterlegte Überhöhungs-Regel setzt das Werkzeug den vollen Rücksprung an (Rücksprung = Attikahöhe).',
      konservativ: 'Voller Rücksprung ergibt die kleinere Attika.',
    },
    waldabstand_seitenbestimmung: {
      artikel: '§ 262 PBG',
      gilt: 'Der Waldabstand misst ab dem Waldrand nach der Waldfeststellung.',
      werkzeug: 'Welche Parzellenseiten betroffen sind, bestimmt das Werkzeug aus einem Suchradius um die Auswahl; bei sehr grossen Auswahlen kann die Seitenbestimmung unscharf werden.',
      konservativ: 'Unbestimmte Seiten werden als betroffen behandelt und erscheinen zusätzlich als Prüfpunkt.',
    },
    anrechenbare_flaeche_nur_wald: {
      artikel: '§ 255/259 PBG bzw. § 259 aPBG',
      gilt: 'Von der anrechenbaren Grundstücksfläche sind Wald, Waldabstandsflächen mehr als 15 m hinter der Waldabstandslinie, offene Gewässer und Flächen ausserhalb der Bauzone abzuziehen.',
      werkzeug: 'Automatisch abgezogen werden Wald und die Waldabstandsfläche > 15 m hinter der Linie. Gewässer und Zonenanteile erscheinen als Hinweis.',
      konservativ: 'Nicht konservativ — wegen der ungeprüften Gewässer- und Zonenanteile kann die anrechenbare Fläche zu GROSS sein. Deshalb steht der Hinweis, und die Stufe fällt.',
    },
    zone_mischzone: {
      artikel: '§ 259 PBG',
      gilt: 'Liegt eine Parzelle in mehreren Zonen, ist zonenanteilig zu rechnen.',
      werkzeug: 'Das Werkzeug legt die Zone der Ausgangsparzelle über die ganze Auswahl.',
      konservativ: 'Nicht konservativ — Richtung der Abweichung hängt von den Zonen ab. Erscheint als Hinweis.',
    },
    quelle_ohne_zonenzitat: {
      artikel: 'BZO (Grundmasse-Artikel)',
      gilt: 'Jeder Zonenwert sollte mit Artikel, Seite und Wortlaut belegt sein.',
      werkzeug: 'Für diese Zone liegt kein zonenscharfes Zitat vor, nur der allgemeine Grundmasse-Artikel der Gemeinde.',
      konservativ: 'Nicht konservativ, sondern unbelegt — der Wert ist als solcher zu prüfen.',
    },
  };

  // ---- 3. Register: Werkzeug-Annahmen -----------------------------------
  // REGELN.md §5, maschinenlesbar. Die Zahlen selbst bleiben dort, wo sie
  // gebraucht werden (parkierung.js, coordinates.js, output.js) — hier steht
  // nur, DASS es eine Annahme ist und mit welcher Bandbreite.
  const WERKZEUG_ANNAHMEN = {
    bestandspruefung_winkelraster: { was: 'Winkelraster der Bestands-Passprobe (bekannte Gebäude)', band: null, einheit: '°' },
    kostenkennwert_chf_m3: { was: 'Kostenkennwert BKP 2', band: [800, 1000], einheit: 'CHF/m³' },
    flaeche_je_platz_tiefgarage: { was: 'Fläche je Abstellplatz, Tiefgarage', band: [25, 35], einheit: 'm²' },
    flaeche_je_platz_oberirdisch: { was: 'Fläche je Abstellplatz, oberirdisch', band: [20, 30], einheit: 'm²' },
    wohnungsgroesse_gnf: { was: 'hergeleitete Wohnungsgrösse, wenn keine eingegeben', band: null, einheit: 'm² GNF' },
    min_fassadenlaenge: { was: 'kürzeste Kante, die als Fassade zählt', band: null, einheit: 'm' },
    min_baukoerperbreite: { was: 'Mindestbreite eines Baukörpers', band: null, einheit: 'm' },
    terrainraster: { was: 'Raster der Höhenabfrage', band: null, einheit: 'Punkte' },
    suchradien: { was: 'Suchradien und Arbeitsränder der Geodatenabfragen', band: null, einheit: 'm' },
    attika_ersatzhoehe: { was: 'Attikahöhe ohne Höhenzuschlag in den Daten', band: null, einheit: 'm' },
  };

  // ---- 4. Die Kaskade ----------------------------------------------------

  // Werte, die "es gibt hier nichts" bedeuten. Ein leerer Wert ist NIE 0.
  function istLeerwert(wert) {
    if (wert == null) return true;
    if (typeof wert === 'number') return !isFinite(wert);
    const s = String(wert).trim();
    return s === '' || s.startsWith('—') || s === '-';
  }

  function belegIstZitat(prov) {
    return !!(prov && prov.article && prov.file && prov.page != null);
  }

  // Benannte amtliche Datensätze. Kein Gesetzeszitat, aber eine überprüfbare
  // Quelle — und damit belegt, nur mit anderem Belegtyp.
  const AMTLICHE_QUELLEN = [
    'Amtliche Vermessung', 'ogd-0156', 'ogd-0158', 'swissALTI3D',
    'Adressregister', 'ÖREB', 'ÖREB-Kataster',
  ];
  function istAmtlicheQuelle(source) {
    if (!source) return false;
    const s = String(source);
    return AMTLICHE_QUELLEN.some((q) => s.includes(q));
  }

  /**
   * Stuft einen einzelnen Wert ein.
   *
   * @param {object} d
   * @param {string}  d.schluessel   Registerschlüssel (VEREINFACHUNGEN / WERKZEUG_ANNAHMEN) oder null
   * @param {*}       d.wert         der dargestellte Wert
   * @param {object}  d.prov         Belegstelle aus T.getProvenance(), oder null
   * @param {string}  d.kind         GEHOLT | BERECHNET | GEPRÜFT | ANNAHME | ENTWURF
   * @param {string}  d.source       Quellentext der Zeile
   * @param {boolean} d.quelleAusgefallen  Datenquelle nicht erreichbar
   * @param {string}  d.label        nur für die Fehlermeldung
   * @returns {{stufe: string, grund: string, register: object|null}}
   */
  function stufeVon(d) {
    const { schluessel = null, wert, prov = null, kind, source = null,
      quelleAusgefallen = false, label = '(ohne Bezeichnung)' } = d || {};

    // 1. Datenquelle ausgefallen — vor allem anderen, sonst würde ein
    //    ausgefallener Dienst als belegter Wert durchgehen.
    if (quelleAusgefallen) {
      return { stufe: 'NICHT_ERMITTELBAR', grund: 'Datenquelle nicht erreichbar', register: null };
    }

    // 2. Kein Wert. Regel existiert hier nicht, oder bewusst nicht geprüft.
    //    null heisst "gibt es hier nicht" — nie 0 (CLAUDE.md §2).
    if (istLeerwert(wert)) {
      return {
        stufe: 'NICHT_ERMITTELBAR',
        grund: kind === 'GEPRÜFT'
          ? 'Regel geprüft und nicht anwendbar — kein Wert, ausdrücklich nicht 0'
          : 'kein Wert ermittelbar',
        register: null,
      };
    }

    // 3. Entwurfsentscheidung. Keine Rechtsgrösse, aber auch kein Irrtum:
    //    jede Zahl im zulässigen Rahmen ist gleich zulässig. Fällt auf
    //    ANNAHME, weil sie als RECHTLICHE Aussage nichts trägt.
    if (kind === 'ENTWURF') {
      return { stufe: 'ANNAHME', grund: 'Entwurfsentscheidung, frei wählbar im zulässigen Rahmen', register: null };
    }

    // 4. Werkzeug-Annahme — ausdrücklich getippt oder im Register.
    if (kind === 'ANNAHME' || (schluessel && WERKZEUG_ANNAHMEN[schluessel])) {
      const reg = schluessel ? WERKZEUG_ANNAHMEN[schluessel] || null : null;
      return {
        stufe: 'ANNAHME',
        grund: reg
          ? `${reg.was}${reg.band ? ` (Bandbreite ${reg.band[0]}–${reg.band[1]} ${reg.einheit})` : ''} — ohne Gesetzeszitat`
          : 'Werkzeug-Annahme ohne Gesetzeszitat',
        register: reg,
      };
    }

    // 5. Rechtswert, aber genähert angewandt.
    if (schluessel && VEREINFACHUNGEN[schluessel]) {
      const v = VEREINFACHUNGEN[schluessel];
      return { stufe: 'VEREINFACHT', grund: v.werkzeug, register: v };
    }

    // 6. Belegstelle ohne zonenscharfes Zitat (rules.js setzt source.synthetic).
    if (prov && prov.synthetic) {
      return { stufe: 'VEREINFACHT', grund: VEREINFACHUNGEN.quelle_ohne_zonenzitat.werkzeug, register: VEREINFACHUNGEN.quelle_ohne_zonenzitat };
    }

    // 7. Gesetzeszitat mit Datei und Seite.
    if (belegIstZitat(prov)) {
      return { stufe: 'BELEGT', grund: `${prov.article}, S. ${prov.page}`, register: null, belegtyp: 'gesetzeszitat' };
    }

    // 8. Benannte amtliche Datenquelle.
    if (istAmtlicheQuelle(source)) {
      return { stufe: 'BELEGT', grund: String(source), register: null, belegtyp: 'amtliche_daten' };
    }

    // 9. Rechnerisches Zwischenergebnis ohne eigene Quelle: es trägt keine
    //    eigene Aussage, seine Stufe kommt allein aus den Eingängen. Ohne
    //    Eingänge wäre es unbelegt — das ist ein Programmierfehler, kein
    //    Rechtsfall.
    if (kind === 'BERECHNET' || kind === 'GEPRÜFT') {
      return { stufe: 'BELEGT', grund: 'rechnerisch aus den vorstehenden Werten', register: null, belegtyp: 'abgeleitet' };
    }

    // 10. Kein Zweig getroffen. Nicht raten.
    throw new Error(
      `Sicherheitsstufe für "${label}" nicht bestimmbar: kind="${kind}", ` +
      `schluessel="${schluessel}", source="${source}", Beleg=${prov ? 'vorhanden, aber ohne Datei/Seite' : 'keiner'}. ` +
      `Entweder fehlt ein Registereintrag in sicherheit.js oder die Belegstelle in data/*.json.`
    );
  }

  // ---- 5. Vererbung ------------------------------------------------------
  // Ein abgeleiteter Wert ist höchstens so sicher wie sein schwächster
  // Eingang. Hängt die Geschossfläche an einer vereinfachten Messung, ist
  // sie selbst nicht mehr "belegt".
  function schwaechste(...stufen) {
    const flach = stufen.flat().filter(Boolean);
    if (!flach.length) throw new Error('schwaechste() ohne Stufen aufgerufen');
    let schlechteste = null;
    for (const s of flach) {
      const key = typeof s === 'string' ? s : s.stufe;
      const def = STUFEN[key];
      if (!def) throw new Error(`Unbekannte Sicherheitsstufe "${key}"`);
      if (!schlechteste || def.rang > STUFEN[schlechteste].rang) schlechteste = key;
    }
    return schlechteste;
  }

  // Setzt `sicherheit` und `sicherheitVererbt` auf einer Liste von Zeilen,
  // die `id` und `dependsOn` tragen können. Reiner Nachlauf: die Zeilen sind
  // bereits in Ableitungsreihenfolge gebaut, es wird nichts neu gerechnet.
  function vererbe(rows) {
    const nachId = new Map();
    for (const rr of rows) if (rr.id) nachId.set(rr.id, rr);
    for (const rr of rows) {
      const eigene = rr.sicherheit;
      if (!eigene) throw new Error(`Zeile "${rr.label}" ohne eigene Sicherheitsstufe`);
      if (!rr.dependsOn || !rr.dependsOn.length) { rr.sicherheitVererbt = false; continue; }
      const eingaenge = rr.dependsOn.map((id) => {
        const q = nachId.get(id);
        if (!q) throw new Error(`Zeile "${rr.label}" hängt an unbekannter id "${id}"`);
        return q.sicherheit;
      });
      const neu = schwaechste(eigene, ...eingaenge);
      rr.sicherheitVererbt = neu !== eigene;
      if (rr.sicherheitVererbt) {
        const schwach = rr.dependsOn
          .map((id) => nachId.get(id))
          .filter((q) => q.sicherheit === neu)
          .map((q) => q.label);
        rr.sicherheitGrund = `übernommen von: ${schwach.join(', ')}`;
      }
      rr.sicherheit = neu;
    }
    return rows;
  }

  // Zählt die Stufen einer Zeilenliste — für die Laufzusammenfassung, damit
  // Tabelle und Zusammenfassung nicht auseinanderlaufen können.
  function zaehle(rows) {
    const out = {};
    for (const k of Object.keys(STUFEN)) out[k] = 0;
    for (const rr of rows) {
      if (!STUFEN[rr.sicherheit]) throw new Error(`Zeile "${rr.label}" ohne gültige Stufe`);
      out[rr.sicherheit]++;
    }
    return out;
  }

  T.SICHERHEIT_STUFEN = STUFEN;
  T.SICHERHEIT_STUFEN_NACH_RANG = STUFEN_NACH_RANG;
  T.VEREINFACHUNGEN = VEREINFACHUNGEN;
  T.WERKZEUG_ANNAHMEN = WERKZEUG_ANNAHMEN;
  T.stufeVon = stufeVon;
  T.schwaechsteSicherheit = schwaechste;
  T.vererbeSicherheit = vererbe;
  T.zaehleSicherheit = zaehle;
})();
