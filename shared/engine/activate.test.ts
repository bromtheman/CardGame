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

// Two surviving mutations, both in the same shape: the ORIGINAL tests only
// ever exercised a malformed material price on a card with no CP price, where
// the "at least one price" gate already refused it — so the malformed-value
// branch and Math.floor were never reached at all.
describe('ACTIVATE_VEHICLE — mutation survivors', () => {
  const priced = (meta: Record<string, unknown>) => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    game.privates.a.deck = [inst({ name: 'Spare' })]
    game.state.counts.a = { hand: 0, deck: 1 }
    game.state.resources.a.materials = 500_000
    game.state.resources.a.cp = 3
    game.state.zones[0].cards.a.push(zoneEntry({ name: 'Foundry', instanceId: 'm1', meta }))
    return { game, act: () => applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'm1' }, makeCtx()) }
  }

  // A card carrying a VALID cp price and a MALFORMED material one must be
  // refused, not quietly activated for the CP alone. This is the data-key
  // blind spot in miniature: a mistyped value that reads as "free".
  it.each([-1, Number.NaN, '200000'])(
    'refuses a card whose material price is %p alongside a valid CP price',
    (bad) => {
      const { act, game } = priced({
        onActivate: 't_activateDraw', activateCpCost: 1, activateMaterialCost: bad,
      })
      const before = game.state.resources.a.cp
      expect(act()).toMatchObject({ ok: false, status: 400 })
      expect(game.state.resources.a.cp).toBe(before)
    },
  )

  // The mirror: a malformed CP price alongside a valid material one.
  it('refuses a card whose CP price is malformed alongside a valid material price', () => {
    const { act } = priced({
      onActivate: 't_activateDraw', activateCpCost: -1, activateMaterialCost: 200_000,
    })
    expect(act()).toMatchObject({ ok: false, status: 400 })
  })

  // Math.floor, not Math.ceil. No seeded card prints a fractional price, so
  // only a direct fixture reaches it — and the two differ by exactly 1.
  it('rounds a fractional activation price DOWN', () => {
    const { act, game } = priced({ onActivate: 't_activateDraw', activateMaterialCost: 200_000.7 })
    const r = act()
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.resources.a.materials).toBe(game.state.resources.a.materials - 200_000)
  })
})

// A NULL price key is an ABSENT price key, not a malformed one — the same
// reading normalizeState takes of every nullable field. So a card with a valid
// CP price and an explicitly-null material price has a working CP-only
// ability. Written after a mutation-survivor test asserted the opposite and
// was wrong: the expectation was the defect, not the code.
describe('ACTIVATE_VEHICLE — a null price key means absent', () => {
  it('activates on the CP price alone', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    game.privates.a.deck = [inst({ name: 'Spare' })]
    game.state.counts.a = { hand: 0, deck: 1 }
    game.state.resources.a.cp = 2
    game.state.zones[0].cards.a.push(zoneEntry({
      name: 'Foundry', instanceId: 'm2',
      meta: { onActivate: 't_activateDraw', activateCpCost: 1, activateMaterialCost: null },
    }))
    const r = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'm2' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.resources.a.cp).toBe(1)
    expect(r.game.state.resources.a.materials).toBe(game.state.resources.a.materials)
  })
})

describe('a free activated ability', () => {
  // parsePrice takes `raw < 0` as invalid and 0 as valid, so the CP branch runs
  // with a cost of zero rather than being skipped — which matters, because a
  // SKIPPED branch and a ZERO branch differ for a card carrying no price key at
  // all, and that card has no ability (activate.ts's own comment).
  it('activates at 0 CP with an empty purse, and charges nothing', () => {
    const game = gameWithTurret({ meta: { onActivate: 't_activateDraw', activateCpCost: 0 } })
    game.state.resources.a.cp = 0
    const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'v1' }, makeCtx())
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.resources.a.cp).toBe(0)
    expect(res.game.state.zones[0].cards.a[0]).toHaveProperty('activatedOnTurn', 2)
    expect(res.game.privates.a.hand).toHaveLength(1)
  })

  // The line between "free" and "has no ability". A card must carry a price
  // KEY; 0 is a price, absence is not.
  it('still refuses a card carrying onActivate and no price at all', () => {
    const game = gameWithTurret({ meta: { onActivate: 't_activateDraw' } })
    const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'v1' }, makeCtx())
    expect(res).toMatchObject({ ok: false, status: 400 })
  })

  it('still refuses a once-per-turn second activation when it is free', () => {
    const game = gameWithTurret({
      meta: { onActivate: 't_activateDraw', activateCpCost: 0 }, activatedOnTurn: 2,
    })
    expect(applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'v1' }, makeCtx()))
      .toMatchObject({ ok: false, status: 409 })
  })
})
