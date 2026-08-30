import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { applyAction, declareForcedBattle, joinBattle } from './index'
import { registerEffect } from '../effects/registry'
import { inst, makeCtx, makeGame, zoneEntry } from './testFixtures'

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
    const ok = declareForcedBattle(g, makeCtx(), {
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
    const ok = declareForcedBattle(g, makeCtx(), {
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
    const ok = declareForcedBattle(g, makeCtx(), {
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
    const ok = declareForcedBattle(g, makeCtx(), {
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
    const ok = declareForcedBattle(g, makeCtx(), {
      zoneId: 1, aggressor: 'a', attackerIds: [atk.instanceId], defenderIds: [summonDefender.instanceId],
      summons: [summonDefender], cause: 'The Onyx Throne',
    })
    expect(ok).toBe(true)
    expect(g.state.activeBattle?.defenderIds).toEqual([summonDefender.instanceId])
    expect(g.state.zones[0].cards.b).toHaveLength(0)
  })

  it('refuses an unknown zone', () => {
    const { g, def } = battleground()
    expect(declareForcedBattle(g, makeCtx(), {
      zoneId: 99, aggressor: 'a', attackerIds: ['ghost'], defenderIds: [def.instanceId], cause: 'Eclipse',
    })).toBe(false)
  })

  it('refuses when a battle is already active', () => {
    const { g, atk, def } = battleground()
    g.state.activeBattle = {
      zoneId: 1, aggressor: 'a', attackerIds: [atk.instanceId], defenderIds: [def.instanceId],
      distanceM: 1200, distanceModifiedBy: [], summons: [], continuation: null,
    }
    expect(declareForcedBattle(g, makeCtx(), {
      zoneId: 1, aggressor: 'a', attackerIds: [atk.instanceId], defenderIds: [def.instanceId], cause: 'Eclipse',
    })).toBe(false)
  })

  it('refuses an empty attacker list', () => {
    const { g, def } = battleground()
    expect(declareForcedBattle(g, makeCtx(), {
      zoneId: 1, aggressor: 'a', attackerIds: [], defenderIds: [def.instanceId], cause: 'Eclipse',
    })).toBe(false)
  })

  it('refuses an empty defender list', () => {
    const { g, atk } = battleground()
    expect(declareForcedBattle(g, makeCtx(), {
      zoneId: 1, aggressor: 'a', attackerIds: [atk.instanceId], defenderIds: [], cause: 'Eclipse',
    })).toBe(false)
  })

  it('refuses an attacker id that is neither on the aggressor\'s side nor among summons', () => {
    const { g, def } = battleground()
    expect(declareForcedBattle(g, makeCtx(), {
      zoneId: 1, aggressor: 'a', attackerIds: ['ghost'], defenderIds: [def.instanceId], cause: 'Eclipse',
    })).toBe(false)
  })

  it('refuses a defender id that is neither on the defending side nor among summons', () => {
    const { g, atk } = battleground()
    expect(declareForcedBattle(g, makeCtx(), {
      zoneId: 1, aggressor: 'a', attackerIds: [atk.instanceId], defenderIds: ['ghost'], cause: 'Eclipse',
    })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Wave 4: DP2's lock dispatch, and joinBattle — the one function that appends
// to a battle already in progress.
// ---------------------------------------------------------------------------

interface LockFired { card: string; forced: boolean; isDefender: boolean; isParticipant: boolean }
let lockFired: LockFired[] = []

beforeAll(() => {
  registerEffect('t_declareSpy', ({ card, battle }) => {
    lockFired.push({
      card: card.name,
      forced: battle?.forced ?? false,
      isDefender: battle?.isDefender ?? false,
      isParticipant: battle?.isParticipant ?? false,
    })
    return true
  })
  // Joins the battle its own lock trigger was just told about, the way The
  // Onyx Throne does.
  registerEffect('t_joinSpy', ({ game, actor }) => {
    const hull = zoneEntry({ name: 'Joined' })
    return joinBattle(game, actor, hull.instanceId, hull)
  })
})

beforeEach(() => { lockFired = [] })

function spyEntry(name: string, effect = 't_declareSpy') {
  return zoneEntry({ name, meta: { onBattleEffect: effect } })
}

describe('DP2 lock dispatch', () => {
  it('fires for both sides on an ordinary fleet attack, with forced false', () => {
    const g = makeGame({ turnNumber: 3 })
    const atk = spyEntry('Attacker')
    const def = spyEntry('Defender')
    g.state.zones[0].cards.a.push(atk)
    g.state.zones[0].cards.b.push(def)
    const r = applyAction(g, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1, attackerIds: [atk.instanceId], targetIds: [def.instanceId],
    }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(lockFired).toEqual([
      { card: 'Attacker', forced: false, isDefender: false, isParticipant: true },
      { card: 'Defender', forced: false, isDefender: true, isParticipant: true },
    ])
  })

  // The window is not the lock: ATTACK_ENEMY_FLEET returns without a battle
  // when a Stealthy defender may still withdraw, so the trigger must wait for
  // RESPOND_TO_ATTACK to call lockBattle.
  it('fires only once the stealthy response resolves, not when the window opens', () => {
    const g = makeGame({ turnNumber: 3 })
    const atk = zoneEntry({})
    const def = spyEntry('Defender')
    def.keywords = ['stealthy']
    g.state.zones[0].cards.a.push(atk)
    g.state.zones[0].cards.b.push(def)
    const opened = applyAction(g, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1, attackerIds: [atk.instanceId], targetIds: [def.instanceId],
    }, makeCtx())
    if (!opened.ok) throw new Error(opened.error)
    expect(lockFired).toEqual([])
    const locked = applyAction(opened.game, 'bob', { type: 'RESPOND_TO_ATTACK', optOutIds: [] }, makeCtx())
    if (!locked.ok) throw new Error(locked.error)
    expect(lockFired).toEqual([{ card: 'Defender', forced: false, isDefender: true, isParticipant: true }])
  })

  it('fires with forced true from declareForcedBattle', () => {
    const g = makeGame({ turnNumber: 3 })
    const atk = zoneEntry({})
    const def = spyEntry('Defender')
    g.state.zones[0].cards.a.push(atk)
    g.state.zones[0].cards.b.push(def)
    expect(declareForcedBattle(g, makeCtx(), {
      zoneId: 1, aggressor: 'a', attackerIds: [atk.instanceId], defenderIds: [def.instanceId], cause: 'Eclipse',
    })).toBe(true)
    expect(lockFired).toEqual([{ card: 'Defender', forced: true, isDefender: true, isParticipant: true }])
  })

  it('does not fire when declareForcedBattle refuses', () => {
    const g = makeGame({ turnNumber: 3 })
    const def = spyEntry('Defender')
    g.state.zones[0].cards.b.push(def)
    expect(declareForcedBattle(g, makeCtx(), {
      zoneId: 1, aggressor: 'a', attackerIds: ['ghost'], defenderIds: [def.instanceId], cause: 'Eclipse',
    })).toBe(false)
    expect(lockFired).toEqual([])
  })
})

describe('joinBattle', () => {
  it('adds a summoned hull to the battle its own lock trigger was told about', () => {
    const g = makeGame({ turnNumber: 3 })
    const atk = zoneEntry({})
    const def = spyEntry('Defender', 't_joinSpy')
    g.state.zones[0].cards.a.push(atk)
    g.state.zones[0].cards.b.push(def)
    expect(declareForcedBattle(g, makeCtx(), {
      zoneId: 1, aggressor: 'a', attackerIds: [atk.instanceId], defenderIds: [def.instanceId], cause: 'Gang Up',
    })).toBe(true)
    const battle = g.state.activeBattle
    if (!battle) throw new Error('no battle')
    expect(battle.summons.map((s) => s.name)).toEqual(['Joined'])
    expect(battle.defenderIds).toHaveLength(2)
    expect(battle.defenderIds).toContain(battle.summons[0].instanceId)
  })

  it('adds an on-board hull by id alone, with no summon', () => {
    const g = makeGame({ turnNumber: 3 })
    const atk = zoneEntry({})
    const def = zoneEntry({})
    const helper = zoneEntry({ name: 'Helper' })
    g.state.zones[0].cards.a.push(atk)
    g.state.zones[0].cards.b.push(def, helper)
    declareForcedBattle(g, makeCtx(), {
      zoneId: 1, aggressor: 'a', attackerIds: [atk.instanceId], defenderIds: [def.instanceId], cause: 'Gang Up',
    })
    expect(joinBattle(g, 'b', helper.instanceId)).toBe(true)
    expect(g.state.activeBattle?.defenderIds).toEqual([def.instanceId, helper.instanceId])
    expect(g.state.activeBattle?.summons).toEqual([])
  })

  it('puts an aggressor-side joiner on the attacker list', () => {
    const g = makeGame({ turnNumber: 3 })
    const atk = zoneEntry({})
    const mate = zoneEntry({ name: 'Wingman' })
    const def = zoneEntry({})
    g.state.zones[0].cards.a.push(atk, mate)
    g.state.zones[0].cards.b.push(def)
    declareForcedBattle(g, makeCtx(), {
      zoneId: 1, aggressor: 'a', attackerIds: [atk.instanceId], defenderIds: [def.instanceId], cause: 'Gang Up',
    })
    expect(joinBattle(g, 'a', mate.instanceId)).toBe(true)
    expect(g.state.activeBattle?.attackerIds).toEqual([atk.instanceId, mate.instanceId])
  })

  it('refuses a duplicate, a missing battle, and an off-board id with no summon', () => {
    const g = makeGame({ turnNumber: 3 })
    const atk = zoneEntry({})
    const def = zoneEntry({})
    g.state.zones[0].cards.a.push(atk)
    g.state.zones[0].cards.b.push(def)
    expect(joinBattle(g, 'b', def.instanceId)).toBe(false) // no battle yet
    declareForcedBattle(g, makeCtx(), {
      zoneId: 1, aggressor: 'a', attackerIds: [atk.instanceId], defenderIds: [def.instanceId], cause: 'Gang Up',
    })
    expect(joinBattle(g, 'b', def.instanceId)).toBe(false) // already a combatant
    expect(joinBattle(g, 'b', 'ghost')).toBe(false) // not on the board, and no entry supplied
    expect(g.state.activeBattle?.defenderIds).toEqual([def.instanceId])
  })

  it('makes a joined summon visible to the battle report', () => {
    const g = makeGame({ turnNumber: 3 })
    const atk = zoneEntry({})
    const def = spyEntry('Defender', 't_joinSpy')
    g.state.zones[0].cards.a.push(atk)
    g.state.zones[0].cards.b.push(def)
    declareForcedBattle(g, makeCtx(), {
      zoneId: 1, aggressor: 'a', attackerIds: [atk.instanceId], defenderIds: [def.instanceId], cause: 'Gang Up',
    })
    const joined = g.state.activeBattle?.summons[0]
    if (!joined) throw new Error('nothing joined')
    // The report must cover exactly the participants — the joined summon among
    // them, or SUBMIT_BATTLE_REPORT rejects it as incomplete.
    const r = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 100, [def.instanceId]: 100, [joined.instanceId]: 100 },
      repairs: [],
    }, makeCtx())
    expect(r.ok).toBe(true)
  })
})
