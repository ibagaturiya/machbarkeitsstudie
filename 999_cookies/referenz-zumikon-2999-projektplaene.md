# Referenzfall Zumikon, Kat.-Nr. 2999 — Projektpläne

Quelle: dw design & concept ag, `999_cookies/Plangrundlage IVAN_20.08.2026/Projektpläne/`,
12 Pläne, Stand 26.07.2024 / 05.11.2024. Extrahiert 2026-08-27.
Ergänzt `referenz-zumikon-2999-ausnuetzung.md` um Geometrie, Höhen und Abstände —
genau die Punkte, die dort als „nicht ableitbar" offen blieben.

## 0. Was in welchem Plan steht

| Plan | Inhalt | Text extrahierbar |
|---|---|---|
| 101B Situation (11.04.2024) | Bemasste Situation 1:500, Nachbarparzellen, Höhenkoten | ja |
| 113B Übersicht Parzellen (05.10.2023) | Grundlage AZ-Berechnung, Waldabstandsflächen, Gebäudemasse | ja |
| 122A Parzellierungsplan (05.10.2023) | Aufteilung 2999 → 3 Parzellen, Servitut | ja |
| 121 Best. Höhenkurven (30.08.2023) | Terrainkoten, Höhenlinien, Abstandslinien | ja |
| 102E UG / 103D EG / 104E OG / 105D Attika | Grundrisse mit Bemassung | **nein — Raster** |
| 106E Schnitte A/B/C (26.07.2024) | Höhenregime, max. GH/FH, Abgrabung | **nein — Raster** |
| 107E Fassaden A/B/C (26.07.2024) | Ansichten mit Höhenlinien | **nein — Raster** |
| 117E Farb-/Materialkonzept, 109F Umgebung | für die Prüfung irrelevant | – |

Die Rasterpläne wurden gerendert und visuell ausgewertet; die Werte unten sind so gelesen,
nicht maschinell extrahiert. Bei einer Abweichung gegen das Tool erst am Plan gegenprüfen.

## 1. Höhenregime (Schnitte 106E) — der wichtigste Fund

Nullpunkt: **±0.00 = 717.60 m.ü.M** (OK Fertigbelag EG Haus A und B).

| Grösse | Wert | Bemerkung |
|---|---|---|
| Max. Gebäudehöhe | **6.50 m** | rot als „MAX. GEBÄUDEHÖHE" eingetragen, gemessen ab tiefstem Punkt auf best. Terrain |
| Max. Firsthöhe | **+ 4.50 m** über der Gebäudehöhe | **Zuschlag**, nicht absolut — bestätigt die altrechtliche Messweise (§ 281 aPBG) |
| Max. Abgrabung | **1.00 m** | in allen drei Schnitten eingetragen |

Tiefster Punkt auf bestehendem Terrain, je Haus separat ermittelt:
Haus A **717.55**, Haus B **717.66**, Haus C **717.60** m.ü.M.

Ausgeführte Höhen:

| | Haus A | Haus B | Haus C |
|---|---|---|---|
| OK Gebäudehöhe | 723.40 (+5.80) | 723.40 (+5.80) | 723.40 (+5.80) |
| davon gegenüber Maximum | 5.85 von 6.50 | 5.74 von 6.50 | 5.80 von 6.50 |
| Max. Firsthöhe (Plan) | 727.90 (+10.30) | 727.90 (+10.30) | 727.90 (+10.30) |
| OK First ausgeführt | 727.55 (+9.95) | 724.08 (+6.48) | 727.55 (+9.95) |
| Gesamthöhe | – | – | 7.97 bzw. 10.95 |
| Dachneigung | Flachdach/Attika | Flachdach/Attika | 37.04°, 43°, 30° |

Alle drei Häuser liegen auf **derselben** OK Gebäudehöhe 723.40, obwohl ihre tiefsten
Terrainpunkte um 11 cm auseinanderliegen — die Höhe ist städtebaulich gesetzt, nicht ans
Maximum gefahren.

