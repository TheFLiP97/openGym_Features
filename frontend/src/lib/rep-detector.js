// Rep sensor (docs/rep-sensor): counts reps live from the phone lying on a weight stack.
//
// Fed one sample at a time with the acceleration INCLUDING gravity, as Safari's devicemotion
// gives it (accelerationIncludingGravity, m/s²). Which way the phone lies and which sign
// convention the platform uses does not matter: "up" is taken from the phone at rest.
//
// What happens to each sample:
//   1. Wait for rest. Only once the phone has lain still for REST_S is gravity estimated (median of
//      that window, so a knock while laying it down does not tilt the estimate). Start first and
//      then lay the phone down, or the other way round: both work.
//   2. Vertical: project onto "up" and take gravity off -> vertical acceleration, + = up.
//   3. Low-pass at 4 Hz: takes out the 9–10 Hz shake of the stack on its rubber belt and the
//      sensor noise; a rep moves at well under 3 Hz.
//   4. Path. Integrate twice into velocity and position. Both are pulled gently back towards zero
//      (LEAK_V, TAU_P) so that small errors cannot pile up into drift; a rep is over long before
//      that pull matters. Counting on the path, not on the acceleration, is what makes slow and
//      fast sets alike: a 40 cm rep is 40 cm at any tempo, while its acceleration shrinks with the
//      square of the tempo (a slow assisted pull-up hardly shows in the acceleration at all).
//   5. Movements: every time the stack goes up at least MIN and half way back down, that is a
//      movement (a candidate). Its turning points are found on the path with a small hysteresis.
//   6. Live count: the movements that look like reps of this set, so far. With a profile from
//      earlier sets of this exercise: lift within the profile's band. Without: lift close to the
//      typical one of this set, and the start dropped while it does not fit the rhythm (getting
//      into the machine, preloading the lever). The live count may correct itself by one.
//   7. Final count, when the set ends (Stop, or the phone picked up). Every movement is cut out
//      from its own bottom to the next bottom, stretched to SHAPE_N points and scaled, so that
//      only its shape is left: the velocity of one rep. That shape is compared with the reference
//      shape of this exercise (from the profile, or for a first set from the middle of this set).
//      From the start, movements are dropped while they do not match (SHAPE_START); from the end
//      likewise, but leniently (SHAPE_END), since reps towards failure get slower and change
//      shape. In between, every movement counts whose lift lies in the band around the typical
//      lift (BAND). Measured on the gym recordings this got 14 of 18 sets exact, all but one
//      within one rep (docs/rep-sensor/STUFE1_PLAN.md).
//   8. Lifted? If the phone tilts more than LIFT_DEG away from its resting position it has been
//      picked up: the set is over.
//
// summary() hands what this set teaches about the exercise (typical lift, time per rep, shape) to
// lib/motion-profile.js, which keeps the profile.
import { LowPass } from './motion-filter.js'

export const P = {
  REST_S: 0.7,        // the phone must lie still this long (s)
  REST_STD: 0.015,    // "still": spread of the acceleration below 1.5 % of gravity
  FC: 4,              // low-pass cut-off (Hz)
  LEAK_V: 1.0,        // velocity is pulled back to zero with this time constant (s)
  TAU_P: 4,           // and the position with this one (s)
  HYS: 0.015,         // a turning point is found once the path has come back 1.5 cm
  MIN: 0.05,          // a movement lifts the stack at least 5 cm
  BAND: [0.6, 1.4],   // a rep lifts 60–140 % of the typical lift
  START_GAP: 1.5,     // live, without a profile: at the start the next rep within 1.5 × the typical gap
  SHAPE_N: 60,        // points a movement's shape is stretched to
  SHAPE_START: 0.7,   // from the start, drop movements whose shape matches less than this
  SHAPE_END: 0.4,     // from the end, less than this
  LIFT_DEG: 20,       // tilt beyond this = phone picked up
  LIFT_FC: 1.5,       // low-pass for the tilt (Hz)
  GAP_S: 0.25,        // a pause between samples longer than this makes the count unsure (s)
}

