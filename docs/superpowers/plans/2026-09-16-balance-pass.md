# 2026-09-16 Balance Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 2026-09-16 balance pass — ten mechanics (M-1…M-10), 31 updated
card rows, 2 new rows and 1 retirement — with every effect built TDD-first and
every moved number pinned by a seed-backed test.

**Architecture:** Effects stay in the per-faction modules under `shared/effects/`
and register by unique id; new rules that the engine reads off card data
(`battleCap`, `homeSide`) go in as data keys beside `slotDenial`/`uniquePerZone`.
Each task carries its own seed rows so G4 (no unnamed registered effect) and G1
(no unimplemented named effect) stay green at every commit, and the residual
number-only moves land in one data task pinned by a new balance test file.

**Tech Stack:** TypeScript (strict), vitest, the pure engine in `shared/`
(also transpiled verbatim into Deno edge functions), Node seed pipeline
(`supabase/seed/`), Supabase remote project.

**Spec:** `docs/superpowers/specs/2026-09-16-balance-pass-changes.md` (binding;
this plan argues from it). Rulings taken on 2026-09-16 with the user, recorded
in Task 1 below: Q1 refuse (cap AND `uniquePerZone`), Q2 original owner via a
`homeSide` stamp, Q3 side AND zone, Q4 printed `materialCost`, Q5 Tyr's own
decay only, Q6 keep `uniquePerZone` + clause, **Q7 = 400k**, Q8 as listed.

## Global Constraints

- Every commit that touches `shared/` runs `npm run functions:sync` and commits
  the synced copies under `supabase/functions/*/shared/` (CLAUDE.md hard rule;
  `supabase/seed/functionSharedSync.test.ts` fails otherwise).
- Relative imports inside `shared/` carry the `.ts` extension.
- Tests import the engine through `shared/engine/index.ts` (registries are
  empty otherwise). Fixtures: `shared/engine/testFixtures.ts` — `makeGame()`
  (alice = side `a` and active, bob = `b`), `makeCtx()` (rng cycles
  0.1/0.5/0.9, ids `e-0`, `e-1`, …), `inst()`/`snap()` default `isBuiltIn: true`,
  `faction: 'DWG'`, `type: 'vehicle'`, `vehicleType: 'ship'`, `materialCost: 40000`.
- Never use a real seeded effect name as an "unimplemented" stand-in — use a
  `t_`-prefixed synthetic name (docs/claude/testing.md).
- Public `state.log` must never name a card entering a hidden hand.
- Effects are keyed by a unique registry id, never a card name; an orphaned
  id is kept registered and listed in `DELIBERATE_ORPHANS`, never reused.
- `npx vitest run` from the repo root, never `--root`. Baseline before this
  plan: **1747 tests passing in 51 files**. Report before→after at close-out.
- `npm --prefix frontend run build` type-checks `shared/` too, with
  `noUnusedLocals: true` — an import left dangling in `shared/` (e.g.
  `spawnVehicles` after Task 6) fails the frontend build, not the root `tsc`.
  Destructured names prefixed `_` are exempt.
- Shell is PowerShell: separate commands with `;`, never `&&`.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Card data lives in `supabase/seed/source/builtInCards/<FACTION>-built-in.js`;
  after every source edit run `npm run seed:build` and commit
  `supabase/seed/seed_data.sql` (`seedDataSync.test.ts` fails otherwise).
- Seed keywords come from `supabase/seed/source/gameSettings.js`'s own
  `KEYWORDS` map. This pass adds **no** keyword, so that file is untouched.
- Do not deploy, push, merge or apply seed data inside a task: Task 12 lists
  those steps and each needs the user's go-ahead.

---

### Task 1: Record the §4 rulings in the spec

**Files:**
- Modify: `docs/superpowers/specs/2026-09-16-balance-pass-changes.md:172-194` (§4)

**Interfaces:**
- Produces: the binding rulings every later task cites (`Q1`…`Q8`, plus the
  three precedent details D-1…D-3 named below).

- [ ] **Step 1: Replace §4 with the rulings**

Replace the whole `## 4. Open questions …` section (lines 172–194) with:

```markdown
## 4. Rulings — taken 2026-09-16, binding on this pass

- **Q1 Mutiny, full zone: REFUSE the play.** `mutinyEffect` returns `false`
  when `zone.cards[actor].length >= zoneCapFor(state, actor, zone.id)` — and
  also when `uniquePerZoneBlocked(state, actor, zone.id, target)` would trip
  (stealing a second Albacore/Obelisk into a zone you already hold one in).
  The same two gates `moveEntry` applies to walking a hull in. The 400k is
  never spent: the handler 400s and `applyAction` discards the clone.
- **Q2 Mutiny, expiry: the ORIGINAL OWNER's discard.** Mutiny stamps
  `meta.homeSide = <side it was stolen from>` on the stolen entry;
  `discardCard` files a hull under `homeSide ?? controller`, and
  `discardSnapshotOf` strips the stamp. This covers the turn-start cull AND a
  stolen hull dying in battle — either way it goes home, so it can reshuffle
  into the deck it belongs to.
- **Q3 Sinners Luck "swap": exchange side AND zone.** Airships and planes fly
  in every biome, so no biome check is needed. The swap bypasses the zone
  cap (it is not a play, and is net-zero per side — Boarding Party's latitude)
  and does not consult `uniquePerZone` (recorded edge: a swapped-in Albacore
  may land beside the receiver's own).
- **Q4 Sinners Luck "worth": printed `materialCost`.** The difference is
  stamped as `costDelta −(received − given)` on the card the opponent draws;
  the log names neither the card nor its price.
- **Q5 Tyr "Min 500k": floors Tyr's OWN decay only.** `tyrCostModifier`
  returns `max(−60k × steps, −(materialCost − TYR_MIN_COST))`; other
  `costDelta` stamps (Excalibur, Nothung, …) still apply beneath the floor.
- **Q6 Obelisk: keep `uniquePerZone` and its text clause**; take the cost
  (40k→60k) and the STEALTHY removal.
- **Q7 Spawn Audacious: 400k, as the entry says.** It closes the recorded
  40k Spawn Audacious → Repurpose-for-330k loop (`tgEffects.ts`), which
  reads as deliberate rather than a typo.
- **Q8 Silent moves: implemented as listed.** Buccaneer 220k, Pilferer 100k,
  Blockade 120k, Obelisk 60k, Spawn Audacious 400k, Bulwark 600k, Eyrie 650k,
  Purifier 760k; Loggerhead +HALF_COST; Audacious and Tyr +FRAGILE.

Three engine details the sections above left open, each decided by the
nearest precedent:

- **D-1 A side change re-stamps `playedOnTurn`** (Mutiny's stolen hull; both
  Sinners Luck hulls), exactly as Boarding Party does. A stolen hull can
  therefore fight a fleet battle this turn but cannot BOMBARD
  (`baseStrikersIn` excludes fresh deployments). `movedOnTurn` and
  `activatedOnTurn` reset with it.
- **D-2 M-3's cap is enforced in `joinBattle`** (the two spawners) and
  nowhere else. It counts hulls already on that side of the live battle via
  `lockRoster` — board hulls and summons alike — keyed on `cardId`, read off
  the new `battleCap` data key (`DATA_EFFECT_KEYS`). The DECLARED roster of
  `ATTACK_ENEMY_FLEET` is not gated: two board Mirth Swarms (Drones plus a
  refresh in one turn) could still attack together. Recorded, not fixed.
- **D-3 Sinners Luck is a two-hop `choice()`** (Braveheart's shape).
  Declining is the existing `RESOLVE_PENDING_EFFECT { cancel: true }` path
  the dialog already offers; an empty pool at either hop resolves as "nothing
  happens" (Kraken's null shape), so the ship still deploys.
```

- [ ] **Step 2: Commit**

```powershell
git add docs/superpowers/specs/2026-09-16-balance-pass-changes.md
git commit -m "docs(balance): record the 2026-09-16 pass rulings Q1-Q8 and D-1..D-3

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: M-1 — "AI ship" is any built-in ship (six SS cards + HandBar)

**Files:**
- Modify: `shared/effects/primitives.ts:145-155` (add `isAiShip` beside `poolEligible`)
- Modify: `shared/effects/ssEffects.ts:1-40, 54-86, 155-167, 295-308, 894-918`
- Modify: `frontend/src/pages/game/HandBar.tsx:5, 27-60, 304`
- Modify: `supabase/seed/source/builtInCards/SS-built-in.js` (Victoria, Trondheim, Excalibur, Nothung, Resolute, Argonaut texts)
- Modify: `supabase/seed/balance/ss.balance.test.ts:66-122` (six texts)
- Test: `shared/effects/factionEffects.test.ts` (Excalibur, Nothung, Victoria, Trondheim/Resolute, Argonaut blocks)

**Interfaces:**
- Produces: `isAiShip(c: Pick<SnapshotCard, 'isBuiltIn' | 'type' | 'vehicleType'>): boolean`
  exported from `shared/effects/primitives.ts`; `AI_SHIP_FILTER` (module-private
  `PoolFilter`) in `ssEffects.ts`. Task 3 (Sacrilego), Task 5 (Mirth Factory)
  and the frontend consume `isAiShip`.

- [ ] **Step 1: Write the failing tests**

In `shared/effects/factionEffects.test.ts`, replace the two R-5 tests at the
end of `describe('excaliburEffect')` (lines 357–378) with:

```ts
  // M-1 (2026-09-16): "AI ship" is any BUILT-IN ship, whatever its faction —
  // the reverse of 2026-09-02's R-5. A built-in DWG ship qualifies again…
  it('accepts a built-in ship of another faction', () => {
    const game = makeGame()
    const target = inst({ faction: 'DWG', isBuiltIn: true, type: 'vehicle', vehicleType: 'ship' })
    game.privates.a.hand.push(target)
    expect(effectFor('excaliburEffect')!({
      game, actor: 'a', card: inst(), ctx: makeCtx(), targetInstanceId: target.instanceId,
    })).toBe(true)
    expect(game.privates.a.hand[0].meta.costDelta).toBe(EXCALIBUR_COST_DELTA)
  })

  // …and a PLAYER-MADE SS ship no longer does. Motivation: a DWG-stolen SS
  // card must keep working in a hand holding no SS ships.
  it('refuses a player-made SS ship', () => {
    const game = makeGame()
    const target = inst({ faction: 'SS', isBuiltIn: false, type: 'vehicle', vehicleType: 'ship' })
    game.privates.a.hand.push(target)
    expect(effectFor('excaliburEffect')!({
      game, actor: 'a', card: inst(), ctx: makeCtx(), targetInstanceId: target.instanceId,
    })).toBe(false)
  })
```

In `describe('SS Nothung — a discount across the whole hand')` (line 3444),
replace the `hand` helper and the first test with:

```ts
  const hand = (game: EngineGame) => {
    game.privates.a.hand.push(
      inst({ name: 'SS Ship', faction: 'SS', type: 'vehicle', vehicleType: 'ship' }),
      inst({ name: 'SS Ship 2', faction: 'SS', type: 'vehicle', vehicleType: 'ship', meta: { costDelta: -10_000 } }),
      inst({ name: 'SS Sub', faction: 'SS', type: 'vehicle', vehicleType: 'sub' }),
      inst({ name: 'SS Ability', faction: 'SS', type: 'ability', vehicleType: null }),
      inst({ name: 'DWG Ship', faction: 'DWG', type: 'vehicle', vehicleType: 'ship' }),
      inst({ name: 'Custom SS Ship', faction: 'SS', isBuiltIn: false, type: 'vehicle', vehicleType: 'ship' }),
    )
  }

  // M-1 (2026-09-16): every BUILT-IN ship in hand, of any faction. A
  // player-made SS ship is the one that no longer qualifies.
  it('discounts every AI ship in hand and nothing else', () => {
    const game = makeGame()
    hand(game)
    expect(effectFor('nothungOnPlay')!({ game, actor: 'a', card: inst({ name: 'Nothung' }), ctx: makeCtx() })).toBe(true)
    const byName = new Map(game.privates.a.hand.map((c) => [c.name, c.meta.costDelta]))
    expect(byName.get('SS Ship')).toBe(NOTHUNG_COST_DELTA)
    expect(byName.get('SS Ship 2')).toBe(-10_000 + NOTHUNG_COST_DELTA)
    expect(byName.get('DWG Ship')).toBe(NOTHUNG_COST_DELTA)
    expect(byName.get('SS Sub')).toBeUndefined()
    expect(byName.get('SS Ability')).toBeUndefined()
    expect(byName.get('Custom SS Ship')).toBeUndefined()
  })
```

In `describe('SS Victoria — a discount on an SS ship in hand')` (line 3848),
replace the `it.each` refusal table (lines 3879–3890) with:

```ts
  it.each([
    ['a player-made ship', { isBuiltIn: false }],
    ['an SS sub', { vehicleType: 'sub' }],
    ['an SS ability', { type: 'ability' }],
  ])('refuses %s', (_label, over) => {
    const game = makeGame()
    const target = ssShip(over)
    game.privates.a.hand.push(target)
    expect(effectFor('victoriaOnPlay')!({
      game, actor: 'a', card: victoria(), ctx: makeCtx(), targetInstanceId: target.instanceId,
    })).toBe(false)
  })

  // M-1: a built-in ship of ANY faction is an AI ship.
  it('accepts a built-in ship of another faction', () => {
    const game = makeGame()
    const target = ssShip({ faction: 'DWG' })
    game.privates.a.hand.push(target)
    expect(effectFor('victoriaOnPlay')!({
      game, actor: 'a', card: victoria(), ctx: makeCtx(), targetInstanceId: target.instanceId,
    })).toBe(true)
    expect(game.privates.a.hand[0].meta.costDelta).toBe(VICTORIA_COST_DELTA)
  })
```

In `describe('SS Trondheim and Resolute — a discounted SS ship out of the deck')`
(line 6859), replace `deckOf` and add one test after the first `it.each`:

```ts
  // The AI ship is pushed LAST, with two non-matches ahead of it, so the draw
  // can only be explained by the FILTER (isBuiltIn + type + vehicleType)
  // picking it out — not by fixture order. Since M-1 the non-matches are an SS
  // sub and a PLAYER-MADE SS ship; a "grab deck[0]" regression would return
  // 'SS Sub' here and fail every assertion below.
  const deckOf = (game: EngineGame) => {
    game.privates.a.deck.push(
      inst({ name: 'SS Sub', faction: 'SS', type: 'vehicle', vehicleType: 'sub' }),
      inst({ name: 'Home-Brew', faction: 'SS', isBuiltIn: false, type: 'vehicle', vehicleType: 'ship' }),
      inst({ name: 'SS Ship A', faction: 'SS', type: 'vehicle', vehicleType: 'ship', materialCost: 300_000 }),
    )
  }
