import { describe, expect, it } from 'vitest'
import { applyAction, repairCostOf } from './index'
import { makeCtx, makeGame, zoneEntry } from './testFixtures'

function inBattle() {
  const g = makeGame({ turnNumber: 3 })
  const atk = zoneEntry({ playedOnTurn: 2, materialCost: 40000, name: 'Raider' })
  const def = zoneEntry({ materialCost: 60000, name: 'Bastion' })
  g.state.zones[0].cards.a.push(atk)
  g.state.zones[0].cards.b.push(def)
  g.state.activeBattle = {
    zoneId: 1, aggressor: 'a', attackerIds: [atk.instanceId],
    defenderIds: [def.instanceId], distanceM: 1200, distanceModifiedBy: [],
  }
  g.state.zones[0].lastActivatedTurn = 3
  return { g, atk, def }
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
      results: { [atk.instanceId]: 95, [def.instanceId]: 40 }, repairs: [def.instanceId],
    })).toMatchObject({ ok: false, status: 400 }) // 40 is below the repair window
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

describe('death triggers on report approval', () => {
  it('dispatches an implemented onDeathEffect (Loggerhead) for a destroyed vehicle', () => {
    const { g, atk, def } = inBattle()
    def.name = 'Loggerhead'
    def.meta = { onDeathEffect: 'loggerheadOnDeath' }
    const s = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 95, [def.instanceId]: 40 }, repairs: [],
    })
    if (!s.ok) throw new Error(s.error)
    const r = applyAction(s.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.destroyed.b.map((c) => c.name)).toEqual(['Loggerhead'])
    expect(r.game.privates.b.deck).toHaveLength(1)
    const copy = r.game.privates.b.deck[0]
    expect(copy.name).toBe('Loggerhead')
    expect(copy.materialCost).toBe(0)
    expect(r.game.state.counts.b.deck).toBe(1)
    expect(r.game.state.log.some((l) => l.includes('leaves a free copy'))).toBe(true)
  })

  it('silently skips an unimplemented onDeathEffect — approval still succeeds, no extra log line', () => {
    const { g, atk, def } = inBattle()
    def.meta = { onDeathEffect: 'conduitEffect' }
    const s = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 95, [def.instanceId]: 40 }, repairs: [],
    })
    if (!s.ok) throw new Error(s.error)
    const r = applyAction(s.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.destroyed.b).toHaveLength(1)
    expect(r.game.state.log.some((l) => l.includes('conduitEffect'))).toBe(false)
  })
})

describe('repairCostOf', () => {
  it('is half material cost rounded up, free for scrappy', () => {
    expect(repairCostOf(zoneEntry({ materialCost: 41000 }))).toBe(20500)
    expect(repairCostOf(zoneEntry({ materialCost: 41001 }))).toBe(20501)
    expect(repairCostOf(zoneEntry({ materialCost: 90000, keywords: ['scrappy'] }))).toBe(0)
  })
})
