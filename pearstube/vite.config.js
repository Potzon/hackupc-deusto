import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  root: resolve(__dirname, 'ui-src'),
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    host: 'localhost'
  },
  build: {
    outDir: resolve(__dirname, 'ui-dist'),
    emptyOutDir: true
  }
})
