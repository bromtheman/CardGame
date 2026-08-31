import { describe, expect, it } from 'vitest'
import { CATALOG_EFFECTS, effectFor, registerEffect } from './registry.ts'
import { choice } from './primitives.ts'
import { inst, makeCtx, makeGame, snap, zoneEntry } from '../engine/testFixtures.ts'
import {
  applyAction, declareForcedBattle, discardSnapshotOf, effectiveCostInGame, effectiveMaterialCostOf,
  legalZonesFor,
  joinBattle,
} from '../engine/index.ts'
import type { CardInstance } from '../engine/gameInit.ts'
import type { BattleCasualty, BattleContext, EngineContext, EngineGame } from '../engine/engineTypes.ts'

// A synthetic battle trigger that takes the one suspension slot, so a wave-5
// rider's own offer meets an occupied one. t_-prefixed and registered here
// rather than borrowing a real card's name, which would couple this file to
// that card's registration state (docs/claude/testing.md).
registerEffect('t_slotHog', choice({
  effect: 't_slotHog',
  prompt: 'Hog the slot',
  options: () => [{ id: 'x', label: 'X' }],
  resolve: () => true,
}))

const DRAW_ONE = [
  'mandrelOnPlay', 'rookOnPlay', 'resoluteOnPlay', 'excruciatorOnPlay',
  'claymoreEffect', 'palisadeEffect', 'purifierEffect',
  'javelinOnDeath', 'ironMaidenOnDeath', 'victoriaOnDeath',
  'trondheimOnDeath', 'coulombEffect',
  // Wave 6. Basher: "When this is destroyed, draw a card". It prints no
  // keywords at all, so the standing prohibition on SCRAPPY + onDeathEffect
  // (docs/claude/card-effects.md) is clear.
  'basherOnDeath',
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

// Excalibur is DP6's only customer (spec §4.3, departure 4): a vehicle whose
// effect targets a card in the actor's own hand. Dispatched only through
// PLAY_CARD_TARGETING_CARD_IN_HAND, so these tests go through applyAction end
// to end rather than calling effectFor directly — a direct call would pass
// even if the seed meta key or the handler wiring were wrong, and Task 4's
// generic 't_handTargetVehicle' stand-in in placement.test.ts already proves
// the dispatch mechanism; these prove the real card and the real filter.
describe('excaliburEffect', () => {
  const excalibur = () => inst({
    name: 'Excalibur', type: 'vehicle', vehicleType: 'ship', materialCost: 550_000,
    meta: { playOnCardEffect: 'excaliburEffect' },
  })

  it('deploys to a legal zone and stamps -200k costDelta on an AI ship targeted in hand', () => {
    const card = excalibur()
    const target = inst({ name: 'Victoria', isBuiltIn: true, type: 'vehicle', vehicleType: 'ship', materialCost: 270_000 })
    const game = makeGame({ privates: { a: { hand: [card, target], deck: [] }, b: { hand: [], deck: [] } } })
    game.state.resources.a.materials = 600_000
    const before = effectiveCostInGame(game.state, 'a', target)
    const r = applyAction(game, 'alice', {
      type: 'PLAY_CARD_TARGETING_CARD_IN_HAND',
      instanceId: card.instanceId, targetInstanceId: target.instanceId, zoneId: 1,
    }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a.map((e) => e.instanceId)).toContain(card.instanceId)
    const stamped = r.game.privates.a.hand.find((c) => c.instanceId === target.instanceId)!
    expect(stamped.meta.costDelta).toBe(-200_000)
    expect(effectiveCostInGame(r.game.state, 'a', stamped)).toBe(before - 200_000)
  })

  it('rejects a player-made ship as the target', () => {
    const card = excalibur()
    const target = inst({ name: 'Home-Brew Cruiser', isBuiltIn: false, type: 'vehicle', vehicleType: 'ship', materialCost: 100_000 })
    const game = makeGame({ privates: { a: { hand: [card, target], deck: [] }, b: { hand: [], deck: [] } } })
    game.state.resources.a.materials = 600_000
    const r = applyAction(game, 'alice', {
      type: 'PLAY_CARD_TARGETING_CARD_IN_HAND',
      instanceId: card.instanceId, targetInstanceId: target.instanceId, zoneId: 1,
    }, makeCtx())
    expect(r).toMatchObject({ ok: false, status: 400 })
    // The whole action failed atomically — nothing was taken or paid.
    expect(game.privates.a.hand).toHaveLength(2)
    expect(game.state.resources.a.materials).toBe(600_000)
  })

  it('rejects a non-ship AI vehicle as the target', () => {
    const card = excalibur()
    const target = inst({ name: 'AI Tank', isBuiltIn: true, type: 'vehicle', vehicleType: 'tank', materialCost: 100_000 })
    const game = makeGame({ privates: { a: { hand: [card, target], deck: [] }, b: { hand: [], deck: [] } } })
    game.state.resources.a.materials = 600_000
    const r = applyAction(game, 'alice', {
      type: 'PLAY_CARD_TARGETING_CARD_IN_HAND',
      instanceId: card.instanceId, targetInstanceId: target.instanceId, zoneId: 1,
    }, makeCtx())
    expect(r).toMatchObject({ ok: false, status: 400 })
    expect(game.privates.a.hand).toHaveLength(2)
  })

  it('stacks two Excaliburs to -400k on the same target', () => {
    const first = excalibur()
    const second = excalibur()
    const target = inst({ name: 'Victoria', isBuiltIn: true, type: 'vehicle', vehicleType: 'ship', materialCost: 270_000 })
    const game = makeGame({ privates: { a: { hand: [first, second, target], deck: [] }, b: { hand: [], deck: [] } } })
    game.state.resources.a.materials = 1_200_000
    const r1 = applyAction(game, 'alice', {
      type: 'PLAY_CARD_TARGETING_CARD_IN_HAND',
      instanceId: first.instanceId, targetInstanceId: target.instanceId, zoneId: 1,
    }, makeCtx())
    if (!r1.ok) throw new Error(r1.error)
    expect(r1.game.privates.a.hand.find((c) => c.instanceId === target.instanceId)!.meta.costDelta).toBe(-200_000)
    const r2 = applyAction(r1.game, 'alice', {
      type: 'PLAY_CARD_TARGETING_CARD_IN_HAND',
      instanceId: second.instanceId, targetInstanceId: target.instanceId, zoneId: 1,
    }, makeCtx())
    if (!r2.ok) throw new Error(r2.error)
    expect(r2.game.privates.a.hand.find((c) => c.instanceId === target.instanceId)!.meta.costDelta).toBe(-400_000)
    expect(r2.game.state.zones[0].cards.a.map((e) => e.instanceId)).toEqual(
      expect.arrayContaining([first.instanceId, second.instanceId]),
    )
  })

  it('leaves effectiveMaterialCostOf on the target unchanged — the discount is play-time only', () => {
    const card = excalibur()
    const target = inst({ name: 'Victoria', isBuiltIn: true, type: 'vehicle', vehicleType: 'ship', materialCost: 270_000 })
    const game = makeGame({ privates: { a: { hand: [card, target], deck: [] }, b: { hand: [], deck: [] } } })
    game.state.resources.a.materials = 600_000
    const before = effectiveMaterialCostOf(target)
    const r = applyAction(game, 'alice', {
      type: 'PLAY_CARD_TARGETING_CARD_IN_HAND',
      instanceId: card.instanceId, targetInstanceId: target.instanceId, zoneId: 1,
    }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    const stamped = r.game.privates.a.hand.find((c) => c.instanceId === target.instanceId)!
    // Confirm the discount really landed, so the unchanged assertion below
    // isn't vacuous...
    expect(stamped.meta.costDelta).toBe(-200_000)
    // ...then confirm repairs/base-damage/in-battle-resources' authority
    // never sees it (spec §4.5; card-effects.md "Play-time cost modifiers").
    expect(effectiveMaterialCostOf(stamped)).toBe(before)
    expect(effectiveMaterialCostOf(stamped)).toBe(270_000)
  })

  it('deploys through plain PLAY_CARD_TO_ZONE with no effect and no error when the actor holds no AI ship', () => {
    const card = excalibur()
    const game = makeGame({ privates: { a: { hand: [card], deck: [] }, b: { hand: [], deck: [] } } })
    game.state.resources.a.materials = 600_000
    // PLAY_CARD_TO_ZONE's targets object carries no targetInstanceId at all
    // (only targetZoneId/placedInstanceIds) — if playOnCardEffect were
    // mistakenly dispatched here, costDelta's `typeof targetInstanceId !==
    // 'string'` guard would reject it and the whole play would 400. Success
    // itself is therefore proof excaliburEffect was never reached, not just
    // that it did nothing (spec §4.3 departure 4 — no AI ship in hand must
    // not block a 550k blocker from deploying).
    const r = applyAction(game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a.map((e) => e.instanceId)).toContain(card.instanceId)
    expect(r.game.privates.a.hand).toHaveLength(0)
    expect(r.game.state.log.some((l) => l.includes('deployed to zone 1'))).toBe(true)
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

  it('draws for a 250k built-in target, which the 2026-08-30 threshold move now admits', () => {
    const { game, target } = run({ isBuiltIn: true, materialCost: 250_000 })
    expect(target.keywords).toContain('scrappy')
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['Top'])
  })

  it('grants Scrappy but draws nothing for an expensive built-in target', () => {
    const { game, target } = run({ isBuiltIn: true, materialCost: 450_000 })
    expect(target.keywords).toContain('scrappy')
    expect(game.privates.a.hand).toHaveLength(0)
  })

  it('grants Scrappy but draws nothing for a player-made target', () => {
    const { game, target } = run({ isBuiltIn: false, materialCost: 100_000 })
    expect(target.keywords).toContain('scrappy')
    expect(game.privates.a.hand).toHaveLength(0)
  })

  it('grants Scrappy but draws nothing for a built-in target at exactly the 400k boundary — the card says "less than 400k"', () => {
    const { game, target } = run({ isBuiltIn: true, materialCost: 400_000 })
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

  describe('orbitFlankEffect', () => {
    const orbitHull = snap({
      name: 'Orbit', faction: 'LH', vehicleType: 'plane', materialCost: 140_000,
      keywords: ['halfCost', 'temporary'],
    })
    const catalog = [orbitHull]
    const orbitFlankCard = () => inst({
      instanceId: 'of1', name: 'Orbit Flank', type: 'ability', vehicleType: null, materialCost: 90_000,
      meta: { onPlayEffect: 'orbitFlankEffect' },
    })
    const playOrbitFlank = (game: EngineGame, ctx = makeCtx({ catalog })) => {
      game.privates.a.hand.push(orbitFlankCard())
      game.state.counts.a.hand = 1
      return applyAction(game, 'alice', { type: 'PLAY_ABILITY_CARD', instanceId: 'of1' }, ctx)
    }

    it('first entry offers exactly the two modes from the card text', () => {
      const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
      const res = playOrbitFlank(game)
      if (!res.ok) throw new Error(res.error)
      expect(res.game.state.pendingEffect?.effect).toBe('orbitFlankEffect')
      expect(res.game.state.pendingEffect?.options.map((o) => o.id)).toEqual(['spawn', 'battle'])
    })

    it('choosing mode (a) suspends again, offering the three zones', () => {
      const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
      const played = playOrbitFlank(game)
      if (!played.ok) throw new Error(played.error)
      const modeChosen = applyAction(played.game, 'alice', {
        type: 'RESOLVE_PENDING_EFFECT', choiceId: 'spawn',
      }, makeCtx({ catalog }))
      if (!modeChosen.ok) throw new Error(modeChosen.error)
      expect(modeChosen.game.state.activeBattle).toBeNull()
      expect(modeChosen.game.state.pendingEffect?.effect).toBe('orbitFlankEffect')
      expect(modeChosen.game.state.pendingEffect?.options.map((o) => o.id)).toEqual(['1', '2', '3'])
    })

    it('resolving the zone choice spawns one Orbit into zone.cards, Temporary exactly once, no zone activation', () => {
      const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
      // A decoy enemy vehicle whose instanceId doubles as the chosen zone's
      // id string ('2'), sitting in a different zone. Inert for the correct
      // implementation — mode (a)'s resolve never looks up a vehicle — but
      // load-bearing for the teeth check: a mode-confusion bug that treats
      // this hop-2 answer as mode (b) would find this vehicle and wrongly
      // declare a battle instead of spawning, rather than failing closed.
      game.state.zones[0].cards.b.push(zoneEntry({ instanceId: '2', name: 'Decoy Foe' }))
      const ctx = makeCtx({ catalog })
      const played = playOrbitFlank(game, ctx)
      if (!played.ok) throw new Error(played.error)
      const modeChosen = applyAction(played.game, 'alice', {
        type: 'RESOLVE_PENDING_EFFECT', choiceId: 'spawn',
      }, ctx)
      if (!modeChosen.ok) throw new Error(modeChosen.error)
      const resolved = applyAction(modeChosen.game, 'alice', {
        type: 'RESOLVE_PENDING_EFFECT', choiceId: '2',
      }, ctx)
      if (!resolved.ok) throw new Error(resolved.error)
      expect(resolved.game.state.pendingEffect).toBeNull()
      expect(resolved.game.state.activeBattle).toBeNull()
      // Board spawn (spec §4.4): the Orbit enters zone.cards for the chosen
      // zone (id 2 -> zones[1]) and stays there. The other two zones are untouched.
      const spawned = resolved.game.state.zones[1].cards.a
      expect(spawned).toHaveLength(1)
      expect(spawned[0].name).toBe('Orbit')
      expect(spawned[0].keywords.filter((k) => k === 'temporary')).toHaveLength(1)
      expect(resolved.game.state.zones[0].cards.a).toHaveLength(0)
      expect(resolved.game.state.zones[2].cards.a).toHaveLength(0)
      expect(resolved.game.state.zones.every((z) => z.lastActivatedTurn === null)).toBe(true)
    })

    it('choosing mode (b) suspends again, offering the enemy vehicles from every zone', () => {
      const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
      game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'foe-1', name: 'Foe One' }))
      game.state.zones[2].cards.b.push(zoneEntry({ instanceId: 'foe-2', name: 'Foe Two' }))
      const played = playOrbitFlank(game)
      if (!played.ok) throw new Error(played.error)
      const modeChosen = applyAction(played.game, 'alice', {
        type: 'RESOLVE_PENDING_EFFECT', choiceId: 'battle',
      }, makeCtx({ catalog }))
      if (!modeChosen.ok) throw new Error(modeChosen.error)
      expect(modeChosen.game.state.activeBattle).toBeNull()
      expect(modeChosen.game.state.pendingEffect?.effect).toBe('orbitFlankEffect')
      expect(modeChosen.game.state.pendingEffect?.options.map((o) => o.id)).toEqual(['foe-1', 'foe-2'])
    })

    it('resolving the vehicle choice declares a forced battle with one Orbit summon, never entering zone.cards', () => {
      const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
      // instanceId '2' deliberately doubles as a real zone id. Inert for the
      // correct implementation — mode (b)'s resolve never parses choiceId as
      // a number — but load-bearing for the teeth check: a mode-confusion
      // bug that treats this hop-2 answer as mode (a) would successfully
      // (and wrongly) spawn into zone 2 instead of failing closed.
      game.state.zones[2].cards.b.push(zoneEntry({ instanceId: '2', name: 'Foe' }))
      const ctx = makeCtx({ catalog })
      const played = playOrbitFlank(game, ctx)
      if (!played.ok) throw new Error(played.error)
      const modeChosen = applyAction(played.game, 'alice', {
        type: 'RESOLVE_PENDING_EFFECT', choiceId: 'battle',
      }, ctx)
      if (!modeChosen.ok) throw new Error(modeChosen.error)
      const resolved = applyAction(modeChosen.game, 'alice', {
        type: 'RESOLVE_PENDING_EFFECT', choiceId: '2',
      }, ctx)
      if (!resolved.ok) throw new Error(resolved.error)
      expect(resolved.game.state.pendingEffect).toBeNull()
      const battle = resolved.game.state.activeBattle
      expect(battle?.zoneId).toBe(3)
      expect(battle?.aggressor).toBe('a')
      expect(battle?.defenderIds).toEqual(['2'])
      expect(battle?.summons).toHaveLength(1)
      expect(battle?.summons[0].name).toBe('Orbit')
      expect(battle?.attackerIds).toEqual(battle?.summons.map((s) => s.instanceId))
      // Battle summon (spec §4.4): the Orbit lives only in activeBattle.summons —
      // it must never land in zone.cards, on either side, in any zone.
      expect(resolved.game.state.zones.every(
        (z) => z.cards.a.every((c) => c.name !== 'Orbit') && z.cards.b.every((c) => c.name !== 'Orbit'),
      )).toBe(true)
      expect(resolved.game.state.zones[2].lastActivatedTurn).toBeNull() // not a zone activation
    })

    it('mode (b) fizzles without suspending when the enemy has no vehicle anywhere', () => {
      const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
      const played = playOrbitFlank(game)
      if (!played.ok) throw new Error(played.error)
      const modeChosen = applyAction(played.game, 'alice', {
        type: 'RESOLVE_PENDING_EFFECT', choiceId: 'battle',
      }, makeCtx({ catalog }))
      if (!modeChosen.ok) throw new Error(modeChosen.error)
      expect(modeChosen.game.state.pendingEffect).toBeNull()
      expect(modeChosen.game.state.activeBattle).toBeNull()
    })
  })

  // Braveheart and Eclipse are near-identical DP1 (ACTIVATE_VEHICLE) + DP4
  // (choice) + DP3 (declareForcedBattle) cards: activate, choose an enemy
  // vehicle in the hull's own zone, fight it 1v1. Their differences are the
  // whole task (task 8 brief): Braveheart costs 1cp and never touches
  // lastActivatedTurn; Eclipse costs 0cp, excludes Stealthy targets, and
  // stamps lastActivatedTurn itself (spec §4.3's sole exception to "a forced
  // battle is not a zone activation").
  describe('braveheartActivate', () => {
    const onBoard = (over: Record<string, unknown> = {}) => {
      const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
      game.state.zones[0].cards.a.push(zoneEntry({
        instanceId: 'bh1', name: 'Braveheart',
        meta: { onActivate: 'braveheartActivate', activateCpCost: 1 },
        ...over,
      }))
      return game
    }

    it('activating with CP suffices — suspends offering only the enemy vehicles in its own zone', () => {
      const game = onBoard()
      game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'foe-1', name: 'Foe' }))
      // A second enemy sitting in a DIFFERENT zone must not appear — Braveheart
      // passes a real zoneId to enemyVehicleOptions, unlike Orbit Flank's null.
      game.state.zones[1].cards.b.push(zoneEntry({ instanceId: 'foe-2', name: 'Elsewhere' }))
      const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'bh1' }, makeCtx())
      if (!res.ok) throw new Error(res.error)
      expect(res.game.state.activeBattle).toBeNull()
      expect(res.game.state.pendingEffect?.effect).toBe('braveheartActivate')
      expect(res.game.state.pendingEffect?.options).toEqual([{ id: 'foe-1', label: 'Foe' }])
      expect(res.game.state.resources.a.cp).toBe(2) // 3 - 1, paid up front regardless of suspension
    })

    it('resolving declares a 1v1 with Braveheart itself as the sole attacker, no zone-activation stamp', () => {
      const game = onBoard()
      game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'foe-1', name: 'Foe' }))
      const ctx = makeCtx()
      const suspended = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'bh1' }, ctx)
      if (!suspended.ok) throw new Error(suspended.error)
      const resolved = applyAction(suspended.game, 'alice', {
        type: 'RESOLVE_PENDING_EFFECT', choiceId: 'foe-1',
      }, ctx)
      if (!resolved.ok) throw new Error(resolved.error)
      expect(resolved.game.state.pendingEffect).toBeNull()
      const battle = resolved.game.state.activeBattle
      expect(battle?.zoneId).toBe(1)
      expect(battle?.aggressor).toBe('a')
      expect(battle?.attackerIds).toEqual(['bh1'])
      expect(battle?.defenderIds).toEqual(['foe-1'])
      expect(battle?.summons).toEqual([]) // Braveheart fights itself — no summons
      expect(resolved.game.state.zones[0].lastActivatedTurn).toBeNull() // not a zone activation
    })

    it('a second activation the same turn 409s', () => {
      const game = onBoard({ activatedOnTurn: 2 })
      const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'bh1' }, makeCtx())
      expect(res).toMatchObject({ ok: false, status: 409 })
    })

    it('with 0 CP available is rejected', () => {
      const game = onBoard()
      game.state.resources.a.cp = 0
      game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'foe-1', name: 'Foe' }))
      const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'bh1' }, makeCtx())
      expect(res).toMatchObject({ ok: false, status: 400 })
    })

    it('rejects activation when its zone holds no enemy vehicle — CP is not spent, nothing sticks', () => {
      const game = onBoard()
      const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'bh1' }, makeCtx())
      expect(res).toMatchObject({ ok: false, status: 400 })
      expect(game.state.resources.a.cp).toBe(3)
      expect(game.state.zones[0].cards.a[0].activatedOnTurn).toBeNull()
    })

    it('does not spend the zone activation — a fleet attack there still succeeds afterward', () => {
      const game = onBoard()
      game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'foe-1', name: 'Foe' }))
      const ctx = makeCtx()
      const suspended = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'bh1' }, ctx)
      if (!suspended.ok) throw new Error(suspended.error)
      const resolved = applyAction(suspended.game, 'alice', {
        type: 'RESOLVE_PENDING_EFFECT', choiceId: 'foe-1',
      }, ctx)
      if (!resolved.ok) throw new Error(resolved.error)
      // Simulate the forced battle having already been reported and resolved
      // (DECIDE_BATTLE_REPORT nulls activeBattle) so a second battle may lock.
      resolved.game.state.activeBattle = null
      const attack = applyAction(resolved.game, 'alice', {
        type: 'ATTACK_ENEMY_FLEET', zoneId: 1, attackerIds: ['bh1'], targetIds: ['foe-1'],
      }, ctx)
      expect(attack.ok).toBe(true)
    })

    // The discriminating test (task brief step 5): RESOLVE_PENDING_EFFECT's
    // zoneId/targetInstanceId are client-supplied and unvalidated. A naive
    // re-entry that trusted either instead of re-deriving Braveheart's own
    // zone from payload.card must be caught — the decoy sits in a different,
    // legal, non-empty zone so a wrong read produces a plausible wrong
    // battle rather than an empty-zone 400 either way.
    it('a stale/malicious zoneId and targetInstanceId on resolve are ignored', () => {
      const game = onBoard()
      game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'foe-1', name: 'Foe' })) // zone 1 — the real target
      game.state.zones[2].cards.b.push(zoneEntry({ instanceId: 'decoy-1', name: 'Decoy' })) // zone 3 — a different, legal zone
      const ctx = makeCtx()
      const suspended = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'bh1' }, ctx)
      if (!suspended.ok) throw new Error(suspended.error)
      const resolved = applyAction(suspended.game, 'alice', {
        type: 'RESOLVE_PENDING_EFFECT', choiceId: 'foe-1', zoneId: 3, targetInstanceId: 'decoy-1',
      }, ctx)
      if (!resolved.ok) throw new Error(resolved.error)
      const battle = resolved.game.state.activeBattle
      expect(battle?.zoneId).toBe(1)
      expect(battle?.defenderIds).toEqual(['foe-1'])
      expect(resolved.game.state.zones[2].cards.b.map((c) => c.instanceId)).toEqual(['decoy-1'])
    })
  })

  describe('eclipseEffect', () => {
    const onBoard = (over: Record<string, unknown> = {}) => {
      const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
      game.state.zones[0].cards.a.push(zoneEntry({
        instanceId: 'ec1', name: 'Eclipse',
        meta: { onActivate: 'eclipseEffect', activateCpCost: 0 },
        ...over,
      }))
      return game
    }

    it('activating suffices at 0 CP — suspends offering only non-Stealthy enemies in its own zone', () => {
      const game = onBoard()
      game.state.zones[0].cards.b.push(
        zoneEntry({ instanceId: 'foe-1', name: 'Foe' }),
        zoneEntry({ instanceId: 'stealthy-1', name: 'Sneaky', keywords: ['stealthy'] }),
      )
      game.state.zones[1].cards.b.push(zoneEntry({ instanceId: 'foe-2', name: 'Elsewhere' }))
      const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'ec1' }, makeCtx())
      if (!res.ok) throw new Error(res.error)
      expect(res.game.state.pendingEffect?.effect).toBe('eclipseEffect')
      expect(res.game.state.pendingEffect?.options).toEqual([{ id: 'foe-1', label: 'Foe' }])
    })

    // Guards the truthiness trap the brief calls out by name: activateCpCost
    // is card DATA read via a `typeof raw !== 'number'` check
    // (shared/engine/activate.ts's activateCpCostOf); `if (!cost)` or
    // `cost || null` would both wrongly treat Eclipse's printed 0 as "no
    // activated ability" and make it permanently unreachable.
    it('activateCpCost: 0 still permits activation, even with zero CP available', () => {
      const game = onBoard()
      game.state.resources.a.cp = 0
      game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'foe-1', name: 'Foe' }))
      const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'ec1' }, makeCtx())
      if (!res.ok) throw new Error(res.error)
      expect(res.game.state.resources.a.cp).toBe(0)
      expect(res.game.state.pendingEffect?.effect).toBe('eclipseEffect')
    })

    it('resolving declares a 1v1 with Eclipse itself as the sole attacker, and stamps its own zone activation', () => {
      const game = onBoard()
      game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'foe-1', name: 'Foe' }))
      const ctx = makeCtx()
      const suspended = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'ec1' }, ctx)
      if (!suspended.ok) throw new Error(suspended.error)
      const resolved = applyAction(suspended.game, 'alice', {
        type: 'RESOLVE_PENDING_EFFECT', choiceId: 'foe-1',
      }, ctx)
      if (!resolved.ok) throw new Error(resolved.error)
      expect(resolved.game.state.pendingEffect).toBeNull()
      const battle = resolved.game.state.activeBattle
      expect(battle?.zoneId).toBe(1)
      expect(battle?.aggressor).toBe('a')
      expect(battle?.attackerIds).toEqual(['ec1'])
      expect(battle?.defenderIds).toEqual(['foe-1'])
      expect(battle?.summons).toEqual([])
      // Eclipse is the sole card that stamps lastActivatedTurn from a forced
      // battle (spec §4.3 ruling) — Braveheart's equivalent test asserts null.
      expect(resolved.game.state.zones[0].lastActivatedTurn).toBe(2)
    })

    it('a second activation the same turn 409s', () => {
      const game = onBoard({ activatedOnTurn: 2 })
      const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'ec1' }, makeCtx())
      expect(res).toMatchObject({ ok: false, status: 409 })
    })

    it('after use, a fleet attack in that zone 409s — Eclipse consumes the zone activation', () => {
      const game = onBoard()
      game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'foe-1', name: 'Foe' }))
      const ctx = makeCtx()
      const suspended = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'ec1' }, ctx)
      if (!suspended.ok) throw new Error(suspended.error)
      const resolved = applyAction(suspended.game, 'alice', {
        type: 'RESOLVE_PENDING_EFFECT', choiceId: 'foe-1',
      }, ctx)
      if (!resolved.ok) throw new Error(resolved.error)
      resolved.game.state.activeBattle = null // as if DECIDE_BATTLE_REPORT already ran
      const attack = applyAction(resolved.game, 'alice', {
        type: 'ATTACK_ENEMY_FLEET', zoneId: 1, attackerIds: ['ec1'], targetIds: ['foe-1'],
      }, ctx)
      expect(attack).toMatchObject({ ok: false, status: 409 })
    })

    // Eclipse's text only says using it PREVENTS a later fleet battle in the
    // zone — it says nothing about being blocked by an earlier one. A wrong
    // implementation that reused lockBattle's gate, or added a
    // lastActivatedTurn precondition, would refuse this activation.
    it('is not blocked by a zone already activated earlier this turn — only consumes, is never gated by it', () => {
      const game = onBoard()
      game.state.zones[0].lastActivatedTurn = 2 // as if a fleet battle already happened here this turn
      game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'foe-1', name: 'Foe' }))
      const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'ec1' }, makeCtx())
      if (!res.ok) throw new Error(res.error)
      expect(res.game.state.pendingEffect?.effect).toBe('eclipseEffect')
    })

    it('rejects activation when its zone holds only a Stealthy enemy — CP is not spent, nothing sticks', () => {
      const game = onBoard()
      game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'stealthy-1', name: 'Sneaky', keywords: ['stealthy'] }))
      const res = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'ec1' }, makeCtx())
      expect(res).toMatchObject({ ok: false, status: 400 })
      expect(game.state.resources.a.cp).toBe(3)
      expect(game.state.zones[0].cards.a[0].activatedOnTurn).toBeNull()
    })

    // Mirrors Braveheart's equivalent test above. choice() protects both
    // cards identically (RESOLVE_PENDING_EFFECT's zoneId/targetInstanceId
    // are client-supplied and unvalidated; only choiceId, checked against
    // pending.options, and the server-derived zone matter) — this pins
    // that the shared protection actually covers Eclipse too, including
    // its extra Stealthy filter and activatesZone stamp.
    it('a stale/malicious zoneId and targetInstanceId on resolve are ignored', () => {
      const game = onBoard()
      game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'foe-1', name: 'Foe' })) // zone 1 — the real target
      game.state.zones[2].cards.b.push(zoneEntry({ instanceId: 'decoy-1', name: 'Decoy' })) // zone 3 — a different, legal zone
      const ctx = makeCtx()
      const suspended = applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: 'ec1' }, ctx)
      if (!suspended.ok) throw new Error(suspended.error)
      const resolved = applyAction(suspended.game, 'alice', {
        type: 'RESOLVE_PENDING_EFFECT', choiceId: 'foe-1', zoneId: 3, targetInstanceId: 'decoy-1',
      }, ctx)
      if (!resolved.ok) throw new Error(resolved.error)
      const battle = resolved.game.state.activeBattle
      expect(battle?.zoneId).toBe(1)
      expect(battle?.defenderIds).toEqual(['foe-1'])
      expect(resolved.game.state.zones[0].lastActivatedTurn).toBe(2) // still stamped — the real zone, not the decoy's
      expect(resolved.game.state.zones[2].cards.b.map((c) => c.instanceId)).toEqual(['decoy-1'])
      expect(resolved.game.state.zones[2].lastActivatedTurn).toBeNull() // decoy's zone untouched
    })
  })

  // The only three-phase effect in the wave, and the only consumer of
  // ActiveBattle.continuation (spec §4.3, departure 3; task 9 brief). Three
  // entry modes share one registry name, and — unlike every other card in
  // this describe block — the third (post-battle) entry cannot be reached by
  // calling effectFor directly with a hand-built continuation: the
  // `defenderIds`/`zoneId` stash under test is written by trebuchetEffect's
  // OWN declare step, so these tests drive the real pipeline end to end
  // (play -> choice -> declare -> report -> approve) exactly so that
  // reverting the stash (task brief Step 5) is visible here, not papered
  // over by a hand-built fixture.
  describe('trebuchetEffect', () => {
    const trebuchetCard = () => inst({
      instanceId: 'treb-1', name: 'Trebuchet', type: 'vehicle', vehicleType: 'ship',
      materialCost: 500_000, keywords: ['scrappy'], meta: { onPlayEffect: 'trebuchetEffect' },
    })

    function baseGame() {
      const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
      // Trebuchet is 500k — comfortably above makeGame's default 100k, and
      // repairs (Scrappy, so free anyway) must never be the reason a report
      // fails to approve.
      game.state.resources.a.materials = 1_000_000
      game.state.resources.b.materials = 1_000_000
      return game
    }

    function playTrebuchet(game: EngineGame, ctx: EngineContext) {
      game.privates.a.hand.push(trebuchetCard())
      game.state.counts.a.hand = 1
      return applyAction(game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: 'treb-1', zoneId: 1 }, ctx)
    }

    // Plays Trebuchet into zone 1 (alongside the named foes, all on side b)
    // and answers the very first choice against 'foe-1', so the caller lands
    // on a freshly declared 1v1 battle with a real continuation attached.
    function declareFirstBattle(foeIds: string[]) {
      const game = baseGame()
      const labels = ['One', 'Two', 'Three', 'Four']
      foeIds.forEach((id, i) => {
        game.state.zones[0].cards.b.push(zoneEntry({ instanceId: id, name: `Foe ${labels[i]}` }))
      })
      const ctx = makeCtx()
      const suspended = playTrebuchet(game, ctx)
      if (!suspended.ok) throw new Error(suspended.error)
      const resolved = applyAction(suspended.game, 'alice', {
        type: 'RESOLVE_PENDING_EFFECT', choiceId: 'foe-1',
      }, ctx)
      if (!resolved.ok) throw new Error(resolved.error)
      return { game: resolved.game, ctx }
    }

    // Submits and approves a report covering exactly the active battle's
    // participants. alice submits, bob approves — SUBMIT/DECIDE reject a
    // report approved by its own submitter.
    function approveReport(game: EngineGame, ctx: EngineContext, results: Record<string, number>): EngineGame {
      const submitted = applyAction(game, 'alice', {
        type: 'SUBMIT_BATTLE_REPORT', results, repairs: [],
      }, ctx)
      if (!submitted.ok) throw new Error(submitted.error)
      const decided = applyAction(submitted.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true }, ctx)
      if (!decided.ok) throw new Error(decided.error)
      return decided.game
    }

    it('1. played into a zone with an enemy vehicle deploys and suspends with that vehicle as an option', () => {
      const game = baseGame()
      game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'foe-1', name: 'Foe One' }))
      const res = playTrebuchet(game, makeCtx())
      if (!res.ok) throw new Error(res.error)
      expect(res.game.state.zones[0].cards.a.map((c) => c.instanceId)).toEqual(['treb-1'])
      expect(res.game.state.activeBattle).toBeNull()
      expect(res.game.state.pendingEffect?.effect).toBe('trebuchetEffect')
      expect(res.game.state.pendingEffect?.options).toEqual([{ id: 'foe-1', label: 'Foe One' }])
    })

    it('2. played into a zone with no enemy vehicle deploys, no suspension, no failure', () => {
      const game = baseGame()
      const res = playTrebuchet(game, makeCtx())
      if (!res.ok) throw new Error(res.error)
      expect(res.game.state.zones[0].cards.a.map((c) => c.instanceId)).toEqual(['treb-1'])
      expect(res.game.state.pendingEffect).toBeNull()
      expect(res.game.state.activeBattle).toBeNull()
    })

    it('3. cancelling the choice leaves Trebuchet deployed and declares no battle', () => {
      const game = baseGame()
      game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'foe-1', name: 'Foe One' }))
      const ctx = makeCtx()
      const suspended = playTrebuchet(game, ctx)
      if (!suspended.ok) throw new Error(suspended.error)
      const cancelled = applyAction(suspended.game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', cancel: true }, ctx)
      if (!cancelled.ok) throw new Error(cancelled.error)
      expect(cancelled.game.state.pendingEffect).toBeNull()
      expect(cancelled.game.state.activeBattle).toBeNull()
      expect(cancelled.game.state.zones[0].cards.a.map((c) => c.instanceId)).toEqual(['treb-1'])
    })

    it('4. answering declares a 1v1 whose continuation names trebuchetEffect and carries the zone', () => {
      const { game } = declareFirstBattle(['foe-1'])
      const battle = game.state.activeBattle
      expect(battle?.zoneId).toBe(1)
      expect(battle?.aggressor).toBe('a')
      expect(battle?.attackerIds).toEqual(['treb-1'])
      expect(battle?.defenderIds).toEqual(['foe-1'])
      expect(battle?.summons).toEqual([])
      expect(battle?.continuation?.effect).toBe('trebuchetEffect')
      expect(battle?.continuation?.side).toBe('a')
      expect(battle?.continuation?.card.instanceId).toBe('treb-1')
      // The zone, plus the chain's frozen eligible set. The win/survive test
      // comes off the engine's own outcome (payload.battle) rather than a
      // declare-time defender snapshot — Terawatt can join after the declare,
      // which made that stale — while chainIds bounds the REPEAT, so a zone
      // whose population grows mid-chain (Dryad) cannot feed it forever.
      expect(battle?.continuation?.data).toEqual({ zoneId: 1, chainIds: ['foe-1'] })
    })

    it('5. a clean win with Trebuchet surviving >=90% re-suspends offering the remaining enemy vehicles', () => {
      const { game, ctx } = declareFirstBattle(['foe-1', 'foe-2'])
      const after = approveReport(game, ctx, { 'treb-1': 95, 'foe-1': 30 })
      expect(after.state.activeBattle).toBeNull()
      expect(after.state.zones[0].cards.b.map((c) => c.instanceId)).toEqual(['foe-2']) // foe-1 died
      expect(after.state.pendingEffect?.effect).toBe('trebuchetEffect')
      expect(after.state.pendingEffect?.options).toEqual([{ id: 'foe-2', label: 'Foe Two' }])
    })

    it('6. a win where Trebuchet is destroyed offers no repeat', () => {
      // A second foe (foe-2) must remain in the zone after foe-1 dies — with
      // only one foe present, "destroyed" and "no enemy left to re-offer"
      // both produce a null pendingEffect, so a broken survived-check could
      // hide behind the self-limiting empty-options rule instead of being
      // caught here.
      const { game, ctx } = declareFirstBattle(['foe-1', 'foe-2'])
      const after = approveReport(game, ctx, { 'treb-1': 50, 'foe-1': 30 })
      expect(after.state.zones[0].cards.a.some((c) => c.instanceId === 'treb-1')).toBe(false)
      expect(after.state.zones[0].cards.b.some((c) => c.instanceId === 'foe-1')).toBe(false)
      expect(after.state.zones[0].cards.b.some((c) => c.instanceId === 'foe-2')).toBe(true)
      expect(after.state.pendingEffect).toBeNull()
    })

    it('7. a battle where the defender survives offers no repeat, even though Trebuchet survived', () => {
      const { game, ctx } = declareFirstBattle(['foe-1'])
      const after = approveReport(game, ctx, { 'treb-1': 95, 'foe-1': 95 })
      expect(after.state.zones[0].cards.a.some((c) => c.instanceId === 'treb-1')).toBe(true)
      expect(after.state.zones[0].cards.b.some((c) => c.instanceId === 'foe-1')).toBe(true)
      expect(after.state.pendingEffect).toBeNull()
    })

    it('8. Trebuchet at 85% (its Scrappy band) with the defender dead still offers the repeat', () => {
      const { game, ctx } = declareFirstBattle(['foe-1', 'foe-2'])
      const after = approveReport(game, ctx, { 'treb-1': 85, 'foe-1': 30 })
      expect(after.state.zones[0].cards.a.some((c) => c.instanceId === 'treb-1')).toBe(true)
      expect(after.state.log.some((l) => l.includes('Trebuchet was repaired'))).toBe(true)
      expect(after.state.pendingEffect?.effect).toBe('trebuchetEffect')
      expect(after.state.pendingEffect?.options).toEqual([{ id: 'foe-2', label: 'Foe Two' }])
    })

    it('9. a second win chains a third battle', () => {
      const { game, ctx } = declareFirstBattle(['foe-1', 'foe-2', 'foe-3'])
      const afterFirstWin = approveReport(game, ctx, { 'treb-1': 95, 'foe-1': 30 })
      expect(afterFirstWin.state.pendingEffect?.options).toEqual([
        { id: 'foe-2', label: 'Foe Two' }, { id: 'foe-3', label: 'Foe Three' },
      ])
      const secondBattle = applyAction(afterFirstWin, 'alice', {
        type: 'RESOLVE_PENDING_EFFECT', choiceId: 'foe-2',
      }, ctx)
      if (!secondBattle.ok) throw new Error(secondBattle.error)
      expect(secondBattle.game.state.activeBattle?.defenderIds).toEqual(['foe-2'])
      // The chain NARROWS: each entry re-derives it as (still in the zone) ∩
      // (already in the chain), so foe-1 — destroyed by the first battle —
      // drops out and can never come back. That monotone shrink is what makes
      // the repeat terminate.
      expect(secondBattle.game.state.activeBattle?.continuation?.data).toEqual({
        zoneId: 1, chainIds: ['foe-2', 'foe-3'],
      })

      const afterSecondWin = approveReport(secondBattle.game, ctx, { 'treb-1': 95, 'foe-2': 30 })
      expect(afterSecondWin.state.pendingEffect?.effect).toBe('trebuchetEffect')
      expect(afterSecondWin.state.pendingEffect?.options).toEqual([{ id: 'foe-3', label: 'Foe Three' }])

      // The second win must genuinely chain — a third battle actually
      // declares, not just an option that looks offerable.
      const thirdBattle = applyAction(afterSecondWin, 'alice', {
        type: 'RESOLVE_PENDING_EFFECT', choiceId: 'foe-3',
      }, ctx)
      if (!thirdBattle.ok) throw new Error(thirdBattle.error)
      expect(thirdBattle.game.state.activeBattle?.attackerIds).toEqual(['treb-1'])
      expect(thirdBattle.game.state.activeBattle?.defenderIds).toEqual(['foe-3'])
      expect(thirdBattle.game.state.activeBattle?.continuation?.data).toEqual({
        zoneId: 1, chainIds: ['foe-3'],
      })
    })
  })
})

