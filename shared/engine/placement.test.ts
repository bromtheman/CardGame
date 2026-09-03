import { describe, expect, it } from 'vitest'
import {
  applyAction, effectFor, effectiveCostInGame, effectiveMaterialCostOf, legalZonesFor,
} from './index'
import { registerCostModifier, registerEffect } from '../effects/registry.ts'
import { takeFromEnemyDeck } from '../effects/primitives.ts'
import { ADDITIONAL_SPAWNS_CAP, KEYWORDS, MAX_VEHICLES_PER_ZONE_SIDE } from '../gameSettings.ts'
import { inst, makeCtx, makeGame, snap, zoneEntry } from './testFixtures'

function withHand(cardOver: Record<string, unknown>) {
  const g = makeGame()
  const card = inst(cardOver)
  g.privates.a.hand = [card]
  g.state.counts.a.hand = 1
  return { g, card }
}

describe('PLAY_CARD_TO_ZONE', () => {
  it('places a ship into water, pays, stamps playedOnTurn', () => {
    const { g, card } = withHand({ vehicleType: 'ship', materialCost: 40000 })
    const r = applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a[0]).toMatchObject({
      instanceId: card.instanceId, playedOnTurn: 2, movedOnTurn: null,
    })
    expect(r.game.state.resources.a.materials).toBe(60000)
    expect(r.game.privates.a.hand).toHaveLength(0)
    expect(r.game.state.counts.a.hand).toBe(0)
  })
  it('enforces biome legality', () => {
    const { g, card } = withHand({ vehicleType: 'tank' })
    expect(applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }))
      .toMatchObject({ ok: false, status: 400 })
    expect(legalZonesFor(g.state, 'a', card)).toEqual([2, 3])
  })
  it('enforces enemy screens for playing (air + sub)', () => {
    const { g, card } = withHand({ vehicleType: 'plane', materialCost: 10000 })
    g.state.zones[0].cards.b.push(zoneEntry({ keywords: ['airScreen'] }))
    expect(applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }))
      .toMatchObject({ ok: false, status: 400 })
    expect(legalZonesFor(g.state, 'a', card)).toEqual([2, 3])
    const { g: g2, card: sub } = withHand({ vehicleType: 'sub' })
    g2.state.zones[0].cards.b.push(zoneEntry({ keywords: ['subScreen'] }))
    expect(legalZonesFor(g2.state, 'a', sub)).toEqual([2])
  })
  it('rejects unaffordable and unknown cards', () => {
    const { g, card } = withHand({ materialCost: 999999 })
    expect(applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }))
      .toMatchObject({ ok: false, status: 400 })
    expect(applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: 'ghost', zoneId: 1 }))
      .toMatchObject({ ok: false, status: 400 })
  })
  it('pays CP when the card costs CP', () => {
    const { g, card } = withHand({ vehicleType: 'ship', materialCost: 1000, cpCost: 2 })
    const r = applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.resources.a.cp).toBe(1)
  })
  it('halfCost halves the bill (spec §3.7 flier rule)', () => {
    expect(effectiveMaterialCostOf(inst({ materialCost: 240000, keywords: ['halfCost'] }))).toBe(120000)
    expect(effectiveMaterialCostOf(inst({ materialCost: 240000 }))).toBe(240000)
    const { g, card } = withHand({ vehicleType: 'plane', materialCost: 150000, keywords: ['halfCost'] })
    const r = applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.resources.a.materials).toBe(25000) // 100000 - 75000
  })
})

describe('PLAY_ABILITY_CARD', () => {
  it('pays, discards, and logs a normal resolution note', () => {
    const { g, card } = withHand({ type: 'ability', vehicleType: null, materialCost: 0, cpCost: 1, name: 'Rally' })
    const r = applyAction(g, 'alice', { type: 'PLAY_ABILITY_CARD', instanceId: card.instanceId })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.a.hand).toHaveLength(0)
    expect(r.game.state.resources.a.cp).toBe(2)
    expect(r.game.state.log.some((l) => l.includes('Rally resolved'))).toBe(true)
    // Spent ability cards land in the discard (state.destroyed) — Task 4.
    expect(r.game.state.destroyed.a).toHaveLength(1)
    expect(r.game.state.destroyed.a[0]).toMatchObject({ name: 'Rally' })
    expect(r.game.state.destroyed.a[0]).not.toHaveProperty('instanceId')
  })
  it('rejects playing a vehicle via the ability action', () => {
    const { g, card } = withHand({ type: 'vehicle', vehicleType: 'ship' })
    expect(applyAction(g, 'alice', { type: 'PLAY_ABILITY_CARD', instanceId: card.instanceId }))
      .toMatchObject({ ok: false, status: 400 })
  })
})

describe('effectiveCostInGame', () => {
  it('applies a registered cost modifier before the Half-Cost halving, clamping at 0', () => {
    registerCostModifier('testDiscount', () => -30_000)
    const state = makeGame().state
    const plain = inst({ materialCost: 100_000, meta: { costModifier: 'testDiscount' } })
    const halved = inst({ materialCost: 100_000, keywords: ['halfCost'], meta: { costModifier: 'testDiscount' } })
    const cheap = inst({ materialCost: 10_000, meta: { costModifier: 'testDiscount' } })
    expect(effectiveCostInGame(state, 'a', plain)).toBe(70_000)
    expect(effectiveCostInGame(state, 'a', halved)).toBe(35_000)   // (100k−30k)/2
    expect(effectiveCostInGame(state, 'a', cheap)).toBe(0)          // clamped
  })
  it('ignores unimplemented modifier names', () => {
    const card = inst({ materialCost: 50_000, meta: { costModifier: 'mysteryModifier' } })
    expect(effectiveCostInGame(makeGame().state, 'a', card)).toBe(50_000)
  })
})

describe('additionalSpawns', () => {
  it('lands N+1 entries in the zone, distinct instanceIds, all playedOnTurn stamped, cost paid ONCE', () => {
    const { g, card } = withHand({ vehicleType: 'ship', materialCost: 40000, meta: { additionalSpawns: 2 } })
    const r = applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    const entries = r.game.state.zones[0].cards.a
    expect(entries).toHaveLength(3)
    const ids = entries.map((e) => e.instanceId)
    expect(new Set(ids).size).toBe(3)
    for (const e of entries) expect(e).toMatchObject({ playedOnTurn: 2, movedOnTurn: null })
    expect(r.game.state.resources.a.materials).toBe(60000) // 100000 - 40000, paid once
  })

  // Two caps in series. ADDITIONAL_SPAWNS_CAP clamps the runaway meta value
  // (99 → 10); MAX_VEHICLES_PER_ZONE_SIDE then clamps what the board accepts
  // (11 → 8), and since it is the smaller of the two it is what lands.
  //
  // ADDITIONAL_SPAWNS_CAP is therefore no longer observable in the hull COUNT
  // — but it is still load-bearing, and the log line is where that shows: the
  // player is told 3 copies were dropped (11 − 8), not 92. Asserting the
  // count alone would let ADDITIONAL_SPAWNS_CAP be deleted with the suite
  // still green.
  it('applies ADDITIONAL_SPAWNS_CAP first, then the zone cap bounds what lands', () => {
    const { g, card } = withHand({ vehicleType: 'ship', materialCost: 10000, meta: { additionalSpawns: 99 } })
    const r = applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a).toHaveLength(MAX_VEHICLES_PER_ZONE_SIDE)
    const dropped = ADDITIONAL_SPAWNS_CAP + 1 - MAX_VEHICLES_PER_ZONE_SIDE
    expect(r.game.state.log).toContain(
      `Zone 1 is full — ${dropped} further ${card.name} could not deploy`,
    )
  })

  it('spawns none when meta additionalSpawns is non-numeric', () => {
    const { g, card } = withHand({ vehicleType: 'ship', materialCost: 10000, meta: { additionalSpawns: 'x' } })
    const r = applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a).toHaveLength(1)
  })

  it('spawns none when meta additionalSpawns is negative', () => {
    const { g, card } = withHand({ vehicleType: 'ship', materialCost: 10000, meta: { additionalSpawns: -3 } })
    const r = applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a).toHaveLength(1)
  })
})

