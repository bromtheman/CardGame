import { describe, expect, it } from 'vitest'
import { CHANGE_ORDER_DELAY_TURNS } from '../gameSettings'
import { applyAction, effectiveMaterialCostOf } from './index'
import { inst, makeCtx, makeGame, snap, zoneEntry } from './testFixtures'

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

describe('USE_HERO_POWER faction gate', () => {
  it('rejects a power that belongs to a faction the actor is not playing', () => {
    // makeGame(): state.factions.a === 'DWG', so LH-locked flyby is off-limits
    const g = makeGame()
    const r = applyAction(g, 'alice', { type: 'USE_HERO_POWER', power: 'flyby', instanceId: 'whatever' })
    expect(r).toMatchObject({ ok: false, status: 403, error: 'That power belongs to another faction' })
  })
  it('lets a matching-faction power through the gate and into normal validation', () => {
    // DWG-locked boardingParty for a DWG actor passes the gate; the bogus
    // instanceId then fails for an ordinary 400, never a 403.
    const g = makeGame()
    const r = applyAction(g, 'alice', { type: 'USE_HERO_POWER', power: 'boardingParty', instanceId: 'nope' })
    expect(r).toMatchObject({ ok: false, status: 400 })
  })
  it('rejects an inherited-property power name with an ordinary 400, never a 403', () => {
    // FACTION_POWERS lookup must use Object.hasOwn (or equivalent) so a
    // prototype property name like '__proto__' can't be mistaken for a
    // registered power and short-circuit into the faction gate's 403.
    const g = makeGame()
    const r = applyAction(g, 'alice', { type: 'USE_HERO_POWER', power: '__proto__' as never })
    expect(r).toMatchObject({ ok: false, status: 400, error: 'Unknown hero power' })
  })
})

