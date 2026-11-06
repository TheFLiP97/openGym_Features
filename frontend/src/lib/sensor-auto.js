// Rep sensor (docs/rep-sensor/AUTOMATIK.md): the rules of the automatic mode, where the phone
// measures on its own instead of waiting for Start.
//
// Like a dashcam: the sensor listens once most of the rest is over, a set begins with its reps
// (the detector keeps the samples from before, so the first rep is not lost), and the count goes
// into the set once the stack has lain still for a few seconds. It keeps listening a little
// longer after that: a rep after a breather at the bottom (the hard last rep of a set to failure)
// still belongs to the same set, and the count is corrected. Only after GRACE_S without a new rep
// (or the phone picked up, or the set ticked) is the set closed and its data let go.
//
// Pure rules here, kept apart from components/SensorBar.jsx, which runs them.

export const AUTO = {
  REST_SHARE: 0.7,   // listening starts once this share of the rest timer has run
  STOP_S: 3,         // still this long after a rep: the count goes in (or one rep's time if longer)
  GRACE_S: 12,       // and listening goes on this long after that, for a late rep
}

// Has enough of the rest run to listen? No rest timer running (switched off, or it ran out)
// counts as over. Starting earlier than this is what the Start button is for.
export function restAlmostOver(timer, share = AUTO.REST_SHARE) {
  if (!timer || timer.ready || !(timer.total > 0)) return true
  return timer.left <= (1 - share) * timer.total
}

// May the automatic mode listen for this row now? Not for a row that was ticked, and not again
// for one that already has a count (filled in but not ticked yet): that would count it twice.
export function autoArmed(row, timer) {
  return !!row && !row.done && !row.sensor && restAlmostOver(timer)
}

// The set is over for now: still long enough after its last counted rep.
export function softEnded(det, t, stopS = AUTO.STOP_S) {
  return det.restedFor(t) > 0 && det.restedFor(t) >= Math.max(stopS, det.typicalGap())
}

// After the soft end ({ t, moves }): a new movement means the set went on.
export const resumed = (det, soft) => det.cands.length > soft.moves

// After the soft end: long enough without a new movement to close the set.
export const graceOver = (t, soft) => t - soft.t >= AUTO.GRACE_S
