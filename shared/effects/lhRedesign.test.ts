import { describe, expect, it } from 'vitest'
import {
  applyAction, CATALOG_EFFECTS, chargeOf, discardCard, discardSnapshotOf, findVehicle, fleetAttackRosters,
  holdsStillInFtd, isStunned,
} from '../engine/index.ts'
import type { EngineGame, GameAction, ZoneCardEntry } from '../engine/engineTypes.ts'
import { MAX_VEHICLES_PER_ZONE_SIDE } from '../gameSettings.ts'
import { inst, makeCtx, makeGame, snap, zoneEntry } from '../engine/testFixtures.ts'

// One block per 2026-09-21 LH effect. Each drives the registered effect
// through the real action (ACTIVATE_VEHICLE, PLAY_CARD_TO_ZONE, …) so the
// engine's charge gate, spend and prompt plumbing are exercised with it.

export const lhGame = () => {
  const game = makeGame({ turnNumber: 4, activePlayer: 'alice' })
  game.state.factions = { a: 'LH', b: 'SS' }
  game.privates.a.deck = [inst({ name: 'Spare' })]
  game.state.counts.a = { hand: 0, deck: 1 }
  return game
}
export const activate = (game: ReturnType<typeof makeGame>, instanceId: string) =>
  applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId } as GameAction, makeCtx())

describe('Byte — byteDraw', () => {
  const byte = (charge: number) => zoneEntry({
    instanceId: 'byte', name: 'Byte', faction: 'LH', keywords: ['mobile'],
    meta: { chargeMax: 1, onActivate: 'byteDraw', activateCpCost: 0, dischargeCost: 1 }, charge,
  })
  it('draws a card for one pip, and refuses at zero', () => {
    const empty = lhGame(); empty.state.zones[0].cards.a.push(byte(0))
    expect(activate(empty, 'byte')).toMatchObject({ ok: false, status: 400 })
    const full = lhGame(); full.state.zones[0].cards.a.push(byte(1))
    const res = activate(full, 'byte')
    if (!res.ok) throw new Error(res.error)
    expect(res.game.privates.a.hand.map((c) => c.name)).toEqual(['Spare'])
    expect(chargeOf(res.game.state.zones[0].cards.a[0] as ZoneCardEntry)).toBe(0)
  })
})

describe('Volta — voltaJumpStart', () => {
  const volta = () => inst({
    instanceId: 'volta', name: 'Volta', faction: 'LH', materialCost: 40000, keywords: ['fragile'],
    meta: { chargeMax: 1, onPlayEffect: 'voltaJumpStart' },
  })
  const play = (game: ReturnType<typeof makeGame>) =>
    applyAction(game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: 'volta', zoneId: 1 }, makeCtx())

  it('offers only LH hulls with room in its own lane, excluding itself, and the pick gains one pip', () => {
    const game = lhGame()
    game.privates.a.hand = [volta()]; game.state.counts.a = { hand: 1, deck: 1 }
    game.state.zones[0].cards.a.push(
      zoneEntry({ instanceId: 'room', faction: 'LH', meta: { chargeMax: 2 }, charge: 1 }),
      zoneEntry({ instanceId: 'full', faction: 'LH', meta: { chargeMax: 2 }, charge: 2 }),
      zoneEntry({ instanceId: 'dwg', faction: 'DWG', meta: { chargeMax: 2 } }),
    )
    game.state.zones[1].cards.a.push(zoneEntry({ instanceId: 'far', faction: 'LH', meta: { chargeMax: 2 } }))
    const res = play(game)
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.pendingEffect?.options.map((o) => o.id)).toEqual(['room'])
    const done = applyAction(res.game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'room' }, makeCtx())
    if (!done.ok) throw new Error(done.error)
    const room = done.game.state.zones[0].cards.a.find((c) => c.instanceId === 'room') as ZoneCardEntry
    expect(chargeOf(room)).toBe(2)
  })

  it('resolves with a note when nothing can take a charge', () => {
    const game = lhGame()
    game.privates.a.hand = [volta()]; game.state.counts.a = { hand: 1, deck: 1 }
    const res = play(game)
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.pendingEffect).toBeNull()
    expect(res.game.state.log).toContain('Volta: nothing in this zone can take a charge')
  })
})

describe('Umbra — umbraSalvo', () => {
  const umbra = (charge: number) => zoneEntry({
    instanceId: 'umbra', name: 'Umbra', faction: 'LH', vehicleType: 'sub', keywords: ['stealthy'],
    meta: { chargeMax: 2, onActivate: 'umbraSalvo', activateCpCost: 0, dischargeCost: 2 }, charge,
  })
  it('shells the base past a Blocker for 150, surfaces for the rest of the game, and the discard restores Stealthy', () => {
    const game = lhGame()
    game.state.zones[0].cards.a.push(umbra(2))
    game.state.zones[0].cards.b.push(zoneEntry({ keywords: ['blocker'] }))
    const res = activate(game, 'umbra')
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.zones[0].baseHp.b).toBe(850)
    const hull = res.game.state.zones[0].cards.a[0] as ZoneCardEntry
    expect(hull.keywords).not.toContain('stealthy')
    expect(chargeOf(hull)).toBe(0)
    expect(res.game.state.log).toContain('Umbra surfaces — it is no longer Stealthy')
    expect(discardSnapshotOf(hull).keywords).toContain('stealthy')
  })
  it('refuses at one pip', () => {
    const game = lhGame(); game.state.zones[0].cards.a.push(umbra(1))
    expect(activate(game, 'umbra')).toMatchObject({ ok: false, status: 400 })
  })
})

