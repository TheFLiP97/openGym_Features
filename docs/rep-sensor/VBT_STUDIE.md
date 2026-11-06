# Rep-Sensor – VBT und Selbststudie (Ideen, Recherche, Datensammlung)

Stand: 2026-11-05. Noch nichts davon gebaut; hier wird gesammelt, damit nichts verloren geht.
Der Rep-Zähler wird dafür nicht angefasst (Regel: nichts verschlechtern, siehe STUFE1_PLAN.md).

## Leitgedanken (Philipp)

- Ein Werkzeug bauen, das Leuten beim Training wirklich hilft, auch wenn es das so noch nicht gibt.
  Nicht an bestehenden Apps orientieren.
- RIR ist individuell, sollte aber **nicht subjektiv** sein: Selbsteinschätzung ist oft falsch,
  besonders bei Anfängern, und auch Fortgeschrittenen fällt es schwer.
- Anfänger: eher Bewertung der Ausführung (voller Bewegungsweg im Schnitt).
  Fortgeschrittene: Hilfe beim effizienten Training (Ermüdung, Tagesform, Progression).
- So einfach wie möglich, so kompliziert wie nötig. Nicht überanpassen.
- Erst Daten, dann Regeln: eine kleine **Selbststudie** mit Philipps Aufnahmen, um Schätzungen
  zu verbessern und neue Ansätze zu testen.

## Beobachtung von Philipp (2026-11-05)

- Der Weg des Stapels selbst ist für den Nutzer uninteressant. Interessant ist, dass **der Weg
  gegen Ende des Satzes kürzer wird** (an Maschinen typisch), genauso wie die Geschwindigkeit.
  → Weg-Verlust und Geschwindigkeits-Verlust im Satz sind beide Ermüdungszeichen.

## Recherche (2026-11-05, Kurzfassung, vor Veröffentlichung Quellen genau prüfen)

- Ob Anfänger ihre RIR schlechter schätzen als Fortgeschrittene, ist **uneinheitlich** (eine
  Studie 2025 an Kniebeugen fand keinen Unterschied, andere Arbeiten schon). Einig: Schätzen ist
  schwer, besonders weit weg vom Versagen.
- Die Beziehung Geschwindigkeit ↔ RIR ist **sehr individuell**. Allgemeine Formeln sagen RIR
  schlecht voraus, pro Person und Übung kalibriert deutlich besser. Auch innerhalb einer Person
  streut es (mehr bei Schulterdrücken/Bankdrücken und bei weniger Erfahrenen).
- Velocity Loss taugt eher als **Ermüdungsmaß** als für eine exakte RIR-Zahl.
- Fast alle Studien: Smith-Maschine oder Langhantel. Für **Gewichtsstapel-Maschinen** und das
  Erkennen des Versagens mit Handy/Uhr gibt es kaum etwas (eine Arbeit 2025 nennt Near-Failure-
  Erkennung mit Wearables ausdrücklich wenig erforscht). Hier ist Platz für etwas Neues.
- Kommerzielles Beispiel "Stance": Sensor an der Langhantel, Kniebeuge/Bank, zeigt Geschwindigkeit
  pro Rep, "heute schneller/langsamer als die letzten Wochen", RPE eintragen und mit der
  Geschwindigkeit vergleichen. Unser Unterschied: kein Zusatzgerät, alle Stapelmaschinen, Zähler.

Quellen: PubMed 36135029 (RIR-Zuverlässigkeit), repositorio.uss.cl/handle/uss/20828 (RIR nach
Erfahrung), Sports Medicine – Open s40798-021-00404-9 (Velocity-Loss-Schwellen individuell),
AUT-Thesis (RIR-Geschwindigkeits-Beziehungen), Eur J Appl Physiol 2023 s00421-023-05155-x,
repositorio.ufu.br 123456789/45777 (Smith-Maschine), PMC8471343 (Geschwindigkeit → verbleibende
Reps), Viecelli et al. 2021 (Smartphone-Beschleunigung), arXiv 2512.11854 (Near-Failure mit
Wearable), stancefitness.co.

## Ideen (nicht nur RIR vorhersagen)

1. **Versagen objektiv erkennen.** Eine angefangene, nicht geschaffte Rep (Stapel geht hoch,
   bleibt stecken, kommt zurück) sieht der Sensor als Teilrep. Daraus lernt die App **ohne
   Nachfragen** pro Person und Übung die Geschwindigkeit der letzten möglichen Rep: genau die
   individuelle Kalibrierung, die die Forschung verlangt.
2. **"Wie hart war der Satz" gemessen statt geschätzt:** Geschwindigkeits- und Weg-Verlust von
   den ersten zu den letzten Reps, als einfache Stufe angezeigt.
3. **Tagesform:** erste Rep bei bekanntem Gewicht heute vs. sonst ("heute 8 % langsamer").
4. **Anfänger:** voller und gleichmäßiger Bewegungsweg; Gewicht kontrolliert ablassen statt fallen
   lassen (Exzentrik zu schnell).
