# Wave 6 — close-out

Wave 6 was the 2026-08-30 balance pass's twelve cards. All twelve are built,
and `KNOWN_GAPS` is empty for the first time since that pass opened it.

Everything below is **measured on this branch**, not remembered. Where a number
here disagrees with an earlier document, believe the number.

⚠ **The live pass has NOT been run.** This wave stops at the PR, by the owner's
decision, so nothing here has touched production. §6 says exactly what that
leaves unproven and what the post-merge run must do.

---

## 1. The twelve, card by card

| Card | Built as | New machinery |
|---|---|---|
| **WF Basher** | `grant({ draw: 1 })` on death | none |
| **SS Nothung** | `spawnVehicles('Sacrilego')` | none |
| **SS Balmung** | catalog mint into hand at `costDelta: -230000` | none |
| **WF Harbringer** | DWG Waters' clause-2 guest, on a **participant** | none |
| **WF Judgement** | `costModifier` off the enemy board + a 1v1 activation | seeded `activateCpCost: 1` |
| **SS Victoria** | activated ability paid in **materials** | `activateMaterialCost` |
| **SS Chrysaor** | `resourceSurge` with `costDelta` | surge **raises** a price |
| **SS Paladin** | `resourceSurge` with `grantKeywords` | surge **grants hull keywords** |
| **DWG Albacore** | `aircraftLock` data key | a placement rule off seeded data |
| **DWG Tarpon** | the same key, same rule | — |
| **WF Purifier** | `deployRequiresBattleLoss` + `noBaseDamage` | `ZoneState.lostBattleOnTurn` |
| **SS Blockade** | `playOnZoneEffect` rider, three clauses | **DP7** |

Only one needed a new dispatch point, exactly as the handoff predicted.

### Gates

| Gate | Baseline (`356735c`) | Now |
|---|---|---|
| `npx vitest run` | 780 passed / 33 files | **932 passed / 33 files**, 0 failed |
| `npx tsc -p tsconfig.json --noEmit` | 0 | 0 |
| `npm --prefix frontend run build` | 0 | 0 |
| `npm --prefix frontend run lint` | 0, 7 warnings | 0, **7** warnings — same inherited set, counted not copied |
| `npm run seed:build` | — | regenerated; 133 cards, 7 hero powers |
| `KNOWN_GAPS` | 12 | **0** |
| mutation testing | — | **61 applied, 3 surviving, all three explained** (§4) |

### The diff

`git diff main...HEAD --shortstat`, 13 commits:

| Slice | Lines | vs wave 5 |
|---|---:|---|
| hand-written production (`shared/` non-test + `frontend/src`) | **740** | 662 |
| tests (`**/*.test.ts`) | **2,081** | 1,197 |
| docs + spec + plan + close-out | **1,199** | 894 |
| — of which the implementation plan | ~380 (7% of the diff) | 407 (10%) |
| mechanical `functions:sync` output | **784** | 668 |
| seed source + generated SQL | 218 | 8 |
| `scripts/` | 87 | 508 |

Tests-to-production is **2.8**, against wave 5's 1.8 and wave 4's ~2.0. The
rise is not padding: 11 of those tests exist only because a mutation survived
(§4), and the seed slice is 27× wave 5's because seven cards' `meta` changed
rather than none.

---

## 2. Where reality contradicted the plan and the handoff

Four places. Each is recorded in the spec or in the code itself.

| The document said | Reality | Where |
|---|---|---|
| Chrysaor needs "a `resourceSurge` that **raises** the price" | It needs that **and** `extraSpawns` — its text is "costs 100k more **and spawns in a second Chrysaor**". `extraSpawns` already existed, so only half the card was new, but the summary named only half | spec §4.6, departure 1 |
| "**Five** of the twelve carry `meta: {}`", implying five seed edits | **Seven** cards' `meta` changed: the five empty ones plus Victoria and Judgement, which each gained a price key. `npm run seed:build` was mandatory for all seven | plan §7.4 |
| Blind spot 5 "was swept clean at close — every one of the 69 registry names is named by a seeded card" (wave 5 close-out) | **Three orphans**, created by the balance pass one day later: `purifierEffect`, `victoriaOnDeath`, `rheaOnPlay`. Deleting a card's meta key orphans its implementation in total silence | G4 (§3) |
| `smoke-wave5.mjs` is "a **reusable harness** — point its `required` deck lists at your cards rather than writing a third one" | Half true. `startGame` *is* parameterised by `{ p1Faction, p1Required, … }`, but the file **exports nothing** and runs wave 5's scenarios at top level, so importing it runs wave 5's whole suite. Pointing it at wave 6's cards needs the plumbing extracted into a module first — work this wave did not do, because the live pass was deferred | §6 |