describe('play-pipeline effect dispatch', () => {
  it('vehicle with onPlayEffect marauderOnPlay takes an enemy vehicle and discounts it by 50k after deploy', () => {
    const { g, card } = withHand({ vehicleType: 'ship', materialCost: 10000, meta: { onPlayEffect: 'marauderOnPlay' } })
    g.privates.b.deck.push(inst({ name: 'Enemy Ship', type: 'vehicle', materialCost: 200000 }))
    g.state.counts.b.deck = 1
    const r = applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a).toHaveLength(1)
    expect(r.game.privates.a.hand.map((c) => c.name)).toEqual(['Enemy Ship'])
    expect(r.game.privates.a.hand[0].meta.costDelta).toBe(-50000)
    expect(r.game.state.resources.a.cp).toBe(3) // unchanged — Marauder's card text grants no CP
  })

  it('ability with unimplemented playOnZoneEffect t_ambushEffect played to zone 1 succeeds vanilla, no entry added', () => {
    const { g, card } = withHand({
      type: 'ability', vehicleType: null, materialCost: 0, name: 'Ambush',
      meta: { playOnZoneEffect: 't_ambushEffect' },
    })
    const r = applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a).toHaveLength(0)
    expect(r.game.privates.a.hand).toHaveLength(0)
    expect(r.game.state.log.some((l) => l.includes('Ambush') && l.includes('t_ambushEffect') && l.includes('vanilla')))
      .toBe(true)
  })

  it('vehicle with unimplemented onActivate deploys fine with exactly one vanilla note', () => {
    // A synthetic t_-prefixed stand-in, not a real seeded effect name
    // (docs/claude/testing.md). Registering the real name here would NOT
    // have made this test pass silently: noteUnimplemented
    // (shared/effects/registry.ts, ~lines 66-82) pushes its "plays as
    // vanilla" note only via `if (isImplemented(name)) continue` — i.e.
    // only when the name is NOT implemented — so once wave 3 registered
    // eclipseEffect for real, a fixture still naming it here would have
    // lost its log line and failed loudly instead (toHaveLength(1) -> 0).
    // The rename is still worth doing: it decouples this fixture from
    // Eclipse's registration state, so the test keeps exercising the
    // unimplemented path indefinitely, rather than going red — for a
    // reason unrelated to what it's meant to check — the moment a real
    // card is built. Wave 5 renamed the last two offenders — its own
    // ambushEffect and sabotageEffect — for exactly that reason, so every
    // stand-in in this file is now synthetic.
    const { g, card } = withHand({
      vehicleType: 'ship', materialCost: 10000, name: 'Some Ship',
      meta: { onActivate: 't_unimplementedOnActivate' },
    })
    const r = applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a).toHaveLength(1)
    const notes = r.game.state.log.filter((l) => l.includes('t_unimplementedOnActivate'))
    expect(notes).toHaveLength(1)
  })

  it('implemented effect returning false rejects atomically — nothing sticks', () => {
    registerEffect('testAlwaysFail', () => false)
    const { g, card } = withHand({
      type: 'ability', vehicleType: null, materialCost: 5000, cpCost: 1, name: 'Doomed Gambit',
      meta: { onPlayEffect: 'testAlwaysFail' },
    })
    const r = applyAction(g, 'alice', { type: 'PLAY_ABILITY_CARD', instanceId: card.instanceId })
    expect(r).toMatchObject({ ok: false, status: 400, error: "Doomed Gambit's effect could not resolve — check its target" })
    expect(g.privates.a.hand).toHaveLength(1)
    expect(g.state.resources.a.materials).toBe(100000)
    expect(g.state.resources.a.cp).toBe(3)
  })
})

describe('PLAY_ABILITY_CARD rejects cards that need a target', () => {
  it('rejects a card with playOnZoneEffect meta', () => {
    const { g, card } = withHand({
      type: 'ability', vehicleType: null, materialCost: 0, name: 'Ambush',
      meta: { playOnZoneEffect: 't_ambushEffect' },
    })
    const r = applyAction(g, 'alice', { type: 'PLAY_ABILITY_CARD', instanceId: card.instanceId })
    expect(r).toMatchObject({ ok: false, status: 400, error: 'Ambush needs a target' })
    expect(g.privates.a.hand).toHaveLength(1)
    expect(g.state.resources.a.materials).toBe(100000)
  })

  it('rejects a card with playOnVehicleEffect meta', () => {
    const { g, card } = withHand({
      type: 'ability', vehicleType: null, materialCost: 0, name: 'Tactical Strike',
      meta: { playOnVehicleEffect: 'someVehicleEffect' },
    })
    const r = applyAction(g, 'alice', { type: 'PLAY_ABILITY_CARD', instanceId: card.instanceId })
    expect(r).toMatchObject({ ok: false, status: 400, error: 'Tactical Strike needs a target' })
    expect(g.privates.a.hand).toHaveLength(1)
    expect(g.state.resources.a.materials).toBe(100000)
  })

  it("rejects Double Up (its real meta) needing a card target", () => {
    const { g, card } = withHand({
      type: 'ability', vehicleType: null, materialCost: 0, name: 'Double Up',
      meta: { playOnCardEffect: 'doubleUpEffect' },
    })
    const r = applyAction(g, 'alice', { type: 'PLAY_ABILITY_CARD', instanceId: card.instanceId })
    expect(r).toMatchObject({ ok: false, status: 400, error: 'Double Up needs a target' })
    expect(g.privates.a.hand).toHaveLength(1)
    expect(g.state.resources.a.materials).toBe(100000)
  })
})

describe('PLAY_CARD_TO_ZONE ability-to-zone branch', () => {
  it("requires playOnZoneEffect meta — a plain ability is rejected with the vehicles-only message", () => {
    const { g, card } = withHand({ type: 'ability', vehicleType: null, materialCost: 0, name: 'Rally' })
    const r = applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 })
    expect(r).toMatchObject({ ok: false, status: 400, error: 'Ability cards are played without a zone' })
  })

  it('imposes no zone-legality restriction for a zone-targeted ability (any zone is fine)', () => {
    const { g, card } = withHand({
      type: 'ability', vehicleType: null, materialCost: 0, name: 'Ambush',
      meta: { playOnZoneEffect: 't_ambushEffect' },
    })
    const r = applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 3 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[2].cards.a).toHaveLength(0) // no entry pushed for abilities
    expect(r.game.privates.a.hand).toHaveLength(0)
    // A zone-targeted ability is spent, not a vehicle — it must land in the discard.
    expect(r.game.state.destroyed.a).toHaveLength(1)
    expect(r.game.state.destroyed.a[0]).toMatchObject({ name: 'Ambush' })
    expect(r.game.state.destroyed.a[0]).not.toHaveProperty('instanceId')
  })

  it('still enforces the vehicle-only illegal-zone message for vehicles', () => {
    const { g, card } = withHand({ vehicleType: 'tank' })
    expect(applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }))
      .toMatchObject({ ok: false, status: 400, error: 'That vehicle cannot deploy to that zone' })
  })

  it('rejects a nonexistent zoneId for a zone-targeted ability, nothing spent', () => {
    const { g, card } = withHand({
      type: 'ability', vehicleType: null, materialCost: 5000, cpCost: 1, name: 'Ambush',
      meta: { playOnZoneEffect: 't_ambushEffect' },
    })
    const r = applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 99 })
    expect(r).toMatchObject({ ok: false, status: 400, error: 'No such zone' })
    expect(g.privates.a.hand).toHaveLength(1)
    expect(g.state.resources.a.materials).toBe(100000)
    expect(g.state.resources.a.cp).toBe(3)
  })
})

describe('PLAY_CARD_TARGETING_CARD_IN_HAND', () => {
  it('Double Up end-to-end: buffs a DWG vehicle in hand, pays, and leaves the hand', () => {
    const { g, card: doubleUp } = withHand({
      type: 'ability', vehicleType: null, materialCost: 5000, cpCost: 1, name: 'Double Up',
      meta: { playOnCardEffect: 'doubleUpEffect' },
    })
    const target = inst({ type: 'vehicle', faction: 'DWG', materialCost: 100000 })
    g.privates.a.hand.push(target)
    g.state.counts.a.hand = 2
    const r = applyAction(g, 'alice', {
      type: 'PLAY_CARD_TARGETING_CARD_IN_HAND', instanceId: doubleUp.instanceId, targetInstanceId: target.instanceId,
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.a.hand).toHaveLength(1)
    expect(r.game.privates.a.hand[0].instanceId).toBe(target.instanceId)
    expect(r.game.privates.a.hand[0].meta.additionalSpawns).toBe(1)
    expect(r.game.state.counts.a.hand).toBe(1)
    expect(r.game.state.resources.a.materials).toBe(95000) // 100000 - 5000
    expect(r.game.state.resources.a.cp).toBe(2) // 3 - 1
    // Double Up itself is the spent ability card (the target stays in hand, buffed).
    expect(r.game.state.destroyed.a).toHaveLength(1)
    expect(r.game.state.destroyed.a[0]).toMatchObject({ name: 'Double Up' })
    expect(r.game.state.destroyed.a[0]).not.toHaveProperty('instanceId')
  })

  it('then playing the buffed vehicle spawns 2 entries', () => {
    const { g, card: doubleUp } = withHand({
      type: 'ability', vehicleType: null, materialCost: 0, name: 'Double Up',
      meta: { playOnCardEffect: 'doubleUpEffect' },
    })
    const target = inst({ type: 'vehicle', faction: 'DWG', vehicleType: 'ship', materialCost: 40000 })
    g.privates.a.hand.push(target)
    g.state.counts.a.hand = 2
    const r1 = applyAction(g, 'alice', {
      type: 'PLAY_CARD_TARGETING_CARD_IN_HAND', instanceId: doubleUp.instanceId, targetInstanceId: target.instanceId,
    })
    if (!r1.ok) throw new Error(r1.error)
    const r2 = applyAction(
      r1.game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: target.instanceId, zoneId: 1 }, makeCtx(),
    )
    if (!r2.ok) throw new Error(r2.error)
    expect(r2.game.state.zones[0].cards.a).toHaveLength(2)
    const ids = r2.game.state.zones[0].cards.a.map((e) => e.instanceId)
    expect(new Set(ids).size).toBe(2)
  })

  it('Double Up on an over-cost (800k) target fails atomically — nothing spent, additionalSpawns unset', () => {
    const { g, card: doubleUp } = withHand({
      type: 'ability', vehicleType: null, materialCost: 5000, name: 'Double Up',
      meta: { playOnCardEffect: 'doubleUpEffect' },
    })
    const target = inst({ type: 'vehicle', faction: 'DWG', materialCost: 800000 })
    g.privates.a.hand.push(target)
    g.state.counts.a.hand = 2
    const r = applyAction(g, 'alice', {
      type: 'PLAY_CARD_TARGETING_CARD_IN_HAND', instanceId: doubleUp.instanceId, targetInstanceId: target.instanceId,
    })
    expect(r).toMatchObject({ ok: false, status: 400 })
    expect(g.privates.a.hand).toHaveLength(2)
    expect(g.state.resources.a.materials).toBe(100000)
    expect(target.meta.additionalSpawns).toBeUndefined()
  })

  it('rejects a card lacking playOnCardEffect meta', () => {
    const { g, card } = withHand({ type: 'ability', vehicleType: null, materialCost: 0, name: 'Rally' })
    const target = inst({ type: 'vehicle', faction: 'DWG', materialCost: 40000 })
    g.privates.a.hand.push(target)
    g.state.counts.a.hand = 2
    expect(applyAction(g, 'alice', {
      type: 'PLAY_CARD_TARGETING_CARD_IN_HAND', instanceId: card.instanceId, targetInstanceId: target.instanceId,
    })).toMatchObject({ ok: false, status: 400 })
    expect(g.privates.a.hand).toHaveLength(2)
  })

  it('rejects targeting itself', () => {
    const { g, card } = withHand({
      type: 'ability', vehicleType: null, materialCost: 0, name: 'Double Up',
      meta: { playOnCardEffect: 'doubleUpEffect' },
    })
    expect(applyAction(g, 'alice', {
      type: 'PLAY_CARD_TARGETING_CARD_IN_HAND', instanceId: card.instanceId, targetInstanceId: card.instanceId,
    })).toMatchObject({ ok: false, status: 400 })
    expect(g.privates.a.hand).toHaveLength(1)
  })

  it('rejects missing or non-string targetInstanceId', () => {
    const { g, card } = withHand({
      type: 'ability', vehicleType: null, materialCost: 0, name: 'Double Up',
      meta: { playOnCardEffect: 'doubleUpEffect' },
    })
    expect(applyAction(
      g, 'alice', { type: 'PLAY_CARD_TARGETING_CARD_IN_HAND', instanceId: card.instanceId } as never,
    )).toMatchObject({ ok: false, status: 400 })
    expect(applyAction(
      g, 'alice',
      { type: 'PLAY_CARD_TARGETING_CARD_IN_HAND', instanceId: card.instanceId, targetInstanceId: 123 } as never,
    )).toMatchObject({ ok: false, status: 400 })
  })
})

