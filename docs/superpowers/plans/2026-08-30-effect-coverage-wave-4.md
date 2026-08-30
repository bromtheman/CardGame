# Effect Coverage Wave 4 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build DP2 — the battle triggers — and close the eight wave-4 cards plus
Plunderer's and DWG Waters' remaining clauses.

**Architecture:** A new `shared/engine/battleTriggers.ts` owns the dispatch and is
called from three existing seams: `battleDeclare.ts` at lock, `battleResolve.ts`
at resolve, and `baseAttack.ts` for the bombardment case. Effects receive a
`BattleContext` on `EffectPayload.battle`. Two cards suspend at battle lock, so
`state.pendingEffect` and `state.activeBattle` become simultaneously non-null for
the first time — an invariant suite pins that behaviour before any card relies on
it. Defender omission (Buzzsaw, Veles) is not DP2 at all: it is a plain data key
read by `ATTACK_ENEMY_FLEET` into a second opt-out list on `awaitingResponse`.

**Tech Stack:** TypeScript (strict), vitest, Deno edge functions, Supabase.

**Spec:** `docs/superpowers/specs/2026-08-27-effect-coverage-design.md` — §4.3's
DP2 row and its seven "DP2 departure" subsections, §4.4 (battle summons), §4.8
(defender omission), §7.3 (six wave-4 rulings), §8's wave-4 table, §11's four new
test rows. Read those before Task 1.

## Global Constraints

Copied verbatim from `CLAUDE.md` and the spec. Every task's requirements include
these.

- **Shell is PowerShell.** No `&&` chaining; use `;` or separate calls.
- **Relative imports inside `shared/` carry the `.ts` extension.** Deno runs
  those files verbatim.
- **Consumers import `shared/engine/index.ts`**, never an individual engine
  module. A new file there needs a side-effect/re-export line **and** a
  `supabase/functions/shared-manifest.json` entry under `game-action`.
- **Every commit touching `shared/` includes `npm run functions:sync` output.**
  `supabase/seed/functionSharedSync.test.ts` fails otherwise, and it generates one
  case per manifest entry — a `+1` test delta is expected when a file is added.
- **Every commit touching a card's `meta` runs `npm run seed:build`** and commits
  the regenerated `supabase/seed/seed_data.sql`. `seedDataSync.test.ts` fails
  otherwise.
- **`registerEffect(name, fn, { needsCatalog: true })` is mandatory for any
  effect reading `ctx.catalog`** — directly, via `catalogCard`, via
  `drawFromPool`'s catalog branch, or via `summonHulls`. Unit tests cannot catch
  a missing flag (`makeCtx` hand-builds the catalog); the failure is
  production-only.
- **Any effect filtering `ctx.catalog` by hand must repeat
  `c.meta.summonOnly !== true`.** It is not inherited from `drawFromPool`.
- **`state.log` is public and so is `pendingEffect.options`.** No line may name a
  card in a hidden hand or deck.
- **Effect names are unique registry ids, never card names.** Grep the seed
  source before registering a new one.
- **Never `npx vitest run --root`** — include globs are root-relative and it
  matches zero files.
- **Never use a real seeded effect name as an "unimplemented" stand-in** in a
  test; use a synthetic `t_`-prefixed name.
- **A new `ZoneCardEntry` field must be added to `discardCard`'s destructure** in
  `shared/engine/gameEngine.ts` in the same change. TypeScript will not tell you.
  (No task here adds one, but a deviation might.)
- **Constants live in `shared/gameSettings.ts`.** Never inline a magic number.
- **KNOWN_GAPS is shrink-only.** Deleting an entry and decrementing the
  `toHaveLength` literal happen in the same commit that closes the card.

**Baseline, measured on this branch before Task 1:** `npx vitest run` → 521
passed / 30 files; `npx tsc -p tsconfig.json --noEmit` → exit 0;
`npm --prefix frontend run build` → exit 0; `npm --prefix frontend run lint` →
exit 0 with 7 pre-existing warnings across 5 files (`auth.tsx`,
`CardDetailsModal.tsx`, `ConfirmDialog.tsx` ×2, `HandBar.tsx` ×2,
`CreateCardPage.tsx`). Report every task's suite count as before→after against
this.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `shared/engine/battleTriggers.ts` | The whole DP2 dispatch: `BattleContext` construction, the three lock sources, the resolve pass, the base-attack pass, `battleOutcome`, `reviveEntry`. Registers no handler. |
| `shared/engine/battleTriggers.test.ts` | Dispatch mechanics against synthetic `t_`-named effects — who fires, who does not, in what order, and what the context carries. |
| `shared/engine/battleFreeze.test.ts` | The both-freezes-set invariant, driven by a synthetic suspending effect rather than by a card. |

**Modified**

| File | Change |
|---|---|
| `shared/engine/engineTypes.ts` | `BattleContext`; `AwaitingResponse.omissibleIds` |
| `shared/effects/registry.ts` | `EffectPayload.battle`; `BYSTANDER_EFFECTS` derived from `registerEffect`; `DATA_EFFECT_KEYS` += `defensiveOmission` |
| `shared/engine/gameInit.ts` | `omissibleIds` on the `awaitingResponse` structural copy |
| `shared/engine/gameEngine.ts` | `normalizeState` default for `omissibleIds`; rewrite the "both freezes cannot happen" comment |
| `shared/engine/battleDeclare.ts` | `ctx` on `lockBattle`/`declareForcedBattle`; `joinBattle`; lock dispatch; `omissibleIds` in `ATTACK_ENEMY_FLEET`/`RESPOND_TO_ATTACK` |
| `shared/engine/battleResolve.ts` | Outcome computed before nulling; resolve dispatch after death triggers, before the continuation |
| `shared/engine/baseAttack.ts` | `baseStrikersIn` extracted; DWG Waters interception; `onBattleVictory` dispatch |
| `shared/effects/{ss,ow,lh,dwg}Effects.ts` | The nine new registrations |
| `shared/gameSettings.ts` | Three constants |
| `frontend/src/pages/game/StealthyResponseBar.tsx` | Render omissible defenders beside stealthy ones |
| `supabase/seed/source/builtInCards/*.js` | Ten cards' `meta`; Onyx Throne's `cardText` |
| `supabase/seed/seed_data.sql` | Regenerated |
| `supabase/seed/effectCoverage.test.ts` | `REACHABLE_TRIGGERS` row; `KNOWN_GAPS` 13→5; `PARTIAL` 2→0; wave-4 assertion |
| `supabase/functions/shared-manifest.json` | `battleTriggers.ts` under `game-action` |
| `supabase/functions/game-action/index.ts` | Fourth catalog-probe source: `state.zoneEffects` |
| `docs/claude/*.md`, `docs/superpowers/plans/*` | Task 11 |

