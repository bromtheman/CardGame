# FTD Card Game

Turn-based card game companion for From The Depths. Design spec:
`docs/superpowers/specs/2026-08-24-ftd-card-game-design.md`.

## Layout
- `frontend/` — Vite + React SPA
- `shared/` — pure TS game constants/types (imported by frontend and edge functions)
- `supabase/` — migrations, seed pipeline, edge functions
- `supabase/functions/` — edge functions (create-card); `npm run functions:sync` refreshes their shared-module copies

## Setup
1. `npm install` (root tooling), then `cd frontend && npm install`
2. Copy `frontend/.env.example` to `frontend/.env.local` and fill in the Supabase URL + publishable key
3. `cd frontend && npm run dev`

## Tests
`npm test` (root: shared + seed pipeline). Includes a drift-guard test
(`supabase/seed/functionSharedSync.test.ts`) that fails if the edge
function's copied shared modules fall out of sync with `shared/`.
