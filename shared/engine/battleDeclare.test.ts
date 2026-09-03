import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  applyAction, declareForcedBattle, DEPLOY_ORDER_FIRST, DEPLOY_ORDER_LAST, deployOrderFor,
  joinBattle, normalizeState, OMISSION_UNLESS_SHIP_OR_TANK,
} from './index'
import { loadSeedData } from '../../supabase/seed/transform'
import { registerEffect } from '../effects/registry'
import type { ZoneCardEntry } from './engineTypes'
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
  // Same shape as t_joinSpy, but the joining hull ITSELF carries a
  // deployOrder directive. This is the fixture ruling R-WF-6 (commit
  // bd5d2b1) needs: a conflict that exists only in the roster AFTER this
  // join runs, never before it. See 'the deployment-order log line' below.
  registerEffect('t_joinOrderSpy', ({ game, actor }) => {
    const hull = zoneEntry({ name: 'Joined Directive', meta: { deployOrder: DEPLOY_ORDER_FIRST } })
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

// ---------------------------------------------------------------------------
// Wave 4: defender omission (spec §4.8). Buzzsaw and Veles print "this vehicle
// may be omitted from defensive battles unless the attacking enemy force
// contains a ship or tank" — a CONDITIONAL opt-out, which pending.stealthyIds
// has no room for, so awaitingResponse gains a second list.
// ---------------------------------------------------------------------------

// The constant, not the literal: a rename of its value must break this fixture
// rather than silently making every case below vacuous.
const omissible = (over: Partial<ZoneCardEntry> = {}) =>
  zoneEntry({ name: 'Buzzsaw', meta: { defensiveOmission: OMISSION_UNLESS_SHIP_OR_TANK }, ...over })

function attackWith(attackers: ZoneCardEntry[], targets: ZoneCardEntry[]) {
  const g = makeGame({ turnNumber: 3 })
  for (const a of attackers) g.state.zones[0].cards.a.push(a)
  for (const t of targets) g.state.zones[0].cards.b.push(t)
  const r = applyAction(g, 'alice', {
    type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
    attackerIds: attackers.map((a) => a.instanceId), targetIds: targets.map((t) => t.instanceId),
  }, makeCtx())
  if (!r.ok) throw new Error(r.error)
  return r.game
}

describe('defender omission', () => {
  it('lists a Buzzsaw as omissible against an all-plane attacking force', () => {
    const buzz = omissible()
    const out = attackWith([zoneEntry({ vehicleType: 'plane', playedOnTurn: 2 })], [buzz])
    expect(out.state.awaitingResponse?.omissibleIds).toEqual([buzz.instanceId])
    expect(out.state.awaitingResponse?.stealthyIds).toEqual([])
    expect(out.state.activeBattle).toBeNull() // the window opened; the battle has not locked
  })

  it('does not list it when the attacking force contains a ship', () => {
    const buzz = omissible()
    const out = attackWith([
      zoneEntry({ vehicleType: 'plane', playedOnTurn: 2 }),
      zoneEntry({ vehicleType: 'ship', playedOnTurn: 2 }),
    ], [buzz])
    expect(out.state.awaitingResponse).toBeNull()
    expect(out.state.activeBattle).not.toBeNull() // no window at all — it locks straight away
  })

  it('does not list it when the attacking force contains a tank', () => {
    const buzz = omissible()
    const out = attackWith([zoneEntry({ vehicleType: 'tank', playedOnTurn: 2 })], [buzz])
    expect(out.state.awaitingResponse).toBeNull()
  })

  // "Ship or tank", exactly — an airship is not a ship, however the word
  // reads, and a sub is not either. Both are pinned so a predicate widened to
  // any of the five vehicle types cannot pass.
  it('still lists it against an all-airship or all-sub force', () => {
    for (const vehicleType of ['airship', 'sub', 'plane']) {
      const buzz = omissible()
      const out = attackWith([zoneEntry({ vehicleType, playedOnTurn: 2 })], [buzz])
      expect({ vehicleType, ids: out.state.awaitingResponse?.omissibleIds })
        .toEqual({ vehicleType, ids: [buzz.instanceId] })
    }
  })

  // NO SEEDED CARD CARRIES `defensiveOmission` any more: Buzzsaw and Veles both
  // traded it for STEALTHY in the 2026-09-02 pass (spec §6.3), whose opt-out is
  // unconditional and therefore strictly wider.
  //
  // The RULE is kept — ATTACK_ENEMY_FLEET still computes omissibleIds,
  // RESPOND_TO_ATTACK still accepts an opt-out from that list, and
  // FleetAttackDialog still badges one — for the reason purifierEffect is kept
  // registered: an in-flight game dealt before this pass carries a frozen
  // Buzzsaw snapshot that still prints the key, and the opt-out has to keep
  // working for those hulls (spec R-8, §5).
  //
  // Asserted AT ZERO rather than deleted, so the next card to take the key has
  // to come back here and say so.
  it('no seeded card carries defensiveOmission, and the rule is kept for the next one', async () => {
    const { cards } = await loadSeedData()
    const carriers = cards.filter(
      (c) => c.isBuiltIn && (c.meta as Record<string, unknown> | undefined)?.defensiveOmission !== undefined,
    )
    expect(carriers.map((c) => c.name)).toEqual([])
  })

  // Spec §4.8: the "force" is the attacker's committed selection, not
  // everything they own in the zone. A hull sitting the battle out is not
  // attacking.
  it('reads the force as the selection, not the whole zone', () => {
    const g = makeGame({ turnNumber: 3 })
    const plane = zoneEntry({ vehicleType: 'plane', playedOnTurn: 2 })
    const benchedShip = zoneEntry({ vehicleType: 'ship', playedOnTurn: 2 })
    const buzz = omissible()
    g.state.zones[0].cards.a.push(plane, benchedShip)
    g.state.zones[0].cards.b.push(buzz)
    const r = applyAction(g, 'alice', {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
      attackerIds: [plane.instanceId], targetIds: [buzz.instanceId],
    }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.awaitingResponse?.omissibleIds).toEqual([buzz.instanceId])
  })

  it('opens the window on an omissible defender with no stealthy one present', () => {
    const buzz = omissible()
    const plain = zoneEntry({ name: 'Plain' })
    const out = attackWith([zoneEntry({ vehicleType: 'plane', playedOnTurn: 2 })], [buzz, plain])
    expect(out.state.awaitingResponse).not.toBeNull()
    expect(out.state.awaitingResponse?.targetIds).toHaveLength(2)
  })

  it('accepts an omissible opt-out and locks with the rest', () => {
    const buzz = omissible()
    const plain = zoneEntry({ name: 'Plain' })
    const out = attackWith([zoneEntry({ vehicleType: 'plane', playedOnTurn: 2 })], [buzz, plain])
    const r = applyAction(out, 'bob', { type: 'RESPOND_TO_ATTACK', optOutIds: [buzz.instanceId] }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.activeBattle?.defenderIds).toEqual([plain.instanceId])
  })

  it('rejects an opt-out that is in neither list', () => {
    const buzz = omissible()
    const plain = zoneEntry({ name: 'Plain' })
    const out = attackWith([zoneEntry({ vehicleType: 'plane', playedOnTurn: 2 })], [buzz, plain])
    expect(applyAction(out, 'bob', { type: 'RESPOND_TO_ATTACK', optOutIds: [plain.instanceId] }, makeCtx()))
      .toMatchObject({ ok: false, status: 400 })
  })

  it('accepts stealthy and omissible opt-outs together', () => {
    const buzz = omissible()
    const sneak = zoneEntry({ name: 'Sneak', keywords: ['stealthy'] })
    const plain = zoneEntry({ name: 'Plain' })
    const out = attackWith([zoneEntry({ vehicleType: 'plane', playedOnTurn: 2 })], [buzz, sneak, plain])
    const r = applyAction(out, 'bob', {
      type: 'RESPOND_TO_ATTACK', optOutIds: [buzz.instanceId, sneak.instanceId],
    }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.activeBattle?.defenderIds).toEqual([plain.instanceId])
  })

  it('calls the attack off without spending the activation when every defender sits out', () => {
    const buzz = omissible()
    const out = attackWith([zoneEntry({ vehicleType: 'plane', playedOnTurn: 2 })], [buzz])
    const r = applyAction(out, 'bob', { type: 'RESPOND_TO_ATTACK', optOutIds: [buzz.instanceId] }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.activeBattle).toBeNull()
    expect(r.game.state.zones[0].lastActivatedTurn).toBeNull()
  })

  // Spec §4.8: a forced battle skips the response window entirely, exactly as
  // it skips the Stealthy opt-out — the card forces the fight.
  it('is exempt from a forced battle, which locks immediately', () => {
    const g = makeGame({ turnNumber: 3 })
    const attacker = zoneEntry({ vehicleType: 'plane', playedOnTurn: 2 })
    const buzz = omissible()
    g.state.zones[0].cards.a.push(attacker)
    g.state.zones[0].cards.b.push(buzz)
    expect(declareForcedBattle(g, makeCtx(), {
      zoneId: 1, aggressor: 'a', attackerIds: [attacker.instanceId],
      defenderIds: [buzz.instanceId], cause: 'Gang Up',
    })).toBe(true)
    expect(g.state.awaitingResponse).toBeNull()
    expect(g.state.activeBattle?.defenderIds).toEqual([buzz.instanceId])
  })

  it('normalizeState defaults omissibleIds on a legacy awaitingResponse', () => {
    const g = makeGame()
    g.state.awaitingResponse = {
      zoneId: 1, aggressor: 'a', attackerIds: ['x'], targetIds: ['y'], stealthyIds: ['y'],
    } as NonNullable<typeof g.state.awaitingResponse>
    delete (g.state.awaitingResponse as unknown as Record<string, unknown>).omissibleIds
    normalizeState(g.state)
    expect(g.state.awaitingResponse?.omissibleIds).toEqual([])
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

// ---------------------------------------------------------------------------
// 2026-09-02 §4.3: battle deployment order. CONDUCT TEXT — every assertion
// below is about what is DERIVED and what is SAID, never about what the engine
// enforces, because the engine has no deployment-order concept and this pass
// does not give it one.
// ---------------------------------------------------------------------------
describe('deployOrderFor', () => {
  const carrier = (order: unknown, over: Partial<ZoneCardEntry> = {}) =>
    zoneEntry({ name: 'Veles', meta: { deployOrder: order }, ...over })

  it('returns null when no participant carries a directive', () => {
    expect(deployOrderFor([{ entry: zoneEntry({}), side: 'a' }])).toBeNull()
  })

  it("'first' on a side demands that side spawns first", () => {
    expect(deployOrderFor([{ entry: carrier(DEPLOY_ORDER_FIRST), side: 'b' }]))
      .toEqual({ firstSide: 'b', cancelled: false })
  })

  // Purifier prints "the enemy forces must spawn in first" — the same
  // statement Veles prints, seen from the other side. One key serves both, and
  // this is the assertion that says so.
  it("'last' on a side demands the OTHER side spawns first", () => {
    expect(deployOrderFor([{ entry: carrier(DEPLOY_ORDER_LAST), side: 'a' }]))
      .toEqual({ firstSide: 'b', cancelled: false })
  })

  it('cancels when two carriers demand opposite orders', () => {
    expect(deployOrderFor([
      { entry: carrier(DEPLOY_ORDER_FIRST), side: 'a' },
      { entry: carrier(DEPLOY_ORDER_FIRST), side: 'b' },
    ])).toEqual({ firstSide: null, cancelled: true })
  })

  // Ruling W-1. Anguish on side A says "A first"; Veles on side B says "A
  // first" too. Both sides carry a directive and nothing contradicts, so
  // nothing cancels — the spec's literal wording would have cancelled here.
  it('does not cancel when both sides carry directives that agree', () => {
    expect(deployOrderFor([
      { entry: carrier(DEPLOY_ORDER_FIRST), side: 'a' },
      { entry: carrier(DEPLOY_ORDER_LAST), side: 'b' },
    ])).toEqual({ firstSide: 'a', cancelled: false })
  })

  // Two Veles on one side is not a contradiction, and the directive does not
  // stack — there is only one order to spawn in.
  it('does not stack or cancel on two carriers of the same side', () => {
    expect(deployOrderFor([
      { entry: carrier(DEPLOY_ORDER_LAST), side: 'a' },
      { entry: carrier(DEPLOY_ORDER_LAST), side: 'a' },
    ])).toEqual({ firstSide: 'b', cancelled: false })
  })

  // A data key's VALUE is what this compares, and G2 checks only its PRESENCE
  // — so a mistyped one must leave the hull OUT rather than in, exactly as
  // `matches()` treats `metaFlag`. The trailing-space case is not hypothetical:
  // two seeded rows already carry trailing spaces in an effect name, which is
  // why `effectName` trims. This does NOT trim, matching its sibling
  // `defensiveOmission`; the seed-backed assertion in Task 3 is what catches it.
  it.each(['First', 'fist', 'last ', '', 'FIRST'])('ignores the mistyped value %s', (value) => {
    expect(deployOrderFor([{ entry: carrier(value), side: 'a' }])).toBeNull()
  })

  it.each([true, 1, null])('ignores the non-string value %s', (value) => {
    expect(deployOrderFor([{ entry: carrier(value), side: 'a' }])).toBeNull()
  })
})

describe('the deployment-order log line', () => {
  const carrier = (order: string, over: Partial<ZoneCardEntry> = {}) =>
    zoneEntry({ name: 'Directive', meta: { deployOrder: order }, ...over })
  const lines = (g: ReturnType<typeof attackWith>) =>
    g.state.log.filter((l) => l.includes('deployment-order directive'))

  it('is pushed once when the two fleets cancel', () => {
    const out = attackWith(
      [carrier(DEPLOY_ORDER_FIRST, { playedOnTurn: 2 })],
      [carrier(DEPLOY_ORDER_FIRST)],
    )
    expect(lines(out)).toHaveLength(1)
  })

  // An UNcancelled directive is deliberately silent here: it has a permanent
  // home in the spawn sheet both captains read while staging the fight
  // (BattleOverlay, Task 2). The cancellation is the case where that sheet
  // says "normal order" and the player whose card was answered would otherwise
  // never learn why.
  it('is not pushed when one side alone carries a directive', () => {
    const out = attackWith([zoneEntry({ playedOnTurn: 2 })], [carrier(DEPLOY_ORDER_LAST)])
    expect(lines(out)).toEqual([])
  })

  // Ruling R-WF-6 (commit bd5d2b1). noteDeployOrder MUST be derived from the
  // roster produced AFTER dispatchBattleLock, never before it — the ordering
  // is load-bearing, not stylistic, and THIS test is what pins it. Do not
  // "tidy" the noteDeployOrder(game) call back above dispatchBattleLock(...)
  // in lockBattle (or declareForcedBattle); this test fails the moment
  // someone does.
  //
  // t_joinOrderSpy (registered above, alongside t_joinSpy) mirrors a DP2 lock
  // trigger like The Onyx Throne's Parapet: it calls joinBattle from inside
  // dispatchBattleLock, pushing a freshly summoned hull onto
  // battle.attackerIds — exactly what lockRoster reads. That joined hull
  // carries its OWN 'first' directive, which conflicts with the defender's
  // 'first' directive already in play. The conflict exists ONLY in the
  // post-join roster: before the join, the attacker side carries no
  // directive at all, so deployOrderFor(lockRoster(game)) sees a single
  // demand and reports no cancellation.
  //
  // Derived before dispatchBattleLock (the pre-fix ordering), noteDeployOrder
  // reads that pre-join roster and stays silent — the bug: the spawn-sheet
  // panel (Task 2), which reads the roster fresh on demand, would say the
  // fleets cancel, while the log never explained why. Derived after (the
  // current, correct ordering), it sees both directives and cancels, and the
  // log line fires.
  it('cancels once a DP2-joined hull carries a directive that conflicts with the other side (R-WF-6)', () => {
    const trigger = zoneEntry({
      name: 'Trigger Hull', playedOnTurn: 2,
      meta: { onBattleEffect: 't_joinOrderSpy' },
    })
    const out = attackWith([trigger], [carrier(DEPLOY_ORDER_FIRST)])
    // Sanity check that the join actually happened: t_joinOrderSpy joins the
    // triggering hull's OWN side (the attacker here), so the roster grew from
    // 1 to 2 on that side before noteDeployOrder ever ran.
    expect(out.state.activeBattle?.attackerIds).toHaveLength(2)
    expect(lines(out)).toHaveLength(1)
  })

  // Same conflict, same fixture, but for declareForcedBattle's identical
  // R-WF-6 reorder (bd5d2b1) — attackWith cannot reach it, since
  // ATTACK_ENEMY_FLEET only ever calls lockBattle. Both call sites carry the
  // identical "never above the dispatch" comment and got the identical fix,
  // but until this test only lockBattle's copy had a test that failed when
  // reverted; reverting declareForcedBattle's ordering alone would have
  // passed the whole suite silently. Built directly, the way this file's
  // other declareForcedBattle tests are (e.g. 'fires with forced true from
  // declareForcedBattle' above): push the two hulls onto the zone, then call
  // declareForcedBattle(g, makeCtx(), spec) itself rather than going through
  // applyAction.
  it('cancels once a DP2-joined hull carries a directive that conflicts with the other side, via declareForcedBattle too (R-WF-6)', () => {
    const g = makeGame({ turnNumber: 3 })
    const trigger = zoneEntry({
      name: 'Trigger Hull', playedOnTurn: 2,
      meta: { onBattleEffect: 't_joinOrderSpy' },
    })
    const def = carrier(DEPLOY_ORDER_FIRST)
    g.state.zones[0].cards.a.push(trigger)
    g.state.zones[0].cards.b.push(def)
    const ok = declareForcedBattle(g, makeCtx(), {
      zoneId: 1, aggressor: 'a', attackerIds: [trigger.instanceId], defenderIds: [def.instanceId],
      cause: 'Eclipse',
    })
    expect(ok).toBe(true)
    // Same sanity check as the lockBattle test above: the join happened, so
    // the roster grew from 1 to 2 on the attacker side before noteDeployOrder
    // ever ran.
    expect(g.state.activeBattle?.attackerIds).toHaveLength(2)
    expect(lines(g)).toHaveLength(1)
  })
})
