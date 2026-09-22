import { beforeAll, describe, expect, it } from 'vitest'
import { applyAction, enemyTargetFilterFor, registerEffect } from './index.ts'
import { decoyFor } from './decoy.ts'
import { enemyVehicleOptions } from '../effects/primitives.ts'
import { inst, makeCtx, makeGame, zoneEntry } from './testFixtures.ts'

describe('Decoy (2026-09-21 LH spec §3.6)', () => {
  beforeAll(() => {
    registerEffect('t_hitAny', () => true, { enemyTarget: () => true })
    registerEffect('t_hitSubs', () => true, { enemyTarget: (e) => e.vehicleType === 'sub' })
    registerEffect('t_hitUnfiltered', () => true)
  })
  const watt = () => zoneEntry({ instanceId: 'watt', name: 'Watt', faction: 'LH', keywords: ['decoy'] })
  const sub = () => zoneEntry({ instanceId: 'sub', name: 'Umbra', faction: 'LH', vehicleType: 'sub' })
  const ability = (effect: string) => inst({ instanceId: 'ab', type: 'ability', vehicleType: null, faction: 'WF', materialCost: 0, meta: { playOnVehicleEffect: effect } })
  const setup = (effect: string) => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    game.privates.a.hand = [ability(effect)]
    game.state.counts.a = { hand: 1, deck: 0 }
    game.state.zones[0].cards.b.push(watt(), sub())
    game.state.zones[1].cards.b.push(zoneEntry({ instanceId: 'far', faction: 'LH' }))
    return game
  }
  const play = (game: ReturnType<typeof makeGame>, target: string) =>
    applyAction(game, 'alice', { type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD', instanceId: 'ab', targetInstanceId: target }, makeCtx())

  it('redirects an effect the Decoy could be hit by, in its own lane only', () => {
    expect(play(setup('t_hitAny'), 'sub')).toMatchObject({ ok: false, status: 400 })
    expect(play(setup('t_hitAny'), 'watt').ok).toBe(true)
    expect(play(setup('t_hitAny'), 'far').ok).toBe(true)
  })

  it('never blanks: a sub-only effect still hits the sub beside a Decoy', () => {
    expect(play(setup('t_hitSubs'), 'sub').ok).toBe(true)
  })

  it('leaves an unannotated effect alone', () => {
    expect(play(setup('t_hitUnfiltered'), 'sub').ok).toBe(true)
  })

  it('narrows an on-play prompt to the Decoys of a lane', () => {
    const game = setup('t_hitAny')
    expect(enemyVehicleOptions(game, 'a', 1).map((o) => o.id)).toEqual(['watt'])
    expect(enemyVehicleOptions(game, 'a', 1, (e) => e.vehicleType === 'sub').map((o) => o.id)).toEqual(['sub'])
    expect(enemyVehicleOptions(game, 'a', null).map((o) => o.id)).toEqual(['watt', 'far'])
  })

  it('decoyFor answers null when the pick is itself a Decoy', () => {
    expect(decoyFor([watt(), sub()], watt(), () => true)).toBeNull()
  })

  it('every enemy-targeting ability in the game declares its filter', () => {
    for (const name of ['flyingSquirrelAttackEffect', 'mutinyEffect', 'martyrAttackEffect', 'subStrikeEffect', 'subKillerEffect', 'sabotageEffect', 'gangUpEffect', 'airStrafeEffect']) {
      expect(enemyTargetFilterFor(name), name).not.toBeNull()
    }
  })
})