Geschosskoten Haus A/B: UG −2.78 / 714.82 · EG ±0.00 / 717.60 · OG +2.84 / 720.44 ·
Attika +5.80 / 723.40 · OK Dach +8.81 / 726.41 · Fundament −3.30 / 714.30.
Lichte Raumhöhen: UG 2.35 m, EG/OG/Attika 2.46 m (Geschosshöhen 2.84 / 2.96 / 3.01 m).
Haus C: UG −3.88 / 713.72 · EG ±0.00 / 717.60 · OG +1.98 / 719.58 · DG +5.08 / 722.68;
lichte Höhen 2.50–2.60 m, DG 3.28–4.28 m.

## 2. Servitutarische Baubeschränkung — eine zweite, tiefere Höhenlimite

Über Haus B verläuft die **Grunddienstbarkeits-/Baubeschränkungslinie vom 04.12.1953**
(Servitutenprotokoll, EGRID CH796077735733, Blatt 1400, Kataster 2999). Im Schnitt SB1
sind dort **zwei** rote Limiten nebeneinander eingetragen:

| | normal | im Bereich der Baubeschränkung |
|---|---|---|
| Max. Gebäudehöhe | 6.50 m | **5.80 m** |
| Max. Firsthöhe (Zuschlag) | 4.50 m | **4.30 m** |

Das ist eine privatrechtliche Beschränkung, die im Baurecht nicht abgebildet ist. Unser
Tool kennt so etwas nicht. Es ist der Fall, an dem sich „Uncertainty muss auf den Schirm"
(`CLAUDE.md` §2) beweisen muss: erkennbar ist das nur aus dem Grundbuch, nicht aus der BZO.

## 3. Attika-Regel: max. 1/3 der Gebäudelänge

Im Attika-Grundriss (105D) und in den Schnitten explizit bemasst:

| | Gebäudelänge | Attika gebaut | Annotation im Plan | Rest |
|---|---|---|---|---|
| Haus A | 22.17 m | **7.39 m** | „max. 1/3 von 22.17" | 14.78 m Terrasse (BF 96.6 m²) |
| Haus B | 19.06 m | **6.35 m** | „max. 1/3 von 19.06" | Terrasse |

22.17 / 3 = 7.39 und 19.06 / 3 = 6.353 — beide Attikas sitzen **exakt auf dem Maximum**.
Die restliche Dachfläche ist Terrasse mit Glasgeländer.

Das erklärt die kleinen Attika-Flächen aus dem AZ-Nachweis (Haus A 32.4 m² AZ / 33.8 m² BWF
bei 134 m² Grundfläche). Eine Rechtsgrundlage ist auf dem Plan **nicht** zitiert — vor
Übernahme in `REGELN.md` in der BZO Zumikon verifizieren, nicht aus dem Plan übernehmen.

Weitere Winkel im Plan: 45.00° und 135.00° Konstruktionslinien an West- und Ostfassade
(Grenzabstands-/Profilkonstruktion), im Schnitt SC2 zusätzlich 30.00° am Dach Haus C.

## 4. Gebäudegeometrie und Abstände

Gebäudemasse (aus 113B, Rechteckmasse):

| | Grundmass | Fläche | Parzelle |
|---|---|---|---|
| Haus A | 22.17 × 6.06 m | ≈ 134.4 m² | 5028, 920.0 m² |
| Haus B | 19.06 × 6.26 m | ≈ 119.3 m² | 5029, 891.0 m² |
| Haus C | 22.57 × 19.80 m | ≈ 446.9 m² | 5030, 1'448.0 m² |

Haus A und B sind schmale Zeilen (6 m tief), Haus C ein kompakter Baukörper.
Im Schnitt SC2 ist für Haus C ein **Grenzabstand 7.55 m** eingetragen; ein „Abstand
Stützmauer mind. 4.00 m" und „Abstand für Bauten" (grün) sind separat geführt.
Weitere Bemassung in 101B/121 ist unbeschriftet und lässt sich einzelnen Abständen nicht
zuordnen — für einen Grenzabstandsvergleich reicht sie nicht.

