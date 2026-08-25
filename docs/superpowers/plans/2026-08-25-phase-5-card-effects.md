# Phase 5 — Card Effects & Faction Hero Powers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the shared effect registry into the engine so the 7 old-BE-implemented card effects, `additionalSpawns`, cost modifiers, the three targeting/alert actions, and the DWG/OW/LH faction hero powers all work end to end — with everything else playing as vanilla with a log note.

**Architecture:** A new bottom-layer `shared/effects/registry.ts` holds name→function maps (effects + cost modifiers) with zero engine imports; effect implementations in `shared/effects/dwgEffects.ts` self-register (same side-effect-import pattern as action handlers). The engine gains an injected `EngineContext` (rng, id generator, card catalog) threaded through `applyAction` so effects needing randomness or the card table stay pure and testable. Faction powers extend the existing `USE_HERO_POWER` handler, gated by a new `state.factions` field stamped at game creation.

**Tech Stack:** TypeScript (strict, `.ts`-extension relative imports for Deno), Vitest, Supabase Edge Functions (deploy via MCP `deploy_edge_function`), React 19 frontend.

**Spec:** `docs/superpowers/specs/2026-08-24-ftd-card-game-design.md` — §3.7 keywords, §3.8 hero powers, §3.9 card effects, §5 action vocabulary, §8 testing.

## Global Constraints

