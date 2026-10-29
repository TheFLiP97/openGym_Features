// Vergleicht Verfahren, aus der gemessenen Beschleunigung Geschwindigkeit und Weg zu bekommen,
// an einem künstlichen Satz aus gen_csv.py (dort ist die Wahrheit bekannt).
//
// Aufruf (im Ordner docs/rep-sensor):
//   node compare_methods.mjs data/gen/<datei>.csv
// Ergebnis: Tabelle in der Konsole und <name>.methods.csv für plot_methods.py.
//
// Die Verfahren:
//   roh     einfach integrieren (Bias aus der Ruhe vor dem Satz abgezogen)
//   spitzen an jeder Spitze der Beschleunigung v = 0 annehmen, dazwischen Drift linear abziehen
//   zyklus  Satz an den unteren Spitzen in Zyklen teilen. Zwei Tatsachen je Zyklus:
//             1. an derselben Stelle der Bewegung ist die Geschwindigkeit gleich -> Bias
//             2. der Stapel kommt wieder auf dieselbe Höhe -> Anfangsgeschwindigkeit
//           Damit braucht es keinen exakten Stillstandspunkt.
//   kalman  Kalman-Filter mit Zustand (Weg, Geschwindigkeit, Bias), live Messwert für Messwert.
//           Messungen: "v = 0" wenn das Handy ruhig ist, "Weg wie beim ersten Mal" an jeder
//           unteren Spitze.
//   kalman+ derselbe Filter, nach dem Satz rückwärts geglättet (RTS-Glätter): nutzt auch
//           spätere Messungen, geht also erst nach dem Satz.
//
// Umkehrpunkte (v = 0) werden aus der korrigierten Geschwindigkeit bestimmt, einmal nur auf
// Messwerte genau (alle ~17 ms) und einmal zwischen zwei Messwerten linear interpoliert.
import { readFileSync, writeFileSync } from 'node:fs'
import { Integrator } from '../../frontend/src/lib/motion-integrate.js'
import { LowPass } from '../../frontend/src/lib/motion-filter.js'

const path = process.argv[2]
if (!path) {
  console.log('Aufruf: node compare_methods.mjs <datei.csv>')
  process.exit(1)
}
const lines = readFileSync(path, 'utf8').trim().split(/\r?\n/)
const head = lines[0].split(',')
const rows = lines.slice(1).map(l => l.split(',').map(Number))
const get = name => rows.map(r => r[head.indexOf(name)])
const t = get('t_s'), a = get('acc_noisy_m_s2'), pTrue = get('pos_m'), vTrue = get('vel_m_s')
const n = t.length

// ---------------------------------------------------------------- Ruhe vor dem Satz, Spitzen
const REST_S = 1.5                                   // die ersten 1,5 s liegt das Handy still
const restIdx = t.findIndex(x => x >= REST_S)
const b0 = a.slice(0, restIdx).reduce((s, x) => s + x, 0) / restIdx   // Bias aus der Ruhe

// Spitzen in der gefilterten Beschleunigung (4 Hz: entfernt die 9-10-Hz-Gurtschwingung).
const lp = new LowPass(4)
const aLp = t.map((x, i) => lp.step(x, a[i]))
const tops = []                                      // tiefste Stelle jedes großen Buckels nach unten
for (let i = 1; i < n - 1; i++) {
  if (aLp[i] < -1.5 && aLp[i] <= aLp[i - 1] && aLp[i] < aLp[i + 1]) {
    if (tops.length && t[i] - t[tops.at(-1)] < 0.8) { if (aLp[i] < aLp[tops.at(-1)]) tops[tops.length - 1] = i }
    else tops.push(i)
  }
}
const bottoms = []                                   // höchste Stelle vor jedem oberen Buckel
for (const k of tops) {
  let best = -1
  for (let i = k; i >= 0 && t[k] - t[i] < 1.2; i--) if (best < 0 || aLp[i] > aLp[best]) best = i
  if (best >= 0 && aLp[best] > 0.8) bottoms.push(best)
}

// ---------------------------------------------------------------- Hilfen zum Integrieren
// Integriert a − b von i0 bis i1 mit Startwerten (p0, v0). Gibt Arrays für den Abschnitt zurück.
function integrate(i0, i1, p0, v0, b) {
  const ig = new Integrator()
  const P = [], V = []
  for (let i = i0; i <= i1; i++) {
    const s = ig.step(t[i], a[i] - b)
    P.push(p0 + v0 * (t[i] - t[i0]) + s.p)
    V.push(v0 + s.v)
  }
  return { P, V }
}