5. **Progression objektiv:** wird die erste Rep bei gleichem Gewicht über Wochen schneller, ist
   es Zeit für mehr Gewicht.
6. Später: RIR-Spanne ("ca. 2–3") aus eigener Kalibrierung, Pausenempfehlung.

## Technische Voraussetzung

Die Live-Geschwindigkeit des Zählers ist absichtlich gedämpft (gegen Drift) und für Werte in m/s
zu ungenau. Für VBT pro Rep neu rechnen: von Umkehrpunkt zu Umkehrpunkt integrieren, mit
Geschwindigkeit 0 an beiden Enden (Zyklus-Verfahren / ZUPT, siehe STUFE1_PLAN.md und die Kalman-
Idee [x, v, b] mit RTS-Glätter in den Notizen vom 03.11.). Erst offline an den Aufnahmen prüfen:
werden Reps im Satz langsamer, sind schwerere Gewichte langsamer, sind die Werte plausibel.

## Selbststudie: welche Daten Philipp sammelt

- "Sensor-Aufnahmen behalten" an. Jede Aufnahme speichert jetzt (seit 2026-11-05) auch die beim
  Abhaken eingetragene **RIR/RPE** (`rir`, `rpe`), die echten Reps (`real`), wie der Satz endete
  (`end`) und ob per Knopf oder Automatik gestartet (`start`). Rohdaten (CSV) sind dabei, also
  lässt sich alles (Geschwindigkeit, Weg pro Rep) später nachrechnen.
- RIR wie gewohnt eintragen (subjektiv, als Vergleich).
- Ab und zu bei einer Maschine einen Satz **wirklich bis zum Versagen**, mit einer letzten, nicht
  geschafften Rep. Das sind die wertvollsten Daten.
- Notizen im Training (wie bisher): welche Sätze bis zum Versagen gingen, ob die letzte Rep gestockt hat.
- Nach dem Training exportieren (Einstellungen → Rep-Sensor → Alle exportieren) und in
  `docs/rep-sensor/data/raw/Test_N/` legen (lokal, nicht im Repo).

## Studien-Ablauf: echte RIR statt geschätzter (Philipps Idee, 2026-11-06)

Eingetragene RIR sind nur eine Schätzung und taugen deshalb nicht als Wahrheit. Darum:

1. Satz bis zu einer **vorher festgelegten Rep-Zahl** trainieren (z. B. 8).
2. Dort kurz die **Schätzung** festhalten ("noch 3 möglich"), in der App als RIR.
3. **Dann bis zum echten Versagen weitermachen**, also bis eine Rep nicht mehr geht.
4. Echte Reserve = gemachte Reps nach dem Stopp-Punkt. Daraus für **jede** Rep des Satzes bekannt:
   wie viele noch gingen. Ein Satz liefert also viele Messpunkte, nicht nur einen.

Was das ergibt:
- Wie gut Philipp schätzt (Schätzung gegen echte Reserve), getrennt nach Übung und Satz.
- Welche Messgröße die echte Reserve am besten vorhersagt: Geschwindigkeit, Weg/Hub, Beschleunigung
  (Spitzenwerte, Ruckeln am Sticking Point), Rep-Dauer, Pause unten. Erst offline vergleichen.
- Grundlage für die eigene Grenzgeschwindigkeit pro Übung (siehe Idee 1).

Hinweise fürs Protokoll:
- Mehrere Maschinen und Gewichte, die Rep-Zahl am Haltepunkt variieren, damit nicht immer dieselbe
  Reserve übrig ist. Für die Auswertung pro Übung mindestens ein paar Sätze, mehrere Tage.
- Nur Sätze nehmen, in denen das Versagen wirklich erreicht wurde; die letzte, nicht geschaffte
  Rep gehört dazu und wird notiert.
- Die Pause am Haltepunkt kurz halten (Schätzung in 1 bis 2 Sekunden), sonst erholt man sich.
- Sicherheit: nur an Maschinen, wo Versagen ungefährlich ist. Nicht jeden Satz, sonst leidet das
  Training; ein bis zwei Sätze pro Übung reichen.
- Im Automatik-Modus kann die Pause zum Schätzen unter 3 s bleiben, dann läuft der Satz einfach weiter.

## Nächste Schritte (Vorschlag)

1. Offline: Geschwindigkeit und Weg pro Rep aus allen Aufnahmen, Verlauf im Satz, Vergleich mit
   eingetragener RIR. Sind Teilreps / stockende Reps sichtbar?
2. Wenn plausibel: pro Satz eine kleine Zusammenfassung am Satz speichern (`sensor` v2: Weg- und
   Geschwindigkeitsverlust, erste/beste/letzte Rep, siehe SPEICHERN.md) und nach dem Satz eine Zeile
   in der Leiste zeigen. Entscheidet nichts, verschlechtert den Zähler nicht.
3. Danach Tagesform und Versagens-Kalibrierung.
