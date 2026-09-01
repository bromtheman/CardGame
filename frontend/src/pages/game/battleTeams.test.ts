import { describe, expect, it } from 'vitest'
import type { PublicGameState } from '@shared/engine/gameInit'
import type { ZoneCardEntry } from '@shared/engine/engineTypes'
import { makeGame, zoneEntry } from '@shared/engine/testFixtures'
import { CARD_TYPES, KEYWORDS, VEHICLE_TYPES } from '@shared/gameSettings'

import { battleTeams } from './battleTeams'

// Zone 1, side a attacking. Extra hulls are appended to the roster by id, which
// is what decides membership — see battleParticipants.
function battleState(extra: { a?: ZoneCardEntry[]; b?: ZoneCardEntry[]; summons?: ZoneCardEntry[] } = {}) {
  const g = makeGame()
  const raider = zoneEntry({
    name: 'Marauder', faction: 'DWG', vehicleType: VEHICLE_TYPES.SHIP, materialCost: 100_000,
  })
  const bomber = zoneEntry({
    name: 'Monsoon', faction: 'GT', vehicleType: VEHICLE_TYPES.AIRSHIP, materialCost: 60_000,
  })
  const bastion = zoneEntry({
    name: 'Bulwark', faction: 'OW', vehicleType: VEHICLE_TYPES.SHIP, materialCost: 80_000,
  })
  g.state.zones[0]!.cards.a.push(raider, bomber, ...(extra.a ?? []))
  g.state.zones[0]!.cards.b.push(bastion, ...(extra.b ?? []))
  g.state.activeBattle = {
    zoneId: 1,
    aggressor: 'a',
    attackerIds: [raider.instanceId, bomber.instanceId, ...(extra.a ?? []).map((e) => e.instanceId),
      ...(extra.summons ?? []).map((e) => e.instanceId)],
    defenderIds: [bastion.instanceId, ...(extra.b ?? []).map((e) => e.instanceId)],
    distanceM: 1200,
    distanceModifiedBy: [],
    summons: extra.summons ?? [],
    continuation: null,
  }
  return g.state as PublicGameState
}

const namesOf = (cards: { name: string }[]) => cards.map((c) => c.name).sort()

describe('battleTeams', () => {
  it('puts the aggressor first and marks only it the attacker', () => {
    const [attacking, defending] = battleTeams(battleState())
    expect(attacking!.isAttacker).toBe(true)
    expect(defending!.isAttacker).toBe(false)
  })

  it('names each side by its faction and role', () => {
    const [attacking, defending] = battleTeams(battleState())
    expect(attacking!.name).toBe('DWG (attacking)')
    expect(defending!.name).toBe('OW (defending)')
  })

  it('carries each hull name, faction and vehicle type through', () => {
    const [attacking] = battleTeams(battleState())
    expect(attacking!.cards).toContainEqual(
      expect.objectContaining({ name: 'Monsoon', faction: 'GT', vehicleType: VEHICLE_TYPES.AIRSHIP }),
    )
  })

  it('sends the effective material cost, halving a Half Cost hull as the spawn sheet does', () => {
    const state = battleState()
    const [attacking] = battleTeams(state)
    expect(attacking!.cards.find((c) => c.name === 'Marauder')!.materialCost).toBe(100_000)

    const halved = battleState({
      a: [zoneEntry({ name: 'Cheap', materialCost: 90_000, keywords: [KEYWORDS.HALF_COST] })],
    })
    const [withHalfCost] = battleTeams(halved)
    expect(withHalfCost!.cards.find((c) => c.name === 'Cheap')!.materialCost).toBe(45_000)
  })

  it('leaves ability cards out of the fleet', () => {
    const state = battleState({
      a: [zoneEntry({ name: 'Broadside', type: CARD_TYPES.ABILITY, vehicleType: null })],
    })
    const [attacking] = battleTeams(state)
    expect(namesOf(attacking!.cards)).toEqual(['Marauder', 'Monsoon'])
  })

  it('includes a battle summon on the side that brought it', () => {
    const state = battleState({
      summons: [zoneEntry({ name: 'Flying Squirrel', faction: 'DWG', materialCost: 10_000 })],
    })
    const [attacking] = battleTeams(state)
    expect(namesOf(attacking!.cards)).toEqual(['Flying Squirrel', 'Marauder', 'Monsoon'])
  })
})
