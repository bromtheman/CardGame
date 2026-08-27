# Card Effect Coverage — Wave 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close wave 2's nine cards by building two new dispatch points — an activated ability (`ACTIVATE_VEHICLE`) and a suspendable effect (`state.pendingEffect`) — plus board spawning and the three summon-only vehicle rows, with the UI that makes all nine playable.

**Architecture:** Wave 1 left every effect as a synchronous `(payload) => boolean`. Wave 2 adds a second entry point (a vehicle activating on the board) and a second *phase* (an effect that writes a public choice, freezes the game, and is re-entered by name when the player answers). Both are additive: `activatedOnTurn` joins the per-entry stamps beside `playedOnTurn`/`movedOnTurn`, and `pendingEffect` joins `PublicGameState` the way `zoneEffects` did in commit `9d93f13`. A third, smaller piece — `spawnVehicles` — places catalog-minted hulls without playing them.

**Tech Stack:** TypeScript (strict), Vitest, React 19 + Tailwind v4, Deno edge functions, Supabase Postgres. Pure-TS `shared/` runs in both the browser and Deno.

**Spec:** `docs/superpowers/specs/2026-08-27-effect-coverage-design.md` (§4.1–4.3, §4.7, §5, §7.1, §7.2, §7.4, §8 wave 2)

## Global Constraints

Every task's requirements implicitly include this section.

- Tests run with `npx vitest run` from the repo root. **Never pass `--root`** — it silently runs 0 tests. Baseline at the start of this wave: **356 passing, 26 files**.
- **Every commit touching `shared/` must include `npm run functions:sync` output.** The drift test `supabase/seed/functionSharedSync.test.ts` fails otherwise.
- **Relative imports inside `shared/` require the `.ts` extension** — Deno runs those files verbatim inside edge functions.
- **Consumers import `shared/engine/index.ts`, never individual engine modules.** The barrel's side-effect imports populate the handler and effect registries.
- A new file under `shared/engine/` or `shared/effects/` needs its side-effect import added to `shared/engine/index.ts` **and** an entry in `supabase/functions/shared-manifest.json` under `game-action`.
- **Public `state.log` must never name a card in a hidden hand or deck.** Both players see the log. Note `pendingEffect.options` is public too (spec §4.2, departure 5) — never offer a choice over cards the opponent cannot already see.
- All randomness via `ctx.rng()`; all ids via `ctx.newId()`. `Math.random()` and `crypto.randomUUID()` inside an effect break tests.
- Any effect that adds or removes cards in a private hand or deck must resync `game.state.counts[side]`. `drawCard` does it for you; direct pushes must do it manually.
- `effectiveCostInGame` (play-time, modifier-aware) and `effectiveMaterialCostOf` (damage, repairs, in-battle resources) are **different authorities**. Never mix them. Pool and threshold filters read the **printed** `materialCost` — "base cost" in card text — and neither of the above.
- Seed source changes require `npm run seed:build`, which rewrites `supabase/seed/seed_data.sql`. Commit both.
- Effect names are matched exactly after `.trim()`. Seeded data contains stray whitespace — always resolve through `effectName`.
- **Register a name and close its `KNOWN_GAPS` entry in the same task.** The stale-entry assertion fails the moment a listed card starts working, so a task that registers a name must also delete that card's entry and decrement the `toHaveLength` literal in the same commit.
- **Before registering any effect name, grep the seed source for every card that carries it.** Registering `paddlegunEffect` in wave 1 made Kraken silently fire Paddlegun's effect because both rows named it.
- **Tests must never use a real seeded effect name as an "unimplemented" stand-in.** Use synthetic `t_`-prefixed names; `shared/engine/battleResolve.test.ts` shows the pattern. (`eclipseEffect` in `shared/engine/placement.test.ts` is an existing offender; it belongs to wave 3 and is out of scope here.)
- **Effects return `false` to reject the whole play with a 400.** An invalid target returns `false`; nothing to find returns `true` and fizzles. A missing *catalog* entry is a data bug and returns `false`.
- **Read a file's existing imports before adding any.** Merge new names into the existing `import` statement for a specifier; never add a second `import` from the same path.
- **Do not delete or rewrite code a previous task added to a shared file.** Tasks 1, 2, 3, 4 and 8 all edit `shared/engine/gameEngine.ts`; tasks 4 and 10 both append to `shared/effects/primitives.ts`; tasks 11, 12 and 13 all append to `shared/effects/owEffects.ts` and `shared/effects/lhEffects.ts`. Apply your change surgically and leave everything else exactly as you found it.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `shared/engine/activate.ts` | The `ACTIVATE_VEHICLE` handler and `activateCpCostOf`. |
| `shared/engine/activate.test.ts` | Handler tests, driven through `applyAction` with synthetic effect names. |
| `shared/engine/pendingEffect.ts` | The `RESOLVE_PENDING_EFFECT` handler. |
| `shared/engine/pendingEffect.test.ts` | Freeze, ownership, cancel, unknown-choice and unregistered-effect tests. |
| `frontend/src/pages/game/PendingChoiceDialog.tsx` | Renders `state.pendingEffect` — options plus Decline for the owed side, a waiting notice for the other. |

**Modified:**

| File | Change |
|---|---|
| `shared/engine/engineTypes.ts` | `activatedOnTurn` on `ZoneCardEntry`; `ACTIVATE_VEHICLE` and `RESOLVE_PENDING_EFFECT` in `GameAction`. |
| `shared/engine/gameInit.ts` | `PendingEffect` interface; `pendingEffect` on `PublicGameState`; default in `buildInitialGame`. |
| `shared/engine/gameEngine.ts` | `normalizeState` defaults; `PENDING_ACTIONS` freeze; `isSummonOnly`; `activatedOnTurn` dropped from the Temporary-cull snapshot. |
| `shared/engine/battleResolve.ts` | `activatedOnTurn` dropped from the death snapshot; `summonOnly` never pushed to `destroyed`. |
| `shared/engine/heroPowers.ts` | `moveEntry` exported for Monsoon; `activatedOnTurn` reset on both Boarding Party hulls. |
| `shared/engine/placement.ts` | `activatedOnTurn: null` on the two `ZoneCardEntry` literals. |
| `shared/engine/deckValidation.ts` | `summonOnly` on `DeckCardInfo`; rejection in `validateDeck`. |
| `shared/engine/index.ts` | Side-effect imports for `activate.ts` and `pendingEffect.ts`. |
| `shared/engine/testFixtures.ts` | `activatedOnTurn` in `zoneEntry`; `pendingEffect: null` in `makeGame`. |
| `shared/effects/registry.ts` | `resolution` and `pending` on `EffectPayload`. |
| `shared/effects/primitives.ts` | `choice`, `spawnVehicles`, `spawnInto`, `catalogCard`; `summonOnly` excluded from catalog pools. |
| `shared/effects/dwgEffects.ts` | `krakenOnPlay`. |
| `shared/effects/owEffects.ts` | `hunchbackActivate`, `monsoonActivate`, `specialFoundriesEffect`, `defensiveParapetEffect`. |
| `shared/effects/lhEffects.ts` | `spectrumEffect`, `roboticAssemblersEffect`, `sapphireScreenEffect`. |
| `shared/effects/wfEffects.ts` | `allForTheCauseEffect`. |
| `shared/gameSettings.ts` | `HERO_POWER_LABELS`, `ALL_FOR_THE_CAUSE_DOUBLE_COST`. |
| `supabase/functions/shared-manifest.json` | `engine/activate.ts`, `engine/pendingEffect.ts` under `game-action`. |
| `supabase/functions/game-action/index.ts` | Catalog probe scans `state.pendingEffect.card`. |
| `supabase/functions/lobby-action/index.ts` | `summonOnly` in the `DeckCardInfo` map. |
| `supabase/seed/effectCoverage.test.ts` | `onActivate` in G3's vehicle row; the `PARTIAL` map; nine `KNOWN_GAPS` deletions. |
| `supabase/seed/source/builtInCards/*.js` | Three summon rows; nine card corrections. |
| `frontend/src/pages/game/MiniVehicle.tsx` | `activateAffordance` corner button. |
| `frontend/src/pages/game/BoardZone.tsx` | Passes the activate affordance through. |
| `frontend/src/pages/game/GameBoardPage.tsx` | Activate wiring; `MoveMode` kind `activate`; renders `PendingChoiceDialog`. |
| `frontend/src/pages/game/HeroPowerBar.tsx` | `MoveMode` gains the `activate` kind. |
| `frontend/src/pages/DeckBuilderPage.tsx` | `summonOnly` in the info map; excluded from the visible pool. |
| `frontend/src/lib/games.ts` | `isMyMove` handles `pendingEffect`. |
| `docs/claude/architecture.md`, `docs/claude/card-effects.md`, `docs/claude/supabase.md` | Wave-2 lessons. |

**Card → source file map.** Source file and card faction are decoupled — `[GT] Hunchback` and `[GT] Monsoon` are faction GT but live in `OW-Built-in.js`, and register in `owEffects.ts` beside wave 1's `[GT] Osprey`.

| Source file | Wave-2 cards | Summon row to add |
|---|---|---|
| `DWG-built-in.js` | Kraken | Flying Squirrel |
| `LH-Built-in.js` | Spectrum, Robotic Assemblers, Sapphire Screen | — |
| `OW-Built-in.js` | [GT] Hunchback, [GT] Monsoon, Special Foundries, Defensive Parapet | Parapet |
| `WF-built-in.js` | All for the Cause | Martyr |

## Task order

Tasks 1–6 build machinery and touch no card. Task 7 seeds the summon rows, task 8 protects them from the discard, task 9 corrects the nine card rows — leaving them in `KNOWN_GAPS`, which is safe, because an unimplemented name is exactly what a gap entry claims. Tasks 11–13 then register and close three cards each. Frontend is 14–15, and the wave closes with 16–17.

---

# Machinery

## Task 1: `activatedOnTurn` on `ZoneCardEntry`

A **required** field, not optional — `tsc` then names every entry literal that needs it, which is safer than grepping. It carries a trap: two places build a `SnapshotCard` by destructuring the per-entry stamps off an entry, and a stamp they forget to drop leaks into `state.destroyed` and from there, via `reshuffleDiscard`, back into a deck.

