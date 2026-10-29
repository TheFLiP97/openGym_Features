# Rep-Sensor – Plan Stufe 1: Live-Reps zählen

Stand: 2026-10-23. Baut auf [HANDOFF.md](HANDOFF.md) auf. Punkte mit „prüfen“ sind Annahmen,
die wir auf dem iPhone messen, bevor wir uns darauf verlassen.

## Ergebnis von Stufe 1

Handy liegt auf dem Stapel → openGym zählt live mit und schlägt am Satzende die Repzahl für den
Satz vor. Nur Zählen: kein Weg in %, keine Teilreps, keine Geschwindigkeit – das sind spätere
Ausbaustufen (HANDOFF.md, „Reihenfolge“). Progression und alles andere bleiben unverändert. Der Nutzer bestätigt oder korrigiert; nichts wird
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

## Die Teile

Wie ein Satz heute im Code läuft: Eine Satzzeile ist `{ w, r, done }` in `S.active.entries[i].sets`.
Abhaken läuft über `toggle()` in `views/Workout.jsx` (setzt `done`, `at`, startet den Pausentimer).
Gehaltene Sätze (Plank) haben schon einen „Satz läuft“-Zustand: Play-Knopf an der Zeile →
`useUI.startWork()` → Countdown → schreibt `sec` in die Zeile und hakt ab. **Genau dieses Muster
übernehmen wir für den Sensor-Satz.** Das Workout hat vier Ansichten (Karten, Liste, Kompakt,
Fokus), die Zeile muss in allen funktionieren.

### A – Aufnahme (Quelle)
`lib/motion-source.js`: `start()` / `stop()` / `onSample(cb)`, fragt beim ersten Start die
iOS-Erlaubnis (braucht den Tap), liefert `{t, ax, ay, az}`, misst Rate und Lücken. Keine
React-Abhängigkeit, damit später `native`/`ble`/`watch` dieselbe Schnittstelle bekommen.

### B – Satz-Sitzung (Daten pro Satz)
Verbindet die Quelle mit genau einer Satzzeile:
- **Start:** Sensor-Knopf an der Zeile (wie der Play-Knopf bei gehaltenen Sätzen). Der Tap ist
  gleichzeitig die iOS-Erlaubnis. Danach ~1 s „ruhig liegen lassen“ (Schwerkraft schätzen), dann
  „bereit“. Automatischer Start ohne Tap ist Stufe 2.
- **Laufend:** Samples → Zähler (C) → Live-Stand `{ reps, lastRom, quality }` in `useUI`
  (flüchtig, nicht in `S`).
- **Ende:** Abhaken der Zeile (Knopf, Watch, Tastatur – alles läuft über `toggle()`) stoppt die
  Quelle. In die Zeile kommt nur die Zusammenfassung. Rohdaten werden verworfen, außer der
  Debug-Schalter ist an → dann als Datei exportierbar (Recorder).
- Nur eine Sitzung gleichzeitig; ein Abhaken einer anderen Zeile oder Verlassen des Workouts
  beendet sie, wie bei gehaltenen Sätzen.

### C – Reps zählen (Kern)
`lib/rep-counter.js`: 1:1-Port von `prototype/repcounter.py` (`step(t, ax, ay, az)`, kausal,
Parameter an einem Ort), daneben `rep-counter.test.js` gegen Golden Files
(Python schreibt Eingabe + erwartete Reps als JSON). Nur zählen. Weg-% und Teilreps
(ZUPT, Referenzweg) sind eine spätere Ausbaustufe im selben Kern.

### D – Oberfläche
- **Live:** Zahl während des Satzes (Design offen, siehe unten).
- **Ins Feld schreiben:** Die gezählte Zahl landet im Rep-Feld der Zeile, sichtbar als
  „vom Sensor“ markiert. Tippt der Nutzer selbst eine Zahl, gewinnt immer seine – der Sensor
  überschreibt nie eine Hand-Eingabe. Gespeichert wird zusätzlich
  `sensor: { reps, partials: [0.45, 0.30], src: 'web', v: 1 }` an der Zeile.
