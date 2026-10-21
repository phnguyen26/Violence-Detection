export type Page = 'dashboard' | 'monitor' | 'add-device' | 'alerts'
export type Detection = { class: string; conf: number; bbox: [number, number, number, number] }
export type CameraDevice = {
  device_id: string
  name: string
  location: string
  session_id: string | null
  state: 'online' | 'offline'
  stream?: MediaStream | null
  detections?: Detection[]
  frameWidth?: number
  frameHeight?: number
  violenceDetected?: boolean
}
export type Alert = {
  id: string
  device_id: string
  device_name: string
  timestamp: string
  confidence: number
  detection_class: string
  thumbnail_b64: string
  boxes: Detection[]
  acknowledged_by: string[]
}
export type RegisteredDevice = CameraDevice & { camera_token: string; pairing_code: string }