```

and, after the `'%s pulls an SS SHIP and stamps %i on it'` block (change that
title's wording to `'%s pulls an AI SHIP and stamps %i on it'`), add:

```ts
  // M-1: a built-in ship of another faction is an AI ship too.
  it.each(['trondheimOnDeath', 'resoluteOnPlay'])('%s draws a built-in ship of another faction', (name) => {
    const game = makeGame()
    game.privates.a.deck.push(
      inst({ name: 'SS Sub', faction: 'SS', type: 'vehicle', vehicleType: 'sub' }),
      inst({ name: 'DWG Ship', faction: 'DWG', type: 'vehicle', vehicleType: 'ship' }),
    )
    expect(effectFor(name)!({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['DWG Ship'])
  })
```

Also fix the line `expect(game.privates.a.deck.map((c) => c.name)).toEqual(['SS Sub', 'DWG Ship'])`
in that first `it.each` to `.toEqual(['SS Sub', 'Home-Brew'])`.

In `describe('SS Argonaut — a parting discount')` (line 7029), replace the
`'ignores SS subs, SS abilities and other factions'` test with:

```ts
  it('ignores SS subs, SS abilities and player-made ships', () => {
    const game = makeGame()
    game.privates.a.hand.push(
      inst({ name: 'Sub', faction: 'SS', type: 'vehicle', vehicleType: 'sub' }),
      inst({ name: 'Ability', faction: 'SS', type: 'ability', vehicleType: null }),
      inst({ name: 'Custom', faction: 'SS', isBuiltIn: false, type: 'vehicle', vehicleType: 'ship' }),
    )
    effectFor('argonautOnDeath')!({ game, actor: 'a', card: argonaut(), ctx: makeCtx() })
    expect(game.privates.a.hand.every((c) => c.meta.costDelta === undefined)).toBe(true)
  })

  // M-1: a built-in ship of another faction is in the pool.
  it('discounts a built-in ship of another faction', () => {
    const game = makeGame()
    game.privates.a.hand.push(inst({ name: 'DWG', faction: 'DWG', type: 'vehicle', vehicleType: 'ship' }))
    effectFor('argonautOnDeath')!({ game, actor: 'a', card: argonaut(), ctx: makeCtx() })
    expect(game.privates.a.hand[0].meta.costDelta).toBe(ARGONAUT_COST_DELTA)
  })
```

Then add a primitives test to `shared/effects/primitives.test.ts` (append at
the end of the file; it already imports `describe, expect, it` and `inst`):

```ts
describe('isAiShip (2026-09-16 M-1)', () => {
  it('is a built-in SHIP of any faction, and nothing else', () => {
    expect(isAiShip(inst({ faction: 'DWG', isBuiltIn: true, type: 'vehicle', vehicleType: 'ship' }))).toBe(true)
    expect(isAiShip(inst({ faction: 'SS', isBuiltIn: true, type: 'vehicle', vehicleType: 'ship' }))).toBe(true)
    expect(isAiShip(inst({ faction: 'SS', isBuiltIn: false, type: 'vehicle', vehicleType: 'ship' }))).toBe(false)
    expect(isAiShip(inst({ isBuiltIn: true, type: 'vehicle', vehicleType: 'airship' }))).toBe(false)
    expect(isAiShip(inst({ isBuiltIn: true, type: 'ability', vehicleType: null }))).toBe(false)
  })
})
```

(add `isAiShip` to that file's import from `'./primitives.ts'`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run shared/effects`
Expected: FAIL — `isAiShip` is not exported; Excalibur/Victoria/Nothung/
Trondheim/Argonaut new cases fail on the SS-faction filter.

- [ ] **Step 3: Implement `isAiShip` in primitives.ts**

In `shared/effects/primitives.ts`, add `import { CARD_TYPES, VEHICLE_TYPES } from '../gameSettings.ts'`
to the imports and, directly after `poolEligible` (line 155), add:

```ts
/**
 * "An AI ship" (2026-09-16 spec M-1): a BUILT-IN ship of any faction. It was an
 * SS-faction test between the 2026-09-02 pass (ruling R-5) and this one; the
 * reversal exists so a DWG-stolen SS card keeps working in a hand holding no SS
 * ships. Written once — ssEffects.ts's seven "AI ship" cards, tgEffects.ts's
 * Mirth Factory and frontend/src/pages/game/HandBar.tsx all read this one
 * predicate, so no two of them can disagree about what the phrase means.
 *
 * ⚠ Read the L-1 note on PoolFilter.metaFlag before widening this into a
 * catalog pool: "built-in ship" is a query over the whole cards table, and it
 * grows with every faction seeded.
 */
export function isAiShip(c: Pick<SnapshotCard, 'isBuiltIn' | 'type' | 'vehicleType'>): boolean {
  return c.isBuiltIn === true && c.type === CARD_TYPES.VEHICLE && c.vehicleType === VEHICLE_TYPES.SHIP
}
```

- [ ] **Step 4: Rewire ssEffects.ts**

In `shared/effects/ssEffects.ts`:

1. Import `CARD_TYPES` from `'../gameSettings.ts'` and add `isAiShip` to the
   import list from `'./primitives.ts'`.
2. Replace lines 19–39 (the `SS_SHIP_FILTER` comment, constant and the
   exported `isSsShip`) with:

```ts
// "An AI ship" — the pool seven cards share (Victoria, Trondheim, Excalibur,
// Nothung, Resolute, Argonaut, Sacrilego). Since the 2026-09-16 pass (M-1)
// it is a BUILT-IN test rather than an SS-faction one: a built-in DWG hull
// qualifies, a player-made SS ship does not. The predicate form is
// primitives.ts's isAiShip; this is the same test as a PoolFilter for the
// drawFromPool/costDelta factories. Repairmen Ready is NOT in this pool — its
// text says "SS vehicle" and its gate stays faction === SS (below).
//
// ⚠ Read the L-1 note above PoolFilter.metaFlag (primitives.ts) before
// widening a catalog pool onto this filter: "built-in ship" is a query over
// the whole cards table, and it grows with every faction seeded. Every user
// here reads the owner's HAND or DECK, never the catalog.
const AI_SHIP_FILTER = {
  isBuiltIn: true, type: CARD_TYPES.VEHICLE, vehicleType: VEHICLE_TYPES.SHIP,
} as const
```

3. Replace every remaining `SS_SHIP_FILTER` with `AI_SHIP_FILTER` (Trondheim,
   Resolute, Excalibur, Victoria) and every `isSsShip(` with `isAiShip(`
   (Nothung, Sacrilego, Argonaut). Update the card-text quotes in the comments
   above each to the new strings from spec §2 (SS table), e.g. Nothung's header
   becomes `"When this vehicle is played, reduce the cost of all AI ships in
   your hand by 40k."` and the log line `refits the SS ships` → `refits the AI
   ships`. Excalibur's header comment: replace the R-5 paragraph with
   `The filter moved SS -> AI (built-in, any faction) in the 2026-09-16 pass
   (M-1), reversing R-5.` The `FACTIONS` import stays (Repairmen Ready uses it).

- [ ] **Step 5: Rename the HandBar consumer**

In `frontend/src/pages/game/HandBar.tsx`:
- line 5: `import { isAiShip } from '@shared/effects/primitives'`
- rename `isSsShipTarget` → `isAiShipTarget` (definition at line 46 and both
  call sites at lines 59 and 304); replace `isSsShip(c)` with `isAiShip(c)`.
- Update the comment block at lines 27–48 to read: vehicles carrying
  `playOnCardEffect` whose target must be an **AI ship** — `isAiShip` in
  `shared/effects/primitives.ts` (2026-09-16 M-1: built-in, any faction;
  reverses R-5).

- [ ] **Step 6: Update the six SS card texts in the seed**

In `supabase/seed/source/builtInCards/SS-built-in.js` set exactly:

| Card | new `cardText` |
|---|---|
| Victoria (line 24) | `When played, pick one AI ship in hand and reduce its cost by 75k` |
| Trondheim (line 42) | `When this vehicle is destroyed, draw an AI ship and reduce its cost by 75k` |
| Excalibur (line 92) | `Pick one AI ship in hand and reduce its cost by 200k` |
| Resolute (line 197) | `When this vehicle is played, draw an AI ship from your deck. reduce its cost by 40k` |
| Argonaut (line 272) | `When this is destroyed, reduce the cost of a random AI ship in your hand by 50k` |
| Nothung (line 338) | `When played, reduce the cost of all AI ships in your hand by 40k` |

Trondheim keeps `source: 'deck'` in code although the text dropped "from your
deck" (spec §2). Then run `npm run seed:build`.

- [ ] **Step 7: Move the pinned texts**

In `supabase/seed/balance/ss.balance.test.ts` update the six `cardText`
values (Victoria line 68, Trondheim 72, Resolute 76, Excalibur 88, Nothung 96,
Argonaut 121) to the strings above, and add above the `CARDS` map:

```ts
// ⚠ Six texts here moved "SS ship" → "AI ship" in the 2026-09-16 pass (M-1)
// and are updated in place per the 2026-09-02 spec §2.3; the pass's own pins
// live in balance/2026-09-16.balance.test.ts.
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run`
Expected: PASS, and `supabase/seed/seedDataSync.test.ts` green (you ran
`seed:build`).

- [ ] **Step 9: Typecheck the frontend and sync**

Run: `npm --prefix frontend run build; npm run functions:sync`
Expected: build succeeds (no `isSsShip` references remain — verify with
`git grep -n isSsShip` → no hits outside `docs/`).

- [ ] **Step 10: Commit**

```powershell
git add -A
git commit -m "feat(effects): M-1 'AI ship' is any built-in ship — six SS cards and the hand-target filter

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: M-1/Sacrilego — delete the fleet-wide SCRAPPY loan, keep the survive discount

**Files:**
- Modify: `shared/effects/ssEffects.ts:564-637` (`sacrilegoBattle`)
- Modify: `shared/engine/gameEngine.ts:310-326` (comment only — the `scrappyOnLoan` strip stays, R-8)
- Modify: `supabase/seed/source/builtInCards/SS-built-in.js:180,190` (Sacrilego text, −MOBILE)
- Modify: `supabase/seed/balance/ss.balance.test.ts:98-102`
- Test: `shared/effects/factionEffects.test.ts:2046-2250`

**Interfaces:**
- Consumes: `isAiShip` (Task 2), `discountInHand` (existing, `ssEffects.ts`).
- Produces: `sacrilegoBattle` now fires only at `phase === 'resolve' && survived`.

- [ ] **Step 1: Write the failing tests**

In `describe('sacrilegoBattle')` (line 2046) delete the four loan tests —
`'grants SCRAPPY at lock…'`, `'takes the loan back at resolve…'`,
`'takes the loan back even when Sacrilego did not survive'` and the end-to-end
`'loans SCRAPPY for a real battle…'` (lines 2078–2113 and 2181–2249) — and
replace the first three with:

```ts
    // 2026-09-16: the fleet-wide SCRAPPY grant is GONE (spec §2, SS table).
    // Only the survive-discount remains, so lock is a no-op on every hull.
    it('grants nothing at lock', () => {
      const { game, sac, mate, printed, sub } = staged()
      expect(effectFor('sacrilegoBattle')!({ game, actor: 'a', card: sac, ctx: makeCtx(), battle: sacLock() })).toBe(true)
      expect(mate.keywords).not.toContain('scrappy')
      expect(mate.meta.scrappyOnLoan).toBeUndefined()
      expect(printed.keywords).toEqual(['scrappy']) // printed, untouched
      expect(sub.keywords).not.toContain('scrappy')
    })
```

Replace `'cuts 30k off every SS ship in hand on a survival'` with:

```ts
    // M-1: every BUILT-IN ship in hand, of any faction — never a player-made one.
    it('cuts 30k off every AI ship in hand on a survival', () => {
      const { game, sac } = staged()
      game.privates.a.hand.push(
        inst({ name: 'SS Ship', faction: 'SS', type: 'vehicle', vehicleType: 'ship' }),
        inst({ name: 'DWG Ship', faction: 'DWG', type: 'vehicle', vehicleType: 'ship' }),
        inst({ name: 'SS Sub', faction: 'SS', type: 'vehicle', vehicleType: 'sub' }),
        inst({ name: 'Custom', faction: 'SS', isBuiltIn: false, type: 'vehicle', vehicleType: 'ship' }),
      )
      game.state.activeBattle = null
      effectFor('sacrilegoBattle')!({ game, actor: 'a', card: sac, ctx: makeCtx(), battle: sacResolve() })
      const byName = new Map(game.privates.a.hand.map((c) => [c.name, c.meta.costDelta]))
      expect(byName.get('SS Ship')).toBe(SACRILEGO_COST_DELTA)
      expect(byName.get('DWG Ship')).toBe(SACRILEGO_COST_DELTA)
      expect(byName.get('SS Sub')).toBeUndefined()
      expect(byName.get('Custom')).toBeUndefined()
    })
```

Replace the deleted end-to-end test with one that proves a real battle lends
nothing and still charges the repair:

```ts
    // End to end through the real engine. Escort A lands in the repair band;
    // with no loan it is NOT auto-repaired and its owner pays for the repair.
    it('lends no SCRAPPY in a real battle — a repair in the band is paid for', () => {
      const game = makeGame({ turnNumber: 3 })
      const sac = zoneEntry({
        instanceId: 'sac', name: 'Sacrilego', vehicleType: 'ship',
        keywords: ['scrappy', 'stealthy'], meta: { onBattleEffect: 'sacrilegoBattle' },
      })
      const shipA = zoneEntry({ instanceId: 'shipA', name: 'Escort A', vehicleType: 'ship', materialCost: 100_000 })
      const foe = zoneEntry({ instanceId: 'foe', name: 'Foe', vehicleType: 'ship' })
      game.state.zones[0].cards.a.push(sac, shipA)
      game.state.zones[0].cards.b.push(foe)
      game.state.resources.a.materials = 500_000
      const locked = applyAction(game, 'alice', {
        type: 'ATTACK_ENEMY_FLEET', zoneId: 1, attackerIds: ['sac', 'shipA'], targetIds: ['foe'],
      }, makeCtx())
      if (!locked.ok) throw new Error(locked.error)
      const lockedA = locked.game.state.zones[0].cards.a.find((c) => c.instanceId === 'shipA')!
      expect(lockedA.keywords).not.toContain('scrappy')
      expect(lockedA.meta.scrappyOnLoan).toBeUndefined()
      const submitted = applyAction(locked.game, 'alice', {
        type: 'SUBMIT_BATTLE_REPORT',
        results: { sac: 95, shipA: 85, foe: 95 },
        repairs: ['shipA'],
      }, makeCtx())
      if (!submitted.ok) throw new Error(submitted.error)
      const before = submitted.game.state.resources.a.materials
      const decided = applyAction(submitted.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true }, makeCtx())
      if (!decided.ok) throw new Error(decided.error)
      expect(decided.game.state.resources.a.materials).toBeLessThan(before)
      expect(decided.game.state.log.join('\n')).toContain('Escort A was repaired')
    })
```

Keep the two `discardSnapshotOf … scrappyOnLoan` tests: the strip stays for
frozen in-flight snapshots (R-8). Prefix their shared comment with
`// 2026-09-16: no effect WRITES scrappyOnLoan any more; the strip is kept for
// hulls in games dealt before the deploy.`

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run shared/effects/factionEffects.test.ts -t sacrilego`
Expected: FAIL — `grants nothing at lock` (mate gains scrappy), `DWG Ship`
not discounted, e2e sees a loan.

- [ ] **Step 3: Rewrite `sacrilegoBattle`**

Replace lines 564–637 of `shared/effects/ssEffects.ts` with:

```ts
// "Whenever this vehicle survives a fleet battle, reduce the cost of AI ships
// in hand by 30k." (2026-09-16 — the fleet-wide SCRAPPY loan the card used to
// print is gone, and with it the lock clause and the resolve-time strip. The
// `scrappyOnLoan` strip in discardSnapshotOf STAYS for hulls in games dealt
// before this deploy, spec R-8.)
//
// Same registry id, new behaviour — a balance pass rewriting its own card,
// which is not the R-6 collision (two DIFFERENT cards sharing a name).
//
// The log carries neither names nor a count — state.log is public and the
// hand is hidden (Nothung's rule). "Survives" needs no findVehicle guard:
// `battle.survived` is per participant and false for a hull that died.
registerEffect('sacrilegoBattle', ({ game, actor, card, battle }) => {
  if (!battle || !battle.isParticipant) return true
  if (battle.phase !== 'resolve' || !battle.survived) return true
  for (const held of game.privates[actor].hand) {
    if (isAiShip(held)) discountInHand(held, SACRILEGO_COST_DELTA)
  }
  game.state.log.push(`${card.name} survives and cuts the yard's price for player ${actor.toUpperCase()}`)
  return true
})
```

Delete the `SACRILEGO` and `SCRAPPY_ON_LOAN` consts (lines 564–565). In
`shared/engine/gameEngine.ts` amend the `scrappyOnLoan` comment (line 310) to
open with `` `scrappyOnLoan` (2026-09-02, writer deleted 2026-09-16) `` and add
one sentence: `No effect writes it any more; it stays for hulls in games dealt
before that deploy (spec R-8).`

- [ ] **Step 4: Update the seed row and its pin**

`SS-built-in.js` Sacrilego (line 180):
`cardText: 'Whenever this vehicle survives a fleet battle, reduce the cost of AI ships in hand by 30k.',`
and line 190: `keywords: [KEYWORDS.SCRAPPY, KEYWORDS.STEALTHY],`.
`ss.balance.test.ts` lines 98–102: `keywords: ['scrappy', 'stealthy']` and the
new text. Run `npm run seed:build`.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 6: Sync and commit**

```powershell
npm run functions:sync
git add -A
git commit -m "feat(effects): Sacrilego keeps only its survive discount — the SCRAPPY loan is gone (2026-09-16)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: M-7 — Tyr's decay floors at 500k

**Files:**
- Modify: `shared/gameSettings.ts:181-187`
- Modify: `shared/effects/ssEffects.ts` (`tyrCostModifier`, currently lines 775–801)
- Modify: `supabase/seed/source/builtInCards/SS-built-in.js:144,154`
- Modify: `supabase/seed/balance/ss.balance.test.ts:41-45`
- Test: `shared/effects/factionEffects.test.ts:6694-6747`

**Interfaces:**
- Produces: `TYR_MIN_COST = 500_000` in `shared/gameSettings.ts`.

- [ ] **Step 1: Write the failing tests**

In `describe('SS Tyr — a discount that grows in your hand')` replace the test
`'bottoms out at free rather than going negative'` (lines 6719–6724) with:

```ts
  // M-7 (2026-09-16): "Min 500k". The decay alone can never take the printed
  // price below TYR_MIN_COST — 950k − 500k = 450k is seven and a half steps,
  // so step 8 lands exactly on the floor and step 100 stays there.
  it('never decays below TYR_MIN_COST', () => {
    expect(priceAt(9, 1)).toBe(TYR_MIN_COST)
    expect(priceAt(100, 1)).toBe(TYR_MIN_COST)
  })

  it('takes the last partial step down to the floor, not past it', () => {
    expect(priceAt(8, 1)).toBe(950_000 - 7 * TYR_HAND_DISCOUNT) // 530k, above the floor
    expect(priceAt(9, 1)).toBe(500_000)                          // 8 steps would be 470k — floored
  })

  // Q5: the floor is on Tyr's OWN decay. Another card's stamp still applies
  // beneath it, so an Excalibur'd Tyr at the floor costs 300k.
  it('lets other discounts apply beneath the floor', () => {
    const card = tyr(1)
    card.meta = { ...card.meta, costDelta: EXCALIBUR_COST_DELTA }
    expect(effectiveCostInGame(makeGame().state, 'a', card, 100)).toBe(TYR_MIN_COST + EXCALIBUR_COST_DELTA)
  })
```

Add `TYR_MIN_COST` to the file's `../gameSettings.ts` import.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run shared/effects/factionEffects.test.ts -t "SS Tyr"`
Expected: FAIL — `TYR_MIN_COST` is not exported (compile error).

- [ ] **Step 3: Add the constant and the floor**

`shared/gameSettings.ts`, after `TYR_HAND_DISCOUNT` (line 187):

```ts
// Tyr's "Min 500k" (2026-09-16 pass, M-7): the hand-residence decay above can
// never take the PRINTED price below this. It is a floor on Tyr's OWN decay,
// not on the final price (ruling Q5) — another card's costDelta stamp still
// applies beneath it, and effectiveCostInGame's zero clamp is a different
// guarantee again.
export const TYR_MIN_COST = 500_000
```

`shared/effects/ssEffects.ts`: import `TYR_MIN_COST`, and replace the
`tyrCostModifier` body's final line with:

```ts
  const decay = -TYR_HAND_DISCOUNT * Math.max(0, Math.floor(turnNumber - entered))
  // "Min 500k" (M-7, ruling Q5): this floors Tyr's OWN decay at the printed
  // price minus TYR_MIN_COST. It is a CARD floor and deliberately not a copy
  // of effectiveCostInGame's zero clamp — another card's costDelta stamp is
  // summed in after this returns and may still take the final price lower.
  return Math.max(decay, -Math.max(0, card.materialCost - TYR_MIN_COST))
```

Amend the comment above the modifier (lines 789–792): replace the sentence
`The price floor is effectiveCostInGame's own Math.max(0, …) and must not be
duplicated here (spec §4.2)` with `The ZERO floor is effectiveCostInGame's own
Math.max(0, …) and is not duplicated here (spec §4.2); the 500k floor below is
Tyr's own card rule (2026-09-16 M-7) and floors only this modifier's output.`

- [ ] **Step 4: Update the seed row and its pin**

`SS-built-in.js` Tyr: line 144
`cardText: 'This card costs 60k less for every turn it spends in your hand. Min 500k',`
line 154 `keywords: [KEYWORDS.BLOCKER, KEYWORDS.FRAGILE],`.
`ss.balance.test.ts` lines 41–45: `keywords: ['blocker', 'fragile']` and the
new text. Run `npm run seed:build`.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 6: Sync and commit**

```powershell
npm run functions:sync
git add -A
git commit -m "feat(effects): M-7 Tyr's hand decay floors at 500k, and Tyr prints FRAGILE

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: M-2 + M-3 — Mirth Factory targets an AI ship; one Mirth Swarm per side per battle

**Files:**
- Modify: `shared/engine/battleDeclare.ts:178-207` (`joinBattle`, new `battleCapReached`)
- Modify: `shared/effects/registry.ts:128-157` (`DATA_EFFECT_KEYS` + `battleCap`)
- Modify: `shared/effects/tgEffects.ts:55-89` (`obeliskBattle`), `588-644` (`factory`)
- Modify: `supabase/seed/source/builtInCards/TG-built-in.js` (Mirth Swarm, Mirth Factory, Obelisk)
- Modify: `supabase/seed/balance/tg.balance.test.ts:136,190-194`, `supabase/seed/tgFaction.test.ts:163`
- Test: `shared/effects/factionEffects.test.ts` (Obelisk block 4807, Factory block 5721), `shared/engine/battleDeclare.test.ts`

**Interfaces:**
- Consumes: `isAiShip` (Task 2), `lockRoster` (`battleTriggers.ts`).
- Produces: `battleCapReached(game: EngineGame, side: Side, card: { cardId: string; meta: Record<string, unknown> }): boolean`
  exported from `shared/engine/battleDeclare.ts`; `'battleCap'` in `DATA_EFFECT_KEYS`.

- [ ] **Step 1: Write the failing tests — M-2**

In `describe('TG Havoc/Mirth Factory — a rider on a hull (wave 7)')` (line
5721), after the `'E-5: refuses a friendly hull that is not ROBOTIC'` test add:

```ts
  // M-2 (2026-09-16): Mirth Factory targets a friendly AI SHIP — isAiShip,
  // the M-1 predicate — while Havoc Factory still reads ROBOTIC.
  it('M-2: Mirth Factory accepts a friendly built-in ship that is not ROBOTIC', () => {
    const r = playOnto('plain1', 'Mirth', (g) => {
      g.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'plain1', keywords: [], playedOnTurn: 1 }))
    })
    if (!r.ok) throw new Error(r.error)
    expect(findVehicle(r.game.state, 'plain1')!.entry.meta.factoryEscort).toBe('mirthFactoryEffect')
  })

  it('M-2: Mirth Factory refuses a ROBOTIC hull that is not a ship', () => {
    const r = playOnto('bot-plane', 'Mirth', (g) => {
      g.state.zones[0].cards.a.push(zoneEntry({
        instanceId: 'bot-plane', vehicleType: 'plane', keywords: [KEYWORDS.ROBOTIC], playedOnTurn: 1,
      }))
    })
    expect(r).toMatchObject({ ok: false, status: 400 })
  })

  it('M-2: Mirth Factory refuses a player-made ship', () => {
    const r = playOnto('custom1', 'Mirth', (g) => {
      g.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'custom1', isBuiltIn: false, playedOnTurn: 1 }))
    })
    expect(r).toMatchObject({ ok: false, status: 400 })
  })

  it('M-2: Havoc Factory still refuses a plain built-in ship — its text says robotic', () => {
    const r = playOnto('plain1', 'Havoc', (g) => {
      g.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'plain1', keywords: [], playedOnTurn: 1 }))
    })
    expect(r).toMatchObject({ ok: false, status: 400 })
  })