describe('deployVehicle extraction and PLAY_CARD_TARGETING_CARD_IN_HAND hand direction (Task 4)', () => {
  // Synthetic playOnCardEffect stand-in shaped like Excalibur ("pick a card
  // in hand and discount it") — never a real seeded effect name.
  registerEffect('t_handTargetVehicle', ({ game, actor, targetInstanceId }) => {
    if (typeof targetInstanceId !== 'string') return false
    const target = game.privates[actor].hand.find((c) => c.instanceId === targetInstanceId)
    if (!target) return false
    target.meta = { ...target.meta, costDelta: -200_000 }
    return true
  })

  // Test 1: regression over the extraction — same placement count as before,
  // and proof the surge is still read BEFORE pay() reduces materials.
  it('PLAY_CARD_TO_ZONE still lands additionalSpawns + resourceSurge hulls, surge read before payment', () => {
    const { g, card } = withHand({
      vehicleType: 'ship', materialCost: 60_000,
      meta: { additionalSpawns: 1, resourceSurge: { materialsAtLeast: 100_000, extraSpawns: 1 } },
    })
    g.state.resources.a.materials = 100_000 // exactly at the surge threshold
    const r = applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    // card itself + printed additionalSpawns(1) + surge extraSpawns(1) = 3.
    // If the surge read moved to AFTER pay(), materials would already be
    // 100000-60000=40000 (under the 100000 threshold) by the time it's
    // checked, suppressing the surge extra and landing only 2.
    expect(r.game.state.zones[0].cards.a).toHaveLength(3)
    const ids = r.game.state.zones[0].cards.a.map((e) => e.instanceId)
    expect(new Set(ids).size).toBe(3)
    for (const e of r.game.state.zones[0].cards.a) {
      expect(e).toMatchObject({ playedOnTurn: g.turnNumber, movedOnTurn: null })
    }
    expect(r.game.state.resources.a.materials).toBe(40_000)
  })

  // Test 2: the DP6 hand direction itself — deploy AND fire, and never leak
  // the hand target's name into the public log.
  it('a vehicle carrying playOnCardEffect deploys to a legal zoneId and fires the effect on the hand target', () => {
    const { g, card } = withHand({
      vehicleType: 'ship', materialCost: 550_000, name: 'Excalibur Stand-in',
      meta: { playOnCardEffect: 't_handTargetVehicle' },
    })
    g.state.resources.a.materials = 600_000
    const target = inst({ type: 'vehicle', faction: 'AI', materialCost: 300_000, name: 'Secret AI Ship' })
    g.privates.a.hand.push(target)
    g.state.counts.a.hand = 2
    const r = applyAction(g, 'alice', {
      type: 'PLAY_CARD_TARGETING_CARD_IN_HAND',
      instanceId: card.instanceId, targetInstanceId: target.instanceId, zoneId: 1,
    }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a).toHaveLength(1)
    expect(r.game.state.zones[0].cards.a[0].instanceId).toBe(card.instanceId)
    expect(r.game.privates.a.hand).toHaveLength(1)
    expect(r.game.privates.a.hand[0].instanceId).toBe(target.instanceId)
    expect(r.game.privates.a.hand[0].meta.costDelta).toBe(-200_000)
    // state.log is public to both players — the target sits in the actor's
    // OWN hand, but naming it still leaks hand contents to the opponent.
    expect(r.game.state.log.some((l) => l.includes('Secret AI Ship'))).toBe(false)
    expect(r.game.state.log.some((l) => l.includes('deployed to zone 1'))).toBe(true)
  })

  // Test 3: no zoneId at all is rejected.
  it('rejects the same play with no zoneId', () => {
    const { g, card } = withHand({
      vehicleType: 'ship', materialCost: 550_000, name: 'Excalibur Stand-in',
      meta: { playOnCardEffect: 't_handTargetVehicle' },
    })
    g.state.resources.a.materials = 600_000
    const target = inst({ type: 'vehicle', faction: 'AI', materialCost: 300_000 })
    g.privates.a.hand.push(target)
    g.state.counts.a.hand = 2
    const r = applyAction(g, 'alice', {
      type: 'PLAY_CARD_TARGETING_CARD_IN_HAND', instanceId: card.instanceId, targetInstanceId: target.instanceId,
    })
    expect(r).toMatchObject({ ok: false, status: 400 })
    expect(g.privates.a.hand).toHaveLength(2)
    expect(g.state.resources.a.materials).toBe(600_000)
  })

  // Test 4: an illegal zoneId for the hull's biome is rejected — legalZonesFor
  // still gates it.
  it("rejects the same play with an illegal zoneId for the hull's biome", () => {
    const { g, card } = withHand({
      vehicleType: 'ship', materialCost: 550_000, name: 'Excalibur Stand-in',
      meta: { playOnCardEffect: 't_handTargetVehicle' },
    })
    g.state.resources.a.materials = 600_000
    const target = inst({ type: 'vehicle', faction: 'AI', materialCost: 300_000 })
    g.privates.a.hand.push(target)
    g.state.counts.a.hand = 2
    // zone 3 is land; a ship's legal biomes are water/beach (zones 1 and 2).
    expect(legalZonesFor(g.state, 'a', card)).toEqual([1, 2])
    const r = applyAction(g, 'alice', {
      type: 'PLAY_CARD_TARGETING_CARD_IN_HAND',
      instanceId: card.instanceId, targetInstanceId: target.instanceId, zoneId: 3,
    })
    expect(r).toMatchObject({ ok: false, status: 400 })
    expect(g.privates.a.hand).toHaveLength(2)
    expect(g.state.resources.a.materials).toBe(600_000)
  })

  // Test 5: not spendCard'd — it is a hull, not a spent ability.
  it('the vehicle is not spendCard-ed: it stays on the board and is absent from state.destroyed', () => {
    const { g, card } = withHand({
      vehicleType: 'ship', materialCost: 550_000, name: 'Excalibur Stand-in',
      meta: { playOnCardEffect: 't_handTargetVehicle' },
    })
    g.state.resources.a.materials = 600_000
    const target = inst({ type: 'vehicle', faction: 'AI', materialCost: 300_000 })
    g.privates.a.hand.push(target)
    g.state.counts.a.hand = 2
    const r = applyAction(g, 'alice', {
      type: 'PLAY_CARD_TARGETING_CARD_IN_HAND',
      instanceId: card.instanceId, targetInstanceId: target.instanceId, zoneId: 1,
    }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a.map((e) => e.instanceId)).toContain(card.instanceId)
    expect(r.game.state.destroyed.a).toHaveLength(0)
  })

  // Test 6: ability regression — behaves exactly as before, with or without
  // a stray zoneId (which it must ignore).
  it('an ability carrying playOnCardEffect still plays exactly as before, with or without a stray zoneId', () => {
    const run = (withZoneId: boolean) => {
      const { g, card: ability } = withHand({
        type: 'ability', vehicleType: null, materialCost: 5000, cpCost: 1, name: 'Hand Order',
        meta: { playOnCardEffect: 't_handTargetVehicle' },
      })
      const target = inst({ type: 'vehicle', faction: 'AI', materialCost: 300_000 })
      g.privates.a.hand.push(target)
      g.state.counts.a.hand = 2
      const r = withZoneId
        ? applyAction(g, 'alice', {
            type: 'PLAY_CARD_TARGETING_CARD_IN_HAND',
            instanceId: ability.instanceId, targetInstanceId: target.instanceId, zoneId: 99,
          })
        : applyAction(g, 'alice', {
            type: 'PLAY_CARD_TARGETING_CARD_IN_HAND',
            instanceId: ability.instanceId, targetInstanceId: target.instanceId,
          })
      if (!r.ok) throw new Error(r.error)
      expect(r.game.state.zones[0].cards.a).toHaveLength(0)
      expect(r.game.privates.a.hand).toHaveLength(1)
      expect(r.game.privates.a.hand[0].instanceId).toBe(target.instanceId)
      expect(r.game.privates.a.hand[0].meta.costDelta).toBe(-200_000)
      expect(r.game.state.destroyed.a).toHaveLength(1)
      expect(r.game.state.destroyed.a[0]).toMatchObject({ name: 'Hand Order' })
      expect(r.game.state.destroyed.a[0]).not.toHaveProperty('instanceId')
      expect(r.game.state.log.some((l) => l === 'Hand Order resolved')).toBe(true)
    }
    run(false)
    run(true) // zoneId: 99 doesn't even exist as a zone — still ignored
  })

  // Test 7: the no-legal-target escape — plain PLAY_CARD_TO_ZONE deploys a
  // playOnCardEffect vehicle fine and never dispatches the effect.
  it('a vehicle carrying playOnCardEffect played through plain PLAY_CARD_TO_ZONE deploys without firing it (spec §4.3 departure 4)', () => {
    const { g, card } = withHand({
      vehicleType: 'ship', materialCost: 550_000, name: 'Excalibur Stand-in',
      meta: { playOnCardEffect: 't_handTargetVehicle' },
    })
    g.state.resources.a.materials = 600_000
    const r = applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a).toHaveLength(1)
    expect(r.game.state.zones[0].cards.a[0].instanceId).toBe(card.instanceId)
    expect(r.game.privates.a.hand).toHaveLength(0)
    // t_handTargetVehicle IS implemented, so silence (no "not implemented"
    // note, no trace of the effect name) is exactly what proves it never
    // dispatched through this path — PLAY_CARD_TO_ZONE's trigger keys are
    // ['playOnZoneEffect', 'onPlayEffect'] only.
    expect(r.game.state.log.some((l) => l.includes('t_handTargetVehicle'))).toBe(false)
    expect(r.game.state.log.some((l) => l.includes('deployed to zone 1'))).toBe(true)
  })

  // Review fix: test 1 only pins surge-before-pay ordering for
  // PLAY_CARD_TO_ZONE. This mirrors it for the hand-target path itself —
  // same numbers as test 1, so the same "read after pay would under-spawn"
  // failure mode is independently caught at this call site too.
  it('PLAY_CARD_TARGETING_CARD_IN_HAND also lands additionalSpawns + resourceSurge hulls, surge read before payment', () => {
    const { g, card } = withHand({
      vehicleType: 'ship', materialCost: 60_000, name: 'Surge Stand-in',
      meta: {
        additionalSpawns: 1, resourceSurge: { materialsAtLeast: 100_000, extraSpawns: 1 },
        playOnCardEffect: 't_handTargetVehicle',
      },
    })
    g.state.resources.a.materials = 100_000 // exactly at the surge threshold
    const target = inst({ type: 'vehicle', faction: 'AI', materialCost: 300_000 })
    g.privates.a.hand.push(target)
    g.state.counts.a.hand = 2
    const r = applyAction(g, 'alice', {
      type: 'PLAY_CARD_TARGETING_CARD_IN_HAND',
      instanceId: card.instanceId, targetInstanceId: target.instanceId, zoneId: 1,
    }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    // card itself + printed additionalSpawns(1) + surge extraSpawns(1) = 3.
    // If this handler's surge read moved to after pay(), materials would
    // already be 100000-60000=40000 (under the 100000 threshold) by the time
    // it's checked, suppressing the surge extra and landing only 2.
    expect(r.game.state.zones[0].cards.a).toHaveLength(3)
    const ids = r.game.state.zones[0].cards.a.map((e) => e.instanceId)
    expect(new Set(ids).size).toBe(3)
    expect(r.game.state.resources.a.materials).toBe(40_000)
  })
})

