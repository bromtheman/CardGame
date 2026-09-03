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
npm run seed:verify                 # diff LIVE card rows against seed_data.sql (see rule below)
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
below. Edge functions (`game-action`, `lobby-action`, `create-card`,
`battle-report`) are deployed with `verify_jwt: false` and do their own auth +
CORS. `battle-report` is the exception to "auth" meaning a user JWT: its
`submit` op is called by a C# mod inside From The Depths, which has no Supabase
session, and authenticates with a single-use battle token instead. It stores a
report PREFILL and changes no game state — a human still submits and the
opponent still approves. Never extend it into either.
Details: docs/claude/supabase.md.

## Seed data does NOT deploy — apply it by hand after every merge

**Merging deploys CODE, never card data.** `supabase/seed/seed_data.sql` is
applied out of band: `supabase/config.toml` deliberately carries no seed
settings, so the integration's seed step does nothing, and no migration inserts
cards either. Nothing warns you, because the whole test suite reads the seed
**source** and never the database.

This has already shipped two production defects. Wave 0 of the 2026-09-02
balance pass deployed hard card retirement — `validateDeck`'s rejection,
`poolEligible`'s pool filter, the required `DeckCardInfo.retired`, the
DecksPage badge — and every bit of it was **inert**, because the five
`retired: true` flags never reached the database. The DWG/OW/WF waves then
deployed new effect code against the old rows, so three cards lied to players:
Marauder's text promised a 50k discount its rewritten effect no longer gave.

So, after any merge touching `supabase/seed/source/**`:

```bash
npm run seed:verify     # diffs LIVE cards against seed_data.sql, exit 1 on drift
```

If it reports drift, apply the upserts in `seed_data.sql` against the project
(they are idempotent `on conflict (id) do update`, so re-applying is safe and
nothing is ever deleted), then re-run until it is clean. `seed:verify` needs
`SUPABASE_ACCESS_TOKEN`, the same token `functions:deploy` uses.

Spec §1 puts each faction's data and effects in one commit precisely so a card
never ships ahead of its effect. **That guarantee holds in the repo and breaks
at the deploy** — code ships automatically and data does not.

## Deploying edge functions

**Merging to `main` deploys automatically** via the Supabase GitHub integration
(branching). Functions are deployed only if declared in `supabase/config.toml`,
and a failed migrate step silently skips the deploy step — details and the
`verify_jwt` trap are in docs/claude/supabase.md. Migration filenames must keep
the timestamp recorded in `supabase_migrations.schema_migrations`, or they are
replayed and fail.

For a manual or out-of-band deploy, **use the deploy script. Do not deploy
through the `deploy_edge_function` MCP tool, and do not delegate a deploy to a
subagent** — both truncate the payload, and a truncated deploy **deletes every
file it omits**, failing the function at boot for every player. (Wave 3 tried MCP
twice; a 23-file payload arrived as 5.) Subagent deploys additionally stall on
permission classification.

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
