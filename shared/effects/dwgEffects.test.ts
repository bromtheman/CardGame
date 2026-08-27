import { describe, expect, it } from 'vitest'
import { costModifierFor, effectFor } from './registry.ts'
import { DOUBLE_UP_MAX_COST, KEYWORDS, RESERVES_CARD_COUNT } from '../gameSettings.ts'
import { inst, makeCtx, makeGame, snap, zoneEntry } from '../engine/testFixtures.ts'
import './dwgEffects.ts'

describe('marauderOnPlay', () => {
  it('takes a vehicle from the enemy deck and discounts it by 50k', () => {
    const game = makeGame()
    game.privates.b.deck.push(
      inst({ name: 'Enemy Ability', type: 'ability' }),
      inst({ name: 'Enemy Ship', type: 'vehicle', materialCost: 200_000 }),
    )
    game.state.counts.b.deck = 2
    const ok = effectFor('marauderOnPlay')!({ game, actor: 'a', card: inst(), ctx: makeCtx() })
    expect(ok).toBe(true)
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['Enemy Ship'])
    expect(game.privates.a.hand[0].meta.costDelta).toBe(-50_000)
    expect(game.state.counts.b.deck).toBe(1)
    expect(game.state.log.join(' ')).not.toContain('Enemy Ship')
  })

  it('grants no CP — that was the ported behaviour, not the card text', () => {
    const game = makeGame()
    game.privates.b.deck.push(inst({ type: 'vehicle' }))
    effectFor('marauderOnPlay')!({ game, actor: 'a', card: inst(), ctx: makeCtx() })
    expect(game.state.resources.a.cp).toBe(3)
  })
})

describe('crossbonesOnPlay', () => {
  it('crossbonesOnPlay draws a card and grants 1 CP', () => {
    const game = makeGame()
    game.privates.b.deck.push(inst({ name: 'Crossbones Deck Top' }))
    game.state.counts.b.deck = 1
    const ok = effectFor('crossbonesOnPlay')!({ game, actor: 'b', card: inst(), ctx: makeCtx() })
    expect(ok).toBe(true)
    expect(game.privates.b.hand.map((c) => c.name)).toContain('Crossbones Deck Top')
    expect(game.state.resources.b.cp).toBe(4)
    expect(game.state.counts.b.hand).toBe(1)
    expect(game.state.counts.b.deck).toBe(0)
  })
})

describe('plundererCostModifier', () => {
  it('is -20_000 per own-side DWG vehicle across all zones, ignoring other faction/type/side', () => {
    const game = makeGame()
    game.state.zones[0].cards.a.push(zoneEntry({ type: 'vehicle', faction: 'DWG' }))
    game.state.zones[1].cards.a.push(zoneEntry({ type: 'vehicle', faction: 'DWG' }))
    game.state.zones[2].cards.a.push(zoneEntry({ type: 'vehicle', faction: 'OW' })) // wrong faction
    game.state.zones[0].cards.a.push(zoneEntry({ type: 'ability', faction: 'DWG' })) // wrong type
    game.state.zones[0].cards.b.push(zoneEntry({ type: 'vehicle', faction: 'DWG' })) // wrong side
    const modifier = costModifierFor('plundererCostModifier')!
    expect(modifier(game.state, 'a', inst())).toBe(-40_000)
    expect(modifier(game.state, 'b', inst())).toBe(-20_000)
  })

  it('is 0 with no friendly DWG vehicles on the field', () => {
    const game = makeGame()
    const modifier = costModifierFor('plundererCostModifier')!
    expect(modifier(game.state, 'a', inst())).toBe(-0) // 0 * -20_000 === -0
  })
})

