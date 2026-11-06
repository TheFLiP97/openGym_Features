// Rep sensor (docs/rep-sensor), beta in this fork: the bar at the bottom of the workout that
// counts the next open set with the phone lying on the weight stack.
//
// Two ways to start (Settings → Workout, lib/sensor-settings.js `start`):
// - 'button': Start (a tap: it is also the iPhone's motion permission) -> lay the phone on the
//   stack (before or after the tap) -> train. The set ends by itself when the stack rests for a
//   few seconds (longer for slow reps) or the phone is picked up; or with Stop, or by ticking the
//   set (or picking its RIR) on the row.
// - 'auto' (docs/rep-sensor/AUTOMATIK.md, rules in lib/sensor-auto.js): after one Start tap
//   for the permission, the bar listens by itself once 70 % of the rest has run (Start still
//   starts earlier). The set begins with its reps; once the stack lies still the count goes in,
//   but the bar keeps listening for a while: a late rep after a breather is added to the same
//   set. Picked up before any rep, it just listens on.
// After the set, as set in Settings → Workout: the count goes into the set's reps and the effort
// picker opens (RIR or RPE, as the profile logs; its pick ticks the set as it does on the row)
// ('fill'), or the set is ticked right away ('tick'), or the bar asks first and a yes goes on as
// 'fill' does ('ask'; a no leaves the reps to be typed in, and the set still learns from them).
// Reps typed in by hand during the set are never overwritten (lib/sensor-apply.js); a set ticked
// while it was counted still gets the count. A set with no rep counted leaves the row alone.
//
// Learning: when a counted set is ticked, it teaches this exercise's profile
// (lib/motion-profile.js), kept on this device for now, unless the reps ticked are far from what
// the sensor counted (lib/sensor-apply.js learnable). Every counted set waits for its tick, not
// only the last one. With "keep sensor recordings" on, every set's raw data goes to
// lib/motion-debug-store.js, with the live count, how the set ended, and the effort logged.
//
// The screen stays on through the app's own "Keep screen awake" (App.jsx); only with that off
// does the bar hold the lock itself, while it listens.
//
// German text on purpose for now, like the sensor test page: a field-test tool of this fork.
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { RepDetector } from '../lib/rep-detector.js'
import { motionSupported, requestMotionPermission, startMotion } from '../lib/motion-source.js'
import { learn, loadProfiles, saveProfiles } from '../lib/motion-profile.js'
import { applyCount, countable, learnable } from '../lib/sensor-apply.js'
import { useSensorSettings } from '../lib/sensor-settings.js'
import { autoArmed, softEnded, resumed, graceOver } from '../lib/sensor-auto.js'
import { putDebugSet, setDebugReal } from '../lib/motion-debug-store.js'
import { toCsv } from '../lib/motion-recording.js'
import { requestWakeLock, releaseWakeLock } from '../lib/wakelock.js'
import { nextOpenSet } from '../lib/workout-keys.js'
import { modeOf, effortOf, EFFORT } from '../lib/history.js'
import { effortPickerSheet } from '../sheets.jsx'
import { exOr } from '../lib/exercises.js'
import { exerciseNameText, fmtNum } from '../lib/format.js'
import { Button } from './ui.jsx'

const profileKey = exId => 'ex:' + exId

const STATUS = {
  wait_rest: 'Handy ruhig auf den Stapel legen …',
  ready: 'Zählt, stoppt von selbst',
}

// The iPhone asks for the motion sensor once per page, on a tap; after that the automatic mode
// can listen without one.
let motionGranted = false

// The open set the sensor would count now, with what the bar shows about it.
function targetOf(A) {
  const next = nextOpenSet(A?.entries, A?.cur)
  if (!next || next.side) return null
  const entry = A.entries[next.idx]
  const row = entry.sets[next.i]
  const mode = modeOf({ ...(entry.target || {}), id: entry.id })
  if (!countable(row, mode)) return null
  return { idx: next.idx, i: next.i, key: `${next.idx}:${next.i}`, exId: entry.id, name: exerciseNameText(exOr(entry.id)), w: row.w, set: next.i + 1 }
}

// Switched off (the default), nothing of the sensor runs at all.
export default function SensorBar({ onTick }) {
  const settings = useSensorSettings()
  return settings.on ? <ActiveSensorBar settings={settings} onTick={onTick} /> : null
}

