# Wave 6 — close-out

Wave 6 was the 2026-08-30 balance pass's twelve cards. All twelve are built,
and `KNOWN_GAPS` is empty for the first time since that pass opened it.

Everything below is **measured on this branch**, not remembered. Where a number
here disagrees with an earlier document, believe the number.

**Shipped and verified live on 2026-08-31.** PR #25 merged (`874d87c`),
`game-action` deployed by CI at **v18**, the seed applied by hand, and
`scripts/smoke-wave6.mjs` green at **56/56** against the deployed backend. §6
records what the live run proved, and the shorter list of what it did not.

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
| `scripts/` — mutation harness, smoke lib, live wave-6 suite | 606 | 508 |

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
| `smoke-wave5.mjs` is "a **reusable harness** — point its `required` deck lists at your cards rather than writing a third one" | Half true. `startGame` *is* parameterised by `{ p1Faction, p1Required, … }`, but the file **exports nothing** and runs wave 5's scenarios at top level, so importing it runs wave 5's whole suite. Pointing it at wave 6's cards needed the plumbing extracted into a module first, which this wave then did: `scripts/smoke-lib.mjs` | §6 |

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

## 6. The live run

Deployed and verified on 2026-08-31. `scripts/smoke-wave6.mjs`, three staged
games against the real backend: **56/56 steps passed**.

| Step | How it landed |
|---|---|
| PR #25 merged | `874d87c` |
| `game-action` deployed | **v18**, ACTIVE, CI entrypoint (`file:///app/...`) |
| verified by CONTENT | all 18 wave-6 symbols present in the deployed bundle |
| seed applied | `supabase/seed/seed_data.sql` by hand — 133 cards + 7 hero powers |
| `scripts/smoke-wave6.mjs` | **56/56** |
| `scripts/smoke-wave5.mjs` | **27/27**, re-run on top of wave 6 |

### The seed warning was not hypothetical

Production was queried **before** the seed went in, and it looked exactly as
this section predicted: Albacore, Tarpon, Chrysaor, Paladin and Purifier all
carried `meta: {}` — **inert, with no error and no log line** — while Victoria
and Judgement had an `onActivate` and no price key, an ability with no way to
press it. The four cards whose behaviour lives in a registry name worked fine.
The merge had already deployed the code; only the seed was missing.

### What the live run proved that no unit test could

| Proved live | Why a unit test could not |
|---|---|
| **The catalog probe for four new names** — Nothung minted a Sacrilego, Balmung a Hydra, Victoria a second Victoria, and the Blockade rider fired | `makeCtx` hands every unit test a catalog, so a missing `{ needsCatalog: true }` or an unreached probe source is invisible until production |
| **DP7 end to end** — a fleet battle declared on the *deployer's own turn*, with the blockader as aggressor | a battle declared for the player who is not acting, out of a play handler, is a shape production had never executed |
| **`ZoneState.lostBattleOnTurn` through jsonb** — `{"a":12.5,"b":null}` after the losing side was stamped, and only in the zone that fought | a new `PublicGameState` field has to survive Postgres, which no in-memory test exercises |
| **`ActiveBattle.continuation` through jsonb** — it rode along and correctly removed nothing, because the blockader held the zone | same |
| **Seeded data actually driving behaviour** — `aircraftLock`, both `resourceSurge` variants, `activateMaterialCost`, `activateCpCost`, Purifier's two keys | a unit test asserts the CODE reads a key; only this asserts the SEED carries it |
| **Ruling C-1, in production** — the owner's own aircraft was refused from the locked zone and the **enemy's was not** | the ruling most likely to be wrong, and the one assertion that would have said so |
| **Ruling B-7** — a surged Paladin landed carrying `["halfCost","temporary"]` and was **culled at the next turn start** | a price-only implementation passes every other assertion; only the cull separates them |
| **Judgement's live discount** — charged 440,000 against a printed 540,000, off an enemy airship in another zone | the `costModifier` reads the whole enemy board, which needs a real board |

### Three harness bugs, and why they are worth recording

