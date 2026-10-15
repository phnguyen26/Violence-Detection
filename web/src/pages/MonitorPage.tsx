import { ChevronRight, Smartphone, Video, VideoOff, Wifi } from 'lucide-react'
import { useEffect, type RefObject } from 'react'
import type { Detection, SessionState } from '../types'

interface MonitorPageProps {
  videoRef: RefObject<HTMLVideoElement | null>
  remoteStream: MediaStream | null
  sessionState: SessionState
  detections: Detection[]
  violenceDetected: boolean
  onAddDevice: () => void
  onBack: () => void
}

export function MonitorPage({
  videoRef,
  remoteStream,
  sessionState,
  detections,
  violenceDetected,
  onAddDevice,
  onBack,
}: MonitorPageProps) {
  const isPhoneLive = sessionState === 'connected' && (!!remoteStream)
  const isLive = isPhoneLive 
  // Gắn luồng video 30-60 FPS vào thẻ video
  useEffect(() => {
    if (videoRef.current && remoteStream) {
      videoRef.current.srcObject = remoteStream
      void videoRef.current.play().catch(() => undefined)
    }
  }, [remoteStream, videoRef])

  return (
    <section className="monitor-page">
      {/* Top back button */}
      <button className="back-button" onClick={onBack}>
        <ChevronRight size={16} /> Back
      </button>

      {/* Monitor Header with Controls */}
      <div className="monitor-heading">
        <div>
          {/* <p className="eyebrow">HIGH-FPS STREAM / REALTIME YOLO</p> */}
          {/* <h1>Màn hình giám sát trực tiếp</h1> */}
          <p className="muted">
            {remoteStream
              ? 'Phone camera connected'
                  : 'Waitting for phone camera connect.'}
          </p>
        </div>

        {/* Action controls */}
        <div className="header-actions">

          <button className="primary-button compact" onClick={onAddDevice}>
            <Smartphone size={16} />
            <span>Connect to Phone</span>
          </button>

          <span className={`monitor-state ${isLive ? 'connected' : ''}`}>
            <i /> {remoteStream ? 'STREAMING' : isPhoneLive ? 'PHONE LIVE' : 'WAITING CAMERA'}
          </span>
        </div>
      </div>

      {/* Video Viewport Stage */}
      <div className="monitor-stage">
        {/* Case 1: High-FPS WebRTC Video Stream from Phone */}
        {remoteStream && (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
          />
        )}

        {/* Case 2: Empty state when neither phone nor webcam is connected */}
        {!isLive && (
          <div className="monitor-empty">
            <Wifi size={36} />
            <strong>Waiting for camera connection</strong>
            <span>Open the “Connect phone” page and scan the QR code to stream video at 30 FPS.</span>
            <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
              <button className="primary-button" onClick={onAddDevice}>
                <Smartphone size={16} /> Scan phone connection code
              </button>
            </div>
          </div>
        )}

        {/* Bounding boxes drawn on top of the live video stream */}
        {isLive &&
          detections.map((detection, index) => {
            const [x1, y1, x2, y2] = detection.bbox ?? [0, 0, 0, 0]
            const cls = (detection.class ?? '').toLowerCase()
            const isViolenceBox = ['violence'].some((kw) =>
              cls.includes(kw),
            )

            return (
              <div
                key={`${index}-${detection.class}`}
                className={isViolenceBox ? 'detection-box alert' : 'detection-box'}
                style={{
                  left: `${(x1 / 640) * 100}%`,
                  top: `${(y1 / 480) * 100}%`,
                  width: `${((x2 - x1) / 640) * 100}%`,
                  height: `${((y2 - y1) / 480) * 100}%`,
                }}
              >
                <span>
                  {detection.class ?? 'object'} {Math.round((detection.conf ?? 0) * 100)}%
                </span>
              </div>
            )
          })}

        {/* Violence warning overlay banner */}
        {isLive && violenceDetected && (
          <div className="camera-alert">⚠️ VIOLENCE DETECTED</div>
        )}

        {/* HUD top status bar */}
        {isLive && (
          <div className="monitor-hud">
            <span className="live-tag">
              <i /> {remoteStream ? 'LIVE STREAM 30 FPS' : 'LIVE FEED'}
            </span>
            <span>{detections.length} detections</span>
          </div>
        )}
      </div>

      {/* Detection inspector panel below video */}
      {isLive && detections.length > 0 && (
        <div style={{ marginTop: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {detections.map((d, i) => (
            <div
              key={i}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 12px',
                borderRadius: '8px',
                background: '#ffffff',
                border: '1px solid var(--border-subtle)',
                fontSize: '12px',
                fontFamily: 'var(--font-mono)',
              }}
            >
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: ['violence'].some((kw) =>
                    (d.class ?? '').toLowerCase().includes(kw),
                  )
                    ? '#ef4444'
                    : '#22c55e',
                }}
              />
              <strong>{d.class}</strong>
              <span style={{ color: 'var(--ink-muted)' }}>{Math.round((d.conf ?? 0) * 100)}%</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
