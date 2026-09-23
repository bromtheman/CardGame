# LH Drain Discount, Cathode Overheat, Watt and Quadrupole — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn "Drain N Charge" from a play gate into an all-or-nothing N × 50k discount, and rebalance Cathode (Overheat; Fragile only; no duel), the Watt (120k; no pip on entry) and Quadrupole (no Mobile).

**Architecture:** The rule stays keyed on `meta.requiresCharge` (spec approach A).
- `planDrain` in `shared/engine/charge.ts` picks the mode (all N pips, or none) and returns the discount.
- Both deploy handlers in `shared/engine/placement.ts` price the play from that discount.
- Three pure price helpers beside `effectiveCostInGame` feed the hand, the board and the dialog.
- Cathode's Overheat is a new `onBattleEffect` id, `cathodeOverheat`, that reuses `stunHull`.
- The Watt gets a new on-play id, `wattEscortOnPlay`.
- Card data changes in the seed source and reaches production only through `seed-apply.yml` after merge.

**Tech Stack:** TypeScript (the shared engine, which is synced into the Deno edge functions), React 19 + Vite, Vitest, and the seed pipeline (`npm run seed:build`).

**Spec:** `docs/superpowers/specs/2026-09-23-lh-drain-discount-design.md`. Read it first: this plan argues from it.

## Global Constraints

**Shell and git**
- The shell is PowerShell: chain commands with `;`, never `&&`. `git` and `npm` commands run from the worktree root.
- Every commit touching `shared/` carries `npm run functions:sync` output (`supabase/functions/*/shared/**`). `supabase/seed/functionSharedSync.test.ts` fails otherwise.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Code rules**
- Relative imports inside `shared/` end in `.ts`. Consumers import `shared/engine/index.ts` (frontend: `@shared/engine/index`). Tests next to a module may import the module directly.
- Registry ids are unique and never reused. `cathodeOverheat` and `wattEscortOnPlay` are new. `cathodeDuel` and `wattOnPlay` stay registered, because dealt snapshots name them, and join `DELIBERATE_ORPHANS`.
- Public log lines never name a card in a hidden hand.

**The Drain rule**
- `DRAIN_DISCOUNT_PER_CHARGE = 50_000` in `shared/gameSettings.ts`. Every printed discount is N × 50k.
- It is all or nothing: exactly N pips or none.
  - `chargeFrom` absent: drain the suggested split when the board holds N, otherwise pay the full price.
  - `chargeFrom: []`: pay the full price.
  - A non-empty split must total exactly N.

**Testing**
- TDD: the failing test comes first. Report the full-suite before → after count at the end of every task.
- Run the full suite as `npx vitest run --maxWorkers=4`, never with `--root`. The owner's PC overheats, so run one heavy process at a time.

**Seed data and deploys**
- After every seed source edit, run `npm run seed:build` and commit `supabase/seed/seed_data.sql`.
- Never hand-apply seed SQL. Merging runs `seed-apply.yml`.
- Never deploy functions by MCP or through a subagent. Merging to `main` deploys (CLAUDE.md).

**Copy**
- The bot's prose (`factionNotes.ts`, and `rulesPrimer.ts`'s template, glossary and HOW YOU PLAY) contains no digits. Figures go through `{{PLACEHOLDERS}}`.
- Every quoted copy string in this plan is verbatim from the spec (§2, §4, §6, §7, §8).

## File map

| File | Change | Task |
|---|---|---|
| `shared/gameSettings.ts` | `DRAIN_DISCOUNT_PER_CHARGE` | 1 |
| `shared/engine/charge.ts` | `drainDiscountOf`; `planDrain` modes and discount; `applyDrain(…, discount)`; delete `chargeGateShortfall`, move `drainNeedsChoice` | 1 |
| `shared/engine/placement.ts` | `priceInGame`; `canAffordInGame`/`pay` take a discount; both deploy handlers; `drainedCostInGame`, `cheapestCostInGame`, `drainNeedsChoice` | 1 |
| `shared/engine/charge.test.ts`, `shared/engine/placement.test.ts` | Drain tests rewritten | 1 |
| `frontend/src/pages/game/HandBar.tsx` | cheapest price; banner removed | 1 |
| `frontend/src/pages/game/GameBoardPage.tsx` | `playToZone`, materials tint | 1 |
| `docs/claude/frontend.md`, two older specs | pointers | 1 |
| `shared/engine/stun.ts` (+ `stun.test.ts`) | `stunHull(game, entry, logLine?)`, `stunEndsThisTurn` | 2 |
| `shared/effects/lhEffects.ts` (+ `lhRedesign.test.ts`) | `cathodeOverheat` | 2 |
| `frontend/src/pages/game/MiniVehicle.tsx` | stun badge wording | 2 |
| `shared/ai/llm/rulesPrimer.ts` (+ test) | stun sentence | 2 |
| `supabase/seed/source/builtInCards/LH-Built-in.js` | Cathode row | 2 |
| `supabase/seed/balance/lh.balance.test.ts` | Cathode pin; two more absent keys | 2 |
| `supabase/seed/effectCoverage.test.ts` | `cathodeDuel` orphan | 2 |
| `shared/effects/lhEffects.ts` (+ test) | `wattLaunch`, `wattEscortOnPlay` | 3 |
| `LH-Built-in.js`, `lh.balance.test.ts`, `effectCoverage.test.ts` | Watt row, pin, `wattOnPlay` orphan | 3 |
| `shared/ai/llm/factionNotes.ts` (+ test) | Watt clause | 3 |
| `docs/claude/card-effects.md`, hovercraft spec, redesign spec | Watt docs | 3 |
| `LH-Built-in.js`, `lh.balance.test.ts` | six Drain rows and a discount-text test | 4 |
| `frontend/src/lib/keywords.ts` (+ test), `frontend/src/components/PhysicalCard.tsx` | Drain copy | 4 |
| `shared/ai/llm/rulesPrimer.ts`, `factionNotes.ts`, `botDecks.ts` (+ tests) | bot's Drain copy | 4 |
| `frontend/src/pages/game/DrainChargeDialog.tsx` | drain or pay full price | 5 |
| `supabase/seed/seed_data.sql` | regenerated | 2, 3, 4 |

---

### Task 1: Drain as a discount — engine, hand and board

**Files:**
- Modify: `shared/gameSettings.ts` (after `WATT_PLAY_CHARGE`, ~line 305)
- Modify: `shared/engine/charge.ts` (lines 1, 46–63, 78–204)
- Modify: `shared/engine/placement.ts` (line 16, 331–360, 487–517, 685–701)
- Modify: `frontend/src/pages/game/HandBar.tsx` (line 4, 98–100, 287–297, 374, 386–400, 428)
- Modify: `frontend/src/pages/game/GameBoardPage.tsx` (line 6, 156–158, 172–189)
- Modify: `docs/claude/frontend.md` (125–126), `docs/superpowers/specs/2026-09-22-lh-drain-charge-design.md` (after line 6), `docs/superpowers/specs/2026-09-21-lh-faction-redesign-design.md` (§3.3, after the existing blockquote)
- Test: `shared/engine/charge.test.ts`, `shared/engine/placement.test.ts`

**Interfaces:**
- Produces, from `charge.ts` (re-exported by `engine/index.ts`):
  - `drainDiscountOf(card: { meta: Record<string, unknown> }): number`
  - `type DrainPlan = { split: ChargeShare[]; discount: number } | { error: string }`
  - `planDrain(state, side, card, chargeFrom: unknown): DrainPlan`
  - `applyDrain(game, side, cardName: string, split: readonly ChargeShare[], discount: number): void`
  - `chargeGateShortfall` is **deleted**, and `drainNeedsChoice` **moves** to `placement.ts`.
- Produces, from `placement.ts`:
  - `drainedCostInGame(state, side, card: CardInstance, turnNumber: number): number`
  - `cheapestCostInGame(state, side, card: CardInstance, turnNumber: number): number`
  - `drainNeedsChoice(state, side, card: CardInstance, turnNumber: number): boolean`
- Produces, from `gameSettings.ts`: `DRAIN_DISCOUNT_PER_CHARGE = 50_000`.

- [ ] **Step 1: Set up the worktree and take the baseline**

A fresh worktree has no `node_modules` and no env file (CLAUDE.md).

```powershell
npm install
npm --prefix frontend install
Copy-Item C:\Users\JFinn\FtDCardGame\frontend\.env.local frontend\.env.local
npx vitest run --maxWorkers=4
```

Expected: every test passes. Write down the "Tests N passed" figure: it is the whole branch's **before** count. A count in the hundreds of failures means an incomplete install, not broken code.

- [ ] **Step 2: Write the failing `charge.ts` tests**

In `shared/engine/charge.test.ts`:

(a) Replace the import block (lines 2–6) with:

```ts
import {
  addCharge, applyDrain, boardChargeOf, chargeMaxOf, chargeOf, chargePayersOf,
  chargeSplitError, chargeSplitIsForced, drainDiscountOf, planDrain, spendCharge, suggestedChargeSplit,
  tickCharge,
} from './charge.ts'
```

(b) Replace the test `'sums LH pips across every lane and reports a gate shortfall'` (lines 39–49) with:

```ts
  it('sums LH pips across every lane, and only LH', () => {
    const game = makeGame()
    game.state.zones[0].cards.a.push(lh({ charge: 2 }))
    game.state.zones[2].cards.a.push(lh({ charge: 1 }))
    game.state.zones[1].cards.a.push(zoneEntry({ faction: 'DWG', meta: { chargeMax: 2 }, charge: 2 }))
    game.state.zones[0].cards.b.push(lh({ charge: 2 }))
    expect(boardChargeOf(game.state, 'a')).toBe(3)
  })
```

(c) Delete the test `'opens the dialog only for a gated card the board can pay more than one way'` (lines 169–176). It moves to `placement.test.ts` with prices.

(d) Replace the test `'plans a drain: the precondition, the suggested split, or the player’s own'` (lines 178–194) with:

```ts
  it('prices a drain at N × 50k', () => {
    expect(drainDiscountOf(gated(1))).toBe(50_000)
    expect(drainDiscountOf(gated(4))).toBe(200_000)
    expect(drainDiscountOf({ meta: {} })).toBe(0)
  })

  it('plans a drain: all N for the discount, or none at full price — never refused for want of pips', () => {
    const game = makeGame()
    game.state.zones[0].cards.a.push(battery('A', 2), battery('B', 1))
    const none = { split: [], discount: 0 }
    // Absent: the suggested split when the board holds N (A 2→1, then the tie
    // at 1 goes to A in board order), otherwise the printed price.
    expect(planDrain(game.state, 'a', gated(2), undefined))
      .toEqual({ split: [{ instanceId: 'A', amount: 2 }], discount: 100_000 })
    expect(planDrain(game.state, 'a', gated(4), undefined)).toEqual(none)
    // An empty list is a deliberate full-price play, even when the board could drain.
    expect(planDrain(game.state, 'a', gated(2), [])).toEqual(none)
    const own = [{ instanceId: 'B', amount: 1 }, { instanceId: 'A', amount: 1 }]
    expect(planDrain(game.state, 'a', gated(2), own)).toEqual({ split: own, discount: 100_000 })
    // A named split must still total exactly N — there is no partial drain.
    expect(planDrain(game.state, 'a', gated(2), [{ instanceId: 'B', amount: 1 }]))
      .toEqual({ error: 'Choose exactly 2 charge — you chose 1' })
    expect(planDrain(game.state, 'a', gated(2), [{ instanceId: 'B', amount: 2 }])).toEqual({ error: 'B holds only 1 charge' })
    expect(planDrain(game.state, 'a', gated(4), [{ instanceId: 'A', amount: 2 }, { instanceId: 'B', amount: 1 }]))
      .toEqual({ error: 'Choose exactly 4 charge — you chose 3' })
    expect(planDrain(game.state, 'a', gated(2), 'all of it'))
      .toEqual({ error: 'chargeFrom must be a list of { instanceId, amount }' })
    const plain = { name: 'Kilowatt', meta: {} }
    expect(planDrain(game.state, 'a', plain, undefined)).toEqual(none)
    expect(planDrain(game.state, 'a', plain, [])).toEqual(none)
    expect(planDrain(game.state, 'a', plain, [{ instanceId: 'A', amount: 1 }])).toEqual({ error: 'Kilowatt drains no charge' })
  })
```

(e) Replace the test `'spends a split and logs it in board order, never touching an activation'` (lines 196–208) with:

