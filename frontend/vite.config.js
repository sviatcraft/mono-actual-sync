import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  server: {
    proxy: {
      // Local dev convenience: keep frontend calling `/api/*` and proxy to Express.
      '/api': 'http://localhost:9191',
    },
  },
})