The spec itself gained two departures and sixteen §7.3 rulings, all recorded in
commit `7b4b4b0` **before** any code was written.

---

## 3. What the wave found, and where it came from

| Finding | Found by |
|---|---|
| The mutation harness's first two runs were **worthless** — `npx vitest run shared` also selects `functionSharedSync.test.ts`, which fails for any edit to a `shared/` file | investigating a single kill I could not explain |
| **16 of 62 mutations survived** once that was fixed | the corrected harness |
| Three orphaned registry names, and blind spot 5 reopened | a systematic sweep of registered names against the seed |
| Blockade's Inoffensive-only blockader: neither springs nor is spent | **re-reading all twelve card texts after everything was built** |
| Two redundant guards no test could distinguish from their absence | surviving mutations |
| Three guards that are genuinely unobservable, kept and documented | surviving mutations |
| `legalZonesFor`'s new parameter reaching all five call sites | making it **required**, so `tsc` found them |
| Mixed LF/CRLF across `shared/`, silently breaking multi-line mutation anchors | a mutation reported as a skip rather than a result |
| A test asserting zone 1 for a **tank** — which is water, and never legal | the test failing for the right reason on the first run |
| A test asserting a `null` price key is malformed — it means **absent** | the test failing; the expectation was the defect |

**The single highest-value pass was again the cheapest**: reading the twelve
card texts once more, in one sitting, after all twelve were green. That is what
found the Inoffensive-only case, and nothing else would have.

**The most expensive lesson was mutation scope.** Wave 5's close-out warned
that a file-scoped run reports false *survivors*. The mirror is worse: a
too-*wide* scope that includes the `shared/`-to-edge-function drift test
reports false **kills**, and a false kill hides a real gap instead of merely
wasting an investigation. The first run read 62/62 and proved nothing.

### The twelve tests that only exist because a mutation survived

Four were tests that passed for reasons unrelated to their names:

- *"a DWG Waters rider is never handed a deploy context"* passed because the
  Blockade rider came **first** in `zoneEffects` and the pass returned at its
  own one-battle guard before ever reaching DWG Waters. Ordering, not the
  membership check, was carrying it.
- *"ignores the blockader's own deploy"* put **no enemy hull** in the zone, so
  the mutated dispatch bailed on an empty defender list rather than the side
  check.
- *"removes only that side's blockade"* put both riders on the **same side**.
- The malformed-price tests only ever used a card with **no CP price**, where
  the "at least one price" gate already refused — so the malformed branch and
  `Math.floor` were never reached at all.

---

## 4. The three surviving mutations, and why they stay

Each is documented at its own site so the next wave's run does not
re-investigate them.

1. **DP7's ordering** — the dispatch sits after `resolvePlayEffects`' failure
   check, so a failed play springs nothing. `applyAction` works on a
   `structuredClone` and discards the whole clone on failure, so the ordering
   has no observable consequence either way. Kept because it is free and it is
   the honest order; there cannot be a test for it.
2. **Judgement's re-validation on resolve** — `declareForcedBattle` already
   re-validates every listed id against the board on its own side in that zone,
   which subsumes every case the check catches. Kept because
   `braveheartActivate` carries the identical line and the two cards should not
   diverge. This redundancy predates wave 6.
3. **Blockade's stash type guard** — `zoneById(undefined)` already returns
   undefined and the next line refuses. The guard is load-bearing for
   **TypeScript** (`data` is `Record<string, unknown>`) and for nothing else.