```ts
  it('spends a split and logs it with its discount, in board order, never touching an activation', () => {
    const game = makeGame()
    const a = battery('Chrysoprase', 2)
    const b = battery('Kilowatt', 2)
    game.state.zones[0].cards.a.push(a)
    game.state.zones[1].cards.a.push(b)
    applyDrain(game, 'a', 'Candela', [{ instanceId: 'Kilowatt', amount: 1 }, { instanceId: 'Chrysoprase', amount: 2 }], 150_000)
    expect([chargeOf(a), chargeOf(b)]).toEqual([0, 1])
    expect(game.state.log).toEqual(['Candela drains 3 charge for 150k off — Chrysoprase 2, Kilowatt 1'])
    expect([a.activatedOnTurn, b.activatedOnTurn]).toEqual([null, null])
    applyDrain(game, 'a', 'Kilowatt', [], 0)
    expect(game.state.log).toHaveLength(1)
  })
```

- [ ] **Step 3: Write the failing `placement.ts` tests**

In `shared/engine/placement.test.ts`:

(a) Replace the import on lines 2–4 with:

```ts
import {
  applyAction, cheapestCostInGame, drainedCostInGame, drainNeedsChoice, effectFor, effectiveCostInGame,
  effectiveMaterialCostOf, legalZonesFor,
} from './index'
```

(b) Replace the whole `describe('Drain N Charge (2026-09-22 spec §2–§3)', …)` block (lines 1794–1901) with these two blocks:

```ts
describe('Drain as a discount (2026-09-23 spec §2–§3)', () => {
  beforeAll(() => { registerEffect('t_drainHandNoop', () => true) })
  // Printed 150k with Drain 2: 50k drained (2 × 50k off), 150k at full price.
  const gated = (over: Partial<CardInstance> = {}) => inst({
    instanceId: 'cap', name: 'Quadrupole', faction: 'LH', materialCost: 150_000, meta: { requiresCharge: 2 }, ...over,
  })
  const battery = (id: string, charge: number) =>
    zoneEntry({ instanceId: id, name: id, faction: 'LH', meta: { chargeMax: 2 }, charge })
  const setup = (materials: number, ...cards: CardInstance[]) => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    game.state.resources.a.materials = materials
    game.privates.a.hand = cards.length > 0 ? cards : [gated()]
    game.state.counts.a = { hand: game.privates.a.hand.length, deck: 0 }
    return game
  }
  const hull = (game: EngineGame, zoneIndex: number, i: number) => game.state.zones[zoneIndex].cards.a[i] as ZoneCardEntry
  const play = (game: EngineGame, extra: Record<string, unknown> = {}, instanceId = 'cap') =>
    applyAction(game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId, zoneId: 1, ...extra } as GameAction, makeCtx())
  const drainLines = (game: EngineGame) => game.state.log.filter((l) => l.includes(' drains '))

  it('drains the split the player chose for N × 50k off, logged before the deploy line', () => {
    const game = setup(200_000)
    game.state.zones[0].cards.a.push(battery('Chrysoprase', 2))
    game.state.zones[2].cards.a.push(battery('Kilowatt', 2))
    const res = play(game, { chargeFrom: [{ instanceId: 'Kilowatt', amount: 2 }] })
    if (!res.ok) throw new Error(res.error)
    expect(chargeOf(hull(res.game, 0, 0))).toBe(2)
    expect(chargeOf(hull(res.game, 2, 0))).toBe(0)
    expect(res.game.state.resources.a.materials).toBe(150_000)
    const log = res.game.state.log
    const line = 'Quadrupole drains 2 charge for 100k off — Kilowatt 2'
    expect(log.indexOf(line)).toBeGreaterThanOrEqual(0)
    expect(log.indexOf(line)).toBeLessThan(log.indexOf('Quadrupole deployed to zone 1'))
  })

  it('plays at the printed price with an empty split, draining nothing', () => {
    const game = setup(200_000)
    game.state.zones[0].cards.a.push(battery('Chrysoprase', 2))
    const res = play(game, { chargeFrom: [] })
    if (!res.ok) throw new Error(res.error)
    expect(chargeOf(hull(res.game, 0, 0))).toBe(2)
    expect(res.game.state.resources.a.materials).toBe(50_000)
    expect(drainLines(res.game)).toEqual([])
  })

  it('drains the suggested split when the play names none and the board holds N (PracticeAI, a forced split)', () => {
    const game = setup(200_000)
    game.state.zones[0].cards.a.push(zoneEntry({
      instanceId: 'Umbra', name: 'Umbra', faction: 'LH', meta: { chargeMax: 2, dischargeCost: 2 }, charge: 2,
    }))
    game.state.zones[1].cards.a.push(battery('Chrysoprase', 2))
    const res = play(game)
    if (!res.ok) throw new Error(res.error)
    expect(chargeOf(hull(res.game, 0, 0))).toBe(2) // the timer keeps its salvo
    expect(chargeOf(hull(res.game, 1, 0))).toBe(0)
    expect(res.game.state.resources.a.materials).toBe(150_000)
  })

  it('pays the printed price when the play names none and the board holds fewer than N — never a blocker', () => {
    const game = setup(200_000)
    game.state.zones[2].cards.a.push(battery('Chrysoprase', 1))
    const res = play(game)
    if (!res.ok) throw new Error(res.error)
    expect(chargeOf(hull(res.game, 2, 0))).toBe(1)
    expect(res.game.state.resources.a.materials).toBe(50_000)
    expect(drainLines(res.game)).toEqual([])
  })

  it('plays a card affordable only when drained, and refuses it at full price, spending nothing', () => {
    const drained = setup(100_000)
    drained.state.zones[0].cards.a.push(battery('Chrysoprase', 2))
    const res = play(drained)
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.resources.a.materials).toBe(50_000)
    const full = setup(100_000)
    full.state.zones[0].cards.a.push(battery('Chrysoprase', 2))
    expect(play(full, { chargeFrom: [] })).toMatchObject({ ok: false, status: 400, error: 'You cannot afford that card' })
    expect(chargeOf(hull(full, 0, 0))).toBe(2)
    expect(full.privates.a.hand).toHaveLength(1)
  })

  it('refuses a card affordable in neither mode, and spends nothing', () => {
    const game = setup(40_000)
    game.state.zones[0].cards.a.push(battery('Chrysoprase', 2))
    expect(play(game)).toMatchObject({ ok: false, status: 400, error: 'You cannot afford that card' })
    expect(chargeOf(hull(game, 0, 0))).toBe(2)
    expect(game.privates.a.hand).toHaveLength(1)
  })

  it('leaves a payer’s activation alone, so it may still discharge this turn', () => {
    const game = setup(200_000)
    game.state.zones[0].cards.a.push(battery('Chrysoprase', 2))
    const res = play(game)
    if (!res.ok) throw new Error(res.error)
    expect(hull(res.game, 0, 0).activatedOnTurn).toBeNull()
  })

  it('refuses a split that cannot pay, and spends nothing', () => {
    const cases: [unknown, string][] = [
      [[{ instanceId: 'Chrysoprase', amount: 1 }], 'Choose exactly 2 charge — you chose 1'],
      [[{ instanceId: 'Chrysoprase', amount: 3 }], 'Chrysoprase holds only 2 charge'],
      [[{ instanceId: 'Theirs', amount: 2 }], 'That charge source is not one of your LH vehicles on the board'],
    ]
    for (const [chargeFrom, error] of cases) {
      const game = setup(200_000)
      game.state.zones[0].cards.a.push(battery('Chrysoprase', 2))
      game.state.zones[0].cards.b.push(battery('Theirs', 2))
      expect(play(game, { chargeFrom })).toMatchObject({ ok: false, status: 400, error })
      expect(chargeOf(hull(game, 0, 0))).toBe(2)
      expect(game.privates.a.hand).toHaveLength(1)
    }
  })

  it('refuses a split sent with a card that drains nothing', () => {
    const game = setup(200_000, inst({ instanceId: 'plain', name: 'Kilowatt', faction: 'LH', materialCost: 40000 }))
    game.state.zones[0].cards.a.push(battery('Chrysoprase', 2))
    expect(play(game, { chargeFrom: [{ instanceId: 'Chrysoprase', amount: 1 }] }, 'plain'))
      .toMatchObject({ ok: false, status: 400, error: 'Kilowatt drains no charge' })
  })

  it('makes a second Drain card in the same turn find its own pips, or pay full price', () => {
    const game = setup(400_000, gated(), gated({ instanceId: 'cap2' }))
    game.state.zones[0].cards.a.push(battery('Chrysoprase', 2), battery('Kilowatt', 1))
    const first = play(game)
    if (!first.ok) throw new Error(first.error)
    expect(first.game.state.resources.a.materials).toBe(350_000) // drained: 50k
    const second = play(first.game, {}, 'cap2')
    if (!second.ok) throw new Error(second.error)
    expect(second.game.state.resources.a.materials).toBe(200_000) // one pip left: full 150k
    expect(chargeOf(hull(second.game, 0, 1))).toBe(1)
  })

  // No LH card deploys through PLAY_CARD_TARGETING_CARD_IN_HAND; a synthetic
  // one pins that Excalibur's path follows the same rule with no split named.
  it('prices a vehicle deployed through Excalibur’s path the same way', () => {
    const excalibur = () => [
      gated({ meta: { requiresCharge: 2, playOnCardEffect: 't_drainHandNoop' } }),
      inst({ instanceId: 'other' }),
    ]
    const action = { type: 'PLAY_CARD_TARGETING_CARD_IN_HAND', instanceId: 'cap', targetInstanceId: 'other', zoneId: 1 } as GameAction
    const short = setup(200_000, ...excalibur())
    short.state.zones[0].cards.a.push(battery('Chrysoprase', 1))
    const full = applyAction(short, 'alice', action, makeCtx())
    if (!full.ok) throw new Error(full.error)
    expect(full.game.state.resources.a.materials).toBe(50_000)
    expect(chargeOf(hull(full.game, 0, 0))).toBe(1)
    const game = setup(200_000, ...excalibur())
    game.state.zones[0].cards.a.push(battery('Chrysoprase', 2))
    const res = applyAction(game, 'alice', action, makeCtx())
    if (!res.ok) throw new Error(res.error)
    expect(chargeOf(hull(res.game, 0, 0))).toBe(0)
    expect(res.game.state.resources.a.materials).toBe(150_000)
    expect(res.game.state.log).toContain('Quadrupole drains 2 charge for 100k off — Chrysoprase 2')
  })
})

describe('Drain prices — drainedCostInGame, cheapestCostInGame, drainNeedsChoice (2026-09-23 spec §3–§4)', () => {
  const battery = (id: string, charge: number) =>
    zoneEntry({ instanceId: id, name: id, faction: 'LH', meta: { chargeMax: 2 }, charge })
  const card = (materialCost: number, requiresCharge?: number, cpCost = 0) =>
    inst({ name: 'Quadrupole', faction: 'LH', materialCost, cpCost, meta: requiresCharge ? { requiresCharge } : {} })
  const board = (materials: number, ...charges: number[]) => {
    const game = makeGame()
    game.state.resources.a.materials = materials
    charges.forEach((c, i) => game.state.zones[0].cards.a.push(battery(`b${i}`, c)))
    return game.state
  }

  it('takes N × 50k off, last and never below zero', () => {
    const state = board(0)
    expect(drainedCostInGame(state, 'a', card(660_000, 2), 2)).toBe(560_000)
    expect(drainedCostInGame(state, 'a', card(950_000, 4), 2)).toBe(750_000)
    expect(drainedCostInGame(state, 'a', card(60_000, 2), 2)).toBe(0)
    expect(drainedCostInGame(state, 'a', card(60_000), 2)).toBe(60_000)
  })

  it('shows the drained price only when the board holds N', () => {
    expect(cheapestCostInGame(board(0, 2), 'a', card(660_000, 2), 2)).toBe(560_000)
    expect(cheapestCostInGame(board(0, 1), 'a', card(660_000, 2), 2)).toBe(660_000)
    expect(cheapestCostInGame(board(0, 2), 'a', card(660_000), 2)).toBe(660_000)
  })

  it('asks only when a drained play is affordable and something is left to choose', () => {
    // Both prices affordable and one way to drain: drain-or-keep is the choice.
    expect(drainNeedsChoice(board(700_000, 2), 'a', card(660_000, 2), 2)).toBe(true)
    // Only the drained price affordable and one way to drain: nothing to ask.
    expect(drainNeedsChoice(board(600_000, 2), 'a', card(660_000, 2), 2)).toBe(false)
    // Only the drained price affordable but several ways to drain: ask for the split.
    expect(drainNeedsChoice(board(600_000, 2, 1), 'a', card(660_000, 2), 2)).toBe(true)
    // Neither affordable, too few pips, no Drain, or CP short: send, and the server says why.
    expect(drainNeedsChoice(board(500_000, 2, 1), 'a', card(660_000, 2), 2)).toBe(false)
    expect(drainNeedsChoice(board(700_000, 1), 'a', card(660_000, 2), 2)).toBe(false)
    expect(drainNeedsChoice(board(700_000, 2, 1), 'a', card(660_000), 2)).toBe(false)
    expect(drainNeedsChoice(board(700_000, 2, 1), 'a', card(660_000, 2, 9), 2)).toBe(false)
  })
})
```

