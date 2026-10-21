import { useEffect, useRef, useState } from 'react'
import { SwitchCamera } from 'lucide-react'
import { Brand } from '../components/Brand'
import { WS_BASE } from '../constants'

type Peer = { peer: RTCPeerConnection; pendingIce: RTCIceCandidateInit[] }

export function CameraPage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState('Connecting camera...')
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const deviceId = window.location.pathname.match(/^\/camera\/([^/]+)/)?.[1]
  const cameraToken = new URLSearchParams(window.location.search).get('token')

  useEffect(() => {
    if (!deviceId || !cameraToken) {
      return
    }
    let stopped = false
    let signal: WebSocket | null = null
    let frames: WebSocket | null = null
    let stream: MediaStream | null = null
    let timer: number | null = null
    let retry: number | null = null
    const peers = new Map<string, Peer>()

    const closeSockets = () => {
      signal?.close()
      frames?.close()
      for (const connection of peers.values()) connection.peer.close()
      peers.clear()
      if (timer !== null) window.clearInterval(timer)
    }

    const connect = async () => {
      try {
        const registered = await fetch('/api/devices/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_id: deviceId, camera_token: cameraToken }),
        })
        if (!registered.ok) throw new Error('Camera registration failed')
        const { session_id } = await registered.json() as { session_id: string }
        if (stopped || !stream) return
        signal = new WebSocket(
          `${WS_BASE}/ws/sessions/${session_id}?role=camera&camera_token=${encodeURIComponent(cameraToken)}`,
        )
        signal.onopen = () => setStatus('Camera online')
        signal.onmessage = async (event) => {
          try {
            const message = JSON.parse(event.data as string)
            const viewerId = message.viewer_id as string
            if (message.type === 'viewer_joined' && !peers.has(viewerId)) {
              const peer = new RTCPeerConnection({
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
              })
              const connection: Peer = { peer, pendingIce: [] }
              peers.set(viewerId, connection)
              stream?.getTracks().forEach((track) => peer.addTrack(track, stream!))
              peer.onicecandidate = (candidate) => {
                if (candidate.candidate && signal?.readyState === WebSocket.OPEN)
                  signal.send(JSON.stringify({ type: 'ice', viewer_id: viewerId, data: candidate.candidate }))
              }
              const offer = await peer.createOffer()
              await peer.setLocalDescription(offer)
              signal?.send(JSON.stringify({ type: 'offer', viewer_id: viewerId, data: peer.localDescription }))
            }
            if (message.type === 'viewer_left') {
              peers.get(viewerId)?.peer.close()
              peers.delete(viewerId)
            }
            const connection = peers.get(viewerId)
            if (message.type === 'answer' && connection) {
              await connection.peer.setRemoteDescription(message.data as RTCSessionDescriptionInit)
              for (const ice of connection.pendingIce.splice(0)) await connection.peer.addIceCandidate(ice)
            }
            if (message.type === 'ice' && connection) {
              if (connection.peer.remoteDescription) await connection.peer.addIceCandidate(message.data)
              else connection.pendingIce.push(message.data)
            }
          } catch (cause) {
            console.error('Camera signaling failed', cause)
          }
        }
        signal.onclose = () => {
          if (stopped) return
          setStatus('Reconnecting...')
          closeSockets()
          retry = window.setTimeout(() => void connect(), 2000)
        }
        frames = new WebSocket(
          `${WS_BASE}/ws/sessions/${session_id}/frames?camera_token=${encodeURIComponent(cameraToken)}`,
        )
        const canvas = document.createElement('canvas')
        canvas.width = 640
        canvas.height = 480
        const context = canvas.getContext('2d')
        frames.onopen = () => {
          timer = window.setInterval(() => {
            if (!context || !videoRef.current || videoRef.current.readyState < 2 ||
                frames?.readyState !== WebSocket.OPEN || frames.bufferedAmount > 1_000_000) return
            context.drawImage(videoRef.current, 0, 0, 640, 480)
            canvas.toBlob((blob) => {
              if (blob && frames?.readyState === WebSocket.OPEN) frames.send(blob)
            }, 'image/jpeg', 0.7)
          }, 50) //20fps
        }
        frames.onclose = () => {
          if (!stopped && signal?.readyState === WebSocket.OPEN) signal.close()
        }
      } catch (cause) {
        setStatus(cause instanceof Error ? cause.message : 'Could not connect')
        if (!stopped) retry = window.setTimeout(() => void connect(), 3000)
      }
    }
    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        })
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        await connect()
      } catch (cause) {
        setStatus(cause instanceof Error ? cause.message : 'Camera access failed')
      }
    }
    void start()
    return () => {
      stopped = true
      if (retry !== null) window.clearTimeout(retry)
      closeSockets()
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [deviceId, cameraToken, facing])

  return (
    <main className="camera-page">
      <Brand />
      <div className="phone-preview">
        <video ref={videoRef} autoPlay muted playsInline />
        <div className="phone-overlay"><span className="live-tag"><i /> {deviceId && cameraToken ? status : 'Invalid camera link'}</span></div>
      </div>
      <button className="secondary-button" onClick={() => setFacing(
        facing === 'environment' ? 'user' : 'environment',
      )}><SwitchCamera size={16} /> Switch camera</button>
      <h1>Phone camera</h1>
      <p>{deviceId && cameraToken ? status : 'Invalid camera link'}</p>
    </main>
  )
}
