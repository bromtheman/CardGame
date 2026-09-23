# LH Hovercraft Amendment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 2026-09-22 LH amendment:
- Ampere enters charged.
- Umbra stays hidden after firing.
- Byte retires, and its draw moves to the Watt.
- The Watt spawns a permanent Decoy Luxon token and becomes the new Hovercraft vehicle type (a ship in every rule, spawned 20 m up in FtD).
- Anode replaces Hydrovolt at 260k.

**Architecture:**
- **Hovercraft** is a sixth `VEHICLE_TYPES` value, `hover`. Every "is this a ship?" test goes through one leaf helper, `isShipClass` in `shared/vehicleClass.ts`. The battle-file builder gives `hover` its own spawn altitude.
- **Card changes** are new registry ids in `shared/effects/lhEffects.ts`. Old ids stay registered for games already dealt.
- **Seed rows and the database:** the rows change in `LH-Built-in.js`. A migration widens the database's `vehicle_type` check, and the controller applies it to production before merge.

**Tech Stack:** TypeScript (strict), Vitest, React 19 + Vite frontend, Supabase Postgres (remote-only), Deno edge functions fed by `npm run functions:sync`.

**Spec:** [docs/superpowers/specs/2026-09-22-lh-hovercraft-design.md](../specs/2026-09-22-lh-hovercraft-design.md). Read it before any task; where this plan and the spec disagree, stop and ask.

## Global Constraints

- **Shell and tests**
  - Windows machine: shell commands in PowerShell syntax. There is no `&&`, so use `;`.
  - Run tests with `npx vitest run` from the repo root. Never pass `--root`: it silently runs 0 tests.
- **`shared/` code**
  - Every commit touching `shared/` includes `npm run functions:sync` output. The drift test `supabase/seed/functionSharedSync.test.ts` fails otherwise.
  - Relative imports inside `shared/` carry the `.ts` extension (Deno runs these files verbatim).
  - A new `shared/` module used by an edge function must be listed in `supabase/functions/shared-manifest.json`. Otherwise `npm run functions:check` fails, and the deployed function fails at boot.
- **Effect ids**
  - New ids only: `ampereChargedStun`, `umbraBeam`, `wattOnPlay`, `wattDraw`.
  - `ampereStun`, `umbraSalvo`, `byteChargeOnPlay` and `byteDraw` stay registered **with unchanged behaviour**. Never reuse an old id (the Kraken/Paddlegun rule).
- **Logs:** public `state.log` never names a card in a hidden hand.
- **Card texts, verbatim:**
  - Ampere: `When played, this gains 2 charge and stuns target enemy vehicle in this zone.`
  - Umbra: `Discharge 2: deal 150k damage to the enemy base in this zone.`
  - Watt: `When played, this gains 1 charge and a friendly Luxon spawns in this zone. That Luxon has Decoy and is not Temporary. Discharge 1: draw a card.`
  - Anode: `` (empty).
- **Numbers:**
  - Ampere gains **2** charge on play; the Watt gains **1**.
  - `HOVER_SPAWN_ALTITUDE_M = 20`.
  - Anode: material **260,000**, blueprint **363,765**, ⚡2, Blocker + Sub Screen, sub.
  - Watt: material stays **90,000**.
- **No digits** in `shared/ai/llm/factionNotes.ts` prose or the primer template (tests forbid them).
- **Commit trailer:** every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Production is touched once before merge:** the Task 3 migration, run by the **controller session through the Supabase MCP**. Implementer subagents never:
  - call Supabase MCP tools
  - deploy functions
  - run `seed:apply`
  - push

---

## File map

| File | Change | Task |
|---|---|---|
| `shared/gameSettings.ts` | `VEHICLE_TYPES.HOVER`; `AMPERE_PLAY_CHARGE`, `WATT_PLAY_CHARGE` | 1, 5, 6 |
| `supabase/seed/source/gameSettings.js` | `VEHICLE_TYPES.HOVER` | 1 |
| `shared/vehicleClass.ts` (new) | `isShipClass` | 1 |
| `shared/vehicleClass.test.ts` (new) | helper + hover placement | 1 |
| `shared/engine/placement.ts` | `BIOMES_BY_TYPE` hover row | 1 |
| `shared/customBattle.ts` / `.test.ts` | `HOVER_SPAWN_ALTITUDE_M`, `spawnAltitudeOf` | 1 |
| `frontend/src/assets/icons/hovercraftSVG.svg` (new) | icon | 1 |
| `frontend/src/lib/keywords.ts` / `.test.ts` | `VEHICLE_TYPE_INFO.hover` | 1 |
| `frontend/src/pages/game/BattleOverlay.tsx` | altitude guidance line | 1 |
| `supabase/functions/shared-manifest.json` | `vehicleClass.ts` for game-action + lobby-action | 1 |
| `docs/claude/architecture.md` | one bullet on `isShipClass` | 1 |
| `shared/effects/primitives.ts` | `matches` ship class, `isAiShip` | 2 |
| `shared/effects/dwgEffects.ts`, `ssEffects.ts`, `wfEffects.ts`, `lhEffects.ts` | ship tests → `isShipClass` | 2 |
| `shared/engine/heroPowers.ts`, `battleDeclare.ts`, `gameEngine.ts` | ship tests → `isShipClass` | 2 |
| `shared/ai/llm/moveMenu.ts`, `rulesPrimer.ts` | ship test; primer placement line | 2 |
| `frontend/src/pages/game/BoardZone.tsx`, `HeroPowerBar.tsx` | ship tests → `isShipClass` | 2 |
| tests: `primitives`, `dwgEffects`, `heroPowers`, `lhRedesign`, `moveMenu`, `battleSim`, `rulesPrimer` | hover cases | 2 |
| `supabase/migrations/<version>_add_hover_vehicle_type.sql` (new) | widen check | 3 |
| `supabase/seed/vehicleTypeCheck.test.ts` (new) | migration ↔ `VEHICLE_TYPES` | 3 |
| `shared/effects/lhEffects.ts` | `umbraBeam`, `gainOwnCharge`, `ampereChargedStun`, `wattOnPlay`, `wattDraw` | 4–6 |
| `shared/effects/lhRedesign.test.ts` | Umbra/Ampere/Watt blocks | 4–6 |
| `supabase/seed/source/builtInCards/LH-Built-in.js` | rows | 4–7 |
| `supabase/seed/seed_data.sql` | regenerated by `npm run seed:build` | 4–7 |
| `supabase/seed/balance/lh.balance.test.ts` | rows by value, roster | 4–7 |
| `supabase/seed/effectCoverage.test.ts` | two deliberate orphans | 4, 5 |
| `supabase/seed/retirement.test.ts` | Byte, Hydrovolt | 7 |
| `shared/shipProfiles/LH.ts` | regenerated by `profiles:import` | 7 |
| `shared/shipProfiles.test.ts` | LH order/count | 7 |
| `shared/ai/botDecks.ts`, `shared/ai/llm/factionNotes.ts` | deck + notes | 7 |

---

### Task 0: Worktree setup and baseline

**Files:** none committed.

- [ ] **Step 1: Install both package trees and copy the env files**

A fresh worktree has no `node_modules` and no env file (CLAUDE.md, "Worktree / environment setup").

```powershell
npm install
npm --prefix frontend install
Copy-Item C:\Users\JFinn\FtDCardGame\frontend\.env.local frontend\.env.local
if (Test-Path C:\Users\JFinn\FtDCardGame\.env.local) { Copy-Item C:\Users\JFinn\FtDCardGame\.env.local .env.local }
```

- [ ] **Step 2: Record the baseline**

```powershell
npx vitest run
```

Expected: all green. Write down the passing count, e.g. "Tests 2363 passed". Every later task and the final report quote before → after against it. If the count is in the hundreds of failures, suspect an incomplete install before the code.

---

### Task 1: The Hovercraft type — helper, placement, battle file, glossary

**Files:**
- Modify: `shared/gameSettings.ts:94-96`, `supabase/seed/source/gameSettings.js` (VEHICLE_TYPES)
- Create: `shared/vehicleClass.ts`, `shared/vehicleClass.test.ts`
- Modify: `shared/engine/placement.ts:19-25`
- Modify: `shared/customBattle.ts:96-100, 284-313`, `shared/customBattle.test.ts`
- Create: `frontend/src/assets/icons/hovercraftSVG.svg`
- Modify: `frontend/src/lib/keywords.ts:1-24, 128-165`, `frontend/src/lib/keywords.test.ts`
- Modify: `frontend/src/pages/game/BattleOverlay.tsx:12, 600-610`
- Modify: `supabase/functions/shared-manifest.json`
- Modify: `docs/claude/architecture.md` (Engine shape section)

**Interfaces:**
- Produces:
  - `VEHICLE_TYPES.HOVER = 'hover'`
  - `export function isShipClass(vehicleType: string | null | undefined): boolean` (`shared/vehicleClass.ts`)
  - `export const HOVER_SPAWN_ALTITUDE_M = 20` (`shared/customBattle.ts`)
  - `VEHICLE_TYPE_INFO[VEHICLE_TYPES.HOVER]` (label `'Hovercraft'`)

- [ ] **Step 1: Write the failing tests**

Create `shared/vehicleClass.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { VEHICLE_TYPES, ZONE_TYPES } from './gameSettings.ts'
import { biomeAllows } from './engine/index.ts'
import { isShipClass } from './vehicleClass.ts'

// 2026-09-22 hovercraft amendment §4: a Hovercraft is a ship in every rule.
describe('isShipClass', () => {
  it('is true for ships and hovercraft, and nothing else', () => {
    expect(isShipClass(VEHICLE_TYPES.SHIP)).toBe(true)
    expect(isShipClass(VEHICLE_TYPES.HOVER)).toBe(true)
    for (const t of [VEHICLE_TYPES.SUB, VEHICLE_TYPES.TANK, VEHICLE_TYPES.PLANE, VEHICLE_TYPES.AIRSHIP, null, undefined]) {
      expect(isShipClass(t), String(t)).toBe(false)
    }
  })
})

describe('hovercraft placement', () => {
  it('deploys to water and beach zones, like a ship, and never to land', () => {
    expect(biomeAllows(VEHICLE_TYPES.HOVER, ZONE_TYPES.WATER)).toBe(true)
    expect(biomeAllows(VEHICLE_TYPES.HOVER, ZONE_TYPES.BEACH)).toBe(true)
    expect(biomeAllows(VEHICLE_TYPES.HOVER, ZONE_TYPES.LAND)).toBe(false)
  })
})
```

