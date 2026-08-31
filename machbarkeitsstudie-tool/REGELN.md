# Regelwerk des Tools — zur Prüfung

Jede Regel, die dieses Tool anwendet, in der Reihenfolge, in der sie angewendet
wird. Pro Regel: was gerechnet wird, woher der Wert kommt, wo es im Code steht.

Zweck des Dokuments ist die **fachliche Prüfung**. Jeder Rechtswert trägt im
Tool einen **§-Knopf**, der das Quell-PDF auf der zitierten Seite mit markierter
Textstelle öffnet (`js/ui/evidence.js`); die Belege stehen als `_provenance` in den
Datendateien.

Stand: 31.08.2026 (Berichtsprüfung Multi-Parzellen-Export; Commits im Git-Log).
Zahlenbeispiele durchgehend Zumikon W2/25.

---

## 12. Was der Bericht über ein Grundstück behaupten darf

Nicht jede Regel dieses Werkzeugs ist eine Rechenregel. Der Export vom
31.08.2026 (Zumikon 5030 + 5029 + 5028, W2/25, getrennt gerechnet) war
arithmetisch fehlerfrei und trug trotzdem vier Aussagen, die das Dokument an
anderer Stelle selbst bestreitet. Diese Klasse ist hier festgehalten, weil
kein Test über Zahlen sie findet.

**12.1 Ein Grundstück trägt EINEN Namen.** Die Kette ist: Adressregister (GWR)
→ eingetippte Adresse → `Parzelle NNNN`. Das Register geht vor der Eingabe,
weil die Eingabe zur Parzelle führt und nicht zu ihrer Adresse. Sie steht
EINMAL in `js/core/format.js` (`betreffVon`, `grundstueckLabel`) und wird von
Titelblatt, Trennseite, Blattkopf, Kennwerte-Tafel, Zonen-Steckbrief und
Dateinamen konsumiert. Liefert das Register nichts, steht überall
`Parzelle NNNN` — **nie eine Mischung**: das Deckblatt trug zuvor
«Haldenstrasse 5a», der Blattkopf desselben Grundstücks «Parzelle 5028».

**12.2 Die dargestellte Variante ist die gerechnete.** Scheitert ein
Attikageschoss am 45°-Profil (3.13), ist die gewählte Variante zugleich die
gesperrte: `active` und `suppressed` gelten beide. Die Karte nennt dann, was
scheitert und was statt ihrer gebaut wird — nie «gerechnet & dargestellt».
`suppressed` schlägt `active` (`js/ui/print.js`, Variantenreihe).

**12.3 Keine negativen Masse.** Ist der Attika-Rücksprung tiefer als der halbe
Baukörper, ist die Restbreite rechnerisch negativ (5028: 2.7 − 2 × 2.25 =
−1.8 m). Eine Kantenlänge kann das nicht sein. Ausgegeben wird die Aussage
«es bleibt keine Restfläche» mit dem Mindestmass als Massstab
(`attikaSuppressRechnung`, `js/core/envelope.js`).

**12.4 «Realistisches Szenario» ist eine Zusage.** Ein bebaubarer Rest unter
`MIN_PRIMITIVE_WIDTH_M` (3.5 m, §5 — Werkzeug-Annahme, **kein Rechtswert**)
ist ein Streifen, kein Baufeld: 5028 behält 36.7 m² auf 2.7 m Tiefe. Der
Bericht wechselt dort die Beschriftung auf «Für sich allein faktisch nicht
bebaubar» und verweist auf die Areal-Zeile (12.5). **Keine Zahl ändert sich** —
gemessen wird am flächenkleinsten Rechteck, nicht am achsparallelen Umschlag
(`faktischNichtBebaubar`, `js/core/envelope.js`).

**12.5 Die Areal-Variante steht als Zahl da.** Bei getrennter Rechnung führt
das Übersichtsblatt zusätzlich die vereinigte Fläche als eigene Zeile
(Fussabdruck, Geschossfläche, Differenz zur Summe). Sie kommt aus einem
**vollen zweiten Lauf** von `analyse()` über die Vereinigung
(`arealVergleich`, `js/app.js`) — keine Hochrechnung aus den Einzelwerten.
Die max. **anrechenbare** Geschossfläche ändert sich dabei in der Regel nicht
(die Ausnützungsziffer bezieht sich auf dieselbe anrechenbare Grundstücks-
fläche); was sich ändert, ist der Fussabdruck und damit die Frage, ob ein
Baukörper sie aufnehmen kann. Beides wird nebeneinander ausgewiesen. Der
Vorbehalt Parzellenvereinigung / grundbuchlich gesicherte Übertragung bleibt.
Scheitert der Lauf, entfällt die Zeile **mit benannter Begründung** (§2).

**12.6 Der Rechtsstand steht auf Seite 1 jedes Grundstücks.** Der Vorbehalt
aus `legal_status` (Zumikon: teilweise Nichtgenehmigung vom 01.04.2026)
entscheidet, ob die Grundmasse daneben gelten. Er bleibt auf dem Quellenblatt
und steht zusätzlich, im Wortlaut der Datendatei, beim BZO-Versionsvermerk auf
dem ersten Blatt jeder Parzelle.

**12.7 Wiederholung ist keine Sorgfalt.** Bei mehreren Grundstücken im selben
Rechtsrahmen (gleiche Gemeinde **und** gleiche Zone) stehen die Prüfpunkte, die
nicht am einzelnen Grundstück hängen, die Parkierungs-Fussnoten und die
Belastbarkeits-Legende einmal im gemeinsamen Anhang A.3. Zusammengefasst wird
**nur, was nachweislich wortgleich ist** — verglichen wird der fertige
Wortlaut, nicht die Annahme «gleiche Gemeinde, also gleicher Text». Weicht ein
Grundstück ab, bleibt sein Punkt bei ihm. Der Verweis auf dem Parzellenblatt
**nennt die ausgelagerten Punkte namentlich**: sonst wäre nicht mehr
erkennbar, ob ein Punkt geprüft oder vergessen wurde. Die Tier-A-Liste
(«automatisch geprüft») wird nie zusammengefasst — das sind Befunde zu DIESER
Parzelle, und dass sie zufällig gleich lauten, macht sie nicht zu einer
Aussage über alle.

---

## 0. Normhierarchie — welcher Rang gibt was vor

Die Reihenfolge, in der das Werkzeug rechnet (Abschnitt 3), ist **nicht** die
Rangordnung des Rechts. Sie mischt die Stufen, weil sie der Geometrie folgt:
Grundabstand (Gemeinde) → Waldabstand (Kanton) → Ausnützung (Kanton + Gemeinde).
Beide Ordnungen zeigt das Panel **«Ablauf & Normkette»** nebeneinander —
Rangabzeichen je Schritt, Ablauf von oben nach unten.

