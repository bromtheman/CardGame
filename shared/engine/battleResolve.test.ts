import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  applyAction, battleParticipants, declareForcedBattle, effectFor, joinBattle, repairCostOf,
} from './index'
import { registerEffect } from '../effects/registry.ts'
import type { ZoneCardEntry } from './engineTypes.ts'
import { inst, makeCtx, makeGame, zoneEntry } from './testFixtures'

function inBattle() {
  const g = makeGame({ turnNumber: 3 })
  const atk = zoneEntry({ playedOnTurn: 2, materialCost: 40000, name: 'Raider' })
  const def = zoneEntry({ materialCost: 60000, name: 'Bastion' })
  g.state.zones[0].cards.a.push(atk)
  g.state.zones[0].cards.b.push(def)
  g.state.activeBattle = {
    zoneId: 1, aggressor: 'a', attackerIds: [atk.instanceId],
    defenderIds: [def.instanceId], distanceM: 1200, distanceModifiedBy: [],
    summons: [], continuation: null,
  }
  g.state.zones[0].lastActivatedTurn = 3
  return { g, atk, def }
}

// A battle with an additional attacker-side battle summon (spec §4.4):
// exists only for this fight, never in zone.cards. Defaults to a fresh
// Martyr-flavoured entry; callers needing different HP/keywords override.
function inBattleWithSummon(over: Partial<ZoneCardEntry> = {}) {
  const { g, atk, def } = inBattle()
  const summon = zoneEntry({ name: 'Martyr', playedOnTurn: 3, materialCost: 20000, ...over })
  g.state.activeBattle!.summons.push(summon)
  g.state.activeBattle!.attackerIds.push(summon.instanceId)
  return { g, atk, def, summon }
}

describe('SUBMIT_BATTLE_REPORT', () => {
  it('stores a complete report from either participant', () => {
    const { g, atk, def } = inBattle()
    const r = applyAction(g, 'bob', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 95, [def.instanceId]: 40 }, repairs: [],
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.pendingReport).toMatchObject({ submittedBy: 'b' })
  })
  it('rejects duplicate repair ids', () => {
    const { g, atk, def } = inBattle()
    expect(applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 85, [def.instanceId]: 95 },
      repairs: [atk.instanceId, atk.instanceId],
    })).toMatchObject({ ok: false, status: 400 })
  })
  it('rejects a malformed (non-object) results body instead of throwing', () => {
    const { g } = inBattle()
    expect(applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT', results: null as never, repairs: [],
    })).toMatchObject({ ok: false, status: 400 })
    expect(applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT', results: [] as never, repairs: [],
    })).toMatchObject({ ok: false, status: 400 })
  })
  it('rejects a malformed (non-array) repairs list instead of throwing', () => {
    const { g, atk, def } = inBattle()
    expect(applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 95, [def.instanceId]: 40 }, repairs: {} as never,
    })).toMatchObject({ ok: false, status: 400 })
  })
  it('rejects incomplete or out-of-range results and illegal repairs', () => {
    const { g, atk, def } = inBattle()
    expect(applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT', results: { [atk.instanceId]: 95 }, repairs: [],
    })).toMatchObject({ ok: false, status: 400 })
    expect(applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 101, [def.instanceId]: 40 }, repairs: [],
    })).toMatchObject({ ok: false, status: 400 })
    expect(applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 40, [def.instanceId]: 95 }, repairs: [atk.instanceId],
    })).toMatchObject({ ok: false, status: 400 }) // 40 is below the repair window; atk is alice's own vehicle
  })
})

describe('DECIDE_BATTLE_REPORT', () => {
  it('only the non-submitter decides; reject clears the report but not the battle', () => {
    const { g, atk, def } = inBattle()
    const s = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 95, [def.instanceId]: 40 }, repairs: [],
    })
    if (!s.ok) throw new Error(s.error)
    expect(applyAction(s.game, 'alice', { type: 'DECIDE_BATTLE_REPORT', approve: true }))
      .toMatchObject({ ok: false, status: 403 })
    const rej = applyAction(s.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: false })
    if (!rej.ok) throw new Error(rej.error)
    expect(rej.game.state.pendingReport).toBeNull()
    expect(rej.game.state.activeBattle).not.toBeNull()
  })
  it('treats anything other than approve === true as a rejection', () => {
    const { g, atk, def } = inBattle()
    const s = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 95, [def.instanceId]: 40 }, repairs: [],
    })
    if (!s.ok) throw new Error(s.error)
    const r = applyAction(s.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: 'false' as never })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.pendingReport).toBeNull()
    expect(r.game.state.activeBattle).not.toBeNull()
  })
  it('approve applies thresholds: survive / destroy / repair', () => {
    const { g, atk, def } = inBattle()
    const scrapper = zoneEntry({ keywords: ['scrappy'], materialCost: 20000 })
    g.state.zones[0].cards.a.push(scrapper)
    g.state.activeBattle!.attackerIds.push(scrapper.instanceId)
    const s = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 85, [def.instanceId]: 70, [scrapper.instanceId]: 82 },
      repairs: [atk.instanceId, scrapper.instanceId],
    })
    if (!s.ok) throw new Error(s.error)
    const r = applyAction(s.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true })
    if (!r.ok) throw new Error(r.error)
    // atk repaired for ceil(40000*0.5)=20000; scrappy free; def destroyed
    expect(r.game.state.resources.a.materials).toBe(80000)
    expect(r.game.state.zones[0].cards.a).toHaveLength(2)
    expect(r.game.state.zones[0].cards.b).toHaveLength(0)
    expect(r.game.state.destroyed.b.map((c) => c.name)).toEqual(['Bastion'])
    expect(r.game.state.activeBattle).toBeNull()
    expect(r.game.state.pendingReport).toBeNull()
  })
  it('fragile cannot be repaired; unrepaired window vehicles are destroyed', () => {
    const { g, atk, def } = inBattle()
    const glass = zoneEntry({ keywords: ['fragile'], playedOnTurn: 2 })
    g.state.zones[0].cards.a.push(glass)
    g.state.activeBattle!.attackerIds.push(glass.instanceId)
    expect(applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 95, [def.instanceId]: 95, [glass.instanceId]: 85 },
      repairs: [glass.instanceId],
    })).toMatchObject({ ok: false, status: 400 }) // fragile can't be repaired
    const s = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 95, [def.instanceId]: 95, [glass.instanceId]: 85 },
      repairs: [],
    })
    if (!s.ok) throw new Error(s.error)
    const r = applyAction(s.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.destroyed.a.some((c) => c.cardId === glass.cardId)).toBe(true)
  })
  it('fails the approval when a controller cannot afford their repairs', () => {
    const { g, atk, def } = inBattle()
    g.state.resources.a.materials = 1000
    const s = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 85, [def.instanceId]: 95 }, repairs: [atk.instanceId],
    })
    if (!s.ok) throw new Error(s.error)
    expect(applyAction(s.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true }))
      .toMatchObject({ ok: false, status: 400 })
  })
})

