import { describe, expect, it } from 'vitest'
import { CHANGE_ORDER_DELAY_TURNS, MAX_VEHICLES_PER_ZONE_SIDE } from '../gameSettings'
import { applyAction, effectiveMaterialCostOf } from './index'
import { chargeOf } from './charge.ts'
import type { EngineGame, ZoneCardEntry } from './engineTypes.ts'
import { CATALOG_HERO_POWERS } from './heroPowers'
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
    // Both hulls carry a spent activation stamp going in — Boarding Party must
    // reset it on both sides of the trade, not just re-stamp playedOnTurn.
    const mine = zoneEntry({
      faction: 'DWG', vehicleType: 'ship', materialCost: 100000, name: 'Buccaneer',
      playedOnTurn: 1, activatedOnTurn: 1,
    })
    const theirs = zoneEntry({
      faction: 'OW', vehicleType: 'ship', materialCost: 80000, name: 'Ironclad',
      playedOnTurn: 1, activatedOnTurn: 2,
    })
    g.state.zones[0].cards.a.push(mine)
    g.state.zones[0].cards.b.push(theirs)
    const r = applyAction(g, 'alice', {
      type: 'USE_HERO_POWER', power: 'boardingParty', instanceId: mine.instanceId, targetInstanceId: theirs.instanceId,
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a).toHaveLength(1)
    expect(r.game.state.zones[0].cards.a[0]).toMatchObject({
      instanceId: theirs.instanceId, playedOnTurn: 2, movedOnTurn: null, activatedOnTurn: null,
    })
    expect(r.game.state.zones[0].cards.b).toHaveLength(1)
    expect(r.game.state.zones[0].cards.b[0]).toMatchObject({
      instanceId: mine.instanceId, playedOnTurn: 2, movedOnTurn: null, activatedOnTurn: null,
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

  it('trades for an enemy hovercraft — it counts as a ship (2026-09-22 hovercraft amendment)', () => {
    const g = makeGame()
    const mine = zoneEntry({ faction: 'DWG', vehicleType: 'ship', materialCost: 100000, playedOnTurn: 1 })
    const theirs = zoneEntry({ faction: 'LH', vehicleType: 'hover', materialCost: 90000, playedOnTurn: 1 })
    g.state.zones[0].cards.a.push(mine)
    g.state.zones[0].cards.b.push(theirs)
    const r = applyAction(g, 'alice', {
      type: 'USE_HERO_POWER', power: 'boardingParty', instanceId: mine.instanceId, targetInstanceId: theirs.instanceId,
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a.map((c) => c.instanceId)).toEqual([theirs.instanceId])
  })

  // 2026-09-23 owner request: the target may be a submarine as well as a ship.
  // A capture is not a play, so the enemy's own Sub Screen in the zone does
  // not protect it — Mutiny and Sinners Luck ignore screens the same way.
  it('trades for an enemy submarine, even behind its own Sub Screen (2026-09-23 owner request)', () => {
    const g = makeGame()
    const mine = zoneEntry({ faction: 'DWG', vehicleType: 'ship', materialCost: 100000, name: 'Brigand', playedOnTurn: 1 })
    const theirs = zoneEntry({ faction: 'WF', vehicleType: 'sub', materialCost: 90000, name: 'Lurker', playedOnTurn: 1 })
    const screen = zoneEntry({ faction: 'WF', vehicleType: 'ship', materialCost: 250000, keywords: ['subScreen'], playedOnTurn: 1 })
    g.state.zones[0].cards.a.push(mine)
    g.state.zones[0].cards.b.push(theirs, screen)
    const r = applyAction(g, 'alice', {
      type: 'USE_HERO_POWER', power: 'boardingParty', instanceId: mine.instanceId, targetInstanceId: theirs.instanceId,
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a.map((c) => c.instanceId)).toEqual([theirs.instanceId])
    expect(r.game.state.zones[0].cards.b.map((c) => c.instanceId)).toEqual([screen.instanceId, mine.instanceId])
    expect(r.game.state.log).toContain('Boarding Party: Brigand traded for Lurker')
  })

  it('still refuses an enemy plane, airship or tank', () => {
    for (const vehicleType of ['plane', 'airship', 'tank']) {
      const g = makeGame()
      // The beach takes every one of them, so the type is the only objection.
      const mine = zoneEntry({ faction: 'DWG', vehicleType: 'ship', materialCost: 100000, playedOnTurn: 1 })
      const theirs = zoneEntry({ faction: 'OW', vehicleType, materialCost: 80000, playedOnTurn: 1 })
      g.state.zones[1].cards.a.push(mine)
      g.state.zones[1].cards.b.push(theirs)
      const r = applyAction(g, 'alice', {
        type: 'USE_HERO_POWER', power: 'boardingParty', instanceId: mine.instanceId, targetInstanceId: theirs.instanceId,
      })
      expect(r, vehicleType).toMatchObject({ ok: false, status: 400 })
    }
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

describe('MAX_VEHICLES_PER_ZONE_SIDE — the move half of the cap', () => {
  function fill(g: ReturnType<typeof makeGame>, zoneIndex: number, side: 'a' | 'b', count: number) {
    for (let i = 0; i < count; i++) {
      g.state.zones[zoneIndex].cards[side].push(zoneEntry({ vehicleType: 'tank' }))
    }
  }

  it('refuses MOVE_VEHICLE into a side already holding the cap', () => {
    const g = makeGame()
    const truck = zoneEntry({ vehicleType: 'tank', keywords: ['mobile'], playedOnTurn: 1 })
    g.state.zones[1].cards.a.push(truck)
    fill(g, 2, 'a', MAX_VEHICLES_PER_ZONE_SIDE)
    expect(applyAction(g, 'alice', { type: 'MOVE_VEHICLE', instanceId: truck.instanceId, zoneId: 3 }))
      .toMatchObject({ ok: false, status: 400 })
    // and the hull stays put rather than vanishing en route
    expect(g.state.zones[1].cards.a).toHaveLength(1)
  })

  it('allows the move that fills the last slot', () => {
    const g = makeGame()
    const truck = zoneEntry({ vehicleType: 'tank', keywords: ['mobile'], playedOnTurn: 1 })
    g.state.zones[1].cards.a.push(truck)
    fill(g, 2, 'a', MAX_VEHICLES_PER_ZONE_SIDE - 1)
    const r = applyAction(g, 'alice', { type: 'MOVE_VEHICLE', instanceId: truck.instanceId, zoneId: 3 })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[2].cards.a).toHaveLength(MAX_VEHICLES_PER_ZONE_SIDE)
  })

  it('reads the destination side only, not the enemy half of it', () => {
    const g = makeGame()
    const truck = zoneEntry({ vehicleType: 'tank', keywords: ['mobile'], playedOnTurn: 1 })
    g.state.zones[1].cards.a.push(truck)
    fill(g, 2, 'b', MAX_VEHICLES_PER_ZONE_SIDE)
    expect(applyAction(g, 'alice', { type: 'MOVE_VEHICLE', instanceId: truck.instanceId, zoneId: 3 }).ok).toBe(true)
  })

  // A full SOURCE zone must not block the move out of it — the check reads
  // the destination. Without that, a side at the cap would be frozen in place.
  it('lets a vehicle leave a full side', () => {
    const g = makeGame()
    const truck = zoneEntry({ vehicleType: 'tank', keywords: ['mobile'], playedOnTurn: 1 })
    g.state.zones[1].cards.a.push(truck)
    fill(g, 1, 'a', MAX_VEHICLES_PER_ZONE_SIDE - 1)
    expect(g.state.zones[1].cards.a).toHaveLength(MAX_VEHICLES_PER_ZONE_SIDE)
    const r = applyAction(g, 'alice', { type: 'MOVE_VEHICLE', instanceId: truck.instanceId, zoneId: 3 })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[2].cards.a).toHaveLength(1)
  })

  // Boarding Party is a SWAP: net-zero on both sides, so a full zone must not
  // block it. Pins the boundary the cap deliberately does not cross.
  it('does not block Boarding Party into a full zone', () => {
    const g = makeGame()
    const mine = zoneEntry({ vehicleType: 'ship', faction: 'DWG', materialCost: 90000 })
    const theirs = zoneEntry({ vehicleType: 'ship', faction: 'OW', materialCost: 50000 })
    g.state.zones[0].cards.a.push(mine)
    g.state.zones[0].cards.b.push(theirs)
    fill(g, 0, 'a', MAX_VEHICLES_PER_ZONE_SIDE - 1)
    expect(g.state.zones[0].cards.a).toHaveLength(MAX_VEHICLES_PER_ZONE_SIDE)
    const r = applyAction(g, 'alice', {
      type: 'USE_HERO_POWER', power: 'boardingParty',
      instanceId: mine.instanceId, targetInstanceId: theirs.instanceId,
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a).toHaveLength(MAX_VEHICLES_PER_ZONE_SIDE)
  })

  // The move half. Without it a player would deploy into a spare zone and walk
  // hulls into a denied one, which is the denial in name only.
  it('refuses a move into a zone an enemy denier has shrunk', () => {
    const g = makeGame()
    fill(g, 2, 'a', MAX_VEHICLES_PER_ZONE_SIDE - 3)
    g.state.zones[2].cards.b.push(zoneEntry({ name: 'Tiger Shark', meta: { slotDenial: 3 } }))
    // tank, not ship: zoneId 3 is the LAND zone (see testFixtures), and a ship
    // cannot operate there — biomeAllows would refuse the move before the cap
    // check ever runs, which is not what this case is pinning.
    const mover = zoneEntry({ vehicleType: 'tank', keywords: ['mobile'] })
    g.state.zones[0].cards.a.push(mover)
    const r = applyAction(g, 'alice', { type: 'MOVE_VEHICLE', instanceId: mover.instanceId, zoneId: 3 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    // The message quotes the EFFECTIVE cap, not the printed 8 — a player told
    // "your 8-vehicle limit" while standing on 5 has been told nothing.
    expect(r.error).toContain(`${MAX_VEHICLES_PER_ZONE_SIDE - 3}-vehicle limit`)
  })

  it('a side already over the reduced cap can still move hulls OUT', () => {
    const g = makeGame()
    fill(g, 2, 'a', MAX_VEHICLES_PER_ZONE_SIDE)
    g.state.zones[2].cards.b.push(zoneEntry({ name: 'Tiger Shark', meta: { slotDenial: 3 } }))
    g.state.zones[2].cards.a[0].keywords = ['mobile']
    const mover = g.state.zones[2].cards.a[0]
    // zoneId 2 (beach), not 1 (water): the mover is a tank (fill's own type),
    // which cannot operate in water — moving there would be refused by
    // biomeAllows regardless of the cap fix, defeating the point of this case.
    const r = applyAction(g, 'alice', { type: 'MOVE_VEHICLE', instanceId: mover.instanceId, zoneId: 2 })
    expect(r.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The three faction powers heroPowers.js authored for SS, TG and WF.
// ---------------------------------------------------------------------------

describe('USE_HERO_POWER counterIntelligence (SS)', () => {
  function ssGame() {
    const g = makeGame()
    g.state.factions.a = 'SS'
    const mine = zoneEntry({ name: 'Picket', playedOnTurn: 1 })
    const theirs = zoneEntry({ name: 'Raider', playedOnTurn: 1 })
    g.state.zones[0].cards.a.push(mine)
    g.state.zones[0].cards.b.push(theirs)
    return { g, mine, theirs }
  }
  it('grants airScreen and subScreen to one of my on-field vehicles, 1cp, once per game', () => {
    const { g, mine } = ssGame()
    const r = applyAction(g, 'alice', { type: 'USE_HERO_POWER', power: 'counterIntelligence', instanceId: mine.instanceId })
    if (!r.ok) throw new Error(r.error)
    const after = r.game.state.zones[0].cards.a[0]
    expect(after.keywords).toEqual(expect.arrayContaining(['airScreen', 'subScreen']))
    expect(r.game.state.resources.a.cp).toBe(2)
    expect(r.game.state.usedHeroPowers.a).toEqual(['counterIntelligence'])
    expect(r.game.state.log.at(-1)).toContain('Picket')
    expect(applyAction(r.game, 'alice', { type: 'USE_HERO_POWER', power: 'counterIntelligence', instanceId: mine.instanceId }))
      .toMatchObject({ ok: false, status: 400 })
  })
  it('does not duplicate a screen keyword the vehicle already prints', () => {
    const { g, mine } = ssGame()
    mine.keywords.push('airScreen')
    const r = applyAction(g, 'alice', { type: 'USE_HERO_POWER', power: 'counterIntelligence', instanceId: mine.instanceId })
    if (!r.ok) throw new Error(r.error)
    const after = r.game.state.zones[0].cards.a[0]
    expect(after.keywords.filter((k) => k === 'airScreen')).toHaveLength(1)
    expect(after.keywords).toContain('subScreen')
  })
  it('rejects an enemy vehicle, an unknown id and a missing id with 400, spending nothing', () => {
    const { g, theirs } = ssGame()
    for (const instanceId of [theirs.instanceId, 'nope', undefined]) {
      const r = applyAction(g, 'alice', { type: 'USE_HERO_POWER', power: 'counterIntelligence', instanceId })
      expect(r).toMatchObject({ ok: false, status: 400 })
    }
    expect(g.state.resources.a.cp).toBe(3)
    expect(g.state.zones[0].cards.b[0].keywords).toEqual([])
  })
  it('is SS-locked', () => {
    const { g, mine } = ssGame()
    g.state.factions.a = 'DWG'
    expect(applyAction(g, 'alice', { type: 'USE_HERO_POWER', power: 'counterIntelligence', instanceId: mine.instanceId }))
      .toMatchObject({ ok: false, status: 403 })
  })
})

describe('USE_HERO_POWER drones (TG)', () => {
  const swarm = snap({
    name: 'Mirth Swarm', faction: 'TG', vehicleType: 'plane', materialCost: 200000,
    keywords: ['robotic', 'temporary', 'halfCost'],
  })
  function tgGame() {
    const g = makeGame()
    g.state.factions.a = 'TG'
    return g
  }
  it('spawns one Mirth Swarm for me into every zone, 1cp, once per game', () => {
    const g = tgGame()
    const r = applyAction(g, 'alice', { type: 'USE_HERO_POWER', power: 'drones' }, makeCtx({ catalog: [swarm] }))
    if (!r.ok) throw new Error(r.error)
    for (const zone of r.game.state.zones) {
      expect(zone.cards.a.map((c) => c.name)).toEqual(['Mirth Swarm'])
      expect(zone.cards.b).toEqual([])
      expect(zone.cards.a[0].keywords).toContain('temporary')
      expect(zone.cards.a[0].playedOnTurn).toBe(g.turnNumber)
    }
    // Minted through ctx.newId, so three distinct ids.
    const ids = r.game.state.zones.map((z) => z.cards.a[0].instanceId)
    expect(new Set(ids).size).toBe(3)
    expect(r.game.state.resources.a.cp).toBe(2)
    expect(r.game.state.usedHeroPowers.a).toEqual(['drones'])
    expect(applyAction(r.game, 'alice', { type: 'USE_HERO_POWER', power: 'drones' }, makeCtx({ catalog: [swarm] })))
      .toMatchObject({ ok: false, status: 400 })
  })
  it('spawns nothing and spends nothing when the catalog cannot supply a Mirth Swarm', () => {
    const g = tgGame()
    const r = applyAction(g, 'alice', { type: 'USE_HERO_POWER', power: 'drones' }, makeCtx({ catalog: [] }))
    expect(r).toMatchObject({ ok: false, status: 400 })
    expect(g.state.zones.every((z) => z.cards.a.length === 0)).toBe(true)
    expect(g.state.resources.a.cp).toBe(3)
  })
  it('is TG-locked', () => {
    const g = makeGame()
    expect(applyAction(g, 'alice', { type: 'USE_HERO_POWER', power: 'drones' }, makeCtx({ catalog: [swarm] })))
      .toMatchObject({ ok: false, status: 403 })
  })
  it('is declared as needing the catalog, so game-action loads one for it', () => {
    expect(CATALOG_HERO_POWERS.has('drones')).toBe(true)
    expect(CATALOG_HERO_POWERS.has('draw')).toBe(false)
  })
})

describe('USE_HERO_POWER flankingManeuver (WF)', () => {
  // alice (WF) flanks a zone, then has a hull in zone 1 ready to attack with,
  // and bob has one there to defend with.
  function flanked(zoneId = 1) {
    const g = makeGame({ turnNumber: 3 })
    g.state.factions.a = 'WF'
    const attacker = zoneEntry({ name: 'Raider', playedOnTurn: 2 })
    const defender = zoneEntry({ name: 'Home Fleet', playedOnTurn: 1 })
    g.state.zones[0].cards.a.push(attacker)
    g.state.zones[0].cards.b.push(defender)
    const r = applyAction(g, 'alice', { type: 'USE_HERO_POWER', power: 'flankingManeuver', zoneId })
    if (!r.ok) throw new Error(r.error)
    return { game: r.game, attacker, defender }
  }
  const rider = {
    effect: 'flankingManeuverEffect', zoneId: 1, side: 'a', cardName: 'Flanking Maneuver',
    setOnTurn: 3, expiresOnTurn: 3, data: { flanking: true },
  }

  it('claims the zone with a rest-of-turn rider, 1cp, once per game', () => {
    const { game } = flanked()
    expect(game.state.zoneEffects).toEqual([rider])
    expect(game.state.resources.a.cp).toBe(2)
    expect(game.state.usedHeroPowers.a).toEqual(['flankingManeuver'])
    expect(applyAction(game, 'alice', { type: 'USE_HERO_POWER', power: 'flankingManeuver', zoneId: 2 }))
      .toMatchObject({ ok: false, status: 400 })
  })
  it('rejects a missing or unknown zone with 400', () => {
    const g = makeGame()
    g.state.factions.a = 'WF'
    expect(applyAction(g, 'alice', { type: 'USE_HERO_POWER', power: 'flankingManeuver' }))
      .toMatchObject({ ok: false, status: 400 })
    expect(applyAction(g, 'alice', { type: 'USE_HERO_POWER', power: 'flankingManeuver', zoneId: 9 }))
      .toMatchObject({ ok: false, status: 400 })
    expect(g.state.zoneEffects).toEqual([])
  })
  it('is WF-locked', () => {
    const g = makeGame()
    expect(applyAction(g, 'alice', { type: 'USE_HERO_POWER', power: 'flankingManeuver', zoneId: 1 }))
      .toMatchObject({ ok: false, status: 403 })
  })
  it('at my own fleet-attack lock there: consumes the rider, marks the defenders Fragile, grants deploy-after', () => {
    const { game, attacker, defender } = flanked()
    const r = applyAction(game, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zoneEffects).toEqual([])
    expect(r.game.state.activeBattle?.fragileSide).toBe('b')
    expect(r.game.state.log.some((l) => /deploy after the defender/i.test(l))).toBe(true)
    expect(r.game.state.log.some((l) => /Fragile/.test(l))).toBe(true)
  })
  it('leaves a battle in another zone alone', () => {
    const { game, attacker, defender } = flanked(2)
    const r = applyAction(game, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zoneEffects).toHaveLength(1)
    expect(r.game.state.activeBattle?.fragileSide).toBeUndefined()
  })
  it('is not spent by a battle I defend in that zone', () => {
    const { game, attacker, defender } = flanked()
    game.activePlayer = 'bob'
    const r = applyAction(game, 'bob', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zoneEffects).toEqual([rider])
    expect(r.game.state.activeBattle?.fragileSide).toBeUndefined()
  })
  it('expires unused at my END_TURN without a compensation draw', () => {
    const { game } = flanked()
    game.privates.a.deck = [{ ...snap(), instanceId: 'd1' }]
    game.state.counts.a.deck = 1
    const handBefore = game.privates.a.hand.length
    const r = applyAction(game, 'alice', { type: 'END_TURN' })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zoneEffects).toEqual([])
    expect(r.game.privates.a.hand).toHaveLength(handBefore)
    expect(r.game.state.log.some((l) => /Flanking Maneuver expired/.test(l))).toBe(true)
  })
})

// 2026-09-23 owner amendment: "pick a zone and charge all vehicles in that
// zone to max energy" replaces "every friendly LH vehicle gains 1 charge".
describe('Surge (2026-09-21 LH spec §6, amended 2026-09-23)', () => {
  // An LH mirror, so enemy LH hulls with room are on the board to be left alone.
  const lhGame = () => {
    const game = makeGame({ turnNumber: 3, activePlayer: 'alice' })
    game.state.factions = { a: 'LH', b: 'LH' }
    return game
  }
  const surge = (zoneId?: number) => ({ type: 'USE_HERO_POWER', power: 'surge', zoneId } as const)
  const chargesIn = (game: EngineGame, zoneIndex: number, side: 'a' | 'b') =>
    Object.fromEntries(game.state.zones[zoneIndex].cards[side].map((c) => [c.instanceId, chargeOf(c as ZoneCardEntry)]))

  it('fills every friendly LH vehicle in the chosen zone to its maximum', () => {
    const game = lhGame()
    game.state.zones[0].cards.a.push(
      zoneEntry({ instanceId: 'empty', faction: 'LH', meta: { chargeMax: 3 } }),
      zoneEntry({ instanceId: 'part', faction: 'LH', meta: { chargeMax: 4 }, charge: 1 }),
      zoneEntry({ instanceId: 'full', faction: 'LH', meta: { chargeMax: 2 }, charge: 2 }),
      zoneEntry({ instanceId: 'plane', faction: 'LH', vehicleType: 'plane', keywords: ['temporary'] }),
      zoneEntry({ instanceId: 'dwg', faction: 'DWG', meta: { chargeMax: 2 } }),
    )
    const res = applyAction(game, 'alice', surge(1), makeCtx())
    if (!res.ok) throw new Error(res.error)
    expect(chargesIn(res.game, 0, 'a')).toEqual({ empty: 3, part: 4, full: 2, plane: 0, dwg: 0 })
    // 3 + 3 pips gained, and the log says where.
    expect(res.game.state.log.some((l) => /^Surge: .*zone 1.*\b6 charge/.test(l))).toBe(true)
    expect(res.game.state.resources.a.cp).toBe(2)
    expect(res.game.state.usedHeroPowers.a).toEqual(['surge'])
  })

  it('leaves my other zones and every enemy vehicle alone', () => {
    const game = lhGame()
    game.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'mine', faction: 'LH', meta: { chargeMax: 2 } }))
    game.state.zones[1].cards.a.push(zoneEntry({ instanceId: 'elsewhere', faction: 'LH', meta: { chargeMax: 2 } }))
    game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'theirs', faction: 'LH', meta: { chargeMax: 2 } }))
    const res = applyAction(game, 'alice', surge(1), makeCtx())
    if (!res.ok) throw new Error(res.error)
    expect(chargesIn(res.game, 0, 'a')).toEqual({ mine: 2 })
    expect(chargesIn(res.game, 1, 'a')).toEqual({ elsewhere: 0 })
    expect(chargesIn(res.game, 0, 'b')).toEqual({ theirs: 0 })
  })

  it('needs a zone that exists', () => {
    for (const zoneId of [undefined, 9]) {
      const game = lhGame()
      game.state.zones[0].cards.a.push(zoneEntry({ faction: 'LH', meta: { chargeMax: 2 } }))
      expect(applyAction(game, 'alice', surge(zoneId), makeCtx())).toMatchObject({ ok: false, status: 400 })
    }
  })

  it('is usable on a zone with nothing to charge: the CP is spent and the log says so (R-28)', () => {
    const game = lhGame()
    game.state.zones[1].cards.a.push(zoneEntry({ instanceId: 'elsewhere', faction: 'LH', meta: { chargeMax: 2 } }))
    const res = applyAction(game, 'alice', surge(3), makeCtx())
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.resources.a.cp).toBe(2)
    expect(res.game.state.usedHeroPowers.a).toEqual(['surge'])
    expect(res.game.state.log.some((l) => /^Surge: nothing .*zone 3/.test(l))).toBe(true)
    expect(chargesIn(res.game, 1, 'a')).toEqual({ elsewhere: 0 })
  })

  it('belongs to LH', () => {
    const game = makeGame({ turnNumber: 3, activePlayer: 'alice' })
    expect(applyAction(game, 'alice', surge(1), makeCtx())).toMatchObject({ ok: false, status: 403 })
  })
})
