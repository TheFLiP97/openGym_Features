# Rep-Sensor – Konzept: Was wird wo gespeichert, und wie lernt openGym pro Übung?

Stand: 2026-10-30. Entwurf zum gemeinsamen Durchgehen, noch nichts davon gebaut.

## Leitgedanke

Jeder nimmt das Handy, legt es auf den Stapel und trainiert. Niemand muss etwas einstellen,
messen oder korrigieren. Korrigieren *darf* man immer, und jede Korrektur macht die Zählung für
diese Übung besser. Wer nie korrigiert, bekommt trotzdem eine gute Zählung.

Daraus folgt: **Die Grundeinstellung muss ohne gespeichertes Wissen funktionieren.** Was pro Übung
gespeichert wird, verfeinert nur. Ein Pflicht-Eintrag von Hand ("der erste Satz muss händisch
sein") wäre schon eine Korrektur, die viele nicht machen würden.

## Wie openGym heute speichert (relevant dafür)

- Alles liegt in einem Zustand `S` (Zustand-Store), lokal auf dem Handy und per Sync auf dem
  Server (NAS). Der Server rechnet nichts, er speichert nur.
- Ein Satz ist eine Zeile `{ w, r, done, … }` in einem Workout. Zusätzliche Felder an der Zeile
  bleiben beim Abschließen des Trainings erhalten (`finish-workout.js` entfernt nur
  Sitzungs-Hilfsfelder wie `planSec`).
- Pro Übung gibt es schon mehrere "Karten" (Schlüssel = Übungs-ID), z. B. `exWeights` (bestes
  Gewicht), `exNotes`, `stackWeights`. Die gestempelten Karten werden beim Sync pro Übung
  zusammengeführt: die zuletzt geänderte gewinnt (`STAMPED_MAPS` in `lib/sync-merge.js`).
  **Achtung:** diese Liste gibt es absichtlich zweimal (`api/sync-stamps.js`), beide gemeinsam
  ändern, ein Test vergleicht sie.

## Drei Ebenen

### Ebene 1 – Rohdaten (nur im Speicher, nie gespeichert)

Messwerte des laufenden Satzes, solange der Satz offen ist. Werden beim Abhaken verworfen
(Anforderung 4). Ausnahme: Debug-Schalter → Export als Datei, nicht in `S`.

Wichtig: Solange die Rohdaten noch im Speicher sind, kann eine Korrektur sie noch nutzen (siehe
"Lernen aus Korrekturen").

### Ebene 2 – Ergebnis pro Satz (an der Satzzeile, im Workout-Verlauf)

Stufe 1, nur Zählen:
```js
{ w: 55, r: 10, done: true,
  sensor: { v: 1, src: 'web', reps: 10, sure: true } }
```
- `reps`: was der Sensor gezählt hat. `r` bleibt das, was gilt (Progression, Statistik). Ohne
  Hand-Eingabe ist `r = sensor.reps`.
- Ob korrigiert wurde, braucht kein eigenes Feld: `r !== sensor.reps`.
- `sure: false`, wenn der Sensor unsicher war (Lücke in den Daten, Handy während einer Rep
  bewegt, sehr unregelmäßige Buckel). Dann zeigt die App die Zahl mit "?" – man *kann* schauen,
  muss aber nicht.
- `v` = Version des Formats. Was einmal gespeichert ist, muss lesbar bleiben; neue Felder kommen
  mit höherem `v` dazu.

Später (Ausbaustufe Weg/Geschwindigkeit), weiter klein halten – pro Satz eine Zusammenfassung,
keine langen Listen:
```js
sensor: { v: 2, src: 'web', reps: 10, sure: true,
          partial: 1,          // Teilreps
          rom: 41,             // typischer Hub in cm (Median)
          vFirst: 72, vLast: 48, vBest: 75,   // mittlere Konzentrik-Geschwindigkeit in cm/s
          tCon: 0.9, tEcc: 1.6 }              // typische Dauer hoch/runter in s
```
Größe grob 150 Zeichen pro Satz → bei 4 Trainings × 20 Sätzen pro Woche ~0,6 MB pro Jahr im
Zustand. Vertretbar, aber der ganze Zustand wird bei jedem Sync übertragen – deshalb keine
Werte pro Rep speichern. Velocity Loss = 1 − vLast / vFirst ergibt sich daraus.

### Ebene 3 – Wissen pro Übung (neue gestempelte Karte `sensorProfiles`)

```js
sensorProfiles: {
  'leg-extension': {
    _ts: 1793000000000,      // Stempel für den Sync (zuletzt geändert gewinnt)
    n: 7,                    // aus so vielen Sätzen gelernt
    bump: 2.9,               // typische Höhe der Buckel in m/s² (Median der letzten Sätze)
    thr: 0.35,               // Schwelle als Anteil davon
    repS: 2.3,               // typische Dauer einer Rep in s
    // später: rom (cm), vFail (Geschwindigkeit am Versagen), Richtung (Assistenz-Maschine) …
  }
}
```
- Schlüssel = Übungs-ID. Später eventuell Übung + Gerät (`equipProfiles` gibt es schon: dieselbe
  Übung an verschiedenen Maschinen/Studios kann sich anders verhalten).
- Gelernt wird mit einem gleitenden Median über die letzten ~5 Sätze: ein einzelner seltsamer
  Satz verdirbt nichts, und die Werte folgen, wenn man stärker/langsamer wird.
- Sync: in `STAMPED_MAPS` aufnehmen (beide Kopien, siehe oben).

## Wie gezählt wird, ohne dass jemand etwas einstellt

1. **Ohne Profil (erster Satz einer Übung):** Schwelle relativ zum Satz selbst – Untergrenze
   ein Vielfaches des Rauschens in der Ruhe vor dem Satz, nach dem ersten großen Buckel ein Anteil
   von dessen Höhe. Funktioniert ohne Vorwissen.
2. **Mit Profil:** Start mit den gelernten Werten dieser Übung, im Satz weiter angepasst
   (langsamere Reps gegen Ende bei Versagen).
3. Das Profil verfeinert nur. Ist es weg (neues Handy, Reset), zählt die App trotzdem.

## Lernen – ohne dass jemand etwas tun muss

- **Satz ohne Korrektur abgehakt** = stillschweigend bestätigt. Dessen Buckelhöhe und Rep-Dauer
  gehen in das Profil der Übung ein.
- **Satz korrigiert** (z. B. 9 → 10), solange die Rohdaten noch im Speicher sind: die App rechnet
  den Satz mit anderen Schwellen nach, bis die Zahl passt, und merkt sich diese Schwelle für die
  Übung. Danach werden die Rohdaten verworfen. Eine Korrektur hilft also sofort für den nächsten
  Satz.
- **Korrektur später** (Rohdaten schon weg): nur die Zahl wird geändert, das Profil lernt nichts
  daraus – zählt aber auch nicht mehr als "bestätigt".
- **Unsichere Sätze** (`sure: false`) lernen nicht mit.

Deine Idee "der erste Eintrag ist die Basis, wie beim Gewicht" steckt darin: der erste
*bestätigte* Satz einer Übung wird zur Basis – nur eben ohne Pflicht, ihn händisch einzugeben.

## Was nie passiert

- Die Sensor-Zahl überschreibt nie eine Zahl, die man selbst eingetippt hat.
- Fehlende oder unsichere Sensordaten blockieren keine Progression; ohne Sensor gilt wie bisher
  nur die eingetragene Zahl.
- Rohdaten landen nie in `S` oder auf dem Server.

## Offene Fragen

- Schlüssel pro Übung oder pro Übung + Gerät? (Vorschlag: erst pro Übung, Gerät später.)
- Wie viele Sätze für den Median (Vorschlag 5)?
- Soll die App nach z. B. drei Korrekturen in Folge bei einer Übung von sich aus fragen
  "Liegt das Handy richtig?" – oder nie fragen?
