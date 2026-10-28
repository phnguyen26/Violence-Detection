import { useCallback, useEffect, useRef, useState } from 'react'
import { WS_BASE, VIOLENCE_KEYWORDS } from '../constants'
import { api } from '../api'
import { auth } from '../firebase'
import type { CameraDevice, Detection } from '../types'

type Connection = {
  ws: WebSocket
  peer: RTCPeerConnection | null
  pendingIce: RTCIceCandidateInit[]
  sessionId: string
}

export function useDevices(uid: string | undefined) {
  const [devices, setDevices] = useState<CameraDevice[]>([])
  const [deviceOwner, setDeviceOwner] = useState<string | undefined>()
  const [error, setError] = useState('')
  const [latestAlert, setLatestAlert] = useState<{
    uid: string; id: string; device_name: string
  } | null>(null)
  const connections = useRef(new Map<string, Connection>())
  const refreshNow = useRef<() => void>(() => undefined)

  const patch = useCallback((id: string, change: Partial<CameraDevice>) => {
    setDevices((old) => old.map((item) => item.device_id === id ? { ...item, ...change } : item))
  }, [])

  useEffect(() => {
    if (!uid) return
    let active = true
    const activeConnections = connections.current
    const connect = async (device: CameraDevice) => {
      if (!device.session_id) return
      const token = await auth.currentUser?.getIdToken()
      if (!active || !token || !device.session_id) return
      const ws = new WebSocket(
        `${WS_BASE}/ws/sessions/${device.session_id}?role=viewer&id_token=${encodeURIComponent(token)}`,
      )
      const connection: Connection = { ws, peer: null, pendingIce: [], sessionId: device.session_id }
      activeConnections.set(device.device_id, connection)
      ws.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data as string)
          if (message.type === 'session_state') {
            if (!message.camera_connected) {
              connection.peer?.close()
              connection.peer = null
              patch(device.device_id, {
                state: 'offline', stream: null, frameJpeg: null, detections: [], violenceDetected: false,
              })
            } else {
              patch(device.device_id, { state: 'online' })
            }
          }
          if (message.type === 'offer') {
            connection.peer?.close()
            const peer = new RTCPeerConnection({
              iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
            })
            connection.peer = peer
            peer.onicecandidate = (candidate) => {
              if (candidate.candidate && ws.readyState === WebSocket.OPEN)
                ws.send(JSON.stringify({ type: 'ice', data: candidate.candidate }))
            }
            peer.ontrack = (track) => patch(device.device_id, {
              stream: track.streams[0] ?? new MediaStream([track.track]),
              state: 'online',
            })
            peer.onconnectionstatechange = () => {
              if (peer.connectionState === 'failed' || peer.connectionState === 'closed')
                patch(device.device_id, { stream: null })
            }
            await peer.setRemoteDescription(message.data as RTCSessionDescriptionInit)
            for (const ice of connection.pendingIce.splice(0)) await peer.addIceCandidate(ice)
            const answer = await peer.createAnswer()
            await peer.setLocalDescription(answer)
            ws.send(JSON.stringify({ type: 'answer', data: peer.localDescription }))
          }
          if (message.type === 'ice') {
            if (connection.peer?.remoteDescription) await connection.peer.addIceCandidate(message.data)
            else connection.pendingIce.push(message.data)
          }
          if (message.type === 'detections') {
            const detections = (message.data.detections ?? []) as Detection[]
            patch(device.device_id, {
              detections,
              frameWidth: message.data.width,
              frameHeight: message.data.height,
              frameJpeg: message.data.frame_jpeg ?? null,
              violenceDetected: detections.some((box) => VIOLENCE_KEYWORDS.some(
                (word) => box.class.toLowerCase().includes(word),
              )),
            })
          }
          if (message.type === 'alert') setLatestAlert({ ...message.data, uid })
        } catch (cause) {
          console.error('Camera signaling failed', cause)
        }
      }
      ws.onclose = () => {
        if (activeConnections.get(device.device_id) === connection) {
          activeConnections.delete(device.device_id)
          connection.peer?.close()
          patch(device.device_id, { stream: null, frameJpeg: null, state: 'offline' })
        }
      }
    }
    const refresh = async () => {
      try {
        const next = await api<CameraDevice[]>('/api/users/me/devices')
        if (!active) return
        setError('')
        setDeviceOwner(uid)
        setDevices((old) => next.map((item) => ({
          ...old.find((previous) => previous.device_id === item.device_id),
          ...item,
          state: item.state,
        })))
        for (const item of next) {
          const current = activeConnections.get(item.device_id)
          if (current && current.sessionId !== item.session_id) {
            current.ws.close()
            current.peer?.close()
            activeConnections.delete(item.device_id)
          }
          if (item.session_id && !activeConnections.has(item.device_id)) void connect(item)
        }
        for (const [id, connection] of activeConnections)
          if (!next.some((item) => item.device_id === id)) {
            connection.ws.close()
            connection.peer?.close()
            activeConnections.delete(id)
          }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load cameras')
      }
    }
    refreshNow.current = () => void refresh()
    void refresh()
    const interval = window.setInterval(() => void refresh(), 10000) /* Refresh every 10 seconds */
    return () => {
      active = false
      window.clearInterval(interval)
      for (const connection of activeConnections.values()) {
        connection.ws.close()
        connection.peer?.close()
      }
      activeConnections.clear()
    }
  }, [uid, patch])

  return {
    devices: deviceOwner === uid ? devices : [],
    error,
    latestAlert: latestAlert?.uid === uid ? latestAlert : null,
    refresh: () => refreshNow.current(),
    clearAlert: () => setLatestAlert(null),
  }
}