// ---------------------------------------------------------------- roh
function raw() {
  const { P, V } = integrate(0, n - 1, 0, 0, b0)
  return { p: P, v: V }
}

// ---------------------------------------------------------------- spitzen
function peaks() {
  const marks = [...new Set([restIdx, ...tops, ...bottoms, n - 1])].sort((x, y) => x - y)
  const p = new Array(n).fill(0), v = new Array(n).fill(0)
  let pos = 0
  for (let k = 0; k + 1 < marks.length; k++) {
    const i0 = marks[k], i1 = marks[k + 1]
    const T = t[i1] - t[i0]
    const A = integrate(i0, i1, 0, 0, 0)            // ohne Korrektur
    const b = A.V.at(-1) / T                         // so viel Bias, dass v am Ende wieder 0 ist
    const { P, V } = integrate(i0, i1, pos, 0, b)
    for (let j = 0; j < P.length; j++) { p[i0 + j] = P[j]; v[i0 + j] = V[j] }
    pos = P.at(-1)
  }
  return { p, v }
}

// ---------------------------------------------------------------- zyklus
function cycle() {
  const p = new Array(n).fill(0), v = new Array(n).fill(0)
  if (!bottoms.length) return raw()
  // Erster Abschnitt: aus der Ruhe (v = 0, Weg 0) bis zur ersten unteren Spitze, Bias aus der Ruhe.
  let seg = integrate(restIdx, bottoms[0], 0, 0, b0)
  seg.P.forEach((x, j) => { p[restIdx + j] = x; v[restIdx + j] = seg.V[j] })
  const pRef = seg.P.at(-1)                          // Höhe an der unteren Spitze
  // Mittlere Zyklen: v(Ende) = v(Anfang) und Weg(Ende) = Weg(Anfang)
  for (let k = 0; k + 1 < bottoms.length; k++) {
    const i0 = bottoms[k], i1 = bottoms[k + 1], T = t[i1] - t[i0]
    const A = integrate(i0, i1, 0, 0, 0)
    const b = A.V.at(-1) / T                         // 1. gleiche Geschwindigkeit -> Bias
    const intA = A.P.at(-1)                          // ∫∫a über den Zyklus
    const v0 = (b * T * T / 2 - intA) / T            // 2. gleiche Höhe -> Anfangsgeschwindigkeit
    seg = integrate(i0, i1, pRef, v0, b)
    seg.P.forEach((x, j) => { p[i0 + j] = x; v[i0 + j] = seg.V[j] })
  }
  // Letzter Abschnitt: bis zum Ende der Aufnahme, dort ist v = 0 und Weg 0 (Stapel liegt unten).
  const i0 = bottoms.at(-1), i1 = n - 1, T = t[i1] - t[i0]
  const A = integrate(i0, i1, 0, 0, 0)
  // Am Ende: v = 0 und Weg = 0. Mit Av = ∫a und Ap = ∫∫a über den Abschnitt:
  //   (1) v0 + Av − b·T = 0              ->  v0 = b·T − Av
  //   (2) pRef + v0·T + Ap − b·T²/2 = 0  ->  (1) einsetzen: b = 2·(Av·T − Ap − pRef) / T²
  const Av = A.V.at(-1), Ap = A.P.at(-1)
  const b = 2 * (Av * T - Ap - pRef) / (T * T)
  const v0 = b * T - Av
  seg = integrate(i0, i1, pRef, v0, b)
  seg.P.forEach((x, j) => { p[i0 + j] = x; v[i0 + j] = seg.V[j] })
  return { p, v }
}

