# Rep-Sensor / VBT für openGym – Übergabe

Stand: 2026-10-23. Kontext für eine neue Claude-Code-Session im openGym-Fork.
Bitte zuerst komplett lesen; Entscheidungen hier sind mit Philipp abgestimmt.

## Ziel
openGym erkennt Wiederholungen automatisch und misst Weg und Geschwindigkeit pro Rep.
Zuerst mit dem Handy, das bei Maschinen auf dem Gewichtsstapel liegt, später mit einem
selbstgebauten Sensor (per Magnet befestigt, BLE). Daraus entstehen Hinweise zur
Trainingsqualität und zur Progression.

## Harte Anforderungen
1. **Zero-Config für Nutzer:** Handy auf den Stapel legen und trainieren. Kein Messen,
   kein Kalibrieren, keine Ausrichtung. (Maßband etc. nur in Philipps Testphase.)
2. **Sensor nie Pflicht:** Alles funktioniert ohne Sensor wie bisher. Manuelles Eintragen
   und Korrigieren immer möglich. Feature standardmäßig AUS (wie andere openGym-Extras).
3. **Fehlende Sensordaten blockieren nie** eine Progression und täuschen keine Sicherheit vor.
   Fallback ist immer die reine Regel (Reps × Gewicht).
4. **Rohdaten werden nicht gespeichert.** Nach Satzende verwerfen, nur Rep-/Satz-Zusammenfassung
   speichern. (Während der Entwicklung: Debug-Schalter, der Rohdaten behält.)
5. **Sensorunabhängige Logik:** Alles ist auf den späteren eigenen Sensor ausgelegt; das Handy
   ist nur eine Quelle von mehreren.
6. Philipp will **eigenen Server** (Docker auf Synology NAS), Zugriff per Browser UND App,
   mehrere Nutzer auf einer Instanz.

## Architektur (3 Schichten)
1. **Quelle (austauschbar)** → liefert Rohbeschleunigung inkl. Schwerkraft + Zeitstempel.
   - `web`: `DeviceMotionEvent.accelerationIncludingGravity` (PWA + Capacitor-App, sofort nutzbar,
     iOS braucht `DeviceMotionEvent.requestPermission()` per Tap, HTTPS; Rate vermutlich ~60 Hz, prüfen)
   - `native`: CoreMotion / Android-Sensor-API per Capacitor-Plugin (100 Hz) – nur falls nötig
   - `ble`: eigener Sensor (IMU, roh in g inkl. Schwerkraft). Auf iOS nur in der nativen App
     möglich (Safari hat kein Web Bluetooth). Plugin-Kandidat: `@capacitor-community/bluetooth-le`
   - optional später: ToF-Abstandssensor am Eigenbau für direkten Weg ohne Integration
   - `watch`: Apple Watch am Handgelenk für freie Gewichte (Bankdrücken etc.) ohne Eigenbau;
     watchOS-CoreMotion während der Trainings-Session, über die vorhandene Watch-Bridge
     (Details in STUFE1_PLAN.md)
2. **Kern (reine Funktionen, kausal, Sample für Sample)** → Rep-Events:
   `{ start, end, romRel, mcv, peak, tCon, tEcc, partial, confidence, source }`
   - Schwerkraftvektor aus Ruhe vor dem Satz schätzen, auf Vertikale projizieren:
     `s = (a·û − |g0|)` → einheiten- und vorzeichenkonventions-unabhängig, `+ = hoch`
   - Tiefpass 1. Ordnung, Zustandsautomat (unten-Buckel → oben-Buckel → Release = Rep)
   - Geschwindigkeit/Weg: Integration nur pro Konzentrikphase mit Nullgeschwindigkeit an den
     Umkehrpunkten (ZUPT) + lineare Driftkorrektur
   - Referenzweg pro Übung/Maschine automatisch aus ersten sauberen Reps lernen;
     Teilrep = Weg unter ~85–90 % der Referenz
   - Liegt wie die übrige Trainingslogik in `frontend/src/lib/` mit Tests daneben
3. **Auswertung / Progression**
   - Satzkennzahlen: volle Reps, Teilreps, Velocity Loss (erste vs. letzte Rep), RIR-Schätzung, Flags
   - Sensor-Modus pro Übung: **Aus / Hinweis / Gate**
   - Andocken an openGym-Progression und die vorhandene RIR/RPE-Spalte (RIR-Vorschlag pro Satz)

## Darstellung
- **Coach-Modus** (Standard für neue Nutzer): Handlungshinweise („ca. 3–4 Reps übrig, weiter gehen“,
  „Gewicht erhöhen“, „Exzentrik langsamer“, „Weg wird kürzer“)