---

### Task 1: DP2 types, the dispatch module, and G3's row

The dispatch with no callers yet, so it can be tested in isolation before any
existing handler changes shape.

**Files:**
- Create: `shared/engine/battleTriggers.ts`, `shared/engine/battleTriggers.test.ts`
- Modify: `shared/engine/engineTypes.ts`, `shared/effects/registry.ts`,
  `shared/engine/index.ts`, `supabase/functions/shared-manifest.json`,
  `supabase/seed/effectCoverage.test.ts`

**Interfaces:**

Consumes: `EngineGame`, `EngineContext`, `Side`, `ZoneCardEntry`,
`effectFor`/`effectName` (`shared/effects/registry.ts`), `otherSide`/`zoneById`
(`shared/engine/gameEngine.ts`).

Produces — every later task depends on these exact names:

```ts
// shared/engine/engineTypes.ts
export interface BattleContext {
  phase: 'lock' | 'resolve' | 'baseAttack'
  zoneId: number
  isDefender: boolean
  isParticipant: boolean
  forced: boolean
  survived: boolean
  won: boolean
}

// shared/effects/registry.ts
interface EffectPayload { /* … existing … */ battle?: BattleContext }
export const BYSTANDER_EFFECTS: ReadonlySet<string>
export function registerEffect(
  name: string, fn: EffectFn,
  opts?: { needsCatalog?: boolean; battleBystander?: boolean },
): void

// shared/engine/battleTriggers.ts
export interface BattleParticipant { entry: ZoneCardEntry; side: Side }
export interface BattleOutcome { wonBy: Record<Side, boolean>; survived: Set<string> }

export function battleOutcome(
  participants: Map<string, BattleParticipant>,
  survivingIds: Set<string>,
  aggressor: Side,
): BattleOutcome

export function dispatchBattleLock(game: EngineGame, ctx: EngineContext, forced: boolean): void

export function dispatchBattleResolve(
  game: EngineGame, ctx: EngineContext,
  zoneId: number, aggressor: Side,
  participants: Map<string, BattleParticipant>, outcome: BattleOutcome,
): void

export function dispatchBaseAttackVictory(
  game: EngineGame, ctx: EngineContext,
  zoneId: number, actor: Side, strikers: ZoneCardEntry[],
): void

export function reviveEntry(game: EngineGame, side: Side, entry: ZoneCardEntry): boolean
```

**Behaviour to build (spec §4.3, DP2 departures 1, 2, 4, 6):**

- `battleOutcome` — a side `wonBy` is true when **no** enemy participant is in
  `survivingIds`. Summons count (departure 6). Both false is a draw; the caller
  never sees a "draw" flag, only two booleans.
- `dispatchBattleLock` reads `game.state.activeBattle!` and dispatches in this
  fixed order: attackers in `attackerIds` order, defenders in `defenderIds`
  order, then — only when `forced` — the defending side's non-participant zone
  entries whose `onBattleEffect` name is in `BYSTANDER_EFFECTS`, then
  `state.zoneEffects` entries on that zone whose `side` is the defending side.
  `survived`/`won` are `false` at lock; `isDefender` is `side !== aggressor`.
- Zone-effect riders are dispatched by `effectFor(entry.effect)` with
  `card: { ...catalogCard(ctx, entry.cardName), instanceId: ctx.newId() }`. A
  `cardName` missing from the catalog skips the rider silently — it is a data
  problem, not a game-stopping one.
- **Before every dispatch**, if `game.state.pendingEffect !== null`, skip the
  remaining triggers and push one log line naming the skipped card
  (departure 4). A trigger that returns `false` gets a log note and does not
  reject anything, exactly as `onDeathEffect` does today.
- `dispatchBattleResolve` fires `onBattleEffect` for every participant, then
  `onBattleVictory` for participants on a winning side and `onBattleDefeat` for
  those on a losing side. `survived` is per-participant.
- `dispatchBaseAttackVictory` fires `onBattleVictory` only, with
  `phase: 'baseAttack'`, `isParticipant: true`, `isDefender: false`,
  `forced: false`, `survived: true`, `won: true`.
- `reviveEntry` pushes `entry` back onto `zone.cards[side]` and splices **one**
  snapshot with the same `cardId` out of `state.destroyed[ownerSideOf(entry, side)]`.
  Returns `false` (changing nothing) when the zone is gone or no snapshot
  matches, so a caller can refuse rather than half-apply.

- [ ] **Step 1: Write the failing tests** in `shared/engine/battleTriggers.test.ts`.
  Register synthetic effects (`t_lockSpy`, `t_bystanderSpy` with
  `{ battleBystander: true }`, `t_resolveSpy`, `t_suspender`) that record their
  `payload.battle` into a module-level array. Cases, all using `makeGame()` /
  `makeCtx()` from `shared/engine/testFixtures.ts`:
  1. `battleOutcome` — attacker wipe → `wonBy.b` only; defender wipe → `wonBy.a`
     only; both sides holding a survivor → neither; **a surviving summon on the
     defending side denies the attacker a win** (departure 6).
  2. lock dispatch fires for a participant on **each** side, with `isDefender`
     matching, `isParticipant: true`, `survived: false`, `won: false`.
  3. lock dispatch fires for a **summon** listed in `defenderIds`.
  4. lock dispatch does **not** fire for a same-zone non-participant when
     `forced` is false.
  5. lock dispatch **does** fire for a same-zone, defending-side non-participant
     carrying a `battleBystander` effect when `forced` is true, with
     `isParticipant: false` — and does **not** fire for a non-participant whose
     effect is registered without the flag.
  6. lock dispatch fires a `zoneEffects` rider for the defending side, and not
     one belonging to the aggressor.
  7. once `t_suspender` has set `pendingEffect`, the next trigger in order is
     skipped and a log line names it (departure 4).
  8. resolve dispatch: `onBattleVictory` reaches only the winning side,
     `onBattleDefeat` only the losing side, `onBattleEffect` both.
  9. `reviveEntry` returns the hull to `zone.cards` and removes exactly one
     matching snapshot from `state.destroyed`, leaving a second copy in place.
  10. `reviveEntry` returns `false` and mutates nothing when no snapshot matches.

