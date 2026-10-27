# Rep-Sensor – Plan Stufe 1: Live-Reps + Weg in % (inkl. Teilreps)

Stand: 2026-10-23. Baut auf [HANDOFF.md](HANDOFF.md) auf. Punkte mit „prüfen“ sind Annahmen,
die wir auf dem iPhone messen, bevor wir uns darauf verlassen.

## Ergebnis von Stufe 1

Handy liegt auf dem Stapel → openGym zeigt live „7 · 92 %“, am Satzende „10 + 2 Teilreps (45 %, 30 %)“
und schlägt die Repzahl für den Satz vor. Der Nutzer bestätigt oder korrigiert; nichts wird
still überschrieben. Feature standardmäßig aus.

Zwei Meilensteine: **1a Safari** (zuerst, ergibt den ersten PR) und **1b iOS-App** (später, sobald
ein eigener App-Build läuft). Wann jeder davon „geht“, steht unten unter „Abnahme“.

## Was der Kern braucht (Datenvertrag)

Ein Strom von Samples, mehr nicht:

```
{ t, ax, ay, az }
  t        Sekunden, monoton steigend (Abstände dürfen schwanken)
  ax..az   Beschleunigung INKL. Schwerkraft, Einheit egal (m/s² oder g), Vorzeichen egal
```

- Rate ≥ 30 Hz (Prototyp zählt bei 30 Hz noch 10/10), Ziel 60 Hz.
- Schwerkraft wird aus der Ruhe vor dem Satz geschätzt und projiziert – deshalb sind Einheit,
  Vorzeichenkonvention und Lage des Handys egal (Anforderung „Zero-Config“).
- Kein Gyroskop, keine Orientierung, kein Magnetometer in Stufe 1.
- Jede Quelle (web, native, ble) liefert genau dieses Format. Der Kern weiß nicht, woher es kommt.

## Woher wir die Daten bekommen

| Umgebung | API | Rate | Berechtigung | Für Stufe 1 |
|---|---|---|---|---|
| PWA, iPhone Safari | `devicemotion` → `accelerationIncludingGravity` | ~60 Hz (prüfen) | `DeviceMotionEvent.requestPermission()` aus einem Tap, nur HTTPS | **ja – Philipps Testweg** |
| PWA, Android Chrome | dasselbe | max. 60 Hz | keine, nur HTTPS | ja (ohne Code-Unterschied) |
| Capacitor-App iOS (WKWebView) | dasselbe JS-API | ~60 Hz (prüfen) | WebKit fragt selbst; ob Capacitor den Dialog durchreicht: prüfen | ja, ohne nativen Code (sofern Dialog kommt) |
| Capacitor-App Android (WebView) | dasselbe JS-API | ~60 Hz | keine | ja |
| Natives Plugin iOS | CoreMotion `CMMotionManager` (Accelerometer roh oder deviceMotion) | bis 100 Hz | für Rohdaten keine | **nein** – erst wenn Web nicht reicht |
| Natives Plugin Android | `SensorManager`, `TYPE_ACCELEROMETER` | 100 Hz | keine (< 200 Hz) | **nein** |
| Eigener Sensor | BLE (`@capacitor-community/bluetooth-le`), iOS nur in der App | frei | Bluetooth | später |
| Apple Watch | CoreMotion auf watchOS während der Trainings-Session (`WorkoutManager.swift`), Weitergabe über die vorhandene Watch-Bridge | 100 Hz+ | keine extra | später – freie Gewichte ohne Eigenbau |

### Apple Watch als Quelle (Idee für später)

Bei freien Übungen (Bankdrücken, Kurzhantel, Rudern) bewegt sich das Handgelenk fast genau mit
der Last. Die Watch wäre dann der Sensor, den man nicht bauen muss. Gute Voraussetzungen gibt es
schon: Die Watch-App (`frontend/ios/App/Watch/`) startet bereits eine Trainings-Session, in der
watchOS Bewegungsdaten im Hintergrund erlaubt, und die Watch-Bridge zum iPhone existiert. Die
Watch liefert dasselbe `{t, ax, ay, az}`, also läuft derselbe Kern. Unterschied zum Stapel: Das
Handgelenk dreht sich mit, die Schwerkraftrichtung bleibt nicht fest – das braucht vermutlich
Gyroskop oder eine laufend nachgeführte Schwerkraftschätzung. Native watchOS-Arbeit, daher erst
nach 1b.

**Entscheidung für Stufe 1: nur die Quelle `web`.** Sie läuft unverändert in der PWA und in beiden
Capacitor-Shells, braucht keinen Mac und kein Android-Gerät und kein Abstimmen mit dem Maintainer
über nativen Code. Ein natives Plugin lohnt erst, wenn die Messungen zeigen, dass 60 Hz mit
Web-Jitter für Weg/Geschwindigkeit (Stufe 3) nicht reichen.

