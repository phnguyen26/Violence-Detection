import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { Alert, CameraDevice } from '../types'

// ── Lightbox ──────────────────────────────────────────────────────────────────
interface LightboxProps {
  alert: Alert
  onClose: () => void
  onPrev: (() => void) | null
  onNext: (() => void) | null
}

function Lightbox({ alert, onClose, onPrev, onNext }: LightboxProps) {
  const backdropRef = useRef<HTMLDivElement>(null)

  // Close on Escape, navigate with arrow keys
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') onPrev?.()
      if (e.key === 'ArrowRight') onNext?.()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, onPrev, onNext])

  // Lock body scroll while open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  return (
    <div
      className="lightbox-backdrop"
      ref={backdropRef}
      onClick={(e) => { if (e.target === backdropRef.current) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-label={`Alert image — ${alert.device_name}`}
    >
      <div className="lightbox-panel">
        {/* Header */}
        <div className="lightbox-header">
          <div>
            <strong>{alert.device_name}</strong>
            <span className="lightbox-meta">
              {new Date(alert.timestamp).toLocaleString()} &middot; {Math.round(alert.confidence * 100)}% confidence
            </span>
          </div>
          <button className="lightbox-close icon-button" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Image */}
        <div className="lightbox-img-wrap">
          {onPrev && (
            <button className="lightbox-nav lightbox-nav-prev" onClick={onPrev} aria-label="Previous alert">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}
          <img
            src={`data:image/jpeg;base64,${alert.thumbnail_b64}`}
            alt={`Violence detected at ${alert.device_name}`}
            className="lightbox-img"
          />
          {onNext && (
            <button className="lightbox-nav lightbox-nav-next" onClick={onNext} aria-label="Next alert">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="lightbox-footer">
          <span className="lightbox-boxes-badge">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
            </svg>
            {alert.boxes?.length || 0} detection boxes
          </span>
          <a
            href={`data:image/jpeg;base64,${alert.thumbnail_b64}`}
            download={`alert-${alert.id}.jpg`}
            className="secondary-button lightbox-download"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Download
          </a>
        </div>
      </div>
    </div>
  )
}

// ── AlertsPage ─────────────────────────────────────────────────────────────────
export function AlertsPage({ uid, devices }: { uid: string; devices: CameraDevice[] }) {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [camera, setCamera] = useState('')
  const [date, setDate] = useState('')
  const [error, setError] = useState('')
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

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

  return (
    <section className="alerts-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">SAVED DETECTIONS</p>
          <h1>Violence alerts</h1>
          <p className="muted">Frames are saved with the confirmed boxes drawn on them.</p>
        </div>
      </header>

      <div className="alert-filters">
        <label>Camera
          <select value={camera} onChange={(e) => setCamera(e.target.value)}>
            <option value="">All cameras</option>
            {devices.map((d) => <option key={d.device_id} value={d.device_id}>{d.name}</option>)}
          </select>
        </label>
        <label>Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>

      {error && <p className="session-error" role="alert">{error}</p>}
      {!shown.length && <p className="muted">No alerts found.</p>}

      <div className="alert-list">
        {shown.map((alert, idx) => (
          <article className="alert-record" key={alert.id}>
            <button
              className="alert-thumb-btn"
              onClick={() => setLightboxIndex(idx)}
              aria-label={`Expand image for alert at ${alert.device_name}`}
            >
              <img
                src={`data:image/jpeg;base64,${alert.thumbnail_b64}`}
                alt={`Detected violence at ${alert.device_name}`}
              />
              <span className="alert-thumb-expand">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
                  <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
                </svg>
              </span>
            </button>

            <div>
              <strong>{alert.device_name}</strong>
              <p>{new Date(alert.timestamp).toLocaleString()} · {Math.round(alert.confidence * 100)}% confidence</p>
              <small>{alert.boxes?.length || 0} saved boxes</small>
              <div>
                <button
                  className="secondary-button"
                  disabled={alert.acknowledged_by?.includes(uid)}
                  onClick={() => void acknowledge(alert.id)}
                >
                  {alert.acknowledged_by?.includes(uid) ? 'Acknowledged' : 'Acknowledge'}
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>

      {lightboxIndex !== null && (
        <Lightbox
          alert={shown[lightboxIndex]}
          onClose={() => setLightboxIndex(null)}
          onPrev={lightboxIndex > 0 ? () => setLightboxIndex(lightboxIndex - 1) : null}
          onNext={lightboxIndex < shown.length - 1 ? () => setLightboxIndex(lightboxIndex + 1) : null}
        />
      )}
    </section>
  )
}
