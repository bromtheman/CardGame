import { describe, expect, it } from 'vitest'
import { applyAction, chargeOf, effectFor } from '../engine/index.ts'
import type { GameAction, ZoneCardEntry } from '../engine/engineTypes.ts'
import { inst, makeCtx, makeGame, zoneEntry } from '../engine/testFixtures.ts'

// The 2026-09-22 LH draw amendment and its 2026-09-23 second round
// (docs/superpowers/specs/2026-09-22-lh-draw-design.md), driven through the
// real actions so the engine's play, discharge and turn-end plumbing run too.

const lhGame = (deck = 3) => {
  const game = makeGame({ turnNumber: 4, activePlayer: 'alice' })
  game.state.factions = { a: 'LH', b: 'SS' }
  game.privates.a.deck = Array.from({ length: deck }, (_, i) => inst({ instanceId: `d${i}`, name: 'Spare' }))
  game.state.counts.a = { hand: 0, deck }
  return game
}
const ok = (res: ReturnType<typeof applyAction>) => {
  if (!res.ok) throw new Error(res.error)
  return res.game
}
const toHand = (game: ReturnType<typeof makeGame>, ...cards: ReturnType<typeof inst>[]) => {
  game.privates.a.hand.push(...cards)
  game.state.counts.a.hand = game.privates.a.hand.length
}
const playTo = (game: ReturnType<typeof makeGame>, instanceId: string, zoneId: number) =>
  applyAction(game, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId, zoneId } as GameAction, makeCtx())
const activate = (game: ReturnType<typeof makeGame>, instanceId: string) =>
  applyAction(game, 'alice', { type: 'ACTIVATE_VEHICLE', instanceId } as GameAction, makeCtx())
const host = (game: ReturnType<typeof makeGame>, instanceId: string, targetInstanceId: string) =>
  applyAction(game, 'alice', { type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD', instanceId, targetInstanceId } as GameAction, makeCtx())
const handNames = (game: ReturnType<typeof makeGame>) => game.privates.a.hand.map((c) => c.name)

// A charged LH timer with a Discharge 2 ability that resolves with no prompt.
const umbra = (instanceId: string, charge = 2) => zoneEntry({
  instanceId, name: 'Umbra', faction: 'LH', vehicleType: 'sub', keywords: ['stealthy'],
  meta: { chargeMax: 2, onActivate: 'umbraSalvo', activateCpCost: 0, dischargeCost: 2 }, charge,
})
const dataBurst = () => inst({
  instanceId: 'burst', name: 'Data Burst', type: 'ability', vehicleType: null, faction: 'LH', materialCost: 50000,
  meta: { playOnVehicleEffect: 'dataBurstEffect', dischargeFrom: 2 },
})
const feedbackLoop = (instanceId = 'loop') => inst({
  instanceId, name: 'Feedback Loop', type: 'ability', vehicleType: null, faction: 'LH', materialCost: 0,
  meta: { playOnZoneEffect: 'feedbackLoopEffect' },
})

describe('draw when played — Faraday, Kilowatt, Megawatt', () => {
  it.each([
    ['Faraday', 'faradayOnPlay', 'airship'],
    ['Kilowatt', 'kilowattOnPlay', 'hover'],
    ['Megawatt', 'megawattOnPlay', 'ship'],
  ] as const)('%s draws a card as it lands', (name, effect, vehicleType) => {
    const game = lhGame()
    toHand(game, inst({ instanceId: 'hull', name, faction: 'LH', vehicleType, materialCost: 100000, meta: { chargeMax: 2, onPlayEffect: effect } }))
    const after = ok(playTo(game, 'hull', 1))
    expect(handNames(after)).toEqual(['Spare'])
    expect(after.state.zones[0].cards.a.map((c) => c.instanceId)).toEqual(['hull'])
  })
})

describe('Byte — byteChargeOnPlay', () => {
  it('enters with its pip, which pays for the draw the same turn', () => {
    const game = lhGame()
    toHand(game, inst({
      instanceId: 'byte', name: 'Byte', faction: 'LH', materialCost: 40000, keywords: ['mobile'],
      meta: { chargeMax: 1, onPlayEffect: 'byteChargeOnPlay', onActivate: 'byteDraw', activateCpCost: 0, dischargeCost: 1 },
    }))
    const played = ok(playTo(game, 'byte', 1))
    expect(chargeOf(played.state.zones[0].cards.a[0] as ZoneCardEntry)).toBe(1)
    expect(played.state.log).toContain('Byte gains 1 charge')
    const drawn = ok(activate(played, 'byte'))
    expect(handNames(drawn)).toEqual(['Spare'])
    expect(chargeOf(drawn.state.zones[0].cards.a[0] as ZoneCardEntry)).toBe(0)
  })
})

describe('Data Burst — dataBurstEffect', () => {
  it('spends two pips from the host and draws two', () => {
    const game = lhGame()
    game.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'host', faction: 'LH', meta: { chargeMax: 2 }, charge: 2 }))
    toHand(game, dataBurst())
    const after = ok(host(game, 'burst', 'host'))
    expect(handNames(after)).toEqual(['Spare', 'Spare'])
    expect(chargeOf(after.state.zones[0].cards.a[0] as ZoneCardEntry)).toBe(0)
  })
})