describe('loggerheadOnDeath', () => {
  it('shuffles a free 0-cost copy into the deck with a fresh instanceId, stamps stripped, counts synced', () => {
    const game = makeGame()
    const dying = zoneEntry({
      name: 'Loggerhead', materialCost: 80_000, playedOnTurn: 2, movedOnTurn: 3,
    })
    const ok = effectFor('loggerheadOnDeath')!({
      game, actor: 'a', card: dying, ctx: makeCtx(),
    })
    expect(ok).toBe(true)
    expect(game.privates.a.deck).toHaveLength(1)
    const copy = game.privates.a.deck[0]
    expect(copy.name).toBe('Loggerhead')
    expect(copy.materialCost).toBe(0)
    expect(copy.instanceId).toBe('e-0') // ctx.newId()
    expect(copy).not.toHaveProperty('playedOnTurn')
    expect(copy).not.toHaveProperty('movedOnTurn')
    expect(game.state.counts.a.deck).toBe(1)
  })

  it('shuffles the deck via ctx.rng, moving the new copy out of last place', () => {
    const game = makeGame()
    game.privates.a.deck.push(inst({ name: 'One' }), inst({ name: 'Two' }), inst({ name: 'Three' }))
    const dying = zoneEntry({ name: 'Loggerhead', materialCost: 80_000 })
    // Fisher-Yates over [One, Two, Three, Loggerhead] with rng cycle [0.1, 0.5, 0.9]:
    //  i=3 j=floor(0.1*4)=0 -> swap(3,0): [Loggerhead, Two, Three, One]
    //  i=2 j=floor(0.5*3)=1 -> swap(2,1): [Loggerhead, Three, Two, One]
    //  i=1 j=floor(0.9*2)=1 -> swap(1,1): [Loggerhead, Three, Two, One]
    effectFor('loggerheadOnDeath')!({ game, actor: 'a', card: dying, ctx: makeCtx() })
    expect(game.privates.a.deck.map((c) => c.name)).toEqual(['Loggerhead', 'Three', 'Two', 'One'])
  })
})

describe('reservesEffect', () => {
  it('adds RESERVES_CARD_COUNT distinct built-in DWG vehicles to hand with fresh instanceIds', () => {
    const game = makeGame()
    const catalog = [
      snap({ name: 'DWG Vehicle 1' }),
      snap({ name: 'DWG Vehicle 2' }),
      snap({ name: 'DWG Vehicle 3' }),
      snap({ name: 'DWG Vehicle 4' }),
      snap({ name: 'OW Vehicle', faction: 'OW' }),
      snap({ name: 'DWG Ability', type: 'ability' }),
    ]
    const ctx = makeCtx({ catalog })
    const ok = effectFor('reservesEffect')!({ game, actor: 'a', card: inst(), ctx })
    expect(ok).toBe(true)
    expect(game.privates.a.hand).toHaveLength(RESERVES_CARD_COUNT)
    for (const card of game.privates.a.hand) {
      expect(card.faction).toBe('DWG')
      expect(card.type).toBe('vehicle')
    }
    const instanceIds = game.privates.a.hand.map((c) => c.instanceId)
    expect(new Set(instanceIds).size).toBe(RESERVES_CARD_COUNT)
    const cardIds = game.privates.a.hand.map((c) => c.cardId)
    expect(new Set(cardIds).size).toBe(RESERVES_CARD_COUNT)
    expect(game.state.counts.a.hand).toBe(RESERVES_CARD_COUNT)
  })

  it('takes all available when the pool has fewer than RESERVES_CARD_COUNT', () => {
    const game = makeGame()
    const catalog = [
      snap({ name: 'DWG Vehicle 1' }),
      snap({ name: 'DWG Vehicle 2' }),
      snap({ name: 'OW Vehicle', faction: 'OW' }),
    ]
    const ctx = makeCtx({ catalog })
    const ok = effectFor('reservesEffect')!({ game, actor: 'a', card: inst(), ctx })
    expect(ok).toBe(true)
    expect(game.privates.a.hand).toHaveLength(2)
  })

  it('returns false when the catalog has no DWG vehicles', () => {
    const game = makeGame()
    const catalog = [
      snap({ name: 'OW Vehicle', faction: 'OW' }),
      snap({ name: 'DWG Ability', type: 'ability' }),
    ]
    const ctx = makeCtx({ catalog })
    const ok = effectFor('reservesEffect')!({ game, actor: 'a', card: inst(), ctx })
    expect(ok).toBe(false)
    expect(game.privates.a.hand).toHaveLength(0)
  })
})

