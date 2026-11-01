import { describe, it, expect } from 'vitest'
import { applyCount, confirmed, countable, learnable } from './sensor-apply.js'

describe('sensor apply', () => {
  it('fills the reps of a planned row and remembers what the sensor counted', () => {
    const { row, filled } = applyCount({ w: 55, r: 12, done: false }, { reps: 10, sure: true, rAtStart: 12 })
    expect(filled).toBe(true)
    expect(row).toEqual({ w: 55, r: 10, done: false, sensor: { v: 1, src: 'web', reps: 10, sure: true } })
  })

  it('never overwrites reps typed in while the set ran', () => {
    const { row, filled } = applyCount({ w: 55, r: 11, done: false }, { reps: 10, rAtStart: 12 })
    expect(filled).toBe(false)
    expect(row.r).toBe(11)
    expect(row.sensor.reps).toBe(10)
  })

  it('does not change the row it was given', () => {
    const before = { w: 40, r: 8, done: false }
    applyCount(before, { reps: 9, rAtStart: 8 })
    expect(before).toEqual({ w: 40, r: 8, done: false })
  })

  it('knows when a ticked set confirms the count', () => {
    expect(confirmed({ done: true, r: 10, sensor: { reps: 10 } })).toBe(true)
    expect(confirmed({ done: true, r: 9, sensor: { reps: 10 } })).toBe(false)    // corrected
    expect(confirmed({ done: false, r: 10, sensor: { reps: 10 } })).toBe(false)  // not ticked yet
    expect(confirmed({ done: true, r: 10 })).toBe(false)                          // no sensor
  })

  it('learns from a ticked set unless the count was far off', () => {
    expect(learnable({ done: true, r: 10, sensor: { reps: 10 } })).toBe(true)
    expect(learnable({ done: true, r: 12, sensor: { reps: 10 } })).toBe(true)    // corrected by 2
    expect(learnable({ done: true, r: 13, sensor: { reps: 10 } })).toBe(false)   // far off
    expect(learnable({ done: false, r: 10, sensor: { reps: 10 } })).toBe(false)
    expect(learnable({ done: true, r: 10 })).toBe(false)
  })

  it('counts only plain reps rows that are still open', () => {
    expect(countable({ r: 10, done: false }, 'reps')).toBe(true)
    expect(countable({ r: 10, done: true }, 'reps')).toBe(false)
    expect(countable({ sec: 30, done: false }, 'time')).toBe(false)
    expect(countable({ sides: { L: {}, R: {} }, done: false }, 'reps')).toBe(false)
  })
})
