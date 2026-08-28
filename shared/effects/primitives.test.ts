import { describe, expect, it } from 'vitest'
import { catalogCard, choice, drawFromPool, grant, sequence, spawnVehicles, takeFromEnemyDeck, whenPlayed, zoneOccupants } from './primitives.ts'
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

  it('fizzles rather than failing when the deck holds no match and allowEmpty is not specified — deck sources default to allowEmpty', () => {
    const game = makeGame()
    const fn = drawFromPool({ source: 'deck', filter: { vehicleType: 'sub' }, count: 1 })
    expect(fn({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.privates.a.hand).toHaveLength(0)
    expect(game.state.log).toHaveLength(1)
  })

  it('moves the correct two matching cards even as an earlier removal shifts a later match to a new index', () => {
    const game = makeGame()
    game.privates.a.deck.push(
      inst({ name: 'Sub A', vehicleType: 'sub', instanceId: 'sub-a' }),
      inst({ name: 'Ship X', vehicleType: 'ship', instanceId: 'ship-x' }),
      inst({ name: 'Sub B', vehicleType: 'sub', instanceId: 'sub-b' }),
      inst({ name: 'Ship Y', vehicleType: 'ship', instanceId: 'ship-y' }),
    )
    // rng fixed at exactly 0.5 makes shuffled() a no-op for this 2-item pool
    // (floor(0.5 * 2) === 1 swaps copy[1] with itself), so the picks are
    // processed in original deck order: the earlier match (index 0) splices
    // out before the later one (index 2) is looked up. A version that
    // computed both indices up front — instead of re-finding by instanceId
    // after each splice — would look up index 2 against the now-shifted
    // array and remove 'Ship Y' instead of 'Sub B'.
    const fn = drawFromPool({ source: 'deck', filter: { vehicleType: 'sub' }, count: 2 })
    expect(fn({ game, actor: 'a', card: inst(), ctx: makeCtx({ rng: () => 0.5 }) })).toBe(true)
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['Sub A', 'Sub B'])
    expect(game.privates.a.deck.map((c) => c.name)).toEqual(['Ship X', 'Ship Y'])
  })
})

