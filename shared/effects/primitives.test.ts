import { describe, expect, it } from 'vitest'
import { grant, sequence, takeFromEnemyDeck } from './primitives.ts'
import { inst, makeCtx, makeGame } from '../engine/testFixtures.ts'

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
