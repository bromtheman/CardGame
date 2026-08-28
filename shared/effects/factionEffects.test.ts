import { describe, expect, it } from 'vitest'
import { effectFor } from './registry.ts'
import { inst, makeCtx, makeGame, snap, zoneEntry } from '../engine/testFixtures.ts'
import { applyAction } from '../engine/index.ts'
import type { CardInstance } from '../engine/gameInit.ts'
import type { EngineGame } from '../engine/engineTypes.ts'

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
  it.each(DRAW_ONE)('%s draws exactly one card and leaves CP untouched', (name) => {
    const game = makeGame()
    game.privates.a.deck.push(inst({ name: 'Top' }), inst({ name: 'Next' }))
    expect(effectFor(name)!({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['Top'])
    expect(game.state.counts.a).toEqual({ hand: 1, deck: 1 })
    expect(game.state.resources.a.cp).toBe(3)
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

  it('rheaOnPlay does not draw an SS plane at exactly the 300k boundary — the card says "under 300k"', () => {
    const game = makeGame()
    const edgeCatalog = [snap({ name: 'Edge Plane', faction: 'SS', vehicleType: 'plane', materialCost: 300_000 })]
    expect(effectFor('rheaOnPlay')!({ game, actor: 'a', card: inst(), ctx: makeCtx({ catalog: edgeCatalog }) })).toBe(false)
    expect(game.privates.a.hand).toHaveLength(0)
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

  it('conduitEffect draws only the ship when both a qualifying ship and tank are in the deck', () => {
    const game = makeGame()
    game.privates.a.deck.push(
      inst({ name: 'Custom Ship', isBuiltIn: false, vehicleType: 'ship' }),
      inst({ name: 'Custom Tank', isBuiltIn: false, vehicleType: 'tank' }),
    )
    expect(effectFor('conduitEffect')!({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['Custom Ship'])
    expect(game.privates.a.deck.map((c) => c.name)).toEqual(['Custom Tank'])
  })

  it('conduitEffect falls back to a tank when no qualifying ship is in the deck', () => {
    const game = makeGame()
    game.privates.a.deck.push(inst({ name: 'Custom Tank', isBuiltIn: false, vehicleType: 'tank' }))
    expect(effectFor('conduitEffect')!({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['Custom Tank'])
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

  it('grants Scrappy but draws nothing for a built-in target at exactly the 200k boundary — the card says "less than 200k"', () => {
    const { game, target } = run({ isBuiltIn: true, materialCost: 200_000 })
    expect(target.keywords).toContain('scrappy')
    expect(game.privates.a.hand).toHaveLength(0)
  })
})

describe('wave 2 — activated abilities', () => {
  const onBoard = (over: Record<string, unknown>) => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    game.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'v1', ...over }))
    game.state.resources.a.cp = 2
    return game
  }

  it('[GT] Hunchback draws a card for 1 CP', () => {
    const game = onBoard({
      name: '[GT] Hunchback', meta: { onActivate: 'hunchbackActivate', activateCpCost: 1 },
    })
    game.privates.a.deck = [inst({ name: 'Spare' })]
    game.state.counts.a = { hand: 0, deck: 1 }
    const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'v1' }, makeCtx())
    if (!res.ok) throw new Error(res.error)
    expect(res.game.privates.a.hand).toHaveLength(1)
    expect(res.game.state.resources.a.cp).toBe(1)
  })

  it('[GT] Monsoon relocates itself, keeping its activation stamp', () => {
    const game = onBoard({
      name: '[GT] Monsoon', vehicleType: 'airship',
      meta: { onActivate: 'monsoonActivate', activateCpCost: 1 },
    })
    const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'v1', zoneId: 3 }, makeCtx())
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.zones[0].cards.a).toHaveLength(0)
    expect(res.game.state.zones[2].cards.a[0]).toMatchObject({ instanceId: 'v1', activatedOnTurn: 2 })
  })

  it('[GT] Monsoon rejects an activation with no destination', () => {
    const game = onBoard({
      name: '[GT] Monsoon', vehicleType: 'airship',
      meta: { onActivate: 'monsoonActivate', activateCpCost: 1 },
    })
    const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'v1' }, makeCtx())
    expect(res).toMatchObject({ ok: false, status: 400 })
  })

  it('Spectrum draws from the TG Robotics pool', () => {
    const game = onBoard({
      name: 'Spectrum', vehicleType: 'plane',
      meta: { onActivate: 'spectrumEffect', activateCpCost: 1 },
    })
    const ctx = makeCtx({ catalog: [snap({ name: '[TG] Widget', faction: 'TG', vehicleType: 'tank' })] })
    const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'v1' }, ctx)
    if (!res.ok) throw new Error(res.error)
    expect(res.game.privates.a.hand).toHaveLength(1)
    expect(res.game.privates.a.hand[0].faction).toBe('TG')
  })
})