const median = xs => {
  const s = [...xs].sort((x, y) => x - y)
  const k = s.length >> 1
  return !s.length ? 0 : s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2
}

// Scales a list to mean 0 and spread 1, so that only its shape is left.
export function standardize(xs) {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length) || 1
  return xs.map(x => (x - m) / sd)
}

// How alike two standardized shapes are: 1 the same, 0 nothing in common, −1 mirrored.
export const similarity = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0) / a.length

export class RepDetector {
  constructor(params = {}, profile = null) {
    this.p = { ...P, ...params }
    this.profile = profile?.lift > 0 ? profile : null   // { lift, gap, shape } of this exercise
    this.state = 'wait_rest'   // 'wait_rest' -> 'ready' -> 'lifted' or 'stopped'
    this.reps = 0              // the count to show
    this.sure = true           // false after a gap in the data
    this.buf = []              // while waiting for rest: the last REST_S of samples
    this.up = null             // unit vector "up" in the phone's axes
    this.g = 0                 // gravity as measured, in the input's units
    this.lp = new LowPass(this.p.FC)
    this.tiltLp = null
    this.lastT = null
    this.s = 0                 // filtered vertical acceleration (m/s², for a graph)
    this.v = 0                 // velocity (m/s)
    this.pos = 0               // position (m), + = up; drifts back to 0 slowly
    this.tilt = 0              // tilt from rest in degrees
    this.trace = []            // [t, v, pos] of this set, for the shapes at the end (memory only)
    this.going = 1             // +1: looking for the top, -1: looking for the bottom
    this.hi = 0                // highest point since the last bottom
    this.lo = 0                // lowest point since the last top
    this.loT = 0               // when that lowest point was
    this.bottom = 0            // the last bottom
    this.bottoms = []          // times of all bottoms
    this.lift = 0              // lift of the current movement (bottom -> top)
    this.armed = false         // the current movement went high enough
    this.cands = []            // every movement: { t, lift, down }
    this.kept = []             // the movements that count
  }

  // Times of the reps that count (for a graph).
  get repTimes() { return this.kept.map(c => c.t) }

  // Ends the set by hand (Stop button). Returns the final count.
  stop() {
    if (this.state === 'ready' || this.state === 'wait_rest') this.state = 'stopped'
    this.finish()
    return this.reps
  }