describe('USE_HERO_POWER boardingParty (DWG)', () => {
  it('swaps my DWG ship for a same-zone enemy ship of equal-or-lesser effective cost', () => {
    const g = makeGame() // turnNumber 2, alice active, a=DWG
    const mine = zoneEntry({ faction: 'DWG', vehicleType: 'ship', materialCost: 100000, name: 'Buccaneer', playedOnTurn: 1 })
    const theirs = zoneEntry({ faction: 'OW', vehicleType: 'ship', materialCost: 80000, name: 'Ironclad', playedOnTurn: 1 })
    g.state.zones[0].cards.a.push(mine)
    g.state.zones[0].cards.b.push(theirs)
    const r = applyAction(g, 'alice', {
      type: 'USE_HERO_POWER', power: 'boardingParty', instanceId: mine.instanceId, targetInstanceId: theirs.instanceId,
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a).toHaveLength(1)
    expect(r.game.state.zones[0].cards.a[0]).toMatchObject({
      instanceId: theirs.instanceId, playedOnTurn: 2, movedOnTurn: null,
    })
    expect(r.game.state.zones[0].cards.b).toHaveLength(1)
    expect(r.game.state.zones[0].cards.b[0]).toMatchObject({
      instanceId: mine.instanceId, playedOnTurn: 2, movedOnTurn: null,
    })
    expect(r.game.state.resources.a.cp).toBe(2)
    expect(r.game.state.usedHeroPowers.a).toEqual(['boardingParty'])
    expect(r.game.state.log).toContain('Boarding Party: Buccaneer traded for Ironclad')
  })
  it('rejects a non-ship as "mine"', () => {
    const g = makeGame()
    const mine = zoneEntry({ faction: 'DWG', vehicleType: 'tank', materialCost: 100000, playedOnTurn: 1 })
    const theirs = zoneEntry({ faction: 'OW', vehicleType: 'ship', materialCost: 80000, playedOnTurn: 1 })
    g.state.zones[1].cards.a.push(mine)
    g.state.zones[1].cards.b.push(theirs)
    const r = applyAction(g, 'alice', {
      type: 'USE_HERO_POWER', power: 'boardingParty', instanceId: mine.instanceId, targetInstanceId: theirs.instanceId,
    })
    expect(r).toMatchObject({ ok: false, status: 400 })
  })
  it('rejects an enemy ship parked in a different zone', () => {
    const g = makeGame()
    const mine = zoneEntry({ faction: 'DWG', vehicleType: 'ship', materialCost: 100000, playedOnTurn: 1 })
    const theirs = zoneEntry({ faction: 'OW', vehicleType: 'ship', materialCost: 80000, playedOnTurn: 1 })
    g.state.zones[0].cards.a.push(mine)
    g.state.zones[1].cards.b.push(theirs)
    const r = applyAction(g, 'alice', {
      type: 'USE_HERO_POWER', power: 'boardingParty', instanceId: mine.instanceId, targetInstanceId: theirs.instanceId,
    })
    expect(r).toMatchObject({ ok: false, status: 400 })
  })
  it('rejects an enemy ship that costs more than mine at EFFECTIVE cost, not raw cost', () => {
    const g = makeGame()
    // raw 400k but halfCost → effective 200k
    const mine = zoneEntry({
      faction: 'DWG', vehicleType: 'ship', materialCost: 400000, keywords: ['halfCost'], playedOnTurn: 1,
    })
    // raw 210k, no discount → effective 210k, which is MORE than mine's effective 200k
    // (a raw-cost comparison would have wrongly allowed this trade)
    const theirs = zoneEntry({ faction: 'OW', vehicleType: 'ship', materialCost: 210000, playedOnTurn: 1 })
    g.state.zones[0].cards.a.push(mine)
    g.state.zones[0].cards.b.push(theirs)
    const r = applyAction(g, 'alice', {
      type: 'USE_HERO_POWER', power: 'boardingParty', instanceId: mine.instanceId, targetInstanceId: theirs.instanceId,
    })
    expect(r).toMatchObject({ ok: false, status: 400 })
  })
  it('rejects a missing targetInstanceId before any mutation happens', () => {
    const g = makeGame()
    const mine = zoneEntry({ faction: 'DWG', vehicleType: 'ship', materialCost: 100000, playedOnTurn: 1 })
    g.state.zones[0].cards.a.push(mine)
    const before = JSON.stringify(g.state.zones[0])
    const r = applyAction(g, 'alice', { type: 'USE_HERO_POWER', power: 'boardingParty', instanceId: mine.instanceId })
    expect(r).toMatchObject({ ok: false, status: 400 })
    expect(JSON.stringify(g.state.zones[0])).toBe(before) // input untouched (applyAction clones)
  })
  it('cannot be used twice — once per game', () => {
    const g = makeGame()
    const mine = zoneEntry({ faction: 'DWG', vehicleType: 'ship', materialCost: 100000, playedOnTurn: 1 })
    const theirs = zoneEntry({ faction: 'OW', vehicleType: 'ship', materialCost: 80000, playedOnTurn: 1 })
    g.state.zones[0].cards.a.push(mine)
    g.state.zones[0].cards.b.push(theirs)
    const r = applyAction(g, 'alice', {
      type: 'USE_HERO_POWER', power: 'boardingParty', instanceId: mine.instanceId, targetInstanceId: theirs.instanceId,
    })
    if (!r.ok) throw new Error(r.error)
    const mine2 = zoneEntry({ faction: 'DWG', vehicleType: 'ship', materialCost: 100000, playedOnTurn: 1 })
    const theirs2 = zoneEntry({ faction: 'OW', vehicleType: 'ship', materialCost: 80000, playedOnTurn: 1 })
    r.game.state.zones[1].cards.a.push(mine2)
    r.game.state.zones[1].cards.b.push(theirs2)
    const r2 = applyAction(r.game, 'alice', {
      type: 'USE_HERO_POWER', power: 'boardingParty', instanceId: mine2.instanceId, targetInstanceId: theirs2.instanceId,
    })
    expect(r2).toMatchObject({ ok: false, status: 400 })
  })
})

describe('USE_HERO_POWER changeOrder (OW)', () => {
  it('sends an OW vehicle from hand to destroyed[] and schedules a delayed redelivery', () => {
    const g = makeGame({ activePlayer: 'bob', turnNumber: 3 })
    const card = inst({ faction: 'OW', type: 'vehicle', vehicleType: 'ship', name: 'Requisition Order' })
    g.privates.b.hand.push(card)
    g.state.counts.b.hand = 1
    const r = applyAction(g, 'bob', { type: 'USE_HERO_POWER', power: 'changeOrder', instanceId: card.instanceId })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.b.hand).toHaveLength(0)
    expect(r.game.state.counts.b.hand).toBe(0)
    expect(r.game.state.destroyed.b).toHaveLength(1)
    expect(r.game.state.destroyed.b[0]).toMatchObject({ cardId: card.cardId, name: 'Requisition Order' })
    expect(r.game.state.destroyed.b[0]).not.toHaveProperty('instanceId')
    expect(r.game.state.scheduled).toEqual([
      { type: 'changeOrderDraw', side: 'b', dueTurn: 3 + CHANGE_ORDER_DELAY_TURNS },
    ])
    expect(r.game.state.resources.b.cp).toBe(2)
    expect(r.game.state.usedHeroPowers.b).toEqual(['changeOrder'])
  })
  it('rejects a non-OW vehicle and an OW ability card', () => {
    const g = makeGame({ activePlayer: 'bob' })
    const wrongFaction = inst({ faction: 'DWG', type: 'vehicle', vehicleType: 'ship' })
    const wrongType = inst({ faction: 'OW', type: 'ability', vehicleType: null })
    g.privates.b.hand.push(wrongFaction, wrongType)
    g.state.counts.b.hand = 2
    expect(applyAction(g, 'bob', { type: 'USE_HERO_POWER', power: 'changeOrder', instanceId: wrongFaction.instanceId }))
      .toMatchObject({ ok: false, status: 400 })
    expect(applyAction(g, 'bob', { type: 'USE_HERO_POWER', power: 'changeOrder', instanceId: wrongType.instanceId }))
      .toMatchObject({ ok: false, status: 400 })
  })
})