**Files:**
- Modify: `shared/engine/engineTypes.ts`
- Modify: `shared/engine/gameEngine.ts` (`normalizeState`, `endTurn`'s Temporary cull)
- Modify: `shared/engine/battleResolve.ts:155`
- Modify: `shared/engine/placement.ts` (both `ZoneCardEntry` literals)
- Modify: `shared/effects/owEffects.ts` (Clydesdale's copy)
- Modify: `shared/engine/heroPowers.ts` (Boarding Party's two flipped hulls)
- Modify: `shared/engine/testFixtures.ts` (`zoneEntry`)
- Test: `shared/engine/gameEngine.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ZoneCardEntry.activatedOnTurn: number | null`.

- [ ] **Step 1: Write the failing tests**

Append to `shared/engine/gameEngine.test.ts`. Read its import line first — it already pulls several of these names; merge, do not duplicate.

```ts
describe('activatedOnTurn', () => {
  it('normalizeState defaults it to null on a legacy entry', () => {
    const game = makeGame()
    const legacy = zoneEntry({ name: 'Legacy' }) as unknown as Record<string, unknown>
    delete legacy.activatedOnTurn
    game.state.zones[0].cards.a.push(legacy as never)
    normalizeState(game.state)
    expect(game.state.zones[0].cards.a[0]).toHaveProperty('activatedOnTurn', null)
  })

  it('does not leak the stamp into the discard when a Temporary vehicle is culled', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    game.state.zones[0].cards.a.push(
      zoneEntry({ name: 'Ghost', keywords: ['temporary'], activatedOnTurn: 2 }),
    )
    const res = applyAction(game, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.destroyed.a).toHaveLength(1)
    expect(res.game.state.destroyed.a[0]).not.toHaveProperty('activatedOnTurn')
    expect(res.game.state.destroyed.a[0]).not.toHaveProperty('playedOnTurn')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run shared/engine/gameEngine.test.ts`
Expected: FAIL — the first because `activatedOnTurn` is never set, the second because the culled snapshot still carries it.

- [ ] **Step 3: Add the field**

`shared/engine/engineTypes.ts`:

```ts
export interface ZoneCardEntry extends CardInstance {
  playedOnTurn: number
  movedOnTurn: number | null
  // Half-turn number of the last ACTIVATE_VEHICLE on this hull, null if never.
  // Enforces once-per-turn for onActivate (spec §4.3, DP1).
  activatedOnTurn: number | null
}
```

- [ ] **Step 4: Default it in `normalizeState`**

`shared/engine/gameEngine.ts`, inside the existing per-entry loop:

```ts
        if (entry.movedOnTurn === undefined) entry.movedOnTurn = null
        if (entry.activatedOnTurn === undefined) entry.activatedOnTurn = null
```

- [ ] **Step 5: Drop the stamp from both snapshot destructures**

`shared/engine/gameEngine.ts`, in `endTurn`'s Temporary cull:

```ts
          const {
            instanceId: _instanceId, playedOnTurn: _p, movedOnTurn: _m, activatedOnTurn: _a, ...snapshot
          } = entry
```

`shared/engine/battleResolve.ts:155`:

```ts
      const { instanceId: _i, playedOnTurn: _p, movedOnTurn: _m, activatedOnTurn: _a, ...snapshot } = entry
```

- [ ] **Step 6: Fix every `ZoneCardEntry` literal `tsc` reports**

Run `npx tsc -p tsconfig.json --noEmit` and add the field to each literal it flags. The expected sites:

`shared/engine/placement.ts` — the played entry and the `additionalSpawns` copy:

```ts
    const entry: ZoneCardEntry = {
      ...card, playedOnTurn: game.turnNumber, movedOnTurn: null, activatedOnTurn: null,
    }
```

```ts
      const copy: ZoneCardEntry = {
        ...card, instanceId: ctx.newId(), playedOnTurn: game.turnNumber, movedOnTurn: null, activatedOnTurn: null,
      }
```

`shared/effects/owEffects.ts` — Clydesdale's second hull:

```ts
    const copy: ZoneCardEntry = {
      ...card, instanceId: ctx.newId(), playedOnTurn: game.turnNumber, movedOnTurn: null, activatedOnTurn: null,
    }
```

`shared/engine/testFixtures.ts`:

```ts
export function zoneEntry(over: Partial<ZoneCardEntry> = {}): ZoneCardEntry {
  return {
    ...inst(over),
    playedOnTurn: over.playedOnTurn ?? 0,
    movedOnTurn: over.movedOnTurn ?? null,
    activatedOnTurn: over.activatedOnTurn ?? null,
  }
}
```

`shared/engine/heroPowers.ts` — Boarding Party spreads the entry, so the field survives implicitly. Reset it explicitly on both hulls: they change owner and are re-stamped as freshly deployed, so the new controller must not inherit a spent activation.

```ts
  const flippedMine: ZoneCardEntry = {
    ...mine.entry, playedOnTurn: game.turnNumber, movedOnTurn: null, activatedOnTurn: null,
  }
  const flippedTheirs: ZoneCardEntry = {
    ...theirs.entry, playedOnTurn: game.turnNumber, movedOnTurn: null, activatedOnTurn: null,
  }
```

`moveEntry` in the same file spreads without resetting, which is correct: the same hull moving in the same turn keeps its activation stamp.

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run`
Expected: PASS — 358 tests.

- [ ] **Step 8: Sync and commit**

```bash
npm run functions:sync
npx vitest run
git add shared supabase/functions
git commit -m "feat(engine): stamp activatedOnTurn on every zone entry"
```

## Task 2: `ACTIVATE_VEHICLE`

**Files:**
- Create: `shared/engine/activate.ts`
- Create: `shared/engine/activate.test.ts`
- Modify: `shared/engine/engineTypes.ts`
- Modify: `shared/engine/index.ts`
- Modify: `supabase/functions/shared-manifest.json`

**Interfaces:**
- Consumes: `ZoneCardEntry.activatedOnTurn` (Task 1).
- Produces: `GameAction` member `{ type: 'ACTIVATE_VEHICLE'; instanceId: string; targetInstanceId?: string; zoneId?: number }`; `activateCpCostOf(card: { meta: Record<string, unknown> }): number | null`.

- [ ] **Step 1: Add the action type**

`shared/engine/engineTypes.ts`, inside the `GameAction` union:

```ts
  | { type: 'ACTIVATE_VEHICLE'; instanceId: string; targetInstanceId?: string; zoneId?: number }
```

- [ ] **Step 2: Write the failing tests**

Create `shared/engine/activate.test.ts`. The effect names are synthetic on purpose — never use a real seeded name as a test stand-in.

```ts
import { beforeAll, describe, expect, it } from 'vitest'
import { applyAction, drawCard } from './index.ts'
import { registerEffect } from '../effects/registry.ts'
import { inst, makeCtx, makeGame, zoneEntry } from './testFixtures.ts'

beforeAll(() => {
  registerEffect('t_activateDraw', ({ game, actor, ctx }) => { drawCard(game, actor, ctx); return true })
  registerEffect('t_activateFails', () => false)
})

const turret = (over: Record<string, unknown> = {}) => zoneEntry({
  name: 'Turret',
  instanceId: 'v1',
  meta: { onActivate: 't_activateDraw', activateCpCost: 1 },
  ...over,
})

function gameWithTurret(over: Record<string, unknown> = {}) {
  const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
  game.privates.a.deck = [inst({ name: 'Spare' })]
  game.state.counts.a = { hand: 0, deck: 1 }
  game.state.zones[0].cards.a.push(turret(over))
  return game
}

describe('ACTIVATE_VEHICLE', () => {
  it('pays the CP, stamps the turn, and fires the effect', () => {
    const game = gameWithTurret()
    game.state.resources.a.cp = 2
    const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'v1' }, makeCtx())
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.resources.a.cp).toBe(1)
    expect(res.game.state.zones[0].cards.a[0]).toHaveProperty('activatedOnTurn', 2)
    expect(res.game.privates.a.hand).toHaveLength(1)
  })

  it('rejects a second activation in the same turn', () => {
    const game = gameWithTurret({ activatedOnTurn: 2 })
    const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'v1' }, makeCtx())
    expect(res).toMatchObject({ ok: false, status: 409 })
  })

  it('rejects a vehicle with no activated ability', () => {
    const game = gameWithTurret({ meta: {} })
    const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'v1' }, makeCtx())
    expect(res).toMatchObject({ ok: false, status: 400 })
  })

  it('rejects when the actor cannot pay', () => {
    const game = gameWithTurret()
    game.state.resources.a.cp = 0
    const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'v1' }, makeCtx())
    expect(res).toMatchObject({ ok: false, status: 400 })
  })

  it('rejects an enemy vehicle', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    game.state.zones[0].cards.b.push(turret())
    const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'v1' }, makeCtx())
    expect(res).toMatchObject({ ok: false, status: 400 })
  })

  it('leaves the input game untouched when the effect fails', () => {
    const game = gameWithTurret({ meta: { onActivate: 't_activateFails', activateCpCost: 1 } })
    game.state.resources.a.cp = 2
    const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'v1' }, makeCtx())
    expect(res).toMatchObject({ ok: false, status: 400 })
    expect(game.state.resources.a.cp).toBe(2)
    expect(game.state.zones[0].cards.a[0].activatedOnTurn).toBeNull()
  })
})
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run shared/engine/activate.test.ts`
Expected: FAIL — "Unknown or not-yet-supported action: ACTIVATE_VEHICLE".

- [ ] **Step 4: Write the handler**

Create `shared/engine/activate.ts`:

```ts
import { err, findVehicle, registerHandler } from './gameEngine.ts'
import { effectFor, effectName } from '../effects/registry.ts'

// The CP price of an activated ability is plain card data, in the same class
// as additionalSpawns: a number in meta, with no registry entry (spec §4.3).
// A card with no activateCpCost has no activated ability at all.
export function activateCpCostOf(card: { meta: Record<string, unknown> }): number | null {
  const raw = card.meta.activateCpCost
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null
  return Math.floor(raw)
}

// DP1. Activating is not playing: the hull is already on the board, so there
// is no placement legality, no material cost, and no spendCard. The turn is
// stamped BEFORE the effect fires, so an ability that suspends (wave 3)
// cannot be re-entered through a second activation.
registerHandler('ACTIVATE_VEHICLE', (game, actor, action, ctx) => {
  if (action.type !== 'ACTIVATE_VEHICLE') return err(400, 'Bad action')
  const found = findVehicle(game.state, action.instanceId)
  if (!found || found.side !== actor) return err(400, 'That is not your vehicle')
  const entry = found.entry

  const cost = activateCpCostOf(entry)
  const name = effectName(entry, 'onActivate')
  if (cost === null || name === null) return err(400, `${entry.name} has no activated ability`)
  const fn = effectFor(name)
  if (!fn) return err(400, `${entry.name}'s activated ability is not implemented yet`)
  if (entry.activatedOnTurn === game.turnNumber) {
    return err(409, `${entry.name} was already activated this turn`)
  }
  if (game.state.resources[actor].cp < cost) return err(400, 'Not enough CP')

  game.state.resources[actor].cp -= cost
  entry.activatedOnTurn = game.turnNumber
  const resolved = fn({
    game,
    actor,
    card: entry,
    ctx,
    targetZoneId: action.zoneId,
    targetInstanceId: action.targetInstanceId,
  })
  if (!resolved) return err(400, `${entry.name}'s ability could not resolve — check its target`)

  game.state.log.push(`${entry.name} activated`)
  return { ok: true, game }
})
```

- [ ] **Step 5: Register the module**

`shared/engine/index.ts`, after the `placement.ts` pair:

```ts
export * from './activate.ts'
import './activate.ts'
```

`supabase/functions/shared-manifest.json`, in the `game-action` array after `"engine/placement.ts"`:

```json
    "engine/activate.ts",
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run shared/engine/activate.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 7: Sync and commit**

```bash
npm run functions:sync
npx vitest run
git add shared supabase/functions
git commit -m "feat(engine): add ACTIVATE_VEHICLE, the onActivate dispatch point"
```

## Task 3: `state.pendingEffect` and its freeze

State shape only. No handler yet, so nothing writes the slot — but the freeze is testable on its own by planting one by hand.

