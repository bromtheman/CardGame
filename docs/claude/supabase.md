# Supabase — deploys, migrations, and debugging

Read this before deploying edge functions, writing migrations, changing auth/RLS,
or debugging function errors. Everything is **remote-only**: project "FtD Card
Game", ref `wpgsjnjnvykxavaxibld`, operated through the Supabase MCP tools
(`execute_sql`, `apply_migration`, `deploy_edge_function`, `get_edge_function`,
`list_edge_functions`, `query_logs`, `get_advisors`). There is no local
`supabase start`; the CLI is not part of the workflow.

## Edge functions

Three functions, all deployed with `verify_jwt: false` — each does its own
`getUser()` auth check and CORS handling in code. Do not "fix" that flag.

| Function | Role |
|---|---|
| `game-action` | All in-game actions: auth → body/version validation → `normalizeState` → conditional catalog probe → `applyAction` → `apply_action_tx` RPC |
| `lobby-action` | JOIN/LEAVE/START; START validates decks, builds initial game state, stamps `factions` |
| `create-card` | Custom card creation with validation + image handling |

- Version-check contract: client sends `expectedVersion`; RPC returns `null` on
  mismatch → function returns **409** → client refetches. Errors come back as
  `{ errors: string[] }` with 4xx status.
- Catalog probe (`game-action`): when the card being played (looked up by
  `action.instanceId` in the **caller's own hand**) names a `CATALOG_EFFECTS`
  effect (`played.meta ?? {}` guards null meta), the full built-in catalog is
  fetched; a catalog DB error is a 500, never a silent empty catalog.
- Debugging: `query_logs` for function logs; reproduce with a direct
  `supabase.functions.invoke` from a script (see testing.md E2E pattern).

## Shared-code sync (the manifest)

Edge functions cannot import from outside their directory, so each carries a
copied `shared/` subtree, declared in `supabase/functions/shared-manifest.json`
and refreshed by `npm run functions:sync`
(`scripts/sync-function-shared.mjs`). Byte-equality is enforced by
`supabase/seed/functionSharedSync.test.ts`.

- Engine internals (`engineTypes.ts`, `gameEngine.ts`, `placement.ts`, battle
  modules, `effects/*`) sync into **game-action only**. `lobby-action` gets just
  settings/types/deckValidation/gameInit — so `gameInit.ts` must never import
  `engineTypes.ts`.
- Adding a shared file an edge function needs? Add it to the manifest, run the
  sync, commit both.

## Deploying

Deploy via `deploy_edge_function` with the function's **entry file plus every
synced shared file** as the files payload — a partial payload deletes the files
you omit. Read the current deployment first (`get_edge_function`) when unsure
what the payload must contain. After deploy, bump nothing locally: DB is the
source of truth for the deployed version number. Deploy `game-action` after any
engine/effects change; `lobby-action` after game-init/deck/lobby changes.

(Backlog: a script that assembles the full-directory payload automatically.)

## Migrations & data

- Migrations live in `supabase/migrations/` AND must be applied remotely via
  `apply_migration` (same SQL, same name). Existing ones cover profiles,
  cards/hero_powers, signup hardening, decks/storage, lobbies/games, and the
  `apply_action_tx` RPC.
- Seed pipeline: `supabase/seed/` (`npm run seed:build` transforms
  `source/` → `seed_data.sql`); built-in cards have `is_built_in = true`.
- RLS is on everywhere. `games` rows: participants-only SELECT, written only
  via functions/RPC. `lobbies`: readable by every signed-in player (deliberate —
  realtime respects RLS, so a narrower policy would hide lobby-list updates;
  do not narrow it), created/deleted directly by hosts, otherwise written via
  `lobby-action`. `game_players` holds private hands/decks — never widen its
  policies.

## Advisors

`get_advisors` currently reports 3 known, accepted WARNs: `username_available`
function search-path ×2, and leaked-password protection off (enabling it is a
user-dashboard backlog item). New findings beyond these deserve attention.
