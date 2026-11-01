// Rep sensor (docs/rep-sensor), beta in this fork: the bar at the bottom of the workout that
// counts the next open set with the phone lying on the weight stack.
//
// Start (a tap: it is also the iPhone's motion permission) -> lay the phone on the stack (before
// or after the tap) -> train -> pick the phone up, or Stop. Then, as set in Settings → Workout:
// the count goes into the set's reps ('fill'), and the set is ticked too ('tick'), or the bar asks
// first ('ask'); a yes there opens the effort picker (RIR or RPE, as the profile logs), whose
// pick ticks the set as it does on the row. Reps typed in by hand during the set are never
// overwritten (lib/sensor-apply.js).
//
// Learning: when the set is ticked, it teaches this exercise's profile (lib/motion-profile.js),
// kept on this device for now, unless the reps ticked are far from what the sensor counted
// (lib/sensor-apply.js learnable). With "keep sensor recordings" on, every set's raw data goes
// to lib/motion-debug-store.js.
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
  ready: 'Zählt',
}

// The open set the sensor would count now, with what the bar shows about it.
function targetOf(A) {
  const next = nextOpenSet(A?.entries, A?.cur)
  if (!next || next.side) return null
  const entry = A.entries[next.idx]
  const row = entry.sets[next.i]
  const mode = modeOf({ ...(entry.target || {}), id: entry.id })
  if (!countable(row, mode)) return null
  return { idx: next.idx, i: next.i, exId: entry.id, name: exerciseNameText(exOr(entry.id)), w: row.w, set: next.i + 1 }
}

// Switched off (the default), nothing of the sensor runs at all.
export default function SensorBar({ onTick }) {
  const settings = useSensorSettings()
  return settings.on ? <ActiveSensorBar settings={settings} onTick={onTick} /> : null
}

