import { describe, expect, it } from 'vitest'
import { costModifierFor, effectFor } from './registry.ts'
import { DOUBLE_UP_MAX_COST, KEYWORDS, RESERVES_CARD_COUNT } from '../gameSettings.ts'
import { inst, makeCtx, makeGame, snap, zoneEntry } from '../engine/testFixtures.ts'
import { applyAction, declareForcedBattle } from '../engine/index.ts'

describe('marauderOnPlay', () => {
  it('skips past a non-vehicle to the first vehicle, without naming it in the log', () => {
    const game = makeGame()
    game.privates.b.deck.push(
      inst({ name: 'Enemy Ability', type: 'ability' }),
      inst({ name: 'Enemy Ship', type: 'vehicle', materialCost: 200_000 }),
    )
    game.state.counts.b.deck = 2
    const ok = effectFor('marauderOnPlay')!({ game, actor: 'a', card: inst(), ctx: makeCtx() })
    expect(ok).toBe(true)
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['Enemy Ship'])
    expect(game.state.log.join(' ')).not.toContain('Enemy Ship')
  })

  it('grants no CP — that was the ported behaviour, not the card text', () => {
    const game = makeGame()
    game.privates.b.deck.push(inst({ type: 'vehicle' }))
    effectFor('marauderOnPlay')!({ game, actor: 'a', card: inst(), ctx: makeCtx() })
    expect(game.state.resources.a.cp).toBe(3)
  })

  // The discriminating test: an implementation that merely swapped the constant
  // for 0 would still rewrite meta and pass the assertion above. This one fails
  // unless the arithmetic is gone — `current - 50_000` on a card already
  // carrying -30_000 reads -80_000.
  it('leaves a costDelta the captured card already carried exactly as it was', () => {
    const game = makeGame()
    game.privates.b.deck.push(
      inst({ name: 'Discounted Ship', type: 'vehicle', meta: { costDelta: -30_000 } }),
    )
    game.state.counts.b.deck = 1
    effectFor('marauderOnPlay')!({ game, actor: 'a', card: inst(), ctx: makeCtx() })
    expect(game.privates.a.hand[0].meta.costDelta).toBe(-30_000)
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

  // Regression: reservesEffect filters ctx.catalog directly instead of going
  // through drawFromPool, so it applies the shared poolEligible predicate
  // (spec §7.4; 2026-09-02 §2.1) rather than drawFromPool's own filter. A
  // summon-only DWG vehicle (Flying Squirrel, seeded this way) must never be
  // reachable in a hand.
  it('never mints a summon-only DWG vehicle into hand (spec §7.4)', () => {
    const game = makeGame()
    const catalog = [
      snap({ name: 'DWG Vehicle 1' }),
      snap({ name: 'DWG Vehicle 2' }),
      snap({ name: 'Flying Squirrel', meta: { summonOnly: true } }),
    ]
    const ctx = makeCtx({ catalog })
    const ok = effectFor('reservesEffect')!({ game, actor: 'a', card: inst(), ctx })
    expect(ok).toBe(true)
    const names = game.privates.a.hand.map((c) => c.name)
    expect(names).not.toContain('Flying Squirrel')
    expect(names.sort()).toEqual(['DWG Vehicle 1', 'DWG Vehicle 2'])
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

  // The 2026-08-30 balance pass narrowed the target from "DWG vehicle" to
  // "DWG ship". inst() defaults to vehicleType 'ship', so every case above
  // still exercises the accepting path.
  it.each(['airship', 'plane', 'tank', 'sub'])(
    'returns false for a DWG %s — the card now says "DWG ship card in hand"',
    (vehicleType) => {
      const { game, target } = withHandTarget({ vehicleType })
      const doubleUpCard = inst({ type: 'ability', name: 'Double Up' })
      const ok = effectFor('doubleUpEffect')!({
        game, actor: 'a', card: doubleUpCard, ctx: makeCtx(), targetInstanceId: target.instanceId,
      })
      expect(ok).toBe(false)
      const untouched = game.privates.a.hand.find((c) => c.instanceId === target.instanceId)!
      expect(untouched.meta.additionalSpawns).toBeUndefined()
    },
  )

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

describe('plundererRaid', () => {
  // One implementation, two occasions (spec §4.3, DP2 departure 5): at resolve
  // onBattleVictory only reaches the winning side, and at a bombardment
  // dispatchBaseAttackVictory sets survived and won both true. So the whole
  // guard is `survived && won`.
  const raidCtx = (over: Partial<Record<string, unknown>> = {}) => ({
    phase: 'resolve' as const, zoneId: 1, isDefender: false, isParticipant: true,
    forced: false, survived: true, won: true, casualties: [], ...over,
  })

  function armed() {
    const game = makeGame()
    game.privates.a.deck.push(inst({ name: 'Own Top' }))
    game.privates.b.deck.push(inst({ name: 'Enemy Top' }))
    return game
  }

  it('draws from the enemy deck on a victorious battle it survived', () => {
    const game = armed()
    const ok = effectFor('plundererRaid')!({
      game, actor: 'a', card: zoneEntry({ name: 'Plunderer' }), ctx: makeCtx(), battle: raidCtx(),
    })
    expect(ok).toBe(true)
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['Enemy Top'])
    expect(game.privates.a.deck.map((c) => c.name)).toEqual(['Own Top']) // its own deck untouched
    // Both sides resync — one card left b's deck and entered a's hand.
    expect(game.state.counts.a.hand).toBe(1)
    expect(game.state.counts.b.deck).toBe(0)
    // Public log must not name a card entering a hidden hand.
    expect(game.state.log.join(' ')).not.toContain('Enemy Top')
  })

  it('draws nothing when it won but did not survive, or survived but did not win', () => {
    for (const over of [{ survived: false }, { won: false }]) {
      const game = armed()
      const ok = effectFor('plundererRaid')!({
        game, actor: 'a', card: zoneEntry({ name: 'Plunderer' }), ctx: makeCtx(), battle: raidCtx(over),
      })
      expect(ok).toBe(true)
      expect(game.privates.a.hand).toHaveLength(0)
    }
  })

  it('draws nothing with no battle context at all', () => {
    const game = armed()
    const ok = effectFor('plundererRaid')!({
      game, actor: 'a', card: zoneEntry({ name: 'Plunderer' }), ctx: makeCtx(),
    })
    expect(ok).toBe(true)
    expect(game.privates.a.hand).toHaveLength(0)
  })

  it('reports cleanly when the enemy deck is empty', () => {
    const game = makeGame()
    const ok = effectFor('plundererRaid')!({
      game, actor: 'a', card: zoneEntry({ name: 'Plunderer' }), ctx: makeCtx(), battle: raidCtx(),
    })
    expect(ok).toBe(true)
    expect(game.privates.a.hand).toHaveLength(0)
    expect(game.state.log.join(' ')).toContain('finds nothing to take')
  })

  it('draws end to end when it bombards the enemy base', () => {
    const game = makeGame({ turnNumber: 3 })
    game.privates.b.deck.push(inst({ name: 'Enemy Top' }))
    game.state.zones[0].cards.a.push(zoneEntry({
      name: 'Plunderer', materialCost: 180_000, playedOnTurn: 2,
      meta: { onBattleVictory: 'plundererRaid' },
    }))
    const r = applyAction(game, 'alice', { type: 'ATTACK_ENEMY_BASE', zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.a.hand.map((c) => c.name)).toEqual(['Enemy Top'])
    expect(r.game.state.zones[0].baseHp.b).toBe(1000 - 180)
  })

  it('draws end to end when it survives a battle that wipes the enemy', () => {
    const game = makeGame({ turnNumber: 3 })
    game.privates.b.deck.push(inst({ name: 'Enemy Top' }))
    const plunderer = zoneEntry({
      name: 'Plunderer', playedOnTurn: 2, meta: { onBattleVictory: 'plundererRaid' },
    })
    const foe = zoneEntry({ name: 'Foe' })
    game.state.zones[0].cards.a.push(plunderer)
    game.state.zones[0].cards.b.push(foe)
    const declared = applyAction(game, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
      attackerIds: [plunderer.instanceId], targetIds: [foe.instanceId],
    }, makeCtx())
    if (!declared.ok) throw new Error(declared.error)
    const submitted = applyAction(declared.game, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [plunderer.instanceId]: 95, [foe.instanceId]: 5 }, repairs: [],
    }, makeCtx())
    if (!submitted.ok) throw new Error(submitted.error)
    const decided = applyAction(submitted.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true }, makeCtx())
    if (!decided.ok) throw new Error(decided.error)
    expect(decided.game.privates.a.hand.map((c) => c.name)).toEqual(['Enemy Top'])
  })

  // baseStrikersIn's roster, not everything in the zone: a Plunderer that
  // could not strike did not "inflict damage to the enemy base".
  it('draws nothing on a bombardment it could not contribute to', () => {
    const game = makeGame({ turnNumber: 3 })
    game.privates.b.deck.push(inst({ name: 'Enemy Top' }))
    game.state.zones[0].cards.a.push(
      zoneEntry({ name: 'Gunboat', materialCost: 40_000, playedOnTurn: 2 }),
      zoneEntry({
        name: 'Plunderer', materialCost: 180_000, playedOnTurn: 2,
        vehicleType: 'sub', meta: { onBattleVictory: 'plundererRaid' },
      }),
    )
    const r = applyAction(game, 'alice', { type: 'ATTACK_ENEMY_BASE', zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.a.hand).toHaveLength(0)
    expect(r.game.state.zones[0].baseHp.b).toBe(1000 - 40) // the Gunboat struck; the sub did not
  })

  it('keeps its costModifier working alongside the new trigger', () => {
    const game = makeGame()
    game.state.zones[0].cards.a.push(
      zoneEntry({ type: 'vehicle', faction: 'DWG' }),
      zoneEntry({ type: 'vehicle', faction: 'DWG' }),
    )
    expect(costModifierFor('plundererCostModifier')!(game.state, 'a', inst())).toBe(-40_000)
  })
})

describe('DWG Waters clauses 2 and 3', () => {
  // The guest pool "from the game" is the catalog (spec §7.3): built-in DWG
  // vehicles under 60k, filtered through the shared poolEligible predicate
  // because this filters ctx.catalog directly rather than going through
  // drawFromPool.
  const corsair = snap({ name: 'Corsair', faction: 'DWG', type: 'vehicle', materialCost: 30_000 })
  const marauderHull = snap({ name: 'Marauder', faction: 'DWG', type: 'vehicle', materialCost: 40_000 })
  const tooDear = snap({ name: 'Plunderer', faction: 'DWG', type: 'vehicle', materialCost: 180_000 })
  const wrongFaction = snap({ name: 'Rook', faction: 'OW', type: 'vehicle', materialCost: 20_000 })
  const squirrel = snap({
    name: 'Flying Squirrel', faction: 'DWG', type: 'vehicle', materialCost: 20_000,
    meta: { summonOnly: true },
  })
  const watersSnap = snap({ name: 'DWG Waters', faction: 'DWG', type: 'ability', vehicleType: null })
  const fullCatalog = [corsair, marauderHull, tooDear, wrongFaction, squirrel, watersSnap]

  function claimed(over: { side?: 'a' | 'b'; zoneId?: number } = {}) {
    const game = makeGame({ turnNumber: 3 })
    game.state.zoneEffects.push({
      effect: 'dwgWatersEffect', zoneId: over.zoneId ?? 1, side: over.side ?? 'b',
      cardName: 'DWG Waters', setOnTurn: 1,
    })
    return game
  }

  describe('clause 2 — a guest joins a defensive battle in the claimed zone', () => {
    it('offers exactly the DWG vehicles under 60k, and nothing else', () => {
      const game = claimed()
      const attacker = zoneEntry({ playedOnTurn: 2 })
      const defender = zoneEntry({ name: 'Home Fleet' })
      game.state.zones[0].cards.a.push(attacker)
      game.state.zones[0].cards.b.push(defender)
      const r = applyAction(game, 'alice', {
        type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
        attackerIds: [attacker.instanceId], targetIds: [defender.instanceId],
      }, makeCtx({ catalog: fullCatalog }))
      if (!r.ok) throw new Error(r.error)
      expect(r.game.state.pendingEffect?.side).toBe('b')
      expect(r.game.state.pendingEffect?.options.map((o) => o.id).sort()).toEqual(['Corsair', 'Marauder'])
    })

    it('summons the chosen guest into the battle as a defender', () => {
      const game = claimed()
      const attacker = zoneEntry({ playedOnTurn: 2 })
      const defender = zoneEntry({ name: 'Home Fleet' })
      game.state.zones[0].cards.a.push(attacker)
      game.state.zones[0].cards.b.push(defender)
      const declared = applyAction(game, 'alice', {
        type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
        attackerIds: [attacker.instanceId], targetIds: [defender.instanceId],
      }, makeCtx({ catalog: fullCatalog }))
      if (!declared.ok) throw new Error(declared.error)
      const r = applyAction(declared.game, 'bob', {
        type: 'RESOLVE_PENDING_EFFECT', choiceId: 'Corsair',
      }, makeCtx({ catalog: fullCatalog }))
      if (!r.ok) throw new Error(r.error)
      const battle = r.game.state.activeBattle
      expect(battle?.summons.map((s) => s.name)).toEqual(['Corsair'])
      expect(battle?.defenderIds).toHaveLength(2)
      expect(r.game.state.zones[0].cards.b.map((c) => c.name)).toEqual(['Home Fleet']) // never a board unit
    })

    it('offers nothing on an OFFENSIVE battle in the claimed zone', () => {
      const game = claimed({ side: 'a' }) // the aggressor holds the claim
      const attacker = zoneEntry({ playedOnTurn: 2 })
      const defender = zoneEntry({ name: 'Foe' })
      game.state.zones[0].cards.a.push(attacker)
      game.state.zones[0].cards.b.push(defender)
      const r = applyAction(game, 'alice', {
        type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
        attackerIds: [attacker.instanceId], targetIds: [defender.instanceId],
      }, makeCtx({ catalog: fullCatalog }))
      if (!r.ok) throw new Error(r.error)
      expect(r.game.state.pendingEffect).toBeNull()
    })

    it('offers nothing for a battle in an unclaimed zone', () => {
      const game = claimed({ zoneId: 2 })
      const attacker = zoneEntry({ playedOnTurn: 2 })
      const defender = zoneEntry({ name: 'Home Fleet' })
      game.state.zones[0].cards.a.push(attacker)
      game.state.zones[0].cards.b.push(defender)
      const r = applyAction(game, 'alice', {
        type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
        attackerIds: [attacker.instanceId], targetIds: [defender.instanceId],
      }, makeCtx({ catalog: fullCatalog }))
      if (!r.ok) throw new Error(r.error)
      expect(r.game.state.pendingEffect).toBeNull()
    })

    it('declining leaves the battle unchanged and reportable', () => {
      const game = claimed()
      const attacker = zoneEntry({ playedOnTurn: 2 })
      const defender = zoneEntry({ name: 'Home Fleet' })
      game.state.zones[0].cards.a.push(attacker)
      game.state.zones[0].cards.b.push(defender)
      const declared = applyAction(game, 'alice', {
        type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
        attackerIds: [attacker.instanceId], targetIds: [defender.instanceId],
      }, makeCtx({ catalog: fullCatalog }))
      if (!declared.ok) throw new Error(declared.error)
      const r = applyAction(declared.game, 'bob', {
        type: 'RESOLVE_PENDING_EFFECT', cancel: true,
      }, makeCtx({ catalog: fullCatalog }))
      if (!r.ok) throw new Error(r.error)
      expect(r.game.state.activeBattle?.summons).toEqual([])
      expect(r.game.state.activeBattle?.defenderIds).toEqual([defender.instanceId])
    })
  })

  describe('clause 3 — a direct base attack is intercepted', () => {
    function bombard(catalog = fullCatalog) {
      const game = claimed()
      game.state.zones[0].cards.a.push(zoneEntry({ name: 'Raider', materialCost: 40_000, playedOnTurn: 2 }))
      const r = applyAction(game, 'alice', { type: 'ATTACK_ENEMY_BASE', zoneId: 1 }, makeCtx({ catalog }))
      if (!r.ok) throw new Error(r.error)
      return r.game
    }

    it('converts the bombardment into a battle against a summoned guardian', () => {
      const out = bombard()
      const battle = out.state.activeBattle
      expect(battle?.zoneId).toBe(1)
      expect(battle?.aggressor).toBe('a')
      expect(battle?.summons).toHaveLength(1)
      expect(['Corsair', 'Marauder']).toContain(battle?.summons[0].name)
      expect(battle?.defenderIds).toEqual([battle?.summons[0].instanceId])
      expect(battle?.attackerIds).toHaveLength(1)
    })

    it('lands no base damage, and spends the attacker activation on the battle', () => {
      const out = bombard()
      expect(out.state.zones[0].baseHp.b).toBe(1000) // untouched
      expect(out.state.zones[0].lastActivatedTurn).toBe(3)
    })

    // Spec §4.3, DP2 departure 9. ATTACK_ENEMY_BASE now also dispatches the
    // ATTACKER's own zone riders, with isDefender: false. Clause 3 branched on
    // `phase === 'baseAttack'` alone, which was enough while only the defender
    // was ever dispatched with that phase — reached as the attacker it would
    // intercept its owner's own bombardment. Its text says "if THE ENEMY
    // attacks you directly in this zone".
    it('does not intercept a bombardment its own claimant is making', () => {
      const game = claimed({ side: 'a' }) // alice holds the claim AND is attacking
      game.state.zones[0].cards.a.push(
        zoneEntry({ name: 'Raider', materialCost: 40_000, playedOnTurn: 2 }),
      )
      // Bob needs a hull that could BE a striker, or the guard is untestable:
      // clause 3 reads the strikers of `otherSide(actor)`, and with an empty
      // enemy side it bails on "nothing to fight" whether or not it should.
      game.state.zones[0].cards.b.push(
        zoneEntry({ name: 'Home Guard', materialCost: 50_000, playedOnTurn: 2 }),
      )
      const r = applyAction(game, 'alice', { type: 'ATTACK_ENEMY_BASE', zoneId: 1 }, makeCtx({ catalog: fullCatalog }))
      if (!r.ok) throw new Error(r.error)
      expect(r.game.state.activeBattle).toBeNull()
      expect(r.game.state.zones[0].baseHp.b).toBe(960) // 40k / 1000 = 40 damage landed
    })

    // Clause 2 must not also fire for the battle clause 3 just created: the
    // defender has no fleet IN THAT BATTLE, and "alongside your fleet" needs a
    // fleet (spec §7.3). The defender is given a hull standing in the zone but
    // NOT dragged into the fight, so this can tell "no fleet in the battle"
    // (what hasFleet checks) from "no fleet in the zone" — with an empty zone
    // the two are indistinguishable and deleting the check still passes.
    it('does not also offer a clause-2 guest for its own battle', () => {
      const game = claimed()
      game.state.zones[0].cards.a.push(zoneEntry({ name: 'Raider', materialCost: 40_000, playedOnTurn: 2 }))
      game.state.zones[0].cards.b.push(zoneEntry({ name: 'Bystander' })) // in the zone, not in the battle
      const r = applyAction(game, 'alice', { type: 'ATTACK_ENEMY_BASE', zoneId: 1 }, makeCtx({ catalog: fullCatalog }))
      if (!r.ok) throw new Error(r.error)
      expect(r.game.state.activeBattle?.defenderIds).toHaveLength(1) // the guardian alone
      expect(r.game.state.pendingEffect).toBeNull()
      expect(r.game.state.activeBattle?.summons).toHaveLength(1)
    })

    // The guardian is a battle summon: it must evaporate on approval and never
    // reach state.destroyed. Corsair and Marauder are both DRAFTABLE cards, so
    // a leak would put a free one into the DWG player's deck via
    // reshuffleDiscard (spec §4.4).
    it('the guardian evaporates on approval and never reaches a discard', () => {
      const out = bombard()
      const battle = out.state.activeBattle
      if (!battle) throw new Error('no interception')
      const striker = battle.attackerIds[0]
      const guardian = battle.summons[0].instanceId
      const submitted = applyAction(out, 'alice', {
        type: 'SUBMIT_BATTLE_REPORT',
        results: { [striker]: 95, [guardian]: 5 }, repairs: [],
      }, makeCtx({ catalog: fullCatalog }))
      if (!submitted.ok) throw new Error(submitted.error)
      const decided = applyAction(submitted.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true },
        makeCtx({ catalog: fullCatalog }))
      if (!decided.ok) throw new Error(decided.error)
      expect(decided.game.state.destroyed.a).toEqual([])
      expect(decided.game.state.destroyed.b).toEqual([])
      expect(decided.game.state.zones[0].cards.b).toEqual([])
      expect(decided.game.state.log.join('\n')).toContain('summoned vehicle(s) evaporated')
    })

    it('leaves an unclaimed zone alone', () => {
      const game = makeGame({ turnNumber: 3 })
      game.state.zones[0].cards.a.push(zoneEntry({ materialCost: 40_000, playedOnTurn: 2 }))
      const r = applyAction(game, 'alice', { type: 'ATTACK_ENEMY_BASE', zoneId: 1 }, makeCtx({ catalog: fullCatalog }))
      if (!r.ok) throw new Error(r.error)
      expect(r.game.state.activeBattle).toBeNull()
      expect(r.game.state.zones[0].baseHp.b).toBe(1000 - 40)
    })

    it('lets the bombardment through when no guest is available', () => {
      const out = bombard([watersSnap, tooDear, wrongFaction])
      expect(out.state.activeBattle).toBeNull()
      expect(out.state.zones[0].baseHp.b).toBe(1000 - 40)
    })

    // "Beat this ship in battle FIRST before doing damage with their surviving
    // vehicles" — a gate, not a wall. The damage is deferred behind the fight,
    // not cancelled, and rides ActiveBattle.continuation because the battle and
    // the bombardment cannot share a turn.
    it('the deferred bombardment lands when the attacker beats the guardian', () => {
      const out = bombard()
      const battle = out.state.activeBattle
      if (!battle) throw new Error('no interception')
      expect(out.state.zones[0].baseHp.b).toBe(1000) // nothing yet
      const striker = battle.attackerIds[0]
      const guardian = battle.summons[0].instanceId
      const ctx = makeCtx({ catalog: fullCatalog })
      const submitted = applyAction(out, 'alice', {
        type: 'SUBMIT_BATTLE_REPORT',
        results: { [striker]: 95, [guardian]: 5 }, repairs: [],
      }, ctx)
      if (!submitted.ok) throw new Error(submitted.error)
      const decided = applyAction(submitted.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true }, ctx)
      if (!decided.ok) throw new Error(decided.error)
      // The 40k Raider survived, so floor(40000/1000) = 40 lands now.
      expect(decided.game.state.zones[0].baseHp.b).toBe(1000 - 40)
      expect(decided.game.state.log.join('\n')).toContain('the guardian is beaten')
    })

    // The guardian holding must stop the damage EVEN WHEN a striker survived.
    // With a single striker, "the guardian held" and "no striker survived" are
    // the same board, so the `won` check would be untestable — two strikers,
    // one of which lives, is what separates them.
    it('nothing lands when the guardian holds, even with a surviving striker', () => {
      const game = claimed()
      game.state.zones[0].cards.a.push(
        zoneEntry({ name: 'Raider', materialCost: 40_000, playedOnTurn: 2 }),
        zoneEntry({ name: 'Cutter', materialCost: 90_000, playedOnTurn: 2 }),
      )
      const ctx = makeCtx({ catalog: fullCatalog })
      const attacked = applyAction(game, 'alice', { type: 'ATTACK_ENEMY_BASE', zoneId: 1 }, ctx)
      if (!attacked.ok) throw new Error(attacked.error)
      const battle = attacked.game.state.activeBattle
      if (!battle) throw new Error('no interception')
      const [first, second] = battle.attackerIds
      const guardian = battle.summons[0].instanceId
      const submitted = applyAction(attacked.game, 'alice', {
        type: 'SUBMIT_BATTLE_REPORT',
        results: { [first]: 5, [second]: 95, [guardian]: 95 }, repairs: [],
      }, ctx)
      if (!submitted.ok) throw new Error(submitted.error)
      const decided = applyAction(submitted.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true }, ctx)
      if (!decided.ok) throw new Error(decided.error)
      // The Cutter lived, but the ship was not beaten — so no damage at all.
      expect(decided.game.state.zones[0].baseHp.b).toBe(1000)
    })

    // "Their surviving vehicles" means the ones that FOUGHT, not everything
    // standing in the zone when the report is finally approved. A report can be
    // approved a turn later, by which time the attacker may have moved more
    // hulls in — those did not beat the guardian and must not benefit from it.
    it('a hull that arrived after the interception adds nothing', () => {
      const out = bombard()
      const battle = out.state.activeBattle
      if (!battle) throw new Error('no interception')
      const striker = battle.attackerIds[0]
      const guardian = battle.summons[0].instanceId
      // Reinforcement that was never in the fight, old enough to pass the
      // freshly-deployed filter.
      out.state.zones[0].cards.a.push(zoneEntry({ name: 'Latecomer', materialCost: 90_000, playedOnTurn: 1 }))
      const ctx = makeCtx({ catalog: fullCatalog })
      const submitted = applyAction(out, 'alice', {
        type: 'SUBMIT_BATTLE_REPORT',
        results: { [striker]: 95, [guardian]: 5 }, repairs: [],
      }, ctx)
      if (!submitted.ok) throw new Error(submitted.error)
      const decided = applyAction(submitted.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true }, ctx)
      if (!decided.ok) throw new Error(decided.error)
      // 40 from the Raider that actually fought — not 130.
      expect(decided.game.state.zones[0].baseHp.b).toBe(1000 - 40)
    })

    // "With their SURVIVING vehicles" — a striker that died in the fight
    // contributes nothing. Two strikers of different weights, so a wrong
    // roster gives a different number rather than merely zero.
    it('only the surviving strikers deal the deferred damage', () => {
      const game = claimed()
      game.state.zones[0].cards.a.push(
        zoneEntry({ name: 'Raider', materialCost: 40_000, playedOnTurn: 2 }),
        zoneEntry({ name: 'Cutter', materialCost: 90_000, playedOnTurn: 2 }),
      )
      const ctx = makeCtx({ catalog: fullCatalog })
      const attacked = applyAction(game, 'alice', { type: 'ATTACK_ENEMY_BASE', zoneId: 1 }, ctx)
      if (!attacked.ok) throw new Error(attacked.error)
      const battle = attacked.game.state.activeBattle
      if (!battle) throw new Error('no interception')
      const [first, second] = battle.attackerIds
      const guardian = battle.summons[0].instanceId
      const submitted = applyAction(attacked.game, 'alice', {
        type: 'SUBMIT_BATTLE_REPORT',
        results: { [first]: 5, [second]: 95, [guardian]: 5 }, repairs: [],
      }, ctx)
      if (!submitted.ok) throw new Error(submitted.error)
      const decided = applyAction(submitted.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true }, ctx)
      if (!decided.ok) throw new Error(decided.error)
      // The 40k Raider died; only the 90k Cutter is left to strike.
      expect(decided.game.state.zones[0].baseHp.b).toBe(1000 - 90)
    })

    // A Blocker that reached the zone during the fight still protects the
    // base — the same guard ATTACK_ENEMY_BASE applies, re-checked against the
    // board as it stands when the damage would land.
    it('a Blocker arriving during the battle still shields the base', () => {
      const out = bombard()
      const battle = out.state.activeBattle
      if (!battle) throw new Error('no interception')
      const striker = battle.attackerIds[0]
      const guardian = battle.summons[0].instanceId
      out.state.zones[0].cards.b.push(zoneEntry({ name: 'Wall', keywords: ['blocker'] }))
      const ctx = makeCtx({ catalog: fullCatalog })
      const submitted = applyAction(out, 'alice', {
        type: 'SUBMIT_BATTLE_REPORT',
        results: { [striker]: 95, [guardian]: 5 }, repairs: [],
      }, ctx)
      if (!submitted.ok) throw new Error(submitted.error)
      const decided = applyAction(submitted.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true }, ctx)
      if (!decided.ok) throw new Error(decided.error)
      expect(decided.game.state.zones[0].baseHp.b).toBe(1000)
      expect(decided.game.state.log.join('\n')).toContain('Blocker shields the base')
    })

    it('picks the guardian deterministically under a seeded rng', () => {
      const first = bombard().state.activeBattle?.summons[0].name
      const second = bombard().state.activeBattle?.summons[0].name
      expect(first).toBe(second)
    })
  })

  it('clause 1 still claims the zone when played, with no battle context', () => {
    const game = makeGame()
    const ok = effectFor('dwgWatersEffect')!({
      game, actor: 'a', card: inst({ name: 'DWG Waters' }),
      ctx: makeCtx({ catalog: fullCatalog }), targetZoneId: 2,
    })
    expect(ok).toBe(true)
    expect(game.state.zoneEffects).toHaveLength(1)
    expect(game.state.zoneEffects[0]).toMatchObject({ effect: 'dwgWatersEffect', zoneId: 2, side: 'a' })
  })
})

