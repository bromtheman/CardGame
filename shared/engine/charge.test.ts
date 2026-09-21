import { describe, expect, it } from 'vitest'
import {
  addCharge, boardChargeOf, chargeGateShortfall, chargeMaxOf, chargeOf, spendCharge, tickCharge,
} from './charge.ts'
import { discardSnapshotOf } from './gameEngine.ts'
import { makeGame, zoneEntry } from './testFixtures.ts'

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

  it('sums LH pips across every lane and reports a gate shortfall', () => {
    const game = makeGame()
    game.state.zones[0].cards.a.push(lh({ charge: 2 }))
    game.state.zones[2].cards.a.push(lh({ charge: 1 }))
    game.state.zones[1].cards.a.push(zoneEntry({ faction: 'DWG', meta: { chargeMax: 2 }, charge: 2 }))
    game.state.zones[0].cards.b.push(lh({ charge: 2 }))
    expect(boardChargeOf(game.state, 'a')).toBe(3)
    expect(chargeGateShortfall(game.state, 'a', { meta: { requiresCharge: 4 } })).toEqual({ required: 4, have: 3 })
    expect(chargeGateShortfall(game.state, 'a', { meta: { requiresCharge: 3 } })).toBeNull()
    expect(chargeGateShortfall(game.state, 'a', { meta: {} })).toBeNull()
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