// 2026-09-22 hovercraft amendment: Umbra stays Stealthy after firing (R-8
// overturned). Dealt Umbras keep umbraSalvo, and the block above pins that
// they still surface.
describe('Umbra — umbraBeam', () => {
  const umbra = (charge: number) => zoneEntry({
    instanceId: 'umbra', name: 'Umbra', faction: 'LH', vehicleType: 'sub', keywords: ['stealthy'],
    meta: { chargeMax: 2, onActivate: 'umbraBeam', activateCpCost: 0, dischargeCost: 2 }, charge,
  })
  it('shells the base past a Blocker for 150 and stays Stealthy', () => {
    const game = lhGame()
    game.state.zones[0].cards.a.push(umbra(2))
    game.state.zones[0].cards.b.push(zoneEntry({ keywords: ['blocker'] }))
    const res = activate(game, 'umbra')
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.zones[0].baseHp.b).toBe(850)
    const hull = res.game.state.zones[0].cards.a[0] as ZoneCardEntry
    expect(hull.keywords).toEqual(['stealthy'])
    expect(hull.meta.revokedKeywords).toBeUndefined()
    expect(chargeOf(hull)).toBe(0)
    expect(res.game.state.log.some((line) => line.includes('surfaces'))).toBe(false)
  })
})

describe('Ampere — ampereStun', () => {
  const ampere = () => inst({
    instanceId: 'ampere', name: 'Ampere', faction: 'LH', materialCost: 200000, keywords: ['mobile'],
    meta: { chargeMax: 2, onPlayEffect: 'ampereStun' },
  })
  const play = (game: ReturnType<typeof makeGame>) =>
    applyAction(game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: 'ampere', zoneId: 1 }, makeCtx())

  it('stuns the chosen enemy through their next turn', () => {
    const game = lhGame(); game.state.resources.a.materials = 300000
    game.privates.a.hand = [ampere()]; game.state.counts.a = { hand: 1, deck: 1 }
    game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'wall', keywords: ['blocker'] }), zoneEntry({ instanceId: 'other' }))
    const res = play(game)
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.pendingEffect?.options.map((o) => o.id)).toEqual(['wall', 'other'])
    const done = applyAction(res.game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'wall' }, makeCtx())
    if (!done.ok) throw new Error(done.error)
    const wall = done.game.state.zones[0].cards.b[0] as ZoneCardEntry
    expect(wall.stunnedUntilTurn).toBe(5)
  })

  it('plays with no stun into an empty lane, no refund', () => {
    const game = lhGame(); game.state.resources.a.materials = 300000
    game.privates.a.hand = [ampere()]; game.state.counts.a = { hand: 1, deck: 1 }
    const res = play(game)
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.pendingEffect).toBeNull()
    expect(res.game.state.resources.a.materials).toBe(100000)
    expect(chargeOf(res.game.state.zones[0].cards.a[0] as ZoneCardEntry)).toBe(0)
  })
})

// 2026-09-22 hovercraft amendment: Ampere lands full. The charge lands on the
// first entry only, so resolving the stun cannot charge it twice.
describe('Ampere — ampereChargedStun', () => {
  const ampere = () => inst({
    instanceId: 'ampere', name: 'Ampere', faction: 'LH', materialCost: 200000, keywords: ['mobile'],
    meta: { chargeMax: 2, onPlayEffect: 'ampereChargedStun' },
  })
  const setup = () => {
    const game = lhGame(); game.state.resources.a.materials = 300000
    game.privates.a.hand = [ampere()]; game.state.counts.a = { hand: 1, deck: 1 }
    return game
  }
  const play = (game: ReturnType<typeof makeGame>) =>
    applyAction(game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: 'ampere', zoneId: 1 }, makeCtx())
  const hull = (game: ReturnType<typeof makeGame>) =>
    game.state.zones[0].cards.a.find((c) => c.instanceId === 'ampere') as ZoneCardEntry

  it('lands with both pips, then stuns the chosen enemy', () => {
    const game = setup()
    game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'wall', keywords: ['blocker'] }))
    const res = play(game)
    if (!res.ok) throw new Error(res.error)
    expect(chargeOf(hull(res.game))).toBe(2)
    expect(res.game.state.pendingEffect?.options.map((o) => o.id)).toEqual(['wall'])
    const done = applyAction(res.game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'wall' }, makeCtx())
    if (!done.ok) throw new Error(done.error)
    expect(chargeOf(hull(done.game))).toBe(2)
    expect((done.game.state.zones[0].cards.b[0] as ZoneCardEntry).stunnedUntilTurn).toBe(5)
    expect(done.game.state.log).toContain('Ampere gains 2 charge')
  })

  it('still lands charged in a lane with no enemy', () => {
    const res = play(setup())
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.pendingEffect).toBeNull()
    expect(chargeOf(hull(res.game))).toBe(2)
    expect(res.game.state.log).toContain('Ampere: no enemy vehicle in this zone to stun')
  })
})