**Ziel ist die iOS-App, Safari ist nur das Testgerät.** Die iOS-App ist eine Capacitor-Hülle um
genau denselben JS-Code; sie zeigt ihn in einem WKWebView, also mit derselben WebKit-Engine wie
Safari. Was in der Safari-PWA zählt, zählt in der App gleich. Unterschiede gibt es nur beim
Erlaubnis-Dialog und eventuell bei der Rate – das prüfen wir einmal, sobald ein eigener App-Build
auf dem iPhone läuft (siehe „Weg in die iOS-App“).

## Weg in die iOS-App

- **Code ändern:** Im eigenen Fork (`TheFLiP97/openGym_Features`) ohne jede Erlaubnis möglich (AGPL).
  Erlaubnis braucht es erst, damit es in die offizielle App kommt: Pull Request an
  `DuarteSantos8/openGym`, CLA, Review und Release durch den Maintainer.
- **Die App-Store-App lässt sich nicht selbst updaten.** Sie ist mit dem Apple-Konto des
  Maintainers signiert; Änderungen aus dem Fork kommen nur über Upstream-Merge + neues Release.
- **Eigener App-Build auf dem iPhone** braucht macOS zum Bauen und eine Signatur. Ohne Mac:
  - Bauen: `.github/workflows/ios.yml` baut die App schon auf einem macOS-Runner von GitHub
    (im Fork nutzbar), aber nur für den Simulator – der hat keinen Beschleunigungssensor.
  - Variante A – Apple Developer Program (99 €/Jahr): eigene Bundle-ID (z. B. `…opengym.dev`,
    neben der App-Store-App installierbar), Zertifikat als GitHub-Secret, signierter Build im
    Workflow, Upload zu TestFlight → Installation auf dem iPhone. Einmaliger Einrichtungsaufwand;
    Entitlements (HealthKit, App Group, Watch, Widgets) müssen aufs eigene Team umgestellt oder
    für den Dev-Build abgeschaltet werden.
  - Variante B – kostenlose Apple-ID: unsignierten Geräte-Build im Workflow erzeugen und unter
    Windows per Sideloading-Tool signieren/installieren. Läuft nach 7 Tagen ab, Entitlements
    teils nicht erlaubt – möglich, aber prüfen.
  - Variante C – keinen eigenen Build: Stufe 1 in Safari fertig entwickeln, dann über Upstream in
    die App bringen.
- Bis ein App-Build steht, testen wir in der **Safari-PWA** – das ist ohnehin der schnellste
  Kreislauf (Server neu bauen, Seite neu laden).

### Details zur Quelle `web`

- Event: `window.addEventListener('devicemotion', e => …)`; Werte aus
  `e.accelerationIncludingGravity.{x,y,z}` (m/s²), Zeit aus `e.timeStamp` (ms, monoton),
  Nennintervall aus `e.interval`. Wir nehmen den echten Zeitstempel, nicht das Nennintervall.
- iOS: `requestPermission()` muss direkt im Tap-Handler laufen (z. B. Button „Sensor starten“).
  Ob die Home-Screen-PWA bei jedem Start neu fragt: prüfen.
- iOS liefert die Achsen mit umgekehrtem Vorzeichen gegenüber Android – für unseren Kern egal
  (Projektion auf geschätzte Schwerkraft).
- Nur bei sichtbarer Seite: Bildschirm aus oder App im Hintergrund = keine Events. Wir nutzen den
  vorhandenen Wake-Lock aus `frontend/src/lib/wakelock.js`. Im Stromsparmodus verweigert iOS
  den Wake-Lock → Hinweis im HUD statt stiller Lücke.
- Lücken in den Daten (Seite kurz verdeckt) → Satz als „unsicher“ markieren, nie raten
  (Anforderung 3).

### Falls später nativ nötig (nur zur Orientierung)

Das Muster gibt es im Repo schon: eigene Plugins direkt in den Shells, z. B.
`RestAlertPlugin.java` / `RestAlertPlugin.swift`, registriert in `MainActivity.java`
(`registerPlugin`) und `MainViewController.swift` (`registerPluginInstance`), aus JS nur hinter
`MOBILE` dynamisch importiert (`lib/mobile.js`). Ein `MotionPlugin` würde `start({hz})`/`stop()`
anbieten und Samples gesammelt alle ~100 ms per `notifyListeners` als Array an JS geben
(nicht ein Bridge-Aufruf pro Sample). Ausgabe: dasselbe `{t, ax, ay, az}`.

## Bausteine, in dieser Reihenfolge

1. **Quelle `frontend/src/lib/motion-source.js`** – `start()`, `stop()`, `onSample(cb)`,
   Berechtigung, misst echte Rate und Jitter. Gleiche Schnittstelle, die später `native`/`ble`
   bekommen.
2. **Debug-Recorder in der App** – Schalter (Entwickleroption), der die Rohdaten eines Satzes
   behält und als JSON/CSV exportiert. Damit sammeln wir echte Browser-Daten vom iPhone
   (60 Hz, mit Jitter) statt nur Sensor-Logger-Daten (100 Hz, sauber). Erste Messung: tatsächliche
   Rate in PWA und Capacitor-App.
