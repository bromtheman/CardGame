# Testing — unit, E2E, and browser verification

Read this before writing tests, running E2E against the live backend, or doing
browser verification.

## Unit tests (vitest, repo root)

```bash
npx vitest run                      # everything (753 tests / 32 files after wave 5)
npx vitest run shared/effects       # path filter — the ONLY sanctioned way to narrow
```

- **NEVER `--root <dir>`**: include globs are root-relative, so it matches zero
  files, and historically passed silently. `passWithNoTests: false` now guards
  this, but don't rely on the guard.
- Include globs: `shared/**`, `supabase/seed/**`, `frontend/src/**` `*.test.ts`.
- Frontend tests under this runner must be **pure Node** — no DOM, no React
  imports (that's why `reconnectPolicy`/`time`/`games` logic lives in plain `.ts`
  lib modules; keep testable logic out of components).
- `shared/engine/battleFreeze.test.ts` is an **invariant** suite rather than a
  feature one: it pins that `state.pendingEffect` and `state.activeBattle` may
  be non-null together (wave 4's Terawatt and DWG Waters both suspend at battle
  lock) by sweeping every action type × both players. It drives that state with
  a synthetic bystander rather than either card, so it keeps testing the
  invariant if both cards change, and it asserts its sweep covers
  `knownActionTypes()` — a new action type fails the file until someone decides
  how it behaves under the two freezes. `tsc` cannot serve that role: the root
  tsconfig excludes `**/*.test.ts`, so a compile-time exhaustiveness check
  inside a test file is never actually checked.
- ⚠ **After `git checkout --` on a `shared/` file, re-run `npm run
  functions:sync`.** `core.autocrlf` smudges the restored file back to CRLF
  while the synced edge-function copy stays LF. `git diff` shows **nothing**
  (both normalize to the same blob), but `functionSharedSync.test.ts` compares
  bytes and fails until you resync. It reads as a phantom failure on a clean
  tree. This bites mutation testing in particular, where reverting a production
  file is the whole loop.
- Engine tests use `shared/engine/testFixtures.ts`: `makeGame()` (alice=side a,
  active; bob=b; factions a=DWG b=OW) and `makeCtx()` (rng cycles 0.1/0.5/0.9,
  ids `e-0`, `e-1`, …). Import the engine via `shared/engine/index.ts` in tests
  too, or registries are empty.
- The drift test `supabase/seed/functionSharedSync.test.ts` fails when synced
  function copies diverge from `shared/` — fix with `npm run functions:sync`,
  never by editing the copies. It generates one case per `shared-manifest.json`
  entry, so adding a shared file adds a test; a `+n+1` test delta is expected.
- ⚠ **A frontend test that transitively imports `supabaseClient` throws at
  import time.** `frontend/src/lib/supabaseClient.ts` throws when
  `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` are absent, and the root
  `vitest.config.ts` has **no `envDir`**, so it never reads `frontend/.env.local`
  (which is gitignored anyway). The failure names the missing env vars, so it
  reads as a config problem when the real cause is the import graph — e.g.
  testing a pure helper in `games.ts`, which imports the client for its query
  hooks. **Fix it with `vi.mock('./supabaseClient', () => ({ supabase: {} }))`
  in the test file** (`frontend/src/lib/games.test.ts` is the worked example).
  Do *not* add `envDir` to the root config — that would make the suite depend on
  a gitignored file and still fail on a fresh clone and in CI. Corollary: a
  suite that is green only because *your shell* exports those vars is not green.
- ⚠ **Never use a real seeded effect name as an "unimplemented" stand-in.**
  Rename it to a synthetic `t_`-prefixed name instead — see
  `shared/engine/activate.test.ts`, `shared/engine/pendingEffect.test.ts`,
  `shared/effects/primitives.test.ts`, or `shared/effects/registry.test.ts`.
  There are **no offenders left**: wave 5 renamed the last two
  (`shared/engine/placement.test.ts`'s `ambushEffect` / `sabotageEffect`, both
  now `t_`-prefixed) in the same change that registered the real names.
  **The failure mode is loud, not silent** — a claim this doc carried until
  wave 3 disproved it. `noteUnimplemented` (`shared/effects/registry.ts`)
  pushes its "plays as vanilla" log line only via `if (isImplemented(name))
  continue`, i.e. only when the name is **not** implemented, so registering
  the name makes the note vanish and a `toHaveLength(1)` assertion fails
  loudly (`1 → 0`) — it does not pass quietly. Wave 3 verified this two ways:
  empirically, by an implementer's mutation test, and independently, by a
  reviewer reading `registry.ts` against `registry.test.ts`'s "skips
  implemented ones" case. The rename is still correct practice — it decouples
  the fixture from a card's registration state, so the test keeps exercising
  the unimplemented path indefinitely rather than going red one day for a
  reason unrelated to what it's meant to check — but the risk that motivated
  it was misstated. See `shared/engine/placement.test.ts`'s "vehicle with
  unimplemented onActivate deploys fine" test for the worked explanation.