describe('wave 2 — choices', () => {
  function playAbility(game: EngineGame, card: CardInstance, ctx = makeCtx()) {
    game.privates.a.hand.push(card)
    game.state.counts.a.hand = game.privates.a.hand.length
    return applyAction(game, 'alice', { type: 'PLAY_ABILITY_CARD', instanceId: card.instanceId }, ctx)
  }

  it('Kraken offers only the powers already used, and refreshes the chosen one', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    game.state.usedHeroPowers.a = ['draw', 'salvage']
    game.privates.a.hand.push(inst({
      instanceId: 'k1', name: 'Kraken', faction: 'DWG', vehicleType: 'ship',
      materialCost: 0, meta: { onPlayEffect: 'krakenOnPlay' },
    }))
    game.state.counts.a.hand = 1
    const cpBefore = game.state.resources.a.cp
    const suspended = applyAction(
      game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: 'k1', zoneId: 1 }, makeCtx(),
    )
    if (!suspended.ok) throw new Error(suspended.error)
    expect(suspended.game.state.pendingEffect?.options.map((o) => o.id)).toEqual(['draw', 'salvage'])
    const resolved = applyAction(
      suspended.game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'salvage' }, makeCtx(),
    )
    if (!resolved.ok) throw new Error(resolved.error)
    expect(resolved.game.state.usedHeroPowers.a).toEqual(['draw'])
    expect(resolved.game.state.resources.a.cp).toBe(cpBefore + 1)
  })

  it('Kraken still grants its CP when no hero power has been used', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    game.state.usedHeroPowers.a = []
    game.privates.a.hand.push(inst({
      instanceId: 'k2', name: 'Kraken', faction: 'DWG', vehicleType: 'ship',
      materialCost: 0, meta: { onPlayEffect: 'krakenOnPlay' },
    }))
    game.state.counts.a.hand = 1
    const cpBefore = game.state.resources.a.cp
    const res = applyAction(
      game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: 'k2', zoneId: 1 }, makeCtx(),
    )
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.pendingEffect).toBeNull()
    expect(res.game.state.resources.a.cp).toBe(cpBefore + 1)
  })

  it('Special Foundries draws from whichever GT airship pool is chosen', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    const ctx = makeCtx({
      catalog: [
        snap({ name: 'Wasp', faction: 'GT', vehicleType: 'airship', materialCost: 70000 }),
        snap({ name: 'Kobold', faction: 'GT', vehicleType: 'airship', materialCost: 700000 }),
      ],
    })
    const res = playAbility(game, inst({
      instanceId: 'sf1', name: 'Special Foundries', type: 'ability',
      meta: { onPlayEffect: 'specialFoundriesEffect' },
    }), ctx)
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.pendingEffect?.options.map((o) => o.id)).toEqual(['light', 'heavy'])
    const heavy = applyAction(res.game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'heavy' }, ctx)
    if (!heavy.ok) throw new Error(heavy.error)
    expect(heavy.game.privates.a.hand.map((c) => c.name)).toEqual(['Kobold'])
  })

  it('Robotic Assemblers adds the chosen TG card without naming it in the log', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    const ctx = makeCtx({
      catalog: [
        snap({ cardId: 'tg-1', name: '[TG] Alpha', faction: 'TG', vehicleType: 'tank' }),
        snap({ cardId: 'tg-2', name: '[TG] Beta', faction: 'TG', vehicleType: 'tank' }),
      ],
    })
    const res = playAbility(game, inst({
      instanceId: 'ra1', name: 'Robotic Assemblers', type: 'ability',
      meta: { onPlayEffect: 'roboticAssemblersEffect' },
    }), ctx)
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.pendingEffect?.options).toEqual([
      { id: 'tg-1', label: '[TG] Alpha' },
      { id: 'tg-2', label: '[TG] Beta' },
    ])
    const done = applyAction(res.game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'tg-2' }, ctx)
    if (!done.ok) throw new Error(done.error)
    expect(done.game.privates.a.hand.map((c) => c.name)).toEqual(['[TG] Beta'])
    expect(done.game.state.counts.a.hand).toBe(1)
    expect(done.game.state.log.join()).not.toContain('[TG] Beta')
  })
})

