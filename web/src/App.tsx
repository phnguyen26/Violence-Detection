import { useRef, useState } from 'react'
import './App.css'
import type { Detection, Page, PairingSession, SessionState } from './types'
import { API_BASE, VIOLENCE_KEYWORDS, WS_BASE } from './constants'
import { Sidebar } from './components/Sidebar'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { AddDevicePage } from './pages/AddDevicePage'
import { MonitorPage } from './pages/MonitorPage'
import { CameraPage } from './pages/CameraPage'
import { DeviceJoinPage } from './pages/DeviceJoinPage'
import { useAuth } from './hooks/useAuth'

export default function App() {
  const cameraRoute = window.location.pathname.startsWith('/camera/')
  const deviceRoute = window.location.pathname === '/device'

  const { user, loading: authLoading, signInGoogle, signOut } = useAuth()

  const [page, setPage] = useState<Page>('dashboard')
  const [session, setSession] = useState<PairingSession | null>(null)
  const [sessionState, setSessionState] = useState<SessionState>('idle')
  const [sessionError, setSessionError] = useState('')
  const [copied, setCopied] = useState(false)
  const [detections, setDetections] = useState<Detection[]>([])
  const [violenceDetected, setViolenceDetected] = useState(false)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [serverFrame, setServerFrame] = useState('')

  // Video and WebRTC refs for 30+ FPS stream
  const videoRef = useRef<HTMLVideoElement>(null)
  const viewerWsRef = useRef<WebSocket | null>(null)
  const peerRef = useRef<RTCPeerConnection | null>(null)
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([])


  const createViewerPeer = () => {
    const peer = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    })

    peer.onicecandidate = (event) => {
      if (event.candidate && viewerWsRef.current?.readyState === WebSocket.OPEN) {
        viewerWsRef.current.send(
          JSON.stringify({ type: 'ice', data: event.candidate }),
        )
      }
    }

    peer.ontrack = (event) => {
      const stream = event.streams[0]
      setRemoteStream(stream)
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        void videoRef.current.play().catch(() => undefined)
      }
      setSessionState('connected')
    }

    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') {
        setSessionState('connected')
      }
      if (
        peer.connectionState === 'failed' ||
        peer.connectionState === 'disconnected'
      ) {
        setSessionState('waiting')
      }
    }

    peerRef.current = peer
    return peer
  }

  // Viewer WebSocket (WebRTC signaling + YOLO detections)
  const connectViewer = (created: PairingSession) => {
    if (viewerWsRef.current) {
      viewerWsRef.current.close()
    }
    peerRef.current?.close()
    peerRef.current = null
    pendingIceRef.current = []

    const ws = new WebSocket(
      `${WS_BASE}/ws/sessions/${created.session_id}?role=viewer&token=${created.viewer_token}`,
    )
    viewerWsRef.current = ws

    ws.onopen = () => {
      setSessionState('waiting')
    }

    ws.onmessage = async (event) => {
      try {
        // if (event.data instanceof ArrayBuffer) {
        //   const blob = new Blob([event.data], { type: 'image/jpeg' })
        //   setServerFrame(URL.createObjectURL(blob))
        //   setSessionState('connected')
        //   return
        // }

        const message = JSON.parse(event.data as string) as {
          type?: string
          camera_connected?: boolean
          data?: unknown
        }

        // WebRTC SDP Offer 
        if (message.type === 'offer' && message.data) {
          const peer = peerRef.current ?? createViewerPeer()
          await peer.setRemoteDescription(message.data as RTCSessionDescriptionInit)
          for (const candidate of pendingIceRef.current.splice(0)) {
            await peer.addIceCandidate(candidate)
          }
          const answer = await peer.createAnswer()
          await peer.setLocalDescription(answer)
          ws.send(JSON.stringify({ type: 'answer', data: answer }))
          return
        }

        // WebRTC ICE Candidate
        if (message.type === 'ice' && message.data) {
          const candidate = message.data as RTCIceCandidateInit
          if (peerRef.current?.remoteDescription) {
            await peerRef.current.addIceCandidate(candidate)
          } else { // ice before sdp
            pendingIceRef.current.push(candidate)
          }
          return
        }

        // // Live frame fallback (nếu WebRTC bị chặn)
        // if (message.type === 'frame' && message.data) {
        //   setServerFrame('data:image/jpeg;base64,' + (message.data as string))
        //   setSessionState('connected')
        //   return
        // }

        // Session state update
        if (message.type === 'session_state') {
          if (!(message as { camera_connected?: boolean }).camera_connected) {
            setSessionState('waiting')
          }
        }

        // YOLO detections 
        if (message.type === 'detections' && message.data) {
          const det = message.data as {
            detections?: Detection[]
            raw_detections?: Detection[]
          }
          const next = det.detections?.length ? det.detections : det.raw_detections ?? []
          setDetections(next)
          setViolenceDetected(
            next.some((d) =>
              VIOLENCE_KEYWORDS.some((kw) => (d.class ?? '').toLowerCase().includes(kw)),
            ),
          )
        }
      } catch (err) {
        console.error('Viewer Websocket error', err)
      }
    }

    ws.onerror = () => {
      setSessionError('Can\'t connect to server Websocket')
    }

    ws.onclose = () => {
      if (sessionState !== 'connected') {
        setSessionState('idle')
      }
    }
  }

  const startPairing = async () => {
    setSessionError('')
    try {
      const response = await fetch(`${API_BASE}/api/sessions`, { method: 'POST' })
      if (!response.ok) throw new Error()
      const created = (await response.json()) as PairingSession
      setSession(created)
      setPage('add-device')
      connectViewer(created)
    } catch {
      setSessionError('Server it not ready yet.')
    }
  }

  const stopPairing = async () => {
    if (session) {
      await fetch(`${API_BASE}/api/sessions/${session.session_id}`, {
        method: 'DELETE',
      }).catch(() => undefined)
    }
    viewerWsRef.current?.close()
    viewerWsRef.current = null
    peerRef.current?.close()
    peerRef.current = null
    pendingIceRef.current = []
    setRemoteStream(null)
    setSession(null)
    setSessionState('idle')
    setDetections([])
    setViolenceDetected(false)
    setServerFrame('')
  }

  const copyPairingCode = async () => {
    if (session) await navigator.clipboard?.writeText(session.pairing_code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  // --- Routes ---
  if (cameraRoute) return <CameraPage />
  if (deviceRoute) return <DeviceJoinPage />

  // Wait for Firebase to restore the persisted auth session.
  if (authLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '12px', color: 'var(--muted, #888)' }}>
        <svg width="20" height="20" viewBox="0 0 24 24" style={{ animation: 'spin 1s linear infinite' }}>
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" strokeDasharray="32" strokeDashoffset="10" />
        </svg>
        Loading…
      </div>
    )
  }

  // Not logged in — show Google Sign-In
  if (!user) {
    return <LoginPage onSignInGoogle={signInGoogle} />
  }

  return (
    <div className="app-shell">
      <Sidebar
        page={page}
        setPage={setPage}
        onLogout={async () => {
          await stopPairing()
          await signOut()
        }}
        sessionState={sessionState}
        user={user}
      />
      <main className="main-content">
        {page === 'dashboard' ? (
          <DashboardPage
            displayName={user.displayName?.split(' ')[0] ?? 'there'}
            videoRef={videoRef}
            remoteStream={remoteStream}
            serverFrame={serverFrame}
            sessionState={sessionState}
            detections={detections}
            violenceDetected={violenceDetected}
            onViewLive={() => setPage('monitor')}
            onAddDevice={() => void startPairing()}
          />
        ) : page === 'monitor' ? (
          <MonitorPage
            videoRef={videoRef}
            remoteStream={remoteStream}
            sessionState={sessionState}
            detections={detections}
            violenceDetected={violenceDetected}
            onAddDevice={() => void startPairing()}
            onBack={() => setPage('dashboard')}
          />
        ) : (
          <AddDevicePage
            session={session}
            sessionState={sessionState}
            sessionError={sessionError}
            onStart={() => void startPairing()}
            onStop={() => void stopPairing()}
            copied={copied}
            onCopy={() => void copyPairingCode()}
            setPage={setPage}
          />
        )}
      </main>
    </div>
  )
}
