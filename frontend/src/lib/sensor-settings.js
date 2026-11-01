// Rep sensor (docs/rep-sensor): the switches for counting reps with the phone on the stack.
//
// Kept on this device only, not in the synced state: the sensor is a property of the phone that
// lies on the stack, and while it is a beta in this fork it must not touch the sync rules
// (lib/sync-merge.js and api/sync-stamps.js would both need it). A tiny store with a hook, so the
// Settings page and the workout's sensor bar see a change at once.
import { useSyncExternalStore } from 'react'

const KEY = 'opengym_sensor_settings_v1'
export const DEFAULTS = {
  on: false,       // show the sensor bar in the workout
  mode: 'fill',    // after a set: 'fill' the reps, 'tick' fill and tick the set, 'ask' first
  debug: false,    // keep every set's raw data and results on the device (lib/motion-debug-store.js)
}
export const MODES = ['fill', 'tick', 'ask']

let current = null
const listeners = new Set()

export function getSensorSettings(storage = globalThis.localStorage) {
  if (current) return current
  let saved = {}
  try { saved = JSON.parse(storage?.getItem(KEY) || '{}') || {} } catch (e) { saved = {} }
  current = { ...DEFAULTS, ...saved }
  if (!MODES.includes(current.mode)) current.mode = DEFAULTS.mode
  return current
}

export function setSensorSettings(patch, storage = globalThis.localStorage) {
  current = { ...getSensorSettings(storage), ...patch }
  try { storage?.setItem(KEY, JSON.stringify(current)) } catch (e) { /* kept for this session */ }
  for (const l of listeners) l()
}

export function useSensorSettings() {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb) },
    () => getSensorSettings(),
  )
}

// For tests: forget the cached settings.
export function _resetSensorSettings() { current = null }