describe('activatedOnTurn', () => {
  it('does not leak the stamp into the destroyed snapshot on a battle death', () => {
    const { g, atk, def } = inBattle()
    // def carries a spent activation stamp going into the battle — the
    // destroyed snapshot must drop it, the same way endTurn's Temporary
    // cull does (see gameEngine.test.ts), or it rides along through
    // state.destroyed and back into the deck via reshuffleDiscard.
    def.activatedOnTurn = 3
    const s = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 95, [def.instanceId]: 40 }, repairs: [],
    })
    if (!s.ok) throw new Error(s.error)
    const r = applyAction(s.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.destroyed.b).toHaveLength(1)
    const snapshot = r.game.state.destroyed.b[0]
    expect(snapshot).not.toHaveProperty('activatedOnTurn')
    expect(snapshot).not.toHaveProperty('playedOnTurn')
    expect(snapshot).not.toHaveProperty('movedOnTurn')
  })
})

describe('death triggers on report approval', () => {
  // The attacker (side a / Loggerhead's owner) dies while the DEFENDER
  // ('bob', side b) is the one approving — owner and approver deliberately
  // differ so a regression that threads the DECIDE actor's side instead of
  // the destroyed card's own side into the death-effect payload (`actor:
  // actor` instead of `actor: side`) fails this test: the free copy would
  // land in bob's deck instead of alice's.
  it("dispatches an implemented onDeathEffect (Loggerhead) into its OWNER's deck, not the approver's", () => {
    const { g, atk, def } = inBattle()
    atk.name = 'Loggerhead'
    atk.meta = { onDeathEffect: 'loggerheadOnDeath' }
    const s = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 40, [def.instanceId]: 95 }, repairs: [],
    })
    if (!s.ok) throw new Error(s.error)
    const r = applyAction(s.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.destroyed.a.map((c) => c.name)).toEqual(['Loggerhead'])
    expect(r.game.privates.a.deck).toHaveLength(1)
    const copy = r.game.privates.a.deck[0]
    expect(copy.name).toBe('Loggerhead')
    expect(copy.materialCost).toBe(0)
    expect(r.game.state.counts.a.deck).toBe(1)
    // the approver's (bob's / side b) deck must be untouched
    expect(r.game.privates.b.deck).toHaveLength(0)
    expect(r.game.state.counts.b.deck).toBe(0)
    expect(r.game.state.log.some((l) => l.includes('leaves a free copy'))).toBe(true)
  })

  it("logs a could-not-resolve note when an implemented onDeathEffect returns false — approval still succeeds", () => {
    registerEffect('testAlwaysFailOnDeath', () => false)
    const { g, atk, def } = inBattle()
    def.meta = { onDeathEffect: 'testAlwaysFailOnDeath' }
    const s = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 95, [def.instanceId]: 40 }, repairs: [],
    })
    if (!s.ok) throw new Error(s.error)
    const r = applyAction(s.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.destroyed.b).toHaveLength(1)
    expect(r.game.state.log.some((l) => l.includes("Bastion's death effect could not resolve"))).toBe(true)
  })

  it('silently skips an unimplemented onDeathEffect — approval still succeeds, no extra log line', () => {
    const { g, atk, def } = inBattle()
    // Synthetic, never-registered name — a real seeded name is fragile here:
    // once a later wave implements it for real, this test would silently
    // stop covering the unimplemented path. Matches the sibling pattern
    // ('testAlwaysFailOnDeath') just above.
    def.meta = { onDeathEffect: 'neverImplementedOnDeath' }
    const s = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 95, [def.instanceId]: 40 }, repairs: [],
    })
    if (!s.ok) throw new Error(s.error)
    const r = applyAction(s.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.destroyed.b).toHaveLength(1)
    expect(r.game.state.log.some((l) => l.includes('neverImplementedOnDeath'))).toBe(false)
    // Guards against passing vacuously: an implemented-but-failing effect
    // pushes this line (see the test above); an unimplemented one never does.
    expect(r.game.state.log.some((l) => l.includes('could not resolve'))).toBe(false)
  })

  it('a destroyed summon-only vehicle is not pushed to the discard', () => {
    const { g, atk, def } = inBattle()
    const martyr = zoneEntry({ name: 'Martyr', meta: { summonOnly: true }, playedOnTurn: 2 })
    g.state.zones[0].cards.a.push(martyr)
    g.state.activeBattle!.attackerIds.push(martyr.instanceId)
    const s = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 95, [def.instanceId]: 95, [martyr.instanceId]: 0 },
      repairs: [],
    })
    if (!s.ok) throw new Error(s.error)
    const r = applyAction(s.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a.some((c) => c.instanceId === martyr.instanceId)).toBe(false)
    expect(r.game.state.destroyed.a.some((c) => c.name === 'Martyr')).toBe(false)
    expect(r.game.state.log.join()).toContain('Martyr was destroyed')
  })
})