// The whole loop the copy model exists to support, walked end to end: capture,
// play, lose the copy, capture again — with the enemy's own card never leaving
// their deck at any point. The unit tests pin each step; this pins that the
// steps compose and that the cycle is repeatable.
describe('the capture loop repeats, and the enemy keeps their card throughout', () => {
  it('survives capture → play → death → capture again', () => {
    const ctx = makeCtx()
    const game = makeGame()
    game.privates.b.deck.push(
      inst({ name: 'Loot', type: 'vehicle', keywords: ['temporary'], materialCost: 10_000 }),
      inst({ name: 'Filler', type: 'vehicle', materialCost: 10_000 }),
    )
    game.state.counts.b.deck = 2
    const marauder = () =>
      effectFor('marauderOnPlay')!({ game, actor: 'a', card: inst(), ctx })
    const deckOfB = () => game.privates.b.deck.map((c) => c.name)

    // 1. capture
    marauder()
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['Loot'])
    expect(deckOfB()).toEqual(['Filler', 'Loot'])   // 2. the original went to the bottom, not away

    // 3. play the copy, then let Temporary cull it at end of turn
    const copy = game.privates.a.hand.pop()!
    game.state.counts.a.hand = 0
    game.state.zones[0].cards.a.push(zoneEntry({ ...copy, playedOnTurn: 2 }))
    const r = applyAction(game, 'alice', { type: 'END_TURN' }, ctx)
    if (!r.ok) throw new Error(r.error)

    // 4. the copy is gone from the board and from BOTH discards
    expect(r.game.state.zones[0].cards.a).toEqual([])
    expect(r.game.state.destroyed.a).toEqual([])
    expect(r.game.state.destroyed.b).toEqual([])

    // 5. bob draws the card that was under Loot, and Loot is still his to
    //    draw after it — the capture delayed it, never denied it, which is
    //    the whole point of the copy model
    const again = r.game
    expect(again.privates.b.hand.map((c) => c.name)).toEqual(['Filler'])
    expect(again.privates.b.deck.map((c) => c.name)).toEqual(['Loot'])

    // 6. and the loop runs again, off whatever is left of his deck
    expect(effectFor('marauderOnPlay')!({ game: again, actor: 'a', card: inst(), ctx })).toBe(true)
    expect(again.privates.a.hand.map((c) => c.name)).toEqual(['Loot'])
    expect(again.privates.b.deck.map((c) => c.name)).toEqual(['Loot'])
  })
})

