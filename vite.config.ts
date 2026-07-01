import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        // Source file for Electron Main process
        entry: 'electron/main.ts',
      },
      {
        entry: 'electron/preload.ts',
        onconfigure(options) {
          // Notify the Renderer-process to reload the page when the Preload-script changes
          options.reload()
        },
      },
    ]),
    renderer(),
  ],
})
