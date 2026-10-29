// Rep sensor test page (docs/rep-sensor), reached at #/sensor-test and not linked anywhere.
//
// For trying the rep counter in the gym and collecting recordings: Start (which is also the iOS
// motion permission), lay the phone on the stack (before or after Start, both work), lift, Stop.
// The count runs live (lib/rep-detector.js); every sample of the set is kept so it can be saved
// as a raw CSV, named with exercise, weight and the real rep count, and shared to a computer.
// Recordings stay on this device (lib/motion-recording.js), never in the synced state.
//
// German text on purpose for now: this page is a tool for the fork's field tests, not part of
// the app. It goes through the locales before anything of it reaches users.
import { useEffect, useRef, useState } from 'react'
import { RepDetector } from '../lib/rep-detector.js'
import { motionSupported, requestMotionPermission, startMotion } from '../lib/motion-source.js'
import { toCsv, fileName, loadRecordings, saveRecordings } from '../lib/motion-recording.js'
import { requestWakeLock, releaseWakeLock } from '../lib/wakelock.js'
import { Button, TextField } from '../components/ui.jsx'

const GRAPH_S = 8          // the graph shows the last 8 seconds
const NO_DATA_S = 2        // no sample after this long: the browser delivers nothing

const STATUS = {
  idle: 'Bereit zum Start',
  wait_rest: 'Handy ruhig auf den Stapel legen …',
  ready: 'Läuft – trainieren',
  lifted: 'Handy hochgenommen – Satz zu Ende, Stopp tippen',
  stopped: 'Gestoppt',
}