- **Run all commands from the repo root** `C:\Users\JFinn\FtDCardGame`. Full test suite: `npx vitest run` (engine/effects tests under `shared/`, drift tests under `supabase/seed/` — all via the ROOT vitest config). Filtered runs use path filters against the root config, e.g. `npx vitest run shared/effects/registry` or `npx vitest run supabase/seed`. NEVER use `--root` (it breaks the include globs and exits green with zero tests). If vitest prints "No test files found", the command is wrong — do not treat it as a pass. Typecheck: `npx tsc -p tsconfig.json --noEmit` (repo root — there is no `shared/tsconfig.json`) and `npm --prefix frontend run build`.
- **Any task that modifies files under `shared/` runs `npm run functions:sync` before committing and includes the synced `supabase/functions/*/shared/` copies in the same commit** — otherwise the drift test in the full suite goes red between tasks.
- **Consumers import `shared/engine/index.ts`** (or `@shared/engine/index`), never `gameEngine.ts` directly — handler/effect registries are empty otherwise. `shared/engine/index.ts` aggregates side-effect imports.
- **`.ts` extensions are REQUIRED** on all relative imports inside `shared/` (Deno compatibility).
- **Cost authority:** `effectiveMaterialCostOf` (static: Half-Cost floor) remains THE authority for base damage, repair, and in-battle resources. The new game-aware `effectiveCostInGame` (adds cost modifiers, clamps ≥ 0) is used ONLY for play-time cost/afford checks — cost modifiers never affect base damage or repairs (matches old BE).
- **Stored `material_cost` is always FULL price**; discounts apply at usage (spec §3.10).
- **Effects fire inside `applyAction`'s structuredClone** — an effect returning `false` rejects the whole action (400) and mutates nothing.
- **All success paths funnel through `applyAction`'s `finish()`** (LOG_MAX_ENTRIES=200 trim). Handlers validate shapes BEFORE mutating.
- **Unimplemented effect names play as vanilla** (spec §3.9): the action succeeds, the effect is skipped, and one log note per unimplemented name is appended **at play time** (not at death/activation time). Effect-name lookups `.trim()` the stored name (two seeded rows carry trailing spaces: `"orbitFlankEffect "`, `"roboticAssemblersEffect "`).
- **Old-BE bugs are NOT ported** (spec §5): assignment-in-`find`, end-turn copying defender cards into attacker zones, abilities never leaving hand, afford-check ignoring modifiers, `additionalCopies`/`additionalSpawns` key mismatch, missing `await` on the Buccaneer lookup, onDeath called with a bare-card signature.
- **The seeded meta key is `additionalSpawns`** (5 cards). The spec's `additionalCopies` wording is amended in Task 12.
- **Tunables live in `shared/gameSettings.ts`** (user requirement: limits easily changeable). New this phase: `ADDITIONAL_SPAWNS_CAP = 10`, `DOUBLE_UP_MAX_COST = 400_000`, `RESERVES_CARD_COUNT = 3`, `CHANGE_ORDER_DELAY_TURNS = 2`.
- **`turnNumber` advances by 0.5 per half-turn**; a player's own turn recurs at +1.0. Materials reset to `floor(turnNumber) * MATERIALS_PER_TURN` at turn start.
- **Every edge-function deploy is preceded by `npm run functions:sync`** (the drift test enforces byte equality). New shared files must be added to `supabase/functions/shared-manifest.json` under `game-action`. Supabase prunes type-only-import files from deploys — expected, not a bug.
- **Supabase project ref `wpgsjnjnvykxavaxibld`**; deploy with MCP `deploy_edge_function` (`verify_jwt: false` — functions do their own auth). Controller (not subagents) runs deploy tasks.
- **Commit trailer:** `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Branch:** all work on `phase-5-card-effects` (created from `main` before Task 1).
- Frontend may compute legality/costs for display only; the server result is authoritative (client refetches on realtime signal).
- **Rulings already made** (do not re-litigate; log-worthy context for reviewers):
  - Temporary despawn at turn start is NOT a death — no `onDeathEffect` fires. Only battle-report destruction triggers death effects.
  - Cost-modifier order matches old BE: `(base + modifier)`, then Half-Cost floor-half, then clamp ≥ 0.
  - The Loggerhead 0-cost copy deals 0 bombardment damage (damage derives from cost) — port as-is.
  - Spawned Buccaneer's keywords are REPLACED with `[scrappy]` (old-BE behavior; guarantees non-Temporary).
  - Double Up validates target: own hand, vehicle, faction DWG, `effectiveMaterialCostOf ≤ DOUBLE_UP_MAX_COST`, not itself.
  - Boarding Party: own ship must be DWG + vehicleType `ship`; enemy target must be vehicleType `ship` in the SAME zone with `effectiveMaterialCostOf(enemy) ≤ effectiveMaterialCostOf(mine)`. Both swapped entries get `playedOnTurn = turnNumber` (1-turn bombardment delay on captured ships) and `movedOnTurn = null`.
  - Change Order: discarded card goes to the `destroyed` pile (graveyard semantics); the delayed draw picks a RANDOM custom (`isBuiltIn === false`) ship-or-tank from that player's deck at the start of their turn `dueTurn = turnNumber + CHANGE_ORDER_DELAY_TURNS`; if none, a fizzle note is logged. Fires once, then the schedule entry is removed.
  - Flyby adds `halfCost` + `temporary` to the chosen hand instance (no duplicates); the buff persists when played.
  - Reserves picks are DISTINCT: shuffle the pool with `ctx.rng`, take the first `RESERVES_CARD_COUNT` (matches the old BE's shuffle-then-shift; fewer than 3 in the pool → take them all).
  - Effect spawns are not "plays": `spawnBuccaneerEffect` ignores Air/Sub Screens (old-BE behavior; the seeded Buccaneer is an AIRSHIP) — pinned by a test.
  - Boarding Party's enemy target is ANY enemy ship (`vehicleType === 'ship'`, no faction check) — the spec's "opponent's faction ships" is read as "the opponent's ships"; §3.8 amended in Task 12.
  - SET_ALERT_CARD is a reveal mechanic only (no ported effect consumes it): own-turn action, ability cards only; cleared when that instance is played or when the owner's turn ends.
  - Faction powers for legacy games (rows without `state.factions`): `normalizeState` defaults factions to `NEUTRAL`, so old games simply get no faction powers.
  - `PLAY_ABILITY_CARD` keeps its Phase-4 name (spec's `PLAY_CARD_WITHOUT_TARGET` — deviation ruled in Phase 4).

## File Structure

- `shared/effects/registry.ts` — NEW: types, name→fn maps, register/lookup, `CATALOG_EFFECTS`, `effectName`, `noteUnimplemented`. Imports only `gameSettings` + types.
- `shared/effects/dwgEffects.ts` — NEW: the 7 ported effects, self-registering.
- `shared/effects/dwgEffects.test.ts`, `shared/effects/registry.test.ts` — NEW tests.
- `shared/engine/engineTypes.ts` — MODIFY: `EngineContext`, new actions, extended `USE_HERO_POWER`.
- `shared/engine/gameInit.ts` — MODIFY: `PublicGameState` gains `factions`, `alertCard`, `scheduled`; `buildInitialGame` gains `factionA`/`factionB`.
- `shared/engine/gameEngine.ts` — MODIFY: ctx threading, `defaultEngineContext`, normalizeState additions, endTurn scheduled-draw + alert expiry.
- `shared/engine/placement.ts` — MODIFY: `effectiveCostInGame`, play-pipeline rewrite, targeting actions, SET_ALERT_CARD.
- `shared/engine/battleResolve.ts` — MODIFY: onDeath dispatch on approve.
- `shared/engine/heroPowers.ts` — MODIFY: faction powers.
- `shared/engine/testFixtures.ts` — MODIFY: `makeCtx`.
- `shared/engine/index.ts` — MODIFY: re-export registry/costs API + side-effect import of `dwgEffects`.
- `shared/gameSettings.ts` — MODIFY: 4 new tunables.
- `supabase/functions/shared-manifest.json`, `supabase/functions/game-action/index.ts`, `supabase/functions/lobby-action/index.ts` — MODIFY (Task 8).
- `frontend/src/pages/game/HandBar.tsx`, `GameBoardPage.tsx`, `BoardZone.tsx`, `MiniVehicle.tsx`, `HeroPowerBar.tsx` — MODIFY (Tasks 9–10). (`useGameActions.ts` needs no change — `send` already types against the extended `GameAction` union.)
- `vitest.config.ts` — MODIFY (Task 1: `passWithNoTests: false` so a bad path filter fails loudly).

---

### Task 1: Engine context, state-shape additions, and the effect registry

**Files:**
- Create: `shared/effects/registry.ts`, `shared/effects/registry.test.ts`
- Modify: `shared/engine/engineTypes.ts`, `shared/engine/gameInit.ts`, `shared/engine/gameEngine.ts`, `shared/engine/testFixtures.ts`, `shared/engine/gameEngine.test.ts` (normalizeState cases), `shared/engine/index.ts`

**Interfaces:**
- Consumes: existing engine (`registerHandler`, `applyAction`, `normalizeState`).
- Produces (later tasks rely on these EXACT names):
  - `EngineContext { rng: () => number; newId: () => string; catalog: SnapshotCard[] }` and `defaultEngineContext(): EngineContext` (rng=`secureRng`, newId=`crypto.randomUUID`, catalog=`[]`).
  - `applyAction(input, actorId, action, ctx?: EngineContext)` — handlers now typed `(game, actor, action, ctx) => ApplyResult`.
  - `PublicGameState` gains: `factions: { a: string; b: string }`, `alertCard: { side: 'a' | 'b'; instanceId: string; name: string; setOnTurn: number } | null`, `scheduled: { type: 'changeOrderDraw'; side: 'a' | 'b'; dueTurn: number }[]`. Use inline `'a' | 'b'` unions in `gameInit.ts` (the file's existing style) — `gameInit.ts` must NOT import from `engineTypes.ts`, because the lobby-action manifest does not carry `engine/engineTypes.ts` and the synced copy would have an unresolvable import.
  - `buildInitialGame` input gains `factionA: string`, `factionB: string` → sets `state.factions`.
  - `normalizeState` defaults: `factions` → `{ a: 'NEUTRAL', b: 'NEUTRAL' }`, `alertCard` → `null`, `scheduled` → `[]`.
  - Registry API: `EffectPayload { game: EngineGame; actor: Side; card: CardInstance; ctx: EngineContext; targetZoneId?: number; targetInstanceId?: string }`, `EffectFn = (p: EffectPayload) => boolean`, `CostModifierFn = (state: PublicGameState, side: Side, card: CardInstance) => number` (typed over `PublicGameState` so the client, which never holds an `EngineGame`, can price cards too), `registerEffect(name, fn)`, `registerCostModifier(name, fn)`, `effectFor(name)`, `costModifierFor(name)`, `isImplemented(name)`, `effectName(card, triggerKey): string | null` (trims; null for missing/blank/non-string), `noteUnimplemented(game, card): void` (one log line per unimplemented effect name in the card's meta across all 9 TRIGGERS keys + `costModifier`), `CATALOG_EFFECTS: Set<string>` (`'reservesEffect'`, `'spawnBuccaneerEffect'`).
  - `testFixtures.makeCtx(over?: Partial<EngineContext>): EngineContext` — deterministic: `rng` cycles `[0.1, 0.5, 0.9]`, `newId` yields `e-0, e-1, …`, `catalog: []`.

- [ ] **Step 1: Write failing registry tests** in `shared/effects/registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  CATALOG_EFFECTS, effectFor, effectName, isImplemented, noteUnimplemented,
  registerEffect,
} from './registry.ts'
import { inst, makeGame } from '../engine/testFixtures.ts'

