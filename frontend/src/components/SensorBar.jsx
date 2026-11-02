// Rep sensor (docs/rep-sensor), beta in this fork: the bar at the bottom of the workout that
// counts the next open set with the phone lying on the weight stack.
//
// Start (a tap: it is also the iPhone's motion permission) -> lay the phone on the stack (before
// or after the tap) -> train. The set ends by itself when the stack rests at the bottom for a few
// seconds (longer for slow reps) or the phone is picked up; or with Stop, or by ticking the set (or picking its RIR) on
// the row. Then, as set in Settings → Workout: the count goes into the set's reps and the effort
// picker opens (RIR or RPE, as the profile logs; its pick ticks the set as it does on the row)
// ('fill'), or the set is ticked right away ('tick'), or the bar asks first and a yes goes on as
// 'fill' does ('ask'). Reps typed in by hand during the set are never overwritten
// (lib/sensor-apply.js); a set ticked while it was counted still gets the count.
//
// Learning: when a counted set is ticked, it teaches this exercise's profile
// (lib/motion-profile.js), kept on this device for now, unless the reps ticked are far from what
// the sensor counted (lib/sensor-apply.js learnable). Every counted set waits for its tick, not
// only the last one. With "keep sensor recordings" on, every set's raw data goes to
// lib/motion-debug-store.js, with the live count and how the set ended.
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
  ready: 'Zählt, stoppt von selbst',
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
  const pending = useRef(new Map())  // counted sets waiting to be ticked, by 'idx:i': { idx, i, exId, summary, debugId }
  const asked = useRef(null)      // the count waiting for "take it?" in 'ask' mode
  const finishRef = useRef(null)  // the latest finish(), for the sensor and store callbacks
  const settleRef = useRef(null)  // the latest settle()

  const show = settings.on && A && !A.editingWorkoutId
  const target = show ? targetOf(A) : null

  // the page leaves room for the bar
  useEffect(() => {
    document.body.classList.toggle('sensing', !!show)
    return () => document.body.classList.remove('sensing')
  }, [show])

  // stop listening when the bar goes away mid-set
  useEffect(() => () => { run.current?.stop?.(); releaseWakeLock() }, [])

  // Watching the workout: the set being counted was ticked on the row (or got its RIR, which
  // ticks it), which ends the count; and every counted set that is ticked now teaches.
  useEffect(() => useStore.subscribe(st => {
    const r = run.current
    if (r && st.S.active?.entries?.[r.target.idx]?.sets?.[r.target.i]?.done) finishRef.current?.('tick')
    settleRef.current?.(st)
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
      if (e.type === 'lifted' || e.type === 'rested') finishRef.current?.(e.type)
    })
    run.current = r
    requestWakeLock()
    setReps(0); setSure(true); setStatus('wait_rest'); setPhase('running')
  }

  // The set is over (end: 'stop' | 'lifted' | 'rested' | 'tick'): final count, then into the row
  // as the settings say. A set ticked on the row is done already: no question, no picker then.
  function finish(end = 'stop') {
    const r = run.current
    if (!r) return
    run.current = null
    r.stop()
    releaseWakeLock()
    const live = r.det.reps
    const counted = r.det.stop()
    setReps(counted)
    setSure(r.det.sure)
    const done = { r, counted, summary: r.det.summary() }
    if (settings.debug) {
      done.debugId = `${Date.now()}-${r.target.exId}`
      putDebugSet({
        id: done.debugId, at: Date.now(), exId: r.target.exId, exercise: r.target.name, w: r.target.w,
        counted, live, end, real: null, sure: r.det.sure, version: 1, csv: toCsv(r.samples),
        moves: r.det.cands.map(c => ({ t: c.t, lift: r.det.full(c), match: c.match ?? null, kept: r.det.kept.includes(c) })),
      })
    }
    if (end !== 'tick' && settings.mode === 'ask' && counted > 0) { asked.current = done; setPhase('ask'); return }
    take(done)
    if (end !== 'tick' && settings.mode !== 'tick') askEffort(r.target)
  }
  finishRef.current = finish

  // The count into the row, also when the row was ticked meanwhile (that tick then teaches at once).
  function take({ r, counted, summary, debugId }) {
    const { idx, i, exId } = r.target
    let filled = false, wasDone = false
    update(s => {
      const row = s.active?.entries?.[idx]?.sets?.[i]
      if (!row) return
      wasDone = !!row.done
      const res = applyCount(row, { reps: counted, sure: r.det.sure, rAtStart: r.rAtStart })
      s.active.entries[idx].sets[i] = res.row
      filled = res.filled
    }, true)
    pending.current.set(`${idx}:${i}`, { idx, i, exId, summary, debugId })
    setPhase('idle')
    settle(useStore.getState())
    if (settings.mode === 'tick' && filled && !wasDone) onTick?.(idx, i)
  }

  // Each counted set teaches once, when it is ticked; one that lost its count (deleted, moved)
  // is forgotten.
  function settle(st) {
    for (const [key, p] of pending.current) {
      const row = st.S.active?.entries?.[p.idx]?.sets?.[p.i]
      if (!row?.sensor) { pending.current.delete(key); continue }
      if (!row.done) continue
      pending.current.delete(key)
      if (learnable(row) && p.summary) {
        const all = loadProfiles()
        all[profileKey(p.exId)] = learn(all[profileKey(p.exId)], p.summary)
        saveProfiles(all)
      }
      if (p.debugId) setDebugReal(p.debugId, row.r)
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
  // Yes in 'ask' mode: on as 'fill' does.
  const accept = () => {
    const d = asked.current
    asked.current = null
    if (!d) return
    take(d)
    askEffort(d.r.target)
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