Two other survivors were resolved by **deleting** the line, wave 5's own
precedent for a survivor no test can distinguish: `blockadeSpring`'s duplicate
`activeBattle` guard, which was making the dispatcher's unobservable, and its
`mine.length === 0` check, subsumed by the `attackerIds` check.

---

## 5. Beyond the twelve cards

**G4 closes guard blind spot 5.** G1/G2/G3 all iterate seeded *cards* and ask
whether each one's effects exist; none asks the reverse, so deleting a card's
meta key orphans its implementation silently. G4 reads `registeredEffectNames()`
off the registry, skips `t_`-prefixed stand-ins, and fails on anything else no
seeded card names. **Verified by registering an orphan and watching it fail**,
not by assuming.

The three real orphans are kept registered on purpose, in an asserted,
shrink-only `DELIBERATE_ORPHANS` map with the reason for each: a game dealt
before the balance pass carries a frozen snapshot that still names them (spec
§9.2), so deleting the registration would change an in-flight game mid-game —
and *reusing* one of those names for a different card is the Kraken/Paddlegun
collision itself. An orphan is fine; an unexplained one is not.

**`scripts/mutation-harness.mjs`** keeps the runner, with both of its bugs
fixed. Wave 5 ran 62 mutations and left its harness in a gitignored scratchpad,
so wave 6 rebuilt it — and rebuilt both bugs along the way. The next wave
inherits the fixes.

**Two docs a passing suite could not contradict** were corrected, because
nothing asserts prose: `architecture.md` said `KNOWN_GAPS` was "EMPTY as of
wave 5" while it held twelve entries, and `card-effects.md` still carried the
swept-clean claim above.

**Blind spot 6 is untouched** — nothing still compares the generated SQL to the
live `cards` table. It was the kickoff's suggested cheap win; wave 6 closed
blind spot 5 instead, which the wave's own findings made the more urgent of the
two.

---

## 6. What is left unverified

### ⚠ The entire live pass

**Nothing in this wave has run against the deployed backend.** By the owner's
decision the branch stops at the PR, so merging is what deploys it (the
Supabase GitHub integration deploys on merge to `main`, and functions are
deployed only if declared in `supabase/config.toml` — a failed migrate step
silently skips the deploy).

Three things follow, and the first is a real ordering risk:

1. ⚠ **The seed will NOT be applied by merging, and this wave needs it applied.**
   Merging to `main` runs migrate + deploy — it **never reseeds card data**.
   The CLI seeds from `[db.seed].sql_paths` (default `supabase/seed.sql`); this
   repo has no such file and `config.toml` deliberately carries no `[db.seed]`
   block, so applying card data is a **manual `execute_sql` of
   `supabase/seed/seed_data.sql`**.

   Seven cards' `meta` changed this wave, which makes that step load-bearing
   rather than a formality. Merge without it and the deployed code finds
   Albacore with no `aircraftLock`, Victoria with no `activateMaterialCost`,
   and Purifier with neither key — **every one of them silently inert**, with
   no error and no log line, because the guards read the repo rather than the
   live table (blind spot 6). The four cards whose behaviour lives in a
   registry name (Basher, Nothung, Balmung, Harbringer) would work; the ones
   whose behaviour is seeded data would not, and the failure would look like
   nothing at all.

   There is precedent for exactly this being forgotten: commit `8e124b3`
   ("Loggerhead drops Scrappy", 2026-08-27) sat on `main` for days while
   production still carried the old keywords.
2. **The catalog probe is unproven for four new names.** `nothungOnPlay`,
   `balmungOnPlay`, `harbringerBattle`, `victoriaActivate` and `blockadeEffect`
   all carry `{ needsCatalog: true }`, asserted at runtime by unit tests — but
   the probe itself is edge-function code, outside the root tsconfig, with no
   test harness. A name the probe cannot supply is a card that never fires, in
   production only.
3. **Blockade has never run anywhere but in unit tests.** A battle declared for
   the player who is **not acting**, out of a play handler, is a shape
   production has never executed.

### The post-merge run, in the order it should happen

