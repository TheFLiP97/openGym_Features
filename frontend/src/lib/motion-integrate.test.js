import { describe, it, expect } from 'vitest'
import { Integrator } from './motion-integrate.js'

// Feeds samples a(t) at the given times and returns the last velocity and position.
const run = (times, accel) => {
  const it = new Integrator()
  let out = { v: 0, p: 0 }
  for (const t of times) out = it.step(t, accel(t))
  return out
}
const grid = (seconds, hz) => Array.from({ length: Math.round(seconds * hz) + 1 }, (_, k) => k / hz)

describe('Integrator', () => {
  it('starts at rest', () => {
    expect(new Integrator().step(0, 3)).toEqual({ v: 0, p: 0 })
  })

  it('is exact for a constant acceleration: v = a·t, p = a·t²/2', () => {
    const { v, p } = run(grid(2, 60), () => 1.5)
    expect(v).toBeCloseTo(3, 9)
    expect(p).toBeCloseTo(3, 9)
  })

  it('uses the real time between samples, not a fixed rate', () => {
    // Uneven steps like Safari's, still a constant acceleration: still exact.
    const times = [0, 0.01, 0.03, 0.04, 0.07, 0.1, 0.12, 0.16, 0.2]
    const { v, p } = run(times, () => 2)
    expect(v).toBeCloseTo(0.4, 9)
    expect(p).toBeCloseTo(0.04, 9)
  })

  it('brings a smooth up-and-down movement back to within a millimetre at 60 Hz', () => {
    // 40 cm up and back, 2.4 s per rep, 10 reps: p = 0.2·(1 − cos ωt), a = 0.2·ω²·cos ωt.
    // The sample at t = 0 already carries a = 0.2·ω², as the movement starts curved.
    const w = 2 * Math.PI / 2.4
    const times = grid(24, 60)
    const it = new Integrator()
    let worst = 0
    for (const t of times) {
      const { p } = it.step(t, 0.2 * w * w * Math.cos(w * t))
      worst = Math.max(worst, Math.abs(p - 0.2 * (1 - Math.cos(w * t))))
    }
    expect(worst).toBeLessThan(0.001)
  })

  it('turns a constant error in the acceleration into drift growing with t²/2', () => {
    // Standing still, but the sensor reads 0.02 m/s² too much: after 10 s the position is
    // 0.02 · 10² / 2 = 1 m off. This is why the raw integral cannot be used on its own.
    const { v, p } = run(grid(10, 60), () => 0.02)
    expect(v).toBeCloseTo(0.2, 9)
    expect(p).toBeCloseTo(1, 9)
  })
})