| Rang | Ebene | Erlass | Was das Werkzeug daraus verwendet |
|---|---|---|---|
| 1 | Bund | RPG | **nichts gerechnet.** Die Bauzonenzugehörigkeit wird vorausgesetzt, nicht geprüft. |
| 2 | Kanton | PBG 700.1, ABV 700.2 | Begriffe und Messweisen (§ 255–257 Ziffern, § 260/§ 22 ABV Grenzabstand, § 271 Gebäudeabstand), Waldabstand § 262, Baulinien § 96/99, § 281 aPBG Firsthöhe |
| 3 | Gemeinde | BZO + Zonenplan | Zone, Grund- und grosser Grenzabstand, AZ/ÜZ/GFZ-Werte, Höhen, Gesamtlänge, Attikaprofil |
| 4 | Privatrecht | ZGB — Grundbuch, Dienstbarkeiten | **nichts gerechnet.** Näherbau-, Weg- und Leitungsbaurechte nur als Fussnote; beizubringen sind Grundbuchauszug, Katasterplan der amtlichen Vermessung und Höhenaufnahme. |
| — | Amtliche Daten | AV, ÖREB, swissALTI3D, GIS-ZH | Geometrie und Betroffenheit, nicht Recht |
| — | Werkzeug-Annahme | ohne Gesetzeszitat | Abschnitt 5, im Quellen-Abschnitt eigens gelistet |

Tieferes Recht konkretisiert höheres und darf ihm nicht widersprechen. Wo
kantonale und kommunale Werte beide bestehen, gilt der kommunale (Abschnitt
3.3) — das ist keine Ausnahme von der Hierarchie, sondern die vom PBG selbst
vorgesehene Delegation.

**Werkleitungen** liegen bewusst auf zwei Rängen: die *Baulinie für
Versorgungsleitungen* (§ 96 Abs. 2 lit. c PBG, Bauverbot § 99, Abstand § 268)
ist kantonales Recht und wird **gerechnet**, sofern sie im Datensatz ogd-0158
geführt ist. Die *tatsächliche Werkleitung* und das *Leitungsbaurecht* stehen
im Werkleitungskataster der Gemeinde und im Grundbuch — beides liegt dem
Werkzeug nicht vor und erscheint als `review`, nie als bestanden.

Code: `js/core/normkette.js` (`NORM_EBENEN`, `buildNormkette`). Das Modul rechnet
nichts nach; es ordnet ausschliesslich das fertige Ergebnisobjekt von
`analyse()`. Golden-Test: Abschnitt 0 in `tests/run-tests.mjs`.

---

## 11. Sicherheitsstufen — wie belastbar ist eine Zahl

*(Steht hier oben, nicht hinten: §0 ordnet jeden Wert nach seinem RANG im
Stufenbau, §11 nach seiner BELASTBARKEIT. Die beiden Achsen liest man
zusammen. Die Nummer 11 sagt, dass dieser Abschnitt der neueste ist —
CLAUDE.md §1.)*

Die Tafel sagte bisher, **woher** ein Wert kommt (`kind`: GEHOLT, BERECHNET,
GEPRÜFT, ANNAHME, ENTWURF). Sie sagte nicht, **wie belastbar** er ist. Das sind
zwei Achsen: ein Grenzabstand aus Art. 17 BZO und ein Kostenkennwert von
CHF 900/m³ sahen in derselben Spalte gleich aus. Seit `js/core/sicherheit.js`
trägt jeder Wert zusätzlich eine von vier Stufen.

| Zeichen | Stufe | Bedeutung |
|---|---|---|
| `§` | **belegt** | Rechtswert mit Artikel, Seite und Wortlaut — oder eine benannte amtliche Datenquelle (AV, ogd-0156, swissALTI3D). |
| `≈` | **vereinfacht** | Rechtswert, aber genähert angewandt. Die Näherung ist im Register benannt. |
| `~` | **Annahme** | Ohne Gesetzeszitat: Werkzeug-Grösse oder Entwurfsentscheidung. |
| `?` | **nicht ermittelbar** | Regel existiert hier nicht (`null`), Quelle ausgefallen, oder bewusst nicht geprüft. **Nie 0.** |

Farbe ist nicht die Kennzeichnung, sondern ihre Verstärkung — das Zeichen trägt
sie allein, damit sie den Schwarzweissdruck übersteht.

### 11.1 Die Kaskade

`stufeVon()` in `js/core/sicherheit.js`, in dieser Reihenfolge; jeder Zweig endet
in einer benannten Stufe, ein unbekannter Fall **wirft** (CLAUDE.md §4):

1. Datenquelle ausgefallen → `nicht ermittelbar`
2. kein Wert (`null`, `—`) → `nicht ermittelbar`
3. `kind === 'ENTWURF'` → `Annahme` (keine Rechtsgrösse, aber auch kein Irrtum)
4. `kind === 'ANNAHME'` oder Schlüssel in `WERKZEUG_ANNAHMEN` → `Annahme`
5. Schlüssel in `VEREINFACHUNGEN` → `vereinfacht`
6. Belegstelle ohne zonenscharfes Zitat (`source.synthetic`) → `vereinfacht`
7. Gesetzeszitat mit Datei und Seite → `belegt` (Belegtyp `gesetzeszitat`)
8. benannte amtliche Datenquelle → `belegt` (Belegtyp `amtliche_daten`)
9. rechnerisches Zwischenergebnis → `belegt` (Belegtyp `abgeleitet`)
10. sonst → **Fehler**

Die Belegstelle liest die Kaskade über das bestehende `T.getProvenance()`
(`js/core/rules.js`) — keine zweite Lesestelle.

### 11.2 Vererbung

Ein abgeleiteter Wert trägt die **schwächste** Stufe seiner Eingänge und seiner
selbst (`schwaechste()`, `vererbeSicherheit()`). Die Kennwert-Zeilen erklären
ihre Abhängigkeiten über `id`/`dependsOn`; der Nachlauf in
`js/ui/kennwerte.js` läuft einmal über alle Zeilen in Ableitungsreihenfolge.

