# LH "Drain N Charge" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LH's whole-board charge gate a cost. Printed "Drain N Charge" (was "Requires N Charge"), it spends N pips from any mix of the player's LH hulls, split as the player chooses. Every gate drops by 1.

**Architecture:** The payment rules live once, in `shared/engine/charge.ts`: payer list, suggested split, validator, "is it forced?", plan and apply. Both vehicle-deploy handlers in `placement.ts` call `planDrain` before anything moves and `applyDrain` after `pay()`. `PLAY_CARD_TO_ZONE` gains an optional `chargeFrom` split; when it is absent the suggested split pays, which is how PracticeAI plays. The frontend imports the same helpers for a split dialog that opens after the zone pick.

**Tech Stack:** TypeScript strict (shared engine, Deno-compatible `.ts` imports), Vitest, React 19 + Tailwind v4 (frontend), JS seed source → `seed_data.sql`.

**Spec:** `docs/superpowers/specs/2026-09-22-lh-drain-charge-design.md` (amends `docs/superpowers/specs/2026-09-21-lh-faction-redesign-design.md`)

## Global Constraints

- **Shell:** PowerShell syntax for every command, with no `&&`; use `;` or separate calls (CLAUDE.md).
- **CPU:** every Vitest run passes `--maxWorkers=4`. Never `--root`: it silently runs 0 tests. Run one heavy process at a time; the owner's PC overheats.
- **`shared/` commits:** any commit touching `shared/` must include `npm run functions:sync` output (`supabase/functions/*/shared/**`), or `functionSharedSync.test.ts` fails.
- **Imports:** relative imports inside `shared/` carry the `.ts` extension. Frontend code imports engine helpers from `@shared/engine/index`, never from individual modules.
- **Printed name:** "Drain N Charge". The data key stays `meta.requiresCharge`. The attribute row key in `keywords.ts` stays `'requiresCharge'`.
- **Gates:** Dynamo 1, Quadrupole 2, Cathode 2, Terawatt 2, Candela 3, Impedance 4. Material costs unchanged.
- **Log line format:** `<Card> drains <N> charge — <Hull> <k>, <Hull> <k>` (payers in board order).
- **Refusal strings (exact):**
  - `<Card> drains <N> charge — your LH vehicles hold <have>`
  - `<Card> drains no charge`
  - `chargeFrom must be a list of { instanceId, amount }`
  - `Choose exactly <N> charge — you chose <k>`
  - `<Hull> holds only <c> charge`
  - `<Hull> is listed twice`
  - `<Hull> must give up a whole number of charge, at least 1`
  - `That charge source is not one of your LH vehicles on the board`
- **Faction notes:** `factionNotes.ts` prose may contain no digits (`factionNotes.test.ts`).
- **Commit messages** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Drain helpers in the engine

