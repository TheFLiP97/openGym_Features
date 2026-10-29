import { describe, it, expect } from 'vitest'
import { LowPass } from './motion-filter.js'

const grid = (seconds, hz) => Array.from({ length: Math.round(seconds * hz) + 1 }, (_, k) => k / hz)

// Amplitude of a sine of frequency f after the filter (measured over the last second).
const gainAt = (f, fc, hz = 60) => {
  const lp = new LowPass(fc)
  let peak = 0
  for (const t of grid(5, hz)) {
    const y = lp.step(t, Math.sin(2 * Math.PI * f * t))
    if (t > 4) peak = Math.max(peak, Math.abs(y))
  }
  return peak
}

describe('LowPass', () => {
  it('takes the first sample as it is and keeps a constant unchanged', () => {
    const lp = new LowPass(5)
    expect(lp.step(0, 2.5)).toBe(2.5)
    for (const t of grid(1, 60)) expect(lp.step(t, 2.5)).toBeCloseTo(2.5, 12)
  })

  it('reaches 63 % of a step after one time constant 1 / (2π·fc)', () => {
    const lp = new LowPass(5)
    lp.step(0, 0)
    const tau = 1 / (2 * Math.PI * 5)
    expect(lp.step(tau, 1)).toBeCloseTo(1 - Math.exp(-1), 9)
  })

  it('lets a rep-speed movement through and damps fast wiggles', () => {
    expect(gainAt(0.5, 5)).toBeGreaterThan(0.99)   // a rep takes ~2 s
    expect(gainAt(15, 5)).toBeLessThan(0.4)        // fast shaking
  })

  it('behaves the same at 30, 60 and 100 Hz', () => {
    const g = [30, 60, 100].map(hz => gainAt(2, 5, hz))
    expect(Math.max(...g) - Math.min(...g)).toBeLessThan(0.05)
  })
})