describe('captured cards mint copies for their captor', () => {
  // A hull minted off a captured copy is a card of the minter's own. A copy
  // that inherited the phantom stamp would be destroyed the moment it left
  // play, so the captor would never get the free Loggerhead back.
  it('shuffles the free Loggerhead copy in unstamped', () => {
    const game = makeGame()
    const dying = zoneEntry({
      name: 'Loggerhead', materialCost: 80_000, meta: { capturedCopy: true },
    })
    effectFor('loggerheadOnDeath')!({ game, actor: 'a', card: dying, ctx: makeCtx() })
    expect(game.privates.a.deck).toHaveLength(1)
    expect(game.privates.a.deck[0].meta.capturedCopy).toBeUndefined()
  })
})

describe('wave 5 — Ongoing Attrition', () => {
  const attritionSnap = snap({
    name: 'Ongoing Attrition', faction: 'DWG', type: 'ability', vehicleType: null,
    materialCost: 40_000, cardText: 'Choose a zone…',
    meta: { playOnZoneEffect: 'ongoingAttritionEffect' },
  })
  const attritionCtx = () => makeCtx({ catalog: [attritionSnap] })

  // "40k damage" is materials-denominated like every other base-damage figure
  // in this game (design spec §3.4: floor(materialCost / 1000)), so one
  // surplus vehicle costs the enemy base 40 of its 1000 HP — not 40,000.
  const PER_SURPLUS_HP = 40

  // alice claims zone 1, then the caller stocks the zone.
  function claimed(over: { mine?: number; theirs?: number; theirKeywords?: string[] } = {}) {
    const game = makeGame({ turnNumber: 3, activePlayer: 'alice' })
    const card = inst({ ...attritionSnap })
    game.privates.a.hand.push(card)
    game.state.counts.a.hand = 1
    const r = applyAction(game, 'alice', {
      type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1,
    }, attritionCtx())
    if (!r.ok) throw new Error(r.error)
    const mine = Array.from({ length: over.mine ?? 0 }, (_, i) =>
      zoneEntry({ name: `Mine ${i}`, materialCost: 40_000, playedOnTurn: 2 }))
    const theirs = Array.from({ length: over.theirs ?? 0 }, (_, i) =>
      zoneEntry({ name: `Theirs ${i}`, materialCost: 40_000, playedOnTurn: 2, keywords: over.theirKeywords ?? [] }))
    r.game.state.zones[0].cards.a.push(...mine)
    r.game.state.zones[0].cards.b.push(...theirs)
    return { game: r.game, mine, theirs }
  }

  it('claims the zone with a rest-of-turn rider that draws if it never fires', () => {
    const { game } = claimed()
    expect(game.state.zoneEffects).toEqual([{
      effect: 'ongoingAttritionEffect', zoneId: 1, side: 'a', cardName: 'Ongoing Attrition',
      setOnTurn: 3, expiresOnTurn: 3, data: { drawOnExpiry: true },
    }])
  })

  it('deals 40k per surplus vehicle at a fleet-attack lock, and is spent by it', () => {
    const { game, mine, theirs } = claimed({ mine: 3, theirs: 1 })
    const r = applyAction(game, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
      attackerIds: [mine[0].instanceId], targetIds: [theirs[0].instanceId],
    }, attritionCtx())
    if (!r.ok) throw new Error(r.error)
    // Surplus is ZONE population (3 - 1 = 2), not the committed selection —
    // only one attacker was sent (spec §7.3).
    expect(r.game.state.zones[0].baseHp.b).toBe(1000 - 2 * PER_SURPLUS_HP)
    expect(r.game.state.zoneEffects).toEqual([])
  })

  it('does nothing and keeps the rider when the sides are level', () => {
    const { game, mine, theirs } = claimed({ mine: 1, theirs: 1 })
    const r = applyAction(game, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
      attackerIds: [mine[0].instanceId], targetIds: [theirs[0].instanceId],
    }, attritionCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].baseHp.b).toBe(1000)
    expect(r.game.state.zoneEffects).toHaveLength(1)
  })

  it('fires on a bombardment too, on top of the bombardment damage', () => {
    const { game } = claimed({ mine: 1, theirs: 0 })
    const r = applyAction(game, 'alice', { type: 'ATTACK_ENEMY_BASE', zoneId: 1 }, attritionCtx())
    if (!r.ok) throw new Error(r.error)
    // 40k hull bombards for 40, then one surplus vehicle adds 40 more.
    expect(r.game.state.zones[0].baseHp.b).toBe(1000 - 40 - PER_SURPLUS_HP)
    expect(r.game.state.zoneEffects).toEqual([])
  })

  it('is blocked by an enemy Blocker, and keeps the rider', () => {
    const { game, mine, theirs } = claimed({ mine: 3, theirs: 1, theirKeywords: ['blocker'] })
    const r = applyAction(game, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
      attackerIds: [mine[0].instanceId], targetIds: [theirs[0].instanceId],
    }, attritionCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].baseHp.b).toBe(1000)
    expect(r.game.state.zoneEffects).toHaveLength(1)
    expect(r.game.state.log.some((l) => l.includes('Blocker'))).toBe(true)
  })

  it('does nothing against a base that has already fallen, and keeps the rider', () => {
    const { game, mine, theirs } = claimed({ mine: 3, theirs: 1 })
    game.state.zones[0].baseHp.b = 0
    const r = applyAction(game, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
      attackerIds: [mine[0].instanceId], targetIds: [theirs[0].instanceId],
    }, attritionCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].baseHp.b).toBe(0)
    expect(r.game.state.zoneEffects).toHaveLength(1)
  })

  it('does not fire when its owner is the DEFENDER in that zone', () => {
    const { game, mine, theirs } = claimed({ mine: 3, theirs: 1 })
    const bobsTurn = { ...game, activePlayer: 'bob', turnNumber: 3.5 }
    const r = applyAction(bobsTurn, 'bob', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
      attackerIds: [theirs[0].instanceId], targetIds: [mine[0].instanceId],
    }, attritionCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].baseHp.b).toBe(1000)
    expect(r.game.state.zoneEffects).toHaveLength(1)
  })

  it('clamps at zero and ends the game when the second zone falls', () => {
    const { game, mine, theirs } = claimed({ mine: 3, theirs: 1 })
    game.state.zones[0].baseHp.b = 10 // less than the 80 about to land
    game.state.zones[2].baseHp.b = 0  // one zone already lost
    const r = applyAction(game, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
      attackerIds: [mine[0].instanceId], targetIds: [theirs[0].instanceId],
    }, attritionCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].baseHp.b).toBe(0)
    expect(r.game.status).toBe('complete')
    expect(r.game.winnerId).toBe('alice')
  })

  // A defensive guard, pinned directly because no dispatch reaches it today:
  // riders fire at 'lock' and 'baseAttack' only. If a later wave adds a
  // resolve-phase rider pass, this card must not strike a second time for the
  // battle it already struck at lock — a mutation of the phase check survives
  // every end-to-end test above, which is exactly why this one calls the
  // effect directly.
  it('ignores a resolve-phase context', () => {
    const { game } = claimed({ mine: 3, theirs: 1 })
    const ok = effectFor('ongoingAttritionEffect')!({
      game, actor: 'a', card: inst({ ...attritionSnap }), ctx: attritionCtx(),
      battle: {
        phase: 'resolve', zoneId: 1, isDefender: false, isParticipant: true,
        forced: false, survived: true, won: true, casualties: [],
      },
    })
    expect(ok).toBe(true)
    expect(game.state.zones[0].baseHp.b).toBe(1000)
    expect(game.state.zoneEffects).toHaveLength(1)
  })

  // Spec §4.3: "a forced battle is not a zone activation" — it neither
  // consumes nor is blocked by lastActivatedTurn. This card's trigger is the
  // activation, so a card-forced fight in the claimed zone must not pay out,
  // and the rider survives to draw. (Ambush, on the same zone, WOULD fire:
  // its trigger is fighting a battle there, not activating the zone.)
  it('does not fire on a forced battle — that is not a zone activation', () => {
    const { game, mine, theirs } = claimed({ mine: 3, theirs: 1 })
    const declared = declareForcedBattle(game, attritionCtx(), {
      zoneId: 1, aggressor: 'a',
      attackerIds: [mine[0].instanceId], defenderIds: [theirs[0].instanceId],
      cause: 'Gang Up',
    })
    expect(declared).toBe(true)
    expect(game.state.zones[0].baseHp.b).toBe(1000)
    expect(game.state.zoneEffects).toHaveLength(1)
  })

  it('draws at END_TURN when it never dealt damage', () => {
    const { game } = claimed({ mine: 1, theirs: 1 })
    game.privates.a.deck = [inst({ name: 'Reward' }), inst()]
    game.state.counts.a.deck = 2
    const r = applyAction(game, 'alice', { type: 'END_TURN' }, attritionCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.a.hand.map((c) => c.name)).toEqual(['Reward'])
    expect(r.game.state.zoneEffects).toEqual([])
  })

  it('draws nothing at END_TURN once it has dealt damage', () => {
    const { game, mine, theirs } = claimed({ mine: 3, theirs: 1 })
    const struck = applyAction(game, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
      attackerIds: [mine[0].instanceId], targetIds: [theirs[0].instanceId],
    }, attritionCtx())
    if (!struck.ok) throw new Error(struck.error)
    struck.game.state.activeBattle = null // the battle is over
    struck.game.privates.a.deck = [inst({ name: 'Reward' }), inst()]
    struck.game.state.counts.a.deck = 2
    const r = applyAction(struck.game, 'alice', { type: 'END_TURN' }, attritionCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.a.hand).toHaveLength(0)
  })
})

