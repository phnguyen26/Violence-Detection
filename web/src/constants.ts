import type { Device } from './types'

export const API_BASE = import.meta.env.VITE_API_URL ?? ''
export const WS_BASE =
  import.meta.env.VITE_WS_URL ??
  `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
export const WS_URL = `${WS_BASE}/ws`

export const VIOLENCE_KEYWORDS = ['violence']

export const devices: Device[] = [
  {
    name: 'Front Door',
    location: 'Entrance',
    status: 'online',
    image: 'https://images.unsplash.com/photo-1558008258-3256797b43f3?auto=format&fit=crop&w=1200&q=80',
  },
  {
    name: 'Living Room',
    location: 'Indoor',
    status: 'online',
    image: 'https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?auto=format&fit=crop&w=1200&q=80',
  },
  {
    name: 'Backyard',
    location: 'Outdoor',
    status: 'offline',
    image: 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=1200&q=80',
  },
]
