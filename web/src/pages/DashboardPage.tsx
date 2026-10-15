import type { RefObject } from 'react'
import {
  AlertTriangle,
  Bell,
  ChevronRight,
  Grid2X2,
  LayoutGrid,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  Smartphone,
} from 'lucide-react'
import { Brand } from '../components/Brand'
import { CameraCard } from '../components/CameraCard'
import { devices } from '../constants'
import type { Detection, SessionState } from '../types'

interface DashboardPageProps {
  videoRef: RefObject<HTMLVideoElement | null>
  remoteStream: MediaStream | null
  serverFrame: string
  sessionState: SessionState
  detections: Detection[]
  violenceDetected: boolean
  onViewLive: () => void
  onAddDevice: () => void
}

export function DashboardPage({
  videoRef,
  remoteStream,
  serverFrame,
  sessionState,
  detections,
  violenceDetected,
  onViewLive,
  onAddDevice,
}: DashboardPageProps) {
  const isLive = sessionState === 'connected'

  return (
    <>
      {/* Mobile top bar */}
      <div className="mobile-header">
        <button className="icon-button">
          <Menu size={20} />
        </button>
        <Brand />
        <button className="icon-button">
          <Bell size={18} />
        </button>
      </div>

      {/* Page header */}
      <header className="page-header">
        <div>
          <p className="eyebrow">REAL-TIME SECURITY MONITORING</p>
          <h1>Hello, Jordan.</h1>
          <p className="muted">Automated AI violence detection with high-speed video streaming (30+ FPS).</p>
        </div>
        <div className="header-actions">
          <button className="search-button">
            <Search size={16} /> Search
          </button>
          <button className="primary-button compact" onClick={onAddDevice}>
            <Smartphone size={16} /> Connect phone
          </button>
        </div>
      </header>

      {/* Camera grid header */}
      <section className="overview-row">
        <div>
          <p className="eyebrow">CAMERA LIST</p>
          <h2>
            All devices <span className="count-badge">3</span>
          </h2>
        </div>
        <div className="view-switcher">
          <button className="selected">
            <Grid2X2 size={15} />
          </button>
          <button>
            <LayoutGrid size={15} />
          </button>
        </div>
      </section>

      {/* Camera cards */}
      <section className="camera-grid">
        {devices.map((device, index) => (
          <CameraCard
            key={device.name}
            device={device}
            videoRef={index === 0 ? videoRef : undefined}
            remoteStream={index === 0 ? remoteStream : null}
            serverFrame={index === 0 ? serverFrame : ''}
            isLive={index === 0 && isLive}
            detections={index === 0 ? detections : []}
            violenceDetected={index === 0 && violenceDetected}
            onViewLive={onViewLive}
          />
        ))}

        <button className="add-camera-card" onClick={onAddDevice}>
          <span>
            <Plus size={22} />
          </span>
          <strong>Connect a new phone</strong>
          <small>Live camera stream at 30 FPS</small>
        </button>
      </section>

      {/* Summary & alert panels */}
      <section className="dashboard-lower">
        <div className="summary-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">ACTIVITY OVERVIEW</p>
              <h3>AI detection status</h3>
            </div>
            <button className="icon-button">
              <MoreHorizontal size={18} />
            </button>
          </div>
          <div className="metric-row">
            <div className="metric">
              <span className="metric-number">{detections.length}</span>
              <span>Detections</span>
            </div>
            <div className="metric">
              <span className="metric-number" style={{ color: violenceDetected ? '#ef4444' : undefined }}>
                {violenceDetected ? 1 : 0}
              </span>
              <span>Violence alerts</span>
            </div>
            <div className="metric">
              <span className="metric-number">{remoteStream ? '30 FPS' : isLive ? 'Live' : '—'}</span>
              <span>Stream rate</span>
            </div>
          </div>
        </div>

        <div className="alert-panel" onClick={onViewLive} style={{ cursor: 'pointer' }}>
          <div
            className="alert-icon"
            style={violenceDetected ? { background: '#fef2f2', color: '#ef4444' } : undefined}
          >
            <AlertTriangle size={18} />
          </div>
          <div>
            <p className="eyebrow">
              {isLive ? (violenceDetected ? 'EMERGENCY ALERT' : 'CAMERA STREAMING AT 30 FPS') : 'WAITING FOR CONNECTION'}
            </p>
            <h3>
              {violenceDetected
                ? 'Violent behavior detected at Front Door!'
                : isLive
                  ? 'Camera is streaming smoothly'
                  : 'No phone camera connected'}
            </h3>
            <p>
              {isLive
                ? 'Live video is streaming from the phone with real-time YOLO bounding boxes.'
                : 'Click Connect phone to scan the QR code and stream video.'}
            </p>
          </div>
          <ChevronRight size={17} />
        </div>
      </section>
    </>
  )
}
