// print.js — builds a real A3 landscape document for the PDF export.
//
// The export used to just print the web page, which produced a long scroll
// broken across pages at arbitrary points. This instead composes a separate
// document of fixed A3 sheets, one topic per sheet, and prints that while
// hiding the app UI. Each sheet is exactly 420x297mm so nothing reflows.
//
// Images are the tricky part: WMS map tiles and the Three.js canvas both have
// to be fully materialised BEFORE window.print(), or the PDF gets blank boxes.
// The 3D view is baked to a PNG data URL up front, and buildPrintDocument
// resolves only once every <img> has finished loading.
window.MachbarkeitTool = window.MachbarkeitTool || {};

(function () {
  const T = window.MachbarkeitTool;
  // Shared with app.js — see js/core/format.js. The local copy of esc used to
  // leave the single quote unescaped; this one does not.
  const esc = T.esc, fmt = T.fmt, fmtInt = T.fmtInt;


  // ---- Seitenumbruch ------------------------------------------------------
  // Ein Blatt ist A4 hoch und schneidet ab, was nicht hineinpasst
  // (print.css: .sheet-body overflow hidden — sonst malt der Text über die
  // Quellenzeile und den Fusszeilenbereich). Abschneiden ist keine zulässige
  // Antwort: eine Prüfung, die nur halb im Dokument steht, ist schlimmer als
  // gar keine, weil sie so aussieht, als stünde sie vollständig da.
  //
  // Bis 30.8.2026 hatten nur DREI der fünfzehn Blätter einen umbrechbaren
  // Bereich; alle übrigen liefen still in den Beschnitt. Auf dem Blatt
  // «Parkierung» hat das drei Hinweise gekostet — sie standen unter der
  // Quellenzeile im Nichts. Deshalb trägt jetzt JEDES Blatt einen
  // Flussbereich (siehe sheet()), und der Umbruch steigt zusätzlich in
  // verschachtelte Blöcke ab.
  //
  // Der Ablauf je Blatt: solange der Körper überläuft, wandert das letzte
  // Kind des Flussbereichs auf ein Fortsetzungsblatt. Reicht das nicht, weil
  // ein EINZELNES Kind schon zu hoch ist (eine lange Spaltenliste etwa),
  // wird in dieses Kind abgestiegen und es selbst geteilt — die Hülle bleibt
  // dabei auf beiden Blättern stehen, damit Layout und Bedeutung erhalten
  // bleiben. Das Fortsetzungsblatt landet direkt hinter dem Original und
  // wird von derselben Schleife erneut geprüft; drei und mehr Fortsetzungen
  // sind damit abgedeckt.
  const overflows = (el) =>
    el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2;

  // Auf A4 hoch hat `.cols` nur noch EINE Spalte — die Hülle trägt kein
  // Layout mehr. Sie kostet aber die Feinheit des Umbruchs: als ein einziger
  // Block wandert sie komplett auf das nächste Blatt und lässt eines zurück,
  // das zu einem Achtel gefüllt ist. Dasselbe gilt für die klassenlosen
  // <div> darin — das sind die früheren Rasterfelder, reine Hüllen.
  //
  // Beide werden vor dem Umbruch aufgelöst, damit der Fluss eine flache
  // Folge von Blöcken sieht und blockweise statt spaltenweise umbricht.
  // Aufgelöst wird nur, was nachweislich keine Bedeutung trägt: ein <div>
  // ohne jedes Attribut. Alles mit Klasse, id oder data- bleibt unangetastet.
  function flattenForFlow(flow) {
    for (let runde = 0; runde < 4; runde++) {
      let geaendert = false;
      for (const el of [...flow.children]) {
        const istRasterHuelle = el.tagName === 'DIV' && el.classList.contains('cols');
        const istLeereHuelle = el.tagName === 'DIV' && el.attributes.length === 0 && el.children.length > 0;
        if (istRasterHuelle || istLeereHuelle) {
          el.replaceWith(...el.childNodes);
          geaendert = true;
        }
      }
      if (!geaendert) return;
    }
  }

  // Eine Überschrift als letzte Zeile eines Blatts, deren Inhalt auf dem
  // nächsten steht, ist ein Schusterjunge — sie wandert mit.
  const istUeberschrift = (el) => el && /^H[1-6]$/.test(el.tagName);

  // Nimmt so lange Kinder von hinten aus `flow`, bis `body` passt. Gibt die
  // entnommenen Knoten in Originalreihenfolge zurück.
  function peelTrailing(body, flow) {
    const moved = [];
    // Ein Kind muss stehen bleiben, sonst entstünde ein leeres Blatt und die
    // Schleife liefe endlos.
    while (overflows(body) && flow.children.length > 1) {
      const last = flow.lastElementChild;
      flow.removeChild(last);
      moved.unshift(last);
    }
    // Schusterjungen nachziehen: bleibt eine Überschrift als Letztes stehen,
    // gehört sie zu dem, was gerade weggewandert ist.
    while (moved.length && flow.children.length > 1 && istUeberschrift(flow.lastElementChild)) {
      const h = flow.lastElementChild;
      flow.removeChild(h);
      moved.unshift(h);
    }
    return moved;
  }

  // Passt der Körper immer noch nicht, obwohl nur ein Kind übrig ist, dann
  // ist DIESES Kind zu gross. Wir steigen hinein und teilen es: die leere
  // Hülle (gleiche Klassen) kommt auf das Fortsetzungsblatt, die überzähligen
  // Enkel wandern hinein. Rekursiv, damit auch zwei Ebenen tief geteilt wird.
  function splitDeep(body, flow) {
    if (!overflows(body) || flow.children.length !== 1) return null;
    const only = flow.firstElementChild;
    if (!only || only.children.length < 2) return null;

    const innerMoved = peelTrailing(body, only);
    if (!innerMoved.length) {
      const tiefer = splitDeep(body, only);
      if (!tiefer) return null;
      const huelle = only.cloneNode(false);
      huelle.appendChild(tiefer);
      return huelle;
    }
    const huelle = only.cloneNode(false);
    innerMoved.forEach((el) => huelle.appendChild(el));
    return huelle;
  }

  function splitOverflowingSheets(host, foot) {
    // Schutz gegen eine Endlosschleife: ein Blatt, das sich nicht teilen
    // lässt (ein einzelnes zu grosses Bild etwa), darf den Export nicht
    // aufhängen. 200 Blätter sind weit jenseits jedes echten Dokuments.
    const MAX_BLAETTER = 200;

    for (let i = 0; i < host.children.length && host.children.length < MAX_BLAETTER; i++) {
      const sheet = host.children[i];
      const body = sheet.querySelector('.sheet-body');
      const flow = sheet.querySelector('[data-flow]');
      if (!body || !flow) continue;
      flattenForFlow(flow);
      if (!overflows(body)) continue;

      let moved = peelTrailing(body, flow);
      let huelle = null;
      if (!moved.length) {
        huelle = splitDeep(body, flow);
        if (!huelle) continue; // nicht teilbar — die Prüfung unten meldet es
      }

      const cont = continuationSheet(sheet, foot);
      const contFlow = cont.querySelector('[data-flow]');
      if (huelle) contFlow.appendChild(huelle);
      else moved.forEach((el) => contFlow.appendChild(el));
      host.insertBefore(cont, sheet.nextSibling);
    }
  }

  // Nach dem Umbruch: beweisen, dass wirklich nichts mehr über den Rand
  // steht. Ohne diese Prüfung kehrt der Beschnitt beim nächsten längeren
  // Hinweistext still zurück — genau so ist er entstanden. Gemeldet wird
  // laut (Konsole + sichtbare Markierung auf dem Blatt), nicht geworfen:
  // ein unvollständiges Dokument ist schlecht, gar keines ist schlechter.
  function pruefeKeinUeberlauf(host) {
    const schuldige = [];
    for (const sheet of host.children) {
      const body = sheet.querySelector('.sheet-body');
      if (!body || !overflows(body)) continue;
      schuldige.push({
        titel: sheet.dataset.outlineTitle || '(Titelblatt)',
        zuvielPx: Math.max(body.scrollHeight - body.clientHeight,
                           body.scrollWidth - body.clientWidth),
      });
      sheet.dataset.ueberlauf = '1';
    }
    if (schuldige.length) {
      console.error('[PDF] Blätter laufen über — Inhalt fehlt im Export:',
        schuldige.map((s) => `${s.titel} (+${s.zuvielPx}px)`).join(' · '));
    }
    return schuldige;
  }

  // Das Fortsetzungsblatt trägt denselben Titel mit dem Zusatz
  // «(Fortsetzung)» — wer nur eine Seite in der Hand hält, muss erkennen,
  // wozu sie gehört. Der Inhalt steht zweispaltig über die volle Breite:
  // die Karte oder Tabelle daneben stand schon auf dem ersten Blatt.
  // Die Fusszeile kommt vom QUELLBLATT, nicht aus dem Dokument. Vorher
  // bekamen alle Fortsetzungen die Fusszeile der ERSTEN Auswertung: Seite 22
  // trug «Parzelle 5030», obwohl sie die Fortsetzung von Seite 21 (Parzelle
  // 5029) war. Genau die Zuordnung, die die Fusszeile leisten soll, war
  // damit auf jeder Fortsetzung falsch.
  function continuationSheet(sourceSheet, dokumentFoot) {
    const eigenerFoot = (sourceSheet.querySelector('.sheet-foot') || {}).innerHTML
      || dokumentFoot;
    const foot = eigenerFoot;
    const title = sourceSheet.dataset.outlineTitle
      || (sourceSheet.querySelector('h2') || {}).textContent || '';
    const kickerEl = sourceSheet.querySelector('.kicker');
    // Nur den Text hinter dem Nummern-Chip, nicht den Chip mitkopieren.
    const kicker = kickerEl
      ? [...kickerEl.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join('')
      : '';
    const el = document.createElement('div');
    el.innerHTML = sheet(
      `${title} (Fortsetzung)`, kicker, '',
      // `data-flow` am Platzhalter ist kein Zierrat: sheet() legt sonst einen
      // ZWEITEN Flussbereich darum, der geklonte landet darin verschachtelt,
      // und der Umbruch fasst danach die aeussere Huelle an — die genau ein
      // Kind hat und sich nie teilen laesst. Ergebnis waren Fortsetzungen
      // ohne Ende (die Notbremse bei 200 Blaettern hat es abgefangen).
      '<div data-cont-slot data-flow></div>', foot, '',
      sourceSheet.dataset.outlineNum || ''
    );
    const cont = el.firstElementChild;
    // Fortsetzungen zaehlen zum selben Abschnitt, sind aber als solche
    // markiert — die PDF-Bookmarks ueberspringen sie.
    cont.dataset.continuation = '1';
    // Der Fortsetzungs-Container ist ein KLON des Quell-Containers, nicht
    // ein hartkodiertes <div class="flags-cols">: eine Tabelle bricht in
    // eine Tabelle um, eine Spaltenliste in eine Spaltenliste. Bei einem
    // <tbody data-flow> muss die umgebende <table> mitgeklont werden, sonst
    // verlieren die Zeilen ihr Tabellenlayout.
    const srcFlow = sourceSheet.querySelector('[data-flow]');
    const slot = cont.querySelector('[data-cont-slot]');
    const flowClone = srcFlow.cloneNode(false);
    if (srcFlow.tagName === 'TBODY') {
      const tableClone = srcFlow.closest('table').cloneNode(false);
      tableClone.appendChild(flowClone);
      slot.replaceWith(tableClone);
    } else {
      slot.replaceWith(flowClone);
    }
    return cont;
  }

  // ---- Was auf jedem Parzellenblatt WORTGLEICH stuende -------------------
  // Bei mehreren Grundstuecken im selben Rechtsrahmen ist ein grosser Teil
  // des Anhangs nicht parzellenbezogen: die Pruefpunkte «Werkleitungen»,
  // «Sonderbauvorschriften / Gestaltungsplan», «Ortsbildschutz /
  // Denkmalpflege», «Strassenabstand», «Begruenung», «Kronenbedeckungsgrad»
  // haengen an Gemeinde und Zone; die Parkierungs-Fussnoten (GNF-Auslegung,
  // Art.-27-Hinweis) und die Werkzeug-Annahme zur Flaeche je Abstellplatz
  // stehen so in der BZO; die Legende der Belastbarkeitsstufen ist eine
  // Konstante des Werkzeugs. Im Export vom 31.8.2026 stand all das dreimal —
  // Wort fuer Wort, ueber rund zehn Seiten verteilt. Wer dreimal dasselbe
  // liest, liest beim zweiten Mal nicht mehr; die parzellenbezogenen Saetze
  // dazwischen gehen darin unter.
  //
  // Zusammengefasst wird nur, was NACHWEISLICH identisch ist — verglichen
  // wird der fertige Wortlaut, nicht die Annahme «gleiche Gemeinde, also
  // gleicher Text». Weicht ein Grundstueck ab (ein Denkmalpflege-Treffer,
  // eine ausgefallene Quelle, eine Baulinie, die nur hier schneidet), bleibt
  // sein Punkt auf SEINEM Blatt stehen. Ein Vorbehalt, der bei einem
  // Grundstueck anders lautet, darf nicht in einen gemeinsamen Abschnitt
  // wandern und dort zu einer Aussage ueber alle werden.
  //
  // Nicht zusammengefasst wird die Tier-A-Liste («automatisch geprueft»):
  // das sind Befunde ZU DIESER PARZELLE. Dass sie zufaellig gleich lauten,
  // macht sie nicht zu einer gemeinsamen Aussage.
  const GEMEINSAM_NUM = 'A.3';
  const GEMEINSAM_TITEL = 'Gemeinsame Vorbehalte und Annahmen';

  // Gleicher Rechtsrahmen = gleiche Gemeinde UND gleiche Zone. Sonst wird
  // gar nichts zusammengefasst: zwei Zonen haben zwei Grundmasse, und ein
  // gemeinsames Blatt muesste behaupten, welches gilt.
  function gleicherRechtsrahmen(liste) {
    if (liste.length < 2) return false;
    const g = liste[0].rules.gemeinde, z = liste[0].anchor.zone;
    return liste.every((r) => r.rules.gemeinde === g && r.anchor.zone === z);
  }

  // Aus jeder Auswertung eine Liste [key, text] holen und die Schnittmenge
  // bilden: gemeinsam ist, was in JEDER vorkommt und ueberall gleich lautet.
  function schnittmenge(liste, auslesen) {
    const ersteEintraege = auslesen(liste[0]);
    const gemeinsam = new Map();
    for (const [key, text] of ersteEintraege) {
      if (liste.every((r) => auslesen(r).some(([k, t]) => k === key && t === text))) {
        gemeinsam.set(key, text);
      }
    }
    return gemeinsam;
  }

  // Ob ein Pruefpunkt eine Tatsache ueber EINE Parzelle behauptet, entscheidet
  // T.istEinzelfallAussage (js/sources/checklist.js) — dort, wo die Punkte
  // entstehen und wo ihre Kennzeichnung gepflegt wird. Nur was die Probe
  // besteht, darf in den gemeinsamen Anhang (REGELN.md §12.7).
  const istEinzelfallAussage = (item) => T.istEinzelfallAussage(item);

  function ermittleGemeinsames(liste) {
    if (!gleicherRechtsrahmen(liste)) return null;

    const tierB = schnittmenge(liste, (r) =>
      (r.checklist && r.checklist.tierB || [])
        .filter((i) => !istEinzelfallAussage(i))
        .map((i) => [i.key || i.label, `${i.status}|${i.text}`]));
    const tierBItems = (liste[0].checklist.tierB || []).filter((i) => tierB.has(i.key || i.label));

    // Dieselbe Schranke fuer die Parkierungs-Fussnoten: die aus der BZO
    // (Auslegung von «GNF», nicht angewandte ÖV-Reduktion) sind Regeltexte,
    // die hergeleiteten (Wohnungszahl, Besucherplaetze) tragen Zahlen dieses
    // Grundstuecks und bleiben bei ihm — auch wenn sie zufaellig einmal
    // gleich lauten sollten.
    const pkHinweise = schnittmenge(liste, (r) =>
      (r.parkierung && r.parkierung.hinweise || [])
        .filter((h) => !istEinzelfallAussage({ text: h }))
        .map((h) => [h, h]));

    // Die Werkzeug-Annahme-Tafel des Parkierungsblatts: gleich, wenn Artikel,
    // Flaechenannahmen und Unterbringungssatz uebereinstimmen.
    const pkKopf = (r) => (r.parkierung && r.parkierung.erfasst
      ? JSON.stringify([r.rules.meta.parkierung && r.rules.meta.parkierung.art,
                        r.parkierung.annahmen, r.parkierung.unterbringung])
      : null);
    const pkAnnahmenGleich = pkKopf(liste[0]) != null
      && liste.every((r) => pkKopf(r) === pkKopf(liste[0]));

    const etwas = tierBItems.length || pkHinweise.size || pkAnnahmenGleich;
    if (!etwas) return null;
    return {
      num: GEMEINSAM_NUM,
      titel: GEMEINSAM_TITEL,
      anzahl: liste.length,
      tierBKeys: tierB,
      tierBItems,
      pkHinweise,
      pkAnnahmen: pkAnnahmenGleich ? liste[0].parkierung : null,
      // Die Legende der Belastbarkeitsstufen ist eine Konstante des
      // Werkzeugs — sie kann gar nicht abweichen.
      belastbarkeitLegende: true,
    };
  }

  // Der Einzeiler, der auf dem Parzellenblatt an die Stelle des ausgelagerten
  // Blocks tritt. Er NENNT, was ausgelagert wurde: ein blosser Verweis auf
  // «weitere Hinweise» liesse offen, ob ein Punkt geprueft oder vergessen
  // wurde — und das waere schlechter als die Wiederholung.
  function gemeinsamVerweis(gem, was) {
    // Ohne Verb im Anschluss: `was` ist mal Singular («Die Legende»), mal
    // Plural («6 Prüfpunkte») — ein fest gesetztes «steht» stimmte dann bei
    // der Haelfte der Verweise nicht.
    return `<div class="verweis"><b>${esc(was)}</b> — für alle ${gem.anzahl} Grundstücke `
      + `gleichlautend auf Blatt ${esc(gem.num)} «${esc(gem.titel)}» am Ende dieses Dokuments.</div>`;
  }

  // ---- Attika: geht sie oder nicht? -------------------------------------
  // Die Frage stand bisher nur zwischen den Zeilen: als Variantenkarte auf
  // Blatt 2, als Hinweis im Anhang. Wer wissen will, ob ein Attikageschoss
  // drin liegt, soll es auf dem ERSTEN Blatt lesen — es entscheidet ueber
  // eine ganze Wohnung.
  //
  // Vier Faelle, alle benannt: gebaut, zonenrechtlich unzulaessig, zulaessig
  // aber geometrisch nicht darstellbar (der 45°-Ruecksprung frisst die
  // Tiefe auf), oder in dieser Variante schlicht nicht gewaehlt.
  function attikaBefund(mm, rules) {
    if (!mm) return null;
    if (mm.attikaStoreys > 0) {
      return {
        ja: true,
        satz: `Attika möglich — ${mm.attikaStoreys} Geschoss`
          + `${mm.attikaFootplateM2 ? ` à ${fmt(mm.attikaFootplateM2, 0)} m²` : ''}`
          + `${mm.attikaSetbackM ? `, 45°-Rücksprung ${fmt(mm.attikaSetbackM)} m` : ''}.`,
      };
    }
    if (mm.attikaMax === 0) {
      return { ja: false, satz: 'Attika nicht möglich — in dieser Zone ist kein Dach-/Attikageschoss anrechenbar.' };
    }
    if (mm.attikaSuppressed) {
      const d = (mm.attikaDiagnostics || [])[0];
      const rest = d ? fmt(Math.max(0, d.narrowestM)) : null;
      return {
        ja: false,
        satz: 'Attika nicht möglich — zonenrechtlich zulässig, aber geometrisch nicht darstellbar: '
          + (rest
              ? `der 45°-Rücksprung von ${fmt(mm.attikaSetbackM)} m je Seite lässt nur ${rest} m Bautiefe übrig `
                + `(mindestens ${T.MIN_PRIMITIVE_WIDTH_M} m nötig).`
              : `der 45°-Rücksprung lässt zu wenig Bautiefe übrig.`),
      };
    }
    return { ja: null, satz: 'Attika in dieser Variante nicht gerechnet — die gewählte Geschosszahl kommt ohne aus.' };
  }

  // "2 Vollgeschosse", "2 Vollgeschosse + 1 Attika" — ganze Geschosse, nie
  // ein Bruch. Gleiche Formulierung wie am Bildschirm (js/app.js).
  function storeyLabel(ordinary, attika) {
    const base = `${ordinary} Vollgeschoss${ordinary === 1 ? '' : 'e'}`;
    return attika > 0 ? `${base} + ${attika} Attika` : base;
  }


  // ---- Abgrenzung -------------------------------------------------------
  // Was dieses Werkzeug NICHT beantwortet, ausgeschrieben. Die Phase
  // Machbarkeit (SIA 112, 2014, Teilphase 21) prueft rechtliche, technische,
  // staedtebauliche, oekologische und wirtschaftliche Rahmenbedingungen;
  // gerechnet wird hier nur der baurechtliche Teil. Ein Bericht, der die
  // uebrigen Themen stillschweigend weglaesst, liest sich wie eine
  // vollstaendige Machbarkeitsstudie und ist damit falsch — deshalb stehen
  // sie als benannte Luecke im Dokument statt gar nicht.
  function abgrenzungSheetBody() {
    const notChecked = [
      ['Altlasten', 'Ob der Standort im Altlastenkataster des Kantons verzeichnet ist, wurde nicht abgefragt. Ein Eintrag kann Aushub, Entsorgung und Termine erheblich verteuern.'],
      ['Naturgefahren', 'Die Gefahrenkarte (Hochwasser, Rutschung, Sturz) wurde nicht ausgewertet. Sie kann Kotenlage, Untergeschoss und Konstruktion vorgeben.'],
      ['Lärm', 'Lärmbelastungskataster und Empfindlichkeitsstufe wurden nicht abgefragt. Bei Wohnnutzung ist der Lärmschutz häufig grundrissbestimmend und kann die hier gerechnete Geschossfläche unbenutzbar machen.'],
      ['Baugrund und Grundwasser', 'Kein geologisches Gutachten. Tragfähigkeit, Aushubklasse und Grundwasserspiegel sind offen — sie entscheiden mit, ob das oben gerechnete Untergeschoss überhaupt wirtschaftlich ist.'],
      ['Erschliessung (technisch)', 'Wasser, Abwasser, Energie und der Werkleitungskataster wurden nicht geprüft; siehe dazu den Punkt «Werkleitungen» auf dem Blatt «Einschränkungen».'],
      ['Standort und Umfeld', 'Keine Analyse zu Zentren, Arbeitsplätzen, Naherholung oder Nachbarschaft. Die Eignung der Nutzung am Ort ist damit nicht belegt.'],
    ];
    const notScope = [
      ['Raumprogramm und Nutzungsvarianten', 'Diese Auswertung rechnet eine Hüllform, keinen Entwurf. Wohnungsspiegel, Raumgrössen und Betriebskonzept sind Gegenstand der Projektdefinition.'],
      ['Varianten', 'Es wird genau ein Szenario gerechnet — die maximale baurechtliche Ausnützung. Eine Machbarkeitsstudie stellt üblicherweise mehrere Lösungsmöglichkeiten gegenüber.'],
      ['Nachhaltigkeit und Energie', 'Standards, Energiekonzept und Materialwahl sind nicht behandelt; sie werden in dieser Phase mit der Bauherrschaft festgelegt.'],
      ['Wirtschaftlichkeit', 'Enthalten ist eine Grobkostenschätzung der Erstellungskosten. NICHT enthalten sind Erträge, Betriebs- und Lebenszykluskosten und damit jede Renditeaussage.'],
      ['Termine', 'Kein Terminplan, keine Aussage zum Bewilligungsverfahren und zu dessen Dauer.'],
      ['Bestand', 'Es wird von unbebautem Land ausgegangen. Bestehende Bauten, Abbruch und Bestandesschutz sind nicht berücksichtigt.'],
    ];
    const block = (items) => items.map(([k, v]) =>
      `<div class="ci ci-review"><span class="ci-badge">OFFEN</span>` +
      `<span><b>${esc(k)}</b><br>${esc(v)}</span></div>`).join('');
    return `<div class="note-box" style="margin-top:0;margin-bottom:6mm">
        <b>Was dieses Dokument ist.</b> Eine baurechtliche Machbarkeitsprüfung: Zone,
        Ausnützung, Abstände, Volumen und eine grobe Kostenschätzung, hergeleitet aus
        den auf dem Blatt «Quellen und Vorbehalte» zitierten Bestimmungen. Sie deckt
        den rechtlichen Teil der Phase Machbarkeit ab (SIA 112, 2014, Teilphase 21) —
        nicht die Phase als Ganzes. Die folgenden Themen sind offen; keines davon
        wurde geprüft und als unproblematisch befunden.
      </div>
      <div class="cols c-5050">
        <div><h3>Standort, Umwelt, Technik — nicht geprüft</h3>${block(notChecked)}</div>
        <div><h3>Nicht Gegenstand dieses Werkzeugs</h3>${block(notScope)}</div>
      </div>`;
  }

  // ---- Parkierung -------------------------------------------------------
  // Die Pflichtplaetze wachsen mit der Geschossflaeche und muessen in der
  // Regel unter den Baukoerper — ab einer bestimmten Groesse bindet nicht
  // mehr die Ausnuetzungsziffer, sondern die Garage. Gerechnet wurde das
  // schon (core/parkierung.js), im Export fehlte es: die Zahlen standen nur
  // am Bildschirm, auf Papier kam allenfalls eine Warnzeile an.
  // Es wird weiterhin NICHTS vom Fussabdruck abgezogen — ob die Garage
  // zweigeschossig wird oder das Haus kleiner, ist eine Entwurfsentscheidung.
  function parkierungSheetBody(pk, rules, gem, nichtBebaubarJa) {
    // Gleiche Regel wie bei den Kosten (s5 unten): Pflichtplaetze, Flaechen-
    // bedarf und «bindend» setzen einen Baukoerper voraus. Ist die Parzelle
    // fuer sich allein faktisch nicht bebaubar, gibt es diesen Baukoerper
    // nicht — die Zahlen (3 Pflichtplaetze, 56 m² Tiefgarage, «Bindend») sind
    // dann eine Aussage ueber ein Gebaeude, das laut Blatt 1 selbst nicht
    // existiert. Das Parkierungsblatt bleibt als Abschnitt bestehen (anders
    // als das entfallende Kostenblatt), zeigt aber nur den Kurzhinweis.
    if (nichtBebaubarJa) {
      return `<div class="hero">
        <div class="hero-label">Parkierung</div>
        <div class="hero-value">— (nicht bebaubar)</div>
        <div class="hero-sub">Der Parkplatzbedarf entsteht erst im Arealszenario und ist dort zu rechnen.</div>
      </div>`;
    }
    if (!pk.erfasst) {
      return `<div class="cols c-5050">
        <div>
          <div class="hero">
            <div class="hero-label">Pflichtparkplätze</div>
            <div class="hero-value">Nicht prüfbar</div>
            <div class="hero-sub">Hier wird nichts gerechnet und nichts geschätzt.</div>
          </div>
          <div class="note-box">${esc(pk.grund)}</div>
        </div>
        <div>
          <h3>Warum das offen bleibt</h3>
          <div class="note-box small">
            § 242 PBG überlässt die Zahl der Abstellplätze der kommunalen Regelung.
            Liegt diese Quelle dem Werkzeug nicht vor, wäre jede Zahl erfunden —
            deshalb steht hier keine.<br><br>
            <b>Nächster Schritt:</b> Parkplatzverordnung der Gemeinde samt Wegleitung
            beiziehen und die Pflichtplätze festlegen, bevor das Volumen weiterbearbeitet
            wird. Müssen die Plätze unterirdisch unter den Baukörper, können sie die auf
            den Blättern «Volumetrie» und «Grundriss» gerechnete Geschossfläche
            begrenzen — dann bindet die Garage und nicht die Ausnützungsziffer.
          </div>
        </div>
      </div>`;
    }
    const A = pk.annahmen;
    const rows = [
      ['Bezugsgrösse (nutzbare Geschossfläche)', fmt(pk.gnfM2) + ' m²', ''],
      ['Wohnungen', pk.wohnungen + (pk.wohnungenHergeleitet ? ' — hergeleitet, Annahme' : ' — gesetzt'), ''],
      ['Plätze Bewohner', String(pk.bewohnerP), ''],
      ['Plätze Besucher', String(pk.besucherP), ''],
      ['Pflichtplätze total', String(pk.totalP), 'result'],
      ['Flächenbedarf Tiefgarage', fmt(pk.tiefgarageBedarfM2) + ' m²', ''],
      ['Flächenbedarf oberirdisch (Besucher)', fmt(pk.oberirdischBedarfM2) + ' m²', ''],
      ['Freifläche auf der Parzelle', fmt(pk.freiflaecheM2) + ' m²', pk.oberirdischPasst ? '' : 'minus'],
      ['Plätze je Untergeschoss', pk.plaetzeJeUgGeschoss + ' unter ' + fmt(pk.fussabdruckM2) + ' m² Baukörper', ''],
      ['Geschossfläche, die ein UG trägt', fmt(pk.gnfAusEinemUgM2) + ' m²', 'result'],
    ];
    const verdict = pk.bindet
      ? {
          label: 'Bindend',
          value: 'Die Parkierung begrenzt das Volumen',
          sub: `${pk.ugGeschosseNoetig} Untergeschosse nötig — oder weniger Geschossfläche`,
        }
      : {
          label: 'Nicht bindend',
          value: `${pk.totalP} Pflichtplätze, unterbringbar`,
          sub: 'Ein Untergeschoss trägt die gerechnete Geschossfläche',
        };
    return `<div class="cols c-5545">
      <div>
        <div class="hero">
          <div class="hero-label">${esc(verdict.label)}</div>
          <div class="hero-value">${esc(verdict.value)}</div>
          <div class="hero-sub">${esc(verdict.sub)}</div>
        </div>
        <table class="derive">
          ${rows.map(([k, v, cls]) => `<tr class="${cls}"><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}
        </table>
      </div>
      <div>
        ${/* Die Annahmetafel und die beiden Fussnoten aus der BZO (Auslegung
             von «GNF», Hinweis auf die ÖV-Reduktion nach Art. 27) sind bei
             mehreren Grundstuecken im selben Rechtsrahmen wortgleich. Sie
             stehen dann einmal im gemeinsamen Anhang; die Trennung von
             Rechtswert und Werkzeug-Annahme bleibt auf JEDEM Blatt sichtbar —
             sie steht in der Quellenzeile unten. */''}
        ${gem && gem.pkAnnahmen
          ? gemeinsamVerweis(gem, 'Rechtswert und Werkzeug-Annahme der Parkierung (Fläche je Abstellplatz, Unterbringung)')
          : `<h3>Rechtswert und Werkzeug-Annahme, getrennt</h3>
        <table class="facts">
          <tr><td>Rechtswert</td><td>${esc(rules.meta.parkierung.art || '—')}: Zahl der Pflichtplätze, hergeleitet aus Geschossfläche und Wohnungszahl.</td></tr>
          <tr><td>Werkzeug-Annahme</td><td>Fläche je Platz Tiefgarage ${A.flaecheJePlatzTiefgarageM2} m² (Bandbreite ${A.flaecheJePlatzTiefgarageBandM2[0]}–${A.flaecheJePlatzTiefgarageBandM2[1]} m²), oberirdisch ${A.flaecheJePlatzOberirdischM2} m² (${A.flaecheJePlatzOberirdischBandM2[0]}–${A.flaecheJePlatzOberirdischBandM2[1]} m²), je inkl. Anteil Fahrgasse und Rampe. <b>Kein Gesetzeswert</b> — die Platzzahl oben ist belegt, der Flächenbedarf ist geschätzt.</td></tr>
          ${pk.unterbringung ? `<tr><td>Unterbringung</td><td>${esc(pk.unterbringung)}</td></tr>` : ''}
        </table>`}
        <div class="note-box small">
          Von der bebaubaren Fläche wurde für die Parkierung <b>nichts abgezogen</b>.
          Ob die Garage zweigeschossig wird, über den Baukörper hinausreicht oder das
          Haus kleiner wird, ist eine Entwurfsentscheidung — dieses Blatt sagt nur,
          ab wann sie ansteht.
        </div>
        ${(() => {
          const eigene = gem ? pk.hinweise.filter((h) => !gem.pkHinweise.has(h)) : pk.hinweise;
          const ausgelagert = gem ? pk.hinweise.filter((h) => gem.pkHinweise.has(h)) : [];
          return (eigene.length ? `<div class="flags">${eigene.map((h) => `<div class="flagline">${esc(h)}</div>`).join('')}</div>` : '')
            + (ausgelagert.length ? gemeinsamVerweis(gem, `${ausgelagert.length} weitere Fussnote${ausgelagert.length === 1 ? '' : 'n'} zur Parkierung (Auslegung der Bezugsgrösse, nicht angewandte Reduktionen)`) : '');
        })()}
        ${/* pk.bindendHinweis bewusst NICHT hier: die Verdict-Kachel oben links
             sagt dasselbe, und die Zahlen dahinter stehen in der Tabelle
             daneben. Am Bildschirm (ohne Kachel) wird er weiterhin gezeigt. */''}
      </div>
    </div>`;
  }


  // ---- Titelblatt --------------------------------------------------------
  // Erste Seite des Exports: Adresse, zwei Saetze dazu, was das Dokument ist,
  // Absender und Stand. Bewusst fast leer — die Dichte kommt auf den
  // Folgeblaettern.
  // Ein Grundstueck als Zeile: Adresse, sonst die Parzellennummer.
  //
  // Die Kette selbst liegt seit dem 31.8.2026 in js/core/format.js, weil sie
  // nicht nur das Titelblatt betrifft: Kopfzeile, Kennwerte-Tafel,
  // Zonen-Steckbrief und der PDF-Dateiname lasen jeweils ihre eigene, und
  // die Ketten stimmten nicht ueberein — im Export vom 31.8.2026 hiess
  // Parzelle 5028 auf der Trennseite «Haldenstrasse 5a» und drei Zeilen
  // spaeter im Kicker «Parzelle 5028». Hier bleibt nur der kurze Name.
  const betreffVon = (r) => T.betreffVon(r);
  const grundstueckLabel = (r) => T.grundstueckLabel(r);

  // `liste` sind die Auswertungen des Dokuments — im Arealmodus eine, sonst
  // eine je Parzelle. Das Titelblatt nennt sie ALLE: wer drei Grundstuecke
  // pruefen laesst, muss auf der ersten Seite sehen, dass alle drei drin
  // stehen, und nicht nur das erste.
  function titleSheet(liste, foot) {
    const r = liste[0];
    const { selection, anchor, rules } = r;
    const mehrere = liste.length > 1;
    const alleParzellen = liste.flatMap((x) => x.selection);
    const multi = alleParzellen.length > 1;
    const subject = mehrere
      ? `${liste.length} Grundstücke in ${rules.gemeinde}`
      : betreffVon(r);
    const dateStr = new Date().toLocaleDateString('de-CH');
    return `<section class="sheet sheet-title">
      <div class="titel-mitte">
        <div class="titel-kicker">Baurechtliche Machbarkeitsstudie</div>
        <h1 class="titel-adresse">${esc(subject)}</h1>
        <div class="titel-meta">Gemeinde ${esc(rules.gemeinde)} · ${multi ? 'Parzellen' : 'Parzelle'} ${esc(alleParzellen.map((p) => p.parcelNumber).join(' + '))} · Zone ${esc(anchor.zone)}${anchor.zoneLabel ? ` (${esc(anchor.zoneLabel)})` : ''}</div>
        ${mehrere ? `<ul class="titel-liste">${liste.map((x, i) =>
          `<li><span class="tl-n">${i + 1}</span><span class="tl-a">${esc(betreffVon(x))}</span>`
          + `<span class="tl-p">Parzelle ${esc(x.selection.map((p) => p.parcelNumber).join(' + '))}</span></li>`).join('')}</ul>` : ''}
        <p class="titel-text">Automatisch erstellte baurechtliche Machbarkeitsstudie.${mehrere
          ? ` Diese Datei enthält ${liste.length} getrennte Auswertungen — je Grundstück eine, jede für sich gerechnet.`
          : ''}</p>
      </div>
      <div class="titel-unten">
        <div class="titel-autor">exportiert von ${esc(T.ABSENDER)}</div>
        <div class="titel-stand">erstellt am ${esc(dateStr)} · Werkzeug ${esc(T.WERKZEUG_VERSION)} · ${esc(rules.source.version)}</div>
      </div>
      <footer class="sheet-foot">${foot}</footer>
    </section>`;
  }

  // Jedes Blatt beginnt unter dem Titel mit ein bis zwei Saetzen, die sagen,
  // was die Seite zeigt und worauf sie sich stuetzt — der Leser soll nicht
  // aus der Tabelle erraten muessen, was er vor sich hat.
  // `num` ist die Abschnittsnummer («1», «A.2»): sie steht als Chip im
  // Kicker, wandert als data-Attribut ans Blatt (PDF-Bookmarks, Mini-
  // Inhaltsverzeichnis) und fehlt bei Blaettern ohne Nummer einfach.
  // `opts.dokumentweit` markiert die Blaetter, die zum GANZEN Dokument
  // gehoeren und nicht zu einem Grundstueck (Schlussanhang). Vorher wurden
  // sie an ihren Abschnittsnummern erkannt — eine Liste `'A.3' || 'A.4'` an
  // zwei Stellen, die beim naechsten eingefuegten Anhangblatt still falsch
  // wird: das Blatt bekaeme den Abschnitt des letzten Grundstuecks und
  // stuende im Inhalt als dessen Unterpunkt.
  function sheet(title, kicker, intro, bodyHtml, footerHtml, sourcesHtml, num, opts) {
    const o = opts || {};
    return `<section class="sheet" data-outline-title="${esc(title)}"${num ? ` data-outline-num="${esc(num)}"` : ''}${o.dokumentweit ? ' data-dokumentweit="1"' : ''}>
      <header class="sheet-head">
        <div class="kicker">${num ? `<span class="sect-num">${esc(num)}</span>` : ''}${esc(kicker)}</div>
        <h2>${esc(title)}</h2>
        ${intro ? `<p class="sheet-intro">${esc(intro)}</p>` : ''}
      </header>
      <div class="sheet-body">${/^[\s\S]*\sdata-flow[\s=>]/.test(bodyHtml)
        ? bodyHtml
        : `<div data-flow>${bodyHtml}</div>`}</div>
      ${sourcesHtml ? `<div class="sheet-sources">${sourcesHtml}</div>` : ''}
      <footer class="sheet-foot">${footerHtml || ''}</footer>
    </section>`;
  }

  // One compact line naming the legal sources this sheet's argument rests on
  // — document, article and page, from the provenance records. Every sheet
  // carries its own sources so each page of the export is self-supporting.
  function sourcesLine(rules, entries) {
    const parts = [];
    for (const [label, ...keys] of entries) {
      let prov = null;
      for (const k of keys) {
        prov = T.getProvenance ? T.getProvenance(rules, k) : null;
        if (prov) break;
      }
      if (prov) {
        parts.push(`${esc(label)}: ${esc(prov.article || '')}${prov.page ? `, S. ${prov.page}` : ''}${prov.title ? ` (${esc(prov.title)})` : ''}`);
      }
    }
    return parts.length ? `<b>Quellen:</b> ${parts.join(' · ')}` : '';
  }

  function kpi(label, value, sub) {
    return `<div class="kpi"><div class="kpi-label">${esc(label)}</div>
      <div class="kpi-value">${esc(value)}</div>
      ${sub ? `<div class="kpi-sub">${esc(sub)}</div>` : ''}</div>`;
  }

  // crossorigin="anonymous" auf den WMS-Kacheln ist nicht optional: der
  // PDF-Export (js/ui/pdf.js) zeichnet diese Bilder in ein Canvas, und ohne
  // CORS-Freigabe waere das Canvas "tainted" und nicht auslesbar. Der Dienst
  // liefert access-control-allow-origin: * (geprueft 2026-08-27).
  //
  // w/h are the pixel dimensions the map is composed at; the bbox is derived
  // from them so raster and vector layers stay registered to each other.
  // zoneFeatures is pre-fetched by the caller (one request, reused per sheet).
  function mapBlock(rings, centerE, centerN, halfSpan, layers, zoneFeatures, w, h) {
    const bbox = T.buildMapBbox(centerE, centerN, halfSpan, w, h);
    const zoning = layers.includes('zoning') && zoneFeatures
      ? T.buildZonePlanSvg(zoneFeatures, bbox, w, h) : '';
    const cadastre = layers.includes('cadastre')
      ? `<img class="layer ${layers.includes('zoning') ? 'multiply' : ''}" crossorigin="anonymous" src="${T.buildCadastreMapUrl(bbox, w, h)}" alt="Parzellengrenzen">` : '';
    const overlay = T.buildParcelOverlaySvg(rings, bbox, w, h);
    return `<div class="mapwrap" style="aspect-ratio:${w}/${h}">${zoning}${cadastre}${overlay}</div>`;
  }

  // Draws what the Waldabstand computation actually did: the forest, the
  // Waldabstandslinie, and the strip of parcel it removed. Without this the
  // deduction is just a number the reader has to take on trust.
  function restrictionMapSvg(wald, rings, bbox, w, h) {
    const [minE, minN, maxE, maxN] = bbox;
    const px = ([e, n]) => [
      ((e - minE) / (maxE - minE)) * w,
      h - ((n - minN) / (maxN - minN)) * h,
    ];
    const ringPath = (ring) => 'M' + ring.map((c) => px(c).map((v) => v.toFixed(1)).join(',')).join('L') + 'Z';
    const linePath = (coords) => 'M' + coords.map((c) => px(c).map((v) => v.toFixed(1)).join(',')).join('L');
    const out = [];

    out.push(`<defs><pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="8" stroke="#c62828" stroke-width="3"/></pattern></defs>`);

    for (const f of (wald.forest || [])) {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const p of polys) {
        out.push(`<path d="${p.map(ringPath).join(' ')}" fill="#9fc38f" fill-opacity=".85" fill-rule="evenodd" stroke="#5f8a52" stroke-width="1.5"/>`);
      }
    }
    if (wald.forbidden) {
      const polys = wald.forbidden.geometry.type === 'Polygon'
        ? [wald.forbidden.geometry.coordinates] : wald.forbidden.geometry.coordinates;
      for (const p of polys) {
        out.push(`<path d="${p.map(ringPath).join(' ')}" fill="url(#hatch)" fill-opacity=".55" fill-rule="evenodd" stroke="#c62828" stroke-width="1.5"/>`);
      }
    }
    for (const f of (wald.lines || [])) {
      const segs = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const seg of segs) {
        out.push(`<path d="${linePath(seg)}" fill="none" stroke="#2f6b23" stroke-width="3" stroke-dasharray="10 6"/>`);
      }
    }
    for (const ring of rings) {
      out.push(`<path d="${ringPath(ring)}" fill="none" stroke="#c62828" stroke-width="3"/>`);
    }
    return `<svg class="layer" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${out.join('')}</svg>`;
  }

  function legend(entries) {
    return `<div class="legend">${entries.map(([swatch, label]) =>
      `<div class="lg"><span class="lg-sw" style="${swatch}"></span>${esc(label)}</div>`).join('')}</div>`;
  }

  // Eine Zeile je Punkt: Badge + Titel. Für das Blatt «Zone & Regeln», wo
  // die vollen Begründungstexte die Spalte sprengten — sie stehen im Anhang.
  function checklistCompactHtml(items) {
    return items.map((i) => `<div class="ci-line ci-${i.status}">
      <span class="ci-badge">${esc(i.status.toUpperCase())}</span>
      <span>${esc(i.label)}</span></div>`).join('');
  }
  function checklistHtml(items) {
    return items.map((i) => `<div class="ci ci-${i.status}">
      <span class="ci-badge">${esc(i.status.toUpperCase())}</span>
      <span><b>${esc(i.label)}</b><br>${esc(i.text)}</span></div>`).join('');
  }

  // r = the result object from app.js analyse(); flags = the rendered flag
  // strings; grundbuchFootnote may be null.
  // Baut die Blaetter EINER Auswertung und gibt sie in vier Gruppen zurueck,
  // damit der Aufrufer sie fuer mehrere Parzellen zusammensetzen kann.
  async function buildSheetsForResult(r, grundbuchFootnote, mehrere, gem) {
    // Die Hinweise haengen am Ergebnis, nicht am Aufruf: bei mehreren
    // Parzellen traegt sonst jede die Hinweise der ersten.
    const flags = r.flags || [];
    const { selection, anchor, rules, rulesData, reconciled, terrainHeight,
            checklist, merged, setbackFootprint, waldLossInFootprintM2, footprintBeforeWaldM2, wald,
            waldRemoved, lengthLimitM, footprintRect, lengthExceeded, massing, areaRect,
            lengthLossM2, gebaeudeabstandM, massingModel, terrainGrid, hang } = r;
    const multi = selection.length > 1;
    const rings = selection.map((p) => p.geometryLV95[0]);
    const { centerE, centerN, halfSpan } = T.boundingBoxForRings(rings, 25);
    const wideSpan = halfSpan * 2.2;

    // One zoning request covering the widest extent any sheet uses.
    const zoneBbox = T.buildMapBbox(centerE, centerN, Math.max(wideSpan * 1.6, 260), 1, 1);
    const zoneFeatures = await T.fetchZonePolygons(zoneBbox);

    // The PDF must show the SAME building the screen shows: the massing model
    // (chosen storeys, GFA-constrained), not the abstract legal hull — the
    // hull overstated volume and cost by a large factor on AZ-bound parcels.
    const envelopePng = setbackFootprint
      ? T.renderEnvelopeToDataURL({
          footprintFeature: setbackFootprint,
          parcelFeature: merged,
          removedFeature: waldRemoved,
          waldLinien: (wald && wald.lines) || null,
          heightM: rules.heightM,
          massing: massingModel,
        }, 1600, 1080)
      : null;

    // Ein Geschoss ist eine ganze Zahl. "0.73 von 2 Vollgeschossen" war der
    // Quotient Geschossfläche/Fussabdruck und las sich wie "nicht einmal ein
    // Geschoss möglich" — während in Wahrheit zwei Geschosse auf halbem
    // Fussabdruck gebaut werden. Gezeigt wird deshalb der Baukörper, den das
    // Werkzeug tatsächlich modelliert: ganze Geschosse mit ihrer Grundfläche.
    const headline = reconciled.usableFootprintAreaM2 <= 0
      ? 'Kein bebaubares Volumen'
      : massingModel
        ? `${storeyLabel(massingModel.ordinaryStoreys, massingModel.attikaStoreys)} à ${fmt(massingModel.floorplateM2, 0)} m²`
        : `${rules.vollgeschosse_max} Vollgeschosse`;

    // ---- Traegt dieser Rest ueberhaupt ein Gebaeude? ---------------------
    // T.faktischNichtBebaubar (js/core/envelope.js) misst die Tiefe des
    // bebaubaren Rests am flaechenkleinsten Rechteck. Bleibt sie unter der
    // Mindestbreite eines Baukoerpers, ist «Realistisches Szenario» als
    // Ueberschrift eine Zusage, die die Zahl nicht deckt: Parzelle 5028
    // behaelt 36.7 m² — als Streifen von 2.7 m Tiefe. Gerechnet wird
    // unveraendert weiter; es wechselt die Beschriftung, keine Zahl.
    //
    // Steht hier oben, weil zwei Dinge davon abhaengen, die vor dem ersten
    // Blatt feststehen muessen: die Beschriftung auf Blatt 1 und die Frage,
    // ob es ein Kostenblatt gibt (und damit die Abschnittsnummern).
    const nichtBebaubar = T.faktischNichtBebaubar(r);
    const arealVerweis = mehrere
      ? 'Der Wert dieses Grundstücks liegt in der Arealzusammenfassung — Blatt «Übersicht — getrennt gerechnet» am Anfang dieses Dokuments zeigt sie als gerechnete Variante.'
      : 'Zusammen mit einem Nachbargrundstück gerechnet, entfällt der Grenzabstand an der gemeinsamen Grenze und der bebaubare Rest wird grösser — dafür wäre eine Parzellenvereinigung oder eine im Grundbuch gesicherte Übertragung nötig.';

    const BINDING = {
      grundabstand: 'Grundabstand',
      gruenflaechenziffer: 'Grünflächenziffer',
      ueberbauungsziffer: 'Überbauungsziffer',
      ausnuetzungsziffer: 'Ausnützungsziffer',
    };
    const binding = BINDING[reconciled.bindingConstraint] || reconciled.bindingConstraint;

    // Cost from the built massing (same figure as on screen); the hull only
    // as fallback when no massing model exists.
    const envelopeVolumeM3 = massingModel ? massingModel.volumeM3 : reconciled.usableFootprintAreaM2 * rules.heightM;
    const cost = T.estimateCost(envelopeVolumeM3);
    const dateStr = new Date().toLocaleDateString('de-CH');
    // The zone rides in the running footer of every sheet: it is the premise
    // of every number in the document, and a page read on its own has to say
    // which zone it is talking about.
    // Bei mehreren Grundstuecken traegt die Fusszeile die PARZELLE mit. Ohne
    // sie sind die Seiten zweier Grundstuecke am Fuss nicht zu unterscheiden
    // — dieselbe Gemeinde, dieselbe Zone, dasselbe Datum. Wer ein einzelnes
    // Blatt in der Hand haelt, muss sehen, wovon es spricht.
    // Ohne Parzelle — fuer die Blaetter, die zum GANZEN Dokument gehoeren.
    const footNeutral = `${esc(rules.gemeinde)} · Zone ${esc(anchor.zone)} · ${dateStr}`;
    const foot = mehrere
      ? `${esc(rules.gemeinde)} · Parzelle ${esc(selection.map((p) => p.parcelNumber).join(' + '))}`
        + ` · Zone ${esc(anchor.zone)} · ${dateStr}`
      : footNeutral;

    // ---- Abschnittsnummern -------------------------------------------------
    // Die Nummern hängen davon ab, welche optionalen Blätter dieses Grundstück
    // bekommt (Waldabstand nur wo er greift, Parkierung nur mit kommunaler
    // Regel) — deshalb werden sie hier EINMAL vergeben und überall konsumiert:
    // im Kicker-Chip, im Mini-Inhaltsverzeichnis und in den PDF-Bookmarks.
    const pk = r.parkierung;
    const showWaldMap = !!(wald && wald.forbidden);
    // Abschnittsnummern. «Zone & Regeln» ist entfallen, deshalb ruecken
    // Waldabstand und alles danach um eine Stelle vor.
    const numPot = '2', numSitu = '3';
    let numCursor = 4;
    const numWald = showWaldMap ? String(numCursor++) : null;
    const numPk = pk ? String(numCursor++) : null;
    // Kein Kostenblatt fuer einen Streifen, auf dem nichts steht. Die Nummer
    // wird dann auch nicht verbraucht — sonst fehlte im Inhalt eine Ziffer
    // und der Leser suchte ein Blatt, das es absichtlich nicht gibt.
    const numKosten = nichtBebaubar.ja ? null : String(numCursor++);

    // ---- Sheet 1: Übersicht ------------------------------------------------
    // ---- Blatt 1: Das Wichtigste in Kürze ---------------------------------
    // Das Blatt, das ein Makler zuerst zeigt: Verdict, Kernzahlen, drei bis
    // vier Argumente in ganzen Sätzen, daneben Karte und Inhaltsverzeichnis.
    // Die Identitäts-Fakten (EGRID, Rechtsstatus, Terrain) sind zum Blatt
    // «Zone & Regeln» umgezogen — hier verkauft die Seite, dort belegt sie.
    // Die Kacheln daneben tragen die Zahlen; diese Saetze tragen, was in
    // keiner Kachel steht: warum diese Groesse bindet, und woher die
    // Differenz zwischen anrechenbarer und nutzbarer Geschossflaeche kommt.
    // Frueher wiederholte jeder Satz eine Kachel (Flaeche, Geschossflaeche,
    // bindende Groesse, Kosten) -- vier Zahlen, jede zweimal auf einem Blatt.
    const args = [
      bindingExplanation(reconciled, rules),
      ...(massingModel && massingModel.nutzflaecheTotalM2 > reconciled.maxGfaM2 + 1e-6
        ? [`Nutzbar sind dennoch ${fmt(massingModel.nutzflaecheTotalM2, 0)} m²: Dach-, Attika- und Untergeschosse bleiben nach § 255 Abs. 3 PBG je Geschoss bis zu einem Freibetrag ohne Anrechnung an die Ausnützungsziffer.`]
        : []),
    ];
    const s1 = sheet('Das Wichtigste in Kürze',
      betreffVon(r),
      'Was hier gebaut werden darf, auf welcher Fläche und mit welchen Grenzen — nach amtlicher Vermessung und den Bauvorschriften von Kanton und Gemeinde.',
      `<div class="cols c-6040">
        <div>
          <div class="hero">
            <div class="hero-label">${nichtBebaubar.ja
              ? 'Für sich allein faktisch nicht bebaubar'
              : 'Realistisches Szenario'}</div>
            <div class="hero-value">${esc(headline)}</div>
            <div class="hero-sub">${nichtBebaubar.ja
              ? `rechnerisch — bei ${esc(fmt(nichtBebaubar.tiefeM))} m Bautiefe kein Baufeld`
              : `bindend: ${esc(binding)}`}</div>
          </div>
          <div class="kpis">
            ${kpi(multi ? 'Fläche zusammengefasst' : 'Parzellenfläche', fmt(reconciled.parcelAreaM2) + ' m²')}
            ${kpi('Max. Geschossfläche', fmt(reconciled.maxGfaM2) + ' m²')}
            ${kpi('Nutzbarer Fussabdruck', fmt(reconciled.usableFootprintAreaM2) + ' m²')}
            ${kpi('Kosten grob (BKP 2)', nichtBebaubar.ja
              ? '— (nicht bebaubar)'
              : '≈ CHF ' + fmtInt(cost.totalChf))}
          </div>
          ${nichtBebaubar.ja
            ? `<div class="merkzeile is-nein"><span class="mz-k">Bebaubarkeit</span>`
              + `<span class="mz-t">${esc(nichtBebaubar.grund)} ${esc(arealVerweis)}`
              + ` Eine Kostenschätzung ist deshalb nicht ausgewiesen: sie würde einen`
              + ` Baukörper bepreisen, den dieses Grundstück für sich allein nicht trägt.`
              + `</span></div>`
            : ''}
          ${(() => {
            const ab = attikaBefund(massingModel, rules);
            if (!ab) return '';
            const kl = ab.ja === true ? 'is-ja' : (ab.ja === false ? 'is-nein' : 'is-offen');
            return `<div class="attika-zeile ${kl}"><span class="az-k">Attika</span>`
              + `<span class="az-t">${esc(ab.satz)}</span></div>`;
          })()}
          ${/* Der Rechtsstand der BZO gehoert auf die erste Seite jedes
               Grundstuecks, nicht nur ins Quellenblatt am Ende: der Vorbehalt
               zur teilweisen Nichtgenehmigung entscheidet, ob die Grundmasse
               darueber ueberhaupt noch gelten — im Anhang steht er 40 Seiten
               hinter der Zahl, die er einschraenkt. Wortlaut unveraendert aus
               data/bzo-*.json (`legal_status`), damit hier keine zweite,
               weichere Fassung desselben Vorbehalts entsteht. */''}
          ${rulesData.legal_status
            ? `<div class="merkzeile is-warn"><span class="mz-k">Rechtsstand</span>`
              + `<span class="mz-t"><b>${esc(rules.source.version)}</b> — ${esc(rulesData.legal_status)}</span></div>`
            : ''}
          <ul class="args">${args.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
        </div>
        <div>${mapBlock(rings, centerE, centerN, wideSpan, ['cadastre'], null, 900, 540)}
          <div class="caption">Situationsplan — ${multi ? 'gewählte Parzellen' : 'Parzelle'} rot markiert. Amtliche Vermessung (swisstopo / Kantone).</div>
          ${/* Das Inhaltsverzeichnis steht seit dem 31.8.2026 als eigenes
               Blatt auf Seite 2 — hier waere es ein zweites, das bei
               mehreren Grundstuecken ausserdem nur den eigenen Abschnitt
               kennt. Der Platz gehoert jetzt der Karte. */''}
        </div>
      </div>`, foot,
      sourcesLine(rules, [
        ['Ausnützungsziffer', 'ausnuetzungsziffer_max_pct'],
        ['Vollgeschosse', 'vollgeschosse_max'],
        ['Höhe', rules.heightRegime ? 'gebaeudehoehe_max_m_bzo2016' : 'traufseitige_fassadenhoehe_max_m', 'gebaeudehoehe_max_m'],
        ['Regime', 'negative_vorwirkung'],
      ]), '1');

    // ---- Blatt 2: Potenzial & Volumetrie ----------------------------------
    const abz = r.flaechenAbzuege || {};
    const derivation = [
      [multi ? 'Fläche zusammengefasst' : 'Parzellenfläche', fmt(reconciled.parcelAreaM2) + ' m²', ''],
    ];
    if (abz.waldM2 > 0.5) {
      derivation.push(['Abzug Wald (§ 259 PBG: fällt ausser Ansatz)', '− ' + fmt(abz.waldM2) + ' m²', 'minus']);
    }
    if (abz.waldAbstand15M2 > 0.5) {
      derivation.push(['Abzug Waldabstandsfläche > 15 m hinter der Linie (§ 259 aPBG)', '− ' + fmt(abz.waldAbstand15M2) + ' m²', 'minus']);
    }
    // Nur zeigen, wenn tatsaechlich etwas abgezogen wurde -- sonst steht
    // hier die Parzellenflaeche ein zweites Mal.
    if (Math.abs(reconciled.anrechenbareFlaecheM2 - reconciled.parcelAreaM2) > 0.5) {
      derivation.push(['Anrechenbare Grundstücksfläche', fmt(reconciled.anrechenbareFlaecheM2) + ' m²', '']);
    }
    // Das Mass des Grundabstands steht auf dem Blatt «Zone & Regeln»; hier
    // zaehlt, welchen Schritt die Zeile macht, nicht die Wiederholung der Zahl.
    derivation.push(['Fussabdruck nach Grundabstand', fmt(footprintBeforeWaldM2) + ' m²', 'minus']);
    const hasCap = reconciled.hasGreenCap || reconciled.hasUeberbauungsCap;
    if (waldLossInFootprintM2 > 0.5) {
      derivation.push(['Abzug Waldabstand', '− ' + fmt(waldLossInFootprintM2) + ' m²', 'minus']);
      // Zwischenstand nur, wenn ein Deckel ihn danach noch veraendert --
      // sonst ist er zahlengleich mit «Nutzbarer Fussabdruck» unten.
      if (hasCap) {
        derivation.push(['Fussabdruck nach Waldabstand', fmt(reconciled.setbackFootprintAreaM2) + ' m²', '']);
      }
    }
    // Eine Grünflächenziffer, die es in dieser Zone nicht gibt, ist kein
    // Rechenschritt. Dass die Regel geprüft und für nicht anwendbar befunden
    // wurde, hält das Blatt «Belastbarkeit der Zahlen» als «?» fest -- die
    // Angabe geht nicht verloren, sie steht nur nicht zweimal (REGELN.md §2).
    if (reconciled.hasGreenCap) {
      derivation.push(['Deckel Grünflächenziffer', fmt(reconciled.footprintAfterGreenCapAreaM2) + ' m²', '']);
    }
    if (reconciled.hasUeberbauungsCap) {
      derivation.push(['Deckel Überbauungsziffer',
        fmt(reconciled.footprintAfterUeberbauungsCapM2) + ' m²', '']);
    }
    derivation.push(['Nutzbarer Fussabdruck', fmt(reconciled.usableFootprintAreaM2) + ' m²', 'result']);
    derivation.push(['Max. anrechenbare Geschossfläche', fmt(reconciled.maxGfaM2) + ' m²', 'result']);
    // «Bebaubar als» stand hier und gleich darunter noch einmal auf der
    // aktiven Variantenkarte («gerechnet & dargestellt»). Die Karte bleibt:
    // sie zeigt die Wahl, die Zeile zeigte nur ihr Ergebnis.
    if (massingModel && (massingModel.attikaStoreys > 0 || massingModel.ugStoreys > 0)) {
      derivation.push(['Freibetrag Dach-/Attika-/UG (§ 255 Abs. 3 PBG)',
        `je Geschoss bis ${fmt(massingModel.perStoreyFreeM2)} m² frei`, '']);
      derivation.push(['Nutzbare Geschossfläche total', fmt(massingModel.nutzflaecheTotalM2) + ' m²', 'result']);
    }

    // Variantenreihe: dieselben Zahlen wie die Karten am Bildschirm, aus
    // T.storeyVariantData (js/core/envelope.js) — der Export sagt damit auch,
    // dass die Geschosszahl eine WAHL ist, nicht ein einziges Ergebnis.
    //
    // `suppressed` schlaegt `active`, nicht umgekehrt. Die gewaehlte Variante
    // ist beides zugleich, wenn die Attika am 45°-Profil scheitert: sie ist
    // die gerechnete UND die nicht darstellbare. Bis zum 31.8.2026 gewann
    // `active`, und die Karte «2 Vollgeschosse + 1 Attika» trug auf Parzelle
    // 5028 den Vermerk «gerechnet & dargestellt» — obwohl gerechnet und
    // dargestellt zwei Vollgeschosse OHNE Attika wurden. Die Karte behauptete
    // damit genau das, was der Attika-Befund zwei Blaetter davor bestreitet.
    // Sie bleibt in der Reihe (die Variante ist zonenrechtlich zulaessig),
    // sagt aber, was an ihr scheitert und was statt ihrer gebaut wird.
    const variantData = T.storeyVariantData(massingModel, reconciled);
    const variantsHtml = variantData.length
      ? `<div class="variants-row">${variantData.map((v) =>
          `<div class="variant-card${v.active ? ' active' : ''}${v.suppressed ? ' unavailable' : ''}">
             <div class="v-n">${esc(storeyLabel(v.ordinary, v.attika))}</div>
             <div class="v-d">${v.suppressed
                ? esc(T.attikaSuppressShort(massingModel))
                : `${fmt(v.plateM2, 0)} m²/Geschoss · ${fmt(v.coveragePct, 0)} % überbaut · Höhe ${fmt(v.heightM)} m`}</div>
             ${v.suppressed
                ? `<div class="v-tag">nicht darstellbar — gerechnet: ${esc(storeyLabel(v.ordinary, 0))}</div>`
                : (v.active ? '<div class="v-tag">gerechnet & dargestellt</div>' : '<div class="v-tag">gleich zulässig</div>')}
           </div>`).join('')}</div>`
      : '';

    const s2 = sheet('Potenzial & Volumetrie', 'Wie die Zahl zustande kommt',
      'Schritt für Schritt von der Parzellenfläche zur zulässigen Geschossfläche — jede Zeile stützt sich auf eine unten genannte Bestimmung. Die Geschosszahl ist eine Entwurfswahl: die Reihe unten zeigt jede zulässige Variante.',
      `<div class="cols c-5545">
        <div>
          <table class="derive">
            ${derivation.map(([k, v, cls]) => `<tr class="${cls}"><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}
          </table>
        </div>
        <div>
          ${envelopePng ? `<img class="render" src="${envelopePng}" alt="Isometrie">` : '<div class="empty">Kein Volumen darstellbar.</div>'}
          ${waldRemoved ? legend([['background:#b08b4f;', 'zulässige Hüllform'],['background:rgba(198,40,40,.35);border:1px solid #c62828;', 'durch Waldabstand entfallen'],['background:transparent;border:1px solid #333;', 'Parzellengrenze']]) : ''}<div class="caption">Maximal zulässige Hüllform, auf die zulässige ${esc(rules.heightMetric)} extrudiert.${waldRemoved ? ' Der rot dargestellte Teil ist durch die boolesche Differenz mit der Waldabstands-Fläche entfallen und in den Zahlen links bereits abgezogen.' : ''} Flaches Dach ist eine Vereinfachung der Darstellung.</div>
        </div>
      </div>
      ${variantsHtml}`, foot,
      sourcesLine(rules, [
        ['Anrechenbare Fläche', 'massgebliche_grundflaeche', 'anrechenbare_grundstuecksflaeche', 'massgebliche_grundflaeche_altrecht'],
        ['Grundabstand', 'grundabstand_min_m'],
        ['Grünflächenziffer', 'gruenflaechenziffer_min_pct'],
        ['Überbauungsziffer', 'ueberbauungsziffer_hauptgebaeude_max_pct'],
        ['Ausnützungsziffer', 'ausnuetzungsziffer_max_pct'],
        ['Freibetrag', 'dach_attika_ug_freibetrag'],
      ]), numPot);

    // ---- Blatt 3: Situation & Grundriss ------------------------------------
    const fpDims = (() => {
      if (!setbackFootprint) return null;
      const g = setbackFootprint.geometry;
      const pts = g.type === 'Polygon' ? g.coordinates.flat(1) : g.coordinates.flat(2);
      const e = pts.map((q) => q[0]), n = pts.map((q) => q[1]);
      return { w: Math.max(...e) - Math.min(...e), d: Math.max(...n) - Math.min(...n) };
    })();

    const s2b = sheet('Situation & Grundriss', 'Bebaubare Grundfläche, massstäblich',
      'Die bebaubare Grundfläche im Erdgeschoss, massstäblich und nordorientiert gezeichnet — nach Abzug von Grenzabständen, Gebäudeabständen und Waldabstand.',
      `<div class="cols c-7228">
        <div>${setbackFootprint
          ? T.buildFloorPlanSvg({ parcelFeature: merged,
              footprintFeature: massingModel ? massingModel.footprintFeature : setbackFootprint,
              removedFeature: waldRemoved, lengthRect: massing && !massing.impossible ? areaRect : footprintRect,
              lengthLimitM, lengthResolved: !!(massing && !massing.impossible), blockCount: massing ? massing.count : 0,
              terrainGrid, hang, waldLinien: (wald && wald.lines) || null,
              widthPx: 1500, heightPx: 1010 })
          : '<div class="empty">Keine bebaubare Grundfläche.</div>'}
        </div>
        <div>
          <table class="facts big">
            ${/* Die zulaessige Gebaeudelaenge steht als Anmerkung IN der
                 Zeichnung («… (max. N m)»), dort wo sie gilt -- als eigene
                 Tabellenzeile daneben stand sie zweimal auf einem Blatt. */''}
            ${massing && !massing.impossible
              ? `<tr><td>Bereich zu lang</td><td>${fmt(areaRect.lengthM)} m → geteilt</td></tr>
                 <tr><td>Baukörper</td><td><b>${massing.count} × ${fmt(massing.blockLengthM)} m</b> (längster ${fmt(massing.longestBlockM)} m)</td></tr>
                 <tr><td>Gebäudeabstand</td><td>${gebaeudeabstandM} m · kostet ${fmt(lengthLossM2)} m²</td></tr>`
              : (footprintRect ? `<tr><td>Kleinstes Rechteck (L × B)</td><td><b>${fmt(footprintRect.lengthM)} × ${fmt(footprintRect.widthM)} m</b>${lengthLimitM != null ? ' — eingehalten' : ''}</td></tr>` : '')}
          </table>
          ${legend([
            ['background:#d9a066;border:1px solid #8a4b08;', 'bebaubare Grundfläche'],
            ...(waldRemoved ? [['background:repeating-linear-gradient(45deg,#c62828 0 3px,transparent 3px 6px);border:1px dashed #c62828;', 'durch Waldabstand entfallen']] : []),
            ...((wald && wald.lines) ? [['background:transparent;border-top:2.5px dashed #2f6b23;height:0;margin-top:6px;', 'Waldabstandslinie (durchgehend, ogd-0152)']] : []),
            ['background:#fafafa;border:1px solid #333;', 'Parzelle'],
          ])}
          <div class="note-box small">
            Nordorientiert und massstäblich gezeichnet. Die Bemassung ist das Hüllmass
            des Fussabdrucks, nicht eine Gebäudekante — die tatsächliche Gebäudeform ist
            innerhalb dieser Fläche frei wählbar.
          </div>
        </div>
      </div>`, foot,
      sourcesLine(rules, [
        ['Grundabstand', 'grundabstand_min_m'],
        ['Grosser Grenzabstand', 'grosser_grenzabstand_min_m'],
        ['Hauptfassaden', 'grosser_grenzabstand_suedseiten'],
        ['Mehrlängenzuschlag', 'mehrlaengenzuschlag'],
        ['Gebäudelänge', 'gesamtlaenge_max_m', 'gebaeudelaenge_inkl_klein_anbauten_max_m'],
        ['Waldabstand', 'waldabstand'],
      ]), numSitu);

    // ---- Blatt 4: Zone & Regeln --------------------------------------------
    // Das Blatt «Zone & Regeln» ist am 31.8.2026 entfallen. Es zeigte im
    // Kern denselben Kartenausschnitt ein zweites Mal, nur mit der
    // Zonenfarbe darunter; die Grundmasse stehen ohnehin in jeder
    // Quellenzeile und vollstaendig im Anhang A.1, die Pruefliste im Anhang
    // A.2. Fuer den Leser war es eine Wiederholung mit anderer Karte.

    // ---- Blatt 5 (nur wo er greift): Waldabstand ---------------------------
    // Die Wald-Geometrie bekommt ihr eigenes Blatt statt einer Ecke der
    // Checkliste: wo sie greift, ist sie der grösste einzelne Abzug des
    // Grundstücks — und wo nicht, fehlt das Blatt einfach.
    const rmW = 1000, rmH = 780;
    const rmBbox = T.buildMapBbox(centerE, centerN, halfSpan * 1.45, rmW, rmH);
    const sWald = showWaldMap
      ? sheet('Waldabstand', 'Der grösste Abzug dieses Grundstücks, geometrisch ermittelt',
          'Die Waldabstandslinie und die Fläche, die auf ihrer Waldseite liegt — sie ist vom bebaubaren Bereich abgezogen und in allen Zahlen dieses Dokuments berücksichtigt.',
          `<div class="cols c-5545">
            <div>
              <div class="mapwrap" style="aspect-ratio:${rmW}/${rmH}">
                <img class="layer multiply" crossorigin="anonymous" src="${T.buildCadastreMapUrl(rmBbox, rmW, rmH)}" alt="Parzellengrenzen">
                ${restrictionMapSvg(wald, rings, rmBbox, rmW, rmH)}
              </div>
              ${legend([
                ['background:#9fc38f;border:1px solid #5f8a52;', 'Waldareal'],
                ['background:transparent;border-top:3px dashed #2f6b23;height:0;margin-top:6px;', 'Waldabstandslinie'],
                ['background:repeating-linear-gradient(45deg,#c62828 0 3px,transparent 3px 6px);border:1px solid #c62828;', 'nicht bebaubar (Waldseite)'],
                ['background:transparent;border:2px solid #c62828;', multi ? 'gewählte Parzellen' : 'Parzelle'],
              ])}
            </div>
            <div>
              <table class="facts big">
                <tr><td>Fläche auf der Waldseite der Linie</td><td><b>${fmt(wald.lostAreaM2)} m²</b></td></tr>
                ${waldLossInFootprintM2 > 0.5 ? `<tr><td>davon im Fussabdruck abgezogen</td><td>− ${fmt(waldLossInFootprintM2)} m²</td></tr>` : ''}
                ${(r.flaechenAbzuege && r.flaechenAbzuege.waldM2 > 0.5) ? `<tr><td>Abzug Wald von der anrechenbaren Fläche</td><td>− ${fmt(r.flaechenAbzuege.waldM2)} m²</td></tr>` : ''}
                ${(r.flaechenAbzuege && r.flaechenAbzuege.waldAbstand15M2 > 0.5) ? `<tr><td>Abzug > 15 m hinter der Linie (§ 259 aPBG)</td><td>− ${fmt(r.flaechenAbzuege.waldAbstand15M2)} m²</td></tr>` : ''}
              </table>
              <div class="note-box small">
                Geometrisch ermittelt aus der <b>festgesetzten Waldabstandslinie</b>
                (ogd-0152, mit ihrer eingetragenen Wirkungsseite) und dem Waldareal
                (ogd-0111) — kein eigener Puffer um den Wald. Zwei verschiedene
                Grössen, nicht zu vermischen: Der Abzug <b>im Fussabdruck</b> ist die
                Bauverbotsfläche zwischen Linie und Wald (§ 262 PBG). Der Abzug von
                der <b>anrechenbaren Fläche</b> ist die Waldabstandsfläche, soweit sie
                mehr als 15 m hinter der Linie liegt (§ 259 aPBG) — sie betrifft die
                Ausnützung, nicht das Baufeld.
              </div>
            </div>
          </div>`,
          foot,
          sourcesLine(rules, [['Waldabstand', 'waldabstand']]), numWald)
      : '';

    // ---- Sheet 4b: Hinweise (the flags) ------------------------------------
    // The warnings are numerous and legally load-bearing; squeezed under the
    // checklist they overflowed the fixed sheet and painted over the sources
    // line. They get their own sheet, two columns.
    // Anhang A.2 trägt jetzt AUCH die vollständige Tier-B-Checkliste: das
    // Blatt «Zone & Regeln» nennt nur den Zähler und verweist hierher.
    const tierAPrint = checklist.tierA.map((i) => (showWaldMap && i.key === 'waldabstand')
      ? { ...i, text: `Berücksichtigt und geometrisch abgezogen — Karte, Flächen und Rechtsgrundlage auf Blatt ${numWald}.` }
      : i);
    const flagsPrint = pk && r.parkierungFlags
      ? flags.filter((f) => !r.parkierungFlags.includes(f))
      : flags;

    // Die Pruefpunkte, die in ALLEN Auswertungen gleich lauten, stehen einmal
    // im gemeinsamen Anhang; hier bleibt, was diesem Grundstueck eigen ist.
    // Der Verweis NENNT die ausgelagerten Punkte namentlich — sonst waere
    // nicht mehr erkennbar, ob ein Punkt geprueft oder vergessen wurde.
    const tierBEigen = gem
      ? checklist.tierB.filter((i) => !gem.tierBKeys.has(i.key || i.label))
      : checklist.tierB;
    const tierBAusgelagert = gem
      ? checklist.tierB.filter((i) => gem.tierBKeys.has(i.key || i.label))
      : [];

    const s4b = (flagsPrint.length || checklist.tierB.length)
      ? sheet('Hinweise, Vorbehalte & offene Punkte', 'Anhang — jede Vereinfachung, ausgeschrieben',
          'Was vor einem Bauprojekt manuell zu klären bleibt, und jede Vereinfachung und Annahme dieser Berechnung — wer eine Zahl weiterverwendet, sollte den zugehörigen Hinweis kennen.',
          `<div class="flags-cols" data-flow>
            <h3>Automatisch geprüft</h3>
            ${checklistHtml(tierAPrint)}
            <h3 style="margin-top:4mm">Manuell zu prüfen</h3>
            ${tierBEigen.length ? checklistHtml(tierBEigen) : ''}
            ${tierBAusgelagert.length
              ? gemeinsamVerweis(gem, `${tierBAusgelagert.length} Prüfpunkte, die nicht am einzelnen Grundstück hängen (${tierBAusgelagert.map((i) => i.label).join(', ')})`)
              : ''}
            <h3 style="margin-top:4mm">Hinweise der Berechnung</h3>
            ${flagsPrint.map((f) => `<div class="flagline">${esc(f)}</div>`).join('')}
          </div>`,
          foot,
          '<b>Quellen:</b> je Hinweis im Text genannt (Artikel/Paragraph); Wortlaut der zitierten Bestimmungen auf dem Blatt «Quellen und Vorbehalte».',
          'A.2')
      : '';

    // ---- Sheet 4c: Parkierung ---------------------------------------------
    // Position: nach den Einschränkungen, vor den Kosten. Die Parkierung ist
    // eine Einschränkung des Volumens und zugleich Voraussetzung des Volumens,
    // aus dem die Kosten gerechnet werden — sie gehört zwischen beide.
    // (`pk` ist oben bei der Nummernvergabe deklariert.)
    const sPk = pk
      ? sheet('Parkierung', nichtBebaubar.ja
          ? 'Entfällt — kein Baukörper'
          : (pk.erfasst && pk.bindet
            ? 'Wann die Garage das Volumen begrenzt — nicht die Ausnützungsziffer'
            : 'Pflichtplätze und ihr Flächenbedarf'),
          nichtBebaubar.ja
            ? 'Auf diesem Streifen steht kein Gebäude — deshalb kein Parkplatzbedarf für sich allein.'
            : 'Wie viele Parkplätze die Bauordnung verlangt, wie viel Fläche sie brauchen — und ab wann die Garage statt der Ausnützungsziffer das Volumen begrenzt.',
          parkierungSheetBody(pk, rules, gem, nichtBebaubar.ja), foot,
          nichtBebaubar.ja
            ? ''
            : (pk.erfasst
              ? sourcesLine(rules, [['Parkierung', 'parkierung']])
                + ' · <b>Werkzeug-Annahme (kein Rechtswert):</b> Fläche je Abstellplatz.'
              : '<b>Quellen:</b> § 242 PBG überlässt die Zahl der Abstellplätze der kommunalen Regelung; diese liegt dem Werkzeug für diese Gemeinde nicht vor — deshalb keine Zahl.'),
          numPk)
      : '';

    // ---- Sheet 5: Kosten ---------------------------------------------------
    // Entfaellt, wo der bebaubare Rest kein Gebaeude traegt. Parzelle 5028
    // trug bis zum 31.8.2026 «Für sich allein faktisch nicht bebaubar» und
    // zwei Blaetter weiter CHF 220'000 BKP 2 fuer eben diesen Streifen —
    // eine Zahl, die ihre eigene Voraussetzung bestreitet. Das Volumen
    // darunter bleibt gerechnet (es steckt in der Volumetrie); nur der
    // Preis dafuer wird nicht mehr genannt.
    const s5 = nichtBebaubar.ja ? '' : sheet('Kostenschätzung, grob', 'Sehr grob — keine Kostenplanung',
      'Überschlägige Gebäudekosten (BKP 2) aus dem hergeleiteten Volumen und einem Erfahrungskennwert für den Raum Zürich — eine Grössenordnung, keine Kostenplanung.',
      `<div class="cols c-5050">
        <div>
          <div class="hero">
            <div class="hero-label">Erstellungskosten BKP 2, überschlägig</div>
            <div class="hero-value">≈ CHF ${fmtInt(cost.totalChf)}</div>
            <div class="hero-sub">${fmt(envelopeVolumeM3)} m³ umbauter Raum (Box-Näherung) × CHF ${cost.chfPerM3}/m³</div>
          </div>
        </div>
        <div>
          <h3>Bandbreite</h3>
          <table class="derive">
            <tr><td><b>Kennwert BKP 2</b></td><td><b>Gebäudekosten</b></td><td><b>inkl. BNK +30%</b></td></tr>
            ${[800, 900, 1000].map((k) => `<tr class="${k === cost.chfPerM3 ? 'result' : ''}">
              <td>CHF ${k}/m³</td>
              <td>CHF ${fmtInt(T.roundUpChf(envelopeVolumeM3 * k))}</td>
              <td>CHF ${fmtInt(T.roundUpChf(envelopeVolumeM3 * k * 1.3))}</td></tr>`).join('')}
          </table>
          <div class="note-box small">${esc(cost.note)}</div>
        </div>
      </div>`, foot,
      '<b>Quellen:</b> Kostenkennwert ist eine Werkzeug-Annahme (Bandbreite CHF 800–1000/m³ BKP 2), kein Gesetzeswert. Volumen aus dem oben hergeleiteten Baukörper.',
      numKosten);

    // ---- Sheet 5a: Belastbarkeit ------------------------------------------
    // Jede Zahl dieses Berichts mit ihrer Sicherheitsstufe. Ohne dieses Blatt
    // sähe auf dem Papier ein geschätzter Wert aus wie ein belegter — und ein
    // Wert, der am Bildschirm als unsicher markiert ist, aber gedruckt glatt
    // erscheint, ist gedruckt eine falsche Zahl (gleiche Begründung wie beim
    // Parkierungsblatt, REGELN.md §7).
    const sBel = (r.kennwerte && r.kennwerte.length)
      ? (() => {
          const alle = r.kennwerte.flatMap((g) => g.rows);
          const z = T.zaehleSicherheit(alle);
          const legende = T.SICHERHEIT_STUFEN_NACH_RANG.map((st) =>
            `<tr>`
            + `<td class="bel-z bel-${st.key}">${esc(st.zeichen)}</td>`
            + `<td><b>${esc(st.label)}</b><br><span class="bel-erk">${esc(st.erklaerung)}</span></td>`
            + `<td class="bel-n">${z[st.key]}</td></tr>`).join('');
          const tafel = r.kennwerte.map((g) =>
            `<tr class="bel-grp"><td colspan="4">${esc(g.title)}</td></tr>`
            + g.rows.map((row) => {
              const st = T.SICHERHEIT_STUFEN[row.sicherheit];
              return `<tr class="bel-r bel-r-${row.sicherheit}">`
                + `<td class="bel-z bel-${row.sicherheit}">${esc(st.zeichen)}</td>`
                + `<td>${esc(row.label)}</td>`
                + `<td class="bel-v">${esc(row.value)}</td>`
                + `<td class="bel-g">${esc(row.sicherheitGrund || st.kurz)}${row.sicherheitVererbt ? ' <i>(geerbt)</i>' : ''}</td>`
                + `</tr>`;
            }).join('')).join('');
          return sheet('Belastbarkeit der Zahlen', 'Anhang — was belegt ist und was nicht',
            'Nicht jede Zahl ist gleich gut abgestützt — diese Seite stuft jeden Wert ein: belegt, vereinfacht angewandt, Annahme des Werkzeugs oder nicht ermittelbar.',
            `<div class="bel-kopf">
              <div class="hero">
                <div class="hero-label">Von ${alle.length} Werten belegt</div>
                <div class="hero-value">${z.BELEGT} von ${alle.length}</div>
                <div class="hero-sub">${z.VEREINFACHT} vereinfacht · ${z.ANNAHME} Annahme · ${z.NICHT_ERMITTELBAR} nicht ermittelbar</div>
              </div>
              ${/* Die Legende ist eine Konstante des Werkzeugs und stand bei
                   drei Grundstuecken dreimal wortgleich da. Die ZAEHLUNG
                   daneben bleibt hier — sie gehoert zu diesem Grundstueck. */''}
              ${gem && gem.belastbarkeitLegende
                ? `<div class="bel-legende">${gemeinsamVerweis(gem, 'Was die Zeichen § ~ ? bedeuten und wie sich eine Stufe vererbt')}</div>`
                : `<div class="bel-legende">
                ${T.SICHERHEIT_STUFEN_NACH_RANG.map((st) =>
                  `<div><b class="bel-z bel-${st.key}">${esc(st.zeichen)}</b> <b>${esc(st.label)}</b> (${z[st.key]}) — ${esc(st.erklaerung)}</div>`).join('')}
                <div class="bel-fuss">Ein abgeleiteter Wert trägt die schwächste Stufe seiner Eingänge; «geerbt» heisst: einer seiner Eingänge ist schwächer belegt als er selbst. Kein Wert unterhalb von «belegt» ist eine bestandene Prüfung.</div>
              </div>`}
            </div>
            <table class="derive bel-tafel"><tbody data-flow>${tafel}</tbody></table>`, foot,
            '<b>Quellen:</b> die Einstufung selbst rechnet nichts. Sie liest die Belegstellen der Datendateien '
            + '(Artikel, Seite, Wortlaut) und das Register der Werkzeug-Annahmen — Wortlaut auf dem Blatt «Quellen und Vorbehalte».',
            'A.1');
        })()
      : '';

    // ---- Sheet 5b: Abgrenzung ---------------------------------------------
    // Direkt vor den Quellen: das Dokument schliesst mit Umfang und Grundlage.
    const sAbg = sheet('Nicht Gegenstand dieser Auswertung', 'Anhang — was offen bleibt, benannt statt weggelassen',
      'Eine vollständige Machbarkeitsstudie beantwortet mehr als das Baurecht — diese Seite nennt, was hier bewusst offen bleibt, damit nichts davon als geprüft gilt.',
      abgrenzungSheetBody(), footNeutral,
      '<b>Quellen:</b> auf diesem Blatt wird nichts gerechnet. Der Umfang der Phase Machbarkeit folgt der Norm SIA 112, Modell Bauplanung, 2014, Teilphase 21.',
      'A.4', { dokumentweit: true });

    // ---- Sheet 6: Quellen & Vorbehalte ------------------------------------
    // Full WORDING of every cited provision (from the provenance records) —
    // the report has to carry the paragraphs it quotes, not just references.
    const QUOTE_LIST = [
      ['Ausnützungsziffer', 'ausnuetzungsziffer_max_pct'],
      ['Überbauungsziffer', 'ueberbauungsziffer_hauptgebaeude_max_pct'],
      ['Grünflächenziffer', 'gruenflaechenziffer_min_pct'],
      ['Vollgeschosse', 'vollgeschosse_max'],
      ['Anrechenbares Untergeschoss', 'anrechenbares_untergeschoss_max'],
      ['Anrechenbare Dach-/Attikageschosse', 'anrechenbares_dach_attika_max'],
      ['Zulässige Höhe', rules.heightRegime ? 'gebaeudehoehe_max_m_bzo2016' : (rules.traufseitige_fassadenhoehe_max_m != null ? 'traufseitige_fassadenhoehe_max_m' : 'gebaeudehoehe_max_m')],
      ['Firsthöhe (Zuschlag)', 'firsthoehe_zuschlag_m'],
      ['Grenzabstand (Grundabstand)', 'grundabstand_min_m'],
      ['Grosser Grenzabstand / Hauptfassaden', 'grosser_grenzabstand_suedseiten', 'grosser_grenzabstand_min_m'],
      ['Mehrlängenzuschlag', 'mehrlaengenzuschlag'],
      ['Gebäude-/Gesamtlänge', rules.gesamtlaenge_max_m != null ? 'gesamtlaenge_max_m' : 'gebaeudelaenge_inkl_klein_anbauten_max_m'],
      ['Anrechenbare Grundstücksfläche', 'massgebliche_grundflaeche', 'anrechenbare_grundstuecksflaeche', 'massgebliche_grundflaeche_altrecht'],
      ['Freibetrag Dach-/Attika-/UG', 'dach_attika_ug_freibetrag'],
      ['Attika-Profil (45°)', 'attika_profil_ueberhoehung_m'],
      ['Attika Bergseite', 'attika_bergseite'],
      ['Waldabstand', 'waldabstand'],
      ['Strassenabstand ohne Baulinien', 'strassenabstand_ohne_baulinien_m'],
      ['Begrünung', 'begruenung_perimeter_min_pct'],
      ['Negative Vorwirkung (Regime)', 'negative_vorwirkung'],
    ];
    const quoteItems = [];
    for (const [label, ...keys] of QUOTE_LIST) {
      let prov = null;
      for (const k of keys) {
        prov = T.getProvenance ? T.getProvenance(rules, k) : null;
        if (prov) break;
      }
      if (!prov || !prov.quote) continue;
      quoteItems.push(
        `<div class="quote-item"><div class="q-head">${esc(label)}</div>` +
        `<div class="q-ref">${esc(prov.article || '')}${prov.page ? `, S. ${prov.page}` : ''}${prov.title ? ` — ${esc(prov.title)}` : ''}</div>` +
        `<div class="q-text">„${esc(prov.quote)}"</div></div>`
      );
    }

    const s6 = sheet('Quellen und Vorbehalte', 'Anhang — Grundlage und Grenzen, mit Wortlaut',
      'Die verwendeten Datenquellen, die Vorbehalte dieser Auswertung und der Wortlaut jeder zitierten Bestimmung.',
      `<div class="cols c-5050" style="margin-bottom:5mm">
        <div>
          <h3>Quellen</h3>
          <table class="facts">
            <tr><td>Zone / Grundmasse</td><td>Kantonale Nutzungsplanung ZH, Datensatz ogd-0156</td></tr>
            <tr><td>Bauvorschriften</td><td>${esc(rules.source.version)}</td></tr>
            <tr><td>Parzellengeometrie</td><td>Amtliche Vermessung (swisstopo)</td></tr>
            <tr><td>Eigentumsbeschränkungen</td><td>ÖREB-Kataster Kanton Zürich</td></tr>
            <tr><td>Waldabstand</td><td>Kantonale Geodaten ogd-0152 (Abstandslinie) und ogd-0111 (Waldareal)</td></tr>
            <tr><td>Terrain</td><td>swissALTI3D</td></tr>
          </table>
        </div>
        <div>
          <h3>Vorbehalte</h3>
          <div class="note-box small">${esc(rulesData.legal_status || '')}</div>
          ${grundbuchFootnote ? `<div class="note-box small"><b>Grundbuchauszug:</b> ${esc(grundbuchFootnote)}</div>` : ''}
          <div class="note-box small">
            Zonenzuordnung an der Grundstücksgrenze zusätzlich prüfen.
            Kein Ersatz für eine unterschriebene Machbarkeitsstudie oder ein Baugesuch.
          </div>
        </div>
      </div>
      <h3>Zitierte Bestimmungen (Wortlaut)</h3>
      <div class="quote-list" data-flow>${quoteItems.join('')}</div>`, footNeutral, '', 'A.5',
      { dokumentweit: true });

    // Geordnete Blattfolge (CLAUDE.md Carve-out 3): die Erzählung eines
    // Verkaufsdokuments — Ergebnis, Potenzial, Ort, Recht, dann der Anhang
    // mit Belastbarkeit und Wortlaut. Umgestellt am 29.8.2026 (v1.1).
    //
    // In vier Gruppen statt einer Zeichenkette, damit mehrere Parzellen in
    // EIN Dokument passen (siehe buildPrintDocument):
    //   titel   — einmal, ganz vorn
    //   koerper — je Parzelle: Ergebnis, Potenzial, Ort, Recht, Kosten
    //   belege  — je Parzelle: Belastbarkeit (A.1) und Hinweise (A.2).
    //             Beide gehoeren ZUR PARZELLE: A.1 stuft deren Werte ein,
    //             A.2 traegt deren Hinweise. Ein einziges Exemplar am Ende
    //             wuerde die Zahlen einer Parzelle fuer alle ausgeben.
    //   schluss — einmal am Ende: Abgrenzung (A.3) und Quellen (A.4). Die
    //             gelten fuer das ganze Dokument und sind wortgleich.
    return {
      foot,
      footNeutral,
      koerper: [s1, s2, s2b, sWald, sPk, s5].join(''),
      belege: [sBel, s4b].join(''),
      schluss: [sAbg, s6].join(''),
    };
  }

  // ---- Kapitelblatt vor jedem Grundstueck --------------------------------
  // Eine schmale Trennseite, damit beim Blaettern klar ist, dass hier ein
  // NEUES Grundstueck anfaengt und nicht dasselbe weitergeht. Sie traegt die
  // Nummer, die Adresse und die drei Schlagzahlen — genug, um zu wissen, wo
  // man ist und was kommt, ohne die folgenden Blaetter vorwegzunehmen.
  // Nur bei getrennter Auswertung: bei einem Grundstueck gaebe es nichts zu
  // trennen.
  function kapitelSheet(r, index, total, foot) {
    const p = r.selection[0];
    const mm = r.massingModel;
    const zahl = (label, wert) =>
      `<div class="kap-z"><span>${esc(label)}</span><b>${esc(wert)}</b></div>`;
    return `<section class="sheet sheet-kapitel" data-outline-title="${esc(betreffVon(r))}"
             data-outline-num="K" data-kapitel="${index}">
      <div class="kap-mitte">
        <div class="kap-zaehler">Grundstück ${index + 1} von ${total}</div>
        <h1 class="kap-adresse">${esc(betreffVon(r))}</h1>
        <div class="kap-meta">Parzelle ${esc(p.parcelNumber || p.egrid)} · Zone ${esc(r.anchor.zone)}
          · ${esc(r.rules.gemeinde)}</div>
        <div class="kap-zahlen">
          ${zahl('Grundstücksfläche', fmt(r.reconciled.parcelAreaM2, 0) + ' m²')}
          ${zahl('Nutzbarer Fussabdruck', fmt(r.reconciled.usableFootprintAreaM2, 0) + ' m²')}
          ${zahl('Max. Geschossfläche', fmt(r.reconciled.maxGfaM2, 0) + ' m²')}
          ${zahl('Bebaubar als', mm ? storeyLabel(mm.ordinaryStoreys, mm.attikaStoreys) : '—')}
        </div>
        <p class="kap-text">Auf den folgenden Blättern steht die Auswertung dieses
          Grundstücks für sich allein: mit seinen eigenen Grenzabständen, seiner
          eigenen Ausnützung und seinen eigenen Belegen.</p>
        ${(() => {
          // Gleicher Befund wie auf dem Blatt danach (T.faktischNichtBebaubar),
          // nur kuerzer: die Trennseite verspricht sonst einen Abschnitt ueber
          // ein Baugrundstueck, das keines ist.
          const nb = T.faktischNichtBebaubar(r);
          return nb.ja
            ? `<p class="kap-befund"><b>Für sich allein faktisch nicht bebaubar.</b>
                 ${esc(nb.grund)} Der Wert dieses Grundstücks liegt in der
                 Arealzusammenfassung auf dem Blatt «Übersicht — getrennt gerechnet».</p>`
            : '';
        })()}
      </div>
      <footer class="sheet-foot">${foot}</footer>
    </section>`;
  }

  // ---- Inhalt (Seite 2) --------------------------------------------------
  // Das Blatt entsteht LEER und wird nach dem Zusammenbau aus dem
  // tatsaechlichen Dokument gefuellt (fuelleInhalt). Eine fest verdrahtete
  // Liste waere sofort falsch: welche Blaetter es gibt, haengt am Grundstueck
  // (Waldabstand nur wo er greift, Parkierung nur mit kommunaler Regel), und
  // die Abschnittsnummern wiederholen sich bei mehreren Grundstuecken.
  function inhaltSheet(liste, foot) {
    const mehrere = liste.length > 1;
    return sheet('Inhalt',
      mehrere ? `${liste.length} Grundstücke, getrennt gerechnet` : 'Was in diesem Dokument steht',
      mehrere
        ? 'Zuerst die Übersicht über alle Grundstücke zusammen, danach jedes für sich. '
          + 'Vor jedem Grundstück steht eine Trennseite mit seiner Adresse.'
        : 'Die Blätter dieses Dokuments in ihrer Reihenfolge.',
      '<div class="ivz" data-ivz></div>', foot, '', 'I');
  }

  // Fuellt das Inhaltsblatt aus den Blaettern, die wirklich da sind.
  // Laeuft VOR dem Umbruch, damit die Hoehe der Liste beim Umbrechen zaehlt;
  // die Seitenzahlen kommen danach (sie stehen erst nach dem Umbruch fest).
  function fuelleInhalt(host) {
    const ivz = host.querySelector('[data-ivz]');
    if (!ivz) return;
    const rows = [];
    for (const s of host.children) {
      if (!s.classList.contains('sheet')) continue;
      if (s.dataset.continuation) continue;          // Fortsetzungen sind keine Eintraege
      const num = s.dataset.outlineNum || '';
      if (num === 'I' || s.classList.contains('sheet-title')) continue;
      const titel = s.dataset.outlineTitle || '';
      // Oberste Ebene: Uebersicht, Kapitelseiten, Schlussanhang.
      const oben = num === 'Ü' || num === 'K' || s.dataset.dokumentweit === '1';
      const kap = s.dataset.kapitel;
      const beschriftung = num === 'K'
        ? `${Number(kap) + 1}. ${titel}`
        : titel;
      s.dataset.ivzId = String(rows.length);
      rows.push(`<div class="ivz-row${oben ? '' : ' is-sub'}" data-toc-sel="${rows.length}">`
        + `<span class="ivz-t">${esc(beschriftung)}</span><span class="ivz-p"></span></div>`);
    }
    ivz.innerHTML = rows.join('');
  }

  // ---- Gemeinsamer Anhang (nur bei mehreren Grundstuecken) ---------------
  // Traegt einmal, was auf jedem Parzellenblatt wortgleich stuende. Steht am
  // ENDE und nicht vorn: es sind Vorbehalte und Annahmen, keine Ergebnisse —
  // gelesen wird es, wenn eine Zahl weiterverwendet werden soll, nicht beim
  // ersten Durchblaettern.
  function gemeinsamSheet(gem, liste, foot) {
    if (!gem) return '';
    const rules = liste[0].rules;
    const pk = gem.pkAnnahmen;
    const A = pk ? pk.annahmen : null;

    // Die Pruefpunkte sind fuer EIN Grundstueck formuliert und sagen «diese
    // Parzelle» und «oben». Ihr Wortlaut bleibt unangetastet — er ist gegen
    // die Bestimmung geprueft, und eine zweite, umgeschriebene Fassung waere
    // eine zweite Aussage. Stattdessen wird gesagt, worauf die Verweise auf
    // diesem Blatt zeigen.
    const links = gem.tierBItems.length
      ? `<h3>Manuell zu prüfen — für alle ${gem.anzahl} Grundstücke gleich</h3>`
        + `<div class="verweis">Die Punkte sind je Grundstück formuliert und lauten für`
        + ` alle ${gem.anzahl} gleich: «diese Parzelle» meint jedes von ihnen, «oben» die`
        + ` Grundmasse auf dessen eigenem Blatt 1. Wo ein Grundstück abweicht, steht der`
        + ` Punkt bei ihm auf Blatt A.2 und nicht hier.</div>`
        + checklistHtml(gem.tierBItems)
      : '';

    const rechts = [
      gem.belastbarkeitLegende
        ? `<h3>Belastbarkeit der Zahlen — was die Zeichen bedeuten</h3>
           <div class="bel-legende">
             ${T.SICHERHEIT_STUFEN_NACH_RANG.map((st) =>
               `<div><b class="bel-z bel-${st.key}">${esc(st.zeichen)}</b> <b>${esc(st.label)}</b> — ${esc(st.erklaerung)}</div>`).join('')}
             <div class="bel-fuss">Ein abgeleiteter Wert trägt die schwächste Stufe seiner Eingänge; «geerbt» heisst: einer seiner Eingänge ist schwächer belegt als er selbst. Kein Wert unterhalb von «belegt» ist eine bestandene Prüfung. Die Zählung je Grundstück steht auf dessen eigenem Blatt A.1.</div>
           </div>`
        : '',
      pk
        ? `<h3 style="margin-top:5mm">Parkierung — Rechtswert und Werkzeug-Annahme, getrennt</h3>
           <table class="facts">
             <tr><td>Rechtswert</td><td>${esc((rules.meta.parkierung && rules.meta.parkierung.art) || '—')}: Zahl der Pflichtplätze, hergeleitet aus Geschossfläche und Wohnungszahl.</td></tr>
             <tr><td>Werkzeug-Annahme</td><td>Fläche je Platz Tiefgarage ${A.flaecheJePlatzTiefgarageM2} m² (Bandbreite ${A.flaecheJePlatzTiefgarageBandM2[0]}–${A.flaecheJePlatzTiefgarageBandM2[1]} m²), oberirdisch ${A.flaecheJePlatzOberirdischM2} m² (${A.flaecheJePlatzOberirdischBandM2[0]}–${A.flaecheJePlatzOberirdischBandM2[1]} m²), je inkl. Anteil Fahrgasse und Rampe. <b>Kein Gesetzeswert</b> — die Platzzahl je Grundstück ist belegt, der Flächenbedarf ist geschätzt.</td></tr>
             ${pk.unterbringung ? `<tr><td>Unterbringung</td><td>${esc(pk.unterbringung)}</td></tr>` : ''}
           </table>`
        : '',
      gem.pkHinweise.size
        ? `<h3 style="margin-top:5mm">Parkierung — Fussnoten</h3>
           <div class="flags">${[...gem.pkHinweise.values()].map((h) => `<div class="flagline">${esc(h)}</div>`).join('')}</div>`
        : '',
    ].filter(Boolean).join('');

    return sheet(gem.titel, `Anhang — was für alle ${gem.anzahl} Grundstücke gleich gilt`,
      `Diese Vorbehalte und Annahmen hängen an Gemeinde und Zone, nicht am einzelnen Grundstück — sie lauten für alle ${gem.anzahl} Auswertungen dieses Dokuments gleich und stehen deshalb hier einmal statt auf jedem Blatt erneut. Was bei einem Grundstück abweicht, steht weiterhin bei ihm.`,
      `<div class="cols c-5050">
        <div>${links}</div>
        <div>${rechts}</div>
      </div>`,
      foot,
      '<b>Quellen:</b> Prüfpunkte je Punkt im Text genannt; Parkierung nach '
      + esc((rules.meta.parkierung && rules.meta.parkierung.art) || '—')
      + ' · die Fläche je Abstellplatz ist eine Werkzeug-Annahme (kein Rechtswert). '
      + 'Die Belastbarkeitsstufen rechnen nichts — sie lesen Belegstellen und das Register der Werkzeug-Annahmen.',
      gem.num, { dokumentweit: true });
  }

  // ---- Uebersichtsblatt (nur bei getrennter Auswertung) ------------------
  // Nach dem Titel, vor den Einzelabschnitten: alle Parzellen in EINER
  // Situation und EINER Isometrie, dazu je Parzelle die Schlagzahlen. Wer
  // getrennt rechnen laesst, will zuerst das Ganze sehen und danach die
  // Einzelnen — ohne dieses Blatt begaenne das Dokument mitten in der ersten
  // Parzelle.
  async function uebersichtSheet(liste, foot, areal) {
    const rings = liste.flatMap((r) => r.selection.map((p) => p.geometryLV95[0]));
    const { centerE, centerN, halfSpan } = T.boundingBoxForRings(rings, 25);

    const parzellen = T.multiPolygonAus(liste.map((r) => r.merged));
    const fussabdruecke = T.multiPolygonAus(liste.map(T.gezeichneterFussabdruck));
    const entfallen = T.multiPolygonAus(liste.map((r) => r.waldRemoved));

    const plan = fussabdruecke ? T.buildFloorPlanSvg({
      parcelFeature: parzellen,
      footprintFeature: fussabdruecke,
      removedFeature: entfallen,
      // EINE durchgehende Waldabstandslinie ueber alle Parzellen — je
      // Auswertung geholt, hier dedupliziert (sammleWaldLinien).
      waldLinien: T.sammleWaldLinien(liste),
      blocks: liste.flatMap(T.bloeckeVon),
      blockCount: liste.reduce((n, r) => n + (r.massing ? r.massing.count : 0), 0),
      // Bemassung, Laengenrechteck und Hauptfassade gehoeren je EINER
      // Parzelle — ueber mehrere gelegt waeren sie schlicht falsch.
      lengthRect: null, lengthLimitM: null, facadeEdges: null, southFacadeIndex: null,
      widthPx: 1200, heightPx: 900,
    }) : '<div class="empty">Keine bebaubare Grundfläche.</div>';

    // Die Isometrie zeigt jeden Baukoerper mit SEINER Hoehe: die Nachbarn
    // kommen als weitereMassings, nicht als weitere Ringe des ersten —
    // sonst stuenden Parzellen aus anderen Zonen falsch hoch da.
    const iso = fussabdruecke ? T.renderEnvelopeToDataURL({
      footprintFeature: T.multiPolygonAus(liste.map((r) => r.setbackFootprint)),
      parcelFeature: parzellen,
      removedFeature: entfallen,
      waldLinien: T.sammleWaldLinien(liste),
      heightM: liste[0].rules.heightM,
      massing: liste[0].massingModel,
      weitereMassings: liste.slice(1).map((r) => r.massingModel),
    }, 1400, 1000) : null;

    // «Bebaubar als» darf hier nie optimistischer klingen als das Detailblatt
    // (Blatt 1, Abschnitt 3 «Situation & Grundriss»): eine rechnerisch
    // bestehende Geschosszahl auf einem Streifen, der kein Baufeld ist
    // (T.faktischNichtBebaubar), bekommt den Zusatz «(rechnerisch)» plus
    // Fussnotenzeichen, statt unkommentiert wie eine reguläre Zeile zu wirken.
    let anyNichtBebaubar = false;
    const zeilen = liste.map((r) => {
      const mm = r.massingModel;
      const nb = T.faktischNichtBebaubar(r);
      if (nb.ja) anyNichtBebaubar = true;
      const bebaubarAls = mm
        ? storeyLabel(mm.ordinaryStoreys, mm.attikaStoreys) + (nb.ja ? ' (rechnerisch)*' : '')
        : '—';
      // Adresse UND Nummer in einer Zelle (T.grundstueckLabel): die Trennseiten
      // benennen die Grundstuecke mit ihrer Adresse, diese Tabelle trug bisher
      // nur die Nummer — derselbe Gegenstand unter zwei Namen im selben
      // Dokument.
      return `<tr><td>${esc(grundstueckLabel(r))}</td>`
        + `<td>${fmt(r.reconciled.parcelAreaM2, 0)} m²</td>`
        + `<td>${fmt(r.reconciled.usableFootprintAreaM2, 0)} m²</td>`
        + `<td>${fmt(r.reconciled.maxGfaM2, 0)} m²</td>`
        + `<td>${mm ? fmt(mm.nutzflaecheTotalM2, 0) + ' m²' : '—'}</td>`
        + `<td>${esc(bebaubarAls)}</td></tr>`;
    }).join('');
    const summeVon = (f) => liste.reduce((a, r) => a + f(r), 0);
    const summe = (f) => fmt(summeVon(f), 0);

    // ---- Die Areal-Variante, gerechnet ------------------------------------
    // Das Blatt sagte bisher nur, DASS die Zusammenfassung mehr ergibt. Wie
    // viel mehr, stand nirgends — und genau das ist die Frage, wegen der
    // jemand drei Grundstuecke zusammen pruefen laesst. Die Zahlen kommen aus
    // einem vollen zweiten Lauf ueber die vereinigte Flaeche (arealVergleich
    // in js/app.js), nicht aus einer Hochrechnung der Einzelergebnisse.
    //
    // Der Vorbehalt darunter bleibt unveraendert stehen: die Zahl gilt erst
    // mit Parzellenvereinigung oder einer im Grundbuch gesicherten
    // Uebertragung. Ohne diese Sicherung ist die getrennte Summe der Zustand.
    const delta = (wert) => `${wert >= 0 ? '+' : '−'} ${fmt(Math.abs(wert), 0)} m²`;
    // Zwei Geschossflaechen, zwei Spalten. Die ANRECHENBARE ist die
    // rechtliche Obergrenze (§ 255 PBG) und in beiden Rechnungen dieselbe:
    // die Ausnuetzungsziffer bezieht sich auf die anrechenbare
    // Grundstuecksflaeche, und die aendert sich durch eine Vereinigung nicht.
    // Bis zum 31.8.2026 stand nur sie in der Tabelle — die Areal-Zeile las
    // sich damit als «± 0», also als Gewinn von nichts, waehrend der
    // eigentliche Unterschied im Fliesstext darunter versteckt war.
    //
    // Die NUTZBARE ist, was das Modell auf dem tatsaechlichen Fussabdruck
    // unterbringt. Sie ist der Unterschied: Zumikon 5028 darf getrennt
    // 222 m² ausnuetzen und kann davon auf einem 2.7 m breiten Streifen
    // fast nichts bauen. Beide Spalten stehen nebeneinander, damit die
    // Tabelle allein die Aussage traegt und nicht der Absatz darunter.
    const nutzVon = (r) => (r.massingModel ? r.massingModel.nutzflaecheTotalM2 : 0);
    const arealZeilen = (() => {
      if (!areal) return '';
      if (areal.fehler || !areal.areal) {
        return `<tr class="minus"><td colspan="6">Als ein Areal zusammengefasst: nicht gerechnet — `
          + `${esc(areal.fehler || 'die Auswertung der vereinigten Fläche kam nicht zustande')}. `
          + `Die Zeile fehlt deshalb, statt geschätzt zu werden.</td></tr>`;
      }
      const a = areal.areal;
      const amm = a.massingModel;
      return `<tr class="result"><td>Als EIN Areal zusammengefasst</td>`
        + `<td>${fmt(a.reconciled.parcelAreaM2, 0)} m²</td>`
        + `<td>${fmt(a.reconciled.usableFootprintAreaM2, 0)} m²</td>`
        + `<td>${fmt(a.reconciled.maxGfaM2, 0)} m²</td>`
        + `<td>${fmt(nutzVon(a), 0)} m²</td>`
        + `<td>${amm ? storeyLabel(amm.ordinaryStoreys, amm.attikaStoreys) : '—'}</td></tr>`
        + `<tr class="minus"><td>Differenz zur getrennten Summe</td>`
        + `<td>${delta(a.reconciled.parcelAreaM2 - summeVon((r) => r.reconciled.parcelAreaM2))}</td>`
        + `<td>${delta(a.reconciled.usableFootprintAreaM2 - summeVon((r) => r.reconciled.usableFootprintAreaM2))}</td>`
        + `<td>${delta(a.reconciled.maxGfaM2 - summeVon((r) => r.reconciled.maxGfaM2))}</td>`
        + `<td>${delta(nutzVon(a) - summeVon(nutzVon))}</td>`
        + `<td>—</td></tr>`;
    })();

    return sheet('Übersicht — getrennt gerechnet',
      `${liste.length} Parzellen, jede für sich`,
      'Jede Parzelle ist als eigenes Baugrundstück gerechnet: mit ihren eigenen '
      + 'Grenzabständen ringsum, ohne gemeinsame Ausnützung. Die Abschnitte danach '
      + 'zeigen jede Parzelle einzeln; hier stehen sie nebeneinander.',
      `<div>${plan}</div>
       <div class="caption">Situation — alle Parzellen mit ihren je eigenen Baukörpern.</div>
       ${iso ? `<img class="render" src="${iso}" alt="Isometrie aller Parzellen">` : ''}
       <table class="derive">
         <tr><td><b>Grundstück</b></td><td><b>Fläche</b></td><td><b>Fussabdruck</b></td>
             <td><b>Geschossfläche<br>anrechenbar</b></td><td><b>Geschossfläche<br>nutzbar</b></td>
             <td><b>Bebaubar als</b></td></tr>
         ${zeilen}
         <tr class="result"><td>Summe — getrennt gerechnet</td><td>${summe((r) => r.reconciled.parcelAreaM2)} m²</td>
           <td>${summe((r) => r.reconciled.usableFootprintAreaM2)} m²</td>
           <td>${summe((r) => r.reconciled.maxGfaM2)} m²</td>
           <td>${summe(nutzVon)} m²</td><td>—</td></tr>
         ${arealZeilen}
       </table>
       ${anyNichtBebaubar
         ? `<div class="note-box small">* Für sich allein faktisch nicht bebaubar, siehe Abschnitt 3.</div>`
         : ''}
       <div class="note-box small">
         Die Summe ist die getrennte Rechnung: jede Parzelle mit ihren eigenen
         Grenzabständen ringsum. Als EIN Areal zusammengefasst fällt der
         Grenzabstand an den inneren Grenzen weg — dafür setzt die
         Zusammenfassung eine Parzellenvereinigung oder eine im Grundbuch
         gesicherte Übertragung voraus. Ohne diese Sicherung bleibt die
         getrennte Summe der massgebliche Zustand.${areal && areal.areal
           ? ` <b>Anrechenbar</b> ist die rechtliche Obergrenze (§ 255 PBG) — sie`
             + ` bezieht sich auf die anrechenbare Grundstücksfläche und ändert sich`
             + ` durch eine Vereinigung nicht. <b>Nutzbar</b> ist, was ein Baukörper`
             + ` auf dem tatsächlichen Fussabdruck unterbringt; dort steht der`
             + ` Unterschied. Die Areal-Zeile ist mit derselben Rechenkette und`
             + ` denselben Quellen ermittelt wie die Zeilen darüber, in einem eigenen`
             + ` Lauf über die vereinigte Fläche — keine Hochrechnung aus der Summe.`
           : ''}
       </div>`,
      foot, '', 'Ü');
  }

  // Setzt das Dokument aus einer oder mehreren Auswertungen zusammen.
  // Eine Auswertung = Arealmodus (Parzellen als ein Baugrundstueck).
  // Mehrere = getrennt gerechnet, jede Parzelle mit eigener Studie, in
  // einer durchlaufenden Datei.
  async function buildPrintDocument(results, grundbuchFootnote, areal) {
    const liste = Array.isArray(results) ? results : [results];
    const teile = [];
    const mehrere = liste.length > 1;
    // Erst feststellen, was in ALLEN Auswertungen wortgleich ist — die
    // Parzellenblaetter bauen sich danach ohne diese Bloecke auf und
    // verweisen stattdessen auf den gemeinsamen Anhang.
    const gem = mehrere ? ermittleGemeinsames(liste) : null;
    for (const r of liste) teile.push(await buildSheetsForResult(r, grundbuchFootnote, mehrere, gem));

    // Dokumentweite Blaetter tragen die neutrale Fusszeile, die Abschnitte
    // ihre eigene. Vorher bekam jedes Blatt, das nicht selbst gebaut wurde
    // (Kapitelseiten, Fortsetzungen), die Fusszeile der ERSTEN Auswertung —
    // mitten im zweiten Grundstueck stand dann dessen Nachbar.
    const foot = teile[0].footNeutral;
    const uebersicht = mehrere ? await uebersichtSheet(liste, foot, areal) : '';
    // Blattfolge: Titel · Inhalt · (Uebersicht) · je Grundstueck
    // Kapitelseite + Koerper + Belege · Schluss.
    const html = titleSheet(liste, foot)
      + inhaltSheet(liste, foot)
      + uebersicht
      + teile.map((t, i) => (mehrere ? kapitelSheet(liste[i], i, liste.length, t.foot) : '')
          + t.koerper + t.belege).join('')
      + gemeinsamSheet(gem, liste, foot)
      + teile[0].schluss;

    const host = document.getElementById('print-doc');
    host.innerHTML = html;

    // Jedem Blatt seinen Abschnitt anheften: alles ab einer Kapitelseite bis
    // zur naechsten gehoert zu diesem Grundstueck. Ohne das liessen sich die
    // Blaetter spaeter nicht auseinanderhalten — die Abschnittsnummern
    // wiederholen sich je Grundstueck.
    let sect = -1;
    for (const el of host.children) {
      if (!el.classList.contains('sheet')) continue;
      if (el.dataset.kapitel !== undefined) sect = Number(el.dataset.kapitel);
      else if (el.dataset.dokumentweit === '1') sect = -1;
      if (sect >= 0) el.dataset.sect = String(sect);
    }

    // Inhalt fuellen, BEVOR umbrochen wird: die Liste hat eine Hoehe, und die
    // muss beim Umbrechen mitzaehlen.
    fuelleInhalt(host);

    // ERST die Bilder, DANN umbrechen. Ein <img>, das noch laedt, ist null
    // hoch: das Blatt misst sich zu kurz, der Umbruch sieht keinen Grund
    // einzugreifen, und sobald das Bild da ist, steht der Text darunter im
    // Beschnitt. Genau so ist das Uebersichtsblatt uebergelaufen, waehrend
    // die Pruefung Entwarnung gab — sie mass denselben leeren Kasten.
    await waitForImages(host);

    // Jetzt umbrechen, dann numerieren — der Umbruch erzeugt neue Blätter.
    splitOverflowingSheets(host, foot);
    // …und dann beweisen, dass keiner mehr überläuft.
    pruefeKeinUeberlauf(host);

    // Fortsetzungsblaetter entstehen erst beim Umbruch und haben deshalb
    // noch keinen Abschnitt. Sie erben ihn vom Blatt davor — sonst faellt
    // beim Blaettern mitten in einem Grundstueck die Zuordnung weg.
    let letzterSect = null;
    for (const el of host.children) {
      if (!el.classList.contains('sheet')) continue;
      if (el.dataset.sect !== undefined) letzterSect = el.dataset.sect;
      else if (el.dataset.continuation && letzterSect !== null) el.dataset.sect = letzterSect;
      else letzterSect = null;
    }

    // Number the sheets now that we know how many there are.
    const sheets = host.querySelectorAll('.sheet');
    sheets.forEach((s, i) => {
      const f = s.querySelector('.sheet-foot');
      f.innerHTML = `<span>${f.innerHTML}</span><span>Seite ${i + 1} / ${sheets.length}</span>`;
    });
    // Seitenzahlen ins Inhaltsverzeichnis — erst JETZT sind sie bekannt.
    // Zugeordnet wird ueber die beim Fuellen vergebene Id, nicht ueber die
    // Abschnittsnummer: die wiederholt sich bei mehreren Grundstuecken.
    const nachId = new Map();
    [...sheets].forEach((s, i) => {
      if (s.dataset.ivzId !== undefined) nachId.set(s.dataset.ivzId, i + 1);
    });
    host.querySelectorAll('.ivz-row').forEach((row) => {
      const seite = nachId.get(row.dataset.tocSel);
      if (seite === undefined) { row.remove(); return; }
      row.querySelector('.ivz-p').textContent = String(seite);
    });

    // Zweiter Durchgang: die Fortsetzungsblaetter tragen dieselben, bereits
    // geladenen Bilder — das kostet nichts und schliesst den Fall aus, dass
    // der Umbruch doch eines verschoben hat, das noch nicht fertig war.
    await waitForImages(host);
    return host;
  }

  function bindingExplanation(reconciled, rules) {
    switch (reconciled.bindingConstraint) {
      case 'ausnuetzungsziffer':
        return `Die zulässige Geschossfläche ist ausgeschöpft, bevor die Geschosszahl erreicht wird. Ein grösserer Fussabdruck bringt keine zusätzliche Fläche — die Ausnützungsziffer ist die Obergrenze.`;
      case 'gruenflaechenziffer':
        return `Der Fussabdruck wird durch die Grünflächenziffer begrenzt, nicht durch den Grundabstand: es muss mehr Fläche unbebaut bleiben, als der Grenzabstand allein verlangen würde.`;
      case 'grundabstand':
      default:
        return `Der Fussabdruck wird durch den Grenzabstand begrenzt. Die Ausnützungsziffer wäre noch nicht ausgeschöpft — die Parzellengeometrie ist der limitierende Faktor.`;
    }
  }

  // Der Export darf nicht an einer einzelnen Kachel haengen — aber er darf
  // auch nicht zu frueh weitergehen. Mit 8 s Frist kam genau das heraus:
  // bei kaltem Cache brauchen die WMS-Kacheln (900x1300, 1200x1150 px)
  // laenger, waitForImages gab auf, und der Export rasterte Blaetter mit
  // leeren Kartenrahmen. Im Safari-Export vom 27.8.2026 fehlte deshalb auf
  // ALLEN drei Kartenblaettern die Katasterebene.
  //
  // 30 s ist grosszuegig, weil hier ein Dokument entsteht und nicht eine
  // Bildschirmansicht: ein paar Sekunden mehr sind billiger als eine
  // ausgelieferte Studie mit weissen Karten. Laeuft die Frist doch ab,
  // meldet js/ui/pdf.js das Bild als fehlend — still bleibt es nie.
  const IMAGE_TIMEOUT_MS = 30000;

  function waitForImages(root) {
    const imgs = [...root.querySelectorAll('img')];
    return Promise.all(imgs.map((img) => (img.complete && img.naturalWidth
      ? Promise.resolve()
      : new Promise((resolve) => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
          setTimeout(resolve, IMAGE_TIMEOUT_MS);
        }))));
  }

  T.buildPrintDocument = buildPrintDocument;
})();
