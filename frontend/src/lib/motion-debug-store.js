// Rep sensor (docs/rep-sensor), debug only: every counted set kept on this device with its raw
// data, so the counter can be checked and improved later against what really happened. Switched
// on in Settings (lib/sensor-settings.js `debug`), exported from there, and to be removed again
// once the counter has proven itself.
//
// IndexedDB, not localStorage: a set is 50–150 KB of raw samples, and localStorage holds ~5 MB.
// Never in the synced state, never on a server.
//
// A record: { id, at, exId, exercise, w, counted, live, end, start, real, rir, rpe, sure,
//             version, csv, moves }
//   csv     the raw samples (lib/motion-recording.js toCsv): t_s, ax, ay, az
//   moves   what the counter saw: per movement its time, lift (m), shape match and whether it
//           counted; everything else (velocity, path) is recomputed from the raw samples
//   live    the count shown during the set, before the check at its end
//   end     how the set ended: stop | lifted | rested | tick (button mode), auto (automatic mode)
//   start   'button' or 'auto' (components/SensorBar.jsx)
//   real    the reps the row had when it was ticked (null until then), with the effort logged
//   rir/rpe on it then: what velocity-based estimates are checked against later (docs/rep-sensor)

const DB = 'opengym-sensor-debug', STORE = 'sets', VERSION = 1

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no IndexedDB'))
    const req = indexedDB.open(DB, VERSION)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx(mode, fn) {
  const db = await open()
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const result = fn(t.objectStore(STORE))
    t.oncomplete = () => { db.close(); resolve(result?.result ?? result) }
    t.onerror = () => { db.close(); reject(t.error) }
  })
}

export const putDebugSet = rec => tx('readwrite', s => s.put(rec)).catch(() => null)
export const allDebugSets = () => tx('readonly', s => s.getAll()).then(r => r || []).catch(() => [])
export const clearDebugSets = () => tx('readwrite', s => s.clear()).catch(() => null)

export async function setDebugReal(id, real, extra = {}) {
  const all = await allDebugSets()
  const rec = all.find(r => r.id === id)
  if (rec) await putDebugSet({ ...rec, ...extra, real })
}