async function shareOrDownload(files) {
  const list = files.map(f => new File([f.csv], f.name, { type: 'text/csv' }))
  try {
    if (navigator.canShare && navigator.canShare({ files: list })) {
      await navigator.share({ files: list })
      return
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return    // closed the share sheet
  }
  for (const f of list) {
    const url = URL.createObjectURL(f)
    const a = document.createElement('a')
    a.href = url
    a.download = f.name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

export default function SensorTest() {
  const [phase, setPhase] = useState('idle')          // idle | running | done
  const [status, setStatus] = useState('idle')        // detector state shown to the user
  const [reps, setReps] = useState(0)
  const [sure, setSure] = useState(true)
  const [rate, setRate] = useState(0)
  const [problem, setProblem] = useState('')
  const [exercise, setExercise] = useState('')
  const [weight, setWeight] = useState('')
  const [realReps, setRealReps] = useState('')
  const [recordings, setRecordings] = useState(() => loadRecordings())
  const [storageFull, setStorageFull] = useState(false)

  const run = useRef(null)       // { det, samples, trace, stop, startedAt }
  const canvas = useRef(null)

  // Graph: filtered vertical acceleration of the last GRAPH_S seconds, reps as lines
  useEffect(() => {
    if (phase !== 'running') return
    let frame
    const draw = () => {
      frame = requestAnimationFrame(draw)
      const c = canvas.current, r = run.current
      if (!c || !r) return
      const w = c.width = c.clientWidth * devicePixelRatio
      const h = c.height = c.clientHeight * devicePixelRatio
      const ctx = c.getContext('2d')
      ctx.clearRect(0, 0, w, h)
      const now = r.samples.length ? r.samples.at(-1)[0] : 0
      const x = t => w - (now - t) / GRAPH_S * w
      const y = s => h / 2 - s / 5 * (h / 2)               // ±5 m/s² fills the height
      ctx.strokeStyle = 'rgba(128,128,128,.5)'
      ctx.lineWidth = devicePixelRatio
      ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke()
      ctx.strokeStyle = 'rgba(52,199,89,.9)'
      for (const t of r.det.repTimes) if (now - t < GRAPH_S) { ctx.beginPath(); ctx.moveTo(x(t), 0); ctx.lineTo(x(t), h); ctx.stroke() }
      ctx.strokeStyle = getComputedStyle(c).color
      ctx.lineWidth = 2 * devicePixelRatio
      ctx.beginPath()
      let first = true
      for (const [t, s] of r.trace) {
        if (now - t > GRAPH_S) continue
        if (first) { ctx.moveTo(x(t), y(s)); first = false } else ctx.lineTo(x(t), y(s))
      }
      ctx.stroke()
    }
    draw()
    return () => cancelAnimationFrame(frame)
  }, [phase])

  // Rate and "no data" check, once a second
  useEffect(() => {
    if (phase !== 'running') return
    const id = setInterval(() => {
      const r = run.current
      if (!r) return
      const now = r.samples.length ? r.samples.at(-1)[0] : null
      setRate(now === null ? 0 : r.samples.filter(s => now - s[0] <= 1).length)
      if (!r.samples.length && (performance.now() - r.startedAt) / 1000 > NO_DATA_S) {
        setProblem('Keine Bewegungsdaten. Läuft die Seite über https und ist der Bewegungssensor erlaubt?')
      }
    }, 1000)
    return () => clearInterval(id)
  }, [phase])

  useEffect(() => () => { run.current?.stop?.(); releaseWakeLock() }, [])

  const start = async () => {
    setProblem('')
    if (!motionSupported()) { setProblem('Dieser Browser hat keinen Bewegungssensor.'); return }
    if (!(await requestMotionPermission())) { setProblem('Bewegungssensor nicht erlaubt. In Safari: aA → Website-Einstellungen → Bewegung erlauben.'); return }
    const det = new RepDetector()
    const r = { det, samples: [], trace: [], startedAt: performance.now() }
    r.stop = startMotion((t, ax, ay, az) => {
      r.samples.push([t, ax, ay, az])
      const e = det.step(t, ax, ay, az)
      if (det.state === 'ready') r.trace.push([t, det.s])
      if (r.trace.length > 2000) r.trace.splice(0, 1000)
      if (e) {
        setStatus(det.state)
        setReps(det.reps)
        setSure(det.sure)
        if (e.type === 'rep' && navigator.vibrate) navigator.vibrate(30)
      }
    })
    run.current = r
    requestWakeLock()
    setReps(0); setSure(true); setRate(0); setStatus('wait_rest'); setPhase('running')
  }

  const stop = () => {
    const r = run.current
    if (!r) return
    r.stop()
    r.det.stop()
    releaseWakeLock()
    setStatus(r.det.state)
    setReps(r.det.reps)
    setSure(r.det.sure)
    setRealReps(String(r.det.reps))
    setPhase('done')
  }

  const save = () => {
    const r = run.current
    const at = Date.now()
    const name = fileName({ exercise, weight, reps: realReps, at })
    const rec = { name, at, counted: r.det.reps, real: realReps === '' ? null : Number(realReps), sure: r.det.sure, csv: toCsv(r.samples) }
    const next = [rec, ...recordings]
    setRecordings(next)
    setStorageFull(!saveRecordings(next))
    run.current = null
    setPhase('idle'); setStatus('idle'); setReps(0)
  }

  const discard = () => { run.current = null; setPhase('idle'); setStatus('idle'); setReps(0) }

  const remove = name => {
    const next = recordings.filter(x => x.name !== name)
    setRecordings(next)
    setStorageFull(!saveRecordings(next))
  }

  return <div className="narrow">
    <div className="hdr"><div><h1>Sensor-Test</h1><div className="sub">Reps zählen mit dem Handy auf dem Gewichtsstapel</div></div></div>

    <div className="card">
      <div style={{ display: 'flex', gap: 8 }}>
        <TextField placeholder="Übung" value={exercise} onChange={e => setExercise(e.target.value)} style={{ flex: 2 }} />
        <TextField placeholder="kg" inputMode="decimal" value={weight} onChange={e => setWeight(e.target.value.replace(',', '.'))} style={{ flex: 1 }} />
      </div>
    </div>

    <div className="card" style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 120, fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
        {reps}{!sure && <span style={{ fontSize: 48, color: 'var(--label-2)' }}>?</span>}
      </div>
      <div style={{ marginTop: 8, color: 'var(--label-2)' }}>{STATUS[status] || status}</div>
      {phase === 'running' && <div style={{ marginTop: 4, color: 'var(--label-3)', fontSize: 13 }}>{rate} Messwerte/s</div>}
      {problem && <div style={{ marginTop: 8, color: 'var(--red, #d33)' }}>{problem}</div>}
      {phase === 'running' && <canvas ref={canvas} style={{ width: '100%', height: 140, marginTop: 12, color: 'var(--label)' }} />}
      <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center' }}>
        {phase === 'idle' && <Button variant="primary" icon="play" onClick={start}>Start</Button>}
        {phase === 'running' && <Button variant="primary" onClick={stop}>Stopp</Button>}
      </div>
    </div>

    {phase === 'done' && <div className="card">
      <div style={{ marginBottom: 8 }}>Gezählt: <b>{reps}</b>{!sure && ' (unsicher)'}. Wie viele waren es wirklich?</div>
      <TextField inputMode="numeric" value={realReps} onChange={e => setRealReps(e.target.value.replace(/\D/g, ''))} />
      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <Button variant="primary" icon="check" onClick={save}>Aufnahme speichern</Button>
        <Button onClick={discard}>Verwerfen</Button>
      </div>
    </div>}

    {storageFull && <div className="card" style={{ color: 'var(--red, #d33)' }}>
      Der Speicher auf diesem Gerät ist voll. Bitte die Aufnahmen teilen und dann löschen.
    </div>}

    {recordings.length > 0 && <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <b>Aufnahmen ({recordings.length})</b>
        <Button size="sm" icon="share" onClick={() => shareOrDownload(recordings)}>Alle teilen</Button>
      </div>
      {recordings.map(r => <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid var(--sep, rgba(128,128,128,.2))' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14 }}>{r.name}</div>
          <div style={{ color: 'var(--label-2)', fontSize: 12 }}>gezählt {r.counted}{r.real != null ? `, echt ${r.real}` : ''}{r.sure ? '' : ', unsicher'}</div>
        </div>
        <Button size="sm" icon="share" aria-label="Teilen" onClick={() => shareOrDownload([r])} />
        <Button size="sm" icon="trash" aria-label="Löschen" onClick={() => remove(r.name)} />
      </div>)}
    </div>}
  </div>
}
