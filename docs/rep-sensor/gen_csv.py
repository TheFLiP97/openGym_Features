"""Erzeugt einen künstlichen Satz als CSV: Weg -> 2x abgeleitet -> Beschleunigung verrauscht.

Aufruf (im Ordner docs/rep-sensor):
    py gen_csv.py                              realistische Form, Werte wie unten
    py gen_csv.py --reps 8 --vc 0.5 --noise 0.05
    py gen_csv.py --form sinus                 die einfache Sinusform von vorher

Form "real" (Standard) – nachgebaut aus der echten Beinstreckung (LegExtension 55 kg × 10,
2026-10-22). Dort sieht jede Rep in der Beschleunigung so aus:
    unten   Buckel nach oben,  ~0,6 s, Spitze ~3 m/s²   Absenken stoppen + hochdrücken
    oben    Buckel nach unten, ~0,7 s, Spitze ~3,4 m/s² oben abbremsen + fallen lassen
    danach  kleiner Buckel,    ~0,35 s, Spitze ~1 m/s²  Absenken abbremsen
    dann    ruhiges Absenken mit fast gleicher Geschwindigkeit
Gebaut wird das über die GESCHWINDIGKEIT: sie wechselt in weichen Übergängen zwischen festen
Werten (hoch vc, nach dem Loslassen −ve1, beim Absenken −ve2). Jeder Übergang ist eine
"Smoothstep"-Kurve S(x) = 10x³ − 15x⁴ + 6x⁵: sie beginnt und endet ohne Ruck, also ohne Sprung in
der Beschleunigung. Weg, Geschwindigkeit und Beschleunigung sind exakte Formeln:
    Geschwindigkeit  v = v0 + Δv · S(x)                x = Anteil des Übergangs, 0..1
    Beschleunigung   a = Δv / T · S'(x)                S'(x) = 30x² − 60x³ + 30x⁴
    Weg              p = p0 + v0·T·x + Δv·T·(2,5x⁴ − 3x⁵ + x⁶)
Größte Beschleunigung eines Übergangs = 1,875 · Δv / T.
Die Dauer des ruhigen Absenkens wird pro Rep so berechnet, dass der Stapel genau wieder auf 0
landet. Jede Rep wird leicht zufällig verändert (Menschen sind nicht gleichmäßig).

Nur die Beschleunigung bekommt Rauschen, denn nur sie misst das Handy. Zwei Arten, beide am echten
Satz gemessen: ein feines Rauschen immer (in Ruhe 0,02 m/s²) und ein Zittern, nur solange sich der
Stapel bewegt (Seil, Rollen, Hand; im Satz ~0,25 m/s², eher langsam, deshalb gefiltert).

Spalten der CSV (Einheiten im Namen):
    t_s, pos_m, vel_m_s, acc_m_s2, acc_noisy_m_s2    senkrecht, + = hoch
    ax, ay, az                                       Rohdaten wie aus Safari: drei Achsen im
                                                     Handy MIT Schwerkraft (m/s²), daraus zählt
                                                     openGym
"""
import argparse
import math
import os
import random

