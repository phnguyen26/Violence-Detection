import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'localhost:8765',
        changeOrigin: true,
      },
      '/ws': {
        target: 'https://phnguyencs-violence-detection.hf.space',
        ws: true,
        changeOrigin: true,
        secure: true
      },
    },
  },
})