describe('repairCostOf', () => {
  it('is half material cost rounded up, free for scrappy', () => {
    expect(repairCostOf(zoneEntry({ materialCost: 41000 }))).toBe(20500)
    expect(repairCostOf(zoneEntry({ materialCost: 41001 }))).toBe(20501)
    expect(repairCostOf(zoneEntry({ materialCost: 90000, keywords: ['scrappy'] }))).toBe(0)
  })
})

describe('repair ownership', () => {
  it('rejects a submitter who tries to repair the other captain\'s vehicle', () => {
    const { g, atk, def } = inBattle()
    expect(applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 95, [def.instanceId]: 85 },
      repairs: [def.instanceId],
    })).toMatchObject({ ok: false, status: 400 })
  })

  it('accepts a submitter repairing their own vehicle', () => {
    const { g, atk, def } = inBattle()
    const r = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 85, [def.instanceId]: 95 },
      repairs: [atk.instanceId],
    })
    expect(r.ok).toBe(true)
  })

  it('lets the approver repair their own vehicle at decision time', () => {
    const { g, atk, def } = inBattle()
    const submitted = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 95, [def.instanceId]: 85 }, repairs: [],
    })
    if (!submitted.ok) throw new Error(submitted.error)
    const r = applyAction(submitted.game, 'bob', {
      type: 'DECIDE_BATTLE_REPORT', approve: true, repairs: [def.instanceId],
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.b).toHaveLength(1)
    expect(r.game.state.resources.b.materials).toBe(100000 - repairCostOf(def))
  })

  it('rejects an approver repairing the submitter\'s vehicle', () => {
    const { g, atk, def } = inBattle()
    const submitted = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 85, [def.instanceId]: 95 }, repairs: [],
    })
    if (!submitted.ok) throw new Error(submitted.error)
    expect(applyAction(submitted.game, 'bob', {
      type: 'DECIDE_BATTLE_REPORT', approve: true, repairs: [atk.instanceId],
    })).toMatchObject({ ok: false, status: 400 })
  })

  it('ignores a repairs array sent alongside a rejection', () => {
    const { g, atk, def } = inBattle()
    const submitted = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 85, [def.instanceId]: 95 }, repairs: [],
    })
    if (!submitted.ok) throw new Error(submitted.error)
    const r = applyAction(submitted.game, 'bob', {
      type: 'DECIDE_BATTLE_REPORT', approve: false, repairs: [atk.instanceId],
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.pendingReport).toBeNull()
  })
})

describe('Scrappy auto-repair', () => {
  function scrappyBattle() {
    const g = makeGame({ turnNumber: 3 })
    const atk = zoneEntry({ playedOnTurn: 2, materialCost: 40000, name: 'Raider', keywords: ['scrappy'] })
    const def = zoneEntry({ materialCost: 60000, name: 'Bastion' })
    g.state.zones[0].cards.a.push(atk)
    g.state.zones[0].cards.b.push(def)
    g.state.activeBattle = {
      zoneId: 1, aggressor: 'a', attackerIds: [atk.instanceId],
      defenderIds: [def.instanceId], distanceM: 1200, distanceModifiedBy: [],
      summons: [], continuation: null,
    }
    g.state.zones[0].lastActivatedTurn = 3
    return { g, atk, def }
  }

  it('survives an in-band Scrappy vehicle nobody listed, for free', () => {
    const { g, atk, def } = scrappyBattle()
    const submitted = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 85, [def.instanceId]: 95 }, repairs: [],
    })
    if (!submitted.ok) throw new Error(submitted.error)
    const r = applyAction(submitted.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a).toHaveLength(1)
    expect(r.game.state.resources.a.materials).toBe(100000)
  })

  it('charges nothing extra when the Scrappy vehicle was also listed explicitly', () => {
    const { g, atk, def } = scrappyBattle()
    const submitted = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 85, [def.instanceId]: 95 }, repairs: [atk.instanceId],
    })
    if (!submitted.ok) throw new Error(submitted.error)
    const r = applyAction(submitted.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.resources.a.materials).toBe(100000)
  })

  it('never auto-repairs a Fragile vehicle', () => {
    const g = makeGame({ turnNumber: 3 })
    const atk = zoneEntry({
      playedOnTurn: 2, materialCost: 40000, name: 'Blimp', keywords: ['scrappy', 'fragile'],
    })
    const def = zoneEntry({ materialCost: 60000, name: 'Bastion' })
    g.state.zones[0].cards.a.push(atk)
    g.state.zones[0].cards.b.push(def)
    g.state.activeBattle = {
      zoneId: 1, aggressor: 'a', attackerIds: [atk.instanceId],
      defenderIds: [def.instanceId], distanceM: 1200, distanceModifiedBy: [],
      summons: [], continuation: null,
    }
    g.state.zones[0].lastActivatedTurn = 3
    const submitted = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 85, [def.instanceId]: 95 }, repairs: [],
    })
    if (!submitted.ok) throw new Error(submitted.error)
    const r = applyAction(submitted.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a).toEqual([])
  })

  it('does not auto-repair a Scrappy vehicle outside the band', () => {
    const { g, atk, def } = scrappyBattle()
    const submitted = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 70, [def.instanceId]: 95 }, repairs: [],
    })
    if (!submitted.ok) throw new Error(submitted.error)
    const r = applyAction(submitted.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a).toEqual([])
  })
})

