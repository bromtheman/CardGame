import { describe, expect, it } from 'vitest'
import { CATALOG_EFFECTS, costModifierFor, effectFor } from './registry.ts'
import { DOUBLE_UP_MAX_COST, KEYWORDS, MAX_VEHICLES_PER_ZONE_SIDE, RESERVES_CARD_COUNT } from '../gameSettings.ts'
import { chargeOf } from '../engine/charge.ts'
import { inst, makeCtx, makeGame, snap, zoneEntry } from '../engine/testFixtures.ts'
import {
  HOME_SIDE_KEY, applyAction, autoRepairIds, baseStrikersIn, declareForcedBattle, findVehicle,
} from '../engine/index.ts'
import type { EngineGame } from '../engine/engineTypes.ts'
import type { CardInstance } from '../engine/gameInit.ts'

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

  // Regression: a Loggerhead a Plunderer raid captured (meta.costDelta: +20k,
  // spec §6.1) and that its captor then played is in exactly this shape when it
  // dies — copyMeta strips only the phantom capturedCopy stamp, not costDelta,
  // so without an explicit strip here the free copy would inherit the surcharge
  // and cost 20k despite its own text promising "It costs 0." — and reseed the
  // stamp on every later death. toHaveProperty, not toBeUndefined: a fix that
  // merely zeroed the stamp instead of removing it must still fail this.
  it('strips a costDelta stamp off the free copy — a raided Loggerhead still costs 0', () => {
    const game = makeGame()
    const dying = zoneEntry({
      name: 'Loggerhead', materialCost: 80_000, meta: { costDelta: 20_000 },
    })
    const ok = effectFor('loggerheadOnDeath')!({
      game, actor: 'a', card: dying, ctx: makeCtx(),
    })
    expect(ok).toBe(true)
    expect(game.privates.a.deck).toHaveLength(1)
    const copy = game.privates.a.deck[0]
    expect(copy.materialCost).toBe(0)
    expect(copy.meta).not.toHaveProperty('costDelta')
  })

  // Fix round (2026-09-16 review, minor A): the deck copy used to be built with
  // copyMeta plus a two-field destructure, so every OTHER per-instance stamp
  // rode into the deck. A Mutiny-stolen Loggerhead that dies in the thief's
  // turn arrives stamped `homeSide` and carrying a granted TEMPORARY (with its
  // `grantedKeywords` marker); left on, the thief's deck would hand out a
  // Loggerhead that files itself into the ENEMY's discard and is permanently
  // Temporary — and a Hysteria'd one would come back permanently Inoffensive.
  // discardSnapshotOf already owns that strip list; the copy must go through it.
  it('builds the free copy as a clean discard snapshot — no homeSide, no granted keyword', () => {
    const game = makeGame()
    const dying = zoneEntry({
      name: 'Loggerhead', materialCost: 80_000,
      keywords: [KEYWORDS.TEMPORARY],
      meta: { homeSide: 'b', grantedKeywords: [KEYWORDS.TEMPORARY] },
      activatedOnTurn: 2,
    })
    const ok = effectFor('loggerheadOnDeath')!({
      game, actor: 'a', card: dying, ctx: makeCtx(),
    })
    expect(ok).toBe(true)
    expect(game.privates.a.deck).toHaveLength(1)
    const copy = game.privates.a.deck[0]
    expect(copy.materialCost).toBe(0)
    expect(copy.meta).not.toHaveProperty('homeSide')
    expect(copy.meta).not.toHaveProperty('grantedKeywords')
    expect(copy.keywords).not.toContain(KEYWORDS.TEMPORARY)
    expect(copy).not.toHaveProperty('activatedOnTurn')
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

// Buccaneer printed FRAGILE from the 2026-09-02 pass through 2026-09-16, when
// M-6 moved it to SCRAPPY instead (the seeded row now prints the same keyword
// Spawn Buccaneer's text grants). This fixture keeps FRAGILE anyway: it is not
// mirroring the live row but pinning the ENGINE's ordering — spawnBuccaneerEffect
// REPLACES the printed keyword array rather than merging into it (unlike
// mintHull), so a spawned Buccaneer is Scrappy-only while a played one keeps
// whatever it is printed with, Fragile included. That ordering rule is worth
// pinning independent of which keyword the seed currently prints. Both shapes
// are pinned here with the repair verdict each earns — and so is the verdict
// for a combined hull, so the answer is on record if the two ever are merged.
//
// The seeded value itself is pinned in supabase/seed/balance/dwg.balance.test.ts
// and supabase/seed/balance/2026-09-16.balance.test.ts; nothing under shared/
// may read the seed, so those files close the loop between them.
describe('Buccaneer: FRAGILE printed, SCRAPPY granted', () => {
  const seededBuccaneer = () =>
    snap({ name: 'Buccaneer', vehicleType: 'airship', keywords: [KEYWORDS.FRAGILE] })

  function spawned() {
    const game = makeGame()
    const ctx = makeCtx({ catalog: [seededBuccaneer()] })
    const ok = effectFor('spawnBuccaneerEffect')!({
      game, actor: 'a', card: inst(), ctx, targetZoneId: 1,
    })
    expect(ok).toBe(true)
    return game.state.zones[0].cards.a[0]
  }

  it('mints a Scrappy hull that does not inherit the printed Fragile', () => {
    // toEqual, not toContain: a merge would read ['fragile', 'scrappy'] and
    // satisfy a containment check while reversing the hull's repair behaviour.
    expect(spawned().keywords).toEqual([KEYWORDS.SCRAPPY])
  })

  it('auto-repairs the spawned hull in the band, and never the played one', () => {
    const hull = spawned()
    const played = zoneEntry({ name: 'Buccaneer', keywords: [KEYWORDS.FRAGILE] })
    const results = { [hull.instanceId]: 85, [played.instanceId]: 85 }
    const roster = [
      { entry: hull, side: 'a' as const },
      { entry: played, side: 'a' as const },
    ]
    expect(autoRepairIds(roster, results)).toEqual([hull.instanceId])
  })

  it('repairs neither, if the two keywords ever do land on one hull', () => {
    // autoRepairIds checks FRAGILE before SCRAPPY (shared/engine/battleResolve.ts),
    // so FRAGILE wins and the free repair is denied. Asserted rather than
    // assumed, because §6.1 reasons about exactly this hull.
    const both = zoneEntry({
      name: 'Buccaneer', keywords: [KEYWORDS.FRAGILE, KEYWORDS.SCRAPPY],
    })
    expect(autoRepairIds([{ entry: both, side: 'a' as const }], { [both.instanceId]: 85 }))
      .toEqual([])
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

  // ⚠ `grantedSpawns`, NOT `additionalSpawns` (wave 8). The latter is PRINTED
  // card data on nine seeded cards, so a grant written there is
  // indistinguishable from a print and discardSnapshotOf cannot strip one
  // without rewriting the other. deployVehicle sums the two.
  it('sets meta.grantedSpawns to 1 on first use, leaving printed data alone', () => {
    const { game, target } = withHandTarget()
    const doubleUpCard = inst({ type: 'ability', name: 'Double Up' })
    const ok = effectFor('doubleUpEffect')!({
      game, actor: 'a', card: doubleUpCard, ctx: makeCtx(), targetInstanceId: target.instanceId,
    })
    expect(ok).toBe(true)
    const updated = game.privates.a.hand.find((c) => c.instanceId === target.instanceId)!
    expect(updated.meta.grantedSpawns).toBe(1)
    expect(updated.meta).not.toHaveProperty('additionalSpawns')
  })

  it('increments meta.grantedSpawns to 2 on a second use', () => {
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
    expect(updated.meta.grantedSpawns).toBe(2)
  })

  // A card that already prints extra copies stacks rather than being
  // overwritten — the grant is a separate counter, and deployVehicle adds it.
  it('stacks on top of a card that PRINTS additionalSpawns', () => {
    const { game, target } = withHandTarget({ meta: { additionalSpawns: 1 } })
    const doubleUpCard = inst({ type: 'ability', name: 'Double Up' })
    effectFor('doubleUpEffect')!({
      game, actor: 'a', card: doubleUpCard, ctx: makeCtx(), targetInstanceId: target.instanceId,
    })
    const updated = game.privates.a.hand.find((c) => c.instanceId === target.instanceId)!
    expect(updated.meta.additionalSpawns).toBe(1)
    expect(updated.meta.grantedSpawns).toBe(1)
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
      expect(untouched.meta.grantedSpawns).toBeUndefined()
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

  it('takes a DWG hovercraft — it counts as a ship (2026-09-22 hovercraft amendment)', () => {
    const { game, target } = withHandTarget({ vehicleType: 'hover' })
    const ok = effectFor('doubleUpEffect')!({
      game, actor: 'a', card: inst({ type: 'ability', name: 'Double Up' }), ctx: makeCtx(),
      targetInstanceId: target.instanceId,
    })
    expect(ok).toBe(true)
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

  // The 2026-09-02 clause: "…draw one card from the enemy deck, but increase
  // its cost by 20k." The number is spelled out rather than imported from
  // gameSettings — a test that reads its expectation out of the source it is
  // checking proves nothing.
  it('stamps a +20k surcharge on the card it takes', () => {
    const game = armed()
    const ok = effectFor('plundererRaid')!({
      game, actor: 'a', card: zoneEntry({ name: 'Plunderer' }), ctx: makeCtx(), battle: raidCtx(),
    })
    expect(ok).toBe(true)
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['Enemy Top'])
    expect(game.privates.a.hand[0].meta.costDelta).toBe(20_000)
    // Still a capture: the copy is a phantom, and the log still names nothing.
    expect(game.privates.a.hand[0].meta.capturedCopy).toBe(true)
    expect(game.state.log.join(' ')).not.toContain('Enemy Top')
  })

  it('adds to a costDelta the raided card already carried, rather than replacing it', () => {
    const game = makeGame()
    game.privates.b.deck.push(inst({ name: 'Enemy Top', meta: { costDelta: -50_000 } }))
    game.state.counts.b.deck = 1
    effectFor('plundererRaid')!({
      game, actor: 'a', card: zoneEntry({ name: 'Plunderer' }), ctx: makeCtx(), battle: raidCtx(),
    })
    expect(game.privates.a.hand[0].meta.costDelta).toBe(-30_000)
  })

  // The surcharge belongs to the COPY. Stamping the original would raise the
  // price of a card sitting in its owner's own deck — a capture is allowed to
  // reorder that deck and nothing else (docs/claude/card-effects.md).
  it('leaves the enemy original unsurcharged in their deck', () => {
    const game = armed()
    effectFor('plundererRaid')!({
      game, actor: 'a', card: zoneEntry({ name: 'Plunderer' }), ctx: makeCtx(), battle: raidCtx(),
    })
    expect(game.privates.b.deck.map((c) => c.name)).toEqual(['Enemy Top'])
    expect(game.privates.b.deck[0].meta.costDelta).toBeUndefined()
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

    // Fix round 1: a STUNNED Blocker arriving during the battle does not
    // shield the base — dwgWatersAftermath re-applies every guard
    // ATTACK_ENEMY_BASE itself would, and that guard is stun-aware
    // (2026-09-21 LH spec §3.4).
    it('a stunned Blocker arriving during the battle does NOT shield the base', () => {
      const out = bombard()
      const battle = out.state.activeBattle
      if (!battle) throw new Error('no interception')
      const striker = battle.attackerIds[0]
      const guardian = battle.summons[0].instanceId
      out.state.zones[0].cards.b.push(
        zoneEntry({ name: 'Wall', keywords: ['blocker'], stunnedUntilTurn: out.turnNumber + 1 }),
      )
      const ctx = makeCtx({ catalog: fullCatalog })
      const submitted = applyAction(out, 'alice', {
        type: 'SUBMIT_BATTLE_REPORT',
        results: { [striker]: 95, [guardian]: 5 }, repairs: [],
      }, ctx)
      if (!submitted.ok) throw new Error(submitted.error)
      const decided = applyAction(submitted.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true }, ctx)
      if (!decided.ok) throw new Error(decided.error)
      expect(decided.game.state.zones[0].baseHp.b).toBe(1000 - 40)
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
    }, attritionCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].baseHp.b).toBe(1000)
    expect(r.game.state.zoneEffects).toHaveLength(1)
    expect(r.game.state.log.some((l) => l.includes('Blocker'))).toBe(true)
  })

  // Fix round 1: a stunned Blocker does not shield the base — the same guard
  // ATTACK_ENEMY_BASE itself applies is stun-aware (2026-09-21 LH spec §3.4),
  // and this rider re-applies that guard, so it must be too.
  it('is NOT blocked by a stunned enemy Blocker', () => {
    const { game, mine, theirs } = claimed({ mine: 3, theirs: 1, theirKeywords: ['blocker'] })
    theirs[0].stunnedUntilTurn = game.turnNumber + 1
    const r = applyAction(game, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
    }, attritionCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].baseHp.b).toBe(1000 - 2 * PER_SURPLUS_HP)
    expect(r.game.state.zoneEffects).toEqual([])
  })

  it('does nothing against a base that has already fallen, and keeps the rider', () => {
    const { game, mine, theirs } = claimed({ mine: 3, theirs: 1 })
    game.state.zones[0].baseHp.b = 0
    const r = applyAction(game, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
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
    // Marauder's capture is free; each Plunderer raid costs 20k. One stamp per
    // raid, on the card that raid took.
    expect(game.privates.a.hand.map((c) => c.meta.costDelta)).toEqual([undefined, 20_000, 20_000])
    expect(game.privates.b.deck.map((c) => c.name).sort()).toEqual(['Ship One', 'Ship Three', 'Ship Two'])
    expect(game.state.counts.b.deck).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// 2026-09-16 M-4 — DWG Mutiny: "Choose an enemy vehicle, gain control of it and
// give it temporary." A CONTROL CHANGE, new engine ground: the entry moves from
// zone.cards[enemy] to zone.cards[actor] in the same zone, carries a homeSide
// stamp so it is discarded to its owner (Q2), gains TEMPORARY through
// grantKeywordsTo so the turn-start cull removes it, and is re-stamped as
// freshly deployed (D-1, Boarding Party's precedent).
describe('mutinyEffect (2026-09-16 M-4)', () => {
  const mutiny = () => inst({
    name: 'Mutiny', faction: 'DWG', type: 'ability', vehicleType: null, materialCost: 400_000,
    meta: { playOnVehicleEffect: 'mutinyEffect' },
  })
  // Bob keeps one card in his deck: END_TURN draws for the incoming side, and
  // an EMPTY deck would reshuffle his discard — the buried Foe included —
  // straight back into it, hiding exactly what the Q2 test below looks for.
  const board = () => {
    const game = makeGame({ turnNumber: 3 })
    const foe = zoneEntry({ instanceId: 'foe1', name: 'Foe', cardId: 'card:foe', keywords: ['blocker'], playedOnTurn: 1 })
    game.state.zones[0].cards.b.push(foe)
    game.privates.b.deck.push(inst({ name: 'B Top' }))
    game.state.counts.b.deck = 1
    return { game, foe }
  }
  const steal = (game: EngineGame, targetInstanceId: string) => effectFor('mutinyEffect')!({
    game, actor: 'a', card: mutiny(), ctx: makeCtx(), targetInstanceId,
  })

  it('moves the hull to the actor\'s side of the same zone, Temporary, stamped home, freshly deployed', () => {
    const { game } = board()
    expect(steal(game, 'foe1')).toBe(true)
    expect(game.state.zones[0].cards.b).toHaveLength(0)
    const found = findVehicle(game.state, 'foe1')!
    expect(found.side).toBe('a')
    expect(found.zone.id).toBe(1)
    expect(found.entry.keywords).toEqual(['blocker', KEYWORDS.TEMPORARY])
    expect(found.entry.meta.grantedKeywords).toEqual([KEYWORDS.TEMPORARY])
    expect(found.entry.meta[HOME_SIDE_KEY]).toBe('b')
    expect(found.entry).toMatchObject({ playedOnTurn: 3, movedOnTurn: null, activatedOnTurn: null })
    expect(game.state.log.at(-1)).toContain('Foe')
  })

  it('refuses a friendly hull, and a missing one', () => {
    const { game } = board()
    game.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'mine1', playedOnTurn: 1 }))
    expect(steal(game, 'mine1')).toBe(false)
    expect(steal(game, 'nope')).toBe(false)
    expect(effectFor('mutinyEffect')!({ game, actor: 'a', card: mutiny(), ctx: makeCtx() })).toBe(false)
  })

  // Q1: refuse, do not exceed the cap.
  it('refuses when the actor\'s side of the zone is at its cap', () => {
    const { game } = board()
    for (let i = 0; i < MAX_VEHICLES_PER_ZONE_SIDE; i++) {
      game.state.zones[0].cards.a.push(zoneEntry({ instanceId: `full-${i}`, playedOnTurn: 1 }))
    }
    expect(steal(game, 'foe1')).toBe(false)
    expect(game.state.zones[0].cards.b.map((c) => c.instanceId)).toEqual(['foe1'])
  })

  // Q1's second gate: the same uniquePerZone rule moveEntry applies.
  it('refuses to steal a second copy of a uniquePerZone card into a zone holding one', () => {
    const game = makeGame({ turnNumber: 3 })
    game.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'myOb', cardId: 'card:ob', meta: { uniquePerZone: true }, playedOnTurn: 1 }))
    game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'theirOb', cardId: 'card:ob', meta: { uniquePerZone: true }, playedOnTurn: 1 }))
    expect(steal(game, 'theirOb')).toBe(false)
    expect(findVehicle(game.state, 'theirOb')!.side).toBe('b')
  })

  it('leaves an already-Temporary hull Temporary without recording a grant', () => {
    const game = makeGame({ turnNumber: 3 })
    game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'tmp', keywords: [KEYWORDS.TEMPORARY], playedOnTurn: 1 }))
    expect(steal(game, 'tmp')).toBe(true)
    const entry = findVehicle(game.state, 'tmp')!.entry
    expect(entry.keywords).toEqual([KEYWORDS.TEMPORARY])
    expect(entry.meta.grantedKeywords).toBeUndefined()
  })

  // Q2 end to end: played for real, then the thief ends the turn. The cull
  // discards the hull to its OWNER's pile, clean of the stamp and the grant.
  it('is culled at the thief\'s END_TURN into the owner\'s discard, clean', () => {
    const { game } = board()
    const card = mutiny()
    game.privates.a.hand.push(card)
    game.state.counts.a.hand = 1
    game.state.resources.a.materials = 400_000
    const played = applyAction(game, 'alice', {
      type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD', instanceId: card.instanceId, targetInstanceId: 'foe1',
    }, makeCtx())
    if (!played.ok) throw new Error(played.error)
    expect(played.game.state.resources.a.materials).toBe(0)
    expect(findVehicle(played.game.state, 'foe1')!.side).toBe('a')
    const ended = applyAction(played.game, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!ended.ok) throw new Error(ended.error)
    expect(findVehicle(ended.game.state, 'foe1')).toBeNull()
    // Alice's pile holds only the SPENT Mutiny card — never the hull it stole.
    expect(ended.game.state.destroyed.a.map((c) => c.name)).toEqual(['Mutiny'])
    const buried = ended.game.state.destroyed.b
    expect(buried.map((c) => c.name)).toEqual(['Foe'])
    expect(buried[0].keywords).toEqual(['blocker'])
    expect((buried[0].meta as Record<string, unknown>)[HOME_SIDE_KEY]).toBeUndefined()
    expect(buried[0].meta.grantedKeywords).toBeUndefined()
  })

  // A refused play spends nothing (Q1): the handler 400s and the clone is dropped.
  it('a refused play through the handler leaves the hand and materials untouched', () => {
    const { game } = board()
    for (let i = 0; i < MAX_VEHICLES_PER_ZONE_SIDE; i++) {
      game.state.zones[0].cards.a.push(zoneEntry({ instanceId: `full-${i}`, playedOnTurn: 1 }))
    }
    const card = mutiny()
    game.privates.a.hand.push(card)
    game.state.counts.a.hand = 1
    game.state.resources.a.materials = 400_000
    const r = applyAction(game, 'alice', {
      type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD', instanceId: card.instanceId, targetInstanceId: 'foe1',
    }, makeCtx())
    expect(r).toMatchObject({ ok: false, status: 400 })
    expect(game.privates.a.hand).toHaveLength(1)
    expect(game.state.resources.a.materials).toBe(400_000)
  })

  // D-1: a stolen hull cannot bombard this turn (fresh deployment), which is
  // Boarding Party's rule for a hull that changed sides.
  it('re-stamps playedOnTurn so the stolen hull cannot bombard this turn', () => {
    const { game } = board()
    steal(game, 'foe1')
    const entry = findVehicle(game.state, 'foe1')!.entry
    expect(baseStrikersIn([entry], game.turnNumber)).toEqual([])
  })

  it('needs no catalog', () => {
    expect(CATALOG_EFFECTS.has('mutinyEffect')).toBe(false)
  })
})