  // One sample: t in seconds, acceleration including gravity in any unit. Returns an event or
  // null: { type: 'ready' } once at rest, { type: 'rep', reps } when the count goes up,
  // { type: 'adjust', reps } when it was corrected, { type: 'lifted', reps } when the phone
  // was picked up (the count is final then).
  step(t, ax, ay, az) {
    const p = this.p
    if (this.lastT !== null && t - this.lastT > p.GAP_S && this.state === 'ready') this.sure = false
    const dt = this.lastT === null ? 0 : Math.max(0, t - this.lastT)
    this.lastT = t
    if (this.state === 'wait_rest') return this.waitRest(t, ax, ay, az)
    if (this.state !== 'ready') return null

    // 8. Lifted?
    const a = 1 - Math.exp(-2 * Math.PI * p.LIFT_FC * dt)
    const v3 = [ax, ay, az]
    for (let i = 0; i < 3; i++) this.tiltLp[i] += a * (v3[i] - this.tiltLp[i])
    const len = Math.hypot(...this.tiltLp)
    const cos = (this.tiltLp[0] * this.up[0] + this.tiltLp[1] * this.up[1] + this.tiltLp[2] * this.up[2]) / len
    this.tilt = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI
    if (this.tilt > p.LIFT_DEG) {
      this.state = 'lifted'
      this.finish()
      return { type: 'lifted', reps: this.reps }
    }

    // 2. + 3. vertical, filtered
    const vert = ((ax * this.up[0] + ay * this.up[1] + az * this.up[2]) - this.g) / this.g * 9.81
    this.s = this.lp.step(t, vert)

    // 4. Path
    this.v += this.s * dt
    this.v -= this.v * dt / p.LEAK_V
    this.pos += this.v * dt
    this.pos -= this.pos * dt / p.TAU_P
    this.trace.push([t, this.v, this.pos])

    // 5. Turning points and movements
    if (this.going === 1) {
      this.hi = Math.max(this.hi, this.pos)
      if (this.pos < this.hi - p.HYS) {
        this.lift = this.hi - this.bottom
        this.armed = this.lift >= p.MIN
        this.going = -1
        this.lo = this.pos
        this.loT = t
      }
    } else {
      if (this.pos < this.lo) { this.lo = this.pos; this.loT = t }
      if (this.pos > this.lo + p.HYS) {
        const last = this.cands.at(-1)
        if (last && last.down == null) last.down = this.hi - this.lo
        this.bottoms.push(this.loT)
        this.armed = false
        this.bottom = this.lo
        this.going = 1
        this.hi = this.pos
      }
    }
    if (this.armed && this.going === -1 && this.hi - this.pos >= this.lift / 2) {
      this.armed = false
      this.cands.push({ t, lift: this.lift, down: null })
      // 6. live count
      const before = this.reps
      this.kept = this.liveKept()
      this.reps = this.kept.length
      if (this.reps > before) return { type: 'rep', reps: this.reps }
      if (this.reps < before) return { type: 'adjust', reps: this.reps }
    }
    return null
  }

  // The lift a movement stands for: up or down, whichever is larger (the first one starts from
  // the resting position, not from the bottom of a previous rep, and reads short going up).
  full(c) { return Math.max(c.lift, c.down || 0) }

  inBand(c, lift) { return this.full(c) >= this.p.BAND[0] * lift && this.full(c) <= this.p.BAND[1] * lift }

  // 6. Live: with a profile, every movement in its band; without, the typical lift of this set
  // decides, and the start is dropped while it does not keep the rhythm.
  liveKept() {
    const p = this.p
    if (this.profile) return this.cands.filter(c => this.inBand(c, this.profile.lift))
    const big = this.cands.filter(c => this.full(c) >= 0.5 * Math.max(...this.cands.map(x => this.full(x))))
    const lift = median(big.map(c => this.full(c)))
    const c = this.cands.filter(x => this.inBand(x, lift))
    let first = 0
    while (c.length - first >= 3) {
      const gap = median(c.slice(first + 1).map((x, i) => x.t - c[first + i].t))
      if (c[first + 1].t - c[first].t <= p.START_GAP * gap) break
      first++
    }
    return c.slice(first)
  }

  // A movement's shape: the velocity from the bottom before it to the bottom after it.
  shapeOf(c) {
    const n = this.p.SHAPE_N, tr = this.trace
    const before = this.bottoms.filter(b => b < c.t), after = this.bottoms.filter(b => b > c.t)
    // from the bottom before it, or later if the stack rested there first (a pause before the
    // first rep, between sets of a rest-pause): a rest is no part of the shape of a rep
    const t0 = Math.max(before.length ? before.at(-1) : -Infinity, this.startOf(c.t))
    const t1 = after.length ? after[0] : Math.min(tr.at(-1)[0], t0 + (c.t - t0) * 1.6)
    const out = []
    let j = 0
    for (let k = 0; k < n; k++) {
      const t = t0 + (t1 - t0) * k / (n - 1)
      while (j + 1 < tr.length && tr[j + 1][0] < t) j++
      const [ta, va] = tr[j], [tb, vb] = tr[Math.min(j + 1, tr.length - 1)]
      const w = tb > ta ? Math.max(0, Math.min(1, (t - ta) / (tb - ta))) : 0
      out.push(va + (vb - va) * w)
    }
    return { shape: standardize(out), dur: t1 - t0 }
  }

