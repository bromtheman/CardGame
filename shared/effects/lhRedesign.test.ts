import { describe, expect, it } from 'vitest'
import { applyAction, chargeOf, discardSnapshotOf } from '../engine/index.ts'
import type { GameAction, ZoneCardEntry } from '../engine/engineTypes.ts'
import { inst, makeCtx, makeGame, zoneEntry } from '../engine/testFixtures.ts'

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

describe('Cathode — cathodeDuel', () => {
  it('offers ships and subs only, surfaces at declaration, and declares the 1v1', () => {
    const game = lhGame()
    game.state.zones[0].cards.a.push(zoneEntry({
      instanceId: 'cat', name: 'Cathode', faction: 'LH', vehicleType: 'sub', keywords: ['stealthy', 'subScreen'],
      meta: { chargeMax: 2, requiresCharge: 3, onActivate: 'cathodeDuel', activateCpCost: 0, dischargeCost: 2 }, charge: 2,
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
    meta: { chargeMax: 4, chargeRate: 2, requiresCharge: 3, onActivate: 'terawattTransfer', activateCpCost: 0, dischargeCost: 2 }, charge,
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