- [ ] **Step 4: Run the two files to verify they fail**

Run: `npx vitest run shared/engine/charge.test.ts shared/engine/placement.test.ts`

Expected: FAIL. `drainDiscountOf`, `drainedCostInGame` and `cheapestCostInGame` are not exported, `planDrain` still returns `{ split }` and refuses short boards, and the log lacks "for 100k off".

- [ ] **Step 5: Add the constant**

In `shared/gameSettings.ts`, directly after `export const WATT_PLAY_CHARGE = 1`:

```ts
// 2026-09-23 Drain as a discount (docs/superpowers/specs/2026-09-23-lh-drain-discount-design.md
// §2): "Drain N Charge: costs Xk less" takes N × this off, and only when all N
// pips are drained. Printed prices rose by the same N × this, so a drained play
// costs what it did under the gate.
export const DRAIN_DISCOUNT_PER_CHARGE = 50_000
```

- [ ] **Step 6: Rewrite the Drain rule in `charge.ts`**

(a) Replace line 1 with:

```ts
import { CHARGE_TICK, DRAIN_DISCOUNT_PER_CHARGE, FACTIONS } from '../gameSettings.ts'
import { shortHandNumber } from '../format.ts'
```

`format.ts` already ships with both `game-action` and `lobby-action` (`shared-manifest.json`), so the manifest needs no edit.

(b) Replace lines 46–63 (the `boardChargeOf` comment, `boardChargeOf` and `chargeGateShortfall`) with:

```ts
// A Drain reads the whole board (2026-09-21 spec §3.3; a gate until 2026-09-23,
// a discount since). "LH" is faction === 'LH': player-made cards are NEUTRAL and never count.
export function boardChargeOf(state: PublicGameState, side: Side): number {
  let total = 0
  for (const zone of state.zones) {
    for (const c of zone.cards[side]) if (c.faction === FACTIONS.LH) total += chargeOf(c as ZoneCardEntry)
  }
  return total
}

// "Drain N Charge: costs Xk less" (2026-09-23 spec §2): X = N × DRAIN_DISCOUNT_PER_CHARGE,
// earned only by draining all N. Zero for a card without a Drain.
export function drainDiscountOf(card: HasMeta): number {
  return chargeGateOf(card) * DRAIN_DISCOUNT_PER_CHARGE
}
```

(c) Replace the section header comment at lines 78–82 with:

```ts
// ── Drain N Charge (2026-09-22; a discount since docs/superpowers/specs/2026-09-23-lh-drain-discount-design.md) ──
// A Drain card (meta.requiresCharge, printed "Drain N Charge: costs Xk less")
// may be paid for in pips from any mix of the player's LH hulls — all N of
// them for N × 50k off, or none at the printed price. These are the ONE copy of
// the payment rules: both deploy handlers, the dialog and PracticeAI (which
// drains the suggested split whenever it can) import them — nothing re-derives them.
```

(d) Replace everything from `// The split dialog's gate (§4)` (line 161) to the end of the file (the old `drainNeedsChoice`, `DrainPlan`, `planDrain` and `applyDrain`) with:

```ts
export type DrainPlan = { split: ChargeShare[]; discount: number } | { error: string }

// Everything a play decides about its Drain, before anything moves
// (2026-09-23 spec §2–§3). All or nothing: exactly N pips for the discount, or
// none at the printed price — there is no partial drain, and a short board is
// never refused, it just pays full price.
//   - chargeFrom absent (PracticeAI, a forced split): the suggested split when
//     the board holds N, otherwise full price;
//   - chargeFrom []: a deliberate full-price play;
//   - a named split: validated by chargeSplitError, so it totals exactly N.
export function planDrain(
  state: PublicGameState, side: Side, card: HasMeta & { name: string }, chargeFrom: unknown,
): DrainPlan {
  const fullPrice: DrainPlan = { split: [], discount: 0 }
  const gate = chargeGateOf(card)
  if (gate === 0) {
    const sent = Array.isArray(chargeFrom) ? chargeFrom.length > 0 : chargeFrom !== undefined
    return sent ? { error: `${card.name} drains no charge` } : fullPrice
  }
  if (chargeFrom === undefined) {
    const suggested = suggestedChargeSplit(state, side, gate)
    return suggested ? { split: suggested, discount: drainDiscountOf(card) } : fullPrice
  }
  if (!Array.isArray(chargeFrom)) return { error: 'chargeFrom must be a list of { instanceId, amount }' }
  if (chargeFrom.length === 0) return fullPrice
  const error = chargeSplitError(state, side, gate, chargeFrom)
  return error ? { error } : { split: chargeFrom as ChargeShare[], discount: drainDiscountOf(card) }
}

// Spends a split planDrain returned and logs it with its discount — public,
// since every payer is on the board, and "for 100k off" says it is a payment,
// not an ability (the 2026-09-22 playtest misread). Paying is not an
// activation: activatedOnTurn is never touched, so a payer may still
// Discharge this turn with what it has left. A full-price play logs nothing.
export function applyDrain(
  game: EngineGame, side: Side, cardName: string, split: readonly ChargeShare[], discount: number,
): void {
  if (split.length === 0) return
  const byId = new Map(split.map((s) => [s.instanceId, s.amount]))
  const parts: string[] = []
  let total = 0
  for (const { entry } of chargePayersOf(game.state, side)) {
    const amount = byId.get(entry.instanceId)
    if (amount === undefined) continue
    spendCharge(entry, amount)
    parts.push(`${entry.name} ${amount}`)
    total += amount
  }
  game.state.log.push(`${cardName} drains ${total} charge for ${shortHandNumber(discount)} off — ${parts.join(', ')}`)
}
```

- [ ] **Step 7: Price plays from the plan in `placement.ts`**

(a) Replace line 16 with:

```ts
import {
  applyDrain, boardChargeOf, chargeGateOf, chargeOf, chargeSplitIsForced, dischargeFromOf, drainDiscountOf,
  planDrain, spendCharge,
} from './charge.ts'
```

(b) Directly after `effectiveCostInGame` (it ends at line 331), insert:

```ts
// ── 2026-09-23 Drain as a discount (docs/superpowers/specs/2026-09-23-lh-drain-discount-design.md §3) ──
// The discount comes off LAST, after modifiers, costDelta and Half-Cost, so a
// Drain card costs exactly N × 50k less than it otherwise would; never below 0.
export function drainedCostInGame(
  state: PublicGameState, side: Side, card: CardInstance, turnNumber: number,
): number {
  return Math.max(0, effectiveCostInGame(state, side, card, turnNumber) - drainDiscountOf(card))
}

// What the hand shows and rings by: the drained price when the board holds
// the card's N, otherwise effectiveCostInGame. A card without a Drain always
// gets the latter.
export function cheapestCostInGame(
  state: PublicGameState, side: Side, card: CardInstance, turnNumber: number,
): number {
  const gate = chargeGateOf(card)
  return gate > 0 && boardChargeOf(state, side) >= gate
    ? drainedCostInGame(state, side, card, turnNumber)
    : effectiveCostInGame(state, side, card, turnNumber)
}

// The Drain dialog's gate (§4): a drained play is affordable, and something is
// left to choose — the full price is affordable too, or the split is not
// forced. Otherwise the client sends the play with no split, and the engine
// drains, pays full price, or refuses naming why.
export function drainNeedsChoice(
  state: PublicGameState, side: Side, card: CardInstance, turnNumber: number,
): boolean {
  const gate = chargeGateOf(card)
  if (gate === 0 || boardChargeOf(state, side) < gate) return false
  const { materials, cp } = state.resources[side]
  if (cp < card.cpCost || materials < drainedCostInGame(state, side, card, turnNumber)) return false
  return materials >= effectiveCostInGame(state, side, card, turnNumber) || !chargeSplitIsForced(state, side, gate)
}

// The price a play actually pays: effectiveCostInGame less a Drain's discount
// (0 unless all N pips were drained), never below zero.
function priceInGame(game: EngineGame, side: Side, card: CardInstance, discount: number): number {
  return Math.max(0, effectiveCostInGame(game.state, side, card, game.turnNumber) - discount)
}
```

(c) Replace `canAffordInGame` (lines 333–338) with:

```ts
function canAffordInGame(game: EngineGame, side: Side, card: CardInstance, discount = 0): boolean {
  return (
    game.state.resources[side].materials >= priceInGame(game, side, card, discount) &&
    game.state.resources[side].cp >= card.cpCost
  )
}
```

(d) Replace `pay` (lines 357–360) with:

```ts
function pay(game: EngineGame, side: Side, card: CardInstance, discount = 0): void {
  game.state.resources[side].materials -= priceInGame(game, side, card, discount)
  game.state.resources[side].cp -= card.cpCost
}
```

(e) In `PLAY_CARD_TO_ZONE`, replace lines 487–494 (the afford check and the Drain block) with:

```ts
  // 2026-09-23 Drain as a discount (docs/superpowers/specs/2026-09-23-lh-drain-discount-design.md
  // §2–§3): all N pips for N × 50k off, or none at the printed price. Planned
  // FIRST, because the price depends on it; nothing is spent until pay(), and
  // spawns never come through here (design spec §7.4).
  const drain = planDrain(game.state, actor, card, action.chargeFrom)
  if ('error' in drain) return err(400, drain.error)
  if (!canAffordInGame(game, actor, card, drain.discount)) return err(400, 'You cannot afford that card')
```

In the same handler, replace:

```ts
  pay(game, actor, card)
  applyDrain(game, actor, card.name, drain.split)
```

with:

```ts
  pay(game, actor, card, drain.discount)
  applyDrain(game, actor, card.name, drain.split, drain.discount)
```

(f) In `PLAY_CARD_TARGETING_CARD_IN_HAND`, replace lines 685–690 (the afford check and the Drain block) with:

```ts
  // The same Drain as PLAY_CARD_TO_ZONE (2026-09-23 spec §3). No card on this
  // path carries one today, and it takes no split, so the absent row applies:
  // the suggested split when the board holds N, otherwise full price.
  const drain = planDrain(game.state, actor, card, undefined)
  if ('error' in drain) return err(400, drain.error)
  if (!canAffordInGame(game, actor, card, drain.discount)) return err(400, 'You cannot afford that card')
```

Then make the same `pay` / `applyDrain` replacement as in (e): `pay(game, actor, card, drain.discount)` and `applyDrain(game, actor, card.name, drain.split, drain.discount)`.

`PLAY_ABILITY_CARD` and `PLAY_CARD_TARGETING_CARD_ON_FIELD` keep calling `canAffordInGame(game, actor, card)` and `pay(game, actor, card)`. The default discount of 0 leaves them unchanged.

- [ ] **Step 8: Run the two files to verify they pass**

Run: `npx vitest run shared/engine/charge.test.ts shared/engine/placement.test.ts`

Expected: PASS.

- [ ] **Step 9: Move the hand and board onto the new helpers**

`frontend/src/pages/game/HandBar.tsx`:

- Line 4 becomes:

  ```tsx
  import { cheapestCostInGame, dischargeFromOf, effectName, legalZonesFor } from '@shared/engine/index'
  ```

- Lines 98–99, the comment on `onPlayToZone`, becomes:

  ```tsx
    // Every vehicle play into a known zone goes through GameBoardPage, which
    // stops a Drain card at its dialog first when there is a choice (2026-09-23 spec §4).
  ```