- **Einstellungen:** Schalter „Rep-Sensor (experimentell)“, Standard aus, nur sichtbar wenn das
  Gerät Bewegungsdaten liefert. Darunter Debug „Rohdaten behalten“.
- Neue Texte in alle Locales (CI prüft das).

### E – Daten-Durchgang prüfen
Ob das neue Feld `sensor` an einer Zeile durch `finish-workout.js` in `S.workouts`, durch Sync
zum Server, Export/Import und den MCP-Server kommt oder dort verloren geht/stört. Vorher klären,
bevor wir es speichern.

### Design – offen, gemeinsam anschauen
Wo die Live-Zahl sitzt. Kandidaten:
1. **In der Satzzeile selbst:** Rep-Feld zählt live hoch, kleines Sensor-Symbol daneben.
   Wenig neue Oberfläche, funktioniert in allen vier Ansichten, aber klein – vom Sitz der
   Maschine aus schwer lesbar.
2. **Leiste unten wie der Pausentimer:** „Sensor · 7 Reps“, groß, mit Stop/Fertig.
   Gut lesbar, eine Stelle für alle Ansichten; Pausentimer und Sensor-Leiste wechseln sich ab
   (laufen nie gleichzeitig).
3. **Vollbild-Zahl** (nur in der Fokus-Ansicht oder als eigener Modus): riesige Zahl, aus 1–2 m
   lesbar.
Wahrscheinlich 1 + 2 kombiniert, 3 später. Vor dem Bauen als Mockup anschauen.

## Schritte (jeder für sich testbar)

1. **Recorder** – A + B ohne Zählen + Einstellungs-Schalter + Export. Ergebnis: echte
   Safari-Daten vom iPhone und die gemessene Rate. Gym-Test: einen Satz aufnehmen, Datei teilen.
2. **Zähler im Test** – C (nur zählen) + Golden Files aus den Recorder-Dateien. Ergebnis: `npm test`
   beweist die Zählung ohne Gym.
3. **Live-Zahl** – D: Zahl live + ins Rep-Feld, Zusammenfassung speichern (nach E). Ergebnis:
   Gym-Test mit echtem Training.
4. Abnahme 1a (unten) → Discussion → PR.

## Datensammlung (Philipp)

Mit Sensor Logger (100 Hz) und, sobald Baustein 2 steht, mit dem Recorder in openGym:

- 3+ verschiedene Stapelmaschinen, je ein normaler Satz
- 1 Satz bis echtes Versagen
- später, für die Ausbaustufe Weg-%: ein Satz mit absichtlichen Teilreps, Stapelweg per Maßband
- Notiz pro Datei: Maschine, Gewicht, Reps, Besonderheiten

## Lokal testen (nur im Heimnetz, iPhone-Safari → PC)

Safari liefert Bewegungsdaten nur über **HTTPS** (`http://localhost` zählt nur auf dem Gerät
selbst). Das ist der eigentliche Knackpunkt, nicht Docker.

Vorschlag: **Vite-Dev-Server direkt auf dem Windows-PC mit HTTPS** statt Docker.
- Vorteil: Code ändern → iPhone lädt die Seite von selbst neu, kein Image-Bauen.
- `mkcert` (eigenständiges Werkzeug, keine npm-Abhängigkeit) erzeugt ein Zertifikat für die
  LAN-IP des PCs. Das Stamm-Zertifikat einmal aufs iPhone (Profil installieren, dann
  Einstellungen → Allgemein → Info → Zertifikatsvertrauen aktivieren).
- Die Vite-Konfiguration bekommt optional Zertifikatspfade per Umgebungsvariable (nur Dev,
  ändert nichts für alle anderen). Windows-Firewall: Port für das Heimnetz freigeben.
