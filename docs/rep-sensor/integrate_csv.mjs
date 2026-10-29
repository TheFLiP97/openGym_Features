// Integriert die Beschleunigung einer gen_csv.py-Datei mit genau dem Code, den openGym
// verwendet (frontend/src/lib/motion-integrate.js und motion-filter.js), und schreibt das
// Ergebnis daneben.
//
// Aufruf (im Ordner docs/rep-sensor):
//   node integrate_csv.mjs data/gen/<datei>.csv            Tiefpass 5 Hz
//   node integrate_csv.mjs data/gen/<datei>.csv 2          Tiefpass 2 Hz
//
// Ergebnis: <name>.int.csv mit allen Spalten der Eingabe plus
//   vel_int_m_s, pos_int_m              aus der exakten Beschleunigung integriert
//   vel_int_noisy_m_s, pos_int_noisy_m  aus der verrauschten Beschleunigung integriert
//   acc_lp_m_s2                         verrauschte Beschleunigung nach dem Tiefpass
//   vel_int_lp_m_s, pos_int_lp_m        daraus integriert
// Danach zeigt plot_csv.py echten und integrierten Weg übereinander.
import { readFileSync, writeFileSync } from 'node:fs'
import { Integrator } from '../../frontend/src/lib/motion-integrate.js'
import { LowPass } from '../../frontend/src/lib/motion-filter.js'

const path = process.argv[2]
const fc = Number(process.argv[3] || 5)
if (!path) {
  console.log('Aufruf: node integrate_csv.mjs <datei.csv> [Tiefpass in Hz, Standard 5]')
  process.exit(1)
}

const lines = readFileSync(path, 'utf8').trim().split(/\r?\n/)
const head = lines[0].split(',')
const col = name => head.indexOf(name)
const rows = lines.slice(1).map(l => l.split(',').map(Number))

const exact = new Integrator()
const noisy = new Integrator()
const lp = new LowPass(fc)
const filtered = new Integrator()
const out = [head.concat('vel_int_m_s', 'pos_int_m', 'vel_int_noisy_m_s', 'pos_int_noisy_m',
  'acc_lp_m_s2', 'vel_int_lp_m_s', 'pos_int_lp_m').join(',')]
const worst = { exact: 0, noisy: 0, filtered: 0 }
for (const r of rows) {
  const t = r[col('t_s')]
  const truth = r[col('pos_m')]
  const e = exact.step(t, r[col('acc_m_s2')])
  const n = noisy.step(t, r[col('acc_noisy_m_s2')])
  const a = lp.step(t, r[col('acc_noisy_m_s2')])
  const f = filtered.step(t, a)
  worst.exact = Math.max(worst.exact, Math.abs(e.p - truth))
  worst.noisy = Math.max(worst.noisy, Math.abs(n.p - truth))
  worst.filtered = Math.max(worst.filtered, Math.abs(f.p - truth))
  out.push(r.concat(e.v, e.p, n.v, n.p, a, f.v, f.p).map(x => x.toFixed(6)).join(','))
}

const target = path.replace(/\.csv$/i, '') + '.int.csv'
writeFileSync(target, out.join('\n') + '\n')
const cm = x => (x * 100).toFixed(1).padStart(6) + ' cm'
const end = rows.at(-1)[col('pos_m')]
console.log(`geschrieben: ${target}`)
console.log(`                         Weg am Ende   größte Abweichung`)
console.log(`echt                    ${cm(end)}`)
console.log(`integriert, exakt       ${cm(exact.p)}   ${cm(worst.exact)}`)
console.log(`integriert, verrauscht  ${cm(noisy.p)}   ${cm(worst.noisy)}`)
console.log(`integriert, Tiefpass ${String(fc).padEnd(3)}${cm(filtered.p)}   ${cm(worst.filtered)}`)