describe('wave 4 — battle triggers at lock', () => {
  const dryadHull = snap({ name: 'Dryad', faction: 'SS', vehicleType: 'ship', materialCost: 40_500, keywords: ['blocker'], meta: { onBattleEffect: 'dryadBattle' } })
  const parapetHull = snap({ name: 'Parapet', faction: 'OW', vehicleType: 'plane', materialCost: 259_000, meta: { summonOnly: true } })

  // A locked battle in zone 1 with `actor` on the defending side. DP2's lock
  // dispatch has already conceptually happened by the time these tests call
  // the effect directly, so the battle object must already exist — The Onyx
  // Throne in particular joins it rather than declaring one.
  function locked(game: EngineGame, spec: {
    aggressor: 'a' | 'b'; attackerIds: string[]; defenderIds: string[]
  }) {
    game.state.activeBattle = {
      zoneId: 1, aggressor: spec.aggressor,
      attackerIds: spec.attackerIds, defenderIds: spec.defenderIds,
      distanceM: 1200, distanceModifiedBy: [], summons: [], continuation: null,
    }
  }

  const lockCtx = (isDefender: boolean, over: Partial<BattleContext> = {}): BattleContext => ({
    phase: 'lock', zoneId: 1, isDefender, isParticipant: true,
    forced: false, survived: false, won: false, casualties: [], ...over,
  })

  describe('catsharkBattle', () => {
    it('grants 30k materials to a participant on either side', () => {
      for (const isDefender of [false, true]) {
        const game = makeGame()
        const before = game.state.resources.a.materials
        const ok = effectFor('catsharkBattle')!({
          game, actor: 'a', card: inst({ name: 'Catshark' }), ctx: makeCtx(),
          battle: lockCtx(isDefender),
        })
        expect(ok).toBe(true)
        expect(game.state.resources.a.materials).toBe(before + 30_000)
      }
    })

    it('grants nothing to a non-participant', () => {
      const game = makeGame()
      const before = game.state.resources.a.materials
      const ok = effectFor('catsharkBattle')!({
        game, actor: 'a', card: inst({ name: 'Catshark' }), ctx: makeCtx(),
        battle: { ...lockCtx(true), isParticipant: false },
      })
      expect(ok).toBe(true)
      expect(game.state.resources.a.materials).toBe(before)
    })

    it('fires end to end when an ordinary fleet attack locks over it', () => {
      const game = makeGame({ turnNumber: 3 })
      const attacker = zoneEntry({ playedOnTurn: 2 })
      const catshark = zoneEntry({ name: 'Catshark', meta: { onBattleEffect: 'catsharkBattle' } })
      game.state.zones[0].cards.a.push(attacker)
      game.state.zones[0].cards.b.push(catshark)
      const before = game.state.resources.b.materials
      const r = applyAction(game, 'alice', {
        type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
        attackerIds: [attacker.instanceId], targetIds: [catshark.instanceId],
      }, makeCtx())
      if (!r.ok) throw new Error(r.error)
      expect(r.game.state.resources.b.materials).toBe(before + 30_000)
    })
  })

  describe('dryadBattle', () => {
    it('board-spawns another Dryad on a defensive lock, without joining the battle', () => {
      const game = makeGame()
      const dryad = zoneEntry({ name: 'Dryad', instanceId: 'dryad-1', meta: { onBattleEffect: 'dryadBattle' } })
      game.state.zones[0].cards.a.push(dryad)
      locked(game, { aggressor: 'b', attackerIds: [], defenderIds: ['dryad-1'] })
      const ok = effectFor('dryadBattle')!({
        game, actor: 'a', card: dryad, ctx: makeCtx({ catalog: [dryadHull] }),
        battle: lockCtx(true),
      })
      expect(ok).toBe(true)
      expect(game.state.zones[0].cards.a.map((c) => c.name)).toEqual(['Dryad', 'Dryad'])
      // A board spawn, not a battle summon (spec §4.4's wording table).
      expect(game.state.activeBattle?.defenderIds).toEqual(['dryad-1'])
      expect(game.state.activeBattle?.summons).toEqual([])
    })

    it('does nothing on an offensive lock', () => {
      const game = makeGame()
      const dryad = zoneEntry({ name: 'Dryad', instanceId: 'dryad-1' })
      game.state.zones[0].cards.a.push(dryad)
      const ok = effectFor('dryadBattle')!({
        game, actor: 'a', card: dryad, ctx: makeCtx({ catalog: [dryadHull] }),
        battle: lockCtx(false),
      })
      expect(ok).toBe(true)
      expect(game.state.zones[0].cards.a).toHaveLength(1)
    })

    // The roster is snapshotted before any trigger runs, so a spawned Dryad
    // cannot be dispatched by the same lock that spawned it. Two participating
    // Dryads must produce two new hulls, never four.
    it('two participating Dryads spawn exactly two, with no re-trigger', () => {
      const game = makeGame({ turnNumber: 3 })
      const attacker = zoneEntry({ playedOnTurn: 2 })
      const d1 = zoneEntry({ name: 'Dryad', meta: { onBattleEffect: 'dryadBattle' } })
      const d2 = zoneEntry({ name: 'Dryad', meta: { onBattleEffect: 'dryadBattle' } })
      game.state.zones[0].cards.a.push(attacker)
      game.state.zones[0].cards.b.push(d1, d2)
      const r = applyAction(game, 'alice', {
        type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
        attackerIds: [attacker.instanceId], targetIds: [d1.instanceId, d2.instanceId],
      }, makeCtx({ catalog: [dryadHull] }))
      if (!r.ok) throw new Error(r.error)
      expect(r.game.state.zones[0].cards.b).toHaveLength(4)
    })

    it('fails rather than fizzling when Dryad is missing from the catalog', () => {
      const game = makeGame()
      const dryad = zoneEntry({ name: 'Dryad', instanceId: 'dryad-1' })
      game.state.zones[0].cards.a.push(dryad)
      const ok = effectFor('dryadBattle')!({
        game, actor: 'a', card: dryad, ctx: makeCtx(), battle: lockCtx(true),
      })
      expect(ok).toBe(false)
    })
  })

  describe('onyxThroneBattle', () => {
    it('summons a Parapet into the already-locked battle, on the defending side', () => {
      const game = makeGame()
      const throne = zoneEntry({ name: 'The Onyx Throne', instanceId: 'onyx-1' })
      const foe = zoneEntry({ instanceId: 'foe-1' })
      game.state.zones[0].cards.a.push(throne)
      game.state.zones[0].cards.b.push(foe)
      locked(game, { aggressor: 'b', attackerIds: ['foe-1'], defenderIds: ['onyx-1'] })
      const ok = effectFor('onyxThroneBattle')!({
        game, actor: 'a', card: throne, ctx: makeCtx({ catalog: [parapetHull] }),
        battle: lockCtx(true),
      })
      expect(ok).toBe(true)
      const battle = game.state.activeBattle
      expect(battle?.summons.map((s) => s.name)).toEqual(['Parapet'])
      expect(battle?.defenderIds).toEqual(['onyx-1', battle?.summons[0].instanceId])
      // A battle summon, never a board unit (spec §4.4).
      expect(game.state.zones[0].cards.a.map((c) => c.name)).toEqual(['The Onyx Throne'])
    })

    it('does nothing on an offensive lock', () => {
      const game = makeGame()
      const throne = zoneEntry({ name: 'The Onyx Throne', instanceId: 'onyx-1' })
      const foe = zoneEntry({ instanceId: 'foe-1' })
      game.state.zones[0].cards.a.push(throne)
      game.state.zones[0].cards.b.push(foe)
      locked(game, { aggressor: 'a', attackerIds: ['onyx-1'], defenderIds: ['foe-1'] })
      const ok = effectFor('onyxThroneBattle')!({
        game, actor: 'a', card: throne, ctx: makeCtx({ catalog: [parapetHull] }),
        battle: lockCtx(false),
      })
      expect(ok).toBe(true)
      expect(game.state.activeBattle?.summons).toEqual([])
    })

    it('fires end to end when the enemy attacks it, and the Parapet joins the report', () => {
      const game = makeGame({ turnNumber: 3 })
      const attacker = zoneEntry({ playedOnTurn: 2 })
      const throne = zoneEntry({
        name: 'The Onyx Throne', keywords: ['blocker', 'inoffensive'],
        meta: { onBattleEffect: 'onyxThroneBattle' },
      })
      game.state.zones[0].cards.a.push(attacker)
      game.state.zones[0].cards.b.push(throne)
      const r = applyAction(game, 'alice', {
        type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
        attackerIds: [attacker.instanceId], targetIds: [throne.instanceId],
      }, makeCtx({ catalog: [parapetHull] }))
      if (!r.ok) throw new Error(r.error)
      const battle = r.game.state.activeBattle
      expect(battle?.summons.map((s) => s.name)).toEqual(['Parapet'])
      expect(battle?.defenderIds).toHaveLength(2)
    })
  })

  describe('onyxThroneActivate', () => {
    const heavy = snap({ name: 'Nimbus', faction: 'GT', vehicleType: 'airship', materialCost: 530_000 })
    const light = snap({ name: 'Warbird', faction: 'GT', vehicleType: 'airship', materialCost: 190_000 })

    it('draws a GT airship from the heavy half of the pool only', () => {
      const game = makeGame()
      const ok = effectFor('onyxThroneActivate')!({
        game, actor: 'a', card: inst({ name: 'The Onyx Throne' }),
        ctx: makeCtx({ catalog: [heavy, light] }),
      })
      expect(ok).toBe(true)
      expect(game.privates.a.hand.map((c) => c.name)).toEqual(['Nimbus'])
    })

    it('costs 1 CP through ACTIVATE_VEHICLE, once per turn', () => {
      const game = makeGame({ turnNumber: 3 })
      const throne = zoneEntry({
        name: 'The Onyx Throne',
        meta: { onActivate: 'onyxThroneActivate', activateCpCost: 1 },
      })
      game.state.zones[0].cards.a.push(throne)
      const ctx = makeCtx({ catalog: [heavy, light] })
      const r = applyAction(game, 'alice', {
        type: 'ACTIVATE_VEHICLE', instanceId: throne.instanceId,
      }, ctx)
      if (!r.ok) throw new Error(r.error)
      expect(r.game.state.resources.a.cp).toBe(2)
      expect(r.game.privates.a.hand.map((c) => c.name)).toEqual(['Nimbus'])
      expect(applyAction(r.game, 'alice', {
        type: 'ACTIVATE_VEHICLE', instanceId: throne.instanceId,
      }, ctx)).toMatchObject({ ok: false, status: 409 })
    })
  })
})

