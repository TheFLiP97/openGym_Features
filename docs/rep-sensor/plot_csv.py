"""Zeigt eine CSV als Grafik: entweder einen künstlichen Satz (gen_csv.py) oder Sensor Logger.

Aufruf (im Ordner docs/rep-sensor):
    py plot_csv.py data/gen/sinus_10reps_40cm_2.4s_60Hz_noise0.05.csv
    py plot_csv.py Accelerometer.csv                       Sensor-Logger-CSV
    py plot_csv.py LegExtension_55kg_10-....zip            Sensor-Logger-ZIP (wird nur gelesen)
    py plot_csv.py <datei> --von 4 --bis 11                nur ein Ausschnitt

Künstlicher Satz: drei Kurven untereinander – Weg, Geschwindigkeit, Beschleunigung (exakt und
verrauscht). Sensor Logger: nur die Beschleunigung, die es dort gibt (x, y, z und Betrag).

Braucht matplotlib:  py -m pip install matplotlib
"""
import argparse
import csv
import io
import math
import sys
import zipfile

import matplotlib.pyplot as plt


def read_rows(path):
    """CSV-Zeilen als Liste von dicts, dazu Gravity.csv falls vorhanden (nur aus einer ZIP).
    Aus einer ZIP wird Accelerometer.csv gelesen."""
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as z:
            def member(base):
                name = next((n for n in z.namelist() if n.split('/')[-1].lower() == base), None)
                if not name:
                    return None
                with z.open(name) as f:
                    return list(csv.DictReader(io.TextIOWrapper(f, encoding='utf-8-sig')))
            acc = member('accelerometer.csv')
            if acc is None:
                sys.exit(f'keine Accelerometer.csv in {path}')
            return acc, member('gravity.csv'), path
    with open(path, encoding='utf-8-sig', newline='') as f:
        return list(csv.DictReader(f)), None, path


def plot_generated(rows, title, xlim=None):
    col = lambda k: [float(r[k]) for r in rows]
    t = col('t_s')
    fig, (ax1, ax2, ax3) = plt.subplots(3, 1, figsize=(12, 8), sharex=True)
    ax1.plot(t, [x * 100 for x in col('pos_m')], color='tab:gray', label='echt')
    ax1.set_ylabel('Weg (cm)')
    ax2.plot(t, col('vel_m_s'), color='tab:green', label='echt')
    ax2.set_ylabel('Geschwindigkeit (m/s)')
    if 'pos_int_m' in rows[0]:                  # Ergebnis von integrate_csv.mjs dazu
        ax1.plot(t, [x * 100 for x in col('pos_int_m')], color='black', ls='--', lw=1, label='integriert (exakt)')
        ax1.plot(t, [x * 100 for x in col('pos_int_noisy_m')], color='tab:orange', lw=1, label='integriert (verrauscht)')
        ax2.plot(t, col('vel_int_m_s'), color='black', ls='--', lw=1, label='integriert (exakt)')
        ax2.plot(t, col('vel_int_noisy_m_s'), color='tab:orange', lw=1, label='integriert (verrauscht)')
        if 'pos_int_lp_m' in rows[0]:
            ax1.plot(t, [x * 100 for x in col('pos_int_lp_m')], color='tab:blue', lw=1, label='integriert (Tiefpass)')
            ax2.plot(t, col('vel_int_lp_m_s'), color='tab:blue', lw=1, label='integriert (Tiefpass)')
            ax3.plot(t, col('acc_lp_m_s2'), color='tab:blue', lw=1, label='nach Tiefpass')
        ax1.legend(loc='upper left', fontsize=8)
        ax2.legend(loc='upper left', fontsize=8)
    ax3.plot(t, col('acc_noisy_m_s2'), color='tab:orange', lw=0.8, label='verrauscht (das misst das Handy)')
    ax3.plot(t, col('acc_m_s2'), color='black', lw=1, label='exakt')
    ax3.set_ylabel('Beschleunigung (m/s²)')
    ax3.set_xlabel('Zeit (s)')
    ax3.legend(loc='upper right', fontsize=8)
    # Echte Umkehrpunkte (Geschwindigkeit wechselt das Vorzeichen) in allen drei Grafiken:
    # rot = oben (hoch -> runter), grün = unten (runter -> hoch)
    vel = col('vel_m_s')
    for i in range(1, len(vel)):
        if vel[i - 1] > 0 >= vel[i] or vel[i - 1] < 0 <= vel[i]:
            color = 'tab:red' if vel[i - 1] > 0 else 'tab:green'
            for ax in (ax1, ax2, ax3):
                ax.axvline(t[i], color=color, ls=':', lw=1)
    for ax in (ax1, ax2, ax3):
        ax.axhline(0, color='gray', lw=0.5)
        ax.grid(alpha=0.3)
        if xlim:
            ax.set_xlim(*xlim)
    ax1.set_title(title + '   (gepunktet: v = 0, rot oben, grün unten)')
    fig.tight_layout()
    plt.show()