- API dazu mit `node api/server.js` (eigener `DATA_DIR` im Scratch-Ordner), oder Gastmodus.
- Echte Daten: auf der NAS **Einstellungen → Daten & Backup → Backup exportieren**, lokal
  **Backup importieren**. Die NAS-Daten selbst werden nicht angefasst.
- Kein Tunnel/öffentlicher Dienst: alles bleibt im Heimnetz.

Docker Desktop (aktuell nicht installiert) brauchen wir erst, wenn wir das fertige Image testen.

## Python-Replay: Zählen ohne App verstehen

`handoff/prototype/replay.py` liest eine Aufnahme, füttert den Zähler Sample für Sample wie live,
druckt jede erkannte Rep mit Zeitpunkt und am Schluss die Gesamtzahl. Optional in Echtzeit
(`--speed 1`), mit Abtastrate 100/60/30 Hz und einer Grafik: Signal, Schwellen, Zählzeitpunkte.
Eingabe zuerst Sensor Logger (CSV), später dieselbe Funktion für die Recorder-Dateien aus openGym.
Der Zähler selbst bleibt `repcounter.py`; `replay.py` ist nur das Drumherum.

Voraussetzung: Python 3 auf dem PC (aktuell nicht installiert) und die Sensor-Logger-Aufnahme
der Beinstreckung im Repo (z. B. `handoff/data/legext1/`).

Zum Simulieren ohne Gym reicht: Handy flach auf ein Buch, 1–2 s ruhig liegen lassen, dann das
Buch 20–40 cm hoch und runter. Ein gedruckter Schlitten hilft erst später beim Weg-%.

## Abnahme – wann „es geht“

### 1a Safari-PWA → erster PR

Tests (laufen in CI, beweisen es ohne Gym):
- [ ] `cd frontend && npm test` grün, inkl. `rep-counter.test.js` gegen die Golden Files
- [ ] Golden Files mit dem openGym-Recorder in Safari aufgenommen (nicht nur Sensor Logger):
      ≥ 3 Maschinen, 1 Satz bis Versagen
- [ ] In jeder Datei: Repzahl exakt, keine Rep beim Absetzen

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

## Review 2026-10-28: Änderungen vor dem Bauen

Ergebnis einer Durchsicht des Plans (Claude-Chat, mit Philipp abgestimmt). Diese Punkte gelten
vor den Abschnitten oben, wo sie sich widersprechen.

### 1. Hochheben des Handys am Satzende (Pflicht für Stufe 1)
Zum Abhaken nimmt man das Handy vom Stapel. Hochheben = erst Beschleunigung nach oben, dann
Abbremsen, also genau das Muster einer Rep. Das passiert bei **jedem** Satz, nicht nur
gelegentlich. Im ersten Datensatz (Leg Extension 55 kg) wurde zufällig nicht falsch gezählt,
darauf nicht verlassen.
- Erkennung ohne Gyro: Kippt die Richtung von `accelerationIncludingGravity` (tiefpassgefiltert)
  deutlich gegenüber der geschätzten Ruherichtung (Schwelle z. B. 15–20°, an Daten bestimmen),
  ist der Satz zu Ende.
- Eine angefangene oder in den letzten ~1 s vor dem Kippen gezählte Rep wird verworfen.
- Golden Files müssen das Hochheben am Ende enthalten; Test: keine zusätzliche Rep.

### 2. Ruheerkennung statt „1 s nach dem Tap“
Nach dem Tap auf den Sensor-Knopf wird das Handy erst hingelegt; die erste Sekunde ist also
gerade keine Ruhe. Der Prototyp (`repcounter.py`) nimmt stumpf die erste Sekunde, das ist im
Port zu ändern.
- Zustand „warte auf Ruhe“: erst wenn die Beschleunigung ~0,7 s lang stabil ist (Streuung des
  Betrags unter einer Schwelle, Richtung konstant), Schwerkraft aus genau diesem Fenster schätzen.