**Files:**
- Modify: `shared/engine/gameInit.ts`
- Modify: `shared/engine/gameEngine.ts`
- Modify: `shared/engine/engineTypes.ts`
- Modify: `shared/engine/testFixtures.ts`
- Test: `shared/engine/gameEngine.test.ts`, `shared/engine/gameInit.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `PendingEffect` (exported from `gameInit.ts`); `PublicGameState.pendingEffect: PendingEffect | null`; `GameAction` member `{ type: 'RESOLVE_PENDING_EFFECT'; choiceId?: string; targetInstanceId?: string; zoneId?: number; cancel?: boolean }`.

- [ ] **Step 1: Write the failing tests**

Append to `shared/engine/gameEngine.test.ts`:

```ts
describe('pendingEffect freeze', () => {
  const pending = (side: 'a' | 'b' = 'a') => ({
    effect: 't_choice',
    side,
    card: inst({ name: 'Kraken', instanceId: 'k1' }),
    kind: 'choice' as const,
    prompt: 'Pick one',
    options: [{ id: 'x', label: 'X' }],
  })

  it('blocks an ordinary action while a choice is owed', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    game.state.pendingEffect = pending()
    const res = applyAction(game, 'alice', { type: 'END_TURN' }, makeCtx())
    expect(res).toMatchObject({ ok: false, status: 409 })
  })

  it('blocks a hero power, which the battle freeze would have allowed', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    game.state.pendingEffect = pending()
    const res = applyAction(game, 'alice', { type: 'USE_HERO_POWER', power: 'draw' }, makeCtx())
    expect(res).toMatchObject({ ok: false, status: 409 })
  })

  it('still allows conceding', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    game.state.pendingEffect = pending()
    const res = applyAction(game, 'alice', { type: 'CONCEDE' }, makeCtx())
    expect(res.ok).toBe(true)
  })

  it('normalizeState defaults the slot on a legacy row', () => {
    const game = makeGame()
    delete (game.state as unknown as Record<string, unknown>).pendingEffect
    normalizeState(game.state)
    expect(game.state.pendingEffect).toBeNull()
  })
})
```

Append one assertion to `shared/engine/gameInit.test.ts`, inside whichever `describe` already exercises `buildInitialGame` and reusing that block's existing setup — read the file and match it rather than inventing a helper:

```ts
  it('starts with no pending effect', () => {
    expect(built.game.state.pendingEffect).toBeNull()
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run shared/engine/gameEngine.test.ts shared/engine/gameInit.test.ts`
Expected: FAIL — `pendingEffect` is not a property of `PublicGameState`.

- [ ] **Step 3: Add the state shape**

`shared/engine/gameInit.ts`, above `PublicGameState`:

```ts
// One suspension slot (spec §4.2). An effect needing a decision writes this
// and returns true; the game freezes to PENDING_ACTIONS until
// RESOLVE_PENDING_EFFECT re-enters the same registry name.
//
// It carries the whole card, not just a name: by resolve time an ability has
// been spendCard'd into state.destroyed, so it is in neither hand nor field,
// and both the continuation's payload and game-action's catalog probe need
// something with meta on it.
//
// `options` is PUBLIC. Never offer a choice over cards the opponent cannot
// already see.
export interface PendingEffect {
  effect: string
  side: 'a' | 'b'
  card: CardInstance
  kind: 'choice'
  prompt: string
  options: { id: string; label: string }[]
  data?: Record<string, unknown>
}
```

Add the field to `PublicGameState`, after `zoneEffects`:

```ts
  pendingEffect: PendingEffect | null
```

And to `buildInitialGame`'s state literal, after `zoneEffects: []`:

```ts
    pendingEffect: null,
```

- [ ] **Step 4: Default it and add the freeze**

`shared/engine/gameEngine.ts`, in `normalizeState` beside the other slot defaults:

```ts
  if (s.pendingEffect === undefined) s.pendingEffect = null
```

Beside `BATTLE_ACTIONS` and `OFF_TURN_ACTIONS`:

```ts
// A suspended effect freezes harder than a battle does. BATTLE_ACTIONS admits
// USE_HERO_POWER and the three battle actions, none of which should be legal
// while a player owes a choice — so this is its own list, checked first
// (spec §4.2, departure 2).
const PENDING_ACTIONS = new Set<GameAction['type']>([
  'RESOLVE_PENDING_EFFECT', 'CONCEDE', 'ABANDON',
])
```

In `applyAction`, immediately after the `game.status !== 'active'` check and **before** the `battleFrozen` check:

```ts
  if (game.state.pendingEffect !== null && !PENDING_ACTIONS.has(action.type)) {
    return err(409, 'A card effect is waiting on a choice — resolve it first')
  }
```

- [ ] **Step 5: Add the action type and the fixture default**

`shared/engine/engineTypes.ts`, in `GameAction`:

```ts
  | {
      type: 'RESOLVE_PENDING_EFFECT'
      choiceId?: string
      targetInstanceId?: string
      zoneId?: number
      cancel?: boolean
    }
```

`shared/engine/testFixtures.ts`, in `makeGame`'s state literal after `zoneEffects: []`:

```ts
      pendingEffect: null,
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run shared/engine`
Expected: PASS.

- [ ] **Step 7: Sync and commit**

```bash
npm run functions:sync
npx vitest run
git add shared supabase/functions
git commit -m "feat(engine): add state.pendingEffect and its freeze"
```

## Task 4: `RESOLVE_PENDING_EFFECT` and the `choice` primitive

The two halves of the resume mechanic: a handler that re-enters an effect by name, and a factory that knows how to be re-entered.

**Files:**
- Create: `shared/engine/pendingEffect.ts`
- Create: `shared/engine/pendingEffect.test.ts`
- Modify: `shared/effects/registry.ts`
- Modify: `shared/effects/primitives.ts`
- Modify: `shared/engine/index.ts`
- Modify: `supabase/functions/shared-manifest.json`
- Test: `shared/effects/primitives.test.ts`

**Interfaces:**
- Consumes: `PendingEffect`, `PublicGameState.pendingEffect`, the `RESOLVE_PENDING_EFFECT` action (Task 3).
- Produces: `EffectPayload.resolution?: { choiceId?: string; targetInstanceId?: string; zoneId?: number }` and `EffectPayload.pending?: PendingEffect`; `ChoiceOption = { id: string; label: string }`; `choice(spec): EffectFn` where spec is `{ effect: string; prompt: string; options: (p: EffectPayload) => ChoiceOption[]; data?: (p: EffectPayload) => Record<string, unknown>; resolve: (p: EffectPayload, choiceId: string | null) => boolean }`.

- [ ] **Step 1: Extend the payload**

`shared/effects/registry.ts` — add to `EffectPayload`, and merge `PendingEffect` into the existing `import type` from `'../engine/gameInit.ts'`:

```ts
  // Set only on the second entry, by RESOLVE_PENDING_EFFECT. An effect that
  // can suspend branches on `resolution === undefined` to tell the phases
  // apart; `pending` is the slot it wrote on the first entry.
  resolution?: { choiceId?: string; targetInstanceId?: string; zoneId?: number }
  pending?: PendingEffect
```

- [ ] **Step 2: Write the failing primitive test**

Append to `shared/effects/primitives.test.ts`:

```ts
describe('choice', () => {
  const twoOptions = choice({
    effect: 't_pick',
    prompt: 'Pick one',
    options: () => [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }],
    resolve: ({ game }, choiceId) => {
      game.state.log.push(`resolved:${choiceId ?? 'none'}`)
      return true
    },
  })

  it('suspends on the first entry and writes a public slot', () => {
    const game = makeGame()
    const card = inst({ name: 'Chooser', instanceId: 'c1' })
    expect(twoOptions({ game, actor: 'a', card, ctx: makeCtx() })).toBe(true)
    expect(game.state.pendingEffect).toMatchObject({
      effect: 't_pick', side: 'a', kind: 'choice', prompt: 'Pick one',
      options: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }],
    })
    expect(game.state.pendingEffect?.card.instanceId).toBe('c1')
    expect(game.state.log.join()).not.toContain('resolved:')
  })

  it('resolves immediately, without suspending, when there are no options', () => {
    const game = makeGame()
    const empty = choice({
      effect: 't_empty', prompt: 'Pick one', options: () => [],
      resolve: ({ game: g }, choiceId) => { g.state.log.push(`resolved:${choiceId ?? 'none'}`); return true },
    })
    expect(empty({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.state.pendingEffect).toBeNull()
    expect(game.state.log.join()).toContain('resolved:none')
  })

  it('runs resolve on re-entry with a known choiceId', () => {
    const game = makeGame()
    const card = inst({ name: 'Chooser', instanceId: 'c1' })
    twoOptions({ game, actor: 'a', card, ctx: makeCtx() })
    const pending = game.state.pendingEffect!
    game.state.pendingEffect = null
    const ok = twoOptions({
      game, actor: 'a', card, ctx: makeCtx(), pending, resolution: { choiceId: 'b' },
    })
    expect(ok).toBe(true)
    expect(game.state.log.join()).toContain('resolved:b')
  })

  it('rejects an unknown choiceId', () => {
    const game = makeGame()
    const card = inst({ instanceId: 'c1' })
    twoOptions({ game, actor: 'a', card, ctx: makeCtx() })
    const pending = game.state.pendingEffect!
    const ok = twoOptions({
      game, actor: 'a', card, ctx: makeCtx(), pending, resolution: { choiceId: 'nope' },
    })
    expect(ok).toBe(false)
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run shared/effects/primitives.test.ts`
Expected: FAIL — `choice` is not exported.

- [ ] **Step 4: Write the primitive**

Append to `shared/effects/primitives.ts`. Note `effect` is part of the spec: a factory cannot know the registry name it will be stored under, and the slot must carry that name for the handler to re-enter it. Each registration passes the same constant to both.

```ts
export interface ChoiceOption { id: string; label: string }

// Suspend for a player decision (spec §4.2, DP4). First entry writes
// state.pendingEffect and returns true; RESOLVE_PENDING_EFFECT re-enters the
// same registry name with `resolution` set and runs `resolve`.
//
// Empty options do NOT suspend — they call resolve(payload, null) straight
// away, so a card whose choice is optional still runs its tail. Kraken needs
// exactly this: "refresh one of your hero powers then gain 1cp" must still
// grant the CP for a player with no used powers.
export function choice(spec: {
  effect: string
  prompt: string
  options: (p: EffectPayload) => ChoiceOption[]
  data?: (p: EffectPayload) => Record<string, unknown>
  resolve: (p: EffectPayload, choiceId: string | null) => boolean
}): EffectFn {
  return (payload) => {
    if (payload.resolution === undefined) {
      const options = spec.options(payload)
      if (options.length === 0) return spec.resolve(payload, null)
      payload.game.state.pendingEffect = {
        effect: spec.effect,
        side: payload.actor,
        card: payload.card,
        kind: 'choice',
        prompt: spec.prompt,
        options,
        data: spec.data ? spec.data(payload) : undefined,
      }
      payload.game.state.log.push(`${payload.card.name} is waiting on a choice`)
      return true
    }
    const chosen = payload.resolution.choiceId
    const known = payload.pending?.options ?? []
    if (typeof chosen !== 'string' || !known.some((o) => o.id === chosen)) return false
    return spec.resolve(payload, chosen)
  }
}
```

- [ ] **Step 5: Write the failing handler tests**

Create `shared/engine/pendingEffect.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest'
import { applyAction } from './index.ts'
import { registerEffect } from '../effects/registry.ts'
import { choice } from '../effects/primitives.ts'
import { inst, makeCtx, makeGame } from './testFixtures.ts'

beforeAll(() => {
  registerEffect('t_resolvable', choice({
    effect: 't_resolvable',
    prompt: 'Pick one',
    options: () => [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }],
    resolve: ({ game }, choiceId) => { game.state.log.push(`picked:${choiceId}`); return true },
  }))
})

function frozen(side: 'a' | 'b' = 'a', effect = 't_resolvable') {
  const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
  game.state.pendingEffect = {
    effect, side, card: inst({ name: 'Chooser', instanceId: 'c1' }),
    kind: 'choice', prompt: 'Pick one',
    options: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }],
  }
  return game
}

describe('RESOLVE_PENDING_EFFECT', () => {
  it('resolves the choice and clears the slot', () => {
    const res = applyAction(frozen(), 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'b' }, makeCtx())
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.pendingEffect).toBeNull()
    expect(res.game.state.log.join()).toContain('picked:b')
  })

  it('rejects the side that does not owe the choice', () => {
    const game = frozen('b')
    const res = applyAction(game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'a' }, makeCtx())
    expect(res).toMatchObject({ ok: false, status: 403 })
  })

  it('rejects when nothing is pending', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    const res = applyAction(game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'a' }, makeCtx())
    expect(res).toMatchObject({ ok: false, status: 409 })
  })

  it('keeps the slot intact when the choiceId is unknown', () => {
    const game = frozen()
    const res = applyAction(game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'zzz' }, makeCtx())
    expect(res).toMatchObject({ ok: false, status: 400 })
    expect(game.state.pendingEffect).not.toBeNull()
  })

  it('cancel clears the slot without resolving', () => {
    const res = applyAction(frozen(), 'alice', { type: 'RESOLVE_PENDING_EFFECT', cancel: true }, makeCtx())
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.pendingEffect).toBeNull()
    expect(res.game.state.log.join()).not.toContain('picked:')
    expect(res.game.state.log.join()).toContain('declined')
  })

  it('clears the slot rather than bricking the game when the effect is gone', () => {
    const res = applyAction(
      frozen('a', 't_neverRegistered'), 'alice',
      { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'a' }, makeCtx(),
    )
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.pendingEffect).toBeNull()
  })

  it('unfreezes the game once resolved', () => {
    const res = applyAction(frozen(), 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'a' }, makeCtx())
    if (!res.ok) throw new Error(res.error)
    const next = applyAction(res.game, 'alice', { type: 'END_TURN' }, makeCtx())
    expect(next.ok).toBe(true)
  })
})
```

- [ ] **Step 6: Run to verify they fail**

Run: `npx vitest run shared/engine/pendingEffect.test.ts`
Expected: FAIL — "Unknown or not-yet-supported action: RESOLVE_PENDING_EFFECT".

- [ ] **Step 7: Write the handler**

Create `shared/engine/pendingEffect.ts`:

```ts
import { err, registerHandler } from './gameEngine.ts'
import { effectFor } from '../effects/registry.ts'

// DP4's second half. The slot is cleared BEFORE the effect runs, so a
// continuation may suspend again (wave 3's Trebuchet repeats itself). When
// the effect reports failure, applyAction discards the whole clone, so the
// real row keeps its pending slot and the player can answer again.
registerHandler('RESOLVE_PENDING_EFFECT', (game, actor, action, ctx) => {
  if (action.type !== 'RESOLVE_PENDING_EFFECT') return err(400, 'Bad action')
  const pending = game.state.pendingEffect
  if (!pending) return err(409, 'Nothing is waiting on a choice')
  if (pending.side !== actor) return err(403, 'That choice belongs to your opponent')

  if (action.cancel === true) {
    game.state.pendingEffect = null
    game.state.log.push(`${pending.card.name}'s effect was declined`)
    return { ok: true, game }
  }

  const fn = effectFor(pending.effect)
  game.state.pendingEffect = null
  // A deploy that rolled back under a live suspension would otherwise leave a
  // game neither player could advance. Drop the choice and say so.
  if (!fn) {
    game.state.log.push(`${pending.card.name}'s effect is no longer available — the choice was dropped`)
    return { ok: true, game }
  }

  const resolved = fn({
    game,
    actor,
    card: pending.card,
    ctx,
    pending,
    resolution: {
      choiceId: action.choiceId,
      targetInstanceId: action.targetInstanceId,
      zoneId: action.zoneId,
    },
  })
  if (!resolved) return err(400, `${pending.card.name}'s effect could not resolve — check your choice`)
  return { ok: true, game }
})
```

- [ ] **Step 8: Register the module**

`shared/engine/index.ts`, after the `activate.ts` pair:

```ts
export * from './pendingEffect.ts'
import './pendingEffect.ts'
```

`supabase/functions/shared-manifest.json`, in the `game-action` array after `"engine/activate.ts"`:

```json
    "engine/pendingEffect.ts",
```

- [ ] **Step 9: Run the tests**

Run: `npx vitest run shared/engine/pendingEffect.test.ts shared/effects/primitives.test.ts`
Expected: PASS.

- [ ] **Step 10: Sync and commit**

```bash
npm run functions:sync
npx vitest run
git add shared supabase/functions
git commit -m "feat(effects): resume a suspended effect via RESOLVE_PENDING_EFFECT"
```

## Task 5: the catalog probe sees a resolving choice

`game-action` loads the built-in catalog only when some card it can reach names a `CATALOG_EFFECTS` effect. It scans the played hand card and every on-field entry. A resolving choice is neither: the ability was `spendCard`'d into `state.destroyed` when it was played. Without this change Special Foundries and Robotic Assemblers resolve against an empty catalog and fail.

This code lives in a Deno edge function with no test harness, so it is verified by reading and by the live smoke test in Task 16.

**Files:**
- Modify: `supabase/functions/game-action/index.ts`

**Interfaces:**
- Consumes: `PublicGameState.pendingEffect` (Task 3).
- Produces: nothing.

- [ ] **Step 1: Add the third candidate source**

In `supabase/functions/game-action/index.ts`, immediately after the loop that pushes every zone's cards into `candidates`:

```ts
  // A resolving choice's card is in neither hand nor field — it was spent when
  // it was played — so the probe would miss a catalog effect that has only
  // just been asked for its second phase (spec §4.7).
  if (engineGame.state.pendingEffect) candidates.push(engineGame.state.pendingEffect.card)
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/game-action/index.ts
git commit -m "fix(game-action): probe the catalog for a resolving pending effect"
```

## Task 6: guard scaffolding — `onActivate` and the `PARTIAL` map

Two guard changes that must land before any card closes. G3 rejects a trigger key the engine does not dispatch for a card's type; the moment Spectrum leaves `KNOWN_GAPS`, its `onActivate` would be flagged unless the vehicle row learns about it. The `PARTIAL` map closes the guard's third blind spot: a card that passes G2 while only half of its text works.

**Files:**
- Modify: `supabase/seed/effectCoverage.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `PARTIAL` map convention for waves 3–5.

- [ ] **Step 1: Add `onActivate` to G3's vehicle row**

`REACHABLE_TRIGGERS` becomes:

```ts
const REACHABLE_TRIGGERS: Record<string, readonly string[]> = {
  vehicle: ['onPlayEffect', 'playOnZoneEffect', 'onDeathEffect', 'costModifier', 'onActivate'],
  ability: ['onPlayEffect', 'playOnZoneEffect', 'playOnVehicleEffect', 'playOnCardEffect', 'costModifier'],
}
```

Add to the end of the long comment block above it:

```ts
// Wave 2 adds `onActivate` to the vehicle row: ACTIVATE_VEHICLE
// (shared/engine/activate.ts) dispatches it for a hull already on the board,
// which only a vehicle can be. It is deliberately absent from the ability
// row — an ability is spendCard'd on resolution and never enters zone.cards.
```

- [ ] **Step 2: Write the failing PARTIAL test**

Add, after the `KNOWN_GAPS` declaration:

```ts
// Cards that pass G2 — they resolve at least one implemented effect — but
// whose card text is only partly built. G2 asks "any implemented effect?",
// not "does all of the text work?", so it cannot see these, and they cannot
// go in KNOWN_GAPS without tripping the stale-entry assertion. Delete an
// entry when its wave finishes the card.
const PARTIAL: Record<string, string> = {
  'DWG:Plunderer':
    'wave 4 — clause 2 (survive a victorious fleet battle, or damage the enemy base, then draw from the enemy deck) needs a battle-resolve and base-attack hook. Its costModifier is implemented.',
  'DWG:DWG Waters':
    'wave 4 — clauses 2-3 need a battle-declare dispatch point. Its persistent zone claim is implemented.',
}
```

And this test, beside the other guard tests:

```ts
  it('PARTIAL names real cards that currently pass G1 and G2, and never overlaps KNOWN_GAPS', async () => {
    const { cards } = await loadSeedData()
    const byKey = new Map(cards.map((c) => [key(c), c]))
    const problems: string[] = []
    for (const k of Object.keys(PARTIAL)) {
      const card = byKey.get(k)
      if (!card) { problems.push(`${k} (no such card)`); continue }
      if (KNOWN_GAPS[k] !== undefined) { problems.push(`${k} (also in KNOWN_GAPS)`); continue }
      const { unimplemented, silent } = classify(card)
      // A card that is wholly broken belongs in KNOWN_GAPS, not here.
      if (unimplemented.length > 0 || silent) problems.push(`${k} (is a full gap, not a partial)`)
    }
    expect(problems).toEqual([])
  })
```

- [ ] **Step 3: Pin the GT airship split**

Spec §7.3 rules that a "GT heavy airship" is faction GT, `vehicleType: airship`, `materialCost >= GT_HEAVY_AIRSHIP_MIN_COST` — six light cards and eight heavy. Special Foundries (Task 12) partitions the pool on exactly that line, so pin the counts against real seed data. Note the seed's `GT_AIRSHIP` / `GT_HEAVY_AIRSHIP` source arrays are file organisation only and are **not** the authority — the cost cliff is.

Add to `supabase/seed/effectCoverage.test.ts`, merging `GT_HEAVY_AIRSHIP_MIN_COST` into the existing `gameSettings` import:

```ts
  it('the GT airship pool splits 6 light / 8 heavy on the spec §7.3 cost cliff', async () => {
    const { cards } = await loadSeedData()
    const airships = cards.filter(
      (c) => c.isBuiltIn && c.faction === 'GT' && c.vehicleType === 'airship',
    )
    const heavy = airships.filter((c) => c.materialCost >= GT_HEAVY_AIRSHIP_MIN_COST)
    expect(airships).toHaveLength(14)
    expect(heavy).toHaveLength(8)
  })
```

- [ ] **Step 4: Run the guard**

Run: `npx vitest run supabase/seed/effectCoverage.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/seed/effectCoverage.test.ts
git commit -m "test(guard): dispatch onActivate, track partial cards, pin the GT airship split"
```

---

# Content

## Task 7: the three summon-only vehicles

Flying Squirrel is wave 3's, but all three are seeded in one pass so wave 3 does not have to reopen the seed. They carry no card text and no effect names, so they pass G1/G2/G3 without an entry anywhere.

**Files:**
- Modify: `supabase/seed/source/builtInCards/DWG-built-in.js` (Flying Squirrel → `dwgVehicles`)
- Modify: `supabase/seed/source/builtInCards/WF-built-in.js` (Martyr → `wfVehicles`)
- Modify: `supabase/seed/source/builtInCards/OW-Built-in.js` (Parapet → `owVehicles`)
- Modify: `shared/engine/deckValidation.ts`
- Modify: `supabase/functions/lobby-action/index.ts`
- Modify: `frontend/src/pages/DeckBuilderPage.tsx`
- Test: `shared/engine/deckValidation.test.ts`, `supabase/seed/transform.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: three catalog rows named exactly `Flying Squirrel`, `Martyr` and `Parapet`, each with `meta.summonOnly === true`; `DeckCardInfo.summonOnly?: boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `shared/engine/deckValidation.test.ts` (read its existing helpers and reuse them rather than writing new ones):

```ts
  it('rejects a summon-only card', () => {
    const info = new Map<string, DeckCardInfo>([
      ['sum-1', { id: 'sum-1', isBuiltIn: true, faction: 'WF', vehicleType: 'plane', ownerId: null, summonOnly: true }],
    ])
    const result = validateDeck({ faction: 'WF', cards: { 'sum-1': 1 } }, info, 'owner-1')
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toMatch(/cannot be added to a deck/i)
  })
```

Append to `supabase/seed/transform.test.ts`:

```ts
  it('seeds the three summon-only vehicles, flagged and text-free', async () => {
    const { cards } = await loadSeedData()
    for (const name of ['Flying Squirrel', 'Martyr', 'Parapet']) {
      const card = cards.find((c) => c.name === name)
      expect(card, `${name} is missing from the seed`).toBeDefined()
      expect(card!.meta).toMatchObject({ summonOnly: true })
      expect((card!.cardText ?? '').trim()).toBe('')
      expect(card!.keywords ?? []).toEqual([])
    }
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run shared/engine/deckValidation.test.ts supabase/seed/transform.test.ts`
Expected: FAIL on both.

- [ ] **Step 3: Add the three rows**

Stats are the product owner's, verbatim (spec §7.1). Match each file's existing row formatting exactly — four-space indent, single quotes, trailing comma style.

Into `dwgVehicles` in `DWG-built-in.js`:

```js
    {
        name: 'Flying Squirrel',
        isBuiltIn: true,
        cardText: '',
        materialCost: 84000,
        blueprintCost: 84000,
        cpCost: 0,
        imageUrl: '',
        playerId: null,
        vehicleType: 'plane',
        type: 'vehicle',
        faction: FACTIONS.DWG,
        blueprintId: null,
        keywords: [],
        meta: {
            summonOnly: true
        }
    },
```

Into `wfVehicles` in `WF-built-in.js`:

```js
    {
        name: 'Martyr',
        isBuiltIn: true,
        cardText: '',
        materialCost: 8500,
        blueprintCost: 8500,
        cpCost: 0,
        imageUrl: '',
        playerId: null,
        vehicleType: 'plane',
        type: 'vehicle',
        faction: FACTIONS.WF,
        blueprintId: null,
        keywords: [],
        meta: {
            summonOnly: true
        }
    },
```

Into `owVehicles` in `OW-Built-in.js`:

```js
    {
        name: 'Parapet',
        isBuiltIn: true,
        cardText: '',
        materialCost: 259000,
        blueprintCost: 259000,
        cpCost: 0,
        imageUrl: '',
        playerId: null,
        vehicleType: 'plane',
        type: 'vehicle',
        faction: FACTIONS.OW,
        blueprintId: null,
        keywords: [],
        meta: {
            summonOnly: true
        }
    },
```

No frontend art work is needed: `cardImageOrFallback` already falls back to the vehicle-type icon for any non-`http` image, which every built-in card already uses.

- [ ] **Step 4: Reject them from decks**

`shared/engine/deckValidation.ts` — add to `DeckCardInfo`:

```ts
  // Spawned, never drafted (spec §7.1).
  summonOnly?: boolean
```

And inside `validateDeck`'s per-card loop, after the card's `info` is resolved and before the copy-limit accounting:

```ts
    if (info.summonOnly) {
      errors.push(`Card ${cardId} cannot be added to a deck`)
      continue
    }
```

Read the loop first: place this immediately after the existing "unknown card" guard so `info` is known non-null, and make sure the `continue` skips the same accounting the other rejection paths skip.

- [ ] **Step 5: Populate the flag at both construction sites**

`supabase/functions/lobby-action/index.ts` (the query is already `select('*')`, so `meta` is present):

```ts
        (cardRows ?? []).map((c) => [c.id, {
          id: c.id, isBuiltIn: c.is_built_in, faction: c.faction,
          vehicleType: c.vehicle_type, ownerId: c.owner_id,
          summonOnly: (c.meta as { summonOnly?: boolean } | null)?.summonOnly === true,
        }]),
```

`frontend/src/pages/DeckBuilderPage.tsx`, in the `infoMap`:

```ts
      allCards.map((c) => [c.id, {
        id: c.id, isBuiltIn: c.is_built_in, faction: c.faction,
        vehicleType: c.vehicle_type, ownerId: c.owner_id,
        summonOnly: (c.meta as { summonOnly?: boolean } | null)?.summonOnly === true,
      }]),
```

And keep them out of the pickable pool, so the builder never offers a card its own validation rejects:

```ts
  const pool = useMemo(
    () =>
      (allCards ?? []).filter((c) =>
        (c.meta as { summonOnly?: boolean } | null)?.summonOnly === true
          ? false
          : c.is_built_in
            ? c.faction === deck?.faction || c.faction === FACTIONS.NEUTRAL
            : c.owner_id === session?.user.id,
      ),
    [allCards, deck, session],
  )
```

If `CardRow` does not declare `meta`, add it as `meta: Record<string, unknown> | null` in `frontend/src/lib/cards.ts` rather than casting through `unknown` at each site.

`CardsPage` is deliberately left alone — these are real cards and a player should be able to read a Martyr.

- [ ] **Step 6: Rebuild the seed and run everything**

```bash
npm run seed:build
npx vitest run
npm --prefix frontend run build
```
Expected: PASS. `supabase/seed/seed_data.sql` is regenerated.

- [ ] **Step 7: Commit**

```bash
git add supabase/seed shared/engine/deckValidation.ts supabase/functions frontend
git commit -m "feat(seed): add the three summon-only vehicles and keep them out of decks"
```

## Task 8: a summon-only card never reaches the discard

`reshuffleDiscard` feeds `state.destroyed` back into the owner's deck, so a destroyed Martyr would become a draftable card. Both board exits must skip them.

**Files:**
- Modify: `shared/engine/gameEngine.ts`
- Modify: `shared/engine/battleResolve.ts`
- Test: `shared/engine/gameEngine.test.ts`, `shared/engine/battleResolve.test.ts`

**Interfaces:**
- Consumes: `meta.summonOnly` (Task 7).
- Produces: `isSummonOnly(card: { meta: Record<string, unknown> }): boolean`, exported from `gameEngine.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `shared/engine/gameEngine.test.ts`:

```ts
  it('a summon-only Temporary vehicle despawns without entering the discard', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    game.state.zones[0].cards.a.push(zoneEntry({
      name: 'Martyr', keywords: ['temporary'], meta: { summonOnly: true },
    }))
    const res = applyAction(game, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.zones[0].cards.a).toHaveLength(0)
    expect(res.game.state.destroyed.a).toHaveLength(0)
    expect(res.game.state.log.join()).toContain('Martyr despawned')
  })
```

Append to `shared/engine/battleResolve.test.ts`, inside its `death triggers on report approval` block. It reuses that file's `inBattle()` helper, which returns `{ g, atk, def }`, and follows the shape of the neighbouring "fragile cannot be repaired" test:

```ts
  it('a destroyed summon-only vehicle is not pushed to the discard', () => {
    const { g, atk, def } = inBattle()
    const martyr = zoneEntry({ name: 'Martyr', meta: { summonOnly: true }, playedOnTurn: 2 })
    g.state.zones[0].cards.a.push(martyr)
    g.state.activeBattle!.attackerIds.push(martyr.instanceId)
    const s = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 95, [def.instanceId]: 95, [martyr.instanceId]: 0 },
      repairs: [],
    })
    if (!s.ok) throw new Error(s.error)
    const r = applyAction(s.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a.some((c) => c.instanceId === martyr.instanceId)).toBe(false)
    expect(r.game.state.destroyed.a.some((c) => c.name === 'Martyr')).toBe(false)
    expect(r.game.state.log.join()).toContain('Martyr was destroyed')
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run shared/engine/gameEngine.test.ts shared/engine/battleResolve.test.ts`
Expected: FAIL — both push a snapshot into `destroyed`.

- [ ] **Step 3: Add the predicate and both guards**

`shared/engine/gameEngine.ts`, beside `findVehicle`:

```ts
// Summon-only cards are spawned, never drafted (spec §7.1). They must never
// reach state.destroyed: reshuffleDiscard feeds the discard back into the
// owner's deck, which would make a destroyed Martyr draftable.
export const isSummonOnly = (card: { meta: Record<string, unknown> }): boolean =>
  card.meta.summonOnly === true
```

In `endTurn`'s Temporary cull, guard the push and keep the log line:

```ts
          if (!isSummonOnly(entry)) game.state.destroyed[s].push(snapshot)
          game.state.log.push(`${entry.name} despawned (temporary)`)
```

`shared/engine/battleResolve.ts`, at the death path, merging `isSummonOnly` into the existing import from `./gameEngine.ts`:

```ts
      if (!isSummonOnly(entry)) game.state.destroyed[side].push(snapshot as SnapshotCard)
```

Leave `destroyedCount`, the log line and `destroyedEntries` untouched — a summon-only hull still dies, still counts, and still fires an `onDeathEffect` if it has one.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run shared/engine`
Expected: PASS.

- [ ] **Step 5: Sync and commit**

```bash
npm run functions:sync
npx vitest run
git add shared supabase/functions
git commit -m "fix(engine): keep summon-only cards out of the discard"
```

## Task 9: correct the nine seed rows

Data only. Every card stays in `KNOWN_GAPS` afterwards, which is correct and green: an unimplemented effect name is exactly what a gap entry claims.

**Files:**
- Modify: `supabase/seed/source/builtInCards/OW-Built-in.js`
- Modify: `supabase/seed/source/builtInCards/LH-Built-in.js`
- Modify: `supabase/seed/source/builtInCards/WF-built-in.js`