// ---------------------------------------------------------------- kalman (+ Glätter)
// Zustand x = [Weg, Geschwindigkeit, Bias]. Vorhersage mit der gemessenen Beschleunigung:
//   Weg += v·dt + (a − Bias)·dt²/2,  v += (a − Bias)·dt,  Bias bleibt (darf langsam wandern)
const mul = (A, B) => A.map(r => B[0].map((_, j) => r.reduce((s, x, k) => s + x * B[k][j], 0)))
const tr = A => A[0].map((_, j) => A.map(r => r[j]))
const add = (A, B) => A.map((r, i) => r.map((x, j) => x + B[i][j]))
const sub = (A, B) => A.map((r, i) => r.map((x, j) => x - B[i][j]))
const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
function inv3(m) {
  const [[a1, b1, c1], [a2, b2, c2], [a3, b3, c3]] = m
  const d = a1 * (b2 * c3 - b3 * c2) - b1 * (a2 * c3 - a3 * c2) + c1 * (a2 * b3 - a3 * b2)
  return [[(b2 * c3 - b3 * c2) / d, (c1 * b3 - b1 * c3) / d, (b1 * c2 - c1 * b2) / d],
    [(c2 * a3 - a2 * c3) / d, (a1 * c3 - c1 * a3) / d, (c1 * a2 - a1 * c2) / d],
    [(a2 * b3 - b2 * a3) / d, (b1 * a3 - a1 * b3) / d, (a1 * b2 - b1 * a2) / d]]
}
function kalman() {
  const SA = 0.3        // wie unsicher die gemessene Beschleunigung ist (m/s²): Zittern + Rauschen
  const SB = 0.002      // wie schnell der Bias wandern darf (m/s² pro √s)
  const RV = 0.01       // "v = 0 in Ruhe" stimmt auf ±1 cm/s
  const RP = 0.02       // "Weg wie beim ersten Mal" an der unteren Spitze stimmt auf ±2 cm
  // Ruhe erkennen: Gurt schwingt nur in Bewegung, also kleine Streuung = Ruhe
  const quiet = t.map((_, i) => {
    let s = 0, s2 = 0, m = 0
    for (let j = i; j >= 0 && t[i] - t[j] < 0.3; j--) { s += a[j]; s2 += a[j] * a[j]; m++ }
    return m > 5 && Math.sqrt(Math.max(0, s2 / m - (s / m) ** 2)) < 0.06
  })
  const isBottom = new Set(bottoms)
  let x = [[0], [0], [b0]], P = [[1e-6, 0, 0], [0, 1e-6, 0], [0, 0, 0.05 ** 2]]
  let pRef = null
  const xs = [], Ps = [], xp = [], Pp = [], Fs = []
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const dt = t[i] - t[i - 1]
      const F = [[1, dt, -dt * dt / 2], [0, 1, -dt], [0, 0, 1]]
      const u = [[a[i - 1] * dt * dt / 2], [a[i - 1] * dt], [0]]
      const Q = [[SA ** 2 * dt ** 4 / 4, SA ** 2 * dt ** 3 / 2, 0], [SA ** 2 * dt ** 3 / 2, SA ** 2 * dt ** 2, 0], [0, 0, SB ** 2 * dt]]
      x = add(mul(F, x), u)
      P = add(mul(mul(F, P), tr(F)), Q)
      Fs.push(F)
    }
    xp.push(x); Pp.push(P)
    const update = (H, z, R) => {
      const S = mul(mul([H], P), tr([H]))[0][0] + R * R
      const K = mul(P, tr([H])).map(r => [r[0] / S])
      const y = z - mul([H], x)[0][0]
      x = add(x, K.map(r => [r[0] * y]))
      P = mul(sub(I3, mul(K, [H])), P)
    }
    if (quiet[i]) update([0, 1, 0], 0, RV)
    if (isBottom.has(i)) {
      if (pRef === null) pRef = x[0][0]
      else update([1, 0, 0], pRef, RP)
    }
    xs.push(x); Ps.push(P)
  }
  const live = { p: xs.map(s => s[0][0]), v: xs.map(s => s[1][0]) }
  // RTS-Glätter: von hinten nach vorne
  const sm = new Array(n)
  sm[n - 1] = xs[n - 1]
  let Psm = Ps[n - 1]
  for (let i = n - 2; i >= 0; i--) {
    const C = mul(mul(Ps[i], tr(Fs[i])), inv3(Pp[i + 1]))
    sm[i] = add(xs[i], mul(C, sub(sm[i + 1], xp[i + 1])))
    Psm = add(Ps[i], mul(mul(C, sub(Psm, Pp[i + 1])), tr(C)))
  }
  return [live, { p: sm.map(s => s[0][0]), v: sm.map(s => s[1][0]) }]
}

// ---------------------------------------------------------------- auswerten
// Obere Umkehrpunkte: v geht von + nach −. interp = zwischen zwei Messwerten interpolieren.
function topsOf(v, interp) {
  const out = []
  for (let i = 1; i < n; i++) {
    if (v[i - 1] > 0 && v[i] <= 0) {
      out.push(interp ? t[i - 1] + (t[i] - t[i - 1]) * v[i - 1] / (v[i - 1] - v[i]) : t[i])
    }
  }
  return out
}
const trueTops = topsOf(vTrue, true)
const inSet = i => t[i] >= REST_S && t[i] <= t[n - 1]

