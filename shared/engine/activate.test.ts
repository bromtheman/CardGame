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