In `shared/customBattle.test.ts`, add `HOVER_SPAWN_ALTITUDE_M` to the import from `./customBattle.ts`, and add after the "spawns aircraft at the aircraft altitude" test:

```ts
  it('spawns a hovercraft just above the water, below the aircraft (2026-09-22 hovercraft amendment)', () => {
    // The Watt hovers: spawned at the surface like a ship, it died before the
    // fight began. Asserted against the constant, as the aircraft test is.
    const file = buildCustomBattle([
      { name: 'hover', cards: [{ name: 'Watt', faction: 'LH', vehicleType: VEHICLE_TYPES.HOVER }] },
      { name: 'surface', cards: [{ ...marauder, vehicleType: VEHICLE_TYPES.SHIP }] },
    ])
    expect(file.Teams[0]!.Blueprints[0]!.SpawnAltitude).toBe(HOVER_SPAWN_ALTITUDE_M)
    expect(file.Teams[1]!.Blueprints[0]!.SpawnAltitude).toBe(0)
    expect(HOVER_SPAWN_ALTITUDE_M).toBeGreaterThan(0)
    expect(HOVER_SPAWN_ALTITUDE_M).toBeLessThan(AIRCRAFT_SPAWN_ALTITUDE_M)
  })
```

In `frontend/src/lib/keywords.test.ts`, add `import { HOVER_SPAWN_ALTITUDE_M } from '@shared/customBattle'` and append:

```ts
// 2026-09-22 hovercraft amendment §4: the glossary is the one place a player
// reads that a hovercraft is a ship, and its height is derived, never restated.
describe('hovercraft wording', () => {
  const hover = VEHICLE_TYPE_INFO[VEHICLE_TYPES.HOVER]

  it('says it is a ship in every rule and states the spawn height from the battle file', () => {
    expect(hover.label).toBe('Hovercraft')
    expect(hover.description).toContain('Counts as a ship for every rule')
    expect(hover.description).toContain(`${HOVER_SPAWN_ALTITUDE_M} m above the water`)
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

```powershell
npx vitest run shared/vehicleClass.test.ts shared/customBattle.test.ts frontend/src/lib/keywords.test.ts
```

Expected: FAIL. `vehicleClass.test.ts` cannot resolve `./vehicleClass.ts`; the customBattle case fails (the constant is undefined); the keywords case fails on `hover` being undefined.

- [ ] **Step 3: Add the type**

`shared/gameSettings.ts` — replace the `VEHICLE_TYPES` block:

```ts
export const VEHICLE_TYPES = {
  SHIP: 'ship', AIRSHIP: 'airship', TANK: 'tank', PLANE: 'plane', SUB: 'sub',
  // 2026-09-22 hovercraft amendment §4: counts as a ship for every rule
  // (shared/vehicleClass.ts) and spawns just above the water in FtD
  // (HOVER_SPAWN_ALTITUDE_M, shared/customBattle.ts). The cards table's check
  // admits it from migration *_add_hover_vehicle_type.sql.
  HOVER: 'hover',
} as const
```

`supabase/seed/source/gameSettings.js` — the seed source's own copy:

```js
export const VEHICLE_TYPES = {
    SHIP: 'ship',
    AIRSHIP: 'airship',
    TANK: 'tank',
    PLANE: 'plane',
    SUB: 'sub',
    HOVER: 'hover', // 2026-09-22 hovercraft amendment: a ship in every rule, spawned just above the water in FtD
};
```

- [ ] **Step 4: Add the helper**

Create `shared/vehicleClass.ts`:

```ts
import { VEHICLE_TYPES } from './gameSettings.ts'

// "Is this a ship?" — asked by placement pools, isAiShip, the DWG boarding
// party and Double Up, SS Braveheart's duel pick, WF Harbringer's pool, the
// fleet-battle omission rule, Change Order, Cathode's duel and the bot's move
// menu.
//
// A Hovercraft (VEHICLE_TYPES.HOVER, 2026-09-22 hovercraft amendment §4)
// counts as a ship for EVERY rule; the one place it differs is its FtD spawn
// altitude (shared/customBattle.ts). So no rule compares vehicleType to
// VEHICLE_TYPES.SHIP directly — it asks here, and the next ship class is one
// line.
//
// A LEAF module: it imports gameSettings and nothing else, so the engine, the
// effects, the bot and the frontend can all read it without an import cycle.
export function isShipClass(vehicleType: string | null | undefined): boolean {
  return vehicleType === VEHICLE_TYPES.SHIP || vehicleType === VEHICLE_TYPES.HOVER
}
```

- [ ] **Step 5: Placement**

`shared/engine/placement.ts` — in `BIOMES_BY_TYPE`, after the `SHIP` row:

```ts
  // A ship in every rule (2026-09-22 hovercraft amendment §4).
  [VEHICLE_TYPES.HOVER]: [ZONE_TYPES.WATER, ZONE_TYPES.BEACH],
```

- [ ] **Step 6: The battle file**

`shared/customBattle.ts` — update the `BattleCard.vehicleType` doc comment:

```ts
  /**
   * The card's vehicle type, deciding spawn altitude. Aircraft start at
   * AIRCRAFT_SPAWN_ALTITUDE_M, hovercraft at HOVER_SPAWN_ALTITUDE_M; everything
   * else at the surface.
   */
```

Add after `AIRCRAFT_SPAWN_ALTITUDE_M`:

```ts
/**
 * A Hovercraft's spawn height (2026-09-22 hovercraft amendment §4). The Watt is
 * a skimmer that hovers: spawned at the surface like a ship, it died before the
 * fight began, so it starts this far up and settles onto its cushion.
 *
 * ⚠ Derive every player-facing statement of it, exactly as for
 * AIRCRAFT_SPAWN_ALTITUDE_M (the 80 → 160 lesson above).
 */
export const HOVER_SPAWN_ALTITUDE_M = 20
```

Replace `spawnAltitudeOf`:

```ts
function spawnAltitudeOf(card: BattleCard): number {
  if (card.vehicleType === VEHICLE_TYPES.HOVER) return HOVER_SPAWN_ALTITUDE_M
  const airborne = card.vehicleType != null && AIRBORNE_VEHICLE_TYPES.includes(card.vehicleType)
  return airborne ? AIRCRAFT_SPAWN_ALTITUDE_M : 0.0
}
```

- [ ] **Step 7: The icon**

Create `frontend/src/assets/icons/hovercraftSVG.svg`:

```svg
<?xml version="1.0" standalone="no"?>
<!-- Hovercraft (2026-09-22 hovercraft amendment §4): a hull on its air cushion
     with a thrust duct aft, drawn to sit beside shipSVG.svg in the same
     300×100 box and the same solid black fill. -->
<svg version="1.1" xmlns="http://www.w3.org/2000/svg"
 width="300pt" height="100pt" viewBox="0 0 300 100"
 preserveAspectRatio="xMidYMid meet">
<g fill="#000000" stroke="none">
<path d="M40 60 H260 A12 12 0 0 1 260 84 H40 A12 12 0 0 1 40 60 Z"/>
<path d="M60 60 L78 46 H196 L214 60 Z"/>
<rect x="96" y="28" width="78" height="18" rx="3"/>
<path fill-rule="evenodd" d="M204 34 A18 18 0 1 0 240 34 A18 18 0 1 0 204 34 Z M211 34 A11 11 0 1 0 233 34 A11 11 0 1 0 211 34 Z"/>
<rect x="219" y="50" width="6" height="12"/>
<rect x="44" y="90" width="44" height="4" rx="2"/>
<rect x="128" y="90" width="44" height="4" rx="2"/>
<rect x="212" y="90" width="44" height="4" rx="2"/>
</g>
</svg>
```

- [ ] **Step 8: The glossary**

In `frontend/src/lib/keywords.ts`, add these two imports:

```ts
import { HOVER_SPAWN_ALTITUDE_M } from '@shared/customBattle'
import hovercraftIcon from '../assets/icons/hovercraftSVG.svg'
```

The first sits beside the `@shared/engine/index` import; the second after the `anchorIcon` import. Then, in `VEHICLE_TYPE_INFO`, after the `SHIP` entry:

```ts
  [VEHICLE_TYPES.HOVER]: {
    key: VEHICLE_TYPES.HOVER,
    label: 'Hovercraft',
    icon: hovercraftIcon,
    // 2026-09-22 hovercraft amendment §4. The height is DERIVED from the battle
    // file's constant, never restated (BattleOverlay's 80 → 160 lesson).
    description: `Counts as a ship for every rule, and deploys to water and beach zones. In FtD it spawns ${HOVER_SPAWN_ALTITUDE_M} m above the water, where it hovers.`,
  },
```

- [ ] **Step 9: The battle overlay**

`frontend/src/pages/game/BattleOverlay.tsx` — import both constants:

```ts
import { AIRCRAFT_SPAWN_ALTITUDE_M, HOVER_SPAWN_ALTITUDE_M } from '@shared/customBattle'
```

Replace the altitude comment and paragraph:

```tsx
        {/*
          Both altitudes are DERIVED from their constants, never restated:
          this sentence hard-coded "80 m" and kept saying it after the constant
          was retuned to 160, so the panel contradicted the battle file it
          describes. Keep them derived.
        */}
        <p className="mt-2 text-sm text-ocean-300">
          Altitude guidance: surface ships and submarines spawn at the surface; hovercraft spawn{' '}
          {HOVER_SPAWN_ALTITUDE_M} m above the water; aircraft spawn at{' '}
          {AIRCRAFT_SPAWN_ALTITUDE_M} m; land vehicles spawn on land.
        </p>