describe('wave 4 — battle triggers at resolve', () => {
  // A resolve-phase context for a surviving participant on side a. Callers
  // supply the casualty list, which is the only route a resolve trigger has to
  // "who died in this battle, and at what HP" (spec §4.3, DP2 departure 1).
  const resolveCtx = (
    casualties: BattleCasualty[],
    over: Partial<BattleContext> = {},
  ): BattleContext => ({
    phase: 'resolve', zoneId: 1, isDefender: true, isParticipant: true,
    forced: false, survived: true, won: false, casualties, ...over,
  })

  // Puts `entry` in the discard exactly as DECIDE_BATTLE_REPORT would, so a
  // revive has a real snapshot to pull back out.
  function bury(game: EngineGame, side: 'a' | 'b', entry: ReturnType<typeof zoneEntry>) {
    game.state.destroyed[side].push(discardSnapshotOf(entry, side))
  }

  describe('sacrilegoBattle', () => {
    function board() {
      const game = makeGame()
      const sacrilego = zoneEntry({ name: 'Sacrilego', instanceId: 'sac-1', vehicleType: 'ship' })
      game.state.zones[0].cards.a.push(sacrilego)
      const dead = zoneEntry({ name: 'Wreck', instanceId: 'wreck-1', vehicleType: 'ship' })
      bury(game, 'a', dead)
      return { game, sacrilego, dead, casualties: [{ entry: dead, side: 'a' as const, hp: 78 }] }
    }

    it('grants 1 CP for surviving, before any choice is offered', () => {
      const { game, sacrilego, casualties } = board()
      const before = game.state.resources.a.cp
      const ok = effectFor('sacrilegoBattle')!({
        game, actor: 'a', card: sacrilego, ctx: makeCtx(), battle: resolveCtx(casualties),
      })
      expect(ok).toBe(true)
      expect(game.state.resources.a.cp).toBe(before + 1)
      expect(game.state.pendingEffect?.options.map((o) => o.id)).toEqual(['wreck-1'])
    })

    it('grants nothing and offers nothing when it did not survive', () => {
      const { game, sacrilego, casualties } = board()
      const before = game.state.resources.a.cp
      const ok = effectFor('sacrilegoBattle')!({
        game, actor: 'a', card: sacrilego, ctx: makeCtx(),
        battle: resolveCtx(casualties, { survived: false }),
      })
      expect(ok).toBe(true)
      expect(game.state.resources.a.cp).toBe(before) // "whenever this vehicle survives"
      expect(game.state.pendingEffect).toBeNull()
    })

    // Two friendly ships die — one inside the +15 band, one below it — so a
    // mutated boundary changes WHICH option is offered rather than producing a
    // rejected action that never reaches the assertion (handoff §3).
    it('offers only the ship the +15 would actually have saved', () => {
      const game = makeGame()
      const sacrilego = zoneEntry({ name: 'Sacrilego', instanceId: 'sac-1', vehicleType: 'ship' })
      game.state.zones[0].cards.a.push(sacrilego)
      const inBand = zoneEntry({ name: 'Nearly', instanceId: 'near-1', vehicleType: 'ship' })
      const tooFar = zoneEntry({ name: 'Gone', instanceId: 'gone-1', vehicleType: 'ship' })
      bury(game, 'a', inBand)
      bury(game, 'a', tooFar)
      const ok = effectFor('sacrilegoBattle')!({
        game, actor: 'a', card: sacrilego, ctx: makeCtx(),
        battle: resolveCtx([
          { entry: inBand, side: 'a', hp: 78 }, // 78 + 15 = 93 >= 90, saved
          { entry: tooFar, side: 'a', hp: 70 }, // 70 + 15 = 85 < 90, beyond reach
        ]),
      })
      expect(ok).toBe(true)
      expect(game.state.pendingEffect?.options.map((o) => o.id)).toEqual(['near-1'])
    })

    it('ignores an enemy casualty and a friendly non-ship', () => {
      const game = makeGame()
      const sacrilego = zoneEntry({ name: 'Sacrilego', instanceId: 'sac-1', vehicleType: 'ship' })
      game.state.zones[0].cards.a.push(sacrilego)
      const enemyShip = zoneEntry({ name: 'Foe', instanceId: 'foe-1', vehicleType: 'ship' })
      const friendlyPlane = zoneEntry({ name: 'Flyer', instanceId: 'fly-1', vehicleType: 'plane' })
      bury(game, 'b', enemyShip)
      bury(game, 'a', friendlyPlane)
      const ok = effectFor('sacrilegoBattle')!({
        game, actor: 'a', card: sacrilego, ctx: makeCtx(),
        battle: resolveCtx([
          { entry: enemyShip, side: 'b', hp: 78 },
          { entry: friendlyPlane, side: 'a', hp: 78 },
        ]),
      })
      expect(ok).toBe(true)
      expect(game.state.pendingEffect).toBeNull() // no options — no suspension
      expect(game.state.resources.a.cp).toBe(4)
    })

    it('accepting revives the ship, removes one snapshot, and sacrifices Sacrilego', () => {
      const { game, sacrilego, casualties } = board()
      effectFor('sacrilegoBattle')!({
        game, actor: 'a', card: sacrilego, ctx: makeCtx(), battle: resolveCtx(casualties),
      })
      const r = applyAction(game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'wreck-1' }, makeCtx())
      if (!r.ok) throw new Error(r.error)
      const zone = r.game.state.zones[0]
      expect(zone.cards.a.map((c) => c.name)).toEqual(['Wreck'])
      expect(r.game.state.destroyed.a.map((c) => c.name)).toEqual(['Sacrilego'])
    })

    it('declining leaves both the wreck destroyed and Sacrilego alive', () => {
      const { game, sacrilego, casualties } = board()
      effectFor('sacrilegoBattle')!({
        game, actor: 'a', card: sacrilego, ctx: makeCtx(), battle: resolveCtx(casualties),
      })
      const r = applyAction(game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', cancel: true }, makeCtx())
      if (!r.ok) throw new Error(r.error)
      expect(r.game.state.zones[0].cards.a.map((c) => c.name)).toEqual(['Sacrilego'])
      expect(r.game.state.destroyed.a.map((c) => c.name)).toEqual(['Wreck'])
      expect(r.game.state.resources.a.cp).toBe(4) // the CP landed either way
    })

    // Regression: a death trigger dispatched EARLIER in the same
    // DECIDE_BATTLE_REPORT can empty the discard — grant({ draw: 1 }) on an
    // empty deck reshuffles the whole pile into it — leaving the casualty
    // unrevivable. Offering it anyway gave a choice whose only working answer
    // was Decline.
    it('does not offer a casualty whose snapshot has already left the discard', () => {
      const { game, sacrilego, casualties } = board()
      game.state.destroyed.a = [] // what reshuffleDiscard leaves behind
      const ok = effectFor('sacrilegoBattle')!({
        game, actor: 'a', card: sacrilego, ctx: makeCtx(), battle: resolveCtx(casualties),
      })
      expect(ok).toBe(true)
      expect(game.state.pendingEffect).toBeNull()
      expect(game.state.resources.a.cp).toBe(4) // clause 1 is unaffected
    })

    // Regression: the dispatcher used to skip a whole effect once the slot was
    // taken, so a second Sacrilego lost its unconditional CP as well as its
    // offer. UNIQUE_COPY_LIMIT is 2, so two on the field is a legal deck.
    it('grants a CP to EVERY surviving Sacrilego, even when only one can be offered', () => {
      const game = makeGame({ turnNumber: 3 })
      const attacker = zoneEntry({ playedOnTurn: 2 })
      const meta = { onBattleEffect: 'sacrilegoBattle' }
      const first = zoneEntry({ name: 'Sacrilego', vehicleType: 'ship', meta })
      const second = zoneEntry({ name: 'Sacrilego', vehicleType: 'ship', meta })
      const doomed = zoneEntry({ name: 'Wreck', vehicleType: 'ship' })
      game.state.zones[0].cards.a.push(attacker)
      game.state.zones[0].cards.b.push(first, second, doomed)
      game.privates.b.deck.push(inst({ name: 'Spare' })) // so a death draw does not empty the pile
      const declared = applyAction(game, 'alice', {
        type: 'ATTACK_ENEMY_FLEET', zoneId: 1, attackerIds: [attacker.instanceId],
        targetIds: [first.instanceId, second.instanceId, doomed.instanceId],
      }, makeCtx())
      if (!declared.ok) throw new Error(declared.error)
      const before = declared.game.state.resources.b.cp
      const submitted = applyAction(declared.game, 'alice', {
        type: 'SUBMIT_BATTLE_REPORT',
        results: {
          [attacker.instanceId]: 95, [first.instanceId]: 95,
          [second.instanceId]: 95, [doomed.instanceId]: 78,
        },
        repairs: [],
      }, makeCtx())
      if (!submitted.ok) throw new Error(submitted.error)
      const decided = applyAction(submitted.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true }, makeCtx())
      if (!decided.ok) throw new Error(decided.error)
      expect(decided.game.state.resources.b.cp).toBe(before + 2)
      // One offer, not two: the second is dropped rather than overwriting.
      expect(decided.game.state.pendingEffect).not.toBeNull()
      expect(decided.game.state.log.join('\n')).toContain("Sacrilego's offer was not made")
    })

    // Two casualties of the SAME card would otherwise render as two identical
    // buttons — the dialog shows the label alone.
    it('disambiguates same-named casualties by their ending HP', () => {
      const game = makeGame()
      const sacrilego = zoneEntry({ name: 'Sacrilego', instanceId: 'sac-1', vehicleType: 'ship' })
      game.state.zones[0].cards.a.push(sacrilego)
      const one = zoneEntry({ name: 'Cyclone', instanceId: 'cy-1', vehicleType: 'ship', cardId: 'cyclone' })
      const two = zoneEntry({ name: 'Cyclone', instanceId: 'cy-2', vehicleType: 'ship', cardId: 'cyclone' })
      bury(game, 'a', one)
      bury(game, 'a', two)
      effectFor('sacrilegoBattle')!({
        game, actor: 'a', card: sacrilego, ctx: makeCtx(),
        battle: resolveCtx([
          { entry: one, side: 'a', hp: 76 },
          { entry: two, side: 'a', hp: 88 },
        ]),
      })
      expect(game.state.pendingEffect?.options).toEqual([
        { id: 'cy-1', label: 'Cyclone (76%)' },
        { id: 'cy-2', label: 'Cyclone (88%)' },
      ])
    })
  })

  describe('ironCordonBattle', () => {
    const gtAirship = (over: Partial<Parameters<typeof zoneEntry>[0]> = {}) =>
      zoneEntry({ name: 'Nimbus', faction: 'GT', vehicleType: 'airship', ...over })

    function board() {
      const game = makeGame()
      const cordon = zoneEntry({ name: 'Iron Cordon', instanceId: 'cordon-1', faction: 'OW' })
      game.state.zones[0].cards.a.push(cordon)
      return { game, cordon }
    }

    it('offers to save an allied GT airship destroyed in the battle', () => {
      const { game, cordon } = board()
      const dead = gtAirship({ instanceId: 'nimbus-1' })
      bury(game, 'a', dead)
      const ok = effectFor('ironCordonBattle')!({
        game, actor: 'a', card: cordon, ctx: makeCtx(),
        battle: resolveCtx([{ entry: dead, side: 'a', hp: 10 }]),
      })
      expect(ok).toBe(true)
      expect(game.state.pendingEffect?.options.map((o) => o.id)).toEqual(['nimbus-1'])
    })

    // Two allied casualties, only one of them a GT airship: a mutated filter
    // changes which option is offered rather than emptying the list.
    it('ignores an OW airship, a GT ship, and an enemy GT airship', () => {
      const { game, cordon } = board()
      const real = gtAirship({ instanceId: 'nimbus-1' })
      const owAirship = zoneEntry({ name: 'Eyrie', instanceId: 'eyrie-1', faction: 'OW', vehicleType: 'airship' })
      const gtShip = zoneEntry({ name: 'Tug', instanceId: 'tug-1', faction: 'GT', vehicleType: 'ship' })
      const enemyAirship = gtAirship({ instanceId: 'enemy-1' })
      for (const e of [real, owAirship, gtShip]) bury(game, 'a', e)
      bury(game, 'b', enemyAirship)
      const ok = effectFor('ironCordonBattle')!({
        game, actor: 'a', card: cordon, ctx: makeCtx(),
        battle: resolveCtx([
          { entry: real, side: 'a', hp: 0 },
          { entry: owAirship, side: 'a', hp: 0 },
          { entry: gtShip, side: 'a', hp: 0 },
          { entry: enemyAirship, side: 'b', hp: 0 },
        ]),
      })
      expect(ok).toBe(true)
      expect(game.state.pendingEffect?.options.map((o) => o.id)).toEqual(['nimbus-1'])
    })

    it('offers nothing when Iron Cordon did not survive', () => {
      const { game, cordon } = board()
      const dead = gtAirship({ instanceId: 'nimbus-1' })
      bury(game, 'a', dead)
      const ok = effectFor('ironCordonBattle')!({
        game, actor: 'a', card: cordon, ctx: makeCtx(),
        battle: resolveCtx([{ entry: dead, side: 'a', hp: 10 }], { survived: false }),
      })
      expect(ok).toBe(true)
      expect(game.state.pendingEffect).toBeNull()
    })

    it('accepting revives the airship and sacrifices Iron Cordon', () => {
      const { game, cordon } = board()
      const dead = gtAirship({ instanceId: 'nimbus-1' })
      bury(game, 'a', dead)
      effectFor('ironCordonBattle')!({
        game, actor: 'a', card: cordon, ctx: makeCtx(),
        battle: resolveCtx([{ entry: dead, side: 'a', hp: 10 }]),
      })
      const r = applyAction(game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'nimbus-1' }, makeCtx())
      if (!r.ok) throw new Error(r.error)
      expect(r.game.state.zones[0].cards.a.map((c) => c.name)).toEqual(['Nimbus'])
      expect(r.game.state.destroyed.a.map((c) => c.name)).toEqual(['Iron Cordon'])
    })

    it('declining leaves the airship destroyed and Iron Cordon alive', () => {
      const { game, cordon } = board()
      const dead = gtAirship({ instanceId: 'nimbus-1' })
      bury(game, 'a', dead)
      effectFor('ironCordonBattle')!({
        game, actor: 'a', card: cordon, ctx: makeCtx(),
        battle: resolveCtx([{ entry: dead, side: 'a', hp: 10 }]),
      })
      const r = applyAction(game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', cancel: true }, makeCtx())
      if (!r.ok) throw new Error(r.error)
      expect(r.game.state.zones[0].cards.a.map((c) => c.name)).toEqual(['Iron Cordon'])
      expect(r.game.state.destroyed.a.map((c) => c.name)).toEqual(['Nimbus'])
    })

    it('refuses a choiceId that was never offered, leaving the slot intact', () => {
      const { game, cordon } = board()
      const dead = gtAirship({ instanceId: 'nimbus-1' })
      bury(game, 'a', dead)
      effectFor('ironCordonBattle')!({
        game, actor: 'a', card: cordon, ctx: makeCtx(),
        battle: resolveCtx([{ entry: dead, side: 'a', hp: 10 }]),
      })
      expect(applyAction(game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'ghost' }, makeCtx()))
        .toMatchObject({ ok: false, status: 400 })
      expect(game.state.pendingEffect).not.toBeNull()
    })
  })

  it('end to end: a destroyed GT airship reaches Iron Cordon through a real report', () => {
    const game = makeGame({ turnNumber: 3 })
    const attacker = zoneEntry({ playedOnTurn: 2 })
    const cordon = zoneEntry({
      name: 'Iron Cordon', faction: 'OW', meta: { onBattleEffect: 'ironCordonBattle' },
    })
    const airship = zoneEntry({ name: 'Nimbus', faction: 'GT', vehicleType: 'airship' })
    game.state.zones[0].cards.a.push(attacker)
    game.state.zones[0].cards.b.push(cordon, airship)
    const declared = applyAction(game, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
      attackerIds: [attacker.instanceId], targetIds: [cordon.instanceId, airship.instanceId],
    }, makeCtx())
    if (!declared.ok) throw new Error(declared.error)
    const submitted = applyAction(declared.game, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [attacker.instanceId]: 95, [cordon.instanceId]: 95, [airship.instanceId]: 5 },
      repairs: [],
    }, makeCtx())
    if (!submitted.ok) throw new Error(submitted.error)
    const decided = applyAction(submitted.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true }, makeCtx())
    if (!decided.ok) throw new Error(decided.error)
    expect(decided.game.state.pendingEffect?.side).toBe('b')
    expect(decided.game.state.pendingEffect?.options.map((o) => o.id)).toEqual([airship.instanceId])
    const saved = applyAction(decided.game, 'bob', {
      type: 'RESOLVE_PENDING_EFFECT', choiceId: airship.instanceId,
    }, makeCtx())
    if (!saved.ok) throw new Error(saved.error)
    expect(saved.game.state.zones[0].cards.b.map((c) => c.name)).toEqual(['Nimbus'])
    expect(saved.game.state.destroyed.b.map((c) => c.name)).toEqual(['Iron Cordon'])
  })
})