function score(name, m) {
  let se = 0, cnt = 0, worst = 0
  for (let i = 0; i < n; i++) if (inSet(i)) { const e = m.p[i] - pTrue[i]; se += e * e; cnt++; worst = Math.max(worst, Math.abs(e)) }
  // Reps: obere Umkehrpunkte, vor denen der Weg mindestens 5 cm gestiegen ist
  const found = topsOf(m.v, true).filter(tt => {
    const i = t.findIndex(x => x >= tt)
    let lo = m.p[i]
    for (let j = i; j >= 0 && t[i] - t[j] < 3; j--) lo = Math.min(lo, m.p[j])
    return m.p[i] - lo > 0.05
  })
  const timing = interp => {
    const ts = topsOf(m.v, interp), errs = []
    for (const tt of trueTops) {
      const near = ts.reduce((best, x) => Math.abs(x - tt) < Math.abs(best - tt) ? x : best, Infinity)
      if (Math.abs(near - tt) < 0.3) errs.push(Math.abs(near - tt) * 1000)
    }
    return errs.length ? errs.reduce((s, x) => s + x, 0) / errs.length : NaN
  }
  // Höhe oben je Rep und höchste Geschwindigkeit nach oben je Rep, verglichen mit der Wahrheit
  let hErr = 0, vErr = 0, k = 0
  for (const tt of trueTops) {
    const i = t.findIndex(x => x >= tt)
    let vMaxTrue = 0, vMax = 0
    for (let j = i; j >= 0 && tt - t[j] < 1.2; j--) { vMaxTrue = Math.max(vMaxTrue, vTrue[j]); vMax = Math.max(vMax, m.v[j]) }
    let lo = Infinity, loT = Infinity
    for (let j = i; j >= 0 && tt - t[j] < 2.5; j--) { lo = Math.min(lo, m.p[j]); loT = Math.min(loT, pTrue[j]) }
    hErr += Math.abs((m.p[i] - lo) - (pTrue[i] - loT)); vErr += Math.abs(vMax - vMaxTrue) / vMaxTrue; k++
  }
  return { name, rms: Math.sqrt(se / cnt), worst, reps: found.length, hub: hErr / k, vmax: vErr / k,
    tRaw: timing(false), tInt: timing(true) }
}

const [kal, kalS] = kalman()
const methods = { roh: raw(), spitzen: peaks(), zyklus: cycle(), kalman: kal, 'kalman+': kalS }
const res = Object.entries(methods).map(([k, m]) => score(k, m))
const f1 = (x, d = 1) => Number.isFinite(x) ? x.toFixed(d) : '–'
console.log(`${trueTops.length} echte Reps, ${tops.length} obere / ${bottoms.length} untere Spitzen gefunden\n`)
console.log('Verfahren   Weg-Fehler    größter   Reps   Hub-Fehler  v-max-Fehler  Umkehrpunkt-Zeitfehler')
console.log('            (RMS, cm)     (cm)             je Rep (cm)  je Rep (%)   Messwert / interpoliert (ms)')
for (const r of res) {
  console.log(`${r.name.padEnd(10)}  ${f1(r.rms * 100).padStart(8)}  ${f1(r.worst * 100).padStart(9)}  ${String(r.reps).padStart(5)}` +
    `  ${f1(r.hub * 100).padStart(10)}  ${f1(r.vmax * 100).padStart(11)}  ${f1(r.tRaw, 0).padStart(9)} / ${f1(r.tInt, 0)}`)
}

// Für die Grafik
const outHead = ['t_s', 'pos_m', 'vel_m_s', 'acc_noisy_m_s2', 'acc_lp_m_s2', 'top', 'bottom']
for (const k of Object.keys(methods)) outHead.push(`p_${k}`, `v_${k}`)
const topSet = new Set(tops), botSet = new Set(bottoms)
const out = [outHead.join(',')]
for (let i = 0; i < n; i++) {
  const r = [t[i], pTrue[i], vTrue[i], a[i], aLp[i], topSet.has(i) ? 1 : 0, botSet.has(i) ? 1 : 0]
  for (const m of Object.values(methods)) r.push(m.p[i], m.v[i])
  out.push(r.map(x => typeof x === 'number' ? +x.toFixed(6) : x).join(','))
}
const target = path.replace(/(\.int)?\.csv$/i, '') + '.methods.csv'
writeFileSync(target, out.join('\n') + '\n')
console.log(`\ngeschrieben: ${target}`)