describe('wave 2 — board spawns', () => {
  const parapet = snap({ name: 'Parapet', faction: 'OW', vehicleType: 'plane', materialCost: 259000, meta: { summonOnly: true } })
  const martyr = snap({ name: 'Martyr', faction: 'WF', vehicleType: 'plane', materialCost: 8500, meta: { summonOnly: true } })

  it('Defensive Parapet lands two stamped Parapets in the chosen zone', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    const ctx = makeCtx({ catalog: [parapet] })
    const card = inst({
      instanceId: 'dp1', name: 'Defensive Parapet', type: 'ability', materialCost: 200000,
      meta: { playOnZoneEffect: 'defensiveParapetEffect' },
    })
    game.privates.a.hand.push(card)
    game.state.counts.a.hand = 1
    // makeGame starts each side on 100000 materials — not enough for this card.
    game.state.resources.a.materials = 300000
    const res = applyAction(game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: 'dp1', zoneId: 3 }, ctx)
    if (!res.ok) throw new Error(res.error)
    const spawned = res.game.state.zones[2].cards.a
    expect(spawned).toHaveLength(2)
    expect(spawned[0].keywords).toEqual(expect.arrayContaining(['inoffensive', 'scrappy', 'blocker']))
    expect(res.game.state.destroyed.a.map((c) => c.name)).toEqual(['Defensive Parapet'])
  })

  it('Sapphire Screen puts one Sapphire in every zone and fires no Sapphire effect', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    const sapphire = snap({
      name: 'Sapphire', faction: 'LH', vehicleType: 'plane', materialCost: 30000,
      keywords: ['mobile', 'stealthy'], meta: { onPlayEffect: 'sapphireEffect' },
    })
    const ctx = makeCtx({ catalog: [sapphire] })
    const card = inst({
      instanceId: 'ss1', name: 'Sapphire Screen', type: 'ability', materialCost: 90000,
      meta: { onPlayEffect: 'sapphireScreenEffect' },
    })
    game.privates.a.hand.push(card)
    game.state.counts.a.hand = 1
    const materialsBefore = game.state.resources.a.materials
    const res = applyAction(game, 'alice', { type: 'PLAY_ABILITY_CARD', instanceId: 'ss1' }, ctx)
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.zones.map((z) => z.cards.a.length)).toEqual([1, 1, 1])
    // Spawning is not playing (spec §7.4): no draw, no refund from sapphireEffect.
    expect(res.game.privates.a.hand).toHaveLength(0)
    expect(res.game.state.resources.a.materials).toBe(materialsBefore - 90000)
  })

  it('All for the Cause turns friendlies Temporary and spawns Martyrs by cost', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    game.state.zones[1].cards.a.push(
      zoneEntry({ instanceId: 'cheap', name: 'Skiff', materialCost: 100000 }),
      zoneEntry({ instanceId: 'dear', name: 'Dreadnought', materialCost: 300000 }),
    )
    game.state.zones[1].cards.b.push(zoneEntry({ instanceId: 'enemy', name: 'Foe' }))
    const ctx = makeCtx({ catalog: [martyr] })
    const card = inst({
      instanceId: 'afc1', name: 'All for the Cause', type: 'ability', materialCost: 0,
      meta: { playOnZoneEffect: 'allForTheCauseEffect' },
    })
    game.privates.a.hand.push(card)
    game.state.counts.a.hand = 1
    const res = applyAction(game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: 'afc1', zoneId: 2 }, ctx)
    if (!res.ok) throw new Error(res.error)
    const mine = res.game.state.zones[1].cards.a
    const originals = mine.filter((c) => c.name !== 'Martyr')
    const martyrs = mine.filter((c) => c.name === 'Martyr')
    expect(originals.every((c) => c.keywords.includes('temporary'))).toBe(true)
    expect(martyrs).toHaveLength(3)          // 1 for the 100k hull, 2 for the 300k
    expect(martyrs.every((c) => !c.keywords.includes('temporary'))).toBe(true)
    expect(res.game.state.zones[1].cards.b[0].keywords).not.toContain('temporary')
  })

  it('All for the Cause fizzles in an empty zone rather than rejecting the play', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    const ctx = makeCtx({ catalog: [martyr] })
    const card = inst({
      instanceId: 'afc2', name: 'All for the Cause', type: 'ability', materialCost: 0,
      meta: { playOnZoneEffect: 'allForTheCauseEffect' },
    })
    game.privates.a.hand.push(card)
    game.state.counts.a.hand = 1
    const res = applyAction(game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: 'afc2', zoneId: 1 }, ctx)
    expect(res.ok).toBe(true)
  })
})