# Standardwerte – alles an einem Ort. Gemessen an der echten Beinstreckung.
FS = 60.0          # Messwerte pro Sekunde (Safari liefert ~60)
REPS = 10          # Anzahl Wiederholungen
VC = 0.75          # Geschwindigkeit nach oben (m/s)
VE1 = 0.50         # Geschwindigkeit nach unten direkt nach dem Loslassen oben (m/s)
VE2 = 0.22         # Geschwindigkeit beim ruhigen Absenken (m/s); ergibt ~2,3 s pro Rep wie echt
T_START = 0.6      # Übergang Ruhe -> hoch beim ersten Rep (s)
T_BOTTOM = 0.6     # Übergang unten: runter -> hoch (s)
T_TOP = 0.7        # Übergang oben: hoch -> runter (s)
T_BRAKE = 0.35     # Abbremsen beim Absenken (s)
T_END = 0.4        # Übergang runter -> Ruhe nach der letzten Rep (s)
VARY = 0.10        # zufällige Abweichung je Rep, ±10 %
REST_START = 2.0   # Ruhe vor dem Satz (s)
REST_END = 2.0     # Ruhe nach dem Satz (s)
NOISE = 0.02       # Rauschen der Beschleunigung, Standardabweichung (m/s²); echte Ruhe: 0,020
SHAKE = 0.25       # Zittern, solange der Stapel sich bewegt (m/s²); echter Satz: 0,22 + 0,13
SHAKE_FC = 6.0     # wie schnell es zittert: Rauschen durch einen Tiefpass bei 6 Hz
BIAS = 0.0         # konstanter Messfehler (m/s²); Accelerometer.csv vom iPhone hatte in Ruhe 0,03
SEED = 1           # gleicher Startwert = jedes Mal dieselben Zufallszahlen
# nur für --form sinus
ROM = 0.40         # Weg einer Rep (m)
PERIOD = 2.4       # Dauer einer Rep (s)


# ---------------------------------------------------------------- Form "real"

def S(x):  return 10 * x**3 - 15 * x**4 + 6 * x**5
def dS(x): return 30 * x**2 - 60 * x**3 + 30 * x**4
def iS(x): return 2.5 * x**4 - 3 * x**5 + x**6          # Integral von S, iS(1) = 0,5


class Segment:
    """Abschnitt mit weichem Übergang der Geschwindigkeit von v0 auf v1 in T Sekunden."""

    def __init__(self, T, v0, v1):
        self.T, self.v0, self.dv = T, v0, v1 - v0

    def at(self, tau):                     # tau = Zeit seit Beginn des Abschnitts
        x = min(max(tau / self.T, 0.0), 1.0)
        return (self.v0 * tau + self.dv * self.T * iS(x),          # Weg seit Beginn
                self.v0 + self.dv * S(x),                         # Geschwindigkeit
                self.dv / self.T * dS(x))                         # Beschleunigung

    def distance(self):
        return self.at(self.T)[0]


def real_plan(reps, vc, ve1, ve2, vary, rnd):
    """Liste der Abschnitte für den ganzen Satz (ohne Ruhe davor/danach).

    Erst werden für jede Rep die Werte gewürfelt, dann gebaut – so passt der Übergang am Ende
    einer Rep genau zum Anfang der nächsten."""
    j = lambda x: x * (1 + rnd.uniform(-vary, vary))           # leichte Abweichung
    reps_v = [dict(up=j(vc), e1=j(ve1), e2=j(ve2), t_bottom=j(T_START if k == 0 else T_BOTTOM),
                   t_top=j(T_TOP), t_brake=j(T_BRAKE)) for k in range(reps)]
    t_end = j(T_END)

    # Die Übergänge unten: vor Rep k von −e2 (der vorigen Rep) auf +up; vor Rep 0 aus der Ruhe.
    bottoms = []
    for k, r in enumerate(reps_v):
        v_before = 0.0 if k == 0 else -reps_v[k - 1]['e2']
        bottoms.append(Segment(r['t_bottom'], v_before, r['up']))
    end = Segment(t_end, -reps_v[-1]['e2'], 0.0)

    # Weg eines Übergangs unten vor bzw. nach seinem tiefsten Punkt (dort ist v = 0)
    def split(seg):
        if seg.v0 >= 0:
            return 0.0, seg.distance()                 # aus der Ruhe: alles ist "nach oben"
        x0 = solve_zero(seg)
        down = seg.at(x0 * seg.T)[0]
        return down, seg.distance() - down

    segs = []
    for k, r in enumerate(reps_v):
        top = Segment(r['t_top'], r['up'], -r['e1'])         # oben: umkehren
        brake = Segment(r['t_brake'], -r['e1'], -r['e2'])    # Absenken abbremsen
        up_part = split(bottoms[k])[1]
        tail = split(bottoms[k + 1])[0] if k + 1 < reps else end.distance()
        # Von tiefstem Punkt zu tiefstem Punkt muss der Weg 0 ergeben; den Rest erledigt das
        # ruhige Absenken mit −e2: Dauer = übrig gebliebener Weg / e2.
        moved = up_part + top.distance() + brake.distance() + tail
        hold = max(0.0, moved / r['e2'])
        segs += [bottoms[k], top, brake]
        if hold > 0:
            segs.append(Segment(hold, -r['e2'], -r['e2']))
    segs.append(end)
    return segs


