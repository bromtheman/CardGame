import { describe, expect, it } from 'vitest'
import { applyAction, effectiveCostInGame, effectiveMaterialCostOf, legalZonesFor } from './index'
import { registerCostModifier } from '../effects/registry.ts'
import { inst, makeGame, zoneEntry } from './testFixtures'

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
  it('pays, discards, and logs the vanilla note', () => {
    const { g, card } = withHand({ type: 'ability', vehicleType: null, materialCost: 0, cpCost: 1, name: 'Rally' })
    const r = applyAction(g, 'alice', { type: 'PLAY_ABILITY_CARD', instanceId: card.instanceId })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.a.hand).toHaveLength(0)
    expect(r.game.state.resources.a.cp).toBe(2)
    expect(r.game.state.log.some((l) => l.includes('no effect yet'))).toBe(true)
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