describe('Eclipse — eclipseDuel', () => {
  const eclipse = (charge: number) => zoneEntry({
    instanceId: 'eclipse', name: 'Eclipse', faction: 'LH', keywords: ['stealthy'],
    meta: { chargeMax: 2, onActivate: 'eclipseDuel', activateCpCost: 0, dischargeCost: 2 }, charge,
  })
  it('offers non-Stealthy enemies (a stunned Stealthy one included) and declares a 1v1 that leaves the lane activation unspent', () => {
    const game = lhGame()
    game.state.zones[0].cards.a.push(eclipse(2))
    game.state.zones[0].cards.b.push(
      zoneEntry({ instanceId: 'hidden', keywords: ['stealthy'] }),
      zoneEntry({ instanceId: 'stunnedHidden', keywords: ['stealthy'], stunnedUntilTurn: 5 }),
      zoneEntry({ instanceId: 'plain' }),
    )
    const res = activate(game, 'eclipse')
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.pendingEffect?.options.map((o) => o.id)).toEqual(['stunnedHidden', 'plain'])
    const done = applyAction(res.game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'plain' }, makeCtx())
    if (!done.ok) throw new Error(done.error)
    expect(done.game.state.activeBattle).toMatchObject({ zoneId: 1, aggressor: 'a', attackerIds: ['eclipse'], defenderIds: ['plain'] })
    expect(done.game.state.zones[0].lastActivatedTurn).toBeNull()
    expect((done.game.state.zones[0].cards.a[0] as ZoneCardEntry).keywords).toContain('stealthy')
  })
})

describe('Penumbra — penumbraPulse', () => {
  it('stuns every enemy in its lane and nothing elsewhere', () => {
    const game = lhGame()
    game.state.zones[0].cards.a.push(zoneEntry({
      instanceId: 'pen', name: 'Penumbra', faction: 'LH',
      meta: { chargeMax: 3, onActivate: 'penumbraPulse', activateCpCost: 0, dischargeCost: 3 }, charge: 3,
    }))
    game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'b1' }), zoneEntry({ instanceId: 'b2', keywords: ['stealthy'] }))
    game.state.zones[1].cards.b.push(zoneEntry({ instanceId: 'far' }))
    const res = activate(game, 'pen')
    if (!res.ok) throw new Error(res.error)
    const lane = res.game.state.zones[0].cards.b as ZoneCardEntry[]
    expect(lane.map((c) => c.stunnedUntilTurn)).toEqual([5, 5])
    expect((res.game.state.zones[1].cards.b[0] as ZoneCardEntry).stunnedUntilTurn).toBeUndefined()
    expect(res.game.state.log).toContain('Penumbra pulses — 2 enemy vehicle(s) in zone 1 stunned')
  })
})

describe('Cathode — cathodeDuel (dealt snapshots only since 2026-09-23)', () => {
  it('offers ships and subs only, surfaces at declaration, and declares the 1v1', () => {
    const game = lhGame()
    game.state.zones[0].cards.a.push(zoneEntry({
      instanceId: 'cat', name: 'Cathode', faction: 'LH', vehicleType: 'sub', keywords: ['stealthy', 'subScreen'],
      meta: { chargeMax: 2, requiresCharge: 2, onActivate: 'cathodeDuel', activateCpCost: 0, dischargeCost: 2 }, charge: 2,
    }))
    game.state.zones[0].cards.b.push(
      zoneEntry({ instanceId: 'ship' }),
      zoneEntry({ instanceId: 'sub', vehicleType: 'sub' }),
      zoneEntry({ instanceId: 'plane', vehicleType: 'plane' }),
    )
    const res = activate(game, 'cat')
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.pendingEffect?.options.map((o) => o.id)).toEqual(['ship', 'sub'])
    const done = applyAction(res.game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'sub' }, makeCtx())
    if (!done.ok) throw new Error(done.error)
    const cat = done.game.state.zones[0].cards.a[0] as ZoneCardEntry
    expect(cat.keywords).toEqual(['subScreen'])
    expect(done.game.state.activeBattle?.defenderIds).toEqual(['sub'])
  })

  it('offers an enemy hovercraft — it counts as a ship (2026-09-22 hovercraft amendment)', () => {
    const game = lhGame()
    game.state.zones[0].cards.a.push(zoneEntry({
      instanceId: 'cat', name: 'Cathode', faction: 'LH', vehicleType: 'sub', keywords: ['stealthy', 'subScreen'],
      meta: { chargeMax: 2, requiresCharge: 2, onActivate: 'cathodeDuel', activateCpCost: 0, dischargeCost: 2 }, charge: 2,
    }))
    game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'hov', vehicleType: 'hover' }))
    const res = activate(game, 'cat')
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.pendingEffect?.options.map((o) => o.id)).toEqual(['hov'])
  })
})

