import { describe, expect, it } from 'vitest'
import { applyAction } from './index'
import { makeGame, snap, zoneEntry } from './testFixtures'

describe('USE_HERO_POWER', () => {
  it('salvage returns a destroyed vehicle to hand, once per game, 1cp', () => {
    const g = makeGame()
    const dead = snap({ name: 'Sunken Raider' })
    g.state.destroyed.a.push(dead)
    const r = applyAction(g, 'alice', { type: 'USE_HERO_POWER', power: 'salvage', cardId: dead.cardId })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.a.hand.map((c) => c.name)).toEqual(['Sunken Raider'])
    expect(r.game.state.destroyed.a).toHaveLength(0)
    expect(r.game.state.resources.a.cp).toBe(2)
    expect(r.game.state.usedHeroPowers.a).toEqual(['salvage'])
    expect(applyAction(r.game, 'alice', { type: 'USE_HERO_POWER', power: 'salvage', cardId: dead.cardId }))
      .toMatchObject({ ok: false, status: 400 }) // once per game
  })
  it('draw draws; blocked without cp', () => {
    const g = makeGame()
    g.privates.a.deck = [/* one card */ { ...snap(), instanceId: 'd1' }]
    g.state.counts.a.deck = 1
    g.state.resources.a.cp = 0
    expect(applyAction(g, 'alice', { type: 'USE_HERO_POWER', power: 'draw' }))
      .toMatchObject({ ok: false, status: 400 })
    g.state.resources.a.cp = 1
    const r = applyAction(g, 'alice', { type: 'USE_HERO_POWER', power: 'draw' })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.a.hand).toHaveLength(1)
  })
  it('tacticalPositioning is per-player: each side may shift the same battle once', () => {
    const g = makeGame()
    g.state.activeBattle = {
      zoneId: 1, aggressor: 'a', attackerIds: ['x'], defenderIds: ['y'],
      distanceM: 1200, distanceModifiedBy: [],
    }
    const r = applyAction(g, 'bob', {
      type: 'USE_HERO_POWER', power: 'tacticalPositioning', distanceDeltaM: -600,
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.activeBattle!.distanceM).toBe(600)
    expect(r.game.state.activeBattle!.distanceModifiedBy).toEqual(['b'])
    // the OTHER player may counter with their own once-per-game power
    const r2 = applyAction(r.game, 'alice', {
      type: 'USE_HERO_POWER', power: 'tacticalPositioning', distanceDeltaM: 100,
    })
    if (!r2.ok) throw new Error(r2.error)
    expect(r2.game.state.activeBattle!.distanceM).toBe(700)
    expect(r2.game.state.activeBattle!.distanceModifiedBy).toEqual(['b', 'a'])
    // same player again → power already used this game
    expect(applyAction(r2.game, 'bob', {
      type: 'USE_HERO_POWER', power: 'tacticalPositioning', distanceDeltaM: 100,
    })).toMatchObject({ ok: false, status: 400 })
    // delta over the cap rejected
    const g2 = makeGame()
    g2.state.activeBattle = { ...g.state.activeBattle!, distanceModifiedBy: [] }
    expect(applyAction(g2, 'alice', {
      type: 'USE_HERO_POWER', power: 'tacticalPositioning', distanceDeltaM: 700,
    })).toMatchObject({ ok: false, status: 400 })
  })
  it('tacticalPositioning clamps to the spawn-distance bounds', () => {
    const low = makeGame()
    low.state.activeBattle = {
      zoneId: 1, aggressor: 'a', attackerIds: ['x'], defenderIds: ['y'],
      distanceM: 500, distanceModifiedBy: [],
    }
    const rLow = applyAction(low, 'alice', {
      type: 'USE_HERO_POWER', power: 'tacticalPositioning', distanceDeltaM: -600,
    })
    if (!rLow.ok) throw new Error(rLow.error)
    expect(rLow.game.state.activeBattle!.distanceM).toBe(50)
    const high = makeGame()
    high.state.activeBattle = {
      zoneId: 1, aggressor: 'a', attackerIds: ['x'], defenderIds: ['y'],
      distanceM: 1700, distanceModifiedBy: [],
    }
    const rHigh = applyAction(high, 'bob', {
      type: 'USE_HERO_POWER', power: 'tacticalPositioning', distanceDeltaM: 600,
    })
    if (!rHigh.ok) throw new Error(rHigh.error)
    expect(rHigh.game.state.activeBattle!.distanceM).toBe(2000)
  })
  it('rejects a non-numeric distanceDeltaM instead of coercing it', () => {
    const g = makeGame()
    g.state.activeBattle = {
      zoneId: 1, aggressor: 'a', attackerIds: ['x'], defenderIds: ['y'],
      distanceM: 1200, distanceModifiedBy: [],
    }
    expect(applyAction(g, 'bob', {
      type: 'USE_HERO_POWER', power: 'tacticalPositioning', distanceDeltaM: '600' as never,
    })).toMatchObject({ ok: false, status: 400 })
    expect(applyAction(g, 'bob', {
      type: 'USE_HERO_POWER', power: 'tacticalPositioning', distanceDeltaM: '-600' as never,
    })).toMatchObject({ ok: false, status: 400 })
  })
  it('rapidRedeployment moves any own vehicle to a biome-legal zone', () => {
    const g = makeGame()
    const ship = zoneEntry({ vehicleType: 'ship', playedOnTurn: 1 })
    g.state.zones[0].cards.a.push(ship)
    const bad = applyAction(g, 'alice', {
      type: 'USE_HERO_POWER', power: 'rapidRedeployment', instanceId: ship.instanceId, zoneId: 3,
    })
    expect(bad).toMatchObject({ ok: false, status: 400 }) // ship → land
    const r = applyAction(g, 'alice', {
      type: 'USE_HERO_POWER', power: 'rapidRedeployment', instanceId: ship.instanceId, zoneId: 2,
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[1].cards.a).toHaveLength(1)
    expect(r.game.state.zones[0].cards.a).toHaveLength(0)
  })
})

describe('MOVE_VEHICLE', () => {
  it('moves mobile vehicles once per turn, biome-legal, free', () => {
    const g = makeGame()
    const truck = zoneEntry({ vehicleType: 'tank', keywords: ['mobile'], playedOnTurn: 1 })
    g.state.zones[1].cards.a.push(truck)
    const r = applyAction(g, 'alice', { type: 'MOVE_VEHICLE', instanceId: truck.instanceId, zoneId: 3 })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[2].cards.a[0]).toMatchObject({ movedOnTurn: 2 })
    expect(applyAction(r.game, 'alice', { type: 'MOVE_VEHICLE', instanceId: truck.instanceId, zoneId: 2 }))
      .toMatchObject({ ok: false, status: 409 }) // once per turn
  })
  it('rejects non-mobile vehicles and enemy vehicles', () => {
    const g = makeGame()
    const slow = zoneEntry({ vehicleType: 'ship', playedOnTurn: 1 })
    g.state.zones[0].cards.a.push(slow)
    expect(applyAction(g, 'alice', { type: 'MOVE_VEHICLE', instanceId: slow.instanceId, zoneId: 2 }))
      .toMatchObject({ ok: false, status: 400 })
    const foe = zoneEntry({ vehicleType: 'ship', keywords: ['mobile'] })
    g.state.zones[0].cards.b.push(foe)
    expect(applyAction(g, 'alice', { type: 'MOVE_VEHICLE', instanceId: foe.instanceId, zoneId: 2 }))
      .toMatchObject({ ok: false, status: 400 })
  })
})