```

- [ ] **Step 2: Write the failing tests — M-3**

Add a new describe after the Obelisk block (after line 4898):

```ts
// ---------------------------------------------------------------------------
// 2026-09-16 — M-3: "No more than one mirth swarm can participate in any one
// battle on a single side, even if spawned in by card effect."
//
// A DATA key on Mirth Swarm (`battleCap: 1`), enforced at joinBattle — the one
// function that appends to a live battle — and pre-checked by the two spawners
// so a second summon is SKIPPED AND LOGGED rather than failing the trigger.
describe('Mirth Swarm battle cap (2026-09-16 M-3)', () => {
  const mirthSwarm = snap({
    name: 'Mirth Swarm', faction: 'TG', vehicleType: 'plane', materialCost: 200_000,
    keywords: [KEYWORDS.ROBOTIC, KEYWORDS.TEMPORARY, KEYWORDS.HALF_COST],
    meta: { summonOnly: true, battleCap: 1 },
  })
  const havocSwarm = snap({
    name: 'Havoc Swarm', faction: 'TG', vehicleType: 'plane', materialCost: 120_000,
    keywords: [KEYWORDS.ROBOTIC, KEYWORDS.TEMPORARY, KEYWORDS.HALF_COST],
    meta: { summonOnly: true },
  })
  const capCtx = () => makeCtx({ catalog: [mirthSwarm, havocSwarm] })
  const obelisk = (instanceId: string, meta: Record<string, unknown> = {}) => zoneEntry({
    instanceId, name: 'Obelisk', faction: 'TG', vehicleType: 'ship', materialCost: 60_000,
    meta: { onBattleEffect: 'obeliskBattle', ...meta }, playedOnTurn: 1,
  })
  const fight = (game: EngineGame, attackerIds: string[], defenderIds: string[]) => {
    if (!declareForcedBattle(game, capCtx(), { zoneId: 1, aggressor: 'a', attackerIds, defenderIds, cause: 'Test' })) {
      throw new Error('battle not declared')
    }
    return game.state.activeBattle!
  }
  const swarmsOn = (battle: NonNullable<EngineGame['state']['activeBattle']>, ids: string[]) =>
    battle.summons.filter((s) => s.name === 'Mirth Swarm' && ids.includes(s.instanceId)).length

  it('two Obelisks on one side field ONE Mirth Swarm, and the second is logged as held back', () => {
    const game = makeGame({ turnNumber: 3 })
    game.state.zones[0].cards.a.push(obelisk('ob1'), obelisk('ob2'))
    game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'foe', playedOnTurn: 1 }))
    const battle = fight(game, ['ob1', 'ob2'], ['foe'])
    expect(swarmsOn(battle, battle.attackerIds)).toBe(1)
    expect(game.state.log.join('\n')).toContain('holds its Mirth Swarm back')
    expect(game.state.log.join('\n')).not.toContain('could not resolve')
  })

  it('an Obelisk on EACH side fields one each — the cap is per side', () => {
    const game = makeGame({ turnNumber: 3 })
    game.state.zones[0].cards.a.push(obelisk('ob1'))
    game.state.zones[0].cards.b.push(obelisk('ob2'))
    const battle = fight(game, ['ob1'], ['ob2'])
    expect(swarmsOn(battle, battle.attackerIds)).toBe(1)
    expect(swarmsOn(battle, battle.defenderIds)).toBe(1)
  })

  // The exact case M-2 makes reachable: Mirth Factory on an Obelisk.
  it('an Obelisk escorted by a Mirth Factory still fields one Mirth Swarm', () => {
    const game = makeGame({ turnNumber: 3 })
    game.state.zones[0].cards.a.push(obelisk('ob1', { factoryEscort: 'mirthFactoryEffect' }))
    game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'foe', playedOnTurn: 1 }))
    const battle = fight(game, ['ob1'], ['foe'])
    expect(battle.summons.map((s) => s.name)).toEqual(['Mirth Swarm'])
  })

  it('a Havoc Swarm escort is not capped — different card, different cardId', () => {
    const game = makeGame({ turnNumber: 3 })
    game.state.zones[0].cards.a.push(obelisk('ob1', { factoryEscort: 'havocFactoryEffect' }))
    game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'foe', playedOnTurn: 1 }))
    const battle = fight(game, ['ob1'], ['foe'])
    expect(battle.summons.map((s) => s.name).sort()).toEqual(['Havoc Swarm', 'Mirth Swarm'])
  })

  // "However it got there": a BOARD Mirth Swarm (Drones) already in the
  // battle counts, so the Obelisk's summon is held back.
  it('counts a board Mirth Swarm already fighting on that side', () => {
    const game = makeGame({ turnNumber: 3 })
    const board = zoneEntry({ ...mirthSwarm, instanceId: 'drone1', playedOnTurn: 3 })
    game.state.zones[0].cards.a.push(obelisk('ob1'), board)
    game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'foe', playedOnTurn: 1 }))
    const battle = fight(game, ['ob1', 'drone1'], ['foe'])
    expect(battle.summons).toHaveLength(0)
  })

  it('joinBattle itself refuses a capped hull, so no future spawner can bypass it', () => {
    const game = makeGame({ turnNumber: 3 })
    game.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'mine', playedOnTurn: 1 }))
    game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'foe', playedOnTurn: 1 }))
    fight(game, ['mine'], ['foe'])
    const [first, second] = summonHulls(game, capCtx(), 'Mirth Swarm', 2)!
    expect(joinBattle(game, 'a', first.instanceId, first)).toBe(true)
    expect(battleCapReached(game, 'a', second)).toBe(true)
    expect(joinBattle(game, 'a', second.instanceId, second)).toBe(false)
    expect(game.state.activeBattle!.summons).toHaveLength(1)
  })

  it('a hull without battleCap, or with a non-numeric one, is never capped', () => {
    const game = makeGame({ turnNumber: 3 })
    game.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'mine', playedOnTurn: 1 }))
    game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'foe', playedOnTurn: 1 }))
    fight(game, ['mine'], ['foe'])
    const havocs = summonHulls(game, capCtx(), 'Havoc Swarm', 2)!
    for (const h of havocs) expect(joinBattle(game, 'a', h.instanceId, h)).toBe(true)
    const typo = { ...havocs[0], instanceId: 'typo', meta: { battleCap: '1' } }
    expect(battleCapReached(game, 'a', typo)).toBe(false)
  })

  it('battleCap is a recognised data key, so Mirth Swarm can carry text and no effect name', () => {
    expect([...DATA_EFFECT_KEYS]).toContain('battleCap')
  })
})
```

Add `summonHulls` to the `'./primitives.ts'` import, `battleCapReached` to the
`'../engine/index.ts'` import and `DATA_EFFECT_KEYS` to the `'./registry.ts'`
import at the top of `factionEffects.test.ts`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run shared/effects/factionEffects.test.ts -t "M-2|M-3"`
Expected: FAIL — `battleCapReached` not exported; Mirth Factory refuses the
plain ship; two swarms are summoned.

- [ ] **Step 4: Add `battleCap` to the vocabulary**

`shared/effects/registry.ts` — extend the comment above `DATA_EFFECT_KEYS` with:

```ts
// `battleCap` (2026-09-16 spec M-3) joins them for slotDenial's reason: TG
// Mirth Swarm prints one sentence, that sentence IS a rule read by joinBattle
// (shared/engine/battleDeclare.ts), and the card names no effect at all.
```

and add `'battleCap'` to the array after `'slotDenial'`.

- [ ] **Step 5: Enforce the cap in `joinBattle`**

In `shared/engine/battleDeclare.ts` add, directly above `joinBattle`:

```ts
// M-3 (2026-09-16 spec): "no more than one mirth swarm can participate in any
// one battle on a single side, even if spawned in by card effect". A DATA key
// (`battleCap: n`) on the card, so the next capped card needs no engine edit
// — the slotDenial/uniquePerZone shape — read strictly: a non-number or
// non-positive value leaves the hull uncapped rather than unjoinable.
//
// Counts what is ALREADY fighting on that side, board hulls and summons alike
// ("however it got there"), keyed on cardId like uniquePerZone so a copy
// minted from the catalog matches a copy Drones put on the board. Exported so
// the two spawners (obeliskBattle, the Factory escort) can pre-check and log a
// skip instead of failing their trigger; joinBattle below checks it again so
// no future spawner can bypass the rule.
export function battleCapReached(
  game: EngineGame, side: Side, card: { cardId: string; meta: Record<string, unknown> },
): boolean {
  const cap = card.meta.battleCap
  if (typeof cap !== 'number' || !Number.isFinite(cap) || cap <= 0) return false
  if (!game.state.activeBattle) return false
  const fielded = lockRoster(game).filter((p) => p.side === side && p.entry.cardId === card.cardId).length
  return fielded >= Math.floor(cap)
}
```

and change `joinBattle` to:

```ts
export function joinBattle(
  game: EngineGame, side: Side, instanceId: string, entry?: ZoneCardEntry,
): boolean {
  const battle = game.state.activeBattle
  if (!battle) return false
  if (battle.attackerIds.includes(instanceId) || battle.defenderIds.includes(instanceId)) return false
  let joining: ZoneCardEntry | undefined = entry
  if (!entry) {
    const zone = zoneById(game.state, battle.zoneId)
    joining = zone?.cards[side].find((c) => c.instanceId === instanceId) as ZoneCardEntry | undefined
    if (!joining) return false
  }
  // M-3. Checked BEFORE the summon is pushed, so a refused join leaves the
  // battle exactly as it was.
  if (battleCapReached(game, side, joining!)) return false
  if (entry) battle.summons.push(entry)
  if (side === battle.aggressor) battle.attackerIds.push(instanceId)
  else battle.defenderIds.push(instanceId)
  return true
}
```

(`lockRoster` is already imported from `./battleTriggers.ts`.)

- [ ] **Step 6: Pre-check in the two spawners and parametrise `factory`**

`shared/effects/tgEffects.ts` — import `battleCapReached` from
`'../engine/battleDeclare.ts'` and `isAiShip` from `'./primitives.ts'`.

Replace `obeliskBattle`'s body (lines 78–89) with:

```ts
registerEffect('obeliskBattle', ({ game, actor, ctx, card, battle }) => {
  if (!battle || battle.phase !== 'lock' || !battle.isParticipant) return true
  const summons = summonHulls(game, ctx, 'Mirth Swarm', 1)
  // A missing catalog card is a data bug, not an empty pool — but at lock the
  // battle is already declared and cannot be rolled back, so this reports
  // failure and DP2's dispatcher logs it rather than throwing.
  if (!summons) return false
  const [swarm] = summons
  // M-3: one Mirth Swarm per side per battle, however it got there. A second
  // is SKIPPED and said so — not a failed trigger, the card did nothing wrong.
  if (battleCapReached(game, actor, swarm)) {
    game.state.log.push(`${card.name} holds its ${swarm.name} back — one already fights on its side`)
    return true
  }
  if (!joinBattle(game, actor, swarm.instanceId, swarm)) return false
  game.state.log.push(`${card.name} calls in a ${swarm.name}`)
  return true
}, { needsCatalog: true })
```