## Live E2E (scripted, against the real project)

`scripts/smoke-wave4.mjs` is the worked, working example — and it is meant to be
**reused**, not read as history. Point its `required` deck lists at the cards a
wave needs and it does the rest: signs in both QA accounts from
`scripts/qa-accounts.local`, builds two legal 20-card decks, creates a lobby,
starts a game, then drives the **real deployed `game-action`** and reports
PASS/FAIL per step. `--keep` leaves the game behind so you can open it in the
browser; without it the lobby is cleaned up.

Why it exists: `game-action`'s catalog probe is edge-function code, so `tsc`
does not read it and no unit test can reach it — and a regression there is a
card that silently does nothing in production while every check stays green.
Three waves deferred this test before wave 4 ran it.

Two things that cost time writing it, both worth knowing before the next one:

- **A card in a hand is a `CardInstance` snapshot (camelCase — `vehicleType`,
  `materialCost`), while a `games`/`cards` ROW is snake_case.** Mixing them
  gives a filter that silently matches nothing.
- **Never name a variable `URL`.** It shadows the global constructor `fetch`
  needs, and the failure (`URL is not a constructor`) points nowhere near the
  assignment.

The shape, if you write another from scratch: read `frontend/.env.local` for the
project URL and publishable key, sign in both accounts against `/auth/v1/token`,
build decks/lobby/game through the real functions, then assert on `games` rows.
Record PASS/FAIL per step and print a summary.

- Credentials live in `scripts/qa-accounts.local` (gitignored, `P1_*`/`P2_*`
  pairs) — the same file `scripts/qa-login.mjs` reads. Passwords go only to
  `/auth/v1/token` and are never printed. Older phase-plan docs name two
  `jacob.finn+ftdtest*` accounts with passwords committed in the doc; those are
  legacy and should be **rotated or deleted before anything goes public**.
- The service-role key from local env may be used for assertions ONLY — never
  print it, never ship it in frontend code, never commit it.
- Engine imports work in scripts via
  `import { ... } from 'file:///C:/Users/JFinn/FtDCardGame/shared/engine/index.ts'`.
- Watch deck-validation constraints when building fixtures (e.g. flier-copy
  limits); query built-ins with `is_built_in = true`.

## Browser verification

Dev server via the preview tools with launch config `frontend`
(`.claude/launch.json`, port 5173) — never via raw Bash. Verify with
`read_console_messages` (zero errors expected), `read_page`, and screenshots.
Two-account games: sign the second account in from a second browser
context/profile. Never type credentials into the sign-in form at all — use the QA
login below, which is the sanctioned way to get a signed-in browser.

### Signing in without typing a password

`scripts/qa-login.mjs` exists so nobody — human or agent — has to type a password
into the sign-in form to get a QA session.

```bash
cp scripts/qa-accounts.example scripts/qa-accounts.local   # then fill it in; gitignored
node scripts/qa-login.mjs        # first account in the file
node scripts/qa-login.mjs p2     # a named account
```

It signs in from Node against `/auth/v1/token`, then serves that session **once**
on `127.0.0.1:5199` and exits, so run it in the background. In the dev-server page:

```js
await window.__qaLogin()   // -> the signed-in email
```

`window.__qaLogin` is installed by `frontend/src/lib/qaLogin.ts`, imported from
`main.tsx` only under `import.meta.env.DEV` — it is absent from production builds.
It calls `supabase.auth.setSession()`, so the session persists through the client's
own storage and `AuthProvider` picks it up without a reload.

- **`__qaLogin()` does not navigate.** It resolves with the signed-in email while the
  page is still on `/login` — that is success, not failure. Navigate afterwards; the
  session is already live, and it survives reloads via the client's own storage.
- The handoff server refuses any request whose `Origin` is not localhost/127.0.0.1,
  and is bound to loopback only.
- Passwords live only in `scripts/qa-accounts.local` (gitignored) and are never
  printed, logged, or written anywhere else.
- Both seats of a two-player game still need two browser profiles — same origin
  means same `localStorage`, so one profile holds one session.

## Gates before any merge (all must pass)

```bash
npx vitest run
npx tsc -p tsconfig.json --noEmit
npm --prefix frontend run build
```

Note: the root tsconfig excludes `**/*.test.ts` / `**/*.spec.ts` (a Netlify
deploy fix), so the tsc gate does NOT typecheck test files — vitest runtime
failures are the only automated net under them.