describe('SET_ALERT_CARD', () => {
  it('reveals an ability card from hand, keeps it in hand, and logs the reveal', () => {
    const { g, card } = withHand({ type: 'ability', vehicleType: null, materialCost: 0, name: 'Ambush Alert' })
    const r = applyAction(g, 'alice', { type: 'SET_ALERT_CARD', instanceId: card.instanceId })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.alertCard).toEqual({
      side: 'a', instanceId: card.instanceId, name: 'Ambush Alert', setOnTurn: g.turnNumber,
    })
    expect(r.game.privates.a.hand).toHaveLength(1)
    expect(
      r.game.state.log.some((l) => l === 'Player A reveals Ambush Alert — effect in progress'),
    ).toBe(true)
  })

  it('rejects a vehicle card', () => {
    const { g, card } = withHand({ type: 'vehicle', vehicleType: 'ship' })
    expect(applyAction(g, 'alice', { type: 'SET_ALERT_CARD', instanceId: card.instanceId }))
      .toMatchObject({ ok: false, status: 400 })
  })

  it('rejects a card not in hand', () => {
    const g = makeGame()
    expect(applyAction(g, 'alice', { type: 'SET_ALERT_CARD', instanceId: 'ghost' }))
      .toMatchObject({ ok: false, status: 400 })
  })

  it("409s when the opponent's alert is already up", () => {
    const { g, card } = withHand({ type: 'ability', vehicleType: null, materialCost: 0, name: 'Counter' })
    g.state.alertCard = { side: 'b', instanceId: 'enemy-1', name: 'Enemy Alert', setOnTurn: 1 }
    expect(applyAction(g, 'alice', { type: 'SET_ALERT_CARD', instanceId: card.instanceId }))
      .toMatchObject({ ok: false, status: 409, error: 'An alert card is already revealed' })
  })

  it('replaces your own already-revealed alert', () => {
    const { g, card } = withHand({ type: 'ability', vehicleType: null, materialCost: 0, name: 'New Alert' })
    g.state.alertCard = { side: 'a', instanceId: 'old-id', name: 'Old Alert', setOnTurn: 1 }
    const r = applyAction(g, 'alice', { type: 'SET_ALERT_CARD', instanceId: card.instanceId })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.alertCard).toMatchObject({ side: 'a', instanceId: card.instanceId, name: 'New Alert' })
  })

  it('clears when the revealed instance is later played via PLAY_ABILITY_CARD', () => {
    const { g, card } = withHand({ type: 'ability', vehicleType: null, materialCost: 0, name: 'Rally' })
    const set = applyAction(g, 'alice', { type: 'SET_ALERT_CARD', instanceId: card.instanceId })
    if (!set.ok) throw new Error(set.error)
    expect(set.game.state.alertCard).not.toBeNull()
    const played = applyAction(set.game, 'alice', { type: 'PLAY_ABILITY_CARD', instanceId: card.instanceId })
    if (!played.ok) throw new Error(played.error)
    expect(played.game.state.alertCard).toBeNull()
  })

  it('is turn-gated by the generic guard: the off-turn player is rejected with 409', () => {
    const { g, card } = withHand({ type: 'ability', vehicleType: null, materialCost: 0, name: 'Ambush Alert' })
    expect(applyAction(g, 'bob', { type: 'SET_ALERT_CARD', instanceId: card.instanceId }))
      .toMatchObject({ ok: false, status: 409 })
  })

  it('is blocked by the generic battle-frozen guard while a battle is active', () => {
    const { g, card } = withHand({ type: 'ability', vehicleType: null, materialCost: 0, name: 'Ambush Alert' })
    g.state.activeBattle = {
      zoneId: 1, aggressor: 'a', attackerIds: ['x'], defenderIds: ['y'],
      distanceM: 1200, distanceModifiedBy: [],
    }
    expect(applyAction(g, 'alice', { type: 'SET_ALERT_CARD', instanceId: card.instanceId }))
      .toMatchObject({ ok: false, status: 409 })
  })
})