// All three enemy-deck effects go through takeFromEnemyDeck, so all three
// inherit the copy model. Pinned per card so a future branch in one of them
// cannot quietly revert to moving the card.
describe('enemy-deck capture is a copy, for all three cards', () => {
  it('marauderOnPlay copies a vehicle at full price, and leaves the deck intact', () => {
    const game = makeGame()
    game.privates.b.deck.push(
      inst({ name: 'Enemy Ability', type: 'ability' }),
      inst({ name: 'Enemy Ship', type: 'vehicle', materialCost: 200_000 }),
    )
    game.state.counts.b.deck = 2
    effectFor('marauderOnPlay')!({ game, actor: 'a', card: inst(), ctx: makeCtx() })
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['Enemy Ship'])
    // The 2026-09-02 pass paid for the 50k discount with 15k of printed cost
    // (40k -> 55k) and dropped the clause from the card text. No stamp at all
    // now — not a zero one, which would still read as a deliberate discount.
    expect(game.privates.a.hand[0].meta.costDelta).toBeUndefined()
    expect(game.privates.a.hand[0].meta.capturedCopy).toBe(true)
    expect(game.privates.b.deck.map((c) => c.name)).toEqual(['Enemy Ability', 'Enemy Ship'])
    expect(game.state.counts.b.deck).toBe(2)
  })

  it('paddlegunEffect copies, leaving the deck intact', () => {
    const game = makeGame()
    game.privates.b.deck.push(inst({ name: 'Enemy Secret' }))
    game.state.counts.b.deck = 1
    effectFor('paddlegunEffect')!({ game, actor: 'a', card: inst(), ctx: makeCtx() })
    expect(game.privates.a.hand[0].meta.capturedCopy).toBe(true)
    expect(game.privates.b.deck.map((c) => c.name)).toEqual(['Enemy Secret'])
    expect(game.state.counts.b.deck).toBe(1)
  })

  it('plundererRaid copies, leaving the deck intact', () => {
    const game = makeGame()
    game.privates.b.deck.push(inst({ name: 'Enemy Secret' }))
    game.state.counts.b.deck = 1
    effectFor('plundererRaid')!({
      game, actor: 'a', card: inst(), ctx: makeCtx(),
      battle: { survived: true, won: true, zoneId: 1 },
    })
    expect(game.privates.a.hand[0].meta.capturedCopy).toBe(true)
    expect(game.privates.b.deck.map((c) => c.name)).toEqual(['Enemy Secret'])
    expect(game.state.counts.b.deck).toBe(1)
  })

  // The reported bug: a copy leaves the original on top, so every raid read
  // the same card until the enemy happened to draw it. Marauder plus two
  // Plunderer raids must reach three different cards.
  it('Marauder then two Plunderer raids take three different cards, not the top card thrice', () => {
    const game = makeGame()
    const ctx = makeCtx()
    game.privates.b.deck.push(
      inst({ name: 'Ship One', type: 'vehicle' }),
      inst({ name: 'Ship Two', type: 'vehicle' }),
      inst({ name: 'Ship Three', type: 'vehicle' }),
    )
    game.state.counts.b.deck = 3
    effectFor('marauderOnPlay')!({ game, actor: 'a', card: inst(), ctx })
    const raid = effectFor('plundererRaid')!
    raid({ game, actor: 'a', card: inst(), ctx, battle: { survived: true, won: true, zoneId: 1 } })
    raid({ game, actor: 'a', card: inst(), ctx, battle: { survived: true, won: true, zoneId: 1 } })
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['Ship One', 'Ship Two', 'Ship Three'])
    expect(game.privates.b.deck.map((c) => c.name).sort()).toEqual(['Ship One', 'Ship Three', 'Ship Two'])
    expect(game.state.counts.b.deck).toBe(3)
  })
})
