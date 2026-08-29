import { describe, expect, it } from 'vitest'
import { applyAction, declareForcedBattle } from './index'
import { inst, makeGame, zoneEntry } from './testFixtures'

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
  it('is unchanged by the setBattle/lockBattle/declareForcedBattle split — same stamp, same log line', () => {
    // Regression gate on the battleDeclare.ts refactor (spec §4.3, departure
    // 1): ATTACK_ENEMY_FLEET must still stamp lastActivatedTurn and still log
    // exactly "Fleet battle declared", byte-identical to before the split.
    const { g, atk, def } = battleground()
    const r = applyAction(g, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1, attackerIds: [atk.instanceId], targetIds: [def.instanceId],
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].lastActivatedTurn).toBe(3)
    expect(r.game.state.log).toContain(
      'Fleet battle declared in zone 1 — 1 vs 1. Fight it in From The Depths, then report results.',
    )
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
  it('rejects malformed (non-array) attacker/target selections instead of throwing', () => {
    const { g, def } = battleground()
    expect(applyAction(g, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1, attackerIds: {} as never, targetIds: [def.instanceId],
    })).toMatchObject({ ok: false, status: 400 })
    expect(applyAction(g, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1, attackerIds: [def.instanceId], targetIds: {} as never,
    })).toMatchObject({ ok: false, status: 400 })
  })
  it('rejects duplicate ids within a selection', () => {
    const { g, atk, def } = battleground()
    expect(applyAction(g, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
      attackerIds: [atk.instanceId, atk.instanceId], targetIds: [def.instanceId],
    })).toMatchObject({ ok: false, status: 400 })
    expect(applyAction(g, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
      attackerIds: [atk.instanceId], targetIds: [def.instanceId, def.instanceId],
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

describe('declareForcedBattle', () => {
  it('does not spend the zone activation — a subsequent ATTACK_ENEMY_FLEET there still succeeds', () => {
    const { g, atk, def } = battleground()
    const ok = declareForcedBattle(g, {
      zoneId: 1, aggressor: 'a', attackerIds: [atk.instanceId], defenderIds: [def.instanceId],
      cause: 'Eclipse',
    })
    expect(ok).toBe(true)
    expect(g.state.zones[0].lastActivatedTurn).toBeNull() // an implementation detail — the next line is the bug that matters
    // Simulate the forced battle having already been reported and resolved
    // (DECIDE_BATTLE_REPORT nulls activeBattle; that flow is covered by
    // battleResolve.test.ts). What's under test here is purely whether the
    // zone's activation survived a forced battle for a later ordinary attack.
    g.state.activeBattle = null
    const r = applyAction(g, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1, attackerIds: [atk.instanceId], targetIds: [def.instanceId],
    })
    expect(r.ok).toBe(true)
  })

  it('stamps lastActivatedTurn only when activatesZone is passed (Eclipse), and then a subsequent attack 409s', () => {
    const { g, atk, def } = battleground()
    const ok = declareForcedBattle(g, {
      zoneId: 1, aggressor: 'a', attackerIds: [atk.instanceId], defenderIds: [def.instanceId],
      cause: 'Eclipse', activatesZone: true,
    })
    expect(ok).toBe(true)
    expect(g.state.zones[0].lastActivatedTurn).toBe(3)
    g.state.activeBattle = null
    const r = applyAction(g, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1, attackerIds: [atk.instanceId], targetIds: [def.instanceId],
    })
    expect(r).toMatchObject({ ok: false, status: 409, error: 'That zone was already activated this turn' })
  })

  it('sets no alert card and never says "Fleet battle" — the log names the cause instead', () => {
    const { g, atk, def } = battleground()
    const ok = declareForcedBattle(g, {
      zoneId: 1, aggressor: 'a', attackerIds: [atk.instanceId], defenderIds: [def.instanceId],
      cause: 'Eclipse',
    })
    expect(ok).toBe(true)
    expect(g.state.alertCard).toBeNull()
    const lastLine = g.state.log.at(-1)
    expect(lastLine).toContain('Eclipse')
    expect(lastLine).not.toContain('Fleet battle')
    expect(lastLine).toContain('Fight it in From The Depths, then report results.')
  })

  it('places summons in activeBattle.summons (never zone.cards on either side) and carries the continuation', () => {
    const g = makeGame({ turnNumber: 3 })
    const def = zoneEntry({})
    g.state.zones[0].cards.b.push(def)
    const summon = zoneEntry({ name: 'Flying Squirrel', instanceId: 'summon-1' })
    const trebuchet = inst({ name: 'Trebuchet', instanceId: 'trebuchet-1' })
    const continuation = { effect: 'trebuchetEffect', side: 'a' as const, card: trebuchet }
    const ok = declareForcedBattle(g, {
      zoneId: 1, aggressor: 'a', attackerIds: [summon.instanceId], defenderIds: [def.instanceId],
      summons: [summon], continuation, cause: 'Flying Squirrel Attack',
    })
    expect(ok).toBe(true)
    expect(g.state.activeBattle?.summons).toEqual([summon])
    expect(g.state.activeBattle?.continuation).toEqual(continuation)
    expect(g.state.zones[0].cards.a).toHaveLength(0)
    expect(g.state.zones[0].cards.b).toEqual([def])
  })

  it('accepts a summon on the defending side too — membership decides the side, not a separate field', () => {
    const g = makeGame({ turnNumber: 3 })
    const atk = zoneEntry({})
    g.state.zones[0].cards.a.push(atk)
    const summonDefender = zoneEntry({ name: 'Parapet', instanceId: 'summon-def-1' })
    const ok = declareForcedBattle(g, {
      zoneId: 1, aggressor: 'a', attackerIds: [atk.instanceId], defenderIds: [summonDefender.instanceId],
      summons: [summonDefender], cause: 'The Onyx Throne',
    })
    expect(ok).toBe(true)
    expect(g.state.activeBattle?.defenderIds).toEqual([summonDefender.instanceId])
    expect(g.state.zones[0].cards.b).toHaveLength(0)
  })

  it('refuses an unknown zone', () => {
    const { g, def } = battleground()
    expect(declareForcedBattle(g, {
      zoneId: 99, aggressor: 'a', attackerIds: ['ghost'], defenderIds: [def.instanceId], cause: 'Eclipse',
    })).toBe(false)
  })

  it('refuses when a battle is already active', () => {
    const { g, atk, def } = battleground()
    g.state.activeBattle = {
      zoneId: 1, aggressor: 'a', attackerIds: [atk.instanceId], defenderIds: [def.instanceId],
      distanceM: 1200, distanceModifiedBy: [], summons: [], continuation: null,
    }
    expect(declareForcedBattle(g, {
      zoneId: 1, aggressor: 'a', attackerIds: [atk.instanceId], defenderIds: [def.instanceId], cause: 'Eclipse',
    })).toBe(false)
  })

  it('refuses an empty attacker list', () => {
    const { g, def } = battleground()
    expect(declareForcedBattle(g, {
      zoneId: 1, aggressor: 'a', attackerIds: [], defenderIds: [def.instanceId], cause: 'Eclipse',
    })).toBe(false)
  })

  it('refuses an empty defender list', () => {
    const { g, atk } = battleground()
    expect(declareForcedBattle(g, {
      zoneId: 1, aggressor: 'a', attackerIds: [atk.instanceId], defenderIds: [], cause: 'Eclipse',
    })).toBe(false)
  })

  it('refuses an attacker id that is neither on the aggressor\'s side nor among summons', () => {
    const { g, def } = battleground()
    expect(declareForcedBattle(g, {
      zoneId: 1, aggressor: 'a', attackerIds: ['ghost'], defenderIds: [def.instanceId], cause: 'Eclipse',
    })).toBe(false)
  })

  it('refuses a defender id that is neither on the defending side nor among summons', () => {
    const { g, atk } = battleground()
    expect(declareForcedBattle(g, {
      zoneId: 1, aggressor: 'a', attackerIds: [atk.instanceId], defenderIds: ['ghost'], cause: 'Eclipse',
    })).toBe(false)
  })
})