// 2026-09-23 (docs/superpowers/specs/2026-09-23-lh-drain-discount-design.md §6):
// Cathode no longer duels; every battle it survives stuns it for a turn.
describe('Cathode — cathodeOverheat', () => {
  const cathode = () => zoneEntry({
    instanceId: 'cat', name: 'Cathode', faction: 'LH', vehicleType: 'sub', keywords: ['fragile'],
    meta: { chargeMax: 2, requiresCharge: 2, onBattleEffect: 'cathodeOverheat' },
  })
  const cat = (game: EngineGame) => findVehicle(game.state, 'cat')?.entry as ZoneCardEntry | undefined
  // Alice reports and Bob approves — DECIDE refuses the reporter's own report.
  const resolve = (game: EngineGame, results: Record<string, number>) => {
    const submitted = applyAction(game, 'alice', { type: 'SUBMIT_BATTLE_REPORT', results, repairs: [] }, makeCtx())
    if (!submitted.ok) throw new Error(submitted.error)
    const decided = applyAction(submitted.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true }, makeCtx())
    if (!decided.ok) throw new Error(decided.error)
    return decided.game
  }
  const bobsTurn = () => {
    const game = lhGame()
    game.turnNumber = 4.5
    game.activePlayer = 'bob'
    return game
  }
  const overheated = 'Cathode overheats — stunned until the end of the next turn'

  it('does nothing at lock, then stuns a Cathode that attacked and survived through the enemy turn', () => {
    const game = lhGame() // turn 4, Alice (LH) to act
    game.state.zones[0].cards.a.push(cathode())
    game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'foe' }))
    const declared = applyAction(game, 'alice', { type: 'ATTACK_ENEMY_FLEET', zoneId: 1 }, makeCtx())
    if (!declared.ok) throw new Error(declared.error)
    expect(cat(declared.game)!.stunnedUntilTurn).toBeUndefined()
    const done = resolve(declared.game, { cat: 100, foe: 0 })
    const hull = cat(done)!
    expect(hull.stunnedUntilTurn).toBe(5)
    expect(isStunned(hull, 4.5)).toBe(true)
    expect(holdsStillInFtd(hull, 4.5)).toBe(true) // the enemy's turn: FtD holds the sub still
    expect(isStunned(hull, 5)).toBe(false)        // ready on its owner's next turn
    expect(done.state.log).toContain(overheated)
  })

  it('stuns a Cathode that defended — a draw included — through its owner’s next turn, so it cannot strike back', () => {
    const game = bobsTurn()
    game.state.zones[0].cards.a.push(cathode())
    game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'foe' }), zoneEntry({ instanceId: 'foe2' }))
    const declared = applyAction(game, 'bob', { type: 'ATTACK_ENEMY_FLEET', zoneId: 1 }, makeCtx())
    if (!declared.ok) throw new Error(declared.error)
    const done = resolve(declared.game, { cat: 95, foe: 0, foe2: 100 })
    const hull = cat(done)!
    expect(hull.stunnedUntilTurn).toBe(5.5)
    expect(fleetAttackRosters(done.state, 'a', 1, 5)!.force).toEqual([])
    expect(isStunned(hull, 5.5)).toBe(false)
  })

  it('overheats after a forced 1v1 too — an enemy Eclipse duels it, now that it is not Stealthy', () => {
    const game = bobsTurn()
    game.state.zones[0].cards.a.push(cathode())
    game.state.zones[0].cards.b.push(zoneEntry({
      instanceId: 'ecl', name: 'Eclipse', faction: 'LH', vehicleType: 'hover', keywords: ['stealthy'],
      meta: { chargeMax: 2, onActivate: 'eclipseDuel', activateCpCost: 0, dischargeCost: 2 }, charge: 2,
    }))
    const offered = applyAction(game, 'bob', { type: 'ACTIVATE_VEHICLE', instanceId: 'ecl' } as GameAction, makeCtx())
    if (!offered.ok) throw new Error(offered.error)
    expect(offered.game.state.pendingEffect?.options.map((o) => o.id)).toEqual(['cat'])
    const declared = applyAction(offered.game, 'bob', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'cat' }, makeCtx())
    if (!declared.ok) throw new Error(declared.error)
    const done = resolve(declared.game, { ecl: 0, cat: 100 })
    expect(cat(done)!.stunnedUntilTurn).toBe(5.5)
  })

  it('leaves a Cathode that died alone — nothing overheats', () => {
    const game = lhGame()
    game.state.zones[0].cards.a.push(cathode())
    game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'foe' }))
    const declared = applyAction(game, 'alice', { type: 'ATTACK_ENEMY_FLEET', zoneId: 1 }, makeCtx())
    if (!declared.ok) throw new Error(declared.error)
    const done = resolve(declared.game, { cat: 85, foe: 100 }) // 85%: destroyed — no repair asked, none allowed
    expect(cat(done)).toBeUndefined()
    expect(done.state.log).not.toContain(overheated)
  })
})