1. **Apply `supabase/seed/seed_data.sql` by hand** (`execute_sql`) — merging
   does not do it (see above) — then confirm `game-action` incremented past
   **v14**, and verify **by content**, not file count: type-only imports are
   erased in transpilation, so a correct deploy legitimately reads back with
   fewer modules. A quick seed check that does not need the whole file:
   `select name, meta from cards where name in ('Albacore','Victoria','Purifier')`
   should show `aircraftLock`, `activateMaterialCost` and both Purifier keys.
2. Grep the deployed bundle for `dispatchDeployWatchers`, `blockadeEffect`,
   `aircraftLock`, `lostBattleOnTurn`, `activateMaterialCost`.
3. Drive one game per faction pair. **Blockade deserves its own pass**: prove
   the rider survives jsonb, that the spring names the **blockader** as
   aggressor, that the overlay renders for both players, and that the aftermath
   removes the rider only on a wipe.
4. Browser-verify in a **fresh tab** — `read_console_messages` returns a
   cumulative buffer that survives reloads, so pre-fix errors otherwise read as
   a fix that did not work. Check the Blockade badge renders, Victoria's board
   button appears with a material-only price, and a locked zone refuses an
   aircraft.
5. ⚠ Before any of that, the harness needs extracting: `smoke-wave5.mjs`
   exports nothing and runs its own scenarios on import (§2). Pull `signIn` /
   `buildDeck` / `startGame` / `step` into `scripts/smoke-lib.mjs` first, then
   write the wave-6 spec against it. Three things that harness already knows
   and a fresh one would have to relearn: `ATTACK_ENEMY_FLEET` does not always
   lock (a Stealthy or omissible defender raises the response window instead,
   and the lock — with it DP2's whole dispatch — happens on
   `RESPOND_TO_ATTACK`); staging spans turns, because income is *set* to
   `floor(turnNumber) × 75k` rather than accumulated; and **a live test whose
   result depends on the shuffle is not a test yet**.

### Smaller gaps

- **Victoria's activation chain is unit-tested only.** The ruling (per-hull,
  per-turn, bounded by materials) is asserted through `applyAction`, but a real
  three-link chain across one turn's income has never been played.
- **Purifier has never been deployed for real.** Its prerequisite needs a lost
  battle in a zone within the last full round — a two-turn setup no unit test
  fixture has to earn.
- **Paladin's base damage is unverified in a battle report.** Ruling B-7 makes
  a surged Paladin deal 120 rather than 240, which only a real report shows.
- **The `deploy` phase reaches exactly one effect.** If a second card ever
  wants DP7, the opt-in set is what keeps it from meeting a phase it was not
  written for — proven by test, never by a second customer.

### Not built, deliberately

- **Blind spot 6** (generated SQL vs the live `cards` table) — still open, see
  §5.
- **`HandBar.tsx`'s `ALL_TRIGGER_KEYS`** still duplicates the registry's
  private list. Wave 6 added no key to `TRIGGERS`, so it did not bite.
- **SS/WF/GT hero powers** remain unbuilt (spec §10, out of scope throughout).

---

## 7. The one thing worth carrying forward

Wave 5's lesson was to read the primary source again after building against
it — and then, in its own correction, to make sure you are reading **all** of
it. Wave 6's is the same shape, one level down: **check that your instrument
measures what you think it measures.**

The mutation harness reported 62 kills out of 62. That is a *better* result
than wave 5's 57-of-62, and it was entirely false — every mutation was being
killed by a drift test that fails for any edit to a `shared/` file, and 16 real
gaps were hidden behind it. Nothing in the output looked wrong. What exposed it
was refusing to accept one kill I could not explain.

A green result you cannot account for deserves the same suspicion as a red one.
Wave 5 wrote that "a green test written for a bug you have not yet fixed is a
finding, not a relief" — this is that rule applied to the tooling rather than to
a single test:

```bash
# Before trusting a mutation run, prove the harness can FAIL for the right
# reason: mutate one line, and confirm which test caught it.
npx vitest list <your scope>   # and read the list, rather than assuming it
```

The corollary is cheaper still, and this wave earned it twice: **a tool you had
to rebuild is a tool the last wave should have kept.** `scripts/mutation-harness.mjs`
is in the repo now, with both bugs fixed, so wave 7 starts where wave 6
finished rather than where wave 5 did.
