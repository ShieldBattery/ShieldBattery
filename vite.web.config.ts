import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/engine.io': {
        target: 'ws://localhost:3000',
        ws: true,
        rewriteWsOrigin: true,
      },
    },
  },
  plugins: [react()],
  // NOTE(tec27): In production this will be replaced with a real value
  html: {
    cspNonce: '{SERVER-CSP-NONCE}',
  },
})
