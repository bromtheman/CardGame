# Effect Coverage Wave 3 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the nine `wave 3` entries in `KNOWN_GAPS` by building forced
battles (DP3), battle summons, a battle continuation, and DP6's hand direction.

**Architecture:** `battleDeclare.ts` splits into `setBattle` / `lockBattle` /
`declareForcedBattle`, so a forced battle can be declared without spending the
zone's activation. `ActiveBattle` gains `summons` (combatants that never touch
`zone.cards` and evaporate on approval) and `continuation` (an effect re-entered
when the battle resolves — where a battle wait lives, because `pendingEffect`'s
freeze cannot host one). All five forced-battle target picks go through the
existing `choice` primitive, so no new picking UI is needed.

**Tech Stack:** TypeScript (strict), pure-function engine in `shared/`, vitest,
React 19 + Tailwind v4 frontend, Supabase edge functions (Deno).

**Spec:** `docs/superpowers/specs/2026-08-27-effect-coverage-design.md` —
**binding**. §4.3 (with its four departures), §4.4, §6, §7.3 and §8's wave-3
table are this plan's authority. Read §4.3's departures before Task 2.

**Handoff:** `docs/superpowers/plans/2026-08-27-effect-coverage-wave-3-handoff.md`
— §4's eleven traps are real and each one bit someone. Read §4.1, §4.2, §4.4 and
§4.10 before starting.

---

## Global Constraints

Every task's requirements implicitly include all of these.

- **Every commit touching `shared/` runs `npm run functions:sync` and includes
  its output.** `supabase/seed/functionSharedSync.test.ts` fails otherwise.
- **Relative imports inside `shared/` carry the `.ts` extension.** Deno runs
  these files verbatim.
- **Consumers import `shared/engine/index.ts`, never individual engine modules.**
  Tests too, or the registries are empty.
- **A new file in `shared/` needs three things**: a side-effect import in
  `shared/engine/index.ts`, an entry in `supabase/functions/shared-manifest.json`
  under `game-action`, and the sync. The drift test generates one case per
  manifest entry, so expect a `+1` test count beyond your own.
- **`state.log` is public** and so is `pendingEffect.options`. No line and no
  option may name a card in a hidden hand or deck.
- **All randomness through `ctx.rng()`, all ids through `ctx.newId()`.**
- **Constants go in `shared/gameSettings.ts`.** Never inline a tunable.
- **An effect that reads `ctx.catalog` — directly, via `catalogCard`, or through
  a `drawFromPool` catalog pool — MUST register with `{ needsCatalog: true }`.**
  Unit tests cannot catch a missing flag (`makeCtx` hand-builds the catalog), so
  this is a production-only failure: green suite, 400 on every real play.
- **Never use a real seeded effect name as an "unimplemented" test stand-in.**
  Use synthetic `t_`-prefixed names.
- **Gates before any merge:** `npx vitest run` (never `--root`),
  `npx tsc -p tsconfig.json --noEmit`, `npm --prefix frontend run build`.
  Baseline at branch point: **423 passed / 29 files**, tsc exit 0, build exit 0,
  lint exit 0 with 7 pre-existing warnings.

### Why this plan carries no implementation bodies

Handoff §6 measured wave 2: its plan inlined every test and every implementation,
so the code got written twice — once by the planner, once by an implementer
transcribing it — and the plan alone was 45% of a ~6,000-line diff. This plan
names files, signatures, exact values and the non-obvious constraints, and lets
the implementer write the code. If a step feels underspecified, that is a bug in
the step — report it rather than guessing.

### Process rules for whoever dispatches these tasks

1. **Tell every implementer, in the dispatch, that the brief may be wrong.**
   Literally: *"If the brief conflicts with what the code shows, stop and report
   it rather than complying."* This is free, and in wave 2 it caught two
   production bugs.
2. **Every test written must answer: "would this fail if the production line it
   covers were reverted?"** The implementer answers by actually reverting the
   line, watching the test go red, and restoring — transcript in the report.
   This is what surfaced every weak test in wave 2 and it replaces most of what
   a per-task reviewer was doing.