- Replace lines 288–297 (from `const effectiveCost = …` through `const playable = …`) with:

  ```tsx
            // The price the hand shows and rings by. A Drain card the board can
            // pay shows its drained price (2026-09-23 spec §4); the dialog then
            // offers the full price too, and a short board simply pays full price.
            const price = cheapestCostInGame(state, mySide, c, turnNumber)
            const affordable = state.resources[mySide].materials >= price && state.resources[mySide].cp >= c.cpCost
            // §3.2 / R-20: an ability card's own "Discharge N from a friendly LH
            // vehicle" cost, greyed out with no legal host — vehicles never
            // carry dischargeFrom, so this only ever narrows an ability.
            const dischargeFrom = c.type === 'ability' ? dischargeFromOf(c) : null
            const dischargeUnmet = dischargeFrom !== null && !dischargeHostAvailable(state, mySide, dischargeFrom, turnNumber)
            const playable = affordable && !dischargeUnmet
  ```

- Line 374: `effectiveCost={effectiveCost}` becomes `effectiveCost={price}`.
- Lines 386 and 393: `effectiveCost !== c.materialCost` becomes `price !== c.materialCost`, and `{shortHandNumber(effectiveCost)}` becomes `{shortHandNumber(price)}`.
- Delete the Drain banner (lines 396–400), the whole `{gate && ( … Drain {gate.required} Charge — you have {gate.have} … )}` block.
- Line 428: `Play ({shortHandNumber(effectiveCost)})` becomes `Play ({shortHandNumber(price)})`.

`frontend/src/pages/game/GameBoardPage.tsx`:

- Line 6 becomes:

  ```tsx
  import { battleFrozen, biomeAllows, cheapestCostInGame, drainNeedsChoice, effectName, findVehicle, legalZonesFor, zoneCapFor } from '@shared/engine/index'
  ```

- Lines 156–158 (`liftedUnaffordable`) become:

  ```tsx
    const liftedUnaffordable =
      liftedCard !== null &&
      state.resources[mySide].materials < cheapestCostInGame(state, mySide, liftedCard, game.turn_number)
  ```

- Replace lines 172–189 (the comment above `playToZone` and the function) with:

  ```tsx
    // Every play of a hand card into a zone — the hand's one-legal-zone
    // shortcut and a zone click alike — comes through here, so a Drain card
    // with a real choice (drain or pay full price, or which hulls pay) stops at
    // the dialog first (2026-09-23 spec §4). Everything else sends at once with
    // no split: the engine drains when the board holds N and pays full price
    // when it does not, and an unaffordable or off-turn play gets the server's
    // refusal, which names why.
    function playToZone(card: CardInstance, zoneId: number) {
      if (!state || !game) return
      if (isMyTurn && drainNeedsChoice(state, mySide, card, game.turn_number)) {
        setDraining({ card, zoneId })
        return
      }
      void send({ type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId })
    }
  ```

- [ ] **Step 10: Docs pointers**

- In `docs/claude/frontend.md`, replace:

  > `- Costs shown to the player use `effectiveCostInGame` (typed over`
  > `  `PublicGameState` precisely so the client can call it).`

  with:

  ```markdown
  - Costs shown to the player use `effectiveCostInGame` (typed over
    `PublicGameState` precisely so the client can call it). The hand and the
    materials tint use `cheapestCostInGame`, which also takes a Drain card's
    discount when the board holds its N (2026-09-23).
  ```

- In `docs/superpowers/specs/2026-09-22-lh-drain-charge-design.md`, insert after line 6 (the paragraph ending "…edited to point here (§9).") a blank line and:

  ```markdown
  > **Superseded in part 2026-09-23.** [2026-09-23-lh-drain-discount-design.md](2026-09-23-lh-drain-discount-design.md)
  > makes Drain an all-or-nothing discount. §2's precondition, the shortfall
  > refusal and "exactly N or refused" no longer hold: a short board pays the
  > printed price. The split rules (§2.1–§2.2) and the dialog's payer rows stand.
  ```

- In `docs/superpowers/specs/2026-09-21-lh-faction-redesign-design.md` §3.3, insert after the existing "Amended 2026-09-22." blockquote a blank line and:

  ```markdown
  > **Amended again 2026-09-23.** [2026-09-23-lh-drain-discount-design.md](2026-09-23-lh-drain-discount-design.md):
  > Drain is a discount, never a gate — drain all N pips for N × 50k off, or pay the printed price.
  ```

- [ ] **Step 11: Sync, run every gate**

```powershell
npm run functions:sync
npx vitest run --maxWorkers=4
npx tsc -p tsconfig.json --noEmit
npm --prefix frontend run build
npm --prefix frontend run lint
```

Expected: every test passes. The count is the baseline + 6. charge.test.ts nets 0: one test deleted, one split in two, the rest replaced. placement.test.ts gains 6: the 8 Drain tests become 11, plus the 3 price tests. tsc and the build are clean, and lint shows no new warnings.

- [ ] **Step 12: Commit**

```powershell
git add shared supabase/functions frontend/src/pages/game/HandBar.tsx frontend/src/pages/game/GameBoardPage.tsx docs
git commit -m "feat(lh): Drain N Charge is an all-or-nothing discount, never a gate - owner request" -m "planDrain returns the discount (N x 50k for all N pips, else full price); both deploy handlers price the play from it; drainedCostInGame, cheapestCostInGame and drainNeedsChoice feed the hand and board. Spec: docs/superpowers/specs/2026-09-23-lh-drain-discount-design.md" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Cathode — Overheat, Fragile only, no duel

**Files:**
- Modify: `shared/engine/stun.ts` (lines 26–32) and `shared/engine/stun.test.ts`
- Modify: `shared/effects/lhEffects.ts` (after `cathodeDuel`, ~line 601; the comment above `duel`)
- Modify: `shared/effects/lhRedesign.test.ts` (imports; the Cathode block at line 234)
- Modify: `frontend/src/pages/game/MiniVehicle.tsx` (line 4, line 80)
- Modify: `shared/ai/llm/rulesPrimer.ts` (line 49) and `shared/ai/llm/rulesPrimer.test.ts`
- Modify: `supabase/seed/source/builtInCards/LH-Built-in.js` (the Cathode row, lines 669–684)
- Modify: `supabase/seed/balance/lh.balance.test.ts` (the `LH:Cathode` pin; the absent-keys list at line 206)
- Modify: `supabase/seed/effectCoverage.test.ts` (`DELIBERATE_ORPHANS` and its sorted list)
- Modify: `docs/superpowers/specs/2026-09-21-lh-faction-redesign-design.md` (lines 50, 271–272, 351)
- Regenerate: `supabase/seed/seed_data.sql`

**Interfaces:**
- Consumes: Task 1's printed Drain phrasing ("Drain 2 Charge: costs 100k less.").
- Produces:
  - `stunHull(game, entry, logLine?: string): void`: the same stamp, with an optional caller's own log line.
  - `stunEndsThisTurn(entry: { stunnedUntilTurn?: number }, turnNumber: number): boolean`
  - The registry id `cathodeOverheat`, fired on `onBattleEffect`.

- [ ] **Step 1: Write the failing stun tests**

In `shared/engine/stun.test.ts`, change line 5 to `import { isStunned, stunEndsThisTurn, stunHull } from './stun.ts'`. Then add inside `describe('stun (2026-09-21 LH spec §3.4)', …)`, after the first test:

```ts
  it('logs a caller’s own line when one is given (Cathode’s Overheat, 2026-09-23)', () => {
    const game = makeGame({ turnNumber: 2 })
    const e = zoneEntry({ instanceId: 'e', name: 'Cathode' })
    stunHull(game, e, 'Cathode overheats — stunned until the end of the next turn')
    expect(e.stunnedUntilTurn).toBe(3)
    expect(game.state.log).toEqual(['Cathode overheats — stunned until the end of the next turn'])
  })

  it('says whether a stun wears off at the end of this turn or the next (the badge’s wording)', () => {
    const e = zoneEntry({ stunnedUntilTurn: 3 })
    expect(stunEndsThisTurn(e, 2)).toBe(false)   // stunned on turn 2: the next turn is still to come
    expect(stunEndsThisTurn(e, 2.5)).toBe(true)  // its last stunned turn
    expect(stunEndsThisTurn(e, 3)).toBe(false)   // no longer stunned
    expect(stunEndsThisTurn(zoneEntry(), 2)).toBe(false)
  })
