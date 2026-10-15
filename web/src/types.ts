export type Page = 'login' | 'dashboard' | 'monitor' | 'add-device'
export type SessionState = 'idle' | 'waiting' | 'connected'
export type Device = { name: string; location: string; status: 'online' | 'offline'; image: string }
export type Detection = { class?: string; conf?: number; bbox?: [number, number, number, number] }
export type PairingSession = {
  session_id: string
  pairing_code: string
  camera_token: string
  viewer_token: string
  join_url: string
  expires_at: number
  state: string
}
