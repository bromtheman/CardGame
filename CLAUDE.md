# FTD Card Game — agent guide

Turn-based companion card game for From The Depths. React SPA (Vite) + Supabase
backend (remote-only — there is no local Supabase stack). The design spec at
`docs/superpowers/specs/2026-08-24-ftd-card-game-design.md` is **binding**: game
rules, costs, and flows come from it, not from guesswork.

## Layout

| Path | What lives there |
|---|---|
| `frontend/` | Vite + React 19 + TS strict SPA (Tailwind v4, TanStack Query v5, react-router) |
| `shared/` | Pure-TS game rules/types, imported by frontend AND edge functions |
| `supabase/` | Migrations, seed pipeline, edge functions (deployed remotely via MCP) |
| `docs/claude/` | Task-specific agent docs — read the relevant one before that kind of task |
| `docs/superpowers/` | Binding design spec + executed phase plans |

## Commands (run from repo root)

```bash
npx vitest run                      # all tests. NEVER pass --root — it silently runs 0 tests
npx tsc -p tsconfig.json --noEmit   # typecheck shared/ + supabase/seed (frontend has its own)
npm --prefix frontend run build     # frontend typecheck + production build
npm --prefix frontend run lint      # oxlint
npm run functions:sync              # copy shared/ modules into edge functions (see rule below)
```

Dev server: `npm --prefix frontend run dev` (port 5173; `.claude/launch.json` has a
`frontend` entry for the browser preview). Needs `frontend/.env.local` (see `.env.example`).

## Hard rules

- **Every commit touching `shared/` must include `npm run functions:sync` output.**
  A drift test (`supabase/seed/functionSharedSync.test.ts`) fails otherwise.
- **Relative imports inside `shared/` require the `.ts` extension** (Deno runs these
  files verbatim inside edge functions).
- **Consumers import `shared/engine/index.ts`, never individual engine modules** —
  the index's side-effect imports populate the handler/effect registries; skip it and
  registry-backed actions fail with "Unknown or not-yet-supported action".
- **Public `state.log` must never name a card in a hidden hand.** Log lines are
  visible to both players.
- Never commit secrets. Only the publishable anon key belongs in frontend env;
  run a secrets audit before any push (see docs/claude/workflow.md).

## Supabase (remote-only)

Project "FtD Card Game", ref `wpgsjnjnvykxavaxibld`. All DB/function work goes
through the Supabase MCP tools (`execute_sql`, `deploy_edge_function`, …) — there is
no local `supabase start`. Edge functions (`game-action`, `lobby-action`,
`create-card`) are deployed with `verify_jwt: false` and do their own auth + CORS.
Details: docs/claude/supabase.md.

## Task docs — read before starting the matching task

| Doc | Read when… |
|---|---|
| [docs/claude/architecture.md](docs/claude/architecture.md) | touching the game engine, state shape, actions, battles, or hero powers |
| [docs/claude/card-effects.md](docs/claude/card-effects.md) | adding/changing a card effect, keyword, or effect-driven UI |
| [docs/claude/supabase.md](docs/claude/supabase.md) | deploying functions, writing migrations, changing auth/RLS, debugging 4xx/5xx from functions |
| [docs/claude/frontend.md](docs/claude/frontend.md) | changing pages, realtime/reconnect behavior, dialogs, or query wiring |
| [docs/claude/testing.md](docs/claude/testing.md) | writing tests, running E2E against the live backend, browser verification |
| [docs/claude/workflow.md](docs/claude/workflow.md) | branching, merging, pushing, deploy sequencing, or picking up backlog work |