- [ ] **Step 2: Run and watch them fail.** `npx vitest run shared/engine/battleTriggers`
  → FAIL, "Cannot find module './battleTriggers.ts'".

- [ ] **Step 3: Implement** `BattleContext`, the `EffectPayload.battle` field,
  `BYSTANDER_EFFECTS` (derived from `registerEffect`, mirroring how
  `catalogEffects`/`CATALOG_EFFECTS` already work), and `battleTriggers.ts`.

- [ ] **Step 4: Add G3's row before any card needs it.** In
  `supabase/seed/effectCoverage.test.ts`, `REACHABLE_TRIGGERS.vehicle` gains
  `'onBattleEffect'`, `'onBattleVictory'`, `'onBattleDefeat'`. Leave the
  `ability` row alone — DWG Waters' riders are dispatched under its existing
  `playOnZoneEffect` key, not a new one.

- [ ] **Step 5: Register the file.** Add the export + side-effect import to
  `shared/engine/index.ts`, add `shared/engine/battleTriggers.ts` to
  `supabase/functions/shared-manifest.json` under `game-action`, and run
  `npm run functions:sync`.

- [ ] **Step 6: Full gates.** `npx vitest run` (expect 521 → ~541, +1 of which is
  the manifest drift case), `npx tsc -p tsconfig.json --noEmit`.

- [ ] **Step 7: Teeth check.** Revert one production line per behaviour — the
  `isParticipant` assignment, the `BYSTANDER_EFFECTS.has` guard, the
  `pendingEffect !== null` skip, and `battleOutcome`'s summon inclusion — rerun,
  and record which test went red for each. A mutation that produces a *different
  legal outcome* rather than a crash is the only one that proves anything
  (handoff §3).

- [ ] **Step 8: Commit.**

```bash
git add shared/engine/battleTriggers.ts shared/engine/battleTriggers.test.ts shared/engine/engineTypes.ts shared/effects/registry.ts shared/engine/index.ts supabase/functions/ supabase/seed/effectCoverage.test.ts
git commit -m "feat(engine): DP2 battle-trigger dispatch, with no callers yet"
```

---

### Task 2: Wire the lock dispatch, thread `ctx`, add `joinBattle`

**Files:**
- Modify: `shared/engine/battleDeclare.ts`, `shared/engine/battleDeclare.test.ts`,
  `shared/effects/{ssEffects,owEffects,lhEffects,dwgEffects,wfEffects}.ts`

**Interfaces:**

Consumes: `dispatchBattleLock` (Task 1).

Produces:

```ts
export function declareForcedBattle(game: EngineGame, ctx: EngineContext, spec: {
  zoneId: number; aggressor: Side; attackerIds: string[]; defenderIds: string[]
  summons?: ZoneCardEntry[]; continuation?: BattleContinuation | null
  cause: string; activatesZone?: boolean
}): boolean

// Appends to a battle already in progress — the only function that does.
// `entry` present  → a fresh hull: pushed onto summons AND onto the side's id list.
// `entry` absent   → an id already on the board: pushed onto the side's id list only.
export function joinBattle(
  game: EngineGame, side: Side, instanceId: string, entry?: ZoneCardEntry,
): boolean
```

`lockBattle` gains `ctx` as its second parameter, matching. Both call
`dispatchBattleLock` **after** `setBattle` and after their own log line, so the
line ordering a player reads is declare-then-trigger. `declareForcedBattle`
passes `forced: true`; `lockBattle` passes `false`.

`joinBattle` returns `false` when there is no active battle, when the id is
already a combatant, or when `entry` is absent and the id is not on `side`'s half
of the battle's zone.

**Call sites to update — nine, all of which already have `ctx` in scope:**
`ssEffects.ts` (Air Strafe ×2, Braveheart), `owEffects.ts` (Trebuchet),
`dwgEffects.ts` (Flying Squirrel Attack, Gang Up), `wfEffects.ts` (Martyr
Attack), `lhEffects.ts` (Orbit Flank, Eclipse). Confirm the count with
`grep -rn "declareForcedBattle(" shared/` before and after.

- [ ] **Step 1: Write the failing tests** in `battleDeclare.test.ts`:
  an ordinary `ATTACK_ENEMY_FLEET` lock dispatches to both sides' participants
  with `forced: false`; a `declareForcedBattle` lock dispatches with
  `forced: true`; a lock effect that pushes onto `activeBattle.summons` via
  `joinBattle` is visible to `participantsOf` in the same battle; `joinBattle`
  refuses a duplicate id, refuses with no active battle, and refuses an
  off-board id with no `entry`.
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement** the `ctx` parameter, `joinBattle`, and the two
  `dispatchBattleLock` calls; update all nine call sites.
- [ ] **Step 4: Full gates** — `npx vitest run`, `npx tsc`, and
  `npm --prefix frontend run build` (the frontend imports the engine).
- [ ] **Step 5: Teeth check** — swap `forced: true`/`false` between the two
  callers and confirm two different tests go red, not one.
- [ ] **Step 6:** `npm run functions:sync`, then commit.

---

### Task 3: Wire the resolve dispatch and the base-attack victory

**Files:**
- Modify: `shared/engine/battleResolve.ts`, `shared/engine/battleResolve.test.ts`,
  `shared/engine/baseAttack.ts`, `shared/engine/baseAttack.test.ts`

**Interfaces:**

Consumes: `battleOutcome`, `dispatchBattleResolve`, `dispatchBaseAttackVictory`
(Task 1).

Produces:

```ts
// shared/engine/baseAttack.ts — the single filter for "which hulls actually
// strike the base". baseDamageFrom now sums over this rather than repeating it.
export function baseStrikersIn(entries: ZoneCardEntry[], turnNumber: number): ZoneCardEntry[]
```

**Ordering inside `DECIDE_BATTLE_REPORT`** — insert, do not reorder anything
existing:

1. …validation, repair charging, the destruction loop… *(unchanged)*
2. summon-evaporation log *(unchanged)*
3. **new:** build `survivingIds` from the same `survives` predicate the loop
   already computes, and call `battleOutcome(participants, survivingIds, battle.aggressor)`
   — **before** `activeBattle` is nulled, or `zoneId` and `aggressor` are lost.
4. null `activeBattle`/`pendingReport`, "Battle resolved" log *(unchanged)*
5. `onDeathEffect` dispatch *(unchanged)*
6. **new:** `dispatchBattleResolve(...)`
7. `continuation` *(unchanged)*

`onDeathEffect` stays ahead of DP2 so Iron Cordon sees the airship already in
`state.destroyed` to revive it, and DP2 stays ahead of the continuation so
Trebuchet still runs last.