**Interfaces:**
- Consumes: nothing.
- Produces: the effect names Tasks 11–13 register — `hunchbackActivate`, `monsoonActivate`, `spectrumEffect`, `krakenOnPlay`, `specialFoundriesEffect`, `roboticAssemblersEffect`, `defensiveParapetEffect`, `sapphireScreenEffect`, `allForTheCauseEffect`.

- [ ] **Step 1: Check every name for a second owner**

The Kraken trap: registering `paddlegunEffect` in wave 1 made Kraken fire Paddlegun's effect, because both rows carried that name. Before touching anything:

```bash
grep -rn "hunchbackActivate\|monsoonActivate\|spectrumEffect\|krakenOnPlay\|specialFoundriesEffect\|roboticAssemblersEffect\|defensiveParapetEffect\|sapphireScreenEffect\|allForTheCauseEffect" supabase/seed/source/
```

Expected: exactly one hit per name (and zero for the two new `*Activate` names), each on the card that should own it. Stop and re-plan if any name appears twice.

- [ ] **Step 2: `[GT] Hunchback` — give it an activated ability**

Its `meta` is an empty block, so both the name and the price are new. In `GT_HEAVY_AIRSHIP` in `OW-Built-in.js`:

```js
        meta: {
            [TRIGGERS.ON_ACTIVATE]: 'hunchbackActivate',
            activateCpCost: 1
        }
```

- [ ] **Step 3: `[GT] Monsoon` — same treatment**

```js
        meta: {
            [TRIGGERS.ON_ACTIVATE]: 'monsoonActivate',
            activateCpCost: 1
        }
```

- [ ] **Step 4: `Spectrum` — author the text, keep the name**

Spectrum already carries `onActivate: 'spectrumEffect'` and an empty `cardText`. Spec §7.2 authors the text; only `activateCpCost` is new.

```js
        cardText: 'Once per turn, you may pay 1cp to draw a random card from the [TG] Robotics pool',
```

```js
        meta: {
            [TRIGGERS.ON_ACTIVATE]: 'spectrumEffect',
            activateCpCost: 1
        }
```

- [ ] **Step 5: `Robotic Assemblers` — trim the trailing space**

The registry trims on read, so this is cosmetic, but it is the same class of defect spec §6 normalised on Orbit Flank.

```js
            [TRIGGERS.ON_PLAY]: 'roboticAssemblersEffect'
```

- [ ] **Step 6: `All for the Cause` — correct the trigger key**

Its text reads "Choose a zone", but the seed names `playOnVehicleEffect`. Card text is authoritative (spec §6).

```js
            [TRIGGERS.PLAY_ON_ZONE]: 'allForTheCauseEffect'
```

- [ ] **Step 7: Confirm the other three rows need nothing**