describe('spawnBuccaneerEffect', () => {
  it('pushes a scrappy Buccaneer into the target zone on the actor side', () => {
    const game = makeGame()
    const catalog = [snap({ name: 'Buccaneer', vehicleType: 'airship', keywords: ['someOtherKeyword'] })]
    const ctx = makeCtx({ catalog })
    const ok = effectFor('spawnBuccaneerEffect')!({
      game, actor: 'a', card: inst(), ctx, targetZoneId: 1,
    })
    expect(ok).toBe(true)
    expect(game.state.zones[0].cards.a).toHaveLength(1)
    const entry = game.state.zones[0].cards.a[0]
    expect(entry.name).toBe('Buccaneer')
    expect(entry.keywords).toEqual([KEYWORDS.SCRAPPY])
    expect(entry.instanceId).toBe('e-0')
    expect(entry).toMatchObject({ playedOnTurn: game.turnNumber, movedOnTurn: null })
  })

  it('succeeds even when the target zone holds an enemy Air Screen vehicle (spawns ignore screens)', () => {
    const game = makeGame()
    game.state.zones[0].cards.b.push(zoneEntry({ vehicleType: 'plane', keywords: [KEYWORDS.AIR_SCREEN] }))
    const catalog = [snap({ name: 'Buccaneer', vehicleType: 'airship' })]
    const ctx = makeCtx({ catalog })
    const ok = effectFor('spawnBuccaneerEffect')!({
      game, actor: 'a', card: inst(), ctx, targetZoneId: 1,
    })
    expect(ok).toBe(true)
    expect(game.state.zones[0].cards.a).toHaveLength(1)
    expect(game.state.zones[0].cards.a[0].name).toBe('Buccaneer')
  })

  it('returns false when targetZoneId is missing', () => {
    const game = makeGame()
    const catalog = [snap({ name: 'Buccaneer', vehicleType: 'airship' })]
    const ctx = makeCtx({ catalog })
    const ok = effectFor('spawnBuccaneerEffect')!({ game, actor: 'a', card: inst(), ctx })
    expect(ok).toBe(false)
  })

  it('returns false when targetZoneId does not resolve to a real zone', () => {
    const game = makeGame()
    const catalog = [snap({ name: 'Buccaneer', vehicleType: 'airship' })]
    const ctx = makeCtx({ catalog })
    const ok = effectFor('spawnBuccaneerEffect')!({
      game, actor: 'a', card: inst(), ctx, targetZoneId: 999,
    })
    expect(ok).toBe(false)
  })

  it('returns false when Buccaneer is absent from the catalog', () => {
    const game = makeGame()
    const ctx = makeCtx({ catalog: [] })
    const ok = effectFor('spawnBuccaneerEffect')!({
      game, actor: 'a', card: inst(), ctx, targetZoneId: 1,
    })
    expect(ok).toBe(false)
    expect(game.state.zones[0].cards.a).toHaveLength(0)
  })
})

describe('doubleUpEffect', () => {
  function withHandTarget(over: Record<string, unknown> = {}) {
    const game = makeGame()
    const target = inst({ type: 'vehicle', faction: 'DWG', materialCost: 40_000, ...over })
    game.privates.a.hand.push(target)
    game.state.counts.a.hand = 1
    return { game, target }
  }

  it('sets meta.additionalSpawns to 1 on first use', () => {
    const { game, target } = withHandTarget()
    const doubleUpCard = inst({ type: 'ability', name: 'Double Up' })
    const ok = effectFor('doubleUpEffect')!({
      game, actor: 'a', card: doubleUpCard, ctx: makeCtx(), targetInstanceId: target.instanceId,
    })
    expect(ok).toBe(true)
    const updated = game.privates.a.hand.find((c) => c.instanceId === target.instanceId)!
    expect(updated.meta.additionalSpawns).toBe(1)
  })

  it('increments meta.additionalSpawns to 2 on a second use', () => {
    const { game, target } = withHandTarget()
    const doubleUpCard = inst({ type: 'ability', name: 'Double Up' })
    effectFor('doubleUpEffect')!({
      game, actor: 'a', card: doubleUpCard, ctx: makeCtx(), targetInstanceId: target.instanceId,
    })
    const ok = effectFor('doubleUpEffect')!({
      game, actor: 'a', card: doubleUpCard, ctx: makeCtx(), targetInstanceId: target.instanceId,
    })
    expect(ok).toBe(true)
    const updated = game.privates.a.hand.find((c) => c.instanceId === target.instanceId)!
    expect(updated.meta.additionalSpawns).toBe(2)
  })

  it('succeeds when the effective cost is exactly DOUBLE_UP_MAX_COST (boundary is inclusive)', () => {
    const { game, target } = withHandTarget({ materialCost: DOUBLE_UP_MAX_COST })
    const doubleUpCard = inst({ type: 'ability', name: 'Double Up' })
    const ok = effectFor('doubleUpEffect')!({
      game, actor: 'a', card: doubleUpCard, ctx: makeCtx(), targetInstanceId: target.instanceId,
    })
    expect(ok).toBe(true)
  })

  it('returns false when the target is missing from hand', () => {
    const game = makeGame()
    const doubleUpCard = inst({ type: 'ability', name: 'Double Up' })
    const ok = effectFor('doubleUpEffect')!({
      game, actor: 'a', card: doubleUpCard, ctx: makeCtx(), targetInstanceId: 'nope',
    })
    expect(ok).toBe(false)
  })

  it('returns false when the target exists but sits in the opponent\'s hand', () => {
    const game = makeGame()
    const enemyOwned = inst({ type: 'vehicle', faction: 'DWG', materialCost: 40_000 })
    game.privates.b.hand.push(enemyOwned)
    game.state.counts.b.hand = 1
    const doubleUpCard = inst({ type: 'ability', name: 'Double Up' })
    const ok = effectFor('doubleUpEffect')!({
      game, actor: 'a', card: doubleUpCard, ctx: makeCtx(), targetInstanceId: enemyOwned.instanceId,
    })
    expect(ok).toBe(false)
  })

  it('returns false when the target is not a vehicle', () => {
    const { game, target } = withHandTarget({ type: 'ability' })
    const doubleUpCard = inst({ type: 'ability', name: 'Double Up' })
    const ok = effectFor('doubleUpEffect')!({
      game, actor: 'a', card: doubleUpCard, ctx: makeCtx(), targetInstanceId: target.instanceId,
    })
    expect(ok).toBe(false)
  })

  it('returns false when the target is not DWG', () => {
    const { game, target } = withHandTarget({ faction: 'OW' })
    const doubleUpCard = inst({ type: 'ability', name: 'Double Up' })
    const ok = effectFor('doubleUpEffect')!({
      game, actor: 'a', card: doubleUpCard, ctx: makeCtx(), targetInstanceId: target.instanceId,
    })
    expect(ok).toBe(false)
  })

  it('returns false when the effective cost exceeds DOUBLE_UP_MAX_COST', () => {
    const { game, target } = withHandTarget({ materialCost: DOUBLE_UP_MAX_COST + 100_000 })
    const doubleUpCard = inst({ type: 'ability', name: 'Double Up' })
    const ok = effectFor('doubleUpEffect')!({
      game, actor: 'a', card: doubleUpCard, ctx: makeCtx(), targetInstanceId: target.instanceId,
    })
    expect(ok).toBe(false)
  })

  it('returns false when targeting itself', () => {
    const game = makeGame()
    const doubleUpCard = inst({ type: 'vehicle', faction: 'DWG', name: 'Double Up', materialCost: 40_000 })
    game.privates.a.hand.push(doubleUpCard)
    game.state.counts.a.hand = 1
    const ok = effectFor('doubleUpEffect')!({
      game, actor: 'a', card: doubleUpCard, ctx: makeCtx(), targetInstanceId: doubleUpCard.instanceId,
    })
    expect(ok).toBe(false)
  })
})

