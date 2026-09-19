# Supabase — deploys, migrations, and debugging

Read this before deploying edge functions, writing migrations, changing auth/RLS,
or debugging function errors. Everything is **remote-only**: project "FtD Card
Game", ref `wpgsjnjnvykxavaxibld`, operated through the Supabase MCP tools
(`execute_sql`, `apply_migration`, `deploy_edge_function`, `get_edge_function`,
`list_edge_functions`, `query_logs`, `get_advisors`). There is no local
`supabase start`; the CLI is not part of the workflow.

## Edge functions

Four functions, all deployed with `verify_jwt: false` — each does its own
CORS handling in code, and its own JWT check: `verifiedUserId` verifies the
caller's token locally with `auth.getClaims()` against the project's ES256
signing keys (JWKS cached per isolate), so no request pays a GoTrue round
trip. Accepted trade (2026-09-16): a revoked session or deleted user stays
valid until its token expires (1 h). Do not "fix" the flag, and do not
recreate the verifying client per request — the JWKS cache lives on it.

| Function | Role |
|---|---|
| `game-action` | All in-game actions: auth → body/version validation → `normalizeState` → conditional catalog probe → `applyAction` → `apply_action_tx` RPC |
| `lobby-action` | JOIN/LEAVE/START; START validates decks, builds initial game state, stamps `factions` |
| `create-card` | Custom card creation with validation + image handling |
| `battle-report` | Prefill from the FtD mod: `issue`/`fetch` (browser, JWT) and `submit` (the mod, **token only**) |

- ⚠ **`battle-report` is the one function where a caller with no Supabase
  session is expected.** Its `submit` op deliberately never checks one
  (`verifiedUserId` is called only by `issue`/`fetch`) — a C# mod inside From
  The Depths has no session and must never be given one. It authenticates with a hashed, single-use,
  battle-scoped token minted by `issue` and embedded in the generated
  `.customBattle`. Every way a token can fail answers with **one opaque 401**,
  so an unauthenticated caller cannot probe which tokens exist; do not make
  those messages more specific.

  It **stores a prefill and changes no game state**, which is the property the
  whole design rests on: a human still submits, and the other captain still
  approves (`DECIDE_BATTLE_REPORT`'s `actor === report.submittedBy` 403). Do
  not extend it into submitting or approving. Background:
  `docs/superpowers/plans/2026-09-01-battle-result-reporting.md`.

  It syncs ONE shared file (`battleReport.ts`) because it dispatches no action
  and so needs neither registry — which is also why it does not know the
  battle roster, and does not need to.

  **The result is pushed to the open overlay** without the function knowing:
  migration `20260916180202_ftd_result_broadcast.sql` puts a trigger on
  `battle_tokens` that, when `reported` lands, calls `realtime.send` on the
  private topic `game:<id>:ftd` (event `ftd_result`) with only game id,
  battle key and timestamp. A `realtime.messages` SELECT policy lets exactly
  the two participants of that game join the topic; the table stays out of
  the publication with no policy of its own. The overlay answers the wake-up
  by calling `fetch` — still the only read path. `realtime.send` swallows its
  own errors as a WARNING (`WarnSendingBroadcastMessage` in postgres logs), so
  a broken broadcast never fails a redeem; the overlay's 30 s poll is the
  fallback. The topic/event strings live in `shared/battleReport.ts` and
  `battleReport.test.ts` reads the migration to keep them in step.
  `scripts/smoke-battle-report.mjs` proves the push live (a subscribed captain
  is woken; an anonymous socket and a non-participant are refused at join).

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
  excluded too). **`npm run functions:check`** is the gate: Deno (via
  `npx deno`, downloaded on first use) type-checks all four `index.ts` files
  against the same `npm:@supabase/supabase-js@2` the deploy bundles. Run it
  before any function deploy; a green tsc says nothing about them.
- Debugging: `query_logs` for function logs; reproduce with a direct
  `supabase.functions.invoke` from a script (see testing.md E2E pattern).

## Latency

Three facts about where the time goes, measured from `function_edge_logs`
(`execution_time_ms`) on 2026-09-16 and worth re-measuring after any change
here. The query is at the bottom.