def solve_zero(seg):
    """Anteil x, bei dem die Geschwindigkeit im Übergang durch 0 geht."""
    lo, hi = 0.0, 1.0
    for _ in range(50):
        mid = (lo + hi) / 2
        if seg.v0 + seg.dv * S(mid) < 0:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


class Shake:
    """Zittern beim Bewegen: Zufallszahlen durch einen Tiefpass 1. Ordnung, so dass es eher
    langsam schwankt statt von Messwert zu Messwert zu springen. amp = Standardabweichung."""

    def __init__(self, rnd, amp, fc, fs):
        self.rnd, self.amp = rnd, amp
        self.alpha = 1 - math.exp(-2 * math.pi * fc / fs)
        self.gain = math.sqrt((2 - self.alpha) / self.alpha)   # gleicht den Tiefpass aus
        self.y = 0.0

    def __call__(self, moving):
        self.y += self.alpha * (self.rnd.gauss(0, self.amp * self.gain) - self.y)
        return self.y * moving                 # moving: 0 in Ruhe ... 1 in voller Bewegung


def noisy(rnd, shake, acc, vel, noise, bias):
    """Gemessene Beschleunigung: exakt + konstanter Fehler + feines Rauschen + Zittern."""
    moving = min(1.0, abs(vel) / 0.1)
    return acc + bias + rnd.gauss(0, noise) + shake(moving)


def generate_real(fs, reps, vc, ve1, ve2, vary, noise, shake_amp, bias, seed):
    rnd = random.Random(seed)
    shake = Shake(random.Random(seed + 1), shake_amp, SHAKE_FC, fs)
    segs = real_plan(reps, vc, ve1, ve2, vary, rnd)
    # Zeitachse: Ruhe, dann die Abschnitte nacheinander, dann Ruhe
    starts, t, p = [], REST_START, 0.0
    for s in segs:
        starts.append((t, p, s))
        t += s.T
        p += s.distance()
    t_total = t + REST_END
    rows, i = [], 0
    for k in range(int(round(t_total * fs)) + 1):
        tt = k / fs
        while i + 1 < len(starts) and tt >= starts[i + 1][0]:
            i += 1
        t0, p0, s = starts[i]
        if tt < REST_START or tt >= t_total - REST_END:
            pos, vel, acc = (0.0 if tt < REST_START else p), 0.0, 0.0
        else:
            d, vel, acc = s.at(tt - t0)
            pos = p0 + d
        rows.append((tt, pos, vel, acc, noisy(rnd, shake, acc, vel, noise, bias)))
    return rows


# ---------------------------------------------------------------- Form "sinus"

def generate_sinus(fs, reps, rom, period, noise, shake_amp, bias, seed):
    rnd = random.Random(seed)
    shake = Shake(random.Random(seed + 1), shake_amp, SHAKE_FC, fs)
    w = 2 * math.pi / period
    t_set = reps * period
    rows = []
    for k in range(int(round((REST_START + t_set + REST_END) * fs)) + 1):
        t = k / fs
        tau = t - REST_START
        if 0 <= tau <= t_set:
            p = rom / 2 * (1 - math.cos(w * tau))
            v = rom / 2 * w * math.sin(w * tau)
            a = rom / 2 * w * w * math.cos(w * tau)
        else:
            p = v = a = 0.0
        rows.append((t, p, v, a, noisy(rnd, shake, a, v, noise, bias)))
    return rows


