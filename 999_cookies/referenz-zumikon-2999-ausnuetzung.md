# Referenzfall Zumikon, Kat.-Nr. 2999 — reale Ausnützungsberechnung

Quelle: dw design & concept ag, Baueingabe „Überbauung Zumikon, Haldenstrasse 5".
Vier PDFs in `999_cookies/Plangrundlage IVAN_20.08.2026/Ausnützungsberechnung/`.
Stand 05.10.2023 (Rev. B). Extrahiert 2026-08-27 zum späteren Vergleich mit dem Tool.

## 1. Ausgangswerte (Soll-Input fürs Tool)

| Grösse | Wert | Bemerkung |
|---|---|---|
| Gemeinde / Kanton | Zumikon / ZH | |
| Kataster-Nr. | 2999 | |
| Zone | W2/25 (Wohnzone, 2 Geschosse) | |
| Ausnützungsziffer | 25 % | |
| Grundstücksfläche GF | 3'259.00 m² | Gesamtparzelle, vor Aufteilung |
| Waldabstandsfläche | 69.00 m² | vollständig abgezogen |
| Anrechenbare Grundstücksfläche | 3'190.00 m² | 3'259.00 − 69.00 |
| Maximale Ausnützung total | **797.50 m²** | 3'190.00 × 0.25 |
| ±0.00 | 717.60 m.ü.M | OK Fertigbelag EG Haus A/B |

## 2. Parzellierung und Waldabstandsabzug

| Teilparzelle | Fläche total | anrechenbar (AZ) | nicht anrechenbar (Wald) |
|---|---|---|---|
| Haus A | 920.00 | 895.20 | 24.80 |
| Haus B | 891.00 | 846.80 | 44.20 |
| Haus C | 1'448.00 | 1'448.00 | 0.00 |
| **Total** | **3'259.00** | **3'190.00** | **69.00** |

Kontrolle im Original: „in Ordnung!"

## 3. Haus A

- Max. Ausnützung: 895.2 × 0.25 = **223.80 m²**
- Ausnützung pro Geschoss: 223.8 : 2 = **111.90 m²** ← Schlüsselmechanik, s. §5

| Geschoss | AZ befreit | AZ anrechenbar | Bruttowohnfläche |
|---|---|---|---|
| Untergeschoss | 87.60 (≤ 111.90 befreit) | – | 90.60 |
| Erdgeschoss | – | 103.60 | 104.20 |
| Obergeschoss | – | 93.40 | 91.80 |
| Attika | 32.40 (≤ 111.90 befreit) | – | 33.80 |
| **Total** | **120.00** | **197.00** | **320.40** |

- Reserve: 223.80 − 197.00 = **26.80 m²**
- Übertrag an Haus C: 107.00 m² Grundstücksfläche → 26.75 m²
- Höhenkoten: UG 714.82 / EG 717.60 / OG 720.44 / Attika 723.40 m.ü.M
- Raumhöhen i.L.: UG 2.35 m (tw. 2.25/2.53), EG/OG/Attika 2.46 m
- Nebenräume UG: 19.7 m² (separat ausgewiesen, nicht in AZ)

## 4. Haus B

- Max. Ausnützung: 846.8 × 0.25 = **211.70 m²**
- Ausnützung pro Geschoss: 211.7 : 2 = **105.85 m²**

| Geschoss | AZ befreit | AZ anrechenbar | Bruttowohnfläche |
|---|---|---|---|
| Untergeschoss | 105.80 (≤ 105.85 befreit) | – | 105.20 |
| Erdgeschoss | – | 97.60 | 93.20 |
| Obergeschoss | – | 100.20 | 99.10 |
| Attika | 30.30 (≤ 105.85 befreit) | – | 29.60 |
| **Total** | **136.10** | **197.80** | **327.10** |

- Reserve: 211.70 − 197.80 = **13.90 m²**
- Übertrag an Haus C: 55.00 m² → 13.75 m²
- Höhenkoten: EG 717.60 / OG 720.44 / Attika 723.40 m.ü.M; best. Terrain 717.66
- Nebenräume UG: 33.8 m²

## 5. Haus C

- Max. Ausnützung: 1'448.0 × 0.25 = **362.00 m²**
- Ausnützung pro Geschoss: 362.00 : 2 = **181.00 m²**; im Blatt als **180.88 m²** befreit geführt (Rundungs-/Übernahmeunschärfe im Original)

| Geschoss | AZ befreit | AZ anrechenbar | Bruttowohnfläche |
|---|---|---|---|
| Untergeschoss | 159.10 (≤ 180.88 befreit) | – | 162.90 |
| Erdgeschoss | – | 213.30 | 221.30 |
| Obergeschoss | – | 188.90 | 192.70 |
| Dachgeschoss | 155.00 (≤ 180.88 befreit) | – | 177.20 |
| **Total** | **314.10** | **402.20** | **754.10** |

