import { useEffect, useRef, useState } from 'react'
import { SwitchCamera } from 'lucide-react'
import { Brand } from '../components/Brand'
import { WS_BASE } from '../constants'

export function CameraPage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const signalRef = useRef<WebSocket | null>(null)
  const frameRef = useRef<WebSocket | null>(null)
  const peerRef = useRef<RTCPeerConnection | null>(null)
  const timerRef = useRef<number | null>(null)
  const sendingRef = useRef(false)

  const [status, setStatus] = useState('Initializing camera...')
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment')
  const [frameCount, setFrameCount] = useState(0)

  const sessionId = window.location.pathname.match(/^\/camera\/([^/]+)/)?.[1]
  const token = new URLSearchParams(window.location.search).get('token')

  const toggleCamera = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))
  }

  useEffect(() => {
    if (!sessionId || !token) {
      setStatus('Invalid camera link')
      return
    }

    let stopped = false

    const start = async () => {
      try {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop())
        }

        // Yêu cầu camera tốc độ 30-60 FPS
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30, max: 60 },
          },
          audio: false,
        })

        if (stopped) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }

        streamRef.current = stream

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }

        // 1. Signaling WebSocket để stream video tốc độ cao (30-60 FPS) qua WebRTC
        const signal = new WebSocket(
          `${WS_BASE}/ws/sessions/${sessionId}?role=camera&token=${token}`,
        )
        signalRef.current = signal

        signal.onopen = () => {
          setStatus('Waiting for computer to connect...')
        }

        signal.onmessage = async (event) => {
          try {
            const message = JSON.parse(event.data) as {
              type?: string
              viewer_count?: number
              data?: RTCSessionDescriptionInit | RTCIceCandidateInit
            }

            if (message.type === 'session_state' && message.viewer_count && !peerRef.current) {
              const peer = new RTCPeerConnection({
                iceServers: [
                  { urls: 'stun:stun.l.google.com:19302' },
                  { urls: 'stun:stun1.l.google.com:19302' },
                ],
              })
              peerRef.current = peer

              stream.getTracks().forEach((track) => peer.addTrack(track, stream))

              peer.onicecandidate = (candidate) => {
                if (candidate.candidate && signal.readyState === WebSocket.OPEN) {
                  signal.send(JSON.stringify({ type: 'ice', data: candidate.candidate }))
                }
              }

              const offer = await peer.createOffer()
              await peer.setLocalDescription(offer)
              signal.send(JSON.stringify({ type: 'offer', data: offer }))
              setStatus('Streaming video at 30+ FPS')
            }

            if (message.type === 'answer' && message.data && peerRef.current) {
              await peerRef.current.setRemoteDescription(
                message.data as RTCSessionDescriptionInit,
              )
            }

            if (message.type === 'ice' && message.data && peerRef.current) {
              await peerRef.current.addIceCandidate(
                message.data as RTCIceCandidateInit,
              )
            }
          } catch (e) {
            console.error('Signaling error:', e)
          }
        }

        signal.onerror = () => {
          setStatus('Server connection error')
        }

        // 2. Frame WebSocket để gửi frames định kỳ phục vụ YOLO AI inference
        const frame = new WebSocket(
          `${WS_BASE}/ws/sessions/${sessionId}/frames?role=camera&token=${token}`,
        )
        frameRef.current = frame

        frame.onopen = () => {
          const canvas = document.createElement('canvas')
          canvas.width = 640
          canvas.height = 480
          const context = canvas.getContext('2d')

          // Gửi frame cho YOLO AI ở tốc độ tối ưu (~20 FPS / 50ms)
          timerRef.current = window.setInterval(() => {
            if (
              sendingRef.current ||
              frame.readyState !== WebSocket.OPEN ||
              !videoRef.current ||
              videoRef.current.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
              !context
            ) {
              return
            }

            sendingRef.current = true
            context.drawImage(videoRef.current, 0, 0, 640, 480)
            canvas.toBlob(
              (blob) => {
                if (!blob || frame.readyState !== WebSocket.OPEN) {
                  sendingRef.current = false
                  return
                }

                void blob.arrayBuffer().then((buffer) => {
                  if (frame.readyState === WebSocket.OPEN) {
                    try {
                      frame.send(buffer)
                      setFrameCount((prev) => prev + 1)
                    } catch {
                      // ignore
                    }
                  }
                  sendingRef.current = false
                })
              },
              'image/jpeg',
              0.7,
            )
          }, 50) //20fps
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unable to access camera'
        setStatus(`Camera error: ${msg}`)
      }
    }

    void start()

    return () => {
      stopped = true
      if (timerRef.current) window.clearInterval(timerRef.current)
      streamRef.current?.getTracks().forEach((track) => track.stop())
      signalRef.current?.close()
      frameRef.current?.close()
      peerRef.current?.close()
      peerRef.current = null
    }
  }, [sessionId, token, facingMode])

  return (
    <main className="camera-page">
      <Brand />

      <div className="phone-preview">
        <video ref={videoRef} autoPlay muted playsInline />
        <div className="phone-overlay">
          <span className="live-tag">
            <i /> {status}
          </span>
          <span>Frames: {frameCount}</span>
        </div>
      </div>

      <div style={{ marginTop: '16px', display: 'flex', gap: '12px', justifyContent: 'center' }}>
        <button
          className="secondary-button"
          onClick={toggleCamera}
          style={{
            background: 'rgba(255,255,255,0.1)',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.2)',
          }}
        >
          <SwitchCamera size={16} /> Switch camera ({facingMode === 'environment' ? 'Rear' : 'Front'})
        </button>
      </div>

      <h1>Phone camera</h1>
      <p>Stream live video at 30 FPS from your camera to the computer with instant violence detection.</p>

      <div className="camera-page-status">
        <span className="status-dot" /> {status}
      </div>
    </main>
  )
}