Replace the `factory` function and its two registrations (lines 619–644) with:

```ts
function factory(effectName: string, swarmName: string, eligible: (e: ZoneCardEntry) => boolean): EffectFn {
  return ({ game, actor, ctx, card, battle, targetInstanceId }) => {
    // Escort half: dispatched at battle lock off the stamp. `battle` is the
    // only thing distinguishing the two entries — dwgWatersEffect's shape.
    if (battle) {
      if (battle.phase !== 'lock') return true
      const summons = summonHulls(game, ctx, swarmName, 1)
      if (!summons) return false
      const [hull] = summons
      // M-3 (2026-09-16): Mirth Swarm prints battleCap: 1. Skipped and logged,
      // never failed — obeliskBattle's shape.
      if (battleCapReached(game, actor, hull)) {
        game.state.log.push(`${card.name} holds its ${swarmName} back — one already fights on its side`)
        return true
      }
      if (!joinBattle(game, actor, hull.instanceId, hull)) return false
      game.state.log.push(`A ${swarmName} joins the battle alongside ${card.name}`)
      return true
    }
    // Play half: validate, then stamp.
    if (typeof targetInstanceId !== 'string') return false
    const found = findVehicle(game.state, targetInstanceId)
    if (!found || found.side !== actor) return false
    if (!eligible(found.entry)) return false
    found.entry.meta = { ...found.entry.meta, [FACTORY_ESCORT_KEY]: effectName }
    game.state.log.push(`${card.name} is assigned to ${found.entry.name}`)
    return true
  }
}

// Havoc Factory: "Target friendly robotic vehicle." — unchanged.
registerEffect('havocFactoryEffect', factory(
  'havocFactoryEffect', 'Havoc Swarm', (e) => e.keywords.includes(KEYWORDS.ROBOTIC),
), { needsCatalog: true })
// Mirth Factory: "Target friendly AI ship." (2026-09-16 M-2) — the M-1
// predicate, so TG's robotic non-ships stop being targets and Obelisk, a
// built-in TG ship, becomes one. The own-side check above stays (ruling E-5).
registerEffect('mirthFactoryEffect', factory('mirthFactoryEffect', 'Mirth Swarm', isAiShip), { needsCatalog: true })
```

Update the `factory` header comment's first line to `// "Target friendly
robotic vehicle." (Havoc) / "Target friendly AI ship." (Mirth) …` and amend
the E-5 note: `so this validates own-side AND the card's own target predicate`.
Also amend `obeliskBattle`'s header: delete the paragraph `⚠ Obelisk is
STEALTHY, so an ATTACK_ENEMY_FLEET naming it raises the response window…`
(Obelisk loses STEALTHY in this pass) and add `M-3: at most one Mirth Swarm
per side per battle — see battleCapReached.`

- [ ] **Step 7: Seed rows and pins**

`TG-built-in.js`:
- Mirth Swarm (line 402): `cardText: 'No more than one mirth swarm can participate in any one battle on a single side, even if spawned in by card effect',`
  and meta (lines 413–415):
  ```js
        meta: {
            summonOnly: true,
            // M-3 (2026-09-16): read by joinBattle via battleCapReached —
            // a rule, not an effect name, so the next capped card needs no
            // engine edit. Must stay in DATA_EFFECT_KEYS: this card now has
            // text and names no effect (G2).
            battleCap: 1,
        }
  ```
- Mirth Factory (line 437): `cardText: 'Target friendly AI ship. Whenever that vehicle is engaged in a fleet combat, spawn a Mirth swarm to fight along side it',`
- Obelisk (line 454): `cardText: 'Whenever this vehicle participates in a fleet battle, spawn a temporary Mirth swarm to fight on your side in the battlefield. You may only control one Obelisk per zone.',`
  line 455 `materialCost: 60000,`, line 464 `keywords: [],`. Update its
  `uniquePerZone` comment's `A 40k ship` to `A 60k ship`.

`supabase/seed/balance/tg.balance.test.ts` line 136:
`Obelisk: { materialCost: 60_000, keywords: [], vehicleType: 'ship' },` and the
Mirth Factory text test (line 190–194) to the new sentence. Prefix the
`MOVED` map comment with `// ⚠ Obelisk moved again on 2026-09-16 (60k, −STEALTHY)
— updated in place per §2.3.`
`supabase/seed/tgFaction.test.ts` line 163:
`Obelisk: { materialCost: 60_000, blueprintCost: 32_000, vehicleType: 'ship', type: V, keywords: [] },`

Run `npm run seed:build`.

- [ ] **Step 8: Run the full suite**

Run: `npx vitest run`
Expected: PASS. (The `'coexists with the hull's OWN printed battle trigger'`
test at 5824 still passes — Havoc and Mirth have different cardIds.)

- [ ] **Step 9: Sync and commit**

```powershell
npm run functions:sync
git add -A
git commit -m "feat(engine): M-3 one Mirth Swarm per side per battle (battleCap), M-2 Mirth Factory targets an AI ship, Obelisk 60k and loses STEALTHY

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: M-9 — Fear draws a card; Horror is retired

**Files:**
- Modify: `shared/effects/tgEffects.ts:29-53` (`fearOnPlay`)
- Modify: `supabase/seed/source/builtInCards/TG-built-in.js` (Fear line 257, Horror meta line 87–89)
- Modify: `supabase/seed/retirement.test.ts`
- Test: `shared/effects/factionEffects.test.ts:31-51` (DRAW_ONE), `4715-4797` (Fear block)

**Interfaces:**
- Produces: `fearOnPlay` = `grant({ draw: 1 })`, no catalog flag; `TG:Horror` carries `retired: true`.

- [ ] **Step 1: Write the failing tests**

In `factionEffects.test.ts` add `'fearOnPlay'` to the `DRAW_ONE` list (line 31)
with the comment `// 2026-09-16. TG Fear: "When this vehicle is played, draw
a card" — it no longer spawns Horrors.` Replace the whole
`describe('TG Fear — a Horror into every zone (wave 7)')` block (lines
4715–4797) with:

```ts
describe('TG Fear — draws a card (2026-09-16; it used to spawn Horrors)', () => {
  it('spawns nothing and needs no catalog', () => {
    const card = inst({
      name: 'Fear', faction: 'TG', vehicleType: 'ship', materialCost: 500_000,
      keywords: [KEYWORDS.BLOCKER, KEYWORDS.ROBOTIC, KEYWORDS.UPKEEP_REQUIRED],
      meta: { onPlayEffect: 'fearOnPlay' },
    })
    const game = makeGame({ privates: { a: { hand: [card], deck: [inst({ name: 'Top' })] }, b: { hand: [], deck: [] } } })
    game.state.resources.a.materials = 900_000
    const r = applyAction(game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    for (const zone of r.game.state.zones) expect(zone.cards.a.filter((c) => c.name === 'Horror')).toHaveLength(0)
    expect(r.game.privates.a.hand.map((c) => c.name)).toEqual(['Top'])
    expect(CATALOG_EFFECTS.has('fearOnPlay')).toBe(false)
  })
})
```

In `supabase/seed/retirement.test.ts`: `RETIRED` gains `'TG:Horror'`; rename
the first test to `'retires exactly the six cards the two passes name'`; in
`'leaves the retired cards still naming their effects'` add
`expect(meta('TG:Horror').onBattleEffect).toBe('horrorBattle')`; change the
describe title to `'balance-pass retirements (2026-09-02, 2026-09-16)'` and
add above `RETIRED`: `// TG:Horror joined on 2026-09-16 (spec M-9): Fear's
rewrite removed its last spawner.`

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run shared/effects/factionEffects.test.ts supabase/seed/retirement.test.ts -t "Fear|retire"`
Expected: FAIL — Fear spawns Horrors / needs the catalog; Horror is not retired.

- [ ] **Step 3: Rewrite `fearOnPlay`**

Replace lines 29–53 of `shared/effects/tgEffects.ts` with:

```ts
// "When this vehicle is played, draw a card." (2026-09-16 pass.) Same registry
// id as the Horror-spawning version it replaces — a balance pass rewriting its
// own card, not the R-6 collision. No { needsCatalog: true } any more: the
// spawn read ctx.catalog, a draw reads only the deck. Fear was Horror's last
// spawner, which is what let M-9 retire Horror without deleting it.
registerEffect('fearOnPlay', grant({ draw: 1 }))
```

`spawnVehicles` stays imported (Task 5's code does not use it; check with
`git grep -n spawnVehicles shared/effects/tgEffects.ts` — if the only hit is
the import, drop it from the import list).

- [ ] **Step 4: Seed rows**

`TG-built-in.js` Fear (line 257): `cardText: 'When this vehicle is played, draw a card',`.
Horror meta (lines 87–89):

```js
        meta: {
            [TRIGGERS.ON_BATTLE_EFFECT]: 'horrorBattle',
            // Retired by the 2026-09-16 pass (M-9): Fear's rewrite removed
            // its last spawner. The row stays so in-flight snapshots and
            // unedited decks still resolve, and horrorBattle stays registered
            // (Harbringer's precedent, 2026-09-02 §2.1).
            retired: true,
        }
```

Run `npm run seed:build`.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 6: Sync and commit**

```powershell
npm run functions:sync
git add -A
git commit -m "feat(effects): M-9 Fear draws a card and Horror is retired, not deleted

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: M-4 — Mutiny steals an enemy vehicle for one turn (`homeSide` stamp)

**Files:**
- Modify: `shared/engine/gameEngine.ts:38-48, 288-370` (`HOME_SIDE_KEY`, `homeSideOf`, `discardSnapshotOf`, `discardCard`)
- Modify: `shared/effects/dwgEffects.ts` (new `mutinyEffect`, imports)
- Modify: `supabase/seed/source/builtInCards/DWG-built-in.js` (new Mutiny row after Flying Squirrel Attack)
- Test: `shared/engine/gameEngine.test.ts` (append), `shared/effects/dwgEffects.test.ts` (append)

**Interfaces:**
- Produces: `HOME_SIDE_KEY = 'homeSide'`, `homeSideOf(card): Side | null` exported
  from `gameEngine.ts`; `discardCard` files under `homeSideOf(card) ?? controller`;
  registry id `mutinyEffect` (`playOnVehicleEffect`). Task 8 seeds Brigand,
  which mints Mutiny by name `'Mutiny'`.
- Consumes: `zoneCapFor` (`zoneCapacity.ts`), `uniquePerZoneBlocked` (`placement.ts`),
  `grantKeywordsTo`, `findVehicle`, `otherSide`.

- [ ] **Step 1: Write the failing engine tests**

Append to `shared/engine/gameEngine.test.ts` (add `homeSideOf` and `HOME_SIDE_KEY`
to the `'./index'` import):

```ts
// 2026-09-16 M-4 (ruling Q2): a mutinied hull goes HOME when it leaves play —
// the discard of the side it was stolen from, not of the side flying it.
describe('discardCard files a hull under its homeSide (2026-09-16 M-4)', () => {
  it('a hull stamped homeSide b, discarded by its controller a, lands in b\'s pile', () => {
    const g = makeGame()
    const stolen = zoneEntry({ name: 'Stolen', meta: { [HOME_SIDE_KEY]: 'b' } })
    discardCard(g, 'a', stolen)
    expect(g.state.destroyed.a).toHaveLength(0)
    expect(g.state.destroyed.b.map((c) => c.name)).toEqual(['Stolen'])
  })

  it('an unstamped hull still files under its controller', () => {
    const g = makeGame()
    discardCard(g, 'a', zoneEntry({ name: 'Mine' }))
    expect(g.state.destroyed.a.map((c) => c.name)).toEqual(['Mine'])
  })

  it('a mistyped stamp is ignored, never thrown on', () => {
    const g = makeGame()
    discardCard(g, 'a', zoneEntry({ name: 'Odd', meta: { [HOME_SIDE_KEY]: 'c' } }))
    expect(g.state.destroyed.a.map((c) => c.name)).toEqual(['Odd'])
    expect(homeSideOf({ meta: { [HOME_SIDE_KEY]: 'c' } })).toBeNull()
    expect(homeSideOf({ meta: { [HOME_SIDE_KEY]: 'b' } })).toBe('b')
  })

  // The snapshot-destructure trap (docs/claude/architecture.md): a
  // per-instance stamp that is not named in the strip rides into the discard
  // and back out of the deck.
  it('discardSnapshotOf strips the stamp', () => {
    const snapshot = discardSnapshotOf(zoneEntry({ meta: { [HOME_SIDE_KEY]: 'b', additionalSpawns: 1 } }))
    expect((snapshot.meta as Record<string, unknown>)[HOME_SIDE_KEY]).toBeUndefined()
    expect(snapshot.meta.additionalSpawns).toBe(1) // printed data stays
  })
})
```

- [ ] **Step 2: Write the failing effect tests**

Append to `shared/effects/dwgEffects.test.ts`. Its imports today are
`costModifierFor, effectFor` (registry), `DOUBLE_UP_MAX_COST, KEYWORDS,
RESERVES_CARD_COUNT` (gameSettings), the five fixtures, and `applyAction,
autoRepairIds, declareForcedBattle` (engine index). Extend them to:

```ts
import { CATALOG_EFFECTS, costModifierFor, effectFor } from './registry.ts'
import { DOUBLE_UP_MAX_COST, KEYWORDS, MAX_VEHICLES_PER_ZONE_SIDE, RESERVES_CARD_COUNT } from '../gameSettings.ts'
import { inst, makeCtx, makeGame, snap, zoneEntry } from '../engine/testFixtures.ts'
import {
  HOME_SIDE_KEY, applyAction, autoRepairIds, baseStrikersIn, declareForcedBattle, findVehicle,
} from '../engine/index.ts'
import type { EngineGame } from '../engine/engineTypes.ts'
import type { CardInstance } from '../engine/gameInit.ts'
```

then append:

```ts
// ---------------------------------------------------------------------------
// 2026-09-16 M-4 — DWG Mutiny: "Choose an enemy vehicle, gain control of it and
// give it temporary." A CONTROL CHANGE, new engine ground: the entry moves from
// zone.cards[enemy] to zone.cards[actor] in the same zone, carries a homeSide
// stamp so it is discarded to its owner (Q2), gains TEMPORARY through
// grantKeywordsTo so the turn-start cull removes it, and is re-stamped as
// freshly deployed (D-1, Boarding Party's precedent).
describe('mutinyEffect (2026-09-16 M-4)', () => {
  const mutiny = () => inst({
    name: 'Mutiny', faction: 'DWG', type: 'ability', vehicleType: null, materialCost: 400_000,
    meta: { playOnVehicleEffect: 'mutinyEffect' },
  })
  // Bob keeps one card in his deck: END_TURN draws for the incoming side, and
  // an EMPTY deck would reshuffle his discard — the buried Foe included —
  // straight back into it, hiding exactly what the Q2 test below looks for.
  const board = () => {
    const game = makeGame({ turnNumber: 3 })
    const foe = zoneEntry({ instanceId: 'foe1', name: 'Foe', cardId: 'card:foe', keywords: ['blocker'], playedOnTurn: 1 })
    game.state.zones[0].cards.b.push(foe)
    game.privates.b.deck.push(inst({ name: 'B Top' }))
    game.state.counts.b.deck = 1
    return { game, foe }
  }
  const steal = (game: EngineGame, targetInstanceId: string) => effectFor('mutinyEffect')!({
    game, actor: 'a', card: mutiny(), ctx: makeCtx(), targetInstanceId,
  })

  it('moves the hull to the actor\'s side of the same zone, Temporary, stamped home, freshly deployed', () => {
    const { game } = board()
    expect(steal(game, 'foe1')).toBe(true)
    expect(game.state.zones[0].cards.b).toHaveLength(0)
    const found = findVehicle(game.state, 'foe1')!
    expect(found.side).toBe('a')
    expect(found.zone.id).toBe(1)
    expect(found.entry.keywords).toEqual(['blocker', KEYWORDS.TEMPORARY])
    expect(found.entry.meta.grantedKeywords).toEqual([KEYWORDS.TEMPORARY])
    expect(found.entry.meta[HOME_SIDE_KEY]).toBe('b')
    expect(found.entry).toMatchObject({ playedOnTurn: 3, movedOnTurn: null, activatedOnTurn: null })
    expect(game.state.log.at(-1)).toContain('Foe')
  })

  it('refuses a friendly hull, and a missing one', () => {
    const { game } = board()
    game.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'mine1', playedOnTurn: 1 }))
    expect(steal(game, 'mine1')).toBe(false)
    expect(steal(game, 'nope')).toBe(false)
    expect(effectFor('mutinyEffect')!({ game, actor: 'a', card: mutiny(), ctx: makeCtx() })).toBe(false)
  })

  // Q1: refuse, do not exceed the cap.
  it('refuses when the actor\'s side of the zone is at its cap', () => {
    const { game } = board()
    for (let i = 0; i < MAX_VEHICLES_PER_ZONE_SIDE; i++) {
      game.state.zones[0].cards.a.push(zoneEntry({ instanceId: `full-${i}`, playedOnTurn: 1 }))
    }
    expect(steal(game, 'foe1')).toBe(false)
    expect(game.state.zones[0].cards.b.map((c) => c.instanceId)).toEqual(['foe1'])
  })

  // Q1's second gate: the same uniquePerZone rule moveEntry applies.
  it('refuses to steal a second copy of a uniquePerZone card into a zone holding one', () => {
    const game = makeGame({ turnNumber: 3 })
    game.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'myOb', cardId: 'card:ob', meta: { uniquePerZone: true }, playedOnTurn: 1 }))
    game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'theirOb', cardId: 'card:ob', meta: { uniquePerZone: true }, playedOnTurn: 1 }))
    expect(steal(game, 'theirOb')).toBe(false)
    expect(findVehicle(game.state, 'theirOb')!.side).toBe('b')
  })

  it('leaves an already-Temporary hull Temporary without recording a grant', () => {
    const game = makeGame({ turnNumber: 3 })
    game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'tmp', keywords: [KEYWORDS.TEMPORARY], playedOnTurn: 1 }))
    expect(steal(game, 'tmp')).toBe(true)
    const entry = findVehicle(game.state, 'tmp')!.entry
    expect(entry.keywords).toEqual([KEYWORDS.TEMPORARY])
    expect(entry.meta.grantedKeywords).toBeUndefined()
  })

  // Q2 end to end: played for real, then the thief ends the turn. The cull
  // discards the hull to its OWNER's pile, clean of the stamp and the grant.
  it('is culled at the thief\'s END_TURN into the owner\'s discard, clean', () => {
    const { game } = board()
    const card = mutiny()
    game.privates.a.hand.push(card)
    game.state.counts.a.hand = 1
    game.state.resources.a.materials = 400_000
    const played = applyAction(game, 'alice', {
      type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD', instanceId: card.instanceId, targetInstanceId: 'foe1',
    }, makeCtx())
    if (!played.ok) throw new Error(played.error)
    expect(played.game.state.resources.a.materials).toBe(0)
    expect(findVehicle(played.game.state, 'foe1')!.side).toBe('a')
    const ended = applyAction(played.game, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!ended.ok) throw new Error(ended.error)
    expect(findVehicle(ended.game.state, 'foe1')).toBeNull()
    // Alice's pile holds only the SPENT Mutiny card — never the hull it stole.
    expect(ended.game.state.destroyed.a.map((c) => c.name)).toEqual(['Mutiny'])
    const buried = ended.game.state.destroyed.b
    expect(buried.map((c) => c.name)).toEqual(['Foe'])
    expect(buried[0].keywords).toEqual(['blocker'])
    expect((buried[0].meta as Record<string, unknown>)[HOME_SIDE_KEY]).toBeUndefined()
    expect(buried[0].meta.grantedKeywords).toBeUndefined()
  })

  // A refused play spends nothing (Q1): the handler 400s and the clone is dropped.
  it('a refused play through the handler leaves the hand and materials untouched', () => {
    const { game } = board()
    for (let i = 0; i < MAX_VEHICLES_PER_ZONE_SIDE; i++) {
      game.state.zones[0].cards.a.push(zoneEntry({ instanceId: `full-${i}`, playedOnTurn: 1 }))
    }
    const card = mutiny()
    game.privates.a.hand.push(card)
    game.state.counts.a.hand = 1
    game.state.resources.a.materials = 400_000
    const r = applyAction(game, 'alice', {
      type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD', instanceId: card.instanceId, targetInstanceId: 'foe1',
    }, makeCtx())
    expect(r).toMatchObject({ ok: false, status: 400 })
    expect(game.privates.a.hand).toHaveLength(1)
    expect(game.state.resources.a.materials).toBe(400_000)
  })

  // D-1: a stolen hull cannot bombard this turn (fresh deployment), which is
  // Boarding Party's rule for a hull that changed sides.
  it('re-stamps playedOnTurn so the stolen hull cannot bombard this turn', () => {
    const { game } = board()
    steal(game, 'foe1')
    const entry = findVehicle(game.state, 'foe1')!.entry
    expect(baseStrikersIn([entry], game.turnNumber)).toEqual([])
  })

  it('needs no catalog', () => {
    expect(CATALOG_EFFECTS.has('mutinyEffect')).toBe(false)
  })
})
```

Add `baseStrikersIn` and `MAX_VEHICLES_PER_ZONE_SIDE` to the imports
(`'../engine/index.ts'` re-exports `baseStrikersIn`; the constant comes from
`'../gameSettings.ts'`), and `CATALOG_EFFECTS` from `'./registry.ts'` if absent.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run shared/engine/gameEngine.test.ts shared/effects/dwgEffects.test.ts -t "homeSide|mutiny"`
Expected: FAIL — `HOME_SIDE_KEY`/`homeSideOf` not exported, `mutinyEffect` null.

- [ ] **Step 4: Engine — the stamp, the strip, the filing**

`shared/engine/gameEngine.ts`, after `isCapturedCopy` (line 48):

```ts
// The side whose DISCARD a hull returns to when that is not the side flying it
// (2026-09-16 spec M-4, ruling Q2). Written by DWG Mutiny onto a stolen entry,
// read by discardCard, stripped by discardSnapshotOf — a per-instance stamp
// like factoryEscort, and named in that strip list for the same reason. Absent
// means "the controller", which is what every hull dealt before this pass
// means, so normalizeState needs no default. Read strictly: a value that is
// not a side is ignored rather than indexed.
export const HOME_SIDE_KEY = 'homeSide'
export function homeSideOf(card: { meta: Record<string, unknown> }): Side | null {
  const raw = card.meta[HOME_SIDE_KEY]
  return raw === 'a' || raw === 'b' ? raw : null
}
```

In `discardSnapshotOf` (line 344), add `homeSide: _homeSide,` to the meta
destructure after `factoryEscort: _factoryEscort,` and a comment line:
`// \`homeSide\` (2026-09-16 M-4) comes off for factoryEscort's reason: it is a
// per-INSTANCE stamp for one theft, and the card it rode in on belongs to the
// deck it is about to reshuffle into.`

Replace `discardCard` (lines 362–370) with:

```ts
export function discardCard(game: EngineGame, controller: Side, card: CardInstance): void {
  // Two kinds of card must never reach a discard, because that is a deck's
  // back door. Summon-only cards are spawned, never drafted (spec §7.1). A
  // captured copy was never in the captor's deck and never left its owner's,
  // so filing it anywhere would mint a card that did not exist. This is the
  // single exit out of play, so guarding both here covers every path at once.
  if (isSummonOnly(card) || isCapturedCopy(card)) return
  // A mutinied hull goes HOME rather than to the thief's discard (2026-09-16
  // M-4, ruling Q2): the card belongs to its owner's deck, and reshuffleDiscard
  // feeds this pile back into exactly that deck. Read BEFORE the snapshot
  // strips the stamp. Covers the turn-start cull and a death in battle alike.
  const home = homeSideOf(card) ?? controller
  game.state.destroyed[home].push(discardSnapshotOf(card))
}
```

- [ ] **Step 5: The effect and its row**

In `shared/effects/dwgEffects.ts` add to the imports: `HOME_SIDE_KEY`,
`grantKeywordsTo` (from `'../engine/gameEngine.ts'`), `uniquePerZoneBlocked`
(from `'../engine/placement.ts'`), `zoneCapFor` (from `'../engine/zoneCapacity.ts'`).
Append after `gangUpEffect`:

```ts
// "Choose an enemy vehicle, gain control of it and give it temporary." (M-4,
// 2026-09-16.) The engine's first CONTROL CHANGE: the entry is moved between
// the two side lists of its own zone. No new primitive — it is one splice and
// one push, and nothing else needs to move a hull between sides.
//
// PLAY_CARD_TARGETING_CARD_ON_FIELD checks only that the target is on the
// field, not whose it is (ruling E-5), so the enemy-side test is here —
// flyingSquirrelAttackEffect's shape.
//
// Q1: a full zone REFUSES the play rather than exceeding the cap, and so does
// a uniquePerZone clash (a second Albacore/Obelisk into a zone you already
// hold one in) — the two gates moveEntry applies to walking a hull in. A
// refusal 400s the handler and the 400k is never spent.
//
// Q2: the stolen entry is stamped HOME_SIDE_KEY with the side it came from, so
// discardCard files it under its owner when the turn-start cull (or a death in
// battle) sends it out of play; discardSnapshotOf strips the stamp on the way.
//
// D-1: re-stamped as freshly deployed, as Boarding Party re-stamps both hulls
// it swaps — so it can fight a fleet battle this turn but cannot bombard.
// TEMPORARY is granted through grantKeywordsTo so the grant is recorded and
// shed with the rest; a hull that already prints it records nothing and is
// culled just the same.
registerEffect('mutinyEffect', ({ game, actor, card, targetInstanceId }) => {
  if (typeof targetInstanceId !== 'string') return false
  const found = findVehicle(game.state, targetInstanceId)
  if (!found || found.side !== otherSide(actor)) return false
  const { zone, entry, side: owner } = found
  if (zone.cards[actor].length >= zoneCapFor(game.state, actor, zone.id)) return false
  if (uniquePerZoneBlocked(game.state, actor, zone.id, entry)) return false
  zone.cards[owner] = zone.cards[owner].filter((c) => c.instanceId !== entry.instanceId)
  const stolen: ZoneCardEntry = {
    ...entry,
    meta: { ...entry.meta, [HOME_SIDE_KEY]: entry.meta[HOME_SIDE_KEY] ?? owner },
    playedOnTurn: game.turnNumber, movedOnTurn: null, activatedOnTurn: null,
  }
  grantKeywordsTo(stolen, [KEYWORDS.TEMPORARY])
  zone.cards[actor].push(stolen)
  // The hull was public on the board a moment ago, so naming it leaks nothing.
  game.state.log.push(
    `${card.name}: ${entry.name} mutinies and joins player ${actor.toUpperCase()} in zone ${zone.id} for this turn`,
  )
  return true
})
```

`supabase/seed/source/builtInCards/DWG-built-in.js` — insert after the
`Flying Squirrel Attack` object (after line 382):

```js
    {
        name: 'Mutiny',
        isBuiltIn: true,
        cardText: 'Choose an enemy vehicle, gain control of it and give it temporary',
        materialCost: 400000,
        blueprintCost: 0,
        cpCost: 0,
        imageUrl: 'mutiny.png',
        playerId: null,
        vehicleType: null,
        type: 'ability',
        faction: FACTIONS.DWG,
        blueprintId: null,
        meta: {
            [TRIGGERS.PLAY_ON_VEHICLE]: 'mutinyEffect',
        }
    },
```

Run `npm run seed:build`.

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: PASS — including G1/G4 (Mutiny names `mutinyEffect`, which is registered).

- [ ] **Step 7: Sync and commit**

