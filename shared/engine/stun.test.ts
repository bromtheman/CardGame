import { describe, expect, it } from 'vitest'
import {
  applyAction, baseDamageFrom, discardSnapshotOf, fleetAttackRosters, holdsStillInFtd, legalZonesFor, moveEntry,
} from './index.ts'
import { isStunned, stunHull } from './stun.ts'
import { inst, makeCtx, makeGame, zoneEntry } from './testFixtures.ts'
import type { ZoneCardEntry } from './engineTypes.ts'

describe('stun (2026-09-21 LH spec §3.4)', () => {
  it('lasts through the owner\'s next turn and clears when the stunner\'s next one begins', () => {
    const game = makeGame({ turnNumber: 2 })
    const e = zoneEntry({ instanceId: 'e' })
    stunHull(game, e)
    expect(e.stunnedUntilTurn).toBe(3)
    expect(isStunned(e, 2)).toBe(true)
    expect(isStunned(e, 2.5)).toBe(true)
    expect(isStunned(e, 3)).toBe(false)
    expect(isStunned(zoneEntry(), 2)).toBe(false)
  })

  it('cannot bombard and does not count as a Blocker', () => {
    const game = makeGame({ turnNumber: 3, activePlayer: 'alice' })
    const striker = zoneEntry({ instanceId: 's', materialCost: 100000, playedOnTurn: 1, stunnedUntilTurn: 4 })
    game.state.zones[0].cards.a.push(striker)
    expect(baseDamageFrom([striker], 3)).toBe(0)
    game.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'ok', materialCost: 100000, playedOnTurn: 1 }))
    game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'wall', keywords: ['blocker'], stunnedUntilTurn: 4 }))
    const res = applyAction(game, 'alice', { type: 'ATTACK_ENEMY_BASE', zoneId: 1 }, makeCtx())
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.zones[0].baseHp.b).toBe(900)
  })

  it('does not attack in a fleet attack, and cannot withdraw as Stealthy', () => {
    const game = makeGame({ turnNumber: 3 })
    game.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'a1', stunnedUntilTurn: 4 }), zoneEntry({ instanceId: 'a2' }))
    game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'b1', keywords: ['stealthy'], stunnedUntilTurn: 4 }))
    const rosters = fleetAttackRosters(game.state, 'a', 1, 3)!
    expect(rosters.force.map((c) => c.instanceId)).toEqual(['a2'])
    expect(rosters.stealthyIds).toEqual([])
  })

  it('does not Screen, and cannot move', () => {
    const game = makeGame({ turnNumber: 3, activePlayer: 'alice' })
    game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'screen', keywords: ['airScreen'], stunnedUntilTurn: 4 }))
    const plane = inst({ vehicleType: 'plane' })
    expect(legalZonesFor(game.state, 'a', plane, 3)).toContain(1)
    const mover = zoneEntry({ instanceId: 'm', keywords: ['mobile'], stunnedUntilTurn: 4 })
    game.state.zones[0].cards.a.push(mover)
    expect(moveEntry(game, 'a', 'm', 2, true)).toMatchObject({ ok: false, status: 400 })
  })

  it('is stripped on discard', () => {
    const snap = discardSnapshotOf(zoneEntry({ stunnedUntilTurn: 4 })) as Record<string, unknown>
    expect('stunnedUntilTurn' in snap).toBe(false)
  })
})

// 2026-09-23: the FtD mod holds a flagged hull still for the whole battle —
// movement AI off and locked, weapons still firing. This is which hulls get the
// flag. Every hull below was stunned on turn 3, so it is stamped 4.
describe('holdsStillInFtd — which stunned hulls the FtD battle holds still', () => {
  it.each(['ship', 'tank', 'sub'])('holds a stunned %s still', (vehicleType) => {
    expect(holdsStillInFtd(zoneEntry({ vehicleType, stunnedUntilTurn: 4 }), 3)).toBe(true)
  })

  // Each needs its AI to stay up: a hovercraft may lose its cushion, a plane
  // would crash, an airship leans on its lift. Hover is the one isShipClass
  // would have let through.
  it.each(['hover', 'plane', 'airship'])('lets a stunned %s fight normally', (vehicleType) => {
    expect(holdsStillInFtd(zoneEntry({ vehicleType, stunnedUntilTurn: 4 }), 3)).toBe(false)
  })

  it('holds nothing that is not stunned', () => {
    expect(holdsStillInFtd(zoneEntry({ vehicleType: 'ship' }), 3)).toBe(false)
  })

  it('lets the hull go on the turn its stun expires', () => {
    expect(holdsStillInFtd(zoneEntry({ vehicleType: 'ship', stunnedUntilTurn: 4 }), 4)).toBe(false)
  })
})
