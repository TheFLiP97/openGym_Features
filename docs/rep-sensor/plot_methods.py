"""Zeigt das Ergebnis von compare_methods.mjs: Weg, Geschwindigkeit, Beschleunigung untereinander.

Aufruf (im Ordner docs/rep-sensor):
    py plot_methods.py data/gen/<datei>.methods.csv
    py plot_methods.py data/gen/<datei>.methods.csv --von 1.5 --bis 10
    py plot_methods.py data/gen/<datei>.methods.csv --alle      auch "roh" und "spitzen"

Gepunktete Linien: echte Umkehrpunkte (v = 0), rot oben, grün unten.
Dreiecke in der Beschleunigung: die gefundenen Spitzen (▼ oben, ▲ unten).
"""
import argparse
import csv

import matplotlib.pyplot as plt

STYLE = {
    'roh':     dict(color='tab:gray', lw=0.8, ls='--'),
    'spitzen': dict(color='tab:brown', lw=0.8, ls='--'),
    'zyklus':  dict(color='tab:blue', lw=1.2),
    'kalman':  dict(color='tab:orange', lw=1.0),
    'kalman+': dict(color='tab:purple', lw=1.2),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('path')
    ap.add_argument('--von', type=float)
    ap.add_argument('--bis', type=float)
    ap.add_argument('--alle', action='store_true', help='auch roh und spitzen zeigen')
    args = ap.parse_args()

    rows = list(csv.DictReader(open(args.path, encoding='utf-8')))
    col = lambda k: [float(r[k]) for r in rows]
    t, p, v = col('t_s'), col('pos_m'), col('vel_m_s')
    shown = [m for m in STYLE if f'p_{m}' in rows[0] and (args.alle or m not in ('roh', 'spitzen'))]

    fig, (ax1, ax2, ax3) = plt.subplots(3, 1, figsize=(12, 9), sharex=True)
    ax1.plot(t, [x * 100 for x in p], color='black', lw=2, alpha=0.35, label='echt')
    ax2.plot(t, v, color='black', lw=2, alpha=0.35, label='echt')
    for m in shown:
        ax1.plot(t, [x * 100 for x in col(f'p_{m}')], label=m, **STYLE[m])
        ax2.plot(t, col(f'v_{m}'), label=m, **STYLE[m])
    ax3.plot(t, col('acc_noisy_m_s2'), color='tab:orange', lw=0.6, alpha=0.6, label='gemessen')
    ax3.plot(t, col('acc_lp_m_s2'), color='black', lw=1, label='Tiefpass 4 Hz (zum Spitzen-Finden)')
    a_lp = col('acc_lp_m_s2')
    for i, r in enumerate(rows):
        if r['top'] == '1':
            ax3.plot(t[i], a_lp[i], 'v', color='tab:red', ms=8)
        if r['bottom'] == '1':
            ax3.plot(t[i], a_lp[i], '^', color='tab:green', ms=8)
    for i in range(1, len(v)):
        if v[i - 1] > 0 >= v[i] or v[i - 1] < 0 <= v[i]:
            for ax in (ax1, ax2, ax3):
                ax.axvline(t[i], color='tab:red' if v[i - 1] > 0 else 'tab:green', ls=':', lw=1)

    ax1.set_ylim(min(p) * 100 - 15, max(p) * 100 + 15)       # nicht vom Ausreißer "roh" bestimmen
    ax2.set_ylim(min(v) - 0.3, max(v) + 0.3)
    ax1.set_ylabel('Weg (cm)')
    ax2.set_ylabel('Geschwindigkeit (m/s)')
    ax3.set_ylabel('Beschleunigung (m/s²)')
    ax3.set_xlabel('Zeit (s)')
    ax1.set_title(f'{args.path}   (gepunktet: echte Umkehrpunkte, ▼▲ gefundene Spitzen)')
    for ax in (ax1, ax2, ax3):
        ax.axhline(0, color='gray', lw=0.5)
        ax.grid(alpha=0.3)
        ax.legend(loc='upper right', fontsize=8)
        if args.von is not None or args.bis is not None:
            ax.set_xlim(args.von, args.bis)
    fig.tight_layout()
    plt.show()


if __name__ == '__main__':
    main()