function ActiveSensorBar({ settings, onTick }) {
  const A = useStore(s => s.S.active)
  const update = useStore(s => s.update)
  const keepAwake = useStore(s => s.S.keepAwake !== false)
  const timer = useUI(s => s.timer)
  const resting = useUI(s => !!(s.timer || s.work))
  const [phase, setPhase] = useState('idle')        // idle | running | grace (auto: in, still listening) | ask
  const [status, setStatus] = useState('wait_rest')
  const [reps, setReps] = useState(0)
  const [sure, setSure] = useState(true)
  const [settling, setSettling] = useState(false)  // lying still after a rep: about to stop by itself
  const [granted, setGranted] = useState(motionGranted)
  const [problem, setProblem] = useState('')
  const run = useRef(null)        // { det, samples, stop, target, rAtStart, auto, soft, taken, profile }
  const pending = useRef(new Map())  // counted sets waiting to be ticked, by 'idx:i': { idx, i, exId, summary, debugId }
  const asked = useRef(null)      // the count waiting for "take it?" in 'ask' mode
  const finishRef = useRef(null)  // the latest finish(), for the sensor and store callbacks
  const settleRef = useRef(null)  // the latest settle()
  const sampleRef = useRef(null)  // the latest onSample()

  const auto = settings.start === 'auto'
  const show = settings.on && A && !A.editingWorkoutId
  const target = show ? targetOf(A) : null
  const targetRow = target ? A.entries[target.idx].sets[target.i] : null
  const armNow = !!(show && auto && granted && phase === 'idle' && target && autoArmed(targetRow, timer))

  // the page leaves room for the bar
  useEffect(() => {
    document.body.classList.toggle('sensing', !!show)
    return () => document.body.classList.remove('sensing')
  }, [show])

  // the screen stays on while the bar listens, if the app does not keep it on anyway
  const listening = phase === 'running' || phase === 'grace' || (auto && granted)
  useEffect(() => {
    if (!listening || keepAwake) return
    requestWakeLock()
    return releaseWakeLock
  }, [listening, keepAwake])

  // stop listening when the bar goes away mid-set
  useEffect(() => () => { run.current?.stop?.() }, [])

  // Watching the workout: the set being counted was ticked on the row (or got its RIR, which
  // ticks it), which ends the count; and every counted set that is ticked now teaches.
  useEffect(() => useStore.subscribe(st => {
    const r = run.current
    if (r && st.S.active?.entries?.[r.target.idx]?.sets?.[r.target.i]?.done) finishRef.current?.('tick')
    settleRef.current?.(st)
  }), [])

  // Automatic mode: listen once the rest is nearly over. Moved on to another set before a rep
  // came (another exercise picked, a set ticked by hand): listen for that one instead.
  useEffect(() => { if (armNow && !run.current) begin(target, true) }, [armNow, target?.key])
  useEffect(() => {
    const r = run.current
    if (r?.auto && r.target.key !== target?.key && !r.det.kept.length && !r.soft) discard()
  }, [target?.key])

  if (!show) return null

  const start = async () => {
    setProblem('')
    if (!target) return
    if (!motionSupported()) { setProblem('Dieses Gerät liefert keine Bewegungsdaten.'); return }
    if (!(await requestMotionPermission())) { setProblem('Bewegungssensor nicht erlaubt (Safari: aA → Website-Einstellungen).'); return }
    motionGranted = true
    setGranted(true)
    if (!run.current) begin(target, auto)
  }

  function begin(t, isAuto) {
    const profile = loadProfiles()[profileKey(t.exId)] || null
    const det = new RepDetector(isAuto ? { AUTO_STOP_S: 0 } : {}, profile)   // auto: the end is decided here
    const r = { det, samples: [], target: t, rAtStart: A.entries[t.idx].sets[t.i].r, auto: isAuto, soft: null, profile }
    r.stop = startMotion((ts, ax, ay, az) => sampleRef.current?.(r, ts, ax, ay, az))
    run.current = r
    setReps(0); setSure(true); setSettling(false); setStatus('wait_rest'); setPhase('running')
  }

  // Automatic mode, nothing counted yet: let go without a trace.
  function discard() {
    const r = run.current
    if (!r) return
    run.current = null
    r.stop()
    setReps(0); setSettling(false); setPhase('idle')
  }

  function onSample(r, t, ax, ay, az) {
    if (run.current !== r) return
    r.samples.push([t, ax, ay, az])
    const det = r.det
    const e = det.step(t, ax, ay, az)
    const still = !r.soft && det.state === 'ready' && det.restedFor(t) >= 1
    if (still !== r.settling) { r.settling = still; setSettling(still) }
    if (r.auto) {
      if (e?.type === 'lifted') {
        if (det.kept.length) { finish('lifted'); return }
        // picked up before the set (moved, looked at): listen on from scratch once it lies again
        r.det = new RepDetector({ AUTO_STOP_S: 0 }, r.profile)
        r.samples = []
        setReps(0); setStatus('wait_rest')
        return
      }
      if (r.soft) {
        if (resumed(det, r.soft)) {             // a late rep: the set goes on
          r.soft = null
          if (asked.current) asked.current = null
          setPhase('running')
        } else if (graceOver(t, r.soft)) { finish('auto'); return }
      } else if (softEnded(det, t)) { softEnd(r, t); return }
    }
    if (!e) return
    setStatus(det.state)
    setReps(det.reps)
    setSure(det.sure)
    if (e.type === 'rep' && navigator.vibrate) navigator.vibrate(30)
    if (!r.auto && (e.type === 'lifted' || e.type === 'rested')) finishRef.current?.(e.type)
  }
  sampleRef.current = onSample

  // Automatic mode: the stack lies still after the reps. The count goes in as at the end of a
  // set, while the bar listens on for a late rep (lib/sensor-auto.js).
  function softEnd(r, t) {
    r.det.finish()                     // the final count so far; the detector itself listens on
    const counted = r.det.reps
    r.soft = { t, moves: r.det.cands.length }
    setReps(counted); setSure(r.det.sure); setSettling(false)
    const done = { r, counted, summary: r.det.summary() }
    if (settings.mode === 'ask') { asked.current = done; setPhase('ask'); return }
    take(done)
    setPhase(run.current === r ? 'grace' : 'idle')
    // the picker once per set: after a late rep the count changes under the open picker
    if (settings.mode !== 'tick' && !r.effortAsked) { r.effortAsked = true; askEffort(r.target) }
  }

  // The set is over (end: 'stop' | 'lifted' | 'rested' | 'tick' | 'auto'): final count, then into
  // the row as the settings say. A set ticked on the row is done already: no question, no picker.
  function finish(end = 'stop') {
    const r = run.current
    if (!r) return
    run.current = null
    r.stop()
    const live = r.det.reps
    const counted = r.det.stop()
    setReps(counted)
    setSure(r.det.sure)
    setSettling(false)
    const done = { r, counted, summary: r.det.summary() }
    if (settings.debug && counted > 0) {
      done.debugId = `${Date.now()}-${r.target.exId}`
      putDebugSet({
        id: done.debugId, at: Date.now(), exId: r.target.exId, exercise: r.target.name, w: r.target.w,
        counted, live, end, start: r.auto ? 'auto' : 'button', real: null, sure: r.det.sure, version: 1, csv: toCsv(r.samples),
        moves: r.det.cands.map(c => ({ t: c.t, lift: r.det.full(c), match: c.match ?? null, kept: r.det.kept.includes(c) })),
      })
    }
    if (counted === 0) { asked.current = null; setPhase('idle'); return }   // nothing counted: the row stays as it is
    if (asked.current) { asked.current = done; setPhase('ask'); return }    // auto, still asking: the question stays
    if (r.taken !== undefined) {
      // automatic mode: the count went in when the stack came to rest; only a change goes in now
      if (counted !== r.taken) take(done)
      else {
        const p = pending.current.get(r.target.key)
        if (p) Object.assign(p, { summary: done.summary, debugId: done.debugId })
        settle(useStore.getState())
      }
      setPhase('idle')
      return
    }
    if (end !== 'tick' && settings.mode === 'ask') { asked.current = done; setPhase('ask'); return }
    take(done)
    setPhase('idle')
    if (end !== 'tick' && settings.mode !== 'tick') askEffort(r.target)
  }
  finishRef.current = finish

  // The count into the row, also when the row was ticked meanwhile (that tick then teaches at once).
  function take({ r, counted, summary, debugId }, fill = true) {
    const { idx, i, exId, key } = r.target
    let filled = false, wasDone = false
    update(s => {
      const row = s.active?.entries?.[idx]?.sets?.[i]
      if (!row) return
      wasDone = !!row.done
      const res = applyCount(row, { reps: counted, sure: r.det.sure, rAtStart: r.rAtStart, fill })
      s.active.entries[idx].sets[i] = res.row
      filled = res.filled
    }, true)
    // a later correction (a late rep in the automatic mode) may fill again what was filled here
    r.taken = counted
    if (filled) r.rAtStart = counted
    pending.current.set(key, { idx, i, exId, summary, debugId })
    settle(useStore.getState())
    if (settings.mode === 'tick' && filled && !wasDone) onTick?.(idx, i)
  }

  // Each counted set teaches once, when it is ticked; one that lost its count (deleted, moved)
  // is forgotten. The recording keeps the reps and effort the set was ticked with.
  function settle(st) {
    for (const [key, p] of pending.current) {
      const row = st.S.active?.entries?.[p.idx]?.sets?.[p.i]
      if (!row?.sensor) { pending.current.delete(key); continue }
      if (!row.done) continue
      if (run.current?.target.key === key) continue     // still listening for a late rep: at its end
      pending.current.delete(key)
      if (learnable(row) && p.summary) {
        const all = loadProfiles()
        all[profileKey(p.exId)] = learn(all[profileKey(p.exId)], p.summary)
        saveProfiles(all)
      }
      if (p.debugId) setDebugReal(p.debugId, row.r, { rir: row.rir ?? null, rpe: row.rpe ?? null })
    }
  }
  settleRef.current = settle

  const stop = () => finish('stop')
  // After the reps went in: straight on to how hard it was. Picking a rating ticks the set and
  // starts the rest, as the effort cell on the row does (views/Workout.jsx pickEffort). Without
  // an effort column the set just keeps its reps, to be ticked by hand.
  function askEffort({ idx, i }) {
    const kind = effortOf(useStore.getState().S)
    const eff = EFFORT[kind]
    if (!eff) return
    const now = useStore.getState().S.active?.entries?.[idx]?.sets?.[i]
    if (!now || now.done) return
    effortPickerSheet(kind, now[eff.f] ?? null, nv => {
      update(s => { const row = s.active?.entries?.[idx]?.sets?.[i]; if (row) row[eff.f] = nv }, true)
      const fresh = useStore.getState().S.active?.entries?.[idx]?.sets?.[i]
      if (nv != null && fresh && !fresh.done) onTick?.(idx, i)
    })
  }
  const afterAnswer = d => setPhase(run.current === d.r ? 'grace' : 'idle')
  // Yes in 'ask' mode: on as 'fill' does.
  const accept = () => {
    const d = asked.current
    asked.current = null
    if (!d) return
    take(d)
    afterAnswer(d)
    if (!d.r.effortAsked) { d.r.effortAsked = true; askEffort(d.r.target) }
  }
  // No: the count stays out of the reps, to be typed in by hand. The set still remembers it, so
  // ticking it (or picking its RIR) teaches with the number typed in.
  const dismiss = () => {
    const d = asked.current
    asked.current = null
    if (!d) { setPhase('idle'); return }
    take(d, false)
    afterAnswer(d)
  }

  const which = target ? `Satz ${target.set}${target.w ? ' · ' + fmtNum(target.w) + ' kg' : ''}` : ''
  const counting = run.current?.det.kept.length > 0
  const idleSub = !target ? 'Rep-Sensor (Beta)'
    : !auto ? `${which} · Rep-Sensor`
    : !granted ? `${which} · Automatisch: einmal Start tippen`
    : `${which} · Misst ab 70 % der Pause`
  const runSub = settling ? 'Ruhig, stoppt gleich'
    : run.current?.auto && !counting && status === 'ready' ? 'Misst, Satz startet von selbst'
    : STATUS[status] || ''
  const title = phase === 'ask' ? `${reps} übernehmen?` : target ? target.name : 'Kein offener Satz mit Wiederholungen'
  const sub = problem || (phase === 'running' ? `${which} · ${runSub}`
    : phase === 'grace' ? `${which} · Eingetragen, misst noch kurz`
    : phase === 'ask' ? `${target?.name || ''} · ${which}`
    : idleSub)

  return <div id="sensorbar" className={resting ? 'above-timer' : ''}>
    <div className="sb-count">{phase === 'idle' ? '–' : reps}{phase !== 'idle' && !sure && <small>?</small>}</div>
    <div className="sb-text">
      <div className="sb-title">{title}</div>
      <div className="sb-sub">{sub}</div>
    </div>
    <div className="sb-acts">
      {phase === 'idle' && <Button size="sm" variant="primary" icon="play" disabled={!target} onClick={start}>Start</Button>}
      {phase === 'running' && <Button size="sm" variant="primary" onClick={stop}>Stopp</Button>}
      {phase === 'grace' && <Button size="sm" onClick={stop}>Fertig</Button>}
      {phase === 'ask' && <>
        <Button size="sm" variant="primary" icon="check" onClick={accept}>Ja</Button>
        <Button size="sm" onClick={dismiss}>Nein</Button>
      </>}
    </div>
  </div>
}