describe('dwgWatersEffect', () => {
  const watersCard = () =>
    inst({ type: 'ability', name: 'DWG Waters', meta: { playOnZoneEffect: 'dwgWatersEffect' } })

  it('records a persistent DWG Waters marker on the chosen zone for the actor', () => {
    const game = makeGame()
    const card = watersCard()
    const ok = effectFor('dwgWatersEffect')!({
      game, actor: 'a', card, ctx: makeCtx(), targetZoneId: 2,
    })
    expect(ok).toBe(true)
    expect(game.state.zoneEffects).toEqual([
      { effect: 'dwgWatersEffect', zoneId: 2, side: 'a', cardName: 'DWG Waters', setOnTurn: game.turnNumber },
    ])
    expect(game.state.log.join('\n')).toContain('Zone 2')
  })

  it('returns false when the same side claims a zone it already holds', () => {
    const game = makeGame()
    const ctx = makeCtx()
    expect(effectFor('dwgWatersEffect')!({ game, actor: 'a', card: watersCard(), ctx, targetZoneId: 1 })).toBe(true)
    expect(effectFor('dwgWatersEffect')!({ game, actor: 'a', card: watersCard(), ctx, targetZoneId: 1 })).toBe(false)
    expect(game.state.zoneEffects).toHaveLength(1)
  })

  it('lets each side claim the same zone independently', () => {
    const game = makeGame()
    const ctx = makeCtx()
    expect(effectFor('dwgWatersEffect')!({ game, actor: 'a', card: watersCard(), ctx, targetZoneId: 3 })).toBe(true)
    expect(effectFor('dwgWatersEffect')!({ game, actor: 'b', card: watersCard(), ctx, targetZoneId: 3 })).toBe(true)
    expect(game.state.zoneEffects.map((e) => e.side)).toEqual(['a', 'b'])
  })

  it('returns false for a zone that does not exist or a missing target', () => {
    const game = makeGame()
    const ctx = makeCtx()
    expect(effectFor('dwgWatersEffect')!({ game, actor: 'a', card: watersCard(), ctx, targetZoneId: 99 })).toBe(false)
    expect(effectFor('dwgWatersEffect')!({ game, actor: 'a', card: watersCard(), ctx })).toBe(false)
    expect(game.state.zoneEffects).toEqual([])
  })
})