- Erst dann „bereit“ im HUD anzeigen.
- Dieselbe Ruheerkennung ist die Grundlage für den automatischen Satzstart in Stufe 2.

### 3. Feste Schwellen sind das größte Algorithmus-Risiko
Die Schwellen im Prototyp (1,2 m/s²) passen zu einem zügigen Satz Beinstrecken. Bei langsamem,
kontrolliertem Tempo (z. B. 3 s konzentrisch) sind die Beschleunigungen deutlich kleiner,
dann fehlen Reps.
- Datensammlung ergänzen: **mindestens ein bewusst langsamer Satz** (und wenn möglich einer mit
  leichtem Gewicht).
- Wahrscheinlich nötig: adaptive Schwellen (relativ zur Amplitude der ersten Rep / laufendes
  Maximum) oder Zählen auf einem bandpassgefilterten Positions- bzw. Geschwindigkeitssignal
  statt auf der Beschleunigung. Entscheidung anhand der Golden Files.

### 4. Datenformat für Stufe 1 schlank halten
In Teil D steht `sensor: { reps, partials: [0.45, 0.30], src: 'web', v: 1 }`. Teilreps kommen
aber erst in der Ausbaustufe 1b. Was einmal gespeichert ist, muss dauerhaft lesbar bleiben.
- Stufe 1 speichert nur `sensor: { reps, src: 'web', v: 1 }`.
- `partials`, Weg, Geschwindigkeit usw. kommen später als neue Felder dazu; `v` zeigt an,
  welche Felder es gibt.

### 5. HTTPS fürs Gym: GitHub Pages des Forks (ergänzt „Lokal testen“)
Der Vite-Dev-Server mit `mkcert` (Abschnitt „Lokal testen“) ist der richtige Weg für den schnellen
Entwicklungskreislauf zu Hause. **Im Gym ist er aber nicht erreichbar**: Er läuft nur im Heimnetz
und nur, solange der PC an ist. Für Aufnahmen im Gym braucht es eine HTTPS-Adresse, die von überall
geht. Dafür muss nicht auf die Synology gewartet werden.
- Der Fork hat `.github/workflows/pages.yml`, der das Demo-Build (`VITE_DEMO=1`) auf GitHub Pages
  veröffentlicht, bei jedem Push auf `main` mit Änderungen unter `frontend/**` oder manuell
  (`workflow_dispatch`).
- Einschalten: im Fork Settings → Pages → Source „GitHub Actions“, dann den Workflow einmal
  laufen lassen.
- Adresse dann `https://theflip97.github.io/openGym_Features/` (echtes HTTPS, DeviceMotion
  erlaubt, kein Zertifikat aufs iPhone nötig, über Mobilfunk erreichbar).
- Die Demo startet im Gastmodus mit Beispieldaten und hat kein Backend. Für den Recorder reicht
  das (kein Konto, kein Sync, Export als Datei).
- Wird auf einem Branch statt `main` entwickelt: `branches` im Workflow anpassen oder vor dem
  Gym-Test nach `main` mergen.
- Aufteilung also: **zu Hause** Vite + mkcert, **im Gym** GitHub Pages, **Abnahme 1a** (Sync,
  Export, Konto) auf der eigenen Instanz der NAS mit HTTPS.

### Angepasste Reihenfolge Schritt 1 (Recorder)
`motion-source.js` mit Ratenmessung und Lückenerkennung, Ruheerkennung (Punkt 2), Erkennung
„Handy hochgehoben“ (Punkt 1, im Recorder nur als Marker), Einstellungsschalter, Export als Datei.
Zu Hause mit Vite + mkcert entwickeln, im Gym über GitHub Pages aufnehmen: mehrere Maschinen, ein Satz bis Versagen, ein langsamer
Satz, jeweils inklusive Hochheben am Ende.