// A card taken out of the enemy deck (Marauder, Paddlegun, Plunderer) is only
// ever on loan: the raider gets to play it, but the hull belongs to the player
// who built the deck. Routing its death into the raider's discard instead
// would strip the card out of its owner's deck permanently — a steal every
// turn would grind the opponent's deck down to nothing.
function capturedInBattle() {
  const { g, atk, def } = inBattle()
  g.privates.b.deck.push(inst({ name: 'Ironclad', type: 'vehicle', materialCost: 60000 }))
  g.state.counts.b.deck = 1
  effectFor('marauderOnPlay')!({ game: g, actor: 'a', card: inst({ name: 'Marauder' }), ctx: makeCtx() })
  const stolen = zoneEntry({ ...g.privates.a.hand[0], playedOnTurn: 2 })
  g.privates.a.hand = []
  g.state.counts.a.hand = 0
  g.state.zones[0].cards.a.push(stolen)
  g.state.activeBattle!.attackerIds.push(stolen.instanceId)
  const s = applyAction(g, 'alice', {
    type: 'SUBMIT_BATTLE_REPORT',
    results: { [atk.instanceId]: 95, [def.instanceId]: 95, [stolen.instanceId]: 40 }, repairs: [],
  })
  if (!s.ok) throw new Error(s.error)
  const r = applyAction(s.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true }, makeCtx())
  if (!r.ok) throw new Error(r.error)
  return r.game
}

