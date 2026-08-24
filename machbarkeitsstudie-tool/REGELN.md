# Regelwerk des Tools — zur Prüfung

Jede Regel, die dieses Tool anwendet, in der Reihenfolge, in der sie angewendet
wird. Pro Regel: was gerechnet wird, woher der Wert kommt, wo es im Code steht.

Zweck des Dokuments ist die **fachliche Prüfung**. Jeder Rechtswert trägt im
Tool einen **§-Knopf**, der das Quell-PDF auf der zitierten Seite mit markierter
Textstelle öffnet (`js/evidence.js`); die Belege stehen als `_provenance` in den
Datendateien.

Stand: 24.08.2026 (nach der Genauigkeits-Überarbeitung; Commits im Git-Log).
Zahlenbeispiele durchgehend Zumikon W2/25.

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
* Vereinfachung (angezeigt): massgebend wären laut Art. 18 Abs. 2 die Seiten
  des **Gebäudes** (flächenkleinstes Rechteck), gemessen nach § 22 ABV
  rechtwinklig zur Fassade mit radialem Eckumgriff. Die Näherung über die
  Parzellenkanten liegt auf der sicheren Seite.
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
Gleiches Verfahren wie Waldabstand, gleicher Abzug.

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

### 3.9 Anrechenbare Grundstücksfläche (NEU)
Bezugsgrösse aller Ziffern (AZ/ÜZ/GFZ) ist die **anrechenbare
Grundstücksfläche** (§ 255/259 PBG; altrechtlich § 259 aPBG «massgebliche
Grundfläche»): **Waldflächen innerhalb der Parzelle werden abgezogen**
(Geometrie aus ogd-0111). Offene Gewässer und Flächenanteile ausserhalb der
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

### 3.17 Checkliste
* **Tier A — gerechnet:** Waldabstand, Baulinien, Gewässerraum-Gate.
* **Tier B — nur erkannt:** Sonderbauvorschriften/Gestaltungsplan,
  Ortsbildschutz/Denkmalpflege (Gate über **BFS-Nr. 261**, nicht den
  überschreibbaren Gemeindenamen), Kronenbedeckungsgrad, **NEU:**
  Strassenabstand Art. 32 BZO Zumikon (2 m ohne Verkehrsbaulinien), **NEU:**
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
| 30 m | BBOX-Halbweite Zonenabfrage | Annahme | `zone-lookup.js` |
| 4 m / 5 m² / 40 / 3 | Block-Minima / Maxima | Annahme | `massing.js` |
| 3.5 m | min. Breite eines Baukörpers | Annahme | `coordinates.js` |
| 1.0 m | Attika-Profil-Überhöhung | **Art. 31 Abs. 1 BZO Zumikon** | `data/bzo-zumikon.json` |
| 12 m / ⅓ / 10–13 m | Mehrlängenzuschlag | **Art. 14 BZO 2016** | `data/bzo-zurich-wohnzonen.json` |
| 2 m | Strassenabstand ohne Baulinien | **Art. 32 BZO Zumikon** | `data/bzo-zumikon.json` |
| 7×7 | Terrainraster | Annahme | `app.js` |
| CHF 900/m³ | Kostenkennwert BKP 2 | Annahme (Bandbreite 800–1000) | `output.js` |
| 2 × Grundabstand | Gebäudeabstand | **§ 271 PBG** | `app.js` |
| 261 | BFS-Nr. Stadt Zürich (Checklisten-Gate) | Fakt | `checklist.js` |

Annahmen werden im Quellen-Abschnitt des Tools ausdrücklich als
«Werkzeug-Annahmen ohne Gesetzeszitat» gelistet.

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
* **Näherbaurecht / Wegrecht / Dienstbarkeiten** — nur Fussnote.
* **Lärm** (LSV), **Energie**, **Parkierung**, **Brandschutz**, **Aussenraum**.
* **Bestandesbauten** — die Parzelle wird als leer gerechnet.
* **Herabsetzung des Grenzabstands** (Art. 15 BZO 2016) — nicht modelliert
  (wäre günstiger für den Bauherrn, Weglassen ist konservativ).

---

## 7. Nachvollziehbarkeit

* Jede Zwischenzahl steht in der Ergebnistabelle; die Kette Parzellenfläche →
  anrechenbare Fläche → Fussabdruck → Deckel → GFA → Geschosse → Volumen →
  Kosten ist vollständig sichtbar.
* Jeder Rechtswert trägt einen **§-Knopf** → Quell-PDF, zitierte Seite,
  markierte Stelle. Werte aus der BZO 2016 tragen einen **«BZO 2016»-Tag**.
* Der PDF-Export (Vollbild-Vorschau → «PDF speichern») führt **pro Blatt ein
  Argument** mit Plänen und einer eigenen Quellenzeile.
* **Golden-Tests:** `node tests/run-tests.mjs` prüft die Rechenkette gegen
  handgerechnete Erwartungswerte (Zumikon W2/25, Zürich W2bI, Wald-Abzug,
  Monotonie, Null-Semantik, Belege). Muss vor jedem Commit grün sein.

---

## 8. Behobene Fehler

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

* Grenzabstands-Streifen mit runden Enden entlang Parzellenkanten statt
  Gebäude-Rechteck-Messung nach § 22 ABV (auf der sicheren Seite; angezeigt).
* Mehrlängenzuschlag allseitig statt fassadenweise (konservativ; angezeigt).
* Waldabstands-Seitenbestimmung hängt an der Auswahl-Grösse (3.6).
* Mischzonen: Zone der Ausgangsparzelle für alles (Hinweis auf § 259 PBG).
* Anrechenbare Fläche: nur Wald automatisch abgezogen.
* Baukörper schematisch (Rechteck, gleichverteilte Fläche, keine Erschliessung).
* Für Zürich fehlt eine Attika-Profil-Regel in den Daten → voller Rücksprung
  (konservativ).

---

## 10. Offene Punkte

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