- **Daten-Modus**: MCV, Peak, Weg %, Velocity Loss, Load-Velocity-Profil, e1RM
- Teilreps nicht als 0,5 zählen; Anzeige z. B. „10 + 2 Teilreps (45 %, 30 %)“, gedehnte vs.
  obere Position unterscheiden. Progression wertet nur volle Reps.
- HUD im Workout-Screen muss angepasst werden (klein, abschaltbar)

## Reihenfolge
1. Live-Reps zählen (nur zählen)  ← **als Nächstes**
1b. Weg in % + Teilreps (eigene Ausbaustufe, nach dem ersten PR)
2. Automatische Satzerkennung + Pausentimer-Start
3. Geschwindigkeit pro Rep + Velocity Loss → RIR-Vorschlag
4. Selbstkalibrierung (gelegentliche Sätze bis Versagen → Geschwindigkeit am Versagen pro Maschine),
   Load-Velocity-Profil, Tagesform
Backlog: Tempo/Exzentrik/Stapel-Anschlagen, Schwung-Erkennung, Pausenempfehlung (auch mit
Apple-Watch-Herzfrequenz pro Satz, seit v1.4.2), physikalische Arbeit pro Satz, Wochen-Konsistenz.

## Entwicklungsweise
- Philipp kann kein JS. Konzeptarbeit und Plots gern in Python, aber Kern so schreiben, dass er
  1:1 nach JS portierbar ist: Klasse mit `step(t, ax, ay, az)`, kausal, keine `filtfilt`/SciPy im Kern,
  Parameter zentral an einem Ort.
- Golden Files: Python schreibt Eingabe + erwartete Ausgabe als JSON; JS muss dasselbe liefern.
- Direkt im Fork entwickeln, keine separate Wegwerf-Test-App.
- Philipp hat iPhone 13 Pro Max und einen **Windows-PC** (kein Mac, kein Android-Gerät).
  → Web-Teil auf dem iPhone per PWA der eigenen Instanz testen. Native Plugins bräuchten
  Mac/Xcode oder macOS-CI und Abstimmung mit dem Maintainer.
- Upstream: AGPL, CLA, `CONTRIBUTING.md`. Erst Discussion eröffnen, wenn Stufe 1 nachweislich zählt.

## Datenstand
- Datensatz 1: Leg Extension 55 kg × 10, 2026-10-22, iOS-App „Sensor Logger“ (ZIP mit
  Accelerometer, Gravity, Gyroscope, Orientation, *Uncalibrated, Metadata). 100 Hz exakt, 31,9 s.
  - Handy lag flach, Schwerkraft fast nur auf z; Apple-Konvention: vertikal hoch = `a · g/|g|`
  - ~1,8 s Ruhe am Anfang, 10 Reps im Abstand ~2,4 s, ab ~24 s Absetzen/Handling (Gyro-Spitzen)
  - Pro Rep: unten positiver Buckel, oben negativer, Peaks ±3–4 m/s²; Gyro während Reps ≈ 0
  - `prototype/repcounter.py` (kausal, nur Rohdaten inkl. Schwerkraft): **10/10 Reps bei 100, 60
    und 30 Hz**, Erkennung ~0,3 s nach oberem Umkehrpunkt, keine Fehlzählung beim Absetzen
  - Erster Weg/Geschwindigkeits-Versuch unbrauchbar (Segmentierung über driftende Position) –
    muss mit ZUPT an den Umkehrpunkten neu gemacht werden
- Noch benötigt: mehrere Maschinen, ein Satz bis echtes Versagen, ein Satz mit absichtlichen
  Teilreps am Ende, Stapelweg pro Maschine mit Maßband (nur zur Validierung).

## Hinweise zur Wissenschaft (aus dem Gedächtnis, vor Veröffentlichung Quellen prüfen)
- Last-Geschwindigkeits-Beziehung individuell, aber stabil (González-Badillo, Sánchez-Medina)
- Velocity Loss als Ermüdungsmarker; ~20 % ähnliche Kraftzuwächse bei weniger Ermüdung,
  ≥40 % eher mehr Hypertrophie/Ermüdung (Pareja-Blanco et al.)
- Geschwindigkeit am Versagen individuell und übungsspezifisch → Selbstkalibrierung nötig
- RIR-Selbsteinschätzung oft ungenau, besonders bei Anfängern
- Gedehnte Teilwiederholungen an der Beinstreckung möglicherweise gleichwertig/besser (Pedrosa et al.)
- Fast alle VBT-Studien an freien Gewichten; für Stapelmaschinen kaum Daten