def vertical(rows, grav):
    """Senkrechte Beschleunigung, + = hoch: Accelerometer auf die Schwerkraft-Richtung projiziert.
    Beim iPhone zeigen beide Vektoren mit umgekehrtem Vorzeichen, das hebt sich auf."""
    out = []
    for a, g in zip(rows, grav):
        gx, gy, gz = float(g['x']), float(g['y']), float(g['z'])
        n = math.sqrt(gx * gx + gy * gy + gz * gz)
        out.append((float(a['x']) * gx + float(a['y']) * gy + float(a['z']) * gz) / n)
    return out


def plot_logger(rows, grav, title, xlim=None):
    t = [float(r['seconds_elapsed']) for r in rows]
    xyz = {k: [float(r[k]) for r in rows] for k in ('x', 'y', 'z')}
    mag = [math.sqrt(a * a + b * b + c * c) for a, b, c in zip(xyz['x'], xyz['y'], xyz['z'])]
    if grav:                                    # ZIP mit Gravity.csv: senkrecht wie im Generator
        fig, (ax0, ax) = plt.subplots(2, 1, figsize=(12, 6), sharex=True)
        ax0.plot(t, vertical(rows, grav), color='tab:orange', lw=0.8)
        ax0.axhline(0, color='gray', lw=0.5)
        ax0.set_ylabel('senkrecht (m/s², + = hoch)')
        ax0.set_title(title)
        ax0.grid(alpha=0.3)
    else:
        fig, ax = plt.subplots(figsize=(12, 4))
        ax.set_title(title)
    for k, c in (('x', 'tab:red'), ('y', 'tab:green'), ('z', 'tab:blue')):
        ax.plot(t, xyz[k], color=c, lw=0.8, label=k)
    ax.plot(t, mag, color='black', lw=0.8, label='Betrag')
    ax.axhline(0, color='gray', lw=0.5)
    ax.set_ylabel('Beschleunigung (Einheit wie in der Datei)')
    ax.set_xlabel('Zeit (s)')
    ax.legend(loc='upper right', fontsize=8)
    ax.grid(alpha=0.3)
    if xlim:
        ax.set_xlim(*xlim)
    fig.tight_layout()
    plt.show()


def main():
    ap = argparse.ArgumentParser(description='CSV oder Sensor-Logger-ZIP als Grafik.')
    ap.add_argument('paths', nargs='+', help='eine oder mehrere Dateien')
    ap.add_argument('--von', type=float, help='Ausschnitt ab dieser Sekunde')
    ap.add_argument('--bis', type=float, help='Ausschnitt bis zu dieser Sekunde')
    args = ap.parse_args()
    xlim = (args.von, args.bis) if args.von is not None or args.bis is not None else None
    for path in args.paths:
        rows, grav, name = read_rows(path)
        if not rows:
            print(f'leer: {name}')
        elif 'pos_m' in rows[0]:
            plot_generated(rows, name, xlim)
        elif {'x', 'y', 'z', 'seconds_elapsed'} <= set(rows[0]):
            plot_logger(rows, grav, name, xlim)
        else:
            print(f'unbekannte Spalten in {name}: {list(rows[0])}')


if __name__ == '__main__':
    main()