Vermessungsfixpunkte (Gossweiler Ingenieure AG): Bolzen 21602392 = 720.894 ·
21602395 = 721.518 · 21602651 = 714.549 · 21602652 = 715.109 m.ü.M.
Terrain fällt von ca. 721 m im NW auf ca. 714.5 m an der Haldenstrasse im SO — rund 6.5 m
über die Parzelle, also ein deutliches Hanggrundstück.

Weitere im Plan geführte Linien: **Waldabstand** (magenta), **Baulinie** (blau),
**Grenzabstand** (rot), **Abstand für Bauten** (grün), **Grenze neu** (Parzellierung).

## 5. Beobachtete Nebenregeln (Rechtsgrundlage im Plan nicht zitiert)

- „8.00 (max. 1/4 von 47.46 = 11.86 m)" an der Haldenstrasse — Viertels-Regel auf die
  Frontlänge, vermutlich für die Zufahrts-/Vorplatzbreite.
- Rampen: „< 6 % im Gefälle" bzw. 8.0 % / 8.4 % / 12.2 %, mit Note „max. 15 % Gefälle
  gem. VSS 40 291 / 20.5" und „Neigung darf 8 % die ersten 5 m nicht übersteigen"
  (Ausfahrtstyp A gemäss Verkehrserschliessungsverordnung VErV).
- Sichtbereich: „vertikal frei zwischen 0.80 m und 2.65 m", Tiefe 2.50 m an der Ausfahrt.
- Hecke Taxus H = 2.00 m, Maschendrahtzaun H = 1.50 m an der Grenze.
- PV-Anlagen auf den Flachdächern: Haus A 20 Stk., Haus B 18 Stk. je 1.30 × 0.875 m,
  dazu extensive Begrünung.

## 6. Was das für den Tool-Vergleich bedeutet

1. **Messweise bestätigt.** Firsthöhe als Zuschlag von 4.50 m über der Gebäudehöhe von
   6.50 m, gemessen ab tiefstem Punkt auf gewachsenem Terrain — genau die altrechtliche
   Variante, die `CLAUDE.md` §2 für Zumikon vorschreibt. Kein IVHB.
2. **Der tiefste Punkt wird je Gebäude bestimmt**, nicht je Parzelle (717.55 / 717.66 /
   717.60 für drei Häuser auf einem Grundstück). Prüfen, ob unser Tool das so macht.
3. **Attika-Regel 1/3 der Gebäudelänge** — falls unser Tool die Attika über einen
   Rücksprung statt über einen Längenanteil modelliert, ist das ein struktureller
   Unterschied, nicht nur eine Zahlenabweichung.
4. **Max. Abgrabung 1.00 m** begrenzt, wie tief das UG freigelegt werden darf, und damit
   indirekt, ob es als Vollgeschoss zählt. Sitzt vermutlich noch nicht im Tool.
5. **Servitutarische Höhenbeschränkung** (§2 oben) — ein Fall, den kein BZO-Datensatz
   liefern kann. Gehört als `review`-Flag auf den Schirm, nicht als grünes PASS.
6. **Hanglage 6.5 m über die Parzelle.** Ein Werkzeug, das mit einem flachen Terrain
   rechnet, liegt hier systematisch daneben — nicht nur bei den Höhen, auch beim
   Untergeschoss-Deckel.
7. **Alle drei Gebäude sind Rechtecke** mit klaren Massen. Das macht den Fall als
   Golden-Test brauchbar, sobald die Parzellengeometrie vorliegt.

## 7. Weiterhin offen

- Eckkoordinaten der drei neuen Parzellen 5028/5029/5030 (nur Flächen und Gebäudemasse
  bekannt; die Vermessung liegt bei Gossweiler Ingenieure AG).
- Verlauf der Waldabstandslinie in Koordinaten.
- Die zugeordneten Grenzabstände je Fassade — ausser dem einen Wert 7.55 m bei Haus C.
- Rechtsgrundlage der 1/3-Attika-Regel und der 1/4-Frontregel in der BZO Zumikon.
- Grünflächenziffer: kommt in keinem der Pläne vor.