```

- [ ] **Step 2: Write the failing Overheat tests**

In `shared/effects/lhRedesign.test.ts`, replace lines 2–3 with:

```ts
import {
  applyAction, CATALOG_EFFECTS, chargeOf, discardCard, discardSnapshotOf, findVehicle, fleetAttackRosters,
  holdsStillInFtd, isStunned,
} from '../engine/index.ts'
import type { EngineGame, GameAction, ZoneCardEntry } from '../engine/engineTypes.ts'
```

Rename `describe('Cathode — cathodeDuel', …)` (line 234) to `describe('Cathode — cathodeDuel (dealt snapshots only since 2026-09-23)', …)`, leaving its body unchanged. Then add this block directly after it:

```ts
// 2026-09-23 (docs/superpowers/specs/2026-09-23-lh-drain-discount-design.md §6):
// Cathode no longer duels; every battle it survives stuns it for a turn.
describe('Cathode — cathodeOverheat', () => {
  const cathode = () => zoneEntry({
    instanceId: 'cat', name: 'Cathode', faction: 'LH', vehicleType: 'sub', keywords: ['fragile'],
    meta: { chargeMax: 2, requiresCharge: 2, onBattleEffect: 'cathodeOverheat' },
  })
  const cat = (game: EngineGame) => findVehicle(game.state, 'cat')?.entry as ZoneCardEntry | undefined
  // Alice reports and Bob approves — DECIDE refuses the reporter's own report.
  const resolve = (game: EngineGame, results: Record<string, number>) => {
    const submitted = applyAction(game, 'alice', { type: 'SUBMIT_BATTLE_REPORT', results, repairs: [] }, makeCtx())
    if (!submitted.ok) throw new Error(submitted.error)
    const decided = applyAction(submitted.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true }, makeCtx())
    if (!decided.ok) throw new Error(decided.error)
    return decided.game
  }
  const bobsTurn = () => {
    const game = lhGame()
    game.turnNumber = 4.5
    game.activePlayer = 'bob'
    return game
  }
  const overheated = 'Cathode overheats — stunned until the end of the next turn'

  it('does nothing at lock, then stuns a Cathode that attacked and survived through the enemy turn', () => {
    const game = lhGame() // turn 4, Alice (LH) to act
    game.state.zones[0].cards.a.push(cathode())
    game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'foe' }))
    const declared = applyAction(game, 'alice', { type: 'ATTACK_ENEMY_FLEET', zoneId: 1 }, makeCtx())
    if (!declared.ok) throw new Error(declared.error)
    expect(cat(declared.game)!.stunnedUntilTurn).toBeUndefined()
    const done = resolve(declared.game, { cat: 100, foe: 0 })
    const hull = cat(done)!
    expect(hull.stunnedUntilTurn).toBe(5)
    expect(isStunned(hull, 4.5)).toBe(true)
    expect(holdsStillInFtd(hull, 4.5)).toBe(true) // the enemy's turn: FtD holds the sub still
    expect(isStunned(hull, 5)).toBe(false)        // ready on its owner's next turn
    expect(done.state.log).toContain(overheated)
  })

  it('stuns a Cathode that defended — a draw included — through its owner’s next turn, so it cannot strike back', () => {
    const game = bobsTurn()
    game.state.zones[0].cards.a.push(cathode())
    game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'foe' }), zoneEntry({ instanceId: 'foe2' }))
    const declared = applyAction(game, 'bob', { type: 'ATTACK_ENEMY_FLEET', zoneId: 1 }, makeCtx())
    if (!declared.ok) throw new Error(declared.error)
    const done = resolve(declared.game, { cat: 95, foe: 0, foe2: 100 })
    const hull = cat(done)!
    expect(hull.stunnedUntilTurn).toBe(5.5)
    expect(fleetAttackRosters(done.state, 'a', 1, 5)!.force).toEqual([])
    expect(isStunned(hull, 5.5)).toBe(false)
  })

  it('overheats after a forced 1v1 too — an enemy Eclipse duels it, now that it is not Stealthy', () => {
    const game = bobsTurn()
    game.state.zones[0].cards.a.push(cathode())
    game.state.zones[0].cards.b.push(zoneEntry({
      instanceId: 'ecl', name: 'Eclipse', faction: 'LH', vehicleType: 'hover', keywords: ['stealthy'],
      meta: { chargeMax: 2, onActivate: 'eclipseDuel', activateCpCost: 0, dischargeCost: 2 }, charge: 2,
    }))
    const offered = applyAction(game, 'bob', { type: 'ACTIVATE_VEHICLE', instanceId: 'ecl' } as GameAction, makeCtx())
    if (!offered.ok) throw new Error(offered.error)
    expect(offered.game.state.pendingEffect?.options.map((o) => o.id)).toEqual(['cat'])
    const declared = applyAction(offered.game, 'bob', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'cat' }, makeCtx())
    if (!declared.ok) throw new Error(declared.error)
    const done = resolve(declared.game, { ecl: 0, cat: 100 })
    expect(cat(done)!.stunnedUntilTurn).toBe(5.5)
  })

  it('leaves a Cathode that died alone — nothing overheats', () => {
    const game = lhGame()
    game.state.zones[0].cards.a.push(cathode())
    game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'foe' }))
    const declared = applyAction(game, 'alice', { type: 'ATTACK_ENEMY_FLEET', zoneId: 1 }, makeCtx())
    if (!declared.ok) throw new Error(declared.error)
    const done = resolve(declared.game, { cat: 85, foe: 100 }) // 85%: destroyed — no repair asked, none allowed
    expect(cat(done)).toBeUndefined()
    expect(done.state.log).not.toContain(overheated)
  })
})
```

- [ ] **Step 3: Write the failing seed-side tests**

In `supabase/seed/balance/lh.balance.test.ts`:

- Replace the `'LH:Cathode'` pin with:

  ```ts
    // 2026-09-23 (owner request): it won every fight it was in — submerged, only
    // torpedoes reach it — so Stealthy, Sub Screen and the duel went, Fragile came
    // in, and every battle it survives stuns it for a turn (spec §6).
    'LH:Cathode': {
      materialCost: 600_000, blueprintCost: 726_398, cpCost: 0, keywords: ['fragile'], vehicleType: 'sub',
      cardText: 'Drain 2 Charge: costs 100k less. Overheat: after each battle it fights, it is stunned until the end of the next turn.',
      meta: { chargeMax: 2, requiresCharge: 2, onBattleEffect: 'cathodeOverheat' },
    },
  ```

- In the absent-keys list at line 206, add `'onActivate', 'onBattleEffect'`, so a removed ability cannot linger unpinned:

  ```ts
      for (const key of ['chargeMax', 'chargeRate', 'chargeRelay', 'dischargeCost', 'dischargeFrom', 'requiresCharge', 'deployRequiresLhVehicle', 'ignoresAirScreen', 'activateCpCost', 'onActivate', 'onBattleEffect']) {
  ```

In `supabase/seed/effectCoverage.test.ts`:

- Add to `DELIBERATE_ORPHANS`, after the `umbraSalvo` entry:

  ```ts
    cathodeDuel: '2026-09-23 drain discount: Cathode no longer duels; cathodeOverheat replaced its ability (spec §6)',
  ```

- In the sorted list of the third G4 test, add `'cathodeDuel',` between `'candelaOnPlay',` and `'conduitEffect',`.
- Rename that test to `'the deliberate list matches exactly what the 2026-08-30, 2026-09-02, 2026-09-16, 2026-09-21, 2026-09-22 and 2026-09-23 passes orphaned'`.

In `shared/ai/llm/rulesPrimer.test.ts`, add inside `describe('rules primer', …)`:

```ts
  it('times a stun from the turn it lands, whoever stunned it (2026-09-23 Overheat)', () => {
    expect(PRIMER_TEMPLATE).toContain('until the end of the turn after the one it was stunned in')
    expect(PRIMER_TEMPLATE).not.toContain("until the end of its owner's next turn")
  })
```

- [ ] **Step 4: Run to verify they fail**

Run: `npx vitest run shared/engine/stun.test.ts shared/effects/lhRedesign.test.ts supabase/seed/balance/lh.balance.test.ts supabase/seed/effectCoverage.test.ts shared/ai/llm/rulesPrimer.test.ts`

Expected: FAIL.
- `stunEndsThisTurn` is not exported.
- The Overheat cases fail: no stamp, and no log line.
- The Cathode pin fails on price text, keywords and meta.
- G4's stale-orphan test fails, because `cathodeDuel` is still named by the seed.
- The primer still prints "its owner's next turn".

- [ ] **Step 5: Extend `stun.ts`**

Replace lines 26–32 of `shared/engine/stun.ts` (the comment above `stunHull` and the function) with:

```ts
// Applied + 1.0 on the turn it lands, so it covers exactly the next turn and
// clears when the one after begins. Every LH stun of an ENEMY lands on LH's own
// turn, so that next turn is the enemy's; Cathode's Overheat (2026-09-23) can
// land on either player's turn, and passes its own log line. Re-stunning
// rewrites the stamp. Rounded the way endTurn rounds turnNumber.
export function stunHull(game: EngineGame, entry: ZoneCardEntry, logLine?: string): void {
  entry.stunnedUntilTurn = Math.round((game.turnNumber + STUN_DURATION_TURNS) * 10) / 10
  game.state.log.push(logLine ?? `${entry.name} is stunned — its systems are down until the end of its owner's next turn`)
}

// Whether a stun wears off when the NEXT turn begins — it lasts to the end of
// this one — rather than a turn later: the stun badge's wording (2026-09-23
// spec §4). Turns advance in half steps.
export function stunEndsThisTurn(entry: { stunnedUntilTurn?: number }, turnNumber: number): boolean {
  return isStunned(entry, turnNumber) && (entry.stunnedUntilTurn as number) - turnNumber <= 0.5
}
```

- [ ] **Step 6: Register `cathodeOverheat`**

In `shared/effects/lhEffects.ts`, in the comment above `function duel(` (line 561), replace:

```ts
// `surfaces` is Cathode's (R-18): Stealthy comes off the moment the duel is
// declared, and a refused declaration rolls the whole clone back.
```

with:

```ts
// `surfaces` is Cathode's (R-18; dealt snapshots only since 2026-09-23):
// Stealthy comes off the moment the duel is declared, and a refused
// declaration rolls the whole clone back.
```

Directly after the `registerEffect('cathodeDuel', duel(…))` call (ends ~line 601), insert:

```ts
// 2026-09-23 (docs/superpowers/specs/2026-09-23-lh-drain-discount-design.md §6):
// Cathode — "Overheat: after each battle it fights, it is stunned until the
// end of the next turn." The existing stun, stamped from the battle's own turn:
// after an attack it sits out the enemy's turn (held still in FtD — subs are
// held types), after a defence its owner's next one. Resolve only, survivors
// only, whatever the outcome; lock does nothing. A NEW id: dealt Cathodes keep
// cathodeDuel and never overheat.
registerEffect('cathodeOverheat', ({ game, actor, card, battle }) => {
  if (battle?.phase !== 'resolve' || !battle.survived) return true
  const self = findVehicle(game.state, card.instanceId)
  if (!self || self.side !== actor) return true
  stunHull(game, self.entry as ZoneCardEntry, `${card.name} overheats — stunned until the end of the next turn`)
  return true
})
```

- [ ] **Step 7: Change the Cathode seed row, rebuild the seed**

In `supabase/seed/source/builtInCards/LH-Built-in.js`, replace the Cathode object's `cardText`, `keywords` and `meta` lines with the following. Everything else stays, and the comment goes above `keywords`:

```js
        cardText: 'Drain 2 Charge: costs 100k less. Overheat: after each battle it fights, it is stunned until the end of the next turn.',
```

```js
        // 2026-09-23 (owner request): it won every fight it was in — submerged,
        // only torpedoes reach it — so Stealthy, Sub Screen and the duel went,
        // Fragile came in, and every battle it survives stuns it for a turn.
        keywords: [KEYWORDS.FRAGILE],
        meta: { chargeMax: 2, requiresCharge: 2, [TRIGGERS.ON_BATTLE_EFFECT]: 'cathodeOverheat' },
```

Then:

```powershell
npm run seed:build
```

- [ ] **Step 8: Correct the primer's stun sentence**

In `shared/ai/llm/rulesPrimer.ts`, line 49 becomes:

```ts
- A STUNNED hull cannot attack, move, Block or Screen, and cannot withdraw as Stealthy, until the end of the turn after the one it was stunned in. It still defends.
```

- [ ] **Step 9: Run the task's tests to verify they pass**

Run: `npx vitest run shared/engine/stun.test.ts shared/effects/lhRedesign.test.ts supabase/seed/balance/lh.balance.test.ts supabase/seed/effectCoverage.test.ts shared/ai/llm/rulesPrimer.test.ts`

Expected: PASS.

- [ ] **Step 10: The stun badge says when the stun wears off**

In `frontend/src/pages/game/MiniVehicle.tsx`:

- Line 4 becomes:

  ```tsx
  import { chargeMaxOf, chargeOf, isStunned, stunEndsThisTurn } from '@shared/engine/index'
  ```

- In the stun badge (line 80), replace the static `title="Stunned — cannot attack, move, Block or Screen until the end of its owner's next turn"` with:

  ```tsx
  title={`Stunned — cannot attack, move, Block or Screen until the end of ${stunEndsThisTurn(entry, turnNumber) ? 'this' : 'the next'} turn`}
  ```

- [ ] **Step 11: Spec pointers**

In `docs/superpowers/specs/2026-09-21-lh-faction-redesign-design.md`:

- Line 50: append ` *(2026-09-23: Cathode is neither now — [drain discount spec](2026-09-23-lh-drain-discount-design.md) §6.)*` after "(Cathode)."
- R-18 (lines 271–272): append ` **Superseded 2026-09-23** ([drain discount spec](2026-09-23-lh-drain-discount-design.md) §6): Cathode has no duel and never surfaces; it overheats after every battle it fights.` after "Surfacing on declaration."
- The roster row (line 351) becomes:

  ```markdown
  | Cathode | sub · 600k (726k) | 2 | Fragile | Drain 2 Charge: costs 100k less. Overheat: after each battle it fights, it is stunned until the end of the next turn. (2026-09-23) |
  ```

- [ ] **Step 12: Sync, run every gate, commit**

```powershell
npm run functions:sync
npx vitest run --maxWorkers=4
npx tsc -p tsconfig.json --noEmit
npm --prefix frontend run build
npm --prefix frontend run lint
```

Expected: everything passes. The count is +7 on Task 1's: stun +2, Overheat +4, primer +1.

```powershell
git add shared supabase frontend/src/pages/game/MiniVehicle.tsx docs
git commit -m "feat(lh): Cathode overheats after every battle; Fragile, no Stealthy, Sub Screen or duel - owner request" -m "cathodeOverheat (onBattleEffect, resolve, survivors) reuses stunHull with its own log line; cathodeDuel stays registered for dealt snapshots. Stun badge and primer now time a stun from the turn it lands." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Watt — 120k, no pip on entry

**Files:**
- Modify: `shared/effects/lhEffects.ts` (lines 398–428) and `shared/effects/lhRedesign.test.ts` (the Watt block at line 471)
- Modify: `supabase/seed/source/builtInCards/LH-Built-in.js` (the Watt row, lines 489–511)
- Modify: `supabase/seed/balance/lh.balance.test.ts` (the `LH:Watt` pin), `supabase/seed/effectCoverage.test.ts`
- Modify: `shared/ai/llm/factionNotes.ts` (the LH Watt clause) and `shared/ai/llm/factionNotes.test.ts`
- Modify: `docs/claude/card-effects.md` (347), `docs/superpowers/specs/2026-09-22-lh-hovercraft-design.md` (after line 8), `docs/superpowers/specs/2026-09-21-lh-faction-redesign-design.md` (lines 326, 374, 378–379)
- Regenerate: `supabase/seed/seed_data.sql`

**Interfaces:**
- Produces: the registry id `wattEscortOnPlay` (`needsCatalog`). `wattOnPlay` stays registered with unchanged behaviour.

- [ ] **Step 1: Write the failing tests**

In `shared/effects/lhRedesign.test.ts`, rename `describe('Watt — wattOnPlay and wattDraw', …)` to `describe('Watt — wattOnPlay (dealt snapshots) and wattDraw', …)`, leaving its body unchanged. Add after it:

```ts
// 2026-09-23 (docs/superpowers/specs/2026-09-23-lh-drain-discount-design.md §7):
// the Watt costs 120k and enters with no charge; its Luxon is unchanged.
describe('Watt — wattEscortOnPlay', () => {
  const luxon = () => snap({
    name: 'Luxon', faction: 'LH', vehicleType: 'plane', materialCost: 60000,
    keywords: ['halfCost', 'temporary'], meta: { deployRequiresLhVehicle: true },
  })
  const setup = () => {
    const game = lhGame()
    game.state.resources.a.materials = 150_000
    game.privates.a.hand = [inst({
      instanceId: 'watt', name: 'Watt', faction: 'LH', vehicleType: 'hover', materialCost: 120_000,
      keywords: ['scrappy', 'mobile'],
      meta: { chargeMax: 1, onPlayEffect: 'wattEscortOnPlay', onActivate: 'wattDraw', activateCpCost: 0, dischargeCost: 1 },
    })]
    game.state.counts.a = { hand: 1, deck: 1 }
    return game
  }
  const play = (game: ReturnType<typeof makeGame>, ctx = makeCtx({ catalog: [luxon()] })) =>
    applyAction(game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: 'watt', zoneId: 1 }, ctx)

  it('asks for the catalog, so game-action loads it for a Watt play', () => {
    expect(CATALOG_EFFECTS.has('wattEscortOnPlay')).toBe(true)
  })

  it('lands with no charge and still launches its Decoy Luxon token', () => {
    const res = play(setup())
    if (!res.ok) throw new Error(res.error)
    const [hull, escort] = res.game.state.zones[0].cards.a as ZoneCardEntry[]
    expect(hull.instanceId).toBe('watt')
    expect(chargeOf(hull)).toBe(0)
    expect(escort.name).toBe('Luxon')
    expect(escort.keywords).toEqual(['halfCost', 'decoy'])
    expect(escort.meta.summonOnly).toBe(true)
    expect(res.game.state.log).toContain('Watt launches a Luxon in zone 1 — it has Decoy and stays')
    expect(res.game.state.log).not.toContain('Watt gains 1 charge')
  })

  it('cannot draw the turn it lands — its first pip comes at its owner’s next turn start', () => {
    const res = play(setup())
    if (!res.ok) throw new Error(res.error)
    expect(activate(res.game, 'watt')).toMatchObject({ ok: false, status: 400, error: 'Watt needs 1 charge to discharge' })
  })

  it('fails the play when the catalog has no Luxon, as wattOnPlay does', () => {
    const game = setup()
    expect(play(game, makeCtx())).toMatchObject({ ok: false })
    expect(game.privates.a.hand.map((c) => c.instanceId)).toEqual(['watt'])
  })
})
```

In `supabase/seed/balance/lh.balance.test.ts`, replace the `'LH:Watt'` pin and its comment with:

```ts
  // 2026-09-22 hovercraft amendment: Byte's draw, a Decoy Luxon token, and the
  // Hovercraft type; the Watt itself no longer prints Decoy. 2026-09-23 (owner
  // request): 120k, and it enters with no charge (wattEscortOnPlay).
  'LH:Watt': {
    materialCost: 120_000, blueprintCost: 90_797, cpCost: 0, keywords: ['scrappy', 'mobile'], vehicleType: 'hover',
    cardText: 'When played, a friendly Luxon spawns in this zone. That Luxon has Decoy and is not Temporary. Discharge 1: draw a card.',
    meta: { chargeMax: 1, onPlayEffect: 'wattEscortOnPlay', onActivate: 'wattDraw', activateCpCost: 0, dischargeCost: 1 },
  },
```

In `supabase/seed/effectCoverage.test.ts`:

- Add to `DELIBERATE_ORPHANS`, after `cathodeDuel`:

  ```ts
    wattOnPlay: '2026-09-23 drain discount: the Watt enters with no charge; wattEscortOnPlay replaced it (spec §7)',
  ```

- In the sorted list, add `'wattOnPlay',` after `'victoriaOnDeath',`.

In `shared/ai/llm/factionNotes.test.ts`, add inside `describe('faction notes', …)`:

```ts
  it('says the Watt enters empty and draws from its owner’s next turn (2026-09-23)', () => {
    expect(FACTION_NOTES.LH.text).not.toContain('enters holding a pip')
    expect(FACTION_NOTES.LH.text).toContain("the Watt's first pip arrives at the start of your next turn")
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run shared/effects/lhRedesign.test.ts supabase/seed/balance/lh.balance.test.ts supabase/seed/effectCoverage.test.ts shared/ai/llm/factionNotes.test.ts`

Expected: FAIL.
- `wattEscortOnPlay` is unknown, so the play logs a "plays as vanilla" note and `CATALOG_EFFECTS` lacks it.
- The Watt pin differs.
- G4 reports `wattOnPlay` as stale.
- The notes still say "enters holding a pip".

- [ ] **Step 3: Share the launch, add the new id**

In `shared/effects/lhEffects.ts`, replace lines 398–428 (the comment above `WATT_ESCORT` through the end of `registerEffect('wattOnPlay', …, { needsCatalog: true })`) with:

```ts
// Watt — "When played, a friendly Luxon spawns in this zone. That Luxon has
// Decoy and is not Temporary." (2026-09-22 hovercraft amendment §3; since
// 2026-09-23 it no longer gains a pip on play — drain discount spec §7.)
// Spawning is not playing: no payment, no blind-placement check, no on-play.
// The Decoy is a recorded grant and Temporary a recorded revoke — Extended
// Sortie's path, so the turn-start cull skips it. The Luxon is a TOKEN: stamped
// summonOnly, which discardCard refuses, so a dead one is gone instead of
// filing a free Luxon into the deck. No room in the lane → no Luxon, the room
// rule a card's printed extra copies follow. A catalog without Luxon is a data
// bug and fails the play (spawnVehicles' contract), checked before anything moves.
const WATT_ESCORT = 'Luxon'
function wattLaunch(payload: EffectPayload, pip: number): boolean {
  const { game, actor, card, ctx } = payload
  const escortCard = catalogCard(ctx, WATT_ESCORT)
  if (!escortCard || !poolEligible(escortCard)) return false
  const self = findVehicle(game.state, card.instanceId)
  if (!self || self.side !== actor) return true
  if (pip > 0) gainOwnCharge(payload, pip)
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
}
// Dealt snapshots (before 2026-09-23) name this one, and keep the pip.
registerEffect('wattOnPlay', (payload) => wattLaunch(payload, WATT_PLAY_CHARGE), { needsCatalog: true })
// Since 2026-09-23: the Luxon only — the Watt's first pip comes at its owner's next turn start.
registerEffect('wattEscortOnPlay', (payload) => wattLaunch(payload, 0), { needsCatalog: true })
```

- [ ] **Step 4: Change the Watt seed row, rebuild the seed**

In `LH-Built-in.js`'s Watt object, change:

```js
        cardText: 'When played, a friendly Luxon spawns in this zone. That Luxon has Decoy and is not Temporary. Discharge 1: draw a card.',
        materialCost: 120000,
```

and the `meta` `ON_PLAY` value to `'wattEscortOnPlay'`:

```js
        meta: {
            chargeMax: 1, [TRIGGERS.ON_PLAY]: 'wattEscortOnPlay',
            [TRIGGERS.ON_ACTIVATE]: 'wattDraw', activateCpCost: 0, dischargeCost: 1,
        },
```

Replace the comment above `keywords` ("Byte's draw moved here, …") with:

```js
        // Byte's draw moved here, and the Decoy moved to the permanent Luxon
        // token (R-6 amended). 2026-09-23 (owner request): 120k, and it enters
        // with no charge — wattEscortOnPlay launches the Luxon only.
```

Then run:

```powershell
npm run seed:build
```

- [ ] **Step 5: The bot's Watt advice**

In `shared/ai/llm/factionNotes.ts`, in the LH "Draw keeps your hand full" bullet, replace:

`the Watt enters holding a pip, so discharge it for a card the turn it lands and again each turn it lives,`

with:

`the Watt's first pip arrives at the start of your next turn, so discharge it for a card each turn it lives,`

- [ ] **Step 6: Run the task's tests to verify they pass**

Run: `npx vitest run shared/effects/lhRedesign.test.ts supabase/seed/balance/lh.balance.test.ts supabase/seed/effectCoverage.test.ts shared/ai/llm/factionNotes.test.ts`

Expected: PASS, including the old `wattOnPlay` block, whose pip is unchanged.

- [ ] **Step 7: Docs**

- `docs/claude/card-effects.md` line 347: replace "the Watt's Luxon (`wattOnPlay`, 2026-09-22)" with "the Watt's Luxon (`wattEscortOnPlay` since 2026-09-23; `wattOnPlay` for dealt snapshots)".
- `docs/superpowers/specs/2026-09-22-lh-hovercraft-design.md`: after line 8 (ending "…and **R-13** (Hydrovolt)."), insert a blank line and:

  ```markdown
  > **Amended 2026-09-23.** The Watt costs 120k and enters with no charge; its Luxon is unchanged
  > ([2026-09-23-lh-drain-discount-design.md](2026-09-23-lh-drain-discount-design.md) §7).
  ```

- `docs/superpowers/specs/2026-09-21-lh-faction-redesign-design.md`:
  - The roster Watt row (line 326) becomes:

    ```markdown
    | Watt | hover · 120k (91k) | 1 | Scrappy, Mobile | When played, a friendly Luxon spawns in this zone. That Luxon has Decoy and is not Temporary. Discharge 1: draw a card. (2026-09-23: 120k, enters empty) |
    ```

  - In the curve bullet (line 374), "Watt 90k turn 2" becomes "Watt 120k turn 2".
  - In the charge-timeline bullet (line 378–379), "from 350k of hulls" becomes "from 380k of hulls". The Watt's pip now comes from its turn-3 tick, so the turn-4 total is still 5.

- [ ] **Step 8: Sync, run every gate, commit**

```powershell
npm run functions:sync
npx vitest run --maxWorkers=4
npx tsc -p tsconfig.json --noEmit
```

Expected: everything passes. The count is +5 on Task 2's: Watt +4, notes +1.

```powershell
git add shared supabase docs
git commit -m "feat(lh): Watt costs 120k and enters with no charge - owner request" -m "wattEscortOnPlay launches the Luxon only; wattOnPlay keeps its pip for dealt snapshots (shared wattLaunch)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Drain rows and Drain copy

**Files:**
- Modify: `supabase/seed/source/builtInCards/LH-Built-in.js`: the Dynamo, Thyristor, Quadrupole, Terawatt, Candela and Impedance rows
- Modify: `supabase/seed/balance/lh.balance.test.ts`: six pins and a new describe
- Modify: `frontend/src/lib/keywords.ts` (imports; the Drain row at ~240) and `frontend/src/lib/keywords.test.ts` (line 117)
- Modify: `frontend/src/components/PhysicalCard.tsx` (line 3; the chip tooltip at line 127)
- Modify: `shared/ai/llm/rulesPrimer.ts` (imports, line 48, `PRIMER_VALUES`), `rulesPrimer.test.ts`, `factionNotes.ts` (Drain bullet), `factionNotes.test.ts`, `shared/ai/botDecks.ts` (lines 127–129)
- Modify: `docs/superpowers/specs/2026-09-21-lh-faction-redesign-design.md`: roster rows 340, 343, 350, 353, 354, 356 and the curve bullet
- Regenerate: `supabase/seed/seed_data.sql`

**Interfaces:**
- Consumes: `drainDiscountOf` and `DRAIN_DISCOUNT_PER_CHARGE` (Task 1), and `shortHandNumber` (`@shared/format`).

- [ ] **Step 1: Write the failing tests**

In `supabase/seed/balance/lh.balance.test.ts`:

(a) Add `import { DRAIN_DISCOUNT_PER_CHARGE } from '../../../shared/gameSettings'` below the existing imports.

(b) Replace these six pins:

```ts
  'LH:Dynamo': {
    materialCost: 400_000, blueprintCost: 346_346, cpCost: 0, keywords: ['mobile', 'swift'], vehicleType: 'airship',
    cardText: 'Drain 1 Charge: costs 50k less.', meta: { chargeMax: 1, requiresCharge: 1 },
  },
```

```ts
  'LH:Thyristor': {
    materialCost: 500_000, blueprintCost: 565_250, cpCost: 0, keywords: ['mobile'], vehicleType: 'airship',
    cardText: 'Drain 2 Charge: costs 100k less.', meta: { chargeMax: 2, requiresCharge: 2 },
  },
```

```ts
  // 2026-09-23 (owner request): no Mobile.
  'LH:Quadrupole': {
    materialCost: 660_000, blueprintCost: 685_159, cpCost: 0, keywords: ['blocker'], vehicleType: 'airship',
    cardText: 'Drain 2 Charge: costs 100k less.', meta: { chargeMax: 2, requiresCharge: 2 },
  },
```

```ts
  'LH:Candela': {
    materialCost: 850_000, blueprintCost: 1_021_169, cpCost: 0, keywords: ['blocker', 'subScreen', 'scrappy', 'mobile'], vehicleType: 'ship',
    cardText: 'Drain 3 Charge: costs 150k less.', meta: { chargeMax: 2, requiresCharge: 3 },
  },
```

```ts
  'LH:Impedance': {
    materialCost: 950_000, blueprintCost: 1_326_933, cpCost: 0, keywords: ['blocker'], vehicleType: 'ship',
    cardText: 'Drain 4 Charge: costs 200k less. Discharge 2: deal 400k damage to the enemy base in this zone.',
    meta: { chargeMax: 2, requiresCharge: 4, onActivate: 'impedanceBeam', activateCpCost: 0, dischargeCost: 2 },
  },
```

```ts
  'LH:Terawatt': {
    materialCost: 740_000, blueprintCost: 725_002, cpCost: 0, keywords: ['blocker', 'scrappy', 'mobile'], vehicleType: 'hover',
    cardText: 'Drain 2 Charge: costs 100k less. Generators: this gains 2 charge at the start of your turn instead of 1. Discharge 2: another friendly LH vehicle in this zone gains 2 charge.',
    meta: { chargeMax: 4, chargeRate: 2, requiresCharge: 2, onActivate: 'terawattTransfer', activateCpCost: 0, dischargeCost: 2 },
  },
```

(c) Append at the end of the file:

```ts
// 2026-09-23 (docs/superpowers/specs/2026-09-23-lh-drain-discount-design.md §2, §8):
// Drain is a discount the card text states, so the printed figure is tied to
// the engine's own rate here — a rate change that forgets the texts fails.
describe('LH Drain — a discount the text states', () => {
  it('prints every Drain card’s discount as N × the engine’s rate', async () => {
    const { cards } = await loadSeedData()
    const drains = cards.filter((c) => {
      const meta = (c.meta ?? {}) as Record<string, unknown>
      return c.faction === 'LH' && meta.retired !== true && typeof meta.requiresCharge === 'number'
    })
    expect(drains.map((c) => c.name).sort())
      .toEqual(['Candela', 'Cathode', 'Dynamo', 'Impedance', 'Quadrupole', 'Terawatt', 'Thyristor'])
    for (const c of drains) {
      const n = (c.meta as Record<string, unknown>).requiresCharge as number
      expect(c.cardText, c.name).toMatch(new RegExp(`^Drain ${n} Charge: costs ${(n * DRAIN_DISCOUNT_PER_CHARGE) / 1000}k less\\.`))
    }
  })
})
```

In `frontend/src/lib/keywords.test.ts`, replace the test `'explains Drain as a whole-board cost the player splits as they choose'` (lines 117–125) with:

```ts
  it('explains Drain as an optional whole-board discount of N × 50k, never a gate', () => {
    expect(labels({ chargeMax: 2, requiresCharge: 3 })).toEqual(['Charge 2', 'Drain 3 Charge'])
    const text = body({ requiresCharge: 3 }, 'requiresCharge')
    expect(text).toContain('you may drain exactly 3 charge')
    expect(text).toContain('any mix of them')
    expect(text).toContain('costs 150k less')
    expect(text).toContain('you pay the full price')
    expect(text).toContain('never out of reach')
    expect(text).not.toContain('You need')
  })
```

In `shared/ai/llm/rulesPrimer.test.ts`, add `DRAIN_DISCOUNT_PER_CHARGE` to the `'../../gameSettings'` import, and add inside `describe('rules primer', …)`:

```ts
  it('explains Drain as a discount at the engine’s rate, never a requirement (2026-09-23)', () => {
    const text = renderPrimer('LH')
    expect(text).toContain(`N × ${DRAIN_DISCOUNT_PER_CHARGE} less`)
    expect(text).toContain('never a requirement')
    expect(text).not.toContain('can be played only while')
  })
```

In `shared/ai/llm/factionNotes.test.ts`, add inside `describe('faction notes', …)`:

```ts
  it('describes a Drain capital as always playable, cheaper when drained (2026-09-23)', () => {
    expect(FACTION_NOTES.LH.text).toContain('is always playable')
    expect(FACTION_NOTES.LH.text).not.toContain('needs that many pips')
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run supabase/seed/balance/lh.balance.test.ts frontend/src/lib/keywords.test.ts shared/ai/llm/rulesPrimer.test.ts shared/ai/llm/factionNotes.test.ts`

Expected: FAIL. The six pins differ, the discount-text test catches the old "Drain N Charge." texts, and the Drain row, primer and notes still describe a gate.

- [ ] **Step 3: Change the six seed rows, rebuild the seed**

In `LH-Built-in.js`, change only these fields:

| Row | `cardText` | `materialCost` | Other |
|---|---|---|---|
| Dynamo | `'Drain 1 Charge: costs 50k less.'` | `400000` | — |
| Thyristor | `'Drain 2 Charge: costs 100k less.'` | `500000` | — |
| Quadrupole | `'Drain 2 Charge: costs 100k less.'` | `660000` | `keywords: [KEYWORDS.BLOCKER]` |
| Terawatt | `'Drain 2 Charge: costs 100k less. Generators: this gains 2 charge at the start of your turn instead of 1. Discharge 2: another friendly LH vehicle in this zone gains 2 charge.'` | `740000` | — |
| Candela | `'Drain 3 Charge: costs 150k less.'` | `850000` | — |
| Impedance | `'Drain 4 Charge: costs 200k less. Discharge 2: deal 400k damage to the enemy base in this zone.'` | `950000` | — |

Above the Quadrupole object's `name` line, add:

```js
        // 2026-09-23 (owner request): Drain is a discount — every Drain row prints
        // N × 50k more, so a drained play costs what it did — and Quadrupole
        // loses Mobile.
```

Then run:

```powershell
npm run seed:build
```

- [ ] **Step 4: The card-details row and the chip**

In `frontend/src/lib/keywords.ts`:

- In the `@shared/engine/index` import (lines 2–4), add `drainDiscountOf` after `dischargeFromOf`.
- Below that import, add `import { shortHandNumber } from '@shared/format'`.
- Replace the Drain row block (the `const gate = chargeGateOf(card)` block, ~line 240) with:

```ts
  const gate = chargeGateOf(card)
  if (gate > 0) {
    const off = shortHandNumber(drainDiscountOf(card))
    rows.push({
      key: 'requiresCharge', label: `Drain ${gate} Charge`, icon: drainIcon,
      description:
        `As you play this, you may drain exactly ${gate} charge from the LH vehicles you control — any mix `
        + `of them, in any zone. If you do, it costs ${off} less. Drain nothing and you pay the full price, `
        + 'so it is never out of reach.',
    })
  }
```

In `frontend/src/components/PhysicalCard.tsx`:

- Line 3 becomes:

  ```tsx
  import { chargeGateOf, chargeMaxOf, drainDiscountOf } from '@shared/engine/index'
  ```

- The chip's `title` (line 127) becomes:

  ```tsx
                title={`You may drain ${chargeGate} charge from your LH vehicles as you play this — any mix of them, across your board — to pay ${shortHandNumber(drainDiscountOf({ meta }))} less.`}
  ```

The chip lives in a `.tsx` file, and vitest collects only `*.test.ts`, so no unit test can reach it. Task 7 Step 3's bundle grep ("to pay") and the browser check cover it.

- [ ] **Step 5: The bot's Drain copy**

In `shared/ai/llm/rulesPrimer.ts`:

- Add `DRAIN_DISCOUNT_PER_CHARGE` to the `'../../gameSettings.ts'` import (alphabetical: after `DEFAULT_BASE_HP`).
- Add `DRAIN_DISCOUNT_PER_CHARGE,` to `PRIMER_VALUES` (after `HERO_POWER_DISTANCE_MOD_M,`).
- In line 48, replace the sentence:

  `"Drain N Charge" means the card can be played only while the pips across your whole board total at least N, and playing it spends N of them (taken first from hulls without a Discharge of their own).`

  with:

  `"Drain N Charge: costs Xk less" is a discount, never a requirement: when the pips across your whole board total at least N as you play the card, N of them are drained (taken first from hulls without a Discharge of their own) and it costs N × {{DRAIN_DISCOUNT_PER_CHARGE}} less; with fewer you pay the full printed price.`

In `shared/ai/llm/factionNotes.ts`, in the LH "Cheap pickets" bullet, replace:

`A "Drain N Charge" capital needs that many pips across your board and spends them when you play it, so keep the pickets alive and let them refill between capitals.`

with:

`A "Drain N Charge" capital is always playable: when your board holds its N pips as you play it they are drained and it costs less, otherwise it costs full price, so keep the pickets alive and let them refill between capitals.`

In `shared/ai/botDecks.ts`, lines 128–129 become:

```ts
  // three Blockers, one timer, one beam, and the ability cards the policy
  // aims by trial. No Drain capitals: curated while Drain gated a play, when a
  // greedy bot held them all game. Since 2026-09-23 Drain is a discount and
  // they are always playable — a candidate for the next curation.
```

- [ ] **Step 6: Run the task's tests to verify they pass**

Run: `npx vitest run supabase/seed/balance/lh.balance.test.ts frontend/src/lib/keywords.test.ts shared/ai/llm/rulesPrimer.test.ts shared/ai/llm/factionNotes.test.ts`

Expected: PASS.

- [ ] **Step 7: Roster rows in the redesign spec**

In `docs/superpowers/specs/2026-09-21-lh-faction-redesign-design.md` §5, replace these rows:

```markdown
| Dynamo | airship · 400k (346k) | 1 | Mobile, Swift | Drain 1 Charge: costs 50k less. |
| Thyristor | airship · 500k (565k) | 2 | Mobile | Drain 2 Charge: costs 100k less. (back from the bench, 2026-09-23) |
| Quadrupole | airship · 660k (685k) | 2 | Blocker | Drain 2 Charge: costs 100k less. (2026-09-23: no Mobile) |
| Terawatt | hover · 740k (725k) | 4 | Blocker, Scrappy, Mobile | Drain 2 Charge: costs 100k less. Generators: this gains 2 charge at the start of your turn instead of 1. Discharge 2: another friendly LH vehicle in this zone gains 2 charge. |
| Candela | ship · 850k (1,021k) | 2 | Blocker, Sub Screen, Scrappy, Mobile | Drain 3 Charge: costs 150k less. |
| Impedance | ship · 950k (1,327k) | 2 | Blocker | Drain 4 Charge: costs 200k less. Discharge 2: deal 400k damage to the enemy base in this zone. |
```

At the end of the curve bullet (after "Rectifier (350k to play) turn 5."), append: ` Since 2026-09-23 the Drain capitals print N × 50k more, so these are their drained turns; undrained, each lands a turn or two later (Cathode excepted: 600k printed, 500k drained).`

- [ ] **Step 8: Sync, run every gate, commit**

```powershell
npm run functions:sync
npx vitest run --maxWorkers=4
npx tsc -p tsconfig.json --noEmit
npm --prefix frontend run build
npm --prefix frontend run lint
```

Expected: everything passes. The count is +3 on Task 3's: the discount-text test, the primer test and the notes test. The keywords test is a replacement.

```powershell
git add shared supabase frontend/src/lib frontend/src/components/PhysicalCard.tsx docs
git commit -m "feat(lh): Drain capitals print N x 50k more and say so; Quadrupole loses Mobile - owner request" -m "Dynamo 400k, Thyristor 500k, Quadrupole 660k, Terawatt 740k, Candela 850k, Impedance 950k; a drained play costs what it did. Card-details row, chip tooltip, primer and faction notes describe the discount; a seed test ties each printed figure to DRAIN_DISCOUNT_PER_CHARGE." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Drain dialog — drain or pay full price

**Files:**
- Modify: `frontend/src/pages/game/DrainChargeDialog.tsx` (whole file)

**Interfaces:**
- Consumes: `drainDiscountOf` (Task 1, `charge.ts`); `drainedCostInGame` and `effectiveCostInGame` (`placement.ts`); `shortHandNumber` (`@shared/format`).
- The props are unchanged. `onPlay(split)` sends a split to drain, and `onPlay([])` pays full price. `GameBoardPage` already forwards either as `chargeFrom`.

There is no component-test harness: vitest collects only `*.test.ts`. The dialog's logic is the engine's (tested in Task 1). This task's gates are the build and lint, and the post-merge browser check in Task 7.

- [ ] **Step 1: Rewrite the dialog**

Replace the whole of `frontend/src/pages/game/DrainChargeDialog.tsx` with:

```tsx
import { useState } from 'react'
import { shortHandNumber } from '@shared/format'
import type { CardInstance, PublicGameState } from '@shared/engine/gameInit'
import type { ChargeShare, Side } from '@shared/engine/engineTypes'
import {
  chargeGateOf, chargeOf, chargePayersOf, chargeSplitError, drainDiscountOf, drainedCostInGame,
  effectiveCostInGame, suggestedChargeSplit,
} from '@shared/engine/index'
import { useEscapeToCancel } from '../../components/ConfirmDialog'
import { MiniVehicle } from './MiniVehicle'

// 2026-09-23 Drain as a discount (docs/superpowers/specs/2026-09-23-lh-drain-discount-design.md §4).
// The last step of playing a Drain card when there is a real choice: drain
// exactly N pips — which of my LH hulls give up how much — for N × 50k off, or
// pay the full price and keep every pip. It opens on the engine's suggested
// split and asks the engine's own validator and prices about every change;
// nothing here re-derives a rule (docs/claude/frontend.md, "Never mirror
// engine logic").
export function DrainChargeDialog({
  state, mySide, turnNumber, card, busy, onPlay, onCancel,
}: {
  state: PublicGameState
  mySide: Side
  turnNumber: number
  card: CardInstance
  busy: boolean
  // A split drains; an empty list is the full-price play (`chargeFrom: []`).
  onPlay: (split: ChargeShare[]) => void
  onCancel: () => void
}) {
  const gate = chargeGateOf(card)
  const payers = chargePayersOf(state, mySide)
  const [taken, setTaken] = useState<Record<string, number>>(() =>
    Object.fromEntries((suggestedChargeSplit(state, mySide, gate) ?? []).map((s) => [s.instanceId, s.amount])))
  useEscapeToCancel(true, onCancel)

  const { materials, cp } = state.resources[mySide]
  const affordable = (price: number) => materials >= price && cp >= card.cpCost
  const fullPrice = effectiveCostInGame(state, mySide, card, turnNumber)
  const drainedPrice = drainedCostInGame(state, mySide, card, turnNumber)

  const split: ChargeShare[] = payers
    .filter((p) => (taken[p.entry.instanceId] ?? 0) > 0)
    .map((p) => ({ instanceId: p.entry.instanceId, amount: taken[p.entry.instanceId] }))
  const chosen = split.reduce((sum, s) => sum + s.amount, 0)
  const problem = chargeSplitError(state, mySide, gate, split)
  const step = (instanceId: string, delta: 1 | -1, max: number) =>
    setTaken((cur) => ({ ...cur, [instanceId]: Math.min(max, Math.max(0, (cur[instanceId] ?? 0) + delta)) }))
  const zoneIds = [...new Set(payers.map((p) => p.zoneId))]
  const btn = 'inline-flex min-h-7 min-w-7 items-center justify-center font-bold leading-none disabled:cursor-not-allowed disabled:opacity-30'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ocean-950/80 p-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Drain ${gate} charge for ${card.name}?`}
        className="w-full max-w-2xl rounded-xl border-2 border-brass-400 bg-ocean-900 p-6 shadow-plank"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-2xl">Drain {gate} charge for {card.name}?</h2>
        <p className="mt-1 text-sm text-ocean-300">
          Drain exactly {gate} charge from your LH vehicles and it costs {shortHandNumber(drainDiscountOf(card))} less,
          or pay the full price and keep your charge.
        </p>
        <div className="mt-4 space-y-3">
          {zoneIds.map((zoneId) => (
            <div key={zoneId}>
              <p className="text-sm text-ocean-300">Zone {zoneId}</p>
              <div className="mt-1 flex flex-wrap gap-3">
                {payers.filter((p) => p.zoneId === zoneId).map(({ entry }) => {
                  const n = taken[entry.instanceId] ?? 0
                  const max = chargeOf(entry)
                  return (
                    <div key={entry.instanceId} className="flex flex-col items-center gap-1">
                      <MiniVehicle entry={entry} turnNumber={turnNumber} selected={n > 0} />
                      <span
                        role="group"
                        aria-label={`Charge taken from ${entry.name}`}
                        className="flex items-center gap-1 rounded-full border border-ocean-600 px-1 text-sm"
                      >
                        <button
                          type="button"
                          disabled={n <= 0}
                          aria-label={`Take one less charge from ${entry.name}`}
                          onClick={() => step(entry.instanceId, -1, max)}
                          className={btn}
                        >
                          −
                        </button>
                        <span className="min-w-[1.5ch] text-center font-bold tabular-nums">{n}</span>
                        <button
                          type="button"
                          disabled={n >= max}
                          aria-label={`Take one more charge from ${entry.name}`}
                          onClick={() => step(entry.instanceId, 1, max)}
                          className={btn}
                        >
                          +
                        </button>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        <p className={`mt-4 text-sm font-bold ${chosen === gate ? 'text-ocean-300' : 'text-red-300'}`}>
          {chosen} of {gate} chosen
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {/* Focus moves into the dialog on open, onto Cancel as ConfirmDialog
              does, so the keyboard is not left on the hand behind it. */}
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            className="rounded border border-ocean-600 px-4 py-2 font-bold text-parchment-100"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !affordable(fullPrice)}
            onClick={() => onPlay([])}
            className="rounded border border-brass-400 px-4 py-2 font-bold text-brass-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Pay full price — {shortHandNumber(fullPrice)}
          </button>
          <button
            type="button"
            disabled={busy || problem !== null || !affordable(drainedPrice)}
            onClick={() => onPlay(split)}
            className="rounded bg-brass-400 px-4 py-2 font-bold text-ocean-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Drain and pay {shortHandNumber(drainedPrice)}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Build and lint**

```powershell
npm --prefix frontend run build
npm --prefix frontend run lint
```

Expected: the build is clean, and lint shows no new warnings.

- [ ] **Step 3: Commit**

```powershell
git add frontend/src/pages/game/DrainChargeDialog.tsx
git commit -m "feat(game): Drain dialog offers drain or full price - owner request" -m "Drain and pay (the split, N x 50k off) or Pay full price (chargeFrom []), each enabled only when affordable; prices from drainedCostInGame and effectiveCostInGame." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Gates, whole-branch review, PR

**Files:** none new.

- [ ] **Step 1: Bring the branch up to date with `main`**

```powershell
git fetch origin main
git merge origin/main
```

Open PRs #98 (EMP Torpedo) and #100 (Surge) touch `LH-Built-in.js`, `lh.balance.test.ts`, `seed_data.sql`, `botDecks.ts` and the LH faction notes. If either merged first, the conflicts are adjacent adds: keep both sides. **Never hand-merge `seed_data.sql`**: take either side, then run `npm run seed:build` and stage the regenerated file. If the roster count test (`seeds 31 draftable LH cards`) moved on `main`, keep `main`'s number, because this branch adds no card.

- [ ] **Step 2: Every gate, in full**

```powershell
npm run functions:sync
npx vitest run --maxWorkers=4
npx tsc -p tsconfig.json --noEmit
npm --prefix frontend run build
npm --prefix frontend run lint
npm run functions:check
npm run seed:build
git status --short
git diff main...HEAD | Select-String -Pattern 'service_role|sb_secret|SUPABASE_SERVICE|BEGIN [A-Z ]*PRIVATE KEY|eyJhbGciOi'
```

Expected:
- Every test passes, and the final before → after count is recorded.
- tsc and the build are clean, and lint shows no new warnings.
- `functions:check` passes.
- `seed:build` and `functions:sync` leave `git status` clean.
- The secrets grep prints nothing.

- [ ] **Step 3: Whole-branch review**

Use superpowers:requesting-code-review on `main...HEAD`, against the spec. Fix what it confirms, and re-run Step 2 after any fix.

- [ ] **Step 4: Pre-merge seed diff**

`seed:verify` needs `SUPABASE_ACCESS_TOKEN`, and a worktree has no root `.env.local`. Read it from the main checkout into the environment:

```powershell
$env:SUPABASE_ACCESS_TOKEN = ((Get-Content C:\Users\JFinn\FtDCardGame\.env.local | Select-String '^SUPABASE_ACCESS_TOKEN=').Line -split '=', 2)[1]
npm run seed:verify
```

Expected: exactly eight rows drift — Watt, Dynamo, Thyristor, Quadrupole, Cathode, Terawatt, Candela and Impedance. Any other drift is a question for the owner, not a finding.

- [ ] **Step 5: Push and open the PR (the owner merges)**

Write the PR body to `$bodyPath`, then:

```powershell
$bodyPath = Join-Path $env:TEMP 'lh-drain-discount-pr.md'
git push -u origin claude/card-balance-adjustments-6f80af
gh pr create --base main --title "LH: Drain becomes a discount; Cathode overheats; Watt 120k; Quadrupole loses Mobile" --body-file $bodyPath
```

The PR body covers:
- **Owner rulings:** all-or-nothing Drain at 50k a pip; printed prices rise by N × 50k; Cathode stays at 600k with Fragile only, no duel and Overheat; Watt 120k with no pip on entry; Quadrupole loses Mobile.
- **The price table.**
- **Games in progress** (spec §9): they keep their dealt cards and play by the new rule.
- **The before → after test count.**
- **The post-merge checklist** (Task 7).
- The footer "🤖 Generated with [Claude Code](https://claude.com/claude-code)".

---

### Task 7: After the owner merges

- [ ] **Step 1: The seed job**

```powershell
gh run list --workflow seed-apply.yml --limit 3
npm run seed:verify
```

Expected: the newest run, on the merge commit, is `completed success`, and `seed:verify` reports drift 0.

- [ ] **Step 2: Functions redeployed, read back by content**

Save as `check-functions.mjs` in the session scratchpad (not the repo), and run it with `node` while `SUPABASE_ACCESS_TOKEN` is set as in Task 6 Step 4:

```js
const ref = 'wpgsjnjnvykxavaxibld'
const headers = { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` }
const want = ['cathodeOverheat', 'wattEscortOnPlay', 'DRAIN_DISCOUNT_PER_CHARGE', 'charge for']
for (const slug of ['game-action', 'lobby-action']) {
  const base = `https://api.supabase.com/v1/projects/${ref}/functions/${slug}`
  const meta = await (await fetch(base, { headers })).json()
  const body = await (await fetch(`${base}/body`, { headers })).text()
  console.log(slug, 'version', meta.version, want.map((w) => `${w}:${body.includes(w)}`).join(' '))
}
```

Expected: both versions are above their pre-merge numbers, and every string is `true` for both functions. A lower module count on readback is normal, so verify by content.

- [ ] **Step 3: Netlify**

Save as `check-netlify.mjs` in the scratchpad and run it with `node`:

```js
const site = 'https://ftd-card-game.netlify.app'
const html = await (await fetch(site)).text()
const entry = html.match(/assets\/index-[\w-]+\.js/)[0]
const main = await (await fetch(`${site}/${entry}`)).text()
const chunks = ['PhysicalCard', 'GameBoardPage'].map((c) => main.match(new RegExp(`${c}-[\\w-]+\\.js`))?.[0])
const js = (await Promise.all(chunks.map(async (c) => (c ? (await fetch(`${site}/assets/${c}`)).text() : '')))).join('\n')
const want = ['to pay', 'never out of reach', 'wattEscortOnPlay', 'cathodeOverheat', 'Pay full price']
console.log(chunks, want.map((w) => `${w}:${js.includes(w)}`).join(' '))
```

Expected: both chunks are found and every string is `true`. New effect ids ship in the `PhysicalCard` chunk. If a string is missing, the build was probably skipped: the owner re-runs it, because Netlify can cancel silently.

- [ ] **Step 4: Browser check against the live backend**

Start the `frontend` launch entry and read the bound port from its log. Run `node scripts/qa-login.mjs` in the background, then `await window.__qaLogin()`. In an LH practice game, check:
- A Drain card's hand pill (struck printed price, then the drained price) once the board holds its N.
- The dialog's two actions, each charging what it says (materials before and after).
- A full-price play with too little charge, which sends no dialog.
- The log line "… drains N charge for Xk off — …".
- The Cathode and Watt card details.

- [ ] **Step 5: Owner's FtD test**

Ask the owner to check in FtD whether a stunned Cathode, held still, stays surfaced and can be hit (spec §6, unverified).

- [ ] **Step 6: Record**

Update the memory files: a new entry for this change (PR, versions, checks), and a pointer in `MEMORY.md`. List what is still owed rather than calling it done: the owner's FtD test, and PracticeAI's LH deck curation now that Drain capitals are playable.
