import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { RepDetector } from './rep-detector.js'

// Raw recordings in the format Safari delivers and the sensor test page exports:
// t_s, ax, ay, az (acceleration including gravity, m/s²).
const load = name => {
  const [head, ...lines] = readFileSync(new URL(`./fixtures/rep-sensor/${name}`, import.meta.url), 'utf8').trim().split(/\r?\n/)
  const cols = head.split(',')
  const at = k => cols.indexOf(k)
  return lines.map(l => l.split(',').map(Number)).map(r => [r[at('t_s')], r[at('ax')], r[at('ay')], r[at('az')]])
}

const run = (samples, det = new RepDetector()) => {
  const events = []
  for (const [t, x, y, z] of samples) {
    const e = det.step(t, x, y, z)
    if (e) events.push({ t, ...e })
  }
  return { det, events }
}

// A phone flat on a stack (iPhone sign: z = −9.81 at rest) moving up by acc(t) m/s².
const synth = (seconds, acc, hz = 60) => Array.from({ length: Math.round(seconds * hz) }, (_, k) => {
  const t = k / hz
  return [t, 0, 0, -(9.81 + acc(t))]
})

describe('RepDetector', () => {
  it('waits for the phone to lie still before it counts anything', () => {
    // Held in the hand first (shaking), then laid down still.
    const shaky = synth(1.5, t => Math.sin(t * 40) * 0.8)
    const still = synth(1, () => 0).map(([t, ...r]) => [t + 1.5, ...r])
    const { det, events } = run([...shaky, ...still])
    expect(det.state).toBe('ready')
    expect(events[0].type).toBe('ready')
    expect(events[0].t).toBeGreaterThan(1.5)
  })

  it('works whichever way the phone lies and whatever the sign convention', () => {
    // A rep: bump up at the bottom, bump down at the top, then still.
    const rep = t => (t > 1 && t < 1.6 ? 2.5 * Math.sin((t - 1) / 0.6 * Math.PI) : 0)
      - (t > 1.7 && t < 2.4 ? 2.5 * Math.sin((t - 1.7) / 0.7 * Math.PI) : 0)
    const flat = synth(4, rep)
    const upsideDown = flat.map(([t, x, y, z]) => [t, x, y, -z])                 // Android sign
    const onSide = flat.map(([t, x, y, z]) => [t, z * 0.6, z * 0.8, 0])          // tilted
    for (const s of [flat, upsideDown, onSide]) expect(run(s).det.reps).toBe(1)
  })

  it('counts the real leg extension set (55 kg × 10, Sensor Logger, thinned to 60 Hz)', () => {
    const { det } = run(load('legext-55kg-10reps-60hz.csv'))
    expect(det.reps).toBe(10)
  })

  it('counts generated sets shaped like the real one, at 60 and 30 Hz', () => {
    for (const name of ['gen-10reps-seed1.csv', 'gen-10reps-seed2.csv', 'gen-10reps-seed3.csv']) {
      const s = load(name)
      expect(run(s).det.reps).toBe(10)
      expect(run(s.filter((_, i) => i % 2 === 0)).det.reps).toBe(10)
    }
  })

  it('ends the set when the phone is picked up and takes back a rep that was just counted', () => {
    // Still, then picked up: lifted (bump up), braked (bump down), tilted 35° in the hand.
    const s = []
    for (let k = 0; k < 4 * 60; k++) {
      const t = k / 60
      const acc = (t > 2 && t < 2.4 ? 3 * Math.sin((t - 2) / 0.4 * Math.PI) : 0)
        - (t > 2.4 && t < 2.8 ? 3 * Math.sin((t - 2.4) / 0.4 * Math.PI) : 0)
      const tilt = Math.min(35, Math.max(0, (t - 2.2) * 60)) * Math.PI / 180
      const f = -(9.81 + acc)
      s.push([t, 0, f * Math.sin(tilt), f * Math.cos(tilt)])
    }
    const { det, events } = run(s)
    expect(det.state).toBe('lifted')
    expect(det.reps).toBe(0)
    expect(events.at(-1).type).toBe('lifted')
  })

  it('marks the count unsure after a gap in the data', () => {
    const s = synth(3, () => 0).filter(([t]) => t < 1.5 || t > 2)
    expect(run(s).det.sure).toBe(false)
  })

  it('stops by hand and keeps the count', () => {
    const { det } = run(load('gen-10reps-seed1.csv'))
    expect(det.stop()).toBe(10)
    expect(det.state).toBe('stopped')
  })
})