describe('wave 4 — terawattJoin', () => {
  // alice (side a) forces the battle; bob (side b) owns the lone defender and
  // the Terawatt standing beside it. Two enemy vehicles sit in the zone but
  // only one is dragged into the fight, so a mutated "sole defender" guard
  // changes WHICH offer appears rather than producing a rejected action
  // (handoff §3's collision-aware requirement).
  function forced(over: {
    terawattZone?: number
    terawattSide?: 'a' | 'b'
    defenderCount?: number
  } = {}) {
    const game = makeGame({ turnNumber: 3 })
    const attacker = zoneEntry({ name: 'Aggressor', playedOnTurn: 2 })
    const lone = zoneEntry({ name: 'Lone', instanceId: 'lone-1' })
    const spare = zoneEntry({ name: 'Spare', instanceId: 'spare-1' })
    const terawatt = zoneEntry({
      name: 'Terawatt', instanceId: 'tera-1', meta: { onBattleEffect: 'terawattJoin' },
    })
    game.state.zones[0].cards.a.push(attacker)
    game.state.zones[0].cards.b.push(lone, spare)
    const side = over.terawattSide ?? 'b'
    const zoneIndex = (over.terawattZone ?? 1) - 1
    game.state.zones[zoneIndex].cards[side].push(terawatt)
    const defenderIds = over.defenderCount === 2 ? ['lone-1', 'spare-1'] : ['lone-1']
    const declared = declareForcedBattle(game, makeCtx(), {
      zoneId: 1, aggressor: 'a', attackerIds: [attacker.instanceId], defenderIds, cause: 'Gang Up',
    })
    return { game, terawatt, lone, spare, attacker, declared }
  }

  it('offers the join when a friendly vehicle is left to fight alone', () => {
    const { game, declared } = forced()
    expect(declared).toBe(true)
    expect(game.state.pendingEffect?.side).toBe('b')
    expect(game.state.pendingEffect?.card.name).toBe('Terawatt')
    expect(game.state.pendingEffect?.options).toHaveLength(1)
  })

  it('accepting puts Terawatt on the defending side of the battle', () => {
    const { game, terawatt, lone } = forced()
    const r = applyAction(game, 'bob', {
      type: 'RESOLVE_PENDING_EFFECT', choiceId: game.state.pendingEffect!.options[0].id,
    }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.activeBattle?.defenderIds).toEqual([lone.instanceId, terawatt.instanceId])
    expect(r.game.state.activeBattle?.summons).toEqual([]) // already on the board — not a summon
    expect(r.game.state.pendingEffect).toBeNull()
  })

  it('declining leaves the battle 1v1 and still reportable', () => {
    const { game, attacker, lone } = forced()
    const r = applyAction(game, 'bob', { type: 'RESOLVE_PENDING_EFFECT', cancel: true }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.activeBattle?.defenderIds).toEqual([lone.instanceId])
    const s = applyAction(r.game, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [attacker.instanceId]: 95, [lone.instanceId]: 95 }, repairs: [],
    }, makeCtx())
    expect(s.ok).toBe(true)
  })

  it('offers nothing when the defending side already has two participants', () => {
    const { game } = forced({ defenderCount: 2 })
    expect(game.state.activeBattle?.defenderIds).toHaveLength(2)
    expect(game.state.pendingEffect).toBeNull()
  })

  it('offers nothing for a Terawatt in a different zone', () => {
    const { game } = forced({ terawattZone: 2 })
    expect(game.state.activeBattle).not.toBeNull()
    expect(game.state.pendingEffect).toBeNull()
  })

  it('offers nothing for a Terawatt on the aggressor side', () => {
    const { game } = forced({ terawattSide: 'a' })
    expect(game.state.activeBattle).not.toBeNull()
    expect(game.state.pendingEffect).toBeNull()
  })

  // "Due to enemy card effect" — an ordinary fleet attack is not that, however
  // lonely the defender ends up.
  it('offers nothing on an ordinary fleet attack that leaves one defender', () => {
    const game = makeGame({ turnNumber: 3 })
    const attacker = zoneEntry({ playedOnTurn: 2 })
    const lone = zoneEntry({ name: 'Lone' })
    const terawatt = zoneEntry({ name: 'Terawatt', meta: { onBattleEffect: 'terawattJoin' } })
    game.state.zones[0].cards.a.push(attacker)
    game.state.zones[0].cards.b.push(lone, terawatt)
    const r = applyAction(game, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
      attackerIds: [attacker.instanceId], targetIds: [lone.instanceId],
    }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.pendingEffect).toBeNull()
  })

  // Terawatt as the lone defender is already fighting: the bystander pass
  // excludes combatants, and the participant pass hands it isParticipant true,
  // which its own guard rejects.
  it('offers nothing when Terawatt IS the lone defender', () => {
    const game = makeGame({ turnNumber: 3 })
    const attacker = zoneEntry({ playedOnTurn: 2 })
    const terawatt = zoneEntry({
      name: 'Terawatt', instanceId: 'tera-1', meta: { onBattleEffect: 'terawattJoin' },
    })
    game.state.zones[0].cards.a.push(attacker)
    game.state.zones[0].cards.b.push(terawatt)
    const declared = declareForcedBattle(game, makeCtx(), {
      zoneId: 1, aggressor: 'a', attackerIds: [attacker.instanceId], defenderIds: ['tera-1'], cause: 'Gang Up',
    })
    expect(declared).toBe(true)
    expect(game.state.pendingEffect).toBeNull()
  })

  // The reason resolve re-checks "alone" rather than trusting the offer: the
  // choice can sit open while the board moves. joinBattle's own duplicate
  // guard does NOT cover this — the joiner here is a different hull.
  it('refuses once someone else has joined, so the vehicle is no longer alone', () => {
    const { game, spare } = forced()
    const optionId = game.state.pendingEffect!.options[0].id
    expect(joinBattle(game, 'b', spare.instanceId)).toBe(true)
    expect(applyAction(game, 'bob', { type: 'RESOLVE_PENDING_EFFECT', choiceId: optionId }, makeCtx()))
      .toMatchObject({ ok: false, status: 400 })
  })

  it('refuses once the battle is gone', () => {
    const { game } = forced()
    const optionId = game.state.pendingEffect!.options[0].id
    const noBattle = structuredClone(game)
    noBattle.state.activeBattle = null
    expect(applyAction(noBattle, 'bob', { type: 'RESOLVE_PENDING_EFFECT', choiceId: optionId }, makeCtx()))
      .toMatchObject({ ok: false, status: 400 })
  })

  // joinBattle's own duplicate guard, reached on its own terms. Going through
  // a real second answer instead hits the "no longer alone" re-check one line
  // earlier, which proves a different thing.
  it('refuses to join a battle it is already fighting in', () => {
    const { game, terawatt } = forced()
    const optionId = game.state.pendingEffect!.options[0].id
    const joined = applyAction(game, 'bob', { type: 'RESOLVE_PENDING_EFFECT', choiceId: optionId }, makeCtx())
    if (!joined.ok) throw new Error(joined.error)
    // Put the battle back to one defender — Terawatt itself — so the sole-
    // defender re-check passes and joinBattle is what has to refuse.
    joined.game.state.activeBattle!.defenderIds = [terawatt.instanceId]
    joined.game.state.pendingEffect = game.state.pendingEffect
    expect(applyAction(joined.game, 'bob', { type: 'RESOLVE_PENDING_EFFECT', choiceId: optionId }, makeCtx()))
      .toMatchObject({ ok: false, status: 400 })
  })

  // The join has to survive everything a battle does to a combatant, not just
  // land in defenderIds: report completeness, destruction, and the discard.
  it('an accepted join is a full combatant through the report', () => {
    const { game, terawatt, lone, attacker } = forced()
    const joined = applyAction(game, 'bob', {
      type: 'RESOLVE_PENDING_EFFECT', choiceId: game.state.pendingEffect!.options[0].id,
    }, makeCtx())
    if (!joined.ok) throw new Error(joined.error)
    // Completeness now demands Terawatt: a report without it is rejected.
    expect(applyAction(joined.game, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [attacker.instanceId]: 95, [lone.instanceId]: 95 }, repairs: [],
    }, makeCtx())).toMatchObject({ ok: false, status: 400 })
    const submitted = applyAction(joined.game, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [attacker.instanceId]: 95, [lone.instanceId]: 95, [terawatt.instanceId]: 10 },
      repairs: [],
    }, makeCtx())
    if (!submitted.ok) throw new Error(submitted.error)
    const decided = applyAction(submitted.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true }, makeCtx())
    if (!decided.ok) throw new Error(decided.error)
    expect(decided.game.state.zones[0].cards.b.map((c) => c.name)).toEqual(['Lone', 'Spare'])
    expect(decided.game.state.destroyed.b.map((c) => c.name)).toEqual(['Terawatt'])
  })

  // The Onyx Throne's Parapet joins in the participant pass, which runs first,
  // so by the bystander pass the defending side has two participants. A lone
  // Onyx Throne is therefore never "alone" — intended, and recorded here so a
  // future change to the pass order cannot flip it silently.
  it('makes no offer when a Parapet has already joined the lone defender', () => {
    const game = makeGame({ turnNumber: 3 })
    const attacker = zoneEntry({ name: 'Aggressor', playedOnTurn: 2 })
    const throne = zoneEntry({
      name: 'The Onyx Throne', instanceId: 'onyx-1', meta: { onBattleEffect: 'onyxThroneBattle' },
    })
    const terawatt = zoneEntry({ name: 'Terawatt', meta: { onBattleEffect: 'terawattJoin' } })
    game.state.zones[0].cards.a.push(attacker)
    game.state.zones[0].cards.b.push(throne, terawatt)
    const parapetHull = snap({ name: 'Parapet', faction: 'OW', vehicleType: 'plane', meta: { summonOnly: true } })
    expect(declareForcedBattle(game, makeCtx({ catalog: [parapetHull] }), {
      zoneId: 1, aggressor: 'a', attackerIds: [attacker.instanceId],
      defenderIds: ['onyx-1'], cause: 'Gang Up',
    })).toBe(true)
    expect(game.state.activeBattle?.defenderIds).toHaveLength(2) // Throne + Parapet
    expect(game.state.pendingEffect).toBeNull()
  })

  // Regression for the second half of the same problem: Dryad board-spawns a
  // replacement whenever it is dragged into a defensive battle, forced ones
  // included, so a Trebuchet chain fed on Dryads never ran out of targets and
  // spec §7.3's "terminates on the zone's population" was false. The chain is
  // now bounded by the hulls eligible when it began, which a spawned Dryad is
  // not — so the repeat ends even though the zone never empties.
  it('does not let a Dryad spawned mid-chain feed Trebuchet another repeat', () => {
    const dryadHull = snap({
      name: 'Dryad', faction: 'SS', vehicleType: 'ship', materialCost: 40_500,
      keywords: ['blocker'], meta: { onBattleEffect: 'dryadBattle' },
    })
    const game = makeGame({ turnNumber: 3 })
    const treb = zoneEntry({ name: 'Trebuchet', instanceId: 'treb-1', playedOnTurn: 2, keywords: ['scrappy'] })
    const dryad = zoneEntry({
      name: 'Dryad', instanceId: 'dryad-1', vehicleType: 'ship',
      meta: { onBattleEffect: 'dryadBattle' },
    })
    game.state.zones[0].cards.a.push(treb)
    game.state.zones[0].cards.b.push(dryad)
    const ctx = makeCtx({ catalog: [dryadHull] })

    effectFor('trebuchetEffect')!({ game, actor: 'a', card: treb, ctx, targetZoneId: 1 })
    const declared = applyAction(game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'dryad-1' }, ctx)
    if (!declared.ok) throw new Error(declared.error)
    // Dryad's own lock trigger already replaced it, so the zone will not be
    // empty when the battle resolves — which is exactly what used to keep the
    // chain alive.
    expect(declared.game.state.zones[0].cards.b).toHaveLength(2)

    const submitted = applyAction(declared.game, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT', results: { 'treb-1': 95, 'dryad-1': 10 }, repairs: [],
    }, ctx)
    if (!submitted.ok) throw new Error(submitted.error)
    const decided = applyAction(submitted.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true }, ctx)
    if (!decided.ok) throw new Error(decided.error)

    // Trebuchet won cleanly and survived, and a fresh Dryad is standing right
    // there — but it was not in the chain, so there is no repeat to offer.
    expect(decided.game.state.zones[0].cards.b).toHaveLength(1)
    expect(decided.game.state.zones[0].cards.b[0].name).toBe('Dryad')
    expect(decided.game.state.zones[0].cards.a.some((c) => c.instanceId === 'treb-1')).toBe(true)
    expect(decided.game.state.pendingEffect).toBeNull()
  })

  // Regression: Trebuchet's repeat used to re-derive its win from a roster
  // snapshotted at DECLARE time, so a defender that joined afterwards was
  // invisible and it scored a battle it had lost as a clean win.
  it('does not hand Trebuchet a repeat off a battle Terawatt survived', () => {
    const game = makeGame({ turnNumber: 3 })
    const treb = zoneEntry({ name: 'Trebuchet', instanceId: 'treb-1', playedOnTurn: 2 })
    const lone = zoneEntry({ name: 'Lone', instanceId: 'lone-1' })
    const terawatt = zoneEntry({
      name: 'Terawatt', instanceId: 'tera-1', meta: { onBattleEffect: 'terawattJoin' },
    })
    game.state.zones[0].cards.a.push(treb)
    game.state.zones[0].cards.b.push(lone, terawatt)
    const ctx = makeCtx()
    const played = effectFor('trebuchetEffect')!({
      game, actor: 'a', card: treb, ctx, targetZoneId: 1,
    })
    expect(played).toBe(true)
    const declared = applyAction(game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'lone-1' }, ctx)
    if (!declared.ok) throw new Error(declared.error)
    // Terawatt's offer lands on the defender, off-turn.
    expect(declared.game.state.pendingEffect?.card.name).toBe('Terawatt')
    const joined = applyAction(declared.game, 'bob', {
      type: 'RESOLVE_PENDING_EFFECT', choiceId: declared.game.state.pendingEffect!.options[0].id,
    }, ctx)
    if (!joined.ok) throw new Error(joined.error)
    const submitted = applyAction(joined.game, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { 'treb-1': 95, 'lone-1': 10, 'tera-1': 100 }, repairs: [],
    }, ctx)
    if (!submitted.ok) throw new Error(submitted.error)
    const decided = applyAction(submitted.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true }, ctx)
    if (!decided.ok) throw new Error(decided.error)
    // Terawatt survived, so the aggressor did not win — and Trebuchet gets no
    // repeat. Before the fix, this was an offered choice.
    expect(decided.game.state.pendingEffect).toBeNull()
  })
})