## Stand 2026-10-29: Zähler 2 (Weg statt Beschleunigung)

`handoff/prototype/repcounter2.py`, verglichen mit `replay.py` auf künstlichen Sätzen aus
`gen_synth.py` (18 Szenarien × 6 Zufallsvarianten × 100/60/30 Hz = 324 Läufe):
**neu 320/324 richtig, alt 72/324.** Echte Beinstreckung: beide 10/10.
- Ruheerkennung (0,7 s still, Schwerkraft per Median), Stoß-Filter (Median 0,1 s), Integration mit
  undichter Geschwindigkeit (2 s), Umkehrpunkte am Weg (1 cm bzw. 20 % des typischen Wegs),
  Rep ab 3 cm bzw. 35 % des typischen Wegs, Kipp-Erkennung > 20° = hochgehoben.
- Ergebnis kaum abhängig von `leak_s` (1–3 s), d. h. nicht auf einen Wert hingetrimmt.
- Rest-Fehler: sehr langsame UND kurze Reps (10 cm in 3 s) mit Klappern, vor allem bei 30 Hz.
- Offen: alles nur an künstlichen Daten gezeigt – echte Aufnahmen A–F entscheiden.

### Weg und Geschwindigkeit: wie gut geht es? (Messung an künstlichen Daten)
- **Mit den exakten Umkehrpunkten** (aus Truth.csv) liefert die Integration pro Rep (v = 0 unten und
  oben, Drift linear abziehen) den Weg auf **< 1 %** genau (40,0 statt 40 cm, 29,9 statt 30 cm).
  Die Physik reicht also; die Kunst sind die Umkehrpunkte.
- Mit den Umkehrpunkten, die der Zähler live findet: Weg 30–45 % daneben (das undichte
  Integrieren verschiebt sie, der Stoß-Filter verzögert um ~50 ms).
- Mit nachträglicher Verfeinerung pro Rep (Nulldurchgang der Geschwindigkeit zwischen den
  Nachbar-Umkehrpunkten, rohe Daten ohne Stoß-Filter): Weg ~10 % (Median), mittlere
  Geschwindigkeit 2–4 %, Spitzengeschwindigkeit ~5 % bei normalen Sätzen; kurze/langsame Reps und
  Pausen unten noch deutlich schlechter (Pausen: Umkehrpunkt im Stillstand nicht eindeutig).
- Folgerung: Zählen (live) und Vermessen (pro Rep, kurz nach der Rep) sind **zwei Stufen** mit
  verschiedenen Methoden. Die Vermessung braucht die Rohdaten der laufenden Rep (nur im
  Speicher, danach verworfen) und eine eigene Umkehrpunkt-Suche, Stillstand als ZUPT nutzen.
  Eigene Ausbaustufe, nicht Teil von Stufe 1.

### Abläufe, an die der Zähler denken muss
Start:
1. Handy hinlegen, dann Start tippen → Ruhe sofort da (der Tipp selbst ist ein kurzer Ruck, die
   0,7-s-Ruhe kommt danach).
2. Start tippen, dann hinlegen → `wait_rest` deckt das ab (getestet: Szenarien „echt“).
3. Start tippen, schon mitten in den Reps (keine Ruhe) → Zähler bleibt in `wait_rest` und zählt
   nie. **Lücke.** Ausweg: Schwerkraft aus dem Mittel über 2–3 s schätzen (Reps mitteln sich
   heraus), oder Hinweis „Handy kurz ruhig liegen lassen“.
4. Handy liegt nicht auf dem Stapel (Bank, Boden) → nie Bewegung → nach einigen Sekunden Hinweis.
Ende:
5. Aufstehen, Handy nehmen (häufigster Fall) → Kippung > 20° → Satz zu Ende, letzte Rep < 1 s
   zurückgenommen (getestet).