`ATTACK_ENEMY_BASE` calls `dispatchBaseAttackVictory` with
`baseStrikersIn(zone.cards[actor], game.turnNumber)` **after** `checkVictory` —
so a trigger cannot alter a game that has already ended.

- [ ] **Step 1: Write the failing tests.** In `battleResolve.test.ts`: a
  surviving participant's `onBattleEffect` fires with `survived: true` and a
  destroyed one's with `survived: false`; `onBattleVictory` fires only for the
  winning side; the DP2 pass runs **after** an `onDeathEffect` on the same card
  (assert log order) and **before** a `continuation`; a resolve trigger returning
  `false` logs a note and still leaves the report applied. In
  `baseAttack.test.ts`: `onBattleVictory` fires for a damage-contributing vehicle
  and **not** for a sub, an Inoffensive hull, or one played this turn;
  `baseDamageFrom` and `baseStrikersIn` agree on the same fixture.
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Full gates.**
- [ ] **Step 5: Teeth check** — move the DP2 call above the death-trigger loop and
  confirm the log-order test goes red; narrow `baseStrikersIn` to drop the
  Inoffensive clause and confirm a *different* base test goes red.
- [ ] **Step 6:** `npm run functions:sync`, then commit.

---

### Task 4: The both-freezes-set invariant suite

Decision 19's proof, standing on its own rather than on two cards that may change.
No card exists yet that suspends at lock — drive it with a synthetic effect.

**Files:**
- Create: `shared/engine/battleFreeze.test.ts`
- Modify: `shared/engine/gameEngine.ts` (comment only)

- [ ] **Step 1: Write the tests.** Register `t_lockChooser`, a
  `{ battleBystander: true }` effect that writes `state.pendingEffect` on first
  entry and returns `true` on re-entry. Drive a real `declareForcedBattle`
  through `applyAction` so both freezes end up set, then assert:
  1. Both `state.pendingEffect` and `state.activeBattle` are non-null at once.
  2. Every action type **except** `RESOLVE_PENDING_EFFECT`, `CONCEDE` and
     `ABANDON` is rejected — including `SUBMIT_BATTLE_REPORT` and
     `USE_HERO_POWER`, which the battle freeze alone would have admitted.
     Iterate `GameAction['type']` explicitly so a future action type cannot be
     added without this test seeing it.
  3. The **off-turn** side may answer, and the on-turn side may not (403).
  4. After `RESOLVE_PENDING_EFFECT`, `pendingEffect` is null, `activeBattle`
     still stands, and `SUBMIT_BATTLE_REPORT` → `DECIDE_BATTLE_REPORT` resolves
     the battle normally.
  5. The same, but answered with `{ cancel: true }`: the battle still resolves.
- [ ] **Step 2: Run.** These should pass **without any production change** — that
  is the finding. If any fails, stop and report before touching `applyAction`.
- [ ] **Step 3: Rewrite the stale comment** in `gameEngine.ts` above
  `pendingAdmitted` — "Why the both-set state cannot happen today" is now false.
  Replace it with what makes the state *safe*: pending is checked first, only
  `PENDING_ACTIONS` is admitted, `pendingAdmitted` keeps the battle check from
  rejecting the one action that can clear the slot, and `RESOLVE_PENDING_EFFECT`
  is an `OFF_TURN_ACTION` so the defender can answer on the aggressor's turn.
  Cite spec §4.3, DP2 departure 3 and decision 19.
- [ ] **Step 4: Teeth check** — delete `pendingAdmitted` from the battle-freeze
  condition and confirm case 4 goes red (the game would be unresolvable).
  Restore it.
- [ ] **Step 5:** `npm run functions:sync`, then commit.

---

### Task 5: Catshark, Dryad, The Onyx Throne — the three lock-phase cards

Batched: three cards, one dispatch point, all settled machinery (handoff §6,
"batch mechanical, related card work").

**Files:**
- Modify: `shared/effects/ssEffects.ts`, `shared/effects/owEffects.ts`,
  `shared/effects/factionEffects.test.ts`, `shared/gameSettings.ts`,
  `supabase/seed/source/builtInCards/{SS-built-in,OW-Built-in}.js`,
  `supabase/seed/seed_data.sql`, `supabase/seed/effectCoverage.test.ts`

**Constants:** `CATSHARK_MATERIALS = 30_000`.

**Seed metas** — note **Iron Cordon and The Onyx Throne have no `meta` object at
all** today, so one must be added rather than extended:

| Card | File | `meta` |
|---|---|---|
| Catshark | `SS-built-in.js` | `{ [TRIGGERS.ON_BATTLE_EFFECT]: 'catsharkBattle' }` |
| Dryad | `SS-built-in.js` | `{ [TRIGGERS.ON_BATTLE_EFFECT]: 'dryadBattle' }` |
| The Onyx Throne | `OW-Built-in.js` | `{ [TRIGGERS.ON_BATTLE_EFFECT]: 'onyxThroneBattle', [TRIGGERS.ON_ACTIVATE]: 'onyxThroneActivate', activateCpCost: 1 }` |

**The Onyx Throne's `cardText`** is missing a noun and is replaced with spec
§7.2's authored wording, verbatim:

> Whenever this vehicle would partake in a defensive battle, spawn an allied
> Parapet alongside it for that battle. Once per turn, you may pay 1cp to draw a
> GT heavy airship card.

**Implementations:**

- `catsharkBattle` (`ssEffects.ts`) — fires on `battle.phase === 'lock' &&
  battle.isParticipant`, either side (§7.3: "fleet combat" is any battle), then
  `grant({ materials: CATSHARK_MATERIALS })`. No rider: `endTurn` overwrites the
  incoming side's materials outright, so it expires by itself.