describe('Feedback Loop — feedbackLoopEffect', () => {
  const looped = () => {
    const game = lhGame()
    toHand(game, feedbackLoop())
    return ok(playTo(game, 'loop', 1))
  }

  it('claims the zone for this turn only', () => {
    const game = looped()
    expect(game.state.zoneEffects).toEqual([expect.objectContaining({
      effect: 'feedbackLoopEffect', zoneId: 1, side: 'a', expiresOnTurn: 4,
    })])
  })

  it('draws a card when a friendly LH hull in that zone discharges its own ability', () => {
    const game = looped()
    game.state.zones[0].cards.a.push(umbra('u1'))
    const after = ok(activate(game, 'u1'))
    expect(handNames(after)).toEqual(['Spare'])
    expect(after.state.log).toContain('Feedback Loop: player A draws')
  })

  it('draws once per discharge, hull by hull', () => {
    const game = looped()
    game.state.zones[0].cards.a.push(umbra('u1'), umbra('u2'))
    const after = ok(activate(ok(activate(game, 'u1')), 'u2'))
    expect(handNames(after)).toEqual(['Spare', 'Spare'])
  })

  it('also draws when a hull in that zone hosts a Discharge-from card', () => {
    const game = looped()
    game.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'host', faction: 'LH', meta: { chargeMax: 2 }, charge: 2 }))
    toHand(game, dataBurst())
    const after = ok(host(game, 'burst', 'host'))
    // One for the discharge, two for Data Burst itself.
    expect(handNames(after)).toEqual(['Spare', 'Spare', 'Spare'])
  })

  it('ignores a discharge in any other zone', () => {
    const game = looped()
    game.state.zones[1].cards.a.push(umbra('far'))
    const after = ok(activate(game, 'far'))
    expect(handNames(after)).toEqual([])
  })

  it('does not stack: a second copy on the same zone is refused', () => {
    const game = looped()
    toHand(game, feedbackLoop('loop2'))
    expect(playTo(game, 'loop2', 1)).toMatchObject({ ok: false })
  })

  it('expires at its owner\'s end of turn', () => {
    const ended = ok(applyAction(looped(), 'alice', { type: 'END_TURN' }, makeCtx()))
    expect(ended.state.zoneEffects).toEqual([])
  })

  it('does nothing when a battle, bombardment or interception re-dispatches the rider', () => {
    const game = looped()
    const fn = effectFor('feedbackLoopEffect')!
    const card = feedbackLoop()
    const battle = {
      phase: 'lock', zoneId: 1, isDefender: false, isParticipant: false,
      forced: false, survived: false, won: false, casualties: [],
    } as const
    expect(fn({ game, actor: 'a', card, ctx: makeCtx(), battle } as Parameters<typeof fn>[0])).toBe(true)
    expect(game.state.zoneEffects).toHaveLength(1)
  })
})
