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
//   4. Bumps. Every rep shows the same pattern: a bump up at the bottom (the stack is stopped and
//      pushed up), then a bump down at the top (the stack is braked and let down). A rep is
//      counted when the bump down at the top is over, i.e. while the stack is being lowered.
//      Thresholds are relative, not fixed m/s²: never below a multiple of the noise measured at
//      rest, and as a share of the bumps seen so far in this set, since slow sets have small
//      bumps and fast sets big ones.
//   5. Lifted? If the phone tilts more than LIFT_DEG away from its resting position it has been
//      picked up: the set is over, and a rep counted just before is taken back (picking the phone
//      up looks like a rep: up, then braked).
import { LowPass } from './motion-filter.js'

export const P = {
  REST_S: 0.7,        // the phone must lie still this long (s)
  REST_STD: 0.015,    // "still": spread of the acceleration below 1.5 % of gravity
  FC: 4,              // low-pass cut-off (Hz)
  NOISE_K: 8,         // a bump must stand at least this many times above the resting noise
  FLOOR: 0.25,        // and never below this (m/s²)
  REL: 0.35,          // and at least this share of the bumps seen in this set
  TOP_WITHIN_S: 3,    // the bump down must follow the bump up within this time (s)
  MIN_REP_S: 0.6,     // two reps are at least this far apart (s)
  LIFT_DEG: 20,       // tilt beyond this = phone picked up
  LIFT_FC: 1.5,       // low-pass for the tilt (Hz)
  UNDO_S: 1.0,        // a rep counted this shortly before the pick-up is taken back (s)
  GAP_S: 0.25,        // a pause between samples longer than this makes the count unsure (s)
}

const median = xs => {
  const s = [...xs].sort((x, y) => x - y)
  const k = s.length >> 1
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2
}

export class RepDetector {
  constructor(params = {}) {
    this.p = { ...P, ...params }
    this.state = 'wait_rest'   // 'wait_rest' -> 'ready' -> 'lifted' (or stop())
    this.reps = 0
    this.sure = true           // false after a gap in the data
    this.buf = []              // while waiting for rest: the last REST_S of samples
    this.up = null             // unit vector "up" in the phone's axes
    this.g = 0                 // gravity as measured, in the input's units
    this.floor = this.p.FLOOR  // bump threshold from the noise at rest
    this.lp = new LowPass(this.p.FC)
    this.tiltLp = null
    this.phase = 'wait_up'     // 'wait_up' -> 'in_up' -> 'wait_down' -> 'in_down'
    this.upPeak = 0            // height of the current bump up
    this.upAt = 0              // when it was
    this.downPeak = 0          // depth of the current bump down
    this.bumps = []            // heights of the bumps up seen in this set
    this.repTimes = []
    this.lastT = null
    this.s = 0                 // last filtered vertical acceleration (for a graph)
    this.tilt = 0              // last tilt from rest in degrees
  }

  // Ends the set by hand (Stop button). Returns the final count.
  stop() {
    if (this.state !== 'lifted') this.state = 'stopped'
    return this.reps
  }

  // One sample: t in seconds, acceleration including gravity in any unit. Returns an event or
  // null: { type: 'ready' } once at rest, { type: 'rep', reps }, { type: 'lifted', reps, undone }.
  step(t, ax, ay, az) {
    const p = this.p
    if (this.lastT !== null && t - this.lastT > p.GAP_S && this.state === 'ready') this.sure = false
    const dt = this.lastT === null ? 0 : Math.max(0, t - this.lastT)
    this.lastT = t
    if (this.state === 'wait_rest') return this.waitRest(t, ax, ay, az)
    if (this.state !== 'ready') return null

    // 5. Lifted?
    const a = 1 - Math.exp(-2 * Math.PI * p.LIFT_FC * dt)
    const v = [ax, ay, az]
    for (let i = 0; i < 3; i++) this.tiltLp[i] += a * (v[i] - this.tiltLp[i])
    const len = Math.hypot(...this.tiltLp)
    const cos = (this.tiltLp[0] * this.up[0] + this.tiltLp[1] * this.up[1] + this.tiltLp[2] * this.up[2]) / len
    this.tilt = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI
    if (this.tilt > p.LIFT_DEG) {
      this.state = 'lifted'
      let undone = 0
      while (this.repTimes.length && t - this.repTimes.at(-1) < p.UNDO_S) { this.repTimes.pop(); this.reps--; undone++ }
      return { type: 'lifted', reps: this.reps, undone }
    }

    // 2. + 3. vertical, filtered
    const vert = ((ax * this.up[0] + ay * this.up[1] + az * this.up[2]) - this.g) / this.g * 9.81
    const s = this.s = this.lp.step(t, vert)

    // 4. Bumps
    const seen = this.bumps.length ? median(this.bumps.slice(-5)) : 0
    const upThr = Math.max(this.floor, p.REL * seen)
    if (this.phase === 'wait_up' || this.phase === 'wait_down') {
      if (s > upThr) { this.phase = 'in_up'; this.upPeak = s; this.upAt = t }
      // the bump down is measured against the bump up before it AND the bumps of this set, so the
      // small brake while lowering (≈1 m/s²) and a dip after it are not taken for a rep
      else if (this.phase === 'wait_down' && s < -Math.max(this.floor, p.REL * Math.max(this.upPeak, seen))) {
        this.phase = 'in_down'; this.downPeak = s
      } else if (this.phase === 'wait_down' && t - this.upAt > p.TOP_WITHIN_S) this.phase = 'wait_up'
    } else if (this.phase === 'in_up') {
      if (s > this.upPeak) { this.upPeak = s; this.upAt = t }
      if (s < 0) this.phase = 'wait_down'
    } else if (this.phase === 'in_down') {
      this.downPeak = Math.min(this.downPeak, s)
      if (s > this.downPeak / 2) {             // the bump down is over: the stack is on its way down
        this.phase = 'wait_up'
        if (!this.repTimes.length || t - this.repTimes.at(-1) >= p.MIN_REP_S) {
          this.bumps.push(this.upPeak)
          this.reps++
          this.repTimes.push(t)
          return { type: 'rep', reps: this.reps }
        }
      }
    }
    return null
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
    // noise at rest along "up", in m/s², sets the lowest bump threshold
    const vert = this.buf.map(x => ((x[1] * this.up[0] + x[2] * this.up[1] + x[3] * this.up[2]) - this.g) / this.g * 9.81)
    const vm = vert.reduce((s, x) => s + x, 0) / n
    const vs = Math.sqrt(vert.reduce((s, x) => s + (x - vm) ** 2, 0) / n)
    this.floor = Math.max(p.FLOOR, p.NOISE_K * vs)
    this.tiltLp = [...med]
    this.state = 'ready'
    this.buf = []
    return { type: 'ready' }
  }
}
