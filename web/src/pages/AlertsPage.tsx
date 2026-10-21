import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Alert, CameraDevice } from '../types'

export function AlertsPage({ uid, devices }: { uid: string; devices: CameraDevice[] }) {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [camera, setCamera] = useState('')
  const [date, setDate] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const result = await api<Alert[]>('/api/alerts?limit=100')
        if (active) { setAlerts(result); setError('') }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load alerts')
      }
    }
    void load()
    const interval = window.setInterval(() => void load(), 15000)
    return () => { active = false; window.clearInterval(interval) }
  }, [uid])
  const acknowledge = async (id: string) => {
    try {
      await api(`/api/alerts/${encodeURIComponent(id)}/acknowledge`, { method: 'POST' })
      setAlerts((old) => old.map((alert) => alert.id === id
        ? { ...alert, acknowledged_by: [...(alert.acknowledged_by || []), uid] } : alert))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not acknowledge alert')
    }
  }
  const shown = alerts.filter((alert) =>
    (!camera || alert.device_id === camera) && (!date || alert.timestamp?.slice(0, 10) === date),
  )
  return <section className="alerts-page">
    <header className="page-header"><div><p className="eyebrow">SAVED DETECTIONS</p>
      <h1>Violence alerts</h1><p className="muted">Frames are saved with the confirmed boxes drawn on them.</p></div></header>
    <div className="alert-filters">
      <label>Camera <select value={camera} onChange={(event) => setCamera(event.target.value)}>
        <option value="">All cameras</option>
        {devices.map((device) => <option key={device.device_id} value={device.device_id}>{device.name}</option>)}
      </select></label>
      <label>Date <input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
    </div>
    {error && <p className="session-error" role="alert">{error}</p>}
    {!shown.length && <p className="muted">No alerts found.</p>}
    <div className="alert-list">{shown.map((alert) => <article className="alert-record" key={alert.id}>
      <img src={`data:image/jpeg;base64,${alert.thumbnail_b64}`} alt={`Detected violence at ${alert.device_name}`} />
      <div><strong>{alert.device_name}</strong>
        <p>{new Date(alert.timestamp).toLocaleString()} · {Math.round(alert.confidence * 100)}% confidence</p>
        <small>{alert.boxes?.length || 0} saved boxes</small>
        <div><button className="secondary-button"
          disabled={alert.acknowledged_by?.includes(uid)}
          onClick={() => void acknowledge(alert.id)}>
          {alert.acknowledged_by?.includes(uid) ? 'Acknowledged' : 'Acknowledge'}
        </button></div>
      </div>
    </article>)}</div>
  </section>
}
