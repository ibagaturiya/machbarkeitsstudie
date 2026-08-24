# Regelwerk des Tools — zur Prüfung

Jede Regel, die dieses Tool anwendet, in der Reihenfolge, in der sie angewendet
wird. Pro Regel: was gerechnet wird, woher der Wert kommt, wo es im Code steht.

Zweck des Dokuments ist die **fachliche Prüfung**. Die Abschnitte
[Bestätigte Fehler](#8-bestätigte-fehler-reproduziert) und
[Zu prüfen](#10-zu-prüfen--offene-fragen-an-dich) sind die, bei denen ich deine
Entscheidung brauche.

Stand: 24.08.2026. Zahlenbeispiele durchgehend Zumikon W2/25.

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
| Grenzabstand, Grünflächenziffer | lokale Datei | `data/bzo-*.json` (aus dem BZO-PDF abgeschrieben) |
| Waldabstandslinie | GIS-ZH WFS | `ogd-0152_arv_basis_abstandslinie_wald_l` |
| Waldareal | GIS-ZH WFS | `ogd-0111_giszhpub_wald_waldareal_f` |
| Baulinien | GIS-ZH WFS | `ogd-0158_arv_basis_abstandslinie_baulinie_l` |
| Betroffenheit (Gate) | ÖREB-Kataster ZH | `maps.zh.ch/oereb/v2/extract/json?EGRID=` |
| Terrainhöhe | geo.admin.ch height | swissALTI3D |
| Sonderbauvorschriften, Denkmalpflege | WFS **Stadt Zürich** | nur Stadtgebiet — ausserhalb kein Befund möglich |

Alle Geometrie wird planar in **LV95 (EPSG:2056)** gerechnet. turf-Funktionen,
die WGS84 annehmen (Distanz, Fläche, Buffer), sind durch eigene ersetzt —
`coordinates.js`.

---

## 3. Ablauf: von der Parzelle zum Volumen

Reihenfolge ist bindend, jede Stufe arbeitet auf dem Ergebnis der vorherigen.
Code: `js/app.js` → `deriveFootprint()` (ab Zeile 325) und `analyse()` (ab 539).

### 3.1 Parzellen vereinigen
Mehrere gewählte Parzellen werden **vereinigt** (`turf.union`) und ab hier wie
**eine** Parzelle behandelt: eine Aussengrenze, eine Fläche, ein Grundabstands-
ring. Die gemeinsame Grenze verschwindet, dort gilt also **kein** Grenzabstand
mehr.

> Rechtliche Voraussetzung, die das Tool **nicht** prüft: dass die Parzellen
> tatsächlich als ein Grundstück behandelt werden dürfen (Vereinigung,
> gemeinsame Überbauung, Dienstbarkeit). Ohne das ist die Annahme zu grosszügig.

Nicht aneinandergrenzende Parzellen ergeben ein MultiPolygon und werden trotzdem
gemeinsam gerechnet — siehe [Fehler B](#b-nicht-gezeichneter-baukörper-absturz).

### 3.2 Zone bestimmen
Punkt → kantonale Nutzungsplanung, BBOX ±30 m um den Punkt, dann
Point-in-Polygon. Liegt der Punkt exakt auf einer Zonengrenze und es gibt genau
einen Kandidaten, wird dieser genommen und als *unsicher* markiert.

Bei mehreren Parzellen gilt **die Zone der ersten (Ausgangs-)Parzelle** für die
ganze Auswahl. Abweichende Zonen der übrigen Parzellen erzeugen nur einen
Hinweis, keine getrennte Rechnung.

### 3.3 Regelwerte laden
Kantonale Werte (Ausnützung, Vollgeschosse, Höhen) werden von den kommunalen
Werten **überschrieben**, wo beide existieren. `null` in der BZO-Datei heisst
ausdrücklich «diese Vorschrift gibt es hier nicht» — nicht 0, nicht Default.

Höhenmass: `traufseitige_fassadenhoehe_max_m` wenn vorhanden (Zürich E-BZO),
sonst `gebaeudehoehe_max_m` (Zumikon, Kanton). Die beiden Masse werden **nicht**
ineinander umgerechnet; das verwendete Mass wird mitgeführt und angezeigt.

### 3.4 Grundabstand
Fläche = Parzelle **nach innen versetzt** um `grundabstand_min_m`
(Zumikon W2/25: **5 m**).

### 3.5 Grosser Grenzabstand (Hauptfassade)
Wenn die BZO einen `grosser_grenzabstand_min_m` kennt, der grösser ist als der
Grundabstand (Zumikon: **10 m**, Art. 18 BZO), verliert **eine** Kante
zusätzlich den Streifen von 5 m bis 10 m ab der ursprünglichen Parzellengrenze.

* Vorschlag = die Kante, deren Aussennormale am nächsten bei **Süden (180°)**
  liegt; bei Gleichstand die längere. Kanten unter **3 m** gelten als Ecke, nicht
  als Fassade.
* Die Kante ist im Grundriss **anklickbar** und damit von Hand überschreibbar.
* Vereinfachung: der Streifen ist an den Enden **abgerundet** (Buffer einer
  Linie) und endet an der Kante — kein umlaufend variabler Abstand.

### 3.6 Waldabstand
Nicht nur ein Hinweis, sondern **geometrisch abgezogen**.

Massgeblich ist die Waldabstands**linie** (die legale Grenze), nicht ein
pauschaler Abstand zum Wald. Verfahren:

1. Linien im Umkreis von **250 m**, Waldareal im Umkreis von **400 m** laden.
2. Ein Arbeitsrechteck (Parzellen-BBOX + **60 m**) wird mit Linien,
   Waldrändern und «Schliessern» (vom Linienende zum nächsten Waldrand)
   zerschnitten — Schnittbreite 0.15 m.
3. Jedes entstehende Teilgebiet wird über das Attribut **`wirksamkeit`**
   (`links`/`rechts`) der nächstliegenden Linie einer Seite zugeordnet.
4. Die verbotene Seite wird von der Fläche aus 3.4/3.5 abgezogen.

Ohne Linie: kein Abzug. Linie ohne Waldareal, oder Seite nicht bestimmbar:
**kein Abzug, aber `review`** — die Fläche ist dann eher zu gross als zu klein.

> Diese Rechnung hängt an der Grösse des Arbeitsrechtecks und damit an der
> Auswahl. Der Fall «195 m² allein, 0 m² zu dritt» ist dokumentiert und wurde
> mit den Schliessern (Schritt 2) behoben; ich habe ihn am 24.08.2026 für
> Parzelle 5030 + 4 Nachbarn nachgemessen: stabil 194.8 m². Die Abhängigkeit
> ist damit entschärft, nicht beseitigt.

### 3.7 Baulinien
Gleiches Verfahren wie Waldabstand (Linie + `wirksamkeit`), gleicher Abzug.

### 3.8 Max. Gebäudelänge → Aufteilung in Baukörper
Grenzwert = `gesamtlaenge_max_m`, ersatzweise
`gebaeudelaenge_inkl_klein_anbauten_max_m` (Zumikon W2/25: **35 m**).

Ist das umschliessende Rechteck der bebaubaren Fläche länger, wird die Fläche
**quer zur Längsachse in gleich lange Blöcke geschnitten**, Abstand dazwischen =
**Gebäudeabstand = 2 × Grundabstand** (§ 271 PBG; Zumikon: 10 m).

Konstanten: min. Blocklänge 4 m, min. Blockfläche 5 m², max. 40 Blöcke,
höchstens 3 Schnittdurchgänge (breite Formen werden auch quer geschnitten).

> **Hier sitzt Fehler A.** Die geteilte Fläche ersetzt anschliessend die
> bebaubare Fläche für *alle* weiteren Zahlen — die Gebäudeabstands-Lücken
> gehen also als Fläche verloren. Siehe [Abschnitt 8](#a-mehr-parzellen--weniger-geschossfläche).

### 3.9 Grünflächenziffer
`Fläche_max = Parzellenfläche × (1 − GFZ/100)`. Fehlt die GFZ (Zumikon), wird die
Vorschrift **weggelassen** — nicht als 0 % und nicht als 100 % interpretiert.

Bebaubare Fläche = **Minimum** aus (3.8) und dieser Obergrenze. Welche der beiden
bindet, wird ausgewiesen.

### 3.10 Ausnützungsziffer
`max. Geschossfläche = Parzellenfläche × AZ` (Zumikon W2/25: **25 %**).

Bezugsgrösse ist die **volle (vereinigte) Parzellenfläche**. Eine
*anrechenbare* Grundstücksfläche im Sinne der BZO (Abzüge für Wald, Strassen,
Gewässer) wird **nicht** gebildet → [zu prüfen](#10-zu-prüfen--offene-fragen-an-dich).

Bindend ist, was zuerst greift: Grundabstand, Grünflächenziffer oder
Ausnützungsziffer. Das Ergebnis wird benannt.

### 3.11 Geschosse und Höhen
* Geschosszahl ist eine **Entwurfsentscheidung, kein Ergebnis**. Jede Zahl
  zwischen «gerade genug für die erlaubte Geschossfläche» und dem Zonenmaximum
  ist gleich zulässig und ergibt **dieselbe** Geschossfläche — nur die
  Grundfläche ändert. Default = Zonenmaximum inkl. Attika (kleinster
  Fussabdruck).
* `Regelgeschosshöhe = Höhenmass / max. Vollgeschosse` (6.5 / 2 = **3.25 m**).
* `Grundfläche = Geschossfläche / Geschosse`, höchstens die bebaubare Fläche.
* `Volumen = Grundfläche × Gebäudehöhe` — das **gebaute** Volumen, nicht die
  legale Hülle.

### 3.12 Attikageschoss
Vier Faustregeln, geometrisch umgesetzt:

1. **Höchstens 1 Attikageschoss** pro Gebäude — auch wenn die BZO mehr
   anrechenbare Dach-/Attikageschosse zulässt (Zumikon: 2). Das zweite wäre ein
   *Dachgeschoss* (Schrägdach, Kniestock, Dachneigung) — dafür fehlen die Daten,
   also wird es nicht als Attika gezeichnet.
2. **45°-Rücksprung** (kantonales Recht): waagrechter Rücksprung = Höhe des
   Attikageschosses, auf allen Seiten.
3. **Max. 60 %** der Grundfläche des darunterliegenden Geschosses.
4. **Bergseite-Ausnahme**: ab **10 % Hangneigung** darf die bergseitige Fassade
   bündig stehen statt zurückzuspringen.

Attikahöhe = `firsthoehe_max_m − Höhenmass`, **wenn** die Firsthöhe grösser ist.
Sonst wird die Regelgeschosshöhe als Platzhalter genommen und im Modell als
**«(geschätzt)»** angeschrieben. Bei Zumikon W2/25 trifft genau das zu
(Firsthöhe 4.5 m < Gebäudehöhe 6.5 m) → [zu prüfen](#10-zu-prüfen--offene-fragen-an-dich).

### 3.13 Hanglage
7×7 = 49 Terrainpunkte über die Parzellen-BBOX, Ausgleichsebene durchgelegt.
Ab **10 % Neigung** gilt Hanglage; die Fallrichtung liefert die Bergseite für
3.12.4 und die Höhenlinien im Grundriss.

### 3.14 Geometrie des gezeichneten Baukörpers
Der Baukörper ist ein **echtes Rechteck**, kein verkleinertes Abbild der
bebaubaren Fläche (die kann durch die Abzüge vielzackig sein). Gesucht wird ein
Rechteck, das in die bebaubare Fläche passt und die verlangte Grundfläche hat —
über 11 Seitenverhältnisse (1:1 bis 1:3.5, beide Richtungen) und 11 Flächen-
stufen. Minimale Breite **3.5 m**; schmaler gilt nicht als Baukörper.

Findet sich keines, wird die Fläche massstäblich verkleinert und beschnitten —
das Ergebnis ist dann wieder gezackt und wird als solches gekennzeichnet
(`cuboidNotPrimitive`), samt fehlender Fläche.

Baukörper sind in 3D und im Grundriss **verschiebbar**; Attika und Masse folgen.

### 3.15 Kosten
`Volumen × CHF 900/m³`, aufgerundet auf CHF 10'000. Nur **BKP 2**
(Gebäudekosten). Ohne Land, ohne Baunebenkosten (BKP 1/4/5, üblich +25–40 %).
Pauschalwert, **nicht** der Zürcher Index der Wohnbaupreise.

### 3.16 Checkliste
* **Tier A — gerechnet:** Waldabstand, Baulinien. Ergebnis mit Fläche.
* **Tier B — nur erkannt, Inhalt manuell:** Gewässerraum, Sonderbau-
  vorschriften/Gestaltungsplan, Ortsbildschutz/Denkmalpflege,
  Kronenbedeckungsgrad.
* Ampel: `pass` / `review` / `flag`. **`review` heisst nicht «unproblematisch»**,
  sondern «hier rechnet das Tool bewusst nicht».

---

## 4. Grundsatz, den das Tool einhalten muss

> **Mehr Land darf nie weniger Baurecht ergeben.**
> Wer zwei Parzellen hat, kann immer auch nur auf einer bauen. Das Ergebnis für
> die Vereinigung muss darum mindestens so gut sein wie das beste Ergebnis der
> einzelnen Parzellen.

Diese Bedingung ist derzeit **verletzt** — siehe Fehler A.

---

## 5. Alle Konstanten an einem Ort

| Wert | Bedeutung | Datei |
|---|---|---|
| 3.0 m | kürzeste Kante, die als Fassade zählt | `grenzabstand.js` |
| 250 m / 400 m | Suchradius Abstandslinien / Waldareal | `waldabstand.js` |
| 60 m | Rand des Arbeitsrechtecks für den Seitenentscheid | `waldabstand.js` |
| 0.15 m | Schnittbreite beim Zerteilen | `waldabstand.js` |
| 30 m | BBOX-Halbweite Zonenabfrage | `zone-lookup.js` |
| 4 m / 5 m² / 40 / 3 | min. Blocklänge / min. Blockfläche / max. Blöcke / Schnittdurchgänge | `massing.js` |
| 3.5 m | min. Breite eines Baukörpers | `coordinates.js` |
| 0.6 | Flächendeckel Attika | `coordinates.js` |
| 10 % | Schwelle Hanglage | `app.js` |
| 7×7 | Terrainraster | `app.js` |
| CHF 900/m³ | Kostenkennwert BKP 2 | `output.js` |
| 2 × Grundabstand | Gebäudeabstand (§ 271 PBG) | `app.js` |

---

## 6. Was bewusst **nicht** gerechnet wird

* **Arealüberbauung** (§ 69 ff. PBG) — keine Bonusziffern, kein eigener Modus.
* **Anrechenbare** Grundstücksfläche (Abzüge) — es wird die volle Fläche genommen.
* **Untergeschosse**, obwohl `anrechenbares_untergeschoss_max` in den Daten steht.
* **Dachgeschoss** im Schrägdach (Kniestock, Neigung).
* **Gewässerraum**, **Sonderbauvorschriften**, **Denkmalschutz** — nur erkannt.
* **Näherbaurecht / Wegrecht / Dienstbarkeiten** — nur als manuelle Eingabe, die
  in eine Fussnote läuft; sie verändern **keine** Zahl.
* **Lärm** (LSV), **Energie**, **Parkierung**, **Brandschutz**, **Aussenraum**.
* **Bestandesbauten** — die Parzelle wird als leer gerechnet.
* Ausserhalb der Stadt Zürich: **keine** Prüfung auf Sonderbauvorschriften und
  Denkmalpflege (die WFS decken nur das Stadtgebiet ab).

---

## 7. Woran du das Ergebnis erkennst

Angezeigt werden immer: Parzellenfläche → Fussabdruck nach Grundabstand →
Abzug Waldabstand/Baulinien → bebaubarer Bereich → bindende Vorschrift →
Geschossfläche → Geschosse/Höhe → Volumen → Kosten. Jede Zwischenzahl steht in
der Tabelle, damit die Kette nachvollziehbar bleibt.

---

## 8. Bestätigte Fehler (reproduziert)

Beide treten **nur bei mehreren Parzellen** auf. Reproduziert am 24.08.2026 über
127 tatsächlich aneinandergrenzende Parzellenpaare in Zumikon, mit den echten
Modulen und echten Geodaten.

### A. Mehr Parzellen → weniger Geschossfläche

**Fall 4872 + 4258:**

| | Parzelle 4872 allein | 4872 + 4258 |
|---|---|---|
| bebaubare Fläche | 71 m² | **62 m²** |
| Geschossfläche | 213 m² | **185 m²** |

Mit der zusätzlichen Parzelle wird also *weniger* zulässig — obwohl die
Parzellenfläche auf 4862 m² wächst. Das verletzt den Grundsatz aus Abschnitt 4.

**Ursache** (`app.js:377`): Nach der Längenteilung wird die bebaubare Fläche
durch die Vereinigung der Blöcke **ersetzt**. Die Gebäudeabstands-Lücken sind
danach dauerhaft weg und fehlen in Ausnützungs- und Flächenrechnung.

Das ist eine falsche Lesart der Vorschrift: Die Fläche ist der **Bereich, in dem
ein Gebäude stehen darf** — nicht eine Fläche, die vollständig mit mehreren
Gebäuden gefüllt werden muss. Ein einzelnes 35-m-Gebäude darf irgendwo darin
stehen. Die Teilung sollte also den **gezeichneten Baukörper** bestimmen, nicht
die **Bezugsfläche der Zahlen**.

### B. Nicht gezeichneter Baukörper / Absturz — **behoben am 24.08.2026**

**Fälle 4650 + 2868 und 2868 + 3547.**

Wenn die Längenteilung Blöcke erzeugt, die alle unter der Mindestfläche von 5 m²
liegen, kommt `blocks = []` zurück — aber **nicht** als `impossible` markiert.
Dann:

1. `app.js:377` behält korrekt die ungeteilte Fläche (Zahlen bleiben plausibel:
   247 m² Geschossfläche),
2. `app.js:393` betritt trotzdem den Teilungs-Zweig, weil `impossible` falsch ist,
3. die leere Blockliste reduziert zu `footprintFeature = null` (`app.js:448`),
4. `app.js:710` liest `footprintFeature.geometry` → **TypeError**,
5. der Lauf endet in `Fehler: …`, es wird nichts angezeigt.

**Das ist mit hoher Wahrscheinlichkeit das, was du gesehen hast**: Zahlen wären
da, aber es erscheint nichts mehr.

**Behoben durch:**
* `massing.js` — eine leere Blockliste wird jetzt als `impossible` gemeldet,
  gleich wie eine zu kurze Blocklänge. Damit greift der bestehende Hinweis
  «Aufteilung ergibt keine sinnvoll bebaubaren Volumen — manuelle Prüfung
  erforderlich», und gezeichnet wird ein einzelner Baukörper in der
  ungeteilten Fläche.
* `app.js:448` — die Blockvereinigung fällt auf die bebaubare Fläche zurück,
  statt `null` weiterzureichen.
* `app.js` `renderFloorPlan()` und `blocksNow()` — beide kommen jetzt mit
  einem Massing-Modell ohne gezeichneten Baukörper zurecht, statt auf
  `.geometry` zu greifen.

Nachgemessen nach der Korrektur: beide Fälle liefern `impossible=true`,
einzelner Baukörper, Ergebnis wird angezeigt (4650 + 2868: 82 m² bebaubar,
247 m² Geschossfläche). Der Durchlauf über alle 127 Nachbarpaare zeigt
**0 Absturzfälle**; die Zahlen des Normalfalls (Haldenstrasse 5, allein und
mit 1–3 Nachbarn) sind unverändert.

**Fehler A bleibt offen** — die Änderung dort ist eine fachliche
Interpretationsfrage und braucht deine Entscheidung.

---

## 9. Bekannte Ungenauigkeiten (kein Fehler, aber wissenswert)

* Der grosse Grenzabstand wirkt nur entlang **einer** Kante, mit runden Enden.
* Die Waldabstands-Seitenbestimmung hängt an der Grösse der Auswahl (3.6).
* Bei gemischten Zonen rechnet das Tool durchgehend mit der Zone der ersten
  Parzelle.
* Nicht aneinandergrenzende Parzellen werden gemeinsam gerechnet, als wären sie
  ein Grundstück.
* Der gezeichnete Baukörper ist schematisch: gleichmässig verteilte
  Geschossfläche, Rechteck, keine Erschliessung, keine Belichtung.

---

## 10. Zu prüfen — offene Fragen an dich

1. **Ausnützungsziffer-Bezug.** Volle Parzellenfläche statt *anrechenbarer*
   Grundstücksfläche. Bei Parzellen mit Wald-, Strassen- oder Gewässeranteil ist
   die ausgewiesene Geschossfläche damit zu gross. Soll ich Abzüge einbauen?
2. **Zumikon W2/25: Firsthöhe 4.5 m < Gebäudehöhe 6.5 m.** Als absolutes Mass
   gelesen ergibt das keinen Sinn; vermutlich ist es die **zusätzlich** zulässige
   Höhe über der Gebäudehöhe. Das Tool liest es absolut, fällt darum zurück und
   schreibt «(geschätzt)» an. Bitte gegen Art. 17 BZO prüfen — davon hängt die
   Attikahöhe und damit die Gesamthöhe ab.
3. **`anrechenbares_dach_attika_max: 2` für Zumikon.** Das Tool zeichnet
   höchstens 1 Attika. Wenn die BZO tatsächlich Dach- **und** Attikageschoss
   zulässt, fehlt Geschossfläche.
4. **Gebäudeabstand = 2 × Grundabstand.** § 271 PBG ist als Summe der beiden
   erforderlichen Grenzabstände umgesetzt. Wenn in Zumikon für die Hauptfassade
   der grosse Grenzabstand gilt, wäre der Abstand zwischen zwei Baukörpern
   teilweise 15 m statt 10 m.
5. **Parzellenvereinigung.** Soll das Tool verlangen/anzeigen, dass eine
   rechtliche Grundlage für die gemeinsame Behandlung besteht?
6. **Kostenkennwert CHF 900/m³** — passt der für deine Fälle, oder soll er
   einstellbar sein?