// 2026-09-16 — DWG Brigand (new to the repo): "When this is destroyed, draw a
// copy of Mutiny". SCRAPPY plus a death trigger is allowed (card-effects.md
// rule 10 as corrected; Argonaut's precedent). slasherOnPlay's shape: mint from
// the catalog by name, through poolEligible, into the hand via putInHand.
describe('brigandOnDeath (2026-09-16)', () => {
  const mutinyRow = snap({
    name: 'Mutiny', faction: 'DWG', type: 'ability', vehicleType: null, materialCost: 400_000,
    meta: { playOnVehicleEffect: 'mutinyEffect' },
  })
  const brigand = () => zoneEntry({ name: 'Brigand', faction: 'DWG', vehicleType: 'ship', keywords: ['scrappy'] })

  it('puts one Mutiny into the owner\'s hand and resyncs the count', () => {
    const game = makeGame()
    const ok = effectFor('brigandOnDeath')!({ game, actor: 'a', card: brigand(), ctx: makeCtx({ catalog: [mutinyRow] }) })
    expect(ok).toBe(true)
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['Mutiny'])
    expect(game.privates.a.hand[0].meta.playOnVehicleEffect).toBe('mutinyEffect')
    expect(game.privates.a.hand[0].handEnteredTurn).toBe(game.turnNumber)
    expect(game.state.counts.a.hand).toBe(1)
  })

  it('never names the card in the public log', () => {
    const game = makeGame()
    effectFor('brigandOnDeath')!({ game, actor: 'a', card: brigand(), ctx: makeCtx({ catalog: [mutinyRow] }) })
    expect(game.state.log.join(' ')).not.toContain('Mutiny')
  })

  // A death effect must return false on failure, never throw (architecture.md).
  it('returns false when the catalog has no Mutiny', () => {
    const game = makeGame()
    expect(effectFor('brigandOnDeath')!({ game, actor: 'a', card: brigand(), ctx: makeCtx({ catalog: [] }) })).toBe(false)
  })

  // ⚠ Unit tests cannot catch a missing flag — makeCtx hands them a catalog.
  it('is registered as needing the catalog', () => {
    expect(CATALOG_EFFECTS.has('brigandOnDeath')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2026-09-16 M-5 — DWG Sinners Luck: "when played, you may swap a friendly
// airship with an enemy airship or plane. If airship you provide is worth less
// than what you get, the opponent draws a card and reduces that cards cost by
// the difference."
//
// Two hops through choice() (Braveheart's shape). Q3: side AND zone are
// exchanged; Q4: "worth" is printed materialCost; D-1: both hulls re-stamp as
// freshly deployed; D-3: an empty pool at either hop resolves without a swap.
describe('sinnersLuckOnPlay (2026-09-16 M-5)', () => {
  const sinners = () => inst({
    instanceId: 'sl1', name: 'Sinners Luck', faction: 'DWG', vehicleType: 'ship', materialCost: 250_000,
    meta: { onPlayEffect: 'sinnersLuckOnPlay' },
  })
  // My airships in zones 1 and 2, a ship and a plane of mine that must never
  // be offered; enemy airship in zone 2, enemy plane in zone 3, enemy ship.
  const armed = () => {
    const card = sinners()
    const game = makeGame({
      turnNumber: 3, activePlayer: 'alice',
      privates: { a: { hand: [card], deck: [] }, b: { hand: [], deck: [inst({ name: 'Enemy Top' })] } },
    })
    game.state.resources.a.materials = 300_000
    game.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'myAir1', name: 'My Airship', vehicleType: 'airship', materialCost: 100_000, playedOnTurn: 1 }))
    game.state.zones[1].cards.a.push(
      zoneEntry({ instanceId: 'myAir2', name: 'My Other Airship', vehicleType: 'airship', materialCost: 100_000, playedOnTurn: 1 }),
      zoneEntry({ instanceId: 'myPlane', name: 'My Plane', vehicleType: 'plane', playedOnTurn: 1 }),
    )
    game.state.zones[1].cards.b.push(zoneEntry({ instanceId: 'theirAir', name: 'Their Airship', vehicleType: 'airship', materialCost: 300_000, playedOnTurn: 1 }))
    game.state.zones[2].cards.b.push(
      zoneEntry({ instanceId: 'theirPlane', name: 'Their Plane', vehicleType: 'plane', materialCost: 50_000, playedOnTurn: 1 }),
      zoneEntry({ instanceId: 'theirTank', name: 'Their Tank', vehicleType: 'tank', playedOnTurn: 1 }),
    )
    return { game, card }
  }
  const play = (game: EngineGame, card: CardInstance) => {
    const r = applyAction(game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    return r.game
  }
  const answer = (game: EngineGame, choiceId: string) => {
    const r = applyAction(game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    return r.game
  }

  it('hop 1 offers only the actor\'s AIRSHIPS, from every zone', () => {
    const { game, card } = armed()
    const after = play(game, card)
    expect(after.state.pendingEffect?.effect).toBe('sinnersLuckOnPlay')
    expect(after.state.pendingEffect?.options.map((o) => o.id).sort()).toEqual(['myAir1', 'myAir2'])
  })

  it('hop 2 offers enemy airships AND planes from every zone, never ships or tanks', () => {
    const { game, card } = armed()
    const hop2 = answer(play(game, card), 'myAir1')
    expect(hop2.state.pendingEffect?.effect).toBe('sinnersLuckOnPlay')
    expect(hop2.state.pendingEffect?.options.map((o) => o.id).sort()).toEqual(['theirAir', 'theirPlane'])
  })

  // Q3 + D-1: side AND zone are exchanged, both hulls freshly deployed.
  it('swaps the two hulls across sides and zones, re-stamping both', () => {
    const { game, card } = armed()
    const done = answer(answer(play(game, card), 'myAir1'), 'theirAir')
    expect(done.state.pendingEffect).toBeNull()
    const given = findVehicle(done.state, 'myAir1')!
    const received = findVehicle(done.state, 'theirAir')!
    expect({ side: given.side, zone: given.zone.id }).toEqual({ side: 'b', zone: 2 })
    expect({ side: received.side, zone: received.zone.id }).toEqual({ side: 'a', zone: 1 })
    expect(given.entry).toMatchObject({ playedOnTurn: 3, movedOnTurn: null, activatedOnTurn: null })
    expect(received.entry).toMatchObject({ playedOnTurn: 3, movedOnTurn: null, activatedOnTurn: null })
    expect(done.state.zones[0].cards.a.map((c) => c.name).sort()).toEqual(['Sinners Luck', 'Their Airship'])
  })

  // 2026-09-21 LH fix round 1: this swap is a third capture path alongside
  // Boarding Party and Mutiny (spec §3.1.1 — a captured hull enters at 0).
  // theirAir stands in for an LH airship arriving with pips already on the
  // dial; myAir1 (the hull handed to the opponent) must lose its own pips the
  // same way, mirroring heroPowers.ts's symmetric flippedMine/flippedTheirs.
  it('a Sinner\'s Luck swap enters at 0 charge, like every other capture', () => {
    const { game, card } = armed()
    findVehicle(game.state, 'myAir1')!.entry.charge = 2
    const theirs = findVehicle(game.state, 'theirAir')!.entry
    theirs.faction = 'LH'
    theirs.charge = 3
    const done = answer(answer(play(game, card), 'myAir1'), 'theirAir')
    expect(chargeOf(findVehicle(done.state, 'myAir1')!.entry)).toBe(0)
    expect(chargeOf(findVehicle(done.state, 'theirAir')!.entry)).toBe(0)
  })

  // Q4: 100k given for 300k received — the opponent draws, discounted by 200k.
  it('makes the opponent draw a card discounted by the difference when the given airship is worth less', () => {
    const { game, card } = armed()
    const done = answer(answer(play(game, card), 'myAir1'), 'theirAir')
    expect(done.privates.b.hand.map((c) => c.name)).toEqual(['Enemy Top'])
    expect(done.privates.b.hand[0].meta.costDelta).toBe(-200_000)
    expect(done.state.counts.b).toEqual({ hand: 1, deck: 0 })
    expect(done.state.log.join('\n')).not.toContain('Enemy Top')
  })

  it('draws nothing when the given airship is worth as much or more', () => {
    const { game, card } = armed()
    const done = answer(answer(play(game, card), 'myAir1'), 'theirPlane') // 100k for 50k
    expect(done.privates.b.hand).toHaveLength(0)
    expect(findVehicle(done.state, 'theirPlane')!.side).toBe('a')
  })

  it('survives an opponent with nothing to draw', () => {
    const { game, card } = armed()
    game.privates.b.deck = []
    game.state.counts.b.deck = 0
    const done = answer(answer(play(game, card), 'myAir1'), 'theirAir')
    expect(done.privates.b.hand).toHaveLength(0)
    expect(findVehicle(done.state, 'theirAir')!.side).toBe('a')
  })

  // D-3: "you may" — no friendly airship means no suspension and no failure.
  it('deploys without suspending when the actor has no airship', () => {
    const { game, card } = armed()
    game.state.zones[0].cards.a = []
    game.state.zones[1].cards.a = game.state.zones[1].cards.a.filter((c) => c.instanceId !== 'myAir2')
    const after = play(game, card)
    expect(after.state.pendingEffect).toBeNull()
    expect(after.state.zones[0].cards.a.map((c) => c.name)).toEqual(['Sinners Luck'])
  })

  it('resolves with no swap when the enemy has no airship or plane', () => {
    const { game, card } = armed()
    game.state.zones[1].cards.b = []
    game.state.zones[2].cards.b = game.state.zones[2].cards.b.filter((c) => c.instanceId === 'theirTank')
    const hop2 = answer(play(game, card), 'myAir1')
    expect(hop2.state.pendingEffect).toBeNull()
    expect(findVehicle(hop2.state, 'myAir1')!.side).toBe('a')
  })

  it('can be declined at either hop through cancel, leaving the board untouched', () => {
    const { game, card } = armed()
    const declined = applyAction(play(game, card), 'alice', { type: 'RESOLVE_PENDING_EFFECT', cancel: true }, makeCtx())
    if (!declined.ok) throw new Error(declined.error)
    expect(declined.game.state.pendingEffect).toBeNull()
    expect(findVehicle(declined.game.state, 'myAir1')!.side).toBe('a')
    expect(findVehicle(declined.game.state, 'theirAir')!.side).toBe('b')
  })

  it('refuses cleanly when the chosen enemy hull has left the board', () => {
    const { game, card } = armed()
    const hop2 = answer(play(game, card), 'myAir1')
    hop2.state.zones[1].cards.b = []
    const r = applyAction(hop2, 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'theirAir' }, makeCtx())
    expect(r).toMatchObject({ ok: false, status: 400 })
  })

  it('never offers the hull this play just placed, even if it were an airship', () => {
    const game = makeGame({ turnNumber: 3, activePlayer: 'alice' })
    const card = inst({ instanceId: 'sl-air', name: 'Sinners Luck', faction: 'DWG', vehicleType: 'airship', materialCost: 0, meta: { onPlayEffect: 'sinnersLuckOnPlay' } })
    game.privates.a.hand.push(card)
    game.state.counts.a.hand = 1
    game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'theirAir', vehicleType: 'airship', playedOnTurn: 1 }))
    const after = play(game, card)
    expect(after.state.pendingEffect).toBeNull()
  })

  it('needs no catalog', () => {
    expect(CATALOG_EFFECTS.has('sinnersLuckOnPlay')).toBe(false)
  })
})
