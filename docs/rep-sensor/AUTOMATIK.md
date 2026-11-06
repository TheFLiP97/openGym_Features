# Rep-Sensor – Automatik-Modus ("Dashcam")

Stand: 2026-11-05. Gebaut für den Gym-Test am Sonntag 2026-11-08. Einstellung:
**Einstellungen → Workout → Rep-Sensor → Start: Knopf / Automatisch** (Standard: Knopf).

## Idee (Philipp, 2026-11-04)

Wie eine Dashcam: das Handy misst von selbst, statt auf einen Start-Tipp zu warten. Ein Satz
beginnt mit seinen Reps, und nach dem Satz wird noch weiter gemessen. Kommt noch eine Rep (Luft
holen vor der letzten, schweren Rep), gehört sie zum selben Satz. So geht nichts verloren, und
der Stopp darf trotzdem nach wenigen Sekunden kommen.

## Regeln (Code: `frontend/src/lib/sensor-auto.js`, Tests daneben)

| Regel | Wert | Warum |
|---|---|---|
| Messen erst ab | 70 % der Pause (`REST_SHARE`) | Philipp: in den ersten 70 % wird nicht gemessen; wer früher anfängt, tippt Start. Kein Pausen-Timer (aus oder abgelaufen) = sofort messen. |
| Satz "vorläufig fertig" | Stapel ruhig ≥ 3 s nach einer Rep, bei langsamen Reps eine Rep-Dauer (`STOP_S`) | wie der Auto-Stopp im Knopf-Modus; real ~4–5 s nach der letzten Rep, Philipp: "4 s sind ok, man lässt sich Zeit beim Aufstehen" |
| Danach weiter messen | 12 s (`GRACE_S`) | eine späte Rep korrigiert die Zahl im Satz |
| Satz endgültig zu | nach 12 s ohne neue Bewegung, oder Handy hochgenommen, oder Satz abgehakt / RIR gewählt, oder "Fertig" | erst dann wird die Aufnahme gespeichert |
| Handy hochgenommen **vor** der ersten Rep | einfach neu anfangen, weiter messen | Handy in der Hand = nicht messen; z. B. kurz aufs Handy schauen in der Pause |
| Kein zweites Mal zählen | ein Satz, der schon eine Zählung hat (eingetragen, noch nicht abgehakt), wird nicht noch einmal gemessen | sonst zählt die nächste Bewegung in denselben Satz |
| Erlaubnis | einmal Start tippen pro Seitenaufruf | das iPhone erlaubt den Bewegungssensor nur nach einem Tipp |

Ablauf in der Leiste:
`Misst ab 70 % der Pause` → `Misst, Satz startet von selbst` → `Zählt, stoppt von selbst` →
`Ruhig, stoppt gleich` → Zahl eingetragen, RIR-Auswahl offen, `Eingetragen, misst noch kurz`
(Knopf **Fertig** beendet sofort) → zu.

Nach dem Satz gilt weiter "Nach dem Satz" (Eintragen / Abhaken / Fragen):
- Eintragen: Zahl rein, RIR-Auswahl öffnet sich **einmal** pro Satz (auch wenn eine späte Rep die
  Zahl danach noch ändert).
- Abhaken: Zahl rein und abgehakt, damit ist der Satz sofort zu (keine späte Rep mehr).
- Fragen: "N übernehmen?"; kommt vor der Antwort noch eine Rep, verschwindet die Frage und kommt
  mit der neuen Zahl wieder.

## Bildschirm

Safari liefert keine Bewegungsdaten bei ausgeschaltetem Bildschirm. openGym hält den Bildschirm
im Training ohnehin an (Einstellung "Bildschirm anlassen", Standard an). Ist die aus, hält die
Sensor-Leiste ihn selbst an, im Automatik-Modus das ganze Training lang (kostet Akku).

**Behobener Fehler (2026-11-05):** die Sensor-Leiste hat nach jedem Satz die Bildschirmsperre
der ganzen App freigegeben. Danach konnte sich der Bildschirm in der Pause ausschalten. Jetzt
fasst die Leiste die Sperre nur an, wenn die App sie nicht selbst hält.

## Was am Sonntag zu prüfen ist

- Startet die Messung zuverlässig nach 70 % der Pause? Stört die Messung in der Pause (Handy
  liegt, man steht auf / setzt sich hin)?
- Wird das Einsteigen in die Maschine als Rep gezählt (die Rand-Regeln aus STUFE1_PLAN.md gelten
  auch hier)?
- Wie oft kommt eine späte Rep wirklich, und wird sie richtig dazugezählt?
- Fühlt sich der Ablauf ohne Start-Tipp gut an, oder fehlt eine Rückmeldung?
- Akku über ein ganzes Training.

## Offen / später

- Pausen-Timer automatisch starten, wenn der Satz zu ist (heute startet er mit Abhaken/RIR).
- Live-Zahl und Endzahl gleich machen (die Zahl springt nach dem Stopp noch manchmal).
- Ob 70 % für kurze Pausen (< 60 s) passt.
