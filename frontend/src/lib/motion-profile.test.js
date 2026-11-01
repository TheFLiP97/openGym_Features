import { describe, it, expect } from 'vitest'
import { learn, loadProfiles, saveProfiles, profileKey, KEEP } from './motion-profile.js'
import { standardize } from './rep-detector.js'

const shape = f => standardize(Array.from({ length: 60 }, (_, k) => f(k / 59)))
const sine = shape(x => Math.sin(2 * Math.PI * x))
const memory = () => {
  const m = new Map()
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }
}

describe('motion profile', () => {
  it('starts from the first set as it is', () => {
    const p = learn(null, { lift: 0.4, gap: 2.2, shape: sine })
    expect(p.n).toBe(1)
    expect(p.lift).toBe(0.4)
    expect(p.gap).toBe(2.2)
    expect(p.shape).toHaveLength(60)
  })

  it('averages the first sets equally, then follows the last few', () => {
    let p = learn(null, { lift: 0.4, gap: 2, shape: sine })
    p = learn(p, { lift: 0.5, gap: 2, shape: sine })
    expect(p.lift).toBeCloseTo(0.45, 3)                  // two sets: their mean
    for (let i = 0; i < 20; i++) p = learn(p, { lift: 0.3, gap: 2, shape: sine })
    expect(p.lift).toBeCloseTo(0.3, 2)                   // long after: the new value
    const before = p.lift
    p = learn(p, { lift: 0.8, gap: 2, shape: sine })
    expect(p.lift).toBeCloseTo(before + (0.8 - before) / KEEP, 3)   // one odd set moves it by 1/KEEP
  })

  it('keeps the shape scaled to mean 0 and spread 1', () => {
    const p = learn(learn(null, { lift: 0.4, gap: 2, shape: sine }), { lift: 0.4, gap: 2, shape: shape(x => Math.sin(2 * Math.PI * x) + 0.3 * Math.sin(4 * Math.PI * x)) })
    const m = p.shape.reduce((s, x) => s + x, 0) / 60
    const sd = Math.sqrt(p.shape.reduce((s, x) => s + (x - m) ** 2, 0) / 60)
    expect(m).toBeCloseTo(0, 2)
    expect(sd).toBeCloseTo(1, 2)
  })

  it('learns nothing from a set without a summary', () => {
    const p = learn(null, { lift: 0.4, gap: 2, shape: sine })
    expect(learn(p, null)).toBe(p)
    expect(learn(null, null)).toBe(null)
  })

  it('keeps profiles on the device by exercise name, and survives broken storage', () => {
    const s = memory()
    expect(loadProfiles(s)).toEqual({})
    saveProfiles({ [profileKey(' Beinstrecker ')]: { n: 1, lift: 0.4 } }, s)
    expect(loadProfiles(s)).toEqual({ beinstrecker: { n: 1, lift: 0.4 } })
    s.setItem('opengym_sensor_profiles_v1', '[1,2]')
    expect(loadProfiles(s)).toEqual({})
    expect(saveProfiles({}, { setItem: () => { throw new Error('full') } })).toBe(false)
  })
})