**Files:**
- Modify: `shared/engine/engineTypes.ts` (add `ChargeShare` beside `ZoneCardEntry`'s neighbours, near the top-level type exports)
- Modify: `shared/engine/charge.ts`
- Test: `shared/engine/charge.test.ts`
- Sync: `supabase/functions/*/shared/engine/{charge,engineTypes}.ts` via `npm run functions:sync`

**Interfaces:**
- Produces (all exported from `shared/engine/charge.ts`, re-exported by `engine/index.ts` through its existing `export * from './charge.ts'`):
  - `interface ChargeShare { instanceId: string; amount: number }` (in `engineTypes.ts`)
  - `interface ChargePayer { zoneId: number; entry: ZoneCardEntry }`
  - `chargePayersOf(state: PublicGameState, side: Side): ChargePayer[]`
  - `suggestedChargeSplit(state: PublicGameState, side: Side, amount: number): ChargeShare[] | null`
  - `chargeSplitError(state: PublicGameState, side: Side, amount: number, split: readonly unknown[]): string | null`
  - `chargeSplitIsForced(state: PublicGameState, side: Side, amount: number): boolean`
  - `drainNeedsChoice(state: PublicGameState, side: Side, card: { meta: Record<string, unknown> }): boolean`
  - `type DrainPlan = { split: ChargeShare[] } | { error: string }`
  - `planDrain(state: PublicGameState, side: Side, card: { name: string; meta: Record<string, unknown> }, chargeFrom: unknown): DrainPlan`
  - `applyDrain(game: EngineGame, side: Side, cardName: string, split: readonly ChargeShare[]): void`

- [ ] **Step 1: Record the baseline test count**

Run: `npx vitest run --maxWorkers=4`
Expected: all green. Write down the "Tests N passed" figure; the PR body reports before → after.

- [ ] **Step 2: Write the failing tests**

In `shared/engine/charge.test.ts`, replace the import block at the top:

```ts
import {
  addCharge, boardChargeOf, chargeGateShortfall, chargeMaxOf, chargeOf, spendCharge, tickCharge,
} from './charge.ts'
```

with:

```ts
import {
  addCharge, applyDrain, boardChargeOf, chargeGateShortfall, chargeMaxOf, chargeOf, chargePayersOf,
  chargeSplitError, chargeSplitIsForced, drainNeedsChoice, planDrain, spendCharge, suggestedChargeSplit,
  tickCharge,
} from './charge.ts'
```

and append at the end of the file:

```ts
// 2026-09-22 Drain N Charge (docs/superpowers/specs/2026-09-22-lh-drain-charge-design.md
// §2–§3). Batteries carry no dischargeCost; timers do.
describe('Drain N Charge helpers', () => {
  const battery = (id: string, charge: number) =>
    zoneEntry({ instanceId: id, name: id, faction: 'LH', meta: { chargeMax: 2 }, charge })
  const timer = (id: string, charge: number, cost: number) =>
    zoneEntry({ instanceId: id, name: id, faction: 'LH', meta: { chargeMax: Math.max(cost, 2), dischargeCost: cost }, charge })
  const gated = (gate: number) => ({ name: 'Quadrupole', meta: { requiresCharge: gate } })

  it('lists the side’s charged LH hulls in board order, and nothing else', () => {
    const game = makeGame()
    game.state.zones[1].cards.a.push(battery('z2', 1))
    game.state.zones[0].cards.a.push(battery('z1a', 2), battery('empty', 0), battery('z1b', 1))
    game.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'dwg', faction: 'DWG', meta: { chargeMax: 2 }, charge: 2 }))
    game.state.zones[0].cards.b.push(battery('theirs', 2))
    expect(chargePayersOf(game.state, 'a').map((p) => [p.zoneId, p.entry.instanceId]))
      .toEqual([[1, 'z1a'], [1, 'z1b'], [2, 'z2']])
  })

  it('suggests batteries first, fullest first, ties in board order', () => {
    const game = makeGame()
    game.state.zones[0].cards.a.push(battery('A', 2), battery('C', 1))
    game.state.zones[1].cards.a.push(battery('B', 2), timer('S', 3, 3))
    // A 2→1, then B 2→1, then the three-way tie at 1 goes to A (board order).
    expect(suggestedChargeSplit(game.state, 'a', 3)).toEqual([
      { instanceId: 'A', amount: 2 }, { instanceId: 'B', amount: 1 },
    ])
  })

  it('then drains Discharge hulls, emptiest first, keeping a ready timer ready', () => {
    const game = makeGame()
    game.state.zones[0].cards.a.push(timer('Super', 3, 3), timer('Umbra', 1, 2), battery('K', 1))
    game.state.zones[2].cards.a.push(timer('Byte', 1, 1))
    // K first (a battery); then Umbra and Byte tie at 1 — Umbra in board order — then Byte.
    expect(suggestedChargeSplit(game.state, 'a', 3)).toEqual([
      { instanceId: 'Umbra', amount: 1 }, { instanceId: 'K', amount: 1 }, { instanceId: 'Byte', amount: 1 },
    ])
  })

  it('returns null when the board cannot pay, and an empty split for nothing', () => {
    const game = makeGame()
    game.state.zones[0].cards.a.push(battery('A', 1))
    expect(suggestedChargeSplit(game.state, 'a', 2)).toBeNull()
    expect(suggestedChargeSplit(game.state, 'a', 0)).toEqual([])
  })

  it('names why a split cannot pay, or passes it', () => {
    const game = makeGame()
    game.state.zones[0].cards.a.push(battery('Chrysoprase', 2), battery('Kilowatt', 1))
    game.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'Paddlegun', name: 'Paddlegun', faction: 'DWG', meta: { chargeMax: 2 }, charge: 2 }))
    game.state.zones[0].cards.b.push(battery('Theirs', 2))
    const check = (split: unknown[]) => chargeSplitError(game.state, 'a', 2, split)
    expect(check([{ instanceId: 'Chrysoprase', amount: 1 }, { instanceId: 'Kilowatt', amount: 1 }])).toBeNull()
    expect(check([{ instanceId: 'Chrysoprase', amount: 1 }])).toBe('Choose exactly 2 charge — you chose 1')
    expect(check([{ instanceId: 'Kilowatt', amount: 2 }])).toBe('Kilowatt holds only 1 charge')
    expect(check([{ instanceId: 'Chrysoprase', amount: 1 }, { instanceId: 'Chrysoprase', amount: 1 }]))
      .toBe('Chrysoprase is listed twice')
    expect(check([{ instanceId: 'Chrysoprase', amount: 1.5 }]))
      .toBe('Chrysoprase must give up a whole number of charge, at least 1')
    expect(check([{ instanceId: 'Chrysoprase', amount: 0 }, { instanceId: 'Kilowatt', amount: 1 }]))
      .toBe('Chrysoprase must give up a whole number of charge, at least 1')
    for (const id of ['Theirs', 'Paddlegun', 'ghost']) {
      expect(check([{ instanceId: id, amount: 2 }])).toBe('That charge source is not one of your LH vehicles on the board')
    }
    expect(check([null, 7])).toBe('That charge source is not one of your LH vehicles on the board')
  })

  it('calls a split forced when the board holds exactly the drain, or one hull holds it all', () => {
    const exact = makeGame()
    exact.state.zones[0].cards.a.push(battery('A', 1), battery('B', 1))
    expect(chargeSplitIsForced(exact.state, 'a', 2)).toBe(true)
    const single = makeGame()
    single.state.zones[1].cards.a.push(battery('A', 2), battery('empty', 0))
    expect(chargeSplitIsForced(single.state, 'a', 1)).toBe(true)
    const choice = makeGame()
    choice.state.zones[0].cards.a.push(battery('A', 2), battery('B', 1))
    expect(chargeSplitIsForced(choice.state, 'a', 2)).toBe(false)
  })

  it('opens the dialog only for a gated card the board can pay more than one way', () => {
    const game = makeGame()
    game.state.zones[0].cards.a.push(battery('A', 2), battery('B', 1))
    expect(drainNeedsChoice(game.state, 'a', gated(2))).toBe(true)
    expect(drainNeedsChoice(game.state, 'a', gated(3))).toBe(false) // forced: the board holds exactly 3
    expect(drainNeedsChoice(game.state, 'a', gated(4))).toBe(false) // short: the server refuses with the reason
    expect(drainNeedsChoice(game.state, 'a', { meta: {} })).toBe(false)
  })

  it('plans a drain: the precondition, the suggested split, or the player’s own', () => {
    const game = makeGame()
    game.state.zones[0].cards.a.push(battery('A', 2), battery('B', 1))
    expect(planDrain(game.state, 'a', gated(4), undefined))
      .toEqual({ error: 'Quadrupole drains 4 charge — your LH vehicles hold 3' })
    // A 2→1, then the tie at 1 goes to A (board order).
    expect(planDrain(game.state, 'a', gated(2), undefined)).toEqual({ split: [{ instanceId: 'A', amount: 2 }] })
    const own = [{ instanceId: 'B', amount: 1 }, { instanceId: 'A', amount: 1 }]
    expect(planDrain(game.state, 'a', gated(2), own)).toEqual({ split: own })
    expect(planDrain(game.state, 'a', gated(2), [{ instanceId: 'B', amount: 2 }])).toEqual({ error: 'B holds only 1 charge' })
    expect(planDrain(game.state, 'a', gated(2), 'all of it'))
      .toEqual({ error: 'chargeFrom must be a list of { instanceId, amount }' })
    const plain = { name: 'Kilowatt', meta: {} }
    expect(planDrain(game.state, 'a', plain, undefined)).toEqual({ split: [] })
    expect(planDrain(game.state, 'a', plain, [])).toEqual({ split: [] })
    expect(planDrain(game.state, 'a', plain, [{ instanceId: 'A', amount: 1 }])).toEqual({ error: 'Kilowatt drains no charge' })
  })

  it('spends a split and logs it in board order, never touching an activation', () => {
    const game = makeGame()
    const a = battery('Chrysoprase', 2)
    const b = battery('Kilowatt', 2)
    game.state.zones[0].cards.a.push(a)
    game.state.zones[1].cards.a.push(b)
    applyDrain(game, 'a', 'Quadrupole', [{ instanceId: 'Kilowatt', amount: 1 }, { instanceId: 'Chrysoprase', amount: 2 }])
    expect([chargeOf(a), chargeOf(b)]).toEqual([0, 1])
    expect(game.state.log).toEqual(['Quadrupole drains 3 charge — Chrysoprase 2, Kilowatt 1'])
    expect([a.activatedOnTurn, b.activatedOnTurn]).toEqual([null, null])
    applyDrain(game, 'a', 'Kilowatt', [])
    expect(game.state.log).toHaveLength(1)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run shared/engine/charge.test.ts --maxWorkers=4`
Expected: FAIL. The new imports are not exported yet (`applyDrain is not a function` or similar); the six pre-existing tests still pass.

- [ ] **Step 4: Add the `ChargeShare` type**

In `shared/engine/engineTypes.ts`, directly above `export type GameAction =`, add:

```ts
// 2026-09-22 Drain N Charge (docs/superpowers/specs/2026-09-22-lh-drain-charge-design.md):
// how much one friendly LH hull gives up toward a gated card's play.
export interface ChargeShare { instanceId: string; amount: number }
```

- [ ] **Step 5: Implement the helpers**

In `shared/engine/charge.ts`:

1. Replace the type import line

```ts
import type { EngineGame, Side, ZoneCardEntry } from './engineTypes.ts'
```

with

```ts
import type { ChargeShare, EngineGame, Side, ZoneCardEntry } from './engineTypes.ts'
```

2. Replace the comment above `boardChargeOf`

```ts
// The Requires gate reads the whole board (§3.3). "LH" is faction === 'LH':
// player-made cards are NEUTRAL and never count.
```

with

```ts
// The Drain gate reads the whole board (§3.3; printed "Requires N Charge" until
// 2026-09-22). "LH" is faction === 'LH': player-made cards are NEUTRAL and never count.
```

3. Append at the end of the file:

```ts
// ── 2026-09-22 Drain N Charge (docs/superpowers/specs/2026-09-22-lh-drain-charge-design.md) ──
// A gated card (meta.requiresCharge, printed "Drain N Charge") is paid for in
// pips from any mix of the player's LH hulls. These are the ONE copy of the
// payment rules: both deploy handlers, the split dialog and PracticeAI (which
// always pays the suggested split) import them — nothing re-derives them.

export interface ChargePayer { zoneId: number; entry: ZoneCardEntry }

// The player's LH hulls holding charge, in board order: zones in state.zones
// order, then hulls in zone.cards[side] order — §2.1's tie-break.
export function chargePayersOf(state: PublicGameState, side: Side): ChargePayer[] {
  const out: ChargePayer[] = []
  for (const zone of state.zones) {
    for (const c of zone.cards[side] as ZoneCardEntry[]) {
      if (c.faction === FACTIONS.LH && chargeOf(c) > 0) out.push({ zoneId: zone.id, entry: c })
    }
  }
  return out
}

const ownsDischarge = (entry: ZoneCardEntry): boolean => positiveInt(entry.meta.dischargeCost) !== null

// §2.1, one pip at a time: hulls with no Discharge of their own first, the
// fullest first (a full battery wastes its next tick, so levelling several
// down lets the next tick refill them all); then Discharge hulls, the
// emptiest first (a nearly ready timer stays ready, and one already short is
// drained further before another is touched). Ties in board order. Null when
// the board holds less than `amount`.
export function suggestedChargeSplit(state: PublicGameState, side: Side, amount: number): ChargeShare[] | null {
  const payers = chargePayersOf(state, side)
  const left = payers.map((p) => chargeOf(p.entry))
  if (left.reduce((sum, n) => sum + n, 0) < amount) return null
  const taken = payers.map(() => 0)
  for (let owed = amount; owed > 0; owed--) {
    let pick = -1
    for (let i = 0; i < payers.length; i++) {
      if (left[i] === 0) continue
      if (pick === -1) { pick = i; continue }
      const iTimer = ownsDischarge(payers[i].entry)
      const pickTimer = ownsDischarge(payers[pick].entry)
      if (iTimer !== pickTimer) { if (!iTimer) pick = i; continue }
      if (iTimer ? left[i] < left[pick] : left[i] > left[pick]) pick = i
    }
    left[pick]--
    taken[pick]++
  }
  return payers.flatMap((p, i) => (taken[i] > 0 ? [{ instanceId: p.entry.instanceId, amount: taken[i] }] : []))
}

// Why `split` cannot pay a Drain of `amount` for `side`, or null when it can
// (§3). Typed over unknown[] because it validates a network payload.
export function chargeSplitError(
  state: PublicGameState, side: Side, amount: number, split: readonly unknown[],
): string | null {
  const mine = new Map<string, ZoneCardEntry>()
  for (const zone of state.zones) {
    for (const c of zone.cards[side] as ZoneCardEntry[]) if (c.faction === FACTIONS.LH) mine.set(c.instanceId, c)
  }
  const seen = new Set<string>()
  let total = 0
  for (const raw of split) {
    const share = (raw ?? {}) as Partial<ChargeShare>
    const hull = typeof share.instanceId === 'string' ? mine.get(share.instanceId) : undefined
    if (!hull) return 'That charge source is not one of your LH vehicles on the board'
    if (seen.has(hull.instanceId)) return `${hull.name} is listed twice`
    seen.add(hull.instanceId)
    const n = share.amount
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) {
      return `${hull.name} must give up a whole number of charge, at least 1`
    }
    if (n > chargeOf(hull)) return `${hull.name} holds only ${chargeOf(hull)} charge`
    total += n
  }
  return total === amount ? null : `Choose exactly ${amount} charge — you chose ${total}`
}

// §2.2: no real choice — the board holds exactly `amount`, or one hull holds
// all of the player's charge.
export function chargeSplitIsForced(state: PublicGameState, side: Side, amount: number): boolean {
  const payers = chargePayersOf(state, side)
  return payers.length === 1 || payers.reduce((sum, p) => sum + chargeOf(p.entry), 0) === amount
}

// The split dialog's gate (§4): a gated card the board can pay, more than one way.
export function drainNeedsChoice(state: PublicGameState, side: Side, card: HasMeta): boolean {
  const gate = chargeGateOf(card)
  return gate > 0 && boardChargeOf(state, side) >= gate && !chargeSplitIsForced(state, side, gate)
}

export type DrainPlan = { split: ChargeShare[] } | { error: string }

// Everything a play checks about its Drain, before anything moves (§2, §3):
// the whole-board precondition, then the player's split — or the suggested
// one when the play names none (PracticeAI, a stale client, a forced split).
export function planDrain(
  state: PublicGameState, side: Side, card: HasMeta & { name: string }, chargeFrom: unknown,
): DrainPlan {
  const gate = chargeGateOf(card)
  if (gate === 0) {
    const sent = Array.isArray(chargeFrom) ? chargeFrom.length > 0 : chargeFrom !== undefined
    return sent ? { error: `${card.name} drains no charge` } : { split: [] }
  }
  const shortfall = chargeGateShortfall(state, side, card)
  if (shortfall) return { error: `${card.name} drains ${shortfall.required} charge — your LH vehicles hold ${shortfall.have}` }
  if (chargeFrom === undefined) return { split: suggestedChargeSplit(state, side, gate)! }
  if (!Array.isArray(chargeFrom)) return { error: 'chargeFrom must be a list of { instanceId, amount }' }
  const error = chargeSplitError(state, side, gate, chargeFrom)
  return error ? { error } : { split: chargeFrom as ChargeShare[] }
}

// Spends a split planDrain returned and logs it — public, since every payer
// is on the board. Paying is not an activation: activatedOnTurn is never
// touched, so a payer may still Discharge this turn with what it has left.
export function applyDrain(game: EngineGame, side: Side, cardName: string, split: readonly ChargeShare[]): void {
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
  game.state.log.push(`${cardName} drains ${total} charge — ${parts.join(', ')}`)
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run shared/engine/charge.test.ts --maxWorkers=4`
Expected: PASS (all tests in the file).

- [ ] **Step 7: Sync and commit**

```powershell
npm run functions:sync
git add shared/engine/charge.ts shared/engine/charge.test.ts shared/engine/engineTypes.ts supabase/functions
git commit -m "feat(lh): Drain N Charge payment helpers — payers, suggested split, validator, plan and apply" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Both deploy handlers drain the charge

**Files:**
- Modify: `shared/engine/engineTypes.ts` (the `PLAY_CARD_TO_ZONE` member of `GameAction`)
- Modify: `shared/engine/placement.ts` (import line 16; `PLAY_CARD_TO_ZONE` handler lines 485–515; `PLAY_CARD_TARGETING_CARD_IN_HAND` handler lines 681–691)
- Test: `shared/engine/placement.test.ts` (imports at the top; replace the `describe('Requires N Charge (2026-09-21 LH spec §3.3)'` block at lines 1793–1810)
- Sync: `supabase/functions/*/shared/engine/{placement,engineTypes}.ts`

**Interfaces:**
- Consumes: `planDrain`, `applyDrain`, `chargeOf`, `ChargeShare` (Task 1).
- Produces: `GameAction` member `{ type: 'PLAY_CARD_TO_ZONE'; instanceId: string; zoneId: number; chargeFrom?: ChargeShare[] }`, which Task 5's frontend sends.

- [ ] **Step 1: Write the failing tests**

In `shared/engine/placement.test.ts`, change the imports:

```ts
import { chargeGateShortfall, chargeOf } from './charge.ts'
import type { ZoneCardEntry } from './engineTypes.ts'
```

to

```ts
import { chargeOf } from './charge.ts'
import type { EngineGame, GameAction, ZoneCardEntry } from './engineTypes.ts'
import type { CardInstance } from './gameInit.ts'
```

Then replace the whole block that starts `describe('Requires N Charge (2026-09-21 LH spec §3.3)', () => {` and ends at its closing `})` (just before `describe('dischargeFrom on an ability card`) with:

```ts
describe('Drain N Charge (2026-09-22 spec §2–§3)', () => {
  beforeAll(() => { registerEffect('t_drainHandNoop', () => true) })
  const gated = (over: Partial<CardInstance> = {}) => inst({
    instanceId: 'cap', name: 'Quadrupole', faction: 'LH', materialCost: 40000, meta: { requiresCharge: 2 }, ...over,
  })
  const battery = (id: string, charge: number) =>
    zoneEntry({ instanceId: id, name: id, faction: 'LH', meta: { chargeMax: 2 }, charge })
  const setup = (...cards: CardInstance[]) => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    game.privates.a.hand = cards.length > 0 ? cards : [gated()]
    game.state.counts.a = { hand: game.privates.a.hand.length, deck: 0 }
    return game
  }
  const hull = (game: EngineGame, zoneIndex: number, i: number) => game.state.zones[zoneIndex].cards.a[i] as ZoneCardEntry
  const play = (game: EngineGame, extra: Record<string, unknown> = {}, instanceId = 'cap') =>
    applyAction(game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId, zoneId: 1, ...extra } as GameAction, makeCtx())

  it('refuses the play while the board holds too little, naming both figures', () => {
    const game = setup()
    game.state.zones[2].cards.a.push(battery('Chrysoprase', 1))
    expect(play(game)).toMatchObject({ ok: false, status: 400, error: 'Quadrupole drains 2 charge — your LH vehicles hold 1' })
  })

  it('spends the split the player chose, across lanes, and logs it before the deploy line', () => {
    const game = setup()
    game.state.zones[0].cards.a.push(battery('Chrysoprase', 2))
    game.state.zones[2].cards.a.push(battery('Kilowatt', 2))
    const res = play(game, { chargeFrom: [{ instanceId: 'Kilowatt', amount: 2 }] })
    if (!res.ok) throw new Error(res.error)
    expect(chargeOf(hull(res.game, 0, 0))).toBe(2)
    expect(chargeOf(hull(res.game, 2, 0))).toBe(0)
    const log = res.game.state.log
    expect(log.indexOf('Quadrupole drains 2 charge — Kilowatt 2')).toBeGreaterThanOrEqual(0)
    expect(log.indexOf('Quadrupole drains 2 charge — Kilowatt 2')).toBeLessThan(log.indexOf('Quadrupole deployed to zone 1'))
  })

  it('pays the suggested split when the play names none (PracticeAI, a stale client)', () => {
    const game = setup()
    game.state.zones[0].cards.a.push(zoneEntry({
      instanceId: 'Umbra', name: 'Umbra', faction: 'LH', meta: { chargeMax: 2, dischargeCost: 2 }, charge: 2,
    }))
    game.state.zones[1].cards.a.push(battery('Chrysoprase', 2))
    const res = play(game)
    if (!res.ok) throw new Error(res.error)
    expect(chargeOf(hull(res.game, 0, 0))).toBe(2) // the timer keeps its salvo
    expect(chargeOf(hull(res.game, 1, 0))).toBe(0)
  })

  it('leaves a payer’s activation alone, so it may still discharge this turn', () => {
    const game = setup()
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
      const game = setup()
      game.state.zones[0].cards.a.push(battery('Chrysoprase', 2))
      game.state.zones[0].cards.b.push(battery('Theirs', 2))
      expect(play(game, { chargeFrom })).toMatchObject({ ok: false, status: 400, error })
      expect(chargeOf(hull(game, 0, 0))).toBe(2)
      expect(game.privates.a.hand).toHaveLength(1)
    }
  })

  it('refuses a split sent with a card that drains nothing', () => {
    const game = setup(inst({ instanceId: 'plain', name: 'Kilowatt', faction: 'LH', materialCost: 40000 }))
    game.state.zones[0].cards.a.push(battery('Chrysoprase', 2))
    expect(play(game, { chargeFrom: [{ instanceId: 'Chrysoprase', amount: 1 }] }, 'plain'))
      .toMatchObject({ ok: false, status: 400, error: 'Kilowatt drains no charge' })
  })

  it('makes a second Drain card in the same turn find its own pips', () => {
    const game = setup(gated(), gated({ instanceId: 'cap2' }))
    game.state.zones[0].cards.a.push(battery('Chrysoprase', 2), battery('Kilowatt', 1))
    const first = play(game)
    if (!first.ok) throw new Error(first.error)
    expect(play(first.game, {}, 'cap2'))
      .toMatchObject({ ok: false, status: 400, error: 'Quadrupole drains 2 charge — your LH vehicles hold 1' })
  })

  // No LH card deploys through PLAY_CARD_TARGETING_CARD_IN_HAND; a synthetic
  // one pins that Excalibur's path is not a way around the Drain.
  it('gates and drains a vehicle deployed through Excalibur’s path too', () => {
    const excalibur = () => [
      gated({ meta: { requiresCharge: 2, playOnCardEffect: 't_drainHandNoop' } }),
      inst({ instanceId: 'other' }),
    ]
    const action = { type: 'PLAY_CARD_TARGETING_CARD_IN_HAND', instanceId: 'cap', targetInstanceId: 'other', zoneId: 1 } as GameAction
    const short = setup(...excalibur())
    short.state.zones[0].cards.a.push(battery('Chrysoprase', 1))
    expect(applyAction(short, 'alice', action, makeCtx()))
      .toMatchObject({ ok: false, status: 400, error: 'Quadrupole drains 2 charge — your LH vehicles hold 1' })
    const game = setup(...excalibur())
    game.state.zones[0].cards.a.push(battery('Chrysoprase', 2))
    const res = applyAction(game, 'alice', action, makeCtx())
    if (!res.ok) throw new Error(res.error)
    expect(chargeOf(hull(res.game, 0, 0))).toBe(0)
    expect(res.game.state.log).toContain('Quadrupole drains 2 charge — Chrysoprase 2')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run shared/engine/placement.test.ts --maxWorkers=4`
Expected: FAIL. The new Drain tests fail: the refusal still reads `requires 2 Charge on your board`, pips are not spent, and Excalibur's path is not gated. Everything else passes.

- [ ] **Step 3: Add `chargeFrom` to the action type**

In `shared/engine/engineTypes.ts` replace

```ts
  | { type: 'PLAY_CARD_TO_ZONE'; instanceId: string; zoneId: number }
```

with

```ts
  // chargeFrom (2026-09-22 Drain N Charge): how much each friendly LH hull
  // gives up toward a gated card. Absent pays the suggested split.
  | { type: 'PLAY_CARD_TO_ZONE'; instanceId: string; zoneId: number; chargeFrom?: ChargeShare[] }
```

- [ ] **Step 4: Drain in both handlers**

In `shared/engine/placement.ts`:

1. Replace the import

```ts
import { chargeGateShortfall, chargeOf, dischargeFromOf, spendCharge } from './charge.ts'
```

with

```ts
import { applyDrain, chargeOf, dischargeFromOf, planDrain, spendCharge } from './charge.ts'
```

2. In `PLAY_CARD_TO_ZONE`, replace

```ts
  // 2026-09-21 LH (spec §3.3): a play precondition on the board's pips, read at
  // play time only and never spent. Spawns never come through here (§7.4).
  const shortfall = chargeGateShortfall(game.state, actor, card)
  if (shortfall) {
    return err(400, `${card.name} requires ${shortfall.required} Charge on your board — you have ${shortfall.have}`)
  }
```

with

```ts
  // 2026-09-22 Drain N Charge (docs/superpowers/specs/2026-09-22-lh-drain-charge-design.md
  // §2–§3): the whole-board precondition, then the player's split — or the
  // suggested one when the play names none. Checked here, before anything
  // moves; spent after pay(). Spawns never come through here (spec §7.4).
  const drain = planDrain(game.state, actor, card, action.chargeFrom)
  if ('error' in drain) return err(400, drain.error)
```

and, further down in the same handler, replace

```ts
  takeFromHand(game, actor, action.instanceId)
  pay(game, actor, card)

  const placedInstanceIds = card.type === 'vehicle'
    ? deployVehicle(game, ctx, actor, card, action.zoneId, surged)
    : []
```

with

```ts
  takeFromHand(game, actor, action.instanceId)
  pay(game, actor, card)
  applyDrain(game, actor, card.name, drain.split)

  const placedInstanceIds = card.type === 'vehicle'
    ? deployVehicle(game, ctx, actor, card, action.zoneId, surged)
    : []
```

3. In `PLAY_CARD_TARGETING_CARD_IN_HAND`, replace

```ts
  if (!canAffordInGame(game, actor, card)) return err(400, 'You cannot afford that card')

  if (game.state.alertCard?.instanceId === action.instanceId) game.state.alertCard = null

  // Read the surge before paying — same ordering PLAY_CARD_TO_ZONE relies on,
```

with

```ts
  if (!canAffordInGame(game, actor, card)) return err(400, 'You cannot afford that card')

  // The same Drain as PLAY_CARD_TO_ZONE (2026-09-22 spec §3). No card on this
  // path carries a gate today, and it takes no split: the suggested one pays.
  const drain = planDrain(game.state, actor, card, undefined)
  if ('error' in drain) return err(400, drain.error)

  if (game.state.alertCard?.instanceId === action.instanceId) game.state.alertCard = null

  // Read the surge before paying — same ordering PLAY_CARD_TO_ZONE relies on,
```

and, in the same handler, replace

```ts
  takeFromHand(game, actor, action.instanceId)
  pay(game, actor, card)

  // A vehicle deploys like any other hull; an ability places nothing on the
  // board.
```

with

```ts
  takeFromHand(game, actor, action.instanceId)
  pay(game, actor, card)
  applyDrain(game, actor, card.name, drain.split)

  // A vehicle deploys like any other hull; an ability places nothing on the
  // board.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run shared/engine/placement.test.ts shared/engine/charge.test.ts --maxWorkers=4`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 7: Sync and commit**

```powershell
npm run functions:sync
git add shared/engine/placement.ts shared/engine/placement.test.ts shared/engine/engineTypes.ts supabase/functions
git commit -m "feat(lh): playing a Drain card spends its charge — chosen split or the suggested one" -m "Both vehicle-deploy handlers now plan the Drain before anything moves and spend it after pay(); Excalibur's path, which skipped the gate, is gated too." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Card data — every gate −1, printed "Drain N Charge."

**Files:**
- Test: `supabase/seed/balance/lh.balance.test.ts` (six `CARDS` entries; the gates loop in `'the six new-keyword and gate carriers read as intended'`)
- Modify: `supabase/seed/source/builtInCards/LH-Built-in.js` (Quadrupole, Terawatt, Candela, Dynamo, Cathode, Impedance)
- Modify: `shared/effects/lhRedesign.test.ts` (two inline fixtures that copy Cathode's and Terawatt's meta)
- Regenerate: `supabase/seed/seed_data.sql`

**Interfaces:**
- Consumes: nothing from earlier tasks (data only).
- Produces: the seeded gate values the browser check and the playtest (Task 7) play with.

- [ ] **Step 1: Pin the new values (failing test)**

In `supabase/seed/balance/lh.balance.test.ts`, make these six `CARDS` edits. Only `cardText` and `requiresCharge` change; keep every other field as it is:

| Key | `cardText` becomes | `meta.requiresCharge` becomes |
|---|---|---|
| `'LH:Dynamo'` | `'Drain 1 Charge.'` | `1` |
| `'LH:Quadrupole'` | `'Drain 2 Charge.'` | `2` |
| `'LH:Candela'` | `'Drain 3 Charge.'` | `3` |
| `'LH:Cathode'` | `'Drain 2 Charge. Discharge 2: this vehicle fights a 1v1 against target enemy ship or submarine in this zone, then this surfaces — it loses Stealthy for the rest of the game.'` | `2` |
| `'LH:Impedance'` | `'Drain 4 Charge. Discharge 2: deal 400k damage to the enemy base in this zone.'` | `4` |
| `'LH:Terawatt'` | `'Drain 2 Charge. Generators: this gains 2 charge at the start of your turn instead of 1. Discharge 2: another friendly LH vehicle in this zone gains 2 charge.'` | `2` |

Then replace the gates loop

```ts
    for (const [k, gate] of [['LH:Dynamo', 2], ['LH:Quadrupole', 3], ['LH:Cathode', 3], ['LH:Terawatt', 3], ['LH:Candela', 4], ['LH:Impedance', 5]] as const) {
```

with

```ts
    // Every gate one lower than first printed: draining made it a cost (2026-09-22 spec §6).
    for (const [k, gate] of [['LH:Dynamo', 1], ['LH:Quadrupole', 2], ['LH:Cathode', 2], ['LH:Terawatt', 2], ['LH:Candela', 3], ['LH:Impedance', 4]] as const) {
```

Run: `npx vitest run supabase/seed/balance/lh.balance.test.ts --maxWorkers=4`
Expected: FAIL on the six rows and the gates test.

- [ ] **Step 2: Change the seed source**

In `supabase/seed/source/builtInCards/LH-Built-in.js` make the same six changes:

| Card | `cardText` | `meta` |
|---|---|---|
| Quadrupole | `'Drain 2 Charge.'` | `{ chargeMax: 2, requiresCharge: 2 }` |
| Terawatt | `'Drain 2 Charge. Generators: this gains 2 charge at the start of your turn instead of 1. Discharge 2: another friendly LH vehicle in this zone gains 2 charge.'` | `requiresCharge: 2` (other keys unchanged) |
| Candela | `'Drain 3 Charge.'` | `{ chargeMax: 2, requiresCharge: 3 }` |
| Dynamo | `'Drain 1 Charge.'` | `{ chargeMax: 1, requiresCharge: 1 }` |
| Cathode | `'Drain 2 Charge. Discharge 2: this vehicle fights a 1v1 against target enemy ship or submarine in this zone, then this surfaces — it loses Stealthy for the rest of the game.'` | `requiresCharge: 2` (other keys unchanged) |
| Impedance | `'Drain 4 Charge. Discharge 2: deal 400k damage to the enemy base in this zone.'` | `requiresCharge: 4` (other keys unchanged) |

In `shared/effects/lhRedesign.test.ts`, the two inline fixtures copying Cathode's and Terawatt's meta carry `requiresCharge: 3`. Change both to `requiresCharge: 2` so they stay copies of the real card.

- [ ] **Step 3: Regenerate the SQL and run the seed guards**

```powershell
npm run seed:build
npx vitest run supabase/seed shared/effects/lhRedesign.test.ts --maxWorkers=4
```

Expected: `Wrote 190 cards + … hero powers`, then PASS (including `seedDataSync.test.ts` and `lh.balance.test.ts`).
Then run `git diff --stat supabase/seed/seed_data.sql`; expect exactly the six LH rows changed.

- [ ] **Step 4: Sync and commit**

`shared/effects/lhRedesign.test.ts` is a test file (not in the manifest), so no sync is needed. Run `npm run functions:sync` anyway; it must report no changes.

```powershell
npm run functions:sync
git add supabase/seed/source/builtInCards/LH-Built-in.js supabase/seed/seed_data.sql supabase/seed/balance/lh.balance.test.ts shared/effects/lhRedesign.test.ts
git commit -m "feat(lh): every gate drops by one and prints as Drain N Charge" -m "Dynamo 1, Quadrupole/Cathode/Terawatt 2, Candela 3, Impedance 4 — draining made the gate a cost (2026-09-22 spec §6-§7). Card data applies on merge through seed-apply.yml." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Copy — card details, card face, hand banner, PracticeAI text

**Files:**
- Test: `frontend/src/lib/keywords.test.ts`
- Modify: `frontend/src/lib/keywords.ts:182-231` (comment block and the gate row)
- Modify: `frontend/src/components/PhysicalCard.tsx:122-132` (footer chip)
- Modify: `frontend/src/pages/game/HandBar.tsx:392-396` (banner)
- Modify: `shared/ai/llm/rulesPrimer.ts:48`
- Modify: `shared/ai/llm/factionNotes.ts:36,38` (LH note)
- Modify: `shared/ai/botDecks.ts:129-130` (comment)
- Sync: `supabase/functions/*/shared/ai/**`

**Interfaces:**
- Consumes: `chargeGateOf` (existing).
- Produces: the attribute row `{ key: 'requiresCharge', label: 'Drain N Charge' }`.

- [ ] **Step 1: Update the copy tests (failing)**

In `frontend/src/lib/keywords.test.ts`:

1. In the comment above `describe('chargeAttributesOf'`, replace `Requires` with `Drain`, and the phrase `reads the whole board and spends nothing, Discharge comes from one hull.` with `comes out of any mix of hulls across the whole board, Discharge out of one hull.`
2. Replace the test `it('explains Requires as a whole-board total that is checked, never spent', …)` with:

```ts
  it('explains Drain as a whole-board cost the player splits as they choose', () => {
    expect(labels({ chargeMax: 2, requiresCharge: 3 })).toEqual(['Charge 2', 'Drain 3 Charge'])
    const text = body({ requiresCharge: 3 }, 'requiresCharge')
    expect(text).toContain('drains 3 charge')
    expect(text).toContain('any of them')
    expect(text).toContain('you choose')
    expect(text).toContain('whole board')
    expect(text).not.toContain('does not spend')
  })
```

3. In `'lists every charge rule a single card carries, cap first'`, change the meta to `{ chargeMax: 4, chargeRate: 2, requiresCharge: 2, dischargeCost: 2 }` and the expectation to `['Charge 4', 'Drain 2 Charge', 'Discharge 2']`.
4. In `'slots the charge rules between the vehicle type and the keywords'`, change the expectation to `['Ship', 'Charge 2', 'Drain 3 Charge', 'Blocker']`.

Run: `npx vitest run frontend/src/lib/keywords.test.ts --maxWorkers=4`
Expected: FAIL on the three changed tests.

- [ ] **Step 2: Card-details copy**

In `frontend/src/lib/keywords.ts`, replace the comment block

```ts
// 2026-09-21 LH Charge (spec §3.1–§3.3). Charge is not a keyword — it lives in
// a card’s meta — so these rows are built per card rather than looked up, and
// they are the only place the rules are written down for a player. The two
// worth being pedantic about are the ones the shapes read alike but behave
// oppositely: Requires totals the WHOLE BOARD and spends nothing, while every
// Discharge comes out of ONE hull that must hold the entire cost.
```

with

```ts
// 2026-09-21 LH Charge (spec §3.1–§3.3; Drain since 2026-09-22). Charge is not
// a keyword — it lives in a card’s meta — so these rows are built per card
// rather than looked up, and they are the only place the rules are written
// down for a player. The two worth being pedantic about are the ones the
// shapes read alike but split differently: a Drain comes out of ANY MIX of
// hulls across the whole board, while every Discharge comes out of ONE hull
// that must hold the entire cost.
```

and replace the gate row

```ts
    rows.push({
      key: 'requiresCharge', label: `Requires ${gate} Charge`, icon: spark,
      description:
        `You can only play this while the LH vehicles you control hold ${gate} charge or more in total, `
        + 'added up across your whole board — it does not have to sit on one vehicle or in one zone. '
        + 'Playing it does not spend that charge; the total is only checked as you play. Losing charged '
        + 'vehicles can put this card out of reach again.',
    })
```

with

```ts
    rows.push({
      key: 'requiresCharge', label: `Drain ${gate} Charge`, icon: spark,
      description:
        `Playing this drains ${gate} charge from the LH vehicles you control. Take it from any of them, `
        + 'in any zone — you choose how much each gives up as you play it. You need '
        + `${gate} in total across your whole board, so losing charged vehicles can put this card out of reach.`,
    })
```

- [ ] **Step 3: Card face chip and hand banner**

In `frontend/src/components/PhysicalCard.tsx` replace

```tsx
            <span
              title={`Playable only while your LH vehicles hold ${chargeGate} charge in total across your board. The charge is not spent.`}
              className="rounded bg-ocean-900 px-1.5 py-0.5 font-bold text-parchment-100"
            >
              Requires {chargeGate} Charge
            </span>
```

with

```tsx
            <span
              title={`Playing this drains ${chargeGate} charge from your LH vehicles — any mix of them, across your board.`}
              className="rounded bg-ocean-900 px-1.5 py-0.5 font-bold text-parchment-100"
            >
              Drain {chargeGate} Charge
            </span>
```

In `frontend/src/pages/game/HandBar.tsx` replace

```tsx
                  Requires {gate.required} Charge — you have {gate.have}
```

with

```tsx
                  Drain {gate.required} Charge — you have {gate.have}
```

- [ ] **Step 4: PracticeAI's text**

In `shared/ai/llm/rulesPrimer.ts` (line 48), replace

```
"Requires N Charge" means the card cannot be played until the pips on your whole board add up to N; nothing is spent.
```

with

```
"Drain N Charge" means the card can be played only while the pips on your whole board add up to N, and playing it spends N of them (taken first from hulls without a Discharge of their own).
```

In `shared/ai/llm/factionNotes.ts` (LH note), replace

```
"Requires N Charge" capitals can only be played while your board holds that many pips in total, so keep the pickets alive.
```

with

```
A "Drain N Charge" capital needs that many pips across your board and spends them when you play it, so keep the pickets alive and let them refill between capitals.
```

and replace

```
Fire a full hull rather than holding it unless you are saving pips for a gate.
```

with

```
Fire a full hull rather than holding it unless you are saving its pips for a Drain capital.
```

In `shared/ai/botDecks.ts`, replace

```ts
  // second pick the policy aims by trial. No Requires-4+ capitals — a greedy
  // bot would hold them all game.
```

with

```ts
  // second pick the policy aims by trial. No Drain capitals — a greedy bot
  // would hold them all game.
```

- [ ] **Step 5: Run the affected tests**

Run: `npx vitest run frontend/src/lib/keywords.test.ts shared/ai/llm --maxWorkers=4`
Expected: PASS. That includes `factionNotes.test.ts`'s no-digits and names-verbatim checks and `rulesPrimer.test.ts`'s placeholder check.

- [ ] **Step 6: Sync and commit**

```powershell
npm run functions:sync
git add frontend/src/lib/keywords.ts frontend/src/lib/keywords.test.ts frontend/src/components/PhysicalCard.tsx frontend/src/pages/game/HandBar.tsx shared/ai/llm/rulesPrimer.ts shared/ai/llm/factionNotes.ts shared/ai/botDecks.ts supabase/functions
git commit -m "feat(lh): the game says Drain N Charge everywhere, and says it is spent" -m "Card details, the card-face chip, the hand banner and PracticeAI's primer and LH note." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The split dialog

**Files:**
- Create: `frontend/src/pages/game/DrainChargeDialog.tsx`
- Modify: `frontend/src/pages/game/GameBoardPage.tsx` (import, one `useState`, `cancelAllModes`, new `playToZone`, `onZoneClick`, HandBar prop, dialog mount)
- Modify: `frontend/src/pages/game/HandBar.tsx` (new `onPlayToZone` prop; the one-legal-zone shortcut)

**Interfaces:**
- Consumes: `chargeGateOf`, `chargeOf`, `chargePayersOf`, `chargeSplitError`, `suggestedChargeSplit`, `drainNeedsChoice`, `ChargeShare` (Tasks 1–2), `useEscapeToCancel` (`frontend/src/components/ConfirmDialog.tsx`), `MiniVehicle`.
- Produces: `DrainChargeDialog({ state, mySide, turnNumber, card, busy, onPlay, onCancel })`. HandBar gets the prop `onPlayToZone: (card: CardInstance, zoneId: number) => void`.

There is no component-test harness in this repo (Vitest includes only `*.test.ts`). The dialog's logic is the engine helpers Task 1 already tests. The dialog renders them and adds no rule of its own. It is verified by the frontend build here and in the browser after deploy (Task 8).

- [ ] **Step 1: Create the dialog**

Create `frontend/src/pages/game/DrainChargeDialog.tsx`:

```tsx
import { useState } from 'react'
import type { CardInstance, PublicGameState } from '@shared/engine/gameInit'
import type { ChargeShare, Side } from '@shared/engine/engineTypes'
import { chargeGateOf, chargeOf, chargePayersOf, chargeSplitError, suggestedChargeSplit } from '@shared/engine/index'
import { useEscapeToCancel } from '../../components/ConfirmDialog'
import { MiniVehicle } from './MiniVehicle'

// 2026-09-22 Drain N Charge (docs/superpowers/specs/2026-09-22-lh-drain-charge-design.md §4).
// The last step of playing a Drain card whose split is a real choice: which
// of my LH hulls give up how much. It opens on the engine's suggested split
// and asks the engine's own validator about every change — nothing here
// re-derives a rule (docs/claude/frontend.md, "Never mirror engine logic").
export function DrainChargeDialog({
  state, mySide, turnNumber, card, busy, onPlay, onCancel,
}: {
  state: PublicGameState
  mySide: Side
  turnNumber: number
  card: CardInstance
  busy: boolean
  onPlay: (split: ChargeShare[]) => void
  onCancel: () => void
}) {
  const gate = chargeGateOf(card)
  const payers = chargePayersOf(state, mySide)
  const [taken, setTaken] = useState<Record<string, number>>(() =>
    Object.fromEntries((suggestedChargeSplit(state, mySide, gate) ?? []).map((s) => [s.instanceId, s.amount])))
  useEscapeToCancel(true, onCancel)

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
        aria-label={`Drain ${gate} charge for ${card.name}`}
        className="w-full max-w-2xl rounded-xl border-2 border-brass-400 bg-ocean-900 p-6 shadow-plank"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-2xl">Drain {gate} charge for {card.name}</h2>
        <p className="mt-1 text-sm text-ocean-300">
          Choose which of your LH vehicles give up charge. Nothing is spent unless you play.
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
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-ocean-600 px-4 py-2 font-bold text-parchment-100"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || problem !== null}
            onClick={() => onPlay(split)}
            className="rounded bg-brass-400 px-4 py-2 font-bold text-ocean-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Play {card.name}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Route both plays through GameBoardPage**

In `frontend/src/pages/game/GameBoardPage.tsx`:

1. Change the engine import to add `drainNeedsChoice`:

```ts
import { battleFrozen, biomeAllows, drainNeedsChoice, effectiveCostInGame, effectName, findVehicle, legalZonesFor, zoneCapFor } from '@shared/engine/index'
```

2. Add beside the other game-board imports:

```ts
import { DrainChargeDialog } from './DrainChargeDialog'
```

3. After `const [flankMode, setFlankMode] = useState(false)` add:

```ts
  // 2026-09-22 Drain N Charge: a gated card waiting on its split dialog, with
  // the zone already chosen (spec §4). A board mode like the others.
  const [draining, setDraining] = useState<{ card: CardInstance; zoneId: number } | null>(null)
```

4. In `cancelAllModes`, add `setDraining(null)` after `setFlankMode(false)`.

5. Directly after `cancelAllModes`, add:

```ts
  // Every play of a hand card into a zone — the hand's one-legal-zone
  // shortcut and a zone click alike — comes through here, so a Drain card
  // whose split is a real choice stops at the dialog first (2026-09-22 spec
  // §4). A board that cannot pay sends anyway: the server's refusal names why.
  function playToZone(card: CardInstance, zoneId: number) {
    if (!state) return
    if (drainNeedsChoice(state, mySide, card)) {
      setDraining({ card, zoneId })
      return
    }
    void send({ type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId })
  }
```

6. In `onZoneClick`, replace

```ts
    if (placingCard) {
      void send({ type: 'PLAY_CARD_TO_ZONE', instanceId: placingCard.instanceId, zoneId })
      setPlacingCard(null)
      return
    }
```

with

```ts
    if (placingCard) {
      playToZone(placingCard, zoneId)
      setPlacingCard(null)
      return
    }
```

7. On the `<HandBar` element, add the prop `onPlayToZone={playToZone}` after `onPlacingChange={onPlacingChange}`.

8. Directly before `<ConfirmDialog` (the concede confirmation near the end), add:

```tsx
      {draining && (
        <DrainChargeDialog
          state={state}
          mySide={mySide}
          turnNumber={game.turn_number}
          card={draining.card}
          busy={busy}
          onPlay={(chargeFrom) => {
            void send({ type: 'PLAY_CARD_TO_ZONE', instanceId: draining.card.instanceId, zoneId: draining.zoneId, chargeFrom })
            setDraining(null)
          }}
          onCancel={() => setDraining(null)}
        />
      )}
```

- [ ] **Step 3: HandBar hands vehicle plays to GameBoardPage**

In `frontend/src/pages/game/HandBar.tsx`:

1. In the destructured props, change `placingCard, onPlacingChange,` to `placingCard, onPlacingChange, onPlayToZone,`.
2. In the props type, after `onPlacingChange: (card: CardInstance | null) => void` add:

```ts
  // Every vehicle play into a known zone goes through GameBoardPage, which
  // stops a Drain card at its split dialog first (2026-09-22 spec §4).
  onPlayToZone: (card: CardInstance, zoneId: number) => void
```

3. In `handleVehicleClick`, replace

```ts
      void send({ type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: legalZones[0] })
```

with

```ts
      onPlayToZone(card, legalZones[0])
```

- [ ] **Step 4: Build and lint the frontend**

```powershell
npm --prefix frontend run build
npm --prefix frontend run lint
```

Expected: the build succeeds (TypeScript and Vite), and lint reports no errors.

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/pages/game/DrainChargeDialog.tsx frontend/src/pages/game/GameBoardPage.tsx frontend/src/pages/game/HandBar.tsx
git commit -m "feat(lh): the Drain split dialog — choose which hulls pay, pre-filled with the suggestion" -m "Opens after the zone pick when the split is a real choice; skipped when forced. Both vehicle-play paths route through GameBoardPage.playToZone." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Whole-branch gates

**Files:** none new; this task only verifies.

- [ ] **Step 1: The full suite, capped**

Run: `npx vitest run --maxWorkers=4`
Expected: all green. Record the "Tests N passed" figure next to Task 1's baseline for the PR body.

- [ ] **Step 2: Typecheck, build, lint, function sync and Deno check**

```powershell
npx tsc -p tsconfig.json --noEmit
npm --prefix frontend run build
npm --prefix frontend run lint
npm run functions:sync
git status --short
npm run functions:check
```

Expected: no errors. `git status --short` must show no changes after the sync; if it does, the sync was skipped in an earlier commit, so commit it now. `functions:check` passes for all four functions.

- [ ] **Step 3: Leftover wording**

Run: `git grep -n -i "requires [0-9N] charge" -- shared frontend/src supabase/seed/source`
Expected: no matches. (`supabase/functions` holds synced copies and is covered by the sync.)

---

### Task 7: Headless playtest — two subagents who cannot see each other (spec §8)

**Files (throwaway, in the session scratchpad; never committed):**

`<S>` below means this session's scratchpad,
`C:\Users\JFinn\AppData\Local\Temp\claude\C--Users-JFinn-FtDCardGame--claude-worktrees-balance-pass-changelog-impl-be7649\5d1b4c7c-ef9c-45fb-b98d-1821df6935dd\scratchpad`.
A later session substitutes its own scratchpad.

- Create: `<S>/playtest/referee.ts`
- `<S>/package.json` must exist with `{ "type": "module", "private": true }` (already created earlier this session).

Work in two stages:

1. **Build and smoke-test the referee.**
2. **Run the games.** Run two games at once, `--game g1` (A = LH Drain deck vs B = DWG, seed 11) and `--game g2` (A = SS vs B = LH Drain deck, seed 12). Each game gets two background subagents, one per seat, so four agents in all. Each referee call is a single short process; there is no CPU fan-out.

- [ ] **Step 1: Write the referee**

Create `<S>/playtest/referee.ts`:

```ts
// THROWAWAY playtest referee (docs/superpowers/specs/2026-09-22-lh-drain-charge-design.md §8).
// Runs the worktree's engine in-process for two players who never see each
// other's hand: one CLI per side, state in ./<game>.json beside this file.
// Battles are reported by the strength resolver (as the eval harness does)
// and auto-approved, so neither player is asked about reports.
//
//   npx tsx referee.ts new   --game g1 --seed 11 --a LH --b DWG   (LH plays the Drain deck)
//   npx tsx referee.ts rules --game g1 --side a
//   npx tsx referee.ts wait  --game g1 --side a [--timeout 540]
//   npx tsx referee.ts view  --game g1 --side a
//   npx tsx referee.ts act   --game g1 --side a --move 3
//   npx tsx referee.ts act   --game g1 --side a --json '{"type":"PLAY_CARD_TO_ZONE","instanceId":"i-3","zoneId":2,"chargeFrom":[{"instanceId":"i-9","amount":2}]}'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const WT = 'C:/Users/JFinn/FtDCardGame/.claude/worktrees/balance-pass-changelog-impl-be7649'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const TURN_CAP = 30
const imp = (p: string) => import(pathToFileURL(path.join(WT, p)).href)

const { cardId, loadSeedData } = await imp('supabase/seed/transform.ts')
const E = await imp('shared/engine/index.ts')
const { buildInitialGame } = await imp('shared/engine/gameInit.ts')
const { DEFAULT_LOBBY_SETTINGS } = await imp('shared/lobbySettings.ts')
const { STARTING_TURN_NUMBER } = await imp('shared/gameSettings.ts')
const { mulberry32 } = await imp('shared/ai/seededRng.ts')
const { botOwes } = await imp('shared/ai/botOwes.ts')
const { enumerate } = await imp('shared/ai/llm/moveMenu.ts')
const { describeMenuItem } = await imp('shared/ai/llm/describe.ts')
const { renderPrimer } = await imp('shared/ai/llm/rulesPrimer.ts')
const { reportBattle } = await imp('shared/ai/selfPlayHarness.ts')
const { BOT_DECKS } = await imp('shared/ai/botDecks.ts')

// The LH seat plays every Drain hull (spec §8); any other faction plays PracticeAI's deck.
const LH_DRAIN_DECK: Record<string, number> = {
  'Chrysoprase': 2, 'Byte': 2, 'Volta': 1, 'Conduit': 1, 'Watt': 2, 'Kilowatt': 2,
  'Ampere': 1, 'Megawatt': 1, 'Superradiance': 1, 'EMP Salvo': 1,
  'Dynamo': 1, 'Quadrupole': 1, 'Cathode': 1, 'Terawatt': 1, 'Candela': 1, 'Impedance': 1,
}

type Side = 'a' | 'b'
type Saved = { seed: number; step: number; nextId: number; game: any }
const arg = (name: string, fallback = ''): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback
}
const FILE = path.join(HERE, `${arg('game', 'game')}.json`)
const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const other = (s: Side): Side => (s === 'a' ? 'b' : 'a')
const playerOf = (g: any, s: Side) => (s === 'a' ? g.playerA : g.playerB)

// Windows may refuse a rename or a read while the other seat's process holds
// the file for a moment; retry briefly rather than fail the move.
function retry<T>(fn: () => T): T {
  for (let i = 0; ; i++) {
    try { return fn() } catch (e) { if (i >= 40) throw e; pause(50) }
  }
}
const load = (): Saved => retry(() => JSON.parse(readFileSync(FILE, 'utf8')))
function save(s: Saved) {
  retry(() => writeFileSync(`${FILE}.tmp`, JSON.stringify(s)))
  retry(() => renameSync(`${FILE}.tmp`, FILE))
}

async function catalog() {
  const { cards } = await loadSeedData()
  return cards.filter((c: any) => c.isBuiltIn).map((c: any) => ({
    cardId: cardId(c.faction, c.name), name: c.name, isBuiltIn: true, ownerId: null,
    faction: c.faction, type: c.type, vehicleType: c.vehicleType, blueprintCost: c.blueprintCost,
    materialCost: c.materialCost, cpCost: c.cpCost, cardText: c.cardText ?? '', imageUrl: c.imageUrl ?? '',
    keywords: c.keywords ?? [], meta: (c.meta ?? {}) as Record<string, unknown>,
  }))
}
async function realCtx(s: Saved) {
  return { rng: mulberry32((s.seed * 100_003 + s.step * 7) >>> 0), newId: () => `r-${s.nextId++}`, catalog: await catalog() }
}
async function trialCtx(s: Saved) {
  let n = 0
  return { rng: mulberry32((s.seed * 100_003 + s.step * 7 + 99_991) >>> 0), newId: () => `t-${n++}`, catalog: await catalog() }
}

// The defender "reports" every battle by strength and the other side
// approves it with no repairs — neither agent is asked.
function settle(game: any, ctx: any) {
  for (let guard = 0; guard < 50 && game.status === 'active'; guard++) {
    const st = game.state
    if (st.pendingEffect || st.awaitingResponse) return game
    if (st.activeBattle && !st.pendingReport) {
      const r = E.applyAction(game, playerOf(game, other(st.activeBattle.aggressor)), reportBattle(game, ctx.rng), ctx)
      if (!r.ok) throw new Error(`battle report refused: ${r.error}`)
      game = r.game
      continue
    }
    if (st.pendingReport) {
      const r = E.applyAction(game, playerOf(game, other(st.pendingReport.submittedBy)), { type: 'DECIDE_BATTLE_REPORT', approve: true, repairs: [] }, ctx)
      if (!r.ok) throw new Error(`battle decision refused: ${r.error}`)
      game = r.game
      continue
    }
    return game
  }
  return game
}

async function legalMoves(s: Saved, side: Side) {
  const owed = botOwes(s.game, side)
  if (!owed || owed === 'decision') return []
  const ctx = await trialCtx(s)
  const out: { action: any; text: string }[] = []
  for (const action of enumerate(s.game, side, owed)) {
    let r
    try { r = E.applyAction(s.game, playerOf(s.game, side), action, ctx) } catch { continue }
    if (!r.ok) continue
    out.push({ action, text: describeMenuItem(s.game, r.game, side, action) })
  }
  return out
}

function hullText(c: any, turn: number) {
  const bits = [`${c.name} [${c.instanceId}] ${c.vehicleType}`]
  if (E.chargeMaxOf(c) > 0) bits.push(`charge ${E.chargeOf(c)}/${E.chargeMaxOf(c)}`)
  if (c.keywords.length) bits.push(c.keywords.join(','))
  if (E.isStunned(c, turn)) bits.push('STUNNED')
  if (c.playedOnTurn === turn) bits.push('played this turn')
  if (c.activatedOnTurn === turn) bits.push('activated this turn')
  return bits.join(' · ')
}

async function render(s: Saved, side: Side) {
  const g = s.game
  const st = g.state
  const enemy = other(side)
  const owed = botOwes(g, side)
  const over = g.status !== 'active' || g.turnNumber >= TURN_CAP
  const L: string[] = [`=== Side ${side.toUpperCase()} (${st.factions[side]}) vs ${st.factions[enemy]} — turn ${g.turnNumber} ===`]
  if (g.status !== 'active') L.push(`GAME OVER — ${g.winnerId === playerOf(g, side) ? 'YOU WON' : 'YOU LOST'}`)
  else if (over) L.push(`GAME OVER — the turn cap (${TURN_CAP}) was reached with no winner`)
  else L.push(owed ? `YOUR MOVE (${owed})` : 'Waiting for the opponent.')
  L.push(`You: materials ${st.resources[side].materials}, CP ${st.resources[side].cp}, hero powers used: ${st.usedHeroPowers[side].join(', ') || 'none'}`)
  L.push(`Opponent: ${st.counts[enemy].hand} cards in hand, ${st.counts[enemy].deck} in deck, CP ${st.resources[enemy].cp}`)
  L.push('', 'YOUR HAND:')
  for (const c of g.privates[side].hand) {
    const gate = E.chargeGateOf(c)
    let line = `  - ${c.name} [${c.instanceId}] ${c.type}${c.vehicleType ? `/${c.vehicleType}` : ''}, ${E.effectiveCostInGame(st, side, c, g.turnNumber)} materials${c.cpCost ? ` + ${c.cpCost} CP` : ''}`
    if (c.keywords.length) line += `, ${c.keywords.join(',')}`
    if (E.chargeMaxOf(c) > 0) line += `, charge max ${E.chargeMaxOf(c)}`
    line += ` — ${c.cardText || '(no text)'}`
    if (gate > 0) {
      const split = E.suggestedChargeSplit(st, side, gate)
      line += split
        ? `\n      DRAIN ${gate}: the listed play pays ${split.map((x: any) => `${x.instanceId}×${x.amount}`).join(', ')} — send your own split with --json and "chargeFrom"`
        : `\n      DRAIN ${gate}: your LH hulls hold only ${E.boardChargeOf(st, side)} — not playable yet`
    }
    L.push(line)
  }
  L.push('', 'BOARD:')
  for (const z of st.zones) {
    L.push(`  Zone ${z.id} (${z.biome}) — your base ${z.baseHp[side]} HP, enemy base ${z.baseHp[enemy]} HP${z.lastActivatedTurn === g.turnNumber ? ' — zone already activated this turn' : ''}`)
    L.push(`    yours:  ${z.cards[side].map((c: any) => hullText(c, g.turnNumber)).join(' | ') || '(none)'}`)
    L.push(`    theirs: ${z.cards[enemy].map((c: any) => hullText(c, g.turnNumber)).join(' | ') || '(none)'}`)
  }
  if (st.pendingEffect?.side === side) L.push('', `PENDING CHOICE: ${st.pendingEffect.prompt}`)
  if (st.awaitingResponse && owed === 'response') L.push('', `FLEET ATTACK in zone ${st.awaitingResponse.zoneId} — you may withdraw Stealthy hulls or let them fight`)
  L.push('', 'RECENT LOG:', ...st.log.slice(-12).map((l: string) => `  ${l}`))
  if (owed && !over) {
    L.push('', 'LEGAL MOVES (act --move N):')
    ;(await legalMoves(s, side)).forEach((m, i) => L.push(`  ${i + 1}. ${m.text}`))
  }
  return L.join('\n')
}

const cmd = process.argv[2]
const side = arg('side') as Side
if (cmd === 'new') {
  const seed = Number(arg('seed', '1'))
  const fa = arg('a', 'LH')
  const fb = arg('b', 'DWG')
  const cat = await catalog()
  const byName = new Map(cat.map((c: any) => [`${c.faction}:${c.name}`, c]))
  const snapshots = new Map()
  const deck = (faction: string) => {
    const out: Record<string, number> = {}
    for (const [name, n] of Object.entries(faction === 'LH' ? LH_DRAIN_DECK : BOT_DECKS[faction])) {
      const snap: any = byName.get(`${faction}:${name}`)
      if (!snap) throw new Error(`no ${faction}:${name} in the seed`)
      out[snap.cardId] = n as number
      snapshots.set(snap.cardId, snap)
    }
    return out
  }
  let n = 0
  const built = buildInitialGame({
    gameId: `playtest-${seed}`, playerA: 'alice', playerB: 'bob', settings: { ...DEFAULT_LOBBY_SETTINGS },
    deckA: { cards: deck(fa), snapshots }, deckB: { cards: deck(fb), snapshots },
    factionA: fa, factionB: fb, instanceId: () => `i-${n++}`, rng: mulberry32(seed),
  })
  const game = { ...built.game, status: 'active', winnerId: null, turnNumber: STARTING_TURN_NUMBER, privates: { a: built.aPrivate, b: built.bPrivate } }
  save({ seed, step: 0, nextId: n, game })
  console.log(`New game ${arg('game', 'game')} (seed ${seed}): A=${fa} vs B=${fb}. Side A moves first.`)
} else if (cmd === 'rules') {
  const s = load()
  console.log(renderPrimer(s.game.state.factions[side], 'single'))
  console.log('\nNOTE: ignore any answer-format instructions above. You move only through the referee: `act --move N` or `act --json`.')
} else if (cmd === 'view' || cmd === 'wait') {
  const deadline = Date.now() + Number(arg('timeout', '540')) * 1000
  for (;;) {
    const s = load()
    const over = s.game.status !== 'active' || s.game.turnNumber >= TURN_CAP
    if (cmd === 'view' || over || botOwes(s.game, side)) { console.log(await render(s, side)); break }
    if (Date.now() > deadline) { console.log('Still waiting for the opponent — run wait again.'); break }
    await sleep(2000)
  }
} else if (cmd === 'act') {
  const s = load()
  if (s.game.status !== 'active' || s.game.turnNumber >= TURN_CAP) { console.log('The game is over.'); process.exit(0) }
  if (!botOwes(s.game, side)) { console.log('It is not your move — run wait.'); process.exit(0) }
  let action: any
  if (arg('json')) {
    action = JSON.parse(arg('json'))
  } else {
    const moves = await legalMoves(s, side)
    const k = Number(arg('move'))
    if (!Number.isInteger(k) || k < 1 || k > moves.length) { console.log(`No move ${arg('move')} — choose 1..${moves.length}`); process.exit(0) }
    action = moves[k - 1].action
  }
  const ctx = await realCtx(s)
  const r = E.applyAction(s.game, playerOf(s.game, side), action, ctx)
  if (!r.ok) { console.log(`REFUSED (${r.status}): ${r.error}`); process.exit(0) }
  s.game = settle(r.game, ctx)
  s.step++
  save(s)
  console.log(await render(s, side))
} else {
  console.log('commands: new | rules | view | wait | act   (always pass --game and --side)')
}
```

- [ ] **Step 2: Smoke-test it (one process at a time)**

From the worktree root:

```powershell
$S = "<S>"
npx tsx "$S\playtest\referee.ts" new --game smoke --seed 3 --a LH --b DWG
npx tsx "$S\playtest\referee.ts" view --game smoke --side a
npx tsx "$S\playtest\referee.ts" act --game smoke --side a --move 1
npx tsx "$S\playtest\referee.ts" view --game smoke --side b
```

Expected: A's view lists a hand and numbered legal moves. `act --move 1` prints an updated view. B's view shows B's own hand and never A's. Delete `smoke.json` afterwards.

- [ ] **Step 3: Start both games**

```powershell
npx tsx "$S\playtest\referee.ts" new --game g1 --seed 11 --a LH --b DWG
npx tsx "$S\playtest\referee.ts" new --game g2 --seed 12 --a SS --b LH
```

- [ ] **Step 4: Dispatch four background subagents in one message**

The four seats are g1/a (LH), g1/b (DWG), g2/a (SS) and g2/b (LH), all `general-purpose`, all in the background. Each gets the prompt below with `{GAME}`, `{SIDE}`, `{FACTION}` and `{REFEREE}` filled in (`{REFEREE}` = the absolute path of `referee.ts`). No agent is told anything about the other seat beyond what the game shows.

```text
You are playtesting a turn-based card game — the From The Depths companion card game — as one of its two players. You play side {SIDE} ({FACTION}) in game {GAME}. The other side is played by someone you cannot talk to. A referee program runs the game; you touch it ONLY through these commands, run with the Bash tool from C:/Users/JFinn/FtDCardGame/.claude/worktrees/balance-pass-changelog-impl-be7649:

  npx tsx "{REFEREE}" rules --game {GAME} --side {SIDE}
      The rules, your faction's playstyle notes and your fleet. Read it once, first.
  npx tsx "{REFEREE}" wait --game {GAME} --side {SIDE} --timeout 540
      Blocks until it is your move (set the Bash tool's timeout to 600000), then prints your view:
      your hand, the board, the recent log and a numbered list of LEGAL MOVES.
      If it prints "Still waiting", run it again.
  npx tsx "{REFEREE}" act --game {GAME} --side {SIDE} --move N
      Makes move N from the latest list and prints your updated view. Keep acting until you choose
      END TURN, then go back to wait.
  A card marked DRAIN spends charge from your LH vehicles when played. The listed play pays the
  suggested split; to choose your own, send the move as JSON with "chargeFrom" (the amounts must
  total the Drain exactly), e.g.
  npx tsx "{REFEREE}" act --game {GAME} --side {SIDE} --json '{"type":"PLAY_CARD_TO_ZONE","instanceId":"<card id>","zoneId":2,"chargeFrom":[{"instanceId":"<hull id>","amount":1},{"instanceId":"<hull id>","amount":1}]}'

Ground rules: never pass the other side's letter to any command, and never read the referee's .json files — you know only what your own view shows. Play to win. Keep your thinking short per move; a full game is long. Continue until your view says GAME OVER. If a command fails, retry it once and carry on.

When the game is over, reply with a report under 250 words: who won and on what turn; how the game went in three sentences; then, if you played LH — how many Drain cards you played and on which turns, whether Drain ever held you back, whether choosing the split ever mattered, and any LH card that felt too strong or too weak; if you played against LH — how LH's Drain capitals felt to face. Finally, list anything that looked broken or confusing.
```

- [ ] **Step 5: Collect and summarize**

When all four agents have reported, write a short summary for the owner: each game's result and turn, the LH players' Drain experience, and the opponents' view. List any defect (a refusal that should not happen, a wrong split, a confusing message) as a new fix task before the PR. Then delete `g1.json` and `g2.json`.

---

### Task 8: PR, merge checks, browser check

**Files:** none (git, GitHub, live checks, memory).

- [ ] **Step 1: Push and open the PR**

Before pushing, run the secrets audit (docs/claude/workflow.md): `git diff main --stat`, and check that no `.env*`, `qa-accounts.local` or key-looking strings are staged. Then:

```powershell
git push -u origin claude/lh-charge-consumption-fix-a05a12
gh pr create --title "LH: Requires N Charge becomes Drain N Charge — the gate is now a cost" --body-file <S>\pr-body.md
```

The PR body (written to `<S>\pr-body.md`) covers:
- the rule change and its owner rulings;
- the gate table and the balance probe table (spec §7);
- the before → after test counts;
- the playtest summary;
- "card data applies on merge through seed-apply.yml";
- the post-merge checklist below;
- the attribution line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 2: After the owner merges**

- The `seed-apply.yml` run for the merge commit is green.
- `npm run seed:verify` reports drift 0 (190 cards).
- `game-action` and `lobby-action` versions have incremented and read back **by content**: `suggestedChargeSplit` and `drains no charge` are present.
- The Netlify `PhysicalCard-*.js` chunk at https://ftd-card-game.netlify.app contains `Drain`.

- [ ] **Step 3: Browser check (production, QA account via `scripts/qa-login.mjs`; never type credentials)**

Play a practice game with an LH deck that holds Drain cards against PracticeAI until one is playable. Then confirm each of these:

- The hand banner reads `Drain N Charge — you have K` while short.
- With two or more charged hulls, the dialog opens pre-filled, and a changed split is exactly what drains.
- A forced split sends with no dialog.
- The log reads `<Card> drains N charge — …`.
- The card-details row reads "Drain N Charge".
- `read_console_messages` shows no errors.

- [ ] **Step 4: Memory**

Update `ftd-lh-faction-redesign.md` (Drain replaces "Requires … never spent"; the new gates) and add a memory for this change (PR number, deploy state, playtest findings, the LH-vs-DWG/SS side finding).