describe('Superradiance and Impedance — beams', () => {
  it.each([
    ['sup', 'superradianceBeam', 3, 700],
    ['imp', 'impedanceBeam', 2, 600],
  ])('%s shells the base past a Blocker and leaves the lane activation unspent', (id, effect, cost, hpLeft) => {
    const game = lhGame()
    game.state.zones[0].cards.a.push(zoneEntry({
      instanceId: id, name: id, faction: 'LH',
      meta: { chargeMax: cost, onActivate: effect, activateCpCost: 0, dischargeCost: cost }, charge: cost,
    }))
    game.state.zones[0].cards.b.push(zoneEntry({ keywords: ['blocker'] }))
    const res = activate(game, id)
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.zones[0].baseHp.b).toBe(hpLeft)
    expect(res.game.state.zones[0].lastActivatedTurn).toBeNull()
  })
})

describe('Terawatt — terawattTransfer', () => {
  const terawatt = (charge: number) => zoneEntry({
    instanceId: 'tera', name: 'Terawatt', faction: 'LH', keywords: ['blocker', 'scrappy', 'mobile'],
    meta: { chargeMax: 4, chargeRate: 2, requiresCharge: 2, onActivate: 'terawattTransfer', activateCpCost: 0, dischargeCost: 2 }, charge,
  })
  it('offers other LH hulls with room in its lane and the pick gains two pips, capped', () => {
    const game = lhGame()
    game.state.zones[0].cards.a.push(
      terawatt(4),
      zoneEntry({ instanceId: 'pen', faction: 'LH', meta: { chargeMax: 3 }, charge: 2 }),
      zoneEntry({ instanceId: 'full', faction: 'LH', meta: { chargeMax: 2 }, charge: 2 }),
    )
    const res = activate(game, 'tera')
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.pendingEffect?.options.map((o) => o.id)).toEqual(['pen'])
    const done = applyAction(res.game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'pen' }, makeCtx())
    if (!done.ok) throw new Error(done.error)
    const [tera, pen] = done.game.state.zones[0].cards.a as ZoneCardEntry[]
    expect(chargeOf(tera)).toBe(2)
    expect(chargeOf(pen)).toBe(3)
  })
  it('refuses, spending nothing, when nothing in the lane has room', () => {
    const game = lhGame(); game.state.zones[0].cards.a.push(terawatt(4))
    expect(activate(game, 'tera')).toMatchObject({ ok: false, status: 400 })
    expect(chargeOf(game.state.zones[0].cards.a[0] as ZoneCardEntry)).toBe(4)
  })
  it('ticks two a turn', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    game.state.zones[0].cards.b.push(terawatt(0))
    const res = applyAction(game, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!res.ok) throw new Error(res.error)
    expect(chargeOf(res.game.state.zones[0].cards.b[0] as ZoneCardEntry)).toBe(2)
  })

  // R-20: hosting an ability card's discharge is the hull's activation, so a
  // Terawatt that already transferred this turn cannot host EMP Salvo too.
  it('cannot also host EMP Salvo the same turn it transfers — hosting is its activation (R-20)', () => {
    const game = lhGame()
    game.state.zones[0].cards.a.push(
      terawatt(4),
      zoneEntry({ instanceId: 'pen', faction: 'LH', meta: { chargeMax: 3 }, charge: 2 }),
    )
    const activated = activate(game, 'tera')
    if (!activated.ok) throw new Error(activated.error)
    const resolved = applyAction(activated.game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'pen' }, makeCtx())
    if (!resolved.ok) throw new Error(resolved.error)
    const withSalvo = resolved.game
    withSalvo.privates.a.hand = [inst({
      instanceId: 'salvo', name: 'EMP Salvo', type: 'ability', vehicleType: null, faction: 'LH', materialCost: 60000,
      meta: { playOnVehicleEffect: 'empSalvoEffect', dischargeFrom: 2 },
    })]
    withSalvo.state.counts.a = { hand: 1, deck: withSalvo.privates.a.deck.length }
    withSalvo.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'e1' }))
    // Tera has exactly 2 charge left (4 - 2 discharged) — enough to pay EMP
    // Salvo's own cost, so a 409 here can only be R-20's activation guard.
    const res = applyAction(
      withSalvo, 'alice', { type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD', instanceId: 'salvo', targetInstanceId: 'tera' }, makeCtx(),
    )
    expect(res).toMatchObject({ ok: false, status: 409 })
  })
})

