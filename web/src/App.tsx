import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Bell, Camera, Home, LogOut, Plus, ShieldCheck, Smartphone, Volume2, VolumeX } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import './App.css'
import { api } from './api'
import { Brand } from './components/Brand'
import { VIOLENCE_KEYWORDS } from './constants'
import { useAuth } from './hooks/useAuth'
import { useDevices } from './hooks/useDevices'
import { AlertsPage } from './pages/AlertsPage'
import { CameraPage } from './pages/CameraPage'
import { LoginPage } from './pages/LoginPage'
import type { CameraDevice, Page, RegisteredDevice } from './types'

const ALERT_SOUND_COOLDOWN_MS = 30_000
const ALERT_SOUND_SETTING = 'detex-alert-sound-enabled'

function CameraFeed({ device, monitor = false }: { device: CameraDevice; monitor?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = device.stream ?? null
      if (device.stream) void ref.current.play().catch(() => undefined)
    }
  }, [device.stream])
  const width = device.frameWidth ?? 640
  const height = device.frameHeight ?? 480
  // Có stream WebRTC hoặc có frame JPEG relay từ simulator
  const hasVideo = !!device.stream || !!device.frameJpeg
  return (
    <div className={monitor ? 'monitor-stage feed-stage' : 'camera-image feed-stage'}>
      {device.stream
        ? <video ref={ref} autoPlay playsInline muted />
        : device.frameJpeg
          ? <img
              src={`data:image/jpeg;base64,${device.frameJpeg}`}
              className="simulator-feed"
              alt="camera feed"
            />
          : (
            <div className="offline-message"><Camera size={30} /><strong>Camera offline</strong>
              <span>Open its link on the phone to start streaming.</span></div>
          )
      }
      {hasVideo && device.detections?.map((box, index) => {
        const [x1, y1, x2, y2] = box.bbox
        const violence = VIOLENCE_KEYWORDS.some((word) => box.class.toLowerCase().includes(word))
        return <div key={index} className={violence ? 'detection-box alert' : 'detection-box'} style={{
          left: `${x1 / width * 100}%`, top: `${y1 / height * 100}%`,
          width: `${(x2 - x1) / width * 100}%`, height: `${(y2 - y1) / height * 100}%`,
        }}><span>{box.class} {Math.round(box.conf * 100)}%</span></div>
      })}
      {device.violenceDetected && hasVideo && <div className="camera-alert">Violence detected</div>}
      <div className="camera-image-top"><span className="live-tag"><i /> {hasVideo ? 'LIVE' : 'OFFLINE'}</span></div>
    </div>
  )
}

function DeviceCard({ device, onOpen }: { device: CameraDevice; onOpen: () => void }) {
  const isOnline = !!device.stream || !!device.frameJpeg || device.state === 'online'
  return <article className="camera-card">
    <div className="camera-card-head"><div className="camera-title">
      <span className={`camera-status ${isOnline ? 'online' : ''}`} />
      <span><strong>{device.name}</strong><small>{device.location || device.device_id}</small></span>
    </div></div>
    <CameraFeed device={device} />
    <div className="camera-card-foot"><span className="foot-location">
      {isOnline ? `${device.detections?.length ?? 0} detections` : 'Waiting for camera'}
    </span><button className="view-button" onClick={onOpen}>Open monitor →</button></div>
  </article>
}