# ---------------------------------------------------------------- Rohdaten wie aus Safari
#
# Safari liefert accelerationIncludingGravity: drei Achsen x, y, z im Handy, MIT Schwerkraft.
# Das Handy liegt fast flach (leicht gekippt um die x-Achse), "oben" zeigt im Handy nach
# (0, sin θ, cos θ). iPhone-Vorzeichen: in Ruhe flach z = −9,81, beim Beschleunigen nach oben
# wird es noch negativer. Dazu etwas Rauschen auf allen Achsen.

def raw_xyz(acc_up, rnd):
    s, c = raw_xyz.tilt
    f = -(9.81 + acc_up)
    return (rnd.gauss(0, 0.02), f * s + rnd.gauss(0, 0.02), f * c + rnd.gauss(0, 0.02))


raw_xyz.tilt = (0.0, 1.0)


# ----------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description='Künstlichen Satz als CSV erzeugen.')
    ap.add_argument('--form', choices=('real', 'sinus'), default='real')
    ap.add_argument('--fs', type=float, default=FS, help=f'Messwerte pro Sekunde ({FS})')
    ap.add_argument('--reps', type=int, default=REPS, help=f'Wiederholungen ({REPS})')
    ap.add_argument('--vc', type=float, default=VC, help=f'Geschwindigkeit hoch in m/s ({VC})')
    ap.add_argument('--ve1', type=float, default=VE1, help=f'Geschwindigkeit runter nach dem Loslassen ({VE1})')
    ap.add_argument('--ve2', type=float, default=VE2, help=f'Geschwindigkeit ruhiges Absenken ({VE2})')
    ap.add_argument('--vary', type=float, default=VARY, help=f'zufällige Abweichung je Rep ({VARY})')
    ap.add_argument('--rom', type=float, default=ROM, help=f'nur sinus: Weg pro Rep in m ({ROM})')
    ap.add_argument('--period', type=float, default=PERIOD, help=f'nur sinus: Dauer einer Rep in s ({PERIOD})')
    ap.add_argument('--noise', type=float, default=NOISE, help=f'Rauschen in m/s² ({NOISE})')
    ap.add_argument('--shake', type=float, default=SHAKE, help=f'Zittern beim Bewegen in m/s² ({SHAKE})')
    ap.add_argument('--bias', type=float, default=BIAS, help=f'konstanter Messfehler in m/s² ({BIAS})')
    ap.add_argument('--seed', type=int, default=SEED, help=f'Zufallsstartwert ({SEED})')
    ap.add_argument('--out', help='Dateiname (Standard: data/gen/<Werte>.csv)')
    args = ap.parse_args()

    if args.form == 'real':
        rows = generate_real(args.fs, args.reps, args.vc, args.ve1, args.ve2, args.vary,
                             args.noise, args.shake, args.bias, args.seed)
        name = f'real_{args.reps}reps_vc{args.vc:g}_{args.fs:g}Hz_noise{args.noise:g}_shake{args.shake:g}'
    else:
        rows = generate_sinus(args.fs, args.reps, args.rom, args.period, args.noise, args.shake,
                              args.bias, args.seed)
        name = (f'sinus_{args.reps}reps_{args.rom * 100:g}cm_{args.period:g}s_{args.fs:g}Hz'
                f'_noise{args.noise:g}_shake{args.shake:g}')
    if args.bias:
        name += f'_bias{args.bias:g}'
    raw_rnd = random.Random(args.seed + 2)
    tilt = math.radians(raw_rnd.uniform(-5, 5))
    raw_xyz.tilt = (math.sin(tilt), math.cos(tilt))

    out = args.out or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'gen', name + '.csv')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w', encoding='utf-8', newline='') as f:
        f.write('t_s,pos_m,vel_m_s,acc_m_s2,acc_noisy_m_s2,ax,ay,az\n')
        for r in rows:
            f.write(','.join(f'{x:.6f}' for x in r + raw_xyz(r[4], raw_rnd)) + '\n')
    top = max(r[1] for r in rows)
    print(f'geschrieben: {out}  ({len(rows)} Zeilen, {rows[-1][0]:.1f} s, höchster Punkt {top * 100:.0f} cm)')


if __name__ == '__main__':
    main()