// The dispatch in battleTriggers.ts mints a rider's payload card from
// ctx.catalog by cardName, so an effect that must be REACHED as a zone rider
// needs { needsCatalog: true } even when it reads no catalog itself. Asserted
// at runtime rather than by reading the source: makeCtx hands every test a
// catalog, so a missing flag is invisible to unit tests and shows up only as a
// dead card in production (handoff trap 4.5).
//
// Sub Killer is deliberately absent: its rider is a pure data marker read by
// legalZonesFor, so a lock dispatch that skips it costs nothing.
describe('zone riders that must be dispatched carry needsCatalog', () => {
  it.each(['dwgWatersEffect', 'ambushEffect', 'ongoingAttritionEffect', 'recurringThreatEffect'])(
    '%s', (name) => { expect(CATALOG_EFFECTS.has(name)).toBe(true) },
  )
  it('subKillerEffect does not need it', () => {
    expect(CATALOG_EFFECTS.has('subKillerEffect')).toBe(false)
  })
})

// Wave 5 — DP5's rest-of-turn riders (spec §4.3, "DP5 as wave 5 built it").
// Driven through applyAction rather than by calling the effects directly:
// the lock dispatch, the catalog probe's rider source and endTurn's expiry
// pass are the parts most likely to break, and only a real action exercises
// all three.
describe('wave 5 — Ambush', () => {
  const ambushSnap = snap({
    name: 'Ambush', faction: 'WF', type: 'ability', vehicleType: null,
    materialCost: 0, cardText: 'Choose a zone…', meta: { playOnZoneEffect: 'ambushEffect' },
  })
  const ambushCtx = () => makeCtx({ catalog: [ambushSnap] })
  const ambushCard = () => inst({ ...ambushSnap })

  // alice plays Ambush on zone 1, then has a hull ready to attack with.
  function armed() {
    const game = makeGame({ turnNumber: 3, activePlayer: 'alice' })
    const card = ambushCard()
    game.privates.a.hand.push(card)
    game.state.counts.a.hand = 1
    const r = applyAction(game, 'alice', {
      type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1,
    }, ambushCtx())
    if (!r.ok) throw new Error(r.error)
    const attacker = zoneEntry({ name: 'Raider', playedOnTurn: 2 })
    const defender = zoneEntry({ name: 'Home Fleet' })
    r.game.state.zones[0].cards.a.push(attacker)
    r.game.state.zones[0].cards.b.push(defender)
    return { game: r.game, attacker, defender }
  }

  const attack = (game: EngineGame, ids: { attacker: string; defender: string }) =>
    applyAction(game, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1, attackerIds: [ids.attacker], targetIds: [ids.defender],
    }, ambushCtx())

  it('claims the zone with a rest-of-turn rider that draws if unused', () => {
    const { game } = armed()
    expect(game.state.zoneEffects).toEqual([{
      effect: 'ambushEffect', zoneId: 1, side: 'a', cardName: 'Ambush',
      setOnTurn: 3, expiresOnTurn: 3, data: { drawOnExpiry: true },
    }])
  })

  it('refuses a second Ambush on a zone the same side already holds one in', () => {
    const { game } = armed()
    const second = ambushCard()
    game.privates.a.hand.push(second)
    game.state.counts.a.hand = 1
    const r = applyAction(game, 'alice', {
      type: 'PLAY_CARD_TO_ZONE', instanceId: second.instanceId, zoneId: 1,
    }, ambushCtx())
    expect(r).toMatchObject({ ok: false, status: 400 })
  })

  it('allows a second Ambush in a different zone', () => {
    const { game } = armed()
    const second = ambushCard()
    game.privates.a.hand.push(second)
    game.state.counts.a.hand = 1
    const r = applyAction(game, 'alice', {
      type: 'PLAY_CARD_TO_ZONE', instanceId: second.instanceId, zoneId: 2,
    }, ambushCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zoneEffects.map((e) => e.zoneId)).toEqual([1, 2])
  })

  it('offers at the ambusher own battle lock, and consumes the rider first', () => {
    const { game, attacker, defender } = armed()
    const r = attack(game, { attacker: attacker.instanceId, defender: defender.instanceId })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.pendingEffect?.side).toBe('a')
    expect(r.game.state.pendingEffect?.card.name).toBe('Ambush')
    // Spent by the battle, whatever the answer turns out to be (spec §7.3).
    expect(r.game.state.zoneEffects).toEqual([])
  })

  it('accepting moves the spawn distance 600m closer and grants the deploy order', () => {
    const { game, attacker, defender } = armed()
    const locked = attack(game, { attacker: attacker.instanceId, defender: defender.instanceId })
    if (!locked.ok) throw new Error(locked.error)
    const before = locked.game.state.activeBattle!.distanceM
    const r = applyAction(locked.game, 'alice', {
      type: 'RESOLVE_PENDING_EFFECT', choiceId: locked.game.state.pendingEffect!.options[0].id,
    }, ambushCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.activeBattle!.distanceM).toBe(before - 600)
    // Tactical Positioning's per-side ledger is NOT spent by a card.
    expect(r.game.state.activeBattle!.distanceModifiedBy).toEqual([])
    expect(r.game.state.log.some((l) => l.includes('Ambush') && l.includes('after'))).toBe(true)
  })

  it('clamps at the minimum spawn distance rather than going through it', () => {
    const { game, attacker, defender } = armed()
    const locked = attack(game, { attacker: attacker.instanceId, defender: defender.instanceId })
    if (!locked.ok) throw new Error(locked.error)
    locked.game.state.activeBattle!.distanceM = 100
    const r = applyAction(locked.game, 'alice', {
      type: 'RESOLVE_PENDING_EFFECT', choiceId: locked.game.state.pendingEffect!.options[0].id,
    }, ambushCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.activeBattle!.distanceM).toBe(50) // SPAWN_DISTANCE_MIN_M
  })

  it('declining leaves the distance alone', () => {
    const { game, attacker, defender } = armed()
    const locked = attack(game, { attacker: attacker.instanceId, defender: defender.instanceId })
    if (!locked.ok) throw new Error(locked.error)
    const r = applyAction(locked.game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', cancel: true }, ambushCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.activeBattle!.distanceM).toBe(1200)
  })

  it('does not fire when its owner is the DEFENDER of a battle in that zone', () => {
    const { game, attacker, defender } = armed()
    // bob attacks into zone 1 instead: alice's ambush is not an offensive battle.
    const bobsTurn = { ...game, activePlayer: 'bob', turnNumber: 3.5 }
    const r = applyAction(bobsTurn, 'bob', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
      attackerIds: [defender.instanceId], targetIds: [attacker.instanceId],
    }, ambushCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.pendingEffect).toBeNull()
    expect(r.game.state.zoneEffects).toHaveLength(1)
  })

  it('does not fire on a bombardment — a base attack is not a battle fought', () => {
    const { game } = armed()
    const r = applyAction(game, 'alice', { type: 'ATTACK_ENEMY_BASE', zoneId: 1 }, ambushCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.pendingEffect).toBeNull()
    expect(r.game.state.zoneEffects).toHaveLength(1)
  })

  it('draws at its owner END_TURN when no battle was fought there', () => {
    const { game } = armed()
    game.privates.a.deck = [inst({ name: 'Reward' }), inst()]
    game.state.counts.a.deck = 2
    const r = applyAction(game, 'alice', { type: 'END_TURN' }, ambushCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.a.hand.map((c) => c.name)).toEqual(['Reward'])
    expect(r.game.state.zoneEffects).toEqual([])
  })

  it('draws nothing at END_TURN once a battle has consumed it', () => {
    const { game, attacker, defender } = armed()
    const locked = attack(game, { attacker: attacker.instanceId, defender: defender.instanceId })
    if (!locked.ok) throw new Error(locked.error)
    const declined = applyAction(locked.game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', cancel: true }, ambushCtx())
    if (!declined.ok) throw new Error(declined.error)
    declined.game.state.activeBattle = null // the battle is over, however it went
    declined.game.privates.a.deck = [inst({ name: 'Reward' }), inst()]
    declined.game.state.counts.a.deck = 2
    const r = applyAction(declined.game, 'alice', { type: 'END_TURN' }, ambushCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.a.hand).toHaveLength(0)
  })

  // Spec §4.3, DP2 departure 4. The rider is spent BEFORE the offer, so a
  // dropped offer still counts as "you fought there" — which is what the
  // card's own compensation clause asks.
  it('is consumed even when its offer is dropped for an occupied slot', () => {
    const { game, attacker, defender } = armed()
    // A participant that suspends first, taking the one slot.
    const chooser = zoneEntry({ name: 'Chooser', meta: { onBattleEffect: 't_slotHog' } })
    game.state.zones[0].cards.a.push(chooser)
    const r = applyAction(game, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
      attackerIds: [attacker.instanceId, chooser.instanceId], targetIds: [defender.instanceId],
    }, ambushCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.pendingEffect?.card.name).toBe('Chooser')
    expect(r.game.state.zoneEffects).toEqual([])
    expect(r.game.state.log.some((l) => l.includes('Ambush') && l.includes('not made'))).toBe(true)
  })
})

describe('wave 5 — Sub Killer', () => {
  const killerSnap = snap({
    name: 'Sub Killer', faction: 'OW', type: 'ability', vehicleType: null,
    materialCost: 100_000, cpCost: 1, cardText: 'Target an enemy submarine…',
    meta: { playOnVehicleEffect: 'subKillerEffect' },
  })
  const killerCtx = () => makeCtx({ catalog: [killerSnap] })

  // alice holds Sub Killer; bob has `targetType` in zone 1.
  function armed(over: { targetType?: string; targetMeta?: Record<string, unknown>; myGtInZone?: boolean } = {}) {
    const game = makeGame({ turnNumber: 3, activePlayer: 'alice' })
    const card = inst({ ...killerSnap })
    game.privates.a.hand.push(card)
    game.state.counts.a.hand = 1
    const target = zoneEntry({
      name: 'Nautilus', vehicleType: over.targetType ?? 'sub', materialCost: 60_000,
      meta: over.targetMeta ?? {},
    })
    game.state.zones[0].cards.b.push(target)
    if (over.myGtInZone) {
      game.state.zones[0].cards.a.push(zoneEntry({ name: 'GT Hull', faction: 'GT', vehicleType: 'airship' }))
    }
    return { game, card, target }
  }

  const play = (game: EngineGame, ids: { card: string; target: string }) =>
    applyAction(game, 'alice', {
      type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD', instanceId: ids.card, targetInstanceId: ids.target,
    }, killerCtx())

  it('removes the target from play and leaves a GT-blocking rider on its zone', () => {
    const { game, card, target } = armed()
    const r = play(game, { card: card.instanceId, target: target.instanceId })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.b).toHaveLength(0)
    expect(r.game.state.destroyed.b.map((c) => c.name)).toEqual(['Nautilus'])
    expect(r.game.state.zoneEffects).toEqual([{
      effect: 'subKillerEffect', zoneId: 1, side: 'a', cardName: 'Sub Killer',
      setOnTurn: 3, expiresOnTurn: 3, data: { blocksFaction: 'GT' },
    }])
  })

  // Spec §7.3: "remove from play" is deliberately not "destroy", and this wave
  // prints both words on different cards.
  it('fires no death trigger — removal is not destruction', () => {
    const { game, card, target } = armed({ targetMeta: { onDeathEffect: 'javelinOnDeath' } })
    game.privates.b.deck = [inst({ name: 'Consolation' })]
    game.state.counts.b.deck = 1
    const r = play(game, { card: card.instanceId, target: target.instanceId })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.b.hand).toHaveLength(0)
  })

  it.each(['ship', 'tank'])('refuses a %s target', (vehicleType) => {
    const { game, card, target } = armed({ targetType: vehicleType })
    expect(play(game, { card: card.instanceId, target: target.instanceId }))
      .toMatchObject({ ok: false, status: 400 })
  })

  it.each(['plane', 'airship'])('accepts a %s target', (vehicleType) => {
    const { game, card, target } = armed({ targetType: vehicleType })
    const r = play(game, { card: card.instanceId, target: target.instanceId })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.b).toHaveLength(0)
  })

  it('refuses a friendly target', () => {
    const { game, card } = armed()
    const mine = zoneEntry({ name: 'My Sub', vehicleType: 'sub' })
    game.state.zones[0].cards.a.push(mine)
    expect(play(game, { card: card.instanceId, target: mine.instanceId }))
      .toMatchObject({ ok: false, status: 400 })
  })

  it('refuses a zone the actor already holds a GT vehicle in', () => {
    const { game, card, target } = armed({ myGtInZone: true })
    expect(play(game, { card: card.instanceId, target: target.instanceId }))
      .toMatchObject({ ok: false, status: 400 })
  })

  it('blocks the actor from PLAYING a GT vehicle into that zone, but not a non-GT one', () => {
    const { game, card, target } = armed()
    const r = play(game, { card: card.instanceId, target: target.instanceId })
    if (!r.ok) throw new Error(r.error)
    const gt = inst({ name: 'GT Airship', faction: 'GT', vehicleType: 'airship', materialCost: 10_000 })
    const ow = inst({ name: 'OW Airship', faction: 'OW', vehicleType: 'airship', materialCost: 10_000 })
    r.game.privates.a.hand.push(gt, ow)
    r.game.state.counts.a.hand = 2
    r.game.state.resources.a.materials = 50_000 // Sub Killer's 100k left the purse empty
    expect(legalZonesFor(r.game.state, 'a', gt)).toEqual([2, 3])
    expect(legalZonesFor(r.game.state, 'a', ow)).toEqual([1, 2, 3])
    // The opponent is not restricted — the card blocks its own player.
    expect(legalZonesFor(r.game.state, 'b', gt)).toEqual([1, 2, 3])
    expect(applyAction(r.game, 'alice', {
      type: 'PLAY_CARD_TO_ZONE', instanceId: gt.instanceId, zoneId: 1,
    }, killerCtx())).toMatchObject({ ok: false, status: 400 })
    const ok = applyAction(r.game, 'alice', {
      type: 'PLAY_CARD_TO_ZONE', instanceId: ow.instanceId, zoneId: 1,
    }, killerCtx())
    expect(ok.ok).toBe(true)
  })

  it('lifts the block at its owner’s END_TURN, and draws nothing', () => {
    const { game, card, target } = armed()
    const r = play(game, { card: card.instanceId, target: target.instanceId })
    if (!r.ok) throw new Error(r.error)
    r.game.privates.a.deck = [inst({ name: 'Not A Reward' }), inst()]
    r.game.state.counts.a.deck = 2
    const ended = applyAction(r.game, 'alice', { type: 'END_TURN' }, killerCtx())
    if (!ended.ok) throw new Error(ended.error)
    expect(ended.game.state.zoneEffects).toEqual([])
    expect(ended.game.privates.a.hand).toHaveLength(0)
  })

  // Its rider is a pure data marker, but it still lives in state.zoneEffects,
  // so the lock dispatch hands it a battle payload like any other.
  it('is a no-op when the lock dispatch hands it a battle', () => {
    const { game, card, target } = armed()
    const r = play(game, { card: card.instanceId, target: target.instanceId })
    if (!r.ok) throw new Error(r.error)
    const before = JSON.stringify(r.game.state)
    const ok = effectFor('subKillerEffect')!({
      game: r.game, actor: 'a', card: inst({ ...killerSnap }), ctx: killerCtx(),
      battle: {
        phase: 'lock', zoneId: 1, isDefender: false, isParticipant: false,
        forced: false, survived: false, won: false, casualties: [],
      },
    })
    expect(ok).toBe(true)
    expect(JSON.stringify(r.game.state)).toBe(before)
  })
})