```

- [ ] **Step 10: Manifest, sync, docs**

`supabase/functions/shared-manifest.json`: add `"vehicleClass.ts",` directly after `"types.ts",` in both the `lobby-action` and `game-action` arrays.

`docs/claude/architecture.md` — in "Engine shape", after the "**Where card effects fire.**" bullet, add:

```markdown
- **Vehicle classes.** `isShipClass` (`shared/vehicleClass.ts`) is the one
  answer to "is this a ship?". A Hovercraft (`hover`, 2026-09-22) counts as a
  ship for every rule, so no rule compares `vehicleType` to
  `VEHICLE_TYPES.SHIP` directly: placement, pools (`matches`), `isAiShip`, and
  every ship-only effect, hero power and bot move go through it. The one
  difference is the FtD spawn height (`HOVER_SPAWN_ALTITUDE_M`,
  `shared/customBattle.ts`).
```

```powershell
npm run functions:sync
```

- [ ] **Step 11: Run the tests to verify they pass**

```powershell
npx vitest run shared/vehicleClass.test.ts shared/customBattle.test.ts frontend/src/lib/keywords.test.ts supabase/seed/functionSharedSync.test.ts
```

Expected: PASS. Among them, keywords.test's existing "explains every vehicle type" now covers `hover` too.

- [ ] **Step 12: Commit**

```powershell
git add shared/gameSettings.ts supabase/seed/source/gameSettings.js shared/vehicleClass.ts shared/vehicleClass.test.ts shared/engine/placement.ts shared/customBattle.ts shared/customBattle.test.ts frontend/src/assets/icons/hovercraftSVG.svg frontend/src/lib/keywords.ts frontend/src/lib/keywords.test.ts frontend/src/pages/game/BattleOverlay.tsx supabase/functions docs/claude/architecture.md
git commit -m @'
feat(hover): the Hovercraft vehicle type - a ship in every rule, spawned 20 m up

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 2: Every ship-only rule includes hovercraft

**Files:**
- Modify:
  - `shared/effects/primitives.ts:119-122, 170-172`
  - `shared/effects/dwgEffects.ts:156`
  - `shared/effects/ssEffects.ts:406-407`
  - `shared/effects/wfEffects.ts:381`
  - `shared/effects/lhEffects.ts:500`
  - `shared/engine/heroPowers.ts:56,60`
  - `shared/engine/battleDeclare.ts:354-356`
  - `shared/engine/gameEngine.ts:588-590`
  - `shared/ai/llm/moveMenu.ts:126-128`
  - `shared/ai/llm/rulesPrimer.ts:50`
  - `frontend/src/pages/game/BoardZone.tsx:5,301,339`
  - `frontend/src/pages/game/HeroPowerBar.tsx:5,114`
- Test:
  - `shared/effects/primitives.test.ts`
  - `shared/effects/dwgEffects.test.ts`
  - `shared/engine/heroPowers.test.ts`
  - `shared/effects/lhRedesign.test.ts`
  - `shared/ai/llm/moveMenu.test.ts`
  - `shared/ai/battleSim.test.ts`
  - `shared/ai/llm/rulesPrimer.test.ts`

**Interfaces:**
- Consumes: `isShipClass` and `VEHICLE_TYPES.HOVER` from Task 1.
- Produces: no new names. After this task, the grep in Step 6 lists only the survivors named there.

- [ ] **Step 1: Write the failing tests**

`shared/effects/primitives.test.ts` — add `drawFromPool` and `isAiShip` to its existing import from `./primitives.ts` if absent, plus `inst`, `makeCtx`, `makeGame` from `../engine/testFixtures.ts`, then append:

```ts
// 2026-09-22 hovercraft amendment §4: a pool or test that asks for a ship
// takes a hovercraft.
describe('ship class', () => {
  it('a pool asking for ships draws a hovercraft', () => {
    const game = makeGame()
    game.privates.a.deck = [inst({ instanceId: 'hov', vehicleType: 'hover' })]
    game.state.counts.a = { hand: 0, deck: 1 }
    const ok = drawFromPool({ source: 'deck', filter: { vehicleType: 'ship' }, count: 1 })({
      game, actor: 'a', card: inst({ type: 'ability' }), ctx: makeCtx(),
    })
    expect(ok).toBe(true)
    expect(game.privates.a.hand.map((c) => c.instanceId)).toEqual(['hov'])
  })

  it('isAiShip takes a built-in hovercraft and still refuses an airship', () => {
    expect(isAiShip({ isBuiltIn: true, type: 'vehicle', vehicleType: 'hover' })).toBe(true)
    expect(isAiShip({ isBuiltIn: true, type: 'vehicle', vehicleType: 'airship' })).toBe(false)
  })
})
```

`shared/effects/dwgEffects.test.ts` — inside `describe('doubleUpEffect', …)`, add:

```ts
  it('takes a DWG hovercraft — it counts as a ship (2026-09-22 hovercraft amendment)', () => {
    const { game, target } = withHandTarget({ vehicleType: 'hover' })
    const ok = effectFor('doubleUpEffect')!({
      game, actor: 'a', card: inst({ type: 'ability', name: 'Double Up' }), ctx: makeCtx(),
      targetInstanceId: target.instanceId,
    })
    expect(ok).toBe(true)
  })
```

`shared/engine/heroPowers.test.ts` — inside `describe('USE_HERO_POWER boardingParty (DWG)', …)`, add:

```ts
  it('trades for an enemy hovercraft — it counts as a ship (2026-09-22 hovercraft amendment)', () => {
    const g = makeGame()
    const mine = zoneEntry({ faction: 'DWG', vehicleType: 'ship', materialCost: 100000, playedOnTurn: 1 })
    const theirs = zoneEntry({ faction: 'LH', vehicleType: 'hover', materialCost: 90000, playedOnTurn: 1 })
    g.state.zones[0].cards.a.push(mine)
    g.state.zones[0].cards.b.push(theirs)
    const r = applyAction(g, 'alice', {
      type: 'USE_HERO_POWER', power: 'boardingParty', instanceId: mine.instanceId, targetInstanceId: theirs.instanceId,
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a.map((c) => c.instanceId)).toEqual([theirs.instanceId])
  })
```

`shared/effects/lhRedesign.test.ts` — inside `describe('Cathode — cathodeDuel', …)`, add:

```ts
  it('offers an enemy hovercraft — it counts as a ship (2026-09-22 hovercraft amendment)', () => {
    const game = lhGame()
    game.state.zones[0].cards.a.push(zoneEntry({
      instanceId: 'cat', name: 'Cathode', faction: 'LH', vehicleType: 'sub', keywords: ['stealthy', 'subScreen'],
      meta: { chargeMax: 2, requiresCharge: 2, onActivate: 'cathodeDuel', activateCpCost: 0, dischargeCost: 2 }, charge: 2,
    }))
    game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'hov', vehicleType: 'hover' }))
    const res = activate(game, 'cat')
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.pendingEffect?.options.map((o) => o.id)).toEqual(['hov'])
  })
```

`shared/ai/llm/moveMenu.test.ts` — inside `describe('buildMenu', …)`, add:

```ts
  it('offers Boarding Party against an enemy hovercraft — it counts as a ship (2026-09-22 hovercraft amendment)', () => {
    const g = makeGame({ activePlayer: BOT, turnNumber: 3 })
    g.state.factions = { a: 'LH', b: 'DWG' }
    g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'mine', faction: 'DWG', materialCost: 100000, playedOnTurn: 1 }))
    g.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'hov', faction: 'LH', vehicleType: 'hover', materialCost: 90000, playedOnTurn: 1 }))
    const menu = buildMenu(g, BOT, makeCtx(), 'turn').map((m) => m.action)
    expect(menu).toContainEqual({ type: 'USE_HERO_POWER', power: 'boardingParty', instanceId: 'mine', targetInstanceId: 'hov' })
  })
```

`shared/ai/battleSim.test.ts` — inside `describe('hullStrength', …)`. This one **pins** existing behaviour, so it passes before the change; the spec asks for the pin:

```ts
  it('files an enemy hovercraft with ships — it counts as a ship (2026-09-22 hovercraft amendment)', () => {
    const vsShip = hullStrength(crossbones('x'), [plain('e')])
    const vsHover = hullStrength(crossbones('x'), [plain('h', 100000, { vehicleType: 'hover' })])
    const vsPlane = hullStrength(crossbones('x'), [plain('p', 100000, { vehicleType: 'plane' })])
    expect(vsHover).toEqual(vsShip)
    expect(vsPlane.offense).not.toBe(vsShip.offense)   // Crossbones: vs ships 5, aircraft 2
  })
```

`shared/ai/llm/rulesPrimer.test.ts` — inside `describe('rules primer', …)`:

```ts
  it('tells the model a hovercraft is a ship (2026-09-22 hovercraft amendment)', () => {
    expect(PRIMER_TEMPLATE).toContain('Placement: ships, hovercraft and submarines go to water or beach zones;')
    expect(PRIMER_TEMPLATE).toContain('A hovercraft (type hover) counts as a ship for every rule.')
  })
```

- [ ] **Step 2: Run them to verify they fail**

```powershell
npx vitest run shared/effects/primitives.test.ts shared/effects/dwgEffects.test.ts shared/engine/heroPowers.test.ts shared/effects/lhRedesign.test.ts shared/ai/llm/moveMenu.test.ts shared/ai/battleSim.test.ts shared/ai/llm/rulesPrimer.test.ts
```

Expected: the six new ship-class cases FAIL: pool, isAiShip, Double Up, boarding party, Cathode and moveMenu. Also the primer case. The battleSim pin PASSES already.