3. **Dedicated per-task review on Tasks 1, 2, 3, 4, 6, 7, 8 and 9** — every task
   touching state shape, engine control flow, or a freeze. Tasks 6, 7 and 8 make
   the list because they write `state.pendingEffect`, which *is* the freeze.
   Tasks 5, 10, 11 and 12 are card and UI work over settled machinery; the teeth
   check plus the suite is the gate there, and the final review is the net.
   (Eight of twelve, against wave 2's seventeen of seventeen.)
4. **One final whole-branch review on the most capable model available**, given
   the whole diff, the spec and the running ledger. In wave 2 it found the two
   worst bugs, and it found them *because* it saw across tasks.
5. **Demand terse reports:** verdict, findings with `file:line` and a failure
   scenario, one line on what was checked. Detail goes in the report file.

### Task order

Tasks 1–4 are strictly sequential and everything else depends on them. Tasks
5–10 are logically independent but **must still run sequentially**: each deletes
entries from `KNOWN_GAPS` and decrements the same `toHaveLength` literal in
`supabase/seed/effectCoverage.test.ts`, and several share a faction effects file.

---

### Task 1: State shape — `summons`, `continuation`, and G3's row

Handoff §4.2 orders this first: `REACHABLE_TRIGGERS` must gain its row *before*
any card can leave `KNOWN_GAPS`, or the first card that closes fails G3 with a
message that reads "this card is mis-wired" rather than "the table is stale".

**Files:**
- Modify: `shared/engine/engineTypes.ts` — `ActiveBattle`, new `BattleContinuation`
- Modify: `shared/engine/gameInit.ts:81` — the **inline structural duplicate** of
  `ActiveBattle` inside `PublicGameState`
- Modify: `shared/engine/gameEngine.ts` — `normalizeState`
- Modify: `shared/effects/registry.ts` — `EffectPayload`
- Modify: `supabase/seed/effectCoverage.test.ts` — `REACHABLE_TRIGGERS` + its comment
- Test: `shared/engine/gameEngine.test.ts`

**Interfaces — Produces:**

```ts
// shared/engine/engineTypes.ts
export interface BattleContinuation {
  effect: string                    // registry name re-entered when the battle resolves
  side: Side
  card: CardInstance
  data?: Record<string, unknown>    // effect-owned continuation state
}

export interface ActiveBattle {
  /* ...existing fields unchanged... */
  summons: ZoneCardEntry[]
  continuation: BattleContinuation | null
}

// shared/effects/registry.ts — EffectPayload gains one optional field
continuation?: BattleContinuation   // set ONLY by the battle-resolve dispatch
```

- [ ] **Step 1: Write the failing tests**

Three tests in `shared/engine/gameEngine.test.ts`:
1. `normalizeState` on a row whose `activeBattle` is non-null but lacks
   `summons` defaults it to `[]`. **This is the row that exists in production
   the moment you deploy** — a live game mid-battle. `participantsOf` spreading
   `undefined` is a crash, not a fizzle (handoff §4.10).
2. The same for `continuation` → `null`.
3. `normalizeState` on a row whose `activeBattle` is `null` leaves it `null` and
   does not throw.

Follow the existing per-entry stamp loop at the bottom of `normalizeState` for
the nested-defaulting pattern.

- [ ] **Step 2: Run the tests and watch them fail**

`npx vitest run shared/engine/gameEngine.test.ts` — expect failures naming
`summons`/`continuation` as undefined.

- [ ] **Step 3: Add the fields**

Both `ActiveBattle` declarations must gain both fields — `engineTypes.ts` and
the inline copy in `gameInit.ts`. They are structurally duplicated, not aliased,
so `tsc` will not connect them for you. `normalizeState` defaults both inside an
`if (state.activeBattle)` guard.

`EffectPayload` gains `continuation?: BattleContinuation`. Comment it: set only
by the battle-resolve dispatch, and it is what lets an effect tell "re-entered
after my battle" apart from "first entry", which otherwise have identical
payload shapes.

- [ ] **Step 4: Add `playOnCardEffect` to G3's vehicle row**

`REACHABLE_TRIGGERS.vehicle` gains `'playOnCardEffect'` — and **only** that.
After Task 10 corrects Trebuchet's key, no vehicle carries `playOnVehicleEffect`,
so adding it would be an allowance with no customer. (This is a divergence from
handoff §4.2, which assumed Trebuchet kept its key. Spec §4.3, departure 4.)

The long comment above the table currently reasons that "a vehicle can only ever
be played through `PLAY_CARD_TO_ZONE` (every other handler in placement.ts
rejects `card.type !== 'ability'`)". Task 4 makes that **false**. Rewrite the
comment to say a vehicle carrying `playOnCardEffect` is played through
`PLAY_CARD_TARGETING_CARD_IN_HAND` with a `zoneId`, citing spec §4.3 DP6.

- [ ] **Step 5: Run the full suite, tsc and the sync**

```bash
npx vitest run && npx tsc -p tsconfig.json --noEmit && npm run functions:sync
```

Expect 426 passed (423 + your 3). `git status` should show the synced
`supabase/functions/game-action/shared/**` copies as modified.

- [ ] **Step 6: Prove the tests have teeth**

Revert each of the two `normalizeState` default lines in turn, confirm the
matching test goes red, restore. Paste the transcript into your report.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(engine): add ActiveBattle.summons and .continuation, and G3's vehicle playOnCardEffect row"
```

---

### Task 2: `declareForcedBattle` and the summon-minting primitives

**Read spec §4.3's departure 1 before writing a line.** The spec's own DP3 row
says "reusing `lockBattle`", and handoff §4.9 explains why that is a trap:
`lockBattle` stamps `zone.lastActivatedTurn` unconditionally, which contradicts
§4.3's ruling that a forced battle is not a zone activation. Reused unchanged it
silently spends the zone's one activation per turn, and the symptom appears two
actions later as a 409 "That zone was already activated this turn" on a
legitimate fleet attack.

**Files:**
- Modify: `shared/engine/battleDeclare.ts`
- Modify: `shared/effects/primitives.ts`
- Test: `shared/engine/battleDeclare.test.ts` (create if absent),
  `shared/effects/primitives.test.ts`

This task introduces **no** new constant — nothing here is a tunable. If you
find yourself wanting one, that is a signal you have misread the task; report it.

**Interfaces:**
- Consumes: `BattleContinuation`, `ActiveBattle.summons` (Task 1)
- Produces:

```ts
// shared/engine/battleDeclare.ts
export function declareForcedBattle(game: EngineGame, spec: {
  zoneId: number
  aggressor: Side
  attackerIds: string[]
  defenderIds: string[]
  summons?: ZoneCardEntry[]
  continuation?: BattleContinuation | null
  cause: string            // card name, for the log line
  activatesZone?: boolean  // stamps lastActivatedTurn; Eclipse alone passes true
}): boolean

// shared/effects/primitives.ts
export function mintHull(
  game: EngineGame, ctx: EngineContext, snapshot: SnapshotCard, keywords?: string[],
): ZoneCardEntry
export function summonHulls(
  game: EngineGame, ctx: EngineContext, cardName: string, count: number, keywords?: string[],
): ZoneCardEntry[] | null      // null when the card is missing from the catalog
export function enemyVehicleOptions(
  game: EngineGame, actor: Side,
  zoneId: number | null,       // null = every zone; Orbit Flank mode (b) needs this
  filter?: (e: ZoneCardEntry) => boolean,
): ChoiceOption[]              // { id: instanceId, label: card name }
```

- [ ] **Step 1: Write the failing tests**

In `battleDeclare.test.ts`:
1. A forced battle does **not** set `zone.lastActivatedTurn` — and a subsequent
   `ATTACK_ENEMY_FLEET` in that zone still succeeds. Assert the second half; the
   stamp alone is an implementation detail, the 409 is the bug.
2. With `activatesZone: true` it **does** stamp, and the subsequent
   `ATTACK_ENEMY_FLEET` 409s.
3. `ATTACK_ENEMY_FLEET` still stamps `lastActivatedTurn` and still logs
   "Fleet battle declared" (regression: the split must not change it).
4. Summons passed in land in `state.activeBattle.summons` and **not** in
   `zone.cards` on either side.
5. It returns `false` on each of: unknown `zoneId`; a battle already active;
   empty `attackerIds`; empty `defenderIds`; an id in `attackerIds` that is
   neither on the field on the aggressor's side nor among `summons`.

In `primitives.test.ts`:
6. `summonHulls` returns entries with fresh `ctx.newId()` ids, printed keywords
   plus granted ones de-duplicated, and pushes nothing into any zone.
7. `summonHulls` returns `null` for a name absent from the catalog.
8. `enemyVehicleOptions` lists only the enemy's vehicles in that zone, and
   respects the filter.

- [ ] **Step 2: Run them and watch them fail**

- [ ] **Step 3: Split `battleDeclare.ts` three ways**

- `setBattle(game, spec)` — the **only** place the `activeBattle` object literal
  is constructed, so the next field added to it is one edit rather than three.
  It sets `summons: []` and `continuation: null` by default.
- `lockBattle` — `setBattle` plus the `lastActivatedTurn` stamp plus the existing
  "Fleet battle declared in zone N — X vs Y. Fight it in From The Depths, then
  report results." line. `ATTACK_ENEMY_FLEET` and `RESPOND_TO_ATTACK` must be
  behaviourally byte-identical afterwards.
- `declareForcedBattle` — validates, calls `setBattle` with the summons and
  continuation, stamps `lastActivatedTurn` **only** when `activatesZone`, and
  logs its own line naming the cause. Keep the "Fight it in From The Depths,
  then report results." tail: players rely on it to know what the overlay wants.
  Do **not** say "Fleet battle" — these are usually 1v1.

**Set no alert card** (spec §4.3, departure 2).

- [ ] **Step 4: Extract `mintHull` out of `spawnInto`**

`spawnInto` currently builds the `ZoneCardEntry` literal and pushes it. Split the
construction into `mintHull` and have `spawnInto` call it, so the per-entry stamp
list (`playedOnTurn`, `movedOnTurn`, `activatedOnTurn`) lives in one place.
`summonHulls` is `catalogCard` + `count` × `mintHull`, returning the array
without touching any zone.

- [ ] **Step 5: Run everything, sync**

`npx vitest run && npx tsc -p tsconfig.json --noEmit && npm run functions:sync`

- [ ] **Step 6: Prove the tests have teeth**

Revert the `activatesZone` guard so the stamp is unconditional; test 1 must go
red. Revert one validation branch; its test must go red. Restore both.
Transcript in the report.

- [ ] **Step 7: Commit**

---

### Task 3: Summons and the continuation in battle resolution

**Files:**
- Modify: `shared/engine/battleResolve.ts`
- Test: `shared/engine/battleResolve.test.ts`

**Interfaces:**
- Consumes: `ActiveBattle.summons` / `.continuation` (Task 1), `declareForcedBattle` (Task 2)
- Produces: `participantsOf` merges summons; `EffectPayload.continuation` is
  populated exactly here and nowhere else

- [ ] **Step 1: Write the failing tests**

1. A summon appears in `participantsOf` and its ending HP is **required** by
   `SUBMIT_BATTLE_REPORT`'s completeness check.
2. A summon reported at 0% is **not** pushed to `state.destroyed` on either side,
   and is not in `zone.cards`.
3. A summon reported at 100% is likewise gone after approval — it evaporates
   regardless of HP.
4. A summon id in `SUBMIT_BATTLE_REPORT`'s `repairs` is rejected (400).
   Same for `DECIDE_BATTLE_REPORT`'s `repairs`.
5. A **Scrappy** summon in the 80–89.999% band is not auto-repaired and its
   owner is not charged. (`autoRepairIds` must receive the non-summon roster.)
6. A summon carrying an `onDeathEffect` that would be observable does **not**
   fire it. Register a synthetic `t_`-prefixed effect for this; do not reuse a
   real seeded name.
7. The "Battle resolved — N vehicle(s) lost" count excludes summons.
8. A `continuation` set on the battle is invoked after approval, receives
   `payload.continuation` with its `data` intact, and runs **after** the death
   triggers.
9. A `continuation` whose `effect` is not registered logs and drops rather than
   throwing — the rollback escape, matching `pendingEffect`'s.
10. `state.activeBattle = null` after approval clears summons and continuation
    with it.

- [ ] **Step 2: Run them and watch them fail**

- [ ] **Step 3: Implement**

- `participantsOf`: build a `Map` of `battle.summons` by `instanceId`, then for
  each id in `attackerIds` fall back to it when the zone lookup misses (side =
  `battle.aggressor`), and the same for `defenderIds` (side = the defender).
  **Do not add a side field to summons** — list membership already decides it,
  which is what lets wave 4's defender-side Parapet work unchanged (§4.4).
- A local `isSummon(battle, id)` predicate reads better than repeating the map
  lookup at each of the four sites that need it.
- `validateRepairChoices` rejects a summon with its own message, e.g.
  `${name} is a summoned vehicle and cannot be repaired`.
- `autoRepairIds` is called with the non-summon roster only.
- The resolution loop skips summons entirely: no `zone.cards` filter (they were
  never there), no `discardCard`, no `destroyedEntries` push, no
  `destroyedCount` increment. Emit **one** summary line covering them — six
  Martyrs must not produce six log lines.
- The continuation fires after the `destroyedEntries` death-trigger loop, before
  the handler returns. Read it into a local **before** `state.activeBattle` is
  nulled.

- [ ] **Step 4: Run everything, sync**

- [ ] **Step 5: Prove the tests have teeth**

Revert the summon skip in the resolution loop so a summon reaches `discardCard`;
test 2 must go red. Revert the `autoRepairIds` roster filter; test 5 must go red.
Restore both. Transcript in the report.

- [ ] **Step 6: Commit**

---

### Task 4: `deployVehicle` extraction and DP6's hand direction

**Files:**
- Modify: `shared/engine/placement.ts`
- Modify: `shared/engine/engineTypes.ts` — `GameAction`
- Test: `shared/engine/placement.test.ts`

**Interfaces:**
- Produces:

```ts
// shared/engine/placement.ts — extracted from PLAY_CARD_TO_ZONE, unexported
// unless a test needs it; returns the ids it placed (card + additionalSpawns
// + resourceSurge copies), for placedInstanceIds.
function deployVehicle(
  game: EngineGame, ctx: EngineContext, actor: Side,
  card: CardInstance, zoneId: number, surged: boolean,
): string[]

// shared/engine/engineTypes.ts
| { type: 'PLAY_CARD_TARGETING_CARD_IN_HAND'; instanceId: string; targetInstanceId: string; zoneId?: number }
```

- [ ] **Step 1: Write the failing tests**

1. `PLAY_CARD_TO_ZONE` still deploys a vehicle with `additionalSpawns` and with
   `resourceSurge` exactly as before (regression over the extraction — assert
   the placed count and that the surge is read **before** payment).
2. A **vehicle** carrying `playOnCardEffect` played via
   `PLAY_CARD_TARGETING_CARD_IN_HAND` with a legal `zoneId` deploys to that zone
   **and** fires the effect with `targetInstanceId`.
3. The same play with **no** `zoneId` is rejected (400).
4. The same play with an **illegal** `zoneId` for that hull's biome is rejected
   (400) — `legalZonesFor` still gates it.
5. The vehicle is **not** `spendCard`'d: it is on the board and absent from
   `state.destroyed`.
6. An **ability** carrying `playOnCardEffect` still plays exactly as before, with
   or without a stray `zoneId` (regression).
7. A vehicle carrying `playOnCardEffect` played through plain
   `PLAY_CARD_TO_ZONE` deploys and does **not** fire the effect — the
   no-legal-target escape (spec §4.3, departure 4).

- [ ] **Step 2: Run them and watch them fail**

- [ ] **Step 3: Implement**

Extract `deployVehicle` from `PLAY_CARD_TO_ZONE`'s vehicle branch and call it
from both handlers. In `PLAY_CARD_TARGETING_CARD_IN_HAND`, replace the blanket
`card.type !== 'ability'` rejection with: an ability behaves as today; a vehicle
requires a `zoneId` that `legalZonesFor` admits, deploys through `deployVehicle`,
fires via `resolvePlayEffects` with `['playOnCardEffect', 'onPlayEffect']` plus
`placedInstanceIds`, and is **not** `spendCard`'d.

Order matters and the existing handler already gets it right — keep it: validate
that `targetInstanceId !== instanceId` and that the target is in hand **before**
`takeFromHand` removes the played card.

Read the surge **before** `pay()`, as `PLAY_CARD_TO_ZONE` does; paying first
reduces materials and can flip the condition off before the spawn count is
decided.

- [ ] **Step 4: Run everything, sync**

- [ ] **Step 5: Prove the tests have teeth**

Revert the `legalZonesFor` check on the vehicle branch; test 4 must go red.
Revert the surge-before-pay ordering; test 1 must go red. Restore. Transcript.

- [ ] **Step 6: Commit**

---

### Task 5 (batched ×3): Flying Squirrel Attack, Martyr Attack, Gang Up

Three `playOnVehicleEffect` ability cards that declare a forced battle against a
single named target. Batched because they share one shape and one review surface.

**Files:**
- Modify: `shared/effects/dwgEffects.ts` (Flying Squirrel Attack, Gang Up)
- Modify: `shared/effects/wfEffects.ts` (Martyr Attack)
- Modify: `shared/gameSettings.ts`
- Modify: `supabase/seed/source/builtInCards/DWG-built-in.js`, `WF-built-in.js`
- Modify: `supabase/seed/effectCoverage.test.ts`
- Test: `shared/effects/factionEffects.test.ts`

**Exact values:**

| Card | Effect name | Seed correction | Behaviour |
|---|---|---|---|
| Flying Squirrel Attack | `flyingSquirrelAttackEffect` | `ON_PLAY` → `PLAY_ON_VEHICLE` | target fights alone vs `FLYING_SQUIRREL_ATTACK_COUNT` (3) × `'Flying Squirrel'` |
| Martyr Attack | `martyrAttackEffect` | `'MartyrAttackEffect'` → `'martyrAttackEffect'` | `MARTYR_ATTACK_COUNT` (4) × `'Martyr'`, or `MARTYR_ATTACK_BOOSTED_COUNT` (6) |
| Gang Up | `gangUpEffect` | none | target vs all the actor's non-Inoffensive vehicles in that zone; **no summons** |

New constants in `shared/gameSettings.ts`:
`FLYING_SQUIRREL_ATTACK_COUNT = 3`, `MARTYR_ATTACK_COUNT = 4`,
`MARTYR_ATTACK_BOOSTED_COUNT = 6`, `MARTYR_ATTACK_BOOST_MIN_COST = 400_000`.

**Martyr Attack's boost condition** — card text: "If it is an airship, or a
player design costing 400k+". So: `vehicleType === 'airship'` **OR**
(`isBuiltIn === false` **AND** `materialCost >= MARTYR_ATTACK_BOOST_MIN_COST`).
"Player design" is `isBuiltIn === false` per spec §7.3. The cost is the
**printed** `materialCost`, never `effectiveMaterialCostOf`.

**All three:** the target must be an **enemy** vehicle — reject one of the
actor's own. Find it with `findVehicle`, which returns the zone and the side.
The battle's `zoneId` is the target's zone, `aggressor` is the actor,
`defenderIds` is `[targetInstanceId]` alone ("fights alone" — its allies do not
join, §7.3).

**Flying Squirrel Attack and Martyr Attack need `{ needsCatalog: true }`.**
Gang Up does **not** — it reads no catalog. Getting this wrong on the first two
is a green suite and a 400 on every real play.

**Gang Up** fails (returns `false`) when the actor has no non-Inoffensive vehicle
in that zone.

- [ ] **Step 1: Write the failing tests**

Per card: the happy path (battle declared, right attackers, right defenders,
summons where applicable); rejection of a friendly target; and for Martyr Attack
both the 4 and the 6 branches plus a player design **under** 400k staying at 4
and a **built-in** 400k+ ship staying at 4. For Gang Up: an Inoffensive friendly
vehicle in the zone is excluded from `attackerIds`, and a zone containing only
Inoffensive friendlies fails.

Also assert none of the three sets `zone.lastActivatedTurn` — a fleet attack in
that zone afterwards must still succeed.

- [ ] **Step 2: Run them and watch them fail**

- [ ] **Step 3: Implement, correct the seed, and close the gaps**

Register all three. Apply the two seed corrections in the table above. In
`supabase/seed/effectCoverage.test.ts` delete the three `KNOWN_GAPS` entries and
change `toHaveLength(22)` to `toHaveLength(19)` — **in this same commit.** The
stale-entry assertion fails the moment a listed card starts working, so you
cannot close a card and tidy the map later.

Before registering, confirm each name appears exactly once across
`supabase/seed/source/builtInCards/*.js` (handoff §4.11: registering
`paddlegunEffect` in wave 1 made Kraken silently fire Paddlegun's effect).
`martyrAttackEffect` is a rename — grep for the old capitalisation everywhere,
not just in the seed.

- [ ] **Step 4: Run everything, sync**

`npx vitest run && npx tsc -p tsconfig.json --noEmit && npm run functions:sync`

- [ ] **Step 5: Prove the tests have teeth**

Revert Martyr Attack's boost condition to a constant 4; the 6-branch test must go
red. Revert Gang Up's Inoffensive filter; its test must go red. Restore both.

- [ ] **Step 6: Commit**

---

### Task 6: Air Strafe

The first effect that **suspends on a choice and then declares a battle**. The
ordering is the point: the chosen hull joins as a third summon, so the choice
must resolve *before* `declareForcedBattle` is called. It cannot be the other way
round — `pendingEffect`'s freeze admits no battle action.

**Files:**
- Modify: `shared/effects/ssEffects.ts`
- Modify: `shared/gameSettings.ts` — `AIR_STRAFE_PREDATOR_COUNT = 2`
- Modify: `supabase/seed/source/builtInCards/SS-built-in.js`
- Modify: `supabase/seed/effectCoverage.test.ts` — delete entry, `19` → `18`
- Test: `shared/effects/factionEffects.test.ts`

**Exact values:** effect name `airStrafeEffect`; seed correction
`PLAY_ON_ZONE` → `PLAY_ON_VEHICLE`; summons `AIR_STRAFE_PREDATOR_COUNT` ×
`'PredatorX'`, plus one of `'Hydra'` / `'Cyclone'` when the target is a player
design. Registers with **`{ needsCatalog: true }`**.

**Target restriction:** card text says "Choose an enemy **ship**", so
`vehicleType === 'ship'` — reject anything else, and reject a friendly.

**The trap in this task.** Re-entry through `RESOLVE_PENDING_EFFECT` passes only
`resolution` and `pending`. It does **not** preserve `targetInstanceId` or
`targetZoneId` — and although the action *shape* carries a `targetInstanceId`,
that value is client-supplied and must not be trusted. Stash the target's
instanceId and zoneId in the choice's `data` on first entry and read them back
from `payload.pending.data` on re-entry.

Bind the effect name to a const and pass it as `choice({ effect: NAME })`; a
wrong name compiles, passes every unit test that calls the effect directly, and
fails only when a real player answers the dialog.

Hydra is an `airship` and Cyclone a `sub`; neither is gated by the target zone's
biome, because summons bypass placement legality (§4.3).

- [ ] **Step 1: Write the failing tests**

1. Target is a built-in ship → battle declared immediately with 2 summons, no
   suspension.
2. Target is a **player design** ship → `state.pendingEffect` is written, options
   are exactly Hydra and Cyclone, and **no battle is declared yet**.
3. Resolving that choice declares the battle with **3** summons, the third being
   the chosen hull.
4. The target's zone and instanceId survive the suspension — assert the battle
   lands in the right zone with the right defender, with a game state where a
   naive re-read of `targetZoneId` would pick the wrong zone.
5. A non-ship target is rejected; a friendly target is rejected.

- [ ] **Step 2: Run them and watch them fail**
- [ ] **Step 3: Implement, correct the seed, close the gap**
- [ ] **Step 4: Run everything, sync**
- [ ] **Step 5: Prove the tests have teeth** — revert the `data` stash and read
      `targetZoneId` from the payload instead; test 4 must go red. Restore.
- [ ] **Step 6: Commit**

---

### Task 7: Orbit Flank

**Two chained choices.** The slot is cleared *before* the effect is re-entered,
which is exactly what lets a continuation suspend again (spec §4.2).

**Files:**
- Modify: `shared/effects/lhEffects.ts`
- Modify: `supabase/seed/source/builtInCards/LH-Built-in.js`
- Modify: `supabase/seed/effectCoverage.test.ts` — delete entry, `18` → `17`
- Test: `shared/effects/factionEffects.test.ts`

**Exact values:** effect name `orbitFlankEffect`; seed correction is removing the
**trailing space** in `'orbitFlankEffect '`. Trigger key stays `ON_PLAY`.
Registers with **`{ needsCatalog: true }`**.

Leave `shared/effects/registry.test.ts` alone — it uses the literal
`'orbitFlankEffect '` as a hand-built fixture for `effectName`'s trim, which is
correct and independent of the seed row.

**Card text:** "Choose one: Spawn a friendly orbit into any zone and give it the
TEMPORARY keyword, or choose one enemy vehicle and have it fight alone against an
orbit."

- Choice 1: two options, mode (a) and mode (b). Label them from the card text.
- Mode (a) → choice 2 over the three zones → `spawnVehicles`-style **board
  spawn** of one `'Orbit'` with `temporary`. Note the printed Orbit already
  carries `TEMPORARY`, so the grant is idempotent — pass it anyway to match the
  card text; the keyword merge de-duplicates.
- Mode (b) → choice 2 over the enemy's vehicles (`enemyVehicleOptions`, all
  zones — the text does not restrict to one zone) → forced battle, that vehicle
  alone vs one `'Orbit'` **battle summon**.

Mode (a) is a board spawn and mode (b) a battle summon; this card is the evidence
that the split lives in the data rather than being invented (§4.4). A board-spawn
Orbit enters `zone.cards`; a summoned one never does.

Carry the mode across the second suspension in `data`.

- [ ] **Step 1: Write the failing tests**

1. First entry writes a pendingEffect with exactly two mode options.
2. Choosing (a) suspends **again**, with the zones as options.
3. Resolving that spawns one Orbit into the chosen zone's `zone.cards`, carrying
   `temporary` exactly once.
4. Choosing (b) suspends again with the enemy's vehicles as options.
5. Resolving that declares a forced battle whose single summon is an Orbit, and
   the Orbit is **not** in `zone.cards`.
6. Neither mode stamps `lastActivatedTurn`.

- [ ] **Step 2: Run them and watch them fail**
- [ ] **Step 3: Implement, correct the seed, close the gap**
- [ ] **Step 4: Run everything, sync**
- [ ] **Step 5: Prove the tests have teeth** — revert the mode stash in `data`;
      test 3 or 5 must go red. Restore.
- [ ] **Step 6: Commit**

---

### Task 8 (batched ×3): Braveheart, Eclipse, and the `eclipseEffect` stand-in

Two near-identical activated abilities plus one mechanical test rename that must
land with them.

**Files:**
- Modify: `shared/effects/ssEffects.ts` (Braveheart), `shared/effects/lhEffects.ts` (Eclipse)
- Modify: `supabase/seed/source/builtInCards/SS-built-in.js`, `LH-Built-in.js`
- Modify: `shared/engine/placement.test.ts` — the stand-in rename
- Modify: `supabase/seed/effectCoverage.test.ts` — delete two entries, `17` → `15`
- Test: `shared/effects/factionEffects.test.ts`

**Exact values:**

| Card | Effect name | Seed meta to author | Target filter | Stamps `lastActivatedTurn`? |
|---|---|---|---|---|
| Braveheart | `braveheartActivate` | `ON_ACTIVATE: 'braveheartActivate'`, `activateCpCost: 1` | any enemy vehicle in its own zone | no |
| Eclipse | `eclipseEffect` | add `activateCpCost: 0` (keeps existing `ON_ACTIVATE`) | enemy vehicles in its own zone **excluding Stealthy** | **yes** — pass `activatesZone: true` |

Braveheart ships with a completely empty `meta: {}`, so both keys are content you
author, not merely implement. Eclipse's text says "Once per turn" and never
mentions CP, unlike Braveheart's "pay 1cp" — hence `0`. Without an explicit
`activateCpCost`, `ACTIVATE_VEHICLE` and `BoardZone`'s button both refuse, and
the ability is unreachable; that is Eclipse's state today.

Neither needs `{ needsCatalog: true }` — no summons, no catalog.

Both use `enemyVehicleOptions` scoped to the activating hull's own zone, then
`declareForcedBattle` with `attackerIds: [self]`, `defenderIds: [chosen]`.

`ACTIVATE_VEHICLE` stamps `entry.activatedOnTurn` **before** the effect fires, so
a suspending activation cannot be re-entered through a second activation. You get
that for free; do not re-implement it.

**Eclipse is not *blocked* by `lastActivatedTurn`, only consumes it.** Its text
says using it prevents a later fleet battle in that zone, and says nothing about
a prior one preventing it.

**The stand-in rename.** `shared/engine/placement.test.ts` (~lines 164–172) uses
the real name `eclipseEffect` as its "vehicle with an unimplemented `onActivate`
deploys fine with exactly one vanilla note" fixture. **That test silently stops
testing anything the moment you register `eclipseEffect`** — it keeps passing,
having asserted nothing. Rename it to a synthetic `t_`-prefixed name. Leave
`ambushEffect` and `sabotageEffect` in the same file alone; they are wave 5's.

- [ ] **Step 1: Write the failing tests**

Per card: activation with CP suffices → suspends with the right options;
resolving declares a 1v1 with the right attacker and defender; a second
activation the same turn 409s; Braveheart with 0 CP is rejected. For Eclipse:
a Stealthy enemy is absent from the options, and after use a fleet attack in that
zone 409s. For Braveheart: after use a fleet attack in that zone still succeeds.

Also: `activateCpCost: 0` still permits activation (guard against a truthiness
bug that would treat 0 as "no ability").

- [ ] **Step 2: Run them and watch them fail**
- [ ] **Step 3: Implement, author the seed meta, rename the stand-in, close the gaps**
- [ ] **Step 4: Run everything, sync**
- [ ] **Step 5: Prove the tests have teeth** — revert Eclipse's `activatesZone`;
      its 409 test must go red. Revert the Stealthy filter; the options test must
      go red. Restore both. Then confirm the renamed placement.test.ts fixture
      still fails when its production line is reverted.
- [ ] **Step 6: Commit**

---

### Task 9: Trebuchet

The only three-phase effect in the wave, and the only consumer of
`ActiveBattle.continuation`. **Dedicated review.**

**Files:**
- Modify: `shared/effects/owEffects.ts`
- Modify: `supabase/seed/source/builtInCards/OW-Built-in.js`
- Modify: `supabase/seed/effectCoverage.test.ts` — delete entry, `15` → `14`
- Test: `shared/effects/factionEffects.test.ts`

**Exact values:** effect name `trebuchetEffect`; seed correction
`PLAY_ON_VEHICLE` → `ON_PLAY` (spec §6 and §4.3 departure 4). No
`{ needsCatalog: true }` — it summons nothing.

**Card text:** "When Played, you may choose to have this vehicle battle an
opponents vehicle from the same zone in a 1v1. If the trebuchet wins without
becoming damaged beyond repair, fully heal it and you may repeat this effect."

**Three entry modes, and how to tell them apart:**

| Entry | Distinguisher | Does |
|---|---|---|
| (a) on play | `resolution === undefined && continuation === undefined` | choice over enemy vehicles in `targetZoneId`; declining via `cancel` is "you may" |
| (b) choice answered | `resolution !== undefined` | `declareForcedBattle` 1v1, setting `continuation` to itself |
| (c) battle resolved | `continuation !== undefined` | win test; on a win, re-offer (a)'s choice |

`payload.continuation` (Task 1) is what makes (a) and (c) distinguishable — their
payloads are otherwise identical shapes. This is the reason that field exists.

**The win test needs no outcome plumbing.** Read it off the post-resolution
state: Trebuchet **survived** if `continuation.card.instanceId` is still in
`zone.cards[side]`, and **won** if every id in `continuation.data.defenderIds` is
gone from the enemy's side of that zone. Stash `zoneId` and `defenderIds` in
`continuation.data` at declare time.

**"Fully heal it" needs no mechanic.** The board tracks no HP; Trebuchet prints
`SCRAPPY`, which already repairs it free across the whole 80–89.999% band. Do not
invent a healing step (spec §7.3).

**The repeat is unbounded but self-limiting** — each iteration needs another
clean win and another enemy vehicle left in that zone. Impose no cap; card text
imposes none.

**Empty options do not suspend.** If the zone holds no enemy vehicle, `choice`
calls `resolve(payload, null)` immediately. Write `resolve` to handle
`choiceId === null` by doing nothing and returning `true` — Trebuchet must still
deploy successfully into an empty zone.

Note `placement.ts` logs "<card> deployed" unconditionally, including when the
effect has suspended and the game is now frozen on a choice. Pre-existing across
every suspending on-play effect, cosmetic, out of scope — do not fix it here.

- [ ] **Step 1: Write the failing tests**

1. Played into a zone with an enemy vehicle → deploys **and** suspends with that
   vehicle as an option.
2. Played into a zone with no enemy vehicle → deploys, no suspension, no failure.
3. Cancelling the choice leaves Trebuchet deployed and declares no battle.
4. Answering declares a 1v1 whose `continuation` names `trebuchetEffect` and
   carries the zone and defender ids in `data`.
5. Approving a report where the defender dies and Trebuchet survives ≥90%
   re-suspends with the **remaining** enemy vehicles as options.
6. Approving a report where the defender dies and Trebuchet is **destroyed**
   offers no repeat.
7. Approving a report where the defender **survives** offers no repeat, even if
   Trebuchet survived.
8. Trebuchet at 85% (its Scrappy band) with the defender dead **does** offer the
   repeat — "without becoming damaged beyond repair" includes the repair band.
9. A second win chains a third battle (the repeat is genuinely repeatable).

- [ ] **Step 2: Run them and watch them fail**
- [ ] **Step 3: Implement, correct the seed, close the gap**
- [ ] **Step 4: Run everything, sync**
- [ ] **Step 5: Prove the tests have teeth** — revert the survived half of the
      win test so only the defender's death is checked; test 6 must go red.
      Revert the `defenderIds` stash; test 5 must go red. Restore both.
- [ ] **Step 6: Commit**

---

### Task 10: Excalibur

DP6's only customer, and the last card.

**Files:**
- Modify: `shared/effects/ssEffects.ts`
- Modify: `shared/gameSettings.ts` — `EXCALIBUR_COST_DELTA = -200_000`
- Modify: `supabase/seed/source/builtInCards/SS-built-in.js`
- Modify: `supabase/seed/effectCoverage.test.ts` — delete entry, `14` → `13`
- Test: `shared/effects/factionEffects.test.ts`

**Exact values:** effect name `excaliburEffect`; seed meta to author on a card
that ships `meta: {}` — `PLAY_ON_CARD: 'excaliburEffect'`. No
`{ needsCatalog: true }`.

**Card text:** "Pick one AI ship in hand and reduce its cost by 200k." Per spec
§7.3, "AI" is `isBuiltIn === true`. The existing `costDelta` primitive already
does exactly this — use it with
`{ delta: EXCALIBUR_COST_DELTA, filter: { type: 'vehicle', vehicleType: 'ship', isBuiltIn: true } }`.

A choice is **forbidden** here: `pendingEffect.options` is public and would leak
the actor's hand (§4.2, departure 5). The hand pick is a client-side targeting
mode (Task 11), validated server-side by the handler.

`costDelta` is read only by `effectiveCostInGame`, never by
`effectiveMaterialCostOf` — so repairs, base damage, in-battle resources and the
Temporary cull are untouched. Deltas stack additively.

The card stays playable through plain `PLAY_CARD_TO_ZONE` when the actor holds no
AI ship, with the effect unfired (§4.3, departure 4). Do not make a 550k blocker
unplayable.

- [ ] **Step 1: Write the failing tests**

1. Played to a legal zone targeting an AI ship in hand → deploys **and** the
   target's `meta.costDelta` is `-200000`; `effectiveCostInGame` for that target
   drops by 200k.
2. Targeting a player-made ship is rejected; targeting a non-ship is rejected.
3. Two Excaliburs stack to `-400000` on the same target.
4. `effectiveMaterialCostOf` on the target is **unchanged** — the discount must
   not reach repairs or base damage.
5. Excalibur played plainly to a zone deploys with no effect and no error.

- [ ] **Step 2: Run them and watch them fail**
- [ ] **Step 3: Implement, author the seed meta, close the gap**

`KNOWN_GAPS` is now 13 entries: 8 wave 4, 5 wave 5. Update the
"waves 1 and 2 are complete" test to also assert **no `wave 3` entry remains**,
matching the existing wave-1/wave-2 assertions.

- [ ] **Step 4: Run everything, sync**
- [ ] **Step 5: Prove the tests have teeth** — revert the `isBuiltIn: true`
      filter; test 2 must go red. Restore.
- [ ] **Step 6: Commit**

---

### Task 11 (batched ×2): Frontend — summons in the overlay, Excalibur's pick

**Files:**
- Modify: `frontend/src/pages/game/BattleOverlay.tsx`
- Modify: `frontend/src/pages/game/HandBar.tsx`
- Modify: `frontend/src/pages/game/GameBoardPage.tsx`

**`BattleOverlay`** keeps its **own** local `ActiveBattle` type and its own mirror
of `participantsOf` (the engine does not export one). Both need the summon merge,
using the same list-membership rule as Task 3 — attacker ids take the aggressor's
side, defender ids the defender's.

Then: label summons visibly as summoned (they are not on anyone's board and will
vanish), and **disable their repair checkbox** — the engine rejects a summon
repair with a 400, so an enabled control is a trap. `autoRepairIds` is imported
from the engine by this file; make sure the roster you hand it excludes summons,
matching Task 3, or the preview will disagree with what the engine does.

**Excalibur's pick** is a two-step mode: choose the AI ship in hand, then choose
the destination zone, then send
`PLAY_CARD_TARGETING_CARD_IN_HAND { instanceId, targetInstanceId, zoneId }`.
`HandBar` already drives targeting modes off meta keys via `effectName`, and
`GameBoardPage` already has a `moveMode` `pickZone` phase — chain the existing
pieces rather than inventing a mode. Offer the hand pick only when the actor
holds a legal target (built-in ship); otherwise leave the plain zone play.

No change is needed to `PendingChoiceDialog`, `BoardZone` or `games.ts` — that is
what the choice-dialog decision bought (spec §4.3, departure 4).

- [ ] **Step 1: Build and lint**

```bash
npm --prefix frontend run build && npm --prefix frontend run lint
```

Both must exit 0. Lint has **7 pre-existing warnings across 5 files**
(`react(set-state-in-effect)` ×5, `react(only-export-components)` ×2). Do not
chase them, and do not report a smaller number without counting.

- [ ] **Step 2: Browser-verify**

Start the dev server through the preview tools with the `frontend` launch config
(never raw Bash). Check `read_console_messages` for zero errors, and `read_page`
for the overlay rendering. `frontend/.env.local` does not travel into a worktree
— copy it from the main checkout first.

**Wave 2 shipped its UI without ever exercising it in a real game**, because that
needs a signed-in account and a live two-player game. If you cannot get one,
**say so explicitly in your report** rather than implying it was verified — that
honesty is why this plan knows the risk exists.

- [ ] **Step 3: Commit**

---

### Task 12: Documentation, and wave 4's handoff

Handoff §6 names this "the one thing not to cut". Wave 4 will know only what you
write down.

**Files:**
- Modify: `docs/claude/architecture.md`, `card-effects.md`, `supabase.md`, `testing.md`
- Create: `docs/superpowers/plans/<the date you write it>-effect-coverage-wave-4-handoff.md`
- Create: `docs/superpowers/plans/<the date you write it>-effect-coverage-wave-4-kickoff.md`

Both filenames follow the wave-3 pattern exactly — `YYYY-MM-DD-effect-coverage-wave-4-{handoff,kickoff}.md`
— dated the day you write them, not the day this plan was written.

- [ ] **Step 1: Promote durable lessons into `docs/claude/`**

Route by subject, not by convenience: effects → `card-effects.md`, engine and
state → `architecture.md`, deploy → `supabase.md`, test traps → `testing.md`.

At minimum: `architecture.md`'s "Known gaps" list must lose the two DP6 entries
this wave closed and gain `ActiveBattle.summons`/`.continuation`; its freeze
section must record that a battle wait is **not** a `pendingEffect`;
`card-effects.md` must document `summonHulls` / `mintHull` /
`enemyVehicleOptions` and the "stash continuation state in `data`, never trust a
re-sent `targetInstanceId`" rule; `testing.md` must drop `eclipseEffect` from its
stand-in offenders list.

- [ ] **Step 2: Write wave 4's handoff**

Same shape as wave 3's: where things stand with **your own** measured numbers,
what wave 3 built that wave 4 stands on, what wave 4 owns, the traps (keep the
ones still live, delete the ones you closed, add the ones you found), what you
did **not** verify, and how to run the wave with wave 3's measured costs.

Wave 4 owns `onBattleEffect` / `onBattleVictory` / `onBattleDefeat` (DP2), the
Buzzsaw/Veles defender rule, Plunderer's clause 2, and DWG Waters' clauses 2–3 —
both `PARTIAL` entries are labelled wave 4. Tell them that Onyx Throne's
defender-side Parapet works because summons carry no side field, and that
Terawatt's "join a friendly vehicle forced to fight alone" hooks
`declareForcedBattle`.

Record honestly which of the two guard blind spots are still open, and whether
the browser checks in Task 11 actually ran.

- [ ] **Step 3: Write wave 4's kickoff prompt**

Same shape as wave 3's: what to read in what order, how to verify the baseline
(**your** numbers), the shape of the wave, and the one trap that will bite them
that they would not otherwise find.

- [ ] **Step 4: Commit**

---

## Deploying (after the final review, not before)

`docs/claude/supabase.md` carries the runbook. Three things in order:

1. **Check for live games holding the newly-registered names first.** A game's
   `meta` is frozen data, but the name → implementation mapping is code shared by
   every game at once, so an in-flight game whose snapshot already carries one of
   these nine names starts running the new implementation the instant this
   deploys. Query `games` for each name inside `state`/`game_players` and **flag
   any hit to a human** before proceeding.
2. **Apply the seed, then deploy `game-action`.** That order, learned the hard
   way in wave 2.
3. **Rebase or merge `main` before deploying.** A deploy ships your whole branch
   state, not your diff — wave 2 deployed from a stale branch and silently
   reverted a `main` fix in production for three hours.

Deploy with the entry file **plus every synced shared file**; a partial payload
deletes what you omit. Verify by **content, not file count** — a deployed
function legitimately reads back with fewer modules than you sent, because
type-only imports are erased in transpilation. Confirm the version incremented,
grep the bundle for symbols the new code introduces, and check `function_logs`
for clean boots.

Then **smoke-test in a real game**: play one card that mints from the catalog
without suspending (Flying Squirrel Attack) and one that suspends and then mints
(Air Strafe against a player design). The second is the only exercise
`state.pendingEffect.card`'s probe source ever gets — it has no unit test, and
`npx tsc` does not read `supabase/functions/**` at all.

## Definition of done

- [ ] `npx vitest run` green, and `KNOWN_GAPS` is **13** entries with no `wave 3`
      label remaining
- [ ] `npx tsc -p tsconfig.json --noEmit` exit 0
- [ ] `npm --prefix frontend run build` exit 0; lint exit 0 with 7 warnings
- [ ] `npm run functions:sync` output committed in every commit touching `shared/`
- [ ] Spec amended where reality diverged (done: commit `d75c4ee`) and amended
      again if this plan diverges from it during execution
- [ ] `docs/claude/*` updated by subject
- [ ] Wave 4's handoff and kickoff written
- [ ] Final whole-branch review completed, findings resolved or recorded
- [ ] PR opened against `main` (the owner reviews by PR, not local merge)
