import { describe, expect, it } from 'vitest'
import { applyAction, effectiveCostInGame, effectiveMaterialCostOf, legalZonesFor } from './index'
import { registerCostModifier, registerEffect } from '../effects/registry.ts'
import { ADDITIONAL_SPAWNS_CAP } from '../gameSettings.ts'
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
    expect(r.game.state.destroyed.a).toHaveLength(0)
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
  it('vehicle with onPlayEffect marauderOnPlay draws a card and grants CP after deploy', () => {
    const { g, card } = withHand({ vehicleType: 'ship', materialCost: 10000, meta: { onPlayEffect: 'marauderOnPlay' } })
    g.privates.a.deck.push(inst({ name: 'Deck Top' }))
    g.state.counts.a.deck = 1
    const r = applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a).toHaveLength(1)
    expect(r.game.privates.a.hand.map((c) => c.name)).toContain('Deck Top')
    expect(r.game.state.resources.a.cp).toBe(4) // 3 + 1
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

  it('vehicle with unimplemented onActivate eclipseEffect deploys fine with exactly one vanilla note', () => {
    const { g, card } = withHand({
      vehicleType: 'ship', materialCost: 10000, name: 'Eclipse',
      meta: { onActivate: 'eclipseEffect' },
    })
    const r = applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a).toHaveLength(1)
    const notes = r.game.state.log.filter((l) => l.includes('eclipseEffect'))
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
  })

  it('still enforces the vehicle-only illegal-zone message for vehicles', () => {
    const { g, card } = withHand({ vehicleType: 'tank' })
    expect(applyAction(g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }))
      .toMatchObject({ ok: false, status: 400, error: 'That vehicle cannot deploy to that zone' })
  })
})
