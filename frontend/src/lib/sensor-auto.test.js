import { describe, it, expect } from 'vitest'
import { AUTO, restAlmostOver, autoArmed, softEnded, resumed, graceOver } from './sensor-auto.js'
import { RepDetector } from './rep-detector.js'

// A phone flat on a stack moving through smooth legs [seconds, metres], with rest around them.
const stack = (legs, hz = 60) => {
  const out = []
  let t0 = 0
  for (const [T, d] of [[1.5, 0], ...legs]) {
    for (let k = 0; k < Math.round(T * hz); k++) {
      const t = t0 + k / hz
      const acc = d ? d * (Math.PI / T) ** 2 / 2 * Math.cos(Math.PI * (t - t0) / T) : 0
      out.push([t, 0, 0, -(9.81 + acc)])
    }
    t0 += T
  }
  return out
}
const reps = n => Array.from({ length: n }, () => [[0.9, 0.4], [1.1, -0.4]]).flat()

describe('sensor auto', () => {
  it('listens once most of the rest has run, or with no rest timer at all', () => {
    expect(restAlmostOver(null)).toBe(true)
    expect(restAlmostOver({ left: 100, total: 120 })).toBe(false)
    expect(restAlmostOver({ left: 40, total: 120 })).toBe(false)
    expect(restAlmostOver({ left: 36, total: 120 })).toBe(true)     // 70 % run
    expect(restAlmostOver({ left: 0, total: 120, ready: true })).toBe(true)
  })

  it('does not listen for a ticked row or one that already has a count', () => {
    expect(autoArmed({ w: 50, r: 10 }, null)).toBe(true)
    expect(autoArmed({ w: 50, r: 10, done: true }, null)).toBe(false)
    expect(autoArmed({ w: 50, r: 10, sensor: { reps: 9 } }, null)).toBe(false)
    expect(autoArmed({ w: 50, r: 10 }, { left: 90, total: 120 })).toBe(false)
  })

  it('ends a set softly after the rest, and sees a late rep after a breather', () => {
    const det = new RepDetector({ AUTO_STOP_S: 0 })   // the mode decides the end itself
    let soft = null, late = false
    for (const [t, x, y, z] of stack([...reps(5), [5, 0], ...reps(1), [3, 0]])) {
      det.step(t, x, y, z)
      if (!soft && softEnded(det, t)) soft = { t, moves: det.cands.length, reps: det.reps }
      if (soft && resumed(det, soft)) { late = true; soft = null }
    }
    expect(late).toBe(true)
    expect(det.state).toBe('ready')                     // never stopped by the detector itself
    expect(det.stop()).toBe(6)
  })

  it('closes a set after the grace time without a new rep', () => {
    expect(graceOver(20, { t: 10 })).toBe(false)
    expect(graceOver(10 + AUTO.GRACE_S, { t: 10 })).toBe(true)
  })
})
