import { describe, expect, it } from 'vitest'
import { effectFor } from './registry.ts'
import { inst, makeCtx, makeGame, snap, zoneEntry } from '../engine/testFixtures.ts'
import { applyAction } from '../engine/index.ts'

const DRAW_ONE = [
  'mandrelOnPlay', 'rookOnPlay', 'resoluteOnPlay', 'excruciatorOnPlay',
  'claymoreEffect', 'palisadeEffect', 'purifierEffect',
  'javelinOnDeath', 'ironMaidenOnDeath', 'victoriaOnDeath',
  'trondheimOnDeath', 'coulombEffect',
]
const CP_ONLY: [string, number][] = [
  ['bulwarkOnPlay', 2], ['maelstromOnPlay', 1], ['maceEffect', 1],
]

describe('grant-backed cards', () => {
  it.each(DRAW_ONE)('%s draws exactly one card', (name) => {
    const game = makeGame()
    game.privates.a.deck.push(inst({ name: 'Top' }), inst({ name: 'Next' }))
    expect(effectFor(name)!({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['Top'])
    expect(game.state.counts.a).toEqual({ hand: 1, deck: 1 })
  })

  it.each(CP_ONLY)('%s grants %i CP and draws nothing', (name, cp) => {
    const game = makeGame()
    game.privates.a.deck.push(inst({ name: 'Top' }))
    expect(effectFor(name)!({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.state.resources.a.cp).toBe(3 + cp)
    expect(game.privates.a.hand).toHaveLength(0)
  })

  it('ransackOnPlay draws a card and grants 1 CP', () => {
    const game = makeGame()
    game.privates.a.deck.push(inst({ name: 'Top' }))
    expect(effectFor('ransackOnPlay')!({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.privates.a.hand).toHaveLength(1)
    expect(game.state.resources.a.cp).toBe(4)
  })

  it('paddlegunEffect draws from the ENEMY deck', () => {
    const game = makeGame()
    game.privates.a.deck.push(inst({ name: 'Own Top' }))
    game.privates.b.deck.push(inst({ name: 'Enemy Top' }))
    expect(effectFor('paddlegunEffect')!({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['Enemy Top'])
    expect(game.privates.a.deck.map((c) => c.name)).toEqual(['Own Top'])
    expect(game.state.log.join(' ')).not.toContain('Enemy Top')
  })
})

describe('drawFromPool-backed cards', () => {
  const catalog = [
    snap({ name: 'TG Obsession', faction: 'TG', type: 'vehicle', materialCost: 330_000 }),
    snap({ name: 'Warbird', faction: 'GT', vehicleType: 'airship', materialCost: 190_000 }),
    snap({ name: 'Nimbus', faction: 'GT', vehicleType: 'airship', materialCost: 530_000 }),
    snap({ name: 'PredatorX', faction: 'SS', vehicleType: 'plane', materialCost: 120_000, keywords: ['halfCost', 'temporary'] }),
    snap({ name: 'Hydra', faction: 'SS', vehicleType: 'airship', materialCost: 230_000 }),
  ]

  it.each(['ampereOnPlay', 'candelaOnPlay', 'quadrupoleOnPlay'])(
    '%s draws a TG Robotics card',
    (name) => {
      const game = makeGame()
      expect(effectFor(name)!({ game, actor: 'a', card: inst(), ctx: makeCtx({ catalog }) })).toBe(true)
      expect(game.privates.a.hand.map((c) => c.faction)).toEqual(['TG'])
    },
  )

  it.each(['halberdOnDeath', 'jormangundOnDeath', 'partisanEffect'])(
    '%s draws a GT airship',
    (name) => {
      const game = makeGame()
      expect(effectFor(name)!({ game, actor: 'a', card: inst(), ctx: makeCtx({ catalog }) })).toBe(true)
      const drawn = game.privates.a.hand[0]
      expect(drawn.faction).toBe('GT')
      expect(drawn.vehicleType).toBe('airship')
    },
  )

  it('rheaOnPlay draws a sub-300k SS plane and strips its temporary keyword', () => {
    const game = makeGame()
    expect(effectFor('rheaOnPlay')!({ game, actor: 'a', card: inst(), ctx: makeCtx({ catalog }) })).toBe(true)
    expect(game.privates.a.hand[0].name).toBe('PredatorX')
    expect(game.privates.a.hand[0].keywords).toEqual(['halfCost'])
  })

  it('cauldronEffect pulls a submarine out of your own deck', () => {
    const game = makeGame()
    game.privates.a.deck.push(inst({ name: 'My Sub', vehicleType: 'sub' }), inst({ name: 'My Ship' }))
    expect(effectFor('cauldronEffect')!({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['My Sub'])
  })

  it('cauldronEffect resolves when you have no submarine', () => {
    const game = makeGame()
    game.privates.a.deck.push(inst({ name: 'My Ship' }))
    expect(effectFor('cauldronEffect')!({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.privates.a.hand).toHaveLength(0)
  })

  it('conduitEffect pulls a player-made ship or tank out of your own deck', () => {
    const game = makeGame()
    game.privates.a.deck.push(
      inst({ name: 'Built-in Ship', isBuiltIn: true, vehicleType: 'ship' }),
      inst({ name: 'Custom Ship', isBuiltIn: false, vehicleType: 'ship' }),
    )
    expect(effectFor('conduitEffect')!({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['Custom Ship'])
  })
})

describe('clydesdaleEffect', () => {
  const play = (existing: boolean) => {
    const card = inst({
      name: 'Clydesdale', vehicleType: 'ship', materialCost: 0,
      meta: { onPlayEffect: 'clydesdaleEffect' },
    })
    const game = makeGame({ privates: { a: { hand: [card], deck: [] }, b: { hand: [], deck: [] } } })
    if (existing) game.state.zones[0].cards.a.push(zoneEntry({ name: 'Escort', vehicleType: 'ship' }))
    const r = applyAction(game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    return r.game.state.zones[0].cards.a.filter((c) => c.name === 'Clydesdale').length
  }

  it('spawns a second copy into an empty-of-friendlies zone', () => {
    expect(play(false)).toBe(2)
  })

  it('spawns nothing when a friendly vehicle is already there', () => {
    expect(play(true)).toBe(1)
  })
})

describe('sapphireEffect', () => {
  it('draws and refunds when the zone is empty on both sides', () => {
    const card = inst({
      name: 'Sapphire', vehicleType: 'plane', materialCost: 30_000,
      meta: { onPlayEffect: 'sapphireEffect' },
    })
    const game = makeGame({
      privates: { a: { hand: [card], deck: [inst({ name: 'Top' })] }, b: { hand: [], deck: [] } },
    })
    const before = game.state.resources.a.materials
    const r = applyAction(game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.a.hand.map((c) => c.name)).toEqual(['Top'])
    expect(r.game.state.resources.a.materials).toBe(before)
  })

  it('does nothing when an enemy vehicle holds the zone', () => {
    const card = inst({
      name: 'Sapphire', vehicleType: 'plane', materialCost: 30_000,
      meta: { onPlayEffect: 'sapphireEffect' },
    })
    const game = makeGame({
      privates: { a: { hand: [card], deck: [inst({ name: 'Top' })] }, b: { hand: [], deck: [] } },
    })
    game.state.zones[0].cards.b.push(zoneEntry({ name: 'Enemy', vehicleType: 'ship' }))
    const before = game.state.resources.a.materials
    const r = applyAction(game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.a.hand).toHaveLength(0)
    expect(r.game.state.resources.a.materials).toBe(before - 30_000)
  })
})

describe('excaliburOnPlay', () => {
  it('stamps a -200k costDelta on a built-in ship in hand', () => {
    const target = inst({ name: 'Victoria', isBuiltIn: true, vehicleType: 'ship', materialCost: 270_000 })
    const game = makeGame({ privates: { a: { hand: [target], deck: [] }, b: { hand: [], deck: [] } } })
    const ok = effectFor('excaliburOnPlay')!({
      game, actor: 'a', card: inst({ name: 'Excalibur' }), ctx: makeCtx(),
      targetInstanceId: target.instanceId,
    })
    expect(ok).toBe(true)
    expect(game.privates.a.hand[0].meta.costDelta).toBe(-200_000)
  })

  it('stacks with an existing delta', () => {
    const target = inst({ isBuiltIn: true, vehicleType: 'ship', meta: { costDelta: -50_000 } })
    const game = makeGame({ privates: { a: { hand: [target], deck: [] }, b: { hand: [], deck: [] } } })
    effectFor('excaliburOnPlay')!({
      game, actor: 'a', card: inst(), ctx: makeCtx(), targetInstanceId: target.instanceId,
    })
    expect(game.privates.a.hand[0].meta.costDelta).toBe(-250_000)
  })

  it('rejects a player-made target', () => {
    const target = inst({ isBuiltIn: false, vehicleType: 'ship' })
    const game = makeGame({ privates: { a: { hand: [target], deck: [] }, b: { hand: [], deck: [] } } })
    expect(effectFor('excaliburOnPlay')!({
      game, actor: 'a', card: inst(), ctx: makeCtx(), targetInstanceId: target.instanceId,
    })).toBe(false)
  })
})

describe('garrisonEffect', () => {
  it('gives a built-in vehicle in hand Half-Cost and Inoffensive', () => {
    const target = inst({ name: 'Bulwark', isBuiltIn: true, type: 'vehicle', keywords: ['blocker'] })
    const game = makeGame({ privates: { a: { hand: [target], deck: [] }, b: { hand: [], deck: [] } } })
    const ok = effectFor('garrisonEffect')!({
      game, actor: 'a', card: inst(), ctx: makeCtx(), targetInstanceId: target.instanceId,
    })
    expect(ok).toBe(true)
    expect(game.privates.a.hand[0].keywords).toEqual(['blocker', 'halfCost', 'inoffensive'])
  })

  it('does not duplicate a keyword the target already has', () => {
    const target = inst({ isBuiltIn: true, type: 'vehicle', keywords: ['halfCost'] })
    const game = makeGame({ privates: { a: { hand: [target], deck: [] }, b: { hand: [], deck: [] } } })
    effectFor('garrisonEffect')!({
      game, actor: 'a', card: inst(), ctx: makeCtx(), targetInstanceId: target.instanceId,
    })
    expect(game.privates.a.hand[0].keywords).toEqual(['halfCost', 'inoffensive'])
  })

  it('rejects a player-made target', () => {
    const target = inst({ isBuiltIn: false, type: 'vehicle' })
    const game = makeGame({ privates: { a: { hand: [target], deck: [] }, b: { hand: [], deck: [] } } })
    expect(effectFor('garrisonEffect')!({
      game, actor: 'a', card: inst(), ctx: makeCtx(), targetInstanceId: target.instanceId,
    })).toBe(false)
  })
})

describe('repairmenReadyEffect', () => {
  const run = (over: Partial<Parameters<typeof inst>[0]>) => {
    const target = zoneEntry({ name: 'Target', keywords: [], ...over })
    const game = makeGame()
    game.state.zones[0].cards.b.push(target)
    game.privates.a.deck.push(inst({ name: 'Top' }))
    const ok = effectFor('repairmenReadyEffect')!({
      game, actor: 'a', card: inst(), ctx: makeCtx(), targetInstanceId: target.instanceId,
    })
    return { ok, game, target: game.state.zones[0].cards.b[0] }
  }

  it('grants Scrappy and draws for a cheap built-in target', () => {
    const { ok, game, target } = run({ isBuiltIn: true, materialCost: 150_000 })
    expect(ok).toBe(true)
    expect(target.keywords).toContain('scrappy')
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['Top'])
  })

  it('grants Scrappy but draws nothing for an expensive built-in target', () => {
    const { game, target } = run({ isBuiltIn: true, materialCost: 250_000 })
    expect(target.keywords).toContain('scrappy')
    expect(game.privates.a.hand).toHaveLength(0)
  })

  it('grants Scrappy but draws nothing for a player-made target', () => {
    const { game, target } = run({ isBuiltIn: false, materialCost: 100_000 })
    expect(target.keywords).toContain('scrappy')
    expect(game.privates.a.hand).toHaveLength(0)
  })
})