`Kraken` already carries `onPlayEffect: 'krakenOnPlay'` (wave 1's rename), `Special Foundries` carries `onPlayEffect: 'specialFoundriesEffect'`, `Defensive Parapet` carries `playOnZoneEffect: 'defensiveParapetEffect'`, and `Sapphire Screen` carries `onPlayEffect: 'sapphireScreenEffect'`. Read each and change nothing.

- [ ] **Step 8: Rebuild and run**

```bash
npm run seed:build
npx vitest run
```
Expected: PASS — all nine cards are still in `KNOWN_GAPS`, so G1 and the stale-entry check are both satisfied.

- [ ] **Step 9: Commit**

```bash
git add supabase/seed
git commit -m "fix(seed): wire wave 2's nine cards to the names their text implies"
```

## Task 10: `spawnVehicles`

Placing a hull on the board without playing it. Spawning is not playing (spec §7.4): the spawned card's own `onPlayEffect` never fires, and biome and screen rules do not gate it.

**Files:**
- Modify: `shared/effects/primitives.ts`
- Test: `shared/effects/primitives.test.ts`

**Interfaces:**
- Consumes: `ZoneCardEntry.activatedOnTurn` (Task 1).
- Produces: `catalogCard(ctx: EngineContext, cardName: string): SnapshotCard | null`; `spawnInto(game: EngineGame, ctx: EngineContext, actor: Side, zoneId: number, snapshot: SnapshotCard, keywords?: string[]): ZoneCardEntry | null` (null when there is no such zone); `spawnVehicles(spec: { cardName: string; count: number; zones: 'target' | 'all'; keywords?: string[] }): EffectFn`.

- [ ] **Step 1: Write the failing tests**

Append to `shared/effects/primitives.test.ts`:

```ts
describe('spawnVehicles', () => {
  const parapet = snap({ name: 'Parapet', faction: 'OW', vehicleType: 'plane', materialCost: 259000 })

  it('spawns into the target zone with the summoning card\'s keywords', () => {
    const game = makeGame()
    const ctx = makeCtx({ catalog: [parapet] })
    const fn = spawnVehicles({ cardName: 'Parapet', count: 2, zones: 'target', keywords: ['inoffensive', 'blocker'] })
    expect(fn({ game, actor: 'a', card: inst({ name: 'Defensive Parapet' }), ctx, targetZoneId: 3 })).toBe(true)
    const spawned = game.state.zones[2].cards.a
    expect(spawned).toHaveLength(2)
    expect(spawned[0].keywords).toEqual(expect.arrayContaining(['inoffensive', 'blocker']))
    expect(spawned[0].instanceId).not.toBe(spawned[1].instanceId)
    expect(spawned[0]).toHaveProperty('activatedOnTurn', null)
  })

  it('ignores biome legality — a plane reaches every zone', () => {
    const game = makeGame()
    const ctx = makeCtx({ catalog: [snap({ name: 'Sapphire', vehicleType: 'plane', faction: 'LH' })] })
    const fn = spawnVehicles({ cardName: 'Sapphire', count: 1, zones: 'all', keywords: ['mobile', 'stealthy'] })
    expect(fn({ game, actor: 'a', card: inst({ name: 'Sapphire Screen' }), ctx })).toBe(true)
    expect(game.state.zones.map((z) => z.cards.a.length)).toEqual([1, 1, 1])
  })

  it('does not fire the spawned card\'s own onPlayEffect', () => {
    const game = makeGame()
    const ctx = makeCtx({ catalog: [snap({ name: 'Sapphire', vehicleType: 'plane', meta: { onPlayEffect: 'sapphireEffect' } })] })
    const before = game.state.resources.a.materials
    const fn = spawnVehicles({ cardName: 'Sapphire', count: 1, zones: 'all' })
    expect(fn({ game, actor: 'a', card: inst(), ctx })).toBe(true)
    expect(game.state.resources.a.materials).toBe(before)
    expect(game.privates.a.hand).toHaveLength(0)
  })

  it('fails when the catalog has no such card', () => {
    const game = makeGame()
    const fn = spawnVehicles({ cardName: 'Parapet', count: 1, zones: 'target' })
    expect(fn({ game, actor: 'a', card: inst(), ctx: makeCtx({ catalog: [] }), targetZoneId: 1 })).toBe(false)
  })

  it('fails when a target-zone spawn has no zone', () => {
    const game = makeGame()
    const fn = spawnVehicles({ cardName: 'Parapet', count: 1, zones: 'target' })
    expect(fn({ game, actor: 'a', card: inst(), ctx: makeCtx({ catalog: [parapet] }) })).toBe(false)
  })
})

describe('drawFromPool excludes summon-only cards', () => {
  it('never mints a summon-only card into a hand', () => {
    const game = makeGame()
    const ctx = makeCtx({
      catalog: [snap({ name: 'Martyr', faction: 'WF', vehicleType: 'plane', meta: { summonOnly: true } })],
    })
    const fn = drawFromPool({ source: 'catalog', filter: { faction: 'WF' }, count: 1, allowEmpty: true })
    expect(fn({ game, actor: 'a', card: inst(), ctx })).toBe(true)
    expect(game.privates.a.hand).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run shared/effects/primitives.test.ts`
Expected: FAIL — `spawnVehicles` is not exported.

- [ ] **Step 3: Exclude summon-only from catalog pools**

In `drawFromPool`'s catalog branch:

```ts
      const pool = ctx.catalog.filter(
        (c) => c.isBuiltIn && c.meta.summonOnly !== true && matches(c, spec.filter),
      )
```

Spawned-only hulls must never be draftable *or* drawable. No pool matches one today, but nothing should ever mint a Martyr into a hand.

- [ ] **Step 4: Write the primitive**

Append to `shared/effects/primitives.ts`, merging `SnapshotCard` and `ZoneCardEntry` into the existing type imports:

```ts
// Find a built-in card by its printed name. Summoning cards name their hull
// in card text ("spawn two parapets"), so the name is the only stable key —
// card ids are generated at seed time.
export function catalogCard(ctx: EngineContext, cardName: string): SnapshotCard | null {
  return ctx.catalog.find((c) => c.isBuiltIn && c.name === cardName) ?? null
}

// Place one hull on the board. SPAWNING IS NOT PLAYING (spec §7.4): no
// payment, no placement legality, no onPlayEffect. Keywords come from the
// summoning card, on top of whatever the row prints; the add is idempotent.
export function spawnInto(
  game: EngineGame, ctx: EngineContext, actor: Side, zoneId: number,
  snapshot: SnapshotCard, keywords: string[] = [],
): ZoneCardEntry | null {
  const zone = game.state.zones.find((z) => z.id === zoneId)
  if (!zone) return null
  const entry: ZoneCardEntry = {
    ...snapshot,
    instanceId: ctx.newId(),
    keywords: [...snapshot.keywords, ...keywords.filter((k) => !snapshot.keywords.includes(k))],
    playedOnTurn: game.turnNumber,
    movedOnTurn: null,
    activatedOnTurn: null,
  }
  zone.cards[actor].push(entry)
  return entry
}

// Spawn `count` copies of a named catalog card into the played zone, or into
// every zone. A card missing from the catalog is a data bug, not an empty
// pool, so it fails the play rather than fizzling.
export function spawnVehicles(spec: {
  cardName: string
  count: number
  zones: 'target' | 'all'
  keywords?: string[]
}): EffectFn {
  return ({ game, actor, ctx, targetZoneId }) => {
    const snapshot = catalogCard(ctx, spec.cardName)
    if (!snapshot) return false
    const zoneIds = spec.zones === 'all'
      ? game.state.zones.map((z) => z.id)
      : typeof targetZoneId === 'number' ? [targetZoneId] : []
    if (zoneIds.length === 0) return false
    let spawned = 0
    for (const zoneId of zoneIds) {
      for (let i = 0; i < spec.count; i++) {
        if (spawnInto(game, ctx, actor, zoneId, snapshot, spec.keywords)) spawned++
      }
    }
    if (spawned === 0) return false
    game.state.log.push(
      `${spawned} ${spec.cardName}${spawned === 1 ? '' : 's'} spawned for player ${actor.toUpperCase()}`,
    )
    return true
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run shared/effects/primitives.test.ts`
Expected: PASS.

- [ ] **Step 6: Sync and commit**

```bash
npm run functions:sync
npx vitest run
git add shared supabase/functions
git commit -m "feat(effects): add spawnVehicles — board spawns that are not plays"
```

---

# The nine cards

Each of the next three tasks registers three effect names **and deletes those three `KNOWN_GAPS` entries in the same commit**. The stale-entry assertion fails the moment a listed card starts working, so the two halves cannot be separated.

## Task 11: the three activated abilities

| Card | Name | Effect |
|---|---|---|
| `[GT] Hunchback` | `hunchbackActivate` | `grant({ draw: 1 })` |
| `[GT] Monsoon` | `monsoonActivate` | relocate this hull to another legal zone |
| `Spectrum` | `spectrumEffect` | the existing `tgRobotics` pool draw |

**Files:**
- Modify: `shared/engine/heroPowers.ts` (export `moveEntry`)
- Modify: `shared/effects/owEffects.ts`
- Modify: `shared/effects/lhEffects.ts`
- Modify: `supabase/seed/effectCoverage.test.ts`
- Test: `shared/effects/factionEffects.test.ts`

**Interfaces:**
- Consumes: `ACTIVATE_VEHICLE` (Task 2), the seeded names (Task 9).
- Produces: `moveEntry` exported from `shared/engine/heroPowers.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `shared/effects/factionEffects.test.ts`, matching its existing helper style:

```ts
describe('wave 2 — activated abilities', () => {
  const onBoard = (over: Record<string, unknown>) => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    game.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'v1', ...over }))
    game.state.resources.a.cp = 2
    return game
  }

  it('[GT] Hunchback draws a card for 1 CP', () => {
    const game = onBoard({
      name: '[GT] Hunchback', meta: { onActivate: 'hunchbackActivate', activateCpCost: 1 },
    })
    game.privates.a.deck = [inst({ name: 'Spare' })]
    game.state.counts.a = { hand: 0, deck: 1 }
    const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'v1' }, makeCtx())
    if (!res.ok) throw new Error(res.error)
    expect(res.game.privates.a.hand).toHaveLength(1)
    expect(res.game.state.resources.a.cp).toBe(1)
  })

  it('[GT] Monsoon relocates itself, keeping its activation stamp', () => {
    const game = onBoard({
      name: '[GT] Monsoon', vehicleType: 'airship',
      meta: { onActivate: 'monsoonActivate', activateCpCost: 1 },
    })
    const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'v1', zoneId: 3 }, makeCtx())
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.zones[0].cards.a).toHaveLength(0)
    expect(res.game.state.zones[2].cards.a[0]).toMatchObject({ instanceId: 'v1', activatedOnTurn: 2 })
  })

  it('[GT] Monsoon rejects an activation with no destination', () => {
    const game = onBoard({
      name: '[GT] Monsoon', vehicleType: 'airship',
      meta: { onActivate: 'monsoonActivate', activateCpCost: 1 },
    })
    const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'v1' }, makeCtx())
    expect(res).toMatchObject({ ok: false, status: 400 })
  })

  it('Spectrum draws from the TG Robotics pool', () => {
    const game = onBoard({
      name: 'Spectrum', vehicleType: 'plane',
      meta: { onActivate: 'spectrumEffect', activateCpCost: 1 },
    })
    const ctx = makeCtx({ catalog: [snap({ name: '[TG] Widget', faction: 'TG', vehicleType: 'tank' })] })
    const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'v1' }, ctx)
    if (!res.ok) throw new Error(res.error)
    expect(res.game.privates.a.hand).toHaveLength(1)
    expect(res.game.privates.a.hand[0].faction).toBe('TG')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run shared/effects/factionEffects.test.ts`
Expected: FAIL — none of the three names is registered.

- [ ] **Step 3: Export `moveEntry`**

`shared/engine/heroPowers.ts` — change the declaration only, leaving the body alone:

```ts
// Exported for [GT] Monsoon's activated ability, which is a relocation with a
// different price and gate but identical mechanics.
export function moveEntry(game: EngineGame, actor: Side, instanceId: string, zoneId: number, stampMove: boolean) {
```

- [ ] **Step 4: Register Hunchback and Monsoon**

Append to `shared/effects/owEffects.ts`. They are faction GT but their rows live in `OW-Built-in.js`, which is why they register here beside `[GT] Osprey`. Merge `moveEntry` into a new import from `'../engine/heroPowers.ts'` and `grant` into the existing `primitives.ts` import.

```ts
// "Once per turn, you may spend 1cp to draw a card" — the CP is charged by
// ACTIVATE_VEHICLE from meta.activateCpCost, so the effect is only the draw.
registerEffect('hunchbackActivate', grant({ draw: 1 }))

// "Once per turn, you may pay 1cp to move this vehicle to another zone."
// Reuses the hero-power relocation, so biome legality and the movedOnTurn
// stamp behave exactly as they do for a Mobile vehicle's MOVE_VEHICLE.
registerEffect('monsoonActivate', ({ game, actor, card, targetZoneId }) => {
  if (typeof targetZoneId !== 'number') return false
  return moveEntry(game, actor, card.instanceId, targetZoneId, true).ok
})
```

- [ ] **Step 5: Register Spectrum**

Append to `shared/effects/lhEffects.ts`, reusing the `tgRobotics` constant already declared at the top of that file:

```ts
// Spec §7.2 authors this card's text: "Once per turn, you may pay 1cp to draw
// a random card from the [TG] Robotics pool." Same pool as Ampere's.
registerEffect('spectrumEffect', tgRobotics, { needsCatalog: true })
```

- [ ] **Step 6: Close the three gaps**

`supabase/seed/effectCoverage.test.ts` — delete these three entries from `KNOWN_GAPS`:

```ts
  'GT:[GT] Hunchback': 'wave 2', 'GT:[GT] Monsoon': 'wave 2', 'LH:Spectrum': 'wave 2',
```

and change the count assertion:

```ts
    expect(Object.keys(KNOWN_GAPS)).toHaveLength(28)
```

- [ ] **Step 7: Run everything**

Run: `npx vitest run`
Expected: PASS. If the stale-entry test fails, an entry was left behind; if G1 fails, a name was deleted from `KNOWN_GAPS` without being registered.

- [ ] **Step 8: Sync and commit**

```bash
npm run functions:sync
npx vitest run
git add shared supabase
git commit -m "feat(cards): Hunchback, Monsoon and Spectrum activate"
```

## Task 12: the three choices

| Card | Name | Choice |
|---|---|---|
| `Kraken` | `krakenOnPlay` | which used hero power to refresh, then +1 CP |
| `Special Foundries` | `specialFoundriesEffect` | the light or the heavy GT airship pool |
| `Robotic Assemblers` | `roboticAssemblersEffect` | which [TG] Robotics card to take |

All three offer options over information the opponent already has — used hero powers are in `state.usedHeroPowers`, the two pools are named on the card, and the four TG Robotics cards are public built-ins. `pendingEffect.options` is public; check this for every future choice.

**Files:**
- Modify: `shared/gameSettings.ts`
- Modify: `shared/effects/dwgEffects.ts`
- Modify: `shared/effects/owEffects.ts`
- Modify: `shared/effects/lhEffects.ts`
- Modify: `supabase/seed/effectCoverage.test.ts`
- Test: `shared/effects/factionEffects.test.ts`

**Interfaces:**
- Consumes: `choice` (Task 4), `RESOLVE_PENDING_EFFECT` (Task 4), `GT_HEAVY_AIRSHIP_MIN_COST` (already in `gameSettings.ts`).
- Produces: `HERO_POWER_LABELS: Record<string, string>` in `shared/gameSettings.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `shared/effects/factionEffects.test.ts`:

```ts
describe('wave 2 — choices', () => {
  function playAbility(game: EngineGame, card: CardInstance, ctx = makeCtx()) {
    game.privates.a.hand.push(card)
    game.state.counts.a.hand = game.privates.a.hand.length
    return applyAction(game, 'alice', { type: 'PLAY_ABILITY_CARD', instanceId: card.instanceId }, ctx)
  }

  it('Kraken offers only the powers already used, and refreshes the chosen one', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    game.state.usedHeroPowers.a = ['draw', 'salvage']
    game.privates.a.hand.push(inst({
      instanceId: 'k1', name: 'Kraken', faction: 'DWG', vehicleType: 'ship',
      materialCost: 0, meta: { onPlayEffect: 'krakenOnPlay' },
    }))
    game.state.counts.a.hand = 1
    const cpBefore = game.state.resources.a.cp
    const suspended = applyAction(
      game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: 'k1', zoneId: 1 }, makeCtx(),
    )
    if (!suspended.ok) throw new Error(suspended.error)
    expect(suspended.game.state.pendingEffect?.options.map((o) => o.id)).toEqual(['draw', 'salvage'])
    const resolved = applyAction(
      suspended.game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'salvage' }, makeCtx(),
    )
    if (!resolved.ok) throw new Error(resolved.error)
    expect(resolved.game.state.usedHeroPowers.a).toEqual(['draw'])
    expect(resolved.game.state.resources.a.cp).toBe(cpBefore + 1)
  })

  it('Kraken still grants its CP when no hero power has been used', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    game.state.usedHeroPowers.a = []
    game.privates.a.hand.push(inst({
      instanceId: 'k2', name: 'Kraken', faction: 'DWG', vehicleType: 'ship',
      materialCost: 0, meta: { onPlayEffect: 'krakenOnPlay' },
    }))
    game.state.counts.a.hand = 1
    const cpBefore = game.state.resources.a.cp
    const res = applyAction(
      game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: 'k2', zoneId: 1 }, makeCtx(),
    )
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.pendingEffect).toBeNull()
    expect(res.game.state.resources.a.cp).toBe(cpBefore + 1)
  })

  it('Special Foundries draws from whichever GT airship pool is chosen', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    const ctx = makeCtx({
      catalog: [
        snap({ name: 'Wasp', faction: 'GT', vehicleType: 'airship', materialCost: 70000 }),
        snap({ name: 'Kobold', faction: 'GT', vehicleType: 'airship', materialCost: 700000 }),
      ],
    })
    const res = playAbility(game, inst({
      instanceId: 'sf1', name: 'Special Foundries', type: 'ability',
      meta: { onPlayEffect: 'specialFoundriesEffect' },
    }), ctx)
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.pendingEffect?.options.map((o) => o.id)).toEqual(['light', 'heavy'])
    const heavy = applyAction(res.game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'heavy' }, ctx)
    if (!heavy.ok) throw new Error(heavy.error)
    expect(heavy.game.privates.a.hand.map((c) => c.name)).toEqual(['Kobold'])
  })

  it('Robotic Assemblers adds the chosen TG card without naming it in the log', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    const ctx = makeCtx({
      catalog: [
        snap({ cardId: 'tg-1', name: '[TG] Alpha', faction: 'TG', vehicleType: 'tank' }),
        snap({ cardId: 'tg-2', name: '[TG] Beta', faction: 'TG', vehicleType: 'tank' }),
      ],
    })
    const res = playAbility(game, inst({
      instanceId: 'ra1', name: 'Robotic Assemblers', type: 'ability',
      meta: { onPlayEffect: 'roboticAssemblersEffect' },
    }), ctx)
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.pendingEffect?.options).toEqual([
      { id: 'tg-1', label: '[TG] Alpha' },
      { id: 'tg-2', label: '[TG] Beta' },
    ])
    const done = applyAction(res.game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'tg-2' }, ctx)
    if (!done.ok) throw new Error(done.error)
    expect(done.game.privates.a.hand.map((c) => c.name)).toEqual(['[TG] Beta'])
    expect(done.game.state.counts.a.hand).toBe(1)
    expect(done.game.state.log.join()).not.toContain('[TG] Beta')
  })
})
```

Zone 1 is water in `makeGame`'s fixture, so a ship deploys there legally, and `materialCost: 0` keeps affordability out of the way. `playAbility` is used only for the two genuine ability cards; Kraken is a vehicle and goes through `PLAY_CARD_TO_ZONE`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run shared/effects/factionEffects.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the hero-power labels**

`shared/gameSettings.ts`, beside the other tunables. `HeroPowerBar`'s `FACTION_POWER_INFO` covers only the three faction powers and keeps its own copy for the blurbs; leave it alone.

```ts
// Human-readable names for the seven hero powers, used wherever a power id
// is shown to a player (Kraken's refresh choice).
export const HERO_POWER_LABELS: Record<string, string> = {
  salvage: 'Salvage',
  tacticalPositioning: 'Tactical Positioning',
  draw: 'Draw',
  rapidRedeployment: 'Rapid Redeployment',
  boardingParty: 'Boarding Party',
  changeOrder: 'Change Order',
  flyby: 'Flyby',
}
```

- [ ] **Step 4: Register Kraken**

Append to `shared/effects/dwgEffects.ts`. Declare the name once and pass the same constant to both `registerEffect` and `choice({ effect })` — the factory cannot know the name it is stored under, and the slot must carry it for the handler to re-enter.

```ts
// "When played, refresh one of your hero powers then gain 1cp." With no used
// power there is nothing to refresh, and `choice` resolves without suspending
// so the CP still lands.
const KRAKEN = 'krakenOnPlay'
registerEffect(KRAKEN, choice({
  effect: KRAKEN,
  prompt: 'Refresh one of your used hero powers',
  options: ({ game, actor }) =>
    game.state.usedHeroPowers[actor].map((p) => ({ id: p, label: HERO_POWER_LABELS[p] ?? p })),
  resolve: ({ game, actor }, choiceId) => {
    if (choiceId === null) {
      game.state.log.push('Kraken finds no used hero power to refresh')
    } else {
      game.state.usedHeroPowers[actor] = game.state.usedHeroPowers[actor].filter((p) => p !== choiceId)
      game.state.log.push(`Kraken refreshes ${HERO_POWER_LABELS[choiceId] ?? choiceId}`)
    }
    game.state.resources[actor].cp += 1
    return true
  },
}))
```

- [ ] **Step 5: Register Special Foundries**

Append to `shared/effects/owEffects.ts`. `maxCost` is inclusive, hence the `- 1`.

```ts
// "Draw one card from either the GT Airship or Heavy Airship deck (your
// choice)." Spec §7.3 puts the cliff at GT_HEAVY_AIRSHIP_MIN_COST, which
// splits the fourteen GT airships 6 / 8 — the guard pins those counts.
const SPECIAL_FOUNDRIES = 'specialFoundriesEffect'
const gtLightAirship = drawFromPool({
  source: 'catalog',
  filter: { faction: 'GT', vehicleType: 'airship', maxCost: GT_HEAVY_AIRSHIP_MIN_COST - 1 },
  count: 1,
})
const gtHeavyAirship = drawFromPool({
  source: 'catalog',
  filter: { faction: 'GT', vehicleType: 'airship', minCost: GT_HEAVY_AIRSHIP_MIN_COST },
  count: 1,
})
registerEffect(SPECIAL_FOUNDRIES, choice({
  effect: SPECIAL_FOUNDRIES,
  prompt: 'Draw from which GT airship pool?',
  options: () => [
    { id: 'light', label: 'GT Airship' },
    { id: 'heavy', label: 'GT Heavy Airship' },
  ],
  resolve: (payload, choiceId) => (choiceId === 'heavy' ? gtHeavyAirship(payload) : gtLightAirship(payload)),
}), { needsCatalog: true })
```

- [ ] **Step 6: Register Robotic Assemblers**

Append to `shared/effects/lhEffects.ts`. Options are sorted by name so a seeded rng is not needed and the order is stable across runs. The log must not name the card — it is entering a hidden hand — even though the options were public.

```ts
// "Choose a [TG] Robotics card to add to your hand." All four TG built-ins
// are public, so offering them by name leaks nothing.
const ROBOTIC_ASSEMBLERS = 'roboticAssemblersEffect'
registerEffect(ROBOTIC_ASSEMBLERS, choice({
  effect: ROBOTIC_ASSEMBLERS,
  prompt: 'Choose a [TG] Robotics card to add to your hand',
  options: ({ ctx }) => ctx.catalog
    .filter((c) => c.isBuiltIn && c.faction === 'TG' && c.meta.summonOnly !== true)
    .sort((x, y) => x.name.localeCompare(y.name))
    .map((c) => ({ id: c.cardId, label: c.name })),
  resolve: ({ game, actor, ctx }, choiceId) => {
    const pick = ctx.catalog.find((c) => c.cardId === choiceId)
    // An empty catalog here is an infrastructure bug, not an empty pool.
    if (!pick) return false
    const hand = game.privates[actor].hand
    hand.push({ ...pick, instanceId: ctx.newId() })
    game.state.counts[actor].hand = hand.length
    game.state.log.push(`Player ${actor.toUpperCase()} adds a card to their hand`)
    return true
  },
}), { needsCatalog: true })
```

- [ ] **Step 7: Close the three gaps**

Delete from `KNOWN_GAPS`:

```ts
  'DWG:Kraken': 'wave 2', 'OW:Special Foundries': 'wave 2',
  'LH:Robotic Assemblers': 'wave 2',
```

and set the count to `25`.

- [ ] **Step 8: Run everything**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 9: Sync and commit**

```bash
npm run functions:sync
npx vitest run
git add shared supabase
git commit -m "feat(cards): Kraken, Special Foundries and Robotic Assemblers suspend for a choice"
```

## Task 13: the three board spawns

| Card | Name | Spawn |
|---|---|---|
| `Defensive Parapet` | `defensiveParapetEffect` | 2 × Parapet into the target zone, +Inoffensive +Scrappy +Blocker |
| `Sapphire Screen` | `sapphireScreenEffect` | 1 × Sapphire into every zone, +Mobile +Stealthy |
| `All for the Cause` | `allForTheCauseEffect` | Temporary to friendlies in the zone, then Martyrs |

**Files:**
- Modify: `shared/gameSettings.ts`
- Modify: `shared/effects/owEffects.ts`
- Modify: `shared/effects/lhEffects.ts`
- Modify: `shared/effects/wfEffects.ts`
- Modify: `supabase/seed/effectCoverage.test.ts`
- Test: `shared/effects/factionEffects.test.ts`

**Interfaces:**
- Consumes: `spawnVehicles`, `spawnInto`, `catalogCard` (Task 10); the seeded `Parapet` and `Martyr` rows (Task 7).
- Produces: `ALL_FOR_THE_CAUSE_DOUBLE_COST` in `shared/gameSettings.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `shared/effects/factionEffects.test.ts`:

```ts
describe('wave 2 — board spawns', () => {
  const parapet = snap({ name: 'Parapet', faction: 'OW', vehicleType: 'plane', materialCost: 259000, meta: { summonOnly: true } })
  const martyr = snap({ name: 'Martyr', faction: 'WF', vehicleType: 'plane', materialCost: 8500, meta: { summonOnly: true } })

  it('Defensive Parapet lands two stamped Parapets in the chosen zone', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    const ctx = makeCtx({ catalog: [parapet] })
    const card = inst({
      instanceId: 'dp1', name: 'Defensive Parapet', type: 'ability', materialCost: 200000,
      meta: { playOnZoneEffect: 'defensiveParapetEffect' },
    })
    game.privates.a.hand.push(card)
    game.state.counts.a.hand = 1
    const res = applyAction(game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: 'dp1', zoneId: 3 }, ctx)
    if (!res.ok) throw new Error(res.error)
    const spawned = res.game.state.zones[2].cards.a
    expect(spawned).toHaveLength(2)
    expect(spawned[0].keywords).toEqual(expect.arrayContaining(['inoffensive', 'scrappy', 'blocker']))
    expect(res.game.state.destroyed.a.map((c) => c.name)).toEqual(['Defensive Parapet'])
  })

  it('Sapphire Screen puts one Sapphire in every zone and fires no Sapphire effect', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    const sapphire = snap({
      name: 'Sapphire', faction: 'LH', vehicleType: 'plane', materialCost: 30000,
      keywords: ['mobile', 'stealthy'], meta: { onPlayEffect: 'sapphireEffect' },
    })
    const ctx = makeCtx({ catalog: [sapphire] })
    const card = inst({
      instanceId: 'ss1', name: 'Sapphire Screen', type: 'ability', materialCost: 90000,
      meta: { onPlayEffect: 'sapphireScreenEffect' },
    })
    game.privates.a.hand.push(card)
    game.state.counts.a.hand = 1
    const materialsBefore = game.state.resources.a.materials
    const res = applyAction(game, 'alice', { type: 'PLAY_ABILITY_CARD', instanceId: 'ss1' }, ctx)
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.zones.map((z) => z.cards.a.length)).toEqual([1, 1, 1])
    // Spawning is not playing (spec §7.4): no draw, no refund from sapphireEffect.
    expect(res.game.privates.a.hand).toHaveLength(0)
    expect(res.game.state.resources.a.materials).toBe(materialsBefore - 90000)
  })

  it('All for the Cause turns friendlies Temporary and spawns Martyrs by cost', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    game.state.zones[1].cards.a.push(
      zoneEntry({ instanceId: 'cheap', name: 'Skiff', materialCost: 100000 }),
      zoneEntry({ instanceId: 'dear', name: 'Dreadnought', materialCost: 300000 }),
    )
    game.state.zones[1].cards.b.push(zoneEntry({ instanceId: 'enemy', name: 'Foe' }))
    const ctx = makeCtx({ catalog: [martyr] })
    const card = inst({
      instanceId: 'afc1', name: 'All for the Cause', type: 'ability', materialCost: 0,
      meta: { playOnZoneEffect: 'allForTheCauseEffect' },
    })
    game.privates.a.hand.push(card)
    game.state.counts.a.hand = 1
    const res = applyAction(game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: 'afc1', zoneId: 2 }, ctx)
    if (!res.ok) throw new Error(res.error)
    const mine = res.game.state.zones[1].cards.a
    const originals = mine.filter((c) => c.name !== 'Martyr')
    const martyrs = mine.filter((c) => c.name === 'Martyr')
    expect(originals.every((c) => c.keywords.includes('temporary'))).toBe(true)
    expect(martyrs).toHaveLength(3)          // 1 for the 100k hull, 2 for the 300k
    expect(martyrs.every((c) => !c.keywords.includes('temporary'))).toBe(true)
    expect(res.game.state.zones[1].cards.b[0].keywords).not.toContain('temporary')
  })

  it('All for the Cause fizzles in an empty zone rather than rejecting the play', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    const ctx = makeCtx({ catalog: [martyr] })
    const card = inst({
      instanceId: 'afc2', name: 'All for the Cause', type: 'ability', materialCost: 0,
      meta: { playOnZoneEffect: 'allForTheCauseEffect' },
    })
    game.privates.a.hand.push(card)
    game.state.counts.a.hand = 1
    const res = applyAction(game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: 'afc2', zoneId: 1 }, ctx)
    expect(res.ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run shared/effects/factionEffects.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the threshold constant**

`shared/gameSettings.ts`, beside `DOUBLE_UP_MAX_COST`:

```ts
// All for the Cause: "If the vehicle costed more than 250k, summon two
// instead." Printed materialCost, strictly greater — the same authority every
// other pool and threshold filter reads.
export const ALL_FOR_THE_CAUSE_DOUBLE_COST = 250_000
```

- [ ] **Step 4: Register Defensive Parapet**

Append to `shared/effects/owEffects.ts`:

```ts
// "Spawn two parapets into a zone. They gain Inoffensive, Scrappy, and blocker
// keywords." Keywords come from the summoning card, not the Parapet row —
// the established pattern (spawnBuccaneerEffect stamps Scrappy the same way).
registerEffect('defensiveParapetEffect', spawnVehicles({
  cardName: 'Parapet',
  count: 2,
  zones: 'target',
  keywords: [KEYWORDS.INOFFENSIVE, KEYWORDS.SCRAPPY, KEYWORDS.BLOCKER],
}), { needsCatalog: true })
```

- [ ] **Step 5: Register Sapphire Screen**

Append to `shared/effects/lhEffects.ts`:

```ts
// "Spawn a friendly Sapphire into each zone. They have MOBILE and STEALTHY
// keywords." Sapphire already prints both, so the stamp is idempotent and
// kept only because the card text asks for it. Sapphire's own onPlayEffect
// does NOT fire — spawning is not playing (spec §7.4) — which is what keeps a
// 90k ability from also drawing three cards and refunding 90k.
registerEffect('sapphireScreenEffect', spawnVehicles({
  cardName: 'Sapphire',
  count: 1,
  zones: 'all',
  keywords: [KEYWORDS.MOBILE, KEYWORDS.STEALTHY],
}), { needsCatalog: true })
```

- [ ] **Step 6: Register All for the Cause**

Replace the whole of `shared/effects/wfEffects.ts`'s tail with this appended block (leave wave 1's two registrations untouched):

