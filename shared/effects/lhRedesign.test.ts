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
