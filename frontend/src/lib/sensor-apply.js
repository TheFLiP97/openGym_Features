// Rep sensor (docs/rep-sensor/SPEICHERN.md): what a counted set does to its row in the workout.
//
// The row is { w, r, done, ... }. The count goes into r, unless the reps were changed by hand
// while the set ran (r differs from what it was when the sensor started): a number typed in is
// never overwritten. Either way the row remembers what the sensor counted, as
//   sensor: { v: 1, src: 'web', reps, sure }
// so that later r !== sensor.reps shows a correction, and statistics can tell sensor sets apart.
// Rows that are not plain reps rows (timed, cardio, one side of a per-side set) are left alone.

export const SENSOR_VERSION = 1

// Whether the sensor can count this row at all.
export function countable(row, mode) {
  return !!row && mode === 'reps' && !row.sides && !row.done
}

// The row after the sensor counted `reps` (a new object; the input is not changed).
// rAtStart: the row's r when the sensor started. Returns { row, filled }.
export function applyCount(row, { reps, sure = true, rAtStart }) {
  const typed = rAtStart !== undefined && row.r !== rAtStart
  const next = { ...row, sensor: { v: SENSOR_VERSION, src: 'web', reps, sure: !!sure } }
  if (!typed) next.r = reps
  return { row: next, filled: !typed }
}

// After the set was ticked: did the sensor get it exactly right?
export function confirmed(row) {
  return !!(row?.done && row.sensor && row.r === row.sensor.reps)
}

// After the set was ticked: may it teach the exercise's profile? The profile learns from the
// middle of the set (lib/rep-detector.js summary leaves out the first and last rep), and the
// middle looks the same when a movement at the edge was counted wrongly. So a count off by up to
// LEARN_OFF still teaches; further off, something else went wrong (the phone slid, another
// exercise) and the set teaches nothing.
export const LEARN_OFF = 2
export function learnable(row) {
  return !!(row?.done && row.sensor && Number.isFinite(row.r) && Math.abs(row.r - row.sensor.reps) <= LEARN_OFF)
}