Weil die anrechenbare Grundstücksfläche Gewässer- und Nicht-Bauzonen-Anteile
nicht automatisch abzieht (§9), ist sie `vereinfacht` — und alles, was auf ihr aufbaut, erbt das. Das ist keine
Übervorsicht, sondern die Sachlage: die Bezugsgrösse aller Ziffern kann zu gross
sein. Zeilen, die nicht an ihr hängen (Zone, Höhenmass, Zonenwerte), bleiben
`belegt`. Am Referenzfall Zumikon W2/25: 22 Werte, davon 11 belegt,
8 vereinfacht, 2 Annahme, 1 nicht ermittelbar.

### 11.3 Register

`VEREINFACHUNGEN` und `WERKZEUG_ANNAHMEN` in `js/core/sicherheit.js` sind die
maschinenlesbare Fassung von §5 und §9. Jeder Eintrag nennt den Artikel, der
eigentlich gilt, was das Werkzeug stattdessen tut und ob das konservativ ist.
**Bei einer Änderung ist das Register die Quelle**, nicht die Prosa hier.

### 11.4 Wo die Stufen erscheinen

* **Kennwerte-Tafel** — Zeichen vorne in eigener Kolonne, Legende darüber,
  Zählung in der Kopfzeile (aus derselben Zählung wie die Abzeichen).
* **Ablauf & Normkette** — Stufe je Schritt; wo der Wert von der Gemeinde und
  die **Messweise** vom Kanton kommt, stehen beide untereinander (`messweise` /
  `grundlage`). Damit ist die Ableitung PBG/ABV → BZO an jedem Schritt lesbar.
* **PDF** — eigenes Blatt «Belastbarkeit der Zahlen» mit Legende und jeder Zahl.
  Ein Wert, der am Bildschirm unsicher ist und auf dem Papier glatt aussieht,
  ist auf dem Papier eine falsche Zahl (gleiche Begründung wie §7).

### 11.5 Gemeinde ohne hinterlegte BZO

Der Lauf **bricht weiterhin ab** (§1, CLAUDE.md §2) — es wird nichts geschätzt
und kein Teilergebnis als Ergebnis dargestellt. Neu ist, dass der Abbruch die
Lücke benennt: `GemeindeNichtHinterlegtError` (`js/core/rules.js`) trägt drei
Listen — was PBG/ABV auch ohne BZO liefern (aus
`data/kantonale-abstandsvorschriften.json`), welche Werte die BZO liefern müsste
und wofür sie im Ablauf gebraucht werden (`KOMMUNAL_ERFORDERLICH`), und was
beizubringen ist. `app.js` zeigt das als Tafel «Nicht gerechnet» statt als
Fehlermeldung.

Golden-Tests: Abschnitte 7, 8 und 9 in `tests/run-tests.mjs`.

---

## 1. Geltungsbereich

| | |
|---|---|
| Kanton | Zürich |
| Zonen | nur **Wohnzonen**. Alles andere bricht mit Fehlermeldung ab, statt zu raten. |
| Gemeinden | nur solche mit hinterlegter BZO-Datei: aktuell **Zürich** und **Zumikon**. Grund: Grenzabstand und Grünflächenziffer stehen *nicht* im kantonalen Datensatz, nur im kommunalen BZO-Text. |
| Aussage | Volumenstudie. **Keine** Baueingabe, keine Kostenplanung, keine Rechtsauskunft. |

---

## 2. Datenquellen

| Datum | Quelle | Layer / Endpoint |
|---|---|---|
| Adresse → Koordinate | geo.admin.ch SearchServer | `origins=address` |
| Parzellennummer → Koordinate | geo.admin.ch SearchServer | `origins=parcel` |
| Parzellengeometrie + EGRID | geo.admin.ch MapServer identify | `ch.swisstopo-vd.amtliche-vermessung` |
| Zone + kantonale Grundmasse | GIS-ZH WFS | `ogd-0156_arv_basis_np_gn_zonenflaeche_f` |
| Grenzabstand, Grünflächenziffer, Regime | lokale Datei | `data/bzo-*.json` (aus den BZO-PDFs, mit Beleg je Wert) |
| Kantonale Normen (§§ PBG/ABV) | lokale Datei | `data/kantonale-abstandsvorschriften.json` |
| Waldabstandslinie | GIS-ZH WFS | `ogd-0152_arv_basis_abstandslinie_wald_l` |
| Waldareal | GIS-ZH WFS | `ogd-0111_giszhpub_wald_waldareal_f` |
| Baulinien | GIS-ZH WFS | `ogd-0158_arv_basis_abstandslinie_baulinie_l` |
| Betroffenheit (Gate) | ÖREB-Kataster ZH | `maps.zh.ch/oereb/v2/extract/json?EGRID=` |
| Terrainhöhe | geo.admin.ch height | swissALTI3D |
| Sonderbauvorschriften, Denkmalpflege | WFS **Stadt Zürich** | nur Stadtgebiet (BFS-Nr. 261) — ausserhalb «nicht geprüft», nie grün |

Alle Geometrie wird planar in **LV95 (EPSG:2056)** gerechnet. turf-Funktionen,
die WGS84 annehmen (Distanz, Fläche, Buffer), sind durch eigene ersetzt —
`coordinates.js`.

**Ausfallverhalten:** Fällt eine Quelle aus (WFS, ÖREB, Höhendienst,
Stadt-Zürich-WFS), degradiert nur der betroffene Abschnitt («nicht prüfbar»,
Warnhinweis) — die Analyse läuft weiter. Ein Ausfall wird **nie** als grünes
PASS dargestellt. ÖREB-Themen-Codes werden gegen die Antwort validiert; unbekannte
Codes ⇒ «nicht prüfbar» statt «nicht betroffen».

---

## 3. Ablauf: von der Parzelle zum Volumen

Reihenfolge ist bindend, jede Stufe arbeitet auf dem Ergebnis der vorherigen.
Code: `js/app.js` → `deriveFootprint()` und `analyse()`.

### 3.1 Parzellen vereinigen
Mehrere gewählte Parzellen werden **vereinigt** (`turf.union`) und ab hier wie
**eine** Parzelle behandelt: eine Aussengrenze, eine Fläche, ein Grundabstands-
ring. Die gemeinsame Grenze verschwindet, dort gilt also **kein** Grenzabstand
mehr.

> Rechtliche Voraussetzung, die das Tool nicht prüfen kann, aber **immer
> anzeigt**: Die Zusammenrechnung setzt eine Parzellenvereinigung oder eine im
> Grundbuch gesicherte Ausnützungsübertragung/Näherbaurecht voraus. Der Hinweis
> erscheint bei jeder Mehrfachauswahl.

Nicht aneinandergrenzende Parzellen ergeben ein MultiPolygon und werden trotzdem
gemeinsam gerechnet — mit eigenem Warnhinweis.

