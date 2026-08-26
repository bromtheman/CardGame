import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['shared/**/*.test.ts', 'supabase/seed/**/*.test.ts', 'frontend/src/**/*.test.ts'],
    passWithNoTests: false,
  },
})
