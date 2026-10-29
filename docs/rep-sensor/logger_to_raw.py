"""Wandelt eine Sensor-Logger-ZIP in das Rohdaten-Format von openGym um.

Aufruf (im Ordner docs/rep-sensor):
    py logger_to_raw.py LegExtension_55kg_10-2026-10-22_13-16-18.zip
    py logger_to_raw.py <zip> --hz 60          auf ~60 Messwerte pro Sekunde ausdünnen (wie Safari)
    py logger_to_raw.py <zip> --out datei.csv

Rohdaten-Format (so liefert es auch Safari und so exportiert es die Sensor-Testseite):
    t_s, ax, ay, az      Zeit in s ab Start, Beschleunigung MIT Schwerkraft in m/s²

Sensor Logger speichert die Beschleunigung OHNE Schwerkraft (Accelerometer.csv) und die
Schwerkraft getrennt (Gravity.csv), beide in m/s². Zusammengezählt ergibt das, was Safari als
accelerationIncludingGravity liefert. Die ZIP wird nur gelesen.
"""
import argparse
import csv
import io
import os
import zipfile


def member(z, base):
    name = next((n for n in z.namelist() if n.split('/')[-1].lower() == base), None)
    if not name:
        raise SystemExit(f'{base} fehlt in der ZIP')
    with z.open(name) as f:
        return list(csv.DictReader(io.TextIOWrapper(f, encoding='utf-8-sig')))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('zip')
    ap.add_argument('--hz', type=float, help='ausdünnen auf so viele Messwerte pro Sekunde')
    ap.add_argument('--out')
    args = ap.parse_args()

    with zipfile.ZipFile(args.zip) as z:
        acc, grav = member(z, 'accelerometer.csv'), member(z, 'gravity.csv')
    rows, next_t = [], 0.0
    for a, g in zip(acc, grav):
        t = float(a['seconds_elapsed'])
        if args.hz and t < next_t - 1e-9:
            continue
        if args.hz:
            while next_t <= t + 1e-9:
                next_t += 1.0 / args.hz
        rows.append((t, *(float(a[k]) + float(g[k]) for k in ('x', 'y', 'z'))))

    t0 = rows[0][0]
    out = args.out or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'raw',
                                   os.path.splitext(os.path.basename(args.zip))[0]
                                   + (f'_{args.hz:g}Hz' if args.hz else '') + '.csv')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w', encoding='utf-8', newline='') as f:
        f.write('t_s,ax,ay,az\n')
        for t, x, y, zz in rows:
            f.write(f'{t - t0:.4f},{x:.5f},{y:.5f},{zz:.5f}\n')
    print(f'geschrieben: {out}  ({len(rows)} Zeilen)')


if __name__ == '__main__':
    main()