### 3.2 Zone bestimmen
Kartenklick: Zone vom **repräsentativen Punkt** der Parzelle (Zentroid, sofern
innenliegend), nicht vom Klickpunkt — deterministisch auch bei Parzellen an
Zonengrenzen. Liegt der Punkt nahe einer Zonengrenze, wird die Zuordnung als
**unsicher markiert und angezeigt** (`edgeUncertain`-Flag).

Bei mehreren Parzellen gilt **die Zone der ersten (Ausgangs-)Parzelle** für die
ganze Auswahl. Abweichende Zonen erzeugen einen Hinweis mit Verweis auf § 259
PBG (Anrechnung je Bauzone) — keine getrennte Rechnung (bekannte Lücke).

### 3.3 Regelwerte laden — zwei Regime für Zürich
Kantonale Werte werden von den kommunalen **überschrieben**, wo beide existieren.
`null` in der BZO-Datei heisst ausdrücklich «diese Vorschrift gibt es hier
nicht» — nicht 0, nicht Default.

**Zürich (§ 234 PBG, negative Vorwirkung):** Das E-BZO (Entwurf 6.1.2026) bindet
nur, wo es **strenger** ist als die in Kraft stehende BZO 2016. `rules.js`
rechnet darum pro Parameter mit dem **strengeren** Wert beider Regime
(`bzo2016`-Block je Zone) und kennzeichnet die Herkunft («BZO 2016»-Tag im UI).
Konkret strenger aus der BZO 2016: **Gebäudehöhe** (z.B. W2b 9 m statt
Fassadenhöhe 10 m) und der **Mehrlängenzuschlag Art. 14 BZO 2016** (3.5a).

Höhenmass: das jeweils massgebende Mass (`traufseitige Fassadenhöhe` oder
`Gebäudehöhe`) wird mitgeführt und angezeigt; die beiden Masse werden **nicht**
ineinander umgerechnet.

### 3.4 Grundabstand
Fläche = Parzelle **nach innen versetzt** um `grundabstand_min_m`
(Zumikon W2/25: **5 m**).

### 3.5 Grosser Grenzabstand (Hauptfassaden)
Wenn die BZO einen `grosser_grenzabstand_min_m` kennt (Zumikon: **10 m** W2/25,
9 m übrige; Art. 17/18 BZO):

* **W2/25: die BEIDEN am meisten gegen Süden gerichteten Seiten** verlieren den
  Streifen bis 10 m (Art. 18 Abs. 1: «für die beiden…»); in W2/35–W2/60 die eine
  längste, am stärksten südorientierte Seite (`grosser_grenzabstand_suedseiten`
  in der Datendatei).
* Vorschlag = Kante(n), deren Aussennormale am nächsten bei **Süden (180°)**
  liegt; bei Gleichstand die längere. Kanten unter **3 m** gelten als Ecke.
  Die primäre Kante ist im Grundriss **anklickbar**.
* Der 10-m-Streifen endet **bündig** an den Enden der gewählten Kante
  (flache Enden, kein Kreisbogen): § 22 Abs. 2 ABV schlägt bei zwei
  verschieden grossen Grundabständen den **kleineren** radial um die Ecken —
  jenseits der Hauptfassade gilt also nur der kleine Abstand. (Die frühere
  Linien-Buffer-Umsetzung mit runden Enden schnitt 10-m-Bögen über die
  Fassadenenden hinaus aus der Parzelle — zu streng, und sie erzeugte
  sichelförmige «Baukörper», z.B. Parzelle 5029.)
* Vereinfachung (angezeigt): massgebend wären laut Art. 18 Abs. 2 die Seiten
  des **Gebäudes** (flächenkleinstes Rechteck), gemessen nach § 22 ABV
  rechtwinklig zur Fassade. Die Näherung über die Parzellenkanten liegt auf
  der sicheren Seite.
* Parzellen ohne auswertbare Fassadenkante (alles < 3 m) stürzen nicht mehr ab,
  sondern rechnen einheitlich mit dem kleinen Abstand und warnen.

### 3.5a Mehrlängenzuschlag (nur Zürich, Art. 14 BZO 2016)
Fassadenlängen über **12 m** erhöhen den Grenzabstand um **einen Drittel der
Mehrlänge**, höchstens auf den Zonendeckel (W2b–W3: 10 m, W4: 11 m, W5: 12 m,
W6: 13 m). Umsetzung als Fixpunkt-Iteration: einmal mit Grundabstand rechnen,
längste Fassade des gezeichneten Baukörpers messen, bei Überschreitung einmal
mit erhöhtem Abstand neu rechnen. Vereinfachung (angezeigt): der Zuschlag wird
allseitig angewandt — konservativ.

### 3.6 Waldabstand
Nicht nur ein Hinweis, sondern **geometrisch abgezogen** (Verfahren mit
Waldabstandslinie, `wirksamkeit` links/rechts, Schliessern; unverändert, siehe
Code-Kommentare in `waldabstand.js`). Ohne Linie: kein Abzug. Seite nicht
bestimmbar: kein Abzug, aber `review`.

### 3.7 Baulinien
Gleiches Verfahren wie Waldabstand, gleicher Abzug. Rechtsgrundlage:
**§ 99 Abs. 1 PBG** (innerhalb der Baulinie nur zweckkonforme Bauten),
Baulinienarten **§ 96 Abs. 2 PBG**.