  // Where a movement begins when the stack rested at the bottom first: the last moment, before
  // it peaks, that the stack was still at its lowest point (within 5 mm). Known gap: after a long
  // pause the position wanders (it is pulled back to 0 slowly), and the start is found too early.
  startOf(t) {
    const tr = this.trace
    let i = tr.findIndex(x => x[0] >= t)
    if (i < 0) i = tr.length - 1
    let lo = i
    for (let j = i; j >= 0 && t - tr[j][0] < 4; j--) if (tr[j][2] < tr[lo][2]) lo = j
    let top = lo
    for (let j = lo; j <= i; j++) if (tr[j][2] > tr[top][2]) top = j
    let s = lo
    for (let j = lo; j < top; j++) if (tr[j][2] <= tr[lo][2] + 0.005) s = j
    return tr[s][0]
  }

  // 7. Final count.
  finish() {
    const p = this.p
    const last = this.cands.at(-1)
    if (last && last.down == null) last.down = this.hi - Math.min(this.lo, this.pos)
    const c = this.cands
    if (!c.length) { this.kept = []; this.reps = 0; return }
    for (const x of c) Object.assign(x, this.shapeOf(x))
    // reference: the profile's, or the middle of this set (not its first two and last movement)
    const mid = c.length >= 5 ? c.slice(2, -1) : c
    const ref = this.profile?.shape?.length === p.SHAPE_N ? this.profile.shape
      : standardize(Array.from({ length: p.SHAPE_N }, (_, k) => mid.reduce((s, x) => s + x.shape[k], 0) / mid.length))
    const lift = this.profile ? this.profile.lift : median(mid.map(x => this.full(x)))
    for (const x of c) x.match = similarity(x.shape, ref)
    let a = 0, b = c.length
    while (a < b && c[a].match < p.SHAPE_START) a++
    while (b > a && c[b - 1].match < p.SHAPE_END) b--
    this.kept = c.slice(a, b).filter(x => this.inBand(x, lift))
    this.reps = this.kept.length
  }

  // What this set teaches about the exercise, for lib/motion-profile.js: typical lift (m), time
  // per rep (s) and the mean shape of the reps that counted, leaving out the first and last.
  summary() {
    const k = this.kept.length >= 4 ? this.kept.slice(1, -1) : this.kept
    if (!k.length || !k[0].shape) return null
    return {
      lift: median(k.map(x => this.full(x))),
      gap: median(k.map(x => x.dur)),
      shape: standardize(Array.from({ length: this.p.SHAPE_N }, (_, i) => k.reduce((s, x) => s + x.shape[i], 0) / k.length)),
    }
  }

  // 1. Wait for rest
  waitRest(t, ax, ay, az) {
    const p = this.p
    this.buf.push([t, ax, ay, az])
    while (this.buf.length && t - this.buf[0][0] > p.REST_S) this.buf.shift()
    const n = this.buf.length
    if (n < 3 || t - this.buf[0][0] < p.REST_S * 0.95) return null
    const mean = [1, 2, 3].map(i => this.buf.reduce((s, x) => s + x[i], 0) / n)
    const spread = Math.sqrt([1, 2, 3].reduce((s, i) => s + this.buf.reduce((q, x) => q + (x[i] - mean[i - 1]) ** 2, 0) / n, 0))
    const g = Math.hypot(...mean)
    if (!(g > 0) || spread / g >= p.REST_STD) return null
    const med = [1, 2, 3].map(i => median(this.buf.map(x => x[i])))
    this.g = Math.hypot(...med)
    this.up = med.map(x => x / this.g)
    this.tiltLp = [...med]
    this.state = 'ready'
    this.buf = []
    return { type: 'ready' }
  }
}
