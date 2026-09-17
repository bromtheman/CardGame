import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) },
  },
  // The browser preview (.claude/launch.json, autoPort) hands a second worktree
  // a free port through PORT; a plain `npm run dev` still lands on 5173.
  server: { port: Number(process.env.PORT) || 5173 },
})
