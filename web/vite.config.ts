import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ['committee-gst-occur-col.trycloudflare.com'],
    hmr: {
      protocol: 'wss',
      host: 'committee-gst-occur-col.trycloudflare.com',
      clientPort: 443,
    },
    proxy: {
      '/api': 'http://localhost:8765',
      '/ws': {
        target: 'ws://localhost:8765',
        ws: true,
      },
    },
  },
})