describe('clydesdaleEffect on a captured hull', () => {
  it('spawns its second hull for the captor, not the deck it came from', () => {
    const card = inst({
      name: 'Clydesdale', vehicleType: 'ship', materialCost: 0,
      meta: { onPlayEffect: 'clydesdaleEffect', ownerSide: 'b' },
    })
    const game = makeGame({ privates: { a: { hand: [card], deck: [] }, b: { hand: [], deck: [] } } })
    const r = applyAction(game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    const hulls = r.game.state.zones[0].cards.a
    expect(hulls.map((c) => c.meta.ownerSide)).toEqual(['b', undefined])
  })
})

describe('wave 3 — forced battles', () => {
  const flyingSquirrel = snap({
    name: 'Flying Squirrel', faction: 'DWG', vehicleType: 'plane', materialCost: 84_000, meta: { summonOnly: true },
  })
  const martyrHull = snap({
    name: 'Martyr', faction: 'WF', vehicleType: 'plane', materialCost: 8_500, meta: { summonOnly: true },
  })

  describe('flyingSquirrelAttackEffect', () => {
    it('the target fights alone against 3 summoned Flying Squirrels', () => {
      const game = makeGame()
      const target = zoneEntry({ name: 'Foe', instanceId: 'foe-1' })
      game.state.zones[0].cards.b.push(target)
      const ok = effectFor('flyingSquirrelAttackEffect')!({
        game, actor: 'a', card: inst({ name: 'Flying Squirrel Attack' }),
        ctx: makeCtx({ catalog: [flyingSquirrel] }), targetInstanceId: target.instanceId,
      })
      expect(ok).toBe(true)
      const battle = game.state.activeBattle
      expect(battle?.zoneId).toBe(1)
      expect(battle?.aggressor).toBe('a')
      expect(battle?.defenderIds).toEqual(['foe-1']) // fights alone — no ally joins
      expect(battle?.attackerIds).toHaveLength(3)
      expect(battle?.summons).toHaveLength(3)
      expect(battle?.summons.every((s) => s.name === 'Flying Squirrel')).toBe(true)
      expect(battle?.attackerIds).toEqual(battle?.summons.map((s) => s.instanceId))
      expect(game.state.zones[0].lastActivatedTurn).toBeNull() // not a zone activation
      expect(game.state.log.at(-1)).toContain('Flying Squirrel Attack')
    })

    it('rejects a friendly target', () => {
      const game = makeGame()
      const mine = zoneEntry({ name: 'Mine', instanceId: 'mine-1' })
      game.state.zones[0].cards.a.push(mine)
      const ok = effectFor('flyingSquirrelAttackEffect')!({
        game, actor: 'a', card: inst(), ctx: makeCtx({ catalog: [flyingSquirrel] }), targetInstanceId: mine.instanceId,
      })
      expect(ok).toBe(false)
      expect(game.state.activeBattle).toBeNull()
    })
  })

  describe('martyrAttackEffect', () => {
    const run = (targetOver: Partial<Parameters<typeof zoneEntry>[0]>) => {
      const game = makeGame()
      const target = zoneEntry({ name: 'Foe', instanceId: 'foe-1', ...targetOver })
      game.state.zones[0].cards.b.push(target)
      const ok = effectFor('martyrAttackEffect')!({
        game, actor: 'a', card: inst({ name: 'Martyr Attack' }),
        ctx: makeCtx({ catalog: [martyrHull] }), targetInstanceId: target.instanceId,
      })
      return { ok, game }
    }

    it('fights 4 Martyrs against an ordinary built-in target', () => {
      const { ok, game } = run({ isBuiltIn: true, vehicleType: 'ship', materialCost: 90_000 })
      expect(ok).toBe(true)
      const battle = game.state.activeBattle
      expect(battle?.defenderIds).toEqual(['foe-1'])
      expect(battle?.attackerIds).toHaveLength(4)
      expect(battle?.summons).toHaveLength(4)
      expect(battle?.summons.every((s) => s.name === 'Martyr')).toBe(true)
      expect(game.state.zones[0].lastActivatedTurn).toBeNull()
      expect(game.state.log.at(-1)).toContain('Martyr Attack')
    })

    it('fights 6 Martyrs against a built-in airship, regardless of its cost', () => {
      const { ok, game } = run({ isBuiltIn: true, vehicleType: 'airship', materialCost: 1_000 })
      expect(ok).toBe(true)
      expect(game.state.activeBattle?.attackerIds).toHaveLength(6)
    })

    it('fights 6 Martyrs against a player design costing 400k or more', () => {
      const { ok, game } = run({ isBuiltIn: false, vehicleType: 'ship', materialCost: 400_000 })
      expect(ok).toBe(true)
      expect(game.state.activeBattle?.attackerIds).toHaveLength(6)
    })

    it('a player design under 400k stays at 4', () => {
      const { ok, game } = run({ isBuiltIn: false, vehicleType: 'ship', materialCost: 399_999 })
      expect(ok).toBe(true)
      expect(game.state.activeBattle?.attackerIds).toHaveLength(4)
    })

    it('a built-in 400k+ ship (not an airship) stays at 4', () => {
      const { ok, game } = run({ isBuiltIn: true, vehicleType: 'ship', materialCost: 500_000 })
      expect(ok).toBe(true)
      expect(game.state.activeBattle?.attackerIds).toHaveLength(4)
    })

    it('reads the printed materialCost, not the Half-Cost-halved effective cost', () => {
      // Printed 420k clears the 400k threshold; halved to 210k it would not —
      // the discriminating case between materialCost and effectiveMaterialCostOf.
      const { ok, game } = run({
        isBuiltIn: false, vehicleType: 'ship', materialCost: 420_000, keywords: ['halfCost'],
      })
      expect(ok).toBe(true)
      expect(game.state.activeBattle?.attackerIds).toHaveLength(6)
    })

    it('rejects a friendly target', () => {
      const game = makeGame()
      const mine = zoneEntry({ name: 'Mine', instanceId: 'mine-1' })
      game.state.zones[0].cards.a.push(mine)
      const ok = effectFor('martyrAttackEffect')!({
        game, actor: 'a', card: inst(), ctx: makeCtx({ catalog: [martyrHull] }), targetInstanceId: mine.instanceId,
      })
      expect(ok).toBe(false)
      expect(game.state.activeBattle).toBeNull()
    })
  })

  describe('gangUpEffect', () => {
    it('battles the target against all of the actor\'s vehicles in that zone — no summons', () => {
      const game = makeGame()
      const target = zoneEntry({ name: 'Foe', instanceId: 'foe-1' })
      const mineOne = zoneEntry({ name: 'Mine One', instanceId: 'mine-1' })
      const mineTwo = zoneEntry({ name: 'Mine Two', instanceId: 'mine-2' })
      game.state.zones[0].cards.b.push(target)
      game.state.zones[0].cards.a.push(mineOne, mineTwo)
      const ok = effectFor('gangUpEffect')!({
        game, actor: 'a', card: inst({ name: 'Gang Up' }), ctx: makeCtx(), targetInstanceId: target.instanceId,
      })
      expect(ok).toBe(true)
      const battle = game.state.activeBattle
      expect(battle?.defenderIds).toEqual(['foe-1'])
      expect(battle?.attackerIds).toEqual(['mine-1', 'mine-2'])
      expect(battle?.summons).toEqual([])
      expect(game.state.zones[0].lastActivatedTurn).toBeNull()
      expect(game.state.log.at(-1)).toContain('Gang Up')
    })

    it('excludes an Inoffensive friendly from the attacker list', () => {
      const game = makeGame()
      const target = zoneEntry({ name: 'Foe', instanceId: 'foe-1' })
      const attacker = zoneEntry({ name: 'Attacker', instanceId: 'atk-1' })
      const passive = zoneEntry({ name: 'Passive', instanceId: 'psv-1', keywords: ['inoffensive'] })
      game.state.zones[0].cards.b.push(target)
      game.state.zones[0].cards.a.push(attacker, passive)
      const ok = effectFor('gangUpEffect')!({
        game, actor: 'a', card: inst(), ctx: makeCtx(), targetInstanceId: target.instanceId,
      })
      expect(ok).toBe(true)
      expect(game.state.activeBattle?.attackerIds).toEqual(['atk-1'])
    })

    it('fails when the zone holds only Inoffensive friendlies', () => {
      const game = makeGame()
      const target = zoneEntry({ name: 'Foe', instanceId: 'foe-1' })
      const passive = zoneEntry({ name: 'Passive', instanceId: 'psv-1', keywords: ['inoffensive'] })
      game.state.zones[0].cards.b.push(target)
      game.state.zones[0].cards.a.push(passive)
      const ok = effectFor('gangUpEffect')!({
        game, actor: 'a', card: inst(), ctx: makeCtx(), targetInstanceId: target.instanceId,
      })
      expect(ok).toBe(false)
      expect(game.state.activeBattle).toBeNull()
    })

    it('rejects a friendly target', () => {
      const game = makeGame()
      const mine = zoneEntry({ name: 'Mine', instanceId: 'mine-1' })
      game.state.zones[0].cards.a.push(mine)
      const ok = effectFor('gangUpEffect')!({
        game, actor: 'a', card: inst(), ctx: makeCtx(), targetInstanceId: mine.instanceId,
      })
      expect(ok).toBe(false)
    })

    it('does not spend the zone activation — a subsequent fleet attack there still succeeds', () => {
      const game = makeGame()
      const target = zoneEntry({ name: 'Foe', instanceId: 'foe-1' })
      const attacker = zoneEntry({ name: 'Attacker', instanceId: 'atk-1' })
      game.state.zones[0].cards.b.push(target)
      game.state.zones[0].cards.a.push(attacker)
      const ok = effectFor('gangUpEffect')!({
        game, actor: 'a', card: inst(), ctx: makeCtx(), targetInstanceId: target.instanceId,
      })
      expect(ok).toBe(true)
      // Simulate the forced battle having already been reported and resolved
      // (DECIDE_BATTLE_REPORT nulls activeBattle) so a second battle may lock.
      game.state.activeBattle = null
      const r = applyAction(game, 'alice', {
        type: 'ATTACK_ENEMY_FLEET', zoneId: 1, attackerIds: ['atk-1'], targetIds: ['foe-1'],
      })
      expect(r.ok).toBe(true)
    })
  })

  describe('airStrafeEffect', () => {
    const predatorX = snap({ name: 'PredatorX', faction: 'SS', vehicleType: 'plane', materialCost: 120_000 })
    const hydra = snap({ name: 'Hydra', faction: 'SS', vehicleType: 'airship', materialCost: 230_000 })
    const cyclone = snap({ name: 'Cyclone', faction: 'SS', vehicleType: 'sub', materialCost: 280_000 })
    const catalog = [predatorX, hydra, cyclone]
    const airStrafeCard = () => inst({
      instanceId: 'as1', name: 'Air Strafe', type: 'ability', materialCost: 180_000,
      meta: { playOnVehicleEffect: 'airStrafeEffect' },
    })

    it('a built-in target fights immediately against 2 PredatorX — no suspension', () => {
      const game = makeGame()
      const target = zoneEntry({ instanceId: 'foe-1', name: 'Foe', vehicleType: 'ship', isBuiltIn: true })
      game.state.zones[0].cards.b.push(target)
      const ok = effectFor('airStrafeEffect')!({
        game, actor: 'a', card: inst({ name: 'Air Strafe' }),
        ctx: makeCtx({ catalog }), targetInstanceId: target.instanceId,
      })
      expect(ok).toBe(true)
      expect(game.state.pendingEffect).toBeNull()
      const battle = game.state.activeBattle
      expect(battle?.zoneId).toBe(1)
      expect(battle?.aggressor).toBe('a')
      expect(battle?.defenderIds).toEqual(['foe-1'])
      expect(battle?.summons).toHaveLength(2)
      expect(battle?.summons.every((s) => s.name === 'PredatorX')).toBe(true)
      expect(battle?.attackerIds).toEqual(battle?.summons.map((s) => s.instanceId))
      expect(game.state.zones[0].lastActivatedTurn).toBeNull() // not a zone activation
    })

    it('rejects a non-ship target', () => {
      const game = makeGame()
      const target = zoneEntry({ instanceId: 'foe-1', name: 'Foe Plane', vehicleType: 'plane', isBuiltIn: true })
      game.state.zones[0].cards.b.push(target)
      const ok = effectFor('airStrafeEffect')!({
        game, actor: 'a', card: inst({ name: 'Air Strafe' }),
        ctx: makeCtx({ catalog }), targetInstanceId: target.instanceId,
      })
      expect(ok).toBe(false)
      expect(game.state.activeBattle).toBeNull()
      expect(game.state.pendingEffect).toBeNull()
    })

    it('rejects a friendly target', () => {
      const game = makeGame()
      const mine = zoneEntry({ instanceId: 'mine-1', name: 'Mine', vehicleType: 'ship', isBuiltIn: true })
      game.state.zones[0].cards.a.push(mine)
      const ok = effectFor('airStrafeEffect')!({
        game, actor: 'a', card: inst({ name: 'Air Strafe' }),
        ctx: makeCtx({ catalog }), targetInstanceId: mine.instanceId,
      })
      expect(ok).toBe(false)
      expect(game.state.activeBattle).toBeNull()
    })

    it('a player-design target suspends offering exactly Hydra and Cyclone, and declares no battle yet', () => {
      const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
      game.state.resources.a.materials = 300_000
      const target = zoneEntry({ instanceId: 'foe-1', name: 'Custom Ship', vehicleType: 'ship', isBuiltIn: false })
      game.state.zones[0].cards.b.push(target)
      game.privates.a.hand.push(airStrafeCard())
      game.state.counts.a.hand = 1
      const ctx = makeCtx({ catalog })
      const res = applyAction(game, 'alice', {
        type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD', instanceId: 'as1', targetInstanceId: 'foe-1',
      }, ctx)
      if (!res.ok) throw new Error(res.error)
      expect(res.game.state.activeBattle).toBeNull()
      expect(res.game.state.pendingEffect?.effect).toBe('airStrafeEffect')
      expect(res.game.state.pendingEffect?.options).toEqual([
        { id: 'Hydra', label: 'Hydra' },
        { id: 'Cyclone', label: 'Cyclone' },
      ])
    })

    it('resolving the choice declares the battle with 3 summons, the third the chosen hull', () => {
      const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
      game.state.resources.a.materials = 300_000
      const target = zoneEntry({ instanceId: 'foe-1', name: 'Custom Ship', vehicleType: 'ship', isBuiltIn: false })
      game.state.zones[0].cards.b.push(target)
      game.privates.a.hand.push(airStrafeCard())
      game.state.counts.a.hand = 1
      const ctx = makeCtx({ catalog })
      const suspended = applyAction(game, 'alice', {
        type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD', instanceId: 'as1', targetInstanceId: 'foe-1',
      }, ctx)
      if (!suspended.ok) throw new Error(suspended.error)
      const resolved = applyAction(suspended.game, 'alice', {
        type: 'RESOLVE_PENDING_EFFECT', choiceId: 'Cyclone',
      }, ctx)
      if (!resolved.ok) throw new Error(resolved.error)
      expect(resolved.game.state.pendingEffect).toBeNull()
      const battle = resolved.game.state.activeBattle
      expect(battle?.zoneId).toBe(1)
      expect(battle?.defenderIds).toEqual(['foe-1'])
      expect(battle?.summons).toHaveLength(3)
      expect(battle?.summons.filter((s) => s.name === 'PredatorX')).toHaveLength(2)
      expect(battle?.summons.filter((s) => s.name === 'Cyclone')).toHaveLength(1)
      expect(battle?.attackerIds).toEqual(battle?.summons.map((s) => s.instanceId))
    })

    // The discriminating test (task brief Step 5): a naive re-entry that
    // reads the target's zone/id back off `payload.resolution` instead of
    // the `data` stash must be caught. The decoy sits in a different,
    // legal, non-empty zone so a wrong read does not just hit an empty
    // zone (400 either way) but a *plausible* wrong one — a stale or
    // malicious RESOLVE_PENDING_EFFECT could point at either field.
    it('the target zone and instanceId survive the suspension — a stale/wrong client zoneId and targetInstanceId on resolve are ignored', () => {
      const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
      game.state.resources.a.materials = 300_000
      const target = zoneEntry({ instanceId: 'foe-1', name: 'Custom Ship', vehicleType: 'ship', isBuiltIn: false })
      game.state.zones[0].cards.b.push(target) // zone 1 (water) — the real target
      const decoy = zoneEntry({ instanceId: 'decoy-1', name: 'Decoy Ship', vehicleType: 'ship', isBuiltIn: false })
      game.state.zones[2].cards.b.push(decoy) // zone 3 (land) — a different, legal zone with its own enemy ship
      game.privates.a.hand.push(airStrafeCard())
      game.state.counts.a.hand = 1
      const ctx = makeCtx({ catalog })
      const suspended = applyAction(game, 'alice', {
        type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD', instanceId: 'as1', targetInstanceId: 'foe-1',
      }, ctx)
      if (!suspended.ok) throw new Error(suspended.error)
      const resolved = applyAction(suspended.game, 'alice', {
        type: 'RESOLVE_PENDING_EFFECT', choiceId: 'Hydra', zoneId: 3, targetInstanceId: 'decoy-1',
      }, ctx)
      if (!resolved.ok) throw new Error(resolved.error)
      const battle = resolved.game.state.activeBattle
      expect(battle?.zoneId).toBe(1)
      expect(battle?.defenderIds).toEqual(['foe-1'])
      expect(resolved.game.state.zones[2].cards.b.map((c) => c.instanceId)).toEqual(['decoy-1'])
    })
  })
})
