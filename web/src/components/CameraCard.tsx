import { Camera, ChevronRight, MoreHorizontal, Wifi } from 'lucide-react'
import { useEffect, type RefObject } from 'react'
import type { Detection, Device } from '../types'

interface CameraCardProps {
  device: Device
  videoRef?: RefObject<HTMLVideoElement | null>
  remoteStream?: MediaStream | null
  serverFrame?: string
  isLive: boolean
  detections: Detection[]
  violenceDetected: boolean
  onViewLive: () => void
}

export function CameraCard({
  device,
  videoRef,
  remoteStream,
  serverFrame,
  isLive,
  detections,
  violenceDetected,
  onViewLive,
}: CameraCardProps) {
  useEffect(() => {
    if (videoRef?.current && remoteStream) {
      videoRef.current.srcObject = remoteStream
      void videoRef.current.play().catch(() => undefined)
    }
  }, [remoteStream, videoRef])

  return (
    <article className="camera-card">
      {/* Header */}
      <div className="camera-card-head">
        <div className="camera-title">
          <span className={`camera-status ${isLive ? 'online' : device.status}`} />
          <span>
            <strong>{device.name}</strong>
            <small>{device.location}</small>
          </span>
        </div>
        <button className="icon-button" aria-label={`${device.name} options`}>
          <MoreHorizontal size={18} />
        </button>
      </div>

      {/* Image / High-FPS Video Stream */}
      <div
        className={`camera-image ${device.status === 'offline' ? 'is-offline' : ''} ${isLive ? 'has-video' : ''}`}
        style={{ backgroundImage: isLive ? undefined : `url(${device.image})` }}
      >
        {/* Live video feed at full 30-60 FPS */}
        {isLive &&
          (remoteStream ? (
            <video ref={videoRef} className="dashboard-video" autoPlay playsInline />
          ) : serverFrame ? (
            <img
              src={serverFrame}
              className="dashboard-video"
              style={{ objectFit: 'cover', width: '100%', height: '100%' }}
              alt="Live camera stream"
            />
          ) : videoRef ? (
            <video ref={videoRef} className="dashboard-video" autoPlay playsInline muted />
          ) : null)}

        {/* Bounding boxes drawn on top of the live camera stream */}
        {isLive &&
          detections.map((detection, index) => {
            const [x1, y1, x2, y2] = detection.bbox ?? [0, 0, 0, 0]
            return (
              <div
                key={`${index}-${detection.class}`}
                className={violenceDetected ? 'detection-box alert' : 'detection-box'}
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

        {/* HUD top */}
        <div className="camera-image-top">
          <span className="live-tag">
            <i />
            {isLive ? 'LIVE STREAM' : device.status === 'online' ? 'STANDBY' : 'OFFLINE'}
          </span>
          <span className="camera-time">{remoteStream ? '30+ FPS' : 'Live'}</span>
        </div>

        {/* Offline overlay */}
        {device.status === 'offline' && (
          <div className="offline-message">
            <Wifi size={22} />
            <strong>Camera is offline</strong>
            <span>Check your connection</span>
          </div>
        )}

        {/* Violence alert */}
        {isLive && violenceDetected && (
          <div className="camera-alert">⚠️ Violence detected</div>
        )}

        {/* HUD bottom */}
        <div className="camera-image-bottom">
          <span>
            <Camera size={14} /> 640×480 HD
          </span>
          <span>{isLive ? `${detections.length} detections` : 'Ready'}</span>
        </div>
      </div>

      {/* Footer */}
      <div className="camera-card-foot">
        <span className="foot-location">
          {violenceDetected && isLive
            ? 'Detection alert!'
            : isLive
              ? 'YOLO realtime stream'
              : device.status === 'online'
                ? 'Ready to connect'
                : 'Last seen yesterday'}
        </span>
        <button className="view-button" onClick={onViewLive}>
          {isLive ? 'Open monitor' : 'View details'} <ChevronRight size={14} />
        </button>
      </div>
    </article>
  )
}