describe('wave 5 — Recurring Threat', () => {
  const threatSnap = snap({
    name: 'Recurring Threat', faction: 'DWG', type: 'ability', vehicleType: null,
    materialCost: 100_000, cardText: 'Choose a friendly vehicle, destroy it…',
    meta: { playOnVehicleEffect: 'recurringThreatEffect' },
  })
  const threatCtx = () => makeCtx({ catalog: [threatSnap] })

  // alice has `hulls` ships in zone 1, bob has a raider there to attack with.
  function board(over: { hulls?: number; hullMeta?: Record<string, unknown>; builtIn?: boolean } = {}) {
    const game = makeGame({ turnNumber: 3, activePlayer: 'alice' })
    game.state.resources.a.materials = 500_000
    game.privates.a.deck = [inst({ name: 'Deck Top' }), inst({ name: 'Deck Next' })]
    game.state.counts.a.deck = 2
    const mine = Array.from({ length: over.hulls ?? 1 }, (_, i) => zoneEntry({
      name: `Doomed ${i}`, faction: 'DWG', vehicleType: 'ship', materialCost: 70_000,
      isBuiltIn: over.builtIn ?? true, keywords: ['scrappy'],
      meta: over.hullMeta ?? {}, playedOnTurn: 2,
    }))
    const raider = zoneEntry({ name: 'Raider', playedOnTurn: 2 })
    game.state.zones[0].cards.a.push(...mine)
    game.state.zones[0].cards.b.push(raider)
    return { game, mine, raider }
  }

  function cast(game: EngineGame, targetInstanceId: string) {
    const card = inst({ ...threatSnap })
    game.privates.a.hand.push(card)
    game.state.counts.a.hand = game.privates.a.hand.length
    const r = applyAction(game, 'alice', {
      type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD', instanceId: card.instanceId, targetInstanceId,
    }, threatCtx())
    return r
  }

  // bob attacks alice's remaining hull in zone 1 — a DEFENSIVE battle for the
  // claimant, which is the only kind the card reacts to.
  function attacked(game: EngineGame, raiderId: string, defenderId: string) {
    const bobsTurn = { ...game, activePlayer: 'bob', turnNumber: 3.5 }
    return applyAction(bobsTurn, 'bob', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1, attackerIds: [raiderId], targetIds: [defenderId],
    }, threatCtx())
  }

  it('is registered as needing the catalog', () => {
    // Verified at runtime rather than by reading the source: makeCtx hands
    // every test a catalog, so a missing flag is invisible to unit tests and
    // shows up only as a dead card in production (handoff trap 4.5).
    expect(CATALOG_EFFECTS.has('recurringThreatEffect')).toBe(true)
  })

  it('destroys the target, remembers its snapshot, and rides forever', () => {
    const { game, mine } = board()
    const r = cast(game, mine[0].instanceId)
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a).toHaveLength(0)
    expect(r.game.state.destroyed.a.map((c) => c.name)).toContain('Doomed 0')
    expect(r.game.state.zoneEffects).toHaveLength(1)
    const rider = r.game.state.zoneEffects[0]
    expect(rider).toMatchObject({
      effect: 'recurringThreatEffect', zoneId: 1, side: 'a', cardName: 'Recurring Threat', setOnTurn: 3,
    })
    expect(rider.expiresOnTurn).toBeUndefined()
    expect((rider.data?.summon as { name: string }).name).toBe('Doomed 0')
  })

  // Spec §7.3, decision 28: this card says "destroy", and means it.
  it('fires the destroyed hull’s own death trigger', () => {
    const { game, mine } = board({ hullMeta: { onDeathEffect: 'javelinOnDeath' } })
    const r = cast(game, mine[0].instanceId)
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.a.hand.map((c) => c.name)).toEqual(['Deck Top'])
  })

  it('refuses an enemy target', () => {
    const { game, raider } = board()
    expect(cast(game, raider.instanceId)).toMatchObject({ ok: false, status: 400 })
  })

  it('survives END_TURN — it is for the rest of the game', () => {
    const { game, mine } = board()
    const r = cast(game, mine[0].instanceId)
    if (!r.ok) throw new Error(r.error)
    const ended = applyAction(r.game, 'alice', { type: 'END_TURN' }, threatCtx())
    if (!ended.ok) throw new Error(ended.error)
    expect(ended.game.state.zoneEffects).toHaveLength(1)
  })

  it('offers a summon in a defensive battle, and the accepted copy fights without landing', () => {
    const { game, mine, raider } = board({ hulls: 2 })
    const cast1 = cast(game, mine[0].instanceId)
    if (!cast1.ok) throw new Error(cast1.error)
    const locked = attacked(cast1.game, raider.instanceId, mine[1].instanceId)
    if (!locked.ok) throw new Error(locked.error)
    expect(locked.game.state.pendingEffect?.side).toBe('a')
    expect(locked.game.state.pendingEffect?.card.name).toBe('Recurring Threat')
    const r = applyAction(locked.game, 'alice', {
      type: 'RESOLVE_PENDING_EFFECT', choiceId: locked.game.state.pendingEffect!.options[0].id,
    }, threatCtx())
    if (!r.ok) throw new Error(r.error)
    const battle = r.game.state.activeBattle!
    expect(battle.summons.map((s) => s.name)).toEqual(['Doomed 0'])
    expect(battle.defenderIds).toContain(battle.summons[0].instanceId)
    // A battle summon never reaches the board (spec §4.4).
    expect(r.game.state.zones[0].cards.a.map((c) => c.name)).toEqual(['Doomed 1'])
    // The marker is permanent — it is not spent by being used.
    expect(r.game.state.zoneEffects).toHaveLength(1)
  })

  it('declining summons nothing', () => {
    const { game, mine, raider } = board({ hulls: 2 })
    const cast1 = cast(game, mine[0].instanceId)
    if (!cast1.ok) throw new Error(cast1.error)
    const locked = attacked(cast1.game, raider.instanceId, mine[1].instanceId)
    if (!locked.ok) throw new Error(locked.error)
    const r = applyAction(locked.game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', cancel: true }, threatCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.activeBattle!.summons).toEqual([])
  })

  it('offers nothing when its claimant is the AGGRESSOR in that zone', () => {
    const { game, mine, raider } = board({ hulls: 2 })
    const cast1 = cast(game, mine[0].instanceId)
    if (!cast1.ok) throw new Error(cast1.error)
    const r = applyAction(cast1.game, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
      attackerIds: [mine[1].instanceId], targetIds: [raider.instanceId],
    }, threatCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.pendingEffect).toBeNull()
  })

  // The end-to-end case above passes for TWO reasons, and a mutation proved
  // it: with the isDefender guard deleted, the has-a-fleet guard still refuses
  // (an aggressor's own hulls are never in defenderIds), so that test alone
  // cannot tell the two apart. This one isolates the card's own stated
  // condition — "a DEFENSIVE fleet battle" — by hand-building the one state
  // where has-a-fleet would say yes and only isDefender says no.
  it('offers nothing on an offensive battle even when the fleet check would pass', () => {
    const { game, mine } = board({ hulls: 2 })
    const cast1 = cast(game, mine[0].instanceId)
    if (!cast1.ok) throw new Error(cast1.error)
    const g = cast1.game
    g.state.activeBattle = {
      zoneId: 1, aggressor: 'a',
      attackerIds: [], defenderIds: [mine[1].instanceId], // alice's own hull, listed as a defender
      distanceM: 1200, distanceModifiedBy: [], summons: [], continuation: null,
    }
    const ok = effectFor('recurringThreatEffect')!({
      game: g, actor: 'a', card: inst({ ...threatSnap }), ctx: threatCtx(),
      battle: {
        phase: 'lock', zoneId: 1, isDefender: false, isParticipant: false,
        forced: false, survived: false, won: false, casualties: [],
      },
    })
    expect(ok).toBe(true)
    expect(g.state.pendingEffect).toBeNull()
  })

  // "…to fight ALONGSIDE YOUR FLEET in battle" needs a fleet. DWG Waters'
  // clause 3 declares a battle whose only defender is a summoned guardian, and
  // one zone can hold both markers (spec §7.3).
  it('offers nothing when the defending side has no board hull in the battle', () => {
    const { game, mine, raider } = board()
    const cast1 = cast(game, mine[0].instanceId)
    if (!cast1.ok) throw new Error(cast1.error)
    // alice's only zone-1 hull was the one she destroyed; her sole defender is
    // a summon, exactly as a DWG Waters guardian would be.
    const guardian = zoneEntry({ name: 'Guardian' })
    const declared = declareForcedBattle(cast1.game, threatCtx(), {
      zoneId: 1, aggressor: 'b', attackerIds: [raider.instanceId],
      defenderIds: [guardian.instanceId], summons: [guardian], cause: 'Test',
    })
    expect(declared).toBe(true)
    expect(cast1.game.state.pendingEffect).toBeNull()
    expect(cast1.game.state.activeBattle!.summons.map((s) => s.name)).toEqual(['Guardian'])
  })

  // A defensive guard, pinned directly for the reason Ongoing Attrition's is:
  // riders fire at 'lock' and 'baseAttack' only, so no end-to-end path can
  // reach a resolve context, and a mutation of the phase check survives every
  // test above. If a later wave adds a resolve-phase rider pass, a battle must
  // not be able to gain a summon after it has already been fought.
  it('ignores a resolve-phase context', () => {
    const { game, mine, raider } = board({ hulls: 2 })
    const cast1 = cast(game, mine[0].instanceId)
    if (!cast1.ok) throw new Error(cast1.error)
    const locked = attacked(cast1.game, raider.instanceId, mine[1].instanceId)
    if (!locked.ok) throw new Error(locked.error)
    const answered = applyAction(locked.game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', cancel: true }, threatCtx())
    if (!answered.ok) throw new Error(answered.error)
    const ok = effectFor('recurringThreatEffect')!({
      game: answered.game, actor: 'a', card: inst({ ...threatSnap }), ctx: threatCtx(),
      battle: {
        phase: 'resolve', zoneId: 1, isDefender: true, isParticipant: true,
        forced: false, survived: true, won: false, casualties: [],
      },
    })
    expect(ok).toBe(true)
    expect(answered.game.state.pendingEffect).toBeNull()
    expect(answered.game.state.activeBattle!.summons).toEqual([])
  })

  // The lock pass dispatches riders on BOTH sides of a battle (spec §4.3, DP2
  // departure 8), so an enemy marker on the same zone is dispatched in the
  // same loop. Each must see only its own side's remembered hulls.
  it('never offers the ENEMY’s remembered hull, even on the same zone', () => {
    const { game, mine, raider } = board({ hulls: 2 })
    game.state.zoneEffects.push({
      effect: 'recurringThreatEffect', zoneId: 1, side: 'b', cardName: 'Recurring Threat',
      setOnTurn: 2, data: { summon: { ...snap({ name: 'Their Ghost' }) } },
    })
    const cast1 = cast(game, mine[0].instanceId)
    if (!cast1.ok) throw new Error(cast1.error)
    const locked = attacked(cast1.game, raider.instanceId, mine[1].instanceId)
    if (!locked.ok) throw new Error(locked.error)
    expect(locked.game.state.pendingEffect?.side).toBe('a')
    expect(locked.game.state.pendingEffect?.options.map((o) => o.label)).toEqual(['Doomed 0'])
  })

  it('offers only the hulls remembered in THIS zone', () => {
    const { game, mine, raider } = board({ hulls: 2 })
    // A second marker in zone 2, from a hull that was standing there.
    game.state.zones[1].cards.a.push(zoneEntry({
      name: 'Elsewhere', faction: 'DWG', vehicleType: 'ship', materialCost: 70_000, playedOnTurn: 2,
    }))
    const far = cast(game, game.state.zones[1].cards.a[0].instanceId)
    if (!far.ok) throw new Error(far.error)
    const near = cast(far.game, mine[0].instanceId)
    if (!near.ok) throw new Error(near.error)
    expect(near.game.state.zoneEffects).toHaveLength(2)
    const locked = attacked(near.game, raider.instanceId, mine[1].instanceId)
    if (!locked.ok) throw new Error(locked.error)
    expect(locked.game.state.pendingEffect?.options.map((o) => o.label)).toEqual(['Doomed 0'])
  })

  it('two markers on one zone both fire, and the second offer is dropped rather than lost', () => {
    const { game, mine, raider } = board({ hulls: 3 })
    const first = cast(game, mine[0].instanceId)
    if (!first.ok) throw new Error(first.error)
    const second = cast(first.game, mine[1].instanceId)
    if (!second.ok) throw new Error(second.error)
    expect(second.game.state.zoneEffects).toHaveLength(2)
    const locked = attacked(second.game, raider.instanceId, mine[2].instanceId)
    if (!locked.ok) throw new Error(locked.error)
    expect(locked.game.state.pendingEffect).not.toBeNull()
    expect(locked.game.state.log.some((l) => l.includes('Recurring Threat') && l.includes('not made'))).toBe(true)
  })

  it('the summoned copy evaporates on approval, leaving nothing in the discard', () => {
    const { game, mine, raider } = board({ hulls: 2 })
    const cast1 = cast(game, mine[0].instanceId)
    if (!cast1.ok) throw new Error(cast1.error)
    const locked = attacked(cast1.game, raider.instanceId, mine[1].instanceId)
    if (!locked.ok) throw new Error(locked.error)
    const joined = applyAction(locked.game, 'alice', {
      type: 'RESOLVE_PENDING_EFFECT', choiceId: locked.game.state.pendingEffect!.options[0].id,
    }, threatCtx())
    if (!joined.ok) throw new Error(joined.error)
    const summonId = joined.game.state.activeBattle!.summons[0].instanceId
    const discardBefore = joined.game.state.destroyed.a.length
    const submitted = applyAction(joined.game, 'bob', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [raider.instanceId]: 100, [mine[1].instanceId]: 100, [summonId]: 0 },
      repairs: [],
    }, threatCtx())
    if (!submitted.ok) throw new Error(submitted.error)
    const decided = applyAction(submitted.game, 'alice', { type: 'DECIDE_BATTLE_REPORT', approve: true }, threatCtx())
    if (!decided.ok) throw new Error(decided.error)
    expect(decided.game.state.destroyed.a).toHaveLength(discardBefore)
    expect(decided.game.state.zones[0].cards.a.map((c) => c.name)).toEqual(['Doomed 1'])
    expect(decided.game.state.log.some((l) => l.includes('summoned vehicle(s) evaporated'))).toBe(true)
  })

  // The engine's catalog is is_built_in only, so a name-based lookup would
  // fail for exactly the hulls a player is likeliest to have designed.
  it('remembers a PLAYER-MADE vehicle the catalog could never supply', () => {
    const { game, mine, raider } = board({ hulls: 2, builtIn: false })
    const cast1 = cast(game, mine[0].instanceId)
    if (!cast1.ok) throw new Error(cast1.error)
    const locked = attacked(cast1.game, raider.instanceId, mine[1].instanceId)
    if (!locked.ok) throw new Error(locked.error)
    const r = applyAction(locked.game, 'alice', {
      type: 'RESOLVE_PENDING_EFFECT', choiceId: locked.game.state.pendingEffect!.options[0].id,
    }, threatCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.activeBattle!.summons.map((s) => s.name)).toEqual(['Doomed 0'])
    expect(r.game.state.activeBattle!.summons[0].isBuiltIn).toBe(false)
  })
})

