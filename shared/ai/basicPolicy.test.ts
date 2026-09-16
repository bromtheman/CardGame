import { describe, expect, it } from 'vitest'
import type { GameAction } from '../engine/engineTypes'
import { inst, makeGame, zoneEntry } from '../engine/testFixtures'
import { legalZonesFor } from '../engine/index'
import { basicPolicy, zonesByPreference } from './basicPolicy'
import { viewFor } from './botView'

// Deterministic rng: a fixed sequence, so shuffles are stable across runs.
function seq(values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length]
}

// The bot is 'b' (bob) in every fixture, matching the seat it always holds.
function botTurn(over: Parameters<typeof makeGame>[0] = {}) {
  const g = makeGame({ activePlayer: 'bob', turnNumber: 3, ...over })
  return g
}

const types = (actions: GameAction[]) => actions.map((a) => a.type)

describe('zonesByPreference', () => {
  it('ranks a live enemy base before a destroyed one, then lowest HP, then fewest enemy hulls', () => {
    const g = botTurn()
    g.state.zones[0].baseHp.a = 0        // destroyed → last
    g.state.zones[1].baseHp.a = 600
    g.state.zones[2].baseHp.a = 600
    g.state.zones[2].cards.a.push(zoneEntry({}))  // more enemy hulls than zone 2
    const order = zonesByPreference(viewFor(g, 'b', seq([0.1, 0.9, 0.5]))).map((z) => z.id)
    expect(order).toEqual([2, 3, 1])
  })
})

