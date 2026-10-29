// Rep sensor (docs/rep-sensor): recordings made on the sensor test page.
//
// A recording is the raw samples of one set in the format the analysis tools read
// (docs/rep-sensor: plot_csv.py, compare_methods.mjs) and the tests use as fixtures:
//   t_s,ax,ay,az    time from the start in s, acceleration including gravity in m/s²
// The file name carries the exercise, weight and the real rep count ("_10reps"), which the tools
// compare the counter against.
//
// Kept on this device only, in localStorage under its own key: never in the synced state, never
// on a server. Exported by sharing or downloading the CSV.

const KEY = 'opengym_sensor_recordings_v1'

export function toCsv(samples) {
  const t0 = samples.length ? samples[0][0] : 0
  const rows = samples.map(([t, x, y, z]) => `${(t - t0).toFixed(3)},${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`)
  return ['t_s,ax,ay,az', ...rows].join('\n') + '\n'
}

// "Beinstrecker", 55, 10, a date -> "Beinstrecker_55kg_10reps_2026-10-31_18-04-22.csv"
export function fileName({ exercise, weight, reps, at }) {
  const d = new Date(at)
  const pad = n => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  const name = String(exercise || 'Satz').trim().replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/^-+|-+$/g, '') || 'Satz'
  const parts = [name]
  if (weight !== '' && weight != null && Number.isFinite(Number(weight))) parts.push(`${Number(weight)}kg`)
  if (reps !== '' && reps != null && Number.isFinite(Number(reps))) parts.push(`${Number(reps)}reps`)
  parts.push(stamp)
  return parts.join('_') + '.csv'
}

export function loadRecordings(storage = globalThis.localStorage) {
  try {
    const list = JSON.parse(storage.getItem(KEY) || '[]')
    return Array.isArray(list) ? list : []
  } catch (e) {
    return []
  }
}

// Returns false when the device refused (storage full): the caller should ask for an export.
export function saveRecordings(list, storage = globalThis.localStorage) {
  try {
    storage.setItem(KEY, JSON.stringify(list))
    return true
  } catch (e) {
    return false
  }
}