- Zwischentotal Reserve: 362.00 − 402.20 = **−40.20 m²** (Überschreitung)
- \+ Übertrag Haus A 26.75 + Übertrag Haus B 13.75 = 40.50
- Reserve final: **+0.30 m²**
- Max. Gebäudehöhe: 727.90 m.ü.M (Haus C), 723.40 m.ü.M (Parzelle/Bezug A+B)
- Raumhöhen i.L. überwiegend 2.60 m (EG/OG), UG 2.50 m, DG bis 4.48/5.48 m

## 6. Gesamtbild

| | Haus A | Haus B | Haus C | Total |
|---|---|---|---|---|
| Parzelle AZ-wirksam (m²) | 895.20 | 846.80 | 1'448.00 | 3'190.00 |
| Max. Ausnützung (m²) | 223.80 | 211.70 | 362.00 | 797.50 |
| AZ anrechenbar (m²) | 197.00 | 197.80 | 402.20 | **797.00** |
| AZ befreit (m²) | 120.00 | 136.10 | 314.10 | 570.20 |
| Bruttowohnfläche (m²) | 320.40 | 327.10 | 754.10 | **1'401.60** |
| Reserve nach Übertrag (m²) | 0.05* | 0.15* | 0.30 | 0.50 |

\* Rest nach Abzug des Übertrags (26.80 − 26.75 bzw. 13.90 − 13.75).

Effektiv ausgenützt: 797.00 / 797.50 m² = **99.94 %** der zulässigen Ausnützung.
Verhältnis BWF zu anrechenbarer AZ-Fläche: 1'401.60 / 797.00 = **1.76**.

## 7. Was beim Vergleich mit dem Tool zu prüfen ist

1. **Waldabstandsfläche wird von der Grundstücksfläche abgezogen, bevor die AZ
   angewendet wird** — nicht als Baubeschränkung, sondern als Flächenabzug.
   Rechnet unser Tool gleich? (`REGELN.md` §3, Waldabstand)
2. **Befreiungs-Deckel pro Geschoss = max. Ausnützung / Anzahl Vollgeschosse.**
   Für UG und Attika/DG wird je bis zu diesem Betrag komplett von der Anrechnung
   befreit. Das ist die betragsmässig grösste Einzelmechanik (570.20 m² befreit
   gegenüber 797.00 m² angerechnet) und der wahrscheinlichste Abweichungspunkt.
3. **Zwei „befreite" Geschosse pro Haus** (UG *und* Attika/DG), jedes mit eigenem
   Deckel in derselben Höhe — nicht ein gemeinsamer Deckel.
4. **Ausnützungsübertrag zwischen Teilparzellen** durch Übertragung von
   Grundstücksfläche (m² × 0.25). Unser Tool kennt dieses Konstrukt vermutlich nicht.
5. **BWF ≠ AZ-Fläche.** In beide Richtungen abweichend (UG A: BWF 90.60 > AZ 87.60;
   EG A: BWF 104.20 > AZ 103.60; DG C: BWF 177.20 > AZ 155.00). Nicht als identisch
   modellieren.
6. **Haus C überschreitet für sich allein** und wird erst durch die Überträge legal —
   ein Testfall für die Frage, ob das Tool eine Überschreitung sauber als Verstoss
   meldet statt sie stillschweigend zu deckeln.
7. **180.88 vs. 181.00** bei Haus C: das Originaldokument ist hier selbst inkonsistent.
   Kein Ziel für Bit-Genauigkeit; Toleranz beim Abgleich einplanen.
8. **Höhen**: Gebäudehöhe Haus A/B 723.40 m.ü.M bei ±0.00 = 717.60 → 5.80 m;
   Haus C 727.90 → 10.30 m. Messweise altrechtlich (§ 281 aPBG), wie in `CLAUDE.md` §2
   für Zumikon festgehalten. Aus den PDFs geht nicht hervor, gegen welche
   Schnittlinie gemessen wurde — vor einem Höhenvergleich klären.

## 8. Nicht aus den PDFs ableitbar (offene Punkte)

- Parzellengeometrie (Eckkoordinaten) der drei Teilparzellen — nur Flächen genannt.
- Verlauf der Waldabstandslinie; nur die resultierende Fläche (69.00 m²) ist gegeben.
- Grenzabstände und Gebäudegeometrie in Metern — die Pläne sind Flächennachweise.
- Grünflächenziffer: kommt in den Nachweisen nicht vor.
- Ob das Baugesuch bewilligt wurde.