function ActiveSensorBar({ settings, onTick }) {
  const A = useStore(s => s.S.active)
  const update = useStore(s => s.update)
  const resting = useUI(s => !!(s.timer || s.work))
  const [phase, setPhase] = useState('idle')        // idle | running | ask
  const [status, setStatus] = useState('wait_rest')
  const [reps, setReps] = useState(0)
  const [sure, setSure] = useState(true)
  const [problem, setProblem] = useState('')
  const run = useRef(null)        // { det, samples, stop, target, rAtStart, startedAt }
  const pending = useRef(null)    // a counted set waiting to be ticked: { idx, i, exId, summary, debugId }
  const asked = useRef(null)      // the count waiting for "take it?" in 'ask' mode

  const show = settings.on && A && !A.editingWorkoutId
  const target = show ? targetOf(A) : null

  // the page leaves room for the bar
  useEffect(() => {
    document.body.classList.toggle('sensing', !!show)
    return () => document.body.classList.remove('sensing')
  }, [show])

  // stop listening when the bar goes away mid-set
  useEffect(() => () => { run.current?.stop?.(); releaseWakeLock() }, [])

  // Learning: once the counted set is ticked, a count left as it was teaches the profile.
  useEffect(() => useStore.subscribe(st => {
    const p = pending.current
    if (!p) return
    const row = st.S.active?.entries?.[p.idx]?.sets?.[p.i]
    if (!row || !row.sensor) { pending.current = null; return }
    if (!row.done) return
    pending.current = null
    if (learnable(row) && p.summary) {
      const all = loadProfiles()
      all[profileKey(p.exId)] = learn(all[profileKey(p.exId)], p.summary)
      saveProfiles(all)
    }
    if (p.debugId) setDebugReal(p.debugId, row.r)
  }), [])

  if (!show) return null

  const start = async () => {
    setProblem('')
    if (!target) return
    if (!motionSupported()) { setProblem('Dieses Gerät liefert keine Bewegungsdaten.'); return }
    if (!(await requestMotionPermission())) { setProblem('Bewegungssensor nicht erlaubt (Safari: aA → Website-Einstellungen).'); return }
    const profile = loadProfiles()[profileKey(target.exId)] || null
    const det = new RepDetector({}, profile)
    const r = { det, samples: [], target, rAtStart: A.entries[target.idx].sets[target.i].r, startedAt: performance.now() }
    r.stop = startMotion((t, ax, ay, az) => {
      r.samples.push([t, ax, ay, az])
      const e = det.step(t, ax, ay, az)
      if (!e) return
      setStatus(det.state)
      setReps(det.reps)
      setSure(det.sure)
      if (e.type === 'rep' && navigator.vibrate) navigator.vibrate(30)
      if (e.type === 'lifted') finish()
    })
    run.current = r
    requestWakeLock()
    setReps(0); setSure(true); setStatus('wait_rest'); setPhase('running')
  }

  // The set is over: final count, then into the row as the settings say.
  function finish() {
    const r = run.current
    if (!r) return
    run.current = null
    r.stop()
    releaseWakeLock()
    const counted = r.det.stop()
    setReps(counted)
    setSure(r.det.sure)
    const done = { r, counted, summary: r.det.summary() }
    if (settings.debug) {
      done.debugId = `${Date.now()}-${r.target.exId}`
      putDebugSet({
        id: done.debugId, at: Date.now(), exId: r.target.exId, exercise: r.target.name, w: r.target.w,
        counted, real: null, sure: r.det.sure, version: 1, csv: toCsv(r.samples),
        moves: r.det.cands.map(c => ({ t: c.t, lift: r.det.full(c), match: c.match ?? null, kept: r.det.kept.includes(c) })),
      })
    }
    if (settings.mode === 'ask' && counted > 0) { asked.current = done; setPhase('ask'); return }
    take(done)
  }

  function take({ r, counted, summary, debugId }) {
    const { idx, i, exId } = r.target
    let filled = false
    update(s => {
      const row = s.active?.entries?.[idx]?.sets?.[i]
      if (!row || row.done) return
      const res = applyCount(row, { reps: counted, sure: r.det.sure, rAtStart: r.rAtStart })
      s.active.entries[idx].sets[i] = res.row
      filled = res.filled
    }, true)
    pending.current = { idx, i, exId, summary, debugId }
    setPhase('idle')
    if (settings.mode === 'tick' && filled) onTick?.(idx, i)
  }

  const stop = () => finish()
  // Yes: the reps go in, then straight on to how hard it was. Picking a rating ticks the set and
  // starts the rest, as the effort cell on the row does (views/Workout.jsx pickEffort). Without
  // an effort column the set just keeps its reps, to be ticked by hand.
  const accept = () => {
    const d = asked.current
    asked.current = null
    if (!d) return
    take(d)
    const kind = effortOf(useStore.getState().S)
    const eff = EFFORT[kind]
    if (!eff) return
    const { idx, i } = d.r.target
    const now = useStore.getState().S.active?.entries?.[idx]?.sets?.[i]
    if (!now || now.done) return
    effortPickerSheet(kind, now[eff.f] ?? null, nv => {
      update(s => { const row = s.active?.entries?.[idx]?.sets?.[i]; if (row) row[eff.f] = nv }, true)
      const fresh = useStore.getState().S.active?.entries?.[idx]?.sets?.[i]
      if (nv != null && fresh && !fresh.done) onTick?.(idx, i)
    })
  }
  const dismiss = () => { asked.current = null; setPhase('idle') }

  const which = target ? `Satz ${target.set}${target.w ? ' · ' + fmtNum(target.w) + ' kg' : ''}` : ''
  const title = phase === 'ask' ? `${reps} übernehmen?` : target ? target.name : 'Kein offener Satz mit Wiederholungen'
  const sub = problem || (phase === 'running' ? `${which} · ${STATUS[status] || ''}` : phase === 'ask' ? `${target?.name || ''} · ${which}` : target ? `${which} · Rep-Sensor` : 'Rep-Sensor (Beta)')

  return <div id="sensorbar" className={resting ? 'above-timer' : ''}>
    <div className="sb-count">{phase === 'idle' ? '–' : reps}{phase !== 'idle' && !sure && <small>?</small>}</div>
    <div className="sb-text">
      <div className="sb-title">{title}</div>
      <div className="sb-sub">{sub}</div>
    </div>
    <div className="sb-acts">
      {phase === 'idle' && <Button size="sm" variant="primary" icon="play" disabled={!target} onClick={start}>Start</Button>}
      {phase === 'running' && <Button size="sm" variant="primary" onClick={stop}>Stopp</Button>}
      {phase === 'ask' && <>
        <Button size="sm" variant="primary" icon="check" onClick={accept}>Ja</Button>
        <Button size="sm" onClick={dismiss}>Nein</Button>
      </>}
    </div>
  </div>
}
