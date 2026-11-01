// Rep sensor (docs/rep-sensor/SPEICHERN.md): what openGym has learned about one exercise of one
// person, from that person's earlier sets of it:
//   { n, lift, gap, shape }   sets learned from, typical lift (m), time per rep (s), and the
//                             reference shape of one rep (lib/rep-detector.js compares with it)
// Each new set moves the profile a step towards itself: by 1/(n+1) for the first few sets, then
// by 1/KEEP, so the profile is about the average of the last KEEP sets and follows when someone
// gets stronger or slower. It never grows: one small object per exercise, overwritten.
//
// What a set teaches comes from its middle (lib/rep-detector.js summary), which looks the same when
// a movement at the edge was miscounted; so a set corrected by a rep or two still teaches, one far
// off does not (the caller decides, lib/sensor-apply.js learnable).
import { standardize } from './rep-detector.js'

export const KEEP = 5
const KEY = 'opengym_sensor_profiles_v1'

const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d

export function learn(prev, summary) {
  if (!summary) return prev || null
  if (!prev || !(prev.n > 0)) return { n: 1, lift: round(summary.lift, 3), gap: round(summary.gap, 2), shape: summary.shape.map(x => round(x, 3)) }
  const w = 1 / Math.min(prev.n + 1, KEEP)
  const mix = (a, b) => a + (b - a) * w
  const shape = prev.shape?.length === summary.shape.length
    ? standardize(prev.shape.map((x, i) => mix(x, summary.shape[i])))
    : summary.shape
  return {
    n: prev.n + 1,
    lift: round(mix(prev.lift, summary.lift), 3),
    gap: round(mix(prev.gap, summary.gap), 2),
    shape: shape.map(x => round(x, 3)),
  }
}

// The sensor test page keeps profiles on the device, keyed by the exercise name typed there.
// In the app they will live in the synced state instead (sensorProfiles, per exercise id).
export function loadProfiles(storage = globalThis.localStorage) {
  try {
    const m = JSON.parse(storage.getItem(KEY) || '{}')
    return m && typeof m === 'object' && !Array.isArray(m) ? m : {}
  } catch (e) {
    return {}
  }
}

export function saveProfiles(map, storage = globalThis.localStorage) {
  try {
    storage.setItem(KEY, JSON.stringify(map))
    return true
  } catch (e) {
    return false
  }
}

export const profileKey = name => String(name || '').trim().toLowerCase()