```ts
// "Choose a zone. Give all friendly vehicles in that zone the TEMPORARY
// keyword, then spawn a Martyr for each vehicle affected. If the vehicle
// costed more than 250k, summon two instead."
//
// The occupant list is snapshotted before spawning: spawnInto pushes into the
// same array, so iterating it live would stamp the new Martyrs Temporary and
// spawn Martyrs for Martyrs.
registerEffect('allForTheCauseEffect', ({ game, actor, ctx, targetZoneId }) => {
  const zone = game.state.zones.find((z) => z.id === targetZoneId)
  if (!zone) return false
  const martyr = catalogCard(ctx, 'Martyr')
  if (!martyr) return false

  const affected = [...zone.cards[actor]] as ZoneCardEntry[]
  if (affected.length === 0) {
    game.state.log.push('All for the Cause finds no friendly vehicles in that zone')
    return true
  }

  let spawned = 0
  for (const entry of affected) {
    if (!entry.keywords.includes(KEYWORDS.TEMPORARY)) {
      entry.keywords = [...entry.keywords, KEYWORDS.TEMPORARY]
    }
    const copies = entry.materialCost > ALL_FOR_THE_CAUSE_DOUBLE_COST ? 2 : 1
    for (let i = 0; i < copies; i++) {
      if (spawnInto(game, ctx, actor, zone.id, martyr)) spawned++
    }
  }
  game.state.log.push(
    `All for the Cause: ${affected.length} vehicle(s) go Temporary and ${spawned} Martyr(s) answer in zone ${zone.id}`,
  )
  return true
})
```

- [ ] **Step 7: Close the last three gaps and flip the wave assertion**

Delete from `KNOWN_GAPS`:

```ts
  'OW:Defensive Parapet': 'wave 2',
  'LH:Sapphire Screen': 'wave 2', 'WF:All for the Cause': 'wave 2',
```

Replace the wave-1 completion test with one covering both waves:

```ts
  it('waves 1 and 2 are complete — no wave-1 or wave-2 entries remain', () => {
    expect(Object.values(KNOWN_GAPS).filter((w) => w.startsWith('wave 1'))).toEqual([])
    expect(Object.values(KNOWN_GAPS).filter((w) => w.startsWith('wave 2'))).toEqual([])
    expect(Object.keys(KNOWN_GAPS)).toHaveLength(22)
  })
```

`startsWith` rather than equality: `'SS:Excalibur'` is labelled `'wave 3 — a vehicle with a hand target has no play path'`, so a bare `=== 'wave 3'` would miss it if that idiom spreads.

- [ ] **Step 8: Run everything**

Run: `npx vitest run`
Expected: PASS, with `KNOWN_GAPS` down to 22.

- [ ] **Step 9: Sync and commit**

```bash
npm run functions:sync
npx vitest run
git add shared supabase
git commit -m "feat(cards): Defensive Parapet, Sapphire Screen and All for the Cause spawn hulls"
```

---

# Frontend

## Task 14: activating a vehicle

Mirrors the existing Mobile "move" affordance exactly: a corner button on `MiniVehicle`, gated by `BoardZone`, driven by `GameBoardPage`. Monsoon needs a destination, so it reuses `MoveMode`'s pick-a-zone phase with a third `kind`.

**Files:**
- Modify: `frontend/src/pages/game/MiniVehicle.tsx`
- Modify: `frontend/src/pages/game/BoardZone.tsx`
- Modify: `frontend/src/pages/game/HeroPowerBar.tsx`
- Modify: `frontend/src/pages/game/GameBoardPage.tsx`

**Interfaces:**
- Consumes: the `ACTIVATE_VEHICLE` action (Task 2), `meta.activateCpCost` and `onActivate` (Task 9).
- Produces: `MoveMode` kind `'activate'`.

- [ ] **Step 1: Add the affordance to `MiniVehicle`**

Two new optional props beside `moveAffordance` / `onMoveClick`, and a second corner button. Put it at `-right-1 -top-1` so it cannot overlap the move button at `-left-1 -top-1`:

```tsx
  /** Show the small "use" corner button (has an activated ability, unused this turn, affordable). */
  activateAffordance?: boolean
  onActivateClick?: () => void
```

```tsx
      {activateAffordance && onActivateClick && (
        <button
          type="button"
          title="Use this vehicle's activated ability"
          onClick={(e) => {
            e.stopPropagation()
            onActivateClick()
          }}
          className="absolute -right-1 -top-1 rounded-full bg-brass-400 px-1 text-[9px] font-bold text-ocean-950"
        >
          use
        </button>
      )}
```

- [ ] **Step 2: Gate it in `BoardZone`**

Beside `canMoveVehicles` / `mobileEligible`, add a `canActivateVehicles` prop and compute eligibility the same way. The engine re-validates authoritatively; this is UX only.

```tsx
          const activateEligible =
            !!canActivateVehicles &&
            typeof (c.meta as { activateCpCost?: unknown }).activateCpCost === 'number' &&
            typeof (c.meta as { onActivate?: unknown }).onActivate === 'string' &&
            c.activatedOnTurn !== turnNumber
```

```tsx
              activateAffordance={activateEligible}
              onActivateClick={activateEligible ? () => onActivateClick?.(c.instanceId) : undefined}
```

Add `canActivateVehicles?: boolean` and `onActivateClick?: (instanceId: string) => void` to the prop type, and pass them from `GameBoardPage` alongside the existing `canMoveVehicles` / `onMobileMoveClick`.

- [ ] **Step 3: Extend `MoveMode`**

`frontend/src/pages/game/HeroPowerBar.tsx`:

```ts
export type MoveMode =
  | { phase: 'pickVehicle' }
  | { phase: 'pickZone'; instanceId: string; kind: 'mobile' | 'heroPower' | 'activate' }
```

- [ ] **Step 4: Wire `GameBoardPage`**

A vehicle whose `onActivate` needs a zone is the only case that enters pick-a-zone; everything else activates immediately. `[GT] Monsoon` is the only wave-2 card in that class, and it is recognisable from its effect name, so keep the list explicit and small rather than inventing a meta flag:

```tsx
  // Effect names whose activated ability needs a destination zone. Kept
  // explicit: the alternative is a new meta key, and one card needs it.
  const ZONE_TARGETED_ACTIVATIONS = new Set(['monsoonActivate'])

  function onActivateClick(instanceId: string) {
    cancelAllModes()
    const found = findVehicle(state, instanceId)
    const name = found ? effectName(found.entry, 'onActivate') : null
    if (name && ZONE_TARGETED_ACTIVATIONS.has(name)) {
      setMoveMode({ phase: 'pickZone', instanceId, kind: 'activate' })
      return
    }
    void send({ type: 'ACTIVATE_VEHICLE', instanceId })
  }
```

`onZoneClick`'s move branch currently treats "not mobile" as "hero power". Make it exhaustive, or an activate pick will fire Rapid Redeployment:

```tsx
    if (moveMode?.phase === 'pickZone') {
      if (moveMode.kind === 'mobile') {
        void send({ type: 'MOVE_VEHICLE', instanceId: moveMode.instanceId, zoneId })
      } else if (moveMode.kind === 'activate') {
        void send({ type: 'ACTIVATE_VEHICLE', instanceId: moveMode.instanceId, zoneId })
      } else {
        void send({ type: 'USE_HERO_POWER', power: 'rapidRedeployment', instanceId: moveMode.instanceId, zoneId })
      }
      setMoveMode(null)
    }
```

`interactiveZoneIds` and `legalForMove` already highlight the legal destinations for `moveMode?.phase === 'pickZone'`, so an activate pick inherits the same highlighting with no change.

- [ ] **Step 5: Verify in the browser**

Start the preview (`.claude/launch.json` has a `frontend` entry), open a game with an activatable vehicle on the board, and check: the "use" button appears only on an eligible hull, disappears after activating, and Monsoon's flow highlights zones and relocates. Capture a screenshot for the PR.

- [ ] **Step 6: Build, lint and commit**

```bash
npm --prefix frontend run build
npm --prefix frontend run lint
git add frontend
git commit -m "feat(game): activate a vehicle's ability from the board"
```

## Task 15: resolving a choice

Without this, playing Kraken, Special Foundries or Robotic Assemblers freezes the game with no way out. It ships in the same PR as the engine for that reason.

**Files:**
- Create: `frontend/src/pages/game/PendingChoiceDialog.tsx`
- Modify: `frontend/src/pages/game/GameBoardPage.tsx`
- Modify: `frontend/src/lib/games.ts`
- Test: `frontend/src/lib/games.test.ts` if one exists; otherwise no new test file.

**Interfaces:**
- Consumes: `state.pendingEffect` (Task 3), `RESOLVE_PENDING_EFFECT` (Task 4).
- Produces: nothing.

- [ ] **Step 1: Fix `isMyMove` first**

`frontend/src/lib/games.ts` — a frozen game is currently attributed to `active_player`, which is right by accident for wave 2 but not a rule. Make it explicit, ahead of the other two branches, and widen the parameter type:

```ts
export function isMyMove(g: {
  active_player: string
  player_a: string
  state: {
    awaitingResponse: { aggressor: 'a' | 'b' } | null
    pendingReport: { submittedBy: 'a' | 'b' } | null
    pendingEffect: { side: 'a' | 'b' } | null
  }
}, me: string): boolean {
  const mySide: 'a' | 'b' = g.player_a === me ? 'a' : 'b'
  if (g.state?.pendingEffect) return g.state.pendingEffect.side === mySide
  if (g.state?.pendingReport) return g.state.pendingReport.submittedBy !== mySide
  if (g.state?.awaitingResponse) return g.state.awaitingResponse.aggressor !== mySide
  return g.active_player === me
}
```

The `g.state?.` guard is kept on the new branch for the same reason the others have it: a row from an older deploy may not carry the field.

If `frontend/src/lib/games.test.ts` exists, add a case for each side owing the choice before changing the function.

- [ ] **Step 2: Write the dialog**

Create `frontend/src/pages/game/PendingChoiceDialog.tsx`. No return-type annotation — React 19's types removed the global `JSX` namespace.

```tsx
import type { GameAction, Side } from '@shared/engine/engineTypes'
import type { PendingEffect } from '@shared/engine/gameInit'

// Renders state.pendingEffect. The owed player picks an option or declines;
// the other sees why the board is frozen. Declining is deliberate: the card is
// already paid for, so it only forfeits its own upside, and it is what stops a
// misclick from stranding both players in a game neither can advance.
export function PendingChoiceDialog({
  pending,
  mySide,
  send,
  busy,
}: {
  pending: PendingEffect
  mySide: Side
  send: (action: GameAction) => Promise<void>
  busy: boolean
}) {
  const mine = pending.side === mySide

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ocean-950/70 p-4">
      <div className="w-full max-w-md rounded-lg border border-brass-400/60 bg-ocean-900 p-5 shadow-xl">
        <p className="text-xs uppercase tracking-wide text-brass-400">{pending.card.name}</p>
        <h2 className="mt-1 text-lg font-bold text-parchment-100">{pending.prompt}</h2>

        {mine ? (
          <>
            <div className="mt-4 flex flex-col gap-2">
              {pending.options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void send({ type: 'RESOLVE_PENDING_EFFECT', choiceId: option.id })}
                  className="rounded border border-ocean-600 px-3 py-2 text-left text-sm font-bold text-parchment-100 hover:border-brass-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void send({ type: 'RESOLVE_PENDING_EFFECT', cancel: true })}
              className="mt-4 text-xs text-parchment-100/70 underline disabled:opacity-50"
            >
              Decline this effect
            </button>
          </>
        ) : (
          <p className="mt-4 text-sm text-parchment-100/80">
            Waiting for your opponent to choose.
          </p>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Render it**

`frontend/src/pages/game/GameBoardPage.tsx`, beside the other overlays and gated on `status === 'active'` the same way `BattleOverlay` is:

```tsx
      {isActive && state.pendingEffect && (
        <PendingChoiceDialog
          pending={state.pendingEffect}
          mySide={mySide}
          send={send}
          busy={busy}
        />
      )}
```

- [ ] **Step 4: Verify in the browser**

Play Special Foundries in a live game: the dialog opens with both pools, choosing one draws a card and clears the dialog, and the opponent's board shows the waiting notice while it is open. Then play it again and Decline — the dialog closes and the game unfreezes. Screenshot both for the PR.

- [ ] **Step 5: Build, lint and commit**

```bash
npm --prefix frontend run build
npm --prefix frontend run lint
npx vitest run
git add frontend
git commit -m "feat(game): resolve a suspended card effect from the board"
```

---

# Closing the wave

## Task 16: sync, seed, deploy, verify

**Order matters: apply the seed first, then deploy `game-action`.** The worst case in that gap is a card playing vanilla with a log line; the reverse order can make a card fire the wrong effect.

**Files:** none (deployment).

- [ ] **Step 1: Confirm the tree is clean and green**

```bash
npm run functions:sync
npx vitest run
npx tsc -p tsconfig.json --noEmit
npm --prefix frontend run build
npm --prefix frontend run lint
git status --porcelain
```
Expected: all pass; `functions:sync` produces no uncommitted diff.

- [ ] **Step 2: Secrets audit**

Follow `docs/claude/workflow.md` §3 before pushing. Only the publishable anon key may appear in frontend env.

- [ ] **Step 3: Re-confirm the deploy is safe**

Spec §9.2: deploying code changes games already in progress, because a snapshotted `meta` freezes an effect *name* while the implementation behind it is redeployed for everyone at once. Wave 2 registers nine names that were dormant. Confirm with the owner that there are still no live players (they confirmed on 2026-08-27), then check for in-flight games:

```sql
select id, status, updated_at from games where status = 'active' order by updated_at desc limit 20;
```

- [ ] **Step 4: Apply the seed**

Apply the regenerated `supabase/seed/seed_data.sql` to the remote project via the Supabase MCP tools. Card ids are deterministic, so this is an upsert. Then confirm the three new rows exist:

```sql
select name, faction, material_cost, meta from cards where name in ('Flying Squirrel', 'Martyr', 'Parapet');
```
Expected: three rows, each with `meta` containing `"summonOnly": true`.

- [ ] **Step 5: Deploy `game-action`**

Deploy per `docs/claude/supabase.md`. **Verify by content and boot logs, not by file count** — type-only imports are erased during bundling, so a deployed function always reads back with fewer files than were sent.

- [ ] **Step 6: Smoke-test the two dispatch points live**

The catalog probe change (Task 5) has no unit test, so this is where it is verified. In a real game:

1. Play `Special Foundries`, choose **GT Heavy Airship**, and confirm a heavy airship reaches your hand. An empty catalog would surface as a 400 here.
2. Play `Robotic Assemblers` and confirm the four TG options appear and the chosen card arrives.
3. Deploy `[GT] Hunchback`, activate it, and confirm 1 CP is spent and a card is drawn; confirm a second activation the same turn is refused.

- [ ] **Step 7: Commit anything the deploy changed**

```bash
git status --porcelain
git add -A
git commit -m "chore(deploy): wave 2 seed and game-action"
```

## Task 17: hand the wave off

The handoff prompt is explicit that this part is not optional: everything wave 2 learned dies with this session otherwise, and wave 3 depends directly on `pendingEffect`.

**Files:**
- Modify: `docs/claude/card-effects.md`
- Modify: `docs/claude/architecture.md`
- Modify: `docs/claude/supabase.md`
- Create: the wave 3 handoff prompt (hand to the owner; also commit it under `docs/superpowers/plans/` as `2026-08-27-effect-coverage-wave-3-handoff.md`)

- [ ] **Step 1: Promote the effect-authoring lessons**

`docs/claude/card-effects.md`:
- `choice` and `spawnVehicles` in the primitives table, with the `effect: NAME` idiom and why a factory cannot infer its own registry name.
- The empty-options rule, and Kraken as the reason for it.
- **Spawning is not playing** — a spawned hull runs no `onPlayEffect`, and Sapphire Screen is why.
- `pendingEffect.options` is public; never offer a choice over a hidden hand or deck.
- The `PARTIAL` map beside `KNOWN_GAPS`, and when to use each.

- [ ] **Step 2: Promote the engine lessons**

`docs/claude/architecture.md`:
- `ACTIVATE_VEHICLE` and `activatedOnTurn` under the dispatch points; delete or amend the "Known gaps" entry about `onActivate` having no dispatch point.
- `pendingEffect` in the State highlights, with `PENDING_ACTIONS` and why it is not folded into `battleFrozen`.
- **The snapshot-destructure trap:** `endTurn`'s Temporary cull and `battleResolve`'s death path each strip the per-entry stamps by name, so a new `ZoneCardEntry` field must be added to both or it leaks into `state.destroyed`. TypeScript does not catch this.
- `isSummonOnly`, and the discard rule it protects.

- [ ] **Step 3: Promote the deploy lesson**

`docs/claude/supabase.md`: the catalog probe now has three sources, and a resolving `pendingEffect` is the one with no unit test — it is verified by the live smoke test in the deploy runbook.

- [ ] **Step 4: Write wave 3's handoff prompt**

Same shape as wave 2's. It must contain, at minimum:

- `pendingEffect` **as built**, with a worked example — the real `krakenOnPlay` registration is the clearest one, since it shows the `effect: NAME` idiom, the empty-options path and a `resolve` tail in one place.
- The three summon rows, `meta.summonOnly`, and where it is enforced: `deckValidation`, `drawFromPool`'s catalog branch, `endTurn`'s cull and `battleResolve`'s death path. Wave 3's battle-summon sweep is the fourth exit and is wave 3's to add.
- Every trap wave 2 hit that its own prompt did not warn about. At time of writing that list is: the snapshot-destructure trap in Step 2; G3's `REACHABLE_TRIGGERS` needing a row for any new dispatch point *before* a card can leave `KNOWN_GAPS`; the catalog probe being blind to a spent card; and `[GT] Hunchback` / `[GT] Monsoon` shipping with a completely empty `meta`, so wave 2 had to author their effect names, not just implement them. **Add whatever else actually bit you.**
- `eclipseEffect` in `shared/engine/placement.test.ts` — a wave-3 name used today as an "unimplemented" stand-in, which will silently stop testing anything the moment wave 3 registers it. `ambushEffect` and `sabotageEffect` are the same trap for wave 5.
- The guard's state: `KNOWN_GAPS` at 22, `PARTIAL` holding Plunderer and DWG Waters, and the blind spots that remain open (1 and 2).
- The verification baseline as wave 3 will find it — run `npx vitest run` and quote the real numbers rather than copying wave 2's.

- [ ] **Step 5: Re-file any card that moved between waves**

If wave 2 discovered that a card cannot be built where the spec files it, change its `KNOWN_GAPS` label and say so in the handoff — the way wave 1 re-filed Excalibur from wave 1 to wave 3 rather than shipping it half-wired.

- [ ] **Step 6: Commit and open the PR**

```bash
npx vitest run
git add docs
git commit -m "docs: promote wave 2's lessons and hand off wave 3"
git push -u origin claude/wave2-handoff-prompt-1c4e79
gh pr create --title "Effect coverage wave 2: activated abilities, suspended choices, board spawns" --body-file .git/PR_BODY.md
```

Write `.git/PR_BODY.md` first (it is outside the working tree, so it will not be committed). It must list the nine cards and what each now does, name the five spec departures recorded in §4.2, state the guard's new numbers (`KNOWN_GAPS` 31 → 22, `PARTIAL` opened with two entries), and embed the screenshots from Tasks 14 and 15.

---

## Verification summary

| Check | Command | Expected |
|---|---|---|
| Unit + guard suite | `npx vitest run` | all green; `KNOWN_GAPS` at 22 |
| Shared + seed typecheck | `npx tsc -p tsconfig.json --noEmit` | clean |
| Frontend | `npm --prefix frontend run build` and `run lint` | clean |
| Function sync | `npm run functions:sync` then `git status --porcelain` | no diff |
| Seed regenerated | `npm run seed:build` then `git status --porcelain` | no diff |
| Live | Task 16 Step 6 | three cards behave as printed |
