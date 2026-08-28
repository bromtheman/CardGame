# Testing — unit, E2E, and browser verification

Read this before writing tests, running E2E against the live backend, or doing
browser verification.

## Unit tests (vitest, repo root)

```bash
npx vitest run                      # everything (412 tests / 29 files after wave 2)
npx vitest run shared/effects       # path filter — the ONLY sanctioned way to narrow
```

- **NEVER `--root <dir>`**: include globs are root-relative, so it matches zero
  files, and historically passed silently. `passWithNoTests: false` now guards
  this, but don't rely on the guard.
- Include globs: `shared/**`, `supabase/seed/**`, `frontend/src/**` `*.test.ts`.
- Frontend tests under this runner must be **pure Node** — no DOM, no React
  imports (that's why `reconnectPolicy`/`time`/`games` logic lives in plain `.ts`
  lib modules; keep testable logic out of components).
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
- ⚠ **Never use a real seeded effect name as an "unimplemented" stand-in.** A
  test asserting "unknown effect plays vanilla" silently stops testing anything
  the day someone registers that name. Use synthetic `t_`-prefixed names — see
  `shared/engine/activate.test.ts`, `shared/engine/pendingEffect.test.ts`,
  `shared/effects/primitives.test.ts`, or `shared/effects/registry.test.ts`.
  Existing offenders, all in `shared/engine/placement.test.ts`:
  `eclipseEffect` (wave 3), `ambushEffect` / `sabotageEffect` (wave 5).

## Live E2E (scripted, against the real project)

Pattern (used for every phase; reusable scaffolding in prior scripts): a `tsx`
script that reads `frontend/.env.local` for URL + publishable key, signs in the
two test accounts, builds decks/lobby/game through the real functions, then
asserts on `games` rows. Record PASS/FAIL per step and print a summary.

- Test accounts: `jacob.finn+ftdtest2@streetfeastapp.com` and
  `...+ftdtest3@...` (passwords in the committed phase plan docs — deliberate
  for now; **rotate/delete before anything goes public**).
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
context/profile. Never type credentials the user hasn't provided for automation;
the two test accounts above are the sanctioned ones.

## Gates before any merge (all must pass)

```bash
npx vitest run
npx tsc -p tsconfig.json --noEmit
npm --prefix frontend run build
```

Note: the root tsconfig excludes `**/*.test.ts` / `**/*.spec.ts` (a Netlify
deploy fix), so the tsc gate does NOT typecheck test files — vitest runtime
failures are the only automated net under them.
