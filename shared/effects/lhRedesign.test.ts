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