- [ ] **Step 3: Implement — pools and `isAiShip`**

`shared/effects/primitives.ts` — add `import { isShipClass } from '../vehicleClass.ts'`. Above `matches`, add:

```ts
// A pool that asks for a ship takes any ship-class hull — a Hovercraft counts
// as a ship for every rule (2026-09-22 hovercraft amendment §4).
const vehicleTypeMatches = (actual: string | null, wanted: string): boolean =>
  wanted === VEHICLE_TYPES.SHIP ? isShipClass(actual) : actual === wanted
```

In `matches`, replace the vehicleType line with:

```ts
  if (f.vehicleType !== undefined && !vehicleTypeMatches(card.vehicleType, f.vehicleType)) return false
```

In `isAiShip`, replace `c.vehicleType === VEHICLE_TYPES.SHIP` with `isShipClass(c.vehicleType)`.

- [ ] **Step 4: Implement — every other site**

Each file gains `import { isShipClass } from '<relative>/vehicleClass.ts'`, with a `.ts` extension inside `shared/`. In the frontend it is `import { isShipClass } from '@shared/vehicleClass'`.

- `shared/effects/dwgEffects.ts:156`
  - before: `if (target.vehicleType !== VEHICLE_TYPES.SHIP) return false`
  - after: `if (!isShipClass(target.vehicleType)) return false`
- `shared/effects/ssEffects.ts:406-407` (`canDuel`)
  - before: `e.vehicleType === VEHICLE_TYPES.SHIP && !e.keywords.includes(KEYWORDS.INOFFENSIVE)`
  - after: `isShipClass(e.vehicleType) && !e.keywords.includes(KEYWORDS.INOFFENSIVE)`
- `shared/effects/wfEffects.ts:381` (`harbringerPool`)
  - before: `c.vehicleType === VEHICLE_TYPES.SHIP &&`
  - after: `isShipClass(c.vehicleType) &&`
- `shared/effects/lhEffects.ts:500` (Cathode)
  - before: `(e) => e.vehicleType === VEHICLE_TYPES.SHIP || e.vehicleType === VEHICLE_TYPES.SUB,`
  - after: `(e) => isShipClass(e.vehicleType) || e.vehicleType === VEHICLE_TYPES.SUB,`
- `shared/engine/heroPowers.ts:56` (Boarding Party)
  - before: `mine.entry.vehicleType !== 'ship'`
  - after: `!isShipClass(mine.entry.vehicleType)`
- `shared/engine/heroPowers.ts:60` (Boarding Party)
  - before: `theirs.entry.vehicleType !== 'ship'`
  - after: `!isShipClass(theirs.entry.vehicleType)`
- `shared/engine/battleDeclare.ts:355`
  - before: `(c) => c.vehicleType === VEHICLE_TYPES.SHIP || c.vehicleType === VEHICLE_TYPES.TANK,`
  - after: `(c) => isShipClass(c.vehicleType) || c.vehicleType === VEHICLE_TYPES.TANK,`
- `shared/engine/gameEngine.ts:589` (Change Order)
  - before: `(c) => c.isBuiltIn === false && (c.vehicleType === VEHICLE_TYPES.SHIP || c.vehicleType === VEHICLE_TYPES.TANK),`
  - after: `(c) => c.isBuiltIn === false && (isShipClass(c.vehicleType) || c.vehicleType === VEHICLE_TYPES.TANK),`
- `shared/ai/llm/moveMenu.ts:126` — `if (card.vehicleType === 'ship') {` becomes `if (isShipClass(card.vehicleType)) {`.
- `shared/ai/llm/moveMenu.ts:128` — `t.card.vehicleType === 'ship'` becomes `isShipClass(t.card.vehicleType)`. Import path: `'../../vehicleClass.ts'`.
- `frontend/src/pages/game/BoardZone.tsx`:
  - lines 301 and 339: `c.vehicleType === VEHICLE_TYPES.SHIP` becomes `isShipClass(c.vehicleType)`
  - line 5 becomes `import { KEYWORDS } from '@shared/gameSettings'` (`VEHICLE_TYPES` is unused after this)
- `frontend/src/pages/game/HeroPowerBar.tsx`:
  - line 114: `c.vehicleType === VEHICLE_TYPES.SHIP` becomes `isShipClass(c.vehicleType)`
  - line 5 becomes `import { HERO_POWER_DISTANCE_MOD_M } from '@shared/gameSettings'`

`shared/ai/llm/rulesPrimer.ts:50` — replace the start of the Placement line so it reads:

```text
- Placement: ships, hovercraft and submarines go to water or beach zones; tanks to beach or land; planes and airships anywhere. A hovercraft (type hover) counts as a ship for every rule. An enemy Air Screen vehicle in a zone blocks your planes and airships there; an enemy Sub Screen blocks your submarines. Each side holds at most {{MAX_VEHICLES_PER_ZONE_SIDE}} vehicles per zone.
```

Only the first two sentences change; keep the rest of the line byte-identical.

- [ ] **Step 5: Sync and run the tests**

```powershell
npm run functions:sync
npx vitest run shared/effects/primitives.test.ts shared/effects/dwgEffects.test.ts shared/engine/heroPowers.test.ts shared/effects/lhRedesign.test.ts shared/ai/llm/moveMenu.test.ts shared/ai/battleSim.test.ts shared/ai/llm/rulesPrimer.test.ts supabase/seed/functionSharedSync.test.ts
```

Expected: PASS.

- [ ] **Step 6: Audit — nothing still compares to SHIP by hand**

```powershell
git grep -n -E "VEHICLE_TYPES\.SHIP|'ship'" -- shared frontend/src ':!*.test.ts' ':!shared/shipProfiles/*'
```

Expected survivors, and only these:
- `shared/gameSettings.ts` (the definition)
- `shared/vehicleClass.ts`
- `shared/engine/placement.ts` (the SHIP biome row)
- `shared/effects/primitives.ts` (`vehicleTypeMatches`)
- `shared/effects/ssEffects.ts:32` (`AI_SHIP_FILTER`, a PoolFilter value read through `matches`)
- `shared/effects/ssEffects.ts:171` (a comment)
- `shared/effects/lhEffects.ts:46` (`drawCustomShip`'s PoolFilter, read through `matches`)
- `shared/engine/testFixtures.ts` (fixture default)
- `frontend/src/lib/keywords.ts` (the SHIP glossary key)
- `frontend/src/pages/CreateCardPage.tsx` (the form's default)

Any other hit is a missed site: convert it.

- [ ] **Step 7: Typecheck both trees**

```powershell
npx tsc -p tsconfig.json --noEmit
npm --prefix frontend run build
npm --prefix frontend run lint
```

Expected: no errors.

- [ ] **Step 8: Commit**

```powershell
git add shared frontend/src supabase/functions
git commit -m @'
feat(hover): every ship-only rule, pool and bot move takes a hovercraft

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 3: The migration — applied to production before merge (CONTROLLER ONLY)

The owner approved applying this before merge (2026-09-22). **The controller session runs it**, because it needs the Supabase MCP. Never hand it to a subagent.

**Files:**
- Create: `supabase/seed/vehicleTypeCheck.test.ts`
- Create: `supabase/migrations/<version>_add_hover_vehicle_type.sql`, where `<version>` is whatever `apply_migration` records.

**Interfaces:**
- Consumes: `VEHICLE_TYPES` (with `HOVER`) from Task 1.
- Produces: the live `cards_vehicle_type_check` admits `hover`.

- [ ] **Step 1: Write the failing test**

Create `supabase/seed/vehicleTypeCheck.test.ts`:

```ts
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { VEHICLE_TYPES } from '../../shared/gameSettings'

// The cards table's vehicle_type CHECK must admit exactly the engine's types.
// A type the engine knows and the database refuses is invisible to every other
// test (they read the seed SOURCE), and fails the seed job's whole batch at
// merge (2026-09-22 hovercraft amendment §5). Reads the NEWEST migration that
// states the check, the way shared/battleReport.test.ts reads its migration.
function latestVehicleTypeCheck(): string[] {
  const dir = join(__dirname, '..', 'migrations')
  let latest: string[] | null = null
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(dir, file), 'utf8')
    for (const m of sql.matchAll(/check \(vehicle_type in \(([^)]*)\)\)/gi)) {
      latest = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''))
    }
  }
  if (latest === null) throw new Error('no migration states the cards.vehicle_type check')
  return latest
}