export default function App() {
  const cameraRoute = window.location.pathname.startsWith('/camera/')
  const { user, loading, signInGoogle, signOut } = useAuth()
  const { devices, error, latestAlert, clearAlert, refresh } = useDevices(user?.uid)
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem(ALERT_SOUND_SETTING) !== 'false')
  const alertAudio = useRef<HTMLAudioElement | null>(null)
  const lastAlertId = useRef<string | null>(null)
  const lastSoundAt = useRef(0)
  const [page, setPage] = useState<Page>('dashboard')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [registered, setRegistered] = useState<RegisteredDevice | null>(null)
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [pairId, setPairId] = useState('')
  const [pairCode, setPairCode] = useState('')
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const selected = devices.find((device) => device.device_id === selectedId) ?? devices[0]

  useEffect(() => {
    const audio = new Audio(`${import.meta.env.BASE_URL}danger-alarm-sound-effect-meme.mp3`)
    audio.preload = 'auto'
    alertAudio.current = audio
    return () => {
      audio.pause()
      alertAudio.current = null
    }
  }, [])

  useEffect(() => {
    if (!latestAlert || latestAlert.id === lastAlertId.current) return
    lastAlertId.current = latestAlert.id
    const now = Date.now()
    if (!soundEnabled || now - lastSoundAt.current < ALERT_SOUND_COOLDOWN_MS) return
    const audio = alertAudio.current
    if (!audio) return
    lastSoundAt.current = now
    audio.currentTime = 0
    void audio.play().catch(() => undefined)
  }, [latestAlert, soundEnabled])

  const toggleAlertSound = () => {
    const next = !soundEnabled
    setSoundEnabled(next)
    localStorage.setItem(ALERT_SOUND_SETTING, String(next))
    if (!next && alertAudio.current) {
      alertAudio.current.pause()
      alertAudio.current.currentTime = 0
    }
  }

  const createDevice = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true); setFormError('')
    try {
      const result = await api<RegisteredDevice>('/api/devices/register', {
        method: 'POST', body: JSON.stringify({ name: name || 'Camera', location }),
      })
      setRegistered(result)
      refresh()
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Could not create camera')
    } finally { setBusy(false) }
  }
  const pairDevice = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true); setFormError('')
    try {
      await api(`/api/devices/${encodeURIComponent(pairId.trim())}/pair`, {
        method: 'POST', body: JSON.stringify({ pairing_code: pairCode.trim() }),
      })
      setPairId(''); setPairCode(''); refresh(); setPage('dashboard')
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Could not pair camera')
    } finally { setBusy(false) }
  }
  const shareDevice = async (id: string) => {
    try {
      const result = await api<{ pairing_code: string }>(
        `/api/devices/${encodeURIComponent(id)}/share-code`, { method: 'POST' },
      )
      setRegistered({ ...(devices.find((device) => device.device_id === id) as CameraDevice),
        camera_token: '', pairing_code: result.pairing_code })
      setPage('add-device')
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Could not create share code')
    }
  }
  const resetCameraLink = async (id: string) => {
    try {
      const result = await api<{ camera_token: string }>(
        `/api/devices/${encodeURIComponent(id)}/camera-token`, { method: 'POST' },
      )
      setRegistered({ ...(devices.find((device) => device.device_id === id) as CameraDevice),
        camera_token: result.camera_token, pairing_code: '' })
      setPage('add-device')
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Could not reset camera link')
    }
  }
  const cameraUrl = registered?.camera_token
    ? new URL(`/camera/${registered.device_id}?token=${encodeURIComponent(registered.camera_token)}`, window.location.origin).toString()
    : ''

  if (cameraRoute) return <CameraPage />
  if (loading) return <main className="loading-page">Loading…</main>
  if (!user) return <LoginPage onSignInGoogle={signInGoogle} />
  return <div className="app-shell">
    <aside className="sidebar">
      <Brand />
      <div className="home-switcher"><span className="home-avatar">{(user.displayName || 'U')[0]}</span>
        <span><strong>{user.displayName || 'Account'}</strong><small>{user.email}</small></span></div>
      <p className="nav-label">MAIN MENU</p>
      <nav>
        <button className={page === 'dashboard' ? 'nav-link active' : 'nav-link'} onClick={() => setPage('dashboard')}><Home size={17} /> Overview</button>
        <button className={page === 'monitor' ? 'nav-link active' : 'nav-link'} onClick={() => setPage('monitor')}><Camera size={17} /> Live monitor</button>
        <button className={page === 'alerts' ? 'nav-link active' : 'nav-link'} onClick={() => { clearAlert(); setPage('alerts') }}><Bell size={17} /> Alerts {latestAlert && <span className="notification-dot" />}</button>
        <button className="nav-link" type="button" onClick={toggleAlertSound} aria-label={soundEnabled ? 'Mute alert sound' : 'Enable alert sound'} aria-pressed={soundEnabled}>
          {soundEnabled ? <Volume2 size={17} /> : <VolumeX size={17} />} Alert sound {soundEnabled ? 'on' : 'off'}
        </button>
        <button className={page === 'add-device' ? 'nav-link active' : 'nav-link'} onClick={() => setPage('add-device')}><Plus size={17} /> Add camera</button>
      </nav>
      <div className="sidebar-bottom"><div className="security-note"><ShieldCheck size={18} /><span><strong>{devices.filter((d) => d.stream).length} cameras live</strong><small>Firebase + YOLO</small></span></div>
        <button className="nav-link" onClick={() => void signOut()}><LogOut size={17} /> Sign out</button></div>
    </aside>
    <main className="main-content">
      <div className="mobile-header">
        <Brand />
        <nav className="mobile-nav" aria-label="Main navigation">
          <button aria-label="Overview" onClick={() => setPage('dashboard')}><Home size={19} /></button>
          <button aria-label="Live monitor" onClick={() => setPage('monitor')}><Camera size={19} /></button>
          <button aria-label="Alerts" onClick={() => { clearAlert(); setPage('alerts') }}><Bell size={19} /></button>
          <button aria-label={soundEnabled ? 'Mute alert sound' : 'Enable alert sound'} aria-pressed={soundEnabled} onClick={toggleAlertSound}>
            {soundEnabled ? <Volume2 size={19} /> : <VolumeX size={19} />}
          </button>
          <button aria-label="Add camera" onClick={() => setPage('add-device')}><Plus size={19} /></button>
          <button aria-label="Sign out" onClick={() => void signOut()}><LogOut size={19} /></button>
        </nav>
      </div>
      {latestAlert && <div className="web-alert" role="alert">
        <strong>⚠ Violence detected at {latestAlert.device_name}</strong>
        <button onClick={() => { clearAlert(); setPage('alerts') }}>View saved frame</button>
        <button onClick={clearAlert} aria-label="Dismiss alert">×</button>
      </div>}
      {error && <p className="session-error" role="alert">{error}</p>}
      {page === 'dashboard' && <>
        <header className="page-header"><div><p className="eyebrow">REAL-TIME SECURITY MONITORING</p>
          <h1>Hello, {user.displayName?.split(' ')[0] || 'there'}.</h1>
          <p className="muted">Live cameras and confirmed violence alerts.</p></div>
          <button className="primary-button compact" onClick={() => setPage('add-device')}><Smartphone size={16} /> Add camera</button>
        </header>
        <section className="overview-row"><div><p className="eyebrow">CAMERA LIST</p>
          <h2>All devices <span className="count-badge">{devices.length}</span></h2></div></section>
        <section className="camera-grid">
          {devices.map((device) => <DeviceCard key={device.device_id} device={device}
            onOpen={() => { setSelectedId(device.device_id); setPage('monitor') }} />)}
          <button className="add-camera-card" onClick={() => setPage('add-device')}><span><Plus size={22} /></span>
            <strong>Add a camera</strong><small>Connect a phone or pair a shared camera</small></button>
        </section>
      </>}
      {page === 'monitor' && <section className="monitor-page">
        <header className="page-header"><div><p className="eyebrow">LIVE MONITOR</p>
          <h1>{selected?.name || 'No camera selected'}</h1></div>
          <select value={selected?.device_id || ''} onChange={(event) => setSelectedId(event.target.value)}>
            {devices.map((device) => <option key={device.device_id} value={device.device_id}>{device.name}</option>)}
          </select></header>
        {selected ? <><CameraFeed device={selected} monitor />
          <p className="muted">{selected.location || selected.device_id} · {selected.stream || selected.frameJpeg || selected.state === 'online' ? 'Live' : 'Offline'}</p>
          <div className="monitor-actions">
            <button className="secondary-button" onClick={() => void shareDevice(selected.device_id)}>Share pairing code</button>
            <button className="secondary-button" onClick={() => void resetCameraLink(selected.device_id)}>Reset phone link</button>
          </div>
        </> : <p className="muted">Add a camera to start monitoring.</p>}
      </section>}
      {page === 'add-device' && <section className="add-device-page">
        <header className="page-header"><div><p className="eyebrow">DEVICE SETUP</p><h1>Add a camera</h1>
          <p className="muted">Create a phone camera or pair a camera shared with you.</p></div></header>
        <div className="setup-layout">
          <div className="device-setup-card">
            <h2>Create phone camera</h2>
            <form onSubmit={(event) => void createDevice(event)} className="device-form">
              <label>Camera name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Front door" maxLength={80} /></label>
              <label>Location<input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Entrance" maxLength={120} /></label>
              <button className="primary-button" disabled={busy}>Create camera</button>
            </form>
            {registered && <div className="pairing-box">
              {cameraUrl && <div><QRCodeSVG value={cameraUrl} size={160} /><p>Scan this QR code on the phone to start the camera.</p>
                <a href={cameraUrl} target="_blank" rel="noreferrer">Open camera link</a></div>}
              <div><strong>Share with viewers</strong><p>Camera ID: <code>{registered.device_id}</code></p>
                {registered.pairing_code && <p>Pairing code: <code>{registered.pairing_code}</code></p>}
                {registered.pairing_code && <small>Give both values to a viewer you trust. Generating a new code revokes the old code.</small>}</div>
            </div>}
          </div>
          <div className="device-setup-card"><h2>Pair shared camera</h2>
            <form onSubmit={(event) => void pairDevice(event)} className="device-form">
              <label>Camera ID<input value={pairId} onChange={(event) => setPairId(event.target.value)} required /></label>
              <label>Pairing code<input value={pairCode} onChange={(event) => setPairCode(event.target.value)} required /></label>
              <button className="primary-button" disabled={busy}>Pair camera</button>
            </form></div>
        </div>
        {formError && <p className="session-error" role="alert">{formError}</p>}
      </section>}
      {page === 'alerts' && <AlertsPage uid={user.uid} devices={devices} />}
    </main>
  </div>
}