describe('effect registry', () => {
  it('registers and finds an effect', () => {
    registerEffect('testEffect', () => true)
    expect(isImplemented('testEffect')).toBe(true)
    expect(effectFor('nopeEffect')).toBeNull()
  })
  it('effectName trims stored names and rejects non-strings', () => {
    const card = inst({ meta: { onPlayEffect: 'orbitFlankEffect ', onDeathEffect: 7 } })
    expect(effectName(card, 'onPlayEffect')).toBe('orbitFlankEffect')
    expect(effectName(card, 'onDeathEffect')).toBeNull()
    expect(effectName(card, 'playOnZoneEffect')).toBeNull()
  })
  it('noteUnimplemented logs once per unknown name, skips implemented ones', () => {
    registerEffect('knownEffect', () => true)
    const game = makeGame()
    const card = inst({ name: 'Orbit', meta: { onPlayEffect: 'knownEffect', onActivate: 'mysteryEffect' } })
    noteUnimplemented(game, card)
    expect(game.state.log.filter((l) => l.includes('mysteryEffect'))).toHaveLength(1)
    expect(game.state.log.some((l) => l.includes('knownEffect'))).toBe(false)
  })
  it('exposes the catalog-requiring set', () => {
    expect(CATALOG_EFFECTS.has('reservesEffect')).toBe(true)
    expect(CATALOG_EFFECTS.has('spawnBuccaneerEffect')).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run shared/effects/registry` → FAIL (module not found).

- [ ] **Step 3: Implement.** `shared/effects/registry.ts`:

```ts
import { TRIGGERS } from '../gameSettings.ts'
import type { EngineContext, EngineGame, Side } from '../engine/engineTypes.ts'
import type { CardInstance, PublicGameState } from '../engine/gameInit.ts'

export interface EffectPayload {
  game: EngineGame
  actor: Side
  card: CardInstance
  ctx: EngineContext
  targetZoneId?: number
  targetInstanceId?: string
}
export type EffectFn = (payload: EffectPayload) => boolean
export type CostModifierFn = (state: PublicGameState, side: Side, card: CardInstance) => number

const effects = new Map<string, EffectFn>()
const costModifiers = new Map<string, CostModifierFn>()

// Effects that need the built-in card catalog supplied via EngineContext.
export const CATALOG_EFFECTS = new Set(['reservesEffect', 'spawnBuccaneerEffect'])

export function registerEffect(name: string, fn: EffectFn): void { effects.set(name, fn) }
export function registerCostModifier(name: string, fn: CostModifierFn): void { costModifiers.set(name, fn) }
export const effectFor = (name: string): EffectFn | null => effects.get(name) ?? null
export const costModifierFor = (name: string): CostModifierFn | null => costModifiers.get(name) ?? null
export const isImplemented = (name: string): boolean => effects.has(name) || costModifiers.has(name)

// Two seeded rows carry trailing spaces in their effect names — trim on read.
export function effectName(card: { meta: Record<string, unknown> }, triggerKey: string): string | null {
  const raw = card.meta[triggerKey]
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed === '' ? null : trimmed
}

const ALL_META_KEYS = [...Object.values(TRIGGERS), 'costModifier']

// Spec §3.9: cards referencing unimplemented effects play as vanilla, with a
// note appended to the game log at play time.
export function noteUnimplemented(game: EngineGame, card: CardInstance): void {
  for (const key of ALL_META_KEYS) {
    const name = effectName(card, key)
    if (name !== null && !isImplemented(name)) {
      game.state.log.push(`${card.name}: effect "${name}" is not implemented yet — plays as vanilla`)
    }
  }
}
```

- [ ] **Step 4: Write failing engine-context/state tests.** Append to `shared/engine/gameEngine.test.ts`:

```ts
describe('phase 5 state shape', () => {
  it('normalizeState defaults factions, alertCard, and scheduled', () => {
    const game = makeGame()
    const s = game.state as unknown as Record<string, unknown>
    delete s.factions; delete s.alertCard; delete s.scheduled
    normalizeState(game.state)
    expect(game.state.factions).toEqual({ a: 'NEUTRAL', b: 'NEUTRAL' })
    expect(game.state.alertCard).toBeNull()
    expect(game.state.scheduled).toEqual([])
  })
  it('applyAction runs with a default context when none is given', () => {
    const game = makeGame()
    const result = applyAction(game, 'alice', { type: 'END_TURN' })
    expect(result.ok).toBe(true)
  })
})
```

And in the gameInit test file (or alongside), assert `buildInitialGame` stamps factions:

```ts
it('buildInitialGame records both deck factions', () => {
  const built = buildInitialGame({ /* existing fixture args */ factionA: 'DWG', factionB: 'OW', /* ... */ })
  expect(built.game.state.factions).toEqual({ a: 'DWG', b: 'OW' })
})
```

- [ ] **Step 5: Run to verify failures**, then implement:
  - `engineTypes.ts`: add `EngineContext` (import `SnapshotCard` type), extend nothing else yet.
  - `gameInit.ts`: add the three fields to `PublicGameState`; `buildInitialGame` input gains `factionA: string; factionB: string`; initial state sets `factions: { a: input.factionA, b: input.factionB }, alertCard: null, scheduled: []`.
  - `gameEngine.ts`: `defaultEngineContext()` (import `secureRng`); `applyAction(input, actorId, action, ctx: EngineContext = defaultEngineContext())`; `Handler` type gains `ctx` 4th param; pass ctx to `endTurn` and handlers; `normalizeState` gains the three defaults.
  - Update the `Handler` type to four parameters. Existing 3-param handler callbacks remain assignable (TS allows shorter parameter lists), so only handlers that actually USE `ctx` need signature changes. (The root tsconfig sets only `strict` — there is no `noUnusedLocals`.)
  - `testFixtures.ts`: add `makeCtx` exactly as specified in Interfaces. `makeGame` state gains `factions: { a: 'DWG', b: 'OW' }, alertCard: null, scheduled: []` (DWG/OW so faction-power tests read naturally).
  - `index.ts`: re-export `* from '../effects/registry.ts'` — no side-effect import yet (no implementations exist until Task 3).

- [ ] **Step 6: Full run** — set `passWithNoTests: false` in `vitest.config.ts`; run `npm run functions:sync` (drift test stays green); `npx vitest run` all green (every existing test + the new ones), `npx tsc -p tsconfig.json --noEmit` clean, `npm --prefix frontend run build` clean (PublicGameState additions are additive; fix any exhaustive-type fallout).

- [ ] **Step 7: Commit** — `feat(effects): engine context, registry, and faction-aware state`

### Task 2: Game-aware cost authority

**Files:**
- Modify: `shared/engine/placement.ts`, `shared/gameSettings.ts`
- Test: `shared/engine/placement.test.ts` (append)

**Interfaces:**
- Consumes: `costModifierFor`, `effectName` (Task 1), `effectiveMaterialCostOf` (existing).
- Produces: `effectiveCostInGame(state: PublicGameState, side: Side, card: CardInstance): number` exported from `placement.ts` (re-exported via `engine/index.ts`) — typed over `PublicGameState` so the frontend can call it with the fetched state directly; `canAfford(state, side, card)` KEEPS its signature but `PLAY_*` handlers switch to an internal modifier-aware check (pass `game.state`); `pay` uses `effectiveCostInGame`. New tunables in `gameSettings.ts`: `ADDITIONAL_SPAWNS_CAP = 10`, `DOUBLE_UP_MAX_COST = 400_000`, `RESERVES_CARD_COUNT = 3`, `CHANGE_ORDER_DELAY_TURNS = 2`.

- [ ] **Step 1: Write failing tests** (register a throwaway modifier in the test):

```ts
import { registerCostModifier } from '../effects/registry.ts'

describe('effectiveCostInGame', () => {
  it('applies a registered cost modifier before the Half-Cost halving, clamping at 0', () => {
    registerCostModifier('testDiscount', () => -30_000)
    const state = makeGame().state
    const plain = inst({ materialCost: 100_000, meta: { costModifier: 'testDiscount' } })
    const halved = inst({ materialCost: 100_000, keywords: ['halfCost'], meta: { costModifier: 'testDiscount' } })
    const cheap = inst({ materialCost: 10_000, meta: { costModifier: 'testDiscount' } })
    expect(effectiveCostInGame(state, 'a', plain)).toBe(70_000)
    expect(effectiveCostInGame(state, 'a', halved)).toBe(35_000)   // (100k−30k)/2
    expect(effectiveCostInGame(state, 'a', cheap)).toBe(0)          // clamped
  })
  it('ignores unimplemented modifier names', () => {
    const card = inst({ materialCost: 50_000, meta: { costModifier: 'mysteryModifier' } })
    expect(effectiveCostInGame(makeGame().state, 'a', card)).toBe(50_000)
  })
})
```

- [ ] **Step 2: Run to verify failure**, then implement in `placement.ts`:

```ts
import { costModifierFor, effectName } from '../effects/registry.ts'

// Play-time cost: (base + registered modifier), Half-Cost halving, clamp ≥ 0.
// Base damage, repairs, and in-battle resources keep using
// effectiveMaterialCostOf — modifiers are a play-time-only mechanic.
export function effectiveCostInGame(state: PublicGameState, side: Side, card: CardInstance): number {
  const name = effectName(card, 'costModifier')
  const fn = name !== null ? costModifierFor(name) : null
  const modified = card.materialCost + (fn ? fn(state, side, card) : 0)
  return Math.max(0, effectiveMaterialCostOf({ ...card, materialCost: modified }))
}
```

Switch the two play handlers' afford checks and `pay` to `effectiveCostInGame` (a private `canAffordInGame(game, side, card)` helper mirroring `canAfford`). Add the 4 tunables to `gameSettings.ts`.

- [ ] **Step 3: Run** placement tests + full suite green. **Commit** — `feat(effects): game-aware play cost with modifier support`

### Task 3: The DWG effect pack (registry-level)

**Files:**
- Create: `shared/effects/dwgEffects.ts`, `shared/effects/dwgEffects.test.ts`
- Modify: `shared/engine/index.ts` (side-effect import)

**Interfaces:**
- Consumes: registry (Task 1), `drawCard` (gameEngine), `effectiveMaterialCostOf` (placement), `zoneById` (gameEngine), tunables (Task 2), `KEYWORDS` from gameSettings.
- Produces: registered names `marauderOnPlay`, `crossbonesOnPlay`, `plundererCostModifier`, `loggerheadOnDeath`, `reservesEffect`, `spawnBuccaneerEffect`, `doubleUpEffect`. Effects mutate `payload.game` and return `true`, or return `false` (invalid → action rejected). `shared/engine/index.ts` adds `import '../effects/dwgEffects.ts'`.

- [ ] **Step 1: Write failing tests** — call effects directly via `effectFor(name)!(payload)` with `makeGame`/`makeCtx`. Cover:

```ts
// marauderOnPlay / crossbonesOnPlay: hand +1 from deck, cp +1, counts synced, returns true
// plundererCostModifier: -20_000 per own-side DWG vehicle across all zones (counts type==='vehicle' && faction==='DWG' only)
// loggerheadOnDeath: deck gains a copy with materialCost 0 and a fresh ctx.newId() instanceId; deck shuffled via ctx.rng; counts synced
// reservesEffect: with makeCtx({catalog: [4+ DWG vehicle snaps + 1 OW snap + 1 DWG ability snap]}) hand gains RESERVES_CARD_COUNT built-in DWG vehicles with fresh instanceIds AND all-distinct cardIds; returns false when catalog has no DWG vehicles
// spawnBuccaneerEffect: with catalog containing snap({name: 'Buccaneer', vehicleType: 'airship'}), pushes a zone entry to payload.targetZoneId on actor side with keywords exactly ['scrappy'], playedOnTurn = game.turnNumber, movedOnTurn null; returns false when targetZoneId missing/bad or Buccaneer absent from catalog; ALSO succeeds when the target zone holds an enemy Air Screen vehicle (effect spawns ignore screens — ruled in Global Constraints)
// doubleUpEffect: with targetInstanceId of an own-hand DWG vehicle ≤ DOUBLE_UP_MAX_COST (effective cost), increments target.meta.additionalSpawns (1 on first use, 2 on second); returns false for: missing target, non-vehicle, non-DWG, too expensive, targeting itself
```

Example (write ALL of the above as real tests in this style):

```ts
it('marauderOnPlay draws a card and grants 1 CP', () => {
  const game = makeGame()
  game.privates.a.deck.push(inst({ name: 'Deck Top' }))
  game.state.counts.a.deck = 1
  const ok = effectFor('marauderOnPlay')!({ game, actor: 'a', card: inst(), ctx: makeCtx() })
  expect(ok).toBe(true)
  expect(game.privates.a.hand.map((c) => c.name)).toContain('Deck Top')
  expect(game.state.resources.a.cp).toBe(4)
})
```

- [ ] **Step 2: Run to verify failure**, then implement `shared/effects/dwgEffects.ts`:

```ts
import { DOUBLE_UP_MAX_COST, KEYWORDS, RESERVES_CARD_COUNT } from '../gameSettings.ts'
import type { ZoneCardEntry } from '../engine/engineTypes.ts'
import { drawCard, zoneById } from '../engine/gameEngine.ts'
import { effectiveMaterialCostOf } from '../engine/placement.ts'
import { registerCostModifier, registerEffect } from './registry.ts'
import type { EffectPayload } from './registry.ts'

// draw a card and gain 1 CP (Marauder / Crossbones)
const drawPlusCp = ({ game, actor }: EffectPayload): boolean => {
  drawCard(game, actor)
  game.state.resources[actor].cp += 1
  return true
}
registerEffect('marauderOnPlay', drawPlusCp)
registerEffect('crossbonesOnPlay', drawPlusCp)

// cost -20k per friendly DWG vehicle on the field (Plunderer)
registerCostModifier('plundererCostModifier', (state, side) => {
  let count = 0
  for (const zone of state.zones) {
    count += zone.cards[side].filter((c) => c.type === 'vehicle' && c.faction === 'DWG').length
  }
  return count * -20_000
})

// shuffle a 0-cost copy into its owner's deck (Loggerhead, on death)
registerEffect('loggerheadOnDeath', ({ game, actor, card, ctx }) => {
  const deck = game.privates[actor].deck
  // card arrives as a ZoneCardEntry at death — strip the zone stamps so the
  // deck copy is a clean CardInstance
  const { playedOnTurn: _p, movedOnTurn: _m, ...snapshot } = card as ZoneCardEntry
  deck.push({ ...snapshot, instanceId: ctx.newId(), materialCost: 0 })
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.rng() * (i + 1))
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  game.state.counts[actor].deck = deck.length
  game.state.log.push(`${card.name} leaves a free copy in the deck`)
  return true
})

// add RESERVES_CARD_COUNT distinct random built-in DWG vehicles to hand
// (Reserves — old BE shuffles the pool and shifts, so picks never repeat)
registerEffect('reservesEffect', ({ game, actor, ctx }) => {
  const pool = ctx.catalog.filter((c) => c.isBuiltIn && c.faction === 'DWG' && c.type === 'vehicle')
  if (pool.length === 0) return false
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.rng() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  for (const pick of pool.slice(0, RESERVES_CARD_COUNT)) {
    game.privates[actor].hand.push({ ...pick, instanceId: ctx.newId() })
  }
  game.state.counts[actor].hand = game.privates[actor].hand.length
  return true
})

// spawn a Scrappy, non-Temporary Buccaneer into the target zone (Spawn Buccaneer)
registerEffect('spawnBuccaneerEffect', ({ game, actor, ctx, targetZoneId }) => {
  if (typeof targetZoneId !== 'number') return false
  const zone = zoneById(game.state, targetZoneId)
  const buccaneer = ctx.catalog.find((c) => c.isBuiltIn && c.name === 'Buccaneer')
  if (!zone || !buccaneer) return false
  const entry: ZoneCardEntry = {
    ...buccaneer, instanceId: ctx.newId(), keywords: [KEYWORDS.SCRAPPY],
    playedOnTurn: game.turnNumber, movedOnTurn: null,
  }
  zone.cards[actor].push(entry)
  game.state.log.push(`A Buccaneer joins zone ${zone.id} (Scrappy)`)
  return true
})

// target DWG vehicle card in hand spawns an extra copy when played (Double Up)
registerEffect('doubleUpEffect', ({ game, actor, card, targetInstanceId }) => {
  if (typeof targetInstanceId !== 'string' || targetInstanceId === card.instanceId) return false
  const target = game.privates[actor].hand.find((c) => c.instanceId === targetInstanceId)
  if (!target || target.type !== 'vehicle' || target.faction !== 'DWG') return false
  if (effectiveMaterialCostOf(target) > DOUBLE_UP_MAX_COST) return false
  const current = typeof target.meta.additionalSpawns === 'number' ? target.meta.additionalSpawns : 0
  target.meta = { ...target.meta, additionalSpawns: current + 1 }
  return true
})
```

- [ ] **Step 3: Run** — new tests green, full suite green, tsc clean. **Commit** — `feat(effects): port the seven implemented DWG effects`

### Task 4: Play-pipeline rewrite (trigger dispatch + additionalSpawns)

**Files:**
- Modify: `shared/engine/placement.ts`
- Test: `shared/engine/placement.test.ts` (append)

**Interfaces:**
- Consumes: registry (`effectFor`, `effectName`, `noteUnimplemented`), Tasks 1–3.
- Produces: `PLAY_CARD_TO_ZONE` handles vehicles AND zone-targeted abilities; `PLAY_ABILITY_CARD` rejects cards needing targets; both dispatch effects. Later tasks rely on the private helper `resolvePlayEffects(game, actor, card, ctx, targets): ApplyResult | null` (returns an error result on effect failure, null on success) — reused by Task 5's targeting handlers.

**Pipeline order (both play paths):** validate (in hand → correct type/meta for the action → afford via `effectiveCostInGame` → zone legality for vehicles) → clear `alertCard` if it references this instance (wired fully in Task 6; leave a `// alert cleared in Task 6` seam only if Task 6 hasn't landed — otherwise implement here defensively: `if (game.state.alertCard?.instanceId === action.instanceId) game.state.alertCard = null` guarded by `game.state.alertCard != null`) → take from hand → pay → vehicles: push entry + `additionalSpawns` copies → dispatch `playOnZoneEffect` (if meta key present, with `targetZoneId`) → dispatch `onPlayEffect` → `noteUnimplemented(game, card)` → log the play.

**additionalSpawns:** `const extra = Math.min(Math.max(0, Math.floor(Number(card.meta.additionalSpawns) || 0)), ADDITIONAL_SPAWNS_CAP)`; each copy is `{ ...card, instanceId: ctx.newId(), playedOnTurn: game.turnNumber, movedOnTurn: null }` pushed to the same zone. One cost, N+1 hulls (spec §3.9).

**Effect failure:** an implemented effect returning `false` → `err(400, \`${card.name}'s effect could not resolve — check its target\`)`; the clone is discarded so nothing (including payment) sticks.

- [ ] **Step 1: Write failing tests:**

```ts
// vehicle with additionalSpawns: 2 lands 3 entries in the zone, all playedOnTurn === turnNumber, distinct instanceIds, cost paid ONCE
// vehicle with meta additionalSpawns: 99 spawns ADDITIONAL_SPAWNS_CAP extras; meta 'x'/-3 spawns none
// vehicle with onPlayEffect marauderOnPlay (via full applyAction): draws + grants CP after deploy
// PLAY_ABILITY_CARD rejects ANY target-needing ability with 400 'needs a target': one test each for meta playOnZoneEffect, playOnVehicleEffect, and playOnCardEffect (use Double Up's real meta {playOnCardEffect: 'doubleUpEffect'} — hand and materials must be untouched after the rejection)
// ability with unimplemented playOnZoneEffect 'ambushEffect' played to zone 1: succeeds, no entry added, vanilla note in log
// vehicle with unimplemented onActivate 'eclipseEffect': deploys fine with vanilla note; NO note again later
// implemented effect returning false rejects atomically: doubleUp-style failing effect → 400 and hand/materials untouched
// PLAY_CARD_TO_ZONE ability branch requires meta playOnZoneEffect; plain ability → 400 'played without a zone'... (keep existing vehicle-only msg for vehicles)
```

Write each as a real test using `makeGame` + `applyAction(game, 'alice', {...}, makeCtx())`.

- [ ] **Step 2: Run to verify failures**, then rewrite the two handlers in `placement.ts`. Ability-to-zone branch: type `'ability'` + `effectName(card, 'playOnZoneEffect') !== null` required; NO zone-legality check (any zone); no entry pushed. Vehicle branch keeps biome/screen checks. `PLAY_ABILITY_CARD` returns `err(400, \`${card.name} needs a target\`)` when `effectName(card, k) !== null` for ANY k of `'playOnZoneEffect' | 'playOnVehicleEffect' | 'playOnCardEffect'` — implemented or not, those cards must go through their targeting action. Both play paths end with the dispatch helper:

```ts
function resolvePlayEffects(
  game: EngineGame, actor: Side, card: CardInstance, ctx: EngineContext,
  targets: { targetZoneId?: number; targetInstanceId?: string },
): ApplyResult | null {
  for (const key of ['playOnZoneEffect', 'onPlayEffect'] as const) {
    const name = effectName(card, key)
    if (name === null) continue
    const fn = effectFor(name)
    if (fn && !fn({ game, actor, card, ctx, ...targets })) {
      return err(400, `${card.name}'s effect could not resolve — check its target`)
    }
  }
  noteUnimplemented(game, card)
  return null
}
```

- [ ] **Step 3: Run** — all green, tsc clean, frontend build clean (HandBar's ability confirm still compiles). **Commit** — `feat(engine): effect dispatch and extra spawns in the play pipeline`

### Task 5: Targeting actions (on-field / in-hand)

**Files:**
- Modify: `shared/engine/engineTypes.ts` (GameAction union), `shared/engine/placement.ts`
- Test: `shared/engine/placement.test.ts` (append)

**Interfaces:**
- Consumes: `resolvePlayEffects` seam pattern (Task 4), `findVehicle` (gameEngine), registry.
- Produces: new actions
  - `{ type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD'; instanceId: string; targetInstanceId: string }` — ability + meta `playOnVehicleEffect` required; target must exist on the field (either side, via `findVehicle`); dispatches `playOnVehicleEffect` (all seeded ones unimplemented → vanilla note) then `onPlayEffect`.
  - `{ type: 'PLAY_CARD_TARGETING_CARD_IN_HAND'; instanceId: string; targetInstanceId: string }` — ability + meta `playOnCardEffect` required; target must be a DIFFERENT card in the actor's own hand **validated before pay** (the effect re-validates specifics); dispatches `playOnCardEffect` then `onPlayEffect`.
  Both: `typeof action.targetInstanceId !== 'string'` → 400 before any mutation; afford via `effectiveCostInGame`; card leaves hand; pay; effects; `noteUnimplemented`; log.
  Extend `resolvePlayEffects`'s key list per-action (pass the trigger keys to run): change its signature to `resolvePlayEffects(game, actor, card, ctx, targets, keys: string[])` and update Task 4's call sites to pass `['playOnZoneEffect', 'onPlayEffect']`.

- [ ] **Step 1: Write failing tests:**

```ts
// Double Up end-to-end via applyAction: ability card meta {playOnCardEffect: 'doubleUpEffect'}, target DWG vehicle 100k in hand → success, target.meta.additionalSpawns === 1, Double Up left the hand, cost paid
// then playing the buffed vehicle spawns 2 entries
// Double Up on an 800k target → 400, nothing spent, additionalSpawns unset
// ON_FIELD with unimplemented 'sabotageEffect' targeting an enemy vehicle on the field → success + vanilla note; targeting a nonexistent instanceId → 400
// ON_FIELD/IN_HAND on a card lacking the matching meta key → 400
// IN_HAND target === the played card itself → 400 (self-target)
// missing targetInstanceId (undefined / number) → 400
```

- [ ] **Step 2: Run to verify failures**, implement the two handlers (registered in `placement.ts` beside the other play handlers), refactor `resolvePlayEffects` to take `keys`.

- [ ] **Step 3: Run** — green, tsc, frontend build. **Commit** — `feat(engine): targeted ability plays (on-field and in-hand)`

### Task 6: Death triggers and the alert card

**Files:**
- Modify: `shared/engine/battleResolve.ts`, `shared/engine/gameEngine.ts` (endTurn alert expiry), `shared/engine/placement.ts` (alert-clear on play — confirm the Task 4 seam is real code), `shared/engine/engineTypes.ts` (SET_ALERT_CARD action)
- Test: `shared/engine/battleResolve.test.ts`, `shared/engine/gameEngine.test.ts` (append)

**Interfaces:**
- Consumes: registry, ctx threading.
- Produces:
  - `DECIDE_BATTLE_REPORT` approve path: after the destruction loop, for each destroyed entry with an IMPLEMENTED `onDeathEffect`, call it with `{ game, actor: <owner side>, card: entry, ctx }`; a `false` return does NOT reject the report (the battle already happened) — log `<name>'s death effect could not resolve` instead. Unimplemented names: silently skipped (their vanilla note already appeared at play).
  - `{ type: 'SET_ALERT_CARD'; instanceId: string }` action (normal turn-gated action — NOT in BATTLE_ACTIONS/OFF_TURN_ACTIONS): card must be in the actor's hand and `type === 'ability'`; sets `state.alertCard = { side: actor, instanceId, name: card.name, setOnTurn: game.turnNumber }`. Single global slot, one rule: if your OWN alert is already up, the new one REPLACES it (re-reveal); if the OPPONENT's alert is up → 409 `'An alert card is already revealed'`. Register the handler in `placement.ts` beside the other play handlers. Log `Player X reveals <name> — effect in progress`.
  - Alert expiry: in `endTurn`, if `state.alertCard?.side` is the side whose turn is ENDING (the pre-switch active side), clear it with a log note. Alert clear on play: every play handler (zone/ability/targeting) clears `alertCard` when `alertCard.instanceId === action.instanceId` before dispatching effects.

- [ ] **Step 1: Write failing tests:**

```ts
// Loggerhead integration: zone entry with meta {onDeathEffect: 'loggerheadOnDeath'} destroyed via SUBMIT (hp 40) + DECIDE approve → destroyed snapshot present AND owner's deck contains a 0-cost copy, counts updated
// destroyed entry with unimplemented onDeathEffect 'conduitEffect' → approve succeeds, no extra log line about conduitEffect
// SET_ALERT_CARD happy path + log; vehicle card → 400; opponent's alert up → 409; own alert replaced
// alert clears when the revealed instance is played (PLAY_ABILITY_CARD path)
// alert clears at the owner's END_TURN (and NOT at the opponent's)
```

- [ ] **Step 2: Run to verify failures**, implement. `battleResolve.ts` DECIDE handler signature gains `ctx`; death dispatch after the destruction loop using the captured `participants` map (the entry + side are already in scope).

- [ ] **Step 3: Run** — green, tsc, frontend build. **Commit** — `feat(engine): death effects on report approval and the alert card`

### Task 7: Faction hero powers

**Files:**
- Modify: `shared/engine/heroPowers.ts`, `shared/engine/engineTypes.ts` (power union + `targetInstanceId`), `shared/engine/gameEngine.ts` (endTurn scheduled processing)
- Test: `shared/engine/heroPowers.test.ts` (append)

**Interfaces:**
- Consumes: `state.factions`, `state.scheduled`, ctx, `effectiveMaterialCostOf`, `CHANGE_ORDER_DELAY_TURNS`.
- Produces: `USE_HERO_POWER` power union extended to `'salvage' | 'tacticalPositioning' | 'draw' | 'rapidRedeployment' | 'boardingParty' | 'changeOrder' | 'flyby'`; action gains optional `targetInstanceId?: string` (boardingParty's enemy ship). Faction gate: `const FACTION_POWERS: Record<string, string> = { boardingParty: 'DWG', changeOrder: 'OW', flyby: 'LH' }` — using one whose faction ≠ `game.state.factions[actor]` → 403 `'That power belongs to another faction'`. All three are own-turn, non-frozen powers (existing else-branch), once per game via `usedHeroPowers`, 1 CP.
  - **boardingParty** `{ power, instanceId, targetInstanceId }`: `findVehicle` both; mine → side===actor, `faction === 'DWG'`, `vehicleType === 'ship'`; theirs → side===otherSide(actor), `vehicleType === 'ship'` (ANY faction — ruled in Global Constraints, §3.8 amended in Task 12), SAME `zone.id`, `effectiveMaterialCostOf(theirs) <= effectiveMaterialCostOf(mine)`. Swap: remove each from its side array, push `{ ...entry, playedOnTurn: game.turnNumber, movedOnTurn: null }` onto the opposite side's array in that zone. Log `Boarding Party: <mine> traded for <theirs>`.
  - **changeOrder** `{ power, instanceId }`: hand card with `faction === 'OW'` and `type === 'vehicle'` required; remove from hand → sync `state.counts[actor].hand` → push its snapshot (strip `instanceId`/stamps) onto `state.destroyed[actor]`; push `{ type: 'changeOrderDraw', side: actor, dueTurn: game.turnNumber + CHANGE_ORDER_DELAY_TURNS }` onto `state.scheduled`; log.
  - **flyby** `{ power, instanceId }`: hand card with `faction === 'LH'` and `type === 'vehicle'` required; add `KEYWORDS.HALF_COST` and `KEYWORDS.TEMPORARY` to its `keywords` if absent; log.
  - **endTurn scheduled processing** (in `gameEngine.ts`, after the draw + materials reset for the incoming side): for each `scheduled` item with `item.side === incomingSide && game.turnNumber >= item.dueTurn`: pool = that side's deck cards where `isBuiltIn === false && (vehicleType === 'ship' || vehicleType === 'tank')`; if empty → log `Change Order finds no player-made ship or tank`; else pick `pool[Math.floor(ctx.rng() * pool.length)]`, move it deck→hand, sync counts, log `Change Order delivers <name>`. Remove processed items from `scheduled` either way.

- [ ] **Step 1: Write failing tests:**

```ts
// faction gate: DWG player (state.factions.a === 'DWG') uses flyby → 403; uses boardingParty → proceeds to validation
// boardingParty happy path: swap occurs, both entries re-stamped playedOnTurn = turnNumber, cp -1, usedHeroPowers includes 'boardingParty'
// boardingParty rejects: non-ship mine, enemy in a different zone, enemy costlier than mine (effective costs), missing targetInstanceId
// changeOrder: OW vehicle leaves hand into destroyed[], state.counts hand count decremented, scheduled entry with dueTurn = turnNumber + CHANGE_ORDER_DELAY_TURNS; non-OW / ability card → 400
// changeOrder delivery: schedule an entry due now for the incoming side, deck holds a custom tank (isBuiltIn: false) + a built-in ship → END_TURN moves the custom tank to hand, scheduled emptied
// changeOrder fizzle: no custom ship/tank in deck → log note, scheduled emptied, no draw
// flyby: LH vehicle in hand gains halfCost + temporary exactly once (idempotent keywords), later PLAY costs half
// all three: once per game + 1 CP enforced (existing loop covers — add one regression test for boardingParty reuse → 400)
```

- [ ] **Step 2: Run to verify failures**, implement. `endTurn` already receives `ctx` (Task 1).

- [ ] **Step 3: Run** — green, tsc, frontend build. **Commit** — `feat(engine): DWG, OW, and LH faction hero powers`

### Task 8: Server deploy — game-action v3 + lobby-action v8 (CONTROLLER-RUN)

**Files:**
- Modify: `supabase/functions/game-action/index.ts`, `supabase/functions/lobby-action/index.ts`, `supabase/functions/shared-manifest.json`
- Test: `supabase/seed/functionSharedSync.test.ts` (drift test auto-covers new manifest entries; run it)

**Interfaces:**
- Consumes: `CATALOG_EFFECTS`, `snapshotCard`, `secureRng`, `defaultEngineContext` shape.
- Produces: deployed game-action v3 and lobby-action v8.

- [ ] **Step 1: Manifest.** Add to the `game-action` list: `"effects/registry.ts"`, `"effects/dwgEffects.ts"` (paths are relative to `shared/`; the sync script already handles subdirectories).

- [ ] **Step 2: lobby-action** — thread factions into `buildInitialGame` (the deck rows are in scope at the call site):

```ts
const built = buildInitialGame({
  // ...existing args unchanged...
  factionA: String(hostDeck.faction),
  factionB: String(guestDeck.faction),
  // ...
})
```

- [ ] **Step 3: game-action** — build the context after loading privates, before `applyAction`:

```ts
import { CATALOG_EFFECTS } from './shared/effects/registry.ts'
import { secureRng, snapshotCard } from './shared/engine/gameInit.ts'
import type { SnapshotCard } from './shared/engine/gameInit.ts'

// Load the built-in card catalog only when the played card's meta references
// an effect that needs it (reservesEffect / spawnBuccaneerEffect).
let catalog: SnapshotCard[] = []
const played = 'instanceId' in (action as Record<string, unknown>)
  ? [...engineGame.privates.a.hand, ...engineGame.privates.b.hand]
      .find((c) => c.instanceId === (action as { instanceId?: unknown }).instanceId)
  : undefined
const needsCatalog = played !== undefined && Object.values(played.meta).some(
  (v) => typeof v === 'string' && CATALOG_EFFECTS.has(v.trim()),
)
if (needsCatalog) {
  const { data: cardRows } = await admin.from('cards').select('*').eq('is_built_in', true)
  catalog = (cardRows ?? []).map(snapshotCard)
}
const ctx = { rng: secureRng, newId: () => crypto.randomUUID(), catalog }
// ...
result = applyAction(engineGame, userId, action, ctx)
```

- [ ] **Step 4:** `npm run functions:sync` → `npx vitest run supabase/seed` (drift test green) → full `npx vitest run` green → `npx tsc -p tsconfig.json --noEmit`.

- [ ] **Step 5: Deploy** via MCP `deploy_edge_function` (project `wpgsjnjnvykxavaxibld`): `game-action` (all files incl. the two new `shared/effects/*` files), then `lobby-action`. Verify with `list_edge_functions` (game-action v3, lobby-action v8) and `get_advisors` (no NEW warnings beyond the 3 known by-design ones).

- [ ] **Step 6: Commit** — `feat(server): deploy effect-aware game-action v3 and faction-stamping lobby-action v8`

### Task 9: Board UI — targeted ability plays and the alert banner

**Files:**
- Modify: `frontend/src/pages/game/HandBar.tsx`, `frontend/src/pages/game/GameBoardPage.tsx`, `frontend/src/pages/game/BoardZone.tsx`, `frontend/src/pages/game/MiniVehicle.tsx`

**Interfaces:**
- Consumes: new actions + `effectiveCostInGame` from `@shared/engine/index`; `effectName` from the same barrel.
- Produces: GameBoardPage owns two new modes alongside `placingCard`/`moveMode`:
  - `fieldTargeting: CardInstance | null` — an ability with `playOnVehicleEffect` was clicked; every MiniVehicle becomes clickable; clicking one sends `PLAY_CARD_TARGETING_CARD_ON_FIELD`.
  - HandBar-internal `handTargeting: CardInstance | null` — an ability with `playOnCardEffect` was clicked; other hand cards get a "Target" button; clicking sends `PLAY_CARD_TARGETING_CARD_IN_HAND`.
  Behavior map for an ability card's Play click (check meta keys in this order): `playOnZoneEffect` → enter `placingCard` mode with ALL zones highlighted (GameBoardPage's zone-highlight logic: vehicles use `legalZonesFor`, abilities highlight every zone) and send `PLAY_CARD_TO_ZONE` on zone click; `playOnVehicleEffect` → `fieldTargeting`; `playOnCardEffect` → `handTargeting`; otherwise → `PLAY_ABILITY_CARD` directly (drop the Phase-5 confirm dialog entirely — effects are real now; keep a plain confirm only for cards with NO meta effects: "Play <name>? It has no effect — this only spends the card.").
  - Alert: each ability card in hand gets a small secondary "Reveal" button sending `SET_ALERT_CARD`; GameBoardPage shows a banner whenever `state.alertCard` is set: `⚠ <name> revealed by <you|opponent> — effect in progress`.
  - Cost displays in HandBar switch `effectiveMaterialCostOf` → `effectiveCostInGame(state, mySide, c)` for the Play button + afford dimming, keeping the strikethrough badge when the effective price differs from `materialCost`. (`effectiveCostInGame` is typed over `PublicGameState` — HandBar already receives `state`; no new props needed.)
- Mode exclusivity: entering any of placing/fieldTargeting/handTargeting/moveMode cancels the others (single `cancelAllModes()` helper in GameBoardPage).

- [ ] **Step 1:** Implement (component-level; the project has no frontend test harness for board pages — manual + E2E cover it; keep changes typechecked).
- [ ] **Step 2:** `npm --prefix frontend run build` clean; full `npx vitest run` still green.
- [ ] **Step 3:** Visual smoke via dev server preview: hand shows Reveal buttons on abilities; clicking a `playOnZoneEffect` ability highlights all three zones. (No login flow for agents — use component inspection/read_page on the login screen only if signed-out state blocks; otherwise rely on typecheck + Task 11's live E2E.)
- [ ] **Step 4: Commit** — `feat(board): targeted ability plays, alert reveal, modifier-aware costs`

### Task 10: Board UI — faction hero powers

**Files:**
- Modify: `frontend/src/pages/game/HeroPowerBar.tsx`, `frontend/src/pages/game/GameBoardPage.tsx`, `frontend/src/pages/game/MiniVehicle.tsx` (swap-mode click plumbing if not already generic from Task 9)

**Interfaces:**
- Consumes: `state.factions[mySide]`, extended `USE_HERO_POWER` action, `MoveMode` pattern.
- Produces: HeroPowerBar appends the player's faction power (if any) after the 4 universal buttons, driven by a static map (matches the seeded `hero_powers` rows — display-only, no fetch):

```ts
const FACTION_POWER_INFO: Record<string, { power: 'boardingParty' | 'changeOrder' | 'flyby'; label: string; blurb: string }> = {
  DWG: { power: 'boardingParty', label: 'Boarding Party', blurb: 'Exchange a friendly DWG ship with an enemy ship of equal or lesser cost in the same zone' },
  OW: { power: 'changeOrder', label: 'Change Order', blurb: 'Discard an OW vehicle; draw a player-made ship or tank from your deck in two turns' },
  LH: { power: 'flyby', label: 'Flyby', blurb: 'Give an LH vehicle card in hand Half-Cost and Temporary' },
}
```

  - `changeOrder` / `flyby`: inline hand-card pickers (same dropdown pattern as Salvage) filtered to OW vehicles / LH vehicles in hand — HeroPowerBar needs the `hand` prop added.
  - `boardingParty`: two-step board picking via a new `swapMode: { phase: 'pickOwn' } | { phase: 'pickEnemy'; ownInstanceId: string }` owned by GameBoardPage (mirrors `moveMode`); own DWG ships clickable first, then enemy ships in the same zone; sends `{ type: 'USE_HERO_POWER', power: 'boardingParty', instanceId, targetInstanceId }`.
  - Universal `reasonFor` gating reused for the faction button (used/CP/turn/frozen checks); powers absent for NEUTRAL/SS/WF/GT factions (nothing rendered).
- [ ] **Step 1:** Implement the HeroPowerBar additions and GameBoardPage swap-mode wiring.
- [ ] **Step 2:** `npm --prefix frontend run build` clean; full `npx vitest run` still green.
- [ ] **Step 3:** Commit — `feat(board): faction hero power controls`

### Task 11: Live E2E — effects and faction powers over deployed functions (CONTROLLER-RUN)

**Files:**
- Create: `scratchpad` E2E script (not committed; pattern from Phase 4's live E2E — sign in as the two test accounts, drive `lobby-action`/`game-action` via HTTP, assert on returned/fetched state).

Test accounts (the disposable ones from the Phase 2/3 plan docs): `jacob.finn+ftdtest2@streetfeastapp.com` / `FtdPhase2Test!2026` (account A) and `jacob.finn+ftdtest3@streetfeastapp.com` / `FtdPhase3Test!2026` (account B).

Scenario (DWG deck for test account A incl. Marauder, Plunderer, Loggerhead, Double Up, a cheap DWG vehicle; OW deck for B incl. an OW vehicle + a custom ship owned by B if present — else Change Order fizzle path is asserted instead):
- [ ] A plays Marauder → assert hand count NET unchanged (the played card leaves, the drawn card replaces it) and CP net +1 minus Marauder's cpCost, via subsequent state fetch.
- [ ] A plays Double Up targeting the cheap DWG vehicle → play the vehicle → assert 2 zone entries.
- [ ] Assert Plunderer's play cost drop (materials delta between turns with 2+ DWG vehicles fielded).
- [ ] B uses Change Order (discard OW vehicle) → assert scheduled entry; two full turns later assert delivery or fizzle log.
- [ ] Force a battle destroying A's Loggerhead → approve report → assert the 0-cost copy is present in A's deck (fetch A's OWN game_players row while signed in as A — RLS permits own-row reads only; the service key from local env may be used for assertions ONLY, never printed).
- [ ] A uses SET_ALERT_CARD → assert `state.alertCard`; END_TURN → assert cleared.
- [ ] Faction gate: A (DWG) attempts `flyby` → assert 403.
- [ ] All assertions pass; tally reported in the ledger.

### Task 12: Spec amendments + docs

**Files:**
- Modify: `docs/superpowers/specs/2026-08-24-ftd-card-game-design.md`

- [ ] §3.9: `additionalCopies` → `additionalSpawns` (matching the seeded data key), keep "cap 10"; append one sentence: "Cost modifiers apply at play time only — base damage, repairs, and in-battle resources use the unmodified effective cost."
- [ ] §3.8: append the once-per-game faction-power action parameters note (boardingParty targets two ships; changeOrder schedules a draw `CHANGE_ORDER_DELAY_TURNS` turns out; flyby buffs a hand card), and change Boarding Party's "one of your opponent's faction ships" to "one of your opponent's ships" (the implemented reading — any enemy ship qualifies).
- [ ] Commit — `docs(spec): additionalSpawns key and play-time-only cost modifiers`

## Self-Review (performed)

1. **Spec coverage:** §3.9 triggers — all 9 keys enumerated in the registry; dispatch points exist for every trigger with an implemented effect (onPlay, playOnZone, playOnCard, onDeath, costModifier) and for the two targeting-action triggers; onActivate/onBattle* have no implemented effects and surface via the play-time vanilla note (spec-compliant). §3.8 faction powers — Task 7 (DWG/OW/LH; SS/WF/GT correctly get nothing). §5 vocabulary — PLAY_CARD_TARGETING_CARD_ON_FIELD/IN_HAND/SET_ALERT_CARD added (Tasks 5–6); PLAY_CARD_WITHOUT_TARGET deviation pre-ruled. §8 — effects built test-first in `shared/effects`. additionalSpawns cap 10 — Task 4. Catalog effects — Tasks 3/8.
2. **Placeholder scan:** none — every effect has real code; the one deliberate seam (`alert clear` in Task 4 vs 6) is specified with exact code on both sides.
3. **Type consistency:** `EngineContext`/`EffectPayload`/`effectiveCostInGame`/`resolvePlayEffects(keys)` names match across Tasks 1–8; `makeCtx` defined in Task 1 and used from Task 3 on; power union strings match `usedHeroPowers` entries and UI senders.
