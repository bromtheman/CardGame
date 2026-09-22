import { describe, expect, it } from 'vitest'
import type { PublicGameState } from '@shared/engine/gameInit'
import { makeGame, zoneEntry } from '@shared/engine/testFixtures'
import { dischargeHostAvailable } from './dischargeHostAvailable'

// §3.2 / R-20: a discharge-from ability card in hand needs a friendly LH hull
// that still holds the printed cost in charge AND has not already hosted (or
// been activated) this turn — hosting a discharge IS the hull's activation,
// so a second host in one turn is exactly as illegal as a second
// ACTIVATE_VEHICLE (placement.ts's own R-20 stamp).
describe('dischargeHostAvailable', () => {
  const state = (turnNumber = 4) => makeGame({ turnNumber }).state as PublicGameState

  it('is true when a friendly LH hull holds at least the required charge', () => {
    const s = state()
    s.zones[0]!.cards.a.push(zoneEntry({ faction: 'LH', charge: 2 }))
    expect(dischargeHostAvailable(s, 'a', 2, 4)).toBe(true)
  })

  it('is false when nothing on the board has enough charge', () => {
    const s = state()
    s.zones[0]!.cards.a.push(zoneEntry({ faction: 'LH', charge: 1 }))
    expect(dischargeHostAvailable(s, 'a', 2, 4)).toBe(false)
  })

  it('is false when the only charged hull already hosted or activated this turn (R-20)', () => {
    const s = state()
    s.zones[0]!.cards.a.push(zoneEntry({ faction: 'LH', charge: 2, activatedOnTurn: 4 }))
    expect(dischargeHostAvailable(s, 'a', 2, 4)).toBe(false)
  })

  it('ignores a charged non-LH hull and a charged enemy hull', () => {
    const s = state()
    s.zones[0]!.cards.a.push(zoneEntry({ faction: 'DWG', charge: 5 }))
    s.zones[0]!.cards.b.push(zoneEntry({ faction: 'LH', charge: 5 }))
    expect(dischargeHostAvailable(s, 'a', 2, 4)).toBe(false)
  })

  it('finds a host in any zone, not only one in particular', () => {
    const s = state()
    s.zones[2]!.cards.a.push(zoneEntry({ faction: 'LH', charge: 3 }))
    expect(dischargeHostAvailable(s, 'a', 2, 4)).toBe(true)
  })
})