**Werkleitungen (Issue #1) — was hier drin ist und was nicht.** Zu den drei
Baulinienarten gehören ausdrücklich die **Baulinien für Versorgungsleitungen**
(§ 96 Abs. 2 lit. c; auf ihnen darf nur gebaut werden, soweit die Grenz- und
Gebäudeabstände es erlauben, § 268). Sind sie in ogd-0158 geführt, sind sie
damit **gerechnet** — ohne Sonderbehandlung, sie sind einfach Baulinien.

**Nicht** gerechnet sind die *tatsächlich verlegten* Werkleitungen
(Werkleitungskataster der Gemeinde) und die *Durchleitungs- und
Leitungsbaurechte* im Grundbuch. Eine Leitung kann liegen, ohne dass je eine
Baulinie festgesetzt wurde. Beides erscheint als Tier-B-Eintrag «Werkleitungen»
(`review`, nie `pass`) und lässt sich unter «Mehr › Grundbuch» als Fussnote
erfassen — dort neu mit eigenem Feld, weil ein Leitungsbaurecht anders als ein
Näherbaurecht regelmässig Untergeschoss und Fundation trifft, nicht nur die
Grundfläche.

### 3.8 Max. Gebäudelänge → Aufteilung in Baukörper
Grenzwert = `gesamtlaenge_max_m`, ersatzweise
`gebaeudelaenge_inkl_klein_anbauten_max_m` (Zumikon W2/25: **35 m**).

Ist das umschliessende Rechteck der bebaubaren Fläche länger, wird die Fläche
quer zur Längsachse in gleich lange Blöcke geschnitten, Abstand dazwischen =
**Gebäudeabstand = 2 × massgebender Grundabstand** (§ 271 PBG).

**Fehler A ist behoben:** Die Teilung bestimmt nur noch die **gezeichneten
Baukörper**. Bezugsfläche für Grünflächenziffer/Überbauungsziffer/Ausnützung
bleibt die **ungeteilte** bebaubare Fläche — die Gebäudeabstands-Lücken kosten
keine Ausnützung mehr. Ausgewiesen wird die Zahl der Baukörper mit der
**tatsächlich längsten** Blocklänge (nach allen Schnittdurchgängen).

### 3.9 Anrechenbare Grundstücksfläche
Bezugsgrösse aller Ziffern (AZ/ÜZ/GFZ) ist die **anrechenbare
Grundstücksfläche** (§ 255/259 PBG; altrechtlich § 259 aPBG «massgebliche
Grundfläche»). Automatisch abgezogen werden:

* **Waldflächen innerhalb der Parzelle** (Geometrie aus ogd-0111);
* **NEU (28.08.2026) — Waldabstandsflächen, soweit sie mehr als 15 m hinter
  der Waldabstandslinie liegen** (§ 259 aPBG, Wortlaut in
  `data/kantonale-abstandsvorschriften.json` → `massgebliche_grundflaeche_altrecht`).
  Geometrie: bereits bestimmte Waldseite der Parzelle minus 15-m-Band um die
  Linie minus Wald (der separat abgezogen wird, kein Doppelzählen) —
  `waldAusserAnsatz()` in `js/sources/waldabstand.js`. Ist die Waldseite
  nicht bestimmbar, ist der Abzug **nicht ermittelbar** (`null`, nie 0) und
  wird als solcher geflaggt. Validiert am Referenzfall Zumikon 2999
  (`999_cookies/referenz-zumikon-2999-ausnuetzung.md`): die eingereichte
  Ausnützungsberechnung zieht dafür 69.0 m² ab (3'259 − 69 = 3'190 × 25 % =
  797.5 m²); ohne den Abzug lag das Werkzeug 2.1 % zu hoch.

Offene Gewässer und Flächenanteile ausserhalb der
Bauzone werden **nicht** automatisch erkannt — dauerhafter Warnhinweis.

### 3.10 Fussabdruck-Deckel: Grünflächenziffer und Überbauungsziffer
* `Fläche_max(GFZ) = anrechenbare Fläche × (1 − GFZ/100)`. Fehlt die GFZ
  (Zumikon), entfällt die Vorschrift.
* **NEU — Überbauungsziffer (§ 256 PBG; Art. 62 E-BZO):** in W2bI/W2bII (22 %)
  und W2bIII (25 %) zusätzlich `Fläche_max(ÜZ) = anrechenbare Fläche × ÜZ`.
* Bebaubare Fläche = Minimum aus Setback-Fläche, GFZ- und ÜZ-Deckel. Welche
  Vorschrift bindet, wird benannt.

### 3.11 Ausnützungsziffer und § 255 Abs. 3 (Freibetrag)
`max. anrechenbare Geschossfläche = anrechenbare Fläche × AZ` (W2/25: **25 %**).

**NEU — § 255 Abs. 3 PBG:** Flächen in Dach-, Attika- und Untergeschossen sind
erst anrechenbar, soweit sie **je Geschoss** die Fläche überschreiten, die sich
bei gleichmässiger Aufteilung der gesamten zulässigen Ausnützung auf die
zulässige Vollgeschosszahl ergäbe. Umsetzung:

* AZ-Kontingent wird nur von den **Vollgeschossen** verbraucht.
* Attika- und Untergeschosse sind bis `maxGfa / Vollgeschosszahl` je Geschoss
  **frei** (bei W2/25 mit 1000 m²: 125 m² je Geschoss).
* `anrechenbares_untergeschoss_max` fliesst erstmals in die Rechnung ein
  (Zumikon: 1 UG; Zürich W2b/W2: 1, W3+: 0).
* Zumikons **zweites** anrechenbares Dachgeschoss wird als zusätzliche
  Fläche ausgewiesen (nicht gezeichnet — Schrägdach-Daten fehlen).
* Ausgewiesen werden getrennt: anrechenbare GFA (AZ-relevant) und **nutzbare
  Geschossfläche total** inkl. freier Geschosse.

### 3.12 Geschosse und Höhen
* Geschosszahl ist eine **Entwurfsentscheidung, kein Ergebnis** (unverändert).
* `Regelgeschosshöhe = Höhenmass / max. Vollgeschosse` (6.5 / 2 = **3.25 m**).
* Volumen = gebaute Geschosse (Vollgeschosse × volle Grundfläche + Attika ×
  Attika-Grundfläche), nicht die legale Hülle.

### 3.13 Attikageschoss — Art. 31 BZO Zumikon (statt «Faustregeln»)
1. **Höchstens 1 Attikageschoss** gezeichnet (das zweite anrechenbare
   Dachgeschoss: siehe 3.11).
2. **45°-Profil ab max. 1 m ÜBER der Schnittlinie** (Art. 31 Abs. 1,
   `attika_profil_ueberhoehung_m`): erforderlicher Rücksprung = Attikahöhe −
   1 m — nicht die volle Geschosshöhe. Für Zürich (keine solche Regel erfasst)
   konservativ die volle Höhe.
3. **Kein genereller Flächendeckel.** Der frühere 60 %-Deckel stand nicht im
   Gesetz und wurde entfernt; das Profil selbst begrenzt die Fläche.
4. **Bergseite (Art. 31 Abs. 2):** fassadenbündig zulässig, wenn auf dieser
   Seite die zulässige Gebäudehöhe **unter Einbezug der Attika** eingehalten
   wird — geprüft über den Terrainanstieg über die Gebäudetiefe (Neigung ×
   Tiefe ≥ Attikahöhe), nicht mehr über eine 10 %-Pauschalschwelle. Bündig über
   die **ganze** Fassadenlänge (die frühere 2/3-Grenze stand nicht im Gesetz).
   Flächen-Deckel: nicht grösser als eine Abs.-1-Attika (Abs. 2 Satz 2).

**Attikahöhe:** `firsthoehe_zuschlag_m` ist der **Zuschlag über der
Gebäudehöhe** (§ 281 aPBG: 45°-Ebenen ab Schnittlinie, oberste Ebene =
BZO-Firsthöhe). W2/25: 4.5 m Zuschlag ⇒ Attika bis Regelgeschosshöhe voll
modelliert, kein «(geschätzt)» mehr.

### 3.14 Hanglage
7×7 = 49 Terrainpunkte, Ausgleichsebene. Die Neigung speist die
Bergseiten-Bedingung (3.13.4) und die Höhenlinien; eine eigene
«Hanglage-Schwelle» gibt es nicht mehr.

### 3.15 Geometrie des gezeichneten Baukörpers
Unverändert: echtes Rechteck via Suchraster, min. Breite 3.5 m, zu schmale
Blöcke werden nicht gezeichnet (Hinweis), Baukörper in 3D und Grundriss
verschiebbar.

### 3.16 Kosten
`Volumen × CHF 900/m³` (BKP 2, Bandbreite 800–1000 im PDF). **Werkzeug-Annahme,
kein Rechtswert** — als solche gekennzeichnet. Bildschirm und PDF verwenden
dasselbe (gebaute) Volumen.

### 3.18 Parkierung — die letzte Schicht, die zubeisst (NEU)
Grundlage: **§ 242 PBG** überlässt die Zahl der Abstellplätze der BZO;
**Art. 26 BZO Zumikon** legt sie fest — Wohnen: 1 P je 100 m² GNF *oder* je
Wohnung (Bewohner), 1 P je 4 Wohnungen (Besucher). Das Werkzeug nimmt bei
«oder» das **Maximum** beider Lesarten; das ist die einzige, die nie zu wenig
verlangt.

* **Wohnungszahl** ist eine Entwurfsentscheidung wie die Geschosszahl,
  eingebbar. Ohne Eingabe wird sie mit der BZO-eigenen Bezugsgrösse
  (100 m² GNF je Wohnung) hergeleitet und **als Annahme markiert**.
* **«GNF»** definiert Art. 26 nicht. Gerechnet wird mit der nutzbaren
  Geschossfläche total — die grössere Bezugsgrösse, also die höhere
  Platzzahl. Als Auslegung ausgewiesen.
* **Art. 27 (70 % in ÖV-Güteklasse C) wird NICHT angewandt:** der Artikel
  verweist auf «Art. 33», und den Güteklassen-Plan legt die Baubehörde
  gesondert fest — er liegt nicht vor. Ohne Reduktion zu rechnen ist die
  strengere Variante; der Hinweis steht am Bildschirm.
* **Warum das Volumen begrenzt wird:** Art. 26 Abs. 3 verlangt die
  Bewohnerplätze in der Regel unterirdisch, überdeckt oder im Gebäude. Unter
  einen Baukörper von *F* m² passt bei *a* m² je Platz nur ⌊F/a⌋ Plätze je
  Untergeschoss, und die tragen ⌊F/a⌋ × 100 m² GNF. Liegt die gerechnete
  Geschossfläche darüber, **bindet die Garage, nicht die Ausnützungsziffer** —
  ausgewiesen mit der Zahl der nötigen Untergeschosse.
* **Nichts wird abgezogen.** Ob die Garage zweigeschossig wird, über den
  Baukörper hinausreicht oder das Haus kleiner wird, ist Entwurf, nicht
  Rechnung.
* **Zürich: nicht erfasst.** Die Pflichtparkplätze stehen weder in der BZO
  2016 noch im E-BZO-Entwurf (beide nennen nur Zweiradabstellplätze bei
  Arealüberbauungen); massgebend sind § 242 ff. PBG mit der städtischen
  Parkplatzverordnung, die nicht vorliegt. Ausgewiesen als **nicht prüfbar** —
  ausdrücklich nicht als `null` («gibt es hier nicht»).

Code: `js/core/parkierung.js`, Belege in `data/bzo-*.json`. Golden-Test Abschnitt 00.

### 3.17 Checkliste
* **Tier A — gerechnet:** Waldabstand, Baulinien, Gewässerraum-Gate.
* **Tier B — nur erkannt:** Sonderbauvorschriften/Gestaltungsplan,
  Ortsbildschutz/Denkmalpflege (Gate über **BFS-Nr. 261**, nicht den
  überschreibbaren Gemeindenamen), Kronenbedeckungsgrad, **NEU:**
  Strassenabstand Art. 32 BZO Zumikon (2 m ohne Verkehrsbaulinien), **NEU:**
  Werkleitungen (Kataster + Leitungsbaurechte, siehe 3.7), **NEU:**
  Begrünung Art. 29 Abs. 2 BZO Zumikon (25 % im Perimeter).
* Ausfälle einer Datenquelle ⇒ `review` («nicht prüfbar»), nie `pass`.
* Die Checkliste wird bei Geschoss-/Fassadenwechsel **mit neu gerechnet**.

---

## 4. Grundsatz, den das Tool einhalten muss

> **Mehr Land darf nie weniger Baurecht ergeben.**

Seit der Behebung von Fehler A eingehalten; durch Golden-Test abgesichert
(`tests/run-tests.mjs`, Monotonie-Test).

---

## 5. Alle Konstanten an einem Ort

| Wert | Bedeutung | Rechtsgrundlage / Status | Datei |
|---|---|---|---|
| 3.0 m | kürzeste Kante, die als Fassade zählt | Annahme | `grenzabstand.js` |
| 250 m / 400 m / 60 m / 0.15 m | Suchradien / Arbeitsrand / Schnittbreite | Annahme | `waldabstand.js` |
| 15 m | Waldabstandsfläche hinter der Linie fällt ausser Ansatz | **§ 259 aPBG** (Wortlaut in `data/kantonale-abstandsvorschriften.json`) | `waldabstand.js` |
| 30 m | BBOX-Halbweite Zonenabfrage | Annahme | `zone-lookup.js` |
| 4 m / 5 m² / 40 / 3 | Block-Minima / Maxima | Annahme | `massing.js` |
| 3.5 m | min. Breite eines Baukörpers | Annahme | `coordinates.js` |
| 1.0 m | Attika-Profil-Überhöhung | **Art. 31 Abs. 1 BZO Zumikon** | `data/bzo-zumikon.json` |
| 12 m / ⅓ / 10–13 m | Mehrlängenzuschlag | **Art. 14 BZO 2016** | `data/bzo-zurich-wohnzonen.json` |
| 2 m | Strassenabstand ohne Baulinien | **Art. 32 BZO Zumikon** | `data/bzo-zumikon.json` |
| 7×7 | Terrainraster | Annahme | `app.js` |
| 28 m²/Platz | Fläche je Platz Tiefgarage | Annahme (Bandbreite 25–35) | `parkierung.js` |
| 25 m²/Platz | Fläche je Platz oberirdisch | Annahme (Bandbreite 20–30) | `parkierung.js` |
| 100 m² GNF | hergeleitete Wohnungsgrösse, wenn keine eingegeben | Annahme (= die Bezugsgrösse aus Art. 26) | `parkierung.js` |
| CHF 900/m³ | Kostenkennwert BKP 2 | Annahme (Bandbreite 800–1000) | `output.js` |
| 2 × Grundabstand | Gebäudeabstand | **§ 271 PBG** | `app.js` |
| 261 | BFS-Nr. Stadt Zürich (Checklisten-Gate) | Fakt | `checklist.js` |

Annahmen werden im Quellen-Abschnitt des Tools ausdrücklich als
«Werkzeug-Annahmen ohne Gesetzeszitat» gelistet.

**Maschinenlesbar** steht dieselbe Unterscheidung in `WERKZEUG_ANNAHMEN`
(`js/core/sicherheit.js`); von dort kommt das Abzeichen `~` an jedem Wert.
Bei Abweichungen gilt das Register, nicht diese Tabelle — siehe §11.

---

## 6. Was bewusst **nicht** gerechnet wird

* **Arealüberbauung** (Art. 6–9 E-BZO / § 69 ff. PBG) — keine Bonus-Rechnung.
  **NEU:** ab 4000 m² zusammenhängender Fläche weist ein Hinweis auf das
  ungenutzte Potenzial hin (Bonuswerte aus der Datendatei).
* **Gewässer- und Nicht-Bauzonen-Abzüge** von der anrechenbaren Fläche — nur
  Wald wird automatisch abgezogen; Rest als Warnhinweis.
* **Zonen-anteilige Rechnung** bei Mischzonen-Auswahl (§ 259 PBG) — Hinweis statt
  Rechnung.
* **Dachgeschoss** im Schrägdach als Geometrie (Fläche wird angerechnet, 3.11).
* **Gewässerraum**, **Sonderbauvorschriften**, **Denkmalschutz** — nur erkannt.
* **Näherbaurecht / Wegrecht / Durchleitungs- und Leitungsbaurechte /
  übrige Dienstbarkeiten** — nur Fussnote (manuelle Erfassung).
* **Werkleitungskataster** der Gemeinde — nicht abgefragt; nur die Baulinie
  für Versorgungsleitungen wird gerechnet (3.7).
* **Lärm** (LSV), **Energie**, **Brandschutz**, **Aussenraum**.
* **Parkierung**: die Pflichtplatzzahl wird gerechnet und die Passung unter
  den Baukörper geprüft (3.18) — die Garage selbst wird **nicht** geplant und
  **nicht** vom Fussabdruck abgezogen.
* **Bestandesbauten** — die Parzelle wird als leer gerechnet.
* **Herabsetzung des Grenzabstands** (Art. 15 BZO 2016) — nicht modelliert
  (wäre günstiger für den Bauherrn, Weglassen ist konservativ).

---

## 7. Nachvollziehbarkeit

* **Das Protokollfenster** (linke Spalte, dauerhaft sichtbar) zeigt den Lauf,
  während er läuft: eine Zeile je Rechenschritt mit ihrer Dauer, eine je
  Norm, die tatsächlich gegriffen hat (mit Artikel aus dem
  `_provenance`-Block, nie formuliert), eine je Werkzeug-Annahme, eine je
  ausgefallener Quelle. Darunter QUELLEN · STAND mit dem Stand jedes
  Datensatzes. Die Kopfzeile — `n Regeln · n Annahmen · n Konflikte` — wird
  aus dem Protokoll und den Kennwerten **gezählt**, nicht getippt: Annahmen
  sind die Zeilen mit `kind = ANNAHME`, Konflikte die ausgefallenen Quellen.
  Beides kann deshalb nicht von der Tafel daneben abweichen
  (`js/ui/protokoll.js`).
* **Jeder Kennwert trägt vier Angaben** (`js/ui/kennwerte.js`): den Wert, die
  Fundstelle (Artikel oder Datensatz — Gesetzeszitate in der Akzentfarbe),
  die Art (`GEHOLT` aus einer Quelle, `BERECHNET` in `js/core/`, `GEPRÜFT`
  eine Prüfung, die gehalten hat, `ANNAHME` aus dem Register §5, `ENTWURF`
  eine Entscheidung des Benutzers) und die **Herleitung** als Text. Beim
  Überfahren einer Zeile steht ihre Herleitung in der Leiste am Fuss des
  Bildschirms — es gibt auf dem Auswertungsbildschirm keine Zahl ohne
  sichtbaren Rechenweg.
* **Die Regelfahnen** über Isometrie (REGELN IM MODELL) und Situationsplan
  (ABSTÄNDE & ABZÜGE) stammen aus den Werten dieses Laufs. Eine Regel, die
  hier nicht gilt, steht ausdrücklich als «nicht anwendbar» da statt zu
  fehlen — eine fehlende Zeile liest sich wie eine vergessene Prüfung
  (gleiche Begründung wie §2 und 3.17).
* Eine Zeichnung, die nicht zustande kommt, nimmt die Zahlen **nicht** mit:
  der Grund steht im Panel, eine Warnung im Protokoll, die Auswertung läuft
  weiter. Die Zahlen sind das Ergebnis, das Modell ist ihre Darstellung.
* **Ablauf & Normkette** (Detailbildschirm): während der
  Rechnung das Live-Protokoll des Laufs, danach jeder Schritt mit seiner
  Normebene, seiner Rechtsgrundlage und der Fläche, die er kostet — plus die
  abspielbare Animation, die die Fläche Schicht für Schicht schrumpfen zeigt.
  Ein Klick auf einen Schritt springt die Animation dorthin.
* Jede Zwischenzahl steht in der Ergebnistabelle; die Kette Parzellenfläche →
  anrechenbare Fläche → Fussabdruck → Deckel → GFA → Geschosse → Volumen →
  Kosten ist vollständig sichtbar.
* Jeder Rechtswert trägt einen **§-Knopf** → Quell-PDF, zitierte Seite,
  markierte Stelle. Werte aus der BZO 2016 tragen einen **«BZO 2016»-Tag**.
* Der PDF-Export (Vollbild-Vorschau → «PDF speichern») führt **pro Blatt ein
  Argument** mit Plänen und einer eigenen Quellenzeile. Er heisst
  «Baurechtliche Machbarkeit», nicht «Machbarkeitsstudie»: gerechnet wird der
  rechtliche Teil der Phase Machbarkeit (SIA 112, 2014, Teilphase 21). Das
  Blatt **«Nicht Gegenstand dieser Auswertung»** führt die ungeprüften Themen
  namentlich auf (Altlasten, Naturgefahren, Lärm, Baugrund, Erschliessung,
  Standort) — eine weggelassene Prüfung darf sich nicht wie eine bestandene
  lesen, gleiche Begründung wie 3.17.
* Die **Parkierung** hat ein eigenes Blatt. Sie wurde schon gerechnet, stand
  aber nur am Bildschirm; eine bindende Einschränkung, die es nicht aufs
  Papier schafft, ist auf Papier eine falsche Zahl.
* **«PDF öffnen»** schreibt die Datei (`js/ui/pdf.js`) und zeigt sie in einem
  eigenen Tab im PDF-Viewer des Browsers, ohne Druckdialog. Die Seiten sind
  Bilder — inhaltlich identisch mit der Vorschau, aber der Text darin ist
  nicht mehr markierbar. Wer den Wortlaut der zitierten Bestimmungen zum
  Kopieren braucht, nimmt «Drucken» (vektoriell).
* **Golden-Tests:** `node tests/run-tests.mjs` prüft die Rechenkette gegen
  handgerechnete Erwartungswerte (Zumikon W2/25, Zürich W2bI, Wald-Abzug,
  Monotonie, Null-Semantik, Belege). Muss vor jedem Commit grün sein.

---

## 8. Behobene Fehler

* **Bericht widersprach sich selbst** (Multi-Parzellen-Export 31.08.2026):
  ein Grundstück unter drei Namen, «gerechnet & dargestellt» auf einer nicht
  darstellbaren Attika, «14.3 × −1.8 m» im Kundendokument, 37 m² auf 2.7 m
  Tiefe als «Realistisches Szenario». Alle vier **behoben** — Regeln und
  Begründungen in §12, durch Golden-Tests gesichert.
* **A. Mehr Parzellen → weniger Geschossfläche** (4872+4258: 213 → 185 m²):
  **behoben** — die Längenteilung bestimmt nur noch die Zeichnung, nicht die
  Bezugsfläche (3.8). Invariante durch Test gesichert.
* **B. Absturz bei leerer Blockliste**: behoben (24.08.2026, siehe Git-Log).
* Grosser Grenzabstand W2/25 nur auf einer Seite: **behoben** (zwei Seiten).
* Attika-«Faustregeln» (60 %-Deckel, 2/3-Bündigkeit, 10 %-Hangschwelle) ohne
  Rechtsgrundlage: **ersetzt** durch Art. 31 BZO Zumikon.
* Firsthöhe absolut gelesen (Attika immer «geschätzt»): **behoben**
  (Zuschlag-Semantik, § 281 aPBG).
* PDF zeigte Hüllvolumen statt gebautem Volumen (~2.6× Kosten): **behoben**.
* Checkliste veraltete nach Geschosswechsel: **behoben**.
* Stadt-Zürich-Checks konnten per Gemeinde-Override grün werden: **behoben**
  (BFS-Nr.-Gate).
* Klick auf Parzelle in nicht hinterlegter Gemeinde: stiller Absturz →
  **Popup mit Begründung**.

---

## 9. Bekannte Ungenauigkeiten (kein Fehler, aber wissenswert)

Jede der folgenden Näherungen steht als Eintrag im Register `VEREINFACHUNGEN`
(`js/core/sicherheit.js`) und färbt die betroffenen Werte auf `≈ vereinfacht`
(§11). Wer eine ergänzt, ergänzt sie dort — sonst trägt der Wert weiter ein
`§`, das er nicht verdient.

* Grenzabstands-Streifen mit runden Enden entlang Parzellenkanten statt
  Gebäude-Rechteck-Messung nach § 22 ABV (auf der sicheren Seite; angezeigt).
* Mehrlängenzuschlag allseitig statt fassadenweise (konservativ; angezeigt).
* Waldabstands-Seitenbestimmung hängt an der Auswahl-Grösse (3.6).
* Mischzonen: Zone der Ausgangsparzelle für alles (Hinweis auf § 259 PBG).
* Anrechenbare Fläche: Wald und der 15-m-Streifen hinter der Waldabstandslinie
  automatisch abgezogen; Gewässer und Zonenanteile nur als Hinweis.
* Baukörper schematisch (Rechteck, gleichverteilte Fläche, keine Erschliessung).
* Für Zürich fehlt eine Attika-Profil-Regel in den Daten → voller Rücksprung
  (konservativ).

---

## 10. Offene Punkte

0. **Attikaregel: 45°-Profil oder Drittel der Gebäudelänge?** Das Werkzeug
   rechnet nach Art. 31 Abs. 1 BZO Zumikon mit dem 45°-Profil und einem
   Rücksprung von Attikahöhe minus 1 m. Die reale Baueingabe für Kat. 2999
   (Haldenstrasse 5, ausgewertet in `999_cookies/referenz-zumikon-2999-*.md`)
   hält statt dessen **ein Drittel der Gebäudelänge** ein — Haus A 7.39 m von
   22.17 m, Haus B 6.35 m von 19.06 m, beide exakt auf dem Maximum. Das sind
   zwei verschiedene Regeln. Die Pläne zitieren dafür keine Rechtsgrundlage.
   **Vor jeder Änderung am Attika-Code in der BZO Zumikon verifizieren** —
   nicht aus dem Plan übernehmen (CLAUDE.md §2).
1. **Zonen-anteilige Rechnung** bei Mischzonen (§ 259 PBG) — Hinweis vorhanden,
   Rechnung fehlt.
2. **Gewässer-/Nicht-Bauzonen-Abzug** der anrechenbaren Fläche automatisieren.
3. **Arealüberbauungs-Modus** (Art. 6–9 E-BZO) mit Bonusziffern und kantonalen
   internen Abständen (Datengrundlage liegt in
   `data/kantonale-abstandsvorschriften.json`).
4. **Gebäudeabstand bei Hauptfassaden** (§ 271 PBG: Summe der beidseitigen
   Grenzabstände — zwischen zwei Baukörpern mit grosser Grenzabstandsseite wären
   es 15 m statt 10 m).
5. **Kostenkennwert** einstellbar machen.
6. **E-BZO-Rechtskraft** verfolgen: nach Festsetzung entfällt das
   Stricter-of-Regime und die BZO-2016-Werte werden Geschichte
   (`legal_status` in den Datendateien aktualisieren).
