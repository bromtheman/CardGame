import { beforeAll, describe, expect, it } from 'vitest'
import { applyAction, drawCard } from './index.ts'
import { registerEffect } from '../effects/registry.ts'
import { inst, makeCtx, makeGame, zoneEntry } from './testFixtures.ts'

beforeAll(() => {
  registerEffect('t_activateDraw', ({ game, actor, ctx }) => { drawCard(game, actor, ctx); return true })
  registerEffect('t_activateFails', () => false)
})

const turret = (over: Record<string, unknown> = {}) => zoneEntry({
  name: 'Turret',
  instanceId: 'v1',
  meta: { onActivate: 't_activateDraw', activateCpCost: 1 },
  ...over,
})

function gameWithTurret(over: Record<string, unknown> = {}) {
  const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
  game.privates.a.deck = [inst({ name: 'Spare' })]
  game.state.counts.a = { hand: 0, deck: 1 }
  game.state.zones[0].cards.a.push(turret(over))
  return game
}

describe('ACTIVATE_VEHICLE', () => {
  it('pays the CP, stamps the turn, and fires the effect', () => {
    const game = gameWithTurret()
    game.state.resources.a.cp = 2
    const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'v1' }, makeCtx())
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.resources.a.cp).toBe(1)
    expect(res.game.state.zones[0].cards.a[0]).toHaveProperty('activatedOnTurn', 2)
    expect(res.game.privates.a.hand).toHaveLength(1)
  })

  it('rejects a second activation in the same turn', () => {
    const game = gameWithTurret({ activatedOnTurn: 2 })
    const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'v1' }, makeCtx())
    expect(res).toMatchObject({ ok: false, status: 409 })
  })

  it('rejects a vehicle with no activated ability', () => {
    const game = gameWithTurret({ meta: {} })
    const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'v1' }, makeCtx())
    expect(res).toMatchObject({ ok: false, status: 400 })
  })

  it('rejects when the actor cannot pay', () => {
    const game = gameWithTurret()
    game.state.resources.a.cp = 0
    const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'v1' }, makeCtx())
    expect(res).toMatchObject({ ok: false, status: 400 })
  })

  it('rejects an enemy vehicle', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    game.state.zones[0].cards.b.push(turret())
    const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'v1' }, makeCtx())
    expect(res).toMatchObject({ ok: false, status: 400 })
  })

  it('leaves the input game untouched when the effect fails', () => {
    const game = gameWithTurret({ meta: { onActivate: 't_activateFails', activateCpCost: 1 } })
    game.state.resources.a.cp = 2
    const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'v1' }, makeCtx())
    expect(res).toMatchObject({ ok: false, status: 400 })
    expect(game.state.resources.a.cp).toBe(2)
    expect(game.state.zones[0].cards.a[0].activatedOnTurn).toBeNull()
  })
})

// Wave 6 — an activated ability paid in MATERIALS rather than CP (SS
// Victoria: "each turn you may spend 200k resources to spawn another victoria
// into this zone"). A card needs `onActivate` plus AT LEAST ONE price; the
// two prices are independent, and a card may carry either or both.
describe('ACTIVATE_VEHICLE — activateMaterialCost', () => {
  const materialTurret = (over: Record<string, unknown> = {}) => zoneEntry({
    name: 'Foundry',
    instanceId: 'm1',
    meta: { onActivate: 't_activateDraw', activateMaterialCost: 200_000 },
    ...over,
  })

  function gameWithFoundry(over: Record<string, unknown> = {}) {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    game.privates.a.deck = [inst({ name: 'Spare' })]
    game.state.counts.a = { hand: 0, deck: 1 }
    game.state.resources.a.materials = 250_000
    game.state.zones[0].cards.a.push(materialTurret(over))
    return game
  }

  it('works with a material price and no CP price at all', () => {
    const game = gameWithFoundry()
    const cpBefore = game.state.resources.a.cp
    const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'm1' }, makeCtx())
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.resources.a.materials).toBe(50_000)
    expect(res.game.state.resources.a.cp).toBe(cpBefore)
    expect(res.game.state.zones[0].cards.a[0]).toHaveProperty('activatedOnTurn', 2)
    expect(res.game.privates.a.hand).toHaveLength(1)
  })

  it('rejects when the actor cannot afford the materials, and charges nothing', () => {
    const game = gameWithFoundry()
    game.state.resources.a.materials = 199_999
    const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'm1' }, makeCtx())
    expect(res).toMatchObject({ ok: false, status: 400 })
    expect(game.state.resources.a.materials).toBe(199_999)
    expect(game.state.zones[0].cards.a[0].activatedOnTurn).toBeNull()
  })

  it('charges both prices when a card carries both', () => {
    const game = gameWithFoundry({
      meta: { onActivate: 't_activateDraw', activateCpCost: 1, activateMaterialCost: 200_000 },
    })
    game.state.resources.a.cp = 2
    const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'm1' }, makeCtx())
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.resources.a.materials).toBe(50_000)
    expect(res.game.state.resources.a.cp).toBe(1)
  })

  it('refuses a card carrying onActivate and neither price — the silent-pair trap', () => {
    const game = gameWithFoundry({ meta: { onActivate: 't_activateDraw' } })
    const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'm1' }, makeCtx())
    expect(res).toMatchObject({ ok: false, status: 400 })
  })

  // An activation price is charged FLAT (spec §7.3, wave 6): Half-Cost and
  // costModifier are PLAY-time purchase mechanics, and activating is not
  // playing. A Half-Cost hull must not activate at half price.
  it('ignores Half-Cost — an activation price is not a purchase price', () => {
    const game = gameWithFoundry({ keywords: ['halfCost'] })
    const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'm1' }, makeCtx())
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.resources.a.materials).toBe(50_000)
  })

  it('rejects a negative or non-finite material price rather than paying it out', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, '200000']) {
      const game = gameWithFoundry({ meta: { onActivate: 't_activateDraw', activateMaterialCost: bad } })
      const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'm1' }, makeCtx())
      expect(res).toMatchObject({ ok: false, status: 400 })
    }
  })
})
