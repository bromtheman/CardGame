import { describe, expect, it } from 'vitest'
import {
  addCharge, applyDrain, boardChargeOf, chargeMaxOf, chargeOf, chargePayersOf,
  chargeSplitError, chargeSplitIsForced, drainDiscountOf, planDrain, spendCharge, suggestedChargeSplit,
  tickCharge,
} from './charge.ts'
import type { ZoneCardEntry } from './engineTypes.ts'
import { discardSnapshotOf } from './gameEngine.ts'
import { applyAction } from './index.ts'
import { makeCtx, makeGame, zoneEntry } from './testFixtures.ts'

const lh = (over: Record<string, unknown> = {}) =>
  zoneEntry({ faction: 'LH', meta: { chargeMax: 2 }, ...over })

describe('charge', () => {
  it('reads 0 for a hull with no stamp and caps at the printed max', () => {
    const e = lh()
    expect(chargeOf(e)).toBe(0)
    expect(chargeMaxOf(e)).toBe(2)
    expect(addCharge(e, 5)).toBe(2)
    expect(chargeOf(e)).toBe(2)
    expect(addCharge(e, 1)).toBe(0)
  })

  it('never charges a hull without chargeMax', () => {
    const e = zoneEntry()
    expect(addCharge(e, 1)).toBe(0)
    expect(e.charge).toBeUndefined()
  })

  it('spends only what it has', () => {
    const e = lh({ charge: 1 })
    expect(spendCharge(e, 2)).toBe(false)
    expect(chargeOf(e)).toBe(1)
    expect(spendCharge(e, 1)).toBe(true)
    expect(chargeOf(e)).toBe(0)
  })

  it('sums LH pips across every lane, and only LH', () => {
    const game = makeGame()
    game.state.zones[0].cards.a.push(lh({ charge: 2 }))
    game.state.zones[2].cards.a.push(lh({ charge: 1 }))
    game.state.zones[1].cards.a.push(zoneEntry({ faction: 'DWG', meta: { chargeMax: 2 }, charge: 2 }))
    game.state.zones[0].cards.b.push(lh({ charge: 2 }))
    expect(boardChargeOf(game.state, 'a')).toBe(3)
  })

  it('ticks at the printed rate, relays once per lane, and leaves the other side alone', () => {
    const game = makeGame()
    const slow = lh({ instanceId: 'slow', meta: { chargeMax: 4 } })
    const fast = lh({ instanceId: 'fast', meta: { chargeMax: 4, chargeRate: 2 } })
    const relayA = zoneEntry({ faction: 'LH', instanceId: 'relayA', meta: { chargeRelay: 1 } })
    const relayB = zoneEntry({ faction: 'LH', instanceId: 'relayB', meta: { chargeRelay: 1 } })
    const theirs = lh({ instanceId: 'theirs' })
    game.state.zones[0].cards.a.push(slow, fast, relayA, relayB)
    game.state.zones[0].cards.b.push(theirs)
    tickCharge(game, 'a')
    expect(chargeOf(slow)).toBe(2)   // 1 tick + 1 relay; two relays do not stack (§3.1.5)
    expect(chargeOf(fast)).toBe(3)   // 2 tick (Generators) + 1 relay
    expect(chargeOf(relayA)).toBe(0) // a relay has no pips of its own
    expect(chargeOf(theirs)).toBe(0)
  })

  it('strips the charge stamp on discard', () => {
    const snap = discardSnapshotOf(lh({ charge: 2 })) as Record<string, unknown>
    expect('charge' in snap).toBe(false)
  })
})

describe('END_TURN charges the incoming side', () => {
  it('after the Temporary cull and before the draw, on that side only', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    const plane = zoneEntry({ instanceId: 'plane', faction: 'LH', keywords: ['temporary'], meta: { chargeMax: 2 } })
    const bobs = zoneEntry({ instanceId: 'bobs', faction: 'LH', meta: { chargeMax: 2 } })
    const mine = zoneEntry({ instanceId: 'mine', faction: 'LH', meta: { chargeMax: 2 } })
    game.state.zones[0].cards.b.push(plane, bobs)
    game.state.zones[0].cards.a.push(mine)
    const res = applyAction(game, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!res.ok) throw new Error(res.error)
    const b = res.game.state.zones[0].cards.b as ZoneCardEntry[]
    expect(b.map((c) => c.instanceId)).toEqual(['bobs'])
    expect(chargeOf(b[0])).toBe(1)
    expect(chargeOf(res.game.state.zones[0].cards.a[0] as ZoneCardEntry)).toBe(0)
  })
})

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
})