describe('EMP Salvo — empSalvoEffect', () => {
  const salvo = () => inst({
    instanceId: 'salvo', name: 'EMP Salvo', type: 'ability', vehicleType: null, faction: 'LH', materialCost: 60000,
    meta: { playOnVehicleEffect: 'empSalvoEffect', dischargeFrom: 2 },
  })
  const setup = (enemies: boolean) => {
    const game = lhGame(); game.state.resources.a.materials = 100000
    game.privates.a.hand = [salvo()]; game.state.counts.a = { hand: 1, deck: 1 }
    game.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'host', faction: 'LH', meta: { chargeMax: 2 }, charge: 2 }))
    if (enemies) game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'e1' }), zoneEntry({ instanceId: 'e2' }))
    game.state.zones[1].cards.b.push(zoneEntry({ instanceId: 'far' }))
    return game
  }
  const play = (game: ReturnType<typeof makeGame>) =>
    applyAction(game, 'alice', { type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD', instanceId: 'salvo', targetInstanceId: 'host' }, makeCtx())

  it('offers the enemies in the host\'s lane and stuns the pick', () => {
    const res = play(setup(true))
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.pendingEffect?.options.map((o) => o.id)).toEqual(['e1', 'e2'])
    expect(chargeOf(res.game.state.zones[0].cards.a[0] as ZoneCardEntry)).toBe(0)
    const done = applyAction(res.game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'e2' }, makeCtx())
    if (!done.ok) throw new Error(done.error)
    expect((done.game.state.zones[0].cards.b[1] as ZoneCardEntry).stunnedUntilTurn).toBe(5)
  })

  it('is refused, spending nothing, when the host\'s lane has no enemy', () => {
    const game = setup(false)
    expect(play(game)).toMatchObject({ ok: false, status: 400 })
    expect(chargeOf(game.state.zones[0].cards.a[0] as ZoneCardEntry)).toBe(2)
    expect(game.privates.a.hand).toHaveLength(1)
  })
})

