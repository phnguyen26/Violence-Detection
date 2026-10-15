import { Camera, ChevronRight, Copy, QrCode, Wifi } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import type { Page, PairingSession, SessionState } from '../types'

interface AddDevicePageProps {
  session: PairingSession | null
  sessionState: SessionState
  sessionError: string
  onStart: () => void
  onStop: () => void
  copied: boolean
  onCopy: () => void
  setPage: (page: Page) => void
}

export function AddDevicePage({
  session,
  sessionState,
  sessionError,
  onStart,
  onStop,
  copied,
  onCopy,
  setPage,
}: AddDevicePageProps) {
  return (
    <section className="add-device-page">
      {/* Back button and page heading */}
      <div className="subpage-heading">
        <button className="back-button" onClick={() => setPage('dashboard')}>
          <ChevronRight size={16} /> Back to dashboard
        </button>
        <p className="eyebrow">DEVICE SETUP</p>
        <h1>Connect a phone camera</h1>
        <p className="muted">Turn your smartphone into a live AI security camera.</p>
      </div>

      <div className="setup-layout">
        {/* Step Guide */}
        <div className="setup-steps">
          <div className={`setup-step ${!session ? 'active' : 'completed'}`}>
            <span className="step-num">01</span>
            <div className="step-info">
              <strong>Create a connection session</strong>
              <small>Generate a temporary WebSocket pairing code.</small>
            </div>
          </div>
          <div
            className={`setup-step ${
              session && sessionState !== 'connected' ? 'active' : session ? 'completed' : ''
            }`}
          >
            <span className="step-num">02</span>
            <div className="step-info">
              <strong>Open on your phone</strong>
              <small>Scan the QR code with your phone camera.</small>
            </div>
          </div>
          <div className={`setup-step ${sessionState === 'connected' ? 'active' : ''}`}>
            <span className="step-num">03</span>
            <div className="step-info">
              <strong>AI violence detection</strong>
              <small>Video and bounding boxes appear on the dashboard.</small>
            </div>
          </div>
        </div>

        {/* Main interactive setup card */}
        <div className="device-setup-card">
          <div className="setup-illustration">
            <Camera size={34} />
            <span className="illustration-badge">
              <Wifi size={14} />
            </span>
          </div>

          <p className="eyebrow">{session ? 'CONNECTION SESSION ACTIVE' : 'READY TO CONNECT'}</p>
          <h2>{session ? 'Scan the QR code with your phone' : 'Connect a phone as a camera'}</h2>
          <p className="muted">
            {session
              ? 'Use your phone camera to scan the QR code below, or open the direct link.'
              : 'Your phone will stream video over WebSocket to the YOLO server for real-time violence detection.'}
          </p>

          {session ? (
            <div className="pairing-box">
              {/* QR Code Container */}
              <div className="pairing-qr-wrapper">
                <div className="qr-box">
                  <QRCodeSVG
                    value={new URL(session.join_url, window.location.origin).toString()}
                    size={160}
                    level="M"
                    includeMargin={false}
                  />
                </div>
                <span className="qr-hint">
                  <QrCode size={13} /> Scan with your phone camera
                </span>
              </div>

              {/* Pairing Code & Direct Action */}
              <div className="pairing-details">
                <div className="pairing-code-label">OR ENTER THE CODE ON YOUR PHONE</div>
                <div className="pairing-code-group">
                  <span className="pairing-code-text">{session.pairing_code}</span>
                  <button className="copy-button" onClick={onCopy} type="button" title="Copy code">
                    <Copy size={14} />
                    <span>{copied ? 'Copied!' : 'Copy code'}</span>
                  </button>
                </div>

                <a
                  className="open-link-button"
                  href={new URL(session.join_url, window.location.origin).toString()}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>Open live camera page</span>
                  <ChevronRight size={14} />
                </a>

                <div className={`pairing-state-badge ${sessionState}`}>
                  <span className="pulse-dot" />
                  <span>
                    {sessionState === 'connected'
                      ? 'Camera connected successfully!'
                      : 'Waiting for the phone camera to connect...'}
                  </span>
                </div>

                {sessionState === 'connected' && (
                  <button
                    className="primary-button"
                    onClick={() => setPage('monitor')}
                    style={{ marginTop: '10px' }}
                  >
                    View live monitor <ChevronRight size={16} />
                  </button>
                )}
              </div>
            </div>
          ) : (
            <button className="primary-button next-button" onClick={onStart} type="button">
              <Camera size={16} /> Create a connection session
            </button>
          )}

          {sessionError && (
            <p className="session-error" role="alert">
              {sessionError}
            </p>
          )}

          {session && (
            <button className="stop-link" onClick={onStop} type="button">
              End connection session
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
