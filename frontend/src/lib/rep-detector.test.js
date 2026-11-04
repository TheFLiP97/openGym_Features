import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
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

  // A stack moving p(t) metres (smooth, cosine-shaped legs), seen by a phone flat on it.
  const stack = (legs, hz = 60) => {
    const out = []
    let t0 = 0, p0 = 0
    const plan = [[1.5, 0], ...legs, [2, 0]]          // rest, the movement, rest
    for (const [T, d] of plan) {
      for (let k = 0; k < Math.round(T * hz); k++) {
        const t = t0 + k / hz
        const acc = d * (Math.PI / T) ** 2 / 2 * Math.cos(Math.PI * (t - t0) / T)
        out.push([t, 0, 0, -(9.81 + (T > 0 && d !== 0 ? acc : 0))])
      }
      t0 += T; p0 += d
    }
    return out
  }

  it('counts slow reps whose acceleration hardly shows (7 s per rep, like an assisted pull-up)', () => {
    const legs = []
    for (let i = 0; i < 4; i++) legs.push([3, 0.45], [4, -0.45])
    const { det } = run(stack(legs))
    expect(det.stop()).toBe(4)
  })

  it('drops a short preload before the set and the setting down after it', () => {
    // 12 cm preload, pause, then 8 reps of 40 cm every 2 s, then a 10 cm bump setting it down
    const legs = [[0.6, 0.12], [0.6, -0.12], [2, 0]]
    for (let i = 0; i < 8; i++) legs.push([0.9, 0.4], [1.1, -0.4])
    legs.push([1.5, 0], [0.5, 0.1], [0.5, -0.1])
    const { det } = run(stack(legs))
    expect(det.stop()).toBe(8)
  })

  it('drops sitting down and pulling the handle, which moves the stack further than a rep', () => {
    const legs = [[1.2, 0.65], [1.2, -0.65], [0.3, 0]]  // 65 cm, a short pause; reps go 40 cm
    for (let i = 0; i < 8; i++) legs.push([0.9, 0.4], [1.1, -0.4])
    const { det, events } = run(stack(legs))
    // live it may run one ahead for a moment, never more; once the set is over it is right
    expect(Math.max(...events.filter(e => e.reps !== undefined).map(e => e.reps))).toBeLessThanOrEqual(9)
    expect(det.stop()).toBe(8)
  })

  it('keeps the first rep after a long pause at the bottom, as it comes in time with the rest', () => {
    const legs = [[4, 0]]                              // resting on the stack before the set
    for (let i = 0; i < 8; i++) legs.push([0.9, 0.4], [1.1, -0.4])
    const { det } = run(stack(legs))
    expect(det.stop()).toBe(8)
  })

  it('with a profile of the exercise, keeps a bigger movement out from the start, live too', () => {
    // sitting down pulls the stack 65 cm, the reps go 40 cm; the profile knows 40 cm
    const legs = [[1.2, 0.65], [1.2, -0.65], [1.5, 0]]
    for (let i = 0; i < 6; i++) legs.push([0.9, 0.4], [1.1, -0.4])
    const { det, events } = run(stack(legs), new RepDetector({}, { lift: 0.4, gap: 2 }))
    expect(Math.max(...events.filter(e => e.reps !== undefined).map(e => e.reps))).toBe(6)
    expect(det.stop()).toBe(6)
  })

  it('hands a summary of the set for learning: typical lift, time per rep, shape', () => {
    const legs = []
    for (let i = 0; i < 8; i++) legs.push([0.9, 0.4], [1.1, -0.4])
    const { det } = run(stack(legs))
    det.stop()
    const s = det.summary()
    expect(s.lift).toBeGreaterThan(0.3)
    expect(s.lift).toBeLessThan(0.5)
    expect(s.gap).toBeGreaterThan(1.5)
    expect(s.gap).toBeLessThan(2.5)
    expect(s.shape).toHaveLength(60)
  })

  it('stops by itself when the stack rests at the bottom after the set', () => {
    const legs = []
    for (let i = 0; i < 6; i++) legs.push([0.9, 0.4], [1.1, -0.4])
    legs.push([5, 0])
    const { det, events } = run(stack(legs))
    const end = events.find(e => e.type === 'rested')
    expect(end?.reps).toBe(6)
    expect(end.t).toBeGreaterThan(1.5 + 12 + 3)      // 3 s of rest, not earlier
    expect(det.state).toBe('rested')
  })

  it('does not stop before the first rep, or for a short breather between reps', () => {
    const legs = [[6, 0]]                              // a long wait before the set
    for (let i = 0; i < 4; i++) legs.push([0.9, 0.4], [1.1, -0.4])
    legs.push([2, 0])                                  // 2 s at the bottom, then on
    for (let i = 0; i < 2; i++) legs.push([0.9, 0.4], [1.1, -0.4])
    const { det, events } = run(stack(legs))
    expect(events.some(e => e.type === 'rested')).toBe(false)
    expect(det.stop()).toBe(6)
  })

  // The gym recordings stay on the developer's machine (docs/rep-sensor/data/raw/<day>/, not in
  // the repository: they are other people's sets too). When they are there, the counter must
  // keep what it reached on them without any profile (as in a first set), ending each set the
  // way the app does (by itself, else Stop at the end of the recording): on 2026-10-31 14 of the
  // 18 sets exact, on 2026-11-02 14 of 15, on 2026-11-04 13 of 17, none off by more than 2.
  const gym = new URL('../../../docs/rep-sensor/data/raw/', import.meta.url)
  const gymFiles = existsSync(gym)
    ? readdirSync(gym, { withFileTypes: true }).filter(d => d.isDirectory())
      .flatMap(d => readdirSync(new URL(encodeURIComponent(d.name) + '/', gym)).map(f => new URL(encodeURIComponent(d.name) + '/' + encodeURIComponent(f), gym)))
      .filter(u => /\d+reps_\d{4}-\d\d-\d\d.*\.csv$/.test(decodeURIComponent(u.pathname)))
    : []
  for (const [day, sets, minExact] of [['2026-10-31', 18, 14], ['2026-11-02', 15, 14], ['2026-11-04', 17, 13]]) {
    const files = gymFiles.filter(u => decodeURIComponent(u.pathname).includes(day))
    it.skipIf(files.length < sets)(`counts the gym recordings of ${day}`, () => {
      let exact = 0
      for (const u of files) {
        const name = decodeURIComponent(u.pathname).split('/').at(-1)
        const lines = readFileSync(u, 'utf8').trim().split(/\r?\n/).slice(1)
        const det = new RepDetector()
        for (const l of lines) {
          const [t, x, y, z] = l.split(',').map(Number)
          const e = det.step(t, x, y, z)
          if (e?.type === 'rested' || e?.type === 'lifted') break
        }
        const counted = det.stop()
        const real = +name.match(/(\d+)reps/)[1]
        expect(Math.abs(counted - real), name).toBeLessThanOrEqual(2)
        if (counted === real) exact++
      }
      expect(exact).toBeGreaterThanOrEqual(minExact)
    })
  }
})