describe('PLAY_CARD_TARGETING_CARD_ON_FIELD', () => {
  it('unimplemented playOnVehicleEffect (t_sabotageEffect) targeting an enemy vehicle on the field succeeds vanilla', () => {
    const { g, card } = withHand({
      type: 'ability', vehicleType: null, materialCost: 0, name: 'Sabotage',
      meta: { playOnVehicleEffect: 't_sabotageEffect' },
    })
    const enemy = zoneEntry({ vehicleType: 'ship' })
    g.state.zones[0].cards.b.push(enemy)
    const r = applyAction(g, 'alice', {
      type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD', instanceId: card.instanceId, targetInstanceId: enemy.instanceId,
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.a.hand).toHaveLength(0)
    expect(
      r.game.state.log.some((l) => l.includes('Sabotage') && l.includes('t_sabotageEffect') && l.includes('vanilla')),
    ).toBe(true)
    // The spent targeting ability lands in the discard, same as any other ability play.
    expect(r.game.state.destroyed.a).toHaveLength(1)
    expect(r.game.state.destroyed.a[0]).toMatchObject({ name: 'Sabotage' })
    expect(r.game.state.destroyed.a[0]).not.toHaveProperty('instanceId')
  })

  it('rejects a nonexistent target instanceId', () => {
    const { g, card } = withHand({
      type: 'ability', vehicleType: null, materialCost: 0, name: 'Sabotage',
      meta: { playOnVehicleEffect: 't_sabotageEffect' },
    })
    expect(applyAction(g, 'alice', {
      type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD', instanceId: card.instanceId, targetInstanceId: 'ghost',
    })).toMatchObject({ ok: false, status: 400 })
    expect(g.privates.a.hand).toHaveLength(1)
  })

  it('rejects a card lacking playOnVehicleEffect meta', () => {
    const { g, card } = withHand({ type: 'ability', vehicleType: null, materialCost: 0, name: 'Rally' })
    const enemy = zoneEntry({ vehicleType: 'ship' })
    g.state.zones[0].cards.b.push(enemy)
    expect(applyAction(g, 'alice', {
      type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD', instanceId: card.instanceId, targetInstanceId: enemy.instanceId,
    })).toMatchObject({ ok: false, status: 400 })
    expect(g.privates.a.hand).toHaveLength(1)
  })

  it('rejects missing or non-string targetInstanceId', () => {
    const { g, card } = withHand({
      type: 'ability', vehicleType: null, materialCost: 0, name: 'Sabotage',
      meta: { playOnVehicleEffect: 't_sabotageEffect' },
    })
    expect(applyAction(
      g, 'alice', { type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD', instanceId: card.instanceId } as never,
    )).toMatchObject({ ok: false, status: 400 })
    expect(applyAction(
      g, 'alice',
      { type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD', instanceId: card.instanceId, targetInstanceId: 42 } as never,
    )).toMatchObject({ ok: false, status: 400 })
  })
})

describe('effectiveCostInGame — costDelta', () => {
  it('subtracts a stored costDelta from the printed cost', () => {
    const game = makeGame()
    const card = inst({ materialCost: 550_000, meta: { costDelta: -200_000 } })
    expect(effectiveCostInGame(game.state, 'a', card)).toBe(350_000)
  })

  it('clamps at zero', () => {
    const game = makeGame()
    const card = inst({ materialCost: 40_000, meta: { costDelta: -100_000 } })
    expect(effectiveCostInGame(game.state, 'a', card)).toBe(0)
  })

  it('applies before the Half-Cost halving', () => {
    const game = makeGame()
    const card = inst({ materialCost: 500_000, keywords: [KEYWORDS.HALF_COST], meta: { costDelta: -100_000 } })
    expect(effectiveCostInGame(game.state, 'a', card)).toBe(200_000)
  })

  it('never reaches effectiveMaterialCostOf', () => {
    const card = inst({ materialCost: 550_000, meta: { costDelta: -200_000 } })
    expect(effectiveMaterialCostOf(card)).toBe(550_000)
  })
})

const PREDATOR_META = { resourceSurge: { materialsOver: 120_000, extraSpawns: 1 } }
const ORBIT_META = { resourceSurge: { materialsAtLeast: 140_000, extraSpawns: 1 } }

describe('resourceSurge — conditional Half-Cost suppression', () => {
  const priced = (materials: number, meta: Record<string, unknown>, cost: number) => {
    const game = makeGame()
    game.state.resources.a.materials = materials
    const card = inst({ materialCost: cost, keywords: [KEYWORDS.HALF_COST], meta })
    return effectiveCostInGame(game.state, 'a', card)
  }

  it('PredatorX halves below the threshold', () => {
    expect(priced(120_000, PREDATOR_META, 120_000)).toBe(60_000)
  })

  it('PredatorX charges full price strictly above the threshold', () => {
    expect(priced(120_001, PREDATOR_META, 120_000)).toBe(120_000)
  })

  it('Orbit charges full price at exactly the threshold', () => {
    expect(priced(140_000, ORBIT_META, 140_000)).toBe(140_000)
  })

  it('Orbit halves below the threshold', () => {
    expect(priced(139_999, ORBIT_META, 140_000)).toBe(70_000)
  })

  it('leaves effectiveMaterialCostOf alone', () => {
    const card = inst({ materialCost: 120_000, keywords: [KEYWORDS.HALF_COST], meta: PREDATOR_META })
    expect(effectiveMaterialCostOf(card)).toBe(60_000)
  })
})

describe('resourceSurge — the extra hull', () => {
  const deploy = (materials: number) => {
    const card = inst({
      name: 'PredatorX', vehicleType: 'plane', materialCost: 120_000,
      keywords: [KEYWORDS.HALF_COST, KEYWORDS.TEMPORARY], meta: PREDATOR_META,
    })
    const game = makeGame({ privates: { a: { hand: [card], deck: [] }, b: { hand: [], deck: [] } } })
    game.state.resources.a.materials = materials
    const r = applyAction(game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    return r.game
  }

  it('lands two hulls when surged, charging full price', () => {
    const game = deploy(200_000)
    expect(game.state.zones[0].cards.a).toHaveLength(2)
    expect(game.state.resources.a.materials).toBe(80_000)
  })

  it('lands one hull at half price when not surged', () => {
    const game = deploy(100_000)
    expect(game.state.zones[0].cards.a).toHaveLength(1)
    expect(game.state.resources.a.materials).toBe(40_000)
  })

  it('the landed hulls keep their printed Half-Cost keyword', () => {
    const game = deploy(200_000)
    for (const entry of game.state.zones[0].cards.a) {
      expect(entry.keywords).toContain(KEYWORDS.HALF_COST)
    }
  })
})

describe('captured cards', () => {
  // Paddlegun copies whatever sits on top of the enemy deck, abilities
  // included, and an ability leaves play down a different exit than a
  // vehicle (spendCard, not a battle death). It is destroyed just the same.
  it('spends a captured ability copy into neither discard, leaving the original', () => {
    const g = makeGame()
    g.privates.b.deck.push(inst({ name: 'Enemy Order', type: 'ability', vehicleType: null, materialCost: 0 }))
    g.state.counts.b.deck = 1
    effectFor('paddlegunEffect')!({ game: g, actor: 'a', card: inst({ name: 'Paddlegun' }), ctx: makeCtx() })
    const card = g.privates.a.hand[0]
    const r = applyAction(g, 'alice', { type: 'PLAY_ABILITY_CARD', instanceId: card.instanceId }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.destroyed.a).toHaveLength(0)
    expect(r.game.state.destroyed.b).toHaveLength(0)
    expect(r.game.privates.b.deck.map((c) => c.name)).toEqual(['Enemy Order'])
  })
})

describe('captured cards spawn hulls for their captor', () => {
  it("keeps the captured copy's stamp on its own hull but not on the extras", () => {
    const g = makeGame()
    g.privates.b.deck.push(inst({
      name: 'Swarm', vehicleType: 'ship', materialCost: 0, meta: { additionalSpawns: 1 },
    }))
    g.state.counts.b.deck = 1
    takeFromEnemyDeck(g, 'a', makeCtx())
    const card = g.privates.a.hand[0]
    const r = applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    const hulls = r.game.state.zones[0].cards.a
    expect(hulls).toHaveLength(2)
    expect(hulls.map((c) => c.meta.capturedCopy)).toEqual([true, undefined])
  })
})

// ===========================================================================
// Wave 6 — resourceSurge's two departures from spec §4.6 (see "4.6 as wave 6
// extended it"). Chrysaor needs a surge that RAISES the price; Paladin needs
// one that GRANTS keywords onto the hull, which §4.6 originally ruled out.
// ===========================================================================

const CHRYSAOR_META = {
  resourceSurge: { materialsOver: 200_000, extraSpawns: 1, costDelta: 100_000 },
}
const PALADIN_META = {
  resourceSurge: { materialsUnder: 240_000, grantKeywords: [KEYWORDS.HALF_COST, KEYWORDS.TEMPORARY] },
}

describe('resourceSurge — Chrysaor raises its own price', () => {
  const chrysaor = () => inst({
    name: 'Chrysaor', vehicleType: 'ship', materialCost: 100_000,
    keywords: [KEYWORDS.STEALTHY], meta: CHRYSAOR_META,
  })
  const priced = (materials: number) => {
    const game = makeGame()
    game.state.resources.a.materials = materials
    return effectiveCostInGame(game.state, 'a', chrysaor())
  }
  const deploy = (materials: number) => {
    const card = chrysaor()
    const game = makeGame({ privates: { a: { hand: [card], deck: [] }, b: { hand: [], deck: [] } } })
    game.state.resources.a.materials = materials
    const r = applyAction(
      game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx(),
    )
    if (!r.ok) throw new Error(r.error)
    return r.game
  }

  it('charges the printed price at exactly the threshold — the text says "more than"', () => {
    expect(priced(200_000)).toBe(100_000)
  })

  it('charges 100k more strictly above the threshold', () => {
    expect(priced(200_001)).toBe(200_000)
  })

  it('lands one hull unsurged and two when surged', () => {
    expect(deploy(200_000).state.zones[0].cards.a).toHaveLength(1)
    expect(deploy(200_001).state.zones[0].cards.a).toHaveLength(2)
  })

  // Ruling B-10, and the exact regression the handoff warned about: pay()
  // reduces the materials the condition reads, so a post-payment re-read
  // would flip Chrysaor's own condition off between pricing and spawning.
  // 200_001 - 200_000 = 1, which is emphatically NOT "more than 200k".
  it('does not flip its own condition off by paying for itself', () => {
    const game = deploy(200_001)
    expect(game.state.resources.a.materials).toBe(1)
    expect(game.state.zones[0].cards.a).toHaveLength(2)
  })

  // Ruling B-6. A purchase-price mechanic like every other, so base damage,
  // repairs and in-battle resources still read the printed 100k.
  it('leaves effectiveMaterialCostOf and the landed keywords alone', () => {
    expect(effectiveMaterialCostOf(chrysaor())).toBe(100_000)
    for (const entry of deploy(200_001).state.zones[0].cards.a) {
      expect(entry.keywords).toEqual([KEYWORDS.STEALTHY])
    }
  })
})

describe('resourceSurge — Paladin grants keywords onto the hull', () => {
  const paladin = () => inst({
    name: 'Paladin', vehicleType: 'ship', materialCost: 240_000, keywords: [], meta: PALADIN_META,
  })
  const priced = (materials: number) => {
    const game = makeGame()
    game.state.resources.a.materials = materials
    return effectiveCostInGame(game.state, 'a', paladin())
  }
  const deploy = (materials: number, over: Record<string, unknown> = {}) => {
    const card = inst({ ...paladin(), ...over })
    const game = makeGame({ privates: { a: { hand: [card], deck: [] }, b: { hand: [], deck: [] } } })
    game.state.resources.a.materials = materials
    const r = applyAction(
      game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx(),
    )
    if (!r.ok) throw new Error(r.error)
    return r.game
  }

  it('charges full price at exactly the threshold — the text says "less than"', () => {
    expect(priced(240_000)).toBe(240_000)
  })

  it('halves the price below the threshold', () => {
    expect(priced(239_999)).toBe(120_000)
  })

  // Ruling B-7 (spec §4.6, departure 2). BOTH keywords land on the hull,
  // following the LH flyby hero power, which stamps exactly this pair.
  it('lands the hull carrying both halfCost and temporary when surged', () => {
    const entry = deploy(239_999).state.zones[0].cards.a[0]
    expect([...entry.keywords].sort()).toEqual([KEYWORDS.HALF_COST, KEYWORDS.TEMPORARY].sort())
  })

  it('lands a plain hull when not surged', () => {
    expect(deploy(240_000).state.zones[0].cards.a[0].keywords).toEqual([])
  })

  // The proof that `temporary` really reached the BOARD rather than only the
  // price: endTurn's cull reads the hull's keyword array, so a Paladin priced
  // as temporary but not stamped would never despawn.
  it('a surged Paladin is culled at the next turn start; an unsurged one is not', () => {
    for (const [materials, survivors] of [[239_999, 0], [240_000, 1]] as const) {
      const game = deploy(materials)
      const ended = applyAction(game, 'alice', { type: 'END_TURN' }, makeCtx())
      if (!ended.ok) throw new Error(ended.error)
      expect(ended.game.state.zones[0].cards.a).toHaveLength(survivors)
    }
  })

  it('stamps the granted keywords onto additionalSpawns copies too', () => {
    const game = deploy(239_999, { meta: { ...PALADIN_META, additionalSpawns: 1 } })
    const hulls = game.state.zones[0].cards.a
    expect(hulls).toHaveLength(2)
    for (const entry of hulls) expect(entry.keywords).toContain(KEYWORDS.TEMPORARY)
  })

  it('merges idempotently with a keyword the card already prints', () => {
    const game = deploy(239_999, { keywords: [KEYWORDS.TEMPORARY] })
    expect(game.state.zones[0].cards.a[0].keywords.filter((k) => k === KEYWORDS.TEMPORARY)).toHaveLength(1)
  })

  // Ruling B-8. "CAN be played with" describes the legality the condition
  // unlocks, not a per-play election — an offer would freeze the game on
  // every Paladin.
  it('never suspends on a choice', () => {
    expect(deploy(239_999).state.pendingEffect).toBeNull()
  })
})

// Ruling B-9's other arm. A surge with no grantKeywords of its own is still a
// Half-Cost SUPPRESSION, so the two older cards must be byte-for-byte
// unchanged by the extension above. Deliberately a separate test rather than
// trusting the block near PREDATOR_META to notice.
describe('resourceSurge — PredatorX and Orbit still lose Half-Cost', () => {
  const priced = (materials: number, meta: Record<string, unknown>, cost: number) => {
    const game = makeGame()
    game.state.resources.a.materials = materials
    return effectiveCostInGame(
      game.state, 'a', inst({ materialCost: cost, keywords: [KEYWORDS.HALF_COST], meta }),
    )
  }

  it('PredatorX pays full price when surged and half when not', () => {
    expect(priced(120_001, PREDATOR_META, 120_000)).toBe(120_000)
    expect(priced(120_000, PREDATOR_META, 120_000)).toBe(60_000)
  })

  it('Orbit pays full price when surged and half when not', () => {
    expect(priced(140_000, ORBIT_META, 140_000)).toBe(140_000)
    expect(priced(139_999, ORBIT_META, 140_000)).toBe(70_000)
  })
})

// ===========================================================================
// Wave 6 — DWG Albacore and Tarpon: "While this vehicle is alive, you may not
// play any other aircraft into this zone."
//
// A placement rule sourced from a HULL ON THE BOARD, read off a seeded data
// key rather than an effect name — the riderBlocks / blocksFaction precedent,
// so the next card wanting it needs no engine edit.
// ===========================================================================

describe('aircraftLock — Albacore and Tarpon', () => {
  const locker = (over: Record<string, unknown> = {}) => zoneEntry({
    name: 'Albacore', faction: 'DWG', vehicleType: 'airship',
    materialCost: 260_000, keywords: [KEYWORDS.FRAGILE],
    meta: { aircraftLock: true }, ...over,
  })
  // Zone 1 is water, 2 beach, 3 land — every one of them admits an aircraft,
  // so a missing zone in these lists is the lock and never a biome.
  const zonesFor = (vehicleType: string, place: (g: ReturnType<typeof makeGame>) => void) => {
    const g = makeGame()
    place(g)
    return legalZonesFor(g.state, 'a', inst({ vehicleType, faction: 'DWG' }))
  }

  it.each(['plane', 'airship'])('locks the zone against the owner own %s', (vehicleType) => {
    expect(zonesFor(vehicleType, (g) => { g.state.zones[0].cards.a.push(locker()) })).toEqual([2, 3])
  })

  // Ruling C-3: "any OTHER aircraft" falls out for free — a card in hand is by
  // definition not the hull already on the board, so a SECOND Albacore into
  // the same zone is blocked, and a Tarpon into an Albacore's zone is too.
  it('blocks a second locking airship into the same zone', () => {
    const g = makeGame()
    g.state.zones[0].cards.a.push(locker())
    const second = inst({ name: 'Tarpon', faction: 'DWG', vehicleType: 'airship', meta: { aircraftLock: true } })
    expect(legalZonesFor(g.state, 'a', second)).toEqual([2, 3])
  })

  // Compared against the same card with no locker on the board rather than
  // against a hard-coded list: a tank cannot enter zone 1 anyway (it is
  // water), so a literal expectation would pass for the wrong reason.
  it.each(['ship', 'sub', 'tank'])('leaves a non-aircraft %s exactly as it was', (vehicleType) => {
    const card = inst({ vehicleType, faction: 'DWG' })
    const clear = makeGame()
    const locked = makeGame()
    locked.state.zones[0].cards.a.push(locker())
    expect(legalZonesFor(locked.state, 'a', card)).toEqual(legalZonesFor(clear.state, 'a', card))
  })

  // Ruling C-1 (spec §7.3, wave 6), and the assertion that pins the pronoun.
  // "YOU may not play" restricts the OWNER — the opposite of AIR_SCREEN,
  // which the two rules now sit beside in the same function.
  it('an ENEMY locker does not block the actor aircraft', () => {
    expect(zonesFor('plane', (g) => { g.state.zones[0].cards.b.push(locker()) })).toEqual([1, 2, 3])
  })

  it('an AIR_SCREEN on the enemy still blocks, so the two rules do not shadow each other', () => {
    const g = makeGame()
    g.state.zones[0].cards.b.push(zoneEntry({ name: 'Screen', keywords: [KEYWORDS.AIR_SCREEN] }))
    g.state.zones[1].cards.a.push(locker())
    expect(legalZonesFor(g.state, 'a', inst({ vehicleType: 'plane' }))).toEqual([3])
  })

  it('PLAY_CARD_TO_ZONE refuses the locked zone through the handler', () => {
    const { g, card } = withHand({ vehicleType: 'plane', materialCost: 0, faction: 'DWG' })
    g.state.zones[0].cards.a.push(locker())
    const r = applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx())
    expect(r).toMatchObject({ ok: false, status: 400 })
  })

  // Ruling C-4: the lock reaches PLAYS and nothing else. Sub Killer's block
  // takes the same latitude, and §7.4 already exempts every other arrival.
  it('MOVE_VEHICLE still relocates an aircraft into a locked zone', () => {
    const g = makeGame({ turnNumber: 3 })
    g.state.zones[0].cards.a.push(locker())
    const mover = zoneEntry({
      name: 'Flyer', vehicleType: 'plane', keywords: [KEYWORDS.MOBILE], playedOnTurn: 2,
    })
    g.state.zones[1].cards.a.push(mover)
    const r = applyAction(g, 'alice', { type: 'MOVE_VEHICLE', instanceId: mover.instanceId, zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a.map((c) => c.name)).toEqual(['Albacore', 'Flyer'])
  })

  it('an additionalSpawns copy lands beside the lock its own play created', () => {
    const { g, card } = withHand({
      name: 'Albacore', vehicleType: 'airship', materialCost: 0, faction: 'DWG',
      meta: { aircraftLock: true, additionalSpawns: 1 },
    })
    const r = applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a).toHaveLength(2)
  })

  it('only a truthy aircraftLock locks — a mistyped value is not a lock', () => {
    for (const value of [false, null, 0, 'true']) {
      const g = makeGame()
      g.state.zones[0].cards.a.push(locker({ meta: { aircraftLock: value } }))
      expect(legalZonesFor(g.state, 'a', inst({ vehicleType: 'plane' }))).toEqual([1, 2, 3])
    }
  })
})

// ===========================================================================
// Wave 6 — WF Purifier: "This ship can only be played into a zone in which you
// have lost a fleet battle the previous turn."
//
// ⚠ Purifier gave the key up in the 2026-09-02 pass and no seeded card carries
// it now; these cases are hand-built fixtures, and they are what keeps the
// KEPT rule (placement.ts, spec R-8) honest for the frozen snapshots that
// still print it and for the next card that takes it. The 760_000 below is the
// PRE-pass price deliberately — these fixtures model exactly the snapshot the
// kept rule serves, not today's 750_000 Purifier.
//
// Ruling C-5 (spec §7.3, wave 6): "the previous turn" is the last FULL round,
// current turn included — lostBattleOnTurn >= turnNumber - 1. The counter moves
// in half steps, so the strictly-previous half-turn is the OPPONENT'S, and
// reading it that way would admit only a defensive loss.
// ===========================================================================

describe('deployRequiresBattleLoss — Purifier', () => {
  const purifier = () => inst({
    name: 'Purifier', faction: 'WF', vehicleType: 'ship', materialCost: 760_000,
    keywords: [KEYWORDS.HALF_COST, KEYWORDS.FRAGILE],
    meta: { deployRequiresBattleLoss: true, noBaseDamage: true },
  })
  // turnNumber 4: the window opens at 3 and takes everything at or above it.
  const zones = (place: (g: ReturnType<typeof makeGame>) => void, turnNumber = 4) => {
    const g = makeGame({ turnNumber })
    place(g)
    return legalZonesFor(g.state, 'a', purifier(), turnNumber)
  }

  it('offers no zone at all with no recorded loss', () => {
    expect(zones(() => {})).toEqual([])
  })

  it('offers exactly the zone the actor lost in', () => {
    expect(zones((g) => { g.state.zones[1].lostBattleOnTurn.a = 4 })).toEqual([2])
  })

  it('reads a loss on THIS turn — fresher wreckage is still wreckage', () => {
    expect(zones((g) => { g.state.zones[0].lostBattleOnTurn.a = 4 })).toEqual([1])
  })

  // The two sides of the ruling C-5 boundary. 4 - 1 = 3 is the actor's own
  // previous turn; 2.5 was a full round and a half ago.
  it('admits a loss one full turn back and refuses one older', () => {
    expect(zones((g) => { g.state.zones[0].lostBattleOnTurn.a = 3 })).toEqual([1])
    expect(zones((g) => { g.state.zones[0].lostBattleOnTurn.a = 3.5 })).toEqual([1])
    expect(zones((g) => { g.state.zones[0].lostBattleOnTurn.a = 2.5 })).toEqual([])
    expect(zones((g) => { g.state.zones[0].lostBattleOnTurn.a = 2 })).toEqual([])
  })

  it('ignores a loss the ENEMY suffered in that zone', () => {
    expect(zones((g) => { g.state.zones[0].lostBattleOnTurn.b = 4 })).toEqual([])
  })

  it('still obeys biome legality on top of the prerequisite', () => {
    // Zone 3 is land, and Purifier is a ship — a loss there earns nothing.
    expect(zones((g) => { g.state.zones[2].lostBattleOnTurn.a = 4 })).toEqual([])
  })

  it('PLAY_CARD_TO_ZONE refuses a zone with no loss and allows one with', () => {
    for (const [record, ok] of [[null, false], [4, true]] as const) {
      const g = makeGame({ turnNumber: 4 })
      const card = purifier()
      g.privates.a.hand = [card]
      g.state.counts.a.hand = 1
      g.state.resources.a.materials = 1_000_000
      g.state.zones[0].lostBattleOnTurn.a = record
      const r = applyAction(
        g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx(),
      )
      expect(r.ok).toBe(ok)
    }
  })

  it('leaves every other card untouched by the prerequisite', () => {
    const g = makeGame({ turnNumber: 4 })
    expect(legalZonesFor(g.state, 'a', inst({ vehicleType: 'ship' }), 4)).toEqual([1, 2])
  })

  it('only a truthy deployRequiresBattleLoss gates — a mistyped value does not', () => {
    for (const value of [false, null, 0, 'true']) {
      const g = makeGame({ turnNumber: 4 })
      const card = inst({ ...purifier(), meta: { deployRequiresBattleLoss: value } })
      expect(legalZonesFor(g.state, 'a', card, 4)).toEqual([1, 2])
    }
  })
})

// SURVIVING MUTATION: battleLossMissing's optional chaining. A game row
// written before wave 6 has zones with no lostBattleOnTurn at all, and
// normalizeState only runs at the applyAction boundary — legalZonesFor is also
// called DIRECTLY by the frontend, against whatever state the query handed it.
// Without the optional chaining that is a crash on the hand, not a refusal.
describe('deployRequiresBattleLoss — an unnormalized zone', () => {
  it('refuses rather than throwing when the zone has no loss record at all', () => {
    const g = makeGame({ turnNumber: 4 })
    for (const zone of g.state.zones) {
      delete (zone as unknown as Record<string, unknown>).lostBattleOnTurn
    }
    const purifier = inst({
      name: 'Purifier', faction: 'WF', vehicleType: 'ship', materialCost: 760_000,
      meta: { deployRequiresBattleLoss: true, noBaseDamage: true },
    })
    expect(() => legalZonesFor(g.state, 'a', purifier, 4)).not.toThrow()
    expect(legalZonesFor(g.state, 'a', purifier, 4)).toEqual([])
    // …and an ordinary card is unaffected by the missing field.
    expect(legalZonesFor(g.state, 'a', inst({ vehicleType: 'ship' }), 4)).toEqual([1, 2])
  })
})

// ---------------------------------------------------------------------------
// Wave 7, group B — two TG cards that are pure DATA and name no registry
// effect at all, exactly as Buzzsaw and Veles do (spec §4.8).
//
// The literals here are tied to the real seeded rows by
// supabase/seed/tgFaction.test.ts, which asserts the cards carry these exact
// objects. Neither half is enough alone: this file proves the engine reads the
// shape, that one proves the card carries it.
const CURIOSITY_META = { additionalSpawns: 1 }
const ACCEPTANCE_META = { resourceSurge: { materialsAtLeast: 150_000, extraSpawns: 1 } }

describe('TG Curiosity — additionalSpawns (wave 7)', () => {
  // "Whenever this vehicle is played into a zone, spawn a second curiosity
  // into that zone too."
  const play = (zoneId: number) => {
    const card = inst({
      name: 'Curiosity', vehicleType: 'airship', materialCost: 80_000, meta: CURIOSITY_META,
    })
    const game = makeGame({ privates: { a: { hand: [card], deck: [] }, b: { hand: [], deck: [] } } })
    game.state.resources.a.materials = 200_000
    const r = applyAction(game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    return r.game
  }

  it('lands two hulls in the played zone for one payment', () => {
    const game = play(1)
    expect(game.state.zones[0].cards.a).toHaveLength(2)
    expect(game.state.resources.a.materials).toBe(120_000)
  })

  it('puts the copy in the SAME zone, never spread across the board', () => {
    const game = play(2)
    expect(game.state.zones[1].cards.a).toHaveLength(2)
    expect(game.state.zones[0].cards.a).toHaveLength(0)
    expect(game.state.zones[2].cards.a).toHaveLength(0)
  })

  // ✅ No infinite loop, and no guard to go looking for: deployVehicle is the
  // only reader of additionalSpawns, and the copies it mints never pass back
  // through it — so the inherited key on a copy never fires again.
  it('does not cascade: the copy inherits the key but spawns nothing itself', () => {
    const game = play(1)
    const hulls = game.state.zones[0].cards.a
    expect(hulls).toHaveLength(2)
    expect(hulls[1].meta.additionalSpawns).toBe(1)
  })

  it('gives the copy its own instanceId', () => {
    const [first, second] = play(1).state.zones[0].cards.a
    expect(second.instanceId).not.toBe(first.instanceId)
  })
})

describe('TG Acceptance — resourceSurge, the suppressing arm (wave 7)', () => {
  // "If you have at least 150k materials, this card loses halfcost keyword and
  // spawns a second acceptance." The comparator is materialsAtLeast (Orbit's),
  // because the text says "at least" — §4.6 keeps exactly one per card so each
  // card's own wording survives.
  const deploy = (materials: number) => {
    const card = inst({
      name: 'Acceptance', vehicleType: 'plane', materialCost: 150_000,
      keywords: [KEYWORDS.HALF_COST, KEYWORDS.TEMPORARY], meta: ACCEPTANCE_META,
    })
    const game = makeGame({ privates: { a: { hand: [card], deck: [] }, b: { hand: [], deck: [] } } })
    game.state.resources.a.materials = materials
    const r = applyAction(game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    return r.game
  }

  it('at exactly 150k: full price, two hulls', () => {
    const game = deploy(150_000)
    expect(game.state.zones[0].cards.a).toHaveLength(2)
    expect(game.state.resources.a.materials).toBe(0)
  })

  it('at 149,999: half price, one hull', () => {
    const game = deploy(149_999)
    expect(game.state.zones[0].cards.a).toHaveLength(1)
    expect(game.state.resources.a.materials).toBe(74_999)
  })

  // ⚠ Ruling A-1, and the assertion most likely to be wrong. The suppression
  // is PRICE-ONLY: the hull on the board keeps HALF_COST, which feeds
  // effectiveMaterialCostOf and so its base damage and its repair bill. So a
  // surged Acceptance pays 150k and still hits like a 75k hull. PredatorX has
  // this shape already and wave 6's ruling B-7 answered it for Paladin; the
  // alternative would need a keyword-stripping arm that does not exist.
  it('A-1: the landed hulls keep HALF_COST — suppression is price-only', () => {
    const game = deploy(150_000)
    for (const entry of game.state.zones[0].cards.a) {
      expect(entry.keywords).toContain(KEYWORDS.HALF_COST)
      expect(effectiveMaterialCostOf(entry)).toBe(75_000)
    }
  })

  // ✅ The exact case the read-before-pay() ordering exists for (Chrysaor was
  // the first): Acceptance's threshold EQUALS its own printed cost, so a
  // post-payment re-read would flip its own condition off between pricing and
  // spawning, charging 150k and landing one hull.
  it('reads the surge before payment, so paying for itself cannot cancel it', () => {
    const game = deploy(150_000)
    expect(game.state.resources.a.materials).toBe(0)
    expect(game.state.zones[0].cards.a).toHaveLength(2)
  })

  it('both hulls are Temporary, so the pair is culled at the next turn start', () => {
    const game = deploy(150_000)
    for (const entry of game.state.zones[0].cards.a) {
      expect(entry.keywords).toContain(KEYWORDS.TEMPORARY)
    }
  })
})

// ---------------------------------------------------------------------------
// Wave 7 — TG Alarmed's clause 1: "Can only play this into a zone in which you
// control a AI vehicle."
//
// Purifier's shape exactly: a seeded data key read by a predicate that NARROWS
// the legal set rather than removing zones from it.
//
// ⚠ Ruling D-1: "an AI vehicle" is `isBuiltIn === true`. This is spec §7.3's
// FIRST ruling, reaffirmed rather than reopened — OW:Garrison prints the
// identical phrase ("Target an AI vehicle in hand") and is implemented that
// way, as are Air Strafe, Excalibur, Repairmen Ready and Martyr Attack. Wave
// 7's handoff recommended the ROBOTIC keyword instead, on the grounds that the
// engine has no AI concept; it has had one since wave 1.
describe('deployRequiresAiVehicle — TG Alarmed (wave 7)', () => {
  const alarmed = () => inst({
    name: 'Alarmed', faction: 'TG', vehicleType: 'airship', materialCost: 230_000,
    keywords: [KEYWORDS.ROBOTIC, KEYWORDS.UPKEEP_REQUIRED],
    meta: { deployRequiresAiVehicle: true, onPlayEffect: 'alarmedOnPlay' },
  })

  it('admits only zones where the actor controls a built-in vehicle', () => {
    const game = makeGame({ turnNumber: 3 })
    game.state.zones[1].cards.a.push(zoneEntry({ isBuiltIn: true, playedOnTurn: 1 }))
    expect(legalZonesFor(game.state, 'a', alarmed(), 3)).toEqual([2])
  })

  // "AI" is isBuiltIn, so a player's own custom design does NOT satisfy it.
  // This is the assertion that separates ruling D-1 from the alternative.
  it('a player-made vehicle does not qualify', () => {
    const game = makeGame({ turnNumber: 3 })
    game.state.zones[0].cards.a.push(zoneEntry({ isBuiltIn: false, playedOnTurn: 1 }))
    expect(legalZonesFor(game.state, 'a', alarmed(), 3)).toEqual([])
  })

  // "YOU control" — the enemy's hulls are not yours, however AI they are.
  it('an enemy built-in does not qualify', () => {
    const game = makeGame({ turnNumber: 3 })
    game.state.zones[0].cards.b.push(zoneEntry({ isBuiltIn: true, playedOnTurn: 1 }))
    expect(legalZonesFor(game.state, 'a', alarmed(), 3)).toEqual([])
  })

  it('admits several zones at once when several qualify', () => {
    const game = makeGame({ turnNumber: 3 })
    game.state.zones[0].cards.a.push(zoneEntry({ isBuiltIn: true, playedOnTurn: 1 }))
    game.state.zones[2].cards.a.push(zoneEntry({ isBuiltIn: true, playedOnTurn: 1 }))
    expect(legalZonesFor(game.state, 'a', alarmed(), 3)).toEqual([1, 3])
  })

  it('leaves a card without the key completely unrestricted', () => {
    const game = makeGame({ turnNumber: 3 })
    const plain = inst({ vehicleType: 'airship' })
    expect(legalZonesFor(game.state, 'a', plain, 3)).toEqual([1, 2, 3])
  })

  it('refuses the play outright when no zone qualifies', () => {
    const card = alarmed()
    const game = makeGame({
      turnNumber: 3, activePlayer: 'alice',
      privates: { a: { hand: [card], deck: [] }, b: { hand: [], deck: [] } },
    })
    game.state.resources.a.materials = 500_000
    const r = applyAction(game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx())
    expect(r).toMatchObject({ ok: false, status: 400 })
  })
})

describe('MAX_VEHICLES_PER_ZONE_SIDE — the zone-side cap', () => {
  // Fill one side of a zone to `count` with plain ships that need no catalog.
  function fill(g: ReturnType<typeof makeGame>, zoneIndex: number, side: 'a' | 'b', count: number) {
    for (let i = 0; i < count; i++) {
      g.state.zones[zoneIndex].cards[side].push(zoneEntry({ vehicleType: 'ship' }))
    }
  }

  it('refuses a play into a side already holding the cap', () => {
    const { g, card } = withHand({ vehicleType: 'ship', materialCost: 10000 })
    fill(g, 0, 'a', MAX_VEHICLES_PER_ZONE_SIDE)
    expect(applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx()))
      .toMatchObject({ ok: false, status: 400 })
    expect(legalZonesFor(g.state, 'a', card, g.turnNumber)).not.toContain(1)
  })

  it('allows the play that fills the last slot', () => {
    const { g, card } = withHand({ vehicleType: 'ship', materialCost: 10000 })
    fill(g, 0, 'a', MAX_VEHICLES_PER_ZONE_SIDE - 1)
    expect(legalZonesFor(g.state, 'a', card, g.turnNumber)).toContain(1)
    const r = applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a).toHaveLength(MAX_VEHICLES_PER_ZONE_SIDE)
  })

  // The cap is per zone SIDE. Three independent axes, each its own way to
  // get the scoping wrong: a different zone, the enemy's half of the same
  // zone, and the enemy's own play into a zone your side has filled.
  it('is scoped to one side of one zone', () => {
    const { g, card } = withHand({ vehicleType: 'ship', materialCost: 10000 })
    fill(g, 0, 'a', MAX_VEHICLES_PER_ZONE_SIDE)
    // zone 2 (beach) still takes a ship
    expect(legalZonesFor(g.state, 'a', card, g.turnNumber)).toContain(2)
    // the enemy's half of zone 1 is untouched by your side being full
    expect(legalZonesFor(g.state, 'b', card, g.turnNumber)).toContain(1)
  })

  it('counts only your own side, not the enemy hulls sharing the zone', () => {
    const { g, card } = withHand({ vehicleType: 'ship', materialCost: 10000 })
    fill(g, 0, 'b', MAX_VEHICLES_PER_ZONE_SIDE)
    expect(legalZonesFor(g.state, 'a', card, g.turnNumber)).toContain(1)
    expect(applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx()).ok)
      .toBe(true)
  })

  // The overflow ruling: one free slot makes the card playable, and the
  // additionalSpawns copies fill what is left instead of the play being
  // refused. Without the clamp this lands 4 hulls on top of 6 and reaches 10.
  it('clamps additionalSpawns copies to the remaining slots', () => {
    const { g, card } = withHand({ vehicleType: 'ship', materialCost: 10000, meta: { additionalSpawns: 3 } })
    fill(g, 0, 'a', MAX_VEHICLES_PER_ZONE_SIDE - 2)
    const r = applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a).toHaveLength(MAX_VEHICLES_PER_ZONE_SIDE)
    // and it says so, rather than dropping them silently
    // 6 already there + the card itself = 7, so exactly one of its three
    // copies fits and the other two are dropped.
    expect(r.game.state.log).toContain(`Zone 1 is full — 2 further ${card.name} could not deploy`)
  })

  it('still lands the full additionalSpawns payload when it fits', () => {
    const { g, card } = withHand({ vehicleType: 'ship', materialCost: 10000, meta: { additionalSpawns: 3 } })
    const r = applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a).toHaveLength(4)
    expect(r.game.state.log.some((l) => /could not deploy/.test(l))).toBe(false)
  })

  // A spawn is not a play (spec §7.4) — the cap deliberately does not reach
  // it, so this pins the boundary rather than leaving it to drift.
  it('does not stop a spawn from exceeding the cap', () => {
    const g = makeGame()
    fill(g, 0, 'a', MAX_VEHICLES_PER_ZONE_SIDE)
    const buccaneer = snap({ name: 'Buccaneer', vehicleType: 'ship' })
    const spawner = inst({
      type: 'ability', vehicleType: null, materialCost: 0,
      meta: { playOnZoneEffect: 'spawnBuccaneerEffect' },
    })
    g.privates.a.hand = [spawner]
    g.state.counts.a.hand = 1
    const r = applyAction(
      g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: spawner.instanceId, zoneId: 1 },
      makeCtx({ catalog: [buccaneer] }),
    )
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a).toHaveLength(MAX_VEHICLES_PER_ZONE_SIDE + 1)
  })

  // ADDITIONAL_SPAWNS_CAP (10) is larger than the zone cap (8), so the zone
  // cap is the binding one on an empty side. Pins that they are not confused.
  it('binds ahead of ADDITIONAL_SPAWNS_CAP on an empty side', () => {
    expect(MAX_VEHICLES_PER_ZONE_SIDE).toBeLessThan(ADDITIONAL_SPAWNS_CAP + 1)
    const { g, card } = withHand({
      vehicleType: 'ship', materialCost: 10000, meta: { additionalSpawns: ADDITIONAL_SPAWNS_CAP },
    })
    const r = applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a).toHaveLength(MAX_VEHICLES_PER_ZONE_SIDE)
  })
})