- **The database is in `us-west-2`; functions run nearest the caller.** For a
  US-East player that put every function execution in `us-east-1/2`, so each
  sequential DB or auth round trip inside a call crossed the continent (three
  in `battle-report`'s `fetch`/`submit`, more in `game-action`). Before the
  fix: battle-report POST p50 622 ms / p90 1.0 s, game-action p50 929 ms /
  p90 1.5 s. Every browser call now passes `region: FUNCTIONS_REGION`
  (`frontend/src/lib/supabaseClient.ts`), and `issue` writes
  `?forceFunctionRegion=us-west-2` into the endpoint it mints so the mod's
  POST is pinned too, with no mod change. `x-sb-edge-region` on a response
  (and in the logs) says where it actually ran.
- **The `region` option sends an `x-region` header**, so every function's
  CORS `Access-Control-Allow-Headers` lists it. A function deployed WITHOUT it
  fails the preflight for every browser call, so: **deploy the four functions
  before any frontend change that starts sending it.** Netlify and the
  Supabase integration both fire on a push to `main`; a manual
  `npm run functions:deploy` of all four first is how to avoid the window.
- **Preflights were never cached.** No function set `Access-Control-Max-Age`,
  so Chrome re-sent `OPTIONS` after 5 s — 410 preflights for 430 POSTs in one
  day — each a full extra round trip (~150 ms of edge execution plus the
  network) before the real request. All four now send `Max-Age: 7200`
  (Chrome's cap).

```sql
-- query_logs: per-function execution time by region, last 24 h
select log_attributes['request.pathname'] as path,
       log_attributes['response.headers.x_sb_edge_region'] as region,
       count() as n,
       round(quantile(0.5)(toFloat64OrZero(log_attributes['execution_time_ms']))) as p50_ms,
       round(quantile(0.9)(toFloat64OrZero(log_attributes['execution_time_ms']))) as p90_ms
from logs where source = 'function_edge_logs' and log_attributes['request.method'] = 'POST'
group by path, region order by path, n desc
```

Two more, done the same day: **auth is local** (`getClaims`, above — a warm
verification measured 0 ms against a ~30–70 ms in-region GoTrue call), and
**independent round trips run in parallel** — `game-action`'s token check,
`games` read and `game_players` read were three sequential hops that only
ever needed the header and `gameId`; `battle-report`'s `issue`/`fetch` the
same for two. The remaining per-call cost is structural: ~150 ms of edge
overhead (an `OPTIONS` that does nothing measures that), cold starts, and
`select('*')` on `games` pulling a 9–28 KB `state` for `battle-report`,
which reads five fields of it.

## Shared-code sync (the manifest)

Edge functions cannot import from outside their directory, so each carries a
copied `shared/` subtree, declared in `supabase/functions/shared-manifest.json`
and refreshed by `npm run functions:sync`
(`scripts/sync-function-shared.mjs`). Byte-equality is enforced by
`supabase/seed/functionSharedSync.test.ts`.

- Engine internals (`engineTypes.ts`, `gameEngine.ts`, `placement.ts`, battle
  modules, `effects/*`) sync into **game-action only**. `lobby-action` gets just
  settings/types/deckValidation/gameInit — so `gameInit.ts` must never import
  `engineTypes.ts`. `battle-report` gets `battleReport.ts` alone, which is why
  that module imports nothing at all — not even `gameSettings.ts`. Adding an
  import to it drags a whole subtree into that function's payload.
- Adding a shared file an edge function needs? Add it to the manifest, run the
  sync, commit both.

## Deploying

**Merging to `main` deploys automatically.** The Supabase GitHub integration
(branching, enabled 2026-08-30) runs a 7-step workflow on every push and PR:
clone → pull → health → configure → **migrate** → seed → **deploy**. A PR gets
its own ephemeral preview database; merging to `main` applies new migrations and
redeploys functions to production.

Two consequences worth knowing before you touch anything here:

- **Only functions declared in `supabase/config.toml` are deployed.** API, Auth
  and seed settings are ignored by default. A function missing from that file is
  silently never deployed — and `verify_jwt` defaults to **true**, so a function
  declared without `verify_jwt = false` would 401 every request (including the
  CORS `OPTIONS` preflight) before its handler runs. See the comments in
  `supabase/config.toml`.
- **A failed migrate step skips the deploy step.** They are parent and child in
  the same DAG, so migration drift silently blocks function deploys rather than
  reporting a function error. If a deploy "did nothing", read the migrate log
  first.
- **The seed step does NOT apply `seed_data.sql`.** It is in the workflow's DAG,
  but this project's `config.toml` deliberately carries no seed settings (see the
  bullet above — adding one would push CLI defaults over the dashboard), and no
  migration inserts cards. **So merging ships code and never card data.**

  Nothing surfaces the mismatch on its own: every seed guard in the suite
  (`seedDataSync`, `balancePass`, `balance/*`, `effectCoverage`) reads
  `supabase/seed/source/**`, not the database. A green suite says the generated
  SQL is correct, never that production ran it.

  It has cost two production defects already. Wave 0 of the 2026-09-02 balance
  pass shipped hard retirement — `validateDeck`'s rejection, `poolEligible`'s
  filter, the required `DeckCardInfo.retired`, the DecksPage badge — and all of
  it sat **inert**, because the five `retired: true` flags never reached the
  `cards` table, leaving retired cards legal in decks and live in draw pools.
  The DWG/OW/WF waves then deployed rewritten effects against the old rows, so
  Marauder's printed text promised a 50k discount its code no longer gave.

  Since 2026-09-17 `.github/workflows/seed-apply.yml` does this on every push
  to `main` that changes `seed_data.sql` (repository secret
  `SUPABASE_ACCESS_TOKEN` required; `workflow_dispatch` re-runs it by hand).
  Check that run after any merge touching `supabase/seed/source/**`; the same
  two commands work locally:

  ```bash
  npm run seed:apply      # scripts/apply-seed.mjs — posts the file in 40-statement batches
  npm run seed:verify     # scripts/verify-seed.mjs — exit 1 on any drift
  ```

  `seed:verify` fetches every `is_built_in` row through the Management API and
  deep-compares all nine data columns against `seed_data.sql`. `seed:apply`
  posts the file's own statements through the same endpoint, byte-exact — never
  retype or paste the SQL, a slip in 150 KB of card data is invisible to every
  test. The upserts are idempotent (`on conflict (id) do update`) and contain no
  `delete`/`truncate`, so re-applying is safe and never removes a row — which
  matters, because `gameInit.ts`'s `expandDeck` **throws** on a dangling card id.
  The script refuses any statement that is not an upsert into `cards` or
  `hero_powers`.

  ⚠ When comparing card `meta`, canonicalise **deeply**. `JSON.stringify(v,
  Object.keys(v).sort())` looks like a canonicaliser but the key array is a
  replacer that filters at *every* nesting level, so `{"resourceSurge":{...}}`
  compares as `{"resourceSurge":{}}` and all nested drift reads as a match.
  `scripts/verify-seed.mjs` carries the correct version and a comment saying why.

**For a manual/out-of-band deploy, use the script, not the MCP tool:**

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

- Migrations live in `supabase/migrations/` and are applied on merge to `main`
  by the GitHub integration. Existing ones cover profiles, cards/hero_powers,
  signup hardening, decks/storage, lobbies/games, the `apply_action_tx` RPC,
  `profiles.is_admin`, battle tokens, lobby ready/optional decks, and the FtD
  result broadcast (trigger + `realtime.messages` policy).
- **A migration filename's timestamp IS its identity.** The integration applies
  any version not already in `supabase_migrations.schema_migrations`, so a file
  whose timestamp is not the recorded one gets replayed against a database that
  already has those objects, and fails. Filenames were reconciled to the recorded
  versions on 2026-08-30 after MCP `apply_migration` had assigned its own
  timestamps (all six differed; `add_profile_is_admin` had no local file at all).
  If you ever apply a migration through MCP again, write the file back with the
  version MCP recorded — check with `list_migrations`.
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

## PracticeAI bootstrap (once, by hand, after the first deploy of the AI opponent)

The practice-game bot (spec `docs/superpowers/specs/2026-09-16-ai-opponent-design.md`)
is a real auth user. Migration `20260916210000_ai_opponent` adds
`profiles.is_bot`; nothing creates the row, because a migration cannot mint an
auth user. Until step 2 lands, `lobby-action ADD_BOT` answers **503 "AI
opponent is not provisioned"** and nothing else is affected.

1. Dashboard → Authentication → Users → **Add user**: any email you control,
   **Auto Confirm User** on, a long random password you do not keep. The
   form takes no user metadata, so `handle_new_user` names the profile
   `player_<8 hex>` — step 2 fixes that by id, never by username. Then **Ban
   user** (Authentication → the user → Ban) so the account can never sign in.
2. Find the row and name + flag it in one statement:
   `update public.profiles p set username = 'PracticeAI', is_bot = true
   from auth.users u where u.id = p.id and u.email = '<the email>'
   returning p.id, p.username;` — one row back.
3. `select id, username, is_bot from public.profiles where is_bot;` — exactly
   one row.
4. `node scripts/smoke-practice.mjs` — the end-to-end check (below).

Done 2026-09-17: profile `4480604c-1934-4968-ba27-7012f07cc8d3` is PracticeAI
(`lobby-action` v43, `game-action` v48; smoke green).

The bot never holds a session: only `lobby-action` (`ADD_BOT`, `START`) and
`game-action` ever act as it, with the service role. Its `decks` rows are
created by `ADD_BOT` from `shared/ai/botDecks.ts` and are never deleted.

## LLM PracticeAI — the OpenRouter secret, the kill switch, and `bot_decisions`

Spec: `docs/superpowers/specs/2026-09-16-llm-practice-ai-design.md`. The bot
plays through a model (OpenRouter, `inception/mercury-2.5` by default) when
`OPENROUTER_API_KEY` is set as an **Edge Function secret**; otherwise the
evaluator (`scoredPolicy`) plays and every request files one `disabled`
telemetry row.

1. Create an OpenRouter API key **with a credit limit** (a few dollars covers
   hundreds of games at ~3¢ each). Exhausted key → HTTP errors → the heuristic
   plays and telemetry says `http`; no game breaks.
2. Dashboard → Edge Functions → Secrets (or `supabase secrets set
   OPENROUTER_API_KEY=sk-or-…`). Optional: `BOT_MODEL=<openrouter model id>`
   to switch models without a deploy; `BOT_LLM_DISABLED=1` is the kill switch.
   Secrets are read per request, so a change needs no redeploy.
   - **Switching to DeepSeek:** `BOT_MODEL=deepseek/deepseek-v4.1-flash`.
     Its rows in `shared/ai/llm/llmSettings.ts` do the rest:
     `MODEL_REASONING_EFFORT` sends OpenRouter's `reasoning: { effort: 'high' }`
     so the bot thinks before it answers (the level does not shorten the
     thinking — 580–4 500 tokens on one prompt at `low` and `high` alike),
     and `MODEL_ROUTING` sends `provider: { sort: 'throughput',
     require_parameters: true }`, which matters more than the model: OpenRouter
     spreads it over twenty providers whose speed differs 3× (StreamLake
     48 tok/s, Modal 105–177 tok/s), and in the 2026-09-17 evals both default
     routing and a StreamLake pin timed out 10–11 of 12 calls into the
     heuristic; Alibaba answered with prose instead of the schema's JSON,
     which `require_parameters` excludes. On the fastest route a call took
     6–38 s, hence `LLM_CALL_TIMEOUT_MS` 60 s. Mercury sends neither field
     and stays the code default; delete `BOT_MODEL` to go back. The
     OpenRouter catalog (`GET /api/v1/models`, and
     `/api/v1/models/<id>/endpoints` for provider slugs, ceilings and
     parameter support) is the source for a new model's rows;
     `LLM_MAX_OUTPUT_TOKENS` (65 536) must not exceed the provider's
     `max_completion_tokens`, or every call is a 400 and the heuristic plays
     with telemetry saying `http`.
   - `BOT_REASONING_EFFORT=none|minimal|low|medium|high|xhigh|max` overrides
     the model's row for any model (`none` switches reasoning off where the
     model allows it). Unset, blank or misspelt, the model's own default
     stands — a typo never silently turns reasoning off. Mercury tolerates an
     explicit effort (probed 2026-09-17).
   - `BOT_PROVIDERS=<slug>[,<slug>…]` adds an `only` pin on top of the
     model's routing row (slugs as the endpoints listing prints them, e.g.
     `modal`, `together`); blank means the row, never "no provider".
   - The eval measures exactly what production sends:
     `npm run bot:eval -- --games 10 --model deepseek/deepseek-v4.1-flash`
     (`--reasoning <level>` and `--providers <slugs>` mirror the secrets).
3. `node scripts/smoke-practice.mjs` with `SUPABASE_ACCESS_TOKEN` set — it
   reads the game's `bot_decisions` rows through the Management API.
4. Spend and health, by SQL: `select date_trunc('day', created_at) d,
   count(*), sum(cost_usd), avg(latency_ms), count(*) filter (where
   fallback_reason is not null) fallbacks from public.bot_decisions group by 1
   order by 1 desc;`. `cached_tokens` shows whether the provider caches the
   primer; when a row fell back, `fallback_reason` and `error` say why.
   `table_talk` is the line the model proposed — the driver's guard may have
   dropped it, so compare with the game's log.

`public.bot_decisions` has RLS on and **no policies** (the `battle_tokens`
pattern): the service role writes after the commit under
`EdgeRuntime.waitUntil`, the owner reads by SQL, the frontend never sees it.