describe('Overcharge — overchargeEffect', () => {
  const overcharge = () => inst({
    instanceId: 'oc', name: 'Overcharge', type: 'ability', vehicleType: null, faction: 'LH', materialCost: 0, cpCost: 1,
    meta: { playOnVehicleEffect: 'overchargeEffect' },
  })
  const play = (game: ReturnType<typeof makeGame>, target: string) =>
    applyAction(game, 'alice', { type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD', instanceId: 'oc', targetInstanceId: target }, makeCtx())
  const setup = () => {
    const game = lhGame()
    game.privates.a.hand = [overcharge()]; game.state.counts.a = { hand: 1, deck: 1 }
    game.state.zones[0].cards.a.push(
      zoneEntry({ instanceId: 'fresh', faction: 'LH', meta: { chargeMax: 3 }, playedOnTurn: 4 }),
      zoneEntry({ instanceId: 'full', faction: 'LH', meta: { chargeMax: 2 }, charge: 2 }),
      zoneEntry({ instanceId: 'dwg', faction: 'DWG', meta: { chargeMax: 2 } }),
    )
    return game
  }
  it('adds two pips to a fresh LH hull for one CP, capped', () => {
    const res = play(setup(), 'fresh')
    if (!res.ok) throw new Error(res.error)
    expect(chargeOf(res.game.state.zones[0].cards.a[0] as ZoneCardEntry)).toBe(2)
    expect(res.game.state.resources.a.cp).toBe(2)
  })
  it('refuses a full hull and a non-LH hull', () => {
    expect(play(setup(), 'full')).toMatchObject({ ok: false, status: 400 })
    expect(play(setup(), 'dwg')).toMatchObject({ ok: false, status: 400 })
  })
})

describe('Afterburner — afterburnerEffect', () => {
  it('lets a hull played this turn bombard, the host itself included', () => {
    const game = lhGame(); game.state.resources.a.materials = 100000
    game.privates.a.hand = [inst({
      instanceId: 'ab', name: 'Afterburner', type: 'ability', vehicleType: null, faction: 'LH', materialCost: 50000,
      meta: { playOnVehicleEffect: 'afterburnerEffect', dischargeFrom: 2 },
    })]
    game.state.counts.a = { hand: 1, deck: 1 }
    game.state.zones[0].cards.a.push(
      zoneEntry({ instanceId: 'host', faction: 'LH', materialCost: 200000, meta: { chargeMax: 2 }, charge: 2, playedOnTurn: 4 }),
      zoneEntry({ instanceId: 'old', faction: 'LH', materialCost: 100000, meta: { chargeMax: 2 }, playedOnTurn: 2 }),
      zoneEntry({ instanceId: 'cap', faction: 'LH', materialCost: 700000, playedOnTurn: 4 }),
    )
    const res = applyAction(game, 'alice', { type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD', instanceId: 'ab', targetInstanceId: 'host' }, makeCtx())
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.pendingEffect?.options.map((o) => o.id)).toEqual(['host', 'cap'])
    const done = applyAction(res.game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'cap' }, makeCtx())
    if (!done.ok) throw new Error(done.error)
    const strike = applyAction(done.game, 'alice', { type: 'ATTACK_ENEMY_BASE', zoneId: 1 }, makeCtx())
    if (!strike.ok) throw new Error(strike.error)
    expect(strike.game.state.zones[0].baseHp.b).toBe(200) // old 100 + afterburned 700; the fresh host still waits
  })
})

describe('Extended Sortie — extendedSortieEffect', () => {
  it('keeps the chosen plane past the next turn start, and the discard makes it Temporary again', () => {
    const game = lhGame(); game.state.resources.a.materials = 200000
    game.privates.a.hand = [inst({
      instanceId: 'es', name: 'Extended Sortie', type: 'ability', vehicleType: null, faction: 'LH', materialCost: 100000,
      meta: { playOnVehicleEffect: 'extendedSortieEffect', dischargeFrom: 2 },
    })]
    game.state.counts.a = { hand: 1, deck: 1 }
    game.state.zones[0].cards.a.push(
      zoneEntry({ instanceId: 'host', faction: 'LH', meta: { chargeMax: 2 }, charge: 2 }),
      zoneEntry({ instanceId: 'wing', faction: 'LH', vehicleType: 'plane', keywords: ['halfCost', 'temporary', 'fragile', 'swift'] }),
      zoneEntry({ instanceId: 'ship', faction: 'LH' }),
    )
    const res = applyAction(game, 'alice', { type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD', instanceId: 'es', targetInstanceId: 'host' }, makeCtx())
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.pendingEffect?.options.map((o) => o.id)).toEqual(['wing'])
    const done = applyAction(res.game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'wing' }, makeCtx())
    if (!done.ok) throw new Error(done.error)
    // endTurn culls Temporary hulls on EVERY END_TURN call, from both sides —
    // so one END_TURN alone cannot tell "the keyword was revoked" apart from
    // "the cull simply has not reached this side yet". Ending both alice's and
    // bob's turns drives a full round, which only a genuine revoke survives.
    const endedAlice = applyAction(done.game, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!endedAlice.ok) throw new Error(endedAlice.error)
    const ended = applyAction(endedAlice.game, 'bob', { type: 'END_TURN' }, makeCtx())
    if (!ended.ok) throw new Error(ended.error)
    const wing = ended.game.state.zones[0].cards.a.find((c) => c.instanceId === 'wing') as ZoneCardEntry
    expect(wing).toBeDefined()
    expect(wing.keywords).toEqual(['halfCost', 'fragile', 'swift'])
    expect(discardSnapshotOf(wing).keywords).toContain('temporary')
  })
})

// 2026-09-22 hovercraft amendment §3: Byte's draw moved here; the Decoy moved
// to a permanent Luxon token.
describe('Watt — wattOnPlay (dealt snapshots) and wattDraw', () => {
  const luxon = () => snap({
    name: 'Luxon', faction: 'LH', vehicleType: 'plane', materialCost: 60000,
    keywords: ['halfCost', 'temporary'], meta: { deployRequiresLhVehicle: true },
  })
  const wattMeta = { chargeMax: 1, onPlayEffect: 'wattOnPlay', onActivate: 'wattDraw', activateCpCost: 0, dischargeCost: 1 }
  const setup = () => {
    const game = lhGame()
    game.privates.a.hand = [inst({
      instanceId: 'watt', name: 'Watt', faction: 'LH', vehicleType: 'hover', materialCost: 90000,
      keywords: ['scrappy', 'mobile'], meta: wattMeta,
    })]
    game.state.counts.a = { hand: 1, deck: 1 }
    return game
  }
  const play = (game: ReturnType<typeof makeGame>, ctx = makeCtx({ catalog: [luxon()] })) =>
    applyAction(game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: 'watt', zoneId: 1 }, ctx)

  it('asks for the catalog, so game-action loads it for a Watt play', () => {
    expect(CATALOG_EFFECTS.has('wattOnPlay')).toBe(true)
  })

  it('lands with its pip and launches a Luxon that has Decoy, is not Temporary, and is a token', () => {
    const res = play(setup())
    if (!res.ok) throw new Error(res.error)
    const [hull, escort] = res.game.state.zones[0].cards.a as ZoneCardEntry[]
    expect(hull.instanceId).toBe('watt')
    expect(chargeOf(hull)).toBe(1)
    expect(escort.name).toBe('Luxon')
    expect(escort.keywords).toEqual(['halfCost', 'decoy'])
    expect(escort.meta.summonOnly).toBe(true)
    expect(res.game.state.log).toContain('Watt gains 1 charge')
    expect(res.game.state.log).toContain('Watt launches a Luxon in zone 1 — it has Decoy and stays')
  })

  it('keeps its Luxon through a full round of turn starts', () => {
    const res = play(setup())
    if (!res.ok) throw new Error(res.error)
    const endedAlice = applyAction(res.game, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!endedAlice.ok) throw new Error(endedAlice.error)
    const ended = applyAction(endedAlice.game, 'bob', { type: 'END_TURN' }, makeCtx())
    if (!ended.ok) throw new Error(ended.error)
    expect(ended.game.state.zones[0].cards.a.map((c) => c.name)).toEqual(['Watt', 'Luxon'])
  })

  it('sends a dead Luxon nowhere — it never reaches the discard', () => {
    const res = play(setup())
    if (!res.ok) throw new Error(res.error)
    discardCard(res.game, 'a', res.game.state.zones[0].cards.a[1])
    expect(res.game.state.destroyed.a).toEqual([])
  })

  it('still lands and charges in a full lane, with no Luxon and a log line', () => {
    const game = setup()
    for (let i = 0; i < MAX_VEHICLES_PER_ZONE_SIDE - 1; i++) game.state.zones[0].cards.a.push(zoneEntry({ faction: 'LH' }))
    const res = play(game)
    if (!res.ok) throw new Error(res.error)
    const lane = res.game.state.zones[0].cards.a as ZoneCardEntry[]
    expect(lane).toHaveLength(MAX_VEHICLES_PER_ZONE_SIDE)
    expect(lane.some((c) => c.name === 'Luxon')).toBe(false)
    expect(chargeOf(lane.find((c) => c.instanceId === 'watt')!)).toBe(1)
    expect(res.game.state.log).toContain('Watt: no room in zone 1 for its Luxon')
  })

  it('fails the play when the catalog has no Luxon — a data bug, not an empty pool', () => {
    const game = setup()
    expect(play(game, makeCtx())).toMatchObject({ ok: false })
    expect(game.privates.a.hand.map((c) => c.instanceId)).toEqual(['watt'])
  })

  it('discharges its pip for a card', () => {
    const game = lhGame()
    game.state.zones[0].cards.a.push(zoneEntry({
      instanceId: 'watt', name: 'Watt', faction: 'LH', vehicleType: 'hover', keywords: ['scrappy', 'mobile'],
      meta: wattMeta, charge: 1,
    }))
    const res = activate(game, 'watt')
    if (!res.ok) throw new Error(res.error)
    expect(res.game.privates.a.hand.map((c) => c.name)).toEqual(['Spare'])
    expect(chargeOf(res.game.state.zones[0].cards.a[0] as ZoneCardEntry)).toBe(0)
  })
})

// 2026-09-23 (docs/superpowers/specs/2026-09-23-lh-drain-discount-design.md §7):
// the Watt costs 120k and enters with no charge; its Luxon is unchanged.
describe('Watt — wattEscortOnPlay', () => {
  const luxon = () => snap({
    name: 'Luxon', faction: 'LH', vehicleType: 'plane', materialCost: 60000,
    keywords: ['halfCost', 'temporary'], meta: { deployRequiresLhVehicle: true },
  })
  const setup = () => {
    const game = lhGame()
    game.state.resources.a.materials = 150_000
    game.privates.a.hand = [inst({
      instanceId: 'watt', name: 'Watt', faction: 'LH', vehicleType: 'hover', materialCost: 120_000,
      keywords: ['scrappy', 'mobile'],
      meta: { chargeMax: 1, onPlayEffect: 'wattEscortOnPlay', onActivate: 'wattDraw', activateCpCost: 0, dischargeCost: 1 },
    })]
    game.state.counts.a = { hand: 1, deck: 1 }
    return game
  }
  const play = (game: ReturnType<typeof makeGame>, ctx = makeCtx({ catalog: [luxon()] })) =>
    applyAction(game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: 'watt', zoneId: 1 }, ctx)

  it('asks for the catalog, so game-action loads it for a Watt play', () => {
    expect(CATALOG_EFFECTS.has('wattEscortOnPlay')).toBe(true)
  })

  it('lands with no charge and still launches its Decoy Luxon token', () => {
    const res = play(setup())
    if (!res.ok) throw new Error(res.error)
    const [hull, escort] = res.game.state.zones[0].cards.a as ZoneCardEntry[]
    expect(hull.instanceId).toBe('watt')
    expect(chargeOf(hull)).toBe(0)
    expect(escort.name).toBe('Luxon')
    expect(escort.keywords).toEqual(['halfCost', 'decoy'])
    expect(escort.meta.summonOnly).toBe(true)
    expect(res.game.state.log).toContain('Watt launches a Luxon in zone 1 — it has Decoy and stays')
    expect(res.game.state.log).not.toContain('Watt gains 1 charge')
  })

  it('cannot draw the turn it lands — its first pip comes at its owner’s next turn start', () => {
    const res = play(setup())
    if (!res.ok) throw new Error(res.error)
    expect(activate(res.game, 'watt')).toMatchObject({ ok: false, status: 400, error: 'Watt needs 1 charge to discharge' })
  })

  it('fails the play when the catalog has no Luxon, as wattOnPlay does', () => {
    const game = setup()
    expect(play(game, makeCtx())).toMatchObject({ ok: false })
    expect(game.privates.a.hand.map((c) => c.instanceId)).toEqual(['watt'])
  })
})
