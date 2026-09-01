import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

declare const process: { env: Record<string, string | undefined> }

export default defineConfig({
  plugins: [react()],
  base: process.env.OTA_WEB_BASE_PATH ?? '/',
  server: {
    port: 5180,
    proxy: {
      '/api': process.env.OTA_API_PROXY_TARGET ?? 'http://localhost:8091',
    },
  },
  preview: {
    port: 4180,
    proxy: {
      '/api': process.env.OTA_API_PROXY_TARGET ?? 'http://localhost:8091',
    },
  },
})