- `dryadBattle` (`ssEffects.ts`, `{ needsCatalog: true }`) — lock, participant,
  `isDefender` only; `spawnInto(game, ctx, actor, battle.zoneId, catalogCard(ctx, 'Dryad'))`.
  A **board** spawn (spec §4.4's wording table), so it does *not* join the
  battle. The dispatch iterates a participant snapshot taken before any effect
  runs, so the new Dryad cannot re-trigger this — assert that.
- `onyxThroneBattle` (`owEffects.ts`, `{ needsCatalog: true }`) — lock,
  participant, `isDefender` only; `summonHulls(game, ctx, 'Parapet', 1)` then
  `joinBattle(game, actor, hull.instanceId, hull)`. **Do not call
  `declareForcedBattle`** — it refuses outright when `activeBattle` is non-null,
  which at lock it always is.
- `onyxThroneActivate` (`owEffects.ts`, `{ needsCatalog: true }`) — reuse the
  existing `gtHeavyAirship` `drawFromPool` already defined in that file for
  Special Foundries (`minCost: GT_HEAVY_AIRSHIP_MIN_COST`). Do **not** filter on
  the `GT_AIRSHIP`/`GT_HEAVY_AIRSHIP` source-file arrays, which misreport at
  least two cards (handoff §4.7).

- [ ] **Step 1: Write the failing tests** in `factionEffects.test.ts`: Catshark
  gains 30k as attacker **and** as defender, and gains nothing when in the zone
  but not in the battle; Dryad spawns exactly one Dryad on a defensive lock, none
  on an offensive one, and the spawned copy is in `zone.cards` and **not** in
  `activeBattle.defenderIds`; a defensive lock with two Dryads participating
  spawns exactly two, not four (no re-trigger); Onyx Throne's Parapet appears in
  both `activeBattle.summons` and `defenderIds` and is visible to
  `participantsOf`; Onyx Throne's activation draws a GT airship of at least
  `GT_HEAVY_AIRSHIP_MIN_COST` and costs 1 CP.
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement** the constants, the four registrations, and the seed
  edits.
- [ ] **Step 4: Close the guard entries.** Delete `'SS:Catshark'`, `'SS:Dryad'`
  and `'OW:The Onyx Throne'` from `KNOWN_GAPS` and change `toHaveLength(13)` to
  `toHaveLength(10)` in the **same commit**.
- [ ] **Step 5: Regenerate and verify the seed.** `npm run seed:build`, then
  `grep -n "catsharkBattle\|dryadBattle\|onyxThroneBattle\|onyxThroneActivate\|Parapet alongside" supabase/seed/seed_data.sql`
  and confirm every name appears.
- [ ] **Step 6: Full gates**, then `npm run functions:sync`.
- [ ] **Step 7: Catalog-flag check by hand.** `tsc` and the unit tests cannot see
  a missing `{ needsCatalog: true }`. Re-read the three registrations that read
  the catalog and confirm the flag on each.
- [ ] **Step 8: Commit** — seed source, generated SQL, effects, tests, guard, and
  sync output together.

---

### Task 6: Sacrilego and Iron Cordon — the two reviving resolve cards

Both write `state.pendingEffect`, so both get a dedicated review pass.

**Files:**
- Modify: `shared/effects/ssEffects.ts`, `shared/effects/owEffects.ts`,
  `shared/effects/factionEffects.test.ts`, `shared/gameSettings.ts`,
  `supabase/seed/source/builtInCards/{SS-built-in,OW-Built-in}.js`,
  `supabase/seed/seed_data.sql`, `supabase/seed/effectCoverage.test.ts`

**Constants:** `SACRILEGO_HP_BOOST = 15`. The rescue band is
`SURVIVE_HP_PERCENT - SACRILEGO_HP_BOOST` (75) inclusive to `SURVIVE_HP_PERCENT`
(90) exclusive — derive it, never write 75.

**Seed metas:** Sacrilego `{ [TRIGGERS.ON_BATTLE_EFFECT]: 'sacrilegoBattle' }`;
Iron Cordon gains a whole `meta` object `{ [TRIGGERS.ON_BATTLE_EFFECT]: 'ironCordonBattle' }`.

**`sacrilegoBattle`** — resolve, participant, `survived`. Grants 1 CP
unconditionally first (clause 1 does not depend on clause 2), then offers a
`choice` over friendly **ships** destroyed in this battle whose reported HP sits
in the rescue band. `options` empty → the CP still lands and nothing suspends,
which is exactly `choice`'s empty-options rule. On resolve: `reviveEntry` the
chosen ship and sacrifice Sacrilego (remove from `zone.cards`, then
`discardCard`).

**`ironCordonBattle`** — resolve, participant, `survived`. Offers a `choice` over
allied vehicles destroyed in this battle with `faction === 'GT'` and
`vehicleType === VEHICLE_TYPES.AIRSHIP` (§7.3 — the full fourteen-card pool, not
the eight heavy). On resolve: `reviveEntry` the airship and sacrifice Iron Cordon.

**Both** must stash the candidate entries in the choice's `data` at first entry —
by resolve time the battle is gone and `state.destroyed` holds only snapshots
without `instanceId`. Read `payload.pending?.data` on re-entry, **never**
`payload.resolution.targetInstanceId`/`.zoneId`, both of which are
client-supplied and unvalidated (`docs/claude/card-effects.md`, "Suspending for a
choice"). Stashing a board vehicle leaks nothing — it was public on the field —
but re-check the stashed hull against the board before acting on it.

- [ ] **Step 1: Write the failing tests.** Sacrilego: survives → +1 CP; destroyed
  → no CP and no offer; survives with a friendly ship destroyed at 78% → an
  offer, and accepting revives that ship, removes exactly one snapshot from
  `state.destroyed`, and removes Sacrilego from the board into the discard;
  a friendly ship destroyed at **70%** produces no option (out of band); an enemy
  ship destroyed at 78% produces no option; declining via `cancel` leaves both
  the ship destroyed and Sacrilego alive; the CP lands in every one of these.
  Iron Cordon: an allied GT airship destroyed → offer; an allied **OW** airship
  or a GT **ship** destroyed → no offer; accepting revives the airship and
  sacrifices Iron Cordon; Iron Cordon destroyed in the same battle → no offer at
  all.
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Close the guard entries** — delete `'SS:Sacrilego'` and
  `'OW:Iron Cordon'`, `toHaveLength(10)` → `toHaveLength(8)`.
- [ ] **Step 5:** `npm run seed:build`; grep the SQL for both names.
- [ ] **Step 6: Full gates**, then `npm run functions:sync`.
- [ ] **Step 7: Collision-aware teeth check (handoff §3).** Build the Sacrilego
  fixture with **two** friendly ships destroyed — one in band, one out — so that
  mutating the band boundary changes *which option is offered* rather than
  producing a 400. Record the transcript.
- [ ] **Step 8: Commit.**
- [ ] **Step 9: Dedicated review pass** over this task's diff alone, against the
  four suspension rules in `docs/claude/card-effects.md`.

---

### Task 7: Terawatt — the bystander join

**Files:**
- Modify: `shared/effects/lhEffects.ts`, `shared/effects/factionEffects.test.ts`,
  `supabase/seed/source/builtInCards/LH-Built-in.js`,
  `supabase/seed/seed_data.sql`, `supabase/seed/effectCoverage.test.ts`

**Seed meta:** `{ [TRIGGERS.ON_BATTLE_EFFECT]: 'terawattJoin' }`.

**`terawattJoin`**, registered `{ battleBystander: true }`. Fires only when all of
these hold, and returns `true` (a no-op resolution, not a failure) otherwise:
`battle.phase === 'lock'`, `battle.forced`, `!battle.isParticipant`,
`battle.isDefender`, and the defending side has exactly one participant —
`game.state.activeBattle.defenderIds.length === 1`. Terawatt must be on the
defending side of `battle.zoneId` (§7.3). It then offers a one-option `choice`
("Add Terawatt to the battle in zone N?"), declinable through the dialog's own
cancel. On resolve: `joinBattle(game, actor, card.instanceId)` — no `entry`
argument, because the hull is already on the board.

Stash `{ zoneId }` in the choice's `data`; re-derive Terawatt's own position from
`payload.card` via `findVehicle`, the way Braveheart does, and re-check
`activeBattle` still exists and still has one defender before joining.

- [ ] **Step 1: Write the failing tests.** A forced battle leaving one enemy
  defender, with a Terawatt in that zone → an offer, and accepting puts Terawatt
  into `defenderIds` and into `participantsOf`; declining leaves the battle 1v1
  and reportable; **two** defenders → no offer; a Terawatt in a *different* zone
  → no offer; a Terawatt that **is** the lone defender → no offer; an ordinary
  `ATTACK_ENEMY_FLEET` leaving one defender → no offer (`forced` is false); a
  Terawatt on the **aggressor's** side → no offer.
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Close the guard entry** — delete `'LH:Terawatt'`,
  `toHaveLength(8)` → `toHaveLength(7)`.
- [ ] **Step 5:** `npm run seed:build`; grep the SQL for `terawattJoin`.
- [ ] **Step 6: Full gates**, then `npm run functions:sync`.
- [ ] **Step 7: Collision-aware teeth check.** Build the fixture with **two**
  enemy vehicles in the zone, only one of them a defender, so that mutating the
  `defenderIds.length === 1` guard produces a *different legal offer* rather than
  a rejected action. This is the exact trap wave 3 lost a fix round to on Orbit
  Flank — verify the mutated run reaches its assertion before trusting it.
- [ ] **Step 8: Commit.**
- [ ] **Step 9: Dedicated review pass** over this task's diff.

---

### Task 8: Buzzsaw and Veles — defender omission

Spec §4.8. Not DP2; it touches `awaitingResponse`, so it gets a review pass.

**Files:**
- Modify: `shared/engine/engineTypes.ts`, `shared/engine/gameInit.ts`,
  `shared/engine/gameEngine.ts`, `shared/engine/battleDeclare.ts`,
  `shared/engine/battleDeclare.test.ts`, `shared/effects/registry.ts`,
  `frontend/src/pages/game/StealthyResponseBar.tsx`,
  `supabase/seed/source/builtInCards/WF-built-in.js`,
  `supabase/seed/seed_data.sql`, `supabase/seed/effectCoverage.test.ts`

**Seed meta**, both cards: `{ defensiveOmission: 'unlessShipOrTank' }`. No
registry name — it is data, in the `additionalSpawns` class.

**Changes:**
- `DATA_EFFECT_KEYS` in `registry.ts` gains `'defensiveOmission'`, so G2 and
  `noteUnimplemented` both treat these cards as satisfied. It stays **outside**
  `TRIGGERS`, so G3 never inspects it and `HandBar.tsx`'s `ALL_TRIGGER_KEYS`
  needs no change.
- `AwaitingResponse` (`engineTypes.ts`) and the structural copy in
  `PublicGameState` (`gameInit.ts`) both gain `omissibleIds: string[]`.
- `normalizeState` defaults it on a live legacy row, in the same guarded block
  that already defaults `activeBattle.summons`/`.continuation`.
- `ATTACK_ENEMY_FLEET` computes `omissibleIds` = targets carrying
  `meta.defensiveOmission === 'unlessShipOrTank'` **when** none of the selected
  `attackerIds` is a `ship` or a `tank`. The response window now opens when
  **either** list is non-empty.
- `RESPOND_TO_ATTACK` accepts an opt-out id present in either list; the error
  message becomes "Only stealthy or omissible vehicles may withdraw".
- `StealthyResponseBar` renders both sets. Label the two differently — "(withdraw)"
  for a stealthy hull, "(sit out)" for an omissible one — and change the banner
  copy so it does not say "stealthy" when only omissible hulls are listed.

- [ ] **Step 1: Write the failing tests** in `battleDeclare.test.ts`: a Buzzsaw
  targeted by an all-plane attacking force is listed in `omissibleIds`; the same
  Buzzsaw targeted by a force containing a **ship** is not; the same for a
  **tank**; a force whose ship is on the board but **not** in `attackerIds` still
  makes Buzzsaw omissible (§4.8 — the force is the selection); the window opens
  with zero stealthy and one omissible target; `RESPOND_TO_ATTACK` accepts an
  omissible opt-out and rejects an id in neither list; opting out every defender
  calls the attack off; a `declareForcedBattle` naming Buzzsaw as sole defender
  opens **no** window and locks immediately (§4.8's forced-battle exemption);
  `normalizeState` defaults `omissibleIds` on a legacy `awaitingResponse` that
  lacks it.
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement**, frontend included.
- [ ] **Step 4: Close the guard entries** — delete `'WF:Buzzsaw'` and
  `'WF:Veles'`, `toHaveLength(7)` → `toHaveLength(5)`. Both cards close with a
  **data key and no effect name**, so confirm by running the suite that the
  stale-entry assertion is satisfied.
- [ ] **Step 5:** `npm run seed:build`; grep the SQL for `defensiveOmission`
  (expect two hits).
- [ ] **Step 6: Full gates**, including `npm --prefix frontend run lint` —
  confirm still exactly the 7 pre-existing warnings, no new ones.
- [ ] **Step 7: Teeth check** — invert the ship/tank condition and confirm two
  tests diverge in opposite directions rather than one failing both ways.
- [ ] **Step 8:** `npm run functions:sync`, then commit.
- [ ] **Step 9: Dedicated review pass** over this task's diff.

---

### Task 9: Plunderer clause 2

**Files:**
- Modify: `shared/effects/dwgEffects.ts`, `shared/effects/dwgEffects.test.ts`,
  `supabase/seed/source/builtInCards/DWG-built-in.js`,
  `supabase/seed/seed_data.sql`, `supabase/seed/effectCoverage.test.ts`

**Seed meta:** add `[TRIGGERS.ON_BATTLE_VICTORY]: 'plundererRaid'` **beside** the
existing `costModifier: 'plundererCostModifier'` — do not replace it.

**`plundererRaid`** — guard on `battle.survived && battle.won`, then
`takeFromEnemyDeck(game, actor, ctx)`. That single guard covers both of the
card's occasions: at resolve, `onBattleVictory` only reaches the winning side and
`survived` is per-participant; at a base attack, `dispatchBaseAttackVictory` sets
both to `true` (§4.3, DP2 departure 5). No catalog.

- [ ] **Step 1: Write the failing tests.** Plunderer survives a battle where every
  enemy participant is destroyed → one card moves from the enemy deck to
  Plunderer's owner's hand, **both** sides' `state.counts` resync, and no log
  line names the card; Plunderer survives a battle where an enemy survives → no
  draw; Plunderer is destroyed in a won battle → no draw; Plunderer contributes to
  a base bombardment → a draw; a Plunderer that is Inoffensive/a sub/played this
  turn does **not** draw on a bombardment (it did not strike). Assert the empty
  enemy deck path logs "finds nothing to take" and still returns cleanly.
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Close the `PARTIAL` entry** — delete `'DWG:Plunderer'`.
- [ ] **Step 5:** `npm run seed:build`; grep the SQL for `plundererRaid`.
- [ ] **Step 6: Full gates**, then `npm run functions:sync`, then commit.

---

### Task 10: DWG Waters clauses 2 and 3

**Files:**
- Modify: `shared/effects/dwgEffects.ts`, `shared/effects/dwgEffects.test.ts`,
  `shared/engine/baseAttack.ts`, `shared/engine/baseAttack.test.ts`,
  `shared/gameSettings.ts`, `supabase/functions/game-action/index.ts`,
  `supabase/seed/effectCoverage.test.ts`

**Constants:** `DWG_WATERS_GUEST_MAX_COST = 60_000`.

**No seed change.** Both riders keep the existing `dwgWatersEffect` name and are
told apart by `payload.battle` — the same one-name-three-entries shape Trebuchet
uses with `payload.continuation`. Its registration gains `{ needsCatalog: true }`.

**The guest pool** — built-in, `faction: 'DWG'`, `type: 'vehicle'`,
`materialCost < DWG_WATERS_GUEST_MAX_COST`, and **`meta.summonOnly !== true`
repeated by hand** because this filters `ctx.catalog` directly rather than going
through `drawFromPool`. It is exactly Corsair (30k) and Marauder (40k) today;
assert that in the test so a seed change cannot silently widen it.

**Clause 2** — dispatched as a zone-effect rider at lock (Task 1's third source),
so it arrives with `battle.phase === 'lock'` and no card on the board. Fire only
when `battle.isDefender` — the rider is dispatched for the defending side's own
claims, and the guard is belt-and-braces. Offer a `choice` over the guest pool
(labels are catalog card names — public, like Special Foundries' pools). On
resolve: `summonHulls(game, ctx, choiceId, 1)` then `joinBattle(game, actor, hull.instanceId, hull)`.
Stash `{ zoneId }` in `data`.

**Clause 3** — in `ATTACK_ENEMY_BASE`, after every existing validation and
**before** the damage is applied. If `state.zoneEffects` holds a
`dwgWatersEffect` claim for the **enemy** on that zone and the guest pool is
non-empty: pick one guest with `ctx.rng()`, stamp `zone.lastActivatedTurn`
(the attacker spent their activation on the base attack), and
`declareForcedBattle(game, ctx, { zoneId, aggressor: actor, attackerIds: baseStrikersIn(...).map(...), defenderIds: [guest.instanceId], summons: [guest], cause: claim.cardName, activatesZone: true })`,
then return without applying damage. Automatic, not offered — §7.3, decision 25.

**The fourth catalog-probe source.** `supabase/functions/game-action/index.ts`
feeds its candidate list from the caller's hand card, every on-field entry, and
`state.pendingEffect.card`. DWG Waters is a **spent ability** whose riders fire
from `state.zoneEffects`, so it is in none of the three. Add a fourth: fetch the
catalog when any `state.zoneEffects[].effect` is itself in `CATALOG_EFFECTS` —
the entry stores the registry name directly, so no card lookup is needed. **This
file is outside the root tsconfig's `include` and has no test harness** — read it
by hand and verify against the live smoke test in Task 12.

- [ ] **Step 1: Write the failing tests.** Clause 2: a defensive lock in a claimed
  zone offers exactly Corsair and Marauder; accepting puts the chosen hull in
  `activeBattle.summons` **and** `defenderIds`; an **offensive** battle in the
  claimed zone offers nothing; a battle in an **unclaimed** zone offers nothing; a
  claim held by the *aggressor* offers nothing; the guest evaporates on report
  approval and never reaches `zone.cards` or `state.destroyed`. Clause 3: a base
  attack into a claimed zone declares a forced battle with the striking hulls as
  attackers and a summoned guest as sole defender, applies **no** base damage,
  and stamps `lastActivatedTurn`; a base attack into an unclaimed zone is
  unchanged; the guest pick is stable under `makeCtx`'s seeded rng.
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement**, including the probe source.
- [ ] **Step 4: Close the `PARTIAL` entry** — delete `'DWG:DWG Waters'`. `PARTIAL`
  is now empty; confirm its assertion still passes over an empty map.
- [ ] **Step 5: Extend the wave assertion** in `effectCoverage.test.ts` — add
  `wave 4` to the "no entries remain" check beside waves 1-3, leaving
  `toHaveLength(5)`.
- [ ] **Step 6: Full gates**, then `npm run functions:sync`, then commit.
- [ ] **Step 7: Dedicated review pass** over this task's diff — it writes
  `pendingEffect`, `activeBattle` **and** edge-function code that nothing
  typechecks.

---

### Task 11: Guard blind spot 5, docs, and the wave-5 handoff

**Files:**
- Modify: `docs/claude/architecture.md`, `docs/claude/card-effects.md`,
  `docs/claude/supabase.md`, `docs/claude/testing.md`
- Create: `docs/superpowers/plans/2026-08-30-effect-coverage-wave-5-handoff.md`,
  `docs/superpowers/plans/2026-08-30-effect-coverage-wave-5-kickoff.md`

- [ ] **Step 1: Blind-spot-5 sweep.** For each of the nine names registered this
  wave (`catsharkBattle`, `dryadBattle`, `onyxThroneBattle`, `onyxThroneActivate`,
  `sacrilegoBattle`, `ironCordonBattle`, `terawattJoin`, `plundererRaid`,
  `dwgWatersEffect`), grep `supabase/seed/source` and confirm a card names it. A
  registered effect no card names is invisible to G1/G2/G3 — this is how
  `excaliburOnPlay` sat unreachable for a whole wave.
- [ ] **Step 2: `architecture.md`** — replace the "DP2 … still undispatched" known
  gap with what was built; document `BattleContext`, the three lock sources,
  `joinBattle`, `reviveEntry`, `omissibleIds`; and **rewrite the freeze section**,
  which currently states the two freezes are mutually exclusive.
- [ ] **Step 3: `card-effects.md`** — DP2 in the meta-key vocabulary;
  `defensiveOmission` in the plain-data list; `battleBystander` beside
  `needsCatalog`; a fifth suspension rule ("a battle trigger may find the slot
  occupied and be skipped"); update the guard blind-spot list.
- [ ] **Step 4: `supabase.md`** — the fourth catalog-probe source, and the wave-4
  smoke test pair (Task 12).
- [ ] **Step 5: `testing.md`** — correct the stale "514 tests / 29 files" count to
  the measured wave-4 number, and note the both-freezes invariant suite.
- [ ] **Step 6: Write the wave-5 handoff and kickoff**, in the same shape as
  wave 4's. Wave 5 owns Ambush, Ongoing Attrition, Sub Killer, Recurring Threat
  and Sabotage — DP5, the rest-of-turn riders — plus decision 3's alert card,
  which spec §4.3 has now narrowed twice to reach *only* wave 5's riders. Record:
  the measured diff split by path glob; which review passes returned nothing;
  every trap this wave hit; and what wave 4 did **not** verify.
- [ ] **Step 7: Commit.**

---

### Task 12: Final verification, whole-branch review, and deploy

- [ ] **Step 1: Rebase or merge `main`.** A deploy ships the whole branch state,
  not the diff, so a production fix already on `main` must not be regressed by a
  deploy from a stale branch.
- [ ] **Step 2: Full gates from a clean state**, with the Supabase env vars
  provably unset: `npx vitest run`; `npx tsc -p tsconfig.json --noEmit`;
  `npm --prefix frontend run build`; `npm --prefix frontend run lint`. Report the
  before→after passing count against the 521/30 baseline.
- [ ] **Step 3: Whole-branch review** — the highest-leverage single spend in both
  prior waves, and the only pass that sees across tasks. Read `git diff main...HEAD`
  in full, specifically hunting leaks whose cause and reachability live in
  different tasks (wave 3's `costDelta` bug was exactly that shape).
- [ ] **Step 4: Secrets audit** before any push (`docs/claude/workflow.md`).
- [ ] **Step 5: Live-game name collision check.** A game's `meta` is frozen but
  the name→implementation mapping is shared code, so an in-flight game starts
  running a new effect the instant it deploys. Query `games` for `status =
  'active'` and confirm no live row's state names any of this wave's nine names.
- [ ] **Step 6: Apply the seed first, then deploy.**
  `node scripts/deploy-function.mjs game-action --dry-run` to list the payload,
  then without the flag. **Never** the `deploy_edge_function` MCP tool — its
  23-file, ~161 KB payload is silently truncated and a partial payload deletes
  every file it omits. Needs `$env:SUPABASE_ACCESS_TOKEN` (PowerShell; `export`
  is bash and fails).
- [ ] **Step 7: Verify the deploy by content, not file count.** Confirm the
  version number incremented and every wave-4 symbol is present; a legitimate
  deploy reads back with *fewer* modules, because type-only imports are erased
  in transpilation. Prove a clean boot by POSTing with no auth: a healthy
  `game-action` answers `401 {"errors":["Not signed in"]}`, its own error shape,
  which means every module resolved.
- [ ] **Step 8: In-game smoke test** — the step both prior waves left unrun.
  `node scripts/qa-login.mjs` in the background, then `await window.__qaLogin()`
  in the dev-server page; never type a credential into the form. Confirm the dev
  server's **actual** bound port first (Vite increments past 5173 when another
  worktree holds it) and check it matches the origin the browser pane is signed
  in to. Play: **wave 3's inherited pair** — Flying Squirrel Attack (mints
  without suspending) and Air Strafe against a player design (suspends, then
  mints — the only exercise anywhere of the `pendingEffect.card` probe source);
  then **wave 4's own** — Catshark in any battle (materials land at lock) and
  Terawatt on a forced 1v1 (the choice dialog must render **over** the
  `BattleOverlay`, and the battle must stay reportable after the answer).
- [ ] **Step 9: Report honestly** — the before→after suite count, which spec
  effects remain unimplemented (wave 5's five), and anything left unverified.
  "Wave 4 complete" is a claim about the spec, not about the diff.

---

## Self-Review

**Spec coverage.** §4.3 DP2 departures 1/2/4/6 → Task 1; departure 3 → Task 4;
departure 5 → Tasks 3 and 9; departure 7 → Tasks 1 and 6. §4.4's `joinBattle`
caution → Tasks 2 and 5. §4.8 → Task 8. §7.2's Onyx Throne text → Task 5. §7.3's
six rulings → Tasks 5 (Catshark), 6 (Sacrilego, Iron Cordon), 7 (Terawatt), 10
(DWG Waters ×2). §8's table → Tasks 5-10. §11's four new rows → Tasks 1, 3, 4, 8.
Decisions 19-25 → Tasks 4, 1, 1, 10, 6, 8, 10. No gaps.

**Type consistency.** `dispatchBattleLock(game, ctx, forced)`,
`dispatchBattleResolve(game, ctx, zoneId, aggressor, participants, outcome)`,
`dispatchBaseAttackVictory(game, ctx, zoneId, actor, strikers)`,
`battleOutcome(participants, survivingIds, aggressor)`,
`reviveEntry(game, side, entry)`, `joinBattle(game, side, instanceId, entry?)`,
`baseStrikersIn(entries, turnNumber)`,
`declareForcedBattle(game, ctx, spec)` — each is named identically wherever it
appears above.

**Counters.** `KNOWN_GAPS` 13 → 10 (T5) → 8 (T6) → 7 (T7) → 5 (T8), matching the
`toHaveLength` literal at every step. `PARTIAL` 2 → 1 (T9) → 0 (T10).