describe('changeOrder delivery via END_TURN', () => {
  it('delivers only a non-built-in ship/tank from the incoming side\'s deck, when due', () => {
    const g = makeGame({ turnNumber: 2, activePlayer: 'alice' }) // incoming side on END_TURN is b
    g.state.scheduled = [{ type: 'changeOrderDraw', side: 'b', dueTurn: 2.5 }]
    const filler = inst({ name: 'Filler', vehicleType: 'plane', isBuiltIn: true })
    const builtInShip = inst({ name: 'Built-in Ship', vehicleType: 'ship', isBuiltIn: true })
    const customTank = inst({ name: 'Custom Tank', vehicleType: 'tank', isBuiltIn: false })
    g.privates.b.deck = [filler, builtInShip, customTank]
    g.state.counts.b.deck = 3
    const r = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.scheduled).toEqual([])
    // normal turn draw (filler) + the delivered custom tank both land in hand
    expect(r.game.privates.b.hand.map((c) => c.instanceId).sort()).toEqual(
      [filler.instanceId, customTank.instanceId].sort(),
    )
    // the built-in ship does NOT qualify for Change Order and stays in the deck
    expect(r.game.privates.b.deck.map((c) => c.instanceId)).toEqual([builtInShip.instanceId])
    expect(r.game.state.counts.b.deck).toBe(r.game.privates.b.deck.length)
    expect(r.game.state.counts.b.hand).toBe(r.game.privates.b.hand.length)
    expect(r.game.state.log).toContain('Change Order delivers a replacement')
  })
  it('fizzles with a log note when the incoming side has no custom ship/tank in deck', () => {
    const g = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    g.state.scheduled = [{ type: 'changeOrderDraw', side: 'b', dueTurn: 2.5 }]
    const filler = inst({ name: 'Filler', vehicleType: 'plane', isBuiltIn: true })
    const builtInShip = inst({ name: 'Built-in Ship', vehicleType: 'ship', isBuiltIn: true })
    g.privates.b.deck = [filler, builtInShip]
    g.state.counts.b.deck = 2
    const r = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.scheduled).toEqual([])
    // only the ordinary turn draw happened — no extra card arrived
    expect(r.game.privates.b.hand.map((c) => c.instanceId)).toEqual([filler.instanceId])
    expect(r.game.privates.b.deck.map((c) => c.instanceId)).toEqual([builtInShip.instanceId])
    expect(r.game.state.log).toContain('Change Order finds no player-made ship or tank')
  })
  it('leaves not-yet-due or other-side scheduled entries untouched', () => {
    const g = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    g.state.scheduled = [
      { type: 'changeOrderDraw', side: 'b', dueTurn: 10 }, // not due yet
      { type: 'changeOrderDraw', side: 'a', dueTurn: 2.5 }, // wrong side (incoming is b)
    ]
    const r = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.scheduled).toEqual([
      { type: 'changeOrderDraw', side: 'b', dueTurn: 10 },
      { type: 'changeOrderDraw', side: 'a', dueTurn: 2.5 },
    ])
  })
})