describe('zoneOccupants', () => {
  it('returns null when there is no target zone, not an empty array', () => {
    const game = makeGame()
    const payload = { game, actor: 'a' as const, card: inst(), ctx: makeCtx() }
    expect(zoneOccupants(payload, 'own')).toBeNull()
    expect(zoneOccupants(payload, 'either')).toBeNull()
  })

  it('a whenPlayed predicate built on it does not run its body when the zone is missing', () => {
    const game = makeGame()
    let ran = false
    const fn = whenPlayed((p) => zoneOccupants(p, 'own')?.length === 0, () => { ran = true; return true })
    expect(fn({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(ran).toBe(false)
  })
})

describe('choice', () => {
  const twoOptions = choice({
    effect: 't_pick',
    prompt: 'Pick one',
    options: () => [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }],
    resolve: ({ game }, choiceId) => {
      game.state.log.push(`resolved:${choiceId ?? 'none'}`)
      return true
    },
  })

  it('suspends on the first entry and writes a public slot', () => {
    const game = makeGame()
    const card = inst({ name: 'Chooser', instanceId: 'c1' })
    expect(twoOptions({ game, actor: 'a', card, ctx: makeCtx() })).toBe(true)
    expect(game.state.pendingEffect).toMatchObject({
      effect: 't_pick', side: 'a', kind: 'choice', prompt: 'Pick one',
      options: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }],
    })
    expect(game.state.pendingEffect?.card.instanceId).toBe('c1')
    expect(game.state.log.join()).not.toContain('resolved:')
  })

  it('resolves immediately, without suspending, when there are no options', () => {
    const game = makeGame()
    const empty = choice({
      effect: 't_empty', prompt: 'Pick one', options: () => [],
      resolve: ({ game: g }, choiceId) => { g.state.log.push(`resolved:${choiceId ?? 'none'}`); return true },
    })
    expect(empty({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.state.pendingEffect).toBeNull()
    expect(game.state.log.join()).toContain('resolved:none')
  })

  it('runs resolve on re-entry with a known choiceId', () => {
    const game = makeGame()
    const card = inst({ name: 'Chooser', instanceId: 'c1' })
    twoOptions({ game, actor: 'a', card, ctx: makeCtx() })
    const pending = game.state.pendingEffect!
    game.state.pendingEffect = null
    const ok = twoOptions({
      game, actor: 'a', card, ctx: makeCtx(), pending, resolution: { choiceId: 'b' },
    })
    expect(ok).toBe(true)
    expect(game.state.log.join()).toContain('resolved:b')
  })

  it('rejects an unknown choiceId', () => {
    const game = makeGame()
    const card = inst({ instanceId: 'c1' })
    twoOptions({ game, actor: 'a', card, ctx: makeCtx() })
    const pending = game.state.pendingEffect!
    const ok = twoOptions({
      game, actor: 'a', card, ctx: makeCtx(), pending, resolution: { choiceId: 'nope' },
    })
    expect(ok).toBe(false)
  })
})

describe('spawnVehicles', () => {
  const parapet = snap({ name: 'Parapet', faction: 'OW', vehicleType: 'plane', materialCost: 259000, keywords: ['blocker'] })

  it('spawns into the target zone with merged keywords, de-duplicating overlaps', () => {
    const game = makeGame()
    const ctx = makeCtx({ catalog: [parapet] })
    const fn = spawnVehicles({ cardName: 'Parapet', count: 2, zones: 'target', keywords: ['inoffensive', 'blocker'] })
    expect(fn({ game, actor: 'a', card: inst({ name: 'Defensive Parapet' }), ctx, targetZoneId: 3 })).toBe(true)
    const spawned = game.state.zones[2].cards.a
    expect(spawned).toHaveLength(2)
    expect(spawned[0].keywords).toEqual(expect.arrayContaining(['inoffensive', 'blocker']))
    expect(spawned[0].keywords).toHaveLength(2)
    expect(spawned[0].instanceId).not.toBe(spawned[1].instanceId)
    expect(spawned[0]).toHaveProperty('activatedOnTurn', null)
  })

  it('ignores biome legality — a ship reaches land despite biome restriction', () => {
    const game = makeGame()
    const ctx = makeCtx({ catalog: [snap({ name: 'Gunboat', vehicleType: 'ship', faction: 'LH', keywords: ['mobile'] })] })
    const fn = spawnVehicles({ cardName: 'Gunboat', count: 1, zones: 'all', keywords: ['mobile', 'stealthy'] })
    expect(fn({ game, actor: 'a', card: inst({ name: 'Gunboat Screen' }), ctx })).toBe(true)
    expect(game.state.zones.map((z) => z.cards.a.length)).toEqual([1, 1, 1])
  })

  it('does not fire the spawned card\'s own onPlayEffect', () => {
    const game = makeGame()
    const ctx = makeCtx({ catalog: [snap({ name: 'Sapphire', vehicleType: 'plane', meta: { onPlayEffect: 'sapphireEffect' } })] })
    const before = game.state.resources.a.materials
    const fn = spawnVehicles({ cardName: 'Sapphire', count: 1, zones: 'all' })
    expect(fn({ game, actor: 'a', card: inst(), ctx })).toBe(true)
    expect(game.state.resources.a.materials).toBe(before)
    expect(game.privates.a.hand).toHaveLength(0)
  })

  it('fails when the catalog has no such card', () => {
    const game = makeGame()
    const fn = spawnVehicles({ cardName: 'Parapet', count: 1, zones: 'target' })
    expect(fn({ game, actor: 'a', card: inst(), ctx: makeCtx({ catalog: [] }), targetZoneId: 1 })).toBe(false)
  })

  it('fails when a target-zone spawn has no zone', () => {
    const game = makeGame()
    const fn = spawnVehicles({ cardName: 'Parapet', count: 1, zones: 'target' })
    expect(fn({ game, actor: 'a', card: inst(), ctx: makeCtx({ catalog: [parapet] }) })).toBe(false)
  })
})

describe('drawFromPool excludes summon-only cards', () => {
  it('never mints a summon-only card into a hand', () => {
    const game = makeGame()
    const ctx = makeCtx({
      catalog: [snap({ name: 'Martyr', faction: 'WF', vehicleType: 'plane', meta: { summonOnly: true } })],
    })
    const fn = drawFromPool({ source: 'catalog', filter: { faction: 'WF' }, count: 1, allowEmpty: true })
    expect(fn({ game, actor: 'a', card: inst(), ctx })).toBe(true)
    expect(game.privates.a.hand).toHaveLength(0)
  })
})
