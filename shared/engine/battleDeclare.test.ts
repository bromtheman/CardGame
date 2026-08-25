import { describe, expect, it } from 'vitest'
import { applyAction } from './index'
import { makeGame, zoneEntry } from './testFixtures'

function battleground() {
  const g = makeGame({ turnNumber: 3 })
  const atk = zoneEntry({ playedOnTurn: 2 })
  const def = zoneEntry({})
  g.state.zones[0].cards.a.push(atk)
  g.state.zones[0].cards.b.push(def)
  return { g, atk, def }
}

describe('ATTACK_ENEMY_FLEET', () => {
  it('locks a battle at default distance and spends the activation', () => {
    const { g, atk, def } = battleground()
    const r = applyAction(g, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1, attackerIds: [atk.instanceId], targetIds: [def.instanceId],
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.activeBattle).toMatchObject({
      zoneId: 1, aggressor: 'a', attackerIds: [atk.instanceId],
      defenderIds: [def.instanceId], distanceM: 1200, distanceModifiedBy: [],
    })
    expect(r.game.state.zones[0].lastActivatedTurn).toBe(3)
  })
  it('rejects inoffensive attackers, foreign ids, and empty selections', () => {
    const { g, def } = battleground()
    const ino = zoneEntry({ keywords: ['inoffensive'], playedOnTurn: 2 })
    g.state.zones[0].cards.a.push(ino)
    expect(applyAction(g, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1, attackerIds: [ino.instanceId], targetIds: [def.instanceId],
    })).toMatchObject({ ok: false, status: 400 })
    expect(applyAction(g, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1, attackerIds: ['ghost'], targetIds: [def.instanceId],
    })).toMatchObject({ ok: false, status: 400 })
    expect(applyAction(g, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1, attackerIds: [], targetIds: [def.instanceId],
    })).toMatchObject({ ok: false, status: 400 })
  })
  it('routes stealthy targets through the response window', () => {
    const { g, atk, def } = battleground()
    const sneak = zoneEntry({ keywords: ['stealthy'] })
    g.state.zones[0].cards.b.push(sneak)
    const r = applyAction(g, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
      attackerIds: [atk.instanceId], targetIds: [def.instanceId, sneak.instanceId],
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.awaitingResponse).toMatchObject({ stealthyIds: [sneak.instanceId] })
    expect(r.game.state.activeBattle).toBeNull()
    expect(r.game.state.zones[0].lastActivatedTurn).toBeNull() // not spent yet
    // defender opts the stealthy ship out; battle locks with the rest
    const r2 = applyAction(r.game, 'bob', { type: 'RESPOND_TO_ATTACK', optOutIds: [sneak.instanceId] })
    if (!r2.ok) throw new Error(r2.error)
    expect(r2.game.state.activeBattle!.defenderIds).toEqual([def.instanceId])
    expect(r2.game.state.zones[0].lastActivatedTurn).toBe(3)
  })
  it('cancels without spending the activation when every defender opts out', () => {
    const { g, atk } = battleground()
    g.state.zones[0].cards.b = []
    const sneak = zoneEntry({ keywords: ['stealthy'] })
    g.state.zones[0].cards.b.push(sneak)
    const r = applyAction(g, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1, attackerIds: [atk.instanceId], targetIds: [sneak.instanceId],
    })
    if (!r.ok) throw new Error(r.error)
    const r2 = applyAction(r.game, 'bob', { type: 'RESPOND_TO_ATTACK', optOutIds: [sneak.instanceId] })
    if (!r2.ok) throw new Error(r2.error)
    expect(r2.game.state.awaitingResponse).toBeNull()
    expect(r2.game.state.activeBattle).toBeNull()
    expect(r2.game.state.zones[0].lastActivatedTurn).toBeNull()
    // attacker may activate the zone again (e.g. base attack)
  })
  it('only the defender may respond, and only non-stealthy opt-outs are rejected', () => {
    const { g, atk, def } = battleground()
    const sneak = zoneEntry({ keywords: ['stealthy'] })
    g.state.zones[0].cards.b.push(sneak)
    const r = applyAction(g, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
      attackerIds: [atk.instanceId], targetIds: [def.instanceId, sneak.instanceId],
    })
    if (!r.ok) throw new Error(r.error)
    expect(applyAction(r.game, 'alice', { type: 'RESPOND_TO_ATTACK', optOutIds: [] }))
      .toMatchObject({ ok: false, status: 403 })
    expect(applyAction(r.game, 'bob', { type: 'RESPOND_TO_ATTACK', optOutIds: [def.instanceId] }))
      .toMatchObject({ ok: false, status: 400 })
  })
})