describe('USE_HERO_POWER flyby (LH)', () => {
  it('adds halfCost + temporary to an LH vehicle in hand, without duplicating an already-present keyword', () => {
    const g = makeGame()
    g.state.factions = { ...g.state.factions, a: 'LH' }
    const card = inst({ faction: 'LH', type: 'vehicle', vehicleType: 'airship', keywords: ['temporary'] })
    g.privates.a.hand.push(card)
    g.state.counts.a.hand = 1
    const r = applyAction(g, 'alice', { type: 'USE_HERO_POWER', power: 'flyby', instanceId: card.instanceId })
    if (!r.ok) throw new Error(r.error)
    const updated = r.game.privates.a.hand.find((c) => c.instanceId === card.instanceId)!
    expect(updated.keywords.filter((k) => k === 'temporary')).toHaveLength(1)
    expect(updated.keywords.filter((k) => k === 'halfCost')).toHaveLength(1)
    expect(r.game.state.resources.a.cp).toBe(2)
    expect(r.game.state.usedHeroPowers.a).toEqual(['flyby'])
  })
  it("a flyby'd card plays at half its material cost", () => {
    const g = makeGame()
    g.state.factions = { ...g.state.factions, a: 'LH' }
    const card = inst({ faction: 'LH', type: 'vehicle', vehicleType: 'airship', materialCost: 100000 })
    g.privates.a.hand.push(card)
    g.state.counts.a.hand = 1
    const r = applyAction(g, 'alice', { type: 'USE_HERO_POWER', power: 'flyby', instanceId: card.instanceId })
    if (!r.ok) throw new Error(r.error)
    const updated = r.game.privates.a.hand.find((c) => c.instanceId === card.instanceId)!
    expect(effectiveMaterialCostOf(updated)).toBe(50000)
  })
  it('rejects a non-LH vehicle and an LH ability card', () => {
    const g = makeGame()
    g.state.factions = { ...g.state.factions, a: 'LH' }
    const wrongFaction = inst({ faction: 'DWG', type: 'vehicle', vehicleType: 'ship' })
    const wrongType = inst({ faction: 'LH', type: 'ability', vehicleType: null })
    g.privates.a.hand.push(wrongFaction, wrongType)
    g.state.counts.a.hand = 2
    expect(applyAction(g, 'alice', { type: 'USE_HERO_POWER', power: 'flyby', instanceId: wrongFaction.instanceId }))
      .toMatchObject({ ok: false, status: 400 })
    expect(applyAction(g, 'alice', { type: 'USE_HERO_POWER', power: 'flyby', instanceId: wrongType.instanceId }))
      .toMatchObject({ ok: false, status: 400 })
  })
})
