import { describe, expect, it } from 'vitest'
import { drawFromPool, grant, sequence, takeFromEnemyDeck } from './primitives.ts'
import { inst, makeCtx, makeGame, snap } from '../engine/testFixtures.ts'

describe('grant', () => {
  it('draws from your own deck and syncs counts', () => {
    const game = makeGame()
    game.privates.a.deck.push(inst({ name: 'Top' }), inst({ name: 'Next' }))
    expect(grant({ draw: 2 })({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['Top', 'Next'])
    expect(game.state.counts.a).toEqual({ hand: 2, deck: 0 })
  })

  it('grants CP and materials', () => {
    const game = makeGame()
    expect(grant({ cp: 2, materials: 30_000 })({ game, actor: 'b', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.state.resources.b.cp).toBe(5)
    expect(game.state.resources.b.materials).toBe(130_000)
  })

  it('combines draw and CP', () => {
    const game = makeGame()
    game.privates.a.deck.push(inst({ name: 'Top' }))
    expect(grant({ draw: 1, cp: 1 })({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.privates.a.hand).toHaveLength(1)
    expect(game.state.resources.a.cp).toBe(4)
  })

  it('draws from the enemy deck without naming the card, syncing both sides', () => {
    const game = makeGame()
    game.privates.b.deck.push(inst({ name: 'Enemy Secret' }))
    game.state.counts.b.deck = 1
    expect(grant({ draw: 1, from: 'enemy' })({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['Enemy Secret'])
    expect(game.privates.b.deck).toHaveLength(0)
    expect(game.state.counts.a.hand).toBe(1)
    expect(game.state.counts.b.deck).toBe(0)
    expect(game.state.log.join(' ')).not.toContain('Enemy Secret')
  })

  it('mints a fresh instanceId for a card taken from the enemy deck', () => {
    const game = makeGame()
    game.privates.b.deck.push(inst({ name: 'Enemy Secret', instanceId: 'enemy-1' }))
    grant({ draw: 1, from: 'enemy' })({ game, actor: 'a', card: inst(), ctx: makeCtx() })
    expect(game.privates.a.hand[0].instanceId).toBe('e-0')
  })

  it('resolves without failing when the enemy deck is empty', () => {
    const game = makeGame()
    expect(grant({ draw: 1, from: 'enemy' })({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.privates.a.hand).toHaveLength(0)
  })
})

describe('takeFromEnemyDeck', () => {
  it('takes the topmost card matching the filter, leaving the rest in order', () => {
    const game = makeGame()
    game.privates.b.deck.push(
      inst({ name: 'Ability', type: 'ability' }),
      inst({ name: 'Ship', type: 'vehicle' }),
      inst({ name: 'Ship Two', type: 'vehicle' }),
    )
    const ok = takeFromEnemyDeck(game, 'a', makeCtx(), (c) => c.type === 'vehicle')
    expect(ok).toBe(true)
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['Ship'])
    expect(game.privates.b.deck.map((c) => c.name)).toEqual(['Ability', 'Ship Two'])
  })
})

describe('sequence', () => {
  it('runs every effect in order', () => {
    const game = makeGame()
    game.privates.a.deck.push(inst({ name: 'Top' }))
    const fn = sequence(grant({ draw: 1 }), grant({ cp: 1 }))
    expect(fn({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.privates.a.hand).toHaveLength(1)
    expect(game.state.resources.a.cp).toBe(4)
  })

  it('stops and reports failure when a step fails', () => {
    const game = makeGame()
    const fn = sequence(() => false, grant({ cp: 1 }))
    expect(fn({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(false)
    expect(game.state.resources.a.cp).toBe(3)
  })
})

describe('drawFromPool — catalog source', () => {
  const catalog = [
    snap({ name: 'TG One', faction: 'TG', type: 'vehicle', materialCost: 330_000 }),
    snap({ name: 'TG Two', faction: 'TG', type: 'vehicle', materialCost: 600_000 }),
    snap({ name: 'DWG Ship', faction: 'DWG', type: 'vehicle', materialCost: 40_000 }),
  ]

  it('adds one filtered card to hand with a fresh id and syncs counts', () => {
    const game = makeGame()
    const fn = drawFromPool({ source: 'catalog', filter: { faction: 'TG' }, count: 1 })
    expect(fn({ game, actor: 'a', card: inst(), ctx: makeCtx({ catalog }) })).toBe(true)
    expect(game.privates.a.hand).toHaveLength(1)
    expect(game.privates.a.hand[0].name).toMatch(/^TG /)
    expect(game.privates.a.hand[0].instanceId).toBe('e-0')
    expect(game.state.counts.a.hand).toBe(1)
  })

  it('never names the drawn card in the log', () => {
    const game = makeGame()
    drawFromPool({ source: 'catalog', filter: { faction: 'TG' }, count: 1 })(
      { game, actor: 'a', card: inst(), ctx: makeCtx({ catalog }) },
    )
    expect(game.state.log.join(' ')).not.toContain('TG One')
    expect(game.state.log.join(' ')).not.toContain('TG Two')
  })

  it('is deterministic under a seeded rng', () => {
    const pick = () => {
      const game = makeGame()
      drawFromPool({ source: 'catalog', filter: { faction: 'TG' }, count: 1 })(
        { game, actor: 'a', card: inst(), ctx: makeCtx({ catalog }) },
      )
      return game.privates.a.hand[0].name
    }
    expect(pick()).toBe(pick())
  })

  it('respects maxCost and strips requested keywords', () => {
    const planes = [
      snap({ name: 'Cheap Plane', faction: 'SS', vehicleType: 'plane', materialCost: 120_000, keywords: ['halfCost', 'temporary'] }),
      snap({ name: 'Dear Plane', faction: 'SS', vehicleType: 'plane', materialCost: 400_000, keywords: ['temporary'] }),
    ]
    const game = makeGame()
    const fn = drawFromPool({
      source: 'catalog', filter: { faction: 'SS', vehicleType: 'plane', maxCost: 299_999 },
      count: 1, strip: ['temporary'],
    })
    expect(fn({ game, actor: 'a', card: inst(), ctx: makeCtx({ catalog: planes }) })).toBe(true)
    expect(game.privates.a.hand[0].name).toBe('Cheap Plane')
    expect(game.privates.a.hand[0].keywords).toEqual(['halfCost'])
  })

  it('fails when the catalog pool is empty and allowEmpty is not set', () => {
    const game = makeGame()
    const fn = drawFromPool({ source: 'catalog', filter: { faction: 'TG' }, count: 1 })
    expect(fn({ game, actor: 'a', card: inst(), ctx: makeCtx({ catalog: [] }) })).toBe(false)
  })
})

describe('drawFromPool — deck source', () => {
  it('moves a matching card out of your own deck into your hand', () => {
    const game = makeGame()
    game.privates.a.deck.push(
      inst({ name: 'Ship', vehicleType: 'ship' }),
      inst({ name: 'Sub', vehicleType: 'sub' }),
    )
    const fn = drawFromPool({ source: 'deck', filter: { vehicleType: 'sub' }, count: 1, allowEmpty: true })
    expect(fn({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['Sub'])
    expect(game.privates.a.deck.map((c) => c.name)).toEqual(['Ship'])
    expect(game.state.counts.a).toEqual({ hand: 1, deck: 1 })
  })

  it('keeps the card instanceId when moving within your own zones', () => {
    const game = makeGame()
    game.privates.a.deck.push(inst({ name: 'Sub', vehicleType: 'sub', instanceId: 'mine-1' }))
    drawFromPool({ source: 'deck', filter: { vehicleType: 'sub' }, count: 1, allowEmpty: true })(
      { game, actor: 'a', card: inst(), ctx: makeCtx() },
    )
    expect(game.privates.a.hand[0].instanceId).toBe('mine-1')
  })

  it('resolves with a log note when the deck holds no match and allowEmpty is set', () => {
    const game = makeGame()
    const fn = drawFromPool({ source: 'deck', filter: { vehicleType: 'sub' }, count: 1, allowEmpty: true })
    expect(fn({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.privates.a.hand).toHaveLength(0)
    expect(game.state.log).toHaveLength(1)
  })
})