6. Handy gerade hochheben, ohne zu kippen → **Lücke**, Kipp-Erkennung greift nicht. Hilfen:
   Weg geht weit über den typischen oberen Punkt, danach Hand-Zittern statt Stille.
7. Fertig tippen, Handy bleibt liegen → Stapel unten, Ruhe; Tipp = kleiner Ruck (unter 3 cm).
8. Weggehen, Handy bleibt liegen → lange Ruhe unten → Satzende (Grundlage Auto-Stopp).
Während des Satzes:
9. Halten oben (isometrisch, Rest-Pause) → Stillstand OBEN ist kein Satzende; Satzende nur bei
   Stillstand UNTEN. Der Zähler kennt die Höhe, das ist unterscheidbar.
10. Gewicht umstecken mit Handy auf dem Stapel → Stöße, kein Weg ≥ 3 cm → keine Rep.
11. Handy rutscht/fällt → große Kippung → wie Hochheben.
12. Maschinen, bei denen der Stapel bei der Konzentrik sinkt (z. B. Unterstützung bei Klimmzügen/
    Dips) → Zählen gleich, aber konzentrisch/exzentrisch vertauscht – wichtig erst für
    Geschwindigkeit; dann pro Übung einstellbar oder aus dem Übungstyp.

### Auto-Start/Stopp (Stufe 2) – die Bausteine sind schon da
- Sensor hört während des ganzen Workouts mit (ein Tipp beim Trainingsstart für die iOS-Erlaubnis).
- **Satzstart** = erste Rep nach einer Ruhe bestätigt (z. B. ab 2 Reps, damit Umstecken/Anstoßen
  keinen Satz startet); Startzeit rückwirkend auf den unteren Umkehrpunkt vor Rep 1.
- **Satzende** = Handy hochgehoben ODER ≥ 3–4 s Stillstand unten nach ≥ 1 Rep.
- Pausentimer startet rückwirkend ab Ende der letzten Rep.
- Reps landen im nächsten offenen Satz; Korrektur per Hand bleibt immer möglich.

## Stand 2026-10-30: Weg und Geschwindigkeit, Verfahren im Vergleich

Werkzeuge (alles in `docs/rep-sensor`, Daten in `data/gen/`, nicht im Repo):
`gen_csv.py` (künstlicher Satz, Form nach der echten Beinstreckung: Buckel unten/oben,
Bremsbuckel, ruhiges Absenken, Zittern nur in Bewegung), `plot_csv.py`, `integrate_csv.mjs`,
`compare_methods.mjs` + `plot_methods.py`. openGym-Code: `frontend/src/lib/motion-integrate.js`,
`motion-filter.js` (mit Tests).

Befunde:
- Echter Satz: Gurt-Schwingung 9–10 Hz nur während der Bewegung (Stapel an elastischem Gurt).
- Einfaches Integrieren: exakt 0,2 cm, mit realistischem Zittern Meter Drift (echt: −1,85 m nach
  24 s). Tiefpass hilft gegen Drift nicht (Drift kommt aus dem langsamen Fehleranteil).
- Konstanter Messfehler wird über die Ruhe vor dem Satz bzw. pro Zyklus vollständig entfernt;
  das Problem ist das Zittern.
- Spitzen der Beschleunigung sind KEIN Stillstand: an der unteren Spitze fährt der Stapel schon
  mit 0,35–0,5 m/s. "v = 0 an der Spitze" ergibt Meter-Fehler.
- Mittel über 6 künstliche Sätze (Weg RMS / Hub je Rep / v-max je Rep / Zeitfehler Umkehrpunkt):
  roh 189 cm / 17 cm / 20 % / 51 ms; zyklus 2,9 cm / 2,3 cm / 4,8 % / 8 ms;
  kalman (live) 7,4 cm / 6,3 cm / 5,8 % / 17 ms, zählt falsch (Sprünge); kalman+ (nach dem Satz
  geglättet) 2,5 cm / 1,6 cm / 3,8 % / 11 ms.