describe('basicPolicy — turn', () => {
  it('plays the most expensive affordable vehicle first, into the preferred legal zone', () => {
    const cheap = inst({ instanceId: 'ship-40', materialCost: 40000 })
    const mid = inst({ instanceId: 'ship-90', materialCost: 90000 })
    const dear = inst({ instanceId: 'ship-200', materialCost: 200000 })
    const g = botTurn({ privates: { a: { hand: [], deck: [] }, b: { hand: [cheap, mid, dear], deck: [] } } })
    g.state.resources.b.materials = 100000
    g.state.zones[0].baseHp.a = 1000
    g.state.zones[1].baseHp.a = 600   // beach: a ship may go here, and it is the weakest live base
    g.state.zones[2].baseHp.a = 300   // land: a ship may NOT go here
    const out = basicPolicy.candidates(viewFor(g, 'b', seq([0.5])), 'turn')
    expect(out[0]).toEqual({ type: 'PLAY_CARD_TO_ZONE', instanceId: 'ship-90', zoneId: 2 })
    expect(out.some((a) => 'instanceId' in a && a.instanceId === 'ship-200')).toBe(false)
    expect(out.some((a) => a.type === 'PLAY_CARD_TO_ZONE' && a.zoneId === 3)).toBe(false)
    expect(out.at(-1)).toEqual({ type: 'END_TURN' })
  })

  it('offers abilities after vehicles, by their trigger key', () => {
    const plain = inst({ instanceId: 'ab-plain', type: 'ability', vehicleType: null, materialCost: 10000 })
    const onZone = inst({ instanceId: 'ab-zone', type: 'ability', vehicleType: null, materialCost: 10000, meta: { playOnZoneEffect: 'x' } })
    const onHull = inst({ instanceId: 'ab-hull', type: 'ability', vehicleType: null, materialCost: 10000, meta: { playOnVehicleEffect: 'x' } })
    const onHand = inst({ instanceId: 'ab-hand', type: 'ability', vehicleType: null, materialCost: 10000, meta: { playOnCardEffect: 'x' } })
    const ship = inst({ instanceId: 'ship-40', materialCost: 40000 })
    const g = botTurn({ privates: { a: { hand: [], deck: [] }, b: { hand: [plain, onZone, onHull, onHand, ship], deck: [] } } })
    g.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'foe-1' }))
    g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'mine-1' }))
    const out = basicPolicy.candidates(viewFor(g, 'b', seq([0.5])), 'turn')
    const firstAbility = out.findIndex((a) => 'instanceId' in a && String(a.instanceId).startsWith('ab-'))
    const lastVehicle = out.map((a) => 'instanceId' in a && a.instanceId === 'ship-40').lastIndexOf(true)
    expect(lastVehicle).toBeLessThan(firstAbility)
    expect(out).toContainEqual({ type: 'PLAY_ABILITY_CARD', instanceId: 'ab-plain' })
    expect(out.filter((a) => a.type === 'PLAY_CARD_TO_ZONE' && a.instanceId === 'ab-zone')).toHaveLength(3)
    const hullTargets = out.filter((a) => a.type === 'PLAY_CARD_TARGETING_CARD_ON_FIELD' && a.instanceId === 'ab-hull')
    expect(hullTargets.map((a) => (a as { targetInstanceId: string }).targetInstanceId).sort()).toEqual(['foe-1', 'mine-1'])
    const handTargets = out.filter((a) => a.type === 'PLAY_CARD_TARGETING_CARD_IN_HAND' && a.instanceId === 'ab-hand')
    expect(handTargets).toHaveLength(4) // every OTHER hand card
    expect(handTargets.some((a) => (a as { targetInstanceId: string }).targetInstanceId === 'ab-hand')).toBe(false)
  })

  it('attacks the base where the enemy base is alive, ahead of the fleet in the same zone', () => {
    const g = botTurn()
    g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'mine-1', materialCost: 200000, playedOnTurn: 2 }))
    g.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'foe-1', materialCost: 100000 }))
    const out = basicPolicy.candidates(viewFor(g, 'b', seq([0.5])), 'turn')
    expect(types(out)).toEqual(['ATTACK_ENEMY_BASE', 'ATTACK_ENEMY_FLEET', 'END_TURN'])
    expect(out[0]).toEqual({ type: 'ATTACK_ENEMY_BASE', zoneId: 1 })
  })

  it('declares a fleet attack only when its non-Inoffensive hulls are at least as costly as the enemy’s', () => {
    const g = botTurn()
    g.state.zones[0].baseHp.a = 0  // no base attack to get in the way
    g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'mine-1', materialCost: 100000, playedOnTurn: 2 }))
    g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'tender', materialCost: 900000, keywords: ['inoffensive'], playedOnTurn: 2 }))
    g.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'foe-1', materialCost: 150000 }))
    expect(types(basicPolicy.candidates(viewFor(g, 'b', seq([0.5])), 'turn'))).toEqual(['END_TURN'])
    g.state.zones[0].cards.a[0].materialCost = 100000
    expect(types(basicPolicy.candidates(viewFor(g, 'b', seq([0.5])), 'turn'))).toEqual(['ATTACK_ENEMY_FLEET', 'END_TURN'])
  })

  it('skips a zone already activated this turn', () => {
    const g = botTurn()
    g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'mine-1', materialCost: 200000, playedOnTurn: 2 }))
    g.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'foe-1', materialCost: 100000 }))
    g.state.zones[0].lastActivatedTurn = 3
    expect(types(basicPolicy.candidates(viewFor(g, 'b', seq([0.5])), 'turn'))).toEqual(['END_TURN'])
  })

  it('ends the turn when there is nothing else to do', () => {
    const g = botTurn()
    expect(basicPolicy.candidates(viewFor(g, 'b', seq([0.5])), 'turn')).toEqual([{ type: 'END_TURN' }])
  })

  it('offers a hand-targeting vehicle plainly as well, so it stays playable with no target', () => {
    const sword = inst({ instanceId: 'sword', materialCost: 40000, meta: { playOnCardEffect: 'x' } })
    const g = botTurn({ privates: { a: { hand: [], deck: [] }, b: { hand: [sword], deck: [] } } })
    const legal = legalZonesFor(g.state, 'b', sword, g.turnNumber)
    const firstZoneId = zonesByPreference(viewFor(g, 'b', seq([0.5]))).find((z) => legal.includes(z.id))!.id

    const out = basicPolicy.candidates(viewFor(g, 'b', seq([0.5])), 'turn')
    expect(out).toContainEqual({ type: 'PLAY_CARD_TO_ZONE', instanceId: 'sword', zoneId: firstZoneId })
    expect(out.some((a) => a.type === 'PLAY_CARD_TARGETING_CARD_IN_HAND')).toBe(false)

    g.privates.b.hand.push(inst({ instanceId: 'other', materialCost: 40000 }))
    const out2 = basicPolicy.candidates(viewFor(g, 'b', seq([0.5])), 'turn')
    const targetedIndex = out2.findIndex((a) =>
      a.type === 'PLAY_CARD_TARGETING_CARD_IN_HAND' && a.instanceId === 'sword' &&
      a.targetInstanceId === 'other' && a.zoneId === firstZoneId)
    const plainIndex = out2.findIndex((a) =>
      a.type === 'PLAY_CARD_TO_ZONE' && a.instanceId === 'sword' && a.zoneId === firstZoneId)
    expect(targetedIndex).toBeGreaterThanOrEqual(0)
    expect(plainIndex).toBeGreaterThanOrEqual(0)
    expect(targetedIndex).toBeLessThan(plainIndex)
  })
})