3. **Python-Kern erweitern** (`handoff/prototype/`): Weg per Integration nur in der Konzentrikphase
   mit Nullgeschwindigkeit an den Umkehrpunkten (ZUPT) + lineare Driftkorrektur; Referenzweg aus
   den ersten sauberen Reps; Teilrep unter ~85–90 % der Referenz. Ausgabe pro Rep:
   `{ start, end, romRel, partial, confidence, source }` (mcv/peak/tCon/tEcc erst Stufe 3).
   Parameter an einem Ort.
4. **Golden Files** – Python schreibt Eingabe + erwartete Rep-Events als JSON
   (`frontend/src/lib/__fixtures__/rep-sensor/…`, Ort noch festlegen).
5. **JS-Port `frontend/src/lib/rep-counter.js`** + `rep-counter.test.js` gegen die Golden Files
   (Vitest, wie die übrige Trainingslogik).
6. **Minimales HUD im Workout-Screen** – klein, abschaltbar: Repzahl + Weg-% der letzten Rep;
   am Satzende Vorschlag zum Übernehmen.
7. **Speichern nur der Zusammenfassung** am Satz, z. B.
   `sensor: { reps, partials: [0.45, 0.30], src: 'web', v: 1 }`. Rohdaten nach Satzende verwerfen
   (außer Debug-Schalter). Vorher prüfen, wie Sync, Export und MCP-Server unbekannte Felder an
   einem Satz behandeln.

## Datensammlung (Philipp)

Mit Sensor Logger (100 Hz) und, sobald Baustein 2 steht, mit dem Recorder in openGym:

- 3+ verschiedene Stapelmaschinen, je ein normaler Satz
- 1 Satz bis echtes Versagen
- 1 Satz mit absichtlichen Teilreps am Ende (gedehnt und oben getrennt)
- Stapelweg pro Maschine mit Maßband (nur zur Validierung von Weg-%)
- Notiz pro Datei: Maschine, Gewicht, Reps, Besonderheiten

## Voraussetzung zum Testen

Der Fork muss auf der Synology per **HTTPS** laufen (DeviceMotion und Passkeys verlangen es), siehe
`docs/SELF_HOSTING.md` / `docs/SELF_HOSTING_HTTPS.md`. Dann PWA auf dem iPhone installieren.

## Abnahme – wann „es geht“

### 1a Safari-PWA → erster PR

Tests (laufen in CI, beweisen es ohne Gym):
- [ ] `cd frontend && npm test` grün, inkl. `rep-counter.test.js` gegen die Golden Files
- [ ] Golden Files mit dem openGym-Recorder in Safari aufgenommen (nicht nur Sensor Logger):
      ≥ 3 Maschinen, 1 Satz bis Versagen, 1 Satz mit absichtlichen Teilreps
- [ ] In jeder Datei: Repzahl exakt, Teilreps als Teilreps erkannt, keine Rep beim Absetzen

Im Gym (iPhone 13 Pro Max, Safari-PWA der eigenen Instanz):
- [ ] Feature aus → openGym verhält sich genau wie vorher
- [ ] Einschalten, einmal tippen (Erlaubnis), Handy auf den Stapel – kein weiterer Schritt
- [ ] Live-Zahl im HUD während des Satzes; am Satzende Vorschlag, übernehmen oder korrigieren
- [ ] ≥ 20 Live-Sätze an ≥ 3 Maschinen: in ≥ 19 davon stimmt die Repzahl exakt (Liste mit
      Soll/Ist wird Teil der Upstream-Discussion)
- [ ] Bildschirm aus / Stromsparmodus / Lücke → sichtbarer Hinweis, keine falsche Zahl
- [ ] Gespeichert wird nur die Zusammenfassung; Sync über den Server und Export funktionieren

Formal:
- [ ] Keine neue Abhängigkeit; neue Texte in den Locales (Locale-Check in CI)
- [ ] Discussion upstream mit Ergebnistabelle eröffnet, danach PR

### 1b iOS-App → Nachtrag oder zweiter PR

- [ ] Eigener App-Build auf dem iPhone (Variante A oder B)
- [ ] Erlaubnis-Dialog erscheint in der App; Rate gemessen
- [ ] Dieselben Live-Sätze wie in 1a liefern dieselbe Qualität

### Server-Variante: was gleich ist und was nicht

Die App kann sich mit dem eigenen Server verbinden („Mit meinem Server verbinden“,
`lib/remote.js`). Dann sind die **Daten** gleich: ein Satz, den Safari mit Sensor aufnimmt, sieht
die App und umgekehrt. Der **Code** kommt aber nicht vom Server – die App bringt ihren
JS-Code fest im App-Paket mit. Neue Funktionen kommen deshalb nur mit einem neuen App-Build in die
App, auch im Server-Modus. Deshalb sind 1a und 1b getrennt.

## Offen / prüfen

- Tatsächliche Rate und Jitter in iOS-PWA und Capacitor-iOS
- Merkt sich die Home-Screen-PWA die Bewegungs-Berechtigung?
- Reicht der WKWebView-Standarddialog in der Capacitor-App, oder braucht es ein paar Zeilen Swift?
- Wo das Feature in den Einstellungen sitzt (bei den anderen optionalen Extras)