describe('wave 5 — Sabotage', () => {
  const sabotageSnap = snap({
    name: 'Sabotage', faction: 'OW', type: 'ability', vehicleType: null,
    materialCost: 30_000, cardText: 'Target a vehicle and give it FRAGILE…',
    meta: { playOnVehicleEffect: 'sabotageEffect' },
  })
  const sabCtx = () => makeCtx({ catalog: [sabotageSnap] })

  function armed(over: { targetKeywords?: string[]; friendly?: boolean } = {}) {
    const game = makeGame({ turnNumber: 3, activePlayer: 'alice' })
    game.privates.a.deck = [inst({ name: 'Reward' }), inst({ name: 'Spare' })]
    game.state.counts.a.deck = 2
    const card = inst({ ...sabotageSnap })
    game.privates.a.hand.push(card)
    game.state.counts.a.hand = 1
    const target = zoneEntry({
      name: 'Victim', vehicleType: 'ship', materialCost: 60_000,
      keywords: over.targetKeywords ?? [], playedOnTurn: 2,
    })
    game.state.zones[0].cards[over.friendly ? 'a' : 'b'].push(target)
    return { game, card, target }
  }

  const play = (game: EngineGame, ids: { card: string; target: string }) =>
    applyAction(game, 'alice', {
      type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD', instanceId: ids.card, targetInstanceId: ids.target,
    }, sabCtx())

  it('gives the target FRAGILE and schedules a watch on it', () => {
    const { game, card, target } = armed()
    const r = play(game, { card: card.instanceId, target: target.instanceId })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.b[0].keywords).toEqual(['fragile'])
    expect(r.game.state.scheduled).toEqual([
      { type: 'sabotageWatch', side: 'a', dueTurn: 3, instanceId: target.instanceId },
    ])
  })

  it('does not duplicate FRAGILE on a hull that already has it', () => {
    const { game, card, target } = armed({ targetKeywords: ['fragile', 'scrappy'] })
    const r = play(game, { card: card.instanceId, target: target.instanceId })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.b[0].keywords).toEqual(['fragile', 'scrappy'])
  })

  it('may target a friendly vehicle — the card says only “a vehicle”', () => {
    const { game, card, target } = armed({ friendly: true })
    const r = play(game, { card: card.instanceId, target: target.instanceId })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a[0].keywords).toEqual(['fragile'])
  })

  it('draws exactly one card at its owner’s END_TURN when the hull is still there', () => {
    const { game, card, target } = armed()
    const r = play(game, { card: card.instanceId, target: target.instanceId })
    if (!r.ok) throw new Error(r.error)
    const ended = applyAction(r.game, 'alice', { type: 'END_TURN' }, sabCtx())
    if (!ended.ok) throw new Error(ended.error)
    expect(ended.game.privates.a.hand.map((c) => c.name)).toEqual(['Reward'])
    expect(ended.game.state.scheduled).toEqual([])
  })

  it('draws nothing when the hull left the board first, and still drops the watch', () => {
    const { game, card, target } = armed()
    const r = play(game, { card: card.instanceId, target: target.instanceId })
    if (!r.ok) throw new Error(r.error)
    r.game.state.zones[0].cards.b = [] // destroyed in a battle meanwhile
    const ended = applyAction(r.game, 'alice', { type: 'END_TURN' }, sabCtx())
    if (!ended.ok) throw new Error(ended.error)
    expect(ended.game.privates.a.hand).toHaveLength(0)
    expect(ended.game.state.scheduled).toEqual([])
  })

  // The turn-end pass runs BEFORE the flip, and the Temporary cull runs after
  // it: a Temporary hull is culled at the NEXT turn's start, so it did survive
  // this one (spec §4.3, "DP5 as wave 5 built it").
  it('counts a Temporary hull as having survived the turn', () => {
    const { game, card, target } = armed({ targetKeywords: ['temporary'] })
    const r = play(game, { card: card.instanceId, target: target.instanceId })
    if (!r.ok) throw new Error(r.error)
    const ended = applyAction(r.game, 'alice', { type: 'END_TURN' }, sabCtx())
    if (!ended.ok) throw new Error(ended.error)
    expect(ended.game.privates.a.hand.map((c) => c.name)).toEqual(['Reward'])
    expect(ended.game.state.zones[0].cards.b).toEqual([]) // culled at the new turn's start
  })

  // The card's whole point: Fragile can never be repaired, so a sabotaged hull
  // in the 80-89.999% band dies where it would otherwise have been patched.
  // Asserted end to end rather than by reading autoRepairIds.
  it('makes a Scrappy hull in the repair band die instead of auto-repairing', () => {
    const { game, card, target } = armed({ targetKeywords: ['scrappy'] })
    const attacker = zoneEntry({ name: 'Raider', playedOnTurn: 2 })
    game.state.zones[0].cards.a.push(attacker)
    const r = play(game, { card: card.instanceId, target: target.instanceId })
    if (!r.ok) throw new Error(r.error)
    const locked = applyAction(r.game, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
      attackerIds: [attacker.instanceId], targetIds: [target.instanceId],
    }, sabCtx())
    if (!locked.ok) throw new Error(locked.error)
    const submitted = applyAction(locked.game, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [attacker.instanceId]: 100, [target.instanceId]: 85 }, repairs: [],
    }, sabCtx())
    if (!submitted.ok) throw new Error(submitted.error)
    const decided = applyAction(submitted.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true }, sabCtx())
    if (!decided.ok) throw new Error(decided.error)
    expect(decided.game.state.zones[0].cards.b).toEqual([])
    expect(decided.game.state.destroyed.b.map((c) => c.name)).toEqual(['Victim'])
    // …and so the watch pays nothing.
    const ended = applyAction(decided.game, 'alice', { type: 'END_TURN' }, sabCtx())
    if (!ended.ok) throw new Error(ended.error)
    expect(ended.game.privates.a.hand).toHaveLength(0)
  })
})

// ===========================================================================
// Wave 6 — the twelve cards of the 2026-08-30 balance pass.
//
// Driven through applyAction wherever a handler is part of what is being
// proved. A direct effectFor() call would pass even if the seeded meta key or
// the handler wiring were wrong.
// ===========================================================================

describe('wave 6 — SS Nothung', () => {
  const sacrilegoSnap = snap({
    name: 'Sacrilego', faction: 'SS', vehicleType: 'ship', materialCost: 80_000,
    keywords: ['scrappy', 'stealthy', 'mobile'],
    meta: { onBattleEffect: 'sacrilegoBattle' },
  })
  const nothung = () => inst({
    name: 'Nothung', faction: 'SS', vehicleType: 'ship', materialCost: 0,
    keywords: ['blocker'], meta: { onPlayEffect: 'nothungOnPlay' },
  })
  const nothungCtx = () => makeCtx({ catalog: [sacrilegoSnap] })

  function play(zoneId: number) {
    const card = nothung()
    const game = makeGame({ privates: { a: { hand: [card], deck: [] }, b: { hand: [], deck: [] } } })
    const r = applyAction(
      game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId }, nothungCtx(),
    )
    if (!r.ok) throw new Error(r.error)
    return r.game
  }

  it('puts a friendly Sacrilego into the zone Nothung was played into', () => {
    const game = play(1)
    expect(game.state.zones[0].cards.a.map((c) => c.name)).toEqual(['Nothung', 'Sacrilego'])
    // …and nowhere else, on neither side.
    expect(game.state.zones[1].cards.a).toEqual([])
    expect(game.state.zones[0].cards.b).toEqual([])
  })

  it('follows Nothung into whichever zone it was played into', () => {
    const game = play(2)
    expect(game.state.zones[1].cards.a.map((c) => c.name)).toEqual(['Nothung', 'Sacrilego'])
    expect(game.state.zones[0].cards.a).toEqual([])
  })

  // Ruling A-1 (spec §7.3, wave 6). Spawning is not playing skips
  // onPlayEffect and NOTHING else, so the spawned hull's own battle trigger
  // survives — which is why the card names Sacrilego rather than a vanilla
  // hull. Asserted rather than assumed: the alternative is discovering it in
  // a battle report.
  it('the spawned Sacrilego keeps its printed battle trigger', () => {
    const spawned = play(1).state.zones[0].cards.a.find((c) => c.name === 'Sacrilego')!
    expect(spawned.meta.onBattleEffect).toBe('sacrilegoBattle')
    expect(spawned.keywords).toEqual(['scrappy', 'stealthy', 'mobile'])
  })

  it('fails the play when the catalog has no Sacrilego — a data bug, not an empty pool', () => {
    const card = nothung()
    const game = makeGame({ privates: { a: { hand: [card], deck: [] }, b: { hand: [], deck: [] } } })
    const r = applyAction(
      game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx(),
    )
    expect(r.ok).toBe(false)
  })
})

// The wave-6 half of the needsCatalog check (handoff trap 4). Same reasoning
// as the rider block above: makeCtx hands every test a catalog, so a missing
// flag is invisible to unit tests and shows up only as a dead card in
// production. Asserted at runtime rather than by reading the source.
describe('wave 6 — effects that must carry needsCatalog', () => {
  it.each(['nothungOnPlay', 'balmungOnPlay', 'harbringerBattle', 'victoriaActivate'])(
    '%s', (name) => { expect(CATALOG_EFFECTS.has(name)).toBe(true) },
  )
})

describe('wave 6 — SS Balmung', () => {
  const hydraSnap = snap({
    name: 'Hydra', faction: 'SS', vehicleType: 'airship', materialCost: 230_000,
    blueprintCost: 231_000, keywords: ['mobile'], meta: {},
  })
  const balmung = () => inst({
    name: 'Balmung', faction: 'SS', vehicleType: 'ship', materialCost: 0,
    keywords: ['blocker'], meta: { onPlayEffect: 'balmungOnPlay' },
  })
  const balmungCtx = () => makeCtx({ catalog: [hydraSnap] })

  function play() {
    const card = balmung()
    const game = makeGame({ privates: { a: { hand: [card], deck: [] }, b: { hand: [], deck: [] } } })
    const r = applyAction(
      game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, balmungCtx(),
    )
    if (!r.ok) throw new Error(r.error)
    return r.game
  }

  it('mints exactly one Hydra into the actor own hand and nowhere else', () => {
    const game = play()
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['Hydra'])
    expect(game.privates.b.hand).toEqual([])
    // A card in hand, never a hull on the board — the text says "in hand".
    expect(game.state.zones[0].cards.a.map((c) => c.name)).toEqual(['Balmung'])
  })

  // Ruling A-2 (spec §7.3, wave 6). "Reduce its COST to zero" is a price, not
  // a rewrite. A minted materialCost: 0 would silently make the Hydra
  // harmless as well as free — this is the assertion that catches it.
  it('reduces the price with costDelta and leaves the printed materialCost alone', () => {
    const hydra = play().privates.a.hand[0]
    expect(hydra.meta.costDelta).toBe(-230_000)
    expect(hydra.materialCost).toBe(230_000)
  })

  it('costs nothing to play but still does its printed damage and repair', () => {
    const game = play()
    const hydra = game.privates.a.hand[0]
    expect(effectiveCostInGame(game.state, 'a', hydra)).toBe(0)
    // The figure base damage, repairs and in-battle resources all read.
    expect(effectiveMaterialCostOf(hydra)).toBe(230_000)
  })

  it('resyncs the public hand count, which a direct push does not do for you', () => {
    const game = play()
    expect(game.state.counts.a.hand).toBe(game.privates.a.hand.length)
    expect(game.state.counts.a.hand).toBe(1)
  })

  // Ruling A-3. state.log is public and the Hydra is going into a hidden
  // hand. Balmung's own text already reveals it, so this leaks nothing — but
  // the rule is absolute and drawFromPool sets the precedent.
  it('never names the minted card in the public log', () => {
    expect(play().state.log.join('\n')).not.toContain('Hydra')
  })

  it('fails the play when the catalog has no Hydra — a data bug, not an empty pool', () => {
    const card = balmung()
    const game = makeGame({ privates: { a: { hand: [card], deck: [] }, b: { hand: [], deck: [] } } })
    const r = applyAction(
      game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, makeCtx(),
    )
    expect(r.ok).toBe(false)
  })

  // summonOnly cards are spawned, never drafted (docs/claude/architecture.md).
  // This effect filters ctx.catalog by name directly rather than going through
  // drawFromPool, so it does not get that guard for free — reservesEffect
  // missed exactly this and could mint a Flying Squirrel into a hand.
  it('refuses to mint a summonOnly card even if one is named Hydra', () => {
    const card = balmung()
    const game = makeGame({ privates: { a: { hand: [card], deck: [] }, b: { hand: [], deck: [] } } })
    const r = applyAction(
      game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 },
      makeCtx({ catalog: [snap({ ...hydraSnap, meta: { summonOnly: true } })] }),
    )
    expect(r.ok).toBe(false)
  })
})

describe('wave 6 — WF Harbringer', () => {
  const wfShip = (name: string, materialCost: number) =>
    snap({ name, faction: 'WF', type: 'vehicle', vehicleType: 'ship', materialCost })
  // Boundary cards on purpose: the card says "<=100k", and The Repentance is a
  // real WF PLANE at exactly 100k, so the type filter is load-bearing rather
  // than decorative.
  const pool = [
    wfShip('Buzzsaw', 80_000),
    wfShip('Earth Raker', 50_000),
    wfShip('On The Line', 100_000),
    wfShip('Over The Line', 100_001),
    snap({ name: 'The Repentance', faction: 'WF', type: 'vehicle', vehicleType: 'plane', materialCost: 100_000 }),
    snap({ name: 'Sacrilego', faction: 'SS', type: 'vehicle', vehicleType: 'ship', materialCost: 80_000 }),
    snap({
      name: 'Summon Only', faction: 'WF', type: 'vehicle', vehicleType: 'ship',
      materialCost: 10_000, meta: { summonOnly: true },
    }),
  ]
  const harbCtx = () => makeCtx({ catalog: pool })
  const lockCtx = (over: Partial<BattleContext> = {}): BattleContext => ({
    phase: 'lock', zoneId: 1, isDefender: false, isParticipant: true,
    forced: false, survived: false, won: false, casualties: [], ...over,
  })
  const fire = (game: EngineGame, battle: BattleContext) => effectFor('harbringerBattle')!({
    game, actor: 'a', card: inst({ name: 'Harbringer', faction: 'WF' }), ctx: harbCtx(), battle,
  })

  // Ruling A-6. The pool is WF SHIPS at <= 100k, inclusive, on printed cost.
  it('offers exactly the WF ships at or under 100k, and nothing else', () => {
    const game = makeGame()
    expect(fire(game, lockCtx())).toBe(true)
    expect(game.state.pendingEffect?.options.map((o) => o.id).sort()).toEqual(
      ['Buzzsaw', 'Earth Raker', 'On The Line'],
    )
  })

  // Ruling A-4 (spec §7.3, wave 6). "Whenever this ship is in fleet combat"
  // reads to both directions — so BOTH of these must offer, and neither may
  // be guarded away by an isDefender check.
  it.each([false, true])('offers whether it is attacking or defending (isDefender=%s)', (isDefender) => {
    const game = makeGame()
    expect(fire(game, lockCtx({ isDefender }))).toBe(true)
    expect(game.state.pendingEffect).not.toBeNull()
  })

  it('offers nothing at resolve — the guest joins a fight, it does not arrive after one', () => {
    const game = makeGame()
    expect(fire(game, lockCtx({ phase: 'resolve' }))).toBe(true)
    expect(game.state.pendingEffect).toBeNull()
  })

  it('offers nothing to a non-participant', () => {
    const game = makeGame()
    expect(fire(game, lockCtx({ isParticipant: false }))).toBe(true)
    expect(game.state.pendingEffect).toBeNull()
  })

  it('joins the chosen hull to the battle as a summon on Harbringer own side', () => {
    const game = makeGame({ turnNumber: 3 })
    const harbringer = zoneEntry({
      name: 'Harbringer', faction: 'WF', vehicleType: 'ship', playedOnTurn: 2,
      meta: { onBattleEffect: 'harbringerBattle' },
    })
    const victim = zoneEntry({ name: 'Victim' })
    game.state.zones[0].cards.a.push(harbringer)
    game.state.zones[0].cards.b.push(victim)
    const declared = applyAction(game, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
      attackerIds: [harbringer.instanceId], targetIds: [victim.instanceId],
    }, harbCtx())
    if (!declared.ok) throw new Error(declared.error)
    expect(declared.game.state.pendingEffect?.side).toBe('a')
    const r = applyAction(
      declared.game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'Buzzsaw' }, harbCtx(),
    )
    if (!r.ok) throw new Error(r.error)
    const battle = r.game.state.activeBattle!
    expect(battle.summons.map((s) => s.name)).toEqual(['Buzzsaw'])
    // A summon's SIDE is decided by which id list it is in (spec §4.4).
    expect(battle.attackerIds).toContain(battle.summons[0].instanceId)
    expect(battle.defenderIds).not.toContain(battle.summons[0].instanceId)
    // Never pushed onto the board — it evaporates with the battle.
    expect(r.game.state.zones[0].cards.a.map((c) => c.name)).toEqual(['Harbringer'])
  })

  it('declining leaves the battle exactly as it was', () => {
    const game = makeGame({ turnNumber: 3 })
    const harbringer = zoneEntry({
      name: 'Harbringer', faction: 'WF', vehicleType: 'ship', playedOnTurn: 2,
      meta: { onBattleEffect: 'harbringerBattle' },
    })
    const victim = zoneEntry({ name: 'Victim' })
    game.state.zones[0].cards.a.push(harbringer)
    game.state.zones[0].cards.b.push(victim)
    const declared = applyAction(game, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
      attackerIds: [harbringer.instanceId], targetIds: [victim.instanceId],
    }, harbCtx())
    if (!declared.ok) throw new Error(declared.error)
    const r = applyAction(
      declared.game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', cancel: true }, harbCtx(),
    )
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.activeBattle!.summons).toEqual([])
    expect(r.game.state.activeBattle!.attackerIds).toEqual([harbringer.instanceId])
  })

  it('resolves without an offer when the pool is empty', () => {
    const game = makeGame()
    expect(fire(game, lockCtx())).toBe(true)
    const empty = makeGame()
    const ok = effectFor('harbringerBattle')!({
      game: empty, actor: 'a', card: inst({ name: 'Harbringer' }),
      ctx: makeCtx({ catalog: [] }), battle: lockCtx(),
    })
    expect(ok).toBe(true)
    expect(empty.state.pendingEffect).toBeNull()
  })
})

describe('wave 6 — WF Judgement', () => {
  const judgementCard = () => inst({
    name: 'Judgement', faction: 'WF', vehicleType: 'ship', materialCost: 540_000,
    meta: { costModifier: 'judgementCostModifier', onActivate: 'judgementActivate', activateCpCost: 1 },
  })

  // Ruling B-1 (spec §7.3, wave 6). "While your opponent HAS a submarine or
  // airship" names no zone; the card's own second sentence says "in this
  // zone" explicitly. The contrast inside one card is the evidence.
  describe('judgementCostModifier — the whole enemy board', () => {
    const priced = (place?: (g: EngineGame) => void) => {
      const game = makeGame()
      place?.(game)
      return effectiveCostInGame(game.state, 'a', judgementCard())
    }

    it('costs full price when the enemy has neither', () => {
      expect(priced()).toBe(540_000)
      expect(priced((g) => { g.state.zones[0].cards.b.push(zoneEntry({ vehicleType: 'ship' })) })).toBe(540_000)
      expect(priced((g) => { g.state.zones[0].cards.b.push(zoneEntry({ vehicleType: 'tank' })) })).toBe(540_000)
    })

    it.each(['sub', 'airship'])('costs 100k less against an enemy %s', (vehicleType) => {
      expect(priced((g) => { g.state.zones[0].cards.b.push(zoneEntry({ vehicleType })) })).toBe(440_000)
    })

    // The zone Judgement itself would land in is irrelevant — this is the
    // assertion that pins the ruling rather than an accident of fixtures.
    it('reads every zone, not just one', () => {
      expect(priced((g) => { g.state.zones[2].cards.b.push(zoneEntry({ vehicleType: 'airship' })) })).toBe(440_000)
    })

    it('ignores the actor own subs and airships', () => {
      expect(priced((g) => {
        g.state.zones[0].cards.a.push(zoneEntry({ vehicleType: 'sub' }))
        g.state.zones[1].cards.a.push(zoneEntry({ vehicleType: 'airship' }))
      })).toBe(540_000)
    })

    it('does not stack — the text is a flat discount, not a per-hull one', () => {
      expect(priced((g) => {
        g.state.zones[0].cards.b.push(zoneEntry({ vehicleType: 'sub' }))
        g.state.zones[0].cards.b.push(zoneEntry({ vehicleType: 'airship' }))
        g.state.zones[1].cards.b.push(zoneEntry({ vehicleType: 'sub' }))
      })).toBe(440_000)
    })

    it('prices for side b symmetrically, reading side a as the enemy', () => {
      const game = makeGame()
      game.state.zones[0].cards.a.push(zoneEntry({ vehicleType: 'sub' }))
      expect(effectiveCostInGame(game.state, 'b', judgementCard())).toBe(440_000)
      expect(effectiveCostInGame(game.state, 'a', judgementCard())).toBe(540_000)
    })
  })

  describe('judgementActivate — a 1v1 against a sub or airship in this zone', () => {
    function armed(place?: (g: EngineGame) => void) {
      const game = makeGame({ turnNumber: 3 })
      const judgement = zoneEntry({
        name: 'Judgement', faction: 'WF', vehicleType: 'ship', playedOnTurn: 2,
        meta: { onActivate: 'judgementActivate', activateCpCost: 1 },
      })
      game.state.zones[0].cards.a.push(judgement)
      place?.(game)
      return { game, judgement }
    }
    const activate = (game: EngineGame, instanceId: string) =>
      applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId }, makeCtx())

    it('offers only enemy subs and airships in its own zone', () => {
      const { game, judgement } = armed((g) => {
        g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'sub-here', name: 'Diver', vehicleType: 'sub' }))
        g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'air-here', name: 'Blimp', vehicleType: 'airship' }))
        g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'ship-here', name: 'Hull', vehicleType: 'ship' }))
        g.state.zones[1].cards.b.push(zoneEntry({ instanceId: 'sub-away', name: 'Far', vehicleType: 'sub' }))
        g.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'own-sub', name: 'Mine', vehicleType: 'sub' }))
      })
      const r = activate(game, judgement.instanceId)
      if (!r.ok) throw new Error(r.error)
      expect(r.game.state.pendingEffect?.options.map((o) => o.id).sort()).toEqual(['air-here', 'sub-here'])
    })

    it('declares a 1v1 forced battle against the chosen hull', () => {
      const { game, judgement } = armed((g) => {
        g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'sub-here', name: 'Diver', vehicleType: 'sub' }))
        g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'air-here', name: 'Blimp', vehicleType: 'airship' }))
      })
      const offered = activate(game, judgement.instanceId)
      if (!offered.ok) throw new Error(offered.error)
      const r = applyAction(
        offered.game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'air-here' }, makeCtx(),
      )
      if (!r.ok) throw new Error(r.error)
      const battle = r.game.state.activeBattle!
      expect(battle.aggressor).toBe('a')
      expect(battle.attackerIds).toEqual([judgement.instanceId])
      expect(battle.defenderIds).toEqual(['air-here'])
      // A forced battle is not a zone activation (spec §4.3) — Eclipse alone
      // is the exception and says so in its own text.
      expect(r.game.state.zones[0].lastActivatedTurn).toBeNull()
    })

    it('charges the printed 1cp and stamps once-per-turn', () => {
      const { game, judgement } = armed((g) => {
        g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'sub-here', name: 'Diver', vehicleType: 'sub' }))
      })
      const before = game.state.resources.a.cp
      const r = activate(game, judgement.instanceId)
      if (!r.ok) throw new Error(r.error)
      expect(r.game.state.resources.a.cp).toBe(before - 1)
      const again = activate(r.game, judgement.instanceId)
      expect(again.ok).toBe(false)
    })

    it('fails when the zone holds no eligible target', () => {
      const { game, judgement } = armed((g) => {
        g.state.zones[0].cards.b.push(zoneEntry({ name: 'Hull', vehicleType: 'ship' }))
      })
      expect(activate(game, judgement.instanceId).ok).toBe(false)
    })
  })
})

