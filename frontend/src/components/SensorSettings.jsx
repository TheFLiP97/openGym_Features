// Rep sensor (docs/rep-sensor), beta in this fork: its switches in Settings → Workout.
// German text on purpose for now, like the sensor bar and the test page.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSensorSettings, setSensorSettings } from '../lib/sensor-settings.js'
import { allDebugSets, clearDebugSets } from '../lib/motion-debug-store.js'
import { fileName, shareFiles } from '../lib/motion-recording.js'
import { Button, Row, Section, Segmented, Switch } from './ui.jsx'

const START_OPTIONS = [
  { value: 'button', label: 'Knopf' },
  { value: 'auto', label: 'Automatisch' },
]

const MODE_OPTIONS = [
  { value: 'fill', label: 'Eintragen' },
  { value: 'tick', label: 'Abhaken' },
  { value: 'ask', label: 'Fragen' },
]

export default function SensorSettings() {
  const s = useSensorSettings()
  const nav = useNavigate()
  const [kept, setKept] = useState(null)      // number of kept sensor recordings
  useEffect(() => { if (s.debug) allDebugSets().then(r => setKept(r.length)) }, [s.debug])

  const exportAll = async () => {
    const sets = await allDebugSets()
    if (!sets.length) return
    const files = sets.map(r => ({ name: fileName({ exercise: r.exercise, weight: r.w, reps: r.real ?? '', at: r.at }), text: r.csv }))
    files.push({
      name: `sensor-saetze_${new Date().toISOString().slice(0, 10)}.json`, type: 'application/json',
      text: JSON.stringify(sets.map(({ csv, ...rest }) => ({ ...rest, file: fileName({ exercise: rest.exercise, weight: rest.w, reps: rest.real ?? '', at: rest.at }) })), null, 1),
    })
    await shareFiles(files)
  }
  const clearAll = async () => { await clearDebugSets(); setKept(0) }

  return <Section footer="Beta: das Handy liegt auf dem Gewichtsstapel und zählt mit. Gelernt wird pro Übung aus jedem abgehakten Satz, auch wenn du die Zahl um bis zu 2 korrigiert hast. Alles bleibt auf diesem Gerät.">
    <Row icon="chartLine" iconTint="var(--green)" title="Rep-Sensor (Beta)">
      <Switch aria-label="Rep-Sensor" checked={s.on} onChange={v => setSensorSettings({ on: v })} />
    </Row>
    {s.on && <Row icon="play" iconTint="var(--green)" title="Start" subtitle={s.start === 'auto' ? 'Misst ab 70 % der Pause von selbst' : 'Start tippen vor jedem Satz'}>
      <Segmented className="seg-inline" options={START_OPTIONS} value={s.start} onChange={v => setSensorSettings({ start: v })} />
    </Row>}
    {s.on && <Row icon="check" iconTint="var(--green)" title="Nach dem Satz">
      <Segmented className="seg-inline" options={MODE_OPTIONS} value={s.mode} onChange={v => setSensorSettings({ mode: v })} />
    </Row>}
    {s.on && <Row icon="download" iconTint="var(--grey)" title="Sensor-Aufnahmen behalten" subtitle={s.debug ? `${kept ?? '…'} Sätze auf diesem Gerät` : 'Zum Auswerten, später wieder aus'}>
      <Switch aria-label="Sensor-Aufnahmen behalten" checked={s.debug} onChange={v => setSensorSettings({ debug: v })} />
    </Row>}
    {s.on && s.debug && kept > 0 && <div style={{ display: 'flex', gap: 8, padding: '8px 16px' }}>
      <Button size="sm" icon="share" onClick={exportAll}>Alle exportieren</Button>
      <Button size="sm" icon="trash" onClick={clearAll}>Löschen</Button>
    </div>}
    <Row icon="chartLine" iconTint="var(--green)" title="Sensor-Test" subtitle="Testseite mit Graph" accessory="chevron" onClick={() => nav('/sensor-test')} />
  </Section>
}
