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
| `supabase/` | Migrations, seed pipeline, edge functions (deployed by script — see below) |
| `docs/claude/` | Task-specific agent docs — read the relevant one before that kind of task |
| `docs/superpowers/` | Binding design spec + executed phase plans |

## Shell

This machine is Windows. **Default to PowerShell syntax for every shell command**:
no `&&` chaining — use `;` or separate calls — and PowerShell's own cmdlets and
path quoting. Use bash syntax only inside WSL or an actual `.sh` script.

## Worktree / environment setup

A fresh worktree starts with **no `node_modules` and no env file**. Before any
build, test, or browser verification in one:

1. `npm install` in **both** the repo root and `frontend/` — they are separate
   package trees, and installing only one leaves the other's imports unresolved.
2. Copy `frontend/.env.local` from the main checkout (it is gitignored; see
   `frontend/.env.example` for the keys).
3. Confirm the dev server port before pointing anything at it (below).

**If a typecheck reports errors in the hundreds, suspect incomplete
`node_modules` before suspecting the code.** Missing `@types` and unresolved
imports fail at every use site, so one missing install reads as a catastrophic
regression.

## Browser verification

Vite is configured for port 5173 (`.claude/launch.json`), but it **increments to
the next free port when 5173 is taken** — which it routinely is when another
worktree is already serving. So a second worktree silently lands on 5174+.

Print the port the dev server actually bound to, and navigate to *that* exact
origin; never assume 3000/5173. Check it also matches the origin already signed
in to the browser pane — a session on `localhost:5173` does not carry over to
`localhost:5174`, and the mismatch presents as a spurious auth failure rather
than as a wrong-port error.

## Commands (run from repo root)

```bash
npx vitest run                      # all tests. NEVER pass --root — it silently runs 0 tests
npx tsc -p tsconfig.json --noEmit   # typecheck shared/ + supabase/seed (frontend has its own)
npm --prefix frontend run build     # frontend typecheck + production build
npm --prefix frontend run lint      # oxlint
npm run functions:sync              # copy shared/ modules into edge functions (see rule below)
```

Dev server: `npm --prefix frontend run dev` (`.claude/launch.json` has a `frontend`
entry for the browser preview). Needs `frontend/.env.local` (see `.env.example`) and
the port it actually bound to — see "Browser verification" above.

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
- **Card effects are TDD, and are keyed by a unique registry id — never by a
  card's name.** Failing engine test first, then implement, then run the full
  suite and report the before→after passing count; after deploying, list the
  spec effects still unimplemented rather than calling the wave complete. A
  reused effect name rebinds another card's behaviour mid-game (Kraken/Paddlegun).
  Full workflow: [docs/claude/card-effects.md](docs/claude/card-effects.md).
- Never commit secrets. Only the publishable anon key belongs in frontend env;
  run a secrets audit before any push (see docs/claude/workflow.md).
- **Never type credentials into the sign-in form, and never ask the user to log in
  for you.** To get a signed-in browser, run `node scripts/qa-login.mjs` (background —
  it serves once and exits), then `await window.__qaLogin()` in the page. Passwords
  stay in gitignored `scripts/qa-accounts.local`. Setup: docs/claude/testing.md.

## Supabase (remote-only)

Project "FtD Card Game", ref `wpgsjnjnvykxavaxibld`. There is no local
`supabase start`: DB work goes through the Supabase MCP tools (`execute_sql`,
`apply_migration`, `get_edge_function`, …). **Function deploys do not** — see
below. Edge functions (`game-action`, `lobby-action`, `create-card`) are
deployed with `verify_jwt: false` and do their own auth + CORS.
Details: docs/claude/supabase.md.

## Deploying edge functions

**Use the deploy script. Do not deploy through the `deploy_edge_function` MCP
tool, and do not delegate a deploy to a subagent** — both truncate the payload,
and a truncated deploy **deletes every file it omits**, failing the function at
boot for every player. (Wave 3 tried MCP twice; a 23-file payload arrived as 5.)
Subagent deploys additionally stall on permission classification.

```bash
npm run functions:deploy -- game-action     # add --dry-run to list the payload first
```

`scripts/deploy-function.mjs` sends a multipart upload of **all** files, derived
from the same `shared-manifest.json` that `functions:sync` reads, so the two can
never disagree. Needs `SUPABASE_ACCESS_TOKEN` in the environment.

Afterwards, **verify the deployed version number incremented** — and verify by
content, not file count: a deploy legitimately reads back with fewer modules,
because type-only imports are erased during transpilation
(docs/claude/supabase.md).

**Always deploy from a branch that is up to date with `main`**, so a production
fix already on `main` is never regressed by a deploy from a stale branch.

## Task docs — read before starting the matching task

| Doc | Read when… |
|---|---|
| [docs/claude/architecture.md](docs/claude/architecture.md) | touching the game engine, state shape, actions, battles, or hero powers |
| [docs/claude/card-effects.md](docs/claude/card-effects.md) | adding/changing a card effect, keyword, or effect-driven UI |
| [docs/claude/supabase.md](docs/claude/supabase.md) | deploying functions, writing migrations, changing auth/RLS, debugging 4xx/5xx from functions |
| [docs/claude/frontend.md](docs/claude/frontend.md) | changing pages, realtime/reconnect behavior, dialogs, or query wiring |
| [docs/claude/testing.md](docs/claude/testing.md) | writing tests, running E2E against the live backend, browser verification, or needing a signed-in browser session |
| [docs/claude/workflow.md](docs/claude/workflow.md) | branching, merging, pushing, deploy sequencing, or picking up backlog work |
