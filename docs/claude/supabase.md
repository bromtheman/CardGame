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
- Catalog probe (`game-action`): the full built-in catalog is fetched when any
  candidate card's `meta` names a `CATALOG_EFFECTS` effect. A catalog DB error
  is a 500, never a silent empty catalog. **Three sources feed the candidate
  list**, and a card outside all three resolves against an empty catalog:

  | Source | Covers |
  |---|---|
  | the card at `action.instanceId` in the **caller's own hand** | the card being played |
  | every on-field entry in every zone, **both sides** | `onDeathEffect`s fired inside `DECIDE_BATTLE_REPORT` (which carries no `instanceId`) and on-field activated abilities, plus every DP2 battle trigger — a participant is always on-field |
  | `state.pendingEffect.card` | a **suspended** effect being resolved |
  | `state.zoneEffects[].effect` **(wave 4)** | a persistent zone claim still firing long after its card was spent |

  The third exists because **the probe is blind to a card that has already been
  spent.** An ability is `spendCard`'d into `state.destroyed` when it is played,
  so by the time `RESOLVE_PENDING_EFFECT` arrives it is in neither hand nor
  field — which is why `pendingEffect` stores the card verbatim rather than its
  name.

  The fourth is the same lesson one step further out: DWG Waters' battle riders
  fire from `state.zoneEffects` for the rest of the game, so its card is in
  none of the first three until it has already suspended once. That entry
  stores the **registry name** directly, so this source asks
  `CATALOG_EFFECTS` about the name rather than looking up a card at all.
  **Any new dispatch point that fires an effect for a card in neither hand nor
  field needs its own source here** — that is now twice.

  ⚠ **This branch has no unit test.** `game-action/index.ts` is Deno edge code
  with no test harness in this repo, so a probe regression reaches production
  and surfaces as a 400 on Special Foundries or Robotic Assemblers. It is
  covered only by the live smoke test in the deploy runbook below — run it.

- ⚠ **`npx tsc -p tsconfig.json --noEmit` does not typecheck edge functions.**
  The root tsconfig's `include` is `["shared", "supabase/seed"]`, so
  `supabase/functions/**` is outside it entirely (and `**/*.test.ts` is
  excluded too). Careful reading is the only gate on edge-function code —
  do not treat a green tsc as evidence that a change to `game-action` or
  `lobby-action` compiles.
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

**Use the script, not the MCP tool:**

```bash
npm run functions:deploy -- game-action            # add --dry-run to list the payload first
```

`scripts/deploy-function.mjs` derives the payload from the same
`shared-manifest.json` that `functions:sync` reads, so the two can never
disagree about which files a function needs, and it POSTs the bytes straight
from disk to `POST /v1/projects/{ref}/functions/deploy`. It needs
`SUPABASE_ACCESS_TOKEN` in the environment (a personal access token from
supabase.com/dashboard/account/tokens); it reads it from `process.env` and
never prints or stores it. `SUPABASE_PROJECT_REF` overrides the default ref.
`verify_jwt` defaults to **false**, which is correct for all three functions
here — pass `--verify-jwt` only if that ever changes.

⚠ **Do not assemble the payload by hand, and do not deploy through the
`deploy_edge_function` MCP tool for `game-action`.** Its payload is 23 files
and ~161 KB; wave 3 tried it twice and both attempts were truncated by
response-length limits into a **5-file** payload. A partial payload **deletes
the files you omit**, so that would have stripped 18 runtime modules and
failed the function at boot for every player. The MCP tool remains fine for a
small function you can send whole in one call.

A partial payload deletes the files you omit — the script guards this by
failing when a manifest-listed file is missing from the function directory
(run `npm run functions:sync` first) and by printing the file count before it
sends. After deploy, bump nothing locally: the DB is the source of truth for
the version number. Deploy `game-action` after any engine/effects change;
`lobby-action` after game-init/deck/lobby changes.

- **Before redeploying `game-action` for a wave that registers a previously
  unregistered effect name**, check whether any active game holds a card
  whose snapshotted `meta` already names it. A game's `meta` is frozen data,
  but the name → implementation mapping is code, shared by every game at
  once — so an in-flight game whose old snapshot happens to carry that exact
  name starts running the new implementation the instant this deploys, with
  no reseed involved (see `docs/superpowers/specs/2026-08-27-effect-coverage-design.md`
  §9.2 for the concrete Kraken/Paddlegun case). Query `games` for the
  newly-registered name(s) inside `state`/`game_players` before deploying,
  and flag any hit to a human — this doc does not prescribe what to do about
  one, only that it be found first.

- **A deployed function legitimately reads back with fewer files than you sent.**
  `get_edge_function` returns the *bundled reachable* module set, not the raw
  upload: anything reached only through `import type` is erased during
  transpilation and never appears. This is easy to mistake for the partial
  payload warned about above. Two data points — `game-action` v5 read back as
  12 modules of a 16-file manifest, v6 as 17 of 21, and both times the
  absentees were exactly the type-only files (`types.ts`, `lobbySettings.ts`,
  `engine/engineTypes.ts`, `engine/deckValidation.ts`).

  So **verify a deploy by content, not by file count**: confirm the version
  number incremented, grep the returned bundle for symbols the new code should
  introduce and for ones it should have removed, and check `function_logs` for
  clean boots. A genuinely partial payload shows up as a missing *runtime*
  module — which fails at boot, loudly — not as a missing type-only one.

- **Smoke-test the catalog probe after any deploy that touches it or adds a
  `needsCatalog` effect.** In a real game, play one card whose effect mints from
  the catalog *without* suspending (e.g. Defensive Parapet, or wave 3's Flying
  Squirrel Attack) and one that suspends and then mints on resolution (Special
  Foundries, Robotic Assemblers, or wave 3's Air Strafe played against a
  player-design target) — the second kind is the only exercise the
  `state.pendingEffect.card` source ever gets, since it has no unit test and
  tsc does not read the file. Air Strafe against a player design is only the
  *second* real exercise of that path anywhere in the codebase, and the first
  since wave 2 built it — worth confirming deliberately rather than assuming
  it still works by analogy. A probe regression shows up as a 400 on the
  resolving action, not on the play.

  **Wave 4 added a fourth source that needs its own smoke test**, for the same
  reason: `state.zoneEffects[].effect`. Play DWG Waters to claim a zone, then
  let the enemy attack you there — the clause-2 rider offers a Corsair or
  Marauder minted from the catalog, and DWG Waters' own card is in neither
  hand, field, nor `pendingEffect` when that offer is built. A regression
  surfaces as an empty option list rather than an error, which is quieter than
  a 400 and worth looking for deliberately.

  **Wave 4's own pair, beyond the probe:** Catshark in any battle (30k lands at
  lock, on either side) and Terawatt on a forced 1v1 — the second is the first
  time a player ever sees the choice dialog **over** the battle overlay, and
  the battle must still be reportable after the answer.

(That backlog item — "a script that assembles the full-directory payload
automatically" — is closed by `scripts/deploy-function.mjs` above.)

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
