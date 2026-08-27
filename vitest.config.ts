import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  // Mirrors frontend/vite.config.ts so frontend tests can import shared/ the
  // same way the app does.
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('./shared', import.meta.url)) },
  },
  test: {
    include: ['shared/**/*.test.ts', 'supabase/seed/**/*.test.ts', 'frontend/src/**/*.test.ts'],
    passWithNoTests: false,
  },
})
