# Card Effect Coverage — Waves 0 & 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the card-effect coverage gap permanently measurable, then close the broken cards that need no new dispatch point — 33 of the 65, plus Excalibur's effect built ready for wave 3.

**Architecture:** A registry-backed effect system already exists. This plan adds (a) a build-time coverage guard that baselines all 65 known gaps and shrinks as they close, (b) two infrastructure repairs the later waves depend on, and (c) six parameterised effect factories in `shared/effects/primitives.ts` that 34 cards are wired to via ordinary per-card registry names. No new engine dispatch points are introduced — that is waves 2–5.

**Tech Stack:** TypeScript (strict), Vitest, Deno edge functions, Supabase Postgres. Pure-TS `shared/` runs in both the browser and Deno.

**Spec:** `docs/superpowers/specs/2026-08-27-effect-coverage-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- Tests run with `npx vitest run` from the repo root. **Never pass `--root`** — it silently runs 0 tests.
- **Every commit touching `shared/` must include `npm run functions:sync` output.** The drift test `supabase/seed/functionSharedSync.test.ts` fails otherwise.
- **Relative imports inside `shared/` require the `.ts` extension** — Deno runs those files verbatim inside edge functions.
- **Consumers import `shared/engine/index.ts`, never individual engine modules.** The barrel's side-effect imports populate the handler and effect registries.
- A new file under `shared/effects/` needs its side-effect import added to `shared/engine/index.ts` **and** an entry in `supabase/functions/shared-manifest.json` under `game-action`.
- **Public `state.log` must never name a card in a hidden hand or deck.** Both players see the log.
- All randomness via `ctx.rng()`; all ids via `ctx.newId()`. `Math.random()` and `crypto.randomUUID()` inside an effect break tests.
- Any effect that adds or removes cards in a private hand or deck must resync `game.state.counts[side]`. `drawCard` does it for you; direct pushes must do it manually.
- `effectiveCostInGame` (play-time, modifier-aware) and `effectiveMaterialCostOf` (damage, repairs, in-battle resources) are **different authorities**. Never mix them.
- Seed source changes require `npm run seed:build`, which rewrites `supabase/seed/seed_data.sql`. Commit both.
- Effect names are matched exactly after `.trim()`. Seeded data contains stray whitespace — always resolve through `effectName`.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `shared/effects/primitives.ts` | Parameterised effect factories and shared helpers. Registers nothing. |
| `shared/effects/primitives.test.ts` | Behavioural tests for each factory. |
| `shared/effects/owEffects.ts` | OW card registrations (also hosts `[GT] Osprey`'s faction-GT neighbours). |
| `shared/effects/ssEffects.ts` | SS card registrations. |
| `shared/effects/lhEffects.ts` | LH card registrations. |
| `shared/effects/wfEffects.ts` | WF card registrations. |
| `shared/effects/factionEffects.test.ts` | Per-card wiring tests for the four new faction modules. |
| `supabase/seed/effectCoverage.test.ts` | The G1/G2 coverage guard over real seed data. |

**Modified:**

| File | Change |
|---|---|
| `shared/effects/registry.ts` | `needsCatalog` registration flag; `noteUnimplemented` covers text-without-effect. |
| `shared/effects/dwgEffects.ts` | Marauder correction; Paddlegun and Ransack registrations; `needsCatalog` on the two catalog effects. |
| `shared/engine/placement.ts` | `costDelta` and Half-Cost suppression in `effectiveCostInGame`; surge spawns and `placedInstanceIds` in `PLAY_CARD_TO_ZONE`. |
| `shared/engine/index.ts` | Side-effect imports for the four new faction modules. |
| `supabase/functions/shared-manifest.json` | The five new `shared/effects/` files under `game-action`. |
| `supabase/functions/game-action/index.ts` | Broadened catalog probe. |
| `supabase/seed/source/builtInCards/*.js` | Meta keys for 34 cards + Marauder (see the per-task tables). |
| `docs/claude/card-effects.md` | Supersede the Marauder ruling; document the primitives and the guard. |

**Card → source file map** (source file and card faction are decoupled — `[GT] Osprey` is faction GT but lives in `OW-Built-in.js`):

| Source file | Wave-1 cards |
|---|---|
| `DWG-built-in.js` | Ransack, Paddlegun, Marauder |
| `LH-Built-in.js` | Coulomb, Ampere, Candela, Quadrupole, Conduit, Sapphire, Orbit |
| `OW-Built-in.js` | Mandrel, Rook, Claymore, Palisade, Bulwark, Mace, Javelin, Halberd, Jormangund, Partisan, Cauldron, Clydesdale, Garrison, [GT] Osprey |
| `SS-built-in.js` | Resolute, Maelstrom, Iron Maiden, Victoria, Trondheim, Rhea, PredatorX, Excalibur, Repairmen Ready |
| `WF-built-in.js` | Excruciator, Purifier |

Every silent card's source already has an empty block of exactly this shape, so each edit inserts lines inside it:

```js
        keywords: [KEYWORDS.SCRAPPY],
        meta: {
        }
```

---

# Wave 0 — Make the gap measurable

## Task 1: `needsCatalog` registration flag

`CATALOG_EFFECTS` is a hand-maintained `Set` in `registry.ts`. With ~15 catalog effects arriving it will drift from the implementations it describes, so derive it from registrations instead.

**Files:**
- Modify: `shared/effects/registry.ts`
- Modify: `shared/effects/dwgEffects.ts`
- Test: `shared/effects/registry.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `registerEffect(name: string, fn: EffectFn, opts?: { needsCatalog?: boolean }): void`; `CATALOG_EFFECTS: ReadonlySet<string>` (same export name, now derived).

- [ ] **Step 1: Write the failing test**

Append to `shared/effects/registry.test.ts`:

```ts
describe('needsCatalog registration flag', () => {
  it('adds flagged effects to CATALOG_EFFECTS and leaves unflagged ones out', () => {
    registerEffect('t_needsCatalog', () => true, { needsCatalog: true })
    registerEffect('t_plain', () => true)
    expect(CATALOG_EFFECTS.has('t_needsCatalog')).toBe(true)
    expect(CATALOG_EFFECTS.has('t_plain')).toBe(false)
  })

  it('still reports the two pre-existing catalog effects', () => {
    expect(CATALOG_EFFECTS.has('reservesEffect')).toBe(true)
    expect(CATALOG_EFFECTS.has('spawnBuccaneerEffect')).toBe(true)
  })
})
```

Make sure the file's import line includes `CATALOG_EFFECTS` and `registerEffect`, and that it imports `'./dwgEffects.ts'` for the second test:

```ts
import { CATALOG_EFFECTS, registerEffect } from './registry.ts'
import './dwgEffects.ts'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/effects/registry.test.ts`
Expected: FAIL — the second test fails because `CATALOG_EFFECTS` is currently a literal set that is not driven by registration, and the first fails because `registerEffect` takes no third argument.

- [ ] **Step 3: Write minimal implementation**

In `shared/effects/registry.ts`, replace the `CATALOG_EFFECTS` literal and `registerEffect`:

```ts
// Effects that need the built-in card catalog supplied via EngineContext.
// Derived from registration so it can never drift from the implementations.
const catalogEffects = new Set<string>()
export const CATALOG_EFFECTS: ReadonlySet<string> = catalogEffects

export function registerEffect(
  name: string, fn: EffectFn, opts?: { needsCatalog?: boolean },
): void {
  effects.set(name, fn)
  if (opts?.needsCatalog) catalogEffects.add(name)
}
```

In `shared/effects/dwgEffects.ts`, flag the two existing catalog effects. Change the closing line of `reservesEffect` from `})` to `}, { needsCatalog: true })`, and the same for `spawnBuccaneerEffect`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run`
Expected: PASS — 255+ tests, 22+ files. `game-action`'s `CATALOG_EFFECTS.has(...)` call site is unchanged because the export name and `.has` shape are preserved.

- [ ] **Step 5: Sync and commit**

```bash
npm run functions:sync
git add shared/effects/registry.ts shared/effects/registry.test.ts shared/effects/dwgEffects.ts supabase/functions
git commit -m "refactor(effects): derive CATALOG_EFFECTS from registration"
```

---

## Task 2: Silent no-op diagnostic

`noteUnimplemented` iterates meta keys, so a card with `meta: {}` has nothing to iterate and its card text is skipped in total silence. Add a second note for that case.

**Files:**
- Modify: `shared/effects/registry.ts`
- Test: `shared/effects/registry.test.ts`

**Interfaces:**
- Consumes: `registerEffect` from Task 1.
- Produces: `DATA_EFFECT_KEYS: readonly string[]` — meta keys that satisfy card text without naming an effect (`additionalSpawns`, `resourceSurge`).

- [ ] **Step 1: Write the failing test**

Append to `shared/effects/registry.test.ts`:

```ts
describe('noteUnimplemented — text with no effect name', () => {
  const note = (over: Partial<CardInstance>) => {
    const game = makeGame()
    noteUnimplemented(game, inst({ meta: {}, ...over }))
    return game.state.log
  }

  it('notes a card whose text names no effect at all', () => {
    expect(note({ name: 'Ransack', cardText: 'draw a card and gain 1cp.' }))
      .toEqual(['Ransack: its card text has no implemented effect yet — plays as vanilla'])
  })

  it('stays silent for a true vanilla card', () => {
    expect(note({ name: 'Tarpon', cardText: '' })).toEqual([])
  })

  it('stays silent when additionalSpawns satisfies the text', () => {
    expect(note({ name: 'Abactor', cardText: 'add an additional copy', meta: { additionalSpawns: 1 } }))
      .toEqual([])
  })

  it('stays silent when resourceSurge satisfies the text', () => {
    expect(note({
      name: 'PredatorX', cardText: 'loses its HALFCOST keyword',
      meta: { resourceSurge: { materialsOver: 120000, extraSpawns: 1 } },
    })).toEqual([])
  })

  it('does not add the second note when an unimplemented name was already reported', () => {
    const log = note({ name: 'Kraken', cardText: 'refresh a hero power', meta: { onPlayEffect: 'ghostEffect' } })
    expect(log).toEqual(['Kraken: effect "ghostEffect" is not implemented yet — plays as vanilla'])
  })

  it('stays silent when the card has a working effect', () => {
    expect(note({ name: 'Crossbones', cardText: 'draw a card', meta: { onPlayEffect: 'crossbonesOnPlay' } }))
      .toEqual([])
  })
})
```

Add to the file's imports:

```ts
import { noteUnimplemented } from './registry.ts'
import type { CardInstance } from '../engine/gameInit.ts'
import { inst, makeGame } from '../engine/testFixtures.ts'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/effects/registry.test.ts`
Expected: FAIL — the first test gets `[]` instead of the note; the `resourceSurge` test would pass only by accident today.

- [ ] **Step 3: Write minimal implementation**

In `shared/effects/registry.ts`, add the data-key list next to `ALL_META_KEYS` and rewrite `noteUnimplemented`:

```ts
// Meta keys that carry plain data rather than an effect name, and which
// satisfy a card's text on their own (spec §5).
export const DATA_EFFECT_KEYS = ['additionalSpawns', 'resourceSurge'] as const

// Spec §3.9: cards referencing unimplemented effects play as vanilla, with a
// note appended to the game log at play time. A card whose text names no
// effect at all gets its own note — otherwise it would fail in total silence.
export function noteUnimplemented(game: EngineGame, card: CardInstance): void {
  let namedAny = false
  let implementedAny = false
  for (const key of ALL_META_KEYS) {
    const name = effectName(card, key)
    if (name === null) continue
    namedAny = true
    if (isImplemented(name)) {
      implementedAny = true
      continue
    }
    game.state.log.push(`${card.name}: effect "${name}" is not implemented yet — plays as vanilla`)
  }
  if (namedAny || implementedAny) return
  const hasData = DATA_EFFECT_KEYS.some((k) => card.meta[k] !== undefined && card.meta[k] !== null)
  if (!hasData && card.cardText.trim() !== '') {
    game.state.log.push(`${card.name}: its card text has no implemented effect yet — plays as vanilla`)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run`
Expected: PASS. If `shared/engine/placement.test.ts` now fails on an unexpected extra log line, that is a real behaviour change — update those expectations to include the new note.

- [ ] **Step 5: Sync and commit**

```bash
npm run functions:sync
git add shared/effects/registry.ts shared/effects/registry.test.ts shared/engine/placement.test.ts supabase/functions
git commit -m "fix(effects): note cards whose text names no effect at all"
```

---

## Task 3: The coverage guard

Freeze the audit as a test. It ships **green** by baselining all 65 current gaps in a `KNOWN_GAPS` map; each later task deletes its own entries, and a third assertion rejects stale entries so the list can only shrink.

**Files:**
- Create: `supabase/seed/effectCoverage.test.ts`

**Interfaces:**
- Consumes: `effectName`, `isImplemented`, `DATA_EFFECT_KEYS` from Tasks 1–2.
- Produces: `KNOWN_GAPS` and `EXEMPT` maps, keyed `'FACTION:Card Name'`. Later tasks delete `KNOWN_GAPS` entries.

- [ ] **Step 1: Write the test file**

Create `supabase/seed/effectCoverage.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { loadSeedData } from './transform'
import { TRIGGERS } from '../../shared/gameSettings'
import '../../shared/engine/index'
import { DATA_EFFECT_KEYS, effectName, isImplemented } from '../../shared/effects/registry'

const ALL_META_KEYS = [...Object.values(TRIGGERS), 'costModifier']
const key = (c: { faction: string; name: string }) => `${c.faction}:${c.name}`

// Permanently exempt: card text that is player-conduct guidance for the spawn
// sheet, not a trigger. There is nothing for the engine to fire.
const EXEMPT: Record<string, string> = {
  'SS:Falcon Squadron': 'Robotic-shaped conduct text: players apply it when reporting results',
}

// 64 of the 65 gaps (Falcon Squadron is permanently EXEMPT above),
// baselined so the guard is green from day one. Delete entries as their wave
// lands — the third test rejects stale ones, so this list only shrinks.
const KNOWN_GAPS: Record<string, string> = {
  'DWG:Ransack': 'wave 1', 'OW:Mandrel': 'wave 1', 'OW:Rook': 'wave 1',
  'SS:Resolute': 'wave 1', 'WF:Excruciator': 'wave 1', 'OW:Claymore': 'wave 1',
  'OW:Palisade': 'wave 1', 'WF:Purifier': 'wave 1', 'OW:Bulwark': 'wave 1',
  'SS:Maelstrom': 'wave 1', 'OW:Mace': 'wave 1', 'DWG:Paddlegun': 'wave 1',
  'OW:Javelin': 'wave 1', 'SS:Iron Maiden': 'wave 1', 'SS:Victoria': 'wave 1',
  'SS:Trondheim': 'wave 1', 'LH:Coulomb': 'wave 1', 'LH:Ampere': 'wave 1',
  'LH:Candela': 'wave 1', 'LH:Quadrupole': 'wave 1', 'SS:Rhea': 'wave 1',
  'OW:Halberd': 'wave 1', 'OW:Jormangund': 'wave 1', 'OW:Partisan': 'wave 1',
  'OW:Cauldron': 'wave 1', 'LH:Conduit': 'wave 1', 'OW:Clydesdale': 'wave 1',
  'LH:Sapphire': 'wave 1', 'SS:PredatorX': 'wave 1', 'LH:Orbit': 'wave 1',
  'SS:Excalibur': 'wave 1', 'OW:Garrison': 'wave 1', 'SS:Repairmen Ready': 'wave 1',
  'GT:[GT] Osprey': 'wave 1',

  'GT:[GT] Hunchback': 'wave 2', 'GT:[GT] Monsoon': 'wave 2', 'LH:Spectrum': 'wave 2',
  'DWG:Kraken': 'wave 2', 'OW:Special Foundries': 'wave 2',
  'LH:Robotic Assemblers': 'wave 2', 'OW:Defensive Parapet': 'wave 2',
  'LH:Sapphire Screen': 'wave 2', 'WF:All for the Cause': 'wave 2',

  'DWG:Flying Squirrel Attack': 'wave 3', 'WF:Martyr Attack': 'wave 3',
  'SS:Air Strafe': 'wave 3', 'LH:Orbit Flank': 'wave 3', 'DWG:Gang Up': 'wave 3',
  'SS:Braveheart': 'wave 3', 'LH:Eclipse': 'wave 3', 'OW:Trebuchet': 'wave 3',

  'SS:Catshark': 'wave 4', 'SS:Dryad': 'wave 4', 'OW:The Onyx Throne': 'wave 4',
  'SS:Sacrilego': 'wave 4', 'OW:Iron Cordon': 'wave 4', 'LH:Terawatt': 'wave 4',
  'WF:Buzzsaw': 'wave 4', 'WF:Veles': 'wave 4',

  'WF:Ambush': 'wave 5', 'DWG:Ongoing Attrition': 'wave 5', 'OW:Sub Killer': 'wave 5',
  'DWG:Recurring Threat': 'wave 5', 'OW:Sabotage': 'wave 5',
}

function classify(card: { faction: string; name: string; cardText: string; meta?: unknown }) {
  const meta = (card.meta ?? {}) as Record<string, unknown>
  const names = ALL_META_KEYS
    .map((k) => effectName({ meta }, k))
    .filter((n): n is string => n !== null)
  const hasData = DATA_EFFECT_KEYS.some((k) => meta[k] !== undefined && meta[k] !== null)
  return {
    unimplemented: names.filter((n) => !isImplemented(n)),
    silent: (card.cardText ?? '').trim() !== '' && names.length === 0 && !hasData,
  }
}

describe('built-in card effect coverage', () => {
  it('G1: every effect name in meta resolves to a registered implementation', async () => {
    const { cards } = await loadSeedData()
    const offenders: string[] = []
    for (const card of cards.filter((c) => c.isBuiltIn)) {
      const { unimplemented } = classify(card)
      if (unimplemented.length > 0 && KNOWN_GAPS[key(card)] === undefined) {
        offenders.push(`${key(card)} → ${unimplemented.join(', ')}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('G2: every card with card text has an implemented effect, data key, or exemption', async () => {
    const { cards } = await loadSeedData()
    const offenders: string[] = []
    for (const card of cards.filter((c) => c.isBuiltIn)) {
      const { silent } = classify(card)
      if (silent && KNOWN_GAPS[key(card)] === undefined && EXEMPT[key(card)] === undefined) {
        offenders.push(key(card))
      }
    }
    expect(offenders).toEqual([])
  })

  it('KNOWN_GAPS contains no stale entries — delete a card once its wave lands', async () => {
    const { cards } = await loadSeedData()
    const byKey = new Map(cards.map((c) => [key(c), c]))
    const stale: string[] = []
    for (const k of Object.keys(KNOWN_GAPS)) {
      const card = byKey.get(k)
      if (!card) { stale.push(`${k} (no such card)`); continue }
      const { unimplemented, silent } = classify(card)
      if (unimplemented.length === 0 && !silent) stale.push(k)
    }
    expect(stale).toEqual([])
  })

  it('the gap is exactly 65 cards at wave 0', () => {
    expect(Object.keys(KNOWN_GAPS)).toHaveLength(64)
  })
})
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run supabase/seed/effectCoverage.test.ts`
Expected: PASS, 4 tests. If G1 or G2 reports offenders, a card is missing from `KNOWN_GAPS` — add it with its wave. If the stale test fires, a listed card is already fine — remove it.

- [ ] **Step 3: Delete the wave-0 count assertion's fragility**

The fourth test is a one-time tripwire proving the baseline matches the audit. Leave it in place for now; **Task 14 replaces it** with an assertion that wave 1's 34 entries are gone.

- [ ] **Step 4: Commit**

```bash
git add supabase/seed/effectCoverage.test.ts
git commit -m "test(seed): guard built-in card effect coverage, baselining 65 gaps"
```

---

## Task 4: Broaden the catalog probe

`game-action` loads the built-in catalog only when the played card **in hand** references a catalog effect. Death effects fire inside `DECIDE_BATTLE_REPORT`, which carries no `instanceId`, so Halberd, Jormangund and Partisan (Task 9) would receive an empty catalog and fail.

**Files:**
- Modify: `supabase/functions/game-action/index.ts:85-100`

**Interfaces:**
- Consumes: `CATALOG_EFFECTS` from Task 1.
- Produces: nothing importable — an edge-function behaviour change.

- [ ] **Step 1: Read the current block**

Run: `sed -n '85,101p' supabase/functions/game-action/index.ts`
Expected: the `needsCatalog` computation that only inspects `engineGame.privates[mySide].hand`.

- [ ] **Step 2: Replace it**

```ts
  // Load the built-in card catalog when any card that this action could fire
  // an effect on references a catalog effect. Scanning the played hand card
  // alone misses death effects (which fire during DECIDE_BATTLE_REPORT with
  // no instanceId) and on-field activated abilities.
  let catalog: SnapshotCard[] = []
  const mySide: Side = row.player_a === userId ? 'a' : 'b'
  const wantsCatalog = (card: { meta?: Record<string, unknown> } | undefined): boolean =>
    card !== undefined &&
    Object.values(card.meta ?? {}).some(
      (v) => typeof v === 'string' && CATALOG_EFFECTS.has(v.trim()),
    )

  const candidates: { meta?: Record<string, unknown> }[] = []
  const actionInstanceId = (action as { instanceId?: unknown }).instanceId
  if (typeof actionInstanceId === 'string') {
    const played = engineGame.privates[mySide].hand.find((c) => c.instanceId === actionInstanceId)
    if (played) candidates.push(played)
  }
  for (const zone of engineGame.state.zones) {
    candidates.push(...zone.cards.a, ...zone.cards.b)
  }

  if (candidates.some(wantsCatalog)) {
    const { data: cardRows, error: catalogError } = await admin.from('cards').select('*').eq('is_built_in', true)
    if (catalogError) return json(500, { errors: ['Failed to load the card catalog'] })
    catalog = (cardRows ?? []).map(snapshotCard)
  }
  const ctx = { rng: secureRng, newId: () => crypto.randomUUID(), catalog }
```

Both sides' on-field cards are scanned because `DECIDE_BATTLE_REPORT` fires death effects for **both** sides' destroyed participants.

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors. (The edge function is Deno-flavoured; if it is outside this tsconfig's `include`, confirm with `npx vitest run` staying green and rely on the deploy-time check.)

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/game-action/index.ts
git commit -m "fix(game-action): probe the catalog for on-field and death effects"
```

---

# Wave 1 — 34 cards, no new dispatch points

## Task 5: The `grant` primitive

**Files:**
- Create: `shared/effects/primitives.ts`
- Test: `shared/effects/primitives.test.ts`

**Interfaces:**
- Consumes: `EffectFn`, `EffectPayload` from `registry.ts`; `drawCard`, `otherSide` from `gameEngine.ts`.
- Produces:
  - `grant(spec: GrantSpec): EffectFn` where `GrantSpec = { draw?: number; cp?: number; materials?: number; from?: 'own' | 'enemy' }`
  - `takeFromEnemyDeck(game: EngineGame, actor: Side, ctx: EngineContext, filter?: (c: CardInstance) => boolean): boolean`
  - `sequence(...fns: EffectFn[]): EffectFn`

- [ ] **Step 1: Write the failing test**

Create `shared/effects/primitives.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { grant, sequence, takeFromEnemyDeck } from './primitives.ts'
import { inst, makeCtx, makeGame } from '../engine/testFixtures.ts'

describe('grant', () => {
  it('draws from your own deck and syncs counts', () => {
    const game = makeGame()
    game.privates.a.deck.push(inst({ name: 'Top' }), inst({ name: 'Next' }))
    expect(grant({ draw: 2 })({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['Top', 'Next'])
    expect(game.state.counts.a).toEqual({ hand: 2, deck: 0 })
  })

  it('grants CP and materials', () => {
    const game = makeGame()
    expect(grant({ cp: 2, materials: 30_000 })({ game, actor: 'b', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.state.resources.b.cp).toBe(5)
    expect(game.state.resources.b.materials).toBe(130_000)
  })

  it('combines draw and CP', () => {
    const game = makeGame()
    game.privates.a.deck.push(inst({ name: 'Top' }))
    expect(grant({ draw: 1, cp: 1 })({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.privates.a.hand).toHaveLength(1)
    expect(game.state.resources.a.cp).toBe(4)
  })

  it('draws from the enemy deck without naming the card, syncing both sides', () => {
    const game = makeGame()
    game.privates.b.deck.push(inst({ name: 'Enemy Secret' }))
    game.state.counts.b.deck = 1
    expect(grant({ draw: 1, from: 'enemy' })({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['Enemy Secret'])
    expect(game.privates.b.deck).toHaveLength(0)
    expect(game.state.counts.a.hand).toBe(1)
    expect(game.state.counts.b.deck).toBe(0)
    expect(game.state.log.join(' ')).not.toContain('Enemy Secret')
  })

  it('mints a fresh instanceId for a card taken from the enemy deck', () => {
    const game = makeGame()
    game.privates.b.deck.push(inst({ name: 'Enemy Secret', instanceId: 'enemy-1' }))
    grant({ draw: 1, from: 'enemy' })({ game, actor: 'a', card: inst(), ctx: makeCtx() })
    expect(game.privates.a.hand[0].instanceId).toBe('e-0')
  })

  it('resolves without failing when the enemy deck is empty', () => {
    const game = makeGame()
    expect(grant({ draw: 1, from: 'enemy' })({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.privates.a.hand).toHaveLength(0)
  })
})

describe('takeFromEnemyDeck', () => {
  it('takes the topmost card matching the filter, leaving the rest in order', () => {
    const game = makeGame()
    game.privates.b.deck.push(
      inst({ name: 'Ability', type: 'ability' }),
      inst({ name: 'Ship', type: 'vehicle' }),
      inst({ name: 'Ship Two', type: 'vehicle' }),
    )
    const ok = takeFromEnemyDeck(game, 'a', makeCtx(), (c) => c.type === 'vehicle')
    expect(ok).toBe(true)
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['Ship'])
    expect(game.privates.b.deck.map((c) => c.name)).toEqual(['Ability', 'Ship Two'])
  })
})

describe('sequence', () => {
  it('runs every effect in order', () => {
    const game = makeGame()
    game.privates.a.deck.push(inst({ name: 'Top' }))
    const fn = sequence(grant({ draw: 1 }), grant({ cp: 1 }))
    expect(fn({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.privates.a.hand).toHaveLength(1)
    expect(game.state.resources.a.cp).toBe(4)
  })

  it('stops and reports failure when a step fails', () => {
    const game = makeGame()
    const fn = sequence(() => false, grant({ cp: 1 }))
    expect(fn({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(false)
    expect(game.state.resources.a.cp).toBe(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/effects/primitives.test.ts`
Expected: FAIL — `Cannot find module './primitives.ts'`.

- [ ] **Step 3: Write minimal implementation**

Create `shared/effects/primitives.ts`:

```ts
import type { CardInstance } from '../engine/gameInit.ts'
import type { EngineContext, EngineGame, Side } from '../engine/engineTypes.ts'
import { drawCard, otherSide } from '../engine/gameEngine.ts'
import type { EffectFn } from './registry.ts'

// Move one card from the enemy's deck into the actor's hand. The log line
// must not name it — it is going into a hidden hand. A fresh instanceId is
// minted because the card is changing owners.
export function takeFromEnemyDeck(
  game: EngineGame, actor: Side, ctx: EngineContext,
  filter?: (card: CardInstance) => boolean,
): boolean {
  const enemy = otherSide(actor)
  const deck = game.privates[enemy].deck
  const index = filter ? deck.findIndex(filter) : (deck.length > 0 ? 0 : -1)
  if (index < 0) {
    game.state.log.push(`Player ${actor.toUpperCase()} finds nothing to take from the enemy deck`)
    return true
  }
  const [card] = deck.splice(index, 1)
  game.privates[actor].hand.push({ ...card, instanceId: ctx.newId() })
  game.state.counts[actor].hand = game.privates[actor].hand.length
  game.state.counts[enemy].deck = deck.length
  game.state.log.push(`Player ${actor.toUpperCase()} takes a card from the enemy deck`)
  return true
}

export interface GrantSpec {
  draw?: number
  cp?: number
  materials?: number
  from?: 'own' | 'enemy'
}

// Draw cards and/or add CP and materials. The workhorse: 17 built-in cards
// are nothing more than one of these.
export function grant(spec: GrantSpec): EffectFn {
  return ({ game, actor, ctx }) => {
    for (let i = 0; i < (spec.draw ?? 0); i++) {
      if (spec.from === 'enemy') takeFromEnemyDeck(game, actor, ctx)
      else drawCard(game, actor, ctx)
    }
    if (spec.cp) game.state.resources[actor].cp += spec.cp
    if (spec.materials) game.state.resources[actor].materials += spec.materials
    return true
  }
}

// Run effects in order, stopping at the first failure.
export function sequence(...fns: EffectFn[]): EffectFn {
  return (payload) => {
    for (const fn of fns) if (!fn(payload)) return false
    return true
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run`
Expected: PASS, all suites.

- [ ] **Step 5: Sync and commit**

```bash
npm run functions:sync
git add shared/effects/primitives.ts shared/effects/primitives.test.ts supabase/functions
git commit -m "feat(effects): add the grant primitive and enemy-deck draw helper"
```

Note: `functions:sync` will not copy `primitives.ts` until Task 6 adds it to the manifest. That is expected — the drift test only checks files the manifest lists.

---

## Task 6: Faction effect modules

Create the four new registration modules empty-but-wired, so Task 7 only has to add registrations. Wiring them is its own reviewable step because it touches the barrel and the manifest — the two places a missed entry causes a runtime "Unknown or not-yet-supported action" in Deno only.

**Files:**
- Create: `shared/effects/owEffects.ts`, `shared/effects/ssEffects.ts`, `shared/effects/lhEffects.ts`, `shared/effects/wfEffects.ts`
- Create: `shared/effects/factionEffects.test.ts`
- Modify: `shared/engine/index.ts`
- Modify: `supabase/functions/shared-manifest.json`

**Interfaces:**
- Consumes: `grant`, `sequence` from Task 5.
- Produces: four modules whose import registers their cards' effects. Task 7 fills them.

- [ ] **Step 1: Write the failing test**

Create `shared/effects/factionEffects.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { effectFor } from './registry.ts'
import '../engine/index.ts'

// Importing the engine barrel must register every faction's effects. If a
// module is missing its side-effect import there, Deno fails at runtime with
// "Unknown or not-yet-supported action" — this catches it in CI instead.
describe('faction effect modules are registered via the engine barrel', () => {
  it('registers a canary from each faction module', () => {
    expect(effectFor('mandrelOnPlay')).not.toBeNull()   // owEffects
    expect(effectFor('resoluteOnPlay')).not.toBeNull()  // ssEffects
    expect(effectFor('ampereOnPlay')).not.toBeNull()    // lhEffects
    expect(effectFor('purifierEffect')).not.toBeNull()  // wfEffects
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/effects/factionEffects.test.ts`
Expected: FAIL — all four are `null`.

- [ ] **Step 3: Create the four modules**

`shared/effects/owEffects.ts`:

```ts
import { grant } from './primitives.ts'
import { registerEffect } from './registry.ts'

// OW built-in card effects. Cards whose faction is GT but whose seed row
// lives in OW-Built-in.js are registered here too.
registerEffect('mandrelOnPlay', grant({ draw: 1 }))
```

`shared/effects/ssEffects.ts`:

```ts
import { grant } from './primitives.ts'
import { registerEffect } from './registry.ts'

// SS built-in card effects.
registerEffect('resoluteOnPlay', grant({ draw: 1 }))
```

`shared/effects/lhEffects.ts`:

```ts
import { grant } from './primitives.ts'
import { registerEffect } from './registry.ts'

// LH built-in card effects.
registerEffect('ampereOnPlay', grant({ draw: 1 }))
```

`shared/effects/wfEffects.ts`:

```ts
import { grant } from './primitives.ts'
import { registerEffect } from './registry.ts'

// WF built-in card effects.
registerEffect('purifierEffect', grant({ draw: 1 }))
```

`ampereOnPlay` is a placeholder body here; Task 9 replaces it with `drawFromPool`.

- [ ] **Step 4: Wire the barrel**

In `shared/engine/index.ts`, replace the final line with:

```ts
export * from '../effects/registry.ts'
import '../effects/dwgEffects.ts'
import '../effects/owEffects.ts'
import '../effects/ssEffects.ts'
import '../effects/lhEffects.ts'
import '../effects/wfEffects.ts'
```

- [ ] **Step 5: Wire the manifest**

In `supabase/functions/shared-manifest.json`, extend the `game-action` array. It currently ends with `"effects/dwgEffects.ts"`; make that:

```json
    "effects/registry.ts",
    "effects/primitives.ts",
    "effects/dwgEffects.ts",
    "effects/owEffects.ts",
    "effects/ssEffects.ts",
    "effects/lhEffects.ts",
    "effects/wfEffects.ts"
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run functions:sync && npx vitest run`
Expected: PASS. The drift test now also checks the five new files.

- [ ] **Step 7: Commit**

```bash
git add shared/effects shared/engine/index.ts supabase/functions
git commit -m "feat(effects): add OW/SS/LH/WF effect modules and wire the barrel"
```

---

## Task 7: Wire the 17 `grant` cards

**Files:**
- Modify: `shared/effects/owEffects.ts`, `ssEffects.ts`, `lhEffects.ts`, `wfEffects.ts`, `dwgEffects.ts`
- Modify: `supabase/seed/source/builtInCards/{DWG-built-in,OW-Built-in,SS-built-in,LH-Built-in,WF-built-in}.js`
- Modify: `supabase/seed/effectCoverage.test.ts`
- Test: `shared/effects/factionEffects.test.ts`

**Interfaces:**
- Consumes: `grant` from Task 5; the four modules from Task 6.
- Produces: 17 registry names, listed in the table below.

- [ ] **Step 1: Write the failing tests**

Replace the body of `shared/effects/factionEffects.test.ts` with:

```ts
import { describe, expect, it } from 'vitest'
import { effectFor } from './registry.ts'
import { inst, makeCtx, makeGame } from '../engine/testFixtures.ts'
import '../engine/index.ts'

const DRAW_ONE = [
  'mandrelOnPlay', 'rookOnPlay', 'resoluteOnPlay', 'excruciatorOnPlay',
  'claymoreEffect', 'palisadeEffect', 'purifierEffect',
  'javelinOnDeath', 'ironMaidenOnDeath', 'victoriaOnDeath',
  'trondheimOnDeath', 'coulombEffect',
]
const CP_ONLY: [string, number][] = [
  ['bulwarkOnPlay', 2], ['maelstromOnPlay', 1], ['maceEffect', 1],
]

describe('grant-backed cards', () => {
  it.each(DRAW_ONE)('%s draws exactly one card', (name) => {
    const game = makeGame()
    game.privates.a.deck.push(inst({ name: 'Top' }), inst({ name: 'Next' }))
    expect(effectFor(name)!({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['Top'])
    expect(game.state.counts.a).toEqual({ hand: 1, deck: 1 })
  })

  it.each(CP_ONLY)('%s grants %i CP and draws nothing', (name, cp) => {
    const game = makeGame()
    game.privates.a.deck.push(inst({ name: 'Top' }))
    expect(effectFor(name)!({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.state.resources.a.cp).toBe(3 + cp)
    expect(game.privates.a.hand).toHaveLength(0)
  })

  it('ransackOnPlay draws a card and grants 1 CP', () => {
    const game = makeGame()
    game.privates.a.deck.push(inst({ name: 'Top' }))
    expect(effectFor('ransackOnPlay')!({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.privates.a.hand).toHaveLength(1)
    expect(game.state.resources.a.cp).toBe(4)
  })

  it('paddlegunEffect draws from the ENEMY deck', () => {
    const game = makeGame()
    game.privates.a.deck.push(inst({ name: 'Own Top' }))
    game.privates.b.deck.push(inst({ name: 'Enemy Top' }))
    expect(effectFor('paddlegunEffect')!({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['Enemy Top'])
    expect(game.privates.a.deck.map((c) => c.name)).toEqual(['Own Top'])
    expect(game.state.log.join(' ')).not.toContain('Enemy Top')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run shared/effects/factionEffects.test.ts`
Expected: FAIL — most names return `null`; `paddlegunEffect` is unregistered.

- [ ] **Step 3: Add the registrations**

`shared/effects/owEffects.ts` — replace its single registration with:

```ts
registerEffect('mandrelOnPlay', grant({ draw: 1 }))
registerEffect('rookOnPlay', grant({ draw: 1 }))
registerEffect('claymoreEffect', grant({ draw: 1 }))
registerEffect('palisadeEffect', grant({ draw: 1 }))
registerEffect('javelinOnDeath', grant({ draw: 1 }))
registerEffect('bulwarkOnPlay', grant({ cp: 2 }))
registerEffect('maceEffect', grant({ cp: 1 }))
```

`shared/effects/ssEffects.ts`:

```ts
registerEffect('resoluteOnPlay', grant({ draw: 1 }))
registerEffect('ironMaidenOnDeath', grant({ draw: 1 }))
registerEffect('victoriaOnDeath', grant({ draw: 1 }))
registerEffect('trondheimOnDeath', grant({ draw: 1 }))
registerEffect('maelstromOnPlay', grant({ cp: 1 }))
```

`shared/effects/lhEffects.ts` — keep `ampereOnPlay` for now and add:

```ts
registerEffect('coulombEffect', grant({ draw: 1 }))
```

`shared/effects/wfEffects.ts`:

```ts
registerEffect('purifierEffect', grant({ draw: 1 }))
registerEffect('excruciatorOnPlay', grant({ draw: 1 }))
```

`shared/effects/dwgEffects.ts` — add below the existing `crossbonesOnPlay` line, importing `grant` from `'./primitives.ts'`:

```ts
registerEffect('ransackOnPlay', grant({ draw: 1, cp: 1 }))
registerEffect('paddlegunEffect', grant({ draw: 1, from: 'enemy' }))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run shared/effects/factionEffects.test.ts`
Expected: PASS, 17 cases.

- [ ] **Step 5: Add the meta keys to the seed source**

For each card below, find its object in the named file and add the line inside its empty `meta: {` / `}` block. Cards marked *(exists)* already carry the name — leave them untouched.

| Card | Source file | Meta line to add |
|---|---|---|
| Ransack | `DWG-built-in.js` | `[TRIGGERS.ON_PLAY]: 'ransackOnPlay',` |
| Paddlegun | `DWG-built-in.js` | *(exists)* `onPlayEffect: 'paddlegunEffect'` |
| Mandrel | `OW-Built-in.js` | `[TRIGGERS.ON_PLAY]: 'mandrelOnPlay',` |
| Rook | `OW-Built-in.js` | `[TRIGGERS.ON_PLAY]: 'rookOnPlay',` |
| Claymore | `OW-Built-in.js` | *(exists)* |
| Palisade | `OW-Built-in.js` | *(exists)* |
| Bulwark | `OW-Built-in.js` | `[TRIGGERS.ON_PLAY]: 'bulwarkOnPlay',` |
| Mace | `OW-Built-in.js` | *(exists)* |
| Javelin | `OW-Built-in.js` | `[TRIGGERS.ON_DEATH]: 'javelinOnDeath',` |
| Resolute | `SS-built-in.js` | `[TRIGGERS.ON_PLAY]: 'resoluteOnPlay',` |
| Maelstrom | `SS-built-in.js` | `[TRIGGERS.ON_PLAY]: 'maelstromOnPlay',` |
| Iron Maiden | `SS-built-in.js` | `[TRIGGERS.ON_DEATH]: 'ironMaidenOnDeath',` |
| Victoria | `SS-built-in.js` | `[TRIGGERS.ON_DEATH]: 'victoriaOnDeath',` |
| Trondheim | `SS-built-in.js` | `[TRIGGERS.ON_DEATH]: 'trondheimOnDeath',` |
| Coulomb | `LH-Built-in.js` | *(exists)* |
| Excruciator | `WF-built-in.js` | `[TRIGGERS.ON_PLAY]: 'excruciatorOnPlay',` |
| Purifier | `WF-built-in.js` | *(exists)* |

Worked example — Ransack in `DWG-built-in.js` goes from:

```js
        keywords: [KEYWORDS.SCRAPPY],
        meta: {
        }
```

to:

```js
        keywords: [KEYWORDS.SCRAPPY],
        meta: {
            [TRIGGERS.ON_PLAY]: 'ransackOnPlay',
        }
```

All five files already import `TRIGGERS` from `"../gameSettings"`, so no import changes are needed.

**Constraint check — decision 2:** none of the four new `onDeathEffect` cards may carry `SCRAPPY`. Verify before proceeding:

```bash
grep -A14 "name: 'Javelin'\|name: 'Iron Maiden'\|name: 'Victoria'\|name: 'Trondheim'" supabase/seed/source/builtInCards/*.js | grep -i "scrappy"
```

Expected: no output. If any match appears, stop and report it — a Scrappy card with a beneficial death trigger is silently unreachable.

- [ ] **Step 6: Rebuild the seed and shrink the guard**

```bash
npm run seed:build
```

Then delete these 17 keys from `KNOWN_GAPS` in `supabase/seed/effectCoverage.test.ts`:

`DWG:Ransack`, `DWG:Paddlegun`, `OW:Mandrel`, `OW:Rook`, `OW:Claymore`, `OW:Palisade`, `OW:Bulwark`, `OW:Mace`, `OW:Javelin`, `SS:Resolute`, `SS:Maelstrom`, `SS:Iron Maiden`, `SS:Victoria`, `SS:Trondheim`, `LH:Coulomb`, `WF:Excruciator`, `WF:Purifier`

Also change the last test's expectation from `64` to `47`:

```ts
  it('the gap shrinks as waves land', () => {
    expect(Object.keys(KNOWN_GAPS)).toHaveLength(47)
  })
```

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run`
Expected: PASS. The stale-entry test proves all 17 are genuinely closed; if any is still listed, it reports the key.

- [ ] **Step 8: Sync and commit**

```bash
npm run functions:sync
git add shared/effects supabase/seed supabase/functions
git commit -m "feat(effects): wire 17 draw/CP cards to the grant primitive"
```

---

## Task 8: The `drawFromPool` primitive

**Files:**
- Modify: `shared/effects/primitives.ts`
- Test: `shared/effects/primitives.test.ts`

**Interfaces:**
- Consumes: `grant` from Task 5.
- Produces: `drawFromPool(spec: PoolSpec): EffectFn` where

```ts
interface PoolFilter {
  faction?: string; vehicleType?: string; type?: string
  isBuiltIn?: boolean; maxCost?: number; minCost?: number
}
interface PoolSpec {
  source: 'catalog' | 'deck'
  filter: PoolFilter
  count: number
  strip?: string[]
  allowEmpty?: boolean   // default false
}
```

- [ ] **Step 1: Write the failing test**

Append to `shared/effects/primitives.test.ts`:

```ts
import { drawFromPool } from './primitives.ts'
import { snap } from '../engine/testFixtures.ts'

describe('drawFromPool — catalog source', () => {
  const catalog = [
    snap({ name: 'TG One', faction: 'TG', type: 'vehicle', materialCost: 330_000 }),
    snap({ name: 'TG Two', faction: 'TG', type: 'vehicle', materialCost: 600_000 }),
    snap({ name: 'DWG Ship', faction: 'DWG', type: 'vehicle', materialCost: 40_000 }),
  ]

  it('adds one filtered card to hand with a fresh id and syncs counts', () => {
    const game = makeGame()
    const fn = drawFromPool({ source: 'catalog', filter: { faction: 'TG' }, count: 1 })
    expect(fn({ game, actor: 'a', card: inst(), ctx: makeCtx({ catalog }) })).toBe(true)
    expect(game.privates.a.hand).toHaveLength(1)
    expect(game.privates.a.hand[0].name).toMatch(/^TG /)
    expect(game.privates.a.hand[0].instanceId).toBe('e-0')
    expect(game.state.counts.a.hand).toBe(1)
  })

  it('never names the drawn card in the log', () => {
    const game = makeGame()
    drawFromPool({ source: 'catalog', filter: { faction: 'TG' }, count: 1 })(
      { game, actor: 'a', card: inst(), ctx: makeCtx({ catalog }) },
    )
    expect(game.state.log.join(' ')).not.toContain('TG One')
    expect(game.state.log.join(' ')).not.toContain('TG Two')
  })

  it('is deterministic under a seeded rng', () => {
    const pick = () => {
      const game = makeGame()
      drawFromPool({ source: 'catalog', filter: { faction: 'TG' }, count: 1 })(
        { game, actor: 'a', card: inst(), ctx: makeCtx({ catalog }) },
      )
      return game.privates.a.hand[0].name
    }
    expect(pick()).toBe(pick())
  })

  it('respects maxCost and strips requested keywords', () => {
    const planes = [
      snap({ name: 'Cheap Plane', faction: 'SS', vehicleType: 'plane', materialCost: 120_000, keywords: ['halfCost', 'temporary'] }),
      snap({ name: 'Dear Plane', faction: 'SS', vehicleType: 'plane', materialCost: 400_000, keywords: ['temporary'] }),
    ]
    const game = makeGame()
    const fn = drawFromPool({
      source: 'catalog', filter: { faction: 'SS', vehicleType: 'plane', maxCost: 299_999 },
      count: 1, strip: ['temporary'],
    })
    expect(fn({ game, actor: 'a', card: inst(), ctx: makeCtx({ catalog: planes }) })).toBe(true)
    expect(game.privates.a.hand[0].name).toBe('Cheap Plane')
    expect(game.privates.a.hand[0].keywords).toEqual(['halfCost'])
  })

  it('fails when the catalog pool is empty and allowEmpty is not set', () => {
    const game = makeGame()
    const fn = drawFromPool({ source: 'catalog', filter: { faction: 'TG' }, count: 1 })
    expect(fn({ game, actor: 'a', card: inst(), ctx: makeCtx({ catalog: [] }) })).toBe(false)
  })
})

describe('drawFromPool — deck source', () => {
  it('moves a matching card out of your own deck into your hand', () => {
    const game = makeGame()
    game.privates.a.deck.push(
      inst({ name: 'Ship', vehicleType: 'ship' }),
      inst({ name: 'Sub', vehicleType: 'sub' }),
    )
    const fn = drawFromPool({ source: 'deck', filter: { vehicleType: 'sub' }, count: 1, allowEmpty: true })
    expect(fn({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['Sub'])
    expect(game.privates.a.deck.map((c) => c.name)).toEqual(['Ship'])
    expect(game.state.counts.a).toEqual({ hand: 1, deck: 1 })
  })

  it('keeps the card instanceId when moving within your own zones', () => {
    const game = makeGame()
    game.privates.a.deck.push(inst({ name: 'Sub', vehicleType: 'sub', instanceId: 'mine-1' }))
    drawFromPool({ source: 'deck', filter: { vehicleType: 'sub' }, count: 1, allowEmpty: true })(
      { game, actor: 'a', card: inst(), ctx: makeCtx() },
    )
    expect(game.privates.a.hand[0].instanceId).toBe('mine-1')
  })

  it('resolves with a log note when the deck holds no match and allowEmpty is set', () => {
    const game = makeGame()
    const fn = drawFromPool({ source: 'deck', filter: { vehicleType: 'sub' }, count: 1, allowEmpty: true })
    expect(fn({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.privates.a.hand).toHaveLength(0)
    expect(game.state.log).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/effects/primitives.test.ts`
Expected: FAIL — `drawFromPool` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `shared/effects/primitives.ts`:

```ts
export interface PoolFilter {
  faction?: string
  vehicleType?: string
  type?: string
  isBuiltIn?: boolean
  maxCost?: number
  minCost?: number
}

export interface PoolSpec {
  source: 'catalog' | 'deck'
  filter: PoolFilter
  count: number
  strip?: string[]
  // Catalog pools that come up empty are a data bug and fail. Deck pools are
  // often legitimately empty ("if you have one"), so those opt into a note.
  allowEmpty?: boolean
}

// Cost filters read the printed materialCost — "base cost" in card text —
// never effectiveMaterialCostOf.
function matches(card: { faction: string; vehicleType: string | null; type: string; isBuiltIn: boolean; materialCost: number }, f: PoolFilter): boolean {
  if (f.faction !== undefined && card.faction !== f.faction) return false
  if (f.vehicleType !== undefined && card.vehicleType !== f.vehicleType) return false
  if (f.type !== undefined && card.type !== f.type) return false
  if (f.isBuiltIn !== undefined && card.isBuiltIn !== f.isBuiltIn) return false
  if (f.maxCost !== undefined && card.materialCost > f.maxCost) return false
  if (f.minCost !== undefined && card.materialCost < f.minCost) return false
  return true
}

function shuffled<T>(items: T[], ctx: EngineContext): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.rng() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

// Put `count` cards matching `filter` into the actor's hand, either minted
// from the built-in catalog or moved out of the actor's own deck. The log
// never names them — they are entering a hidden hand.
export function drawFromPool(spec: PoolSpec): EffectFn {
  return ({ game, actor, ctx }) => {
    const hand = game.privates[actor].hand
    if (spec.source === 'catalog') {
      const pool = ctx.catalog.filter((c) => c.isBuiltIn && matches(c, spec.filter))
      if (pool.length === 0) {
        if (!spec.allowEmpty) return false
        game.state.log.push(`Player ${actor.toUpperCase()} finds no matching card`)
        return true
      }
      for (const pick of shuffled(pool, ctx).slice(0, spec.count)) {
        hand.push({
          ...pick,
          instanceId: ctx.newId(),
          keywords: spec.strip ? pick.keywords.filter((k) => !spec.strip!.includes(k)) : pick.keywords,
        })
      }
    } else {
      const deck = game.privates[actor].deck
      const pool = deck.filter((c) => matches(c, spec.filter))
      if (pool.length === 0) {
        if (!spec.allowEmpty) return false
        game.state.log.push(`Player ${actor.toUpperCase()} finds no matching card in their deck`)
        return true
      }
      for (const pick of shuffled(pool, ctx).slice(0, spec.count)) {
        const index = deck.findIndex((c) => c.instanceId === pick.instanceId)
        if (index < 0) continue
        const [card] = deck.splice(index, 1)
        hand.push(spec.strip ? { ...card, keywords: card.keywords.filter((k) => !spec.strip!.includes(k)) } : card)
      }
      game.privates[actor].deck = deck
    }
    game.state.counts[actor] = { hand: hand.length, deck: game.privates[actor].deck.length }
    game.state.log.push(`Player ${actor.toUpperCase()} adds a card to their hand`)
    return true
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Sync and commit**

```bash
npm run functions:sync
git add shared/effects supabase/functions
git commit -m "feat(effects): add the drawFromPool primitive"
```

---

## Task 9: Wire the 9 `drawFromPool` cards

**Files:**
- Modify: `shared/effects/lhEffects.ts`, `ssEffects.ts`, `owEffects.ts`
- Modify: `shared/gameSettings.ts`
- Modify: `supabase/seed/source/builtInCards/{LH-Built-in,SS-built-in,OW-Built-in}.js`
- Modify: `supabase/seed/effectCoverage.test.ts`
- Test: `shared/effects/factionEffects.test.ts`

**Interfaces:**
- Consumes: `drawFromPool` from Task 8; `registerEffect(..., { needsCatalog: true })` from Task 1.
- Produces: `RHEA_MAX_PLANE_COST`, `GT_HEAVY_AIRSHIP_MIN_COST` in `shared/gameSettings.ts`.

- [ ] **Step 1: Add the constants**

Append to `shared/gameSettings.ts`:

```ts
export const RHEA_MAX_PLANE_COST = 300_000 // Rhea: "base cost under 300k" (exclusive)
export const GT_HEAVY_AIRSHIP_MIN_COST = 400_000 // spec §7.3: the GT airship cost cliff
```

- [ ] **Step 2: Write the failing test**

Append to `shared/effects/factionEffects.test.ts`:

```ts
import { snap } from '../engine/testFixtures.ts'

describe('drawFromPool-backed cards', () => {
  const catalog = [
    snap({ name: 'TG Obsession', faction: 'TG', type: 'vehicle', materialCost: 330_000 }),
    snap({ name: 'Warbird', faction: 'GT', vehicleType: 'airship', materialCost: 190_000 }),
    snap({ name: 'Nimbus', faction: 'GT', vehicleType: 'airship', materialCost: 530_000 }),
    snap({ name: 'PredatorX', faction: 'SS', vehicleType: 'plane', materialCost: 120_000, keywords: ['halfCost', 'temporary'] }),
    snap({ name: 'Hydra', faction: 'SS', vehicleType: 'airship', materialCost: 230_000 }),
  ]

  it.each(['ampereOnPlay', 'candelaOnPlay', 'quadrupoleOnPlay'])(
    '%s draws a TG Robotics card',
    (name) => {
      const game = makeGame()
      expect(effectFor(name)!({ game, actor: 'a', card: inst(), ctx: makeCtx({ catalog }) })).toBe(true)
      expect(game.privates.a.hand.map((c) => c.faction)).toEqual(['TG'])
    },
  )

  it.each(['halberdOnDeath', 'jormangundOnDeath', 'partisanEffect'])(
    '%s draws a GT airship',
    (name) => {
      const game = makeGame()
      expect(effectFor(name)!({ game, actor: 'a', card: inst(), ctx: makeCtx({ catalog }) })).toBe(true)
      const drawn = game.privates.a.hand[0]
      expect(drawn.faction).toBe('GT')
      expect(drawn.vehicleType).toBe('airship')
    },
  )

  it('rheaOnPlay draws a sub-300k SS plane and strips its temporary keyword', () => {
    const game = makeGame()
    expect(effectFor('rheaOnPlay')!({ game, actor: 'a', card: inst(), ctx: makeCtx({ catalog }) })).toBe(true)
    expect(game.privates.a.hand[0].name).toBe('PredatorX')
    expect(game.privates.a.hand[0].keywords).toEqual(['halfCost'])
  })

  it('cauldronEffect pulls a submarine out of your own deck', () => {
    const game = makeGame()
    game.privates.a.deck.push(inst({ name: 'My Sub', vehicleType: 'sub' }), inst({ name: 'My Ship' }))
    expect(effectFor('cauldronEffect')!({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['My Sub'])
  })

  it('cauldronEffect resolves when you have no submarine', () => {
    const game = makeGame()
    game.privates.a.deck.push(inst({ name: 'My Ship' }))
    expect(effectFor('cauldronEffect')!({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.privates.a.hand).toHaveLength(0)
  })

  it('conduitEffect pulls a player-made ship or tank out of your own deck', () => {
    const game = makeGame()
    game.privates.a.deck.push(
      inst({ name: 'Built-in Ship', isBuiltIn: true, vehicleType: 'ship' }),
      inst({ name: 'Custom Ship', isBuiltIn: false, vehicleType: 'ship' }),
    )
    expect(effectFor('conduitEffect')!({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['Custom Ship'])
  })
})
```

`conduitEffect` needs to accept ship **or** tank, which a single `vehicleType` filter cannot express — the implementation below composes two pool draws behind one name rather than widening `PoolFilter` for one card.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run shared/effects/factionEffects.test.ts`
Expected: FAIL — the pool-backed names are unregistered or still bound to the Task 6 placeholder.

- [ ] **Step 4: Write the registrations**

`shared/effects/lhEffects.ts` — replace the placeholder `ampereOnPlay` and add:

Throughout these tasks, **merge new imports into each module's existing import lines** rather than appending duplicate `import` statements from the same specifier.

```ts
import { drawFromPool, grant } from './primitives.ts'
import type { EffectFn } from './registry.ts'
import { registerEffect } from './registry.ts'

const tgRobotics = drawFromPool({ source: 'catalog', filter: { faction: 'TG' }, count: 1 })
registerEffect('ampereOnPlay', tgRobotics, { needsCatalog: true })
registerEffect('candelaOnPlay', tgRobotics, { needsCatalog: true })
registerEffect('quadrupoleOnPlay', tgRobotics, { needsCatalog: true })
registerEffect('coulombEffect', grant({ draw: 1 }))

// "a player made ship or tank" — two pool draws behind one name, so
// PoolFilter does not need a multi-value vehicleType for a single card.
const drawCustomShip = drawFromPool({
  source: 'deck', filter: { isBuiltIn: false, vehicleType: 'ship' }, count: 1, allowEmpty: true,
})
const drawCustomTank = drawFromPool({
  source: 'deck', filter: { isBuiltIn: false, vehicleType: 'tank' }, count: 1, allowEmpty: true,
})
const conduitOnDeath: EffectFn = (payload) => {
  const before = payload.game.privates[payload.actor].hand.length
  drawCustomShip(payload)
  if (payload.game.privates[payload.actor].hand.length > before) return true
  return drawCustomTank(payload)
}
registerEffect('conduitEffect', conduitOnDeath)
```

`shared/effects/ssEffects.ts` — add:

```ts
import { RHEA_MAX_PLANE_COST } from '../gameSettings.ts'
import { drawFromPool } from './primitives.ts'

registerEffect('rheaOnPlay', drawFromPool({
  source: 'catalog',
  filter: { faction: 'SS', vehicleType: 'plane', maxCost: RHEA_MAX_PLANE_COST - 1 },
  count: 1,
  strip: ['temporary'],
}), { needsCatalog: true })
```

`shared/effects/owEffects.ts` — add:

```ts
import { drawFromPool } from './primitives.ts'

const gtAirship = drawFromPool({
  source: 'catalog', filter: { faction: 'GT', vehicleType: 'airship' }, count: 1,
})
registerEffect('halberdOnDeath', gtAirship, { needsCatalog: true })
registerEffect('jormangundOnDeath', gtAirship, { needsCatalog: true })
registerEffect('partisanEffect', gtAirship, { needsCatalog: true })

// OW has no built-in submarines, so a player's only subs are custom cards in
// their own deck — which is why the card says "if you have one".
registerEffect('cauldronEffect', drawFromPool({
  source: 'deck', filter: { vehicleType: 'sub' }, count: 1, allowEmpty: true,
}))
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run shared/effects/factionEffects.test.ts`
Expected: PASS.

- [ ] **Step 6: Add the meta keys to the seed source**

| Card | Source file | Meta line |
|---|---|---|
| Ampere | `LH-Built-in.js` | `[TRIGGERS.ON_PLAY]: 'ampereOnPlay',` |
| Candela | `LH-Built-in.js` | `[TRIGGERS.ON_PLAY]: 'candelaOnPlay',` |
| Quadrupole | `LH-Built-in.js` | `[TRIGGERS.ON_PLAY]: 'quadrupoleOnPlay',` |
| Conduit | `LH-Built-in.js` | *(exists)* `onDeathEffect: 'conduitEffect'` |
| Rhea | `SS-built-in.js` | `[TRIGGERS.ON_PLAY]: 'rheaOnPlay',` |
| Halberd | `OW-Built-in.js` | `[TRIGGERS.ON_DEATH]: 'halberdOnDeath',` |
| Jormangund | `OW-Built-in.js` | `[TRIGGERS.ON_DEATH]: 'jormangundOnDeath',` |
| Partisan | `OW-Built-in.js` | *(exists)* |
| Cauldron | `OW-Built-in.js` | rename `'CauldronEffect'` → `'cauldronEffect'` |

**Constraint check — decision 2:** Halberd carries `SUB_SCREEN` and Jormangund none; neither may carry `SCRAPPY` alongside its new death trigger. Verify:

```bash
grep -A14 "name: 'Halberd'\|name: 'Jormangund'" supabase/seed/source/builtInCards/OW-Built-in.js | grep -i scrappy
```

Expected: no output.

- [ ] **Step 7: Rebuild the seed and shrink the guard**

```bash
npm run seed:build
```

Delete these 9 keys from `KNOWN_GAPS`: `LH:Ampere`, `LH:Candela`, `LH:Quadrupole`, `LH:Conduit`, `SS:Rhea`, `OW:Halberd`, `OW:Jormangund`, `OW:Partisan`, `OW:Cauldron`. Change the count assertion from `47` to `38`.

- [ ] **Step 8: Run the full suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 9: Sync and commit**

```bash
npm run functions:sync
git add shared supabase
git commit -m "feat(effects): wire 9 pool-draw cards to drawFromPool"
```

---

## Task 10: `whenPlayed` — Clydesdale and Sapphire

Both cards test the zone they landed in. `PLAY_CARD_TO_ZONE` pushes the entry (and any `additionalSpawns` copies) **before** effects fire, so the predicate must exclude what this play just placed. The handler tells the effect which ids those were.

**Files:**
- Modify: `shared/effects/registry.ts` (payload field)
- Modify: `shared/engine/placement.ts`
- Modify: `shared/effects/primitives.ts`, `owEffects.ts`, `lhEffects.ts`
- Modify: `supabase/seed/source/builtInCards/{OW-Built-in,LH-Built-in}.js`
- Test: `shared/effects/primitives.test.ts`, `shared/effects/factionEffects.test.ts`

**Interfaces:**
- Consumes: `grant`, `sequence` from Task 5.
- Produces:
  - `EffectPayload.placedInstanceIds?: string[]`
  - `whenPlayed(predicate: (p: EffectPayload) => boolean, body: EffectFn): EffectFn`
  - `zoneOccupants(p: EffectPayload, side: 'own' | 'either'): CardInstance[]`

- [ ] **Step 1: Write the failing test**

Append to `shared/effects/factionEffects.test.ts`:

```ts
import { applyAction } from '../engine/index.ts'
import { zoneEntry } from '../engine/testFixtures.ts'

describe('clydesdaleEffect', () => {
  const play = (existing: boolean) => {
    const card = inst({
      name: 'Clydesdale', vehicleType: 'ship', materialCost: 0,
      meta: { onPlayEffect: 'clydesdaleEffect' },
    })
    const game = makeGame({ privates: { a: { hand: [card], deck: [] }, b: { hand: [], deck: [] } } })
    if (existing) game.state.zones[0].cards.a.push(zoneEntry({ name: 'Escort', vehicleType: 'ship' }))
    const r = applyAction(game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    return r.game.state.zones[0].cards.a.filter((c) => c.name === 'Clydesdale').length
  }

  it('spawns a second copy into an empty-of-friendlies zone', () => {
    expect(play(false)).toBe(2)
  })

  it('spawns nothing when a friendly vehicle is already there', () => {
    expect(play(true)).toBe(1)
  })
})

describe('sapphireEffect', () => {
  it('draws and refunds when the zone is empty on both sides', () => {
    const card = inst({
      name: 'Sapphire', vehicleType: 'plane', materialCost: 30_000,
      meta: { onPlayEffect: 'sapphireEffect' },
    })
    const game = makeGame({
      privates: { a: { hand: [card], deck: [inst({ name: 'Top' })] }, b: { hand: [], deck: [] } },
    })
    const before = game.state.resources.a.materials
    const r = applyAction(game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.a.hand.map((c) => c.name)).toEqual(['Top'])
    expect(r.game.state.resources.a.materials).toBe(before)
  })

  it('does nothing when an enemy vehicle holds the zone', () => {
    const card = inst({
      name: 'Sapphire', vehicleType: 'plane', materialCost: 30_000,
      meta: { onPlayEffect: 'sapphireEffect' },
    })
    const game = makeGame({
      privates: { a: { hand: [card], deck: [inst({ name: 'Top' })] }, b: { hand: [], deck: [] } },
    })
    game.state.zones[0].cards.b.push(zoneEntry({ name: 'Enemy', vehicleType: 'ship' }))
    const before = game.state.resources.a.materials
    const r = applyAction(game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.a.hand).toHaveLength(0)
    expect(r.game.state.resources.a.materials).toBe(before - 30_000)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run shared/effects/factionEffects.test.ts`
Expected: FAIL — both effect names are unregistered, so the plays succeed as vanilla.

- [ ] **Step 3: Add the payload field**

In `shared/effects/registry.ts`, extend `EffectPayload`:

```ts
export interface EffectPayload {
  game: EngineGame
  actor: Side
  card: CardInstance
  ctx: EngineContext
  targetZoneId?: number
  targetInstanceId?: string
  // Ids this play just placed on the board (the card plus any
  // additionalSpawns copies). Predicates that ask "was this zone empty?"
  // must exclude them — PLAY_CARD_TO_ZONE places before effects fire.
  placedInstanceIds?: string[]
}
```

- [ ] **Step 4: Populate it in the handler**

In `shared/engine/placement.ts`, inside `PLAY_CARD_TO_ZONE`, collect the ids as entries are pushed and pass them through. Change the vehicle block and the `resolvePlayEffects` call to:

```ts
  const placedInstanceIds: string[] = []
  if (card.type === 'vehicle') {
    const zone = game.state.zones.find((z) => z.id === action.zoneId)!
    const entry: ZoneCardEntry = { ...card, playedOnTurn: game.turnNumber, movedOnTurn: null }
    zone.cards[actor].push(entry)
    placedInstanceIds.push(entry.instanceId)
    const extra = Math.min(Math.max(0, Math.floor(Number(card.meta.additionalSpawns) || 0)), ADDITIONAL_SPAWNS_CAP)
    for (let i = 0; i < extra; i++) {
      const copy: ZoneCardEntry = {
        ...card, instanceId: ctx.newId(), playedOnTurn: game.turnNumber, movedOnTurn: null,
      }
      zone.cards[actor].push(copy)
      placedInstanceIds.push(copy.instanceId)
    }
  }

  const failure = resolvePlayEffects(
    game, actor, card, ctx,
    { targetZoneId: action.zoneId, placedInstanceIds },
    ['playOnZoneEffect', 'onPlayEffect'],
  )
```

Widen `resolvePlayEffects`'s `targets` parameter type to
`{ targetZoneId?: number; targetInstanceId?: string; placedInstanceIds?: string[] }`.

- [ ] **Step 5: Add the primitive**

Append to `shared/effects/primitives.ts`:

```ts
import type { EffectPayload } from './registry.ts'

// Vehicles already in the target zone, excluding whatever this play just
// placed. `side: 'own'` counts only the actor's; 'either' counts both.
export function zoneOccupants(p: EffectPayload, side: 'own' | 'either'): CardInstance[] {
  const zone = p.game.state.zones.find((z) => z.id === p.targetZoneId)
  if (!zone) return []
  const placed = new Set(p.placedInstanceIds ?? [])
  const mine = zone.cards[p.actor].filter((c) => !placed.has(c.instanceId))
  if (side === 'own') return mine
  const theirs = zone.cards[p.actor === 'a' ? 'b' : 'a'].filter((c) => !placed.has(c.instanceId))
  return [...mine, ...theirs]
}

// Run `body` only when `predicate` holds. A false predicate is not a
// failure — the effect resolved, it simply did nothing.
export function whenPlayed(predicate: (p: EffectPayload) => boolean, body: EffectFn): EffectFn {
  return (payload) => (predicate(payload) ? body(payload) : true)
}
```

- [ ] **Step 6: Register the two cards**

`shared/effects/owEffects.ts`:

```ts
import { whenPlayed, zoneOccupants } from './primitives.ts'
import type { ZoneCardEntry } from '../engine/engineTypes.ts'

// "If played into a zone in which you have no friendly vehicles, spawn
// another copy into that zone."
registerEffect('clydesdaleEffect', whenPlayed(
  (p) => zoneOccupants(p, 'own').length === 0,
  ({ game, actor, card, ctx, targetZoneId }) => {
    const zone = game.state.zones.find((z) => z.id === targetZoneId)
    if (!zone) return false
    const copy: ZoneCardEntry = {
      ...card, instanceId: ctx.newId(), playedOnTurn: game.turnNumber, movedOnTurn: null,
    }
    zone.cards[actor].push(copy)
    game.state.log.push(`A second ${card.name} rolls off the line in zone ${zone.id}`)
    return true
  },
))
```

`shared/effects/lhEffects.ts`:

```ts
import { effectiveCostInGame } from '../engine/placement.ts'
import { sequence, whenPlayed, zoneOccupants } from './primitives.ts'

// "When this vehicle is played into an empty zone, draw a card and refund
// its cost." Recomputing the cost is exact here: Sapphire carries no
// costModifier, so nothing about it depends on board state.
registerEffect('sapphireEffect', whenPlayed(
  (p) => zoneOccupants(p, 'either').length === 0,
  sequence(
    grant({ draw: 1 }),
    ({ game, actor, card }) => {
      game.state.resources[actor].materials += effectiveCostInGame(game.state, actor, card)
      game.state.log.push(`${card.name} slips in unopposed — its cost is refunded`)
      return true
    },
  ),
))
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 8: Seed, shrink, sync, commit**

Clydesdale and Sapphire already carry their effect names — no seed edit is needed, so no `seed:build` either. Delete `OW:Clydesdale` and `LH:Sapphire` from `KNOWN_GAPS` and change the count from `38` to `36`.

```bash
npx vitest run
npm run functions:sync
git add shared supabase
git commit -m "feat(effects): add whenPlayed and wire Clydesdale and Sapphire"
```

---

## Task 11: `costDelta` — Excalibur and the Marauder correction

**Files:**
- Modify: `shared/engine/placement.ts`
- Modify: `shared/effects/primitives.ts`, `ssEffects.ts`, `dwgEffects.ts`
- Modify: `supabase/seed/source/builtInCards/SS-built-in.js`
- Modify: `docs/claude/card-effects.md`
- Test: `shared/engine/placement.test.ts`, `shared/effects/factionEffects.test.ts`, `shared/effects/dwgEffects.test.ts`

**Interfaces:**
- Consumes: `takeFromEnemyDeck` from Task 5.
- Produces: `costDelta(spec: { delta: number; filter: PoolFilter }): EffectFn`; `effectiveCostInGame` now reads `meta.costDelta`.

- [ ] **Step 1: Write the failing test**

Append to `shared/engine/placement.test.ts`:

```ts
describe('effectiveCostInGame — costDelta', () => {
  it('subtracts a stored costDelta from the printed cost', () => {
    const game = makeGame()
    const card = inst({ materialCost: 550_000, meta: { costDelta: -200_000 } })
    expect(effectiveCostInGame(game.state, 'a', card)).toBe(350_000)
  })

  it('clamps at zero', () => {
    const game = makeGame()
    const card = inst({ materialCost: 40_000, meta: { costDelta: -100_000 } })
    expect(effectiveCostInGame(game.state, 'a', card)).toBe(0)
  })

  it('applies before the Half-Cost halving', () => {
    const game = makeGame()
    const card = inst({ materialCost: 500_000, keywords: [KEYWORDS.HALF_COST], meta: { costDelta: -100_000 } })
    expect(effectiveCostInGame(game.state, 'a', card)).toBe(200_000)
  })

  it('never reaches effectiveMaterialCostOf', () => {
    const card = inst({ materialCost: 550_000, meta: { costDelta: -200_000 } })
    expect(effectiveMaterialCostOf(card)).toBe(550_000)
  })
})
```

Append to `shared/effects/factionEffects.test.ts`:

```ts
describe('excaliburOnPlay', () => {
  it('stamps a -200k costDelta on a built-in ship in hand', () => {
    const target = inst({ name: 'Victoria', isBuiltIn: true, vehicleType: 'ship', materialCost: 270_000 })
    const game = makeGame({ privates: { a: { hand: [target], deck: [] }, b: { hand: [], deck: [] } } })
    const ok = effectFor('excaliburOnPlay')!({
      game, actor: 'a', card: inst({ name: 'Excalibur' }), ctx: makeCtx(),
      targetInstanceId: target.instanceId,
    })
    expect(ok).toBe(true)
    expect(game.privates.a.hand[0].meta.costDelta).toBe(-200_000)
  })

  it('stacks with an existing delta', () => {
    const target = inst({ isBuiltIn: true, vehicleType: 'ship', meta: { costDelta: -50_000 } })
    const game = makeGame({ privates: { a: { hand: [target], deck: [] }, b: { hand: [], deck: [] } } })
    effectFor('excaliburOnPlay')!({
      game, actor: 'a', card: inst(), ctx: makeCtx(), targetInstanceId: target.instanceId,
    })
    expect(game.privates.a.hand[0].meta.costDelta).toBe(-250_000)
  })

  it('rejects a player-made target', () => {
    const target = inst({ isBuiltIn: false, vehicleType: 'ship' })
    const game = makeGame({ privates: { a: { hand: [target], deck: [] }, b: { hand: [], deck: [] } } })
    expect(effectFor('excaliburOnPlay')!({
      game, actor: 'a', card: inst(), ctx: makeCtx(), targetInstanceId: target.instanceId,
    })).toBe(false)
  })
})
```

Replace the existing `marauderOnPlay` test in `shared/effects/dwgEffects.test.ts` with:

```ts
describe('marauderOnPlay', () => {
  it('takes a vehicle from the enemy deck and discounts it by 50k', () => {
    const game = makeGame()
    game.privates.b.deck.push(
      inst({ name: 'Enemy Ability', type: 'ability' }),
      inst({ name: 'Enemy Ship', type: 'vehicle', materialCost: 200_000 }),
    )
    game.state.counts.b.deck = 2
    const ok = effectFor('marauderOnPlay')!({ game, actor: 'a', card: inst(), ctx: makeCtx() })
    expect(ok).toBe(true)
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['Enemy Ship'])
    expect(game.privates.a.hand[0].meta.costDelta).toBe(-50_000)
    expect(game.state.counts.b.deck).toBe(1)
    expect(game.state.log.join(' ')).not.toContain('Enemy Ship')
  })

  it('grants no CP — that was the ported behaviour, not the card text', () => {
    const game = makeGame()
    game.privates.b.deck.push(inst({ type: 'vehicle' }))
    effectFor('marauderOnPlay')!({ game, actor: 'a', card: inst(), ctx: makeCtx() })
    expect(game.state.resources.a.cp).toBe(3)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run`
Expected: FAIL on the new `costDelta`, `excaliburOnPlay` and rewritten Marauder cases.

- [ ] **Step 3: Read `meta.costDelta` in the cost authority**

In `shared/engine/placement.ts`, replace `effectiveCostInGame`:

```ts
// Play-time cost: (base + registered modifier + stored costDelta), Half-Cost
// halving, clamp ≥ 0. Base damage, repairs, and in-battle resources keep
// using effectiveMaterialCostOf — these are play-time-only mechanics.
export function effectiveCostInGame(state: PublicGameState, side: Side, card: CardInstance): number {
  const name = effectName(card, 'costModifier')
  const fn = name !== null ? costModifierFor(name) : null
  const delta = typeof card.meta.costDelta === 'number' ? card.meta.costDelta : 0
  const modified = card.materialCost + (fn ? fn(state, side, card) : 0) + delta
  return Math.max(0, effectiveMaterialCostOf({ ...card, materialCost: modified }))
}
```

- [ ] **Step 4: Add the primitive**

Append to `shared/effects/primitives.ts`:

```ts
// Stamp a persistent per-instance cost change onto a card in the actor's
// hand, the way doubleUpEffect stamps additionalSpawns. Read only by
// effectiveCostInGame — never by effectiveMaterialCostOf.
export function costDelta(spec: { delta: number; filter: PoolFilter }): EffectFn {
  return ({ game, actor, targetInstanceId }) => {
    if (typeof targetInstanceId !== 'string') return false
    const target = game.privates[actor].hand.find((c) => c.instanceId === targetInstanceId)
    if (!target || !matches(target, spec.filter)) return false
    const current = typeof target.meta.costDelta === 'number' ? target.meta.costDelta : 0
    target.meta = { ...target.meta, costDelta: current + spec.delta }
    return true
  }
}
```

- [ ] **Step 5: Register Excalibur and rewrite Marauder**

`shared/effects/ssEffects.ts`:

```ts
import { costDelta } from './primitives.ts'
import { EXCALIBUR_DISCOUNT } from '../gameSettings.ts'

// "Pick one AI ship in hand and reduce its cost by 200k." AI means built-in
// (design spec §3.10, "AI/built-in card costs").
registerEffect('excaliburOnPlay', costDelta({
  delta: -EXCALIBUR_DISCOUNT,
  filter: { isBuiltIn: true, vehicleType: 'ship', type: 'vehicle' },
}))
```

`shared/effects/dwgEffects.ts` — replace `registerEffect('marauderOnPlay', drawPlusCp)` with:

```ts
// "When this vehicle is played, draw a vehicle card from the enemy deck
// reduce its cost by 50k." The ported implementation aliased this to
// Crossbones' own-deck draw plus 1 CP; card text is authoritative
// (spec 2 §6), so that ruling is superseded.
registerEffect('marauderOnPlay', ({ game, actor, ctx }) => {
  const before = game.privates[actor].hand.length
  takeFromEnemyDeck(game, actor, ctx, (c) => c.type === 'vehicle')
  const taken = game.privates[actor].hand[before]
  if (!taken) return true
  const current = typeof taken.meta.costDelta === 'number' ? taken.meta.costDelta : 0
  taken.meta = { ...taken.meta, costDelta: current - MARAUDER_DISCOUNT }
  return true
})
```

Add to `shared/gameSettings.ts`:

```ts
export const MARAUDER_DISCOUNT = 50_000  // Marauder: enemy vehicle costs 50k less
export const EXCALIBUR_DISCOUNT = 200_000 // Excalibur: AI ship in hand costs 200k less
```

`drawPlusCp` now has a single caller (`crossbonesOnPlay`); leave it as a named local — it is still the clearest expression of that card.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 7: Seed and docs**

**Do NOT add Excalibur's meta key in this task.** Excalibur is a **vehicle** carrying `playOnCardEffect`, and no handler can fire that combination today: `PLAY_CARD_TARGETING_CARD_IN_HAND` rejects non-ability cards (`if (card.type !== 'ability') return err(400, 'Vehicles must target a zone')`), and `PLAY_CARD_TO_ZONE` only fires `playOnZoneEffect` / `onPlayEffect`.

Adding the key anyway would be actively worse than leaving it: the card would deploy, the effect would never run, `noteUnimplemented` would stay silent because the name *is* implemented — the exact silent no-op this whole spec exists to remove — and the guard would report it as fixed. It would also break the stale-entry assertion, since the card would then classify as clean while still being listed.

So: register and unit-test `excaliburOnPlay` now (done in steps 4–5), leave `SS-built-in.js` untouched, and re-file the gap. In `KNOWN_GAPS`, move `SS:Excalibur` out of the wave-1 block and into the wave-3 block with the reason `'wave 3 — a vehicle with a hand target has no play path'`. G2 still reports it as a genuine gap, which is honest, and the primitive is ready and proven when wave 3 builds the path.

**Spec gap to carry into wave 3's plan:** spec §4.3's DP6 covers a vehicle with a **field** target (Trebuchet) but not a vehicle with a **hand** target (Excalibur). Wave 3 must extend DP6 to both shapes — `PLAY_CARD_TARGETING_CARD_ON_FIELD` *and* `PLAY_CARD_TARGETING_CARD_IN_HAND` each gaining an optional `zoneId` and accepting a vehicle that carries the matching key.

Then in `docs/claude/card-effects.md`, replace item 1 of the "Adding a new effect" checklist parenthetical:

```markdown
1. Rules first: confirm the card's intended behavior against the spec / seeded
   `card_text`. **Card text is authoritative** over any ported implementation
   that disagrees (2026-08-27 effect-coverage spec, decision 1). Marauder's
   ported own-deck-draw behavior was corrected to match its text.
```

And append to the "Play-time cost modifiers" section:

```markdown
`meta.costDelta` is a stored per-instance discount stamped onto a card in hand
(Marauder −50k, Excalibur −200k). It is summed into `effectiveCostInGame`
alongside the registered `costModifier` and, like it, never reaches
`effectiveMaterialCostOf`.
```

- [ ] **Step 8: Rebuild, shrink, sync, commit**

Marauder's own meta key already exists (`onPlayEffect: 'marauderOnPlay'`), so this task changes no seed source and needs no `seed:build`.

Move `SS:Excalibur` from the wave-1 block to the wave-3 block as described in step 7. The `KNOWN_GAPS` count is unchanged at `36` — update the entry's label, not the assertion's number.

```bash
npx vitest run
npm run functions:sync
git add shared supabase docs
git commit -m "feat(effects): add costDelta; correct Marauder to its card text"
```

---

## Task 12: `resourceSurge` — PredatorX and Orbit

Conditional Half-Cost suppression. Per spec decision 8 this is a **price-time** property only: the hulls that land keep their printed keywords, so `effectiveMaterialCostOf` is untouched.

**Files:**
- Modify: `shared/engine/placement.ts`
- Modify: `supabase/seed/source/builtInCards/{SS-built-in,LH-Built-in}.js`
- Test: `shared/engine/placement.test.ts`

**Interfaces:**
- Consumes: `effectiveCostInGame` from Task 11.
- Produces: `halfCostSuppressed(state: PublicGameState, side: Side, card: CardInstance): boolean` and `surgeSpawnsFor(card: CardInstance): number`, both exported from `placement.ts`.

- [ ] **Step 1: Write the failing test**

Append to `shared/engine/placement.test.ts`:

```ts
const PREDATOR_META = { resourceSurge: { materialsOver: 120_000, extraSpawns: 1 } }
const ORBIT_META = { resourceSurge: { materialsAtLeast: 140_000, extraSpawns: 1 } }

describe('resourceSurge — conditional Half-Cost suppression', () => {
  const priced = (materials: number, meta: Record<string, unknown>, cost: number) => {
    const game = makeGame()
    game.state.resources.a.materials = materials
    const card = inst({ materialCost: cost, keywords: [KEYWORDS.HALF_COST], meta })
    return effectiveCostInGame(game.state, 'a', card)
  }

  it('PredatorX halves below the threshold', () => {
    expect(priced(120_000, PREDATOR_META, 120_000)).toBe(60_000)
  })

  it('PredatorX charges full price strictly above the threshold', () => {
    expect(priced(120_001, PREDATOR_META, 120_000)).toBe(120_000)
  })

  it('Orbit charges full price at exactly the threshold', () => {
    expect(priced(140_000, ORBIT_META, 140_000)).toBe(140_000)
  })

  it('Orbit halves below the threshold', () => {
    expect(priced(139_999, ORBIT_META, 140_000)).toBe(70_000)
  })

  it('leaves effectiveMaterialCostOf alone', () => {
    const card = inst({ materialCost: 120_000, keywords: [KEYWORDS.HALF_COST], meta: PREDATOR_META })
    expect(effectiveMaterialCostOf(card)).toBe(60_000)
  })
})

describe('resourceSurge — the extra hull', () => {
  const deploy = (materials: number) => {
    const card = inst({
      name: 'PredatorX', vehicleType: 'plane', materialCost: 120_000,
      keywords: [KEYWORDS.HALF_COST, KEYWORDS.TEMPORARY], meta: PREDATOR_META,
    })
    const game = makeGame({ privates: { a: { hand: [card], deck: [] }, b: { hand: [], deck: [] } } })
    game.state.resources.a.materials = materials
    const r = applyAction(game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    return r.game
  }

  it('lands two hulls when surged, charging full price', () => {
    const game = deploy(200_000)
    expect(game.state.zones[0].cards.a).toHaveLength(2)
    expect(game.state.resources.a.materials).toBe(80_000)
  })

  it('lands one hull at half price when not surged', () => {
    const game = deploy(100_000)
    expect(game.state.zones[0].cards.a).toHaveLength(1)
    expect(game.state.resources.a.materials).toBe(40_000)
  })

  it('the landed hulls keep their printed Half-Cost keyword', () => {
    const game = deploy(200_000)
    for (const entry of game.state.zones[0].cards.a) {
      expect(entry.keywords).toContain(KEYWORDS.HALF_COST)
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run shared/engine/placement.test.ts`
Expected: FAIL — everything halves and only one hull lands.

- [ ] **Step 3: Write minimal implementation**

In `shared/engine/placement.ts`, add above `effectiveCostInGame`:

```ts
interface ResourceSurge { materialsOver?: number; materialsAtLeast?: number; extraSpawns?: number }

const surgeOf = (card: CardInstance): ResourceSurge | null => {
  const raw = card.meta.resourceSurge
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as ResourceSurge) : null
}

// Spec §4.6: a card whose resource condition holds loses Half-Cost for
// PRICING ONLY. Hulls that land keep their printed keywords, so repairs,
// base damage, in-battle resources and the Temporary cull are untouched.
export function halfCostSuppressed(state: PublicGameState, side: Side, card: CardInstance): boolean {
  const surge = surgeOf(card)
  if (!surge) return false
  const materials = state.resources[side].materials
  if (typeof surge.materialsOver === 'number') return materials > surge.materialsOver
  if (typeof surge.materialsAtLeast === 'number') return materials >= surge.materialsAtLeast
  return false
}

export function surgeSpawnsFor(card: CardInstance): number {
  return Math.max(0, Math.floor(Number(surgeOf(card)?.extraSpawns) || 0))
}
```

Then use it inside `effectiveCostInGame` — replace its final line:

```ts
  const keywords = halfCostSuppressed(state, side, card)
    ? card.keywords.filter((k) => k !== KEYWORDS.HALF_COST)
    : card.keywords
  return Math.max(0, effectiveMaterialCostOf({ materialCost: modified, keywords }))
```

- [ ] **Step 4: Add the extra hull**

In `PLAY_CARD_TO_ZONE`, capture the surge **before** `pay()` — `pay` reduces materials, which would flip the condition off:

```ts
  if (game.state.alertCard?.instanceId === action.instanceId) game.state.alertCard = null

  // Read the surge before paying — pay() reduces materials, which would flip
  // the condition off before the spawn count is decided.
  const surged = halfCostSuppressed(game.state, actor, card)

  takeFromHand(game, actor, action.instanceId)
  pay(game, actor, card)
```

and change the spawn count:

```ts
    const printed = Math.max(0, Math.floor(Number(card.meta.additionalSpawns) || 0))
    const extra = Math.min(printed + (surged ? surgeSpawnsFor(card) : 0), ADDITIONAL_SPAWNS_CAP)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 6: Add the card data**

`SS-built-in.js`, PredatorX's empty meta block:

```js
            resourceSurge: { materialsOver: 120000, extraSpawns: 1 },
```

`LH-Built-in.js`, Orbit — it already carries `[TRIGGERS.ON_PLAY]: 'orbitEffect'`, which must be **removed** (the whole card is now data-driven, and leaving an unregistered name would trip G1):

```js
        meta: {
            resourceSurge: { materialsAtLeast: 140000, extraSpawns: 1 },
        }
```

- [ ] **Step 7: Rebuild, shrink, sync, commit**

```bash
npm run seed:build
```

Delete `SS:PredatorX` and `LH:Orbit` from `KNOWN_GAPS`; change the count from `36` to `34`.

```bash
npx vitest run
npm run functions:sync
git add shared supabase
git commit -m "feat(effects): conditional Half-Cost suppression for PredatorX and Orbit"
```

---

## Task 13: `grantKeywords` — Garrison and Repairmen Ready

**Files:**
- Modify: `shared/effects/primitives.ts`, `owEffects.ts`, `ssEffects.ts`
- Modify: `supabase/seed/source/builtInCards/{OW-Built-in,SS-built-in}.js`
- Test: `shared/effects/primitives.test.ts`, `shared/effects/factionEffects.test.ts`

**Interfaces:**
- Consumes: `grant`, `sequence` from Task 5; `matches` (module-private) from Task 8.
- Produces: `grantKeywords(spec: { keywords: string[]; target: 'hand' | 'field'; filter?: PoolFilter }): EffectFn`.

- [ ] **Step 1: Write the failing test**

Append to `shared/effects/factionEffects.test.ts`:

```ts
describe('garrisonEffect', () => {
  it('gives a built-in vehicle in hand Half-Cost and Inoffensive', () => {
    const target = inst({ name: 'Bulwark', isBuiltIn: true, type: 'vehicle', keywords: ['blocker'] })
    const game = makeGame({ privates: { a: { hand: [target], deck: [] }, b: { hand: [], deck: [] } } })
    const ok = effectFor('garrisonEffect')!({
      game, actor: 'a', card: inst(), ctx: makeCtx(), targetInstanceId: target.instanceId,
    })
    expect(ok).toBe(true)
    expect(game.privates.a.hand[0].keywords).toEqual(['blocker', 'halfCost', 'inoffensive'])
  })

  it('does not duplicate a keyword the target already has', () => {
    const target = inst({ isBuiltIn: true, type: 'vehicle', keywords: ['halfCost'] })
    const game = makeGame({ privates: { a: { hand: [target], deck: [] }, b: { hand: [], deck: [] } } })
    effectFor('garrisonEffect')!({
      game, actor: 'a', card: inst(), ctx: makeCtx(), targetInstanceId: target.instanceId,
    })
    expect(game.privates.a.hand[0].keywords).toEqual(['halfCost', 'inoffensive'])
  })

  it('rejects a player-made target', () => {
    const target = inst({ isBuiltIn: false, type: 'vehicle' })
    const game = makeGame({ privates: { a: { hand: [target], deck: [] }, b: { hand: [], deck: [] } } })
    expect(effectFor('garrisonEffect')!({
      game, actor: 'a', card: inst(), ctx: makeCtx(), targetInstanceId: target.instanceId,
    })).toBe(false)
  })
})

describe('repairmenReadyEffect', () => {
  const run = (over: Partial<Parameters<typeof inst>[0]>) => {
    const target = zoneEntry({ name: 'Target', keywords: [], ...over })
    const game = makeGame()
    game.state.zones[0].cards.b.push(target)
    game.privates.a.deck.push(inst({ name: 'Top' }))
    const ok = effectFor('repairmenReadyEffect')!({
      game, actor: 'a', card: inst(), ctx: makeCtx(), targetInstanceId: target.instanceId,
    })
    return { ok, game, target: game.state.zones[0].cards.b[0] }
  }

  it('grants Scrappy and draws for a cheap built-in target', () => {
    const { ok, game, target } = run({ isBuiltIn: true, materialCost: 150_000 })
    expect(ok).toBe(true)
    expect(target.keywords).toContain('scrappy')
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['Top'])
  })

  it('grants Scrappy but draws nothing for an expensive built-in target', () => {
    const { game, target } = run({ isBuiltIn: true, materialCost: 250_000 })
    expect(target.keywords).toContain('scrappy')
    expect(game.privates.a.hand).toHaveLength(0)
  })

  it('grants Scrappy but draws nothing for a player-made target', () => {
    const { game, target } = run({ isBuiltIn: false, materialCost: 100_000 })
    expect(target.keywords).toContain('scrappy')
    expect(game.privates.a.hand).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run shared/effects/factionEffects.test.ts`
Expected: FAIL — both names unregistered.

- [ ] **Step 3: Add the primitive**

Append to `shared/effects/primitives.ts`:

```ts
import { findVehicle } from '../engine/gameEngine.ts'

// Add keywords to a card, either in the actor's hand or anywhere on the
// field. Idempotent — a keyword the target already carries is not duplicated.
export function grantKeywords(spec: {
  keywords: string[]
  target: 'hand' | 'field'
  filter?: PoolFilter
}): EffectFn {
  return ({ game, actor, targetInstanceId }) => {
    if (typeof targetInstanceId !== 'string') return false
    const card = spec.target === 'hand'
      ? game.privates[actor].hand.find((c) => c.instanceId === targetInstanceId)
      : findVehicle(game.state, targetInstanceId)?.entry
    if (!card) return false
    if (spec.filter && !matches(card, spec.filter)) return false
    card.keywords = [...card.keywords, ...spec.keywords.filter((k) => !card.keywords.includes(k))]
    return true
  }
}
```

- [ ] **Step 4: Register the two cards**

`shared/effects/owEffects.ts`:

```ts
import { grantKeywords } from './primitives.ts'
import { KEYWORDS } from '../gameSettings.ts'

// "Target an AI vehicle in hand. Give it the HALFCOST and INOFFENSIVE
// keywords." The seeded meta key said playOnVehicleEffect (a field target);
// the card text says "in hand", and card text is authoritative (spec 2 §6).
registerEffect('garrisonEffect', grantKeywords({
  keywords: [KEYWORDS.HALF_COST, KEYWORDS.INOFFENSIVE],
  target: 'hand',
  filter: { isBuiltIn: true, type: 'vehicle' },
}))
```

`shared/effects/ssEffects.ts`:

```ts
import { grantKeywords, grant, sequence } from './primitives.ts'
import { KEYWORDS, REPAIRMEN_READY_DRAW_MAX_COST } from '../gameSettings.ts'
import { findVehicle } from '../engine/gameEngine.ts'

// "Grant target vehicle scrappy. If the target is an AI vehicle that costs
// less than 200k, draw a card."
registerEffect('repairmenReadyEffect', sequence(
  grantKeywords({ keywords: [KEYWORDS.SCRAPPY], target: 'field' }),
  (payload) => {
    const found = findVehicle(payload.game.state, payload.targetInstanceId ?? '')
    if (!found) return false
    const { entry } = found
    if (entry.isBuiltIn && entry.materialCost < REPAIRMEN_READY_DRAW_MAX_COST) {
      return grant({ draw: 1 })(payload)
    }
    return true
  },
))
```

Add to `shared/gameSettings.ts`:

```ts
export const REPAIRMEN_READY_DRAW_MAX_COST = 200_000 // Repairmen Ready draws below this
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 6: Correct Garrison's meta key**

In `OW-Built-in.js`, Garrison's meta currently reads
`[TRIGGERS.PLAY_ON_VEHICLE]: 'garrisonEffect'`. Change the key to
`[TRIGGERS.PLAY_ON_CARD]`, keeping the name:

```js
        meta: {
            [TRIGGERS.PLAY_ON_CARD]: 'garrisonEffect',
        }
```

Repairmen Ready already carries `[TRIGGERS.PLAY_ON_VEHICLE]: 'repairmenReadyEffect'` — leave it.

- [ ] **Step 7: Rebuild, shrink, sync, commit**

```bash
npm run seed:build
```

Delete `OW:Garrison` and `SS:Repairmen Ready` from `KNOWN_GAPS`; change the count from `34` to `32`.

```bash
npx vitest run
npm run functions:sync
git add shared supabase
git commit -m "feat(effects): add grantKeywords; wire Garrison and Repairmen Ready"
```

---

## Task 14: Osprey, docs, and wave-1 verification

**Files:**
- Modify: `supabase/seed/source/builtInCards/OW-Built-in.js`
- Modify: `supabase/seed/effectCoverage.test.ts`
- Modify: `docs/claude/card-effects.md`, `docs/claude/architecture.md`

**Interfaces:**
- Consumes: everything above.
- Produces: a wave-1-complete `KNOWN_GAPS` of 32 entries.

- [ ] **Step 1: Write the failing test**

In `supabase/seed/effectCoverage.test.ts`, replace the count assertion with:

```ts
  it('wave 1 is complete — no wave-1 entries remain', () => {
    expect(Object.values(KNOWN_GAPS).filter((w) => w === 'wave 1')).toEqual([])
    expect(Object.keys(KNOWN_GAPS)).toHaveLength(31)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run supabase/seed/effectCoverage.test.ts`
Expected: FAIL — `GT:[GT] Osprey` is still listed as `'wave 1'`, giving 32 entries.

- [ ] **Step 3: Give Osprey its spawn**

In `OW-Built-in.js`, `[GT] Osprey`'s empty meta block becomes:

```js
        meta: {
            additionalSpawns: 1,
        }
```

No registration is needed — `additionalSpawns` is plain data the play handler already honours, and Task 2's diagnostic already treats it as satisfying card text.

- [ ] **Step 4: Rebuild and shrink**

```bash
npm run seed:build
```

Delete `GT:[GT] Osprey` from `KNOWN_GAPS`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run supabase/seed/effectCoverage.test.ts`
Expected: PASS — 32 entries remain (waves 2–5, plus Excalibur re-filed to wave 3).

- [ ] **Step 6: Update the task docs**

In `docs/claude/card-effects.md`, replace the `CATALOG_EFFECTS` bullet:

```markdown
- `CATALOG_EFFECTS` — derived from `registerEffect(name, fn, { needsCatalog: true })`,
  so it can never drift from the implementations. If your effect mints cards from
  the DB catalog, pass the flag; `game-action`'s probe scans the played hand card
  plus every on-field card on both sides.
```

Append a new section before "Play-time cost modifiers":

```markdown
## Primitives (`shared/effects/primitives.ts`)

Most cards are a parameterised factory, not a bespoke function. Registrations
live in per-faction modules (`dwgEffects.ts`, `owEffects.ts`, `ssEffects.ts`,
`lhEffects.ts`, `wfEffects.ts`), each of which needs a side-effect import in
`shared/engine/index.ts` AND an entry in `shared-manifest.json`.

| Factory | Use |
|---|---|
| `grant({draw, cp, materials, from})` | draw cards and/or add CP/materials; `from: 'enemy'` takes from the opponent's deck |
| `drawFromPool({source, filter, count, strip, allowEmpty})` | mint from the catalog or pull from your own deck |
| `whenPlayed(predicate, body)` | condition on the zone the card landed in; use `zoneOccupants(p, 'own' \| 'either')`, which excludes what this play just placed |
| `grantKeywords({keywords, target, filter})` | idempotently add keywords to a card in hand or on the field |
| `costDelta({delta, filter})` | stamp a persistent per-instance discount on a card in hand |
| `sequence(...fns)` | run effects in order, stopping at the first failure |

Coverage is enforced by `supabase/seed/effectCoverage.test.ts`. Its `KNOWN_GAPS`
map is shrink-only — a third assertion rejects stale entries, so closing a card
without deleting its entry fails the build.
```

In `docs/claude/architecture.md`, replace the last "Known gaps" bullet:

```markdown
- Remaining unimplemented effect names are tracked in `KNOWN_GAPS` in
  `supabase/seed/effectCoverage.test.ts`, with the wave that closes each one.
  Cards still listed there play vanilla and log a note at play time.
```

- [ ] **Step 7: Full verification**

```bash
npx vitest run
npm --prefix frontend run build
npm --prefix frontend run lint
npx tsc -p tsconfig.json --noEmit
```

Expected: all green. If the frontend build fails on `EffectPayload`'s new optional field, it is a genuine type error — `placedInstanceIds` is optional, so no caller should need changing.

- [ ] **Step 8: Sync and commit**

```bash
npm run functions:sync
git add shared supabase docs
git commit -m "feat(cards): complete wave 1 — 34 cards now match their card text"
```

- [ ] **Step 9: Deploy**

Deploy `game-action` per `docs/claude/supabase.md`, then apply `supabase/seed/seed_data.sql` to the remote project. Card ids are deterministic, so the seed is an upsert.

**Live games do not retrofit** (spec §9.2): card `meta` is snapshotted into `games.state` and `game_players` at deal time, so only games started after the reseed pick up the new effects. Say so when reporting completion.

---

## Wave 1 exit criteria

- `npx vitest run` green, including the four coverage-guard assertions.
- `KNOWN_GAPS` holds exactly 31 entries, none marked `'wave 1'`.
- `npm --prefix frontend run build` and `lint` green.
- `git status` clean after `npm run functions:sync` (the drift test proves the synced copies match).
- **33 cards** behave as their text says in a fresh game against the reseeded catalog.

The spec's wave 1 listed 34. Excalibur is the difference: its `costDelta` effect is built, registered and unit-tested here, but its meta key and play path move to wave 3, because a vehicle carrying a hand target has no dispatch point and wiring it early would produce exactly the silent no-op this spec exists to remove (Task 11, step 7). Wave 3's plan inherits that, plus the DP6 extension it implies.