describe('captured cards', () => {
  it('destroys a copy killed in battle — it reaches neither discard', () => {
    const game = capturedInBattle()
    expect(game.state.destroyed.a).toHaveLength(0)
    expect(game.state.destroyed.b).toHaveLength(0)
  })

  it("leaves the raider's discount with the copy it died on", () => {
    const game = capturedInBattle()
    expect(game.state.destroyed.b).toHaveLength(0)
    expect(game.privates.b.deck[0].meta.costDelta).toBeUndefined()
  })

  it('never took the original, so its owner can still draw it', () => {
    const game = capturedInBattle()
    const r = applyAction(game, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    // bob's deck held only the Ironclad the whole time — the copy never
    // removed it, so it is still the card he draws
    expect(r.game.privates.b.hand.map((c) => c.name)).toEqual(['Ironclad'])
  })
})

describe('battle summons (spec §4.4)', () => {
  it('appears in participantsOf: SUBMIT_BATTLE_REPORT requires its ending HP', () => {
    const { g, atk, def, summon } = inBattleWithSummon()
    // Omitting the summon's id fails the completeness check, same as
    // omitting any other participant's.
    expect(applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 95, [def.instanceId]: 40 }, repairs: [],
    })).toMatchObject({ ok: false, status: 400 })
    const r = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 95, [def.instanceId]: 40, [summon.instanceId]: 0 }, repairs: [],
    })
    expect(r.ok).toBe(true)
  })

  it('evaporates a summon reported at 0% — never reaches the discard or the deck', () => {
    const { g, atk, def, summon } = inBattleWithSummon()
    const s = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 95, [def.instanceId]: 95, [summon.instanceId]: 0 }, repairs: [],
    })
    if (!s.ok) throw new Error(s.error)
    const r = applyAction(s.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true })
    if (!r.ok) throw new Error(r.error)
    // The behavioural claim, checked first: it never reaches discardCard, so
    // reshuffleDiscard can never feed it back into alice's deck as a
    // draftable card. (The zone.cards claim below would hold trivially
    // either way — a summon is never pushed there in the first place — so
    // it is not the assertion doing the real work.)
    expect(r.game.state.destroyed.a.some((c) => c.name === 'Martyr')).toBe(false)
    expect(r.game.state.zones[0].cards.a.some((c) => c.instanceId === summon.instanceId)).toBe(false)
  })

  it('evaporates a summon reported at 100% too — gone regardless of HP', () => {
    const { g, atk, def, summon } = inBattleWithSummon()
    const s = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 95, [def.instanceId]: 95, [summon.instanceId]: 100 }, repairs: [],
    })
    if (!s.ok) throw new Error(s.error)
    const r = applyAction(s.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.destroyed.a.some((c) => c.name === 'Martyr')).toBe(false)
    expect(r.game.state.zones[0].cards.a.some((c) => c.instanceId === summon.instanceId)).toBe(false)
    expect(r.game.state.log).toContain('1 summoned vehicle(s) evaporated')
  })

  it('rejects a summon id in repairs — from the submitter and from the approver', () => {
    const { g, atk, def, summon } = inBattleWithSummon()
    const submitAttempt = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 85, [def.instanceId]: 95, [summon.instanceId]: 85 },
      repairs: [summon.instanceId],
    })
    expect(submitAttempt).toMatchObject({ ok: false, status: 400 })
    if (!submitAttempt.ok) expect(submitAttempt.error).toContain('summoned vehicle')

    const s = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 85, [def.instanceId]: 95, [summon.instanceId]: 85 }, repairs: [],
    })
    if (!s.ok) throw new Error(s.error)
    // bob (the approver, and not even the summon's owner) tries to list it —
    // rejected for being a summon before ownership is ever considered.
    const decideAttempt = applyAction(s.game, 'bob', {
      type: 'DECIDE_BATTLE_REPORT', approve: true, repairs: [summon.instanceId],
    })
    expect(decideAttempt).toMatchObject({ ok: false, status: 400 })
    if (!decideAttempt.ok) expect(decideAttempt.error).toContain('summoned vehicle')
  })

  it('does not auto-repair a Scrappy summon in the repair band, and does not charge its owner', () => {
    const { g, atk, def, summon } = inBattleWithSummon({ keywords: ['scrappy'] })
    const s = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 95, [def.instanceId]: 95, [summon.instanceId]: 85 }, repairs: [],
    })
    if (!s.ok) throw new Error(s.error)
    const r = applyAction(s.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true })
    if (!r.ok) throw new Error(r.error)
    // The behavioural claim, checked first: no "was repaired" line for it.
    // autoRepairIds() is only ever handed the non-summon roster (Step 5 of
    // the brief reverts exactly that filter and watches this go red).
    expect(r.game.state.log.some((l) => l.includes('Martyr') && l.includes('repaired'))).toBe(false)
    expect(r.game.state.resources.a.materials).toBe(100000)
  })

  it('never charges materials for a summon id in the owed loop, even if it slipped past validateRepairChoices', () => {
    // validateRepairChoices rejects a summon id in repairs (400) whenever a
    // report is submitted through the normal action API, so this path is not
    // reachable that way. To test the owed loop's OWN guard in isolation —
    // the defense-in-depth the brief's review asked for — construct a stored
    // pendingReport directly, as if an earlier validation step already had a
    // bug and let a summon id through into report.repairs. report.repairs is
    // never re-validated at DECIDE time (only the approver's own list is),
    // so this is the realistic shape a regression there would take.
    const { g, atk, def, summon } = inBattleWithSummon({ materialCost: 80000 }) // non-Scrappy: real repair cost
    g.state.pendingReport = {
      submittedBy: 'a',
      results: { [atk.instanceId]: 95, [def.instanceId]: 95, [summon.instanceId]: 85 },
      repairs: [summon.instanceId],
    }
    const r = applyAction(g, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true })
    if (!r.ok) throw new Error(r.error)
    // The behavioural claim: alice is not charged repairCostOf(summon)
    // (ceil(80000 * 0.5) = 40000) for a hull that evaporates regardless.
    expect(r.game.state.resources.a.materials).toBe(100000)
  })

  it('does not fire an onDeathEffect a summon carries', () => {
    // Synthetic t_-prefixed name — a real seeded onDeathEffect would stop
    // testing anything the day it gets implemented for real.
    registerEffect('t_summonMartyrOnDeath', ({ game }) => {
      game.state.log.push('t_summonMartyrOnDeath fired')
      return true
    })
    const { g, atk, def, summon } = inBattleWithSummon({ meta: { onDeathEffect: 't_summonMartyrOnDeath' } })
    const s = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 95, [def.instanceId]: 95, [summon.instanceId]: 0 }, repairs: [],
    })
    if (!s.ok) throw new Error(s.error)
    const r = applyAction(s.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.log.some((l) => l.includes('t_summonMartyrOnDeath fired'))).toBe(false)
  })

  it('excludes summons from the "N vehicle(s) lost" count', () => {
    const { g, atk, def, summon } = inBattleWithSummon()
    const s = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      // def (a real vehicle) dies too, so a count that wrongly included the
      // summon would read 2.
      results: { [atk.instanceId]: 95, [def.instanceId]: 40, [summon.instanceId]: 0 }, repairs: [],
    })
    if (!s.ok) throw new Error(s.error)
    const r = applyAction(s.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.log).toContain('Battle resolved — 1 vehicle(s) lost')
  })

  it('invokes the continuation after approval — after death triggers, with data intact, battle fully cleared', () => {
    registerEffect('t_battleDeathMarker', ({ game }) => {
      game.state.log.push('t_battleDeathMarker fired')
      return true
    })
    registerEffect('t_battleContinuation', (payload) => {
      payload.game.state.log.push(`t_battleContinuation fired data=${JSON.stringify(payload.continuation?.data)}`)
      return true
    })
    // A summon rides along in the same battle so the final activeBattle-null
    // check below means something: this is the one test where a summon, a
    // real death trigger, AND a continuation are all live at once, so a
    // regression that left any of them half-handled has somewhere to show up
    // (a stray zone.cards entry, a stray log line, or activeBattle staying
    // non-null) rather than the field simply being null because nothing
    // interesting happened.
    const { g, atk, def, summon } = inBattleWithSummon()
    def.meta = { onDeathEffect: 't_battleDeathMarker' }
    const trebuchet = inst({ name: 'Trebuchet' })
    g.state.activeBattle!.continuation = {
      effect: 't_battleContinuation', side: 'a', card: trebuchet, data: { again: true },
    }
    const s = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 95, [def.instanceId]: 40, [summon.instanceId]: 50 }, repairs: [],
    })
    if (!s.ok) throw new Error(s.error)
    const r = applyAction(s.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.log).toContain('t_battleContinuation fired data={"again":true}')
    const deathIdx = r.game.state.log.findIndex((l) => l.includes('t_battleDeathMarker fired'))
    const contIdx = r.game.state.log.findIndex((l) => l.includes('t_battleContinuation fired'))
    expect(deathIdx).toBeGreaterThanOrEqual(0)
    expect(contIdx).toBeGreaterThan(deathIdx)
    expect(r.game.state.zones[0].cards.a.some((c) => c.instanceId === summon.instanceId)).toBe(false)
    expect(r.game.state.activeBattle).toBeNull()
  })

  it('drops a continuation whose effect is no longer registered, logging rather than throwing', () => {
    const { g, atk, def } = inBattle()
    const ghost = inst({ name: 'Ghost Rider' })
    g.state.activeBattle!.continuation = { effect: 't_neverRegisteredBattleContinuation', side: 'a', card: ghost }
    const s = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 95, [def.instanceId]: 40 }, repairs: [],
    })
    if (!s.ok) throw new Error(s.error)
    expect(() => applyAction(s.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true })).not.toThrow()
    const r = applyAction(s.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.log.some((l) => l.includes('Ghost Rider') && l.includes('dropped'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Wave 4: DP2 at resolve. It sits after the death triggers — so Iron Cordon
// can see a destroyed airship already in state.destroyed — and before the
// continuation, so Trebuchet still runs last (spec §4.3, DP2 departures 4-7).
// ---------------------------------------------------------------------------

interface ResolveFired { card: string; effect: string; survived: boolean; won: boolean; isDefender: boolean }
let resolveFired: ResolveFired[] = []

beforeAll(() => {
  for (const name of ['t_resolveEffect', 't_resolveWin', 't_resolveLose']) {
    registerEffect(name, ({ card, battle }) => {
      resolveFired.push({
        card: card.name, effect: name,
        survived: battle?.survived ?? false,
        won: battle?.won ?? false,
        isDefender: battle?.isDefender ?? false,
      })
      return true
    })
  }
  registerEffect('t_resolveOrder', ({ game, card }) => {
    game.state.log.push(`battle-trigger:${card.name}`)
    return true
  })
  registerEffect('t_deathOrder', ({ game, card }) => {
    game.state.log.push(`death:${card.name}`)
    return true
  })
  registerEffect('t_continuationOrder', ({ game, card }) => {
    game.state.log.push(`continuation:${card.name}`)
    return true
  })
  registerEffect('t_resolveFails', () => false)
})

beforeEach(() => { resolveFired = [] })

const battleMeta = {
  onBattleEffect: 't_resolveEffect',
  onBattleVictory: 't_resolveWin',
  onBattleDefeat: 't_resolveLose',
}

// Both combatants carry all three DP2 keys, so a single fixture shows which
// key each side actually receives.
function triggeringBattle() {
  const g = makeGame({ turnNumber: 3 })
  const atk = zoneEntry({ playedOnTurn: 2, name: 'Raider', meta: { ...battleMeta } })
  const def = zoneEntry({ name: 'Bastion', meta: { ...battleMeta } })
  g.state.zones[0].cards.a.push(atk)
  g.state.zones[0].cards.b.push(def)
  g.state.activeBattle = {
    zoneId: 1, aggressor: 'a', attackerIds: [atk.instanceId],
    defenderIds: [def.instanceId], distanceM: 1200, distanceModifiedBy: [],
    summons: [], continuation: null,
  }
  g.state.zones[0].lastActivatedTurn = 3
  return { g, atk, def }
}

function settle(g: ReturnType<typeof triggeringBattle>['g'], results: Record<string, number>) {
  const s = applyAction(g, 'alice', { type: 'SUBMIT_BATTLE_REPORT', results, repairs: [] }, makeCtx())
  if (!s.ok) throw new Error(s.error)
  const r = applyAction(s.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true }, makeCtx())
  if (!r.ok) throw new Error(r.error)
  return r.game
}

describe('DP2 at battle resolve', () => {
  it('gives victory to the winner, defeat to the loser, and onBattleEffect to both', () => {
    const { g, atk, def } = triggeringBattle()
    settle(g, { [atk.instanceId]: 95, [def.instanceId]: 10 })
    const pairs = resolveFired.map((f) => `${f.card}:${f.effect}`)
    expect(pairs).toContain('Raider:t_resolveEffect')
    expect(pairs).toContain('Raider:t_resolveWin')
    expect(pairs).toContain('Bastion:t_resolveEffect')
    expect(pairs).toContain('Bastion:t_resolveLose')
    expect(pairs).not.toContain('Raider:t_resolveLose')
    expect(pairs).not.toContain('Bastion:t_resolveWin')
  })

  it('reports survived per participant and isDefender per side', () => {
    const { g, atk, def } = triggeringBattle()
    settle(g, { [atk.instanceId]: 95, [def.instanceId]: 10 })
    const raiderEffect = resolveFired.find((f) => f.card === 'Raider' && f.effect === 't_resolveEffect')
    const bastionEffect = resolveFired.find((f) => f.card === 'Bastion' && f.effect === 't_resolveEffect')
    expect(raiderEffect).toMatchObject({ survived: true, won: true, isDefender: false })
    expect(bastionEffect).toMatchObject({ survived: false, won: false, isDefender: true })
  })

  it('sends neither victory nor defeat on a draw', () => {
    const { g, atk, def } = triggeringBattle()
    settle(g, { [atk.instanceId]: 95, [def.instanceId]: 95 })
    const pairs = resolveFired.map((f) => f.effect)
    expect(pairs).toEqual(['t_resolveEffect', 't_resolveEffect'])
  })

  // A repaired survivor is a survivor: the win test reads the same predicate
  // the destruction loop does, repairs included.
  it('counts a repaired hull as a survivor, denying the enemy the win', () => {
    const { g, atk, def } = triggeringBattle()
    g.state.zones[0].cards.b[0].keywords = ['scrappy'] // auto-repairs free in the 80-90 band
    settle(g, { [atk.instanceId]: 95, [def.instanceId]: 85 })
    const raiderEffect = resolveFired.find((f) => f.card === 'Raider' && f.effect === 't_resolveEffect')
    expect(raiderEffect?.won).toBe(false)
  })

  it('runs after the death triggers and before the continuation', () => {
    const g = makeGame({ turnNumber: 3 })
    const atk = zoneEntry({
      playedOnTurn: 2, name: 'Raider', meta: { onBattleEffect: 't_resolveOrder' },
    })
    const def = zoneEntry({
      name: 'Bastion', meta: { onDeathEffect: 't_deathOrder', onBattleEffect: 't_resolveOrder' },
    })
    g.state.zones[0].cards.a.push(atk)
    g.state.zones[0].cards.b.push(def)
    g.state.activeBattle = {
      zoneId: 1, aggressor: 'a', attackerIds: [atk.instanceId],
      defenderIds: [def.instanceId], distanceM: 1200, distanceModifiedBy: [],
      summons: [],
      continuation: { effect: 't_continuationOrder', side: 'a', card: inst({ name: 'Trebuchet' }) },
    }
    const out = settle(g, { [atk.instanceId]: 95, [def.instanceId]: 10 })
    const at = (needle: string) => out.state.log.findIndex((l) => l.startsWith(needle))
    expect(at('death:Bastion')).toBeGreaterThanOrEqual(0)
    expect(at('battle-trigger:Raider')).toBeGreaterThan(at('death:Bastion'))
    expect(at('continuation:Trebuchet')).toBeGreaterThan(at('battle-trigger:Raider'))
  })

  it('logs a note for a failing battle trigger without rejecting the approved report', () => {
    const g = makeGame({ turnNumber: 3 })
    const atk = zoneEntry({ playedOnTurn: 2, name: 'Raider', meta: { onBattleEffect: 't_resolveFails' } })
    const def = zoneEntry({ name: 'Bastion' })
    g.state.zones[0].cards.a.push(atk)
    g.state.zones[0].cards.b.push(def)
    g.state.activeBattle = {
      zoneId: 1, aggressor: 'a', attackerIds: [atk.instanceId],
      defenderIds: [def.instanceId], distanceM: 1200, distanceModifiedBy: [],
      summons: [], continuation: null,
    }
    const out = settle(g, { [atk.instanceId]: 95, [def.instanceId]: 10 })
    expect(out.state.log.some((l) => l.includes('Raider') && l.includes('could not resolve'))).toBe(true)
    expect(out.state.zones[0].cards.b).toHaveLength(0) // the report still applied
  })

  // A destroyed hull is gone from zone.cards by the time DP2 runs, but the
  // participants map still holds its entry — which is what lets Iron Cordon
  // and Sacrilego revive one.
  it('still dispatches for a participant that was destroyed', () => {
    const { g, atk, def } = triggeringBattle()
    settle(g, { [atk.instanceId]: 95, [def.instanceId]: 10 })
    expect(resolveFired.some((f) => f.card === 'Bastion' && !f.survived)).toBe(true)
  })
})

// ===========================================================================
// Wave 6 — WF Purifier's per-zone, per-side battle-loss record.
//
// "This ship can only be played into a zone in which you have lost a fleet
// battle the previous turn." DECIDE_BATTLE_REPORT already computes wonBy for
// both sides; this is where that becomes durable state legalZonesFor can read.
// ===========================================================================

describe('lostBattleOnTurn — the record DECIDE_BATTLE_REPORT writes', () => {
  const resolve = (results: Record<string, number>, g: ReturnType<typeof inBattle>['g']) => {
    const submitted = applyAction(g, 'alice', { type: 'SUBMIT_BATTLE_REPORT', results, repairs: [] }, makeCtx())
    if (!submitted.ok) throw new Error(submitted.error)
    const decided = applyAction(submitted.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true }, makeCtx())
    if (!decided.ok) throw new Error(decided.error)
    return decided.game
  }

  it('stamps the losing side with the turn the battle resolved on', () => {
    const { g, atk, def } = inBattle()
    const after = resolve({ [atk.instanceId]: 100, [def.instanceId]: 0 }, g)
    expect(after.state.zones[0].lostBattleOnTurn).toEqual({ a: null, b: 3 })
  })

  it('stamps the aggressor when the aggressor is the one wiped out', () => {
    const { g, atk, def } = inBattle()
    const after = resolve({ [atk.instanceId]: 0, [def.instanceId]: 100 }, g)
    expect(after.state.zones[0].lostBattleOnTurn).toEqual({ a: 3, b: null })
  })

  it('records nothing on a draw — both sides kept a survivor', () => {
    const { g, atk, def } = inBattle()
    const after = resolve({ [atk.instanceId]: 100, [def.instanceId]: 100 }, g)
    expect(after.state.zones[0].lostBattleOnTurn).toEqual({ a: null, b: null })
  })

  it('records nothing when BOTH sides are wiped — each side lost, so each is stamped', () => {
    const { g, atk, def } = inBattle()
    const after = resolve({ [atk.instanceId]: 0, [def.instanceId]: 0 }, g)
    expect(after.state.zones[0].lostBattleOnTurn).toEqual({ a: 3, b: 3 })
  })

  it('records only in the zone the battle was fought in', () => {
    const { g, atk, def } = inBattle()
    const after = resolve({ [atk.instanceId]: 100, [def.instanceId]: 0 }, g)
    expect(after.state.zones[1].lostBattleOnTurn).toEqual({ a: null, b: null })
    expect(after.state.zones[2].lostBattleOnTurn).toEqual({ a: null, b: null })
  })

  // Ruling C-6 (spec §7.3, wave 6). §7.3's Catshark ruling already settles
  // that a battle is a battle whatever declared it; this is the same rule
  // reaching the loss record. Everything that resolves through
  // DECIDE_BATTLE_REPORT counts, which keeps the rule honest: if it resolved
  // as a battle, it WAS one.
  it('records a FORCED battle the same as a declared one', () => {
    const { g, atk, def } = inBattle()
    // A forced battle differs only in never having stamped the zone.
    g.state.zones[0].lastActivatedTurn = null
    const after = resolve({ [atk.instanceId]: 100, [def.instanceId]: 0 }, g)
    expect(after.state.zones[0].lostBattleOnTurn.b).toBe(3)
    expect(after.state.zones[0].lastActivatedTurn).toBeNull()
  })

  it('overwrites an older record rather than keeping the first', () => {
    const { g, atk, def } = inBattle()
    g.state.zones[0].lostBattleOnTurn = { a: null, b: 1 }
    const after = resolve({ [atk.instanceId]: 100, [def.instanceId]: 0 }, g)
    expect(after.state.zones[0].lostBattleOnTurn.b).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// The battle roster, exported so there is exactly ONE of it.
//
// ⚠ THIS EXISTS BECAUSE OF A LIVE BUG. BattleOverlay.tsx used to carry a
// hand-written MIRROR of participantsOf, with a comment warning that "a
// divergence here would silently show a different battle than the engine
// resolves". Wave 7 added a board-wide fallback to the engine's copy for TG
// Duel's cross-zone battle and did not update the mirror — so a duelled
// away-zone hull was missing from the overlay AND from the report the overlay
// builds, which the engine then rejected as not covering every vehicle. The
// battle could never be reported and the game was stuck.
//
// The frontend now imports this function instead of mirroring it.
describe('battleParticipants — one roster, shared with the frontend', () => {
  const split = () => {
    const game = makeGame({ turnNumber: 3, activePlayer: 'alice' })
    game.state.zones[1].cards.a.push(zoneEntry({
      instanceId: 'obelisk', name: 'Obelisk', keywords: ['stealthy'], playedOnTurn: 1,
    }))
    game.state.zones[2].cards.b.push(zoneEntry({
      instanceId: 'raker', name: 'Earth Raker', playedOnTurn: 1,
    }))
    return game
  }

  it('includes an away-zone defender', () => {
    const game = split()
    if (!declareForcedBattle(game, makeCtx(), {
      zoneId: 2, aggressor: 'a', attackerIds: ['obelisk'], defenderIds: ['raker'],
      cause: 'Duel', crossZone: true,
    })) throw new Error('battle not declared')
    const roster = battleParticipants(game.state)
    expect([...roster.keys()].sort()).toEqual(['obelisk', 'raker'])
    expect(roster.get('raker')?.side).toBe('b')
    expect(roster.get('raker')?.entry.name).toBe('Earth Raker')
  })

  it('still resolves an ordinary single-zone battle unchanged', () => {
    const game = makeGame({ turnNumber: 3, activePlayer: 'alice' })
    game.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'mine', name: 'Mine', playedOnTurn: 1 }))
    game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'theirs', name: 'Theirs', playedOnTurn: 1 }))
    declareForcedBattle(game, makeCtx(), {
      zoneId: 1, aggressor: 'a', attackerIds: ['mine'], defenderIds: ['theirs'], cause: 'Test',
    })
    const roster = battleParticipants(game.state)
    expect([...roster.keys()].sort()).toEqual(['mine', 'theirs'])
  })

  // The whole point: the report the frontend builds must cover exactly what
  // the engine resolves, or SUBMIT_BATTLE_REPORT 400s and the game is stuck.
  it('covers exactly what SUBMIT_BATTLE_REPORT demands, cross-zone', () => {
    const game = split()
    declareForcedBattle(game, makeCtx(), {
      zoneId: 2, aggressor: 'a', attackerIds: ['obelisk'], defenderIds: ['raker'],
      cause: 'Duel', crossZone: true,
    })
    const results = Object.fromEntries([...battleParticipants(game.state).keys()].map((id) => [id, 100]))
    const r = applyAction(game, 'alice', { type: 'SUBMIT_BATTLE_REPORT', results, repairs: [] }, makeCtx())
    expect(r).toMatchObject({ ok: true })
  })

  it('still finds battle summons, which are in no zone at all', () => {
    const game = split()
    declareForcedBattle(game, makeCtx(), {
      zoneId: 2, aggressor: 'a', attackerIds: ['obelisk'], defenderIds: ['raker'],
      cause: 'Duel', crossZone: true,
    })
    const swarm = zoneEntry({ instanceId: 'swarm1', name: 'Mirth Swarm', playedOnTurn: 3 })
    joinBattle(game, 'a', 'swarm1', swarm)
    const roster = battleParticipants(game.state)
    expect(roster.get('swarm1')?.side).toBe('a')
    expect([...roster.keys()].sort()).toEqual(['obelisk', 'raker', 'swarm1'])
  })
})
