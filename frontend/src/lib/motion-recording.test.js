import { describe, it, expect } from 'vitest'
import { toCsv, fileName, loadRecordings, saveRecordings } from './motion-recording.js'

const memory = () => {
  const m = new Map()
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }
}

describe('motion recordings', () => {
  it('writes the raw CSV with time from the start of the recording', () => {
    expect(toCsv([[10.5, 0.1, 0.2, -9.81], [10.5167, 0.12, 0.21, -9.8]]))
      .toBe('t_s,ax,ay,az\n0.000,0.1000,0.2000,-9.8100\n0.017,0.1200,0.2100,-9.8000\n')
  })

  it('names the file after exercise, weight and real reps', () => {
    const at = new Date(2026, 9, 31, 18, 4, 22).getTime()
    expect(fileName({ exercise: 'Beinstrecker', weight: 55, reps: 10, at })).toBe('Beinstrecker_55kg_10reps_2026-10-31_18-04-22.csv')
    expect(fileName({ exercise: 'Latzug eng / V-Griff', weight: 47.5, reps: '', at })).toBe('Latzug-eng-V-Griff_47.5kg_2026-10-31_18-04-22.csv')
    expect(fileName({ exercise: '', weight: '', reps: 8, at })).toBe('Satz_8reps_2026-10-31_18-04-22.csv')
  })

  it('keeps recordings on the device and survives broken or full storage', () => {
    const s = memory()
    expect(loadRecordings(s)).toEqual([])
    expect(saveRecordings([{ name: 'a.csv', csv: 'x' }], s)).toBe(true)
    expect(loadRecordings(s)).toEqual([{ name: 'a.csv', csv: 'x' }])
    s.setItem('opengym_sensor_recordings_v1', '{not json')
    expect(loadRecordings(s)).toEqual([])
    const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') } }
    expect(saveRecordings([{ name: 'b.csv' }], full)).toBe(false)
  })
})