- Interpolation zwischen Messwerten bringt beim Integrieren nichts (Fehler kommt nicht aus der
  Rechenregel), beim Zeitpunkt des Umkehrpunkts nur wenige ms.
- Empfehlung: Zyklus-Verfahren als Grundlage (zwei physikalische Tatsachen je Rep, einfach,
  erklärbar), Kalman+ nur falls später nötig.

## Entscheidung 2026-10-30: Umfang des ersten Studio-Tests

Ziel: Reps zählen, live und bequem. Die Zahl erhöht sich am oberen Umkehrpunkt (beim Absenken
derselben Rep), also bevor die nächste Rep beginnt.

**Jetzt (Schritt A, Sensor-Testseite `/sensor-test`, noch nicht im Workout):**
1. Start-Knopf (gleichzeitig die iOS-Erlaubnis). Reihenfolge egal: erst hinlegen dann Start, oder
   erst Start dann hinlegen – der Zähler wartet auf Ruhe und schätzt erst dann "oben".
2. Live-Zählung über das Buckel-Muster (unten +, oben −) der gefilterten senkrechten
   Beschleunigung, Schwellen relativ zum Rauschen in der Ruhe und zur Buckelhöhe des Satzes.
3. Satzende: Stopp-Knopf ODER Handy hochgenommen (Kippung > 20°); eine Rep kurz vor dem
   Hochnehmen wird zurückgenommen.
4. Große Zahl, Live-Graph, gemessene Rate, Export der Rohdaten als CSV (`t_s,ax,ay,az`).
5. Erreichbar über GitHub Pages des Forks (HTTPS, Mobilfunk).

**Danach (Schritt B, ins Workout):** Sensor-Knopf an der Satzzeile, gleicher Zähler; beim Abhaken
landet die Zahl im Rep-Feld (nie über eine Hand-Eingabe), `sensor: { v: 1, src, reps, sure }`.

**Später:** Start/Stopp-Automatik (Stufe 2) – baut auf genau diesem Zähler auf; erst wenn die
Zählung im Studio nachweislich stimmt. Lernen pro Übung (`sensorProfiles`, SPEICHERN.md).
Geschwindigkeit live (schneller/langsamer) und RIR/RPE aus Geschwindigkeit erst nach Abgleich
mit aktuellen Studien.

**Rohdaten-Format (überall gleich):** CSV `t_s,ax,ay,az`, Beschleunigung INKL. Schwerkraft in
m/s², so wie Safari sie liefert. Der Recorder exportiert es, `logger_to_raw.py` wandelt
Sensor-Logger-ZIPs um, `gen_csv.py` schreibt es zusätzlich.

## Oberflächen-Ideen für später (2026-10-30)

Ideen für eine eigene Oberfläche:
- Satzzeile bleibt wie gewohnt (Gewicht × Reps × Kennzahl), darunter ein Satz-Panel mit großer
  Rep-Zahl in der Mitte, links Volumen, rechts mittlere Geschwindigkeit.
- Pro Rep ein Balken (Geschwindigkeit), dazu eine Fortschrittsleiste mit einem Strich je Rep.
- Nach dem Satz: Vergleich mit dem letzten Satz (Gewicht, Reps, Anstrengung, kontrolliertes
  Absenken), höchste/mittlere Geschwindigkeit und Velocity Loss.
- Übungsansicht "Sensor": Bewegungsumfang pro Rep als Balken mit Durchschnitt, eine
  Ampel-Skala für die Anstrengung mit kurzem Text dazu, kontrolliertes Absenken pro Rep.

## Fahrplan (abgestimmt 2026-10-29)

