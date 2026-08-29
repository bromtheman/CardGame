import { describe, expect, it } from 'vitest'
import {
  applyAction, effectFor, effectiveCostInGame, effectiveMaterialCostOf, legalZonesFor,
} from './index'
import { registerCostModifier, registerEffect } from '../effects/registry.ts'
import { takeFromEnemyDeck } from '../effects/primitives.ts'
import { ADDITIONAL_SPAWNS_CAP, KEYWORDS } from '../gameSettings.ts'
import { inst, makeCtx, makeGame, zoneEntry } from './testFixtures'

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

  it('caps at ADDITIONAL_SPAWNS_CAP extras when meta requests far more', () => {
    const { g, card } = withHand({ vehicleType: 'ship', materialCost: 10000, meta: { additionalSpawns: 99 } })
    const r = applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a).toHaveLength(ADDITIONAL_SPAWNS_CAP + 1)
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

  it('ability with unimplemented playOnZoneEffect ambushEffect played to zone 1 succeeds vanilla, no entry added', () => {
    const { g, card } = withHand({
      type: 'ability', vehicleType: null, materialCost: 0, name: 'Ambush',
      meta: { playOnZoneEffect: 'ambushEffect' },
    })
    const r = applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a).toHaveLength(0)
    expect(r.game.privates.a.hand).toHaveLength(0)
    expect(r.game.state.log.some((l) => l.includes('Ambush') && l.includes('ambushEffect') && l.includes('vanilla')))
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
    // card is built. ambushEffect/sabotageEffect below are the same shape
    // and are wave 5's to rename when their cards are built.
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
      meta: { playOnZoneEffect: 'ambushEffect' },
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
      meta: { playOnZoneEffect: 'ambushEffect' },
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
      meta: { playOnZoneEffect: 'ambushEffect' },
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
  it('unimplemented playOnVehicleEffect (sabotageEffect) targeting an enemy vehicle on the field succeeds vanilla', () => {
    const { g, card } = withHand({
      type: 'ability', vehicleType: null, materialCost: 0, name: 'Sabotage',
      meta: { playOnVehicleEffect: 'sabotageEffect' },
    })
    const enemy = zoneEntry({ vehicleType: 'ship' })
    g.state.zones[0].cards.b.push(enemy)
    const r = applyAction(g, 'alice', {
      type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD', instanceId: card.instanceId, targetInstanceId: enemy.instanceId,
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.a.hand).toHaveLength(0)
    expect(
      r.game.state.log.some((l) => l.includes('Sabotage') && l.includes('sabotageEffect') && l.includes('vanilla')),
    ).toBe(true)
    // The spent targeting ability lands in the discard, same as any other ability play.
    expect(r.game.state.destroyed.a).toHaveLength(1)
    expect(r.game.state.destroyed.a[0]).toMatchObject({ name: 'Sabotage' })
    expect(r.game.state.destroyed.a[0]).not.toHaveProperty('instanceId')
  })

  it('rejects a nonexistent target instanceId', () => {
    const { g, card } = withHand({
      type: 'ability', vehicleType: null, materialCost: 0, name: 'Sabotage',
      meta: { playOnVehicleEffect: 'sabotageEffect' },
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
      meta: { playOnVehicleEffect: 'sabotageEffect' },
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
  // Paddlegun takes whatever sits on top of the enemy deck, abilities
  // included, and an ability leaves play down a different exit than a
  // vehicle (spendCard, not a battle death). It is on loan just the same.
  it("spends a captured ability card into its OWNER's discard", () => {
    const g = makeGame()
    g.privates.b.deck.push(inst({ name: 'Enemy Order', type: 'ability', vehicleType: null, materialCost: 0 }))
    g.state.counts.b.deck = 1
    effectFor('paddlegunEffect')!({ game: g, actor: 'a', card: inst({ name: 'Paddlegun' }), ctx: makeCtx() })
    const card = g.privates.a.hand[0]
    const r = applyAction(g, 'alice', { type: 'PLAY_ABILITY_CARD', instanceId: card.instanceId }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.destroyed.b.map((c) => c.name)).toEqual(['Enemy Order'])
    expect(r.game.state.destroyed.a).toHaveLength(0)
  })
})

describe('captured cards spawn hulls for their captor', () => {
  it("keeps a captured card's own hull on loan but not the extras it spawns", () => {
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
    expect(hulls.map((c) => c.meta.ownerSide)).toEqual(['b', undefined])
  })
})