The suite failed twice before it passed, and **not once because of engine
code** — the same score wave 5's harness got, for the same reason.

1. **Paladin's "under 240k" clause was tested at 250k.** The Chrysaor step
   before it had spent down from 450k, leaving the balance on the wrong side of
   the threshold. Four steps failed and the engine was right every time. The
   fix is structural: the two threshold cards now have their **own game at a
   deliberately slow 20k/turn**, where the natural ramp lands inside the window
   rather than racing past it.
2. **The cull assertion passed vacuously.** With Paladin never landed, `hull`
   was `undefined` and `.some(c => c.instanceId === undefined)` is false — so
   "the Temporary hull was culled" reported **green for a card that was never
   there**. Wave 5's lesson was that a green test written for a bug you have
   not yet fixed is a finding; this is its twin, a green test for a card that
   never played.
3. **The assertion pinning ruling C-1 could not run**, because no SS aircraft
   happened to be in hand. It reported a failure rather than a pass, which is
   the right way round — but the ruling went unverified for a run. Falcon
   Squadron is `required` now rather than hoped for, and an AIR_SCREEN
   precondition makes any future failure attributable rather than ambiguous.

The deeper point is the one wave 5 already wrote down and wave 6 re-earned: **a
live test whose result depends on the shuffle is not a test yet.** Two of these
three were exactly that.

### The harness is now actually reusable

`scripts/smoke-lib.mjs` holds the plumbing; `smoke-wave5.mjs` and
`smoke-wave6.mjs` are scenarios only. Re-running wave 5 against the extracted
lib is what proved the extraction behaviour-preserving — and, incidentally,
re-verified wave 5's five cards on top of wave 6's changes.

Three capabilities wave 7 inherits rather than rebuilds: `spec.materialsPerTurn`
(per-lobby income, so an expensive card is reachable in two turns instead of
nine), and `waitForMaterials` / `spendInto` — the two halves of putting a player
on a chosen side of a materials threshold. They are two functions rather than
one because income is **set** at each turn start rather than accumulated, so it
only ever rises: a low threshold has to be spent into, and a high one waited
for.

## 6b. What is still unverified

Much shorter than it was, and none of it blocking.

- **Harbringer and Basher never fired.** Both were dealt into game A's WF deck
  and neither reached a battle before the scenarios needing one had finished.
  Harbringer's offer is the one that matters: it is the fifth
  `{ needsCatalog: true }` name and the only one the live run did not exercise.
  Its four siblings all fired, so the probe *source* they share is proven; what
  is unproven is that name specifically.
- **Purifier was only ever refused, never deployed.** The run proved the
  prerequisite REJECTS a zone with no recorded loss, and proved the loss record
  is written and survives jsonb — but the accepting path needs the same side to
  lose a battle and then deploy there, which the scenario ordering did not
  reach.
- **Blockade's removal path never ran.** The live battle resolved with the
  blockader surviving, so the rider remained — the "otherwise it remains" half.
  "If you lose with no surviving vehicles, the blockade goes away" is
  unit-tested only.
- **Victoria's activation chain is unit-tested only.** One activation ran live;
  a real three-link chain across one turn's income has not.
- **No browser pass.** The Blockade badge, Victoria's material-priced board
  button and the locked-zone refusal have never been looked at in the UI. The
  three smoke games can be kept for exactly that (`--keep`), and
  `read_console_messages` returns a cumulative buffer that survives reloads, so
  a fresh tab is the only honest way to read it.

### Two in-flight games hold stale snapshots

Games `6bee3210` (turn 1) and `15b949a5` (turn 6.5) were dealt **before** the
seed, so their frozen card snapshots carry the old empty `meta` and those
instances will play vanilla for the rest of those games. That is spec §9.2
working as designed — code retrofits live games immediately, data never does —
and it is the same rule that makes reusing a registry name dangerous. Left
untouched: rewriting live player hands is a decision, not a cleanup.

### Not built, deliberately

- **Blind spot 6** (generated SQL vs the live `cards` table) — still open, and
  this wave is its best illustration yet: nothing but a human noticing stood
  between the merge and six silently inert cards.
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