describe('cards.vehicle_type check (migrations)', () => {
  it('admits exactly VEHICLE_TYPES', () => {
    expect([...latestVehicleTypeCheck()].sort()).toEqual([...Object.values(VEHICLE_TYPES)].sort())
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```powershell
npx vitest run supabase/seed/vehicleTypeCheck.test.ts
```

Expected: FAIL. The newest check (the 2026-08-24 create migration) lacks `hover`.

- [ ] **Step 3: Apply to production (controller, MCP)**

Call `mcp__…__apply_migration` with:
- `project_id`: `wpgsjnjnvykxavaxibld`
- `name`: `add_hover_vehicle_type`
- `query`: exactly this text (the file in Step 5 carries the same bytes)

```sql
-- 2026-09-22 LH hovercraft amendment (docs/superpowers/specs/2026-09-22-lh-hovercraft-design.md §4-§5):
-- a new vehicle type, 'hover', that counts as a ship for every rule and spawns
-- just above the water in FtD. Applied to production BEFORE the merge through
-- the Supabase MCP apply_migration, so the seed job's upsert of the hover Watt
-- cannot race it; this file carries the version that call recorded. It only
-- widens the list, so nothing live can notice.
alter table public.cards drop constraint cards_vehicle_type_check;
alter table public.cards add constraint cards_vehicle_type_check
  check (vehicle_type in ('ship','airship','tank','plane','sub','hover'));
```

- [ ] **Step 4: Read back the recorded version and the live constraint**

- Call `list_migrations`, and note the `version` of `add_hover_vehicle_type`.
- Call `execute_sql`:

```sql
select pg_get_constraintdef(oid) from pg_constraint
where conrelid = 'public.cards'::regclass and conname = 'cards_vehicle_type_check';
```

Expected: the definition lists `'hover'::text`.

- [ ] **Step 5: Write the file under the recorded version**

Create `supabase/migrations/<version>_add_hover_vehicle_type.sql` with the Step 3 SQL, byte for byte. A wrong version replays at merge and fails the migrate step, which **silently skips the function deploy** (docs/claude/supabase.md).

- [ ] **Step 6: Run the test to verify it passes**

```powershell
npx vitest run supabase/seed/vehicleTypeCheck.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add supabase/migrations supabase/seed/vehicleTypeCheck.test.ts
git commit -m @'
feat(hover): the cards table admits hover - applied to production before merge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 4: Umbra stays hidden — `umbraBeam`

**Files:**
- Modify: `shared/effects/lhEffects.ts:417-434`, `shared/effects/lhRedesign.test.ts`
- Modify: `supabase/seed/source/builtInCards/LH-Built-in.js` (Umbra row), `supabase/seed/seed_data.sql` (generated)
- Modify: `supabase/seed/balance/lh.balance.test.ts` (Umbra row), `supabase/seed/effectCoverage.test.ts`

**Interfaces:**
- Produces: registry id `umbraBeam`; `umbraSalvo` unchanged and now a deliberate orphan.

- [ ] **Step 1: Write the failing tests**

`shared/effects/lhRedesign.test.ts` — add after the `Umbra — umbraSalvo` block:

```ts
// 2026-09-22 hovercraft amendment: Umbra stays Stealthy after firing (R-8
// overturned). Dealt Umbras keep umbraSalvo, and the block above pins that
// they still surface.
describe('Umbra — umbraBeam', () => {
  const umbra = (charge: number) => zoneEntry({
    instanceId: 'umbra', name: 'Umbra', faction: 'LH', vehicleType: 'sub', keywords: ['stealthy'],
    meta: { chargeMax: 2, onActivate: 'umbraBeam', activateCpCost: 0, dischargeCost: 2 }, charge,
  })
  it('shells the base past a Blocker for 150 and stays Stealthy', () => {
    const game = lhGame()
    game.state.zones[0].cards.a.push(umbra(2))
    game.state.zones[0].cards.b.push(zoneEntry({ keywords: ['blocker'] }))
    const res = activate(game, 'umbra')
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.zones[0].baseHp.b).toBe(850)
    const hull = res.game.state.zones[0].cards.a[0] as ZoneCardEntry
    expect(hull.keywords).toEqual(['stealthy'])
    expect(hull.meta.revokedKeywords).toBeUndefined()
    expect(chargeOf(hull)).toBe(0)
    expect(res.game.state.log.some((line) => line.includes('surfaces'))).toBe(false)
  })
})
```

`supabase/seed/balance/lh.balance.test.ts` — replace the `'LH:Umbra'` entry's `cardText` and `meta`:

```ts
    cardText: 'Discharge 2: deal 150k damage to the enemy base in this zone.',
    meta: { chargeMax: 2, onActivate: 'umbraBeam', activateCpCost: 0, dischargeCost: 2 },
```

- [ ] **Step 2: Run them to verify they fail**

```powershell
npx vitest run shared/effects/lhRedesign.test.ts supabase/seed/balance/lh.balance.test.ts
```

Expected: FAIL.
- The umbraBeam activation is refused: no such effect is registered.
- LH:Umbra's row mismatches on cardText and `meta.onActivate`.

- [ ] **Step 3: Register the effect**

`shared/effects/lhEffects.ts`:
- In the beam helper's comment, change "for Umbra, surfaces the sub afterwards (R-8)" to "for the pre-2026-09-22 Umbra id, surfaces the sub afterwards (R-8, since overturned)".
- After `registerEffect('umbraSalvo', beam(UMBRA_SALVO_DAMAGE, true))`, add:

```ts
// 2026-09-22 hovercraft amendment §3: Umbra stays Stealthy after firing (R-8
// overturned). A NEW id: dealt Umbras keep 'umbraSalvo' and still surface.
registerEffect('umbraBeam', beam(UMBRA_SALVO_DAMAGE, false))
```

- [ ] **Step 4: Change the seed row**

`supabase/seed/source/builtInCards/LH-Built-in.js` — replace the whole Umbra entry with:

```js
    {
        name: 'Umbra',
        isBuiltIn: true,
        cardText: 'Discharge 2: deal 150k damage to the enemy base in this zone.',
        materialCost: 150000,
        blueprintCost: 148479,
        cpCost: 0,
        imageUrl: 'umbra.png',
        playerId: null,
        vehicleType: VEHICLE_TYPES.SUB,
        type: 'vehicle',
        faction: FACTIONS.LH,
        blueprintId: null,
        keywords: [KEYWORDS.STEALTHY],
        // 2026-09-22 hovercraft amendment: umbraBeam — it stays Stealthy (R-8 overturned).
        meta: { chargeMax: 2, [TRIGGERS.ON_ACTIVATE]: 'umbraBeam', activateCpCost: 0, dischargeCost: 2 },
    },
```

- [ ] **Step 5: Record the orphan**

`supabase/seed/effectCoverage.test.ts`:
- In `DELIBERATE_ORPHANS`, after `terawattJoin`, add:

```ts
  umbraSalvo: '2026-09-22 hovercraft amendment: Umbra no longer surfaces; umbraBeam replaced it (spec §3)',
```

- In the exact-list test, insert `'umbraSalvo',` between `'terawattJoin',` and `'victoriaActivate',`.
- Add `2026-09-22` to that test's title.

- [ ] **Step 6: Regenerate the seed SQL, sync, run the tests**

```powershell
npm run seed:build
npm run functions:sync
npx vitest run shared/effects/lhRedesign.test.ts supabase/seed
```

Expected: PASS. This includes `seedDataSync`, `effectCoverage` (G1–G4) and `lh.balance`.

- [ ] **Step 7: Commit**

```powershell
git add shared supabase
git commit -m @'
feat(lh): Umbra stays Stealthy after firing - umbraBeam, R-8 overturned

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 5: Ampere enters charged — `ampereChargedStun`

**Files:**
- Modify:
  - `shared/gameSettings.ts` (after `BYTE_PLAY_CHARGE`)
  - `shared/effects/lhEffects.ts:1-17, 363-380, 436-457`
  - `shared/effects/lhRedesign.test.ts`
- Modify:
  - `supabase/seed/source/builtInCards/LH-Built-in.js` (Ampere row)
  - `supabase/seed/seed_data.sql`
  - `supabase/seed/balance/lh.balance.test.ts`
  - `supabase/seed/effectCoverage.test.ts`

**Interfaces:**
- Produces:
  - `export const AMPERE_PLAY_CHARGE = 2` (`shared/gameSettings.ts`)
  - Module-private in `lhEffects.ts`: `function gainOwnCharge(payload: EffectPayload, amount: number): void`, which Task 6 reuses.
  - Module-private in `lhEffects.ts`: `function ampereStunChoice(effect: string): EffectFn`.
  - Registry id `ampereChargedStun`.

- [ ] **Step 1: Write the failing tests**

`shared/effects/lhRedesign.test.ts`:
- In the existing `Ampere — ampereStun` block's "plays with no stun into an empty lane" test, add before its closing `})`. This pins the old id: dealt Amperes enter empty.

```ts
    expect(chargeOf(res.game.state.zones[0].cards.a[0] as ZoneCardEntry)).toBe(0)
```

- Then add a new block after it:

```ts
// 2026-09-22 hovercraft amendment: Ampere lands full. The charge lands on the
// first entry only, so resolving the stun cannot charge it twice.
describe('Ampere — ampereChargedStun', () => {
  const ampere = () => inst({
    instanceId: 'ampere', name: 'Ampere', faction: 'LH', materialCost: 200000, keywords: ['mobile'],
    meta: { chargeMax: 2, onPlayEffect: 'ampereChargedStun' },
  })
  const setup = () => {
    const game = lhGame(); game.state.resources.a.materials = 300000
    game.privates.a.hand = [ampere()]; game.state.counts.a = { hand: 1, deck: 1 }
    return game
  }
  const play = (game: ReturnType<typeof makeGame>) =>
    applyAction(game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: 'ampere', zoneId: 1 }, makeCtx())
  const hull = (game: ReturnType<typeof makeGame>) =>
    game.state.zones[0].cards.a.find((c) => c.instanceId === 'ampere') as ZoneCardEntry

  it('lands with both pips, then stuns the chosen enemy', () => {
    const game = setup()
    game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'wall', keywords: ['blocker'] }))
    const res = play(game)
    if (!res.ok) throw new Error(res.error)
    expect(chargeOf(hull(res.game))).toBe(2)
    expect(res.game.state.pendingEffect?.options.map((o) => o.id)).toEqual(['wall'])
    const done = applyAction(res.game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'wall' }, makeCtx())
    if (!done.ok) throw new Error(done.error)
    expect(chargeOf(hull(done.game))).toBe(2)
    expect((done.game.state.zones[0].cards.b[0] as ZoneCardEntry).stunnedUntilTurn).toBe(5)
    expect(done.game.state.log).toContain('Ampere gains 2 charge')
  })

  it('still lands charged in a lane with no enemy', () => {
    const res = play(setup())
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.pendingEffect).toBeNull()
    expect(chargeOf(hull(res.game))).toBe(2)
    expect(res.game.state.log).toContain('Ampere: no enemy vehicle in this zone to stun')
  })
})
```

`supabase/seed/balance/lh.balance.test.ts` — in `'LH:Ampere'`:

```ts
    cardText: 'When played, this gains 2 charge and stuns target enemy vehicle in this zone.',
    meta: { chargeMax: 2, onPlayEffect: 'ampereChargedStun' },
```

- [ ] **Step 2: Run them to verify they fail**

```powershell
npx vitest run shared/effects/lhRedesign.test.ts supabase/seed/balance/lh.balance.test.ts
```

Expected: FAIL.
- `ampereChargedStun` is unknown.
- The `LH:Ampere` row mismatches.

The pin on the old id PASSES already.

- [ ] **Step 3: The constant**

`shared/gameSettings.ts`, after `BYTE_PLAY_CHARGE`:

```ts
// 2026-09-22 hovercraft amendment. Ampere: "When played, this gains 2 charge
// and stuns …" — it lands full, so its pips can pay the same turn.
export const AMPERE_PLAY_CHARGE = 2
```

- [ ] **Step 4: Implement**

`shared/effects/lhEffects.ts`:
- Add `AMPERE_PLAY_CHARGE` to the `../gameSettings.ts` import.
- Change `import type { EffectFn } from './registry.ts'` to `import type { EffectFn, EffectPayload } from './registry.ts'`.

Replace the Byte on-play block (the comment starting "Byte — "When played, this gains 1 charge."" and its `registerEffect('byteChargeOnPlay', …)`):

```ts
// "When played, this gains N charge." PLAY_CARD_TO_ZONE places the hull before
// on-play effects fire, so it is on the board to charge; its own chargeMax
// caps the gain. Byte, Ampere and the Watt each call it under their own id.
function gainOwnCharge({ game, actor, card }: EffectPayload, amount: number): void {
  const found = findVehicle(game.state, card.instanceId)
  if (!found || found.side !== actor) return
  const gained = addCharge(found.entry as ZoneCardEntry, amount)
  if (gained > 0) game.state.log.push(`${card.name} gains ${gained} charge`)
}

// Byte — "When played, this gains 1 charge."
registerEffect('byteChargeOnPlay', (payload) => {
  gainOwnCharge(payload, BYTE_PLAY_CHARGE)
  return true
})
```

Replace the Ampere block (from `// Ampere — "When played, stun target …` through the closing `}))` of `registerEffect(AMPERE, …)`):

```ts
// Ampere — "When played, stun target enemy vehicle in this zone." On play
// only (R-10); enemyVehicleOptions applies Decoy in a mirror. No enemy in the
// lane: the play resolves with no stun and no refund. One factory for both
// ids, because a pending choice re-dispatches by the id it was offered under.
function ampereStunChoice(effect: string): EffectFn {
  return choice({
    effect,
    prompt: "Ampere's EMP salvo — choose an enemy vehicle in this zone to stun",
    options: ({ game, actor, targetZoneId }) => (
      typeof targetZoneId === 'number' ? enemyVehicleOptions(game, actor, targetZoneId) : []
    ),
    resolve: ({ game, actor, card }, choiceId) => {
      if (choiceId === null) {
        game.state.log.push(`${card.name}: no enemy vehicle in this zone to stun`)
        return true
      }
      const found = findVehicle(game.state, choiceId)
      if (!found || found.side !== otherSide(actor)) return false
      stunHull(game, found.entry as ZoneCardEntry)
      return true
    },
  })
}
registerEffect('ampereStun', ampereStunChoice('ampereStun'))

// 2026-09-22 hovercraft amendment §3 (docs/superpowers/specs/2026-09-22-lh-hovercraft-design.md):
// "When played, this gains 2 charge and stuns target enemy vehicle in this
// zone." A NEW id: dealt Amperes keep 'ampereStun' and enter empty. The charge
// lands on the FIRST entry only, before the stun is offered, so a lane with no
// enemy still charges and the pick's re-entry cannot charge twice.
const AMPERE_CHARGED = 'ampereChargedStun'
const ampereChargedStun = ampereStunChoice(AMPERE_CHARGED)
registerEffect(AMPERE_CHARGED, (payload) => {
  if (payload.resolution === undefined) gainOwnCharge(payload, AMPERE_PLAY_CHARGE)
  return ampereChargedStun(payload)
})
```

- [ ] **Step 5: Change the seed row**

`LH-Built-in.js` — replace the whole Ampere entry with:

```js
    {
        name: 'Ampere',
        isBuiltIn: true,
        cardText: 'When played, this gains 2 charge and stuns target enemy vehicle in this zone.',
        materialCost: 200000,
        blueprintCost: 206645,
        cpCost: 0,
        imageUrl: 'ampere.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.LH,
        blueprintId: null,
        keywords: [KEYWORDS.MOBILE],
        // 2026-09-22 hovercraft amendment: ampereChargedStun — it lands full.
        meta: { chargeMax: 2, [TRIGGERS.ON_PLAY]: 'ampereChargedStun' },
    },
```

- [ ] **Step 6: Record the orphan**

`supabase/seed/effectCoverage.test.ts`:
- In `DELIBERATE_ORPHANS`, after `ampereOnPlay`, add:

```ts
  ampereStun: '2026-09-22 hovercraft amendment: Ampere also gains 2 charge on play; ampereChargedStun replaced it (spec §3)',
```

- In the exact-list test, insert `'ampereStun',` directly after `'ampereOnPlay',`.

- [ ] **Step 7: Regenerate, sync, run the tests**

```powershell
npm run seed:build
npm run functions:sync
npx vitest run shared/effects/lhRedesign.test.ts supabase/seed
```

Expected: PASS. The existing `Byte — byteDraw` test and the old `Ampere — ampereStun` block still pass, unchanged.

- [ ] **Step 8: Commit**

```powershell
git add shared supabase
git commit -m @'
feat(lh): Ampere enters fully charged - ampereChargedStun

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 6: The Watt — Byte's draw, a Decoy Luxon token, and the Hovercraft type

**Files:**
- Modify: `shared/gameSettings.ts`, `shared/effects/lhEffects.ts`, `shared/effects/lhRedesign.test.ts`
- Modify: `supabase/seed/source/builtInCards/LH-Built-in.js` (Watt row), `supabase/seed/seed_data.sql`, `supabase/seed/balance/lh.balance.test.ts`

**Interfaces:**
- Consumes:
  - `gainOwnCharge` (Task 5)
  - `VEHICLE_TYPES.HOVER` (Task 1)
  - `spawnInto`, `catalogCard`, `poolEligible` (`primitives.ts`)
  - `grantKeywordsTo`, `revokeKeywordsFrom` (`gameEngine.ts`)
  - `zoneCapFor` (`zoneCapacity.ts`)
- Produces:
  - `export const WATT_PLAY_CHARGE = 1`
  - registry ids `wattOnPlay` (needsCatalog) and `wattDraw`

- [ ] **Step 1: Write the failing tests**

`shared/effects/lhRedesign.test.ts` — extend the imports:

```ts
import { applyAction, CATALOG_EFFECTS, chargeOf, discardCard, discardSnapshotOf } from '../engine/index.ts'
import { MAX_VEHICLES_PER_ZONE_SIDE } from '../gameSettings.ts'
import { inst, makeCtx, makeGame, snap, zoneEntry } from '../engine/testFixtures.ts'
```

Append:

```ts
// 2026-09-22 hovercraft amendment §3: Byte's draw moved here; the Decoy moved
// to a permanent Luxon token.
describe('Watt — wattOnPlay and wattDraw', () => {
  const luxon = () => snap({
    name: 'Luxon', faction: 'LH', vehicleType: 'plane', materialCost: 60000,
    keywords: ['halfCost', 'temporary'], meta: { deployRequiresLhVehicle: true },
  })
  const wattMeta = { chargeMax: 1, onPlayEffect: 'wattOnPlay', onActivate: 'wattDraw', activateCpCost: 0, dischargeCost: 1 }
  const setup = () => {
    const game = lhGame()
    game.privates.a.hand = [inst({
      instanceId: 'watt', name: 'Watt', faction: 'LH', vehicleType: 'hover', materialCost: 90000,
      keywords: ['scrappy', 'mobile'], meta: wattMeta,
    })]
    game.state.counts.a = { hand: 1, deck: 1 }
    return game
  }
  const play = (game: ReturnType<typeof makeGame>, ctx = makeCtx({ catalog: [luxon()] })) =>
    applyAction(game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: 'watt', zoneId: 1 }, ctx)

  it('asks for the catalog, so game-action loads it for a Watt play', () => {
    expect(CATALOG_EFFECTS.has('wattOnPlay')).toBe(true)
  })

  it('lands with its pip and launches a Luxon that has Decoy, is not Temporary, and is a token', () => {
    const res = play(setup())
    if (!res.ok) throw new Error(res.error)
    const [hull, escort] = res.game.state.zones[0].cards.a as ZoneCardEntry[]
    expect(hull.instanceId).toBe('watt')
    expect(chargeOf(hull)).toBe(1)
    expect(escort.name).toBe('Luxon')
    expect(escort.keywords).toEqual(['halfCost', 'decoy'])
    expect(escort.meta.summonOnly).toBe(true)
    expect(res.game.state.log).toContain('Watt gains 1 charge')
    expect(res.game.state.log).toContain('Watt launches a Luxon in zone 1 — it has Decoy and stays')
  })

  it('keeps its Luxon through a full round of turn starts', () => {
    const res = play(setup())
    if (!res.ok) throw new Error(res.error)
    const endedAlice = applyAction(res.game, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!endedAlice.ok) throw new Error(endedAlice.error)
    const ended = applyAction(endedAlice.game, 'bob', { type: 'END_TURN' }, makeCtx())
    if (!ended.ok) throw new Error(ended.error)
    expect(ended.game.state.zones[0].cards.a.map((c) => c.name)).toEqual(['Watt', 'Luxon'])
  })

  it('sends a dead Luxon nowhere — it never reaches the discard', () => {
    const res = play(setup())
    if (!res.ok) throw new Error(res.error)
    discardCard(res.game, 'a', res.game.state.zones[0].cards.a[1])
    expect(res.game.state.destroyed.a).toEqual([])
  })

  it('still lands and charges in a full lane, with no Luxon and a log line', () => {
    const game = setup()
    for (let i = 0; i < MAX_VEHICLES_PER_ZONE_SIDE - 1; i++) game.state.zones[0].cards.a.push(zoneEntry({ faction: 'LH' }))
    const res = play(game)
    if (!res.ok) throw new Error(res.error)
    const lane = res.game.state.zones[0].cards.a as ZoneCardEntry[]
    expect(lane).toHaveLength(MAX_VEHICLES_PER_ZONE_SIDE)
    expect(lane.some((c) => c.name === 'Luxon')).toBe(false)
    expect(chargeOf(lane.find((c) => c.instanceId === 'watt')!)).toBe(1)
    expect(res.game.state.log).toContain('Watt: no room in zone 1 for its Luxon')
  })

  it('fails the play when the catalog has no Luxon — a data bug, not an empty pool', () => {
    const game = setup()
    expect(play(game, makeCtx())).toMatchObject({ ok: false })
    expect(game.privates.a.hand.map((c) => c.instanceId)).toEqual(['watt'])
  })

  it('discharges its pip for a card', () => {
    const game = lhGame()
    game.state.zones[0].cards.a.push(zoneEntry({
      instanceId: 'watt', name: 'Watt', faction: 'LH', vehicleType: 'hover', keywords: ['scrappy', 'mobile'],
      meta: wattMeta, charge: 1,
    }))
    const res = activate(game, 'watt')
    if (!res.ok) throw new Error(res.error)
    expect(res.game.privates.a.hand.map((c) => c.name)).toEqual(['Spare'])
    expect(chargeOf(res.game.state.zones[0].cards.a[0] as ZoneCardEntry)).toBe(0)
  })
})
```

`supabase/seed/balance/lh.balance.test.ts`:
- Replace the `'LH:Watt'` entry:

```ts
  // 2026-09-22 hovercraft amendment: Byte's draw, a Decoy Luxon token, and the
  // Hovercraft type; the Watt itself no longer prints Decoy.
  'LH:Watt': {
    materialCost: 90_000, blueprintCost: 90_797, cpCost: 0, keywords: ['scrappy', 'mobile'], vehicleType: 'hover',
    cardText: 'When played, this gains 1 charge and a friendly Luxon spawns in this zone. That Luxon has Decoy and is not Temporary. Discharge 1: draw a card.',
    meta: { chargeMax: 1, onPlayEffect: 'wattOnPlay', onActivate: 'wattDraw', activateCpCost: 0, dischargeCost: 1 },
  },
```

- In "the six new-keyword and gate carriers read as intended", replace `expect(seed.get('LH:Watt')!.keywords).toContain('decoy')` with:

```ts
    // Decoy is no longer printed: the Watt's Luxon token takes it by grant (2026-09-22).
    expect(seed.get('LH:Watt')!.keywords).not.toContain('decoy')
```

- [ ] **Step 2: Run them to verify they fail**

```powershell
npx vitest run shared/effects/lhRedesign.test.ts supabase/seed/balance/lh.balance.test.ts
```

Expected: FAIL.
- `wattOnPlay` and `wattDraw` are unknown, so the plays and activation are refused, and `CATALOG_EFFECTS` lacks `wattOnPlay`.
- The `LH:Watt` row mismatches.

- [ ] **Step 3: The constant**

`shared/gameSettings.ts`, after `AMPERE_PLAY_CHARGE`:

```ts
// Watt: "When played, this gains 1 charge …" — Byte's draw moved here, so the
// pip can buy a card the turn it lands (2026-09-22 hovercraft amendment).
export const WATT_PLAY_CHARGE = 1
```

- [ ] **Step 4: Implement**

`shared/effects/lhEffects.ts`, imports:
- Add `WATT_PLAY_CHARGE` to the gameSettings import.
- Add `catalogCard, spawnInto` to the `./primitives.ts` import.
- Add `grantKeywordsTo` to the `../engine/gameEngine.ts` import.
- Add a new import: `import { zoneCapFor } from '../engine/zoneCapacity.ts'`.

Then, after the Data Burst registration, add:

```ts
// Watt — "When played, this gains 1 charge and a friendly Luxon spawns in this
// zone. That Luxon has Decoy and is not Temporary." (2026-09-22 hovercraft
// amendment §3.) Spawning is not playing: no payment, no blind-placement check,
// no on-play. The Decoy is a recorded grant and Temporary a recorded revoke —
// Extended Sortie's path, so the turn-start cull skips it. The Luxon is a
// TOKEN: stamped summonOnly, which discardCard refuses, so a dead one is gone
// instead of filing a free Luxon into the deck. No room in the lane → no
// Luxon, the room rule a card's printed extra copies follow. A catalog without
// Luxon is a data bug and fails the play (spawnVehicles' contract), checked
// before anything moves.
const WATT_ESCORT = 'Luxon'
registerEffect('wattOnPlay', (payload) => {
  const { game, actor, card, ctx } = payload
  const escortCard = catalogCard(ctx, WATT_ESCORT)
  if (!escortCard || !poolEligible(escortCard)) return false
  const self = findVehicle(game.state, card.instanceId)
  if (!self || self.side !== actor) return true
  gainOwnCharge(payload, WATT_PLAY_CHARGE)
  const zoneId = self.zone.id
  if (self.zone.cards[actor].length >= zoneCapFor(game.state, actor, zoneId)) {
    game.state.log.push(`${card.name}: no room in zone ${zoneId} for its Luxon`)
    return true
  }
  const escort = spawnInto(game, ctx, actor, zoneId, escortCard)
  if (!escort) return false
  grantKeywordsTo(escort, [KEYWORDS.DECOY])
  revokeKeywordsFrom(escort, [KEYWORDS.TEMPORARY])
  escort.meta = { ...escort.meta, summonOnly: true }
  game.state.log.push(`${card.name} launches a Luxon in zone ${zoneId} — it has Decoy and stays`)
  return true
}, { needsCatalog: true })

// Watt — "Discharge 1: draw a card." Byte's draw under the Watt's own id: no
// two cards share a registry name, however small the implementation
// (docs/claude/card-effects.md, rule 2).
registerEffect('wattDraw', grant({ draw: 1 }))
```

- [ ] **Step 5: Change the seed row**

`LH-Built-in.js` — replace the whole Watt entry. That also removes the old "Decoy's rule lives in the glossary … (R-6)" comment.

```js
    {
        name: 'Watt',
        isBuiltIn: true,
        cardText: 'When played, this gains 1 charge and a friendly Luxon spawns in this zone. That Luxon has Decoy and is not Temporary. Discharge 1: draw a card.',
        materialCost: 90000,
        blueprintCost: 90797,
        cpCost: 0,
        imageUrl: 'watt.png',
        playerId: null,
        // 2026-09-22 hovercraft amendment: a skimmer that hovers — it died when
        // FtD spawned it at the surface like a ship.
        vehicleType: VEHICLE_TYPES.HOVER,
        type: 'vehicle',
        faction: FACTIONS.LH,
        blueprintId: null,
        // Byte's draw moved here, and the Decoy moved to the permanent Luxon
        // token wattOnPlay spawns (R-6 amended).
        keywords: [KEYWORDS.SCRAPPY, KEYWORDS.MOBILE],
        meta: {
            chargeMax: 1, [TRIGGERS.ON_PLAY]: 'wattOnPlay',
            [TRIGGERS.ON_ACTIVATE]: 'wattDraw', activateCpCost: 0, dischargeCost: 1,
        },
    },
```

- [ ] **Step 6: Regenerate, sync, run the tests**

```powershell
npm run seed:build
npm run functions:sync
npx vitest run shared/effects/lhRedesign.test.ts supabase/seed shared/ai
```

Expected: PASS.
- `shared/ai` covers the bot decks: the Watt stays playable on the all-water board as a hover.
- `effectCoverage` G4: `wattOnPlay` and `wattDraw` are named by the Watt row.

- [ ] **Step 7: Commit**

```powershell
git add shared supabase
git commit -m @'
feat(lh): the Watt draws, launches a Decoy Luxon token, and hovers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 7: Roster — Byte and Hydrovolt retire, Anode arrives

**Files:**
- Modify:
  - `supabase/seed/source/builtInCards/LH-Built-in.js` (Byte, Hydrovolt, new Anode)
  - `supabase/seed/seed_data.sql`
- Modify:
  - `supabase/seed/balance/lh.balance.test.ts` (Anode row, RETIRED, roster counts)
  - `supabase/seed/retirement.test.ts`
- Modify:
  - `shared/shipProfiles/LH.ts` (regenerated)
  - `shared/shipProfiles.test.ts`
- Modify: `shared/ai/botDecks.ts`, `shared/ai/llm/factionNotes.ts`

**Interfaces:**
- Consumes: the Watt's draw (Task 6), Ampere's charge (Task 5), Umbra's beam (Task 4); the notes describe all three.
- Produces: seed rows `LH:Anode` (live) and `LH:Byte`/`LH:Hydrovolt` (retired); LH ship profiles 24.

- [ ] **Step 1: Write the failing tests**

`supabase/seed/balance/lh.balance.test.ts`:
- Delete the `'LH:Byte'` and `'LH:Hydrovolt'` entries from `CARDS`.
- Add after `'LH:Caspian'`:

```ts
  // 2026-09-22 hovercraft amendment: the Anode craft in Hydrovolt's role, at
  // Hydrovolt's price (FtD 363,765 — a 100k discount, owner's call).
  'LH:Anode': {
    materialCost: 260_000, blueprintCost: 363_765, cpCost: 0, keywords: ['blocker', 'subScreen'], vehicleType: 'sub',
    cardText: '', meta: { chargeMax: 2 },
  },
```

- Append `'LH:Byte', 'LH:Hydrovolt',` to `RETIRED`.
- In "roster shape", change the counts:
  - `toHaveLength(30)` → `29`
  - `toHaveLength(38)` → `39`
  - the vehicles `toHaveLength(25)` → `24`
- Update the comment to "28 + Faraday and Data Burst (2026-09-22 draw amendment); − Byte − Hydrovolt + Anode (2026-09-22 hovercraft amendment)".

`supabase/seed/retirement.test.ts`:
- Add `'LH:Byte',` and `'LH:Hydrovolt',` to `RETIRED`, keeping it alphabetical.
- Rename the test to "retires exactly the twenty-one cards named above".
- Add 2026-09-22 to the describe title.
- In "leaves the retired cards still naming their effects", add:

```ts
    expect(meta('LH:Byte').onPlayEffect).toBe('byteChargeOnPlay')
    expect(meta('LH:Byte').onActivate).toBe('byteDraw')
```

`shared/shipProfiles.test.ts` — in the report-order test, the LH lines become:

```ts
    expect(lh.map((p) => p.name).slice(0, 3)).toEqual(['Ampere', 'Angstrom', 'Candela'])
    expect(lh.at(-1)?.name).toBe('Quadrupole')
    expect(lh).toHaveLength(24) // 24 + Faraday − Byte − Hydrovolt + Anode (2026-09-22 amendments)
```

- [ ] **Step 2: Run them to verify they fail**

```powershell
npx vitest run supabase/seed shared/shipProfiles.test.ts
```

Expected: FAIL.
- Anode is missing from the seed source.
- Byte and Hydrovolt are not retired.
- The counts are off.
- The LH profile order and count are still the old ones.

- [ ] **Step 3: Change the seed rows**

`LH-Built-in.js`:
- **Byte:** replace its `meta` block with:

```js
        meta: {
            chargeMax: 1, [TRIGGERS.ON_PLAY]: 'byteChargeOnPlay',
            [TRIGGERS.ON_ACTIVATE]: 'byteDraw', activateCpCost: 0, dischargeCost: 1,
            // Retired by the 2026-09-22 hovercraft amendment: its draw moved to the Watt.
            retired: true,
        },
```

- **Hydrovolt:** replace `meta: { chargeMax: 2 },` with:

```js
        meta: {
            chargeMax: 2,
            // Retired by the 2026-09-22 hovercraft amendment: Anode took its role.
            retired: true,
        },
```

- **Anode:** insert directly after the Hydrovolt entry:

```js
    {
        // 2026-09-22 hovercraft amendment: the report's torpedo submarine with a
        // particle pod (363,765) in Hydrovolt's role, at Hydrovolt's price.
        name: 'Anode',
        isBuiltIn: true,
        cardText: '',
        materialCost: 260000,
        blueprintCost: 363765,
        cpCost: 0,
        imageUrl: 'anode.png',
        playerId: null,
        vehicleType: VEHICLE_TYPES.SUB,
        type: 'vehicle',
        faction: FACTIONS.LH,
        blueprintId: null,
        keywords: [KEYWORDS.BLOCKER, KEYWORDS.SUB_SCREEN],
        meta: { chargeMax: 2 },
    },
```

- [ ] **Step 4: Regenerate the seed and the LH profiles**

```powershell
npm run seed:build
npm run profiles:import -- "C:\Users\JFinn\FtDArmament\reports\LH.cards.md"
```

Expected console:
- `skipped … LH craft not in the seed (bench or retired): …`, with `Byte` and `Hydrovolt` in the list;
- then `24 LH profiles → …shared\shipProfiles\LH.ts`.

- [ ] **Step 5: The bot deck and the notes**

`shared/ai/botDecks.ts`:
- In `BOT_DECKS.LH`, replace `'Byte': 2,` with `'Watt': 2,` and `'Hydrovolt': 1,` with `'Anode': 1,`.
- Append to the comment above the LH deck:

```ts
  // 2026-09-22 hovercraft amendment: Byte retired, so both Watts came back
  // (Byte's draw moved to them); Anode replaced the retired Hydrovolt. Still
  // twenty cards, fliers 3 of 6 — a spawned Luxon is not a deck card.
```

`shared/ai/llm/factionNotes.ts` — replace the LH `text` and `mentions`. **No digits anywhere in the prose.**

```ts
  LH: {
    text: `- LH is the Lightning Hoods: fast laser, plasma and EMP craft. Your hulls carry CHARGE — a pip fills at the start of each of your turns up to the card's max, and a hull's "Discharge N" ability spends N of them. Charge is visible to both players and dies with the hull, so a charging hull is a threat your opponent will try to fleet-attack; keep it behind a Blocker (Kilowatt, Anode, Angstrom) or move it away with Mobile.
- Cheap pickets (Chrysoprase, Volta, Dipole) exist to bank pips. A "Drain N Charge" capital needs that many pips across your board and spends them when you play it, so keep the pickets alive and let them refill between capitals. Conduit adds one extra charge a turn to the other LH hulls in its lane; Volta and Overcharge add pips at once.
- Stun (Ampere on play, Penumbra at three pips, EMP Salvo) switches an enemy hull off through its next turn: it cannot attack, move, Block or Screen, and a Stealthy hull cannot withdraw. Stun a Blocker and bombard past it the same turn; stun a Stealthy hull and fleet-attack it. Ampere also lands fully charged, so spend its pips the turn you play it — on EMP Salvo, Data Burst or a Drain capital.
- Umbra shells the base past Blockers at two pips and stays Stealthy, so it keeps firing; Eclipse duels a chosen enemy at two pips. Fire a full hull rather than holding it unless you are saving its pips for a Drain capital.
- Draw keeps your hand full: the Watt enters holding a pip, so discharge it for a card the turn it lands and again each turn it lives, and it brings a permanent decoy plane that pulls enemy effects away from your other hulls; Faraday draws a card when played; Data Burst spends two pips from one hull for two cards. Turn spare pips into cards whenever no beam, stun or Drain needs them.
- Lasers stop at the water: play Anode's Sub Screen where enemy submarines would hurt.`,
    // Every card name the prose relies on, verbatim — a test pins each against the seed.
    mentions: [
      'Kilowatt', 'Anode', 'Angstrom', 'Chrysoprase', 'Volta', 'Dipole', 'Conduit',
      'Overcharge', 'Ampere', 'Penumbra', 'EMP Salvo', 'Umbra', 'Eclipse', 'Watt', 'Faraday', 'Data Burst',
    ],
  },
```

- [ ] **Step 6: Sync and run the tests**

```powershell
npm run functions:sync
npx vitest run supabase/seed shared/shipProfiles.test.ts shared/ai
```

Expected: PASS. This includes:
- `botDecks.test` (legal, no retired cards, playable on water, early plays);
- `factionNotes.test` (no digits; every mention seeded, live and in the deck);
- `rulesPrimer.test` (the LH roster lists the regenerated profiles);
- `functionSharedSync`.

- [ ] **Step 7: Commit**

```powershell
git add shared supabase
git commit -m @'
feat(lh): Byte and Hydrovolt retire, Anode arrives - bot deck, notes, profiles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 8: Gates, a browser look, and the hand-off

**Files:** none new; fixes only if a gate fails.

- [ ] **Step 1: The full suite, before → after**

```powershell
npx vitest run
```

Expected: all green. Report "Tests <baseline> → <now> passed", using Task 0's baseline.

- [ ] **Step 2: Every other gate**

```powershell
npx tsc -p tsconfig.json --noEmit
npm --prefix frontend run build
npm --prefix frontend run lint
npm run functions:check
npm run functions:sync; git status --short supabase/functions
npm run seed:build; git status --short supabase/seed/seed_data.sql
node scripts/verify-blueprint-mapping.mjs
git diff main...HEAD | Select-String -Pattern 'service_role|sb_secret|SUPABASE_SERVICE|BEGIN [A-Z ]*PRIVATE KEY|eyJhbGciOi'
```

Expected:
- **Typecheck, build, lint and `functions:check`:** no errors.
- **Both `git status` lines:** print nothing (sync and seed already committed).
- **Blueprint verifier:** `Unresolved : 0`, with Anode resolving to `LH/Anode`.
- **Secrets audit:** prints nothing.

- [ ] **Step 3: Browser check of the glossary (previewable now)**

The live cards table has no hover row until merge, so check the one place that shows a hovercraft today: the create-card page.
1. Start the `frontend` preview from `.claude/launch.json`, and read the bound port from its log.
2. Sign in with `node scripts/qa-login.mjs` (background), then `await window.__qaLogin()` in the page (docs/claude/testing.md).
3. Open `/cards/new` and pick `hover` in the type select. The preview card shows the hovercraft icon.
4. Confirm there are no console errors. Take a screenshot as proof.

- [ ] **Step 4: Hand off**

Use superpowers:finishing-a-development-branch. **Pushing and opening the PR are the owner's call.** Ask first.

The PR body lists:
- the spec;
- that the migration is already live (Task 3);
- the before → after count;
- the post-merge checklist below.

---

## After merge (controller, not a subagent)

1. The `seed-apply.yml` Actions run is green.
2. `npm run seed:verify` reports **194/194, drift 0**: 192 + Anode + Feedback Loop (PR #86).
3. game-action, lobby-action and create-card are redeployed, and their versions have bumped. Read them back **by content** through the Management API `/functions/<slug>/body` for:
   - `wattOnPlay`
   - `umbraBeam`
   - `ampereChargedStun`
   - `isShipClass`

   `HOVER_SPAWN_ALTITUDE_M` ships in the frontend bundle, not a function.
4. Netlify: the `PhysicalCard-*.js` chunk carries `LH:Anode`.
   - A `shared/`-only diff can skip the build; this one touches `frontend/`, so it should not.
   - Also grep the battle-launch chunk for `HOVER_SPAWN_ALTITUDE_M`'s value in the altitude sentence.
5. **Owner, in FtD:** check that the Watt and Terawatt hover at 20 m instead of dying. Then play live: the Luxon token, Ampere's pips and Umbra's repeat shots.
6. **Still unimplemented per the spec:** nothing. Moving other skimmers to Hovercraft stays open (spec §9) until one is seen dying.