1. **Testseite** (läuft, GitHub Pages): Aufnahmen im Gym sammeln, Zählung prüfen.
2. **Einbau ins Workout** (Sensor-Leiste unten, Einstellungen siehe unten), getestet in der Demo.
3. **Beta auf der NAS**: Docker-Images des Forks (Workflow "Publish Docker images" → ghcr.io des
   Forks) statt des Originals. Vorher Backup (Einstellungen → Daten & Backup → Backup
   exportieren + `./data` der NAS kopieren). Über längere Zeit mit echten Trainings testen.
4. **Andere Plattformen**: iOS-App (WKWebView: Erlaubnis-Dialog prüfen), Android-App (WebView,
   keine Erlaubnis nötig), dann Upstream (Discussion, PR).
5. Danach: gemeinsamer Durchgang durch den ganzen Code, Repo aufräumen; Start/Stopp-Automatik,
   Lernen pro Übung, Weg/Geschwindigkeit.

### Einstellungen für den Einbau
- Rep-Sensor ein/aus (Standard aus).
- Nach dem Satz:
  - **"Eintragen, dann Anstrengung fragen"** (Standard, wenn "Anstrengung pro Satz" an ist): Reps
    ins Feld, danach öffnet sich die RIR/RPE-Auswahl; die Auswahl hakt den Satz ab und startet die
    Pause – so wie openGym es heute schon macht (Workout.jsx, pickEffort).
  - "Eintragen und abhaken" (für alle ohne RIR).
  - "Nur eintragen" (abhaken von Hand).
  - "Erst fragen" (Übernehmen / Ändern).
- Eine selbst eingetippte Zahl wird nie überschrieben.

### Speichern: warum neue Felder später nichts durcheinanderbringen
- Jeder Wert hat einen **eigenen Namen** am Satz (`sensor.reps`, später `sensor.rom`,
  `sensor.vFirst` …). Gelesen wird immer **nach Namen**, nie nach Position. Fehlt ein Feld (ältere
  Sätze), heißt das "nicht gemessen" – die Auswertung lässt den Satz dafür weg und rechnet nie
  mit 0.
- `sensor.v` sagt, mit welcher Version gerechnet wurde. Ändert sich ein Verfahren so, dass Werte
  nicht mehr vergleichbar sind (z. B. Geschwindigkeit anders berechnet), steigt `v`, und
  Vergleiche nehmen nur Sätze mit gleicher Version bzw. rechnen um.
- Ein Test liest Beispielsätze jeder alten Version, damit nie etwas unlesbar wird.
- Bewusster Preis: Rohdaten werden nach dem Satz gelöscht. Neue Kennzahlen gibt es deshalb nur
  für Sätze ab ihrer Einführung, nicht rückwirkend (außer aus Debug-Aufnahmen).

## Ideen-Speicher (für später, 2026-10-30)

- **RIR/RPE automatisch** aus der Geschwindigkeit schätzen (Velocity Loss im Satz, Geschwindigkeit
  der letzten Rep im Vergleich zur Geschwindigkeit am Versagen pro Übung). Vorher aktuelle Studien
  prüfen; Vorschlag statt Zwang, von Hand änderbar.
- **Auto-Progression** mit Sensordaten: Gewicht/Reps für den nächsten Satz oder das nächste
  Training aus Geschwindigkeit und geschätztem RIR, angedockt an die vorhandene Progression
  (`lib/progression.js`). Fehlende Sensordaten blockieren nie (Anforderung 3).
- **Audio-Feedback beim Training**: kurze Ansagen oder Töne während des Satzes, z. B. "schneller",
  "langsamer absenken", "Kontrolle halten", Ton bei erreichter Velocity-Loss-Grenze oder Zielreps.
  Wie genau, noch offen (Töne vs. Sprache, was zählt als zu schnell/langsam).
- Laser-Abstandssensor am Eigenbau (Weg direkt, ohne Drift), mit Kalman zusammen mit der IMU.
- Oberfläche: siehe "Oberflächen-Ideen für später".