```powershell
npm run functions:sync
git add -A
git commit -m "feat(effects): M-4 DWG Mutiny steals an enemy vehicle for one turn; a mutinied hull is discarded to its owner (homeSide)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Brigand — "When this is destroyed, draw a copy of Mutiny"

**Files:**
- Modify: `shared/effects/dwgEffects.ts` (new `brigandOnDeath`, `catalogCard` import)
- Modify: `supabase/seed/source/builtInCards/DWG-built-in.js` (new Brigand row after Mutiny)
- Test: `shared/effects/dwgEffects.test.ts` (append)

**Interfaces:**
- Consumes: `catalogCard`, `poolEligible`, `putInHand` (existing); the Mutiny row (Task 7).
- Produces: registry id `brigandOnDeath` (`onDeathEffect`, `{ needsCatalog: true }`).

- [ ] **Step 1: Write the failing tests**

Append to `shared/effects/dwgEffects.test.ts`:

```ts
// 2026-09-16 — DWG Brigand (new to the repo): "When this is destroyed, draw a
// copy of Mutiny". SCRAPPY plus a death trigger is allowed (card-effects.md
// rule 10 as corrected; Argonaut's precedent). slasherOnPlay's shape: mint from
// the catalog by name, through poolEligible, into the hand via putInHand.
describe('brigandOnDeath (2026-09-16)', () => {
  const mutinyRow = snap({
    name: 'Mutiny', faction: 'DWG', type: 'ability', vehicleType: null, materialCost: 400_000,
    meta: { playOnVehicleEffect: 'mutinyEffect' },
  })
  const brigand = () => zoneEntry({ name: 'Brigand', faction: 'DWG', vehicleType: 'ship', keywords: ['scrappy'] })

  it('puts one Mutiny into the owner\'s hand and resyncs the count', () => {
    const game = makeGame()
    const ok = effectFor('brigandOnDeath')!({ game, actor: 'a', card: brigand(), ctx: makeCtx({ catalog: [mutinyRow] }) })
    expect(ok).toBe(true)
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['Mutiny'])
    expect(game.privates.a.hand[0].meta.playOnVehicleEffect).toBe('mutinyEffect')
    expect(game.privates.a.hand[0].handEnteredTurn).toBe(game.turnNumber)
    expect(game.state.counts.a.hand).toBe(1)
  })

  it('never names the card in the public log', () => {
    const game = makeGame()
    effectFor('brigandOnDeath')!({ game, actor: 'a', card: brigand(), ctx: makeCtx({ catalog: [mutinyRow] }) })
    expect(game.state.log.join(' ')).not.toContain('Mutiny')
  })

  // A death effect must return false on failure, never throw (architecture.md).
  it('returns false when the catalog has no Mutiny', () => {
    const game = makeGame()
    expect(effectFor('brigandOnDeath')!({ game, actor: 'a', card: brigand(), ctx: makeCtx({ catalog: [] }) })).toBe(false)
  })

  // ⚠ Unit tests cannot catch a missing flag — makeCtx hands them a catalog.
  it('is registered as needing the catalog', () => {
    expect(CATALOG_EFFECTS.has('brigandOnDeath')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run shared/effects/dwgEffects.test.ts -t brigand`
Expected: FAIL — `brigandOnDeath` is null.

- [ ] **Step 3: Implement**

`shared/effects/dwgEffects.ts` — add `catalogCard` to the `'./primitives.ts'`
import and append:

```ts
// "When this is destroyed, draw a copy of Mutiny." (2026-09-16.) slasherOnPlay's
// shape: a named catalog mint through poolEligible into the hand via putInHand.
// Its own registry id (R-6). SCRAPPY sits beside this trigger deliberately —
// rule 10 as corrected narrows the death window to below 80%, it does not
// close it (Argonaut's precedent).
//
// { needsCatalog: true } is load-bearing: game-action's probe scans on-field
// hulls' metas at DECIDE_BATTLE_REPORT, so the flag is what loads the catalog
// for a death trigger. Never named in the log — the card is entering a hidden
// hand, however public its printed text makes the guess.
registerEffect('brigandOnDeath', ({ game, actor, card, ctx }) => {
  const mutiny = catalogCard(ctx, 'Mutiny')
  // A named card the catalog cannot supply is a data bug, not an empty pool.
  if (!mutiny || !poolEligible(mutiny)) return false
  putInHand(game, actor, { ...mutiny, instanceId: ctx.newId() })
  game.state.log.push(`${card.name} goes down — its crew slips a card into player ${actor.toUpperCase()}'s hand`)
  return true
}, { needsCatalog: true })
```

`DWG-built-in.js` — insert after the Mutiny object:

```js
    {
        name: 'Brigand',
        isBuiltIn: true,
        cardText: 'When this is destroyed, draw a copy of Mutiny',
        materialCost: 350000,
        blueprintCost: 356000,
        cpCost: 0,
        imageUrl: 'brigand.png',
        playerId: null,
        vehicleType: VEHICLE_TYPES.SHIP,
        type: 'vehicle',
        faction: FACTIONS.DWG,
        blueprintId: null,
        // SCRAPPY beside a death trigger is deliberate (rule 10 as corrected;
        // Argonaut's precedent): the free repair narrows the window, it does
        // not close it.
        keywords: [KEYWORDS.SCRAPPY],
        meta: {
            [TRIGGERS.ON_DEATH]: 'brigandOnDeath',
        }
    },
```

Run `npm run seed:build`.

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Sync and commit**

```powershell
npm run functions:sync
git add -A
git commit -m "feat(effects): DWG Brigand draws a copy of Mutiny when destroyed (new row)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: M-5 — Sinners Luck's optional swap

**Files:**
- Modify: `shared/effects/dwgEffects.ts` (new `sinnersLuckOnPlay` two-hop choice; imports)
- Modify: `supabase/seed/source/builtInCards/DWG-built-in.js:383-399` (Sinners Luck row)
- Modify: `supabase/seed/balancePass.test.ts:39-42`
- Test: `shared/effects/dwgEffects.test.ts` (append)

**Interfaces:**
- Consumes: `choice`, `friendlyVehicleOptions`, `enemyVehicleOptions` (`primitives.ts`),
  `drawCard`, `findVehicle`, `otherSide`, `VEHICLE_TYPES`.
- Produces: registry id `sinnersLuckOnPlay` (`onPlayEffect` on a vehicle).

- [ ] **Step 1: Write the failing tests**

Append to `shared/effects/dwgEffects.test.ts`:

```ts
// ---------------------------------------------------------------------------
// 2026-09-16 M-5 — DWG Sinners Luck: "when played, you may swap a friendly
// airship with an enemy airship or plane. If airship you provide is worth less
// than what you get, the opponent draws a card and reduces that cards cost by
// the difference."
//
// Two hops through choice() (Braveheart's shape). Q3: side AND zone are
// exchanged; Q4: "worth" is printed materialCost; D-1: both hulls re-stamp as
// freshly deployed; D-3: an empty pool at either hop resolves without a swap.
describe('sinnersLuckOnPlay (2026-09-16 M-5)', () => {
  const sinners = () => inst({
    instanceId: 'sl1', name: 'Sinners Luck', faction: 'DWG', vehicleType: 'ship', materialCost: 250_000,
    meta: { onPlayEffect: 'sinnersLuckOnPlay' },
  })
  // My airships in zones 1 and 2, a ship and a plane of mine that must never
  // be offered; enemy airship in zone 2, enemy plane in zone 3, enemy ship.
  const armed = () => {
    const card = sinners()
    const game = makeGame({
      turnNumber: 3, activePlayer: 'alice',
      privates: { a: { hand: [card], deck: [] }, b: { hand: [], deck: [inst({ name: 'Enemy Top' })] } },
    })
    game.state.resources.a.materials = 300_000
    game.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'myAir1', name: 'My Airship', vehicleType: 'airship', materialCost: 100_000, playedOnTurn: 1 }))
    game.state.zones[1].cards.a.push(
      zoneEntry({ instanceId: 'myAir2', name: 'My Other Airship', vehicleType: 'airship', materialCost: 100_000, playedOnTurn: 1 }),
      zoneEntry({ instanceId: 'myPlane', name: 'My Plane', vehicleType: 'plane', playedOnTurn: 1 }),
    )
    game.state.zones[1].cards.b.push(zoneEntry({ instanceId: 'theirAir', name: 'Their Airship', vehicleType: 'airship', materialCost: 300_000, playedOnTurn: 1 }))
    game.state.zones[2].cards.b.push(
      zoneEntry({ instanceId: 'theirPlane', name: 'Their Plane', vehicleType: 'plane', materialCost: 50_000, playedOnTurn: 1 }),
      zoneEntry({ instanceId: 'theirTank', name: 'Their Tank', vehicleType: 'tank', playedOnTurn: 1 }),
    )
    return { game, card }
  }
  const play = (game: EngineGame, card: CardInstance) => {
    const r = applyAction(game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    return r.game
  }
  const answer = (game: EngineGame, choiceId: string) => {
    const r = applyAction(game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    return r.game
  }

  it('hop 1 offers only the actor\'s AIRSHIPS, from every zone', () => {
    const { game, card } = armed()
    const after = play(game, card)
    expect(after.state.pendingEffect?.effect).toBe('sinnersLuckOnPlay')
    expect(after.state.pendingEffect?.options.map((o) => o.id).sort()).toEqual(['myAir1', 'myAir2'])
  })

  it('hop 2 offers enemy airships AND planes from every zone, never ships or tanks', () => {
    const { game, card } = armed()
    const hop2 = answer(play(game, card), 'myAir1')
    expect(hop2.state.pendingEffect?.effect).toBe('sinnersLuckOnPlay')
    expect(hop2.state.pendingEffect?.options.map((o) => o.id).sort()).toEqual(['theirAir', 'theirPlane'])
  })

  // Q3 + D-1: side AND zone are exchanged, both hulls freshly deployed.
  it('swaps the two hulls across sides and zones, re-stamping both', () => {
    const { game, card } = armed()
    const done = answer(answer(play(game, card), 'myAir1'), 'theirAir')
    expect(done.state.pendingEffect).toBeNull()
    const given = findVehicle(done.state, 'myAir1')!
    const received = findVehicle(done.state, 'theirAir')!
    expect({ side: given.side, zone: given.zone.id }).toEqual({ side: 'b', zone: 2 })
    expect({ side: received.side, zone: received.zone.id }).toEqual({ side: 'a', zone: 1 })
    expect(given.entry).toMatchObject({ playedOnTurn: 3, movedOnTurn: null, activatedOnTurn: null })
    expect(received.entry).toMatchObject({ playedOnTurn: 3, movedOnTurn: null, activatedOnTurn: null })
    expect(done.state.zones[0].cards.a.map((c) => c.name).sort()).toEqual(['Sinners Luck', 'Their Airship'])
  })

  // Q4: 100k given for 300k received — the opponent draws, discounted by 200k.
  it('makes the opponent draw a card discounted by the difference when the given airship is worth less', () => {
    const { game, card } = armed()
    const done = answer(answer(play(game, card), 'myAir1'), 'theirAir')
    expect(done.privates.b.hand.map((c) => c.name)).toEqual(['Enemy Top'])
    expect(done.privates.b.hand[0].meta.costDelta).toBe(-200_000)
    expect(done.state.counts.b).toEqual({ hand: 1, deck: 0 })
    expect(done.state.log.join('\n')).not.toContain('Enemy Top')
  })

  it('draws nothing when the given airship is worth as much or more', () => {
    const { game, card } = armed()
    const done = answer(answer(play(game, card), 'myAir1'), 'theirPlane') // 100k for 50k
    expect(done.privates.b.hand).toHaveLength(0)
    expect(findVehicle(done.state, 'theirPlane')!.side).toBe('a')
  })

  it('survives an opponent with nothing to draw', () => {
    const { game, card } = armed()
    game.privates.b.deck = []
    game.state.counts.b.deck = 0
    const done = answer(answer(play(game, card), 'myAir1'), 'theirAir')
    expect(done.privates.b.hand).toHaveLength(0)
    expect(findVehicle(done.state, 'theirAir')!.side).toBe('a')
  })

  // D-3: "you may" — no friendly airship means no suspension and no failure.
  it('deploys without suspending when the actor has no airship', () => {
    const { game, card } = armed()
    game.state.zones[0].cards.a = []
    game.state.zones[1].cards.a = game.state.zones[1].cards.a.filter((c) => c.instanceId !== 'myAir2')
    const after = play(game, card)
    expect(after.state.pendingEffect).toBeNull()
    expect(after.state.zones[0].cards.a.map((c) => c.name)).toEqual(['Sinners Luck'])
  })

  it('resolves with no swap when the enemy has no airship or plane', () => {
    const { game, card } = armed()
    game.state.zones[1].cards.b = []
    game.state.zones[2].cards.b = game.state.zones[2].cards.b.filter((c) => c.instanceId === 'theirTank')
    const hop2 = answer(play(game, card), 'myAir1')
    expect(hop2.state.pendingEffect).toBeNull()
    expect(findVehicle(hop2.state, 'myAir1')!.side).toBe('a')
  })

  it('can be declined at either hop through cancel, leaving the board untouched', () => {
    const { game, card } = armed()
    const declined = applyAction(play(game, card), 'alice', { type: 'RESOLVE_PENDING_EFFECT', cancel: true }, makeCtx())
    if (!declined.ok) throw new Error(declined.error)
    expect(declined.game.state.pendingEffect).toBeNull()
    expect(findVehicle(declined.game.state, 'myAir1')!.side).toBe('a')
    expect(findVehicle(declined.game.state, 'theirAir')!.side).toBe('b')
  })

  it('refuses cleanly when the chosen enemy hull has left the board', () => {
    const { game, card } = armed()
    const hop2 = answer(play(game, card), 'myAir1')
    hop2.state.zones[1].cards.b = []
    const r = applyAction(hop2, 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'theirAir' }, makeCtx())
    expect(r).toMatchObject({ ok: false, status: 400 })
  })

  it('never offers the hull this play just placed, even if it were an airship', () => {
    const game = makeGame({ turnNumber: 3, activePlayer: 'alice' })
    const card = inst({ instanceId: 'sl-air', name: 'Sinners Luck', faction: 'DWG', vehicleType: 'airship', materialCost: 0, meta: { onPlayEffect: 'sinnersLuckOnPlay' } })
    game.privates.a.hand.push(card)
    game.state.counts.a.hand = 1
    game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'theirAir', vehicleType: 'airship', playedOnTurn: 1 }))
    const after = play(game, card)
    expect(after.state.pendingEffect).toBeNull()
  })

  it('needs no catalog', () => {
    expect(CATALOG_EFFECTS.has('sinnersLuckOnPlay')).toBe(false)
  })
})
```

This block needs `applyAction`, `findVehicle` (engine index), `CATALOG_EFFECTS`
(registry), the `EngineGame` type (`'../engine/engineTypes.ts'`) and the
`CardInstance` type (`'../engine/gameInit.ts'`) — all already in the import
block Task 7 wrote at the top of this file; add any that are missing.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run shared/effects/dwgEffects.test.ts -t "sinnersLuck"`
Expected: FAIL — the play 400s / no effect registered.

- [ ] **Step 3: Implement the two hops**

In `shared/effects/dwgEffects.ts` add `enemyVehicleOptions`,
`friendlyVehicleOptions` to the `'./primitives.ts'` import and `EffectFn` to
the type import from `'./registry.ts'`. Append:

```ts
const SINNERS_LUCK = 'sinnersLuckOnPlay'

// "when played, you may swap a friendly airship with an enemy airship or
// plane. If airship you provide is worth less than what you get, the opponent
// draws a card and reduces that cards cost by the difference." (M-5,
// 2026-09-16.)
//
// TWO HOPS, both routed through choice() — Braveheart's shape, never Orbit
// Flank's hand-written second pendingEffect. Hop 1 picks the friendly airship
// (any zone — the text names none), hop 2 the enemy airship-or-plane (any
// zone). "You may": an empty pool at either hop resolves straight through with
// null (Kraken's shape) and the ship still deploys; the dialog's Decline is
// RESOLVE_PENDING_EFFECT { cancel: true }, which clears the slot untouched.
//
// Q3: side AND zone are exchanged — a swap, not a side flip. Airships and
// planes fly in every biome, so no biome check. The zone cap is bypassed (this
// is not a play and is net-zero per side — Boarding Party's latitude) and
// uniquePerZone is not consulted (recorded edge).
// Q4: "worth" is the PRINTED materialCost, the authority every pool and
// threshold filter reads. The difference lands as a costDelta stamp on the
// card the opponent draws — a PRICE, never a rewrite. The log names neither.
// D-1: both hulls re-stamp as freshly deployed, as Boarding Party's do.
const isAirship = (e: ZoneCardEntry) => e.vehicleType === VEHICLE_TYPES.AIRSHIP
const isFlier = (e: ZoneCardEntry) =>
  e.vehicleType === VEHICLE_TYPES.AIRSHIP || e.vehicleType === VEHICLE_TYPES.PLANE

const sinnersLuckHop2 = (givenId: string): EffectFn => choice({
  effect: SINNERS_LUCK,
  prompt: 'Choose an enemy airship or plane to take in exchange',
  options: ({ game, actor }) => enemyVehicleOptions(game, actor, null, isFlier),
  data: () => ({ givenId }),
  resolve: (payload, receivedId) => {
    const { game, actor, ctx, card } = payload
    if (receivedId === null) {
      game.state.log.push(`${card.name} finds no enemy airship or plane to swap for`)
      return true
    }
    // Both halves re-checked against the CURRENT board: either hull may have
    // left while the dialog sat open.
    const given = findVehicle(game.state, givenId)
    if (!given || given.side !== actor || !isAirship(given.entry)) return false
    const enemy = otherSide(actor)
    const received = findVehicle(game.state, receivedId)
    if (!received || received.side !== enemy || !isFlier(received.entry)) return false
    given.zone.cards[actor] = given.zone.cards[actor].filter((c) => c.instanceId !== givenId)
    received.zone.cards[enemy] = received.zone.cards[enemy].filter((c) => c.instanceId !== receivedId)
    received.zone.cards[enemy].push({
      ...given.entry, playedOnTurn: game.turnNumber, movedOnTurn: null, activatedOnTurn: null,
    })
    given.zone.cards[actor].push({
      ...received.entry, playedOnTurn: game.turnNumber, movedOnTurn: null, activatedOnTurn: null,
    })
    game.state.log.push(
      `${card.name}: ${given.entry.name} is traded to player ${enemy.toUpperCase()} for ${received.entry.name}`,
    )
    const difference = received.entry.materialCost - given.entry.materialCost
    if (difference > 0) {
      // plundererRaid's stamp: the card drawCard just pushed is hand[before].
      // ACCUMULATES onto whatever it already carried, like every costDelta.
      const before = game.privates[enemy].hand.length
      drawCard(game, enemy, ctx)
      const drawn = game.privates[enemy].hand[before]
      if (drawn) {
        const current = typeof drawn.meta.costDelta === 'number' ? drawn.meta.costDelta : 0
        drawn.meta = { ...drawn.meta, costDelta: current - difference }
        game.state.log.push(`Player ${enemy.toUpperCase()} draws a card, discounted by the difference`)
      }
    }
    return true
  },
})

const sinnersLuckHop1: EffectFn = choice({
  effect: SINNERS_LUCK,
  prompt: 'Choose one of your airships to swap away',
  // placedInstanceIds excluded as Alarmed's offer excludes them: PLAY_CARD_TO_ZONE
  // deploys the hull BEFORE effects run. Sinners Luck is a ship, so today this
  // never bites — it is what keeps the card honest if that ever changes.
  options: ({ game, actor, placedInstanceIds }) => {
    const placed = new Set(placedInstanceIds ?? [])
    return friendlyVehicleOptions(game, actor, null, (e) => isAirship(e) && !placed.has(e.instanceId))
  },
  resolve: (payload, givenId) => {
    if (givenId === null) {
      payload.game.state.log.push(`${payload.card.name} has no airship to offer`)
      return true
    }
    // Hop 2's first entry: `resolution` cleared so choice() takes the slot
    // again, `pending` cleared so it cannot be mistaken for hop 2's own.
    return sinnersLuckHop2(givenId)({ ...payload, resolution: undefined, pending: undefined })
  },
})

// The router. Hop 2 is told apart by the givenId hop 1 stashed — never by
// anything the client sent.
registerEffect(SINNERS_LUCK, (payload) => {
  const stashed = payload.pending?.data?.givenId
  if (typeof stashed === 'string') return sinnersLuckHop2(stashed)(payload)
  return sinnersLuckHop1(payload)
})
```

- [ ] **Step 4: Seed row and pin**

`DWG-built-in.js` Sinners Luck (lines 383–399): set
`cardText: 'when played, you may swap a friendly airship with an enemy airship or plane. If airship you provide is worth less than what you get, the opponent draws a card and reduces that cards cost by the difference.',`
`keywords: [],` and `meta: { [TRIGGERS.ON_PLAY]: 'sinnersLuckOnPlay' }`.

`supabase/seed/balancePass.test.ts` lines 39–42:

```ts
  // Reworked by the 2026-09-16 pass (M-5): text, −SCRAPPY, onPlayEffect. Updated
  // in place per the 2026-09-02 spec §2.3; the pass pins it in balance/2026-09-16.balance.test.ts.
  'DWG:Sinners Luck': {
    materialCost: 250_000, blueprintCost: 267_000, keywords: [],
    vehicleType: 'ship', cardText: SINNERS_LUCK_TEXT,
  },
```

with, near `AIRCRAFT_LOCK` at the top of that file:

```ts
const SINNERS_LUCK_TEXT =
  'when played, you may swap a friendly airship with an enemy airship or plane. If airship you ' +
  'provide is worth less than what you get, the opponent draws a card and reduces that cards cost by the difference.'
```

Run `npm run seed:build`.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 6: Sync and commit**

```powershell
npm run functions:sync
git add -A
git commit -m "feat(effects): M-5 Sinners Luck may swap a friendly airship for an enemy flier, paying the difference in a discounted enemy draw

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Residual data — M-6, M-8, M-10 orphans, Q8 numbers, Slasher, Basher; one pinning file for the whole pass

**Files:**
- Create: `supabase/seed/balance/2026-09-16.balance.test.ts`
- Modify: `shared/gameSettings.ts:197, 229` (`FLYING_SQUIRREL_ATTACK_COUNT` 6, `SLASHER_EARTH_RAKER_COUNT` 1)
- Modify: `shared/engine/placement.ts:40-61` (comment: `aircraftLock` has no carrier)
- Modify: `supabase/seed/source/builtInCards/DWG-built-in.js` (Pilferer, Tarpon, Loggerhead, Buccaneer, Spawn Buccaneer, Albacore, Flying Squirrel Attack)
- Modify: `supabase/seed/source/builtInCards/SS-built-in.js` (Blockade, Spectre)
- Modify: `supabase/seed/source/builtInCards/TG-built-in.js` (Audacious, Spawn Audacious)
- Modify: `supabase/seed/source/builtInCards/OW-Built-in.js` (Bulwark, Eyrie)
- Modify: `supabase/seed/source/builtInCards/WF-built-in.js` (Scourge, Disemboweler, Slasher, Basher, Purifier)
- Modify: `supabase/seed/effectCoverage.test.ts:239-297` (`DELIBERATE_ORPHANS` +3)
- Modify: pins — `supabase/seed/balancePass.test.ts`, `supabase/seed/balance/{dwg,ss,tg,ow,wf}.balance.test.ts`, `supabase/seed/tgFaction.test.ts`
- Test: `shared/effects/factionEffects.test.ts:733-752` (FSA), `6491-6548` (Slasher), `6968-6990` (Spectre stays); `shared/effects/dwgEffects.test.ts:263-275` (comment)

**Interfaces:**
- Consumes: everything above. Produces: no new code symbols.

- [ ] **Step 1: Write the pass's pinning test (fails until the data lands)**

Create `supabase/seed/balance/2026-09-16.balance.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { loadSeedData } from '../transform'
import type { SeedCard } from '../../../shared/types'
import { CATALOG_EFFECTS, DATA_EFFECT_KEYS, isImplemented } from '../../../shared/effects/registry'
import { FLYING_SQUIRREL_ATTACK_COUNT, SLASHER_EARTH_RAKER_COUNT, TYR_MIN_COST } from '../../../shared/gameSettings'
import '../../../shared/engine/index'

// The 2026-09-16 balance pass, pinned against the seed source — every row it
// touched, new or updated, in one file (one branch, so no per-faction split
// is needed; the 2026-09-02 files were updated in place where this pass moved
// one of their numbers, per that spec's §2.3).
//
// Costs, keywords and card text are plain data that nothing else in the suite
// reads: effectCoverage asks only whether a card's EFFECTS are wired, and
// seedDataSync only whether the generated SQL matches its source. Both stay
// green if a number is fat-fingered. This file would not. Numbers are spelled
// out, never derived.

async function bySeedKey(): Promise<Map<string, SeedCard>> {
  const { cards } = await loadSeedData()
  return new Map(cards.map((c) => [`${c.faction}:${c.name}`, c]))
}
const metaOf = (card: SeedCard) => (card.meta ?? {}) as Record<string, unknown>

interface Expected {
  materialCost: number
  blueprintCost: number
  keywords: string[]
  vehicleType: string | null
  cardText: string
}

const AI_SHIP = {
  victoria: 'When played, pick one AI ship in hand and reduce its cost by 75k',
  trondheim: 'When this vehicle is destroyed, draw an AI ship and reduce its cost by 75k',
  excalibur: 'Pick one AI ship in hand and reduce its cost by 200k',
  nothung: 'When played, reduce the cost of all AI ships in your hand by 40k',
  resolute: 'When this vehicle is played, draw an AI ship from your deck. reduce its cost by 40k',
  argonaut: 'When this is destroyed, reduce the cost of a random AI ship in your hand by 50k',
  sacrilego: 'Whenever this vehicle survives a fleet battle, reduce the cost of AI ships in hand by 30k.',
}

const CARDS: Record<string, Expected> = {
  // ---------------------------------------------------------------- DWG
  'DWG:Mutiny': {
    materialCost: 400_000, blueprintCost: 0, keywords: [], vehicleType: null,
    cardText: 'Choose an enemy vehicle, gain control of it and give it temporary',
  },
  'DWG:Brigand': {
    materialCost: 350_000, blueprintCost: 356_000, keywords: ['scrappy'], vehicleType: 'ship',
    cardText: 'When this is destroyed, draw a copy of Mutiny',
  },
  'DWG:Buccaneer': {
    materialCost: 220_000, blueprintCost: 296_000, keywords: ['scrappy'], vehicleType: 'airship', cardText: '',
  },
  'DWG:Spawn Buccaneer': {
    materialCost: 225_000, blueprintCost: 0, keywords: [], vehicleType: null,
    cardText: 'Spawn a Buccaneer into a zone. It gains the Scrappy keyword.',
  },
  'DWG:Sinners Luck': {
    materialCost: 250_000, blueprintCost: 267_000, keywords: [], vehicleType: 'ship',
    cardText: 'when played, you may swap a friendly airship with an enemy airship or plane. If airship you provide is worth less than what you get, the opponent draws a card and reduces that cards cost by the difference.',
  },
  'DWG:Tarpon': {
    materialCost: 510_000, blueprintCost: 511_605, keywords: ['airScreen'], vehicleType: 'airship', cardText: '',
  },
  'DWG:Albacore': {
    materialCost: 260_000, blueprintCost: 261_000, keywords: ['fragile'], vehicleType: 'airship',
    cardText: 'While this vehicle is alive, you may not play another Albacore into this zone',
  },
  'DWG:Loggerhead': {
    materialCost: 70_000, blueprintCost: 74_000, keywords: ['halfCost'], vehicleType: 'airship',
    cardText: 'When this vehicle is destroyed, shuffle another copt of it into your deck. It costs 0.',
  },
  'DWG:Pilferer': {
    materialCost: 100_000, blueprintCost: 132_000, keywords: ['scrappy'], vehicleType: 'ship',
    cardText: 'When played, spawn another copy of this vehicle into the zone',
  },
  'DWG:Flying Squirrel Attack': {
    materialCost: 100_000, blueprintCost: 0, keywords: [], vehicleType: null,
    cardText: 'Choose an enemy vehicle, that vehicle fights alone against two flying squirrel (3x squadron)',
  },
  // ----------------------------------------------------------------- SS
  'SS:Victoria': { materialCost: 250_000, blueprintCost: 270_185, keywords: [], vehicleType: 'ship', cardText: AI_SHIP.victoria },
  'SS:Trondheim': { materialCost: 375_000, blueprintCost: 393_000, keywords: ['blocker'], vehicleType: 'ship', cardText: AI_SHIP.trondheim },
  'SS:Excalibur': { materialCost: 550_000, blueprintCost: 553_900, keywords: ['blocker'], vehicleType: 'ship', cardText: AI_SHIP.excalibur },
  'SS:Nothung': { materialCost: 400_000, blueprintCost: 478_000, keywords: ['blocker'], vehicleType: 'ship', cardText: AI_SHIP.nothung },
  'SS:Resolute': { materialCost: 60_000, blueprintCost: 63_300, keywords: [], vehicleType: 'ship', cardText: AI_SHIP.resolute },
  'SS:Argonaut': { materialCost: 90_000, blueprintCost: 94_000, keywords: ['scrappy'], vehicleType: 'ship', cardText: AI_SHIP.argonaut },
  'SS:Sacrilego': {
    materialCost: 10_000, blueprintCost: 86_000, keywords: ['scrappy', 'stealthy'], vehicleType: 'ship', cardText: AI_SHIP.sacrilego,
  },
  'SS:Tyr': {
    materialCost: 950_000, blueprintCost: 983_000, keywords: ['blocker', 'fragile'], vehicleType: 'ship',
    cardText: 'This card costs 60k less for every turn it spends in your hand. Min 500k',
  },
  'SS:Spectre': { materialCost: 200_000, blueprintCost: 214_000, keywords: ['stealthy'], vehicleType: 'ship', cardText: '' },
  'SS:Blockade': {
    materialCost: 120_000, blueprintCost: 0, keywords: [], vehicleType: null,
    cardText: 'Choose a zone, whenever the opponent plays a vehicle into that zone while you have at least one vehicle there, a fleet battle immediately begins in that zone. If you lose with no surviving vehicles, the blockade goes away, otherwise it remains.',
  },
  // ----------------------------------------------------------------- TG
  'TG:Fear': {
    materialCost: 500_000, blueprintCost: 800_000, keywords: ['blocker', 'robotic', 'upkeepRequired'],
    vehicleType: 'ship', cardText: 'When this vehicle is played, draw a card',
  },
  'TG:Mirth Swarm': {
    materialCost: 200_000, blueprintCost: 200_000, keywords: ['halfCost', 'robotic', 'temporary'], vehicleType: 'plane',
    cardText: 'No more than one mirth swarm can participate in any one battle on a single side, even if spawned in by card effect',
  },
  'TG:Mirth Factory': {
    materialCost: 60_000, blueprintCost: 0, keywords: [], vehicleType: null,
    cardText: 'Target friendly AI ship. Whenever that vehicle is engaged in a fleet combat, spawn a Mirth swarm to fight along side it',
  },
  'TG:Obelisk': {
    materialCost: 60_000, blueprintCost: 32_000, keywords: [], vehicleType: 'ship',
    cardText: 'Whenever this vehicle participates in a fleet battle, spawn a temporary Mirth swarm to fight on your side in the battlefield. You may only control one Obelisk per zone.',
  },
  'TG:Audacious': {
    materialCost: 660_000, blueprintCost: 665_000, keywords: ['fragile', 'halfCost', 'temporary'], vehicleType: 'plane', cardText: '',
  },
  'TG:Spawn Audacious': {
    materialCost: 400_000, blueprintCost: 0, keywords: [], vehicleType: null,
    cardText: 'Spawn an audacious into target zone. It is not temporary.',
  },
  'TG:Horror': {
    materialCost: 50_000, blueprintCost: 77_000, keywords: ['robotic'], vehicleType: 'ship',
    cardText: 'Whenever a horror participates in an offensive fleet battle, create anther copy of it in this zone. Max one spawn per zone',
  },
  // ----------------------------------------------------------------- OW
  'OW:Bulwark': { materialCost: 600_000, blueprintCost: 848_000, keywords: ['blocker'], vehicleType: 'ship', cardText: '' },
  'OW:Eyrie': { materialCost: 650_000, blueprintCost: 809_000, keywords: ['blocker', 'fragile'], vehicleType: 'airship', cardText: '' },
  // ----------------------------------------------------------------- WF
  'WF:Scourge': { materialCost: 225_000, blueprintCost: 209_000, keywords: ['blocker', 'scrappy'], vehicleType: 'ship', cardText: '' },
  'WF:Disemboweler': { materialCost: 300_000, blueprintCost: 305_000, keywords: ['stealthy'], vehicleType: 'sub', cardText: '' },
  'WF:Slasher': {
    materialCost: 300_000, blueprintCost: 353_000, keywords: [], vehicleType: 'ship',
    cardText: 'When this is played, add an earth raker to your hand. it costs 0.',
  },
  'WF:Basher': {
    materialCost: 210_000, blueprintCost: 214_000, keywords: [], vehicleType: 'ship',
    cardText: 'When this vehicle is destroyed, draw a card',
  },
  'WF:Purifier': {
    materialCost: 760_000, blueprintCost: 765_000, keywords: ['halfCost', 'fragile'], vehicleType: 'ship',
    cardText: 'This vehicle does no damage to the enemy base. Whenever it participates in a fleet battle, the enemy forces must spawn in first, even if they are defending.',
  },
}

describe('2026-09-16 balance pass — every touched row', () => {
  it('touches exactly 34 rows: 2 new, 31 updated, 1 retired', () => {
    expect(Object.keys(CARDS)).toHaveLength(34)
  })

  it.each(Object.entries(CARDS))('%s carries its balanced numbers', async (k, want) => {
    const card = (await bySeedKey()).get(k)
    expect(card, `${k} is missing from the seed source`).toBeDefined()
    expect({
      materialCost: card!.materialCost,
      blueprintCost: card!.blueprintCost,
      keywords: [...(card!.keywords ?? [])].sort(),
      vehicleType: card!.vehicleType ?? null,
      cardText: card!.cardText ?? '',
    }).toEqual({
      materialCost: want.materialCost,
      blueprintCost: want.blueprintCost,
      keywords: [...want.keywords].sort(),
      vehicleType: want.vehicleType,
      cardText: want.cardText,
    })
  })

  // The two new rows, by name: transform.ts derives each id from
  // `card:<faction>:<name>`, so a retitle mints a different card.
  it('seeds Mutiny and Brigand under their delivered names, wired to their effects', async () => {
    const byKey = await bySeedKey()
    expect(metaOf(byKey.get('DWG:Mutiny')!)).toEqual({ playOnVehicleEffect: 'mutinyEffect' })
    expect(metaOf(byKey.get('DWG:Brigand')!)).toEqual({ onDeathEffect: 'brigandOnDeath' })
    expect(byKey.get('DWG:Mutiny')!.type).toBe('ability')
    expect(isImplemented('mutinyEffect')).toBe(true)
    expect(isImplemented('brigandOnDeath')).toBe(true)
  })

  it('Sinners Luck names its rework and nothing else', async () => {
    expect(metaOf((await bySeedKey()).get('DWG:Sinners Luck')!)).toEqual({ onPlayEffect: 'sinnersLuckOnPlay' })
  })

  // M-6. A data key whose VALUE the engine compares (strict === true) needs a
  // seed-backed assertion — no guard checks a value. Tarpon drops the rule
  // outright, so its meta is EMPTY, asserted in both directions.
  it('M-6: Albacore is uniquePerZone and no seeded card carries aircraftLock any more', async () => {
    const { cards } = await loadSeedData()
    const byKey = new Map(cards.map((c) => [`${c.faction}:${c.name}`, c]))
    expect(metaOf(byKey.get('DWG:Albacore')!)).toEqual({ uniquePerZone: true })
    expect(metaOf(byKey.get('DWG:Tarpon')!)).toEqual({})
    expect(cards.filter((c) => metaOf(c).aircraftLock !== undefined)).toEqual([])
    expect(cards.filter((c) => metaOf(c).uniquePerZone === true).map((c) => `${c.faction}:${c.name}`).sort())
      .toEqual(['DWG:Albacore', 'TG:Obelisk'])
  })

  // M-3. The whole of Mirth Swarm's text is this key.
  it('M-3: Mirth Swarm carries battleCap 1 as a number, and the key is recognised', async () => {
    const meta = metaOf((await bySeedKey()).get('TG:Mirth Swarm')!)
    expect(meta).toEqual({ summonOnly: true, battleCap: 1 })
    expect([...DATA_EFFECT_KEYS]).toContain('battleCap')
  })

  // M-9 lives in retirement.test.ts; the trigger staying named is asserted here too.
  it('M-9: Horror is retired and still names horrorBattle', async () => {
    expect(metaOf((await bySeedKey()).get('TG:Horror')!)).toEqual({ onBattleEffect: 'horrorBattle', retired: true })
  })

  // M-10. Three cards lose their effect; the implementations stay registered
  // (effectCoverage.test.ts DELIBERATE_ORPHANS) and the rows carry no name.
  it.each(['SS:Spectre', 'WF:Scourge', 'WF:Disemboweler'])('%s carries no effect name (M-10)', async (k) => {
    expect(metaOf((await bySeedKey()).get(k)!)).toEqual({})
  })

  it('Basher already draws on death — wording change only (§5)', async () => {
    expect(metaOf((await bySeedKey()).get('WF:Basher')!)).toEqual({ onDeathEffect: 'basherOnDeath' })
  })

  it('Obelisk keeps its battle trigger and uniquePerZone beside its new price (Q6)', async () => {
    expect(metaOf((await bySeedKey()).get('TG:Obelisk')!)).toEqual({ onBattleEffect: 'obeliskBattle', uniquePerZone: true })
  })

  it('Tyr and Purifier keep the meta their text promises', async () => {
    const byKey = await bySeedKey()
    expect(metaOf(byKey.get('SS:Tyr')!)).toEqual({ costModifier: 'tyrCostModifier' })
    expect(metaOf(byKey.get('WF:Purifier')!)).toMatchObject({ noBaseDamage: true, deployOrder: 'last' })
  })

  // The constants the rewritten texts print.
  it('M-8 / Slasher: the constants match the printed counts', () => {
    expect(FLYING_SQUIRREL_ATTACK_COUNT).toBe(6) // two 3x squadrons
    expect(SLASHER_EARTH_RAKER_COUNT).toBe(1)
    expect(TYR_MIN_COST).toBe(500_000)
  })

  // ⚠ A missing or stale { needsCatalog } flag is invisible to unit tests.
  it('catalog flags: Brigand mints, Fear/Mutiny/Sinners Luck do not', () => {
    expect(CATALOG_EFFECTS.has('brigandOnDeath')).toBe(true)
    expect(CATALOG_EFFECTS.has('fearOnPlay')).toBe(false)
    expect(CATALOG_EFFECTS.has('mutinyEffect')).toBe(false)
    expect(CATALOG_EFFECTS.has('sinnersLuckOnPlay')).toBe(false)
  })

  it('every card in CARDS is seeded', async () => {
    const seeded = await bySeedKey()
    for (const k of Object.keys(CARDS)) expect(seeded.has(k), `${k} is missing`).toBe(true)
  })
})
```

- [ ] **Step 2: Write the failing effect tests for M-8 and Slasher**

`factionEffects.test.ts` line 733: rename to
`'the target fights alone against 6 summoned Flying Squirrels — two 3x squadrons (2026-09-16 M-8)'`
and change the two `toHaveLength(3)` to `toHaveLength(FLYING_SQUIRREL_ATTACK_COUNT)`
(import it from `'../gameSettings.ts'`) and add `expect(FLYING_SQUIRREL_ATTACK_COUNT).toBe(6)`.

`describe('2026-09-02 — WF Slasher')` (line 6491): rename the describe to
`'WF Slasher — one free Earth Raker (2026-09-16; two before)'`; the first
test becomes:

```ts
  it('puts exactly one Earth Raker into hand and resyncs the count', () => {
    const game = makeGame()
    expect(fire(game)).toBe(true)
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['Earth Raker'])
    expect(game.state.counts.a.hand).toBe(1)
  })
```

delete `'gives the two copies distinct instanceIds'`, and in
`'prices them at zero without making them worthless'` change
`toHaveLength(2)` to `toHaveLength(SLASHER_EARTH_RAKER_COUNT)` (import it).

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run supabase/seed/balance/2026-09-16.balance.test.ts shared/effects/factionEffects.test.ts -t "2026-09-16|Flying Squirrel|Slasher"`
Expected: FAIL on every row not yet moved, FSA count 3, Slasher count 2.

- [ ] **Step 4: Move the constants**

`shared/gameSettings.ts` line 197:
`export const FLYING_SQUIRREL_ATTACK_COUNT = 6 // Flying Squirrel Attack: "two flying squirrel (3x squadron)" — two squadrons of three (2026-09-16 M-8)`
line 229: `export const SLASHER_EARTH_RAKER_COUNT = 1` and its comment's
`"add two earth rakers to your hand"` → `"add an earth raker to your hand"
(2026-09-16; it was two)`. In `wfEffects.ts` line 149 update Slasher's quoted
text to `"When this is played, add an earth raker to your hand. it costs 0."`,
the plural in its comment (`balmungOnPlay's shape, once`), and its log line to
`` `${card.name} slips ${SLASHER_EARTH_RAKER_COUNT} card(s) into player …` ``
(the count is a constant, not a hidden-hand count, so it may stay). In
`dwgEffects.ts` line 573 update the quote to `"…against two flying squirrel
(3x squadron)"` and `FLYING_SQUIRREL_ATTACK_COUNT freshly minted` stays.

- [ ] **Step 5: Move the rows**

`DWG-built-in.js`:
- Pilferer line 97: `materialCost: 100000,`
- Tarpon: line 132 `cardText: '',`; line 142 `keywords: [KEYWORDS.AIR_SCREEN],`;
  lines 143–147 → `meta: {\n        }` (drop `aircraftLock` and its comment).
- Loggerhead line 195: `keywords: [KEYWORDS.HALF_COST],` with the comment
  `// +HALF_COST (2026-09-16), undoing 09-02's removal. SCRAPPY is still not restored.`
- Buccaneer: line 219 `materialCost: 220000,`; line 228 `keywords: [KEYWORDS.SCRAPPY],`
- Spawn Buccaneer line 234: `cardText: 'Spawn a Buccaneer into a zone. It gains the Scrappy keyword.',`
- Albacore: line 331 `cardText: 'While this vehicle is alive, you may not play another Albacore into this zone',`;
  lines 342–348:
  ```js
        meta: {
            // "You may not play ANOTHER Albacore into this zone" (2026-09-16
            // M-6): the wave-8 Obelisk mechanic — one per zone PER SIDE, keyed
            // on cardId. It replaced the wider aircraftLock, which no seeded
            // card carries now; the engine rule is kept (spec R-8).
            uniquePerZone: true,
        }
  ```
- Flying Squirrel Attack line 369: `cardText: 'Choose an enemy vehicle, that vehicle fights alone against two flying squirrel (3x squadron)',`

`SS-built-in.js`: Blockade line 375 `materialCost: 120000,`; Spectre line 408
`cardText: '',` and lines 419–421 become:

```js
        meta: {
            // Orphaned 2026-09-16 (M-10): the CP drain is gone. spectreOnPlay
            // stays registered for in-flight snapshots (DELIBERATE_ORPHANS in
            // supabase/seed/effectCoverage.test.ts) and must never be reused.
        }
```

`TG-built-in.js`: Audacious line 323 `keywords: [KEYWORDS.HALF_COST, KEYWORDS.TEMPORARY, KEYWORDS.FRAGILE],`;
Spawn Audacious line 531 `materialCost: 400000,` with the comment
`// 40k -> 400k (2026-09-16, ruling Q7): closes the 40k spawn -> Repurpose
// for 330k loop recorded in tgEffects.ts.`

`OW-Built-in.js`: Bulwark line 142 `materialCost: 600000,`; Eyrie line 280 `materialCost: 650000,`.

`WF-built-in.js`:
- Purifier line 75 `materialCost: 760000,`
- Scourge: line 103 `cardText: '',`; line 113 `keywords: [KEYWORDS.SCRAPPY, KEYWORDS.BLOCKER],`;
  lines 114–116 become:
  ```js
        meta: {
            // Orphaned 2026-09-16 (M-10): the CP grant is gone. scourgeOnPlay
            // stays registered for in-flight snapshots (DELIBERATE_ORPHANS in
            // supabase/seed/effectCoverage.test.ts) and must never be reused.
        }
  ```
- Disemboweler: line 155 `cardText: '',`; line 165 `keywords: [KEYWORDS.STEALTHY],`;
  lines 166–168 become the same three-line comment inside an empty `meta: { }`,
  naming `disembowelerOnPlay` instead of `scourgeOnPlay`.
- Slasher line 191: `cardText: 'When this is played, add an earth raker to your hand. it costs 0.',`
- Basher line 332: `cardText: 'When this vehicle is destroyed, draw a card',`

Run `npm run seed:build`.

- [ ] **Step 6: Orphans and the moved pins**

`supabase/seed/effectCoverage.test.ts` — `DELIBERATE_ORPHANS` gains:

```ts
  spectreOnPlay: 'balance 2026-09-16 cleared SS Spectre\'s text and removed its onPlayEffect key (M-10)',
  scourgeOnPlay: 'balance 2026-09-16 cleared WF Scourge\'s text and removed its onPlayEffect key (M-10)',
  disembowelerOnPlay: 'balance 2026-09-16 cleared WF Disemboweler\'s text and removed its onPlayEffect key (M-10)',
```

and the exact-list test (line 289) becomes
`'the deliberate list matches exactly what the 2026-08-30, 2026-09-02 and 2026-09-16 balance passes orphaned'`
with the sorted array `['bulwarkOnPlay', 'disembowelerOnPlay', 'purifierEffect', 'rheaOnPlay', 'scourgeOnPlay', 'spectreOnPlay', 'victoriaActivate', 'victoriaOnDeath']`.

In `shared/effects/ssEffects.ts` (Spectre, line ~845) and `wfEffects.ts`
(Scourge/Disemboweler, line ~457) prefix each header comment with
`// Orphaned by the 2026-09-16 pass (M-10): the card lost its text and its key.
// Kept registered for the frozen snapshots that still name it; the name must
// never be reused (spec §9.2).`

Pins, updated in place with a `// moved 2026-09-16` note on each:
- `balancePass.test.ts`: Albacore `cardText: ALBACORE_TEXT` (new const
  `'While this vehicle is alive, you may not play another Albacore into this zone'`);
  Tarpon `keywords: ['airScreen'], cardText: ''`; Buccaneer `220_000`,
  `['scrappy']`; Blockade `120_000`; Purifier `760_000`. Replace the
  `it.each(['DWG:Albacore', 'DWG:Tarpon'])('%s locks its zone…')` test with:
  ```ts
  // 2026-09-16 M-6: Albacore's lock narrowed to "another Albacore" (uniquePerZone)
  // and Tarpon dropped its lock outright. The engine rule aircraftLock reads is
  // kept for frozen snapshots (R-8); no seeded card carries the key any more.
  it('Albacore is uniquePerZone; neither airship carries aircraftLock', async () => {
    const cards = await bySeedKey()
    expect(cards.get('DWG:Albacore')!.meta).toEqual({ uniquePerZone: true })
    expect(cards.get('DWG:Tarpon')!.meta).toEqual({})
  })
  ```
  Delete the now-unused `AIRCRAFT_LOCK` const.
- `balance/dwg.balance.test.ts`: Tarpon `keywords: ['airScreen'], cardText: ''`;
  Loggerhead `keywords: ['halfCost']` (update its comment: HALF_COST restored
  2026-09-16, SCRAPPY still not); Buccaneer `220_000`, `['scrappy']`; Spawn
  Buccaneer text `'Spawn a Buccaneer into a zone. It gains the Scrappy keyword.'`
  (update `SPAWN_BUCCANEER_TEXT`); in the meta test
  `expect(cards.get('DWG:Tarpon')!.meta).toEqual({})`. Delete the unused
  `AIRCRAFT_LOCK` const.
- `balance/ss.balance.test.ts`: Spectre `cardText: ''`; remove `'spectreOnPlay'`
  from the does-NOT-need-catalog `it.each` list (it is still registered, but
  keep the list to seeded effects).
- `balance/tg.balance.test.ts`: `'Spawn Audacious'` → `materialCost: 400_000`
  (comment: Q7); uniquePerZone carriers test → `toEqual(['DWG:Albacore', 'TG:Obelisk'])`
  and rename it `'is carried by exactly Obelisk and, since 2026-09-16, Albacore'`.
- `tgFaction.test.ts`: Audacious `keywords: ['fragile', 'halfCost', 'temporary']`;
  `'Spawn Audacious': { materialCost: 400_000, … }`.
- `balance/ow.balance.test.ts`: Bulwark `600_000`; Eyrie `650_000`.
- `balance/wf.balance.test.ts`: Purifier `760_000`; Slasher text; Scourge
  `keywords: ['blocker', 'scrappy'], cardText: ''`; Disemboweler
  `keywords: ['stealthy'], cardText: ''`.
- `shared/effects/dwgEffects.test.ts` lines 263–275: reword the header —
  Buccaneer prints SCRAPPY since 2026-09-16; the FRAGILE fixture below is kept
  to pin the engine's FRAGILE-before-SCRAPPY ordering, not the seeded row.

- [ ] **Step 7: Comment the carrier-less engine rule**

`shared/engine/placement.ts` — replace the `aircraftLocked` header (lines 40–53)
with:

```ts
// `aircraftLock`: "While this vehicle is alive, YOU may not play any other
// aircraft into this zone" (wave 6). ⚠ NO SEEDED CARD CARRIES IT since the
// 2026-09-16 pass (M-6): Albacore narrowed to uniquePerZone and Tarpon dropped
// the rule. Kept, like defensiveOmission and deployRequiresBattleLoss, for the
// frozen snapshots in games dealt before that deploy (2026-09-02 spec R-8) —
// do not delete the key or this predicate.
//
// The pronoun is the whole ruling: this reads the ACTOR'S OWN side of the
// zone, where screenBlocks above reads the enemy's. Read off `data`, like
// blocksFaction, so a card wanting the rule again needs no engine edit.
```

- [ ] **Step 8: Run the full suite**

Run: `npx vitest run`
Expected: PASS — the 2026-09-16 file green, seedDataSync green, G1–G4 green
(`KNOWN_GAPS` still `toHaveLength(0)`).

- [ ] **Step 9: Sync and commit**

```powershell
npm run functions:sync
git add -A
git commit -m "feat(balance): 2026-09-16 pass data — M-6 Albacore/Tarpon, M-8 two squadrons, M-10 orphans, Q8 costs, and one pinning file for the whole pass

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Docs, gates, secrets audit, PR

**Files:**
- Modify: `docs/claude/card-effects.md:63-74` (data keys), `docs/claude/architecture.md:211-216, 328-360` (discard filing, strip list)
- Modify: `docs/superpowers/specs/2026-09-16-balance-pass-changes.md` (§6 close-out note)
- Modify: `docs/claude/testing.md:9` (test count)

- [ ] **Step 1: Update the task docs**

`docs/claude/card-effects.md` — in the "plain data, not effect names" list
(line 63) add:

```markdown
`battleCap` (2026-09-16: at most n hulls of this `cardId` may fight on one side
of one battle — TG Mirth Swarm at 1. Read by `joinBattle` through
`battleCapReached`, which the two spawners pre-check so a second summon is
skipped and logged rather than failed), and `homeSide` (2026-09-16, ENGINE-
written like `grantedKeywords`: DWG Mutiny stamps the side a stolen hull came
from; `discardCard` files the hull there when it leaves play and
`discardSnapshotOf` strips it). `aircraftLock` has had no seeded carrier since
2026-09-16 (M-6) and stays for frozen snapshots.
```

and change `so all eight sit outside` to `so all ten sit outside`. In the
"Captured cards" section add one line: `A MUTINIED hull (2026-09-16) is
neither a loan nor a copy: it is the enemy's own entry moved to your side for
one turn, stamped homeSide so it goes back to their discard.`

`docs/claude/architecture.md` — line 213–216 (`destroyed` bullet): replace
`which files it under its **owner** rather than whoever was holding it — a
card captured out of the enemy deck goes home` with `which files it under
the controller unless the entry carries a `homeSide` stamp (DWG Mutiny,
2026-09-16), in which case it goes home to that side's pile; a captured COPY
is destroyed rather than filed`. In the strip-list paragraph (line 355–359)
add `homeSide` to the list of meta stamps `discardSnapshotOf` sheds.

`docs/claude/testing.md` line 9: update the parenthetical count to the
post-pass numbers from Step 3.

`docs/superpowers/specs/2026-09-16-balance-pass-changes.md` — append to §6:

```markdown
- Close-out (2026-09-16): implemented by `docs/superpowers/plans/2026-09-16-balance-pass.md`.
  Not built by design: gating `ATTACK_ENEMY_FLEET`'s declared roster on
  `battleCap` (ruling D-2); a `uniquePerZone` check on Sinners Luck's swap
  (Q3). `scripts/smoke-wave6.mjs` still asserts `aircraftLock` on Albacore
  and Tarpon and is stale as of this pass.
```

- [ ] **Step 2: Run every gate**

```powershell
npx vitest run
npx tsc -p tsconfig.json --noEmit
npm --prefix frontend run build
npm --prefix frontend run lint
npm run functions:check
```

Expected: all green. Record the vitest totals (files, tests) — the "after"
count against the 1747/51 baseline.

- [ ] **Step 3: Secrets audit**

```powershell
git diff main...HEAD | Select-String -Pattern 'service_role|sb_secret|SUPABASE_SERVICE|BEGIN [A-Z ]*PRIVATE KEY|eyJhbGciOi'
```

Expected: no output.

- [ ] **Step 4: Live deck count for Horror (read-only)**

Compute the id and count decks holding it (spec M-9 asks for the number
before merge). Use the Supabase MCP `execute_sql` (read-only):

```powershell
npx tsx -e "import('./supabase/seed/transform.ts').then(m => console.log(m.cardId('TG','Horror')))"
```

then `select count(*) from public.decks where cards ? '<id>'`. Record the
count in the PR description.

- [ ] **Step 5: Commit docs, then open the PR (ask first)**

```powershell
git add -A
git commit -m "docs: 2026-09-16 balance pass — data keys, discard filing, close-out

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Ask the user before pushing. On a yes: `git push -u origin claude/balance-pass-changelog-4b585d`
and open a PR against `main` whose body lists: the before→after test count,
each M-item with its commit, the rulings, the Horror deck count, and the
post-merge steps of Task 12. End the body with
`🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

### Task 12: Post-merge operations (each step needs the user's go-ahead)

Nothing here runs without an explicit yes; the order is the CLAUDE.md order.

- [ ] **Step 1: Merge** — the user's call (docs/claude/workflow.md).

- [ ] **Step 2: Apply the seed data by hand.** Merging deploys CODE, never card data.

```powershell
npm run seed:verify
```

Expected: reports drift for 34 rows. Apply `supabase/seed/seed_data.sql`'s
upserts against project `wpgsjnjnvykxavaxibld` (idempotent `on conflict (id)
do update`), then re-run `npm run seed:verify` until it exits 0.

- [ ] **Step 3: Confirm `game-action` deployed**, or deploy it out of band from an
up-to-date `main` checkout:

```powershell
npm run functions:deploy -- game-action --dry-run
npm run functions:deploy -- game-action
```

Verify the deployed version number incremented and verify BY CONTENT
(`grep` the deployed `dwgEffects.ts` for `mutinyEffect`), not by file count
(docs/claude/supabase.md).

- [ ] **Step 4: Live poke.** Through the browser preview (docs/claude/testing.md,
`node scripts/qa-login.mjs` for a session): play a Mutiny onto an enemy hull
and end the turn; confirm the hull returns to the opponent's discard and that
`game-action` returned 200 throughout.

- [ ] **Step 5: Close out honestly.** Report: before→after test count; the
rulings; what is still unbuilt or recorded-not-fixed (D-2's declared-roster
gap, Q3's uniquePerZone edge, the stale `smoke-wave6.mjs` assertions); and
the Horror deck count.