describe('wave 6 — SS Victoria', () => {
  const victoriaSnap = snap({
    name: 'Victoria', faction: 'SS', vehicleType: 'ship', materialCost: 250_000,
    keywords: [], meta: { onActivate: 'victoriaActivate', activateMaterialCost: 200_000 },
  })
  const vicCtx = () => makeCtx({ catalog: [victoriaSnap] })

  function armed(zoneIndex = 0) {
    const game = makeGame({ turnNumber: 3 })
    game.state.resources.a.materials = 500_000
    const victoria = zoneEntry({
      instanceId: 'vic-1', name: 'Victoria', faction: 'SS', vehicleType: 'ship',
      materialCost: 250_000, playedOnTurn: 2,
      meta: { onActivate: 'victoriaActivate', activateMaterialCost: 200_000 },
    })
    game.state.zones[zoneIndex].cards.a.push(victoria)
    return { game, victoria }
  }

  it('spawns a second Victoria into its own zone and charges 200k', () => {
    const { game, victoria } = armed()
    const r = applyAction(
      game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: victoria.instanceId }, vicCtx(),
    )
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a.map((c) => c.name)).toEqual(['Victoria', 'Victoria'])
    expect(r.game.state.resources.a.materials).toBe(300_000)
  })

  // Ruling B-5 (spec §7.3, wave 6). ACTIVATE_VEHICLE passes the
  // client-supplied action.zoneId straight through as targetZoneId, so an
  // effect that read it could be redirected by a stale or malicious client.
  // Braveheart is the precedent: re-derive the zone from the hull itself.
  it('ignores a client-supplied zoneId and uses the hull own zone', () => {
    const { game, victoria } = armed(1)
    const r = applyAction(
      game, 'alice',
      { type: 'ACTIVATE_VEHICLE', instanceId: victoria.instanceId, zoneId: 3 },
      vicCtx(),
    )
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[1].cards.a.map((c) => c.name)).toEqual(['Victoria', 'Victoria'])
    expect(r.game.state.zones[2].cards.a).toEqual([])
  })

  // Ruling B-4. Spawning is not playing, so the new hull carries its printed
  // meta — which means it can be activated in its own right. The chain is
  // per-hull, per-turn, and hard-bounded by materials; this asserts the
  // mechanism rather than assuming it.
  it('the spawned Victoria carries its own activated ability, unstamped', () => {
    const { game, victoria } = armed()
    const r = applyAction(
      game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: victoria.instanceId }, vicCtx(),
    )
    if (!r.ok) throw new Error(r.error)
    const spawned = r.game.state.zones[0].cards.a.find((c) => c.instanceId !== victoria.instanceId)!
    expect(spawned.meta).toMatchObject({
      onActivate: 'victoriaActivate', activateMaterialCost: 200_000,
    })
    expect(spawned).toHaveProperty('activatedOnTurn', null)
  })

  it('refuses when the actor cannot afford the 200k, spawning nothing', () => {
    const { game, victoria } = armed()
    game.state.resources.a.materials = 199_999
    const r = applyAction(
      game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: victoria.instanceId }, vicCtx(),
    )
    expect(r.ok).toBe(false)
    expect(game.state.zones[0].cards.a).toHaveLength(1)
  })

  it('cannot be activated twice in one turn', () => {
    const { game, victoria } = armed()
    const first = applyAction(
      game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: victoria.instanceId }, vicCtx(),
    )
    if (!first.ok) throw new Error(first.error)
    const second = applyAction(
      first.game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: victoria.instanceId }, vicCtx(),
    )
    expect(second).toMatchObject({ ok: false, status: 409 })
  })

  it('fails when the catalog has no Victoria — a data bug, not an empty pool', () => {
    const { game, victoria } = armed()
    const r = applyAction(
      game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId: victoria.instanceId }, makeCtx(),
    )
    expect(r.ok).toBe(false)
  })
})

// ===========================================================================
// Wave 6 — SS Blockade, and DP7 (spec §4.3, "DP7 as wave 6 built it").
//
// "Choose a zone, whenever the opponent plays a vehicle into that zone while
// you have at least one vehicle there, a fleet battle immediately begins in
// that zone. If you lose with no surviving vehicles, the blockade goes away,
// otherwise it remains."
//
// The only card in the backlog needing a new dispatch point: every existing
// rider dispatch hangs off a battle, a bombardment or the turn end. None
// fires on a play.
// ===========================================================================

describe('wave 6 — SS Blockade', () => {
  const blockadeSnap = snap({
    name: 'Blockade', faction: 'SS', type: 'ability', vehicleType: null,
    materialCost: 0, cardText: 'Choose a zone…', meta: { playOnZoneEffect: 'blockadeEffect' },
  })
  const watersSnap = snap({
    name: 'DWG Waters', faction: 'DWG', type: 'ability', vehicleType: null,
    materialCost: 0, meta: { playOnZoneEffect: 'dwgWatersEffect' },
  })
  const blockCtx = () => makeCtx({ catalog: [blockadeSnap, watersSnap] })
  const riders = (game: EngineGame) =>
    game.state.zoneEffects.filter((e) => e.effect === 'blockadeEffect')

  // Player b holds the blockade; player a (the active player) is the one who
  // will sail into it.
  function blockaded(place?: (g: EngineGame) => void) {
    const game = makeGame({ turnNumber: 3 })
    game.state.zoneEffects.push({
      effect: 'blockadeEffect', zoneId: 1, side: 'b', cardName: 'Blockade', setOnTurn: 2,
    })
    place?.(game)
    return game
  }
  function deploy(game: EngineGame, over: Record<string, unknown> = {}, zoneId = 1) {
    const card = inst({ name: 'Intruder', vehicleType: 'ship', materialCost: 0, ...over })
    game.privates.a.hand = [card]
    game.state.counts.a.hand = 1
    const r = applyAction(
      game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId }, blockCtx(),
    )
    if (!r.ok) throw new Error(r.error)
    return { game: r.game, card }
  }

  describe('the claim', () => {
    const claim = (game: EngineGame, zoneId = 1) => {
      const card = inst({ ...blockadeSnap })
      game.privates.a.hand = [card]
      game.state.counts.a.hand = 1
      return applyAction(
        game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId }, blockCtx(),
      )
    }

    it('writes one PERMANENT rider — the card says "otherwise it remains"', () => {
      const r = claim(makeGame({ turnNumber: 3 }))
      if (!r.ok) throw new Error(r.error)
      expect(riders(r.game)).toHaveLength(1)
      expect(riders(r.game)[0]).toMatchObject({ zoneId: 1, side: 'a', cardName: 'Blockade' })
      expect(riders(r.game)[0].expiresOnTurn).toBeUndefined()
    })

    // Ruling C-13, the ambushClaim precedent: refuse before the handler
    // commits, so the play is not spent on a no-op.
    it('refuses a second claim on a zone this side already holds', () => {
      const game = makeGame({ turnNumber: 3 })
      const first = claim(game)
      if (!first.ok) throw new Error(first.error)
      expect(claim(first.game).ok).toBe(false)
      expect(riders(first.game)).toHaveLength(1)
    })

    it('lets the OTHER side blockade the same zone', () => {
      const game = makeGame({ turnNumber: 3 })
      game.state.zoneEffects.push({
        effect: 'blockadeEffect', zoneId: 1, side: 'b', cardName: 'Blockade', setOnTurn: 2,
      })
      const r = claim(game)
      if (!r.ok) throw new Error(r.error)
      expect(riders(r.game).map((e) => e.side).sort()).toEqual(['a', 'b'])
    })
  })

  describe('the spring', () => {
    // Ruling C-8: the blockader is the aggressor. Every other forced battle in
    // the codebase names the effect's owner, and DWG Waters' clause 3 inverts
    // only because the enemy's own action was already an attack.
    it('declares with the BLOCKADER as aggressor, so the deployer defends on their own turn', () => {
      const game = blockaded((g) => {
        g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'guard', name: 'Guard' }))
      })
      const { game: after, card } = deploy(game)
      const battle = after.state.activeBattle!
      expect(battle.aggressor).toBe('b')
      expect(battle.attackerIds).toEqual(['guard'])
      expect(battle.defenderIds).toEqual([card.instanceId])
    })

    // Ruling C-9: a FLEET battle — everything eligible on both sides, not just
    // the hull that walked into it.
    it('drags in every hull on both sides, not only the one just played', () => {
      const game = blockaded((g) => {
        g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'g1', name: 'Guard 1' }))
        g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'g2', name: 'Guard 2' }))
        g.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'a1', name: 'Bystander' }))
      })
      const { game: after, card } = deploy(game)
      const battle = after.state.activeBattle!
      expect([...battle.attackerIds].sort()).toEqual(['g1', 'g2'])
      expect([...battle.defenderIds].sort()).toEqual([card.instanceId, 'a1'].sort())
    })

    // §7.3's Gang Up ruling: Inoffensive is precisely "cannot attack", and a
    // forced battle is not a licence to break it. It says nothing about being
    // attacked, so the defender's side keeps its Inoffensive hulls.
    it('excludes Inoffensive hulls from the aggressor side but not the defender side', () => {
      const game = blockaded((g) => {
        g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'guard', name: 'Guard' }))
        g.state.zones[0].cards.b.push(zoneEntry({
          instanceId: 'meek', name: 'Meek', keywords: ['inoffensive'],
        }))
        g.state.zones[0].cards.a.push(zoneEntry({
          instanceId: 'timid', name: 'Timid', keywords: ['inoffensive'],
        }))
      })
      const { game: after, card } = deploy(game)
      const battle = after.state.activeBattle!
      expect(battle.attackerIds).toEqual(['guard'])
      expect([...battle.defenderIds].sort()).toEqual([card.instanceId, 'timid'].sort())
    })

    it('declares nothing when every blockading hull is Inoffensive', () => {
      const game = blockaded((g) => {
        g.state.zones[0].cards.b.push(zoneEntry({ name: 'Meek', keywords: ['inoffensive'] }))
      })
      expect(deploy(game).game.state.activeBattle).toBeNull()
    })

    // Ruling C-11: the card removes the rider on a loss and on nothing else.
    it('declares nothing and KEEPS the rider when the blockader holds no hull there', () => {
      const after = deploy(blockaded()).game
      expect(after.state.activeBattle).toBeNull()
      expect(riders(after)).toHaveLength(1)
    })

    it('ignores a deploy by the blockader themselves', () => {
      const game = blockaded((g) => {
        g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'guard', name: 'Guard' }))
      })
      const card = inst({ name: 'Reinforcement', vehicleType: 'ship', materialCost: 0 })
      game.privates.b.hand = [card]
      game.state.counts.b.hand = 1
      game.activePlayer = 'bob'
      const r = applyAction(
        game, 'bob', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, blockCtx(),
      )
      if (!r.ok) throw new Error(r.error)
      expect(r.game.state.activeBattle).toBeNull()
    })

    it('ignores a deploy into a DIFFERENT zone', () => {
      const game = blockaded((g) => {
        g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'guard', name: 'Guard' }))
      })
      expect(deploy(game, {}, 2).game.state.activeBattle).toBeNull()
    })

    // The card says "plays a VEHICLE". An ability resolving on the zone is not
    // a deploy.
    it('ignores an ABILITY played to the zone', () => {
      const game = blockaded((g) => {
        g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'guard', name: 'Guard' }))
      })
      const ability = inst({ ...watersSnap })
      game.privates.a.hand = [ability]
      game.state.counts.a.hand = 1
      const r = applyAction(
        game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: ability.instanceId, zoneId: 1 }, blockCtx(),
      )
      if (!r.ok) throw new Error(r.error)
      expect(r.game.state.activeBattle).toBeNull()
    })

    // Ruling C-12. A forced battle is not a zone activation (spec §4.3);
    // Eclipse alone is the exception.
    it('does not spend the zone activation', () => {
      const game = blockaded((g) => {
        g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'guard', name: 'Guard' }))
      })
      expect(deploy(game).game.state.zones[0].lastActivatedTurn).toBeNull()
    })

    // Ruling C-13: one battle per PLAY, not one per hull. Three hulls arrive
    // inside a single deployVehicle call.
    it('declares exactly one battle for an additionalSpawns play', () => {
      const game = blockaded((g) => {
        g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'guard', name: 'Guard' }))
      })
      const { game: after } = deploy(game, { meta: { additionalSpawns: 2 } })
      expect(after.state.zones[0].cards.a).toHaveLength(3)
      expect(after.state.activeBattle!.defenderIds).toHaveLength(3)
    })

    // The SECOND seam. PLAY_CARD_TARGETING_CARD_IN_HAND deploys vehicles too
    // (DP6), and a dispatch added to only one handler is a card that works
    // until someone plays Excalibur.
    it('springs through PLAY_CARD_TARGETING_CARD_IN_HAND as well', () => {
      const game = blockaded((g) => {
        g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'guard', name: 'Guard' }))
      })
      const excalibur = inst({
        name: 'Excalibur', faction: 'SS', vehicleType: 'ship', materialCost: 0,
        meta: { playOnCardEffect: 'excaliburEffect' },
      })
      const target = inst({ name: 'AI Ship', vehicleType: 'ship', materialCost: 100_000, isBuiltIn: true })
      game.privates.a.hand = [excalibur, target]
      game.state.counts.a.hand = 2
      const r = applyAction(game, 'alice', {
        type: 'PLAY_CARD_TARGETING_CARD_IN_HAND',
        instanceId: excalibur.instanceId, targetInstanceId: target.instanceId, zoneId: 1,
      }, blockCtx())
      if (!r.ok) throw new Error(r.error)
      expect(r.game.state.activeBattle?.aggressor).toBe('b')
      expect(r.game.state.activeBattle?.defenderIds).toEqual([excalibur.instanceId])
    })
  })

  describe('isolation from every other rider', () => {
    // Ruling C-14, and the reason DP7 is opt-in rather than a broadcast:
    // dwgWatersEffect's router falls through to its CLAIM branch for any phase
    // it does not recognise, so an unfamiliar context would make it try to
    // claim a zone with no targetZoneId and log a failure on every enemy
    // deploy into a zone it holds.
    it('never hands a DWG Waters rider a deploy context', () => {
      const game = blockaded((g) => {
        g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'guard', name: 'Guard' }))
        g.state.zoneEffects.push({
          effect: 'dwgWatersEffect', zoneId: 1, side: 'b', cardName: 'DWG Waters', setOnTurn: 2,
        })
      })
      const after = deploy(game).game
      expect(after.state.log.join('\n')).not.toContain('zone effect could not resolve')
    })

    // declareForcedBattle ends in dispatchBattleLock, which iterates EVERY
    // rider on the zone — including the Blockade that just declared. Without a
    // phase guard it would recurse.
    it('does not re-declare when its own battle lock re-enters it', () => {
      const game = blockaded((g) => {
        g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'guard', name: 'Guard' }))
      })
      const after = deploy(game).game
      expect(after.state.activeBattle!.attackerIds).toEqual(['guard'])
      expect(riders(after)).toHaveLength(1)
    })

    // Ruling C-15: it reads no catalog itself, but fireRider mints its payload
    // card from one.
    it('carries needsCatalog', () => {
      expect(CATALOG_EFFECTS.has('blockadeEffect')).toBe(true)
    })
  })

  describe('the aftermath', () => {
    // Ruling C-10: read off the POST-RESOLUTION board, which §7.3's Trebuchet
    // ruling already blesses. It is the only route that works — the
    // continuation's own `won` means "the ENEMY has no survivors", the
    // opposite of what this clause asks.
    function fight(defenderHp: number, blockaderHp: number) {
      const game = blockaded((g) => {
        g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'guard', name: 'Guard' }))
        g.state.zoneEffects.push({
          effect: 'blockadeEffect', zoneId: 2, side: 'b', cardName: 'Blockade', setOnTurn: 2,
        })
      })
      const { game: declared, card } = deploy(game)
      const submitted = applyAction(declared, 'alice', {
        type: 'SUBMIT_BATTLE_REPORT',
        results: { guard: blockaderHp, [card.instanceId]: defenderHp }, repairs: [],
      }, blockCtx())
      if (!submitted.ok) throw new Error(submitted.error)
      const decided = applyAction(
        submitted.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true }, blockCtx(),
      )
      if (!decided.ok) throw new Error(decided.error)
      return decided.game
    }

    it('remains while the blockader still holds a hull in the zone', () => {
      const after = fight(0, 100)
      expect(after.state.zones[0].cards.b).toHaveLength(1)
      expect(riders(after).filter((e) => e.zoneId === 1)).toHaveLength(1)
    })

    it('goes away when the blockading fleet is wiped out', () => {
      const after = fight(100, 0)
      expect(after.state.zones[0].cards.b).toEqual([])
      expect(riders(after).filter((e) => e.zoneId === 1)).toEqual([])
    })

    it('removes only that side blockade on that zone, leaving others standing', () => {
      const after = fight(100, 0)
      expect(riders(after).map((e) => e.zoneId)).toEqual([2])
    })
  })
})
