export const WS_BASE = import.meta.env.VITE_WS_URL ??
  `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
export const VIOLENCE_KEYWORDS = ['violence']
